const { buildEffectivePermissions, buildUnattendedPermissions } = require("../permissions/permissionPolicy.cjs");
const { isoNow } = require("../shared/timeUtils.cjs");
const { estimateContextTokens, usageFromMetadata } = require("../context/contextUtils.cjs");

class RuntimeDelegateMethods {
  getConfig() { return this.settingsService.getConfig(); }

  getConfigDefaults() { return this.settingsService.getConfigDefaults(); }

  getConfigSchema() { return this.settingsService.getConfigSchema(); }

  saveConfig(config) { return this.settingsService.saveConfig(config); }

  getConfigRaw() { return this.settingsService.getConfigRaw(); }

  saveConfigRaw(yamlText) { return this.settingsService.saveConfigRaw(yamlText); }

  effectivePermissions(input = {}) {
    let configPermissions = {};
    try {
      const config = this.getConfig();
      if (config?.permissions && typeof config.permissions === "object" && !Array.isArray(config.permissions)) {
        configPermissions = config.permissions;
      }
    } catch {
      configPermissions = {};
    }
    const inputPermissions =
      input?.permissions && typeof input.permissions === "object" && !Array.isArray(input.permissions)
        ? input.permissions
        : {};
    return buildEffectivePermissions({
      configPermissions,
      inputPermissions,
      overrides: input,
    });
  }

  unattendedPermissions(input = {}) {
    return buildUnattendedPermissions(this.effectivePermissions(input));
  }

  getSkills() { return this.skillService.getSkills(); }

  toggleSkill(name, enabled, scope = null) { return this.skillService.toggleSkill(name, enabled, scope); }

  deleteSkill(skill) { return this.skillService.deleteSkill(skill); }

  mergeSkills(skills) { return this.skillService.mergeSkills(skills); }

  getToolsets() { return this.skillService.getToolsets(); }

  getModelInfo() {
    return this.runDashboardBridge("get_model_info");
  }

  getModelSetupCatalog() {
    return this.runDashboardBridge("get_model_setup_catalog");
  }

  getModelOptions() {
    return this.runDashboardBridge("get_model_options");
  }

  getAuxiliaryModels() {
    return this.runDashboardBridge("get_auxiliary_models");
  }

  setModelAssignment(body) {
    return this.runDashboardBridge("set_model_assignment", body);
  }

  refreshModelSetupModels(body) {
    return this.runDashboardBridge("refresh_model_setup_models", body);
  }

  setupMainModel(body) {
    return this.runDashboardBridge("setup_main_model", body);
  }

  getLogs(params = {}) {
    return this.logService.getLogs(params);
  }

  getCronJobs() {
    return this.schedulerService.listSchedules();
  }

  createCronJob(job) {
    return this.schedulerService.createSchedule(job);
  }

  updateCronJob(id, updates = {}) {
    return this.schedulerService.updateSchedule(id, updates);
  }

  pauseCronJob(id) {
    return this.schedulerService.pauseSchedule(id);
  }

  resumeCronJob(id) {
    return this.schedulerService.resumeSchedule(id);
  }

  triggerCronJob(id) {
    return this.schedulerService.runNow(id);
  }

  deleteCronJob(id) {
    return this.schedulerService.deleteSchedule(id);
  }

  getThemes() { return this.settingsService.getThemes(); }

  setTheme(name) { return this.settingsService.setTheme(name); }

  getLanguage() { return this.settingsService.getLanguage(); }

  setLanguage(language) { return this.settingsService.setLanguage(language); }

  getDashboardPlugins() { return this.pluginService.getDashboardPlugins(); }

  rescanDashboardPlugins() { return this.pluginService.rescanDashboardPlugins(); }

  getPluginsHub() { return this.pluginService.getPluginsHub(); }

  getMcpHub() { return this.pluginService.getMcpHub(); }

  installMcpServer(body) { return this.pluginService.installMcpServer(body); }

  removeMcpServer(name) { return this.pluginService.removeMcpServer(name); }

  testMcpServer(name) { return this.pluginService.testMcpServer(name); }

  installAgentPlugin(body) { return this.pluginService.installAgentPlugin(body); }

  enableAgentPlugin(name) { return this.pluginService.enableAgentPlugin(name); }

  disableAgentPlugin(name) { return this.pluginService.disableAgentPlugin(name); }

  updateAgentPlugin(name) { return this.pluginService.updateAgentPlugin(name); }

  removeAgentPlugin(name) { return this.pluginService.removeAgentPlugin(name); }

  savePluginProviders(body) { return this.pluginService.savePluginProviders(body); }

  setPluginVisibility(name, hidden) { return this.pluginService.setPluginVisibility(name, hidden); }

  getModelsAnalytics(days) {
    return this.analyticsService.getModelsAnalytics(days);
  }

  activeAnalysisItems() {
    return this.analyticsService.activeAnalysisItems();
  }

  primaryActiveAnalysisRun() {
    return this.analyticsService.primaryActiveAnalysisRun();
  }

  getStatus() {
    return this.analyticsService.getStatus();
  }

  desktopSessionId(project, task) {
    return this.analyticsService.desktopSessionId(project, task);
  }

  findTaskByDesktopSessionId(sessionId) {
    return this.analyticsService.findTaskByDesktopSessionId(sessionId);
  }

  activeRunForTaskSnapshot(projectId, taskId) {
    return this.analyticsService.activeRunForTaskSnapshot(projectId, taskId);
  }

  analysisRunForTaskSnapshot(projectId, taskId) {
    return this.analyticsService.analysisRunForTaskSnapshot(projectId, taskId);
  }

  hasAnalysisRunForTask(projectId, taskId = null) {
    return this.analyticsService.hasAnalysisRunForTask(projectId, taskId);
  }

  taskRuntimeSnapshot(projectId, taskId) {
    return this.analyticsService.taskRuntimeSnapshot(projectId, taskId);
  }

  taskCompletionStatus(project, task, runtime) {
    return this.analyticsService.taskCompletionStatus(project, task, runtime);
  }

  decorateTaskRuntime(project, task) {
    return this.analyticsService.decorateTaskRuntime(project, task);
  }

  decorateProjectRuntime(project) {
    return this.analyticsService.decorateProjectRuntime(project);
  }

  activeRunUsage(run) {
    return this.analyticsService.activeRunUsage(run);
  }

  updateActiveRunFromEvent(run, event) {
    if (!run || !event || typeof event !== "object") return;
    run.lastActiveAtMs = Date.now();
    const metadata = event.metadata && typeof event.metadata === "object" ? event.metadata : {};
    const usage = usageFromMetadata(metadata);
    if (usage.inputTokens) run.inputTokens = usage.inputTokens;
    if (usage.outputTokens) run.outputTokens = usage.outputTokens;
    if (usage.cacheReadTokens) run.cacheReadTokens = usage.cacheReadTokens;
    if (usage.cacheWriteTokens) run.cacheWriteTokens = usage.cacheWriteTokens;
    if (usage.reasoningTokens) run.reasoningTokens = usage.reasoningTokens;
    if (usage.apiCalls) run.apiCalls = usage.apiCalls;
    if (usage.estimatedCostUsd) run.estimatedCostUsd = usage.estimatedCostUsd;

    if (event.type === "assistant_delta" && event.content) {
      run.assistantDeltaText = `${run.assistantDeltaText || ""}${event.content}`;
      run.outputEstimateTokens = estimateContextTokens(run.assistantDeltaText);
    } else if (event.type === "assistant_message" && event.content) {
      run.outputEstimateTokens = estimateContextTokens(event.content);
    } else if (event.type === "run_stage") {
      run.currentStage = {
        stage: event.stage || "",
        label: event.label || "",
        status: event.status || "",
        source: event.source || "hermes",
        timestamp: event.timestamp || event.metadata?.timestamp || isoNow(),
        details: event.details || "",
      };
    }
  }

  usageForMessages(messages, activeRun = null) {
    return this.analyticsService.usageForMessages(messages, activeRun);
  }

  toolCountForMessages(messages) {
    return this.analyticsService.toolCountForMessages(messages);
  }

  latestContent(messages, roles) {
    return this.analyticsService.latestContent(messages, roles);
  }

  sessionRecordForTask(project, task) {
    return this.analyticsService.sessionRecordForTask(project, task);
  }

  desktopSessionRecords() {
    return this.analyticsService.desktopSessionRecords();
  }

  getSessions(limit = 20, offset = 0) {
    return this.analyticsService.getSessions(limit, offset);
  }

  dashboardMessageFromTaskMessage(message) {
    return this.analyticsService.dashboardMessageFromTaskMessage(message);
  }

  getSessionMessages(sessionId) {
    return this.analyticsService.getSessionMessages(sessionId);
  }

  getUsageAnalytics(days = 7) {
    return this.analyticsService.getUsageAnalytics(days);
  }

}

function installRuntimeDelegateMethods(target) {
  for (const name of Object.getOwnPropertyNames(RuntimeDelegateMethods.prototype)) {
    if (name === "constructor") continue;
    Object.defineProperty(target.prototype, name, Object.getOwnPropertyDescriptor(RuntimeDelegateMethods.prototype, name));
  }
}

module.exports = { installRuntimeDelegateMethods };
