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
const { desktopSourcePath } = require("../shared/desktopPaths.cjs");
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

const LIVE_USAGE_FIELDS = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "reasoningTokens",
  "apiCalls",
];

function analysisInfrastructureError(message, details = null) {
  const error = new Error(message);
  error.analysisInfrastructureFailure = true;
  error.details = details;
  return error;
}

function isAnalysisInfrastructureError(error) {
  return Boolean(error && error.analysisInfrastructureFailure === true);
}

function emptyLiveUsage() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    reasoningTokens: 0,
    apiCalls: 0,
  };
}

function usageFromMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") return null;
  const usage = {
    inputTokens: toInt(metadata.inputTokens),
    outputTokens: toInt(metadata.outputTokens),
    cacheReadTokens: toInt(metadata.cacheReadTokens),
    reasoningTokens: toInt(metadata.reasoningTokens),
    apiCalls: toInt(metadata.apiCalls),
  };
  return LIVE_USAGE_FIELDS.some((field) => usage[field] > 0) ? usage : null;
}

function parseHermesApiUsageLine(line) {
  const text = String(line || "");
  if (!/\bAPI call #/i.test(text)) return null;
  const numberMatch = text.match(/\bAPI call #(\d+)/i);
  const inputMatch = text.match(/\bin=(\d+)/i);
  const outputMatch = text.match(/\bout=(\d+)/i);
  const cacheMatch = text.match(/\bcache=(\d+)(?:\/\d+)?/i);
  const reasoningMatch = text.match(/\breasoning=(\d+)/i);
  const usage = {
    inputTokens: inputMatch ? toInt(inputMatch[1]) : 0,
    outputTokens: outputMatch ? toInt(outputMatch[1]) : 0,
    cacheReadTokens: cacheMatch ? toInt(cacheMatch[1]) : 0,
    reasoningTokens: reasoningMatch ? toInt(reasoningMatch[1]) : 0,
    apiCalls: numberMatch ? toInt(numberMatch[1]) : 0,
  };
  return LIVE_USAGE_FIELDS.some((field) => usage[field] > 0) ? usage : null;
}

function liveUsageChanged(left, right) {
  return LIVE_USAGE_FIELDS.some((field) => toInt(left?.[field]) !== toInt(right?.[field]));
}

function maxLiveUsage(left, right) {
  const next = emptyLiveUsage();
  for (const field of LIVE_USAGE_FIELDS) {
    next[field] = Math.max(toInt(left?.[field]), toInt(right?.[field]));
  }
  return next;
}

function analysisEvaluatorCompleted(evaluation) {
  return String(evaluation?.evaluatorStatus || "") === "completed";
}

function analysisTaskEvaluatorSummary(task, evaluation, postProcessResult = null) {
  const status = String(evaluation?.evaluatorStatus || "").trim();
  const score = clampScore(evaluation?.score);
  const sections = Array.isArray(evaluation?.sections) ? evaluation.sections : [];
  const incompleteSections = sections
    .filter((section) => clampScore(section.score) < 100)
    .slice(0, 4)
    .map((section) => `${section.label || section.id}: ${clampScore(section.score)}`);
  const lines = [];
  if (status === "completed") {
    lines.push(`Fixed evaluator score for ${task?.id || "task"}: ${score}/100.`);
  } else if (status === "missing") {
    lines.push(`Fixed evaluator did not produce a valid result for ${task?.id || "task"}.`);
  } else if (status === "skipped") {
    lines.push(`Fixed evaluator skipped for ${task?.id || "task"}.`);
  } else {
    lines.push(`Fixed evaluator result unavailable for ${task?.id || "task"}.`);
  }
  if (incompleteSections.length > 0) {
    lines.push(`Incomplete sections: ${incompleteSections.join("; ")}.`);
  }
  if (postProcessResult?.summary) {
    lines.push(postProcessResult.summary);
  }
  return compactMultiline(lines.filter(Boolean).join("\n"), 1200);
}

class AnalysisExecutionMethods {
  copyAnalysisDisplayArtifacts(workspacePath, taskId, modelRunName = "") {
    const target = path.join(analysisDisplayResultsDir(workspacePath), taskId);
    mkdirp(target);
    copyDirectoryRecursive(path.join(workspacePath, "logs"), path.join(target, "logs"));
    copyDirectoryRecursive(path.join(workspacePath, "reports"), path.join(target, "reports"));
    if (modelRunName) {
      copyDirectoryRecursive(
        path.join(workspacePath, "model_runs", modelRunName, "results"),
        path.join(target, "model_results"),
      );
    }
    return target;
  }

  async runAnalysisTaskBatchPostprocess({ workspacePath, task, analysisEnvName, modelRunName }) {
    const script = analysisTaskBatchScript(task?.id);
    if (!script) {
      return { status: "skipped", summary: "No batch script for task.", logPath: "" };
    }
    const scriptPath = path.join(workspacePath, script);
    if (!fs.existsSync(scriptPath)) {
      return { status: "skipped", summary: `${script} not found in analysis workspace.`, logPath: "" };
    }
    normalizeAnalysisWorkspaceScriptsInPlace(workspacePath);
    const bashCommand = [
      `export DOCKER_SERVICE=${shellQuoteSingle(analysisEnvName)}`,
      `export DOCKER_WORKSPACE=${shellQuoteSingle(ANALYSIS_DOCKER_WORKSPACE)}`,
      `export DOCKER_BENCHMARK_ROOT=${shellQuoteSingle(ANALYSIS_DOCKER_WORKSPACE)}`,
      `export MODEL_NAME=${shellQuoteSingle(modelRunName)}`,
      "export SUBMIT_INDEX='1'",
      `bash ${shellQuoteSingle(`./${script}`)}`,
    ].join("; ");
    const result = await this.runAnalysisShellCommand({
      command: "bash",
      args: ["-lc", bashCommand],
      cwd: workspacePath,
      timeoutMs: 900000,
      env: {
        DOCKER_SERVICE: analysisEnvName,
        DOCKER_WORKSPACE: ANALYSIS_DOCKER_WORKSPACE,
        DOCKER_BENCHMARK_ROOT: ANALYSIS_DOCKER_WORKSPACE,
        MODEL_NAME: modelRunName,
        SUBMIT_INDEX: "1",
      },
    });
    const logText = [
      `Task: ${task?.id || ""}`,
      `Script: ${script}`,
      `Docker service: ${analysisEnvName}`,
      `Model run: ${modelRunName}`,
      `Exit code: ${result.code == null ? "n/a" : result.code}`,
      result.signal ? `Signal: ${result.signal}` : "",
      result.error ? `Error: ${result.error}` : "",
      "",
      result.output || "",
      "",
    ].filter((line) => line !== "").join("\n");
    const logName = `${task?.id || "task"}_grade_all.log`;
    const logPath = path.join(workspacePath, "logs", logName);
    const reportLogPath = path.join(workspacePath, "reports", logName);
    const displayDir = path.join(analysisDisplayResultsDir(workspacePath), task?.id || "task");
    mkdirp(path.dirname(logPath));
    mkdirp(path.dirname(reportLogPath));
    mkdirp(displayDir);
    fs.writeFileSync(logPath, logText, "utf8");
    fs.writeFileSync(reportLogPath, logText, "utf8");
    fs.writeFileSync(path.join(displayDir, logName), logText, "utf8");
    const artifactsDir = this.copyAnalysisDisplayArtifacts(workspacePath, task?.id || "task", modelRunName);
    const status = result.code === 0 ? "completed" : "failed";
    return {
      status,
      code: result.code,
      logPath,
      artifactsDir,
      summary: `Batch post-processing ${status}: ${path.relative(workspacePath, logPath).replace(/\\/g, "/")}`,
      output: result.output,
    };
  }

  async removeAnalysisDockerContainer(envName, cwd = "") {
    const name = String(envName || "").trim();
    if (!name || this.shuttingDown) {
      return { status: "skipped", envName: name, output: "" };
    }
    const result = await this.runAnalysisShellCommand({
      command: "docker",
      args: ["rm", "-f", name],
      cwd: cwd || this.projectRoot,
      timeoutMs: 120000,
    });
    const output = String(result.output || result.error || "");
    if (result.code === 0) {
      return { status: "completed", envName: name, output };
    }
    if (isMissingDockerContainerOutput(output)) {
      return { status: "skipped", envName: name, output };
    }
    return { status: "failed", envName: name, error: output || `docker rm exited with code ${result.code}` };
  }

  async cleanupAnalysisDockerEnvironment(item, workspacePath) {
    const key = String(item?.key || "").trim();
    const envName = analysisDockerEnvironmentName(item?.provider, item?.model, key);
    if (this.shuttingDown || item?.stopRequested) {
      return { status: "skipped", envName, reason: "Redou Agent is closing" };
    }
    if (!key) {
      return { status: "skipped", envName, reason: "analysis key missing" };
    }

    const writeCleanupSummary = (message) => {
      this.updateAnalysisResult(key, (result) => ({
        ...result,
        updatedAt: isoNow(),
        summary: [result.summary, message].filter(Boolean).join("\n\n"),
      }));
      this.emitAnalysisEvent(item.webContents, { type: "changed", runId: item.runId });
    };

    const hostDocker = await this.ensureAnalysisHostDockerAvailable({
      cwd: workspacePath || this.projectRoot,
      reason: `cleaning up Docker test environment ${envName}`,
      waitMs: 30000,
    });
    if (hostDocker.status === "failed") {
      const message = `Skipped Docker cleanup for ${envName}: ${compactMultiline(hostDocker.error, 800)}`;
      writeCleanupSummary(message);
      return { status: "skipped", envName, reason: message, hostDocker };
    }

    const composePath = path.join(workspacePath || "", "docker-compose.yml");
    if (!workspacePath || !fs.existsSync(composePath)) {
      const fallback = await this.removeAnalysisDockerContainer(envName, workspacePath || this.projectRoot);
      if (fallback.status === "completed") {
        const message = `Cleaned stale Docker test container ${envName}.`;
        writeCleanupSummary(message);
        return { status: "completed", envName, output: fallback.output, fallback: "container" };
      }
      return { status: "skipped", envName, reason: "docker-compose.yml not found" };
    }

    try {
      const result = await this.runAnalysisShellCommand({
        command: "docker",
        args: ["compose", "down", "--volumes", "--rmi", "local", "--remove-orphans"],
        cwd: workspacePath,
        timeoutMs: 600000,
      });
      if (result.code === 0) {
        const message = `Cleaned Docker test environment ${envName}.`;
        writeCleanupSummary(message);
        return { status: "completed", envName, output: result.output };
      }
      const message = `Docker cleanup for ${envName} failed: ${compactMultiline(result.output || result.error, 800)}`;
      const fallback = await this.removeAnalysisDockerContainer(envName, workspacePath || this.projectRoot);
      if (fallback.status === "completed") {
        const fallbackMessage = `${message}\nCleaned stale Docker test container ${envName}.`;
        writeCleanupSummary(fallbackMessage);
        return { status: "completed", envName, output: fallback.output, fallback: "container" };
      }
      writeCleanupSummary(message);
      return { status: "failed", envName, error: result.output || result.error };
    } catch (error) {
      const message = `Docker cleanup for ${envName} failed: ${error instanceof Error ? error.message : String(error)}`;
      try {
        const fallback = await this.removeAnalysisDockerContainer(envName, workspacePath || this.projectRoot);
        if (fallback.status === "completed") {
          const fallbackMessage = `${message}\nCleaned stale Docker test container ${envName}.`;
          writeCleanupSummary(fallbackMessage);
          return { status: "completed", envName, output: fallback.output, fallback: "container" };
        }
      } catch {
        // Keep the original compose cleanup error as the visible failure.
      }
      writeCleanupSummary(message);
      return { status: "failed", envName, error: message };
    }
  }

  async runAnalysisModelBenchmark(item) {
    if (this.shuttingDown || item.stopRequested) {
      this.markAnalysisInterrupted(item, "Stopped because Redou Agent is closing.");
      return;
    }
    const workspacePath = this.prepareAnalysisWorkspace(item.key, item.runId);
    item.workspacePath = workspacePath;
    const analysisEnvName = analysisDockerEnvironmentName(item.provider, item.model, item.key);
    const modelRunName = analysisModelRunName(item.provider, item.model, item.key);
    const hostDocker = await this.ensureAnalysisHostDockerAvailable({
      cwd: workspacePath,
      reason: "starting model capability benchmark",
    });
    if (hostDocker.status === "failed") {
      throw new Error(hostDocker.error || "Docker is not available for model capability benchmark.");
    }
    try {
      const staleCleanup = await this.removeAnalysisDockerContainer(analysisEnvName, workspacePath);
      if (staleCleanup.status === "completed") {
        this.log(`Removed stale analysis Docker container ${analysisEnvName} before starting benchmark.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Could not pre-clean analysis Docker container ${analysisEnvName}: ${message}`);
    }
    this.updateAnalysisResult(item.key, (result) => ({
      ...result,
      status: "running",
      startedAt: isoNow(),
      updatedAt: isoNow(),
      workspacePath,
      summary: "Running analyze/task1-9 with Hermes Agent.",
    }));
    this.syncAnalysisWorkspaceStarted(item, workspacePath, analysisEnvName);
    this.emitAnalysisEvent(item.webContents, { type: "changed", runId: item.runId });

    let failed = false;
    let dockerReady = false;
    const ensureDockerReady = async (reason) => {
      if (dockerReady) {
        return { status: "completed", envName: analysisEnvName, cached: true };
      }
      const result = await this.ensureAnalysisDockerEnvironment({
        workspacePath,
        provider: item.provider,
        model: item.model,
        key: item.key,
        analysisEnvName,
        reason,
      });
      if (result.status === "failed") {
        throw analysisInfrastructureError(
          `Docker test environment ${analysisEnvName} is unavailable: ${compactMultiline(result.error || result.output, 1000)}`,
          result,
        );
      }
      if (result.status !== "completed") {
        throw analysisInfrastructureError(
          `Docker test environment ${analysisEnvName} could not be prepared: ${compactMultiline(result.reason || result.output || result.status, 1000)}`,
          result,
        );
      }
      dockerReady = result.status === "completed";
      return result;
    };
    const appendTaskSummary = (summary, extra) => [summary, extra].filter(Boolean).join("\n\n");
    const finishInfrastructureInterrupted = (task, message, completedTaskResult = null, taskStartedAtMs = 0) => {
      const cleanMessage = compactMultiline(
        [
          message,
          "Benchmark interrupted by the Docker test environment before the model could be evaluated further. Completed task scores are partial and should not be treated as a full model score.",
        ].filter(Boolean).join("\n"),
        1800,
      );
      const completedAt = isoNow();
      const interruptedResult = this.updateAnalysisResult(item.key, (result) => {
        const tasks = result.tasks.map((candidate) => {
          if (completedTaskResult && candidate.id === completedTaskResult.id) {
            return completedTaskResult;
          }
          const status = String(candidate.status || "").toLowerCase();
          if (candidate.id === task.id || ["pending", "queued", "running"].includes(status)) {
            const durationMs = candidate.id === task.id && taskStartedAtMs
              ? Math.max(toInt(candidate.durationMs), Date.now() - taskStartedAtMs)
              : toInt(candidate.durationMs);
            return {
              ...candidate,
              status: "interrupted",
              completedAt,
              durationMs,
              error: cleanMessage,
              summary: candidate.id === task.id
                ? cleanMessage
                : "Skipped because the Docker test environment was unavailable.",
              score: 0,
              sections: [],
            };
          }
          return candidate;
        });
        const totals = this.analysisTotals(tasks);
        return {
          ...result,
          status: "interrupted",
          completedAt,
          updatedAt: completedAt,
          tasks,
          totals,
          abilityScores: this.analysisAbilityScores(tasks),
          summary: cleanMessage,
        };
      });
      const visibleTask = completedTaskResult || interruptedResult?.tasks?.find((candidate) => candidate.id === task.id) || {};
      this.syncAnalysisWorkspaceTaskStage(item, task, visibleTask.status || "interrupted", visibleTask.summary || cleanMessage, visibleTask);
      this.syncAnalysisWorkspaceFinished(item, "interrupted", cleanMessage, interruptedResult);
      this.emitAnalysisEvent(item.webContents, { type: "changed", runId: item.runId, taskId: task.id });
    };
    const postProcessTask = async (task) => {
      await this.syncAnalysisDockerArtifacts(workspacePath, analysisEnvName, modelRunName);
      const batch = await this.runAnalysisTaskBatchPostprocess({
        workspacePath,
        task,
        analysisEnvName,
        modelRunName,
      });
      await this.syncAnalysisDockerArtifacts(workspacePath, analysisEnvName, modelRunName);
      this.copyAnalysisDisplayArtifacts(workspacePath, task.id, modelRunName);
      return batch;
    };

    for (const task of ANALYSIS_TASKS) {
      if (this.shuttingDown || item.stopRequested) {
        this.markAnalysisInterrupted(item, "Stopped because Redou Agent is closing.");
        return;
      }
      const taskStartedAtMs = Date.now();
      const startedAt = new Date(taskStartedAtMs).toISOString();
      this.syncAnalysisWorkspaceTaskStage(item, task, "running", "Running");
      this.updateAnalysisTask(item.key, task.id, () => ({
        status: "running",
        startedAt,
        completedAt: null,
        error: null,
        summary: "Running",
      }));
      this.emitAnalysisEvent(item.webContents, { type: "changed", runId: item.runId, taskId: task.id });

      try {
        if (task.id !== "task1") {
          await ensureDockerReady(`Starting ${task.id}.`);
        }
        const taskResult = await this.runAnalysisTaskProcess({
          ...item,
          workspacePath,
          task,
          prompt: this.analysisPromptForTask(task, item.provider, item.model, {
            key: item.key,
            analysisEnvName,
            modelRunName,
          }),
          modelRunName,
          skipInlineEvaluation: task.id === "task1",
          postProcessBeforeEvaluation: task.id === "task1"
            ? null
            : async () => postProcessTask(task),
        });
        if (task.id === "task1" && taskResult.status !== "interrupted") {
          let task1Batch = null;
          try {
            task1Batch = await postProcessTask(task);
          } catch (postError) {
            task1Batch = {
              status: "failed",
              summary: `Batch post-processing failed: ${postError instanceof Error ? postError.message : String(postError)}`,
              error: postError instanceof Error ? postError.message : String(postError),
            };
          }
          const task1Evaluation = this.evaluateAnalysisTask(task.id, workspacePath, [], "", {
            analysisEnvName,
            modelRunName,
          });
          const task1EvaluatorSummary = analysisTaskEvaluatorSummary(task, task1Evaluation, task1Batch);
          taskResult.score = task1Evaluation.score;
          taskResult.sections = task1Evaluation.sections;
          taskResult.evaluatorSummary = task1EvaluatorSummary;
          taskResult.summary = task1EvaluatorSummary;
          taskResult.status = analysisEvaluatorCompleted(task1Evaluation) && task1Batch?.status !== "failed"
            ? "completed"
            : "failed";
          taskResult.error = taskResult.status === "failed"
            ? (task1Batch?.error || task1EvaluatorSummary)
            : null;
          try {
            const ensureResult = await ensureDockerReady("Task1 completed; preparing Docker environment for remaining analysis tasks.");
            const details = [
              ensureResult.createdFallback ? `Scheduler created Docker test environment ${analysisEnvName}.` : "",
            ].filter(Boolean).join("\n");
            taskResult.summary = appendTaskSummary(taskResult.summary, details);
            taskResult.evaluatorSummary = appendTaskSummary(taskResult.evaluatorSummary, details);
          } catch (postError) {
            if (isAnalysisInfrastructureError(postError)) {
              const message = postError instanceof Error ? postError.message : String(postError);
              this.updateAnalysisTask(item.key, task.id, () => taskResult);
              finishInfrastructureInterrupted(task, message, taskResult, taskStartedAtMs);
              return;
            }
            failed = true;
            const message = postError instanceof Error ? postError.message : String(postError);
            taskResult.status = "failed";
            taskResult.error = appendTaskSummary(taskResult.error, message);
            taskResult.summary = appendTaskSummary(taskResult.summary, message);
          }
        }
        if (taskResult.status === "failed") {
          failed = true;
        }
        this.updateAnalysisTask(item.key, task.id, () => taskResult);
        this.syncAnalysisWorkspaceTaskStage(item, task, taskResult.status, taskResult.summary, taskResult);
      } catch (error) {
        if (this.shuttingDown || item.stopRequested) {
          this.markAnalysisInterrupted(item, "Stopped because Redou Agent is closing.");
          return;
        }
        if (isAnalysisInfrastructureError(error)) {
          const message = error instanceof Error ? error.message : String(error);
          finishInfrastructureInterrupted(task, message, null, taskStartedAtMs);
          return;
        }
        failed = true;
        const message = error instanceof Error ? error.message : String(error);
        this.updateAnalysisTask(item.key, task.id, () => ({
          status: "failed",
          completedAt: isoNow(),
          error: message,
          summary: message,
          score: 0,
          sections: [],
        }));
        this.syncAnalysisWorkspaceTaskStage(item, task, "failed", message, {
          score: 0,
          durationMs: 0,
        });
      }
      this.updateAnalysisResult(item.key, (result) => ({
        ...result,
        totals: this.analysisTotals(result.tasks),
        abilityScores: this.analysisAbilityScores(result.tasks),
      }));
      this.emitAnalysisEvent(item.webContents, { type: "changed", runId: item.runId, taskId: task.id });
      if (this.shuttingDown || item.stopRequested) {
        this.markAnalysisInterrupted(item, "Stopped because Redou Agent is closing.");
        return;
      }
    }

    const finalResult = this.updateAnalysisResult(item.key, (result) => {
      const completedTasks = result.tasks.filter((task) => task.status === "completed").length;
      const totals = this.analysisTotals(result.tasks);
      const abilityScores = this.analysisAbilityScores(result.tasks);
      const overall = averageScore(Object.values(abilityScores).map((score, index) => ({
        id: String(index),
        label: String(index),
        score,
      })));
      return {
        ...result,
        status: failed ? "failed" : "completed",
        completedAt: isoNow(),
        updatedAt: isoNow(),
        totals,
        abilityScores,
        summary: `${completedTasks}/${ANALYSIS_TASKS.length} tasks completed. Overall capability score: ${overall}.`,
      };
    });
    this.syncAnalysisWorkspaceFinished(
      item,
      finalResult?.status || (failed ? "failed" : "completed"),
      finalResult?.summary || "",
      finalResult,
    );
    this.emitAnalysisEvent(item.webContents, { type: "changed", runId: item.runId });
  }

  runAnalysisTaskProcess({
    runId,
    key,
    provider,
    model,
    workspacePath,
    task,
    prompt,
    maxIterations,
    webContents = null,
    skipInlineEvaluation = false,
    preparedRunDir = "",
    modelRunName = "",
    postProcessBeforeEvaluation = null,
  }) {
    return new Promise((resolve, reject) => {
      if (this.shuttingDown) {
        resolve({
          id: task.id,
          title: task.title,
          capability: task.capability,
          status: "interrupted",
          startedAt: isoNow(),
          completedAt: isoNow(),
          durationMs: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          reasoningTokens: 0,
          apiCalls: 0,
          estimatedCostUsd: 0,
          score: 0,
          sections: [],
          summary: "Stopped because Redou Agent is closing.",
          error: "Stopped because Redou Agent is closing.",
        });
        return;
      }
      if (!this.codexPath) {
        reject(new Error("Codex runtime is unavailable."));
        return;
      }

      const adapterPath = desktopSourcePath("codex_adapter.cjs");
      const taskRunId = `${runId}:${task.id}`;
      const taskStartedAtMs = Date.now();
      const taskStartedAt = new Date(taskStartedAtMs).toISOString();
      const analysisEnvName = analysisDockerEnvironmentName(provider, model, key);
      const resolvedModelRunName = modelRunName || analysisModelRunName(provider, model, key);
      const metadata = {
        analysisRunId: runId,
        analysisKey: key,
        analysisTaskId: task.id,
        analysisTaskTitle: task.title,
        modelProvider: provider,
        model,
        analysisEnvName,
        ...(preparedRunDir ? { preparedRunDir } : {}),
        modelRunName: resolvedModelRunName,
      };
      const events = [];
      let finalAssistantText = "";
      let doneMetadata = {};
      let childError = null;
      const logUsage = emptyLiveUsage();
      let metadataUsage = emptyLiveUsage();
      let lastFlushedUsage = emptyLiveUsage();
      let lastLiveUsageFlushAtMs = 0;
      const permissions = this.unattendedPermissions();

      const currentLiveUsage = () => maxLiveUsage(logUsage, metadataUsage);

      const flushLiveUsage = (force = false) => {
        const usage = currentLiveUsage();
        if (!LIVE_USAGE_FIELDS.some((field) => usage[field] > 0)) return;
        if (!force && !liveUsageChanged(usage, lastFlushedUsage)) return;
        const nowMs = Date.now();
        if (!force && nowMs - lastLiveUsageFlushAtMs < 2000 && usage.apiCalls === lastFlushedUsage.apiCalls) {
          return;
        }
        lastFlushedUsage = { ...usage };
        lastLiveUsageFlushAtMs = nowMs;
        this.updateAnalysisTask(key, task.id, (current) => {
          if (String(current.status || "").toLowerCase() !== "running") {
            return {};
          }
          return {
            durationMs: Math.max(toInt(current.durationMs), nowMs - taskStartedAtMs),
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheReadTokens: usage.cacheReadTokens,
            reasoningTokens: usage.reasoningTokens,
            apiCalls: usage.apiCalls,
          };
        });
        this.emitAnalysisEvent(webContents, { type: "changed", runId, taskId: task.id });
      };

      const recordEvent = (rawEvent) => {
        const event = rawEvent && typeof rawEvent === "object"
          ? rawEvent
          : { type: "raw_log", content: String(rawEvent || "") };
        events.push(event);
        if (event.type === "assistant_message") {
          finalAssistantText = String(event.content || "").trim();
        }
        if (event.type === "done" && event.metadata && typeof event.metadata === "object") {
          doneMetadata = event.metadata;
        }
        const eventUsage = usageFromMetadata(event.metadata);
        if (eventUsage) {
          metadataUsage = maxLiveUsage(metadataUsage, eventUsage);
          flushLiveUsage();
        }
      };

      this.processManager.startJsonLineProcess({
        command: process.execPath,
        args: [adapterPath],
        options: {
          cwd: workspacePath,
          env: this.childEnv({
            CODEX_BINARY: this.codexPath || "codex",
            REDOU_APP_DATA_ROOT: this.appDataRoot(),
            REDOU_ANALYSIS_RUN_ID: runId,
            REDOU_ANALYSIS_TASK_ID: task.id,
            REDOU_RUN_ID: taskRunId,
            REDOU_PERMISSIONS_JSON: JSON.stringify(permissions),
          }),
          shell: false,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        },
        input: {
          projectId: `analysis-${key}`,
          taskId: task.id,
          runId: taskRunId,
          hermesProfile: "analysis",
          hermesSessionId: `redou-analysis-${key}-${task.id}-${Date.now().toString(36)}`,
          systemContext: "You are a coding agent running inside Redou Agent's local model benchmark harness.",
          userContext: prompt,
          attachments: [],
          metadata,
          riskConfirmed: false,
          permissions,
          runtimeApprovalEnabled: false,
          approvalTimeoutSeconds: permissions.approval_timeout_seconds,
          model,
          provider,
          workspacePath,
          maxIterations: normalizeAnalysisMaxIterations(maxIterations, this.analysisDefaultMaxIterations()),
        },
        onStarted: (child) => {
          const activeAnalysisItem = this.activeAnalysisRuns.get(runId);
          if (activeAnalysisItem) {
            activeAnalysisItem.child = child;
            activeAnalysisItem.currentTaskId = task.id;
          }
        },
        onStdoutEvent: (event) => {
          recordEvent(event);
        },
        onStderrLine: (line) => {
          const content = redact(line);
          recordEvent({ type: "raw_log", content, metadata: { stream: "stderr", folded: true } });
          const usage = parseHermesApiUsageLine(content);
          if (usage) {
            logUsage.inputTokens += usage.inputTokens;
            logUsage.outputTokens += usage.outputTokens;
            logUsage.cacheReadTokens += usage.cacheReadTokens;
            logUsage.reasoningTokens += usage.reasoningTokens;
            logUsage.apiCalls = Math.max(logUsage.apiCalls, usage.apiCalls);
            flushLiveUsage();
          }
        },
        onError: (error) => {
          childError = error;
        },
        onExit: async ({ code, child }) => {
          try {
            const currentAnalysisItem = this.activeAnalysisRuns.get(runId);
            if (currentAnalysisItem?.child === child) {
              delete currentAnalysisItem.child;
              delete currentAnalysisItem.currentTaskId;
            }
            flushLiveUsage(true);

            const stopped = this.shuttingDown || currentAnalysisItem?.stopRequested === true;
            let postProcessResult = null;
            if (!stopped && typeof postProcessBeforeEvaluation === "function") {
              try {
                postProcessResult = await postProcessBeforeEvaluation({
                  events,
                  finalAssistantText,
                  doneMetadata,
                });
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                postProcessResult = {
                  status: "failed",
                  summary: `Batch post-processing failed: ${message}`,
                  error: message,
                };
              }
            }

            const completedAtMs = Date.now();
            const durationMs = Math.max(0, completedAtMs - taskStartedAtMs);
            const errors = events
              .filter((event) => event.type === "error")
              .map((event) => event.message || event.content)
              .filter(Boolean);
            const failureSummary = finalAssistantText || compact(errors.join(" "), 600);
            const modelCallFailed = isAnalysisModelCallFailure(failureSummary);
            const evaluation = skipInlineEvaluation || modelCallFailed
              ? { score: 0, sections: [], evaluatorStatus: skipInlineEvaluation ? "skipped" : "failed" }
              : this.evaluateAnalysisTask(task.id, workspacePath, events, finalAssistantText, {
                  analysisEnvName,
                  modelRunName: resolvedModelRunName,
                });
            const postProcessFailed = postProcessResult?.status === "failed";
            const evaluatorCompleted = analysisEvaluatorCompleted(evaluation);
            const status = analysisTaskProcessStatus({
              stopped,
              childError,
              exitCode: code,
              modelCallFailed,
              postProcessFailed,
              hasEvaluation: evaluatorCompleted || skipInlineEvaluation,
              evaluationRequired: !skipInlineEvaluation && !modelCallFailed,
            });
            const evaluatorSummary = skipInlineEvaluation
              ? compactMultiline(finalAssistantText || "Inline evaluation skipped.", 1200)
              : analysisTaskEvaluatorSummary(task, evaluation, postProcessResult);
            const summary = stopped
              ? "Stopped because Redou Agent is closing."
              : modelCallFailed
                ? failureSummary
                : evaluatorSummary;
            const finalUsage = currentLiveUsage();
            const taskResult = {
              id: task.id,
              title: task.title,
              capability: task.capability,
              status,
              startedAt: taskStartedAt,
              completedAt: new Date(completedAtMs).toISOString(),
              durationMs,
              inputTokens: toInt(doneMetadata.inputTokens) || finalUsage.inputTokens,
              outputTokens: toInt(doneMetadata.outputTokens) || finalUsage.outputTokens,
              cacheReadTokens: toInt(doneMetadata.cacheReadTokens) || finalUsage.cacheReadTokens,
              reasoningTokens: toInt(doneMetadata.reasoningTokens) || finalUsage.reasoningTokens,
              apiCalls: toInt(doneMetadata.apiCalls) || finalUsage.apiCalls,
              estimatedCostUsd: Number(doneMetadata.estimatedCostUsd || 0),
              score: evaluation.score,
              sections: evaluation.sections,
              summary,
              evaluatorSummary,
              modelSummary: finalAssistantText,
              error: stopped
                ? "Stopped because Redou Agent is closing."
                : childError
                  ? childError.message
                  : modelCallFailed
                    ? failureSummary
                    : status === "failed"
                    ? [errors.join("\n") || (code !== 0 ? `Exited with code ${code}` : ""), postProcessResult?.error].filter(Boolean).join("\n") || null
                    : null,
            };
            resolve(taskResult);
          } catch (error) {
            reject(error);
          }
        },
      });
    });
  }

  evaluateAnalysisTask(taskId, workspacePath, events, finalAssistantText, context = {}) {
    const commands = commandText(events);
    const allEventText = `${commands}\n${events.map((event) => event.content || event.message || "").join("\n")}\n${finalAssistantText}`;
    if (isAnalysisModelCallFailure(allEventText)) {
      return { score: 0, sections: [], evaluatorStatus: "failed" };
    }
    const analysisEnvName = String(context.analysisEnvName || "agent-lab").trim() || "agent-lab";
    const escapedEnvName = regexEscape(analysisEnvName);
    const gradeLogText = analysisTaskGradeLogText(workspacePath, taskId);
    const gradeLogScore = analysisFinalScoreFromLog(gradeLogText);
    const gradeLogSections = analysisTaskSectionsFromGradeLog(taskId, gradeLogText);
    if (["task1", "task2", "task3", "task4"].includes(taskId) && gradeLogSections.length > 0) {
      return { score: gradeLogScore ?? averageScore(gradeLogSections), sections: gradeLogSections, evaluatorStatus: "completed" };
    }
    if (["task1", "task2", "task3", "task4"].includes(taskId)) {
      return {
        score: 0,
        sections: [
          sectionScore(
            "fixed_evaluator",
            "Fixed evaluator",
            0,
            `${taskId}_grade_all.log missing or did not contain fixed phase scores`,
          ),
        ],
        evaluatorStatus: "missing",
      };
    }
    if (taskId === "task1") {
      const dockerfile = pathExists(workspacePath, "Dockerfile");
      const compose = readRelativeText(workspacePath, "docker-compose.yml");
      const readme = readRelativeText(workspacePath, "README.md");
      const report = readRelativeText(workspacePath, "ENV_REPORT.md");
      const envCheck = readRelativeTextAny(workspacePath, ["logs/env_check.txt", "workspace/logs/env_check.txt"]);
      const dirs = [
        ["projects", "workspace/projects"],
        ["reports", "workspace/reports"],
        ["logs", "workspace/logs"],
      ].filter((rels) => pathExistsAny(workspacePath, rels)).length;
      const serviceRe = new RegExp(`(^|\\n)\\s{2}["']?${escapedEnvName}["']?\\s*:`, "m");
      const containerNameRe = new RegExp(`container_name\\s*:\\s*["']?${escapedEnvName}["']?\\b`, "i");
      const rootMountRe = /(?:^|\n)\s*-\s*(?:["']?(?:\.\/?|\$\{PWD\})["']?\s*:\s*["']?\/workspace\b|type:\s*bind[\s\S]{0,160}source:\s*["']?(?:\.\/?|\$\{PWD\})["']?[\s\S]{0,160}target:\s*["']?\/workspace\b)/i;
      const sections = [
        sectionScore("workspace_structure", "Workspace structure", (dockerfile ? 25 : 0) + (compose ? 25 : 0) + dirs * 16.7, `${dockerfile ? "Dockerfile" : ""} ${compose ? "compose" : ""} ${dirs}/3 dirs`),
        sectionScore("compose_contract", "Docker compose contract", (hasAny(compose, [serviceRe]) ? 25 : 0) + (hasAny(compose, [/\/workspace/]) ? 25 : 0) + (hasAny(compose, [rootMountRe]) ? 25 : 0) + (hasAny(compose, [containerNameRe]) ? 25 : 0), `${analysisEnvName} service/container and analysis root /workspace mount`),
        sectionScore("environment_verification", "Environment verification", 0, "Docker commands detected"),
        sectionScore("mount_evidence", "Workspace mount evidence", envCheck ? 100 : 0, envCheck ? "logs/env_check.txt exists" : "env_check.txt missing"),
        sectionScore("documentation", "README and ENV report", (readme.length > 400 ? 45 : readme ? 25 : 0) + (report.length > 600 ? 55 : report ? 30 : 0), "README.md and ENV_REPORT.md"),
      ];
      sections[2].score = clampScore(
        (hasAny(allEventText, [/docker compose up/i]) ? 34 : 0) +
        (hasAny(allEventText, [/docker compose ps/i]) ? 22 : 0) +
        (hasAny(allEventText, [/node -v|npm -v|python3 --version|pip --version|git --version|curl --version|wget --version/i]) ? 44 : 0),
      );
      return { score: gradeLogScore ?? averageScore(sections), sections };
    }

    if (taskId === "task2") {
      const projectDir = firstExistingRelativePath(workspacePath, ["projects/agent-task-board", "workspace/projects/agent-task-board"]);
      const files = listFilesRecursive(projectDir, 160);
      const combined = files
        .filter((file) => /\.(js|jsx|ts|tsx|html|css|json|md)$/i.test(file))
        .map((file) => readText(file))
        .join("\n");
      const report = readRelativeTextAny(workspacePath, ["reports/agent-task-board-report.md", "workspace/reports/agent-task-board-report.md"]);
      const sections = [
        sectionScore("project_created", "Project files", files.length >= 4 ? 100 : files.length * 20, `${files.length} files found`),
        sectionScore("features", "Task board features", (
          (hasAny(combined, [/sub.?task|子任务/i]) ? 20 : 0) +
          (hasAny(combined, [/Planner|Coder|Reviewer|Tester/i]) ? 20 : 0) +
          (hasAny(combined, [/pending|running|completed|failed|等待|执行|完成|失败/i]) ? 20 : 0) +
          (hasAny(combined, [/log|日志/i]) ? 20 : 0) +
          (hasAny(combined, [/progress|进度/i]) ? 20 : 0)
        ), "Expected board capabilities in source"),
        sectionScore("persistence", "Persistence", hasAny(combined, [/localStorage|indexedDB|fs\.|writeFile/i]) ? 100 : 0, "Persistent storage marker"),
        sectionScore("container_execution", "Container execution", hasContainerExecCommand(commands, analysisEnvName) ? 100 : 0, `${analysisEnvName} command usage`),
        sectionScore("verification", "Runtime verification", hasAny(commands, [/curl|npm run dev|npm start/i]) ? 100 : 0, "Runtime/curl command usage"),
        sectionScore("report", "Delivery report", report.length > 700 ? 100 : report ? 55 : 0, "agent-task-board-report.md"),
      ];
      return { score: gradeLogScore ?? averageScore(sections), sections };
    }

    if (taskId === "task3") {
      const projectDir = firstExistingRelativePath(workspacePath, ["projects/bug-fix-lab", "workspace/projects/bug-fix-lab"]);
      const files = listFilesRecursive(projectDir, 160);
      const combined = files
        .filter((file) => /\.(js|cjs|mjs|json|md)$/i.test(file))
        .map((file) => readText(file))
        .join("\n");
      const logText = readRelativeTextAny(workspacePath, ["logs/bug-fix-lab-test.log", "workspace/logs/bug-fix-lab-test.log"]);
      const report = readRelativeTextAny(workspacePath, ["reports/bug-fix-lab-report.md", "workspace/reports/bug-fix-lab-report.md"]);
      const testFileCount = files.filter((file) => /\.test\./i.test(file)).length;
      const testEvidenceText = `${logText}\n${report}`;
      const hasFailureEvidence = hasAny(testEvidenceText, [
        /\bfail(?:ed|ing)?\b/i,
        /\bnot ok\s+\d+/i,
        /\bAssertionError\b/i,
        /\bERR_ASSERTION\b/i,
        /\b\d+\s+failures?\b/i,
      ]);
      const hasPassEvidence = hasAny(testEvidenceText, [
        /\bpass(?:ed)?\b/i,
        /\bok\s+\d+/i,
        /\btests?\s+passed\b/i,
        /\ball tests pass(?:ed)?\b/i,
        /\b0\s+failures?\b/i,
      ]);
      const sections = [
        sectionScore("project_created", "Library project", pathExistsAny(workspacePath, ["projects/bug-fix-lab/package.json", "workspace/projects/bug-fix-lab/package.json"]) ? 100 : Math.min(80, files.length * 15), `${files.length} files found`),
        sectionScore("tests_created", "Tests created", testFileCount >= 2 ? 100 : testFileCount === 1 ? 50 : 0, "calculator/text tests"),
        sectionScore("bug_loop", "Failing-to-passing loop", (
          (hasFailureEvidence ? 45 : 0) +
          (hasPassEvidence ? 45 : 0) +
          (hasAny(report, [/bug|fix|修复|失败|通过/i]) ? 10 : 0)
        ), "Failure and pass evidence"),
        sectionScore("container_execution", "Container-only commands", hasContainerExecCommand(commands, analysisEnvName) ? 100 : 0, `${analysisEnvName} command usage`),
        sectionScore("log_report", "Log and report", (logText.length > 200 ? 45 : logText ? 25 : 0) + (report.length > 700 ? 55 : report ? 30 : 0), "test log and report"),
        sectionScore("function_coverage", "Required utility coverage", (
          (hasAny(combined, [/add\s*\(/]) ? 13 : 0) +
          (hasAny(combined, [/subtract\s*\(/]) ? 12 : 0) +
          (hasAny(combined, [/multiply\s*\(/]) ? 13 : 0) +
          (hasAny(combined, [/divide\s*\(/]) ? 12 : 0) +
          (hasAny(combined, [/reverseText\s*\(/]) ? 13 : 0) +
          (hasAny(combined, [/countWords\s*\(/]) ? 12 : 0) +
          (hasAny(combined, [/capitalizeWords\s*\(/]) ? 13 : 0) +
          (hasAny(combined, [/isPalindrome\s*\(/]) ? 12 : 0)
        ), "Required functions"),
      ];
      return { score: gradeLogScore ?? averageScore(sections), sections };
    }

    if (taskId === "task4") {
      const report = readRelativeTextAny(workspacePath, ["reports/chinese-agent-product-research.md", "workspace/reports/chinese-agent-product-research.md"]);
    const reportCheckRe = /\b(?:ls|test|stat|wc|head|cat)\b[^\r\n]*chinese-agent-product-research\.md/i;
    const sections = [
      sectionScore("report_saved", "Research report saved", report.length > 1500 ? 100 : report ? 55 : 0, "chinese-agent-product-research.md"),
      sectionScore("sources", "Source links", Math.min(100, countHttpLinks(report) * 12), `${countHttpLinks(report)} links`),
      sectionScore("comparison", "Comparison table", hasAny(report, [/\|.*Claude/i, /\|.*Cursor/i, /\|.*Codex/i]) ? 100 : hasAny(report, [/\|/]) ? 50 : 0, "Markdown table evidence"),
      sectionScore("product_plan", "Product plan", (
        (hasAny(report, [/MVP|产品|用户|场景|痛点|架构|路线图|risk|风险/i]) ? 45 : 0) +
        (hasAny(report, [/多模型|模型协作|大模型|小模型/i]) ? 25 : 0) +
        (hasAny(report, [/Claude Code|Codex|Cursor|Cline|OpenHands/i]) ? 30 : 0)
      ), "Plan sections"),
      sectionScore("container_check", "Container file check", report && hasContainerExecCommand(commands, analysisEnvName, [reportCheckRe]) ? 100 : 0, `${analysisEnvName} file verification`),
    ];
      return { score: gradeLogScore ?? averageScore(sections), sections };
    }

    const migratedMatch = /^task([5-9])$/.exec(taskId);
    if (migratedMatch) {
      const modelRunName = String(context.modelRunName || "unknown-model").trim() || "unknown-model";
      const summary = analysisLatestMigratedTaskSummary(workspacePath, modelRunName, taskId);
      const sections = analysisMigratedTaskSectionsFromSummary(taskId, workspacePath, modelRunName, summary);
      return {
        score: analysisMigratedTaskScore(taskId, workspacePath, modelRunName, summary) ?? 0,
        sections: sections.length > 0
          ? sections
          : [sectionScore("fixed_evaluator", "Fixed evaluator", 0, `${taskId} evaluator summary missing`)],
        evaluatorStatus: summary ? "completed" : "missing",
      };
    }

    return { score: 0, sections: [], evaluatorStatus: "missing" };
  }

  analysisTotals(tasks) {
    return this.analyticsService.analysisTotals(tasks);
  }

  analysisAbilityScores(tasks) {
    return this.analyticsService.analysisAbilityScores(tasks);
  }

}

function installAnalysisExecutionMethods(target) {
  for (const name of Object.getOwnPropertyNames(AnalysisExecutionMethods.prototype)) {
    if (name === "constructor") continue;
    Object.defineProperty(target.prototype, name, Object.getOwnPropertyDescriptor(AnalysisExecutionMethods.prototype, name));
  }
}

module.exports = { installAnalysisExecutionMethods };
