const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const ModbusRTU = require("modbus-serial");
const { createSettingsApi } = require("../src/settings-api");

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

function resolveRequestPath(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, "http://127.0.0.1").pathname);
  const relativePath = pathname === "/" ? "vrb_scada_premium.html" : pathname.replace(/^\/+/, "");
  const resolved = path.resolve(root, relativePath);
  return resolved.startsWith(`${root}${path.sep}`) ? resolved : null;
}

const server = http.createServer(async (request, response) => {
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

server.listen(httpPort, "127.0.0.1", () => {
  console.log(`[portable] EMS page on http://127.0.0.1:${httpPort}`);
});

if (process.env.EMS_DATA_MODE !== "external") {
  require(path.join(root, "mock-bridge.js"));
}
