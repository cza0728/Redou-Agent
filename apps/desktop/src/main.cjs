const { app, BrowserWindow, Menu, dialog, ipcMain, shell, clipboard } = require("electron");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { autoUpdater } = require("electron-updater");
const { RedouLocalService } = require("./services/redouLocalService.cjs");
const {
  GIT_BASH_ENV,
  describePlatformPrerequisites,
  isWindowsShellScript,
  resolveGitBashPath,
  resolveNpm,
  resolveCodex,
  runtimePathExtras,
} = require("./platformRuntime.cjs");

const PRODUCT_NAME = "Redou Agent";

let mainWindow = null;
let localService = null;
let statusLines = [];
let logFile = null;
let rendererLoaded = false;
let rendererLoading = false;
let statusPageReady = false;
let statusPageLoadPromise = null;
let statusPageGeneration = 0;
let statusUpdateTimer = null;
let currentStatusTitle = "Starting";
let shutdownComplete = false;
let activeCodexPath = null;
let updaterConfigured = false;
let updateInProgress = false;

function projectRoot() {
  if (app.isPackaged) {
    return process.resourcesPath;
  }
  return path.resolve(__dirname, "..", "..", "..");
}

function hermesRoot() {
  // Legacy path kept for data compatibility (config.yaml, web_dist, etc.)
  return path.join(projectRoot(), "vendor", "hermes");
}

function runtimeRoot() {
  return path.join(app.getPath("userData"), "runtime");
}

function desktopAssetPath(...segments) {
  return path.join(__dirname, "..", "assets", ...segments);
}

function windowIconPath() {
  return process.platform === "win32"
    ? desktopAssetPath("icons", "redou-agent.ico")
    : desktopAssetPath("icons", "redou-agent.png");
}

function hermesHome() {
  return path.join(app.getPath("userData"), "hermes-home");
}

function clipboardImageAttachmentName(now = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join("") + "-" + [pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds())].join("");
  return `clipboard-image-${stamp}.png`;
}

function sanitizeEnvValue(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\0/g, "");
}

function sanitizeEnvObject(env = {}) {
  const clean = {};
  for (const [key, value] of Object.entries(env || {})) {
    if (!key || key.includes("\0") || value === undefined || value === null) continue;
    clean[key] = sanitizeEnvValue(value);
  }
  return clean;
}

function withRuntimePath(env = process.env) {
  const cleanEnv = sanitizeEnvObject(env);
  const gitBashPath = resolveGitBashPath();
  const extras = runtimePathExtras();
  const runtimeEnv = sanitizeEnvObject({
    ...cleanEnv,
    PATH: [...extras, cleanEnv.PATH || ""].join(path.delimiter),
    REDOU_APP_DATA_ROOT: localService ? localService.appDataRoot() : path.join(app.getPath("userData"), "appData"),
    REDOU_PROJECT_ROOT: projectRoot(),
    CODEX_BINARY: activeCodexPath || "codex",
  });
  if (gitBashPath) {
    runtimeEnv[GIT_BASH_ENV] = gitBashPath;
  }
  return runtimeEnv;
}

function getLocalService() {
  if (!localService) {
    localService = new RedouLocalService({
      app,
      projectRoot: projectRoot(),
      hermesRoot: hermesRoot(),
      hermesHome: hermesHome(),
      log: pushStatus,
    });
  }
  return localService;
}

function stopActivityForShutdown(reason = "Redou Agent is closing; stopping Codex runtime.") {
  if (shutdownComplete || !localService) return;
  shutdownComplete = true;
  try {
    const result = typeof localService.dispose === "function"
      ? localService.dispose(reason)
      : localService.stopAllHermesActivity(reason);
    const stoppedCount =
      (result.stoppedRuns?.length || 0) + (result.stoppedAnalysisRuns?.length || 0);
    if (stoppedCount > 0 || result.queuedMessages > 0 || result.queuedAnalysisRuns > 0) {
      pushStatus(
        `Stopped activity before exit: runs=${stoppedCount}, queued=${result.queuedMessages || 0}, analysisQueued=${result.queuedAnalysisRuns || 0}`,
      );
    }
  } catch (error) {
    pushStatus(`Shutdown cleanup failed: ${error && error.stack ? error.stack : String(error)}`);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildStatusHtml(title = "Starting") {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${PRODUCT_NAME}</title>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #061612;
      color: #f5f0df;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: min(840px, calc(100vw - 48px));
      border: 1px solid rgba(245, 240, 223, .24);
      background: rgba(4, 22, 18, .86);
      padding: 32px;
    }
    h1 {
      margin: 0 0 10px;
      font-size: 24px;
      letter-spacing: 0;
      font-weight: 700;
    }
    p {
      margin: 0 0 22px;
      color: rgba(245, 240, 223, .72);
    }
    pre {
      margin: 0;
      min-height: 260px;
      max-height: 54vh;
      overflow: auto;
      white-space: pre-wrap;
      color: #b9d8ca;
      font: 13px/1.55 ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
    }
  </style>
</head>
<body>
  <main>
    <h1 data-status-title>${escapeHtml(title)}</h1>
    <p>Preparing the native Redou Agent runtime.</p>
    <pre data-status-lines>${escapeHtml(statusLines.join("\n"))}</pre>
  </main>
</body>
</html>`;
}

function clearStatusUpdateTimer() {
  if (!statusUpdateTimer) return;
  clearTimeout(statusUpdateTimer);
  statusUpdateTimer = null;
}

function scheduleStatusContentUpdate() {
  if (rendererLoaded || rendererLoading || !statusPageReady) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (statusUpdateTimer) return;
  statusUpdateTimer = setTimeout(() => {
    statusUpdateTimer = null;
    if (rendererLoaded || rendererLoading || !statusPageReady) return;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const script = `(() => {
      const titleNode = document.querySelector("[data-status-title]");
      const linesNode = document.querySelector("[data-status-lines]");
      if (titleNode) titleNode.textContent = ${JSON.stringify(currentStatusTitle)};
      if (linesNode) linesNode.textContent = ${JSON.stringify(statusLines.join("\n"))};
    })();`;
    mainWindow.webContents.executeJavaScript(script, true).catch(() => {});
  }, 50);
}

function renderStatus(title = "Starting") {
  if (rendererLoaded || rendererLoading) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  currentStatusTitle = title;
  if (statusPageReady) {
    scheduleStatusContentUpdate();
    return;
  }
  if (statusPageLoadPromise) return;

  const generation = statusPageGeneration;
  const targetWindow = mainWindow;
  const statusUrl = `data:text/html;charset=utf-8,${encodeURIComponent(buildStatusHtml(title))}`;
  statusPageLoadPromise = targetWindow
    .loadURL(statusUrl)
    .then(() => {
      if (generation !== statusPageGeneration || targetWindow !== mainWindow) return;
      if (rendererLoaded || rendererLoading) return;
      statusPageReady = true;
      scheduleStatusContentUpdate();
    })
    .catch(() => {
      // A later renderer navigation can cancel the transient status page load.
    })
    .finally(() => {
      if (generation === statusPageGeneration && targetWindow === mainWindow) {
        statusPageLoadPromise = null;
      }
    });
}

function pushStatus(line) {
  statusLines.push(line);
  statusLines = statusLines.slice(-120);
  if (logFile) {
    try {
      fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`, "utf8");
    } catch (_error) {
      // Logging must never stop app startup.
    }
  }
  renderStatus(line || "Starting Redou Agent");
}

function createWindow() {
  rendererLoaded = false;
  rendererLoading = false;
  statusPageReady = false;
  statusPageLoadPromise = null;
  statusPageGeneration += 1;
  clearStatusUpdateTimer();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    title: PRODUCT_NAME,
    icon: windowIconPath(),
    backgroundColor: "#061612",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Debug: open DevTools
  mainWindow.webContents.openDevTools();

  mainWindow.on("closed", () => {
    mainWindow = null;
    statusPageReady = false;
    statusPageLoadPromise = null;
    clearStatusUpdateTimer();
  });
}

function formatErrorMessage(error) {
  if (!error) return "Unknown error";
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

function configureAutoUpdater() {
  if (updaterConfigured) return;
  updaterConfigured = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (message) => pushStatus(`[update] ${message}`),
    warn: (message) => pushStatus(`[update] ${message}`),
    error: (message) => pushStatus(`[update] ${message}`),
    debug: (message) => pushStatus(`[update] ${message}`),
  };
  autoUpdater.on("checking-for-update", () => pushStatus("Checking for Redou Agent updates..."));
  autoUpdater.on("update-available", (info) =>
    pushStatus(`Redou Agent update available: ${info.version || "unknown"}`),
  );
  autoUpdater.on("update-not-available", () =>
    pushStatus(`Redou Agent is already up to date (${app.getVersion()}).`),
  );
  autoUpdater.on("download-progress", (progress) => {
    const percent = Number.isFinite(progress?.percent) ? progress.percent.toFixed(1) : "?";
    pushStatus(`Downloading Redou Agent update... ${percent}%`);
  });
  autoUpdater.on("update-downloaded", (info) =>
    pushStatus(`Redou Agent update downloaded: ${info.version || "unknown"}`),
  );
  autoUpdater.on("error", (error) =>
    pushStatus(`Redou Agent update failed: ${formatErrorMessage(error)}`),
  );
}

async function handleAppUpdate() {
  if (!app.isPackaged) {
    return {
      name: "redou-update",
      ok: false,
      pid: 0,
      message: "Updates are only available in the packaged Redou Agent app.",
    };
  }
  if (updateInProgress) {
    return {
      name: "redou-update",
      ok: false,
      pid: 0,
      message: "An update check is already running.",
    };
  }

  updateInProgress = true;
  configureAutoUpdater();
  try {
    const checkResult = await autoUpdater.checkForUpdates();
    const updateInfo = checkResult?.updateInfo;
    if (!updateInfo || updateInfo.version === app.getVersion()) {
      return {
        name: "redou-update",
        ok: true,
        pid: 0,
        message: `Redou Agent is already up to date (${app.getVersion()}).`,
      };
    }

    await autoUpdater.downloadUpdate();
    const version = updateInfo.version || "the latest version";
    const result = await dialog.showMessageBox(mainWindow, {
      type: "info",
      buttons: ["Restart and install", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Redou Agent update ready",
      message: `Redou Agent ${version} is ready to install.`,
      detail: "Redou Agent will close and restart to finish the update.",
      noLink: true,
    });

    if (result.response === 0) {
      setImmediate(() => autoUpdater.quitAndInstall(false, true));
      return {
        name: "redou-update",
        ok: true,
        pid: 0,
        message: `Installing Redou Agent ${version}.`,
      };
    }

    return {
      name: "redou-update",
      ok: true,
      pid: 0,
      message: `Redou Agent ${version} was downloaded and will install when the app exits.`,
    };
  } catch (error) {
    return {
      name: "redou-update",
      ok: false,
      pid: 0,
      message: formatErrorMessage(error),
    };
  } finally {
    updateInProgress = false;
  }
}

ipcMain.handle("redou:pick-directory", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory", "createDirectory"],
    title: "Select project workspace",
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("redou:pick-files", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile", "multiSelections"],
    title: "Select local attachments",
  });
  if (result.canceled || result.filePaths.length === 0) return [];
  return result.filePaths;
});

ipcMain.handle("redou:paths:open", async (_event, targetPath) => {
  const rawPath = String(targetPath || "").trim();
  if (!rawPath) {
    return { ok: false, message: "Path is empty." };
  }

  const resolvedPath = path.resolve(rawPath);
  if (!fs.existsSync(resolvedPath)) {
    return { ok: false, message: `Path not found: ${resolvedPath}` };
  }

  const errorMessage = await shell.openPath(resolvedPath);
  if (errorMessage) {
    return { ok: false, message: errorMessage, path: resolvedPath };
  }
  return { ok: true, path: resolvedPath };
});

ipcMain.handle("redou:app:update", () => handleAppUpdate());

ipcMain.handle("redou:projects:list", () => getLocalService().getChatProjects());

ipcMain.handle("redou:projects:create", (_event, body) =>
  getLocalService().createChatProject(body),
);

ipcMain.handle("redou:projects:update", (_event, projectId, body) =>
  getLocalService().updateChatProject(projectId, body),
);

ipcMain.handle("redou:projects:delete", (_event, projectId) =>
  getLocalService().deleteChatProject(projectId),
);

ipcMain.handle("redou:projects:select", (_event, projectId) =>
  getLocalService().setActiveChatProject(projectId),
);

ipcMain.handle("redou:tasks:create", (_event, projectId, body) =>
  getLocalService().createChatTask(projectId, body),
);

ipcMain.handle("redou:tasks:update", (_event, projectId, taskId, body) =>
  getLocalService().updateChatTask(projectId, taskId, body),
);

ipcMain.handle("redou:tasks:delete", (_event, projectId, taskId) =>
  getLocalService().deleteChatTask(projectId, taskId),
);

ipcMain.handle("redou:tasks:select", (_event, projectId, taskId) =>
  getLocalService().setActiveChatTask(projectId, taskId),
);

ipcMain.handle("redou:tasks:messages", (_event, projectId, taskId) =>
  getLocalService().getChatTaskMessages(projectId, taskId),
);

ipcMain.handle("redou:tasks:package-skill", (_event, projectId, taskId) =>
  getLocalService().packageTaskSkill(projectId, taskId),
);

ipcMain.handle("redou:tasks:extract-rules", (_event, projectId, taskId, target) =>
  getLocalService().extractTaskContextRules(projectId, taskId, target),
);

ipcMain.handle("redou:sessions:list", (_event, limit, offset) =>
  getLocalService().getSessions(limit, offset),
);

ipcMain.handle("redou:sessions:messages", (_event, sessionId) =>
  getLocalService().getSessionMessages(sessionId),
);

ipcMain.handle("redou:tasks:attachments:copy", (_event, projectId, taskId, filePaths) =>
  getLocalService().copyTaskAttachments(projectId, taskId, filePaths),
);

ipcMain.handle("redou:tasks:attachments:paste-clipboard-image", (_event, projectId, taskId) => {
  const service = getLocalService();
  const image = clipboard.readImage();
  if (image.isEmpty()) {
    const result = service.copyTaskAttachmentBuffers(projectId, taskId, []);
    return {
      ...result,
      warnings: [...result.warnings, "Clipboard does not contain an image."],
    };
  }

  const png = image.toPNG();
  if (!png.length) {
    const result = service.copyTaskAttachmentBuffers(projectId, taskId, []);
    return {
      ...result,
      warnings: [...result.warnings, "Clipboard image could not be read."],
    };
  }

  return service.copyTaskAttachmentBuffers(projectId, taskId, [
    {
      name: clipboardImageAttachmentName(),
      data: png,
      mimeType: "image/png",
      originalPath: "clipboard",
      metadata: { source: "clipboard" },
    },
  ]);
});

ipcMain.handle("redou:context:global:get", (_event, kind) =>
  getLocalService().getGlobalContextFile(kind),
);

ipcMain.handle("redou:context:global:update", (_event, kind, content) =>
  getLocalService().updateGlobalContextFile(kind, content),
);

ipcMain.handle("redou:context:project:get", (_event, projectId, kind) =>
  getLocalService().getProjectContextFile(projectId, kind),
);

ipcMain.handle("redou:context:project:update", (_event, projectId, kind, content) =>
  getLocalService().updateProjectContextFile(projectId, kind, content),
);

ipcMain.handle("redou:context:task:get", (_event, projectId, taskId, kind) =>
  getLocalService().getTaskContextFile(projectId, taskId, kind),
);

ipcMain.handle("redou:context:task:update", (_event, projectId, taskId, kind, content) =>
  getLocalService().updateTaskContextFile(projectId, taskId, kind, content),
);

ipcMain.handle("redou:context:task:build", (_event, input) =>
  getLocalService().buildTaskContext(input),
);

ipcMain.handle("redou:chat:send", (event, input) =>
  getLocalService().sendMessage(event.sender, input),
);

ipcMain.handle("redou:chat:queue:update", (event, input) =>
  getLocalService().updateQueuedMessage(event.sender, input),
);

ipcMain.handle("redou:chat:risk-approval", (event, input) =>
  getLocalService().resolveRiskApproval(event.sender, input),
);

ipcMain.handle("redou:chat:stop", (event, runId) =>
  getLocalService().stopRun(runId, event.sender),
);

ipcMain.handle("redou:chat:stop-task", (event, projectId, taskId) =>
  getLocalService().stopTaskRun(projectId, taskId, event.sender),
);

ipcMain.handle("redou:status", () => ({
  ...getLocalService().getStatus(),
  version: typeof app.getVersion === "function" ? app.getVersion() : "unknown",
}));

ipcMain.handle("redou:config:get", () => getLocalService().getConfig());
ipcMain.handle("redou:config:defaults", () => getLocalService().getConfigDefaults());
ipcMain.handle("redou:config:schema", () => getLocalService().getConfigSchema());
ipcMain.handle("redou:config:save", (_event, config) => getLocalService().saveConfig(config));
ipcMain.handle("redou:config:raw:get", () => getLocalService().getConfigRaw());
ipcMain.handle("redou:config:raw:save", (_event, yamlText) =>
  getLocalService().saveConfigRaw(yamlText),
);
ipcMain.handle("redou:skills:list", () => getLocalService().getSkills());
ipcMain.handle("redou:skills:toggle", (_event, name, enabled, scope) =>
  getLocalService().toggleSkill(name, enabled, scope),
);
ipcMain.handle("redou:skills:delete", (_event, skill) =>
  getLocalService().deleteSkill(skill),
);
ipcMain.handle("redou:skills:merge", (_event, skills) =>
  getLocalService().mergeSkills(skills),
);
ipcMain.handle("redou:toolsets:list", () => getLocalService().getToolsets());
ipcMain.handle("redou:model-info", () => getLocalService().getModelInfo());
ipcMain.handle("redou:model-setup-catalog", () => getLocalService().getModelSetupCatalog());
ipcMain.handle("redou:model-options", () => getLocalService().getModelOptions());
ipcMain.handle("redou:model-auxiliary", () => getLocalService().getAuxiliaryModels());
ipcMain.handle("redou:model-set", (_event, body) => getLocalService().setModelAssignment(body));
ipcMain.handle("redou:model-setup-refresh", (_event, body) =>
  getLocalService().refreshModelSetupModels(body),
);
ipcMain.handle("redou:model-setup", (_event, body) => getLocalService().setupMainModel(body));
ipcMain.handle("redou:model-delete-key", (_event, provider, apiKeyEnv) =>
  getLocalService().deleteModelApiKey(provider, apiKeyEnv),
);
ipcMain.handle("redou:model-hide-benchmark", (_event, modelKey) =>
  getLocalService().hideBenchmarkModel(modelKey),
);
ipcMain.handle("redou:analytics:models", (_event, days) =>
  getLocalService().getModelsAnalytics(days),
);
ipcMain.handle("redou:analytics:usage", (_event, days) =>
  getLocalService().getUsageAnalytics(days),
);
ipcMain.handle("redou:logs", (_event, params) => getLocalService().getLogs(params));
ipcMain.handle("redou:cron:list", () => getLocalService().getCronJobs());
ipcMain.handle("redou:cron:create", (_event, job) => getLocalService().createCronJob(job));
ipcMain.handle("redou:cron:pause", (_event, id) => getLocalService().pauseCronJob(id));
ipcMain.handle("redou:cron:resume", (_event, id) => getLocalService().resumeCronJob(id));
ipcMain.handle("redou:cron:trigger", (_event, id) => getLocalService().triggerCronJob(id));
ipcMain.handle("redou:cron:delete", (_event, id) => getLocalService().deleteCronJob(id));
ipcMain.handle("redou:theme:list", () => getLocalService().getThemes());
ipcMain.handle("redou:theme:set", (_event, name) => getLocalService().setTheme(name));
ipcMain.handle("redou:language:get", () => getLocalService().getLanguage());
ipcMain.handle("redou:language:set", (_event, language) =>
  getLocalService().setLanguage(language),
);
ipcMain.handle("redou:plugins:manifests", () => getLocalService().getDashboardPlugins());
ipcMain.handle("redou:plugins:rescan", () => getLocalService().rescanDashboardPlugins());
ipcMain.handle("redou:plugins:hub", () => getLocalService().getPluginsHub());
ipcMain.handle("redou:mcp:hub", () => getLocalService().getMcpHub());
ipcMain.handle("redou:mcp:install", (_event, body) =>
  getLocalService().installMcpServer(body),
);
ipcMain.handle("redou:mcp:remove", (_event, name) =>
  getLocalService().removeMcpServer(name),
);
ipcMain.handle("redou:mcp:test", (_event, name) =>
  getLocalService().testMcpServer(name),
);
ipcMain.handle("redou:plugins:install", (_event, body) =>
  getLocalService().installAgentPlugin(body),
);
ipcMain.handle("redou:plugins:enable", (_event, name) =>
  getLocalService().enableAgentPlugin(name),
);
ipcMain.handle("redou:plugins:disable", (_event, name) =>
  getLocalService().disableAgentPlugin(name),
);
ipcMain.handle("redou:plugins:update", (_event, name) =>
  getLocalService().updateAgentPlugin(name),
);
ipcMain.handle("redou:plugins:remove", (_event, name) =>
  getLocalService().removeAgentPlugin(name),
);
ipcMain.handle("redou:plugins:providers:save", (_event, body) =>
  getLocalService().savePluginProviders(body),
);
ipcMain.handle("redou:plugins:visibility", (_event, name, hidden) =>
  getLocalService().setPluginVisibility(name, hidden),
);
ipcMain.handle("redou:analysis:benchmarks", () =>
  getLocalService().getAnalysisBenchmarks(),
);
ipcMain.handle("redou:analysis:start", (event, body) =>
  getLocalService().startAnalysisBenchmarks(event.sender, body),
);
ipcMain.handle("redou:analysis:stop", (_event, key) =>
  getLocalService().stopAnalysisBenchmark(key),
);
ipcMain.handle("redou:analysis:logs-list", () =>
  getLocalService().getAnalysisLogsList(),
);
ipcMain.handle("redou:analysis:log-detail", (_event, key) =>
  getLocalService().getAnalysisLogDetail(key),
);
ipcMain.handle("redou:analysis:log-chat", (_event, body) =>
  getLocalService().chatWithAnalysisLog(body),
);
ipcMain.handle("redou:analysis:log-chat-clear", (_event, sessionKey) =>
  getLocalService().clearAnalysisLogChat(sessionKey),
);
ipcMain.handle("redou:analysis:log-chat-history", (_event, sessionKey) =>
  getLocalService().getAnalysisLogChatHistory(sessionKey),
);

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function safeRemoveRuntimeChild(targetPath) {
  const runtimePath = path.resolve(runtimeRoot());
  const resolvedTarget = path.resolve(targetPath);
  if (resolvedTarget === runtimePath || !resolvedTarget.startsWith(`${runtimePath}${path.sep}`)) {
    throw new Error(`Refusing to remove path outside runtime root: ${resolvedTarget}`);
  }
  fs.rmSync(resolvedTarget, { recursive: true, force: true });
}


function runLogged(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const runtimeEnv = withRuntimePath(options.env || process.env);
    const usesShell = isWindowsShellScript(command);
    pushStatus(`> ${command} ${args.join(" ")}`);
    const child = spawn(command, args, {
      cwd: options.cwd || projectRoot(),
      env: runtimeEnv,
      windowsHide: true,
      shell: usesShell,
    });

    child.stdout.on("data", (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) {
        pushStatus(line);
      }
    });
    child.stderr.on("data", (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) {
        pushStatus(line);
      }
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

function ensureCodexRuntime() {
  fs.mkdirSync(runtimeRoot(), { recursive: true });
  fs.mkdirSync(hermesHome(), { recursive: true });

  const codexBin = resolveCodex({ env: withRuntimePath(process.env) });
  if (!codexBin) {
    throw new Error(
      "Codex CLI is not installed. Please install it:\n"
      + "  npm install -g @openai/codex\n"
      + "Or download from: https://github.com/openai/codex/releases"
    );
  }
  activeCodexPath = codexBin;
  pushStatus(`Codex CLI found at ${codexBin}`);
  return codexBin;
}

async function ensureNodeRuntime() {
  const webDir = path.join(hermesRoot(), "web");
  const webEntry = path.join(hermesRoot(), "hermes_cli", "web_dist", "index.html");

  if (fs.existsSync(webEntry)) {
    return;
  }

  if (app.isPackaged) {
    throw new Error(
      `Bundled renderer was not found: ${webEntry}. Rebuild the installer with the renderer included.`,
    );
  }

  if (!fs.existsSync(webDir)) {
    throw new Error(`Renderer source directory was not found: ${webDir}`);
  }

  const npm = resolveNpm({ env: withRuntimePath(process.env) });
  if (!fs.existsSync(path.join(webDir, "node_modules"))) {
    pushStatus("Installing Redou Agent renderer dependencies...");
    await runLogged(npm, ["install", "--no-fund", "--no-audit", "--progress=false"], {
      cwd: webDir,
    });
  }
  pushStatus("Building Redou Agent renderer...");
  await runLogged(npm, ["run", "build"], { cwd: webDir });
}

async function loadRenderer() {
  const indexPath = path.join(hermesRoot(), "hermes_cli", "web_dist", "index.html");
  if (!fs.existsSync(indexPath)) {
    throw new Error(`Renderer build not found: ${indexPath}`);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    rendererLoading = true;
    statusPageReady = false;
    statusPageLoadPromise = null;
    statusPageGeneration += 1;
    clearStatusUpdateTimer();
    try {
      await mainWindow.loadFile(indexPath, { hash: "/workspace" });
      rendererLoaded = true;
    } finally {
      rendererLoading = false;
    }
  }
}

async function boot() {
  try {
    renderStatus("Starting Redou Agent");
    const gitBash = resolveGitBashPath({ required: process.platform === "win32" });
    if (gitBash) pushStatus(`Git Bash ready at ${gitBash}`);
    const codexBin = ensureCodexRuntime();
    const service = getLocalService();
    service.setCodexPath(codexBin);
    service.ensureInitialized();
    await ensureNodeRuntime();
    pushStatus("Opening local Renderer UI");
    await loadRenderer();
  } catch (error) {
    rendererLoaded = false;
    pushStatus("");
    pushStatus(`Required runtime dependencies: ${describePlatformPrerequisites()}`);
    pushStatus(error && error.stack ? error.stack : String(error));
    renderStatus("Redou Agent could not start");
  }
}

app.whenReady().then(() => {
  const logDir = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(logDir, { recursive: true });
  logFile = path.join(logDir, "desktop-main.log");
  fs.writeFileSync(logFile, `${new Date().toISOString()} ${PRODUCT_NAME} boot\n`, "utf8");

  process.on("uncaughtException", (error) => {
    pushStatus(error && error.stack ? error.stack : String(error));
  });
  process.on("unhandledRejection", (error) => {
    pushStatus(error && error.stack ? error.stack : String(error));
  });

  Menu.setApplicationMenu(null);
  createWindow();
  boot();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      boot();
    }
  });
});

app.on("before-quit", () => {
  stopActivityForShutdown();
});

app.on("will-quit", () => {
  stopActivityForShutdown();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    stopActivityForShutdown();
    app.quit();
  }
});
