// Local-service facade boundary:
// - index.cjs owns the facade class, public API mixin installation, and compatibility exports.
// - Service wiring and dependency injection live in wiring/serviceWiring.cjs.
// - Database schema and persistence details live under db/ and db/repositories/.
// - Process spawning, run tracking, and process termination live in processes/processManager.cjs.
// - Schedule CRUD, polling, and trigger orchestration live in scheduler/schedulerService.cjs.
// - Task context assembly, context policy, compression hooks, and attachment formatting live in context/contextBuilder.cjs.
// - Status/session/usage/analysis read models live in analytics/analyticsService.cjs.
// - Settings, theme/language, and dashboard config routing live in settings/settingsService.cjs.
// - User input attachment file operations live in artifacts/artifactService.cjs.
// - UI log reads and task JSONL journals live in logs/logService.cjs.
// - Plugin hub/runtime actions live in plugins/pluginService.cjs; skills and task skill packaging live in skills/skillService.cjs.
// - Local event publishing and lifecycle init/dispose/health behavior live in eventBus.cjs and lifecycle.cjs.
const { analysisTaskProcessStatus } = require("./analysis/benchmarkUtils.cjs");
const {
  ContextValidator,
  SecretRedactor,
  TaskStateManager,
  ToolLogSummarizer,
  compressTaskContext,
} = require("./context/contextUtils.cjs");
const { wireLocalService } = require("./wiring/serviceWiring.cjs");
const { installRuntimeMethods } = require("./runtime/runtimeMethods.cjs");
const { installProfileMethods } = require("./profiles/profileMethods.cjs");
const { installProjectMethods } = require("./projects/projectMethods.cjs");
const { installContextMethods } = require("./context/contextMethods.cjs");
const { installChatRunMethods } = require("./runs/chatRunMethods.cjs");
const { installAnalysisMethods } = require("./analysis/analysisMethods.cjs");


class RedouLocalService {
  constructor(options) {
    wireLocalService.call(this, options);
  }

}

installRuntimeMethods(RedouLocalService);
installProfileMethods(RedouLocalService);
installProjectMethods(RedouLocalService);
installContextMethods(RedouLocalService);
installChatRunMethods(RedouLocalService);
installAnalysisMethods(RedouLocalService);

module.exports = {
  RedouLocalService,
  ContextValidator,
  SecretRedactor,
  ToolLogSummarizer,
  TaskStateManager,
  compressTaskContext,
  analysisTaskProcessStatus,
};
