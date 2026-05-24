const fs = require("fs");
const path = require("path");

class LogRepository {
  appendJsonLine(file, payload) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(payload)}\n`, "utf8");
    return payload;
  }

  readText(file) {
    try {
      return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    } catch {
      return "";
    }
  }

  writeText(file, text) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, String(text || ""), "utf8");
    return file;
  }
}

module.exports = {
  LogRepository,
};
