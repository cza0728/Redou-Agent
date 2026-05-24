const fs = require("fs");
const path = require("path");

class ArtifactRepository {
  ensureDirectory(dir) {
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  copyFile(source, target) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    return target;
  }

  copyFileAtomic(source, target) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    fs.copyFileSync(source, tmp);
    fs.renameSync(tmp, target);
    return target;
  }

  exists(file) {
    return fs.existsSync(file);
  }
}

module.exports = {
  ArtifactRepository,
};
