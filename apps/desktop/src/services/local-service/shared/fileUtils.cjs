const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function ensureTextFile(file, initialText) {
  mkdirp(path.dirname(file));
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, initialText, "utf8");
  }
}

function ensureEmptyFile(file) {
  mkdirp(path.dirname(file));
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, "", "utf8");
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function readTextFirst(files) {
  for (const file of files || []) {
    const text = readText(file);
    if (text) return text;
  }
  return "";
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function sleepSync(ms) {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, ms);
}

function isTransientFileError(error) {
  return ["EBUSY", "EACCES", "EPERM", "ENOTEMPTY"].includes(error && error.code);
}

function removeDirectoryWithRetries(dir) {
  const maxAttempts = process.platform === "win32" ? 5 : 3;
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (!isTransientFileError(error) || attempt === maxAttempts - 1) {
        break;
      }
      sleepSync(60 * (attempt + 1));
    }
  }

  throw lastError;
}

function replaceFileFromTemp(tmp, target) {
  const maxAttempts = process.platform === "win32" ? 8 : 3;
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      if (process.platform === "win32" && fs.existsSync(target)) {
        fs.copyFileSync(tmp, target);
        fs.unlinkSync(tmp);
      } else {
        fs.renameSync(tmp, target);
      }
      return;
    } catch (error) {
      lastError = error;
      if (process.platform === "win32" && fs.existsSync(tmp)) {
        try {
          fs.copyFileSync(tmp, target);
          fs.unlinkSync(tmp);
          return;
        } catch (copyError) {
          lastError = copyError;
        }
      }
      if (!isTransientFileError(lastError) || attempt === maxAttempts - 1) {
        break;
      }
      sleepSync(35 * (attempt + 1));
    }
  }

  throw lastError;
}

function writeJsonAtomic(file, value) {
  mkdirp(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    replaceFileFromTemp(tmp, file);
  } catch (error) {
    if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true });
    throw error;
  }
}

function copyFileAtomic(source, target) {
  mkdirp(path.dirname(target));
  const tmp = `${target}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.copyFileSync(source, tmp);
  try {
    replaceFileFromTemp(tmp, target);
  } catch (error) {
    if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true });
    throw error;
  }
}

function copyDirectoryRecursive(source, target) {
  if (!fs.existsSync(source)) return;
  mkdirp(path.dirname(target));
  fs.cpSync(source, target, {
    recursive: true,
    force: true,
    filter: (src) => {
      const name = path.basename(src);
      return name !== "__pycache__" && name !== ".pytest_cache" && !name.endsWith(".pyc");
    },
  });
}

function assertChildPath(root, target, label) {
  const rootPath = path.resolve(root);
  const targetPath = path.resolve(target);
  const rootCmp = process.platform === "win32" ? rootPath.toLowerCase() : rootPath;
  const targetCmp = process.platform === "win32" ? targetPath.toLowerCase() : targetPath;
  if (targetCmp === rootCmp || !targetCmp.startsWith(`${rootCmp}${path.sep}`)) {
    throw new Error(`Refusing to delete ${label}: path is outside Redou app data.`);
  }
  return targetPath;
}

module.exports = {
  mkdirp,
  readText,
  readTextFirst,
  readJson,
  writeJsonAtomic,
  copyFileAtomic,
  copyDirectoryRecursive,
  ensureTextFile,
  ensureEmptyFile,
  assertChildPath,
  removeDirectoryWithRetries,
  replaceFileFromTemp,
  isTransientFileError,
};
