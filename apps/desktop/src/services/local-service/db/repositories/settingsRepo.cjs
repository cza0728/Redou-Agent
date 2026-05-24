const fs = require("fs");
const path = require("path");

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

class SettingsRepository {
  constructor({ statePath }) {
    this.statePath = statePath;
  }

  getState() {
    return readJson(this.statePath(), {
      current_project_id: "",
      current_task_id: "",
    });
  }

  saveState(state) {
    const payload = {
      current_project_id: state.current_project_id || "",
      current_task_id: state.current_task_id || "",
      updatedAt: new Date().toISOString(),
    };
    writeJsonAtomic(this.statePath(), payload);
    return payload;
  }
}

module.exports = {
  SettingsRepository,
};
