const fs = require("node:fs");

const DEVICE_TYPES = new Set(["PCS", "BMS", "COMBINED"]);
const PARITIES = new Set(["none", "even", "odd"]);

function integer(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function normalizeGateway(gateway = {}) {
  return {
    enabled: gateway.enabled === true,
    baudRate: integer(gateway.baudRate, 9600),
    dataBits: integer(gateway.dataBits, 8),
    parity: String(gateway.parity || "none").toLowerCase(),
    stopBits: Number(gateway.stopBits ?? 1),
  };
}

function normalizeDevice(device, defaults) {
  return {
    id: String(device.id || "").trim().toUpperCase(),
    name: String(device.name || device.id || "").trim(),
    type: String(device.type || "COMBINED").trim().toUpperCase(),
    enabled: device.enabled !== false,
    host: String(device.host || "").trim(),
    port: integer(device.port, 502),
    unitId: integer(device.unitId, 1),
    timeoutMs: integer(device.timeoutMs, defaults.timeoutMs),
    pollingIntervalMs: integer(device.pollingIntervalMs, defaults.pollingIntervalMs),
    reconnectIntervalMs: integer(device.reconnectIntervalMs, defaults.reconnectIntervalMs),
    maxRegistersPerRequest: integer(device.maxRegistersPerRequest, defaults.maxRegistersPerRequest),
    gateway: normalizeGateway(device.gateway),
    note: String(device.note || "").trim(),
  };
}

function legacyDevices(config) {
  const legacy = config.device || {};
  return (legacy.unitIds || []).map((unitId) => ({
    id: `UNIT${String(unitId).padStart(2, "0")}`,
    name: `PCS/BMS ${String(unitId).padStart(2, "0")}`,
    type: "COMBINED",
    enabled: true,
    host: legacy.host,
    port: legacy.port,
    unitId,
    timeoutMs: legacy.timeoutMs,
    reconnectIntervalMs: legacy.reconnectIntervalMs,
    maxRegistersPerRequest: legacy.maxRegistersPerRequest,
    pollingIntervalMs: config.polling?.intervalMs,
  }));
}

function normalizeConfig(input = {}) {
  const legacy = input.device || {};
  const defaults = {
    timeoutMs: integer(input.defaults?.timeoutMs ?? legacy.timeoutMs, 1000),
    reconnectIntervalMs: integer(input.defaults?.reconnectIntervalMs ?? legacy.reconnectIntervalMs, 10000),
    pollingIntervalMs: integer(input.defaults?.pollingIntervalMs ?? input.polling?.intervalMs, 1000),
    maxRegistersPerRequest: integer(input.defaults?.maxRegistersPerRequest ?? legacy.maxRegistersPerRequest, 125),
  };
  const sourceDevices = Array.isArray(input.devices) ? input.devices : legacyDevices(input);
  return {
    schemaVersion: 3,
    runtime: { mode: input.runtime?.mode === "mock" ? "mock" : "live" },
    pointModel: String(input.pointModel || "config/vrfb-point-model.json"),
    defaults,
    devices: sourceDevices.map((device) => normalizeDevice(device, defaults)),
    websocket: {
      host: String(input.websocket?.host || "0.0.0.0"),
      port: integer(input.websocket?.port, 8080),
    },
    control: {
      enabled: false,
      tokenEnv: String(input.control?.tokenEnv || "EMS_CONTROL_TOKEN"),
      auditFile: String(input.control?.auditFile || "logs/control-audit.ndjson"),
    },
  };
}

function validHost(host) {
  if (!host || host.length > 253 || /\s/.test(host)) return false;
  const parts = host.split(".");
  if (parts.length === 4 && parts.every((part) => /^\d+$/.test(part))) {
    return parts.every((part) => Number(part) >= 0 && Number(part) <= 255);
  }
  return parts.every((part) => /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)$/.test(part));
}

function inRange(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function validateConfig(config) {
  const errors = [];
  if (!Array.isArray(config.devices)) return ["设备清单必须是数组"];
  const ids = new Set();
  config.devices.forEach((device, index) => {
    const label = `第${index + 1}行`;
    if (!device.id) errors.push(`${label}设备ID不能为空`);
    else if (ids.has(device.id)) errors.push(`${label}设备ID重复：${device.id}`);
    ids.add(device.id);
    if (!DEVICE_TYPES.has(device.type)) errors.push(`${label}设备类型必须为PCS、BMS或COMBINED`);
    if (device.enabled && !validHost(device.host)) errors.push(`${label}IP地址或主机名无效`);
    if (device.enabled && !inRange(device.port, 1, 65535)) errors.push(`${label}端口必须为1～65535`);
    if (device.enabled && !inRange(device.unitId, 0, 255)) errors.push(`${label}Unit ID必须为0～255`);
    if (device.enabled && !inRange(device.timeoutMs, 100, 60000)) errors.push(`${label}响应超时必须为100～60000ms`);
    if (device.enabled && !inRange(device.pollingIntervalMs, 100, 60000)) errors.push(`${label}轮询周期必须为100～60000ms`);
    if (device.enabled && !inRange(device.reconnectIntervalMs, 500, 300000)) errors.push(`${label}重连间隔必须为500～300000ms`);
    if (device.enabled && !inRange(device.maxRegistersPerRequest, 1, 125)) errors.push(`${label}单次寄存器数量必须为1～125`);
    if (device.gateway.enabled) {
      if (!inRange(device.gateway.baudRate, 300, 921600)) errors.push(`${label}网关波特率无效`);
      if (![7, 8].includes(device.gateway.dataBits)) errors.push(`${label}网关数据位必须为7或8`);
      if (!PARITIES.has(device.gateway.parity)) errors.push(`${label}网关校验位无效`);
      if (![1, 2].includes(device.gateway.stopBits)) errors.push(`${label}网关停止位必须为1或2`);
    }
  });
  if (!inRange(config.websocket?.port, 1, 65535)) errors.push("WebSocket端口必须为1～65535");
  return errors;
}

function loadConfig(configPath) {
  return normalizeConfig(JSON.parse(fs.readFileSync(configPath, "utf8")));
}

function publicConfig(config) {
  return normalizeConfig(config);
}

function saveConfigAtomic(configPath, input) {
  const config = normalizeConfig(input);
  const errors = validateConfig(config);
  if (errors.length) throw new Error(errors.join("；"));
  const temporaryPath = `${configPath}.tmp`;
  const backupPath = `${configPath}.bak`;
  if (fs.existsSync(configPath)) fs.copyFileSync(configPath, backupPath);
  fs.writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, configPath);
  return config;
}

module.exports = { loadConfig, normalizeConfig, publicConfig, saveConfigAtomic, validateConfig };
