const fs = require("fs");
const path = require("path");

class ContextBuilder {
  constructor({ host, repos = {}, paths = {}, logger = null, options = {}, helpers = {} } = {}) {
    if (!host) throw new Error("ContextBuilder requires host callbacks.");
    this.host = host;
    this.repos = repos;
    this.paths = paths;
    this.log = typeof logger === "function" ? logger : () => {};
    this.options = {
      recentMessageLimit: 20,
      recentMessageContentLimit: 4000,
      defaultModelContextTokens: 128000,
      compactForceRatio: 0.85,
      ...options,
    };
    this.helpers = helpers;
  }

  helper(name) {
    const fn = this.helpers[name];
    if (typeof fn !== "function") {
      throw new Error(`ContextBuilder helper is missing: ${name}`);
    }
    return fn;
  }

  readText(file) {
    return this.helper("readText")(file);
  }

  getGlobalFile(kind) {
    const paths = this.host.ensureGlobalFiles();
    if (kind !== "rules" && kind !== "user") {
      throw new Error("Unknown global context file");
    }
    const file = kind === "rules" ? paths.globalRulesPath : paths.userPath;
    return { kind, path: file, content: this.readText(file) };
  }

  updateGlobalFile(kind, content) {
    const response = this.getGlobalFile(kind);
    fs.writeFileSync(response.path, String(content || ""), "utf8");
    return { ...response, content: String(content || ""), ok: true };
  }

  getProjectFile(projectId, kind) {
    const project = this.host.readProject(projectId);
    if (!project) throw new Error("Project not found");
    const file = project.rulesPath;
    return { kind: "rules", path: file, content: this.readText(file) };
  }

  updateProjectFile(projectId, kind, content) {
    const response = this.getProjectFile(projectId, kind);
    fs.writeFileSync(response.path, String(content || ""), "utf8");
    return { ...response, content: String(content || ""), ok: true };
  }

  getTaskFile(projectId, taskId, kind) {
    const { task } = this.host.findProjectAndTask(projectId, taskId);
    if (!task) throw new Error("Task not found");
    const file = kind === "rules" ? task.rulesPath : task.contextPath;
    if (kind !== "rules") {
      this.ensureTaskContextShape(file, task);
    }
    return { kind, path: file, content: this.readText(file) };
  }

  updateTaskFile(projectId, taskId, kind, content) {
    const { task } = this.host.findProjectAndTask(projectId, taskId);
    if (!task) throw new Error("Task not found");
    const response = this.getTaskFile(projectId, taskId, kind);
    const nextContent = kind === "rules"
      ? String(content || "")
      : this.helper("normalizeTaskContextText")(content);
    fs.writeFileSync(response.path, nextContent, "utf8");
    if (kind !== "rules") {
      const state = this.helper("parseTaskStateFromStructuredText")(
        this.helper("splitTaskContext")(nextContent).structuredState,
      );
      const statePath = task.statePath || this.helper("taskStatePathFromContextPath")(response.path);
      fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    }
    return { ...response, content: nextContent, ok: true };
  }

  ensureTaskContextShape(taskContextPath, task = null) {
    const current = this.readText(taskContextPath);
    if (current.trim() && this.helper("hasTaskContextShape")(current)) {
      const normalized = this.helper("normalizeTaskContextText")(current);
      if (current !== normalized) fs.writeFileSync(taskContextPath, normalized, "utf8");
      return normalized;
    }
    const statePath = task?.statePath || this.helper("taskStatePathFromContextPath")(taskContextPath);
    let state = this.helper("readTaskStateFile")(statePath);
    if (!fs.existsSync(statePath) && current.trim()) {
      state = this.helper("parseTaskStateFromStructuredText")(
        this.helper("splitTaskContext")(current).structuredState,
      );
    }
    const next = this.helper("renderTaskContextMarkdown")(state);
    if (current !== next) {
      fs.writeFileSync(taskContextPath, next, "utf8");
    }
    return next;
  }

  ensureTaskStateShape(task) {
    const statePath = task?.statePath || this.helper("taskStatePathFromContextPath")(task?.contextPath || "");
    const eventsPath = task?.eventsPath || this.helper("taskEventsPathFromContextPath")(task?.contextPath || "");
    this.helper("mkdirp")(path.dirname(statePath));
    if (!fs.existsSync(eventsPath)) this.helper("ensureEmptyFile")(eventsPath);
    let state = this.helper("readTaskStateFile")(statePath);
    if (!fs.existsSync(statePath)) {
      const contextText = this.readText(task.contextPath);
      state = contextText.trim()
        ? this.helper("parseTaskStateFromStructuredText")(
            this.helper("splitTaskContext")(contextText).structuredState,
          )
        : this.helper("defaultTaskState")();
      this.helper("writeTaskStateFiles")(task, state);
    }
    return state;
  }

  formatAttachmentSize(size) {
    const value = Number(size || 0);
    if (!Number.isFinite(value) || value <= 0) return "";
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }

  formatAttachmentLine(attachment) {
    if (!attachment || typeof attachment !== "object") return "";
    const kind = this.helper("isImageMime")(attachment.mimeType) ? "image" : "file";
    const details = [
      attachment.mimeType ? `type=${attachment.mimeType}` : "",
      this.formatAttachmentSize(attachment.size),
    ].filter(Boolean).join(", ");
    const locations = [
      attachment.storedPath ? `storedPath=${attachment.storedPath}` : "",
      attachment.originalPath ? `originalPath=${attachment.originalPath}` : "",
    ].filter(Boolean).join("; ");
    return [
      `- [${kind}] ${attachment.name || "attachment"}${details ? ` (${details})` : ""}`,
      locations ? `  ${locations}` : "",
    ].filter(Boolean).join("\n");
  }

  formatAttachmentsForContext(attachments = []) {
    return (Array.isArray(attachments) ? attachments : [])
      .map((attachment) => this.formatAttachmentLine(attachment))
      .filter(Boolean)
      .join("\n");
  }

  attachmentOnlyRequestText(attachments = []) {
    const count = Array.isArray(attachments) ? attachments.length : 0;
    if (count <= 0) return "";
    const imageCount = attachments.filter((attachment) => this.helper("isImageMime")(attachment.mimeType)).length;
    const fileCount = count - imageCount;
    const parts = [
      imageCount ? `${imageCount} image${imageCount === 1 ? "" : "s"}` : "",
      fileCount ? `${fileCount} file${fileCount === 1 ? "" : "s"}` : "",
    ].filter(Boolean).join(" and ");
    return `The user sent ${parts || `${count} attachment${count === 1 ? "" : "s"}`} without additional text. Use the attachment paths below as the current request.`;
  }

  renderRecentMessages(messages) {
    return messages
      .filter((message) => ["user", "assistant", "system", "tool"].includes(message.role))
      .map((message) => {
        const content = this.helper("compactMultiline")(message.content, this.options.recentMessageContentLimit);
        const attachments = this.formatAttachmentsForContext(message.attachments);
        const parts = [`${message.role}: ${content}`.trim()];
        if (attachments) parts.push(`Attachments:\n${attachments}`);
        return parts.join("\n").trim();
      })
      .filter(Boolean)
      .join("\n\n");
  }

  applyContextDirective(projectId, taskId, userInput) {
    const directive = this.helper("classifyContextDirective")(userInput);
    if (!directive) return null;
    const { project, task } = this.host.findProjectAndTask(projectId, taskId);
    if (!project || !task) return null;
    const targetPath =
      directive.scope === "project"
        ? project.rulesPath
        : task.rulesPath;
    const label =
      directive.scope === "project"
        ? "PROJECT_RULES.md"
        : "TASK_RULES.md";
    const added = this.helper("appendDedupeRules")(targetPath, [directive.content]);
    const alreadyPresent = added.length === 0;
    return {
      ...directive,
      targetPath,
      label,
      alreadyPresent,
    };
  }

  appendRawTurnLog(projectId, taskId, userInput, assistantText, options = {}) {
    const { task } = this.host.findProjectAndTask(projectId, taskId);
    if (!task) return null;
    const user = String(userInput || "");
    const assistant = String(assistantText || "");
    if (!user.trim() && !assistant.trim()) return null;
    const artifacts = options.artifacts && typeof options.artifacts === "object"
      ? options.artifacts
      : this.helper("emptyTurnArtifacts")();
    this.helper("seedAttachmentArtifacts")(artifacts, options.attachments || []);
    this.host.appendTaskEventJsonl(task, {
      type: "turn_digest",
      user,
      assistant,
      files: artifacts.files || [],
      commands: artifacts.commands || [],
      errors: artifacts.errors || [],
      attachments: artifacts.attachments || [],
      createdAt: this.helper("isoNow")(),
    });
    const events = this.host.readTaskEvents(task);
    const state = this.helper("compressTaskContext")(events, options.budget || { maxChars: 12000 });
    this.helper("writeTaskStateFiles")(task, state);
    const content = this.readText(task.contextPath);
    return { path: task.contextPath, statePath: task.statePath, eventsPath: task.eventsPath, length: content.length };
  }

  updateTaskContextAfterTurn(projectId, taskId, userInput, assistantText, options = {}) {
    return this.appendRawTurnLog(projectId, taskId, userInput, assistantText, options);
  }

  section(title, content) {
    const body = String(content || "").trim() || "(empty)";
    return `## ${title}\n\n${body}`;
  }

  redouSystemContext() {
    const redouIdentity = [
      "You are Redou Agent inside Redou Desktop Task Chat.",
      "Use Redou Agent as the visible product identity; Hermes is only the Local Runtime layer.",
      "Answer and act within the current Project and Task unless the user explicitly asks to cross that boundary.",
    ].join("\n");
    const isolation = [
      "The current Project is the only project boundary.",
      "The current Task is the only conversation boundary.",
      "Do not reference rules, task context, chat history, sessions, or memories from any other Project or Task.",
      "If cross-Project or cross-Task reuse is needed, ask the user first.",
      "Renderer code calls IPC handlers; only the Electron Main Process / Local Service layer starts Hermes CLI child processes.",
      "Hermes terminal output is never the main UI surface; parse runtime output into structured AgentEvent objects.",
      "The Hermes memory and session_search toolsets are disabled in Redou Task Chat.",
      "Hermes skill reading is allowed through skills_list and skill_view; Hermes skill management is disabled.",
      "Do not create, patch, edit, delete, or reorganize skills from the agent turn. User-initiated task packaging is handled by Redou.",
      "High-risk file operations or shell commands require explicit user confirmation before execution.",
    ].join("\n");
    return [
      "# Redou System Instructions",
      "",
      this.section("Redou Identity", redouIdentity),
      "",
      this.section("Isolation Rules", isolation),
    ].join("\n");
  }

  outputContract(taskType) {
    const type = String(taskType || "general").toLowerCase();
    const contracts = {
      coding: [
        "You must report:",
        "1. files inspected",
        "2. files changed",
        "3. commands run",
        "4. tests or checks performed",
        "5. result",
        "6. remaining risks",
      ],
      research: [
        "You must report:",
        "1. evidence used",
        "2. reasoning",
        "3. proposed revision or conclusion",
        "4. uncertainty",
        "5. next suggested action",
      ],
      experiment: [
        "You must report:",
        "1. root cause or finding",
        "2. commands run",
        "3. config or code changes",
        "4. output paths",
        "5. metrics or logs",
        "6. unresolved issues",
      ],
      general: [
        "You must report:",
        "1. what was done",
        "2. key result",
        "3. remaining issues",
        "4. next action",
      ],
    };
    return (contracts[type] || contracts.general).join("\n");
  }

  inferTaskType(input = {}) {
    const explicit = String(input.taskType || input.capability || "").trim().toLowerCase();
    if (["coding", "research", "experiment", "general"].includes(explicit)) return explicit;
    if (["implementation", "debugging", "environment"].includes(explicit)) return "coding";
    const text = String(input.userInput || "").toLowerCase();
    if (/(experiment|benchmark|metric|auc|rmse|accuracy|loss|瀹為獙|鎸囨爣|璇勬祴)/i.test(text)) return "experiment";
    if (/(research|source|citation|compare|璋冩煡|鐮旂┒|璧勬枡|璇佹嵁)/i.test(text)) return "research";
    if (/(code|implement|fix|test|debug|file|瀹炵幇|淇敼|淇|璋冭瘯|娴嬭瘯|鏂囦欢)/i.test(text)) return "coding";
    return "general";
  }

  rootModelContextTokens() {
    const block = this.host.rootModelConfigBlock();
    for (const line of block.split(/\r?\n/)) {
      const match = line.match(/^\s+(context_length|context_window|model_context_length):\s*(\d+)\s*$/);
      if (match) return Number(match[2]);
    }
    return this.options.defaultModelContextTokens;
  }

  buildRedouContextPack(parts) {
    return [
      "# Redou Context Preview",
      "",
      "## 0. Priority",
      "",
      "Follow this priority when context conflicts:",
      "",
      "1. Current User Request",
      "2. Task Rules",
      "3. Project Rules",
      "4. Task Context",
      "5. Recent Conversation",
      "6. Redou Default Behavior",
      "",
      "Do not use unrelated projects, tasks, sessions, or memories.",
      "",
      "---",
      "",
      "## 1. Project Rules",
      "",
      String(parts.projectRules || "").trim() || "(empty)",
      "",
      "---",
      "",
      "## 2. Task Rules",
      "",
      String(parts.taskRules || "").trim() || "(empty)",
      "",
      "---",
      "",
      "## 3. Task Context",
      "",
      String(parts.structuredState || "").trim() || "(empty)",
      "",
      "---",
      "",
      "## 4. Recent Conversation",
      "",
      String(parts.recentConversation || "").trim() || "(empty)",
      "",
      "---",
      "",
      "## 5. Attachments",
      "",
      String(parts.attachments || "").trim() || "(empty)",
      "",
      "---",
      "",
      "## 6. Current User Request",
      "",
      String(parts.currentUserRequest || "").trim() || "(empty)",
      "",
      "---",
      "",
      "## 7. Output Contract",
      "",
      String(parts.outputContract || "").trim() || this.outputContract("general"),
      "",
    ].join("\n");
  }

  developerRulesContext(project, task, currentRequestText, redactionStats, taskType = "general") {
    const SecretRedactor = this.helpers.SecretRedactor;
    const safeProjectRules = SecretRedactor.redactText(
      this.helper("scrubCurrentRequestEcho")(this.readText(project.rulesPath), currentRequestText),
    );
    const safeTaskRules = SecretRedactor.redactText(
      this.helper("scrubCurrentRequestEcho")(this.readText(task.rulesPath), currentRequestText),
    );
    redactionStats.count += safeProjectRules.count + safeTaskRules.count;
    return [
      "# Redou Project and Task Rules",
      "",
      "## Project Rules",
      "",
      safeProjectRules.text.trim() || "(empty)",
      "",
      "## Task Rules",
      "",
      safeTaskRules.text.trim() || "(empty)",
      "",
      "## Output Contract",
      "",
      this.outputContract(taskType),
    ].join("\n");
  }

  buildContextMessagesCandidate({
    project,
    task,
    allMessages,
    currentAttachmentText,
    effectiveUserInput,
    currentEnvelope,
    taskType,
    allowEmptyCurrentRequest = false,
    recentMessageLimit = this.options.recentMessageLimit,
    attachmentMaxChars = 32000,
    structuredStateMaxChars = 120000,
  }) {
    void recentMessageLimit;
    const SecretRedactor = this.helpers.SecretRedactor;
    const redactionStats = { count: 0 };
    const currentSafe = SecretRedactor.redactText(effectiveUserInput);
    redactionStats.count += currentSafe.count;
    const currentRequestText = currentSafe.text.trim();
    const state = this.ensureTaskStateShape(task);
    const structuredState = this.helper("renderTaskStateStructuredMarkdown")(state);
    const excludedQueuedMessageIds = [];
    const excludedGuideControlEventIds = [];

    for (const message of allMessages || []) {
      const envelope = this.helper("messageInputEnvelope")(message);
      if (envelope && envelope.id !== currentEnvelope?.id && ["pending", "consumed"].includes(envelope.status)) {
        excludedQueuedMessageIds.push(envelope.id);
      }
      if (this.helper("isControlEventMessage")(message)) {
        const { metadata } = this.helper("mergeMetadata")(message);
        excludedGuideControlEventIds.push(envelope?.id || metadata.guideId || metadata.controlEventId || "");
      }
    }

    const historyMessages = [];

    const taskStateRaw = this.helper("compactMultiline")(
      this.helper("scrubCurrentRequestEcho")(structuredState, currentRequestText),
      structuredStateMaxChars,
    );
    const taskState = SecretRedactor.redactText(taskStateRaw);
    redactionStats.count += taskState.count;

    const attachmentSafe = SecretRedactor.redactText(
      this.helper("compactMultiline")(currentAttachmentText, attachmentMaxChars),
    );
    redactionStats.count += attachmentSafe.count;
    const finalUserParts = [
      "# Current User Request",
      "",
      currentRequestText || "(empty)",
    ];
    if (attachmentSafe.text.trim()) {
      finalUserParts.push("", "## Attachments", "", attachmentSafe.text.trim());
    }

    const contextMessages = [
      {
        role: "system",
        content: this.redouSystemContext(),
        metadata: { redouContextKind: "system" },
      },
      {
        role: "developer",
        content: this.developerRulesContext(project, task, currentRequestText, redactionStats, taskType),
        metadata: { redouContextKind: "rules" },
      },
      {
        role: "developer",
        content: [
          "# Task State Snapshot",
          "",
          taskState.text.trim() || "(empty)",
        ].join("\n"),
        metadata: { redouContextKind: "task_state" },
      },
      ...historyMessages,
      {
        role: "user",
        content: finalUserParts.join("\n"),
        metadata: {
          redouContextKind: "current_request",
          inputEnvelope: currentEnvelope,
        },
      },
    ];
    const validation = this.helpers.ContextValidator.validate(contextMessages, {
      currentRequestText,
      currentRequestId: currentEnvelope?.id || "",
      allowEmptyCurrentRequest,
    });
    const promptText = this.helper("promptTextFromMessages")(contextMessages);
    const includedTurnIds = this.helper("uniqueList")(
      contextMessages
        .map((message) => message.metadata?.inputEnvelope?.turnId || message.metadata?.turnId)
        .filter(Boolean),
      40,
    );
    const debugReport = {
      includedMessageCount: contextMessages.length,
      tokenEstimate: this.helper("estimateContextTokens")(promptText),
      currentRequestId: currentEnvelope?.id || "",
      includedTurnIds,
      excludedQueuedMessageIds: this.helper("uniqueList")(excludedQueuedMessageIds.filter(Boolean), 40),
      excludedGuideControlEventIds: this.helper("uniqueList")(excludedGuideControlEventIds.filter(Boolean), 40),
      redactedSecretCount: redactionStats.count,
      validationResult: validation.ok ? "ok" : "failed",
      validationErrors: validation.errors,
    };
    const preview = this.buildRedouContextPack({
      projectRules: SecretRedactor.redactText(this.helper("scrubCurrentRequestEcho")(this.readText(project.rulesPath), currentRequestText)).text,
      taskRules: SecretRedactor.redactText(this.helper("scrubCurrentRequestEcho")(this.readText(task.rulesPath), currentRequestText)).text,
      structuredState: taskState.text,
      recentConversation: historyMessages.map((message) => `${message.role}: ${message.content}`).join("\n\n"),
      attachments: attachmentSafe.text,
      currentUserRequest: currentRequestText,
      outputContract: this.outputContract(taskType),
    });
    return {
      contextMessages,
      systemContext: contextMessages[0].content,
      userContext: preview,
      contextLength: promptText.length,
      contextTokens: this.helper("estimateContextTokens")(promptText),
      currentRequestText,
      debugReport,
      validation,
    };
  }

  buildContextCandidate(input = {}) {
    return this.buildContextMessagesCandidate(input);
  }

  shouldCompressContext(contextUsage, budget) {
    return this.helper("shouldCompactContext")(contextUsage, budget);
  }

  compressContext(input = {}) {
    return this.compactTaskContext(input);
  }

  compactTaskContext({ project, task, budget, compactReason }) {
    const beforeState = this.helper("readTaskStateFile")(task.statePath);
    const beforeTokens = this.helper("estimateContextTokens")(
      this.helper("renderTaskStateStructuredMarkdown")(beforeState),
    );
    const state = this.helper("applyTaskStateBudget")(beforeState, {
      ...budget,
      maxChars: Math.max(2000, Math.floor(Number(budget?.inputBudget || 0) * 2) || 12000),
    });
    this.helper("writeTaskStateFiles")(task, state);
    const compressedTaskContext = this.readText(task.contextPath);
    const afterTokens = this.helper("estimateContextTokens")(compressedTaskContext);
    return {
      triggered: true,
      succeeded: true,
      taskContextBeforeTokens: beforeTokens,
      taskContextAfterTokens: afterTokens,
      reason: compactReason,
      projectRulesAdded: [],
      taskRulesAdded: [],
    };
  }

  runCompressor(payload, project) {
    return this.host._runContextCompactModel(payload, project);
  }

  extractRules(projectId, taskId, target = "task") {
    return this.extractTaskRules(projectId, taskId, target);
  }

  extractTaskRules(projectId, taskId, target = "task") {
    const targetScope = target === "project" ? "project" : "task";
    const { project, task } = this.host.findProjectAndTask(projectId, taskId);
    if (!project || !task) throw new Error("Project or task not found");

    const taskContext = this.helper("normalizeTaskContextText")(this.readText(task.contextPath));
    const targetPath = targetScope === "project" ? project.rulesPath : task.rulesPath;
    const targetLabel = targetScope === "project" ? "PROJECT_RULES.md" : "TASK_RULES.md";
    let extractedRules = this.helper("extractRulesFromTaskContextText")(taskContext, targetScope);
    let extractor = "structured-context";
    const warnings = [];

    if (!extractedRules.length) {
      const modelResponse = this.runCompressor(
        {
          projectId: project.id,
          taskId: task.id,
          hermesProfile: project.hermesProfile,
          provider: task.model_provider,
          model: task.model,
          projectRules: this.readText(project.rulesPath),
          taskRules: this.readText(task.rulesPath),
          taskContext,
          recentMessages: "",
          attachments: "",
          currentUserRequest: `Extract ${targetScope} rules from TASK_CONTEXT.md into ${targetLabel}.`,
          compactReason: "manual-rule-extract",
          budget: this.helper("getContextBudget")(this.rootModelContextTokens()),
        },
        project,
      );
      if (modelResponse?.ok && modelResponse.result && typeof modelResponse.result === "object") {
        const modelRules = targetScope === "project"
          ? modelResponse.result.project_rules_to_add
          : modelResponse.result.task_rules_to_add;
        extractedRules = this.helper("uniqueList")(modelRules || [], 50);
        extractor = "model";
      } else if (modelResponse?.error) {
        warnings.push(modelResponse.error);
      }
    }

    const rulesAdded = this.helper("appendDedupeRules")(targetPath, extractedRules);
    if (!extractedRules.length) {
      warnings.push("No candidate rules were found in TASK_CONTEXT.md.");
    } else if (!rulesAdded.length) {
      warnings.push(`All extracted rules were already present in ${targetLabel}.`);
    }

    const eventContent = rulesAdded.length
      ? `Extracted ${rulesAdded.length} rule(s) from TASK_CONTEXT.md into ${targetLabel}.`
      : `No new rules extracted from TASK_CONTEXT.md into ${targetLabel}.`;
    this.host.appendTaskMessage(projectId, taskId, "event", eventContent, {
      eventType: "rules_extracted",
      target: targetScope,
      targetPath,
      sourcePath: task.contextPath,
      extractor,
      rulesAdded,
      extractedRules,
      warnings,
    });
    this.log(`redou task rules extracted projectId=${project.id} taskId=${task.id} target=${targetScope} added=${rulesAdded.length} extractor=${extractor} targetPath=${this.helper("redact")(targetPath)}`);

    const refreshedProject = this.host.readProject(project.id) || project;
    const refreshedTask =
      refreshedProject.tasks.find((item) => item.id === task.id) || task;
    return {
      ok: true,
      project: refreshedProject,
      task: refreshedTask,
      target: targetScope,
      targetPath,
      sourcePath: task.contextPath,
      extractor,
      extractedRules,
      rulesAdded,
      warnings,
    };
  }

  build(input = {}) {
    return this._buildTaskContext(input);
  }

  _buildTaskContext(input = {}) {
    const projectId = String(input.projectId || "").trim();
    const taskId = String(input.taskId || "").trim();
    const userInput = String(input.userInput || "");
    const preview = input.preview === true || input.allowEmptyCurrentRequest === true;
    const currentEnvelope = input.currentEnvelope && typeof input.currentEnvelope === "object"
      ? this.helper("createUserInputEnvelope")(input.currentEnvelope)
      : this.helper("createUserInputEnvelope")({
          text: userInput,
          deliveryMode: this.helper("normalizeDeliveryMode")(input.deliveryMode, "new_turn"),
          status: "consumed",
        });
    const rawAttachments = Array.isArray(input.attachments) ? input.attachments : [];
    const maxRecentMessages = Number.isFinite(Number(input.maxRecentMessages))
      ? Number(input.maxRecentMessages)
      : this.options.recentMessageLimit;
    const { project, task } = this.host.findProjectAndTask(projectId, taskId);
    if (!project || !task) throw new Error("Project or task not found");
    const currentAttachments = rawAttachments
      .map((item) => this.host.normalizeAttachmentRecord(item, task.uploadsPath))
      .filter(Boolean);
    const currentAttachmentPaths = currentAttachments
      .map((attachment) => attachment.storedPath)
      .filter(Boolean);
    const currentAttachmentText = this.formatAttachmentsForContext(currentAttachments);
    const effectiveUserInput = userInput.trim() || this.attachmentOnlyRequestText(currentAttachments);
    const { messages } = this.host.loadMessagesFile(task.messagesPath, { projectId, taskId });
    const recentMessages = messages.slice(-Math.max(0, maxRecentMessages));
    this.ensureTaskStateShape(task);
    const includedFiles = [
      project.rulesPath,
      task.rulesPath,
      task.statePath,
      ...currentAttachmentPaths,
    ];
    const taskType = this.inferTaskType({ ...input, userInput: effectiveUserInput, capability: task.capability });
    const modelContextTokens = Number(input.modelContextTokens || 0) || this.rootModelContextTokens();
    const budget = this.helper("getContextBudget")(modelContextTokens);
    const provider = String(input.provider || "").trim();
    const model = String(input.model || "").trim();
    const candidateInput = {
      project,
      task,
      allMessages: messages,
      currentAttachmentText,
      effectiveUserInput,
      currentEnvelope: {
        ...currentEnvelope,
        text: effectiveUserInput,
      },
      taskType,
      allowEmptyCurrentRequest: preview,
      recentMessageLimit: maxRecentMessages,
    };
    let rendered = this.buildContextCandidate(candidateInput);
    const beforeCompactTokens = rendered.contextTokens;
    const compactDecision = this.shouldCompressContext(beforeCompactTokens, budget);
    let contextCompression = {
      triggered: false,
      succeeded: false,
      beforeTokens: beforeCompactTokens,
      afterTokens: beforeCompactTokens,
      modelContextTokens: budget.modelContextTokens,
      inputBudget: budget.inputBudget,
      reservedOutput: budget.reservedOutput,
      safetyMargin: budget.safetyMargin,
      thresholdRatio: this.options.compactForceRatio,
      emergency: compactDecision.emergency,
      reason: "",
      fallbackTrimmed: false,
      projectRulesAdded: [],
      taskRulesAdded: [],
      compressedSections: [],
    };
    if (compactDecision.shouldCompact) {
      contextCompression = {
        ...contextCompression,
        ...this.compactTaskContext({
          project,
          task,
          recentMessages: [],
          currentAttachments,
          effectiveUserInput,
          budget,
          compactReason: compactDecision.emergency ? "emergency" : "force",
          provider,
          model,
        }),
      };
      rendered = this.buildContextCandidate(candidateInput);
      contextCompression.afterTokens = rendered.contextTokens;
    }
    if (rendered.contextTokens > budget.inputBudget) {
      rendered = this.buildContextCandidate({
        ...candidateInput,
        recentMessageLimit: Math.min(5, recentMessages.length),
        attachmentMaxChars: 8000,
        structuredStateMaxChars: 16000,
      });
      contextCompression.fallbackTrimmed = true;
    }
    if (rendered.contextTokens > budget.inputBudget) {
      rendered = this.buildContextCandidate({
        ...candidateInput,
        recentMessageLimit: Math.min(2, recentMessages.length),
        attachmentMaxChars: 4000,
        structuredStateMaxChars: 8000,
      });
      contextCompression.fallbackTrimmed = true;
    }
    const { systemContext, userContext, contextMessages, contextLength, contextTokens } = rendered;
    const metadata = {
      projectId,
      taskId,
      hermesProfile: project.hermesProfile,
      includedFiles,
      recentMessageCount: recentMessages.length,
      promptRecentMessageCount: 0,
      attachmentCount: currentAttachments.length,
      imageAttachmentCount: currentAttachments.filter((attachment) => this.helper("isImageMime")(attachment.mimeType)).length,
      contextLength,
      contextChars: contextLength,
      contextTokens,
      modelContextTokens: budget.modelContextTokens,
      contextMaxTokens: budget.inputBudget,
      reservedOutputTokens: budget.reservedOutput,
      safetyMarginTokens: budget.safetyMargin,
      contextPercent: this.helper("contextPercent")(contextTokens, budget.inputBudget),
      contextCompressed: contextCompression.triggered,
      contextCompression,
      taskType,
      projectName: project.name,
      taskTitle: task.title,
      projectPath: project.path,
      projectRulesPath: project.rulesPath,
      taskRulesPath: task.rulesPath,
      taskContextPath: task.contextPath,
      taskStatePath: task.statePath,
      currentRequestId: rendered.debugReport.currentRequestId,
      currentTurnId: currentEnvelope.turnId,
      promptMessageCount: rendered.debugReport.includedMessageCount,
      contextDebugReport: rendered.debugReport,
      contextValidation: rendered.validation,
      preview,
    };
    const debugLine = `redou context debug projectId=${projectId} taskId=${taskId} currentRequestId=${metadata.currentRequestId} messages=${rendered.debugReport.includedMessageCount} tokens=${rendered.debugReport.tokenEstimate} includedTurnIds=${rendered.debugReport.includedTurnIds.join("|")} excludedQueued=${rendered.debugReport.excludedQueuedMessageIds.join("|")} excludedGuides=${rendered.debugReport.excludedGuideControlEventIds.join("|")} redactedSecrets=${rendered.debugReport.redactedSecretCount} validation=${rendered.debugReport.validationResult}`;
    if (process.env.REDOU_CONTEXT_DEBUG === "1" || process.env.NODE_ENV !== "production") {
      this.log(debugLine);
    }
    this.log(`redou context built projectId=${projectId} taskId=${taskId} projectPath=${this.helper("redact")(project.path)} hermesProfile=${project.hermesProfile} messagesPath=${this.helper("redact")(task.messagesPath)} includedFiles=${includedFiles.map((file) => this.helper("redact")(file)).join("|")} recentMessageCount=${recentMessages.length} contextLength=${contextLength} contextTokens=${contextTokens} contextPercent=${metadata.contextPercent} compressed=${metadata.contextCompressed}`);
    return { systemContext, userContext, contextMessages, metadata };
  }

  ruleExtractor() {
    return {
      extract: (projectId, taskId, target = "task") => this.extractTaskRules(projectId, taskId, target),
    };
  }

  contextCompressor() {
    return {
      shouldCompress: (contextUsage, budget) => this.shouldCompressContext(contextUsage, budget),
      compact: (input = {}) => this.compactTaskContext(input),
      compress: (input = {}) => this.compressContext(input),
      runModel: (payload, project) => this.runCompressor(payload, project),
    };
  }
}

module.exports = {
  ContextBuilder,
};
