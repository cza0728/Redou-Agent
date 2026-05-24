const fs = require("fs");
const path = require("path");

const entry = path.join(__dirname, "..", "dist", "entry.js");

try {
  fs.chmodSync(entry, 0o755);
} catch (error) {
  if (process.platform !== "win32") {
    throw error;
  }
}
