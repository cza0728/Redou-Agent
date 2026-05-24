const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { RedouLocalService, SecretRedactor } = require("../src/services/redouLocalService.cjs");

function makeService() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "redou-context-contract-"));
  const app = {
    getPath(name) {
      assert.equal(name, "userData");
      return path.join(root, "userData");
    },
  };
  const logs = [];
  const service = new RedouLocalService({
    app,
    projectRoot: root,
    hermesHome: path.join(root, "hermes-home"),
    log: (line) => logs.push(String(line || "")),
  });
  service.ensureInitialized();
  const workspacePath = path.join(root, "workspace");
  fs.mkdirSync(workspacePath, { recursive: true });
  const { project } = service.createChatProject({
    name: "Context Contract Project",
    workspace_path: workspacePath,
  });
  const task = project.tasks[0];
  return { root, service, project, task, logs };
}

function addActiveRun(service, project, task, runId = "active-run") {
  const writes = [];
  const child = {
    pid: 0,
    killed: false,
    stdin: {
      destroyed: false,
      write(line) {
        writes.push(String(line || ""));
      },
    },
    kill() {
      child.killed = true;
    },
  };
  service.activeRuns.set(runId, {
    child,
    projectId: project.id,
    taskId: task.id,
    webContents: null,
    startedAt: new Date().toISOString(),
    startedAtMs: Date.now(),
    lastActiveAtMs: Date.now(),
    stopRequested: false,
    turnArtifacts: { files: [], commands: [], errors: [], attachments: [] },
  });
  return { child, writes, runId };
}

function promptText(built) {
  return built.contextMessages.map((message) => String(message.content || "")).join("\n\n");
}

function lastUserMessage(built) {
  return built.contextMessages.filter((message) => message.role === "user").at(-1);
}

test("active run user input defaults to queue and does not steer the active run", () => {
  const { service, project, task } = makeService();
  const active = addActiveRun(service, project, task);

  const response = service.sendMessage(null, {
    projectId: project.id,
    taskId: task.id,
    userInput: "queued future question",
  });

  assert.equal(response.queued, true);
  assert.equal(response.queueDepth, 1);
  assert.equal(active.writes.length, 0);

  const loaded = service.getChatTaskMessages(project.id, task.id);
  const queued = loaded.messages.find((message) => message.role === "user");
  assert.equal(queued.content, "queued future question");
  assert.equal(queued.metadata.inputEnvelope.deliveryMode, "queue");
  assert.equal(queued.metadata.inputEnvelope.status, "pending");
});

test("context preview can be built without a current user request", () => {
  const { service, project, task } = makeService();

  const preview = service.buildTaskContext({
    projectId: project.id,
    taskId: task.id,
    userInput: "",
    preview: true,
  });

  assert.equal(preview.metadata.preview, true);
  assert.equal(preview.metadata.contextValidation.ok, true);
  assert.equal(preview.metadata.taskContextPath, task.contextPath);
});

test("queued messages are excluded until their own turn becomes current", () => {
  const { service, project, task } = makeService();
  addActiveRun(service, project, task);
  const queued = service.sendMessage(null, {
    projectId: project.id,
    taskId: task.id,
    userInput: "do not leak this queued request",
  });

  const built = service.buildTaskContext({
    projectId: project.id,
    taskId: task.id,
    userInput: "current active request",
  });

  assert.doesNotMatch(promptText(built), /do not leak this queued request/);
  assert.equal(lastUserMessage(built).content.includes("current active request"), true);
  assert.ok(built.metadata.contextDebugReport.excludedQueuedMessageIds.includes(queued.queueId));
  assert.equal(built.metadata.contextValidation.ok, true);
});

test("queued messages can be deleted before they start", () => {
  const { service, project, task } = makeService();
  addActiveRun(service, project, task);
  const queued = service.sendMessage(null, {
    projectId: project.id,
    taskId: task.id,
    userInput: "delete this queued request",
  });

  const response = service.updateQueuedMessage(null, {
    projectId: project.id,
    taskId: task.id,
    queueId: queued.queueId,
    action: "delete",
  });

  assert.equal(response.ok, true);
  assert.equal(response.deleted, true);
  assert.equal(response.queueDepth, 0);
  const loaded = service.getChatTaskMessages(project.id, task.id);
  assert.equal(loaded.messages.some((message) => message.role === "user" && message.content === "delete this queued request"), false);
});

test("stale queued message logs can be deleted when the in-memory queue is gone", () => {
  const { service, project, task } = makeService();
  addActiveRun(service, project, task);
  const queued = service.sendMessage(null, {
    projectId: project.id,
    taskId: task.id,
    userInput: "delete this stale queued request",
  });
  service.taskQueues.clear();

  const response = service.updateQueuedMessage(null, {
    projectId: project.id,
    taskId: task.id,
    queueId: queued.queueId,
    action: "delete",
  });

  assert.equal(response.ok, true);
  assert.equal(response.deleted, true);
  assert.equal(response.stale, true);
  assert.equal(response.queueDepth, 0);
  const loaded = service.getChatTaskMessages(project.id, task.id);
  assert.equal(loaded.messages.some((message) => message.role === "user" && message.content === "delete this stale queued request"), false);
});

test("queued messages can be converted into guidance", () => {
  const { service, project, task } = makeService();
  const active = addActiveRun(service, project, task);
  const queued = service.sendMessage(null, {
    projectId: project.id,
    taskId: task.id,
    userInput: "turn this queued request into guidance",
  });

  const response = service.updateQueuedMessage(null, {
    projectId: project.id,
    taskId: task.id,
    queueId: queued.queueId,
    action: "guide",
  });

  assert.equal(response.ok, true);
  assert.equal(response.guided, true);
  assert.equal(response.queueDepth, 0);
  assert.equal(active.writes.length, 1);
  assert.match(active.writes[0], /turn this queued request into guidance/);
  const loaded = service.getChatTaskMessages(project.id, task.id);
  assert.equal(loaded.messages.some((message) => message.role === "user" && message.content === "turn this queued request into guidance"), false);
  const control = loaded.messages.find((message) => message.metadata.convertedFromQueueId === queued.queueId);
  assert.ok(control);
  assert.equal(control.metadata.inputEnvelope.deliveryMode, "guide");
});

test("guide delivery is stored as a control event and never as ordinary user history", () => {
  const { service, project, task } = makeService();
  const active = addActiveRun(service, project, task);

  const response = service.sendMessage(null, {
    projectId: project.id,
    taskId: task.id,
    userInput: "steer the active run only",
    deliveryMode: "guide",
    goalMode: true,
  });

  assert.equal(response.guided, true);
  assert.equal(active.writes.length, 1);
  assert.equal(JSON.parse(active.writes[0]).goalMode, true);
  const loaded = service.getChatTaskMessages(project.id, task.id);
  assert.equal(loaded.messages.some((message) => message.role === "user" && message.content === "steer the active run only"), false);
  const control = loaded.messages.find((message) => message.metadata.eventType === "control_event");
  assert.ok(control);
  assert.equal(control.metadata.goalMode, true);
  assert.equal(control.metadata.inputEnvelope.deliveryMode, "guide");

  const built = service.buildTaskContext({
    projectId: project.id,
    taskId: task.id,
    userInput: "next real request",
  });
  assert.doesNotMatch(promptText(built), /steer the active run only/);
  assert.ok(built.metadata.contextDebugReport.excludedGuideControlEventIds.includes(control.metadata.inputEnvelope.id));
});

test("risk approval decisions are forwarded to the active adapter stdin and audited", () => {
  const { service, project, task } = makeService();
  const active = addActiveRun(service, project, task, "run-risk");

  const response = service.resolveRiskApproval(null, {
    projectId: project.id,
    taskId: task.id,
    runId: "run-risk",
    approvalId: "approval-1",
    decision: "allow_once",
  });

  assert.equal(response.ok, true);
  assert.equal(active.writes.length, 1);
  assert.deepEqual(JSON.parse(active.writes[0]), {
    type: "risk_approval_decision",
    projectId: project.id,
    taskId: task.id,
    runId: "run-risk",
    approvalId: "approval-1",
    decision: "allow_once",
  });
  const loaded = service.getChatTaskMessages(project.id, task.id);
  assert.ok(loaded.messages.some((message) => message.metadata.eventType === "risk_approval_decision_submitted"));
});

test("risk approval decisions reject invalid decisions and missing runs", () => {
  const { service, project, task } = makeService();
  const active = addActiveRun(service, project, task, "run-risk");

  const invalid = service.resolveRiskApproval(null, {
    projectId: project.id,
    taskId: task.id,
    runId: "run-risk",
    approvalId: "approval-1",
    decision: "allow_everything",
  });
  assert.equal(invalid.ok, false);
  assert.equal(active.writes.length, 0);

  service.activeRuns.delete("run-risk");
  const missing = service.resolveRiskApproval(null, {
    projectId: project.id,
    taskId: task.id,
    runId: "run-risk",
    approvalId: "approval-1",
    decision: "deny",
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.message, "Run not found");
});

test("Hermes run payload includes effective permission policy", () => {
  const { service, project, task } = makeService();
  let captured = null;
  service.pythonPath = process.execPath;
  service.getConfig = () => ({
    permissions: {
      mode: "ask",
      runtime_approval_enabled: true,
      approval_timeout_seconds: 123,
      prefilter_user_input: true,
    },
  });
  service.processManager.startJsonLineProcess = (options) => {
    captured = options;
    const child = {
      pid: 1,
      killed: false,
      stdin: { destroyed: false, write() {} },
      kill() {},
    };
    options.onStarted?.(child);
    return child;
  };

  const response = service.sendMessage(null, {
    projectId: project.id,
    taskId: task.id,
    userInput: "hello permissions",
    runtimeApprovalEnabled: true,
  });

  assert.equal(response.ok, true);
  assert.equal(captured.input.riskConfirmed, false);
  assert.equal(captured.input.runtimeApprovalEnabled, true);
  assert.equal(captured.input.approvalTimeoutSeconds, 123);
  assert.equal(captured.input.permissions.mode, "ask");
  assert.equal(captured.input.permissions.approval_timeout_seconds, 123);
  assert.equal(JSON.parse(captured.options.env.REDOU_PERMISSIONS_JSON).approval_timeout_seconds, 123);
});

test("Hermes run payload forwards goal mode to the adapter", () => {
  const { service, project, task } = makeService();
  let captured = null;
  service.pythonPath = process.execPath;
  service.processManager.startJsonLineProcess = (options) => {
    captured = options;
    const child = {
      pid: 1,
      killed: false,
      stdin: { destroyed: false, write() {} },
      kill() {},
    };
    options.onStarted?.(child);
    return child;
  };

  const response = service.sendMessage(null, {
    projectId: project.id,
    taskId: task.id,
    userInput: "fix the failing tests",
    runMode: "execute",
    goalMode: true,
  });

  assert.equal(response.ok, true);
  assert.equal(captured.input.goalMode, true);
  assert.equal(captured.input.goalText, "fix the failing tests");
  assert.equal(captured.input.metadata.goalMode, true);
});

test("Hermes run payload uses root agent max_turns with input override priority", () => {
  const { service, project, task } = makeService();
  fs.mkdirSync(service.hermesHome, { recursive: true });
  fs.writeFileSync(
    path.join(service.hermesHome, "config.yaml"),
    "agent:\n  max_turns: 321\n",
    "utf8",
  );
  service.pythonPath = process.execPath;
  const captured = [];
  service.processManager.startJsonLineProcess = (options) => {
    captured.push(options);
    const child = {
      pid: 1,
      killed: false,
      stdin: { destroyed: false, write() {} },
      kill() {},
    };
    options.onStarted?.(child);
    return child;
  };

  const fromConfig = service.sendMessage(null, {
    projectId: project.id,
    taskId: task.id,
    userInput: "hello configured budget",
  });
  assert.equal(fromConfig.ok, true);
  assert.equal(captured.at(-1).input.maxIterations, 321);

  const overrideTask = service.createChatTask(project.id, { title: "Override budget" }).task;
  const fromInput = service.sendMessage(null, {
    projectId: project.id,
    taskId: overrideTask.id,
    userInput: "hello input budget",
    maxIterations: 77.9,
  });
  assert.equal(fromInput.ok, true);
  assert.equal(captured.at(-1).input.maxIterations, 77);

  const invalidTask = service.createChatTask(project.id, { title: "Invalid budget" }).task;
  const fromInvalidInput = service.sendMessage(null, {
    projectId: project.id,
    taskId: invalidTask.id,
    userInput: "hello invalid budget",
    maxIterations: "not-a-number",
  });
  assert.equal(fromInvalidInput.ok, true);
  assert.equal(captured.at(-1).input.maxIterations, 321);

  const cappedTask = service.createChatTask(project.id, { title: "Capped budget" }).task;
  const fromCappedInput = service.sendMessage(null, {
    projectId: project.id,
    taskId: cappedTask.id,
    userInput: "hello capped budget",
    maxIterations: 20001,
  });
  assert.equal(fromCappedInput.ok, true);
  assert.equal(captured.at(-1).input.maxIterations, 10000);
});

test("interrupt_replace cancels the active run and starts a replacement turn", () => {
  const { service, project, task } = makeService();
  const active = addActiveRun(service, project, task);

  const response = service.sendMessage(null, {
    projectId: project.id,
    taskId: task.id,
    userInput: "replace with this request",
    deliveryMode: "interrupt_replace",
  });

  assert.equal(active.child.killed, true);
  assert.equal(service.activeRuns.get(active.runId).stopRequested, true);
  assert.notEqual(response.runId, active.runId);

  const loaded = service.getChatTaskMessages(project.id, task.id);
  const replacement = loaded.messages.find((message) => message.role === "user" && message.content === "replace with this request");
  assert.ok(replacement);
  assert.equal(replacement.metadata.inputEnvelope.deliveryMode, "interrupt_replace");
  assert.equal(replacement.metadata.inputEnvelope.status, "cancelled");
});

test("current user request appears exactly once even when old history had the same text", () => {
  const { service, project, task } = makeService();
  service.appendTaskMessage(project.id, task.id, "user", "repeat exact request", {
    inputEnvelope: {
      id: "old-input",
      text: "repeat exact request",
      turnId: "old-turn",
      deliveryMode: "new_turn",
      status: "completed",
    },
  });
  service.appendTaskMessage(project.id, task.id, "assistant", "old answer");

  const built = service.buildTaskContext({
    projectId: project.id,
    taskId: task.id,
    userInput: "repeat exact request",
  });

  const text = promptText(built);
  assert.equal(text.split("repeat exact request").length - 1, 1);
  assert.equal(built.metadata.contextValidation.ok, true);
});

test("recent turn digest is not included in the assembled prompt", () => {
  const { service, project, task } = makeService();
  service.updateTaskContextFile(project.id, task.id, "context", [
    "# Task Context",
    "",
    "## A. Structured State",
    "",
    "### Current Goal",
    "",
    "Continue safely.",
    "",
    "---",
    "",
    "## B. Recent Turn Digest",
    "",
    "### Earlier",
    "",
    "User Request:",
    "OLD RAW UNIQUE SHOULD NOT ENTER PROMPT",
  ].join("\n"));

  const built = service.buildTaskContext({
    projectId: project.id,
    taskId: task.id,
    userInput: "fresh request",
  });

  assert.doesNotMatch(promptText(built), /OLD RAW UNIQUE SHOULD NOT ENTER PROMPT/);
  assert.equal(built.metadata.contextValidation.ok, true);
});

test("run event records are summarized without raw event labels entering history", () => {
  const { service, project, task } = makeService();
  service.appendTaskMessage(project.id, task.id, "event", "npm test", {
    eventType: "command_start",
    event: { type: "command_start", command: "npm test", metadata: { runId: "run-1" } },
  });
  service.appendTaskMessage(project.id, task.id, "event", "tool started", {
    eventType: "tool_start",
    event: { type: "tool_start", name: "terminal", metadata: { runId: "run-1" } },
  });
  service.appendTaskMessage(project.id, task.id, "event", "tool done", {
    eventType: "tool_end",
    event: { type: "tool_end", name: "terminal", success: true, metadata: { runId: "run-1" } },
  });
  service.appendTaskMessage(project.id, task.id, "event", "done", {
    eventType: "done",
    event: { type: "done", metadata: { runId: "run-1" } },
  });

  const built = service.buildTaskContext({
    projectId: project.id,
    taskId: task.id,
    userInput: "summarize safe state",
  });
  const text = promptText(built);

  assert.doesNotMatch(text, /\bcommand_start\b/);
  assert.doesNotMatch(text, /\btool_start\b/);
  assert.doesNotMatch(text, /\btool_end\b/);
  assert.doesNotMatch(text, /Tool Result Summary/);
  assert.doesNotMatch(text, /npm test/);
  assert.equal(built.metadata.contextValidation.ok, true);
});

test("secret values in scripts are redacted before entering prompt or task state", () => {
  const { service, project, task } = makeService();
  const secret = "super-secret-password";
  const built = service.buildTaskContext({
    projectId: project.id,
    taskId: task.id,
    userInput: `Review this script:\npassword = '${secret}'\nAuthorization: Bearer abcdefghijklmnop`,
  });

  const text = promptText(built);
  assert.doesNotMatch(text, new RegExp(secret));
  assert.doesNotMatch(text, /Bearer abcdefghijklmnop/);
  assert.match(text, /\[REDACTED_SECRET\]/);
  assert.equal(built.metadata.contextValidation.ok, true);

  service.updateTaskContextAfterTurn(project.id, task.id, `password = '${secret}'`, "done");
  assert.doesNotMatch(fs.readFileSync(task.contextPath, "utf8"), new RegExp(secret));
});

test("Chinese credential labels and ssh inline passwords are redacted", () => {
  const secret = "G7@kL9!qR2#vX5mT8";
  const minioSecret = "G9rT2mV8pK6zN4yH7sL3dF5j";
  const source = [
    `密码：\`${secret}\``,
    `ssh -p 8956 ubuntu@118.25.230.236 ${secret}`,
    `Password bytes: b'${secret}'`,
    `- 密码: \`${minioSecret}\``,
  ].join("\n");

  const redacted = SecretRedactor.redactText(source).text;

  assert.doesNotMatch(redacted, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(redacted, new RegExp(minioSecret));
  assert.equal(SecretRedactor.containsUnredactedSecret(redacted), false);
});

test("redacted password prompts do not reconnect to following transcript text", () => {
  const prompt = "ubuntu@host's password: [REDACTED_SECRET] Permission denied, please try again.";
  const transcript = "ssh -p 8956 ubuntu@118.25.230.236 ubuntu@118.25.230.236's password: [REDACTED_SECRET] Permission denied, please try again.";
  const redactedTranscript = "ssh -p 8956 ubuntu@118.25.230.236 ubuntu@118.25.230.236's password=[REDACTED_SECRET] Permission denied, please try again.";

  assert.equal(SecretRedactor.containsUnredactedSecret(prompt), false);
  assert.equal(SecretRedactor.containsUnredactedSecret(transcript), false);
  assert.equal(SecretRedactor.containsUnredactedSecret(redactedTranscript), false);
});

test("last user message remains the current request for weak model prompts", () => {
  const { service, project, task } = makeService();
  service.updateChatTask(project.id, task.id, {
    model_provider: "minimax",
    model: "MiniMax-M2.7",
  });
  service.appendTaskMessage(project.id, task.id, "user", "completed old request", {
    inputEnvelope: {
      id: "completed-old",
      text: "completed old request",
      turnId: "completed-turn",
      deliveryMode: "new_turn",
      status: "completed",
    },
  });
  service.appendTaskMessage(project.id, task.id, "assistant", "completed old answer");

  const built = service.buildTaskContext({
    projectId: project.id,
    taskId: task.id,
    userInput: "the current weak-model request",
    provider: "minimax",
    model: "MiniMax-M2.7",
  });

  const users = built.contextMessages.filter((message) => message.role === "user");
  assert.equal(users.at(-1).content.includes("the current weak-model request"), true);
  assert.equal(built.contextMessages.at(-1).role, "user");
  assert.equal(built.metadata.contextValidation.ok, true);
});
