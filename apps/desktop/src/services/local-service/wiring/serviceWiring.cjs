const fs = require("fs");
const path = require("path");
const { createLocalDb } = require("../db/index.cjs");
const { createEventBus } = require("../eventBus.cjs");
const { LifecycleService } = require("../lifecycle.cjs");
const { AnalyticsService } = require("../analytics/analyticsService.cjs");
const { ContextBuilder } = require("../context/contextBuilder.cjs");
const { ProcessManager } = require("../processes/processManager.cjs");
const { SchedulerService } = require("../scheduler/schedulerService.cjs");
const { SettingsService } = require("../settings/settingsService.cjs");
const { ArtifactService } = require("../artifacts/artifactService.cjs");
const { LogService } = require("../logs/logService.cjs");
const { PluginService } = require("../plugins/pluginService.cjs");
const { SkillService } = require("../skills/skillService.cjs");
const { compact, compactMultiline, safeSegment } = require("../shared/textUtils.cjs");
const { ensureEmptyFile, mkdirp, readText } = require("../shared/fileUtils.cjs");
const { isoNow } = require("../shared/timeUtils.cjs");
const { ANALYSIS_ABILITY_KEYS, ANALYSIS_TASKS } = require("../analysis/benchmarkUtils.cjs");
const {
  COMPACT_FORCE_RATIO,
  ContextValidator,
  DEFAULT_MODEL_CONTEXT_TOKENS,
  RECENT_MESSAGE_CONTENT_LIMIT,
  RECENT_MESSAGE_LIMIT,
  SecretRedactor,
  VALID_MESSAGE_ROLES,
  appendDedupeRules,
  applyTaskStateBudget,
  classifyContextDirective,
  compressTaskContext,
  contextPercent,
  createUserInputEnvelope,
  defaultTaskState,
  emptyTurnArtifacts,
  estimateContextTokens,
  extractRulesFromTaskContextText,
  getContextBudget,
  hasTaskContextShape,
  isControlEventMessage,
  isImageMime,
  mergeMetadata,
  messageInputEnvelope,
  normalizeDeliveryMode,
  normalizeTaskContextText,
  normalizeUserInputStatus,
  parseTaskStateFromStructuredText,
  promptTextFromMessages,
  readTaskStateFile,
  redact,
  renderTaskContextMarkdown,
  renderTaskStateStructuredMarkdown,
  scrubCurrentRequestEcho,
  seedAttachmentArtifacts,
  shouldCompactContext,
  splitTaskContext,
  taskEventsPathFromContextPath,
  taskStatePathFromContextPath,
  uniqueList,
  writeTaskStateFiles,
} = require("../context/contextUtils.cjs");

function wireLocalService({ app, projectRoot, hermesRoot, hermesHome, log }) {
    this.app = app;
    this.projectRoot = projectRoot;
    const repoHermesRoot = path.resolve(__dirname, "..", "..", "..", "..", "..", "..", "vendor", "hermes");
    const projectHermesRoot = path.join(projectRoot, "vendor", "hermes");
    this.hermesRoot = hermesRoot
      || (fs.existsSync(projectHermesRoot) ? projectHermesRoot : "")
      || (fs.existsSync(repoHermesRoot) ? repoHermesRoot : projectRoot);
    this.hermesHome = hermesHome;
    this.log = typeof log === "function" ? log : () => {};
    this.pythonPath = null;
    this.codexPath = null;
    this.activeRuns = new Map();
    this.taskQueues = new Map();
    this.analysisQueue = [];
    this.activeAnalysisRuns = new Map();
    this.activeAnalysisRun = null;
    this.activeAnalysisShellChildren = new Set();
    this.shuttingDown = false;
    this.eventBus = createEventBus();
    this.db = createLocalDb({
      paths: {
        appDataRoot: () => this.appDataRoot(),
        globalDir: () => this.globalDir(),
        projectsDir: () => this.projectsDir(),
        statePath: () => this.statePath(),
        projectJsonPath: (projectId) => this.projectJsonPath(projectId),
      },
      activeRuns: this.activeRuns,
    });
    this.settingsService = new SettingsService({ repos: this.db.repositories, eventBus: this.eventBus, dashboardBridge: (action, payload) => this.runDashboardBridge(action, payload) });
    this.artifactService = new ArtifactService({
      repos: this.db.repositories,
      helpers: {
        compact,
        findProjectAndTask: (projectId, taskId) => this.findProjectAndTask(projectId, taskId),
        isoNow,
        redact,
        safeSegment,
      },
      logger: this.log,
    });
    this.logService = new LogService({
      repos: this.db.repositories,
      paths: {
        hermesHome: () => this.hermesHome,
        redouLogPath: () => path.join(this.app.getPath("userData"), "logs", "desktop-main.log"),
      },
      helpers: {
        findProjectAndTask: (projectId, taskId) => this.findProjectAndTask(projectId, taskId),
        isoNow,
        normalizeUserInputStatus,
        redact,
        taskEventsPathFromContextPath,
        updateChatTask: (projectId, taskId, body, options) => this.updateChatTask(projectId, taskId, body, options),
        validMessageRoles: VALID_MESSAGE_ROLES,
      },
      logger: this.log,
    });
    this.pluginService = new PluginService({ dashboardBridge: (action, payload) => this.runDashboardBridge(action, payload) });
    this.skillService = new SkillService({
      dashboardBridge: (action, payload) => this.runDashboardBridge(action, payload),
      env: {
        appDataRoot: () => this.appDataRoot(),
        childEnv: (extra) => this.childEnv(extra),
        projectRoot: () => this.projectRoot,
        pythonPath: () => this.pythonPath,
        codexPath: () => this.codexPath,
      },
      helpers: {
        appendTaskMessage: (projectId, taskId, role, content, metadata, attachments) => this.appendTaskMessage(projectId, taskId, role, content, metadata, attachments),
        compact,
        ensureProjectHermesProfile: (project) => this.ensureProjectHermesProfile(project),
        findProjectAndTask: (projectId, taskId) => this.findProjectAndTask(projectId, taskId),
        isoNow,
        loadMessagesFile: (messagesPath, options) => this.loadMessagesFile(messagesPath, options),
        projectContextDir: (project) => this.projectContextDir(project),
        projectHermesHome: (project) => this.projectHermesHome(project),
        projectProfileHomesForBridge: () => this.projectProfileHomesForBridge(),
        projectSkillsDir: (project) => this.projectSkillsDir(project),
        readText,
        redact,
      },
      logger: this.log,
    });
    this.processManager = new ProcessManager({
      activeRuns: this.activeRuns,
      eventBus: this.eventBus,
      log: this.log,
    });
    this.schedulerService = new SchedulerService({
      dashboardBridge: (action, payload) => this.runDashboardBridge(action, payload),
      eventBus: this.eventBus,
      repos: this.db.repositories,
      processManager: this.processManager,
      contextBuilder: () => this.contextBuilder,
      logger: this.log,
    });
    this.contextBuilder = new ContextBuilder({
      host: this,
      repos: this.db.repositories,
      logger: this.log,
      options: {
        recentMessageLimit: RECENT_MESSAGE_LIMIT,
        recentMessageContentLimit: RECENT_MESSAGE_CONTENT_LIMIT,
        defaultModelContextTokens: DEFAULT_MODEL_CONTEXT_TOKENS,
        compactForceRatio: COMPACT_FORCE_RATIO,
      },
      helpers: {
        appendDedupeRules,
        applyTaskStateBudget,
        classifyContextDirective,
        compactMultiline,
        compressTaskContext,
        contextPercent,
        ContextValidator,
        createUserInputEnvelope,
        defaultTaskState,
        emptyTurnArtifacts,
        ensureEmptyFile,
        estimateContextTokens,
        extractRulesFromTaskContextText,
        getContextBudget,
        hasTaskContextShape,
        isControlEventMessage,
        isImageMime,
        isoNow,
        mergeMetadata,
        messageInputEnvelope,
        mkdirp,
        normalizeDeliveryMode,
        normalizeTaskContextText,
        parseTaskStateFromStructuredText,
        promptTextFromMessages,
        readTaskStateFile,
        readText,
        redact,
        renderTaskContextMarkdown,
        renderTaskStateStructuredMarkdown,
        scrubCurrentRequestEcho,
        SecretRedactor,
        seedAttachmentArtifacts,
        shouldCompactContext,
        splitTaskContext,
        taskEventsPathFromContextPath,
        taskStatePathFromContextPath,
        uniqueList,
        writeTaskStateFiles,
      },
    });
    this.analyticsService = new AnalyticsService({
      host: this,
      paths: {
        hermesHome: () => this.hermesHome,
      },
      analysis: {
        tasks: ANALYSIS_TASKS,
        abilityKeys: ANALYSIS_ABILITY_KEYS,
      },
    });
    this.lifecycle = new LifecycleService({
      host: this,
      eventBus: this.eventBus,
      logger: this.log,
    });
  }

module.exports = { wireLocalService };
