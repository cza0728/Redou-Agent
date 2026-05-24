const crypto = require("crypto");
const { RISK_APPROVAL_DECISIONS } = require("../permissions/permissionPolicy.cjs");
const { isoNow } = require("../shared/timeUtils.cjs");
const { createUserInputEnvelope, normalizeDeliveryMode, normalizeRunMode, redact } = require("../context/contextUtils.cjs");

class MessageMethods {
  sendMessage(webContents, input = {}) {
    const projectId = String(input.projectId || "").trim();
    const taskId = String(input.taskId || "").trim();
    const userInput = String(input.userInput || "");
    if (!projectId || !taskId) throw new Error("Select a Project and Task before sending.");

    const { project, task } = this.findProjectAndTask(projectId, taskId);
    if (!project || !task) throw new Error("Project or task not found");

    const attachments = Array.isArray(input.attachments)
      ? input.attachments
          .map((item) => this.normalizeAttachmentRecord(item, task.uploadsPath))
          .filter(Boolean)
      : [];
    if (!userInput.trim() && attachments.length === 0) throw new Error("Message is empty.");
    const activeRun = this.activeRunForTask(projectId, taskId);
    const deliveryMode = normalizeDeliveryMode(input.deliveryMode, activeRun ? "queue" : "new_turn");
    const runMode = normalizeRunMode(input.runMode, "execute");
    const goalMode = input.goalMode === true && runMode === "execute";
    const riskConfirmed = input.riskConfirmed === true;

    if (activeRun && deliveryMode === "interrupt_replace") {
      const replacedRunId = activeRun.runId;
      const envelope = createUserInputEnvelope({
        text: userInput,
        deliveryMode: "interrupt_replace",
        status: "consumed",
        targetRunId: replacedRunId,
        consumedAt: isoNow(),
      });
      try {
        activeRun.stopRequested = true;
        const stored = this.activeRuns.get(replacedRunId);
        if (stored) {
          stored.stopRequested = true;
          stored.replacedByEnvelopeId = envelope.id;
        }
        this.processManager.terminate(activeRun.child, { force: true });
      } catch {
        // Best-effort replacement: the old run exit handler also observes stopRequested.
      }
      const event = {
        type: "error",
        message: "Run interrupted and replaced by a new user request.",
        metadata: {
          runId: replacedRunId,
          projectId,
          taskId,
          cancelled: true,
          stopRequested: true,
          replacementInputEnvelopeId: envelope.id,
        },
      };
      this.emitToRenderer(webContents, { runId: replacedRunId, projectId, taskId, event });
      this.persistEvent(projectId, taskId, event);
      return this.startHermesRun(webContents, {
        ...input,
        projectId,
        taskId,
        userInput,
        attachments,
        riskConfirmed,
        userInputEnvelope: envelope,
      }, { deliveryMode: "interrupt_replace", envelope });
    }

    if (activeRun && deliveryMode === "guide" && runMode === "execute" && attachments.length === 0) {
      const guideId = crypto.randomUUID();
      const envelope = createUserInputEnvelope({
        id: guideId,
        text: userInput,
        runId: activeRun.runId,
        deliveryMode: "guide",
        status: "consumed",
        targetRunId: activeRun.runId,
        consumedAt: isoNow(),
      });
      this.appendTaskMessage(projectId, taskId, "event", `Guidance for active run: ${redact(userInput)}`, {
        riskConfirmed,
        runMode,
        goalMode,
        eventType: "control_event",
        controlEvent: true,
        controlEventType: "guide",
        deliveryMode: "guide",
        guideId,
        guidedRunId: activeRun.runId,
        inputEnvelope: envelope,
      });
      try {
        this.writeRunControl(activeRun, {
          type: "steer",
          text: userInput,
          guideId,
          riskConfirmed,
          goalMode,
        });
        this.updateUserInputEnvelopeStatus(projectId, taskId, envelope.id, {
          ...envelope,
          status: "completed",
        });
        this.emitQueueUpdate(
          webContents,
          projectId,
          taskId,
          activeRun.runId,
          "Guidance inserted into the active run.",
          { guideId, guided: true, activeRunId: activeRun.runId, queueState: "guided" },
        );
        return {
          ok: true,
          runId: activeRun.runId,
          guided: true,
          queueDepth: this.queueDepth(projectId, taskId),
        };
      } catch (error) {
        this.updateUserInputEnvelopeStatus(projectId, taskId, envelope.id, {
          ...envelope,
          status: "cancelled",
        });
        const queued = this.enqueueTaskMessage(webContents, {
          ...input,
          projectId,
          taskId,
          userInput,
          attachments,
          riskConfirmed,
        }, { persistUser: true, front: true, source: "queue" });
        const warning = error instanceof Error ? error.message : String(error);
        this.emitQueueUpdate(
          webContents,
          projectId,
          taskId,
          activeRun.runId,
          "Guidance could not be inserted and was queued for the next turn.",
          { queueId: queued.id, guideId, warning, queueState: "queued" },
        );
        return {
          ok: true,
          runId: activeRun.runId,
          queued: true,
          queueId: queued.id,
          queueDepth: this.queueDepth(projectId, taskId),
          warning,
        };
      }
    }

    if (activeRun) {
      const envelope = createUserInputEnvelope({
        text: userInput,
        deliveryMode: "queue",
        status: "pending",
        targetRunId: activeRun.runId,
      });
      const queueId = envelope.id;
      const queuedAt = isoNow();
      this.appendTaskMessage(projectId, taskId, "user", userInput, {
        riskConfirmed,
        deliveryMode: "queue",
        requestedDeliveryMode: deliveryMode,
        runMode,
        goalMode,
        queueId,
        queuedAt,
        inputEnvelope: envelope,
        ...(deliveryMode === "guide" && attachments.length > 0
          ? { guideFallbackReason: "attachments" }
          : {}),
      }, attachments);
      const queued = this.enqueueTaskMessage(webContents, {
        ...input,
        projectId,
        taskId,
        userInput,
        attachments,
        riskConfirmed,
        userInputEnvelope: envelope,
      }, { persistUser: false, queueId, queuedAt, source: "queue", envelope });
      this.emitQueueUpdate(
        webContents,
        projectId,
        taskId,
        activeRun.runId,
        deliveryMode === "guide" && attachments.length > 0
          ? "Attachments are queued for the next turn."
          : deliveryMode === "guide" && runMode === "plan"
            ? "Plan requests are queued for the next turn."
          : "Message queued for the next turn.",
        { queueId: queued.id, activeRunId: activeRun.runId, queueState: "queued" },
      );
      return {
        ok: true,
        runId: activeRun.runId,
        queued: true,
        queueId: queued.id,
        queueDepth: this.queueDepth(projectId, taskId),
        ...(deliveryMode === "guide" && attachments.length > 0
          ? { warning: "Guidance with attachments is queued for the next turn." }
          : deliveryMode === "guide" && runMode === "plan"
            ? { warning: "Plan requests are queued for the next turn." }
          : {}),
      };
    }

    return this.startHermesRun(webContents, {
      ...input,
      projectId,
      taskId,
      userInput,
      attachments,
      riskConfirmed,
    }, { deliveryMode: "new_turn" });
  }

  resolveRiskApproval(webContents, input = {}) {
    const projectId = String(input.projectId || "").trim();
    const taskId = String(input.taskId || "").trim();
    const requestedRunId = String(input.runId || "").trim();
    const approvalId = String(input.approvalId || "").trim();
    const decision = String(input.decision || "").trim();
    const invalid = (message) => {
      if (projectId && taskId) {
        try {
          const event = {
            type: "risk_approval_invalid",
            projectId,
            taskId,
            runId: requestedRunId,
            approvalId,
            decision,
            reason: message,
            metadata: {
              source: "desktop_ipc",
              projectId,
              taskId,
              runId: requestedRunId,
              approvalId,
              decision,
              timestamp: isoNow(),
            },
          };
          this.emitToRenderer(webContents, { runId: requestedRunId, projectId, taskId, event });
          this.persistEvent(projectId, taskId, event);
        } catch {
          // The validation error is still returned to the caller.
        }
      }
      return { ok: false, message };
    };

    if (!projectId || !taskId) return invalid("Select a Project and Task before resolving approval.");
    if (!approvalId) return invalid("Approval id is required.");
    if (!RISK_APPROVAL_DECISIONS.has(decision)) return invalid("Approval decision is not allowed.");

    const { project, task } = this.findProjectAndTask(projectId, taskId);
    if (!project || !task) return invalid("Project or task not found.");

    let run = null;
    if (requestedRunId) {
      const active = this.activeRuns.get(requestedRunId);
      if (active && active.projectId === projectId && active.taskId === taskId) {
        run = { runId: requestedRunId, ...active };
      }
    }
    if (!run) {
      run = this.activeRunForTask(projectId, taskId);
    }
    if (!run) return { ok: false, message: "Run not found" };

    const runId = requestedRunId || run.runId;
    try {
      this.writeRunControl(run, {
        type: "risk_approval_decision",
        projectId,
        taskId,
        runId,
        approvalId,
        decision,
      });
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }

    const event = {
      type: "risk_approval_decision_submitted",
      projectId,
      taskId,
      runId,
      approvalId,
      decision,
      metadata: {
        source: "desktop_ipc",
        projectId,
        taskId,
        runId,
        approvalId,
        decision,
        timestamp: isoNow(),
      },
    };
    this.persistEvent(projectId, taskId, event);
    return { ok: true };
  }

  stopRun(runId, webContents) {
    return this.processManager.stopRun(runId, {
      webContents,
      emitToRenderer: (target, payload) => this.emitToRenderer(target, payload),
      persistEvent: (projectId, taskId, event) => this.persistEvent(projectId, taskId, event),
    });
  }

  stopTaskRun(projectId, taskId, webContents) {
    const run = this.activeRunForTask(projectId, taskId);
    if (!run) return { ok: false, message: "No active run for this task." };
    return this.stopRun(run.runId, webContents);
  }
}

function installMessageMethods(target) {
  for (const name of Object.getOwnPropertyNames(MessageMethods.prototype)) {
    if (name === "constructor") continue;
    Object.defineProperty(target.prototype, name, Object.getOwnPropertyDescriptor(MessageMethods.prototype, name));
  }
}

module.exports = { installMessageMethods };
