export const MODEL_OPTIONS_CHANGED_EVENT = "redou:model-options-changed";
export const CHAT_PROJECTS_CHANGED_EVENT = "redou:chat-projects-changed";

import type { DashboardTheme } from "@/themes/types";

export function notifyModelOptionsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(MODEL_OPTIONS_CHANGED_EVENT));
}

export function notifyChatProjectsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CHAT_PROJECTS_CHANGED_EVENT));
}

// Redou Desktop renderer bridge exposed by apps/desktop/src/preload.cjs.
declare global {
  interface Window {
    redouDesktop?: {
      pickDirectory?: () => Promise<string | null>;
      pickFiles?: () => Promise<string[]>;
      getFilePath?: (file: File) => string;
      openLocalPath?: (
        targetPath: string,
      ) => Promise<{ ok: boolean; path?: string; message?: string }>;
      updateApp?: () => Promise<ActionResponse>;
      getStatus?: () => Promise<StatusResponse>;
      getConfig?: () => Promise<Record<string, unknown>>;
      getConfigDefaults?: () => Promise<Record<string, unknown>>;
      getConfigSchema?: () => Promise<{ fields: Record<string, unknown>; category_order: string[] }>;
      saveConfig?: (config: Record<string, unknown>) => Promise<{ ok: boolean }>;
      getConfigRaw?: () => Promise<{ yaml: string }>;
      saveConfigRaw?: (yamlText: string) => Promise<{ ok: boolean }>;
      getSkills?: () => Promise<SkillInfo[]>;
      toggleSkill?: (
        name: string,
        enabled: boolean,
        scope?: SkillToggleScope,
      ) => Promise<{ ok: boolean }>;
      deleteSkill?: (skill: SkillDeleteInput) => Promise<SkillDeleteResponse>;
      mergeSkills?: (skills: SkillMergeInput[]) => Promise<SkillMergeResponse>;
      getToolsets?: () => Promise<ToolsetInfo[]>;
      getModelInfo?: () => Promise<ModelInfoResponse>;
      getModelSetupCatalog?: () => Promise<ModelSetupCatalogResponse>;
      getModelOptions?: () => Promise<ModelOptionsResponse>;
      getAuxiliaryModels?: () => Promise<AuxiliaryModelsResponse>;
      setModelAssignment?: (body: ModelAssignmentRequest) => Promise<ModelAssignmentResponse>;
      refreshModelSetupModels?: (body: ModelSetupRefreshRequest) => Promise<ModelSetupRefreshResponse>;
      setupMainModel?: (body: ModelSetupRequest) => Promise<ModelSetupResponse>;
      getModelsAnalytics?: (days: number) => Promise<ModelsAnalyticsResponse>;
      getAnalysisBenchmarks?: () => Promise<AnalysisBenchmarksResponse>;
      startAnalysisBenchmarks?: (
        body: AnalysisBenchmarkStartRequest,
      ) => Promise<AnalysisBenchmarkStartResponse>;
      getAnalytics?: (days: number) => Promise<AnalyticsResponse>;
      getChatProjects?: () => Promise<ChatProjectsResponse>;
      getLogs?: (
        params: { file?: string; lines?: number; level?: string; component?: string },
      ) => Promise<LogsResponse>;
      getCronJobs?: () => Promise<CronJob[]>;
      createCronJob?: (
        job: { prompt: string; schedule: string; name?: string; deliver?: string },
      ) => Promise<CronJob>;
      pauseCronJob?: (id: string) => Promise<CronJob>;
      resumeCronJob?: (id: string) => Promise<CronJob>;
      triggerCronJob?: (id: string) => Promise<CronJob>;
      deleteCronJob?: (id: string) => Promise<{ ok: boolean }>;
      getThemes?: () => Promise<DashboardThemesResponse>;
      setTheme?: (name: string) => Promise<{ ok: boolean; theme: string }>;
      getLanguage?: () => Promise<{ language?: string }>;
      setLanguage?: (language: string) => Promise<{ ok: boolean; language: string }>;
      getPlugins?: () => Promise<PluginManifestResponse[]>;
      rescanPlugins?: () => Promise<{ ok: boolean; count: number }>;
      getPluginsHub?: () => Promise<PluginsHubResponse>;
      getMcpHub?: () => Promise<McpHubResponse>;
      installMcpServer?: (
        body: McpInstallRequest,
      ) => Promise<McpInstallResponse>;
      removeMcpServer?: (name: string) => Promise<{ ok: boolean; name: string }>;
      testMcpServer?: (name: string) => Promise<McpTestResponse>;
      installAgentPlugin?: (
        body: AgentPluginInstallRequest,
      ) => Promise<AgentPluginInstallResponse>;
      enableAgentPlugin?: (
        name: string,
      ) => Promise<{ ok: boolean; name: string; unchanged?: boolean }>;
      disableAgentPlugin?: (
        name: string,
      ) => Promise<{ ok: boolean; name: string; unchanged?: boolean }>;
      updateAgentPlugin?: (name: string) => Promise<AgentPluginUpdateResponse>;
      removeAgentPlugin?: (name: string) => Promise<{ ok: boolean; name: string }>;
      savePluginProviders?: (body: PluginProvidersPutRequest) => Promise<{ ok: boolean }>;
      setPluginVisibility?: (
        name: string,
        hidden: boolean,
      ) => Promise<{ ok: boolean; name: string; hidden: boolean }>;
      createChatProject?: (body: ChatProjectCreateRequest) => Promise<ChatProjectMutationResponse>;
      updateChatProject?: (
        projectId: string,
        body: ChatProjectUpdateRequest,
      ) => Promise<ChatProjectMutationResponse>;
      deleteChatProject?: (
        projectId: string,
      ) => Promise<ChatProjectDeleteResponse>;
      setActiveChatProject?: (
        projectId: string,
      ) => Promise<ChatProjectSelectionResponse>;
      createChatTask?: (
        projectId: string,
        body: ChatTaskCreateRequest,
      ) => Promise<ChatTaskMutationResponse>;
      updateChatTask?: (
        projectId: string,
        taskId: string,
        body: ChatTaskUpdateRequest,
      ) => Promise<ChatTaskMutationResponse>;
      deleteChatTask?: (
        projectId: string,
        taskId: string,
      ) => Promise<ChatTaskDeleteResponse>;
      setActiveChatTask?: (
        projectId: string,
        taskId: string,
      ) => Promise<ChatTaskMutationResponse>;
      getChatTaskMessages?: (
        projectId: string,
        taskId: string,
      ) => Promise<ChatTaskMessagesResponse>;
      packageTaskSkill?: (
        projectId: string,
        taskId: string,
      ) => Promise<PackageTaskSkillResponse>;
      extractTaskRules?: (
        projectId: string,
        taskId: string,
        target: RuleExtractionTarget,
      ) => Promise<ExtractTaskRulesResponse>;
      getSessions?: (
        limit?: number,
        offset?: number,
      ) => Promise<PaginatedSessions>;
      getSessionMessages?: (
        sessionId: string,
      ) => Promise<SessionMessagesResponse>;
      copyTaskAttachments?: (
        projectId: string,
        taskId: string,
        filePaths: string[],
      ) => Promise<CopyTaskAttachmentsResponse>;
      pasteClipboardImageAttachment?: (
        projectId: string,
        taskId: string,
      ) => Promise<CopyTaskAttachmentsResponse>;
      getGlobalContextFile?: (
        kind: GlobalContextFileKind,
      ) => Promise<ContextFileResponse>;
      updateGlobalContextFile?: (
        kind: GlobalContextFileKind,
        content: string,
      ) => Promise<ContextFileUpdateResponse>;
      getProjectContextFile?: (
        projectId: string,
        kind: ProjectContextFileKind,
      ) => Promise<ContextFileResponse>;
      updateProjectContextFile?: (
        projectId: string,
        kind: ProjectContextFileKind,
        content: string,
      ) => Promise<ContextFileUpdateResponse>;
      getTaskContextFile?: (
        projectId: string,
        taskId: string,
        kind: TaskContextFileKind,
      ) => Promise<ContextFileResponse>;
      updateTaskContextFile?: (
        projectId: string,
        taskId: string,
        kind: TaskContextFileKind,
        content: string,
      ) => Promise<ContextFileUpdateResponse>;
      buildTaskContext?: (input: BuildContextInput) => Promise<BuiltContext>;
      sendMessage?: (input: SendMessageInput) => Promise<SendMessageResponse>;
      updateQueuedMessage?: (input: QueuedMessageUpdateInput) => Promise<QueuedMessageUpdateResponse>;
      resolveRiskApproval?: (input: ResolveRiskApprovalInput) => Promise<ResolveRiskApprovalResponse>;
      stopRun?: (runId: string) => Promise<{ ok: boolean; message?: string }>;
      stopTaskRun?: (projectId: string, taskId: string) => Promise<{ ok: boolean; message?: string }>;
      onAgentEvent?: (
        callback: (payload: AgentEventEnvelope) => void,
      ) => () => void;
      onAnalysisEvent?: (
        callback: (payload: AnalysisBenchmarkEvent) => void,
      ) => () => void;
    };
  }
}
function requireRedouDesktopApi() {
  const desktop = window.redouDesktop;
  if (!desktop) {
    throw new Error("Redou Desktop IPC API is unavailable. The renderer must run inside Electron with preload.cjs loaded.");
  }
  return desktop;
}

function requireRedouMethod<K extends keyof NonNullable<Window["redouDesktop"]>>(
  name: K,
): NonNullable<NonNullable<Window["redouDesktop"]>[K]> {
  const method = requireRedouDesktopApi()[name];
  if (typeof method !== "function") {
    throw new Error(`Redou desktop IPC method is unavailable: ${String(name)}`);
  }
  return method as NonNullable<NonNullable<Window["redouDesktop"]>[K]>;
}

export async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  void init;
  throw new Error(
    `Legacy dashboard HTTP fetch is disabled in Redou Desktop (${url}). ` +
      "Use redouApi/window.redouDesktop IPC instead.",
  );
}

function unsupportedDesktopFeature<T = never>(feature: string, todo: string): Promise<T> {
  return Promise.reject(
    new Error(`${feature} is not wired for Redou Desktop yet. TODO: ${todo}`),
  );
}

const redouApiCore = {
  status: {
    getStatus: () => requireRedouMethod("getStatus")(),
  },
  sessions: {
    list: (limit = 20, offset = 0) => requireRedouMethod("getSessions")(limit, offset),
    messages: (id: string) => requireRedouMethod("getSessionMessages")(id),
  },
  tasks: {
    getChatProjects: () => requireRedouMethod("getChatProjects")(),
    createChatProject: (body: ChatProjectCreateRequest) =>
      requireRedouMethod("createChatProject")(body),
    updateChatProject: (projectId: string, body: ChatProjectUpdateRequest) =>
      requireRedouMethod("updateChatProject")(projectId, body),
    deleteChatProject: (projectId: string) =>
      requireRedouMethod("deleteChatProject")(projectId),
    setActiveChatProject: (projectId: string) =>
      requireRedouMethod("setActiveChatProject")(projectId),
    createChatTask: (projectId: string, body: ChatTaskCreateRequest) =>
      requireRedouMethod("createChatTask")(projectId, body),
    updateChatTask: (projectId: string, taskId: string, body: ChatTaskUpdateRequest) =>
      requireRedouMethod("updateChatTask")(projectId, taskId, body),
    deleteChatTask: (projectId: string, taskId: string) =>
      requireRedouMethod("deleteChatTask")(projectId, taskId),
    setActiveChatTask: (projectId: string, taskId: string) =>
      requireRedouMethod("setActiveChatTask")(projectId, taskId),
    getChatTaskMessages: (projectId: string, taskId: string) =>
      requireRedouMethod("getChatTaskMessages")(projectId, taskId),
    packageTaskSkill: (projectId: string, taskId: string) =>
      requireRedouMethod("packageTaskSkill")(projectId, taskId),
    extractTaskRules: (projectId: string, taskId: string, target: RuleExtractionTarget) =>
      requireRedouMethod("extractTaskRules")(projectId, taskId, target),
    copyTaskAttachments: (projectId: string, taskId: string, filePaths: string[]) =>
      requireRedouMethod("copyTaskAttachments")(projectId, taskId, filePaths),
    pasteClipboardImageAttachment: (projectId: string, taskId: string) =>
      requireRedouMethod("pasteClipboardImageAttachment")(projectId, taskId),
    buildTaskContext: (input: BuildContextInput) =>
      requireRedouMethod("buildTaskContext")(input),
    sendChatMessage: (input: SendMessageInput) =>
      requireRedouMethod("sendMessage")(input),
    updateQueuedChatMessage: (input: QueuedMessageUpdateInput) =>
      requireRedouMethod("updateQueuedMessage")(input),
    resolveRiskApproval: (input: ResolveRiskApprovalInput) =>
      requireRedouMethod("resolveRiskApproval")(input),
    stopChatRun: (runId: string) => requireRedouMethod("stopRun")(runId),
    stopChatTask: (projectId: string, taskId: string) =>
      requireRedouMethod("stopTaskRun")(projectId, taskId),
    onAgentEvent: (callback: (payload: AgentEventEnvelope) => void) =>
      requireRedouMethod("onAgentEvent")(callback),
  },
  context: {
    openLocalPath: (targetPath: string) => requireRedouMethod("openLocalPath")(targetPath),
    getGlobalContextFile: (kind: GlobalContextFileKind) =>
      requireRedouMethod("getGlobalContextFile")(kind),
    updateGlobalContextFile: (kind: GlobalContextFileKind, content: string) =>
      requireRedouMethod("updateGlobalContextFile")(kind, content),
    getProjectContextFile: (projectId: string, kind: ProjectContextFileKind) =>
      requireRedouMethod("getProjectContextFile")(projectId, kind),
    updateProjectContextFile: (projectId: string, kind: ProjectContextFileKind, content: string) =>
      requireRedouMethod("updateProjectContextFile")(projectId, kind, content),
    getTaskContextFile: (projectId: string, taskId: string, kind: TaskContextFileKind) =>
      requireRedouMethod("getTaskContextFile")(projectId, taskId, kind),
    updateTaskContextFile: (
      projectId: string,
      taskId: string,
      kind: TaskContextFileKind,
      content: string,
    ) => requireRedouMethod("updateTaskContextFile")(projectId, taskId, kind, content),
  },
  logs: {
    getLogs: (params: { file?: string; lines?: number; level?: string; component?: string }) =>
      requireRedouMethod("getLogs")(params),
  },
  analytics: {
    getAnalytics: (days: number) => requireRedouMethod("getAnalytics")(days),
    getModelsAnalytics: (days: number) => requireRedouMethod("getModelsAnalytics")(days),
    getAnalysisBenchmarks: () => requireRedouMethod("getAnalysisBenchmarks")(),
    startAnalysisBenchmarks: (body: AnalysisBenchmarkStartRequest) =>
      requireRedouMethod("startAnalysisBenchmarks")(body),
    onAnalysisEvent: (callback: (payload: AnalysisBenchmarkEvent) => void) =>
      requireRedouMethod("onAnalysisEvent")(callback),
  },
  settings: {
    getConfig: () => requireRedouMethod("getConfig")(),
    getDefaults: () => requireRedouMethod("getConfigDefaults")(),
    getSchema: () => requireRedouMethod("getConfigSchema")(),
    saveConfig: (config: Record<string, unknown>) => requireRedouMethod("saveConfig")(config),
    getConfigRaw: () => requireRedouMethod("getConfigRaw")(),
    saveConfigRaw: (yamlText: string) => requireRedouMethod("saveConfigRaw")(yamlText),
    getLanguage: () => requireRedouMethod("getLanguage")(),
    setLanguage: (language: string) => requireRedouMethod("setLanguage")(language),
  },
  theme: {
    getThemes: () => requireRedouMethod("getThemes")(),
    setTheme: (name: string) => requireRedouMethod("setTheme")(name),
  },
  models: {
    getModelInfo: () => requireRedouMethod("getModelInfo")(),
    getModelOptions: () => requireRedouMethod("getModelOptions")(),
    getModelSetupCatalog: () => requireRedouMethod("getModelSetupCatalog")(),
    getAuxiliaryModels: () => requireRedouMethod("getAuxiliaryModels")(),
    setupMainModel: (body: ModelSetupRequest) => requireRedouMethod("setupMainModel")(body),
    refreshModelSetupModels: (body: ModelSetupRefreshRequest) =>
      requireRedouMethod("refreshModelSetupModels")(body),
    setModelAssignment: (body: ModelAssignmentRequest) =>
      requireRedouMethod("setModelAssignment")(body),
  },
  cron: {
    getCronJobs: () => requireRedouMethod("getCronJobs")(),
    createCronJob: (job: { prompt: string; schedule: string; name?: string; deliver?: string }) =>
      requireRedouMethod("createCronJob")(job),
    pauseCronJob: (id: string) => requireRedouMethod("pauseCronJob")(id),
    resumeCronJob: (id: string) => requireRedouMethod("resumeCronJob")(id),
    triggerCronJob: (id: string) => requireRedouMethod("triggerCronJob")(id),
    deleteCronJob: (id: string) => requireRedouMethod("deleteCronJob")(id),
  },
  skills: {
    getSkills: () => requireRedouMethod("getSkills")(),
    toggleSkill: (name: string, enabled: boolean, scope?: SkillToggleScope) =>
      requireRedouMethod("toggleSkill")(name, enabled, scope),
    deleteSkill: (skill: SkillDeleteInput) => requireRedouMethod("deleteSkill")(skill),
    mergeSkills: (skills: SkillMergeInput[]) => requireRedouMethod("mergeSkills")(skills),
    getToolsets: () => requireRedouMethod("getToolsets")(),
  },
  plugins: {
    getPlugins: () => requireRedouMethod("getPlugins")(),
    rescanPlugins: () => requireRedouMethod("rescanPlugins")(),
    getPluginsHub: () => requireRedouMethod("getPluginsHub")(),
    getMcpHub: () => requireRedouMethod("getMcpHub")(),
    installMcpServer: (body: McpInstallRequest) =>
      requireRedouMethod("installMcpServer")(body),
    removeMcpServer: (name: string) => requireRedouMethod("removeMcpServer")(name),
    testMcpServer: (name: string) => requireRedouMethod("testMcpServer")(name),
    installAgentPlugin: (body: AgentPluginInstallRequest) =>
      requireRedouMethod("installAgentPlugin")(body),
    enableAgentPlugin: (name: string) => requireRedouMethod("enableAgentPlugin")(name),
    disableAgentPlugin: (name: string) => requireRedouMethod("disableAgentPlugin")(name),
    updateAgentPlugin: (name: string) => requireRedouMethod("updateAgentPlugin")(name),
    removeAgentPlugin: (name: string) => requireRedouMethod("removeAgentPlugin")(name),
    savePluginProviders: (body: PluginProvidersPutRequest) =>
      requireRedouMethod("savePluginProviders")(body),
    setPluginVisibility: (name: string, hidden: boolean) =>
      requireRedouMethod("setPluginVisibility")(name, hidden),
  },
  oauth: {
    getOAuthProviders: () =>
      unsupportedDesktopFeature<OAuthProvidersResponse>(
        "OAuth provider management",
        "use the system browser plus localhost/custom-protocol callback and store tokens in the OS keychain",
      ),
    disconnectOAuthProvider: (_providerId: string) => {
      void _providerId;
      return unsupportedDesktopFeature<{ ok: boolean }>(
        "OAuth disconnect",
        "add a desktop auth bridge that updates Hermes auth storage without web_server.py",
      );
    },
    startOAuthLogin: (_providerId: string) => {
      void _providerId;
      return unsupportedDesktopFeature<OAuthStartResponse>(
        "OAuth login",
        "use system browser plus localhost/custom-protocol callback and OS keychain persistence",
      );
    },
    submitOAuthCode: (_providerId: string, _sessionId: string, _code: string) => {
      void _providerId;
      void _sessionId;
      void _code;
      return unsupportedDesktopFeature<OAuthSubmitResponse>(
        "OAuth code submit",
        "replace dashboard session-token flow with a desktop auth bridge",
      );
    },
    pollOAuthSession: (_providerId: string, _sessionId: string) => {
      void _providerId;
      void _sessionId;
      return unsupportedDesktopFeature<OAuthPollResponse>(
        "OAuth polling",
        "replace dashboard polling with desktop-owned callback state",
      );
    },
    cancelOAuthSession: (_sessionId: string) => {
      void _sessionId;
      return unsupportedDesktopFeature<{ ok: boolean }>(
        "OAuth session cancellation",
        "replace dashboard session storage with desktop-owned auth state",
      );
    },
  },
  system: {
    restartGateway: () =>
      unsupportedDesktopFeature<ActionResponse>(
        "Gateway restart",
        "wire an explicit Electron main-process action if Redou Desktop needs gateway control",
      ),
    updateHermes: () =>
      requireRedouMethod("updateApp")(),
    getActionStatus: (_name: string, _lines = 200) => {
      void _lines;
      return unsupportedDesktopFeature<ActionStatusResponse>(
        "Legacy action status",
        "track desktop-owned background actions in Electron main if needed",
      );
    },
  },
} as const;

export const redouApi = {
  ...redouApiCore,
  getStatus: redouApiCore.status.getStatus,
  getSessions: redouApiCore.sessions.list,
  getSessionMessages: redouApiCore.sessions.messages,
  getChatProjects: redouApiCore.tasks.getChatProjects,
  createChatProject: redouApiCore.tasks.createChatProject,
  updateChatProject: redouApiCore.tasks.updateChatProject,
  deleteChatProject: redouApiCore.tasks.deleteChatProject,
  setActiveChatProject: redouApiCore.tasks.setActiveChatProject,
  createChatTask: redouApiCore.tasks.createChatTask,
  updateChatTask: redouApiCore.tasks.updateChatTask,
  deleteChatTask: redouApiCore.tasks.deleteChatTask,
  setActiveChatTask: redouApiCore.tasks.setActiveChatTask,
  getChatTaskMessages: redouApiCore.tasks.getChatTaskMessages,
  packageTaskSkill: redouApiCore.tasks.packageTaskSkill,
  extractTaskRules: redouApiCore.tasks.extractTaskRules,
  copyTaskAttachments: redouApiCore.tasks.copyTaskAttachments,
  pasteClipboardImageAttachment: redouApiCore.tasks.pasteClipboardImageAttachment,
  buildTaskContext: redouApiCore.tasks.buildTaskContext,
  sendChatMessage: redouApiCore.tasks.sendChatMessage,
  updateQueuedChatMessage: redouApiCore.tasks.updateQueuedChatMessage,
  resolveRiskApproval: redouApiCore.tasks.resolveRiskApproval,
  stopChatRun: redouApiCore.tasks.stopChatRun,
  stopChatTask: redouApiCore.tasks.stopChatTask,
  onAgentEvent: redouApiCore.tasks.onAgentEvent,
  openLocalPath: redouApiCore.context.openLocalPath,
  getGlobalContextFile: redouApiCore.context.getGlobalContextFile,
  updateGlobalContextFile: redouApiCore.context.updateGlobalContextFile,
  getProjectContextFile: redouApiCore.context.getProjectContextFile,
  updateProjectContextFile: redouApiCore.context.updateProjectContextFile,
  getTaskContextFile: redouApiCore.context.getTaskContextFile,
  updateTaskContextFile: redouApiCore.context.updateTaskContextFile,
  getLogs: redouApiCore.logs.getLogs,
  getAnalytics: redouApiCore.analytics.getAnalytics,
  getModelsAnalytics: redouApiCore.analytics.getModelsAnalytics,
  getAnalysisBenchmarks: redouApiCore.analytics.getAnalysisBenchmarks,
  startAnalysisBenchmarks: redouApiCore.analytics.startAnalysisBenchmarks,
  onAnalysisEvent: redouApiCore.analytics.onAnalysisEvent,
  getConfig: redouApiCore.settings.getConfig,
  getDefaults: redouApiCore.settings.getDefaults,
  getSchema: redouApiCore.settings.getSchema,
  saveConfig: redouApiCore.settings.saveConfig,
  getConfigRaw: redouApiCore.settings.getConfigRaw,
  saveConfigRaw: redouApiCore.settings.saveConfigRaw,
  getLanguage: redouApiCore.settings.getLanguage,
  setLanguage: redouApiCore.settings.setLanguage,
  getThemes: redouApiCore.theme.getThemes,
  setTheme: redouApiCore.theme.setTheme,
  getModelInfo: redouApiCore.models.getModelInfo,
  getModelOptions: redouApiCore.models.getModelOptions,
  getModelSetupCatalog: redouApiCore.models.getModelSetupCatalog,
  getAuxiliaryModels: redouApiCore.models.getAuxiliaryModels,
  setupMainModel: redouApiCore.models.setupMainModel,
  refreshModelSetupModels: redouApiCore.models.refreshModelSetupModels,
  setModelAssignment: redouApiCore.models.setModelAssignment,
  getCronJobs: redouApiCore.cron.getCronJobs,
  createCronJob: redouApiCore.cron.createCronJob,
  pauseCronJob: redouApiCore.cron.pauseCronJob,
  resumeCronJob: redouApiCore.cron.resumeCronJob,
  triggerCronJob: redouApiCore.cron.triggerCronJob,
  deleteCronJob: redouApiCore.cron.deleteCronJob,
  getSkills: redouApiCore.skills.getSkills,
  toggleSkill: redouApiCore.skills.toggleSkill,
  deleteSkill: redouApiCore.skills.deleteSkill,
  mergeSkills: redouApiCore.skills.mergeSkills,
  getToolsets: redouApiCore.skills.getToolsets,
  getPlugins: redouApiCore.plugins.getPlugins,
  rescanPlugins: redouApiCore.plugins.rescanPlugins,
  getPluginsHub: redouApiCore.plugins.getPluginsHub,
  getMcpHub: redouApiCore.plugins.getMcpHub,
  installMcpServer: redouApiCore.plugins.installMcpServer,
  removeMcpServer: redouApiCore.plugins.removeMcpServer,
  testMcpServer: redouApiCore.plugins.testMcpServer,
  installAgentPlugin: redouApiCore.plugins.installAgentPlugin,
  enableAgentPlugin: redouApiCore.plugins.enableAgentPlugin,
  disableAgentPlugin: redouApiCore.plugins.disableAgentPlugin,
  updateAgentPlugin: redouApiCore.plugins.updateAgentPlugin,
  removeAgentPlugin: redouApiCore.plugins.removeAgentPlugin,
  savePluginProviders: redouApiCore.plugins.savePluginProviders,
  setPluginVisibility: redouApiCore.plugins.setPluginVisibility,
  getOAuthProviders: redouApiCore.oauth.getOAuthProviders,
  disconnectOAuthProvider: redouApiCore.oauth.disconnectOAuthProvider,
  startOAuthLogin: redouApiCore.oauth.startOAuthLogin,
  submitOAuthCode: redouApiCore.oauth.submitOAuthCode,
  pollOAuthSession: redouApiCore.oauth.pollOAuthSession,
  cancelOAuthSession: redouApiCore.oauth.cancelOAuthSession,
  restartGateway: redouApiCore.system.restartGateway,
  updateHermes: redouApiCore.system.updateHermes,
  getActionStatus: redouApiCore.system.getActionStatus,
} as const;

export const api = redouApi;
export interface ActionResponse {
  message?: string;
  name: string;
  ok: boolean;
  pid: number;
}

export interface ActionStatusResponse {
  exit_code: number | null;
  lines: string[];
  name: string;
  pid: number | null;
  running: boolean;
}

export interface PlatformStatus {
  error_code?: string;
  error_message?: string;
  state: string;
  updated_at: string;
}

export interface StatusResponse {
  active_sessions: number;
  config_path: string;
  config_version: number;
  env_path: string;
  gateway_exit_reason: string | null;
  gateway_health_url: string | null;
  gateway_pid: number | null;
  gateway_platforms: Record<string, PlatformStatus>;
  gateway_running: boolean;
  gateway_state: string | null;
  gateway_updated_at: string | null;
  hermes_home: string;
  latest_config_version: number;
  release_date: string;
  version: string;
}

export interface SessionInfo {
  id: string;
  source: string | null;
  model: string | null;
  title: string | null;
  started_at: number;
  ended_at: number | null;
  last_active: number;
  is_active: boolean;
  message_count: number;
  tool_call_count: number;
  input_tokens: number;
  output_tokens: number;
  preview: string | null;
  parent_session_id?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  queue_depth?: number;
  last_event_type?: string | null;
  run_started_at?: number | null;
  api_calls?: number;
}

export interface ChatTask {
  id: string;
  projectId: string;
  title: string;
  path?: string;
  kind?: string;
  analysisKey?: string;
  analysisRunId?: string;
  analysisProvider?: string;
  analysisModel?: string;
  session_id: string | null;
  hermesSessionId: string | null;
  model_provider: string;
  model: string;
  appDataPath: string;
  rulesPath: string;
  contextPath: string;
  messagesPath: string;
  uploadsPath?: string;
  createdAt?: string;
  updatedAt?: string;
  created_at: number;
  updated_at: number;
  is_active?: boolean;
  active_run_id?: string | null;
  queue_depth?: number;
  run_started_at?: number | null;
  last_active?: number | null;
  current_stage?: unknown;
  runtime_status?: "idle" | "queued" | "running" | "completed" | "failed" | "interrupted" | string;
}

export interface ChatProject {
  id: string;
  name: string;
  path: string;
  workspace_path: string;
  hermesProfile: string;
  hermesProfileWarning?: string;
  appDataPath: string;
  rulesPath: string;
  createdAt?: string;
  updatedAt?: string;
  created_at: number;
  updated_at: number;
  tasks: ChatTask[];
}

export interface ChatProjectsResponse {
  version: number;
  current_project_id: string;
  current_task_id: string;
  projects: ChatProject[];
}

export interface ChatProjectCreateRequest {
  name: string;
  workspace_path?: string | null;
}

export interface ChatProjectUpdateRequest {
  name?: string;
  workspace_path?: string | null;
}

export interface ChatTaskCreateRequest {
  title: string;
  model_provider?: string | null;
  model?: string | null;
}

export interface ChatTaskUpdateRequest {
  title?: string;
  session_id?: string | null;
  hermesSessionId?: string | null;
  model_provider?: string | null;
  model?: string | null;
}

export type ProjectContextFileKind = "rules";
export type TaskContextFileKind = "rules" | "context";
export type GlobalContextFileKind = "user" | "rules";

export interface ContextFileResponse {
  kind: string;
  path: string;
  content: string;
}

export interface ContextFileUpdateResponse extends ContextFileResponse {
  ok: boolean;
}

export interface ChatProjectMutationResponse {
  ok: boolean;
  project: ChatProject;
}

export interface ChatTaskMutationResponse {
  ok: boolean;
  project: ChatProject;
  task: ChatTask;
}

export interface ChatProjectSelectionResponse {
  ok: boolean;
  project: ChatProject;
  task: ChatTask | null;
}

export interface RelatedPackagedSkill {
  name: string;
  description?: string;
  projectId?: string;
  taskId?: string;
  taskTitle?: string;
  skillPath: string;
  similarity: number;
}

export interface PackageTaskSkillResponse {
  ok: boolean;
  project: ChatProject;
  task: ChatTask;
  skillName: string;
  skillCategory: string;
  skillDir: string;
  skillPath: string;
  references: string[];
  relatedSkills: RelatedPackagedSkill[];
  warnings: string[];
}

export type RuleExtractionTarget = "task" | "project";

export interface ExtractTaskRulesResponse {
  ok: boolean;
  project: ChatProject;
  task: ChatTask;
  target: RuleExtractionTarget;
  targetPath: string;
  sourcePath: string;
  extractor: string;
  extractedRules: string[];
  rulesAdded: string[];
  warnings: string[];
}

export interface ChatProjectDeleteResponse {
  ok: boolean;
  deleted_project_id: string;
  deleted_task_ids: string[];
  current_project_id: string;
  current_task_id: string;
  projects: ChatProject[];
}

export interface ChatTaskDeleteResponse {
  ok: boolean;
  project: ChatProject;
  deleted_task_id: string;
  next_task: ChatTask | null;
  current_project_id: string;
  current_task_id: string;
}

export type ChatMessageRole = "user" | "assistant" | "system" | "tool" | "event";

export interface ChatTaskMessage {
  role: ChatMessageRole;
  content: string;
  createdAt: string;
  metadata: Record<string, unknown>;
  attachments: ChatAttachment[];
}

export interface ChatAttachment {
  id: string;
  name: string;
  storedPath?: string;
  relativePath?: string;
  originalPath?: string;
  size?: number;
  mimeType?: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

export interface CopyTaskAttachmentsResponse {
  ok: boolean;
  projectId: string;
  taskId: string;
  uploadsPath: string;
  attachments: ChatAttachment[];
  warnings: string[];
}

export interface ChatTaskMessagesResponse {
  projectId: string;
  taskId: string;
  messagesPath: string;
  hermesSessionId: string;
  messages: ChatTaskMessage[];
  warnings: string[];
  is_active?: boolean;
  active_run_id?: string | null;
  queue_depth?: number;
  run_started_at?: number | null;
  last_active?: number | null;
}

export type RiskApprovalDecision =
  | "allow_once"
  | "allow_session"
  | "allow_always"
  | "deny";

export interface ResolveRiskApprovalInput {
  projectId: string;
  taskId: string;
  runId: string;
  approvalId: string;
  decision: RiskApprovalDecision;
}

export interface ResolveRiskApprovalResponse {
  ok: boolean;
  message?: string;
}

export type AgentEvent =
  | { type: "assistant_message"; content: string; metadata?: Record<string, unknown> }
  | { type: "assistant_delta"; content: string; metadata?: Record<string, unknown> }
  | { type: "command_start"; command: string; cwd?: string; metadata?: Record<string, unknown> }
  | { type: "command_output"; content: string; metadata?: Record<string, unknown> }
  | { type: "command_end"; exitCode?: number; success: boolean; metadata?: Record<string, unknown> }
  | { type: "tool_start"; name: string; input?: unknown; metadata?: Record<string, unknown> }
  | { type: "tool_output"; name: string; output?: unknown; metadata?: Record<string, unknown> }
  | { type: "tool_end"; name: string; success: boolean; metadata?: Record<string, unknown> }
  | { type: "file_changed"; path: string; changeType?: string; summary?: string; metadata?: Record<string, unknown> }
  | { type: "queue_update"; queued: number; message?: string; metadata?: Record<string, unknown> }
  | { type: "run_stage"; stage?: string; label?: string; status?: string; details?: string; metadata?: Record<string, unknown> }
  | {
      type: "risk_approval_required";
      taskId?: string;
      projectId?: string;
      runId?: string;
      approvalId: string;
      command: string;
      cwd?: string;
      reason: string;
      riskLevel?: "low" | "medium" | "high";
      mode?: string;
      allowedDecisions?: RiskApprovalDecision[];
      createdAt?: number;
      expiresAt?: number;
      metadata?: Record<string, unknown>;
    }
  | {
      type:
        | "risk_approval_allowed"
        | "risk_approval_denied"
        | "risk_approval_timeout"
        | "risk_approval_invalid"
        | "risk_approval_decision_submitted"
        | "high_risk_command_blocked"
        | "high_risk_command_auto_allowed";
      taskId?: string;
      projectId?: string;
      runId?: string;
      approvalId?: string;
      command?: string;
      cwd?: string;
      reason?: string;
      riskLevel?: "low" | "medium" | "high";
      decision?: string;
      timeoutSeconds?: number;
      metadata?: Record<string, unknown>;
    }
  | { type: "error"; message: string; details?: string; metadata?: Record<string, unknown> }
  | { type: "done"; metadata?: Record<string, unknown> }
  | { type: "raw_log"; content: string; metadata?: Record<string, unknown> };

export interface AgentEventEnvelope {
  runId: string;
  projectId: string;
  taskId: string;
  event: AgentEvent;
}

export interface BuildContextInput {
  projectId: string;
  taskId: string;
  userInput: string;
  attachments?: ChatAttachment[];
  maxRecentMessages?: number;
  preview?: boolean;
}

export interface BuiltContext {
  systemContext: string;
  userContext: string;
  metadata: {
    projectId: string;
    taskId: string;
    hermesProfile: string;
    includedFiles: string[];
    recentMessageCount: number;
    attachmentCount?: number;
    imageAttachmentCount?: number;
    contextLength: number;
    contextChars?: number;
    contextTokens?: number;
    modelContextTokens?: number;
    contextMaxTokens?: number;
    reservedOutputTokens?: number;
    safetyMarginTokens?: number;
    contextPercent?: number;
    contextCompressed?: boolean;
    contextCompression?: {
      triggered: boolean;
      succeeded?: boolean;
      beforeTokens: number;
      afterTokens: number;
      taskContextBeforeTokens?: number;
      taskContextAfterTokens?: number;
      modelContextTokens?: number;
      inputBudget?: number;
      reservedOutput?: number;
      safetyMargin?: number;
      thresholdRatio?: number;
      emergency?: boolean;
      reason?: string;
      fallbackTrimmed?: boolean;
      compressedSections?: Array<{
        title: string;
        beforeTokens: number;
        afterTokens: number;
      }>;
    };
    projectName?: string;
    taskTitle?: string;
    projectPath?: string;
    projectRulesPath?: string;
    taskRulesPath?: string;
    taskContextPath?: string;
    preview?: boolean;
  };
}

export interface SendMessageInput {
  projectId: string;
  taskId: string;
  userInput: string;
  deliveryMode?: "queue" | "guide" | "interrupt_replace";
  runMode?: "execute" | "plan";
  goalMode?: boolean;
  attachments?: ChatAttachment[];
  maxRecentMessages?: number;
  maxIterations?: number;
  riskConfirmed?: boolean;
  runtimeApprovalEnabled?: boolean;
  approvalTimeoutSeconds?: number;
  permissions?: Record<string, unknown>;
}

export interface SendMessageResponse {
  ok: boolean;
  runId: string;
  warning?: string;
  queued?: boolean;
  guided?: boolean;
  queueDepth?: number;
  queueId?: string;
  context?: BuiltContext["metadata"];
}

export interface QueuedMessageUpdateInput {
  projectId: string;
  taskId: string;
  queueId: string;
  action: "delete" | "guide";
}

export interface QueuedMessageUpdateResponse {
  ok: boolean;
  message?: string;
  deleted?: boolean;
  guided?: boolean;
  runId?: string;
  queueDepth?: number;
  stale?: boolean;
}

export interface PaginatedSessions {
  sessions: SessionInfo[];
  total: number;
  limit: number;
  offset: number;
}

export interface SessionMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    function: { name: string; arguments: string };
  }>;
  tool_name?: string;
  tool_call_id?: string;
  timestamp?: number;
}

export interface SessionMessagesResponse {
  session_id: string;
  messages: SessionMessage[];
}

export interface LogsResponse {
  file: string;
  lines: string[];
}

export interface AnalyticsDailyEntry {
  day: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  reasoning_tokens: number;
  estimated_cost: number;
  actual_cost: number;
  sessions: number;
  api_calls: number;
  tool_calls?: number;
}

export interface AnalyticsModelEntry {
  model: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost: number;
  sessions: number;
  api_calls: number;
}

export interface AnalyticsSkillEntry {
  skill: string;
  view_count: number;
  manage_count: number;
  total_count: number;
  percentage: number;
  last_used_at: number | null;
}

export interface AnalyticsSkillsSummary {
  total_skill_loads: number;
  total_skill_edits: number;
  total_skill_actions: number;
  distinct_skills_used: number;
}

export interface AnalyticsResponse {
  daily: AnalyticsDailyEntry[];
  by_model: AnalyticsModelEntry[];
  totals: {
    total_input: number;
    total_output: number;
    total_cache_read: number;
    total_reasoning: number;
    total_estimated_cost: number;
    total_actual_cost: number;
    total_sessions: number;
    total_api_calls: number;
    total_tool_calls?: number;
  };
  skills: {
    summary: AnalyticsSkillsSummary;
    top_skills: AnalyticsSkillEntry[];
  };
}

export interface ModelsAnalyticsModelEntry {
  model: string;
  provider: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  reasoning_tokens: number;
  estimated_cost: number;
  actual_cost: number;
  sessions: number;
  api_calls: number;
  tool_calls: number;
  last_used_at: number;
  avg_tokens_per_session: number;
  capabilities: {
    supports_tools?: boolean;
    supports_vision?: boolean;
    supports_reasoning?: boolean;
    context_window?: number;
    max_output_tokens?: number;
    model_family?: string;
  };
}

export interface ModelsAnalyticsResponse {
  models: ModelsAnalyticsModelEntry[];
  totals: {
    distinct_models: number;
    total_input: number;
    total_output: number;
    total_cache_read: number;
    total_reasoning: number;
    total_estimated_cost: number;
    total_actual_cost: number;
    total_sessions: number;
    total_api_calls: number;
  };
  period_days: number;
}

export interface AnalysisBenchmarkTaskMeta {
  id: string;
  file: string;
  title: string;
  capability: string;
}

export interface AnalysisBenchmarkSection {
  id: string;
  label: string;
  score: number;
  evidence: string;
}

export interface AnalysisBenchmarkTaskResult {
  id: string;
  title: string;
  capability: string;
  status: "pending" | "queued" | "running" | "completed" | "failed" | "interrupted" | string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
  apiCalls: number;
  estimatedCostUsd: number;
  score: number;
  sections: AnalysisBenchmarkSection[];
  error: string | null;
  summary: string;
  artifacts?: {
    rootPath: string;
    batchLogPath: string;
    batchLogPreview: string;
    reports: string[];
    logs: string[];
    modelResults: string[];
  };
}

export interface AnalysisBenchmarkResult {
  id: string;
  key: string;
  runId: string;
  provider: string;
  model: string;
  agent: string;
  status: "queued" | "running" | "completed" | "failed" | "interrupted" | string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  workspacePath: string;
  summary: string;
  totals: {
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    reasoningTokens: number;
    apiCalls: number;
    estimatedCostUsd: number;
  };
  abilityScores: {
    environmentConstraints: number;
    projectDelivery: number;
    debugRepair: number;
    frameworkExtension: number;
    parsingEdgeCases: number;
    verificationIteration: number;
    researchProduct: number;
    documentationReproducibility: number;
  };
  tasks: AnalysisBenchmarkTaskResult[];
}

export interface AnalysisBenchmarksResponse {
  version: number;
  tasks: AnalysisBenchmarkTaskMeta[];
  results: AnalysisBenchmarkResult[];
  activeRunId: string | null;
  activeRunIds: string[];
  queueDepth: number;
}

export interface AnalysisBenchmarkStartRequest {
  models: Array<{ provider?: string; model?: string }>;
  maxIterations?: number;
}

export interface AnalysisBenchmarkStartResponse {
  ok: boolean;
  runIds: string[];
  queued: number;
  skipped: number;
}

export interface AnalysisBenchmarkEvent {
  type: string;
  runId?: string;
  taskId?: string;
  error?: string;
  updatedAt: string;
}

export interface CronJob {
  id: string;
  name?: string | null;
  prompt?: string | null;
  script?: string | null;
  schedule?: { kind?: string; expr?: string; display?: string };
  schedule_display?: string | null;
  enabled: boolean;
  state?: string | null;
  deliver?: string | null;
  last_run_at?: string | null;
  next_run_at?: string | null;
  last_error?: string | null;
}

export interface SkillInfo {
  id?: string;
  name: string;
  description: string;
  category: string | null;
  enabled: boolean;
  source?: "root" | "profile" | string;
  profile?: string | null;
  profileHome?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  path?: string;
}

export interface SkillToggleScope {
  profile?: string | null;
  profileHome?: string | null;
  path?: string | null;
}

export interface SkillDeleteInput {
  id?: string;
  name: string;
  source?: string;
  profile?: string | null;
  profileHome?: string | null;
  category?: string | null;
  path?: string;
}

export interface SkillDeleteResponse {
  ok: boolean;
  name: string;
  source?: string;
  profile?: string | null;
  path?: string;
  message?: string;
}

export interface SkillMergeInput {
  id?: string;
  name: string;
  source?: string;
  profile?: string | null;
  profileHome?: string | null;
  category?: string | null;
  path?: string;
}

export interface SkillMergeResponse {
  ok: boolean;
  mergedInto: {
    name: string;
    profile?: string | null;
    path: string;
  };
  archived: Array<{
    name: string;
    path: string;
  }>;
  copiedFiles?: Array<{
    name: string;
    paths: string[];
  }>;
  count: number;
}

export interface ToolsetInfo {
  name: string;
  label: string;
  description: string;
  enabled: boolean;
  configured: boolean;
  tools: string[];
}

// 鈹€鈹€ Model info types 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export interface ModelInfoResponse {
  model: string;
  provider: string;
  auto_context_length: number;
  config_context_length: number;
  effective_context_length: number;
  capabilities: {
    supports_tools?: boolean;
    supports_vision?: boolean;
    supports_reasoning?: boolean;
    context_window?: number;
    max_output_tokens?: number;
    model_family?: string;
  };
}

// 鈹€鈹€ Model options / assignment types 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export interface ModelOptionProvider {
  name: string;
  slug: string;
  models?: string[];
  total_models?: number;
  is_current?: boolean;
  is_user_defined?: boolean;
  source?: string;
  warning?: string;
}

export interface ModelOptionsResponse {
  model?: string;
  provider?: string;
  providers?: ModelOptionProvider[];
}

export interface ModelSetupProvider {
  provider: string;
  label: string;
  description: string;
  base_url: string;
  api_key_env: string;
  base_url_env?: string;
  models: string[];
  default_model: string;
  region?: string;
  tags?: string[];
  docs_url?: string;
  api_mode?: string;
  custom_provider_name?: string;
  api_key_optional?: boolean;
  api_key_set?: boolean;
  base_url_set?: boolean;
  request_timeout_seconds?: number;
  model_timeout_seconds?: number;
}

export interface ModelSetupCatalogResponse {
  providers: ModelSetupProvider[];
  current: {
    provider: string;
    model: string;
    base_url: string;
  };
}

export interface ModelSetupRequest {
  provider: string;
  model: string;
  base_url: string;
  api_key?: string;
  api_key_env?: string;
  base_url_env?: string;
  api_mode?: string;
  custom_provider_name?: string;
  models?: string[];
  request_timeout_seconds?: number;
  model_timeout_seconds?: number;
}

export interface ModelSetupRefreshRequest {
  provider: string;
  model?: string;
  base_url: string;
  api_key?: string;
  api_key_env?: string;
  base_url_env?: string;
  api_mode?: string;
  custom_provider_name?: string;
  models?: string[];
  request_timeout_seconds?: number;
  model_timeout_seconds?: number;
}

export interface ModelSetupRefreshResponse {
  ok: boolean;
  scope?: string;
  provider?: string;
  base_url?: string;
  api_key_env?: string;
  api_key_set?: boolean;
  base_url_set?: boolean;
  models?: string[];
  default_model?: string;
  model_count?: number;
  refreshed?: boolean;
  warning?: string;
  probed_url?: string | null;
  request_timeout_seconds?: number;
  model_timeout_seconds?: number;
}

export interface ModelSetupResponse {
  ok: boolean;
  scope?: string;
  provider?: string;
  model?: string;
  base_url?: string;
  api_key_env?: string;
  request_timeout_seconds?: number;
  model_timeout_seconds?: number;
}

export interface AuxiliaryTaskAssignment {
  task: string;
  provider: string;
  model: string;
  base_url: string;
}

export interface AuxiliaryModelsResponse {
  tasks: AuxiliaryTaskAssignment[];
  main: { provider: string; model: string };
}

export interface ModelAssignmentRequest {
  scope: "main" | "auxiliary";
  provider: string;
  model: string;
  /** For auxiliary: task slot name, "" for all, "__reset__" to reset all. */
  task?: string;
}

export interface ModelAssignmentResponse {
  ok: boolean;
  scope?: string;
  provider?: string;
  model?: string;
  tasks?: string[];
  reset?: boolean;
}

// 鈹€鈹€ OAuth provider types 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export interface OAuthProviderStatus {
  logged_in: boolean;
  source?: string | null;
  source_label?: string | null;
  token_preview?: string | null;
  expires_at?: string | null;
  has_refresh_token?: boolean;
  last_refresh?: string | null;
  error?: string;
}

export interface OAuthProvider {
  id: string;
  name: string;
  /** "pkce" (browser redirect + paste code), "device_code" (show code + URL),
   *  or "external" (delegated to a separate CLI like Claude Code or Qwen). */
  flow: "pkce" | "device_code" | "external";
  cli_command: string;
  docs_url: string;
  status: OAuthProviderStatus;
}

export interface OAuthProvidersResponse {
  providers: OAuthProvider[];
}

/** Discriminated union 鈥?the shape of /start depends on the flow. */
export type OAuthStartResponse =
  | {
      session_id: string;
      flow: "pkce";
      auth_url: string;
      expires_in: number;
    }
  | {
      session_id: string;
      flow: "device_code";
      user_code: string;
      verification_url: string;
      expires_in: number;
      poll_interval: number;
    };

export interface OAuthSubmitResponse {
  ok: boolean;
  status: "approved" | "error";
  message?: string;
}

export interface OAuthPollResponse {
  session_id: string;
  status: "pending" | "approved" | "denied" | "expired" | "error";
  error_message?: string | null;
  expires_at?: number | null;
}

// 鈹€鈹€ Dashboard theme types 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export interface DashboardThemeSummary {
  description: string;
  label: string;
  name: string;
  /** Full theme definition for user themes; undefined for built-ins
   *  (which the frontend already has locally). */
  definition?: DashboardTheme;
}

export interface DashboardThemesResponse {
  active: string;
  themes: DashboardThemeSummary[];
}

// 鈹€鈹€ Dashboard plugin types 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export interface PluginManifestResponse {
  name: string;
  label: string;
  description: string;
  icon: string;
  version: string;
  tab: {
    path: string;
    position?: string;
    override?: string;
    hidden?: boolean;
  };
  slots?: string[];
  entry: string;
  css?: string | null;
  has_api: boolean;
  source: string;
}

export interface HubAgentPluginRow {
  name: string;
  version: string;
  description: string;
  source: string;
  runtime_status: "disabled" | "enabled" | "inactive";
  has_dashboard_manifest: boolean;
  dashboard_manifest: PluginManifestResponse | null;
  path: string;
  can_remove: boolean;
  can_update_git: boolean;
  auth_required: boolean;
  auth_command: string;
  user_hidden: boolean;
}

export interface PluginsHubProviders {
  memory_provider: string;
  memory_options: Array<{ name: string; description: string }>;
  context_engine: string;
  context_options: Array<{ name: string; description: string }>;
}

export interface PluginsHubResponse {
  plugins: HubAgentPluginRow[];
  orphan_dashboard_plugins: PluginManifestResponse[];
  providers: PluginsHubProviders;
}

export interface McpServerRow {
  name: string;
  enabled: boolean;
  transport: string;
  command: string;
  args: string[];
  url: string;
  env_keys: string[];
  env: Record<string, string>;
  missing_env: string[];
  preset: string;
  package: string;
  docs: string;
}

export interface McpPresetInfo {
  name: string;
  label: string;
  description: string;
  docs: string;
  package: string;
  api_key_env: string;
  has_api_key: boolean;
  default_api_host: string;
  default_resource_mode: string;
  default_output_dir: string;
}

export interface McpHubResponse {
  servers: McpServerRow[];
  presets: Record<string, McpPresetInfo>;
}

export interface McpInstallRequest {
  preset?: string;
  name?: string;
  apiKey?: string;
  apiHost?: string;
  resourceMode?: "local" | "url";
  basePath?: string;
  force?: boolean;
  enable?: boolean;
}

export interface McpInstallResponse {
  ok: boolean;
  name: string;
  enabled: boolean;
  server: McpServerRow;
  missing_env?: string[];
}

export interface McpToolSummary {
  name: string;
  description: string;
}

export interface McpTestResponse {
  ok: boolean;
  name: string;
  tools: McpToolSummary[];
  error?: string;
}

export interface AgentPluginInstallRequest {
  identifier: string;
  force?: boolean;
  enable?: boolean;
}

export interface AgentPluginInstallResponse {
  ok: boolean;
  plugin_name?: string;
  warnings?: string[];
  missing_env?: string[];
  after_install_path?: string | null;
  enabled?: boolean;
  error?: string;
}

export interface AgentPluginUpdateResponse {
  ok: boolean;
  name?: string;
  output?: string;
  unchanged?: boolean;
  error?: string;
}

export interface PluginProvidersPutRequest {
  memory_provider?: string;
  context_engine?: string;
}
