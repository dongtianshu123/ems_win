const { mapBmsTelemetry, mapPcsTelemetry } = require("./scada-point-map");
const { classifySample, summarizeQuality } = require("./data-quality");

function deviceId(prefix, unitId) {
  return `${prefix}${String(unitId).padStart(2, "0")}`;
}

function configuredDeviceId(prefix, key, device) {
  if (device?.id?.startsWith(prefix)) return device.id;
  const suffix = String(device?.id || key).match(/(\d+)$/)?.[1];
  return suffix ? `${prefix}${suffix.padStart(2, "0")}` : `${prefix}-${device?.id || key}`;
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function average(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function buildScadaData(snapshots, receivedAt = new Date().toISOString(), alarms = []) {
  const entries = Object.entries(snapshots).sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }));
  const pcsUnits = [];
  const batteryGroups = [];
  const quality = {};

  for (const [key, snapshot] of entries) {
    const device = snapshot.device;
    const effectiveQuality = classifySample(snapshot, {
      now: receivedAt,
      pollingIntervalMs: device?.pollingIntervalMs,
    });
    const numericUnitId = Number(device?.unitId ?? key);
    const type = device?.type || "COMBINED";
    const includePcs = type === "PCS" || type === "COMBINED";
    const includeBms = type === "BMS" || type === "COMBINED";
    const pcsId = device ? configuredDeviceId("PCS", key, device) : deviceId("PCS", numericUnitId);
    const bmsId = device ? configuredDeviceId("BMS", key, device) : deviceId("BMS", numericUnitId);
    const points = effectiveQuality === "GOOD" ? snapshot.points || {} : {};
    const telemetry = mapPcsTelemetry(points);
    const bms = mapBmsTelemetry(points);
    const P = numberOrNull(points["输出功率"]);
    const Q = numberOrNull(points["无功功率"]);
    if (includePcs) pcsUnits.push({
      id: pcsId,
      unitId: numericUnitId,
      type: "NPC-3L",
      P,
      Q,
      Vdc: numberOrNull(points["直流电压"]),
      Idc: numberOrNull(points["直流电流"]),
      Va: numberOrNull(points["网侧AB线电压"]),
      Vb: numberOrNull(points["网侧BC线电压"]),
      Vc: numberOrNull(points["网侧CA线电压"]),
      modeName: null,
      runState: numberOrNull(points["PCS系统状态-位模式"]),
      telemetry,
    });
    if (includeBms) batteryGroups.push({
      id: bmsId,
      pcsId,
      unitId: numericUnitId,
      mappingStatus: device ? "CONFIGURED_DEVICE_MAPPING" : "ONE_BMS_PER_PCS_ASSUMED",
      stackTopology: { series: 5, parallel: 3, total: 15 },
      bms,
      soc: bms.soc,
      soh: null,
      V: bms.dc.voltage,
      I: bms.dc.current,
      T: bms.temperature.electrolyte,
      status: effectiveQuality === "GOOD" ? "on" : "off",
    });
    for (const id of [includePcs && pcsId, includeBms && bmsId].filter(Boolean)) {
      quality[id] = {
        quality: effectiveQuality,
        sampledAt: snapshot.sampledAt,
        error: snapshot.error || null,
      };
    }
  }

  const qualities = entries.map(([, snapshot]) => classifySample(snapshot, {
    now: receivedAt,
    pollingIntervalMs: snapshot.device?.pollingIntervalMs,
  }));
  const overallQuality = summarizeQuality(qualities);
  const powers = pcsUnits.map((pcs) => pcs.P).filter(Number.isFinite);
  const totalPower = powers.length ? powers.reduce((sum, value) => sum + value, 0) : null;
  const avgSoc = average(batteryGroups.map((battery) => battery.soc));

  return {
    meta: {
      source: "live",
      simulated: false,
      quality: overallQuality,
      receivedAt,
      topologyMapping: "每台PCS对应一个BMS，BMS物理拓扑按5串3并（15电堆）展示",
      protocol: { name: "Modbus TCP", port: 502, readFunctionCode: 3, writeFunctionCode: 6 },
      pointTable: { version: "1.2", workbook: "EMS通信点表V1.2.xlsx" },
      deviceQuality: quality,
    },
    timestamp: receivedAt,
    grid35kV: { U: null, I: null, F: null },
    station: {
      totalPower,
      avgSoc,
      avgSoh: null,
      dailyEnergy: null,
      efficiency: null,
      chargeMode: totalPower === null ? "数据无效" : totalPower < 0 ? "充电模式" : "放电模式",
      chargeModeIcon: totalPower !== null && totalPower < 0 ? "↓" : "↑",
    },
    pcsUnits,
    batteryGroups,
    transformers: [],
    electrolyte: {},
    socHistory: [],
    powerHistory: [],
    gridMeters: [],
    sensor: {},
    alarms,
  };
}

module.exports = { buildScadaData };
