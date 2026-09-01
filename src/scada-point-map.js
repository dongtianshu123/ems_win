function point(name, address, scale = 1) {
  return Object.freeze({ name, address, protocolOffset: address - 1, scale });
}

const SCADA_POINT_MAP = Object.freeze({
  protocol: Object.freeze({
    name: "Modbus TCP",
    port: 502,
    readFunctionCode: 3,
    writeFunctionCode: 6,
    addressBase: 0,
  }),
  pcs: Object.freeze({
    gridVoltageAB: point("网侧AB线电压", 100, 0.1),
    gridVoltageBC: point("网侧BC线电压", 101, 0.1),
    gridVoltageCA: point("网侧CA线电压", 102, 0.1),
    inverterVoltageAB: point("逆变侧AB线电压", 103, 0.1),
    inverterVoltageBC: point("逆变侧BC线电压", 104, 0.1),
    inverterVoltageCA: point("逆变侧CA线电压", 105, 0.1),
    dcVoltage: point("直流电压", 106, 0.1),
    dcCurrent: point("直流电流", 107),
    filterInductorCurrentA: point("滤波电感A相电流", 108, 0.1),
    filterInductorCurrentB: point("滤波电感B相电流", 109, 0.1),
    filterInductorCurrentC: point("滤波电感C相电流", 110, 0.1),
    inverterCurrentA: point("逆变A相电流", 111, 0.1),
    inverterCurrentB: point("逆变B相电流", 112, 0.1),
    inverterCurrentC: point("逆变C相电流", 113, 0.1),
    npcUpperCapVoltage: point("NPC上电容电压", 114, 0.1),
    npcLowerCapVoltage: point("NPC下电容电压", 115, 0.1),
    filterCapCurrentA: point("滤波电容A相电流", 116, 0.1),
    filterCapCurrentB: point("滤波电容B相电流", 117, 0.1),
    filterCapCurrentC: point("滤波电容C相电流", 118, 0.1),
    temperatureA: point("A相温度", 119, 0.1),
    temperatureB: point("B相温度", 120, 0.1),
    temperatureC: point("C相温度", 121, 0.1),
    batteryPower: point("电池功率", 122, 0.1),
    activePower: point("输出功率", 123, 0.1),
    reactivePower: point("无功功率", 124, 0.1),
    powerFactor: point("输出功率因数", 125, 0.1),
    apparentPower: point("电网视在功率", 126, 0.1),
    systemState: point("PCS系统状态-位模式", 180),
    switchFeedback: point("开关反馈", 188),
  }),
  bms: Object.freeze({
    flowPositive: point("DATA228_正极循环流量", 3),
    flowNegative: point("DATA230_负极循环流量", 5),
    dcCurrent: point("DATA231_BMS充放电直流电流", 6),
    dcVoltage: point("DATA232_BMS电堆直流电压", 7, 0.1),
    socVoltage: point("DATA265_SOC电压", 40),
    soc: point("DATA266_SOC", 41),
    positivePipePressure1: point("DATA267_正极管路压力1", 42),
    positivePipePressure2: point("DATA268_正极管路压力2", 43),
    negativePipePressure1: point("DATA269_负极管路压力1", 44),
    negativePipePressure2: point("DATA270_负极管路压力2", 45),
    positiveTankPressure: point("DATA271_正极罐压力1", 46),
    negativeTankPressure: point("DATA272_负极罐压力1", 47),
    electrolyteTemperature: point("DATA273_电解液温度", 48),
    cabinetTemperature: point("DATA274_BMS柜温度", 49),
    maxCellVoltage: point("DATA275_最高单体电压", 50),
    minCellVoltage: point("DATA276_最低单体电压", 51),
    heartbeat: point("DATA277_BMS心跳字", 52),
    chargeCurrentLimit: point("DATA278_充电限制电流", 53),
    dischargeCurrentLimit: point("DATA279_放电限制电流", 54),
    chargeVoltageLimit: point("DATA280_充电限制电压", 55),
    dischargeVoltageLimit: point("DATA281_放电限制电压", 56),
    levelPositive: point("DATA282_正极储液罐液位", 57),
    levelNegative: point("DATA283_负极储液罐液位", 58),
    pumpValveStatus: point("DATA284_泵阀状态字", 59),
    faultWord1: point("DATA285_故障字1", 60),
    faultWord2: point("DATA286_故障字2", 61),
    faultWord3: point("DATA287_故障字3", 62),
    faultWord4: point("DATA288_故障字4", 63),
    zoneVoltageA: Object.freeze(Array.from({ length: 15 }, (_, index) =>
      point(`DATA${233 + index}_A分区电压${index + 1}`, 8 + index, 0.01))),
    zoneVoltageB: Object.freeze(Array.from({ length: 15 }, (_, index) =>
      point(`DATA${249 + index}_B分区电压${index + 1}`, 24 + index, 0.01))),
  }),
});

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function value(points, descriptor) {
  return numberOrNull(points[descriptor.name]);
}

function decodePcsSwitchFeedback(raw) {
  const keys = [
    "gridContactor",
    "acPrechargeContactor",
    "dcPositiveContactor",
    "dcPrechargeContactor",
    "fanContactor",
    "dcNegativeContactor",
  ];
  return Object.fromEntries(keys.map((key, bit) => [
    key,
    Number.isInteger(raw) ? Boolean(raw & (1 << bit)) : null,
  ]));
}

function mapPcsTelemetry(points = {}) {
  const p = SCADA_POINT_MAP.pcs;
  const rawSwitchFeedback = value(points, p.switchFeedback);
  return {
    converterType: "NPC-3L",
    gridVoltage: {
      AB: value(points, p.gridVoltageAB), BC: value(points, p.gridVoltageBC), CA: value(points, p.gridVoltageCA),
    },
    inverterVoltage: {
      AB: value(points, p.inverterVoltageAB), BC: value(points, p.inverterVoltageBC), CA: value(points, p.inverterVoltageCA),
    },
    dc: { voltage: value(points, p.dcVoltage), current: value(points, p.dcCurrent) },
    filterInductorCurrent: {
      A: value(points, p.filterInductorCurrentA), B: value(points, p.filterInductorCurrentB), C: value(points, p.filterInductorCurrentC),
    },
    inverterCurrent: {
      A: value(points, p.inverterCurrentA), B: value(points, p.inverterCurrentB), C: value(points, p.inverterCurrentC),
    },
    filterCapCurrent: {
      A: value(points, p.filterCapCurrentA), B: value(points, p.filterCapCurrentB), C: value(points, p.filterCapCurrentC),
    },
    npc: { upperCapVoltage: value(points, p.npcUpperCapVoltage), lowerCapVoltage: value(points, p.npcLowerCapVoltage) },
    temperature: { A: value(points, p.temperatureA), B: value(points, p.temperatureB), C: value(points, p.temperatureC) },
    power: {
      battery: value(points, p.batteryPower), active: value(points, p.activePower), reactive: value(points, p.reactivePower),
      factor: value(points, p.powerFactor), apparent: value(points, p.apparentPower),
    },
    systemStateWord: value(points, p.systemState),
    rawSwitchFeedback,
    switches: decodePcsSwitchFeedback(rawSwitchFeedback),
  };
}

function mapBmsTelemetry(points = {}) {
  const b = SCADA_POINT_MAP.bms;
  return {
    soc: value(points, b.soc),
    socVoltage: value(points, b.socVoltage),
    dc: { voltage: value(points, b.dcVoltage), current: value(points, b.dcCurrent) },
    hydraulics: {
      positive: {
        flow: value(points, b.flowPositive), level: value(points, b.levelPositive),
        pipePressure1: value(points, b.positivePipePressure1), pipePressure2: value(points, b.positivePipePressure2),
        tankPressure: value(points, b.positiveTankPressure),
      },
      negative: {
        flow: value(points, b.flowNegative), level: value(points, b.levelNegative),
        pipePressure1: value(points, b.negativePipePressure1), pipePressure2: value(points, b.negativePipePressure2),
        tankPressure: value(points, b.negativeTankPressure),
      },
    },
    temperature: { electrolyte: value(points, b.electrolyteTemperature), cabinet: value(points, b.cabinetTemperature) },
    cellVoltage: { max: value(points, b.maxCellVoltage), min: value(points, b.minCellVoltage) },
    limits: {
      chargeCurrent: value(points, b.chargeCurrentLimit), dischargeCurrent: value(points, b.dischargeCurrentLimit),
      chargeVoltage: value(points, b.chargeVoltageLimit), dischargeVoltage: value(points, b.dischargeVoltageLimit),
    },
    heartbeat: value(points, b.heartbeat),
    pumpValveStatusWord: value(points, b.pumpValveStatus),
    faultWords: [b.faultWord1, b.faultWord2, b.faultWord3, b.faultWord4].map((descriptor) => value(points, descriptor)),
    zoneVoltages: {
      A: b.zoneVoltageA.map((descriptor) => value(points, descriptor)),
      B: b.zoneVoltageB.map((descriptor) => value(points, descriptor)),
    },
    engineeringConfirmationRequired: {
      flowAndLevel: true,
      note: "流量、液位的单位、量程及比例系数待BMS协议确认；当前按点表V1.2系数1显示原始工程值",
    },
  };
}

module.exports = { SCADA_POINT_MAP, decodePcsSwitchFeedback, mapBmsTelemetry, mapPcsTelemetry };
