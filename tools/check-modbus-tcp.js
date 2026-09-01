const path = require("node:path");
const ModbusRTU = require("modbus-serial");
const { loadConfig } = require("../src/config-manager");

const root = path.join(__dirname, "..");
const config = loadConfig(path.join(root, "vrfb_modbus_config.json"));

async function checkDevice(device) {
  const client = new ModbusRTU();
  const startedAt = Date.now();
  try {
    await client.connectTCP(device.host, { port: device.port });
    client.setTimeout(device.timeoutMs);
    client.setID(device.unitId);
    const response = await client.readHoldingRegisters(0, 1);
    return {
      deviceId: device.id,
      name: device.name,
      type: device.type,
      target: `${device.host}:${device.port}`,
      unitId: device.unitId,
      status: "PASS",
      latencyMs: Date.now() - startedAt,
      address: 1,
      protocolOffset: 0,
      value: response.data[0],
    };
  } catch (error) {
    return {
      deviceId: device.id,
      name: device.name,
      type: device.type,
      target: `${device.host}:${device.port}`,
      unitId: device.unitId,
      status: "FAIL",
      latencyMs: Date.now() - startedAt,
      error: error.message,
    };
  } finally {
    if (client.isOpen) client.close(() => {});
  }
}

async function main() {
  const devices = config.devices.filter((device) => device.enabled);
  const report = {
    protocol: "Modbus TCP",
    operation: "FC03 read-only diagnostic",
    checkedAt: new Date().toISOString(),
    devices: [],
  };
  for (const device of devices) report.devices.push(await checkDevice(device));
  report.passed = report.devices.filter((device) => device.status === "PASS").length;
  report.failed = report.devices.length - report.passed;
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.devices.length || report.passed === 0) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
