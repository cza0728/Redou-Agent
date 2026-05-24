const { runMigrations } = require("./migrations.cjs");
const { ArtifactRepository } = require("./repositories/artifactRepo.cjs");
const { LogRepository } = require("./repositories/logRepo.cjs");
const { RunRepository } = require("./repositories/runRepo.cjs");
const { ScheduleRepository } = require("./repositories/scheduleRepo.cjs");
const { SettingsRepository } = require("./repositories/settingsRepo.cjs");
const { TaskRepository } = require("./repositories/taskRepo.cjs");

let currentDb = null;

function createLocalDb({ paths, activeRuns }) {
  const repositories = {
    tasks: new TaskRepository({
      projectJsonPath: paths.projectJsonPath,
      projectsDir: paths.projectsDir,
    }),
    runs: new RunRepository({ activeRuns }),
    artifacts: new ArtifactRepository(),
    logs: new LogRepository(),
    schedules: new ScheduleRepository(),
    settings: new SettingsRepository({ statePath: paths.statePath }),
  };

  const db = {
    repositories,
    migrate() {
      runMigrations({
        appDataRoot: paths.appDataRoot(),
        globalDir: paths.globalDir(),
        projectsDir: paths.projectsDir(),
        statePath: paths.statePath(),
      });
    },
    initDb() {
      this.migrate();
      return this;
    },
    closeDb() {
      return undefined;
    },
    getDb() {
      return this;
    },
  };

  currentDb = db;
  return db;
}

function initDb(options) {
  const db = currentDb || createLocalDb(options);
  return db.initDb();
}

function closeDb() {
  if (currentDb) currentDb.closeDb();
  currentDb = null;
}

function getDb() {
  return currentDb;
}

function createLocalDatabase(options) {
  return createLocalDb(options);
}

module.exports = {
  closeDb,
  createLocalDb,
  createLocalDatabase,
  getDb,
  initDb,
};
