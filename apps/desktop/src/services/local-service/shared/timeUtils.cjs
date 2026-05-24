function isoNow() {
  return new Date().toISOString();
}

function nowSeconds() {
  return Date.now() / 1000;
}

function timestampSeconds(value, fallback = nowSeconds()) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value / 1000 : value;
  }
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed / 1000 : fallback;
}

function timestampMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

module.exports = {
  isoNow,
  nowSeconds,
  timestampSeconds,
  timestampMs,
};
