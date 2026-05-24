const fs = require("fs");
const path = require("path");
const { isRunLogicallyActive } = require("../processes/processManager.cjs");
const {
  GLOBAL_RULES_FILE,
  GLOBAL_USER_FILE,
  PROJECT_RULES_FILE,
  REDOU_CONTEXT_DIR,
  REDOU_SKILLS_DIR,
  REDOU_TASKS_DIR,
  TASK_CONTEXT_FILE,
  TASK_EVENTS_FILE,
  TASK_MESSAGES_FILE,
  TASK_RULES_FILE,
  TASK_STATE_FILE,
  TASK_UPLOADS_DIR,
  DEFAULT_CHAT_PROJECT_NAME,
} = require("../constants.cjs");
const { compact, safeSegment } = require("../shared/textUtils.cjs");
const { assertChildPath, ensureEmptyFile, ensureTextFile, mkdirp, readText } = require("../shared/fileUtils.cjs");
const { isoNow, timestampMs, timestampSeconds } = require("../shared/timeUtils.cjs");
const { desktopSourcePath } = require("../shared/desktopPaths.cjs");
const { readDotEnv, sanitizeEnvValue } = require("../analysis/benchmarkUtils.cjs");
const {
  defaultTaskState,
  appendDedupeRules,
  projectWorkspaceOutputRule,
  readTaskStateFile,
  redact,
  renderTaskContextMarkdown,
  writeTaskStateFiles,
} = require("../context/contextUtils.cjs");

function sanitizeChildEnv(env) {
  const clean = {};
  for (const [key, value] of Object.entries(env || {})) {
    if (!key || key.includes("\0") || value === undefined || value === null) continue;
    clean[key] = sanitizeEnvValue(value);
  }
  return clean;
}

function _catalogEntry(o) {
  return {
    provider: o.provider, label: o.label, description: o.description || "",
    base_url: o.base_url || "", api_key_env: o.api_key_env || "",
    base_url_env: o.base_url_env || "", models: o.models || [],
    default_model: o.default_model || (o.models?.[0] || ""),
    region: o.region || "", tags: o.tags || [], docs_url: o.docs_url || "",
    api_mode: o.api_mode || "", custom_provider_name: o.custom_provider_name || "",
    api_key_optional: o.api_key_optional || false,
    api_key_set: !!(process.env[o.api_key_env]),
    request_timeout_seconds: o.request_timeout_seconds || 300,
    model_timeout_seconds: o.model_timeout_seconds || null,
  };
}

function _staticProviderCatalog() {
  return [
    _catalogEntry({ provider: "local-vllm", label: "Local vLLM", description: "Local OpenAI-compatible server.", base_url: "http://127.0.0.1:8000/v1", api_key_env: "VLLM_API_KEY", models: ["local-model"], region: "Local", tags: ["vllm", "openai-compatible"], docs_url: "https://docs.vllm.ai/", api_key_optional: true, api_mode: "chat_completions", custom_provider_name: "Local vLLM" }),
    _catalogEntry({ provider: "deepseek", label: "DeepSeek", description: "DeepSeek chat and reasoning models.", base_url: "https://api.deepseek.com/v1", api_key_env: "DEEPSEEK_API_KEY", base_url_env: "DEEPSEEK_BASE_URL", models: ["deepseek-chat", "deepseek-reasoner"], region: "CN", tags: ["reasoning", "coding"], docs_url: "https://api-docs.deepseek.com/" }),
    _catalogEntry({ provider: "alibaba", label: "Qwen / DashScope", description: "Alibaba DashScope OpenAI-compatible endpoint.", base_url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", api_key_env: "DASHSCOPE_API_KEY", base_url_env: "DASHSCOPE_BASE_URL", models: ["qwen3.6-plus", "qwen3.5-plus", "qwen3-coder-plus"], region: "CN/Global", tags: ["qwen", "coding"], docs_url: "https://help.aliyun.com/zh/model-studio/" }),
    _catalogEntry({ provider: "kimi-coding-cn", label: "Kimi / Moonshot", description: "Moonshot China endpoint for Kimi models.", base_url: "https://api.moonshot.cn/v1", api_key_env: "KIMI_CN_API_KEY", models: ["kimi-k2.6", "kimi-k2.5", "kimi-k2-thinking"], region: "CN", tags: ["coding", "long-context"], docs_url: "https://platform.moonshot.cn/docs" }),
    _catalogEntry({ provider: "zai", label: "GLM / Zhipu", description: "Z.AI / Zhipu GLM family.", base_url: "https://api.z.ai/api/paas/v4", api_key_env: "GLM_API_KEY", base_url_env: "GLM_BASE_URL", models: ["glm-5.1", "glm-5", "glm-4.7"], region: "CN/Global", tags: ["reasoning", "coding"], docs_url: "https://docs.z.ai/" }),
    _catalogEntry({ provider: "minimax-cn", label: "MiniMax", description: "China endpoint for MiniMax M2 models.", base_url: "https://api.minimaxi.com/anthropic", api_key_env: "MINIMAX_CN_API_KEY", base_url_env: "MINIMAX_CN_BASE_URL", models: ["MiniMax-M2.7", "MiniMax-M2.5", "MiniMax-M2.1"], region: "CN", tags: ["agent", "anthropic"], docs_url: "https://platform.minimaxi.com/", api_mode: "anthropic_messages" }),
    _catalogEntry({ provider: "xiaomi", label: "Xiaomi MiMo", description: "Xiaomi MiMo V2.5 and V2 models.", base_url: "https://api.xiaomimimo.com/v1", api_key_env: "XIAOMI_API_KEY", base_url_env: "XIAOMI_BASE_URL", models: ["mimo-v2.5-pro", "mimo-v2.5", "mimo-v2-pro"], region: "CN", tags: ["long-context", "multimodal"], docs_url: "https://platform.xiaomimimo.com/" }),
    _catalogEntry({ provider: "doubao", label: "Doubao / Volcengine Ark", description: "ByteDance Doubao models through Ark OpenAI-compatible API.", base_url: "https://ark.cn-beijing.volces.com/api/v3", api_key_env: "ARK_API_KEY", models: ["doubao-seed-1-6", "doubao-seed-1-6-251015", "doubao-seed-1-6-thinking", "doubao-seed-1-6-flash", "doubao-1-5-pro-32k"], region: "CN", tags: ["fast", "openai-compatible"], docs_url: "https://www.volcengine.com/docs/82379", api_mode: "chat_completions", custom_provider_name: "Doubao / Volcengine Ark" }),
    _catalogEntry({ provider: "openrouter", label: "OpenRouter", description: "OpenRouter hosted model marketplace.", base_url: "https://openrouter.ai/api/v1", api_key_env: "OPENROUTER_API_KEY", base_url_env: "OPENROUTER_BASE_URL", models: ["anthropic/claude-sonnet-4.5", "openai/gpt-5.1", "google/gemini-3-pro-preview"], region: "Global", tags: ["marketplace"], docs_url: "https://openrouter.ai/docs" }),
    _catalogEntry({ provider: "openai", label: "OpenAI", description: "OpenAI API models.", base_url: "https://api.openai.com/v1", api_key_env: "OPENAI_API_KEY", models: ["gpt-5.1", "gpt-5.1-mini", "gpt-4.1"], region: "Global", tags: ["tools", "vision"], docs_url: "https://platform.openai.com/docs" }),
    _catalogEntry({ provider: "anthropic", label: "Anthropic", description: "Claude models through the Anthropic API.", base_url: "https://api.anthropic.com", api_key_env: "ANTHROPIC_API_KEY", models: ["claude-sonnet-4-5", "claude-haiku-4-5"], region: "Global", tags: ["agent", "coding"], docs_url: "https://docs.anthropic.com/", api_mode: "anthropic_messages" }),
  ];
}

class RuntimeCoreMethods {
  setPythonPath(pythonPath) {
    this.pythonPath = pythonPath || null;
  }

  setCodexPath(codexPath) {
    this.codexPath = codexPath || null;
  }

  appDataRoot() {
    return path.join(this.app.getPath("userData"), "appData");
  }

  globalDir() {
    return path.join(this.appDataRoot(), "global");
  }

  projectsDir() {
    return path.join(this.appDataRoot(), "projects");
  }

  workspacesDir() {
    return path.join(this.appDataRoot(), "workspaces");
  }

  defaultChatProjectWorkspacePath() {
    return path.join(this.workspacesDir(), "default-project");
  }

  statePath() {
    return path.join(this.appDataRoot(), "state.json");
  }

  defaultProjectSeedPath() {
    return path.join(this.appDataRoot(), "default-project.seeded");
  }

  projectDir(projectId) {
    return path.join(this.projectsDir(), safeSegment(projectId, "project"));
  }

  taskDir(projectId, taskId) {
    return path.join(this.projectDir(projectId), "tasks", safeSegment(taskId, "task"));
  }

  needsDefaultChatProjectWorkspace(project) {
    const workspacePath = String(project?.path || project?.workspace_path || "").trim();
    return !workspacePath && String(project?.name || "") === DEFAULT_CHAT_PROJECT_NAME;
  }

  withDefaultChatProjectWorkspace(project) {
    if (!this.needsDefaultChatProjectWorkspace(project)) return project;
    const workspacePath = this.defaultChatProjectWorkspacePath();
    return {
      ...project,
      path: workspacePath,
      workspace_path: workspacePath,
    };
  }

  projectContextDir(project) {
    const workspacePath = String(project?.path || project?.workspace_path || "").trim();
    if (workspacePath) {
      return path.join(path.resolve(workspacePath), REDOU_CONTEXT_DIR);
    }
    return this.projectDir(project?.id || "project");
  }

  projectSkillsDir(project) {
    return path.join(this.projectContextDir(project), REDOU_SKILLS_DIR);
  }

  taskContextDir(project, taskId) {
    return path.join(this.projectContextDir(project), REDOU_TASKS_DIR, safeSegment(taskId, "task"));
  }

  taskQueueKey(projectId, taskId) {
    return `${projectId}\n${taskId}`;
  }

  queueDepth(projectId, taskId) {
    return (this.taskQueues.get(this.taskQueueKey(projectId, taskId)) || []).length;
  }

  activeRunForTask(projectId, taskId) {
    return this.processManager.activeRunForTask(projectId, taskId);
  }

  markAnalysisInterrupted(item, reason = "Stopped because Redou Agent is closing.") {
    return this.lifecycle.markAnalysisInterrupted(item, reason);
  }

  stopAllHermesActivity(reason = "Redou Agent is closing; stopping Hermes local runtime.") {
    return this.lifecycle.stopAllHermesActivity(reason);
  }

  emitQueueUpdate(webContents, projectId, taskId, runId, message, metadata = {}) {
    const event = {
      type: "queue_update",
      queued: this.queueDepth(projectId, taskId),
      message,
      metadata: { runId, projectId, taskId, ...metadata },
    };
    this.emitToRenderer(webContents, { runId, projectId, taskId, event });
    this.persistEvent(projectId, taskId, event);
  }

  removeAppDataDir(root, target, label) {
    const targetPath = assertChildPath(root, target, label);
    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    }
  }

  hasActiveRunFor(projectId, taskId = null) {
    for (const run of this.activeRuns.values()) {
      if (!isRunLogicallyActive(run)) continue;
      if (run.projectId !== projectId) continue;
      if (!taskId || run.taskId === taskId) return true;
    }
    if (this.hasAnalysisRunForTask(projectId, taskId)) return true;
    return false;
  }

  ensureInitialized() {
    return this.lifecycle.init();
  }

  dispose(reason = "Redou Agent is closing; stopping Hermes local runtime.") {
    return this.lifecycle.dispose(reason);
  }

  healthCheck() {
    return this.lifecycle.healthCheck();
  }

  ensureGlobalFiles() {
    const root = this.globalDir();
    ensureTextFile(path.join(root, GLOBAL_USER_FILE), "# User Preferences\n\n");
    ensureTextFile(path.join(root, GLOBAL_RULES_FILE), "# Global Rules\n\n");
    return {
      userPath: path.join(root, GLOBAL_USER_FILE),
      globalRulesPath: path.join(root, GLOBAL_RULES_FILE),
    };
  }

  readAllProjects() {
    const projects = this.db.repositories.tasks
      .listProjects()
      .filter((project) => project && typeof project === "object")
      .map((project) => this.ensureProject(project));
    return projects.sort((a, b) => {
      const rightTime = timestampMs(b.updatedAt) ?? timestampSeconds(b.updated_at || b.created_at, 0) * 1000;
      const leftTime = timestampMs(a.updatedAt) ?? timestampSeconds(a.updated_at || a.created_at, 0) * 1000;
      return rightTime - leftTime;
    });
  }

  getState() { return this.settingsService.getState(); }

  saveState(state) { return this.settingsService.saveState(state); }

  latestTaskForProject(project) {
    const tasks = Array.isArray(project?.tasks) ? project.tasks : [];
    return [...tasks].sort((left, right) => {
      const rightTime =
        timestampMs(right.updatedAt) ?? timestampSeconds(right.updated_at || right.created_at, 0) * 1000;
      const leftTime =
        timestampMs(left.updatedAt) ?? timestampSeconds(left.updated_at || left.created_at, 0) * 1000;
      return rightTime - leftTime;
    })[0] || null;
  }

  resolveCurrentChatSelection(projects, state = this.getState()) {
    const safeProjects = Array.isArray(projects) ? projects : [];
    const project =
      safeProjects.find((item) => item.id === state.current_project_id) ??
      safeProjects[0] ??
      null;
    if (!project) {
      return { current_project_id: "", current_task_id: "" };
    }
    const task =
      (project.tasks || []).find((item) => item.id === state.current_task_id) ??
      this.latestTaskForProject(project);
    return {
      current_project_id: project.id,
      current_task_id: task?.id || "",
    };
  }

  projectJsonPath(projectId) {
    return path.join(this.projectDir(projectId), "project.json");
  }

  readProject(projectId) {
    const project = this.db.repositories.tasks.readProject(projectId);
    return project && typeof project === "object" ? this.ensureProject(project) : null;
  }

  writeProject(project) {
    const ensured = this.normalizeProject(project);
    this.db.repositories.tasks.writeProject(ensured);
    return ensured;
  }

  normalizeProject(project) {
    const projectInput = this.withDefaultChatProjectWorkspace(project);
    const id = safeSegment(projectInput.id || projectInput.name, `project-${Date.now().toString(36)}`);
    const createdAt = projectInput.createdAt || (projectInput.created_at ? new Date(projectInput.created_at * 1000).toISOString() : isoNow());
    const updatedAt = projectInput.updatedAt || (projectInput.updated_at ? new Date(projectInput.updated_at * 1000).toISOString() : createdAt);
    const workspacePath = projectInput.path || projectInput.workspace_path || "";
    const appDataRoot = this.projectDir(id);
    const contextRoot = this.projectContextDir({ ...projectInput, id, path: workspacePath, workspace_path: workspacePath });
    const hermesHomePath = contextRoot;
    const rulesPath = path.join(contextRoot, PROJECT_RULES_FILE);
    const normalized = {
      id,
      name: projectInput.name || "Untitled Project",
      path: workspacePath,
      workspace_path: workspacePath,
      hermesProfile: projectInput.hermesProfile || this.desiredProjectProfileName(id),
      appDataPath: appDataRoot,
      contextPath: contextRoot,
      hermesHomePath,
      skillsPath: path.join(hermesHomePath, REDOU_SKILLS_DIR),
      rulesPath,
      createdAt,
      updatedAt,
      created_at: projectInput.created_at || Math.floor(new Date(createdAt).getTime() / 1000),
      updated_at: Math.floor(new Date(updatedAt).getTime() / 1000),
      tasks: Array.isArray(projectInput.tasks) ? projectInput.tasks : [],
    };
    normalized.tasks = normalized.tasks.map((task) => this.normalizeTask(normalized, task));
    return normalized;
  }

  normalizeTask(project, task) {
    const id = safeSegment(task.id || task.title, `task-${Date.now().toString(36)}`);
    const createdAt = task.createdAt || (task.created_at ? new Date(task.created_at * 1000).toISOString() : isoNow());
    const updatedAt = task.updatedAt || (task.updated_at ? new Date(task.updated_at * 1000).toISOString() : createdAt);
    // Project-bound task artifacts live beside the project in <workspace>/.redou/tasks/<task-id>.
    // For projects without a workspace path, the same layout falls back to appData/projects/<project-id>/tasks/<task-id>.
    const root = this.taskContextDir(project, id);
    const contextRoot = root;
    const hermesSessionId = compact(task.hermesSessionId || task.session_id, 160) || undefined;
    const contextPath = path.join(contextRoot, TASK_CONTEXT_FILE);
    const statePath = path.join(contextRoot, TASK_STATE_FILE);
    const eventsPath = path.join(contextRoot, TASK_EVENTS_FILE);
    return {
      id,
      projectId: project.id,
      title: task.title || "Untitled Task",
      path: task.path,
      appDataPath: root,
      rulesPath: path.join(contextRoot, TASK_RULES_FILE),
      contextPath,
      statePath,
      eventsPath,
      messagesPath: path.join(root, TASK_MESSAGES_FILE),
      uploadsPath: path.join(root, TASK_UPLOADS_DIR),
      hermesSessionId,
      session_id: hermesSessionId || null,
      model_provider: task.model_provider || "",
      model: task.model || "",
      ...(task.kind ? { kind: compact(task.kind, 80) } : {}),
      ...(task.analysisKey ? { analysisKey: compact(task.analysisKey, 180) } : {}),
      ...(task.analysisRunId ? { analysisRunId: compact(task.analysisRunId, 180) } : {}),
      ...(task.analysisProvider ? { analysisProvider: compact(task.analysisProvider, 120) } : {}),
      ...(task.analysisModel ? { analysisModel: compact(task.analysisModel, 180) } : {}),
      createdAt,
      updatedAt,
      created_at: task.created_at || Math.floor(new Date(createdAt).getTime() / 1000),
      updated_at: Math.floor(new Date(updatedAt).getTime() / 1000),
    };
  }

  copyMissingProjectContextEntries(sourceRoot, targetRoot, options = {}) {
    const sourcePath = path.resolve(sourceRoot || "");
    const targetPath = path.resolve(targetRoot || "");
    if (!sourceRoot || !targetRoot || sourcePath === targetPath || !fs.existsSync(sourcePath)) return;
    mkdirp(targetPath);
    for (const entry of fs.readdirSync(sourcePath, { withFileTypes: true })) {
      if (options.skipProjectJson && entry.name === "project.json") continue;
      if (entry.name.endsWith(".tmp")) continue;
      const source = path.join(sourcePath, entry.name);
      const target = path.join(targetPath, entry.name);
      if (entry.isDirectory()) {
        this.copyMissingProjectContextEntries(source, target);
      } else if (entry.isFile() && !fs.existsSync(target)) {
        mkdirp(path.dirname(target));
        fs.copyFileSync(source, target);
      }
    }
  }

  migrateDefaultChatProjectWorkspace(project, normalized) {
    if (!this.needsDefaultChatProjectWorkspace(project)) return;
    const id = safeSegment(project.id || project.name, normalized.id);
    this.copyMissingProjectContextEntries(this.projectDir(id), normalized.contextPath, {
      skipProjectJson: true,
    });
  }

  ensureProject(project) {
    const normalized = this.normalizeProject(project);
    this.migrateDefaultChatProjectWorkspace(project, normalized);
    mkdirp(normalized.appDataPath);
    mkdirp(this.projectContextDir(normalized));
    mkdirp(this.projectSkillsDir(normalized));
    ensureTextFile(normalized.rulesPath, "# Project Rules\n\n");
    appendDedupeRules(normalized.rulesPath, [projectWorkspaceOutputRule(normalized.path || normalized.workspace_path)]);
    this.ensureProjectHermesProfile(normalized);
    normalized.tasks = normalized.tasks.map((task) => this.ensureTask(normalized, task));
    this.writeProject(normalized);
    return normalized;
  }

  ensureTask(project, task) {
    const normalized = this.normalizeTask(project, task);
    mkdirp(normalized.appDataPath);
    mkdirp(normalized.uploadsPath);
    ensureTextFile(normalized.rulesPath, "# Task Rules\n\n");
    ensureEmptyFile(normalized.eventsPath);
    if (!fs.existsSync(normalized.statePath)) {
      writeTaskStateFiles(normalized, defaultTaskState());
    }
    ensureTextFile(normalized.contextPath, renderTaskContextMarkdown(readTaskStateFile(normalized.statePath)));
    this.ensureTaskContextShape(normalized.contextPath, normalized);
    ensureEmptyFile(normalized.messagesPath);
    this.db.repositories.tasks.writeTaskMetadata(normalized);
    return normalized;
  }

  ensureTaskContextShape(taskContextPath, task = null) {
    return this.contextBuilder.ensureTaskContextShape(taskContextPath, task);
  }

  ensureTaskStateShape(task) {
    return this.contextBuilder.ensureTaskStateShape(task);
  }

  desiredProjectProfileName(projectId) {
    const base = safeSegment(projectId, "project").replace(/\./g, "-");
    const name = `redou-${base}`;
    return safeSegment(name, "redou-project").slice(0, 64).replace(/[-_]+$/g, "") || "redou-project";
  }

  projectHermesHome(project) {
    return this.projectContextDir(project);
  }

  rootHermesEnv() {
    return readDotEnv(path.join(this.hermesHome, ".env"));
  }

  childEnv(extra = {}) {
    const baseEnv = {
      ...process.env,
      // Redou's model setup writes credentials to the bundled Hermes home.
      // Prefer that explicit UI state over stale parent-process variables.
      ...this.rootHermesEnv(),
      ...extra,
    };
    const cleanBaseEnv = sanitizeChildEnv(baseEnv);
    const pythonPath = [this.hermesRoot, cleanBaseEnv.PYTHONPATH || ""].filter(Boolean).join(path.delimiter);
    return sanitizeChildEnv({
      ...cleanBaseEnv,
      // Required: when process.execPath is electron.exe, this makes it run scripts as Node.js
      ELECTRON_RUN_AS_NODE: "1",
      PYTHONPATH: pythonPath,
      HERMES_PYTHON_SRC_ROOT: this.hermesRoot,
      HERMES_VENDOR_ROOT: this.hermesRoot,
      REDOU_PROJECT_ROOT: this.projectRoot,
      CODEX_BINARY: this.codexPath || cleanBaseEnv.CODEX_BINARY || "codex",
    });
  }

  parseBridgeJson(stdout) {
    const text = String(stdout || "").trim();
    if (!text) throw new Error("Dashboard bridge returned no output.");
    try {
      return JSON.parse(text);
    } catch {
      const objectStart = text.lastIndexOf("\n{");
      if (objectStart >= 0) {
        return JSON.parse(text.slice(objectStart + 1));
      }
      const arrayStart = text.lastIndexOf("\n[");
      if (arrayStart >= 0) {
        return JSON.parse(text.slice(arrayStart + 1));
      }
      throw new Error(`Dashboard bridge returned invalid JSON: ${compact(text, 240)}`);
    }
  }

  runDashboardBridge(action, payload = {}) {
    if (!this.pythonPath || !fs.existsSync(this.pythonPath)) {
      // Python runtime not available - return safe defaults so the renderer works
      this.log?.(`Dashboard bridge skipped (no Python): action=${action}`);
      const defaults = {
        // Config
        get_config: {},
        get_defaults: {},
        get_schema: { fields: [], category_order: [] },
        get_config_raw: { yaml: "" },
        save_config: { ok: true },
        save_config_raw: { ok: true },
        // Theme / Language
        get_themes: { themes: [], active: "default" },
        get_language: { language: "zh" },
        set_theme: { ok: true },
        set_language: { ok: true },
        // Models — shapes must match dashboard_bridge.py exactly
        get_model_info: {
          model: "codex", provider: "openai",
          auto_context_length: 0, config_context_length: 0,
          effective_context_length: 0, capabilities: {},
        },
        get_model_options: { providers: _staticProviderCatalog(), model: "codex", provider: "openai" },
        get_model_setup_catalog: { providers: _staticProviderCatalog(), current: { model: "codex", provider: "openai", base_url: "" } },
        get_auxiliary_models: { tasks: [], main: { provider: "openai", model: "codex" } },
        set_model_assignment: { ok: true },
        refresh_model_setup_models: { ok: true },
        setup_main_model: { ok: true },
        // Analytics
        get_models_analytics: {
          models: [], period_days: 30,
          totals: {
            distinct_models: 0, total_input: 0, total_output: 0,
            total_cache_read: 0, total_reasoning: 0,
            total_estimated_cost: 0, total_actual_cost: 0,
            total_sessions: 0, total_api_calls: 0,
          },
        },
        // Skills — returns array directly
        get_skills: [],
        toggle_skill: { ok: true },
        delete_skill: { ok: true },
        merge_skills: { ok: true },
        get_toolsets: [],
        // Plugins
        get_dashboard_plugins: [],
        rescan_dashboard_plugins: { ok: true, count: 0 },
        get_plugins_hub: {
          plugins: [], orphan_dashboard_plugins: [],
          providers: { memory_provider: "", memory_options: [], context_engine: "", context_options: [] },
        },
        install_agent_plugin: { ok: true },
        set_agent_plugin_enabled: { ok: true },
        update_agent_plugin: { ok: true },
        remove_agent_plugin: { ok: true },
        save_plugin_providers: { ok: true },
        set_plugin_visibility: { ok: true },
        // MCP
        get_mcp_hub: { servers: [], presets: {} },
        install_mcp_server: { ok: true },
        remove_mcp_server: { ok: true },
        test_mcp_server: { ok: true },
        // Scheduler — returns array directly
        cron_list: [],
        cron_create: { ok: true },
        cron_update: { ok: true },
        cron_pause: { ok: true },
        cron_resume: { ok: true },
        cron_trigger: { ok: true },
        cron_delete: { ok: true },
      };
      return action in defaults ? defaults[action] : { ok: true };
    }
    const bridgePath = desktopSourcePath("dashboard_bridge.py");
    const timeout = String(action || "").includes("mcp") ? 180000 : 60000;
    const result = this.processManager.spawnSync(this.pythonPath, [bridgePath, action], {
      cwd: this.projectRoot,
      env: this.childEnv({
        HERMES_HOME: this.hermesHome,
        REDOU_APP_DATA_ROOT: this.appDataRoot(),
        PYTHONUTF8: "1",
        PYTHONUNBUFFERED: "1",
      }),
      input: JSON.stringify(payload || {}),
      encoding: "utf8",
      shell: false,
      timeout,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });

    if (result.error) {
      throw result.error;
    }

    let parsed = null;
    if (result.stdout && result.stdout.trim()) {
      parsed = this.parseBridgeJson(result.stdout);
    }

    if (result.status !== 0) {
      const message =
        (parsed && parsed.error) ||
        compact(redact(result.stderr || result.stdout || `exit code ${result.status}`), 500);
      throw new Error(message);
    }

    if (parsed && parsed.ok === false && parsed.error) {
      throw new Error(parsed.error);
    }

    return parsed;
  }

  projectProfileHomesForBridge() {
    return this.readAllProjects()
      .map((project) => ({
        profile: project.hermesProfile,
        profileHome: this.projectHermesHome(project),
        projectId: project.id,
        projectName: project.name,
        workspacePath: project.path || project.workspace_path || "",
      }))
      .filter((item) => item.profile && item.profileHome);
  }

}

function installRuntimeCoreMethods(target) {
  for (const name of Object.getOwnPropertyNames(RuntimeCoreMethods.prototype)) {
    if (name === "constructor") continue;
    Object.defineProperty(target.prototype, name, Object.getOwnPropertyDescriptor(RuntimeCoreMethods.prototype, name));
  }
}

module.exports = { installRuntimeCoreMethods };
