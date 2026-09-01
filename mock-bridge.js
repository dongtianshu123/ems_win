const path = require("node:path");
const WebSocket = require("ws");

const { loadConfig } = require("./src/config-manager");
const { createMockData } = require("./src/mock-data");

const root = process.env.EMS_APP_ROOT || __dirname;
const config = loadConfig(path.join(root, "vrfb_modbus_config.json"));
const websocketPort = Number(process.env.EMS_WS_PORT || config.websocket.port);
const wss = new WebSocket.Server({
  host: config.websocket.host,
  port: websocketPort,
});
let tick = 0;
let latestData = createMockData(tick);

function broadcast() {
  latestData = createMockData(++tick);
  const payload = JSON.stringify({ type: "scada_update", data: latestData });
  for (const socket of wss.clients) {
    if (socket.readyState === WebSocket.OPEN) socket.send(payload);
  }
}

wss.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "scada_update", data: latestData }));
  socket.on("message", (raw) => {
    try {
      const message = JSON.parse(raw.toString());
      if (message.type === "control_command") {
        socket.send(JSON.stringify({
          type: "command_ack",
          commandId: message.command && message.command.id,
          status: "REJECTED",
          reason: "mock_read_only",
        }));
      }
    } catch {
      socket.send(JSON.stringify({ type: "error", reason: "invalid_json" }));
    }
  });
});

setInterval(broadcast, config.defaults.pollingIntervalMs);
wss.on("listening", () => {
  console.log(`[mock] WebSocket simulation on ${config.websocket.host}:${websocketPort}`);
});
