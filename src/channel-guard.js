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

  return { inferChannelSource, acceptsFrameSource, rememberMockUrl };
}));
