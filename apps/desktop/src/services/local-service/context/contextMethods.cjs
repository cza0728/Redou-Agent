const fs = require("fs");
const { RECENT_MESSAGE_LIMIT } = require("./contextUtils.cjs");
const { compactMultiline } = require("../shared/textUtils.cjs");
const { desktopSourcePath } = require("../shared/desktopPaths.cjs");

class ContextMethods {
  getGlobalContextFile(kind) {
    return this.contextBuilder.getGlobalFile(kind);
  }

  updateGlobalContextFile(kind, content) {
    return this.contextBuilder.updateGlobalFile(kind, content);
  }

  getProjectContextFile(projectId, kind) {
    return this.contextBuilder.getProjectFile(projectId, kind);
  }

  updateProjectContextFile(projectId, kind, content) {
    return this.contextBuilder.updateProjectFile(projectId, kind, content);
  }

  getTaskContextFile(projectId, taskId, kind) {
    return this.contextBuilder.getTaskFile(projectId, taskId, kind);
  }

  updateTaskContextFile(projectId, taskId, kind, content) {
    return this.contextBuilder.updateTaskFile(projectId, taskId, kind, content);
  }

  extractTaskContextRules(projectId, taskId, target = "task") {
    return this.contextBuilder.extractTaskRules(projectId, taskId, target);
  }

  _getGlobalContextFile(kind) {
    return this.contextBuilder.getGlobalFile(kind);
  }

  _updateGlobalContextFile(kind, content) {
    return this.contextBuilder.updateGlobalFile(kind, content);
  }

  _getProjectContextFile(projectId, kind) {
    return this.contextBuilder.getProjectFile(projectId, kind);
  }

  _updateProjectContextFile(projectId, kind, content) {
    return this.contextBuilder.updateProjectFile(projectId, kind, content);
  }

  _getTaskContextFile(projectId, taskId, kind) {
    return this.contextBuilder.getTaskFile(projectId, taskId, kind);
  }

  _updateTaskContextFile(projectId, taskId, kind, content) {
    return this.contextBuilder.updateTaskFile(projectId, taskId, kind, content);
  }

  _extractTaskContextRules(projectId, taskId, target = "task") {
    return this.contextBuilder.extractTaskRules(projectId, taskId, target);
  }

  normalizeAttachmentRecord(record, uploadsPath) {
    return this.artifactService.normalizeAttachmentRecord(record, uploadsPath);
  }

  copyTaskAttachments(projectId, taskId, filePaths = []) {
    return this.artifactService.copyTaskAttachments(projectId, taskId, filePaths);
  }

  copyTaskAttachmentBuffers(projectId, taskId, files = []) {
    return this.artifactService.copyTaskAttachmentBuffers(projectId, taskId, files);
  }

  formatAttachmentSize(size) {
    return this.contextBuilder.formatAttachmentSize(size);
  }

  formatAttachmentLine(attachment) {
    return this.contextBuilder.formatAttachmentLine(attachment);
  }

  formatAttachmentsForContext(attachments = []) {
    return this.contextBuilder.formatAttachmentsForContext(attachments);
  }

  attachmentOnlyRequestText(attachments = []) {
    return this.contextBuilder.attachmentOnlyRequestText(attachments);
  }

  renderRecentMessages(messages) {
    return this.contextBuilder.renderRecentMessages(messages);
  }

  applyContextDirective(projectId, taskId, userInput) {
    return this.contextBuilder.applyContextDirective(projectId, taskId, userInput);
  }

  appendRawTurnLog(projectId, taskId, userInput, assistantText, options = {}) {
    return this.contextBuilder.appendRawTurnLog(projectId, taskId, userInput, assistantText, options);
  }

  updateTaskContextAfterTurn(projectId, taskId, userInput, assistantText, options = {}) {
    return this.contextBuilder.updateTaskContextAfterTurn(projectId, taskId, userInput, assistantText, options);
  }

  section(title, content) {
    return this.contextBuilder.section(title, content);
  }

  redouSystemContext() {
    return this.contextBuilder.redouSystemContext();
  }

  outputContract(taskType) {
    return this.contextBuilder.outputContract(taskType);
  }

  inferTaskType(input = {}) {
    const explicit = String(input.taskType || input.capability || "").trim().toLowerCase();
    if (["coding", "research", "experiment", "general"].includes(explicit)) return explicit;
    if (["implementation", "debugging", "environment"].includes(explicit)) return "coding";
    const text = String(input.userInput || "").toLowerCase();
    if (/(experiment|benchmark|metric|auc|rmse|accuracy|loss|实验|指标|评测)/i.test(text)) return "experiment";
    if (/(research|source|citation|compare|调查|研究|资料|证据)/i.test(text)) return "research";
    if (/(code|implement|fix|test|debug|file|实现|修改|修复|调试|测试|文件)/i.test(text)) return "coding";
    return "general";
  }

  rootModelContextTokens() {
    return this.contextBuilder.rootModelContextTokens();
  }

  buildRedouContextPack(parts) {
    return this.contextBuilder.buildRedouContextPack(parts);
  }

  developerRulesContext(project, task, currentRequestText, redactionStats, taskType = "general") {
    return this.contextBuilder.developerRulesContext(project, task, currentRequestText, redactionStats, taskType);
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
    recentMessageLimit = RECENT_MESSAGE_LIMIT,
    attachmentMaxChars = 32000,
    structuredStateMaxChars = 120000,
  }) {
    return this.contextBuilder.buildContextMessagesCandidate({
      project,
      task,
      allMessages,
      currentAttachmentText,
      effectiveUserInput,
      currentEnvelope,
      taskType,
      allowEmptyCurrentRequest,
      recentMessageLimit,
      attachmentMaxChars,
      structuredStateMaxChars,
    });
  }

  buildContextCandidate({
    project,
    task,
    allMessages,
    currentAttachmentText,
    effectiveUserInput,
    currentEnvelope,
    taskType,
    allowEmptyCurrentRequest = false,
    recentMessageLimit = RECENT_MESSAGE_LIMIT,
    attachmentMaxChars = 32000,
    structuredStateMaxChars = 120000,
  }) {
    return this.contextBuilder.buildContextCandidate({
      project,
      task,
      allMessages,
      currentAttachmentText,
      effectiveUserInput,
      currentEnvelope,
      taskType,
      allowEmptyCurrentRequest,
      recentMessageLimit,
      attachmentMaxChars,
      structuredStateMaxChars,
    });
  }

  compactTaskContext(input = {}) {
    return this.contextBuilder.compactTaskContext(input);
  }

  runContextCompactModel(payload, project) {
    return this.contextBuilder.runCompressor(payload, project);
  }

  buildTaskContext(input = {}) {
    return this.contextBuilder.build(input);
  }

  _compactTaskContext({ project, task, budget, compactReason }) {
    return this.contextBuilder.compactTaskContext({ project, task, budget, compactReason });
  }

  _runContextCompactModel(payload, project) {
    if (!this.pythonPath || !fs.existsSync(this.pythonPath)) {
      // Context compaction is handled internally by Codex; skip legacy Python compactor
      return { ok: true, skipped: true, reason: "Codex handles context compaction internally." };
    }
    const compactorPath = desktopSourcePath("redou_context_compactor.py");
    if (!fs.existsSync(compactorPath)) {
      return { ok: false, error: `Context compactor not found: ${compactorPath}` };
    }
    const result = this.processManager.spawnSync(this.pythonPath, [compactorPath], {
      cwd: project.path || this.projectRoot,
      env: this.childEnv({
        HERMES_HOME: this.projectHermesHome(project),
        REDOU_APP_DATA_ROOT: this.appDataRoot(),
        REDOU_PROJECT_ID: project.id,
        REDOU_TASK_ID: payload.taskId,
        REDOU_PROJECT_HERMES_HOME: this.projectHermesHome(project),
        REDOU_PROJECT_SKILLS_DIR: this.projectSkillsDir(project),
        REDOU_HERMES_PROFILE: project.hermesProfile,
        PYTHONUTF8: "1",
        PYTHONUNBUFFERED: "1",
      }),
      input: JSON.stringify(payload || {}),
      encoding: "utf8",
      shell: false,
      timeout: 180000,
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    });
    if (result.error) {
      return { ok: false, error: result.error.message };
    }
    const stdout = String(result.stdout || "").trim();
    if (result.status !== 0 && !stdout) {
      return { ok: false, error: compactMultiline(result.stderr || `compact exited with code ${result.status}`, 1200) };
    }
    try {
      return JSON.parse(stdout);
    } catch (error) {
      return { ok: false, error: `compact returned invalid JSON: ${error.message}`, raw: stdout };
    }
  }

  _buildTaskContext(input = {}) {
    return this.contextBuilder._buildTaskContext(input);
  }

}

function installContextMethods(target) {
  for (const name of Object.getOwnPropertyNames(ContextMethods.prototype)) {
    if (name === "constructor") continue;
    Object.defineProperty(target.prototype, name, Object.getOwnPropertyDescriptor(ContextMethods.prototype, name));
  }
}

module.exports = { installContextMethods };
