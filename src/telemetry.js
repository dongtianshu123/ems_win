function goodSample({ value, source, sampledAt, receivedAt }) {
  return {
    value,
    quality: "GOOD",
    source,
    sampledAt,
    receivedAt,
  };
}

function badSample({ source, quality, error, sampledAt, receivedAt }) {
  return {
    value: null,
    quality,
    source,
    sampledAt,
    receivedAt,
    error: error instanceof Error ? error.message : String(error),
  };
}

module.exports = { badSample, goodSample };
