const fs = require("fs");
const path = require("path");
const { RISK_AUDIT_EVENT_TYPES } = require("../permissions/permissionPolicy.cjs");
const { mkdirp, readText } = require("../shared/fileUtils.cjs");
const { isoNow } = require("../shared/timeUtils.cjs");
const { desktopSourcePath } = require("../shared/desktopPaths.cjs");
const { topLevelYamlBlock, yamlScalar } = require("../shared/yamlUtils.cjs");
const {
  collectTurnArtifactFromEvent,
  createUserInputEnvelope,
  emptyTurnArtifacts,
  eventToolKey,
  inferCommandFromTool,
  inferFileChangedFromTool,
  normalizeDeliveryMode,
  normalizeRunMode,
  recordTurnArtifact,
  redact,
  seedAttachmentArtifacts,
  toInt,
} = require("../context/contextUtils.cjs");

const DEFAULT_AGENT_MAX_TURNS = 200;
const HARD_MAX_AGENT_MAX_TURNS = 10000;

function normalizeMaxTurns(value, fallback = DEFAULT_AGENT_MAX_TURNS) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(Math.floor(n), HARD_MAX_AGENT_MAX_TURNS));
}

function readRootAgentMaxTurnsValue(hermesHome) {
  // Legacy Hermes config lookup - kept for backward compat with existing config.yaml
  const text = readText(path.join(hermesHome, "config.yaml"));
  const agentBlock = topLevelYamlBlock(text, "agent");
  for (const line of agentBlock.split(/\r?\n/).slice(1)) {
    const match = line.match(/^\s+max_turns:\s*(.*)$/);
    if (match) return yamlScalar(match[1]);
  }

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^max_turns:\s*(.*)$/);
    if (match) return yamlScalar(match[1]);
  }

  return undefined;
}

function truthyFailureText(value) {
  if (value == null || value === false) return "";
  const text = typeof value === "string" ? value.trim() : JSON.stringify(value);
  if (!text || text === "false" || text === "null") return "";
  return text;
}

function doneTerminalStatus(metadata = {}, runRecord = {}) {
  const exitCode = Number(metadata.exitCode);
  const turnExitReason = String(metadata.turnExitReason || metadata.turn_exit_reason || "").toLowerCase();
  if (
    runRecord?.stopRequested ||
    metadata.cancelled ||
    metadata.canceled ||
    metadata.stopRequested ||
    metadata.interrupted ||
    metadata.replacedByRunId
  ) {
    return "cancelled";
  }
  if (
    metadata.failed === true ||
    metadata.partial === true ||
    truthyFailureText(metadata.error) ||
    truthyFailureText(metadata.failure) ||
    truthyFailureText(metadata.exception) ||
    (metadata.completed === false && /max_iterations|partial|stream|error|failed|failure|exception|invalid/.test(turnExitReason)) ||
    (Number.isFinite(exitCode) && exitCode !== 0)
  ) {
    return "cancelled";
  }
  return "completed";
}

class HermesRunMethods {
  startHermesRun(webContents, input = {}, options = {}) {
    if (this.shuttingDown) {
      return { ok: false, warning: "Redou Agent is closing; no new run was started." };
    }
    const projectId = String(input.projectId || "").trim();
    const taskId = String(input.taskId || "").trim();
    const userInput = String(input.userInput || "");
    const runMode = normalizeRunMode(options.runMode || input.runMode, "execute");
    if (!projectId || !taskId) throw new Error("Select a Project and Task before sending.");

    const { project, task } = this.findProjectAndTask(projectId, taskId);
    if (!project || !task) throw new Error("Project or task not found");
    this.ensureProjectHermesProfile(project);
    const attachments = Array.isArray(input.attachments)
      ? input.attachments
          .map((item) => this.normalizeAttachmentRecord(item, task.uploadsPath))
          .filter(Boolean)
      : [];
    if (!userInput.trim() && attachments.length === 0) throw new Error("Message is empty.");
    const contextDirective = input.contextDirectiveApplied
      ? null
      : userInput.trim()
        ? this.applyContextDirective(projectId, taskId, userInput)
        : null;
    const runId = options.runId || crypto.randomUUID();
    const deliveryMode = normalizeDeliveryMode(options.deliveryMode || input.deliveryMode, "new_turn");
    const goalMode = input.goalMode === true && runMode === "execute";
    const currentEnvelope = createUserInputEnvelope({
      ...(input.userInputEnvelope && typeof input.userInputEnvelope === "object" ? input.userInputEnvelope : {}),
      ...(options.envelope && typeof options.envelope === "object" ? options.envelope : {}),
      text: userInput,
      runId,
      deliveryMode: deliveryMode === "guide" ? "queue" : deliveryMode,
      status: "consumed",
      consumedAt: isoNow(),
    });
    if (options.envelope?.id) {
      this.updateUserInputEnvelopeStatus(projectId, taskId, options.envelope.id, currentEnvelope);
    }
    const mainModel = this.rootMainModelSelection();
    const taskProvider = String(task.model_provider || "").trim();
    const taskModel = String(task.model || "").trim();
    const effectiveProvider = taskProvider || mainModel.provider || "";
    const effectiveModel = taskProvider ? taskModel : (taskModel || mainModel.model || "");
    const modelSource = taskProvider || taskModel ? "task" : "main";
    const built = this.buildTaskContext({
      projectId,
      taskId,
      userInput,
      attachments,
      maxRecentMessages: input.maxRecentMessages,
      provider: effectiveProvider,
      model: effectiveModel,
      modelContextTokens: input.modelContextTokens,
      deliveryMode,
      currentEnvelope,
    });
    if (!built.metadata.contextValidation?.ok) {
      const warning = `Context validation failed: ${built.metadata.contextValidation.errors.join("; ")}`;
      const event = {
        type: "error",
        message: warning,
        metadata: { runId, projectId, taskId, contextDebugReport: built.metadata.contextDebugReport },
      };
      this.emitToRenderer(webContents, { runId, projectId, taskId, event });
      this.persistEvent(projectId, taskId, event);
      this.updateUserInputEnvelopeStatus(projectId, taskId, currentEnvelope.id, {
        ...currentEnvelope,
        status: "cancelled",
      });
      return { ok: false, runId, warning, context: built.metadata };
    }
    const riskConfirmed = input.riskConfirmed === true;
    const permissions = this.effectivePermissions(input);
    const runtimeApprovalEnabled = permissions.runtime_approval_enabled !== false;
    const approvalTimeoutSeconds = permissions.approval_timeout_seconds;
    if (options.persistUser !== false) {
      this.appendTaskMessage(projectId, taskId, "user", userInput, {
        riskConfirmed,
        permissionMode: permissions.mode,
        runtimeApprovalEnabled,
        deliveryMode,
        runMode,
        goalMode,
        inputEnvelope: currentEnvelope,
        ...(contextDirective ? { contextDirective } : {}),
        ...(options.queueId ? { queueId: options.queueId } : {}),
        ...(options.queuedAt ? { queuedAt: options.queuedAt } : {}),
      }, attachments);
    }
    const sessionId = task.hermesSessionId || `redou-${taskId}-${Date.now().toString(36)}`;
    this.updateChatTask(projectId, taskId, { hermesSessionId: sessionId });
    const configuredMaxIterations = normalizeMaxTurns(
      readRootAgentMaxTurnsValue(this.hermesHome),
      DEFAULT_AGENT_MAX_TURNS,
    );
    const maxIterations = normalizeMaxTurns(input.maxIterations, configuredMaxIterations);
    const runMetadata = {
      ...built.metadata,
      modelProvider: effectiveProvider,
      model: effectiveModel,
      modelSource,
      maxIterations,
      deliveryMode,
      runMode,
      goalMode,
      currentRequestId: currentEnvelope.id,
      currentTurnId: currentEnvelope.turnId,
      permissionMode: permissions.mode,
      runtimeApprovalEnabled,
      approvalTimeoutSeconds,
      queueDepth: this.queueDepth(projectId, taskId),
      ...(contextDirective ? { contextDirective } : {}),
      ...(options.queueId ? { queueId: options.queueId } : {}),
      ...(options.queuedAt ? { queuedAt: options.queuedAt } : {}),
    };
    this.log(`redou codex call adapter=codex sessionId=${sessionId} projectId=${projectId} taskId=${taskId} modelProvider=${effectiveProvider || "-"} model=${effectiveModel || "-"} modelSource=${modelSource} projectPath=${redact(project.path)} messagesPath=${redact(task.messagesPath)} recentMessageCount=${built.metadata.recentMessageCount} includedFiles=${built.metadata.includedFiles.map(redact).join("|")} contextLength=${built.metadata.contextLength}`);

    if (!this.codexPath) {
      const warning = "Codex runtime is unavailable. The message was saved locally, but no agent run was started.";
      this.log(`redou codex fallback projectId=${projectId} taskId=${taskId}: ${warning}`);
      const event = { type: "error", message: warning, metadata: { runId, projectId, taskId } };
      this.emitToRenderer(webContents, { runId, projectId, taskId, event });
      this.persistEvent(projectId, taskId, event);
      this.updateUserInputEnvelopeStatus(projectId, taskId, currentEnvelope.id, {
        ...currentEnvelope,
        status: "cancelled",
      });
      return { ok: false, runId, warning, context: runMetadata };
    }

    const adapterPath = desktopSourcePath("codex_adapter.cjs");
    const planDir = path.join(this.projectHermesHome(project), "plans");
    if (runMode === "plan") {
      mkdirp(planDir);
    }
    const runStartedAtMs = Date.now();
    const runStartedAt = new Date(runStartedAtMs).toISOString();
    let runRecord = null;
    let completed = false;
    let finalAssistantText = "";
    const activeCommands = new Map();

    const handleEvent = (rawEvent) => {
      const baseEvent = rawEvent && typeof rawEvent === "object"
        ? rawEvent
        : { type: "raw_log", content: String(rawEvent || "") };
      const sanitizedBaseEvent = { ...baseEvent };
      if (RISK_AUDIT_EVENT_TYPES.has(String(sanitizedBaseEvent.type || ""))) {
        for (const key of ["command", "cwd", "reason"]) {
          if (typeof sanitizedBaseEvent[key] === "string") {
            sanitizedBaseEvent[key] = redact(sanitizedBaseEvent[key]);
          }
        }
      }
      const event = {
        ...sanitizedBaseEvent,
        metadata: {
          ...(sanitizedBaseEvent.metadata || {}),
          runId,
          projectId,
          taskId,
          hermesProfile: project.hermesProfile,
          hermesSessionId: sessionId,
        },
      };
      if (event.type === "run_stage") {
        event.runId = event.runId || runId;
        event.projectId = event.projectId || projectId;
        event.taskId = event.taskId || taskId;
        event.turnId = event.turnId || currentEnvelope.turnId;
      }
      this.updateActiveRunFromEvent(runRecord, event);
      collectTurnArtifactFromEvent(runRecord.turnArtifacts, event);
      const command = event.type === "tool_start" ? inferCommandFromTool(event) : null;
      if (command) {
        const key = eventToolKey(event);
        if (key) activeCommands.set(key, command);
        recordTurnArtifact(runRecord.turnArtifacts, "commands", command);
        const commandEvent = {
          type: "command_start",
          command,
          cwd: project.path || this.projectRoot,
          metadata: event.metadata,
        };
        this.emitToRenderer(webContents, { runId, projectId, taskId, event: commandEvent });
        this.persistEvent(projectId, taskId, commandEvent);
      }
      if (event.type === "tool_output") {
        const commandForOutput = activeCommands.get(eventToolKey(event));
        if (commandForOutput) {
          const commandEvent = {
            type: "command_output",
            content: typeof event.output === "string" ? event.output : JSON.stringify(event.output ?? {}, null, 2),
            metadata: { ...event.metadata, command: commandForOutput },
          };
          this.emitToRenderer(webContents, { runId, projectId, taskId, event: commandEvent });
          this.persistEvent(projectId, taskId, commandEvent);
        }
        const fileEvent = inferFileChangedFromTool(event);
        if (fileEvent) {
          recordTurnArtifact(runRecord.turnArtifacts, "files", fileEvent.path || fileEvent.summary);
          const enrichedFileEvent = { ...fileEvent, metadata: event.metadata };
          this.emitToRenderer(webContents, { runId, projectId, taskId, event: enrichedFileEvent });
          this.persistEvent(projectId, taskId, enrichedFileEvent);
        }
      }
      if (event.type === "tool_end") {
        const key = eventToolKey(event);
        const commandForEnd = activeCommands.get(key);
        if (commandForEnd) {
          const commandEvent = {
            type: "command_end",
            success: event.success !== false,
            metadata: { ...event.metadata, command: commandForEnd },
          };
          this.emitToRenderer(webContents, { runId, projectId, taskId, event: commandEvent });
          this.persistEvent(projectId, taskId, commandEvent);
          activeCommands.delete(key);
        }
      }
      if (event.type === "assistant_message") {
        finalAssistantText = String(event.content || "").trim();
      }
      if (event.type === "done") {
        completed = true;
        const completedAtMs = Date.now();
        const startedAtMs = Number(runRecord.startedAtMs || Date.parse(runRecord.startedAt) || completedAtMs);
        const durationMs = Math.max(0, completedAtMs - startedAtMs);
        event.metadata = {
          ...(event.metadata || {}),
          startedAt: event.metadata?.startedAt || runRecord.startedAt,
          completedAt: event.metadata?.completedAt || new Date(completedAtMs).toISOString(),
          durationMs: event.metadata?.durationMs ?? durationMs,
          durationSeconds: event.metadata?.durationSeconds ?? Math.round(durationMs / 100) / 10,
        };
        runRecord.completedAtMs = completedAtMs;
        runRecord.completedAt = event.metadata.completedAt;
        runRecord.terminalAtMs = completedAtMs;
        const terminalStatus = doneTerminalStatus(event.metadata, runRecord);
        if (runRecord.stopRequested) {
          this.updateUserInputEnvelopeStatus(projectId, taskId, currentEnvelope.id, {
            ...currentEnvelope,
            status: "cancelled",
          });
          event.metadata = {
            ...(event.metadata || {}),
            cancelled: true,
            stopRequested: true,
          };
        } else {
          const contextUpdate = runMode === "plan" || terminalStatus !== "completed"
            ? null
            : this.updateTaskContextAfterTurn(
                projectId,
                taskId,
                userInput,
                finalAssistantText,
                { artifacts: runRecord.turnArtifacts, attachments },
              );
          this.updateUserInputEnvelopeStatus(projectId, taskId, currentEnvelope.id, {
            ...currentEnvelope,
            status: terminalStatus,
          });
          if (runMode === "plan" && terminalStatus === "completed") {
            event.metadata = {
              ...(event.metadata || {}),
              planReviewRequired: true,
            };
          }
          if (contextUpdate) {
            event.metadata = {
              ...(event.metadata || {}),
              taskContextUpdated: true,
              taskContextPath: contextUpdate.path,
            };
          }
        }
        const pendingSteer =
          typeof event.metadata?.pendingSteer === "string"
            ? event.metadata.pendingSteer.trim()
            : "";
        if (pendingSteer) {
          const queued = this.enqueueTaskMessage(webContents, {
            projectId,
            taskId,
            userInput: pendingSteer,
            attachments: [],
            maxRecentMessages: input.maxRecentMessages,
            maxIterations: input.maxIterations,
            riskConfirmed: false,
            permissions,
            runtimeApprovalEnabled,
            approvalTimeoutSeconds,
          }, { persistUser: false, front: true, source: "guide-leftover" });
          this.emitQueueUpdate(
            webContents,
            projectId,
            taskId,
            runId,
            "Guidance arrived after the final answer and was moved to the next turn.",
            { queueId: queued.id, source: queued.source, queueState: "queued" },
          );
        }
      }
      this.emitToRenderer(webContents, { runId, projectId, taskId, event });
      this.persistEvent(projectId, taskId, event);
    };

    this.processManager.startJsonLineProcess({
      command: process.execPath,
      args: [adapterPath],
      options: {
        cwd: project.path || this.projectRoot,
        env: this.childEnv({
          CODEX_BINARY: this.codexPath || "codex",
          REDOU_APP_DATA_ROOT: this.appDataRoot(),
          REDOU_PROJECT_ID: projectId,
          REDOU_TASK_ID: taskId,
          REDOU_PLAN_DIR: planDir,
          REDOU_PERMISSIONS_JSON: JSON.stringify(permissions),
          REDOU_RUN_ID: runId,
          REDOU_TURN_ID: currentEnvelope.turnId,
        }),
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
      input: {
        projectId,
        taskId,
        runId,
        hermesProfile: project.hermesProfile,
        hermesSessionId: sessionId,
        userInput,
        systemContext: built.systemContext,
        userContext: built.userContext,
        contextMessages: built.contextMessages,
        attachments,
        metadata: runMetadata,
        riskConfirmed,
        permissions,
        runtimeApprovalEnabled,
        approvalTimeoutSeconds,
        model: effectiveModel,
        provider: effectiveProvider,
        workspacePath: project.path || this.projectRoot,
        runMode,
        goalMode,
        goalText: userInput,
        maxIterations,
      },
      onStarted: (child) => {
        runRecord = {
          child,
          projectId,
          taskId,
          webContents,
          startedAt: runStartedAt,
          startedAtMs: runStartedAtMs,
          lastActiveAtMs: runStartedAtMs,
          hermesSessionId: sessionId,
          model: effectiveModel,
          provider: effectiveProvider,
          contextTokens: toInt(runMetadata.contextTokens),
          inputTokens: 0,
          outputTokens: 0,
          outputEstimateTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
          apiCalls: 0,
          estimatedCostUsd: 0,
          assistantDeltaText: "",
          stopRequested: false,
          currentRequestEnvelope: currentEnvelope,
          turnArtifacts: emptyTurnArtifacts(),
        };
        seedAttachmentArtifacts(runRecord.turnArtifacts, attachments);
        this.processManager.registerRun(runId, runRecord);
        this.eventBus.publishTaskStarted({ projectId, taskId, runId });
        const startedEvent = {
          type: "raw_log",
          content: "Codex runtime started.",
          metadata: { runId, projectId, taskId, context: runMetadata },
        };
        this.emitToRenderer(webContents, { runId, projectId, taskId, event: startedEvent });
        this.persistEvent(projectId, taskId, startedEvent);
      },
      onStdoutEvent: (event) => {
        handleEvent(event);
      },
      onStderrLine: (line) => {
        handleEvent({ type: "raw_log", content: redact(line), metadata: { stream: "stderr", folded: true } });
      },
      onError: (error) => {
        handleEvent({ type: "error", message: error.message });
      },
      onExit: ({ code }) => {
        const run = this.activeRuns.get(runId);
        const stopRequested = run?.stopRequested === true || runRecord?.stopRequested === true || this.shuttingDown;
        if (!completed) {
          if (code === 0 || stopRequested) {
            handleEvent({ type: "done", metadata: { exitCode: code } });
          } else {
            handleEvent({ type: "error", message: `Codex runtime exited with code ${code}` });
            handleEvent({ type: "done", metadata: { exitCode: code } });
          }
        }
        this.processManager.deleteRun(runId);
        if (!this.shuttingDown) {
          setImmediate(() => this.startNextQueuedMessage(projectId, taskId));
        }
      },
    });

    return { ok: true, runId, context: runMetadata };
  }

}

function installHermesRunMethods(target) {
  for (const name of Object.getOwnPropertyNames(HermesRunMethods.prototype)) {
    if (name === "constructor") continue;
    Object.defineProperty(target.prototype, name, Object.getOwnPropertyDescriptor(HermesRunMethods.prototype, name));
  }
}

module.exports = { installHermesRunMethods };
