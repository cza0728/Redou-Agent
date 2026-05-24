const { escapeRegex } = require("./textUtils.cjs");

function yamlString(value) {
  return JSON.stringify(String(value || ""));
}

function yamlScalar(value) {
  let text = String(value || "").trim();
  if (!text || text === "null" || text === "~") return "";
  if (text.includes(" #")) {
    text = text.slice(0, text.indexOf(" #")).trim();
  }
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1);
  }
  return text.trim();
}

function topLevelYamlBlock(text, key) {
  const lines = String(text || "").split(/\r?\n/);
  const keyPattern = new RegExp(`^${escapeRegex(key)}:\\s*(?:.*)?$`);
  const start = lines.findIndex((line) => keyPattern.test(line));
  if (start < 0) return "";

  const block = [lines[start]];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^[A-Za-z_][A-Za-z0-9_-]*:\s*/.test(line) && line.trim() && !line.startsWith(" ")) {
      break;
    }
    block.push(line);
  }
  return block.join("\n").trimEnd();
}

function yamlBlockListValues(block, key) {
  const lines = String(block || "").split(/\r?\n/);
  const keyPattern = new RegExp(`^\\s{2}${escapeRegex(key)}:\\s*(.*)?$`);
  const start = lines.findIndex((line) => keyPattern.test(line));
  if (start < 0) return [];

  const inline = lines[start].match(keyPattern)?.[1]?.trim() || "";
  if (inline && inline !== "[]") {
    return [yamlScalar(inline)].filter(Boolean);
  }

  const values = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s{2}[A-Za-z_][A-Za-z0-9_-]*:\s*/.test(line)) break;
    const match = line.match(/^\s{4}-\s*(.+?)\s*$/);
    if (match) {
      const value = yamlScalar(match[1]);
      if (value) values.push(value);
    }
  }
  return values;
}

module.exports = {
  yamlString,
  yamlScalar,
  topLevelYamlBlock,
  yamlBlockListValues,
};
