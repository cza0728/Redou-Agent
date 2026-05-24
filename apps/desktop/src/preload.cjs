const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("redouDesktop", {
  pickDirectory: () => ipcRenderer.invoke("redou:pick-directory"),
  pickFiles: () => ipcRenderer.invoke("redou:pick-files"),
  getFilePath: (file) => webUtils.getPathForFile(file),
  openLocalPath: (targetPath) => ipcRenderer.invoke("redou:paths:open", targetPath),
  updateApp: () => ipcRenderer.invoke("redou:app:update"),
  getStatus: () => ipcRenderer.invoke("redou:status"),
  getConfig: () => ipcRenderer.invoke("redou:config:get"),
  getConfigDefaults: () => ipcRenderer.invoke("redou:config:defaults"),
  getConfigSchema: () => ipcRenderer.invoke("redou:config:schema"),
  saveConfig: (config) => ipcRenderer.invoke("redou:config:save", config),
  getConfigRaw: () => ipcRenderer.invoke("redou:config:raw:get"),
  saveConfigRaw: (yamlText) => ipcRenderer.invoke("redou:config:raw:save", yamlText),
  getSkills: () => ipcRenderer.invoke("redou:skills:list"),
  toggleSkill: (name, enabled, scope) =>
    ipcRenderer.invoke("redou:skills:toggle", name, enabled, scope),
  deleteSkill: (skill) => ipcRenderer.invoke("redou:skills:delete", skill),
  mergeSkills: (skills) => ipcRenderer.invoke("redou:skills:merge", skills),
  getToolsets: () => ipcRenderer.invoke("redou:toolsets:list"),
  getModelInfo: () => ipcRenderer.invoke("redou:model-info"),
  getModelSetupCatalog: () => ipcRenderer.invoke("redou:model-setup-catalog"),
  getModelOptions: () => ipcRenderer.invoke("redou:model-options"),
  getAuxiliaryModels: () => ipcRenderer.invoke("redou:model-auxiliary"),
  setModelAssignment: (body) => ipcRenderer.invoke("redou:model-set", body),
  refreshModelSetupModels: (body) => ipcRenderer.invoke("redou:model-setup-refresh", body),
  setupMainModel: (body) => ipcRenderer.invoke("redou:model-setup", body),
  getAnalytics: (days) => ipcRenderer.invoke("redou:analytics:usage", days),
  getModelsAnalytics: (days) => ipcRenderer.invoke("redou:analytics:models", days),
  getLogs: (params) => ipcRenderer.invoke("redou:logs", params),
  getCronJobs: () => ipcRenderer.invoke("redou:cron:list"),
  createCronJob: (job) => ipcRenderer.invoke("redou:cron:create", job),
  pauseCronJob: (id) => ipcRenderer.invoke("redou:cron:pause", id),
  resumeCronJob: (id) => ipcRenderer.invoke("redou:cron:resume", id),
  triggerCronJob: (id) => ipcRenderer.invoke("redou:cron:trigger", id),
  deleteCronJob: (id) => ipcRenderer.invoke("redou:cron:delete", id),
  getThemes: () => ipcRenderer.invoke("redou:theme:list"),
  setTheme: (name) => ipcRenderer.invoke("redou:theme:set", name),
  getLanguage: () => ipcRenderer.invoke("redou:language:get"),
  setLanguage: (language) => ipcRenderer.invoke("redou:language:set", language),
  getPlugins: () => ipcRenderer.invoke("redou:plugins:manifests"),
  rescanPlugins: () => ipcRenderer.invoke("redou:plugins:rescan"),
  getPluginsHub: () => ipcRenderer.invoke("redou:plugins:hub"),
  getMcpHub: () => ipcRenderer.invoke("redou:mcp:hub"),
  installMcpServer: (body) => ipcRenderer.invoke("redou:mcp:install", body),
  removeMcpServer: (name) => ipcRenderer.invoke("redou:mcp:remove", name),
  testMcpServer: (name) => ipcRenderer.invoke("redou:mcp:test", name),
  installAgentPlugin: (body) => ipcRenderer.invoke("redou:plugins:install", body),
  enableAgentPlugin: (name) => ipcRenderer.invoke("redou:plugins:enable", name),
  disableAgentPlugin: (name) => ipcRenderer.invoke("redou:plugins:disable", name),
  updateAgentPlugin: (name) => ipcRenderer.invoke("redou:plugins:update", name),
  removeAgentPlugin: (name) => ipcRenderer.invoke("redou:plugins:remove", name),
  savePluginProviders: (body) => ipcRenderer.invoke("redou:plugins:providers:save", body),
  setPluginVisibility: (name, hidden) =>
    ipcRenderer.invoke("redou:plugins:visibility", name, hidden),
  getAnalysisBenchmarks: () => ipcRenderer.invoke("redou:analysis:benchmarks"),
  startAnalysisBenchmarks: (body) => ipcRenderer.invoke("redou:analysis:start", body),
  getChatProjects: () => ipcRenderer.invoke("redou:projects:list"),
  createChatProject: (body) => ipcRenderer.invoke("redou:projects:create", body),
  updateChatProject: (projectId, body) =>
    ipcRenderer.invoke("redou:projects:update", projectId, body),
  deleteChatProject: (projectId) => ipcRenderer.invoke("redou:projects:delete", projectId),
  setActiveChatProject: (projectId) =>
    ipcRenderer.invoke("redou:projects:select", projectId),
  createChatTask: (projectId, body) =>
    ipcRenderer.invoke("redou:tasks:create", projectId, body),
  updateChatTask: (projectId, taskId, body) =>
    ipcRenderer.invoke("redou:tasks:update", projectId, taskId, body),
  deleteChatTask: (projectId, taskId) =>
    ipcRenderer.invoke("redou:tasks:delete", projectId, taskId),
  setActiveChatTask: (projectId, taskId) =>
    ipcRenderer.invoke("redou:tasks:select", projectId, taskId),
  getChatTaskMessages: (projectId, taskId) =>
    ipcRenderer.invoke("redou:tasks:messages", projectId, taskId),
  packageTaskSkill: (projectId, taskId) =>
    ipcRenderer.invoke("redou:tasks:package-skill", projectId, taskId),
  extractTaskRules: (projectId, taskId, target) =>
    ipcRenderer.invoke("redou:tasks:extract-rules", projectId, taskId, target),
  getSessions: (limit, offset) =>
    ipcRenderer.invoke("redou:sessions:list", limit, offset),
  getSessionMessages: (sessionId) =>
    ipcRenderer.invoke("redou:sessions:messages", sessionId),
  copyTaskAttachments: (projectId, taskId, filePaths) =>
    ipcRenderer.invoke("redou:tasks:attachments:copy", projectId, taskId, filePaths),
  pasteClipboardImageAttachment: (projectId, taskId) =>
    ipcRenderer.invoke("redou:tasks:attachments:paste-clipboard-image", projectId, taskId),
  getGlobalContextFile: (kind) =>
    ipcRenderer.invoke("redou:context:global:get", kind),
  updateGlobalContextFile: (kind, content) =>
    ipcRenderer.invoke("redou:context:global:update", kind, content),
  getProjectContextFile: (projectId, kind) =>
    ipcRenderer.invoke("redou:context:project:get", projectId, kind),
  updateProjectContextFile: (projectId, kind, content) =>
    ipcRenderer.invoke("redou:context:project:update", projectId, kind, content),
  getTaskContextFile: (projectId, taskId, kind) =>
    ipcRenderer.invoke("redou:context:task:get", projectId, taskId, kind),
  updateTaskContextFile: (projectId, taskId, kind, content) =>
    ipcRenderer.invoke("redou:context:task:update", projectId, taskId, kind, content),
  buildTaskContext: (input) => ipcRenderer.invoke("redou:context:task:build", input),
  sendMessage: (input) => ipcRenderer.invoke("redou:chat:send", input),
  updateQueuedMessage: (input) => ipcRenderer.invoke("redou:chat:queue:update", input),
  resolveRiskApproval: (input) => ipcRenderer.invoke("redou:chat:risk-approval", input),
  stopRun: (runId) => ipcRenderer.invoke("redou:chat:stop", runId),
  stopTaskRun: (projectId, taskId) => ipcRenderer.invoke("redou:chat:stop-task", projectId, taskId),
  onAgentEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("redou:agent-event", listener);
    return () => ipcRenderer.removeListener("redou:agent-event", listener);
  },
  onAnalysisEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("redou:analysis-event", listener);
    return () => ipcRenderer.removeListener("redou:analysis-event", listener);
  },
});
