function createReadBlocks(model, maxRegisters = 125, deviceType = "COMBINED") {
  const type = String(deviceType).trim().toUpperCase();
  const points = model.points
    .filter((point) => point.access === "read" && (
      type === "COMBINED" || String(point.source || "").trim().toUpperCase().startsWith(type)
    ))
    .sort((a, b) => a.address - b.address);
  const blocks = [];

  for (const point of points) {
    const current = blocks.at(-1);
    const contiguous = current && point.address === current.startAddress + current.count;
    if (!current || !contiguous || current.count >= maxRegisters) {
      blocks.push({ startAddress: point.address, count: 1, points: [point] });
    } else {
      current.count += 1;
      current.points.push(point);
    }
  }
  return blocks;
}

function decodeBlock(block, words) {
  const values = {};
  for (const point of block.points) {
    const index = point.address - block.startAddress;
    const word = words[index];
    const raw = point.dataType === "INT16" && word >= 0x8000 ? word - 0x10000 : word;
    values[point.name] = raw * point.scale;
  }
  return values;
}

function deriveControlState(snapshots) {
  const values = Object.values(snapshots);
  if (!values.length || values.every((snapshot) => snapshot.quality !== "GOOD")) return "OFFLINE";
  const faultPoints = ["DATA285_故障字1", "DATA286_故障字2", "DATA287_故障字3", "DATA288_故障字4"];
  const hasFault = values.some((snapshot) => faultPoints.some((name) => {
    const value = snapshot.points && snapshot.points[name];
    return Number.isFinite(value) && value !== 0;
  }));
  if (hasFault) return "FAULT";
  const running = values.some((snapshot) => {
    const power = snapshot.points && snapshot.points["输出功率"];
    return Number.isFinite(power) && Math.abs(power) > 1;
  });
  return running ? "RUNNING" : "READY";
}

class SerialTransport {
  constructor() {
    this.tail = Promise.resolve();
  }

  execute(operation) {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => {});
    return result;
  }
}

module.exports = { createReadBlocks, decodeBlock, deriveControlState, SerialTransport };
