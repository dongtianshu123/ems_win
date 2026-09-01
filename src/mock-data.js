const PCS_IDS = Array.from({ length: 20 }, (_, index) => `PCS${String(index + 1).padStart(2, "0")}`);
const { mapBmsTelemetry, mapPcsTelemetry } = require("./scada-point-map");

function createMockData(tick = 0, timestamp = new Date().toISOString()) {
  const charging = Math.floor(tick / 20) % 2 === 0;
  const direction = charging ? -1 : 1;
  const pcsUnits = PCS_IDS.map((id, index) => {
    const rating = index < 8 ? 500 : 1000;
    const points = {
      "网侧AB线电压": index < 8 ? 300 : 600,
      "网侧BC线电压": index < 8 ? 300 : 600,
      "网侧CA线电压": index < 8 ? 300 : 600,
      "逆变侧AB线电压": index < 8 ? 299 : 599,
      "逆变侧BC线电压": index < 8 ? 299 : 599,
      "逆变侧CA线电压": index < 8 ? 299 : 599,
      "直流电压": index < 8 ? 620 : 1240,
      "直流电流": direction * 400,
      "NPC上电容电压": index < 8 ? 311 : 621,
      "NPC下电容电压": index < 8 ? 309 : 619,
      "输出功率": direction * rating * (0.55 + 0.1 * Math.sin((tick + index) / 6)),
      "无功功率": 0,
      "输出功率因数": 0.98,
      "PCS系统状态-位模式": charging ? 1 : 2,
      "开关反馈": 0b00101111,
    };
    const telemetry = mapPcsTelemetry(points);
    return {
      id,
      unitId: index + 1,
      type: "NPC-3L",
      P: telemetry.power.active,
      Q: 0,
      Vdc: index < 8 ? 620 : 1240,
      Idc: direction * 400,
      Va: index < 8 ? 300 : 600,
      Vb: index < 8 ? 300 : 600,
      Vc: index < 8 ? 300 : 600,
      pf: 0.98,
      eff: 94,
      modeName: charging ? "恒功率充电" : "恒功率放电",
      runState: charging ? 1 : 2,
      telemetry,
    };
  });
  const batteryGroups = pcsUnits.map((pcs, index) => {
    const points = {
      "DATA228_正极循环流量": 90 + Math.sin((tick + index) / 5),
      "DATA230_负极循环流量": 88 + Math.sin((tick + index) / 5),
      "DATA231_BMS充放电直流电流": direction * 400,
      "DATA232_BMS电堆直流电压": pcs.Vdc,
      "DATA266_SOC": 60 + 8 * Math.sin((tick + index) / 20),
      "DATA267_正极管路压力1": 25,
      "DATA268_正极管路压力2": 24,
      "DATA269_负极管路压力1": 23,
      "DATA270_负极管路压力2": 22,
      "DATA271_正极罐压力1": 20,
      "DATA272_负极罐压力1": 19,
      "DATA273_电解液温度": 30,
      "DATA274_BMS柜温度": 29,
      "DATA282_正极储液罐液位": 65,
      "DATA283_负极储液罐液位": 63,
    };
    for (let zone = 1; zone <= 15; zone += 1) {
      points[`DATA${232 + zone}_A分区电压${zone}`] = 1.40 + zone * 0.001;
      points[`DATA${248 + zone}_B分区电压${zone}`] = 1.39 + zone * 0.001;
    }
    const bms = mapBmsTelemetry(points);
    return {
        id: `BMS${String(index + 1).padStart(2, "0")}`,
        pcsId: pcs.id,
        unitId: index + 1,
        mappingStatus: "ONE_BMS_PER_PCS_ASSUMED",
        stackTopology: { series: 5, parallel: 3, total: 15 },
        bms,
        soc: bms.soc,
        soh: 95,
        V: bms.dc.voltage,
        I: bms.dc.current,
        T: bms.temperature.electrolyte,
        status: "on",
    };
  });
  const totalPower = pcsUnits.reduce((sum, pcs) => sum + pcs.P, 0);

  return {
    meta: {
      source: "mock", simulated: true, quality: "SIMULATED", receivedAt: timestamp,
      protocol: { name: "Modbus TCP", port: 502, readFunctionCode: 3, writeFunctionCode: 6 },
      pointTable: { version: "1.2", workbook: "EMS通信点表V1.2.xlsx" },
    },
    timestamp,
    grid35kV: { U: 35.1, I: 180, F: 50 },
    station: {
      totalPower,
      avgSoc: 60,
      avgSoh: 95,
      dailyEnergy: 20,
      efficiency: 76,
      chargeMode: charging ? "充电模式" : "放电模式",
      chargeModeIcon: charging ? "↓" : "↑",
    },
    pcsUnits,
    batteryGroups,
    transformers: [
      { id: 1, name: "变压器#1", ratingMW: 2, secV: 300, loadPct: 55 },
      { id: 2, name: "变压器#2", ratingMW: 2, secV: 300, loadPct: 57 },
      { id: 3, name: "变压器#3", ratingMW: 2, secV: 600, loadPct: 60 },
      { id: 4, name: "变压器#4", ratingMW: 2, secV: 600, loadPct: 58 },
      { id: 5, name: "变压器#5", ratingMW: 2, secV: 600, loadPct: 56 },
    ],
    electrolyte: Object.fromEntries(batteryGroups.map((battery) => [battery.id, {
      posLevel: 65,
      posTemp: 30,
      posPress: 0.25,
      posPumpSpeed: 1450,
      posPumpFlow: 90,
      posValve: 90,
      posFreq: 40,
      negLevel: 63,
      negTemp: 29,
      negPress: 0.23,
      negPumpSpeed: 1420,
      negPumpFlow: 88,
      negValve: 88,
      negFreq: 39,
    }])),
    socHistory: Array.from({ length: 24 }, (_, index) => 55 + 10 * Math.sin((tick + index) / 8)),
    powerHistory: Array.from({ length: 24 }, (_, index) => 5 * Math.sin((tick + index) / 6)),
    gridMeters: [],
    sensor: {},
    alarms: [],
  };
}

module.exports = { createMockData };
