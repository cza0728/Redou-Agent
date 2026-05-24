const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { RedouLocalService, analysisTaskProcessStatus } = require("../src/services/redouLocalService.cjs");

function makeService() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "redou-analysis-"));
  const app = {
    getPath(name) {
      assert.equal(name, "userData");
      return path.join(root, "userData");
    },
  };
  const service = new RedouLocalService({
    app,
    projectRoot: root,
    hermesHome: path.join(root, "hermes-home"),
    log: () => {},
  });
  return { root, service };
}

function writeAnalysisPrompt(root, file, text) {
  const promptPath = path.join(root, "vendor", "hermes", "analyze", file);
  fs.mkdirSync(path.dirname(promptPath), { recursive: true });
  fs.writeFileSync(promptPath, text, "utf8");
}

test("analysis prompts replace the fixed docker environment per model", () => {
  const { root, service } = makeService();
  writeAnalysisPrompt(
    root,
    "task2.md",
    [
      "Docker Compose service: agent-lab",
      "Docker container: agent-lab",
      'Run: docker compose exec agent-lab bash -lc "npm test"',
    ].join("\n"),
  );

  const prompt = service.analysisPromptForTask(
    { id: "task2", file: "task2.md", title: "Small project build", capability: "implementation" },
    "openai",
    "gpt-test",
    { key: "openai--gpt-test" },
  );

  assert.match(prompt, /\bagent-lab-openai-gpt-test\b/);
  assert.doesNotMatch(prompt, /agent-lab(?!-[a-z0-9])/);
  assert.match(prompt, /docker compose exec agent-lab-openai-gpt-test/);
  assert.match(prompt, /Treat \/workspace as the only benchmark workspace path inside Docker/);
  assert.match(prompt, /Do not write benchmark artifacts to a host-side absolute \/workspace path/);
  assert.equal(
    fs.readFileSync(path.join(root, "vendor", "hermes", "analyze", "task2.md"), "utf8"),
    [
      "Docker Compose service: agent-lab",
      "Docker container: agent-lab",
      'Run: docker compose exec agent-lab bash -lc "npm test"',
    ].join("\n"),
  );
});

test("analysis workspace copies and rewrites docker batch scripts without changing sources", () => {
  const { root, service } = makeService();
  const analyzeRoot = path.join(root, "vendor", "hermes", "analyze");
  fs.mkdirSync(analyzeRoot, { recursive: true });
  fs.writeFileSync(path.join(analyzeRoot, "task1.md"), "Task 1\n", "utf8");
  fs.writeFileSync(path.join(analyzeRoot, "task1_grade_all.sh"), "docker compose exec \"$SERVICE\" bash -lc \"pwd\"\n", "utf8");
  fs.writeFileSync(
    path.join(analyzeRoot, "task2_phase0_env_check.sh"),
    [
      "#!/usr/bin/env bash",
      'SERVICE="agent-lab"',
      'docker compose exec "$SERVICE" bash -lc "pwd"',
      "",
    ].join("\r\n"),
    "utf8",
  );

  const workspace = service.prepareAnalysisWorkspace("openai--gpt-test", "run-scripts");

  assert.equal(fs.existsSync(path.join(workspace, "task1_grade_all.sh")), true);
  const copiedPhase = fs.readFileSync(path.join(workspace, "task2_phase0_env_check.sh"), "utf8");
  assert.doesNotMatch(copiedPhase, /\r/);
  assert.match(copiedPhase, /SERVICE="\$\{DOCKER_SERVICE:-agent-lab\}"/);
  assert.match(copiedPhase, /docker compose exec -T "\$SERVICE"/);
  const sourcePhase = fs.readFileSync(path.join(analyzeRoot, "task2_phase0_env_check.sh"), "utf8");
  assert.match(sourcePhase, /^SERVICE="agent-lab"$/m);
  assert.doesNotMatch(sourcePhase, /exec -T/);
});

test("analysis scheduler creates a fallback docker environment when task1 did not", async () => {
  const { root, service } = makeService();
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  const calls = [];
  service.runAnalysisShellCommand = async (input) => {
    calls.push(input);
    if (input.args.join(" ") === "compose ps -q agent-lab-openai-gpt-test") {
      return { code: 0, stdout: "container-id\n", output: "container-id" };
    }
    return { code: 0, stdout: "", output: "ok" };
  };

  const result = await service.ensureAnalysisDockerEnvironment({
    workspacePath: workspace,
    provider: "openai",
    model: "gpt-test",
    key: "openai--gpt-test",
    analysisEnvName: "agent-lab-openai-gpt-test",
    reason: "test",
  });

  assert.equal(result.status, "completed");
  assert.equal(result.createdFallback, true);
  const compose = fs.readFileSync(path.join(workspace, "docker-compose.yml"), "utf8");
  assert.match(compose, /agent-lab-openai-gpt-test:/);
  assert.match(compose, /\.:\/workspace/);
  assert.ok(calls.some((call) => call.args.join(" ") === "compose up -d --build"));
  assert.ok(calls.some((call) => call.args.includes("exec") && call.args.includes("-T")));
  assert.ok(
    calls.some(
      (call) =>
        call.args.includes("exec") &&
        call.args.join(" ").includes("python3 -m pip install --break-system-packages --prefer-binary --retries 5 --timeout 30 -r task_project_requirements.txt"),
    ),
  );
});

test("analysis docker preflight passes when the docker daemon is already available", async () => {
  const { service } = makeService();
  const calls = [];
  service.runAnalysisShellCommand = async (input) => {
    calls.push(input);
    return { code: 0, output: "Server: Docker Desktop" };
  };

  const result = await service.ensureAnalysisHostDockerAvailable({ cwd: service.projectRoot });

  assert.equal(result.status, "completed");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ["info"]);
});

test("analysis docker preflight starts Docker Desktop on Windows and waits for daemon readiness", async () => {
  const { service } = makeService();
  const calls = [];
  let dockerInfoCalls = 0;
  service.runAnalysisShellCommand = async (input) => {
    calls.push(input);
    if (input.command === "docker") {
      dockerInfoCalls += 1;
      return dockerInfoCalls === 1
        ? { code: 1, output: "failed to connect to the docker API" }
        : { code: 0, output: "Server: Docker Desktop" };
    }
    return { code: 0, output: "service:start-requested\ndesktop:start-requested" };
  };

  const result = await service.ensureAnalysisHostDockerAvailable({
    cwd: service.projectRoot,
    platform: "win32",
    waitMs: 1000,
    pollMs: 0,
  });

  assert.equal(result.status, "completed");
  assert.equal(result.startedDocker, true);
  assert.equal(dockerInfoCalls, 2);
  assert.ok(calls.some((call) => call.command === "powershell.exe"));
});

test("analysis benchmark interrupts instead of zero-scoring model tasks when Docker setup fails", async () => {
  const { root, service } = makeService();
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  const webContents = {
    isDestroyed: () => false,
    send: () => {},
  };
  service.startAnalysisQueue = () => {};
  service.startAnalysisBenchmarks(webContents, {
    models: [{ provider: "openai", model: "gpt-test" }],
  });
  const item = service.analysisQueue[0];
  service.prepareAnalysisWorkspace = () => workspace;
  service.ensureAnalysisHostDockerAvailable = async () => ({ status: "completed" });
  service.removeAnalysisDockerContainer = async () => ({ status: "skipped" });
  service.analysisPromptForTask = () => "Prompt";
  service.ensureAnalysisDockerEnvironment = async () => ({
    status: "failed",
    error: "Could not fetch URL https://pypi.org/simple/pytest/: SSLZeroReturnError",
  });
  service.runAnalysisTaskProcess = async ({ task }) => ({
    id: task.id,
    title: task.title,
    capability: task.capability,
    status: "completed",
    startedAt: new Date(Date.now() - 1000).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 1000,
    inputTokens: 10,
    outputTokens: 2,
    cacheReadTokens: 0,
    reasoningTokens: 0,
    apiCalls: 1,
    estimatedCostUsd: 0,
    score: 100,
    sections: [{ id: "environment_verification", label: "Environment verification", score: 100, evidence: "ok" }],
    summary: "Task completed",
    error: null,
  });
  service.runAnalysisTaskBatchPostprocess = async ({ task }) => {
    fs.mkdirSync(path.join(workspace, "logs"), { recursive: true });
    fs.writeFileSync(
      path.join(workspace, "logs", `${task.id}_grade_all.log`),
      [
        `Task: ${task.id}`,
        "==============================",
        "Running Task1 Phase 1: Files (20 pts)",
        "==============================",
        "Task1 Phase 1: Files PASS: +20",
        "==============================",
        "Final Score: 20 / 100",
      ].join("\n"),
      "utf8",
    );
    return { status: "completed", summary: `Batch post-processing completed: logs/${task.id}_grade_all.log` };
  };

  await service.runAnalysisModelBenchmark(item);

  const result = service.readAnalysisStore().results[0];
  assert.equal(result.status, "interrupted");
  assert.match(result.summary, /Docker test environment/);
  assert.equal(result.tasks.find((task) => task.id === "task1").status, "completed");
  const task2 = result.tasks.find((task) => task.id === "task2");
  assert.equal(task2.status, "interrupted");
  assert.match(task2.error, /Docker test environment/);
  assert.equal(task2.apiCalls, 0);
});

test("analysis batch postprocess writes display logs with docker environment variables", async () => {
  const { root, service } = makeService();
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, "task5_grade_all.sh"), "#!/usr/bin/env bash\necho ok\n", "utf8");
  let captured = null;
  service.runAnalysisShellCommand = async (input) => {
    captured = input;
    return { code: 0, output: "grade output" };
  };

  const result = await service.runAnalysisTaskBatchPostprocess({
    workspacePath: workspace,
    task: { id: "task5", title: "Task 5" },
    analysisEnvName: "agent-lab-openai-gpt-test",
    modelRunName: "gpt-test",
  });

  assert.equal(result.status, "completed");
  assert.equal(captured.args[0], "-lc");
  assert.match(captured.args[1], /export DOCKER_SERVICE='agent-lab-openai-gpt-test'/);
  assert.match(captured.args[1], /bash '.\/task5_grade_all\.sh'/);
  assert.doesNotMatch(captured.args[1], /[A-Za-z]:\\/);
  assert.equal(captured.env.DOCKER_SERVICE, "agent-lab-openai-gpt-test");
  assert.equal(captured.env.DOCKER_BENCHMARK_ROOT, "/workspace");
  assert.equal(captured.env.MODEL_NAME, "gpt-test");
  assert.equal(fs.existsSync(path.join(workspace, "logs", "task5_grade_all.log")), true);
  assert.equal(fs.existsSync(path.join(workspace, "reports", "task5_grade_all.log")), true);
  assert.equal(
    fs.existsSync(path.join(workspace, ".redou", "analysis", "results", "task5", "task5_grade_all.log")),
    true,
  );
});

test("analysis benchmark response exposes display artifacts for the UI", () => {
  const { root, service } = makeService();
  const key = "openai--gpt-test";
  const workspace = path.join(root, "workspace");
  const displayDir = path.join(workspace, ".redou", "analysis", "results", "task5");
  fs.mkdirSync(path.join(displayDir, "reports"), { recursive: true });
  fs.mkdirSync(path.join(displayDir, "logs"), { recursive: true });
  fs.writeFileSync(path.join(displayDir, "task5_grade_all.log"), "Final Score: 100 / 100\n", "utf8");
  fs.writeFileSync(path.join(displayDir, "reports", "task5_report.md"), "report\n", "utf8");
  fs.writeFileSync(path.join(displayDir, "logs", "task5.log"), "log\n", "utf8");
  service.writeAnalysisStore({
    version: 1,
    results: [
      {
        key,
        runId: "run-artifacts",
        provider: "openai",
        model: "gpt-test",
        status: "completed",
        workspacePath: workspace,
        tasks: [
          {
            id: "task5",
            title: "Task 5",
            capability: "debugging",
            status: "completed",
            score: 100,
            sections: [],
          },
        ],
      },
    ],
  });

  const result = service.getAnalysisBenchmarks().results[0];
  const artifacts = result.tasks[0].artifacts;
  assert.equal(artifacts.rootPath, displayDir);
  assert.equal(artifacts.batchLogPath, path.join(displayDir, "task5_grade_all.log"));
  assert.match(artifacts.batchLogPreview, /Final Score: 100/);
  assert.deepEqual(artifacts.reports, ["task5_report.md"]);
  assert.deepEqual(artifacts.logs, ["task5.log"]);
});

test("analysis workspace falls back when the previous workspace is locked", () => {
  const { service } = makeService();
  const key = "local-vllm--qwen-qwen3.6-27b-fp8";
  const preferred = path.join(service.analysisWorkspaceRoot(), key);
  fs.mkdirSync(preferred, { recursive: true });
  fs.writeFileSync(path.join(preferred, "old.txt"), "busy", "utf8");

  const originalRmSync = fs.rmSync;
  let attempts = 0;
  fs.rmSync = (target, options) => {
    if (path.resolve(target) === path.resolve(preferred)) {
      attempts += 1;
      const error = new Error("busy");
      error.code = "EBUSY";
      throw error;
    }
    return originalRmSync(target, options);
  };

  try {
    const workspace = service.prepareAnalysisWorkspace(key, "run-locked");
    assert.notEqual(path.resolve(workspace), path.resolve(preferred));
    assert.match(path.basename(workspace), /^local-vllm--qwen-qwen3\.6-27b-fp8-run-locked/);
    assert.equal(fs.existsSync(path.join(workspace, "projects")), true);
    assert.equal(fs.existsSync(path.join(workspace, "reports")), true);
    assert.equal(fs.existsSync(path.join(workspace, "logs")), true);
    assert.equal(fs.existsSync(path.join(preferred, "old.txt")), true);
    assert.ok(attempts > 0);
  } finally {
    fs.rmSync = originalRmSync;
  }
});

test("analysis task1 does not score model command text without the batch grade log", () => {
  const { root, service } = makeService();
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(path.join(workspace, "projects"), { recursive: true });
  fs.mkdirSync(path.join(workspace, "reports"), { recursive: true });
  fs.mkdirSync(path.join(workspace, "logs"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "Dockerfile"), "FROM node:20\n", "utf8");
  fs.writeFileSync(
    path.join(workspace, "docker-compose.yml"),
    [
      "services:",
      "  agent-lab-openai-gpt-test:",
      "    container_name: agent-lab-openai-gpt-test",
      "    volumes:",
      "      - .:/workspace",
      "    command: sleep infinity",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(path.join(workspace, "README.md"), `${"Readme ".repeat(90)}\n`, "utf8");
  fs.writeFileSync(path.join(workspace, "ENV_REPORT.md"), `${"Report ".repeat(120)}\n`, "utf8");
  fs.writeFileSync(path.join(workspace, "logs", "env_check.txt"), "node v20\n", "utf8");

  const evaluation = service.evaluateAnalysisTask(
    "task1",
    workspace,
    [
      { type: "command_start", command: "docker compose up -d --build" },
      { type: "command_start", command: "docker compose ps" },
      {
        type: "command_start",
        command:
          'docker compose exec agent-lab-openai-gpt-test bash -lc "node -v && npm -v && python3 --version && pip --version && git --version && curl --version && wget --version"',
      },
    ],
    "",
    { analysisEnvName: "agent-lab-openai-gpt-test" },
  );

  assert.equal(evaluation.score, 0);
  assert.equal(evaluation.evaluatorStatus, "missing");
  assert.equal(evaluation.sections.find((section) => section.id === "fixed_evaluator").score, 0);
});

test("analysis task2-3 do not score direct docker exec text without batch grade logs", () => {
  const { root, service } = makeService();
  const workspace = path.join(root, "workspace");
  const envName = "agent-lab-openai-gpt-test";
  const boardDir = path.join(workspace, "projects", "agent-task-board");
  fs.mkdirSync(path.join(boardDir, "src"), { recursive: true });
  fs.mkdirSync(path.join(workspace, "reports"), { recursive: true });
  fs.writeFileSync(path.join(boardDir, "package.json"), "{\"scripts\":{\"start\":\"vite\"}}\n", "utf8");
  fs.writeFileSync(path.join(boardDir, "src", "app.js"), "subtask Planner Coder Reviewer Tester pending running completed failed log progress localStorage\n", "utf8");
  fs.writeFileSync(path.join(boardDir, "src", "style.css"), "body { color: #111; }\n", "utf8");
  fs.writeFileSync(path.join(boardDir, "README.md"), "Agent Task Board\n", "utf8");
  fs.writeFileSync(
    path.join(workspace, "reports", "agent-task-board-report.md"),
    `${"report ".repeat(140)}\n`,
    "utf8",
  );

  const task2 = service.evaluateAnalysisTask(
    "task2",
    workspace,
    [
      {
        type: "tool_start",
        name: "terminal",
        input: {
          command: `docker exec ${envName} bash -lc "cd /workspace/projects/agent-task-board && npm start && curl -I http://127.0.0.1:5173"`,
        },
      },
    ],
    "",
    { analysisEnvName: envName },
  );
  assert.equal(task2.score, 0);
  assert.equal(task2.evaluatorStatus, "missing");

  const labDir = path.join(workspace, "projects", "bug-fix-lab");
  fs.mkdirSync(path.join(labDir, "src"), { recursive: true });
  fs.mkdirSync(path.join(labDir, "tests"), { recursive: true });
  fs.mkdirSync(path.join(workspace, "logs"), { recursive: true });
  fs.mkdirSync(path.join(workspace, "reports"), { recursive: true });
  fs.writeFileSync(path.join(labDir, "package.json"), "{\"scripts\":{\"test\":\"node --test\"}}\n", "utf8");
  fs.writeFileSync(path.join(labDir, "src", "calculator.js"), "function add(){} function subtract(){} function multiply(){} function divide(){}\n", "utf8");
  fs.writeFileSync(path.join(labDir, "src", "textUtils.js"), "function reverseText(){} function countWords(){} function capitalizeWords(){} function isPalindrome(){}\n", "utf8");
  fs.writeFileSync(path.join(labDir, "tests", "calculator.test.js"), "test('calculator', () => {})\n", "utf8");
  fs.writeFileSync(path.join(labDir, "tests", "textUtils.test.js"), "test('text', () => {})\n", "utf8");
  fs.writeFileSync(path.join(workspace, "logs", "bug-fix-lab-test.log"), `${"failed pass ".repeat(30)}\n`, "utf8");
  fs.writeFileSync(path.join(workspace, "reports", "bug-fix-lab-report.md"), `${"bug fix failed passed ".repeat(80)}\n`, "utf8");

  const task3 = service.evaluateAnalysisTask(
    "task3",
    workspace,
    [
      {
        type: "tool_start",
        name: "terminal",
        input: {
          command: `docker exec -w /workspace/projects/bug-fix-lab ${envName} npm test`,
        },
      },
    ],
    "",
    { analysisEnvName: envName },
  );
  assert.equal(task3.score, 0);
  assert.equal(task3.evaluatorStatus, "missing");
});

test("analysis evaluation treats model API failures as invalid zero-score tasks", () => {
  const { root, service } = makeService();
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace, { recursive: true });

  const evaluation = service.evaluateAnalysisTask(
    "task3",
    workspace,
    [],
    "API call failed after 3 retries: HTTP 429: usage limit exceeded, resets at 2026-05-16T00:00:00+08:00",
    { analysisEnvName: "agent-lab-minimax-cn-minimax-m2-7-highspeed" },
  );

  assert.equal(evaluation.score, 0);
  assert.deepEqual(evaluation.sections, []);
});

test("analysis evaluation treats partial stream recovery as invalid zero-score tasks", () => {
  const { root, service } = makeService();
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace, { recursive: true });

  const evaluation = service.evaluateAnalysisTask(
    "task4",
    workspace,
    [],
    "Now let me create the comprehensive final report.\n\nWarning: Stream interrupted before completion; returned partial output.",
    { analysisEnvName: "agent-lab-xiaomi-mimo-v2-5-pro" },
  );

  assert.equal(evaluation.score, 0);
  assert.deepEqual(evaluation.sections, []);
});

test("analysis task process status separates completion from evaluator quality", () => {
  assert.equal(
    analysisTaskProcessStatus({
      exitCode: 1,
      finalAssistantText: "Completed the task; hidden tests passed 421/429.",
    }),
    "failed",
  );
  assert.equal(
    analysisTaskProcessStatus({
      exitCode: 1,
      hasEvaluation: true,
    }),
    "completed",
  );
  assert.equal(
    analysisTaskProcessStatus({
      exitCode: 0,
      evaluationRequired: true,
      hasEvaluation: false,
    }),
    "failed",
  );
  assert.equal(analysisTaskProcessStatus({ exitCode: 1, finalAssistantText: "" }), "failed");
  assert.equal(
    analysisTaskProcessStatus({
      exitCode: 0,
      finalAssistantText: "API call failed after 3 retries: HTTP 429",
      modelCallFailed: true,
    }),
    "failed",
  );
});

test("analysis task process launches through the desktop Hermes adapter", async () => {
  const { root, service } = makeService();
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  service.pythonPath = process.execPath;
  let captured = null;
  service.processManager.startJsonLineProcess = (input) => {
    captured = input;
    const child = {};
    input.onStarted(child);
    setImmediate(() => {
      input.onStdoutEvent({ type: "assistant_message", content: "Done" });
      input.onStdoutEvent({
        type: "done",
        metadata: { inputTokens: 1, outputTokens: 2, apiCalls: 1 },
      });
      input.onExit({ code: 0, child });
    });
  };

  const result = await service.runAnalysisTaskProcess({
    runId: "run-adapter",
    key: "openai--gpt-test",
    provider: "openai",
    model: "gpt-test",
    workspacePath: workspace,
    task: { id: "task1", title: "Docker environment lab", capability: "environment" },
    prompt: "Prompt",
    skipInlineEvaluation: true,
  });

  assert.equal(result.status, "completed");
  assert.equal(result.inputTokens, 1);
  assert.equal(captured.command, process.execPath);
  assert.match(captured.args[0], /hermes_adapter\.py$/);
  assert.equal(fs.existsSync(captured.args[0]), true);
});

test("analysis task summary comes from the fixed evaluator, not model self-report", async () => {
  const { root, service } = makeService();
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(path.join(workspace, "logs"), { recursive: true });
  service.pythonPath = process.execPath;
  service.processManager.startJsonLineProcess = (input) => {
    const child = {};
    input.onStarted(child);
    setImmediate(() => {
      input.onStdoutEvent({ type: "assistant_message", content: "I completed every requirement and all checks pass." });
      input.onExit({ code: 0, child });
    });
  };

  const result = await service.runAnalysisTaskProcess({
    runId: "run-summary",
    key: "openai--gpt-test",
    provider: "openai",
    model: "gpt-test",
    workspacePath: workspace,
    task: { id: "task2", title: "Small project build", capability: "implementation" },
    prompt: "Prompt",
    postProcessBeforeEvaluation: async () => {
      fs.writeFileSync(
        path.join(workspace, "logs", "task2_grade_all.log"),
        [
          "Task: task2",
          "==============================",
          "Running Phase 0: Environment (10 pts)",
          "==============================",
          "Phase 0: Environment PASS: +10",
          "==============================",
          "Running Phase 1: Scaffold (15 pts)",
          "==============================",
          "Phase 1: Scaffold FAIL: +0",
          "==============================",
          "Running Phase 2: Data Logic (20 pts)",
          "==============================",
          "Phase 2: Data Logic FAIL: +0",
          "==============================",
          "Running Phase 3: UI and Build (20 pts)",
          "==============================",
          "Phase 3: UI and Build PASS: +20",
          "==============================",
          "Running Phase 4: Runtime Curl (20 pts)",
          "==============================",
          "Phase 4: Runtime Curl PASS: +20",
          "==============================",
          "Running Phase 5: Report (15 pts)",
          "==============================",
          "Phase 5: Report FAIL: +0",
          "==============================",
          "Final Score: 50 / 100",
        ].join("\n"),
        "utf8",
      );
      return { status: "completed", summary: "Batch post-processing completed: logs/task2_grade_all.log" };
    },
  });

  assert.equal(result.status, "completed");
  assert.equal(result.score, 50);
  assert.match(result.summary, /Fixed evaluator score for task2: 50\/100/);
  assert.doesNotMatch(result.summary, /I completed every requirement/);
  assert.match(result.modelSummary, /I completed every requirement/);
});

test("analysis task process streams live usage from Hermes API logs", async () => {
  const { root, service } = makeService();
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  const key = "openai--gpt-test";
  const runId = "run-live-usage";
  const startedAt = new Date().toISOString();
  service.writeAnalysisStore({
    version: 1,
    results: [
      {
        key,
        runId,
        provider: "openai",
        model: "gpt-test",
        status: "running",
        startedAt,
        updatedAt: startedAt,
        tasks: [
          {
            id: "task9",
            title: "Jinja2 custom extension development",
            capability: "framework",
            status: "running",
            startedAt,
            score: 0,
            sections: [],
          },
        ],
      },
    ],
  });
  service.pythonPath = process.execPath;
  let emitted = 0;
  const webContents = {
    isDestroyed: () => false,
    send: () => {
      emitted += 1;
    },
  };
  service.processManager.startJsonLineProcess = (input) => {
    const child = {};
    input.onStarted(child);
    setImmediate(() => {
      input.onStderrLine("2026-05-22 API call #1: model=gpt-test in=123 out=45 total=168 latency=1.2s");
      input.onExit({ code: 0, child });
    });
  };

  const result = await service.runAnalysisTaskProcess({
    runId,
    key,
    provider: "openai",
    model: "gpt-test",
    workspacePath: workspace,
    task: { id: "task9", title: "Jinja2 custom extension development", capability: "framework" },
    prompt: "Prompt",
    skipInlineEvaluation: true,
    webContents,
  });

  assert.equal(result.inputTokens, 123);
  assert.equal(result.outputTokens, 45);
  assert.equal(result.apiCalls, 1);
  const stored = service.readAnalysisStore().results[0].tasks[0];
  assert.equal(stored.inputTokens, 123);
  assert.equal(stored.outputTokens, 45);
  assert.equal(stored.apiCalls, 1);
  assert.ok(emitted > 0);
});

test("analysis task3 does not award test or pass-loop credit without artifacts", () => {
  const { root, service } = makeService();
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace, { recursive: true });

  const task3 = service.evaluateAnalysisTask(
    "task3",
    workspace,
    [],
    "Token Plan Plus request failed before any tests ran",
    { analysisEnvName: "agent-lab-minimax-cn-minimax-m2-7-highspeed" },
  );

  assert.equal(task3.score, 0);
  assert.equal(task3.evaluatorStatus, "missing");
  assert.equal(task3.sections.find((section) => section.id === "fixed_evaluator").score, 0);
});

test("analysis task4 does not use artifact heuristics without the batch grade log", () => {
  const { root, service } = makeService();
  const workspace = path.join(root, "workspace");
  const envName = "agent-lab-openai-gpt-test";
  const reportsDir = path.join(workspace, "reports");
  fs.mkdirSync(reportsDir, { recursive: true });
  const events = [
    {
      type: "tool_start",
      name: "terminal",
      input: {
        command: `docker exec ${envName} ls -lh /workspace/reports/chinese-agent-product-research.md`,
      },
    },
  ];

  const missingReport = service.evaluateAnalysisTask("task4", workspace, events, "", {
    analysisEnvName: envName,
  });
  assert.equal(missingReport.score, 0);
  assert.equal(missingReport.evaluatorStatus, "missing");

  fs.writeFileSync(
    path.join(reportsDir, "chinese-agent-product-research.md"),
    [
      "| Tool | Form | Source |",
      "| --- | --- | --- |",
      "| Claude Code | Terminal | https://example.com/claude |",
      "| Cursor | IDE | https://example.com/cursor |",
      "| Codex | Terminal | https://example.com/codex |",
      "MVP 产品 用户 场景 痛点 架构 路线图 风险 多模型 模型协作 大模型 小模型 Cline OpenHands",
      "https://example.com/a https://example.com/b https://example.com/c https://example.com/d https://example.com/e https://example.com/f",
      "content ".repeat(240),
    ].join("\n"),
    "utf8",
  );

  const deliveredReport = service.evaluateAnalysisTask("task4", workspace, events, "", {
    analysisEnvName: envName,
  });
  assert.equal(deliveredReport.score, 0);
  assert.equal(deliveredReport.sections.find((section) => section.id === "fixed_evaluator").score, 0);
});

test("analysis task4 preserves partial score from the batch grade log", () => {
  const { root, service } = makeService();
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(path.join(workspace, "logs"), { recursive: true });
  fs.writeFileSync(
    path.join(workspace, "logs", "task4_grade_all.log"),
    [
      "Task: task4",
      "==============================",
      "Running Task4 Phase 0: Environment (10 pts)",
      "==============================",
      "Task4 Phase 0: Environment PASS: +10",
      "==============================",
      "Running Task4 Phase 1: Sources and Notes (20 pts)",
      "==============================",
      "Task4 Phase 1: Sources and Notes PASS: +20",
      "==============================",
      "Running Task4 Phase 2: Report and Comparison (25 pts)",
      "==============================",
      "Task4 Phase 2: Report and Comparison FAIL: +0",
      "==============================",
      "Final Score: 30 / 100",
      "==============================",
      "Result: Failed",
    ].join("\n"),
    "utf8",
  );

  const evaluation = service.evaluateAnalysisTask("task4", workspace, [], "", {
    analysisEnvName: "agent-lab-openai-gpt-test",
  });

  assert.equal(evaluation.score, 30);

  service.writeAnalysisStore({
    version: 1,
    results: [
      {
        key: "openai--gpt-test",
        provider: "openai",
        model: "gpt-test",
        workspacePath: workspace,
        tasks: [
          {
            id: "task4",
            title: "Research and product plan",
            status: "failed",
            score: 0,
            sections: [],
          },
        ],
      },
    ],
  });
  const storedTask = service.getAnalysisBenchmarks().results[0].tasks[0];
  assert.equal(storedTask.score, 30);
  assert.equal(storedTask.status, "completed");
});

test("analysis stored model failures remain failed", () => {
  const { root, service } = makeService();
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  service.writeAnalysisStore({
    version: 1,
    results: [
      {
        key: "openai--gpt-test",
        provider: "openai",
        model: "gpt-test",
        workspacePath: workspace,
        tasks: [
          {
            id: "task3",
            title: "Debug and repair loop",
            status: "failed",
            completedAt: "2026-05-17T00:00:00.000Z",
            score: 0,
            sections: [],
            summary: "API call failed after 3 retries: HTTP 429: usage limit exceeded",
          },
        ],
      },
    ],
  });

  const storedTask = service.getAnalysisBenchmarks().results[0].tasks[0];
  assert.equal(storedTask.score, 0);
  assert.equal(storedTask.status, "failed");
});

test("analysis task1-4 sections come from batch grade logs", () => {
  const { root, service } = makeService();
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(path.join(workspace, "logs"), { recursive: true });
  fs.writeFileSync(
    path.join(workspace, "logs", "task2_grade_all.log"),
    [
      "Task: task2",
      "==============================",
      "Running Phase 0: Environment (10 pts)",
      "==============================",
      "Phase 0: Environment PASS: +10",
      "==============================",
      "Running Phase 1: Scaffold (15 pts)",
      "==============================",
      "Phase 1: Scaffold FAIL: +0",
      "==============================",
      "Running Phase 2: Data Logic (20 pts)",
      "==============================",
      "Phase 2: Data Logic FAIL: +0",
      "==============================",
      "Running Phase 3: UI and Build (20 pts)",
      "==============================",
      "Phase 3: UI and Build PASS: +20",
      "==============================",
      "Running Phase 4: Runtime Curl (20 pts)",
      "==============================",
      "Phase 4: Runtime Curl PASS: +20",
      "==============================",
      "Running Phase 5: Report (15 pts)",
      "==============================",
      "Phase 5: Report FAIL: +0",
      "==============================",
      "Final Score: 50 / 100",
    ].join("\n"),
    "utf8",
  );

  const evaluation = service.evaluateAnalysisTask(
    "task2",
    workspace,
    [],
    "All phases passed and the report is complete.",
    { analysisEnvName: "agent-lab-openai-gpt-test" },
  );

  assert.equal(evaluation.score, 50);
  assert.equal(evaluation.sections.find((section) => section.id === "project_created").score, 0);
  assert.equal(evaluation.sections.find((section) => section.id === "persistence").score, 0);
  assert.equal(evaluation.sections.find((section) => section.id === "features").score, 100);
  assert.equal(evaluation.sections.find((section) => section.id === "report").score, 0);
});

test("analysis migrated project tasks score by pass ratio instead of threshold", () => {
  const { root, service } = makeService();
  const workspace = path.join(root, "workspace");
  const modelRun = "mimo-v2-pro";
  const runDir = path.join(workspace, "model_runs", modelRun, "task6");
  const resultsDir = path.join(workspace, "model_runs", modelRun, "results");
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "bottle_plugins.py"), "# plugins\n", "utf8");
  fs.writeFileSync(path.join(resultsDir, "task6_report.md"), `${"report ".repeat(220)}\n`, "utf8");
  fs.writeFileSync(
    path.join(resultsDir, "task6_submit_1_summary.json"),
    JSON.stringify(
      {
        current_metric: 1,
        original_source_unchanged: true,
        judge_result: {
          passed: true,
          passed_count: 421,
          total: 429,
          metric: 1,
          detail: "passed 421/429; old threshold would have passed",
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const evaluation = service.evaluateAnalysisTask(
    "task6",
    workspace,
    [
      {
        type: "command_start",
        command: "docker compose exec -T agent-lab-xiaomi-mimo-v2-pro bash -lc 'python task_project_evaluate.py --task 6'",
      },
    ],
    "Implemented RateLimitPlugin; it returns HTTP 429 when requests exceed the configured limit.",
    { analysisEnvName: "agent-lab-xiaomi-mimo-v2-pro", modelRunName: modelRun },
  );

  const automated = evaluation.sections.find((section) => section.id === "automated_tests");
  assert.equal(evaluation.score, 99);
  assert.equal(automated.score, 98);
  assert.match(automated.evidence, /421\/429 passed/);
});

test("analysis migrated project score requires the delivery report", () => {
  const { root, service } = makeService();
  const workspace = path.join(root, "workspace");
  const modelRun = "mimo-v2-pro";
  const runDir = path.join(workspace, "model_runs", modelRun, "task6");
  const resultsDir = path.join(workspace, "model_runs", modelRun, "results");
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "bottle_plugins.py"), "# plugins\n", "utf8");
  fs.writeFileSync(
    path.join(resultsDir, "task6_submit_1_summary.json"),
    JSON.stringify(
      {
        current_metric: 1,
        original_source_unchanged: true,
        judge_result: {
          passed: true,
          passed_count: 421,
          total: 429,
          metric: 1,
          detail: "passed 421/429",
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const evaluation = service.evaluateAnalysisTask(
    "task6",
    workspace,
    [],
    "",
    { analysisEnvName: "agent-lab-xiaomi-mimo-v2-pro", modelRunName: modelRun },
  );

  assert.equal(evaluation.score, 84);
  assert.equal(evaluation.sections.find((section) => section.id === "automated_tests").score, 98);
  assert.equal(evaluation.sections.find((section) => section.id === "report").score, 0);
});

test("analysis migrated project summary selection uses newest evaluator output", () => {
  const { root, service } = makeService();
  const workspace = path.join(root, "workspace");
  const modelRun = "qwen3-6-27b";
  const runDir = path.join(workspace, "model_runs", modelRun, "task7");
  const resultsDir = path.join(workspace, "model_runs", modelRun, "results");
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "markdown_parser.py"), "# parser\n", "utf8");
  fs.writeFileSync(path.join(resultsDir, "task7_report.md"), `${"report ".repeat(220)}\n`, "utf8");
  const oldSummaryPath = path.join(resultsDir, "task7_submit_3_summary.json");
  const newSummaryPath = path.join(resultsDir, "task7_submit_1_summary.json");
  fs.writeFileSync(
    oldSummaryPath,
    JSON.stringify(
      {
        current_metric: 0.1,
        original_source_unchanged: true,
        judge_result: { passed: false, passed_count: 100, total: 1000, metric: 0.1 },
      },
      null,
      2,
    ),
    "utf8",
  );
  fs.writeFileSync(
    newSummaryPath,
    JSON.stringify(
      {
        current_metric: 0.9,
        original_source_unchanged: true,
        judge_result: { passed: false, passed_count: 900, total: 1000, metric: 0.9 },
      },
      null,
      2,
    ),
    "utf8",
  );
  fs.utimesSync(oldSummaryPath, new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
  fs.utimesSync(newSummaryPath, new Date("2026-01-02T00:00:00Z"), new Date("2026-01-02T00:00:00Z"));

  const evaluation = service.evaluateAnalysisTask(
    "task7",
    workspace,
    [],
    "",
    { analysisEnvName: "agent-lab-qwen", modelRunName: modelRun },
  );

  const automated = evaluation.sections.find((section) => section.id === "automated_tests");
  assert.equal(evaluation.score, 93);
  assert.equal(automated.score, 90);
  assert.match(automated.evidence, /900\/1000 passed/);
});

test("analysis migrated project scoring uses actual failed test totals", () => {
  const { root, service } = makeService();
  const workspace = path.join(root, "workspace");
  const modelRun = "mimo-v2.5-pro";
  const runDir = path.join(workspace, "model_runs", modelRun, "task8");
  const resultsDir = path.join(workspace, "model_runs", modelRun, "results");
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "click.py"), "# click\n", "utf8");
  fs.writeFileSync(path.join(resultsDir, "task8_report.md"), `${"report ".repeat(220)}\n`, "utf8");
  fs.writeFileSync(
    path.join(resultsDir, "task8_submit_1_summary.json"),
    JSON.stringify(
      {
        current_metric: 1.020139,
        original_source_unchanged: true,
        judge_result: {
          passed: false,
          passed_count: 1469,
          failed_count: 25,
          error_count: 0,
          total: 1440,
          metric: 1.020139,
          detail: "passed 1469/1440; score 102.01/100",
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const evaluation = service.evaluateAnalysisTask(
    "task8",
    workspace,
    [],
    "",
    { analysisEnvName: "agent-lab-xiaomi-mimo-v2-5-pro", modelRunName: modelRun },
  );

  const automated = evaluation.sections.find((section) => section.id === "automated_tests");
  assert.equal(evaluation.score, 99);
  assert.equal(automated.score, 98);
  assert.match(automated.evidence, /1469\/1494 passed/);

  service.writeAnalysisStore({
    version: 1,
    results: [
      {
        key: "xiaomi--mimo-v2.5-pro",
        provider: "xiaomi",
        model: "mimo-v2.5-pro",
        workspacePath: workspace,
        tasks: [
          {
            id: "task8",
            title: "Click CLI framework bug fixing",
            status: "completed",
            score: 100,
            sections: [],
          },
        ],
      },
    ],
  });
  const storedTask = service.getAnalysisBenchmarks().results[0].tasks[0];
  assert.equal(storedTask.score, 99);
  const storedAutomated = storedTask.sections.find((section) => section.id === "automated_tests");
  assert.equal(storedAutomated.score, 98);
  assert.match(storedAutomated.evidence, /1469\/1494 passed/);
});

test("analysis cleanup tears down the model-specific docker compose environment", async () => {
  const { root, service } = makeService();
  const key = "openai--gpt-test";
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(
    path.join(workspace, "docker-compose.yml"),
    [
      "services:",
      "  agent-lab-openai-gpt-test:",
      "    container_name: agent-lab-openai-gpt-test",
    ].join("\n"),
    "utf8",
  );
  service.writeAnalysisStore({
    version: 1,
    results: [
      {
        key,
        runId: "run-cleanup",
        provider: "openai",
        model: "gpt-test",
        status: "completed",
        summary: "9/9 tasks completed.",
        tasks: [],
      },
    ],
  });

  let captured = null;
  service.runAnalysisShellCommand = async (input) => {
    captured = input;
    return { code: 0, output: "removed" };
  };

  const result = await service.cleanupAnalysisDockerEnvironment(
    { key, runId: "run-cleanup", provider: "openai", model: "gpt-test" },
    workspace,
  );

  assert.equal(result.status, "completed");
  assert.equal(captured.cwd, workspace);
  assert.deepEqual(captured.args, ["compose", "down", "--volumes", "--rmi", "local", "--remove-orphans"]);
  const stored = service.readAnalysisStore().results[0];
  assert.match(stored.summary, /Cleaned Docker test environment agent-lab-openai-gpt-test/);
});

test("analysis cleanup is skipped during app shutdown", async () => {
  const { root, service } = makeService();
  const key = "openai--gpt-test";
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, "docker-compose.yml"), "services: {}\n", "utf8");
  service.writeAnalysisStore({
    version: 1,
    results: [
      {
        key,
        runId: "run-cleanup",
        provider: "openai",
        model: "gpt-test",
        status: "interrupted",
        summary: "Stopped because Redou Agent is closing.",
        tasks: [],
      },
    ],
  });

  let called = false;
  service.runAnalysisShellCommand = async () => {
    called = true;
    return { code: 0, output: "removed" };
  };
  service.shuttingDown = true;

  const result = await service.cleanupAnalysisDockerEnvironment(
    { key, runId: "run-cleanup", provider: "openai", model: "gpt-test" },
    workspace,
  );

  assert.equal(result.status, "skipped");
  assert.equal(called, false);
  const stored = service.readAnalysisStore().results[0];
  assert.equal(stored.summary, "Stopped because Redou Agent is closing.");
});

test("analysis cleanup removes stale model container when compose file is missing", async () => {
  const { root, service } = makeService();
  const key = "openai--gpt-test";
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  service.writeAnalysisStore({
    version: 1,
    results: [
      {
        key,
        runId: "run-stale",
        provider: "openai",
        model: "gpt-test",
        status: "failed",
        summary: "compose file was missing",
        tasks: [],
      },
    ],
  });

  let captured = null;
  service.runAnalysisShellCommand = async (input) => {
    captured = input;
    return { code: 0, output: "agent-lab-openai-gpt-test" };
  };

  const result = await service.cleanupAnalysisDockerEnvironment(
    { key, runId: "run-stale", provider: "openai", model: "gpt-test" },
    workspace,
  );

  assert.equal(result.status, "completed");
  assert.deepEqual(captured.args, ["rm", "-f", "agent-lab-openai-gpt-test"]);
  const stored = service.readAnalysisStore().results[0];
  assert.match(stored.summary, /Cleaned stale Docker test container agent-lab-openai-gpt-test/);
});

test("analysis benchmark scheduling uses agent max turns and does not cap explicit max iterations", () => {
  const { service } = makeService();
  const webContents = {
    isDestroyed: () => false,
    send: () => {},
  };
  service.startAnalysisQueue = () => {};
  fs.mkdirSync(service.hermesHome, { recursive: true });
  fs.writeFileSync(
    path.join(service.hermesHome, "config.yaml"),
    ["agent:", "  max_turns: 1234", ""].join("\n"),
    "utf8",
  );

  const defaultResponse = service.startAnalysisBenchmarks(webContents, {
    models: [{ provider: "openai", model: "gpt-default" }],
  });
  assert.equal(defaultResponse.queued, 1);
  assert.equal(service.analysisQueue.at(-1).maxIterations, 1234);

  const overrideResponse = service.startAnalysisBenchmarks(webContents, {
    models: [{ provider: "openai", model: "gpt-long" }],
    maxIterations: 5000,
  });
  assert.equal(overrideResponse.queued, 1);
  assert.equal(service.analysisQueue.at(-1).maxIterations, 5000);
});

test("analysis benchmark scheduling creates a workspace task for each run", () => {
  const { service } = makeService();
  const webContents = {
    isDestroyed: () => false,
    send: () => {},
  };
  service.startAnalysisQueue = () => {};

  const response = service.startAnalysisBenchmarks(webContents, {
    models: [{ provider: "openai", model: "gpt-console" }],
  });

  assert.equal(response.queued, 1);
  const project = service.getChatProjects().projects.find((item) => item.id === "model-benchmarks");
  assert.ok(project);
  assert.equal(project.name, "Model Benchmarks");
  assert.equal(project.path, service.analysisWorkspaceRoot());
  assert.equal(project.workspace_path, service.analysisWorkspaceRoot());
  assert.equal(project.contextPath, path.join(service.analysisWorkspaceRoot(), ".redou"));
  assert.equal(project.tasks.length, 1);

  const task = project.tasks[0];
  assert.equal(task.title, "Benchmark: openai / gpt-console");
  assert.equal(task.kind, "analysis_benchmark");
  assert.equal(task.analysisRunId, response.runIds[0]);
  assert.equal(task.analysisKey, "openai--gpt-console");
  assert.equal(task.model_provider, "openai");
  assert.equal(task.model, "gpt-console");
  assert.equal(task.runtime_status, "queued");
  assert.equal(task.queue_depth, 1);

  const messages = service.getChatTaskMessages(project.id, task.id).messages;
  assert.equal(messages[0].role, "user");
  assert.match(messages[0].content, /Run model capability benchmark/);
  const plannedStages = messages.filter(
    (message) =>
      message.metadata.eventType === "run_stage" &&
      message.metadata.event.status === "pending",
  );
  assert.equal(plannedStages.length, 9);
  assert.equal(plannedStages[0].metadata.event.stage, "task1");
  assert.equal(plannedStages.at(-1).metadata.event.stage, "task9");
  assert.equal(messages.at(-1).metadata.eventType, "queue_update");
});

test("analysis workspace project migrates to the benchmark data path", () => {
  const { service } = makeService();
  const createdAt = new Date().toISOString();
  service.ensureProject({
    id: "model-benchmarks",
    name: "Model Benchmarks",
    path: "",
    workspace_path: "",
    createdAt,
    updatedAt: createdAt,
    tasks: [],
  });

  const project = service.ensureAnalysisWorkspaceProject();

  assert.equal(project.path, service.analysisWorkspaceRoot());
  assert.equal(project.workspace_path, service.analysisWorkspaceRoot());
  assert.equal(project.contextPath, path.join(service.analysisWorkspaceRoot(), ".redou"));
  assert.equal(fs.existsSync(project.rulesPath), true);
});

test("deleting the analysis workspace project removes benchmark data", () => {
  const { service } = makeService();
  const webContents = {
    isDestroyed: () => false,
    send: () => {},
  };
  service.startAnalysisQueue = () => {};

  const response = service.startAnalysisBenchmarks(webContents, {
    models: [{ provider: "openai", model: "gpt-delete" }],
  });
  const project = service.readProject("model-benchmarks");
  const workspaceRoot = service.analysisWorkspaceRoot();
  const modelWorkspace = path.join(workspaceRoot, "openai--gpt-delete");
  fs.mkdirSync(path.join(modelWorkspace, "logs"), { recursive: true });
  fs.writeFileSync(path.join(modelWorkspace, "logs", "task1_grade_all.log"), "data\n", "utf8");
  service.writeAnalysisStore({
    version: 1,
    results: [
      {
        key: "openai--gpt-delete",
        runId: response.runIds[0],
        provider: "openai",
        model: "gpt-delete",
        status: "completed",
        workspacePath: modelWorkspace,
        tasks: [],
      },
    ],
  });
  service.analysisQueue = [];

  const deleted = service.deleteChatProject(project.id);

  assert.equal(deleted.ok, true);
  assert.equal(fs.existsSync(workspaceRoot), false);
  assert.equal(fs.existsSync(service.analysisStorePath()), false);
  assert.deepEqual(service.readAnalysisStore().results, []);
  assert.equal(service.readProject("model-benchmarks"), null);
});

test("deleting an analysis workspace task removes its benchmark workspace", () => {
  const { service } = makeService();
  const webContents = {
    isDestroyed: () => false,
    send: () => {},
  };
  service.startAnalysisQueue = () => {};

  const response = service.startAnalysisBenchmarks(webContents, {
    models: [{ provider: "openai", model: "gpt-task-delete" }],
  });
  const project = service.readProject("model-benchmarks");
  const task = project.tasks[0];
  const modelWorkspace = path.join(service.analysisWorkspaceRoot(), "openai--gpt-task-delete");
  fs.mkdirSync(path.join(modelWorkspace, "reports"), { recursive: true });
  fs.writeFileSync(path.join(modelWorkspace, "reports", "report.md"), "data\n", "utf8");
  service.writeAnalysisStore({
    version: 1,
    results: [
      {
        key: "openai--gpt-task-delete",
        runId: response.runIds[0],
        provider: "openai",
        model: "gpt-task-delete",
        status: "completed",
        workspacePath: modelWorkspace,
        tasks: [],
      },
    ],
  });
  service.analysisQueue = [];

  const deleted = service.deleteChatTask(project.id, task.id);

  assert.equal(deleted.ok, true);
  assert.equal(deleted.deleted_analysis_results, 1);
  assert.equal(fs.existsSync(modelWorkspace), false);
  assert.equal(fs.existsSync(task.messagesPath), false);
  assert.equal(fs.existsSync(service.analysisStorePath()), false);
});

test("analysis workspace task records benchmark stages and final status", () => {
  const { service } = makeService();
  const webContents = {
    isDestroyed: () => false,
    send: () => {},
  };
  service.startAnalysisQueue = () => {};

  service.startAnalysisBenchmarks(webContents, {
    models: [{ provider: "openai", model: "gpt-stages" }],
  });
  const item = service.analysisQueue[0];
  const project = service.readProject(item.projectId);
  const task = project.tasks.find((candidate) => candidate.id === item.taskId);

  service.syncAnalysisWorkspaceTaskStage(item, { id: "task1", title: "Docker environment lab", capability: "environment" }, "running", "Running");
  service.syncAnalysisWorkspaceTaskStage(item, { id: "task1", title: "Docker environment lab", capability: "environment" }, "completed", "Score 90", {
    score: 90,
    durationMs: 1200,
  });
  service.syncAnalysisWorkspaceFinished(item, "completed", "1/9 tasks completed.", {
    totals: {
      durationMs: 1200,
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 0,
      reasoningTokens: 3,
      apiCalls: 1,
      estimatedCostUsd: 0.01,
    },
  });

  const messages = service.getChatTaskMessages(project.id, task.id).messages;
  const stageMessages = messages.filter((message) => message.metadata.eventType === "run_stage");
  assert.equal(stageMessages.length, 11);
  assert.equal(stageMessages.filter((message) => message.metadata.event.status === "pending").length, 9);
  const activeStageMessages = stageMessages.filter((message) => message.metadata.event.status !== "pending");
  assert.equal(activeStageMessages.length, 2);
  assert.equal(activeStageMessages[0].metadata.event.status, "running");
  assert.equal(activeStageMessages[1].metadata.event.status, "completed");
  assert.equal(messages.at(-1).metadata.eventType, "done");
  assert.equal(messages.at(-1).metadata.event.metadata.completed, true);
  assert.equal(messages.at(-1).metadata.event.metadata.inputTokens, 10);

  service.analysisQueue = [];
  const refreshedTask = service.getChatProjects()
    .projects.find((candidate) => candidate.id === project.id)
    .tasks.find((candidate) => candidate.id === task.id);
  assert.equal(refreshedTask.runtime_status, "completed");
});

test("analysis benchmarks start selected models in parallel", async () => {
  const { service } = makeService();
  const launched = [];
  const releases = new Map();
  const webContents = {
    isDestroyed: () => false,
    send: () => {},
  };

  service.cleanupAnalysisDockerEnvironment = async () => ({ status: "skipped" });
  service.runAnalysisModelBenchmark = (item) => {
    launched.push(item.key);
    return new Promise((resolve) => {
      releases.set(item.key, resolve);
    });
  };

  const response = service.startAnalysisBenchmarks(webContents, {
    models: [
      { provider: "openai", model: "gpt-a" },
      { provider: "anthropic", model: "claude-b" },
    ],
  });

  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(response.queued, 2);
  assert.equal(service.analysisQueue.length, 0);
  assert.equal(service.activeAnalysisRuns.size, 2);
  assert.deepEqual(new Set(launched), new Set(["openai--gpt-a", "anthropic--claude-b"]));

  const benchmarkProject = service.getChatProjects().projects.find((project) => project.id === "model-benchmarks");
  assert.ok(benchmarkProject);
  assert.deepEqual(
    new Set(benchmarkProject.tasks.map((task) => task.runtime_status)),
    new Set(["running"]),
  );

  const benchmarks = service.getAnalysisBenchmarks();
  assert.equal(benchmarks.queueDepth, 0);
  assert.deepEqual(new Set(benchmarks.activeRunIds), new Set(response.runIds));

  for (const release of releases.values()) {
    release();
  }
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(service.activeAnalysisRuns.size, 0);
  assert.equal(service.activeAnalysisRun, null);
});
