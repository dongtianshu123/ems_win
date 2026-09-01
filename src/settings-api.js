const { loadConfig, normalizeConfig, publicConfig, saveConfigAtomic, validateConfig } = require("./config-manager");

const MAX_BODY_BYTES = 256 * 1024;

function sendJson(response, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("请求内容超过256 KiB限制"), { statusCode: 413 }));
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (size > MAX_BODY_BYTES) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(Object.assign(new Error("JSON格式无效"), { statusCode: 400 })); }
    });
    request.on("error", reject);
  });
}

function diagnosticConfig(device) {
  return normalizeConfig({
    schemaVersion: 3,
    devices: [{ ...device, enabled: true }],
    control: { enabled: false },
  });
}

function withTimeout(promise, timeoutMs, message) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function runReadOnlyDiagnostic(ModbusClient, device, address = 1, count = 1) {
  const config = diagnosticConfig(device);
  const errors = validateConfig(config);
  if (errors.length) throw Object.assign(new Error(errors.join("；")), { statusCode: 422 });
  const startAddress = Number(address);
  const registerCount = Number(count);
  if (!Number.isInteger(startAddress) || startAddress < 1 || startAddress > 65536) {
    throw Object.assign(new Error("测试地址必须为1～65536"), { statusCode: 422 });
  }
  if (!Number.isInteger(registerCount) || registerCount < 1 || registerCount > 125 || startAddress - 1 + registerCount > 65536) {
    throw Object.assign(new Error("测试寄存器数量必须为1～125且不能超出地址范围"), { statusCode: 422 });
  }
  const target = config.devices[0];
  const client = new ModbusClient();
  const startedAt = Date.now();
  let connected = false;
  try {
    await withTimeout(
      client.connectTCP(target.host, { port: target.port }),
      target.timeoutMs,
      `连接超时：${target.host}:${target.port} 未在 ${target.timeoutMs} ms 内响应`
    );
    connected = true;
    client.setTimeout(target.timeoutMs);
    client.setID(target.unitId);
    const response = await client.readHoldingRegisters(startAddress - 1, registerCount);
    return {
      deviceId: target.id,
      target: `${target.host}:${target.port}`,
      unitId: target.unitId,
      operation: "FC03 read-only diagnostic",
      address: startAddress,
      count: registerCount,
      latencyMs: Date.now() - startedAt,
      values: response.data,
    };
  } finally {
    if (connected && typeof client.close === "function") {
      try { await client.close(); }
      catch {}
    } else if (typeof client.destroy === "function") {
      try { client.destroy(() => {}); }
      catch {}
    }
  }
}

function createSettingsApi({ configPath, ModbusClient, buildVersion = process.env.EMS_BUILD_VERSION || "development" }) {
  return async function handleSettingsApi(request, response) {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    if (!pathname.startsWith("/api/")) return false;
    try {
      if (pathname === "/api/runtime" && request.method === "GET") {
        sendJson(response, 200, { ok: true, service: "VRFB_EMS_SETTINGS_API", buildVersion });
        return true;
      }
      if (pathname === "/api/config" && request.method === "GET") {
        sendJson(response, 200, { ok: true, config: publicConfig(loadConfig(configPath)) });
        return true;
      }
      if (pathname === "/api/config" && request.method === "PUT") {
        const candidate = normalizeConfig(await readJson(request));
        const errors = validateConfig(candidate);
        if (errors.length) {
          sendJson(response, 422, { ok: false, error: "参数校验失败", errors });
          return true;
        }
        const saved = saveConfigAtomic(configPath, candidate);
        sendJson(response, 200, { ok: true, config: publicConfig(saved), restartRequired: true });
        return true;
      }
      if (pathname === "/api/modbus/test" && request.method === "POST") {
        const body = await readJson(request);
        const result = await runReadOnlyDiagnostic(ModbusClient, body.device, body.address, body.count);
        sendJson(response, 200, { ok: true, result });
        return true;
      }
      sendJson(response, 405, { ok: false, error: "不支持的API或请求方法" });
      return true;
    } catch (error) {
      const statusCode = error.statusCode || (pathname === "/api/modbus/test" ? 502 : 500);
      sendJson(response, statusCode, { ok: false, error: error.message || "服务器内部错误" });
      return true;
    }
  };
}

module.exports = { createSettingsApi, runReadOnlyDiagnostic };
