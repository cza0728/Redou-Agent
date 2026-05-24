function safeSegment(value, fallback) {
  const clean = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 96)
    .toLowerCase();
  return clean || fallback;
}

function compact(value, max = 300) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max).trimEnd() : text;
}

function compactMultiline(value, max = 4000) {
  const text = String(value || "").replace(/\r\n/g, "\n");
  return text.length > max ? `${text.slice(0, max).trimEnd()}\n[truncated]` : text;
}

function markdownListText(value, max = 1200) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, max)
    .trim();
}

function uniqueList(values, maxItems = 12) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    const text = String(value || "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

function regexEscape(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const raw of values || []) {
    const value = String(raw || "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

module.exports = {
  safeSegment,
  compact,
  compactMultiline,
  markdownListText,
  uniqueList,
  uniqueStrings,
  regexEscape,
  escapeRegex,
};
