function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function efficiency(chargeKWh, dischargeKWh) {
  return chargeKWh > 0 ? round(dischargeKWh / chargeKWh * 100) : null;
}

function missingRate(actual, expected) {
  if (!Number.isFinite(expected) || expected <= 0) return null;
  return round(Math.max(0, 1 - actual / expected) * 100);
}

function priceInterval(start, end, chargeKWh, dischargeKWh, tariffs) {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  const duration = endMs - startMs;
  if (!Number.isFinite(duration) || duration <= 0) return { complete: false, chargeCost: 0, dischargeRevenue: 0 };

  let coveredMs = 0;
  let chargeCost = 0;
  let dischargeRevenue = 0;
  for (const tariff of tariffs) {
    const from = Date.parse(tariff.from);
    const to = Date.parse(tariff.to);
    const overlap = Math.max(0, Math.min(endMs, to) - Math.max(startMs, from));
    if (!overlap) continue;
    coveredMs += overlap;
    const fraction = overlap / duration;
    if (chargeKWh > 0 && Number.isFinite(tariff.buyPrice)) chargeCost += chargeKWh * fraction * tariff.buyPrice;
    else if (chargeKWh > 0) return { complete: false, chargeCost: 0, dischargeRevenue: 0 };
    if (dischargeKWh > 0 && Number.isFinite(tariff.sellPrice)) dischargeRevenue += dischargeKWh * fraction * tariff.sellPrice;
    else if (dischargeKWh > 0) return { complete: false, chargeCost: 0, dischargeRevenue: 0 };
  }
  return {
    complete: coveredMs >= duration,
    chargeCost,
    dischargeRevenue,
  };
}

function settlementSummary(readings, tariffs, expectedSamples) {
  const sorted = [...readings].sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  const goodSamples = sorted.filter((reading) => reading.quality === "GOOD").length;
  let chargeKWh = 0;
  let dischargeKWh = 0;
  let chargeCost = 0;
  let dischargeRevenue = 0;
  let validIntervals = 0;
  let pricingComplete = true;

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (previous.quality !== "GOOD" || current.quality !== "GOOD") continue;
    const charge = current.importKWh - previous.importKWh;
    const discharge = current.exportKWh - previous.exportKWh;
    if (![charge, discharge].every(Number.isFinite) || charge < 0 || discharge < 0) continue;
    validIntervals += 1;
    chargeKWh += charge;
    dischargeKWh += discharge;
    const priced = priceInterval(previous.at, current.at, charge, discharge, tariffs);
    pricingComplete = pricingComplete && priced.complete;
    chargeCost += priced.chargeCost;
    dischargeRevenue += priced.dischargeRevenue;
  }

  const settleable = validIntervals > 0 && pricingComplete;
  return {
    basis: "PCC_SETTLEMENT_METER",
    status: settleable ? "SETTLEABLE" : "NOT_SETTLEABLE",
    chargeKWh: round(chargeKWh),
    dischargeKWh: round(dischargeKWh),
    roundTripEfficiencyPct: efficiency(chargeKWh, dischargeKWh),
    missingRatePct: missingRate(goodSamples, expectedSamples),
    chargeCost: settleable ? round(chargeCost) : null,
    dischargeRevenue: settleable ? round(dischargeRevenue) : null,
    netRevenue: settleable ? round(dischargeRevenue - chargeCost) : null,
    note: settleable ? "PCC结算表计口径" : "缺少完整PCC结算表计或电价数据，不可结算",
  };
}

function operationalSummary(intervals, expectedIntervals) {
  const good = intervals.filter((interval) => interval.quality === "GOOD");
  const chargeKWh = good.reduce((sum, interval) => sum + (Number.isFinite(interval.chargeKWh) ? interval.chargeKWh : 0), 0);
  const dischargeKWh = good.reduce((sum, interval) => sum + (Number.isFinite(interval.dischargeKWh) ? interval.dischargeKWh : 0), 0);
  return {
    basis: "PCS_AGGREGATE",
    status: "ANALYSIS_ONLY",
    chargeKWh: round(chargeKWh),
    dischargeKWh: round(dischargeKWh),
    roundTripEfficiencyPct: efficiency(chargeKWh, dischargeKWh),
    missingRatePct: missingRate(good.length, expectedIntervals),
    note: "PCS合计仅用于运行分析，不替代PCC财务结算",
  };
}

function buildDailyReport({
  date,
  pccReadings = [],
  pcsIntervals = [],
  tariffs = [],
  expectedPccSamples,
  expectedPcsIntervals,
} = {}) {
  if (!date) throw new Error("report_date_required");
  return {
    date,
    settlement: settlementSummary(pccReadings, tariffs, expectedPccSamples),
    operational: operationalSummary(pcsIntervals, expectedPcsIntervals),
  };
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function reportToCsv(report) {
  const columns = ["date", "basis", "status", "chargeKWh", "dischargeKWh", "roundTripEfficiencyPct", "missingRatePct", "chargeCost", "dischargeRevenue", "netRevenue", "note"];
  const rows = [report.settlement, report.operational].map((entry) => columns.map((column) => csvCell(column === "date" ? report.date : entry[column])).join(","));
  return `\uFEFF${columns.join(",")}\r\n${rows.join("\r\n")}\r\n`;
}

module.exports = { buildDailyReport, reportToCsv };
