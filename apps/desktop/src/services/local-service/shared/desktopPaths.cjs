const fs = require("fs");
const path = require("path");

function maybeUnpackedAsarPath(filePath) {
  const marker = `${path.sep}app.asar${path.sep}`;
  if (!filePath.includes(marker)) {
    return filePath;
  }
  const unpackedPath = filePath.replace(marker, `${path.sep}app.asar.unpacked${path.sep}`);
  return fs.existsSync(unpackedPath) ? unpackedPath : filePath;
}

function desktopSourcePath(...segments) {
  return maybeUnpackedAsarPath(path.resolve(__dirname, "..", "..", "..", ...segments));
}

module.exports = { maybeUnpackedAsarPath, desktopSourcePath };
