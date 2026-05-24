const fs = require("fs");

class LifecycleService {
  constructor({ host, eventBus = null, logger = null } = {}) {
    if (!host) throw new Error("LifecycleService requires a host service.");
    this.host = host;
    this.eventBus = eventBus;
    this.log = typeof logger === "function" ? logger : () => {};
    this.disposed = false;
  }

  init() {
    const host = this.host;
    const seedPath = host.defaultProjectSeedPath();
    const hasSeededDefaultProject = fs.existsSync(seedPath);
    host.db.initDb();
    host.schedulerService.init();
    host.ensureGlobalFiles();
    const projects = host.readAllProjects();
    for (const project of projects) {
      host.ensureProject(project);
    }
    if (!hasSeededDefaultProject && projects.length === 0) {
      host.ensureDefaultChatProject();
      fs.writeFileSync(seedPath, `${new Date().toISOString()}\n`, "utf8");
    } else if (!hasSeededDefaultProject) {
      fs.writeFileSync(seedPath, `${new Date().toISOString()}\n`, "utf8");
    }
    this.disposed = false;
    return { ok: true };
  }

  healthCheck() {
    const host = this.host;
    const queuedMessages = Array.from(host.taskQueues.values()).reduce(
      (count, queue) => count + (Array.isArray(queue) ? queue.length : 0),
      0,
    );
    return {
      ok: true,
      disposed: this.disposed,
      shuttingDown: host.shuttingDown === true,
      activeRuns: host.activeRuns.size,
      activeAnalysisRuns: host.activeAnalysisRuns.size,
      queuedMessages,
      queuedAnalysisRuns: host.analysisQueue.length,
      schedulerInitialized: host.schedulerService.initialized === true,
      schedulerTimerActive: Boolean(host.schedulerService.timer),
      dbAvailable: Boolean(host.db?.getDb?.()),
    };
  }

  markAnalysisInterrupted(item, reason) {
    const host = this.host;
    const message = reason || "Stopped because Redou Agent is closing.";
    if (!item?.key) return undefined;
    const interruptedResult = host.updateAnalysisResult(item.key, (result) => ({
      ...result,
      status: "interrupted",
      completedAt: result.completedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      summary: message,
      tasks: (result.tasks || []).map((task) => {
        if (!["queued", "running", "pending"].includes(String(task.status || "").toLowerCase())) {
          return task;
        }
        return {
          ...task,
          status: task.status === "running" ? "interrupted" : task.status,
          completedAt: task.status === "running" ? new Date().toISOString() : task.completedAt,
          summary: task.status === "running" ? message : task.summary,
        };
      }),
    }));
    host.syncAnalysisWorkspaceFinished(item, "interrupted", message, interruptedResult);
    host.emitAnalysisEvent(item.webContents, { type: "changed", runId: item.runId });
    return interruptedResult;
  }

  stopAllHermesActivity(reason = "Redou Agent is closing; stopping Hermes local runtime.") {
    const host = this.host;
    host.shuttingDown = true;
    host.schedulerService.dispose();
    const queuedMessages = Array.from(host.taskQueues.values()).reduce(
      (count, queue) => count + (Array.isArray(queue) ? queue.length : 0),
      0,
    );
    host.taskQueues.clear();

    const stoppedRuns = [];
    for (const [runId, run] of host.activeRuns.entries()) {
      run.stopRequested = true;
      host.processManager.terminate(run.child, { force: true });
      stoppedRuns.push(runId);
      const event = {
        type: "error",
        message: reason,
        metadata: {
          runId,
          projectId: run.projectId,
          taskId: run.taskId,
          shutdown: true,
        },
      };
      try {
        host.emitToRenderer(run.webContents, {
          runId,
          projectId: run.projectId,
          taskId: run.taskId,
          event,
        });
        host.persistEvent(run.projectId, run.taskId, event);
      } catch {
        // Shutdown cleanup should not be blocked by persistence or renderer state.
      }
    }
    host.activeRuns.clear();

    const queuedAnalysisRuns = host.analysisQueue.length;
    host.analysisQueue = [];
    const stoppedAnalysisRuns = [];
    for (const item of host.activeAnalysisItems()) {
      item.stopRequested = true;
      stoppedAnalysisRuns.push(item.runId || item.key);
      if (item.child) {
        host.processManager.terminate(item.child, { force: true });
      }
      this.markAnalysisInterrupted(item, reason);
    }
    host.processManager.terminateAll(host.activeAnalysisShellChildren, { force: true });
    host.activeAnalysisShellChildren.clear();
    host.activeAnalysisRuns.clear();
    host.activeAnalysisRun = null;

    return {
      ok: true,
      stoppedRuns,
      stoppedAnalysisRuns,
      queuedMessages,
      queuedAnalysisRuns,
    };
  }

  dispose(reason = "Redou Agent is closing; stopping Hermes local runtime.") {
    if (this.disposed) {
      return { ok: true, alreadyDisposed: true, dbClosed: true };
    }
    const stopResult = this.stopAllHermesActivity(reason);
    let dbClosed = false;
    let dbCloseError = null;
    try {
      this.host.db?.closeDb?.();
      dbClosed = true;
    } catch (error) {
      dbCloseError = error instanceof Error ? error.message : String(error);
      this.log(`local-service db close failed: ${dbCloseError}`);
    }
    this.disposed = true;
    return {
      ...stopResult,
      dbClosed,
      ...(dbCloseError ? { dbCloseError } : {}),
    };
  }
}

module.exports = {
  LifecycleService,
};
