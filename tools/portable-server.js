const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const ModbusRTU = require("modbus-serial");
const { Historian } = require("../src/historian");
const { createReportApi } = require("../src/report-api");
const { buildHistoricalDailyReport } = require("../src/report-history");
const { createSettingsApi } = require("../src/settings-api");
const { createDispatchApi } = require("../src/dispatch-api");

const root = path.join(__dirname, "..");
const httpPort = Number(process.env.EMS_HTTP_PORT || 8090);
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
const settingsApi = createSettingsApi({
  configPath: path.join(root, "vrfb_modbus_config.json"),
  ModbusClient: ModbusRTU,
});
const dispatchApi = createDispatchApi({
  configPath: path.join(root, "config", "dispatch-config.json"),
});
const historian = new Historian(process.env.EMS_HISTORY_DB || path.join(root, "data", "ems-history.sqlite"));
const reportApi = createReportApi({
  historian,
  mode: process.env.EMS_REPORT_MODE || (process.env.EMS_DATA_MODE === "external" ? "live" : "simulation"),
  buildLiveReport: (date) => buildHistoricalDailyReport({
    historian,
    date,
    config: JSON.parse(fs.readFileSync(path.join(root, "config", "report-config.json"), "utf8")),
  }),
});

function resolveRequestPath(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, "http://127.0.0.1").pathname);
  const relativePath = pathname === "/" ? "vrb_scada_premium.html" : pathname.replace(/^\/+/, "");
  const resolved = path.resolve(root, relativePath);
  return resolved.startsWith(`${root}${path.sep}`) ? resolved : null;
}

const server = http.createServer(async (request, response) => {
  if (await reportApi(request, response)) return;
  if (await dispatchApi(request, response)) return;
  if (await settingsApi(request, response)) return;
  const filePath = resolveRequestPath(request.url);
  if (!filePath) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(data);
  });
});

function shutdown() {
  server.close(() => { historian.close(); process.exit(0); });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

server.listen(httpPort, "127.0.0.1", () => {
  console.log(`[portable] EMS page on http://127.0.0.1:${httpPort}`);
});

if (process.env.EMS_DATA_MODE !== "external") {
  require(path.join(root, "mock-bridge.js"));
}
