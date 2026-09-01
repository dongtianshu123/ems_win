function parseTime(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function classifySample(sample, { now = new Date().toISOString(), pollingIntervalMs = 1000 } = {}) {
  if (!sample || sample.quality !== "GOOD") return sample?.quality || "BAD_COMM";

  const receivedAt = parseTime(sample.receivedAt || sample.sampledAt);
  const currentTime = parseTime(now);
  if (receivedAt === null || currentTime === null) return "STALE";

  const polling = Number.isFinite(Number(pollingIntervalMs)) ? Number(pollingIntervalMs) : 1000;
  const staleAfterMs = Math.max(2 * polling, 3000);
  return currentTime - receivedAt >= staleAfterMs ? "STALE" : "GOOD";
}

function summarizeQuality(qualities) {
  const values = qualities.filter(Boolean);
  if (!values.length) return "BAD_COMM";
  if (values.every((quality) => quality === values[0])) return values[0];
  if (values.includes("GOOD") || values.includes("SIMULATED")) return "PARTIAL";
  if (values.includes("BAD_COMM")) return "BAD_COMM";
  return "PARTIAL";
}

module.exports = { classifySample, summarizeQuality };
