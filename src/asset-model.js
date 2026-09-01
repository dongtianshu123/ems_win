const ALLOWED_ASSET_TYPES = new Set([
  "STATION",
  "AREA",
  "TRANSFORMER",
  "PCS",
  "BATTERY_SYSTEM",
  "BMS",
  "STACK",
  "TANK",
  "PUMP",
  "VALVE",
  "METER",
  "SENSOR",
]);

const ALLOWED_LINK_TYPES = new Set(["BMS_TO_PCS", "DEVICE_TO_ASSET"]);

function validateAssetModel(model) {
  const errors = [];
  const assets = Array.isArray(model?.assets) ? model.assets : [];
  const links = Array.isArray(model?.links) ? model.links : [];
  const ids = new Set();

  if (model?.schemaVersion !== 1) errors.push("资产模型版本必须为1");
  if (!model?.stationId) errors.push("必须配置stationId");

  for (const asset of assets) {
    if (!asset?.id) {
      errors.push("资产ID不能为空");
      continue;
    }
    if (ids.has(asset.id)) errors.push(`重复资产ID: ${asset.id}`);
    ids.add(asset.id);
    if (!ALLOWED_ASSET_TYPES.has(asset.type)) errors.push(`不支持的资产类型: ${asset.type}`);
  }

  if (model?.stationId && !ids.has(model.stationId)) errors.push(`电站资产不存在: ${model.stationId}`);

  for (const asset of assets) {
    if (asset?.parentId && !ids.has(asset.parentId)) errors.push(`父资产不存在: ${asset.parentId}`);
  }

  for (const link of links) {
    if (!ALLOWED_LINK_TYPES.has(link?.type)) errors.push(`不支持的关联类型: ${link?.type}`);
    if (!ids.has(link?.from)) errors.push(`关联源资产不存在: ${link?.from}`);
    if (!ids.has(link?.to)) errors.push(`关联目标资产不存在: ${link?.to}`);
  }

  return errors;
}

function indexAssetModel(model) {
  const errors = validateAssetModel(model);
  if (errors.length) throw new Error(errors.join("; "));

  const byId = Object.fromEntries(model.assets.map((asset) => [asset.id, asset]));
  const byType = {};
  const linksByType = {};

  for (const asset of model.assets) {
    if (!byType[asset.type]) byType[asset.type] = [];
    byType[asset.type].push(asset);
  }
  for (const link of model.links || []) {
    if (!linksByType[link.type]) linksByType[link.type] = [];
    linksByType[link.type].push(link);
  }

  return {
    byId,
    byType,
    linksByType,
    targets(assetId, linkType) {
      return (linksByType[linkType] || [])
        .filter((link) => link.from === assetId)
        .map((link) => byId[link.to]);
    },
    sources(assetId, linkType) {
      return (linksByType[linkType] || [])
        .filter((link) => link.to === assetId)
        .map((link) => byId[link.from]);
    },
  };
}

module.exports = { ALLOWED_ASSET_TYPES, ALLOWED_LINK_TYPES, indexAssetModel, validateAssetModel };
