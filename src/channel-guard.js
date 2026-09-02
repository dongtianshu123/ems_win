(function exposeChannelGuard(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.EmsChannelGuard = api;
}(typeof globalThis === "object" ? globalThis : this, function createChannelGuard() {
  function inferChannelSource(wsUrl, explicitSource) {
    if (explicitSource === "live" || explicitSource === "mock") return explicitSource;
    try { return new URL(wsUrl).port === "8082" ? "live" : "mock"; }
    catch { return "mock"; }
  }

  function acceptsFrameSource(expectedSource, actualSource) {
    return (expectedSource === "live" || expectedSource === "mock") && expectedSource === actualSource;
  }

  function rememberMockUrl(wsUrl, source, previousUrl = "ws://127.0.0.1:8080") {
    return source === "mock" ? wsUrl : previousUrl;
  }

  function buildConfiguredInventory(config) {
    const devices = (config?.devices || []).filter((device) => device.enabled);
    const pcsUnits = devices
      .filter((device) => device.type === "PCS" || device.type === "COMBINED")
      .map((device) => ({
        id: device.id,
        unitId: device.unitId,
        type: "CONFIGURED_OFFLINE",
        P: null,
        Q: null,
        Vdc: null,
        Idc: null,
        telemetry: {},
      }));
    const batteryGroups = devices
      .filter((device) => device.type === "BMS" || device.type === "COMBINED")
      .map((device) => ({
        id: device.id,
        unitId: device.unitId,
        pcsId: "未绑定",
        status: "offline",
        soc: null,
        T: null,
        bms: {},
      }));
    return { pcsUnits, batteryGroups };
  }

  function mergeConfiguredInventory(data, config) {
    const configured = buildConfiguredInventory(config);
    const merge = (placeholders, received) => {
      const receivedById = new Map((received || []).map((device) => [device.id, device]));
      const configuredIds = new Set(placeholders.map((device) => device.id));
      return [
        ...placeholders.map((device) => receivedById.get(device.id) || device),
        ...(received || []).filter((device) => !configuredIds.has(device.id)),
      ];
    };
    return {
      ...data,
      pcsUnits: merge(configured.pcsUnits, data?.pcsUnits),
      batteryGroups: merge(configured.batteryGroups, data?.batteryGroups),
    };
  }

  return { inferChannelSource, acceptsFrameSource, rememberMockUrl, buildConfiguredInventory, mergeConfiguredInventory };
}));
