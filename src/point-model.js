const fs = require("node:fs");

const SUPPORTED_TYPES = new Set(["INT16", "UINT16"]);
const SUPPORTED_ACCESS = new Set(["read", "write"]);

function loadPointModel(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function validatePointModel(model) {
  if (!model || model.schemaVersion !== 1 || !Array.isArray(model.points)) {
    throw new Error("invalid point model schema");
  }

  const addresses = new Set();
  let readable = 0;
  let writable = 0;

  for (const point of model.points) {
    if (!Number.isInteger(point.address) || point.address < 0) {
      throw new Error(`invalid address ${point.address}`);
    }
    if (addresses.has(point.address)) {
      throw new Error(`duplicate address ${point.address}`);
    }
    addresses.add(point.address);
    if (!SUPPORTED_ACCESS.has(point.access)) {
      throw new Error(`invalid access at address ${point.address}`);
    }
    if (!SUPPORTED_TYPES.has(point.dataType) || point.widthBits !== 16) {
      throw new Error(`invalid data type at address ${point.address}`);
    }
    if (!Number.isFinite(point.scale) || point.scale <= 0) {
      throw new Error(`invalid scale at address ${point.address}`);
    }
    if (typeof point.name !== "string" || !point.name.trim()) {
      throw new Error(`invalid name at address ${point.address}`);
    }
    if (point.access === "read") readable += 1;
    if (point.access === "write") writable += 1;
  }

  const sortedAddresses = [...addresses].sort((a, b) => a - b);
  return {
    total: model.points.length,
    readable,
    writable,
    firstAddress: sortedAddresses[0],
    lastAddress: sortedAddresses.at(-1),
  };
}

function getPointByAddress(model, address) {
  const point = model.points.find((candidate) => candidate.address === address);
  if (!point) throw new Error(`unknown point address ${address}`);
  return point;
}

module.exports = {
  getPointByAddress,
  loadPointModel,
  validatePointModel,
};
