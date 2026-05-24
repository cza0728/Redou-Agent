const crypto = require("crypto");
const { isoNow } = require("../shared/timeUtils.cjs");
const { createUserInputEnvelope, normalizeRunMode, redact } = require("../context/contextUtils.cjs");

class QueueMethods {
  updateQueuedMessage(webContents, input = {}) {
    const projectId = String(input.projectId || "").trim();
    const taskId = String(input.taskId || "").trim();
    const queueId = String(input.queueId || "").trim();
    const action = String(input.action || "").trim().toLowerCase();
    if (!projectId || !taskId) throw new Error("Select a Project and Task before updating queued messages.");
    if (!queueId) throw new Error("Queued message id is required.");
    if (action !== "delete" && action !== "guide") {
      throw new Error("Queued message action must be delete or guide.");
    }

    const { project, task } = this.findProjectAndTask(projectId, taskId);
    if (!project || !task) throw new Error("Project or task not found");

    const key = this.taskQueueKey(projectId, taskId);
    const queue = this.taskQueues.get(key) || [];
    const index = queue.findIndex((item) => String(item?.id || "") === queueId);
    if (index < 0) {
      if (action === "delete") {
        const removed = this.removeQueuedUserInputMessage(projectId, taskId, queueId);
        if (removed) {
          const activeRun = this.activeRunForTask(projectId, taskId);
          this.emitQueueUpdate(
            webContents,
            projectId,
            taskId,
            activeRun?.runId || queueId,
            "Queued message deleted.",
            { queueId, queueState: "deleted", activeRunId: activeRun?.runId || null },
          );
          return {
            ok: true,
            deleted: true,
            queueDepth: this.queueDepth(projectId, taskId),
            stale: true,
          };
        }
      }
      return {
        ok: false,
        message: "Queued message was not found. It may have already started.",
        queueDepth: this.queueDepth(projectId, taskId),
      };
    }

    const queued = queue[index];
    const emitTarget = webContents || queued.webContents;
    const activeRun = this.activeRunForTask(projectId, taskId);
    const removeFromQueue = () => {
      queue.splice(index, 1);
      if (queue.length > 0) {
        this.taskQueues.set(key, queue);
      } else {
        this.taskQueues.delete(key);
      }
    };

    if (action === "delete") {
      removeFromQueue();
      this.removeQueuedUserInputMessage(projectId, taskId, queueId);
      this.emitQueueUpdate(
        emitTarget,
        projectId,
        taskId,
        activeRun?.runId || queueId,
        "Queued message deleted.",
        { queueId, queueState: "deleted", activeRunId: activeRun?.runId || null },
      );
      return {
        ok: true,
        deleted: true,
        queueDepth: this.queueDepth(projectId, taskId),
      };
    }

    if (!activeRun) {
      return {
        ok: false,
        message: "No active run is available for guidance.",
        queueDepth: this.queueDepth(projectId, taskId),
      };
    }

    const queuedInput = queued.input && typeof queued.input === "object" ? queued.input : {};
    const attachments = Array.isArray(queuedInput.attachments) ? queuedInput.attachments : [];
    const runMode = normalizeRunMode(queuedInput.runMode || input.runMode, "execute");
    if (runMode !== "execute") {
      return {
        ok: false,
        message: "Plan requests cannot be converted into guidance.",
        queueDepth: this.queueDepth(projectId, taskId),
      };
    }
    if (attachments.length > 0) {
      return {
        ok: false,
        message: "Queued messages with attachments cannot be converted into guidance.",
        queueDepth: this.queueDepth(projectId, taskId),
      };
    }

    const userInput = String(queuedInput.userInput || "");
    const guideId = crypto.randomUUID();
    const consumedAt = isoNow();
    const envelope = createUserInputEnvelope({
      id: guideId,
      text: userInput,
      runId: activeRun.runId,
      deliveryMode: "guide",
      status: "completed",
      targetRunId: activeRun.runId,
      consumedAt,
    });
    try {
      this.writeRunControl(activeRun, {
        type: "steer",
        text: userInput,
        guideId,
        riskConfirmed: queuedInput.riskConfirmed === true,
        goalMode: queuedInput.goalMode === true && runMode === "execute",
      });
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        queueDepth: this.queueDepth(projectId, taskId),
      };
    }

    removeFromQueue();
    this.removeQueuedUserInputMessage(projectId, taskId, queueId);
    this.appendTaskMessage(projectId, taskId, "event", `Guidance for active run: ${redact(userInput)}`, {
      riskConfirmed: queuedInput.riskConfirmed === true,
      runMode,
      goalMode: queuedInput.goalMode === true && runMode === "execute",
      eventType: "control_event",
      controlEvent: true,
      controlEventType: "guide",
      deliveryMode: "guide",
      guideId,
      guidedRunId: activeRun.runId,
      inputEnvelope: envelope,
      convertedFromQueueId: queueId,
    });
    this.emitQueueUpdate(
      emitTarget,
      projectId,
      taskId,
      activeRun.runId,
      "Queued message inserted into the active run.",
      { queueId, guideId, guided: true, activeRunId: activeRun.runId, queueState: "guided" },
    );
    return {
      ok: true,
      guided: true,
      runId: activeRun.runId,
      queueDepth: this.queueDepth(projectId, taskId),
    };
  }



  enqueueTaskMessage(webContents, input, options = {}) {
    const projectId = String(input.projectId || "").trim();
    const taskId = String(input.taskId || "").trim();
    const key = this.taskQueueKey(projectId, taskId);
    const queue = this.taskQueues.get(key) || [];
    const item = {
      id: options.queueId || crypto.randomUUID(),
      queuedAt: options.queuedAt || isoNow(),
      webContents,
      input: {
        ...input,
        projectId,
        taskId,
        userInput: String(input.userInput || ""),
        attachments: Array.isArray(input.attachments) ? input.attachments : [],
      },
      persistUser: options.persistUser !== false,
      source: options.source || "queue",
      envelope: options.envelope && typeof options.envelope === "object" ? options.envelope : null,
    };
    if (options.front) {
      queue.unshift(item);
    } else {
      queue.push(item);
    }
    this.taskQueues.set(key, queue);
    return item;
  }

  writeRunControl(run, command) {
    this.processManager.writeRunControl(run, command);
  }

  startNextQueuedMessage(projectId, taskId) {
    if (this.shuttingDown) return;
    if (this.activeRunForTask(projectId, taskId)) return;
    const key = this.taskQueueKey(projectId, taskId);
    const queue = this.taskQueues.get(key);
    if (!queue || queue.length === 0) {
      this.taskQueues.delete(key);
      return;
    }
    const next = queue.shift();
    if (queue.length === 0) {
      this.taskQueues.delete(key);
    }
    try {
      const response = this.startHermesRun(next.webContents, next.input, {
        persistUser: next.persistUser,
        deliveryMode: "queue",
        queueId: next.id,
        queuedAt: next.queuedAt,
        envelope: next.envelope || next.input.userInputEnvelope || null,
      });
      this.emitQueueUpdate(
        next.webContents,
        projectId,
        taskId,
        response.runId,
        "Queued message started.",
        { queueId: next.id, source: next.source, activeRunId: response.runId, queueState: "started" },
      );
      if (!response.ok) {
        setImmediate(() => this.startNextQueuedMessage(projectId, taskId));
      }
    } catch (error) {
      const runId = next.id;
      const event = {
        type: "error",
        message: error instanceof Error ? error.message : String(error),
        metadata: { runId, projectId, taskId, queueId: next.id },
      };
      this.emitToRenderer(next.webContents, { runId, projectId, taskId, event });
      this.persistEvent(projectId, taskId, event);
      setImmediate(() => this.startNextQueuedMessage(projectId, taskId));
    }
  }

}

function installQueueMethods(target) {
  for (const name of Object.getOwnPropertyNames(QueueMethods.prototype)) {
    if (name === "constructor") continue;
    Object.defineProperty(target.prototype, name, Object.getOwnPropertyDescriptor(QueueMethods.prototype, name));
  }
}

module.exports = { installQueueMethods };
