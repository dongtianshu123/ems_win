const fs = require("node:fs");
const path = require("node:path");
const ModbusRTU = require("modbus-serial");
const WebSocket = require("ws");

const { AlarmEngine } = require("./src/alarm-engine");
const { createReadBlocks, decodeBlock, deriveControlState, SerialTransport } = require("./src/bridge-core");
const { CommandEngine } = require("./src/command-engine");
const { buildConnectionStatuses } = require("./src/connection-status");
const { loadConfig, validateConfig } = require("./src/config-manager");
const { Historian } = require("./src/historian");
const { loadPointModel, validatePointModel, getPointByAddress } = require("./src/point-model");
const { groupDevicesByEndpoint, runWithConcurrency, SerializedPoller } = require("./src/poll-scheduler");
const { buildScadaData } = require("./src/scada-mapper");

const root = process.env.EMS_APP_ROOT || __dirname;
const config = loadConfig(path.join(root, "vrfb_modbus_config.json"));
const configErrors = validateConfig(config);
if (configErrors.length) throw new Error(`Invalid Modbus configuration: ${configErrors.join("; ")}`);
if (config.runtime.mode !== "live") throw new Error("modbus-bridge.js requires runtime.mode=live; use mock-bridge.js for simulation");

const pointModel = loadPointModel(path.join(root, config.pointModel));
validatePointModel(pointModel);
const snapshots = {};
const runtimes = new Map();
const endpoints = new Map();
const alarmEngine = new AlarmEngine();
const historyQueue = [];
let historyFlushTimer = null;
let historian = null;
try {
  historian = new Historian(process.env.EMS_HISTORY_DB || path.join(root, "data", "ems-history.sqlite"));
} catch (error) {
  console.error(`[bridge] 历史库初始化失败，实时采集继续运行: ${error.message}`);
  alarmEngine.raise({
    key: "SYSTEM:HISTORIAN_FAILURE",
    deviceId: "EMS",
    code: "HISTORIAN_FAILURE",
    severity: "WARNING",
    message: "历史库初始化或写入失败",
    value: error.message,
  });
}
let latestData = null;

const websocketPort = Number(process.env.EMS_WS_PORT || config.websocket.port);
const wss = new WebSocket.Server({ host: config.websocket.host, port: websocketPort });

wss.once("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`[bridge] 端口 ${websocketPort} 已被占用，真实通讯桥接可能已经运行，请勿重复启动。`);
    process.exit(2);
    return;
  }
  console.error(`[bridge] WebSocket服务启动失败: ${error.message}`);
  process.exit(1);
});

function appendAudit(event) {
  const auditPath = path.join(root, config.control.auditFile);
  fs.mkdirSync(path.dirname(auditPath), { recursive: true });
  fs.appendFileSync(auditPath, `${JSON.stringify(event)}\n`, "utf8");
}

function broadcast(message) {
  const payload = JSON.stringify(message);
  for (const socket of wss.clients) {
    if (socket.readyState === WebSocket.OPEN) socket.send(payload);
  }
}

function publish() {
  latestData = buildScadaData(snapshots, new Date().toISOString(), alarmEngine.listActive());
  latestData.meta.connections = buildConnectionStatuses(endpoints.values());
  broadcast({ type: "scada_update", data: latestData });
}

function setEndpointState(endpoint, status, error = null) {
  endpoint.status = status;
  endpoint.lastError = error ? error.message : null;
}

function evaluateSnapshotAlarm(snapshot) {
  alarmEngine.evaluateDevice({
    deviceId: snapshot.device.id,
    quality: snapshot.quality,
    temperature: snapshot.points?.["DATA273_电解液温度"],
    flowPositive: snapshot.points?.["DATA228_正极循环流量"],
    flowNegative: snapshot.points?.["DATA230_负极循环流量"],
  });
}

function flushHistory() {
  historyFlushTimer = null;
  if (!historian || !historyQueue.length) return;
  const batch = historyQueue.splice(0, historyQueue.length);
  try {
    historian.insertTelemetryBatch(batch);
    alarmEngine.clear("SYSTEM:HISTORIAN_FAILURE", "historian_write_restored");
  } catch (error) {
    console.error(`[bridge] 历史库写入失败，实时采集继续运行: ${error.message}`);
    alarmEngine.raise({
      key: "SYSTEM:HISTORIAN_FAILURE",
      deviceId: "EMS",
      code: "HISTORIAN_FAILURE",
      severity: "WARNING",
      message: "历史库初始化或写入失败",
      value: error.message,
    });
  }
}

function queueHistory(snapshot) {
  historyQueue.push({
    deviceId: snapshot.device.id,
    deviceType: snapshot.device.type,
    sampledAt: snapshot.sampledAt,
    receivedAt: snapshot.receivedAt,
    quality: snapshot.quality,
    source: "MODBUS_TCP",
    points: snapshot.points,
  });
  if (!historyFlushTimer) historyFlushTimer = setTimeout(flushHistory, 200);
}

function badSnapshot(device, error) {
  return {
    quality: "BAD_COMM",
    sampledAt: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    points: {},
    error: error.message,
    device,
  };
}

async function pollDevice(runtime) {
  const { device, endpoint, readBlocks } = runtime;
  const { client, transport } = endpoint;
  const sampledAt = new Date().toISOString();
  const points = {};
  for (const block of readBlocks) {
    const decoded = await transport.execute(async () => {
      if (!client?.isOpen) throw new Error("modbus_not_connected");
      client.setTimeout(device.timeoutMs);
      client.setID(device.unitId);
      const response = await client.readHoldingRegisters(block.startAddress - 1, block.count);
      return decodeBlock(block, response.data);
    });
    Object.assign(points, decoded);
  }
  return { quality: "GOOD", sampledAt, receivedAt: new Date().toISOString(), points, device };
}

async function runPollCycle(runtime) {
  const result = await runtime.poller.runCycle([{ id: runtime.device.id, run: () => pollDevice(runtime) }]);
  if (result.skipped) return;
  const entry = result.results[0];
  snapshots[runtime.device.id] = entry.ok ? entry.value : badSnapshot(runtime.device, entry.error);
  if (entry.ok) {
    setEndpointState(runtime.endpoint, "CONNECTED");
    runtime.endpoint.lastPollAt = snapshots[runtime.device.id].receivedAt;
  } else {
    setEndpointState(runtime.endpoint, "POLL_ERROR", entry.error);
  }
  queueHistory(snapshots[runtime.device.id]);
  evaluateSnapshotAlarm(snapshots[runtime.device.id]);
  publish();
  if (!entry.ok && !runtime.endpoint.client?.isOpen) {
    stopEndpoint(runtime.endpoint);
    scheduleReconnect(runtime.endpoint);
  }
}

function stopEndpoint(endpoint) {
  for (const runtime of endpoint.runtimes) {
    if (runtime.pollTimer) clearInterval(runtime.pollTimer);
    runtime.pollTimer = null;
  }
  endpoint.client = null;
}

function scheduleReconnect(endpoint) {
  if (endpoint.reconnectTimer) clearTimeout(endpoint.reconnectTimer);
  endpoint.reconnectTimer = setTimeout(() => connect(endpoint), endpoint.reconnectIntervalMs);
  setEndpointState(endpoint, "RETRY_WAIT", endpoint.lastError ? new Error(endpoint.lastError) : null);
  publish();
}

function markEndpointBad(endpoint, error) {
  for (const runtime of endpoint.runtimes) {
    snapshots[runtime.device.id] = badSnapshot(runtime.device, error);
    queueHistory(snapshots[runtime.device.id]);
    evaluateSnapshotAlarm(snapshots[runtime.device.id]);
  }
  publish();
}

async function connect(endpoint) {
  if (endpoint.connecting) return;
  endpoint.connecting = true;
  endpoint.lastAttemptAt = new Date().toISOString();
  setEndpointState(endpoint, "CONNECTING");
  publish();
  if (endpoint.reconnectTimer) clearTimeout(endpoint.reconnectTimer);
  endpoint.reconnectTimer = null;
  const client = new ModbusRTU();
  endpoint.client = client;
  try {
    await client.connectTCP(endpoint.host, { port: endpoint.port });
    endpoint.lastConnectedAt = new Date().toISOString();
    setEndpointState(endpoint, "CONNECTED");
    publish();
    console.log(`[bridge] endpoint ${endpoint.key} connected for ${endpoint.runtimes.length} device(s)`);
    client.on("close", () => {
      stopEndpoint(endpoint);
      setEndpointState(endpoint, "DISCONNECTED", new Error("connection_closed"));
      markEndpointBad(endpoint, new Error("connection_closed"));
      scheduleReconnect(endpoint);
    });
    client.on("error", (error) => console.error(`[bridge] endpoint ${endpoint.key}:`, error.message));
    for (const runtime of endpoint.runtimes) {
      await runPollCycle(runtime);
      if (endpoint.client === client && client.isOpen) {
        runtime.pollTimer = setInterval(() => runPollCycle(runtime), runtime.device.pollingIntervalMs);
      }
    }
  } catch (error) {
    console.error(`[bridge] endpoint ${endpoint.key} connection failed:`, error.message);
    markEndpointBad(endpoint, error);
    setEndpointState(endpoint, "RETRY_WAIT", error);
    stopEndpoint(endpoint);
    scheduleReconnect(endpoint);
  } finally {
    endpoint.connecting = false;
  }
}

async function writeCommand(request) {
  const runtime = [...runtimes.values()].find((candidate) => candidate.device.unitId === request.unitId && candidate.endpoint.client?.isOpen);
  if (!runtime) throw new Error("modbus_not_connected");
  const point = getPointByAddress(pointModel, request.address);
  const rawValue = request.value / point.scale;
  if (!Number.isInteger(rawValue) || rawValue < -32768 || rawValue > 65535) throw new Error("value_not_representable");
  return runtime.endpoint.transport.execute(async () => {
    runtime.endpoint.client.setTimeout(runtime.device.timeoutMs);
    runtime.endpoint.client.setID(request.unitId);
    await runtime.endpoint.client.writeRegister(request.protocolOffset, rawValue & 0xffff);
    return { transactionId: `${runtime.device.id}-${request.address}-${Date.now()}` };
  });
}

const commandEngine = new CommandEngine({
  pointModel,
  enabled: config.control.enabled || process.env.EMS_CONTROL_ENABLED === "true",
  token: process.env[config.control.tokenEnv],
  stateProvider: () => deriveControlState(snapshots),
  writer: writeCommand,
  audit: appendAudit,
});

wss.on("connection", (socket) => {
  if (latestData) socket.send(JSON.stringify({ type: "scada_update", data: latestData }));
  socket.on("message", async (raw) => {
    let message;
    try { message = JSON.parse(raw.toString()); }
    catch {
      socket.send(JSON.stringify({ type: "error", reason: "invalid_json" }));
      return;
    }
    if (message.type !== "control_command") return;
    const ack = await commandEngine.execute(message.command, message.token);
    socket.send(JSON.stringify(ack));
  });
});

const enabledDevices = config.devices.filter((device) => device.enabled);
for (const group of groupDevicesByEndpoint(enabledDevices)) {
  const endpoint = {
    ...group,
    client: null,
    connecting: false,
    reconnectTimer: null,
    reconnectIntervalMs: Math.min(...group.devices.map((device) => device.reconnectIntervalMs)),
    runtimes: [],
    transport: new SerialTransport(),
    status: "WAITING",
    lastAttemptAt: null,
    lastConnectedAt: null,
    lastPollAt: null,
    lastError: null,
  };
  endpoints.set(endpoint.key, endpoint);
  for (const device of group.devices) {
    const runtime = {
      device,
      endpoint,
      pollTimer: null,
      poller: new SerializedPoller(),
      readBlocks: createReadBlocks(pointModel, device.maxRegistersPerRequest, device.type),
    };
    endpoint.runtimes.push(runtime);
    runtimes.set(device.id, runtime);
  }
}

console.log(`[bridge] Point model: ${pointModel.points.length} points; enabled devices: ${enabledDevices.length}; endpoints: ${endpoints.size}`);
for (const device of enabledDevices) console.log(`[bridge] target ${device.id} (${device.type}) ${device.host}:${device.port}, Unit ${device.unitId}`);
console.log(`[bridge] Live control enabled: ${commandEngine.enabled}`);
wss.once("listening", () => {
  console.log(`[bridge] WebSocket server listening on ${config.websocket.host}:${websocketPort}`);
  (async () => {
    await runWithConcurrency([...endpoints.values()], 16, connect);
  })();
});

function shutdown() {
  if (historyFlushTimer) clearTimeout(historyFlushTimer);
  flushHistory();
  if (historian) historian.close();
  historian = null;
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
