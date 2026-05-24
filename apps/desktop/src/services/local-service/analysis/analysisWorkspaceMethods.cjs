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
  analysisMigratedTaskSectionsFromSummary,
  analysisModelRunName,
  analysisTaskBatchScript,
  analysisTaskDisplayArtifacts,
  analysisTaskGradeLogText,
  analysisTaskProcessStatus,
  analysisTaskPromptPath,
  analysisTaskSectionsFromGradeLog,
  analysisTestCounts,
  analysisTestPassRatio,
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
  readRelativeJson,
  readRelativeText,
  readRelativeTextAny,
  readRootAgentMaxTurns,
  replaceAnalysisDockerEnvironment,
  sectionScore,
  shellQuoteSingle,
} = require("./benchmarkUtils.cjs");

const REDOU_CONTEXT_DIR = ".redou";
const REDOU_ANALYSIS_DIR = "analysis";
const ANALYSIS_DOCKER_START_WAIT_MS = 180000;
const ANALYSIS_DOCKER_START_POLL_MS = 5000;

function delay(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class AnalysisWorkspaceMethods {
  nextAnalysisWorkspacePath(key, runId = "") {
    const root = this.analysisWorkspaceRoot();
    const base = safeSegment(key, "model");
    const run = safeSegment(runId, "run").slice(0, 32) || "run";
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const suffix = attempt === 0 ? run : `${run}-${attempt}`;
      const candidate = assertChildPath(root, path.join(root, `${base}-${suffix}`), "analysis workspace");
      if (!fs.existsSync(candidate)) return candidate;
    }
    const candidate = assertChildPath(
      root,
      path.join(root, `${base}-${run}-${crypto.randomBytes(4).toString("hex")}`),
      "analysis workspace",
    );
    return candidate;
  }

  prepareAnalysisWorkspace(key, runId = "") {
    const root = this.analysisWorkspaceRoot();
    mkdirp(root);
    const workspace = path.join(root, safeSegment(key, "model"));
    if (fs.existsSync(workspace)) {
      const resolved = assertChildPath(root, workspace, "analysis workspace");
      try {
        removeDirectoryWithRetries(resolved);
      } catch (error) {
        if (!isTransientFileError(error)) {
          throw error;
        }
        const fallback = this.nextAnalysisWorkspacePath(key, runId);
        this.log(
          `Analysis workspace is busy (${error.code || error.message}); using a fresh workspace: ${fallback}`,
        );
        return this.prepareAnalysisWorkspaceAt(fallback);
      }
    }
    return this.prepareAnalysisWorkspaceAt(workspace);
  }

  prepareAnalysisWorkspaceAt(workspace) {
    mkdirp(workspace);
    mkdirp(path.join(workspace, "projects"));
    mkdirp(path.join(workspace, "reports"));
    mkdirp(path.join(workspace, "logs"));
    mkdirp(analysisDisplayResultsDir(workspace));
    const promptDir = path.join(workspace, REDOU_CONTEXT_DIR, REDOU_ANALYSIS_DIR, "prompts");
    mkdirp(promptDir);
    for (const task of ANALYSIS_TASKS) {
      const source = analysisTaskPromptPath(this.hermesRoot, task);
      if (fs.existsSync(source)) {
        fs.copyFileSync(source, path.join(promptDir, path.basename(task.file)));
      }
    }
    const analyzeRoot = path.join(this.hermesRoot, "analyze");
    const supportFiles = [
      "task_project_tasks.py",
      "task_project_prepare.py",
      "task_project_judge.py",
      "task_project_evaluate.py",
      "task_project_requirements.txt",
      "task1_grade_all.sh",
      "task2_grade_all.sh",
      "task2_phase0_env_check.sh",
      "task2_phase1_project_scaffold_check.sh",
      "task2_phase2_data_logic_check.sh",
      "task2_phase3_ui_build_check.sh",
      "task2_phase4_runtime_check.sh",
      "task2_phase5_report_check.sh",
      "task3_grade_all.sh",
      "task3_phase0_env_check.sh",
      "task3_phase1_scaffold_check.sh",
      "task3_phase2_initial_failure_check.sh",
      "task3_phase3_final_pass_check.sh",
      "task3_phase4_behavior_check.sh",
      "task3_phase5_report_check.sh",
      "task4_grade_all.sh",
      "task4_phase0_env_check.sh",
      "task4_phase1_sources_notes_check.sh",
      "task4_phase2_report_comparison_check.sh",
      "task4_phase3_product_design_check.sh",
      "task4_phase4_citation_quality_check.sh",
      "task4_phase5_delivery_check.sh",
      "task5.yaml",
      "task6.yaml",
      "task7.yaml",
      "task8.yaml",
      "task9.yaml",
      "task5_grade_all.sh",
      "task6_grade_all.sh",
      "task7_grade_all.sh",
      "task8_grade_all.sh",
      "task9_grade_all.sh",
    ];
    for (const file of supportFiles) {
      const source = path.join(analyzeRoot, file);
      if (fs.existsSync(source)) {
        const target = path.join(workspace, file);
        fs.copyFileSync(source, target);
        if (/\.sh$/i.test(file)) {
          fs.writeFileSync(target, normalizeAnalysisWorkspaceScript(readText(target)), "utf8");
        }
      }
    }
    for (const dir of [
      "task5_source",
      "task5_tests",
      "task6_source",
      "task6_tests",
      "task7_source",
      "task7_tests",
      "task8_source",
      "task8_tests",
      "task9_source",
      "task9_tests",
    ]) {
      copyDirectoryRecursive(path.join(analyzeRoot, dir), path.join(workspace, dir));
    }
    return workspace;
  }

  analysisPromptForTask(task, provider, model, context = {}) {
    const promptPath = analysisTaskPromptPath(this.hermesRoot, task);
    let taskPrompt = readText(promptPath).trim();
    if (!taskPrompt) {
      throw new Error(`Analysis prompt not found: ${promptPath}`);
    }
    const analysisEnvName =
      context.analysisEnvName || analysisDockerEnvironmentName(provider, model, context.key);
    const modelRunName = context.modelRunName || analysisModelRunName(provider, model, "");
    const dockerWorkspace = ANALYSIS_DOCKER_WORKSPACE;
    const benchmarkRoot = dockerWorkspace;
    const taskNumber = String(task.id || "").replace(/^task/, "");
    const taskFolder = `task${taskNumber}`;
    const runRoot = `${benchmarkRoot}/model_runs/${modelRunName}`;
    const replacements = {
      "@@MODEL_NAME@@": modelRunName,
      "@@DOCKER_SERVICE@@": analysisEnvName,
      "@@DOCKER_WORKSPACE@@": dockerWorkspace,
      "@@BENCHMARK_ROOT@@": benchmarkRoot,
      "@@RUN_ROOT@@": runRoot,
      "@@RUN_DIR@@": `${runRoot}/${taskFolder}`,
      "@@RESULTS_DIR@@": `${runRoot}/results`,
      "@@TASK_NUMBER@@": taskNumber,
      "@@TASK_FOLDER@@": taskFolder,
    };
    for (const [token, value] of Object.entries(replacements)) {
      taskPrompt = taskPrompt.split(token).join(value);
    }
    taskPrompt = taskPrompt.replace(/<MODEL_NAME>/g, modelRunName);
    taskPrompt = replaceAnalysisDockerEnvironment(taskPrompt, analysisEnvName);
    return [
      "You are running a Redou Agent model capability benchmark.",
      `Benchmark task: ${task.id} - ${task.title}.`,
      `Model under test: ${provider || "auto"} / ${model || "default"}.`,
      "Work only in the current working directory. Complete the benchmark task as written.",
      "Use real tool calls and real command output. Do not invent verification results.",
      "At the end, briefly report what was completed, where artifacts were saved, and any failures.",
      `Docker test environment for this model: ${analysisEnvName}.`,
      `Use ${analysisEnvName} wherever the task refers to the Docker Compose service, Docker container, or docker compose exec target.`,
      "Treat /workspace as the only benchmark workspace path inside Docker. All task paths such as /workspace/projects, /workspace/reports, /workspace/logs, and /workspace/model_runs refer to that Docker path.",
      "Do not write benchmark artifacts to a host-side absolute /workspace path or to a nested ./workspace directory. If you need to create or edit an absolute /workspace path, do it through Docker, for example docker compose exec -T " +
        `${analysisEnvName} bash -lc 'mkdir -p /workspace/projects /workspace/reports /workspace/logs'.`,
      "The benchmark run root is mounted into Docker as /workspace, so files created there must persist back into the Redou analysis workspace.",
      "",
      taskPrompt,
    ].join("\n");
  }

  runAnalysisShellCommand({ command, args = [], cwd, timeoutMs = 600000, env = {} }) {
    return this.processManager.runBufferedCommand({
      command,
      args,
      cwd,
      env: this.childEnv(env),
      timeoutMs,
      shutdown: this.shuttingDown,
      shutdownResult: { code: null, signal: "shutdown", error: "Redou Agent is closing.", output: "" },
      trackingSet: this.activeAnalysisShellChildren,
    });
  }

  async requestAnalysisDockerDesktopStart(platform = process.platform, cwd = this.projectRoot) {
    if (this.shuttingDown) {
      return { status: "skipped", output: "Redou Agent is closing." };
    }
    if (platform === "win32") {
      const script = [
        "$messages = @()",
        "try {",
        "  Start-Service -Name com.docker.service -ErrorAction SilentlyContinue",
        "  $messages += 'service:start-requested'",
        "} catch {",
        "  $messages += ('service:error ' + $_.Exception.Message)",
        "}",
        "$paths = @(",
        "  (Join-Path $env:ProgramFiles 'Docker\\Docker\\Docker Desktop.exe'),",
        "  (Join-Path ${env:ProgramFiles(x86)} 'Docker\\Docker\\Docker Desktop.exe'),",
        "  (Join-Path $env:LOCALAPPDATA 'Docker\\Docker Desktop.exe')",
        ") | Where-Object { $_ -and (Test-Path $_) }",
        "$desktop = $paths | Select-Object -First 1",
        "if ($desktop) {",
        "  Start-Process -FilePath $desktop -WindowStyle Hidden",
        "  $messages += ('desktop:start-requested ' + $desktop)",
        "} else {",
        "  $messages += 'desktop:not-found'",
        "}",
        "$messages -join \"`n\"",
      ].join("\n");
      const result = await this.runAnalysisShellCommand({
        command: "powershell.exe",
        args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
        cwd,
        timeoutMs: 60000,
      });
      return {
        status: result.code === 0 ? "started" : "failed",
        output: result.output || result.error || "",
        code: result.code,
      };
    }
    if (platform === "darwin") {
      const result = await this.runAnalysisShellCommand({
        command: "open",
        args: ["-g", "-a", "Docker"],
        cwd,
        timeoutMs: 60000,
      });
      return {
        status: result.code === 0 ? "started" : "failed",
        output: result.output || result.error || "",
        code: result.code,
      };
    }
    return {
      status: "skipped",
      output: `Automatic Docker startup is not configured for platform ${platform}.`,
    };
  }

  async ensureAnalysisHostDockerAvailable({
    cwd = this.projectRoot,
    reason = "",
    waitMs = ANALYSIS_DOCKER_START_WAIT_MS,
    pollMs = ANALYSIS_DOCKER_START_POLL_MS,
    platform = process.platform,
  } = {}) {
    if (this.shuttingDown) {
      return { status: "skipped", reason: "Redou Agent is closing." };
    }
    const dockerInfo = async () => this.runAnalysisShellCommand({
      command: "docker",
      args: ["info"],
      cwd,
      timeoutMs: 60000,
    });
    const first = await dockerInfo();
    if (first.code === 0) {
      return { status: "completed", output: first.output || first.stdout || "" };
    }

    const startResult = await this.requestAnalysisDockerDesktopStart(platform, cwd);
    const deadline = Date.now() + Math.max(0, waitMs);
    let last = first;
    while (!this.shuttingDown && Date.now() < deadline) {
      const sleepMs = Math.min(Math.max(0, pollMs), Math.max(0, deadline - Date.now()));
      await delay(sleepMs);
      last = await dockerInfo();
      if (last.code === 0) {
        const startOutput = compactMultiline(startResult.output || "", 400);
        return {
          status: "completed",
          startedDocker: true,
          reason,
          output: [startOutput, last.output || last.stdout || ""].filter(Boolean).join("\n"),
          startResult,
        };
      }
      if (pollMs <= 0) {
        await delay(1);
      }
    }

    return {
      status: "failed",
      startedDocker: startResult.status === "started",
      reason,
      startResult,
      error: compactMultiline(
        [
          `Docker is not available${reason ? ` while ${reason}` : ""}.`,
          startResult.output ? `Startup attempt: ${startResult.output}` : "",
          last.output || last.error || first.output || first.error || "",
        ].filter(Boolean).join("\n"),
        1600,
      ),
    };
  }

  backupAnalysisEnvironmentFile(workspacePath, fileName) {
    const source = path.join(workspacePath, fileName);
    if (!fs.existsSync(source)) return;
    const backupPath = path.join(
      workspacePath,
      REDOU_CONTEXT_DIR,
      REDOU_ANALYSIS_DIR,
      "scheduler",
      `${fileName}.before-scheduler`,
    );
    if (!fs.existsSync(backupPath)) {
      copyFileAtomic(source, backupPath);
    }
  }

  writeAnalysisFallbackDockerEnvironment(workspacePath, envName, reason = "") {
    mkdirp(workspacePath);
    this.backupAnalysisEnvironmentFile(workspacePath, "Dockerfile");
    this.backupAnalysisEnvironmentFile(workspacePath, "docker-compose.yml");
    const dockerfile = [
      "FROM node:20-bookworm",
      "RUN apt-get update \\",
      "  && apt-get install -y --no-install-recommends \\",
      "    bash ca-certificates curl git python-is-python3 python3 python3-markupsafe \\",
      "    python3-pip python3-pytest python3-trio python3-venv wget \\",
      "  && rm -rf /var/lib/apt/lists/*",
      "WORKDIR /workspace",
      'CMD ["bash", "-lc", "tail -f /dev/null"]',
      "",
    ].join("\n");
    const compose = [
      "services:",
      `  ${envName}:`,
      "    build:",
      "      context: .",
      `    container_name: ${yamlString(envName)}`,
      `    working_dir: ${yamlString(ANALYSIS_DOCKER_WORKSPACE)}`,
      "    volumes:",
      `      - .:${ANALYSIS_DOCKER_WORKSPACE}`,
      '    command: bash -lc "tail -f /dev/null"',
      "",
    ].join("\n");
    mkdirp(path.join(workspacePath, REDOU_CONTEXT_DIR, REDOU_ANALYSIS_DIR, "scheduler"));
    fs.writeFileSync(path.join(workspacePath, "Dockerfile"), dockerfile, "utf8");
    fs.writeFileSync(path.join(workspacePath, "docker-compose.yml"), compose, "utf8");
    fs.writeFileSync(
      path.join(workspacePath, REDOU_CONTEXT_DIR, REDOU_ANALYSIS_DIR, "scheduler", "docker-fallback-reason.txt"),
      `${reason || "Scheduler-created Docker environment."}\n`,
      "utf8",
    );
    return { status: "created", envName, reason };
  }

  analysisRequirementsInstallScript() {
    return [
      "set -e",
      `cd ${ANALYSIS_DOCKER_WORKSPACE}`,
      "if ! command -v python >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1 && test \"$(id -u)\" = '0'; then",
      "  ln -sf \"$(command -v python3)\" /usr/local/bin/python 2>/dev/null || true",
      "fi",
      "if test -f task_project_requirements.txt; then",
      "  export PIP_DISABLE_PIP_VERSION_CHECK=1",
      "  export PIP_NO_INPUT=1",
      "  requirements_satisfied() {",
      "    python3 - <<'PY'",
      "from pathlib import Path",
      "import importlib.util",
      "import re",
      "import sys",
      "aliases = {",
      "    'markupsafe': 'markupsafe',",
      "    'pytest': 'pytest',",
      "    'trio': 'trio',",
      "}",
      "names = []",
      "for raw in Path('task_project_requirements.txt').read_text(encoding='utf-8').splitlines():",
      "    line = raw.strip()",
      "    if not line or line.startswith('#') or line.startswith('-'):",
      "        continue",
      "    package = re.split(r'[<>=!~;\\[]', line, 1)[0].strip().lower().replace('-', '_')",
      "    if package:",
      "        names.append(aliases.get(package, package))",
      "missing = [name for name in names if importlib.util.find_spec(name) is None]",
      "sys.exit(1 if missing else 0)",
      "PY",
      "  }",
      "  if requirements_satisfied; then",
      "    echo 'Analysis Python requirements already satisfied.'",
      "  else",
      "    if command -v apt-get >/dev/null 2>&1 && test \"$(id -u)\" = '0'; then",
      "      apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends python3-markupsafe python3-pytest python3-trio || true",
      "      rm -rf /var/lib/apt/lists/* || true",
      "    fi",
      "    if requirements_satisfied; then",
      "      echo 'Analysis Python requirements satisfied by system packages.'",
      "    elif python3 -m pip install --break-system-packages --prefer-binary --retries 5 --timeout 30 -r task_project_requirements.txt; then",
      "      echo 'Analysis Python requirements installed with system pip.'",
      "    else",
      "      VENV=/workspace/.redou/analysis/venv",
      "      mkdir -p \"$(dirname \"$VENV\")\"",
      "      python3 -m venv \"$VENV\"",
      "      \"$VENV/bin/python\" -m pip install --upgrade pip setuptools wheel",
      "      \"$VENV/bin/python\" -m pip install --prefer-binary --retries 5 --timeout 30 -r task_project_requirements.txt",
      "      ln -sf \"$VENV/bin/python\" /usr/local/bin/python 2>/dev/null || true",
      "      ln -sf \"$VENV/bin/pip\" /usr/local/bin/pip 2>/dev/null || true",
      "      echo 'Analysis Python requirements installed in /workspace/.redou/analysis/venv.'",
      "    fi",
      "  fi",
      "fi",
    ].join("\n");
  }

  async analysisDockerContainerId(envName, workspacePath) {
    if (!envName || !workspacePath || this.shuttingDown) {
      return { status: "skipped", containerId: "", output: "" };
    }
    const composeResult = await this.runAnalysisShellCommand({
      command: "docker",
      args: ["compose", "ps", "-q", envName],
      cwd: workspacePath,
      timeoutMs: 120000,
    });
    const composeId = String(composeResult.stdout || composeResult.output || "").trim().split(/\r?\n/).find(Boolean) || "";
    if (composeResult.code === 0 && composeId) {
      return { status: "completed", containerId: composeId, output: composeResult.output || composeId };
    }
    const inspectResult = await this.runAnalysisShellCommand({
      command: "docker",
      args: ["inspect", "-f", "{{.Id}}", envName],
      cwd: workspacePath,
      timeoutMs: 120000,
    });
    const inspectedId = String(inspectResult.stdout || inspectResult.output || "").trim().split(/\r?\n/).find(Boolean) || "";
    if (inspectResult.code === 0 && inspectedId) {
      return { status: "completed", containerId: inspectedId, output: inspectResult.output || inspectedId };
    }
    return {
      status: "failed",
      containerId: "",
      output: compactMultiline(`${composeResult.output || ""}\n${inspectResult.output || inspectResult.error || ""}`, 1200),
    };
  }

  async copyAnalysisBenchmarkSupportIntoDocker(workspacePath, envName) {
    const container = await this.analysisDockerContainerId(envName, workspacePath);
    if (container.status !== "completed" || !container.containerId) {
      return { status: "skipped", envName, reason: "container not available", output: container.output || "" };
    }

    const supportEntries = [
      "task_project_tasks.py",
      "task_project_prepare.py",
      "task_project_judge.py",
      "task_project_evaluate.py",
      "task_project_requirements.txt",
      "task1_grade_all.sh",
      "task2_grade_all.sh",
      "task2_phase0_env_check.sh",
      "task2_phase1_project_scaffold_check.sh",
      "task2_phase2_data_logic_check.sh",
      "task2_phase3_ui_build_check.sh",
      "task2_phase4_runtime_check.sh",
      "task2_phase5_report_check.sh",
      "task3_grade_all.sh",
      "task3_phase0_env_check.sh",
      "task3_phase1_scaffold_check.sh",
      "task3_phase2_initial_failure_check.sh",
      "task3_phase3_final_pass_check.sh",
      "task3_phase4_behavior_check.sh",
      "task3_phase5_report_check.sh",
      "task4_grade_all.sh",
      "task4_phase0_env_check.sh",
      "task4_phase1_sources_notes_check.sh",
      "task4_phase2_report_comparison_check.sh",
      "task4_phase3_product_design_check.sh",
      "task4_phase4_citation_quality_check.sh",
      "task4_phase5_delivery_check.sh",
      "task5.yaml",
      "task6.yaml",
      "task7.yaml",
      "task8.yaml",
      "task9.yaml",
      "task5_grade_all.sh",
      "task6_grade_all.sh",
      "task7_grade_all.sh",
      "task8_grade_all.sh",
      "task9_grade_all.sh",
      "task5_source",
      "task5_tests",
      "task6_source",
      "task6_tests",
      "task7_source",
      "task7_tests",
      "task8_source",
      "task8_tests",
      "task9_source",
      "task9_tests",
    ];
    const copied = [];
    const missing = [];
    for (const entry of supportEntries) {
      const source = path.join(workspacePath, entry);
      if (!fs.existsSync(source)) continue;
      const containerPath = `${ANALYSIS_DOCKER_WORKSPACE}/${entry.replace(/\\/g, "/")}`;
      const existsResult = await this.runAnalysisShellCommand({
        command: "docker",
        args: ["exec", container.containerId, "bash", "-lc", `test -e ${shellQuoteSingle(containerPath)}`],
        cwd: workspacePath,
        timeoutMs: 120000,
      });
      if (existsResult.code === 0) continue;
      const stat = fs.statSync(source);
      if (stat.isDirectory()) {
        await this.runAnalysisShellCommand({
          command: "docker",
          args: ["exec", container.containerId, "bash", "-lc", `mkdir -p ${shellQuoteSingle(containerPath)}`],
          cwd: workspacePath,
          timeoutMs: 120000,
        });
      }
      const cpSource = stat.isDirectory() ? path.join(source, ".") : source;
      const cpTarget = stat.isDirectory()
        ? `${container.containerId}:${containerPath}/`
        : `${container.containerId}:${containerPath}`;
      const cpResult = await this.runAnalysisShellCommand({
        command: "docker",
        args: ["cp", cpSource, cpTarget],
        cwd: workspacePath,
        timeoutMs: 240000,
      });
      if (cpResult.code === 0) {
        copied.push(entry);
      } else {
        missing.push(`${entry}: ${compactMultiline(cpResult.output || cpResult.error, 400)}`);
      }
    }
    return {
      status: missing.length ? "failed" : "completed",
      envName,
      copied,
      missing,
      output: missing.join("\n"),
    };
  }

  async ensureAnalysisDockerEnvironment({ workspacePath, provider, model, key, analysisEnvName = "", reason = "" }) {
    const envName = analysisEnvName || analysisDockerEnvironmentName(provider, model, key);
    if (!workspacePath || this.shuttingDown) {
      return { status: "skipped", envName, reason: "workspace unavailable" };
    }
    const hostDocker = await this.ensureAnalysisHostDockerAvailable({
      cwd: workspacePath,
      reason: reason || `preparing Docker test environment ${envName}`,
    });
    if (hostDocker.status === "failed") {
      return {
        status: "failed",
        envName,
        reason: reason || "Docker host unavailable",
        error: hostDocker.error || "Docker is not available.",
        hostDocker,
      };
    }

    const composePath = path.join(workspacePath, "docker-compose.yml");
    const composeText = readText(composePath);
    let fallbackReason = "";
    if (!composeText) {
      fallbackReason = "docker-compose.yml was missing after task1.";
    } else if (!analysisComposeHasService(composeText, envName)) {
      fallbackReason = `docker-compose.yml did not define the expected service ${envName}.`;
    } else if (!analysisComposeHasWorkspaceMount(composeText)) {
      fallbackReason = "docker-compose.yml did not mount the benchmark root as /workspace.";
    }

    let fallbackCreated = false;
    if (fallbackReason) {
      this.writeAnalysisFallbackDockerEnvironment(workspacePath, envName, fallbackReason);
      fallbackCreated = true;
    }

    const up = async () => this.runAnalysisShellCommand({
      command: "docker",
      args: ["compose", "up", "-d", "--build"],
      cwd: workspacePath,
      timeoutMs: 900000,
    });
    let upResult = await up();
    if (upResult.code !== 0 && !fallbackCreated) {
      this.writeAnalysisFallbackDockerEnvironment(
        workspacePath,
        envName,
        `Existing Docker environment failed to start: ${compactMultiline(upResult.output || upResult.error, 800)}`,
      );
      fallbackCreated = true;
      upResult = await up();
    }
    if (upResult.code !== 0) {
      return {
        status: "failed",
        envName,
        createdFallback: fallbackCreated,
        error: upResult.output || upResult.error || `docker compose up exited with code ${upResult.code}`,
      };
    }

    let container = await this.analysisDockerContainerId(envName, workspacePath);
    if (container.status !== "completed" && !fallbackCreated) {
      this.writeAnalysisFallbackDockerEnvironment(
        workspacePath,
        envName,
        `Expected Docker service ${envName} did not start from the model compose file.`,
      );
      fallbackCreated = true;
      upResult = await up();
      container = await this.analysisDockerContainerId(envName, workspacePath);
    }
    if (container.status !== "completed") {
      return {
        status: "failed",
        envName,
        createdFallback: fallbackCreated,
        error: container.output || `Docker container for ${envName} was not found.`,
      };
    }

    const initWorkspace = async () => this.runAnalysisShellCommand({
      command: "docker",
      args: [
        "compose",
        "exec",
        "-T",
        envName,
        "bash",
        "-lc",
        [
          `mkdir -p ${ANALYSIS_DOCKER_WORKSPACE}/projects ${ANALYSIS_DOCKER_WORKSPACE}/reports ${ANALYSIS_DOCKER_WORKSPACE}/logs ${ANALYSIS_DOCKER_WORKSPACE}/model_runs`,
          `test -d ${ANALYSIS_DOCKER_WORKSPACE}/projects`,
          `test -d ${ANALYSIS_DOCKER_WORKSPACE}/reports`,
          `test -d ${ANALYSIS_DOCKER_WORKSPACE}/logs`,
        ].join(" && "),
      ],
      cwd: workspacePath,
      timeoutMs: 240000,
    });
    let initResult = await initWorkspace();
    if (initResult.code !== 0 && !fallbackCreated) {
      this.writeAnalysisFallbackDockerEnvironment(
        workspacePath,
        envName,
        `Existing Docker service could not initialize /workspace: ${compactMultiline(initResult.output || initResult.error, 800)}`,
      );
      fallbackCreated = true;
      upResult = await up();
      if (upResult.code === 0) {
        container = await this.analysisDockerContainerId(envName, workspacePath);
        if (container.status === "completed") {
          initResult = await initWorkspace();
        }
      }
    }
    if (initResult.code !== 0) {
      return {
        status: "failed",
        envName,
        createdFallback: fallbackCreated,
        error: initResult.output || initResult.error || "Docker workspace initialization failed.",
      };
    }

    const supportCopy = await this.copyAnalysisBenchmarkSupportIntoDocker(workspacePath, envName);
    const requirementsInstall = await this.runAnalysisShellCommand({
      command: "docker",
      args: [
        "compose",
        "exec",
        "-T",
        envName,
        "bash",
        "-lc",
        this.analysisRequirementsInstallScript(),
      ],
      cwd: workspacePath,
      timeoutMs: 600000,
    });
    if (requirementsInstall.code !== 0) {
      return {
        status: "failed",
        envName,
        createdFallback: fallbackCreated,
        reason: fallbackReason || reason,
        error: requirementsInstall.output || requirementsInstall.error || "Analysis project requirements installation failed.",
        supportCopy,
      };
    }
    return {
      status: supportCopy.status === "failed" ? "failed" : "completed",
      envName,
      createdFallback: fallbackCreated,
      reason: fallbackReason || reason,
      output: compactMultiline(
        [upResult.output, supportCopy.output, requirementsInstall.output].filter(Boolean).join("\n"),
        1600,
      ),
      supportCopy,
      requirementsInstall,
    };
  }

  async syncAnalysisDockerArtifacts(workspacePath, envName, modelRunName = "") {
    const container = await this.analysisDockerContainerId(envName, workspacePath);
    if (container.status !== "completed" || !container.containerId) {
      return { status: "skipped", envName, reason: "container not available", output: container.output || "" };
    }
    const entries = ["projects", "reports", "logs"];
    if (modelRunName) {
      entries.push(`model_runs/${modelRunName}/results`);
    } else {
      entries.push("model_runs");
    }
    const copied = [];
    const failed = [];
    for (const entry of entries) {
      const containerPath = `${ANALYSIS_DOCKER_WORKSPACE}/${entry}`;
      const existsResult = await this.runAnalysisShellCommand({
        command: "docker",
        args: ["exec", container.containerId, "bash", "-lc", `test -e ${shellQuoteSingle(containerPath)}`],
        cwd: workspacePath,
        timeoutMs: 120000,
      });
      if (existsResult.code !== 0) continue;
      const target = path.join(workspacePath, ...entry.split("/"));
      mkdirp(target);
      const cpResult = await this.runAnalysisShellCommand({
        command: "docker",
        args: ["cp", `${container.containerId}:${containerPath}/.`, target],
        cwd: workspacePath,
        timeoutMs: 300000,
      });
      if (cpResult.code === 0) {
        copied.push(entry);
      } else {
        failed.push(`${entry}: ${compactMultiline(cpResult.output || cpResult.error, 400)}`);
      }
    }
    return {
      status: failed.length ? "failed" : "completed",
      envName,
      copied,
      output: failed.join("\n"),
    };
  }

}

function installAnalysisWorkspaceMethods(target) {
  for (const name of Object.getOwnPropertyNames(AnalysisWorkspaceMethods.prototype)) {
    if (name === "constructor") continue;
    Object.defineProperty(target.prototype, name, Object.getOwnPropertyDescriptor(AnalysisWorkspaceMethods.prototype, name));
  }
}

module.exports = { installAnalysisWorkspaceMethods };
