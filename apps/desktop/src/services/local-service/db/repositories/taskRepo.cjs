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

class TaskRepository {
  constructor({ projectJsonPath, projectsDir }) {
    this.projectJsonPath = projectJsonPath;
    this.projectsDir = projectsDir;
  }

  listProjects() {
    if (!fs.existsSync(this.projectsDir())) return [];
    const projects = [];
    for (const entry of fs.readdirSync(this.projectsDir(), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const projectJson = path.join(this.projectsDir(), entry.name, "project.json");
      if (!fs.existsSync(projectJson)) continue;
      const project = readJson(projectJson, null);
      if (project && typeof project === "object") projects.push(project);
    }
    return projects;
  }

  readProject(projectId) {
    return readJson(this.projectJsonPath(projectId), null);
  }

  writeProject(project) {
    writeJsonAtomic(this.projectJsonPath(project.id), project);
    return project;
  }

  writeTaskMetadata(task) {
    writeJsonAtomic(path.join(task.appDataPath, "task.json"), task);
    return task;
  }
}

module.exports = {
  TaskRepository,
};
