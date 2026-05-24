const fs = require("fs");
const path = require("path");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function ensureTextFile(file, initialText = "") {
  ensureDir(path.dirname(file));
  if (!fs.existsSync(file)) fs.writeFileSync(file, initialText, "utf8");
}

function runMigrations({ appDataRoot, globalDir, projectsDir, statePath }) {
  ensureDir(appDataRoot);
  ensureDir(globalDir);
  ensureDir(projectsDir);
  ensureTextFile(statePath, `${JSON.stringify({ current_project_id: "", current_task_id: "" }, null, 2)}\n`);
}

module.exports = {
  runMigrations,
};
