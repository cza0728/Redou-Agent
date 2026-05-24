const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  assertChildPath,
  copyDirectoryRecursive,
  copyFileAtomic,
  isTransientFileError,
  mkdirp,
  readJson,
  readText,
  removeDirectoryWithRetries,
  writeJsonAtomic,
} = require("../shared/fileUtils.cjs");
const { compact, compactMultiline, regexEscape, safeSegment } = require("../shared/textUtils.cjs");
const { isoNow } = require("../shared/timeUtils.cjs");
const { yamlString } = require("../shared/yamlUtils.cjs");
const { redact, toInt } = require("../context/contextUtils.cjs");
const {
  ANALYSIS_ABILITY_KEYS,
  ANALYSIS_DEFAULT_MAX_ITERATIONS,
  ANALYSIS_DOCKER_WORKSPACE,
  ANALYSIS_RESULTS_FILE,
  ANALYSIS_TASKS,
  ANALYSIS_WORKSPACE_PROJECT_ID,
  ANALYSIS_WORKSPACE_PROJECT_NAME,
  ANALYSIS_WORKSPACE_TASK_KIND,
  analysisComposeHasService,
  analysisComposeHasWorkspaceMount,
  analysisDisplayResultsDir,
  analysisDockerEnvironmentName,
  analysisFinalScoreFromLog,
  analysisLatestMigratedTaskSummary,
  analysisMigratedTaskScore,
  analysisMigratedTaskSectionsFromSummary,
  analysisModelRunName,
  analysisTaskBatchScript,
  analysisTaskDisplayArtifacts,
  analysisTaskGradeLogText,
  analysisTaskProcessStatus,
  analysisTaskPromptPath,
  analysisTaskSectionsFromGradeLog,
  averageScore,
  clampScore,
  commandText,
  countHttpLinks,
  firstExistingRelativePath,
  hasAny,
  hasContainerExecCommand,
  isAnalysisModelCallFailure,
  isMissingDockerContainerOutput,
  listFilesRecursive,
  modelBenchmarkKey,
  normalizeAnalysisMaxIterations,
  normalizeAnalysisTaskStatus,
  normalizeAnalysisWorkspaceScript,
  normalizeAnalysisWorkspaceScriptsInPlace,
  pathExists,
  pathExistsAny,
  readDotEnv,
  readRelativeText,
  readRelativeTextAny,
  readRootAgentMaxTurns,
  replaceAnalysisDockerEnvironment,
  sectionScore,
  shellQuoteSingle,
} = require("./benchmarkUtils.cjs");

const REDOU_CONTEXT_DIR = ".redou";
const REDOU_ANALYSIS_DIR = "analysis";

class AnalysisStateMethods {
  analysisDir() {
    return path.join(this.appDataRoot(), "analysis");
  }

  analysisStorePath() {
    return path.join(this.analysisDir(), ANALYSIS_RESULTS_FILE);
  }

  analysisWorkspaceRoot() {
    return path.join(this.analysisDir(), "workspaces");
  }

  ensureAnalysisWorkspaceProject() {
    const workspacePath = this.analysisWorkspaceRoot();
    mkdirp(workspacePath);
    const existing = this.readProject(ANALYSIS_WORKSPACE_PROJECT_ID);
    if (existing) {
      const existingPath = String(existing.path || existing.workspace_path || "").trim();
      const pathAlreadyMatches =
        existingPath && path.resolve(existingPath) === path.resolve(workspacePath);
      const nextUpdatedAt = pathAlreadyMatches ? existing.updatedAt : isoNow();
      return this.ensureProject({
        ...existing,
        name: existing.name || ANALYSIS_WORKSPACE_PROJECT_NAME,
        path: workspacePath,
        workspace_path: workspacePath,
        updatedAt: nextUpdatedAt,
      });
    }
    const createdAt = isoNow();
    return this.ensureProject({
      id: ANALYSIS_WORKSPACE_PROJECT_ID,
      name: ANALYSIS_WORKSPACE_PROJECT_NAME,
      path: workspacePath,
      workspace_path: workspacePath,
      createdAt,
      updatedAt: createdAt,
      tasks: [],
    });
  }

  removeAnalysisWorkspacePath(target, label) {
    const targetPath = assertChildPath(this.analysisWorkspaceRoot(), target, label);
    if (!fs.existsSync(targetPath)) return "";
    removeDirectoryWithRetries(targetPath);
    return targetPath;
  }

  removeAnalysisDataPath(target, label) {
    const targetPath = assertChildPath(this.analysisDir(), target, label);
    if (!fs.existsSync(targetPath)) return "";
    removeDirectoryWithRetries(targetPath);
    return targetPath;
  }

  removeAnalysisStoreFile() {
    const storePath = assertChildPath(this.analysisDir(), this.analysisStorePath(), "analysis results");
    if (!fs.existsSync(storePath)) return "";
    fs.rmSync(storePath, { force: true });
    return storePath;
  }

  deleteAnalysisWorkspaceProjectData() {
    const deletedPaths = [];
    const workspacePath = this.removeAnalysisDataPath(this.analysisWorkspaceRoot(), "analysis workspaces");
    if (workspacePath) deletedPaths.push(workspacePath);
    const storePath = this.removeAnalysisStoreFile();
    if (storePath) deletedPaths.push(storePath);
    return { deletedPaths };
  }

  deleteAnalysisWorkspaceTaskData(task = {}) {
    const key = String(task.analysisKey || "").trim();
    const runId = String(task.analysisRunId || "").trim();
    if (!key && !runId) return { deletedPaths: [], removedResults: 0 };

    const store = this.readAnalysisStore();
    const removedResults = [];
    const remainingResults = [];
    for (const result of store.results) {
      const matchesRun = runId && result.runId === runId;
      const matchesKey = !runId && key && result.key === key;
      if (matchesRun || matchesKey) {
        removedResults.push(result);
      } else {
        remainingResults.push(result);
      }
    }

    const deletedPaths = [];
    for (const result of removedResults) {
      const workspacePath = String(result.workspacePath || "").trim();
      if (!workspacePath) continue;
      const deleted = this.removeAnalysisWorkspacePath(workspacePath, "analysis task workspace");
      if (deleted) deletedPaths.push(deleted);
    }

    if (removedResults.length > 0) {
      if (remainingResults.length > 0) {
        this.writeAnalysisStore({ ...store, results: remainingResults });
      } else {
        const storePath = this.removeAnalysisStoreFile();
        if (storePath) deletedPaths.push(storePath);
      }
    }

    return { deletedPaths, removedResults: removedResults.length };
  }

  createAnalysisWorkspaceTask(model, runId, maxIterations) {
    const project = this.ensureAnalysisWorkspaceProject();
    const createdAt = isoNow();
    const provider = String(model.provider || "").trim();
    const modelName = String(model.model || "").trim();
    const key = String(model.key || modelBenchmarkKey(provider, modelName));
    const title = `Benchmark: ${provider || "auto"} / ${modelName || "default"}`;
    const id = safeSegment(`benchmark-${key}-${runId}`, `benchmark-${Date.now().toString(36)}`);
    const existing = (project.tasks || []).find((task) => task.id === id);
    const task = existing || this.ensureTask(project, {
      id,
      projectId: project.id,
      title,
      createdAt,
      updatedAt: createdAt,
      kind: ANALYSIS_WORKSPACE_TASK_KIND,
      analysisKey: key,
      analysisRunId: runId,
      analysisProvider: provider,
      analysisModel: modelName,
      model_provider: provider,
      model: modelName,
    });
    const saved = this.writeProject({
      ...project,
      updatedAt: createdAt,
      tasks: existing ? project.tasks : [...project.tasks, task],
    });
    const savedTask = saved.tasks.find((item) => item.id === id) || task;
    if (!existing) {
      this.appendTaskMessage(
        saved.id,
        savedTask.id,
        "user",
        `Run model capability benchmark for ${provider || "auto"} / ${modelName || "default"}.`,
        {
          analysisRunId: runId,
          analysisKey: key,
          modelProvider: provider,
          model: modelName,
          maxIterations,
        },
      );
    }
    return { project: saved, task: savedTask };
  }

  analysisWorkspaceEventMetadata(item, extra = {}) {
    return {
      runId: item.runId,
      analysisRunId: item.runId,
      analysisKey: item.key,
      modelProvider: item.provider,
      model: item.model,
      hermesProfile: "analysis",
      ...extra,
    };
  }

  persistAnalysisWorkspaceEvent(item, event) {
    if (!item?.projectId || !item?.taskId) return null;
    item.analysisLastActiveAtMs = Date.now();
    const metadata = event.metadata && typeof event.metadata === "object" ? event.metadata : {};
    const payload = {
      ...event,
      metadata: this.analysisWorkspaceEventMetadata(item, metadata),
    };
    try {
      return this.persistEvent(item.projectId, item.taskId, payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Could not persist analysis workspace event runId=${item.runId || ""}: ${message}`);
      return null;
    }
  }

  syncAnalysisWorkspaceQueued(item) {
    this.persistAnalysisWorkspaceEvent(item, {
      type: "queue_update",
      queued: 1,
      message: "Queued for model capability analysis.",
      metadata: { queuedAt: item.queuedAt },
    });
  }

  syncAnalysisWorkspaceTaskPlan(item) {
    ANALYSIS_TASKS.forEach((task, index) => {
      this.syncAnalysisWorkspaceTaskStage(item, task, "pending", "Waiting", {
        planIndex: index + 1,
        planTotal: ANALYSIS_TASKS.length,
      });
    });
  }

  syncAnalysisWorkspaceStarted(item, workspacePath, analysisEnvName) {
    this.persistAnalysisWorkspaceEvent(item, {
      type: "raw_log",
      content: "Model capability benchmark started.",
      metadata: {
        workspacePath,
        analysisEnvName,
      },
    });
  }

  syncAnalysisWorkspaceTaskStage(item, task, status, summary = "", extra = {}) {
    const cleanStatus = String(status || "running").toLowerCase();
    const stageStatus =
      cleanStatus === "completed" || cleanStatus === "done"
        ? "completed"
        : cleanStatus === "failed" || cleanStatus === "error"
          ? "failed"
          : cleanStatus === "interrupted" || cleanStatus === "cancelled"
            ? "failed"
            : cleanStatus === "pending"
              ? "pending"
              : "running";
    this.persistAnalysisWorkspaceEvent(item, {
      type: "run_stage",
      stage: task.id,
      label: `${task.id}: ${task.title}`,
      status: stageStatus,
      details: compact(summary || stageStatus, 600),
      metadata: {
        analysisTaskId: task.id,
        analysisTaskTitle: task.title,
        capability: task.capability,
        score: extra.score,
        durationMs: extra.durationMs,
        planIndex: extra.planIndex,
        planTotal: extra.planTotal,
      },
    });
  }

  syncAnalysisWorkspaceFinished(item, status, summary, result = null) {
    const cleanStatus = String(status || "").toLowerCase();
    const completed = cleanStatus === "completed";
    const interrupted = cleanStatus === "interrupted";
    if (!completed) {
      this.persistAnalysisWorkspaceEvent(item, {
        type: "error",
        message: summary || (interrupted ? "Benchmark interrupted." : "Benchmark failed."),
        metadata: { status: cleanStatus || "failed" },
      });
    } else if (summary) {
      this.persistAnalysisWorkspaceEvent(item, {
        type: "raw_log",
        content: summary,
        metadata: { status: cleanStatus },
      });
    }
    const totals = result?.totals || {};
    this.persistAnalysisWorkspaceEvent(item, {
      type: "done",
      metadata: {
        completed,
        interrupted,
        status: cleanStatus || (completed ? "completed" : "failed"),
        exitCode: completed ? 0 : 1,
        summary: summary || "",
        durationMs: toInt(totals.durationMs),
        inputTokens: toInt(totals.inputTokens),
        outputTokens: toInt(totals.outputTokens),
        cacheReadTokens: toInt(totals.cacheReadTokens),
        reasoningTokens: toInt(totals.reasoningTokens),
        apiCalls: toInt(totals.apiCalls),
        estimatedCostUsd: Number(totals.estimatedCostUsd || 0),
      },
    });
  }

  readAnalysisStore() {
    const store = readJson(this.analysisStorePath(), null);
    const fallback = { version: 1, updatedAt: isoNow(), results: [] };
    if (!store || typeof store !== "object") return fallback;
    const results = Array.isArray(store.results) ? store.results : [];
    return {
      version: 1,
      updatedAt: store.updatedAt || isoNow(),
      results: results.map((result) => this.normalizeAnalysisResult(result)).filter(Boolean),
    };
  }

  writeAnalysisStore(store) {
    const normalized = {
      version: 1,
      updatedAt: isoNow(),
      results: Array.isArray(store?.results)
        ? store.results.map((result) => this.normalizeAnalysisResult(result)).filter(Boolean)
        : [],
    };
    writeJsonAtomic(this.analysisStorePath(), normalized);
    return normalized;
  }

  normalizeAnalysisResult(result) {
    if (!result || typeof result !== "object") return null;
    const provider = String(result.provider || "").trim();
    const model = String(result.model || "").trim();
    const key = String(result.key || modelBenchmarkKey(provider, model));
    const modelRunName = analysisModelRunName(provider, model, key);
    const workspacePath = String(result.workspacePath || "");
    const tasks = Array.isArray(result.tasks) ? result.tasks : [];
    const normalizedTasks = tasks.map((task) => {
      const taskId = String(task.id || "");
      const gradeLogText = analysisTaskGradeLogText(workspacePath, taskId);
      const gradeLogSections = analysisTaskSectionsFromGradeLog(taskId, gradeLogText);
      const migratedSummary = analysisLatestMigratedTaskSummary(workspacePath, modelRunName, taskId);
      const migratedSections = analysisMigratedTaskSectionsFromSummary(taskId, workspacePath, modelRunName, migratedSummary);
      const migratedScore = analysisMigratedTaskScore(taskId, workspacePath, modelRunName, migratedSummary);
      const rawSections = Array.isArray(task.sections)
        ? task.sections.map((section) => ({
            id: String(section.id || ""),
            label: String(section.label || ""),
            score: clampScore(section.score),
            evidence: String(section.evidence || ""),
          }))
        : [];
      const score = migratedScore ?? analysisFinalScoreFromLog(gradeLogText) ?? clampScore(task.score);
      const sections = migratedSections.length > 0
        ? migratedSections
        : gradeLogSections.length > 0
          ? gradeLogSections
          : rawSections;
      return {
        id: taskId,
        title: String(task.title || ""),
        capability: String(task.capability || ""),
        status: normalizeAnalysisTaskStatus(task, { score, sections, gradeLogText, migratedSummary }),
        startedAt: task.startedAt || null,
        completedAt: task.completedAt || null,
        durationMs: toInt(task.durationMs),
        inputTokens: toInt(task.inputTokens),
        outputTokens: toInt(task.outputTokens),
        cacheReadTokens: toInt(task.cacheReadTokens),
        reasoningTokens: toInt(task.reasoningTokens),
        apiCalls: toInt(task.apiCalls),
        estimatedCostUsd: Number(task.estimatedCostUsd || 0),
        score,
        sections,
        error: task.error ? String(task.error) : null,
        summary: String(task.summary || ""),
        evaluatorSummary: String(task.evaluatorSummary || ""),
        modelSummary: String(task.modelSummary || ""),
        artifacts: analysisTaskDisplayArtifacts(workspacePath, taskId),
      };
    });
    const derivedAbilityScores = normalizedTasks.length > 0
      ? this.analysisAbilityScores(normalizedTasks)
      : null;
    return {
      id: String(result.id || key),
      key,
      runId: String(result.runId || ""),
      provider,
      model,
      agent: String(result.agent || "Hermes Agent"),
      status: String(result.status || "completed"),
      startedAt: result.startedAt || null,
      completedAt: result.completedAt || null,
      updatedAt: result.updatedAt || result.completedAt || result.startedAt || isoNow(),
      workspacePath,
      summary: String(result.summary || ""),
      totals: {
        durationMs: toInt(result.totals?.durationMs),
        inputTokens: toInt(result.totals?.inputTokens),
        outputTokens: toInt(result.totals?.outputTokens),
        cacheReadTokens: toInt(result.totals?.cacheReadTokens),
        reasoningTokens: toInt(result.totals?.reasoningTokens),
        apiCalls: toInt(result.totals?.apiCalls),
        estimatedCostUsd: Number(result.totals?.estimatedCostUsd || 0),
      },
      abilityScores: this.normalizeAnalysisAbilityScores(result.abilityScores, derivedAbilityScores),
      tasks: normalizedTasks,
    };
  }

  normalizeAnalysisAbilityScores(rawScores, derivedScores = null) {
    return this.analyticsService.normalizeAnalysisAbilityScores(rawScores, derivedScores);
  }

  withLiveAnalysisTiming(result, nowMs = Date.now()) {
    return this.analyticsService.withLiveAnalysisTiming(result, nowMs);
  }

  getAnalysisBenchmarks() {
    const store = this.readAnalysisStore();
    const snapshot = this.analyticsService.buildAnalysisBenchmarksSnapshot(store, {
      activeAnalysisRuns: this.activeAnalysisItems(),
      analysisQueue: this.analysisQueue,
    });
    if (snapshot.changed) {
      this.writeAnalysisStore({ ...store, results: snapshot.results });
    }
    return snapshot.response;
  }

  normalizeAnalysisModelInput(input) {
    const items = Array.isArray(input?.models) ? input.models : [];
    const normalized = [];
    const seen = new Set();
    for (const item of items) {
      const provider = String(item?.provider || "").trim();
      const model = String(item?.model || "").trim();
      if (!provider && !model) continue;
      const key = modelBenchmarkKey(provider, model);
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push({ provider, model, key });
    }
    return normalized;
  }

  analysisDefaultMaxIterations() {
    return readRootAgentMaxTurns(this.hermesHome) || ANALYSIS_DEFAULT_MAX_ITERATIONS;
  }

  startAnalysisBenchmarks(webContents, input = {}) {
    if (this.shuttingDown) {
      return { ok: false, runIds: [], queued: 0, skipped: 0, warning: "Redou Agent is closing." };
    }
    const models = this.normalizeAnalysisModelInput(input);
    if (models.length === 0) {
      throw new Error("Select at least one configured model before starting analysis.");
    }
    const busyKeys = new Set([
      ...this.activeAnalysisItems().map((item) => item.key),
      ...this.analysisQueue.map((item) => item.key),
    ]);
    const maxIterations = normalizeAnalysisMaxIterations(input.maxIterations, this.analysisDefaultMaxIterations());
    const store = this.readAnalysisStore();
    const results = store.results.filter(
      (result) => !models.some((model) => model.key === result.key && !busyKeys.has(model.key)),
    );
    const runIds = [];
    for (const model of models) {
      if (busyKeys.has(model.key)) {
        continue;
      }
      const runId = crypto.randomUUID();
      runIds.push(runId);
      const workspaceTask = this.createAnalysisWorkspaceTask(model, runId, maxIterations);
      const result = this.normalizeAnalysisResult({
        id: model.key,
        key: model.key,
        runId,
        provider: model.provider,
        model: model.model,
        agent: "Hermes Agent",
        status: "queued",
        startedAt: isoNow(),
        updatedAt: isoNow(),
        summary: "Queued for model capability analysis.",
        tasks: ANALYSIS_TASKS.map((task) => ({
          ...task,
          status: "pending",
          score: 0,
          sections: [],
        })),
      });
      results.push(result);
      this.analysisQueue.push({
        ...model,
        runId,
        maxIterations,
        webContents,
        projectId: workspaceTask.project.id,
        taskId: workspaceTask.task.id,
        queuedAt: isoNow(),
      });
      const queuedItem = this.analysisQueue.at(-1);
      this.syncAnalysisWorkspaceTaskPlan(queuedItem);
      this.syncAnalysisWorkspaceQueued(queuedItem);
    }
    this.writeAnalysisStore({ ...store, results });
    this.emitAnalysisEvent(webContents, { type: "changed" });
    setImmediate(() => this.startAnalysisQueue());
    return {
      ok: true,
      runIds,
      queued: runIds.length,
      skipped: models.length - runIds.length,
    };
  }

  emitAnalysisEvent(webContents, payload = {}) {
    if (!webContents || webContents.isDestroyed()) return;
    webContents.send("redou:analysis-event", {
      ...payload,
      updatedAt: isoNow(),
    });
  }

  updateAnalysisResult(key, updater) {
    const store = this.readAnalysisStore();
    const index = store.results.findIndex((result) => result.key === key);
    if (index < 0) return null;
    const next = this.normalizeAnalysisResult(updater(store.results[index]));
    store.results[index] = next;
    this.writeAnalysisStore(store);
    return next;
  }

  updateAnalysisTask(key, taskId, updater) {
    return this.updateAnalysisResult(key, (result) => ({
      ...result,
      updatedAt: isoNow(),
      tasks: result.tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              ...updater(task),
            }
          : task,
      ),
    }));
  }

  startAnalysisQueue() {
    if (this.shuttingDown) return;
    while (this.analysisQueue.length > 0) {
      const item = this.analysisQueue.shift();
      item.analysisStartedAtMs = Date.now();
      item.analysisLastActiveAtMs = item.analysisStartedAtMs;
      this.activeAnalysisRuns.set(item.runId, item);
      if (!this.activeAnalysisRun) {
        this.activeAnalysisRun = item;
      }
      Promise.resolve()
        .then(() => this.runAnalysisModelBenchmark(item))
        .catch((error) => {
          if (this.shuttingDown || item.stopRequested) {
            this.markAnalysisInterrupted(item, "Stopped because Redou Agent is closing.");
            return;
          }
          const message = error instanceof Error ? error.message : String(error);
          const failedResult = this.updateAnalysisResult(item.key, (result) => ({
            ...result,
            status: "failed",
            completedAt: isoNow(),
            updatedAt: isoNow(),
            summary: message,
          }));
          this.syncAnalysisWorkspaceFinished(item, "failed", message, failedResult);
          this.emitAnalysisEvent(item.webContents, { type: "changed", runId: item.runId, error: message });
        })
        .finally(async () => {
          try {
            await this.cleanupAnalysisDockerEnvironment(
              item,
              item.workspacePath || path.join(this.analysisWorkspaceRoot(), safeSegment(item.key, "model")),
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log(`Analysis cleanup failed for ${item.key}: ${message}`);
          } finally {
            this.activeAnalysisRuns.delete(item.runId);
            if (this.activeAnalysisRun?.runId === item.runId) {
              this.activeAnalysisRun = null;
              this.activeAnalysisRun = this.primaryActiveAnalysisRun();
            }
            this.emitAnalysisEvent(item.webContents, { type: "changed", runId: item.runId });
            if (!this.shuttingDown) {
              setImmediate(() => this.startAnalysisQueue());
            }
          }
        });
    }
  }

}

function installAnalysisStateMethods(target) {
  for (const name of Object.getOwnPropertyNames(AnalysisStateMethods.prototype)) {
    if (name === "constructor") continue;
    Object.defineProperty(target.prototype, name, Object.getOwnPropertyDescriptor(AnalysisStateMethods.prototype, name));
  }
}

module.exports = { installAnalysisStateMethods };
