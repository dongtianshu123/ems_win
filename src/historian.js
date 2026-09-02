const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

class Historian {
  constructor(databasePath) {
    if (!databasePath) throw new Error("historian_database_path_required");
    if (databasePath !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });

    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS telemetry (
        id INTEGER PRIMARY KEY,
        device_id TEXT NOT NULL,
        device_type TEXT,
        point_name TEXT NOT NULL,
        value REAL,
        quality TEXT NOT NULL,
        source TEXT,
        sampled_at TEXT NOT NULL,
        received_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_telemetry_query
        ON telemetry(device_id, point_name, sampled_at, quality);
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY,
        event_id TEXT,
        device_id TEXT,
        event_type TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS commands (
        id INTEGER PRIMARY KEY,
        transaction_id TEXT,
        device_id TEXT,
        issued_at TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS config_versions (
        id INTEGER PRIMARY KEY,
        version TEXT NOT NULL,
        saved_at TEXT NOT NULL,
        operator TEXT,
        payload_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS daily_reports (
        id INTEGER PRIMARY KEY,
        report_date TEXT NOT NULL,
        version INTEGER NOT NULL,
        generated_at TEXT NOT NULL,
        source TEXT NOT NULL,
        review_status TEXT NOT NULL,
        report_json TEXT NOT NULL,
        UNIQUE(report_date, version)
      );
    `);
    this.insertTelemetry = this.database.prepare(`
      INSERT INTO telemetry
        (device_id, device_type, point_name, value, quality, source, sampled_at, received_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  insertTelemetryBatch(samples) {
    if (!Array.isArray(samples)) throw new Error("historian_samples_must_be_array");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const sample of samples) {
        const entries = Object.entries(sample.points || {});
        const rows = entries.length ? entries : [["__STATUS__", null]];
        for (const [pointName, value] of rows) {
          this.insertTelemetry.run(
            sample.deviceId,
            sample.deviceType || null,
            pointName,
            Number.isFinite(value) ? value : null,
            sample.quality,
            sample.source || null,
            sample.sampledAt,
            sample.receivedAt || sample.sampledAt,
          );
        }
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  queryTelemetry({ deviceId, pointName, from, to, qualities } = {}) {
    const conditions = [];
    const parameters = [];
    if (deviceId) { conditions.push("device_id = ?"); parameters.push(deviceId); }
    if (pointName) { conditions.push("point_name = ?"); parameters.push(pointName); }
    if (from) { conditions.push("sampled_at >= ?"); parameters.push(from); }
    if (to) { conditions.push("sampled_at <= ?"); parameters.push(to); }
    if (qualities?.length) {
      conditions.push(`quality IN (${qualities.map(() => "?").join(", ")})`);
      parameters.push(...qualities);
    }
    const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
    return this.database.prepare(`
      SELECT device_id AS deviceId, device_type AS deviceType, point_name AS pointName,
             value, quality, source, sampled_at AS sampledAt, received_at AS receivedAt
      FROM telemetry${where}
      ORDER BY sampled_at, id
    `).all(...parameters);
  }

  aggregateMinutes({ deviceId, pointName, from, to, qualities = ["GOOD"] }) {
    if (!deviceId || !pointName) throw new Error("historian_aggregate_device_and_point_required");
    const conditions = ["device_id = ?", "point_name = ?", "value IS NOT NULL"];
    const parameters = [deviceId, pointName];
    if (from) { conditions.push("sampled_at >= ?"); parameters.push(from); }
    if (to) { conditions.push("sampled_at <= ?"); parameters.push(to); }
    if (qualities.length) {
      conditions.push(`quality IN (${qualities.map(() => "?").join(", ")})`);
      parameters.push(...qualities);
    }
    return this.database.prepare(`
      SELECT substr(sampled_at, 1, 16) || ':00.000Z' AS minute,
             avg(value) AS average, min(value) AS minimum, max(value) AS maximum,
             count(*) AS count
      FROM telemetry
      WHERE ${conditions.join(" AND ")}
      GROUP BY substr(sampled_at, 1, 16)
      ORDER BY minute
    `).all(...parameters).map((row) => ({ ...row }));
  }

  saveDailyReport(report, { source = "HISTORIAN", reviewStatus = "DRAFT" } = {}) {
    if (!report?.date) throw new Error("daily_report_date_required");
    const latest = this.database.prepare("SELECT max(version) AS version FROM daily_reports WHERE report_date = ?").get(report.date);
    const version = Number(latest.version || 0) + 1;
    const generatedAt = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO daily_reports (report_date, version, generated_at, source, review_status, report_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(report.date, version, generatedAt, source, reviewStatus, JSON.stringify(report));
    return { date: report.date, version, generatedAt, source, reviewStatus, report };
  }

  getDailyReport(date, version) {
    const row = version === undefined
      ? this.database.prepare("SELECT * FROM daily_reports WHERE report_date = ? ORDER BY version DESC LIMIT 1").get(date)
      : this.database.prepare("SELECT * FROM daily_reports WHERE report_date = ? AND version = ?").get(date, version);
    if (!row) return null;
    return {
      date: row.report_date, version: row.version, generatedAt: row.generated_at,
      source: row.source, reviewStatus: row.review_status, report: JSON.parse(row.report_json),
    };
  }

  listDailyReports() {
    return this.database.prepare(`
      SELECT report_date AS date, max(version) AS latestVersion, max(generated_at) AS generatedAt
      FROM daily_reports GROUP BY report_date ORDER BY report_date DESC
    `).all().map((row) => ({ ...row }));
  }

  listTables() {
    return this.database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all().map((row) => row.name);
  }

  close() {
    this.database.close();
  }
}

module.exports = { Historian };
