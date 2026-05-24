const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { RedouLocalService, compressTaskContext } = require("../src/services/redouLocalService.cjs");

function makeService() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "redou-context-compression-"));
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
  service.ensureInitialized();
  const workspacePath = path.join(root, "workspace");
  fs.mkdirSync(workspacePath, { recursive: true });
  const { project } = service.createChatProject({
    name: "Context Compression Project",
    workspace_path: workspacePath,
  });
  return { root, service, project, task: project.tasks[0] };
}

function promptText(built) {
  return built.contextMessages.map((message) => String(message.content || "")).join("\n\n");
}

test("compressTaskContext ignores null tool errors and successful exit codes", () => {
  const state = compressTaskContext([
    {
      type: "tool_output",
      output: {
        error: null,
        stderr: "",
        exitCode: 0,
        stdout: "RAW SUCCESS STDOUT WITH WORD Error SHOULD NOT BECOME ISSUE",
      },
    },
    { type: "command_start", command: "npm test" },
    {
      type: "command_output",
      metadata: { command: "npm test" },
      content: JSON.stringify({ stdout: "all good", stderr: "", exitCode: 0, error: null }),
    },
    { type: "command_end", command: "npm test", exitCode: 0, success: true },
  ]);

  assert.deepEqual(state.open_issues, []);
  assert.equal(state.commands_run.some((item) => /passed: npm test \(exitCode 0\)/.test(item)), true);
});

test("compressTaskContext records failed commands and resolves them after a later pass", () => {
  const failed = compressTaskContext([
    { type: "command_start", command: "npm test" },
    {
      type: "command_output",
      metadata: { command: "npm test" },
      content: JSON.stringify({ stdout: "noise", stderr: "AssertionError: expected true", exitCode: 1 }),
    },
    { type: "command_end", command: "npm test", exitCode: 1, success: false },
  ]);

  assert.equal(failed.open_issues.some((item) => /npm test/.test(item) && /exitCode 1/.test(item)), true);

  const resolved = compressTaskContext([
    { type: "command_start", command: "npm test" },
    {
      type: "command_output",
      metadata: { command: "npm test" },
      content: JSON.stringify({ stderr: "AssertionError: expected true", exitCode: 1 }),
    },
    { type: "command_end", command: "npm test", exitCode: 1, success: false },
    { type: "command_start", command: "npm test" },
    {
      type: "command_output",
      metadata: { command: "npm test" },
      content: JSON.stringify({ stdout: "passed", stderr: "", exitCode: 0 }),
    },
    { type: "command_end", command: "npm test", exitCode: 0, success: true },
  ]);

  assert.equal(resolved.open_issues.some((item) => /npm test/.test(item)), false);
  assert.equal(resolved.commands_run.at(-1), "passed: npm test (exitCode 0)");
});

test("recent turn digest and raw events stay out of the assembled prompt", () => {
  const { service, project, task } = makeService();
  const rawStdout = "RAW_EVENTS_JSONL_UNIQUE_STDOUT ".repeat(80);
  service.appendTaskEventJsonl(task, { type: "command_start", command: "node noisy.js" });
  service.appendTaskEventJsonl(task, {
    type: "command_output",
    metadata: { command: "node noisy.js" },
    content: JSON.stringify({ stdout: rawStdout, stderr: "", exitCode: 0, error: null }),
  });
  service.appendTaskEventJsonl(task, { type: "command_end", command: "node noisy.js", exitCode: 0, success: true });

  service.updateTaskContextAfterTurn(project.id, task.id, "Run the noisy command.", "Command passed.", {
    artifacts: {
      files: [],
      commands: ["node noisy.js"],
      errors: [],
      attachments: [],
    },
  });

  const eventsText = fs.readFileSync(task.eventsPath, "utf8");
  const contextText = fs.readFileSync(task.contextPath, "utf8");
  assert.match(eventsText, /RAW_EVENTS_JSONL_UNIQUE_STDOUT/);
  assert.match(contextText, /## B\. Recent Turn Digest/);
  assert.doesNotMatch(contextText, /RAW_EVENTS_JSONL_UNIQUE_STDOUT/);

  const built = service.buildTaskContext({
    projectId: project.id,
    taskId: task.id,
    userInput: "CURRENT UNIQUE REQUEST",
  });
  const text = promptText(built);
  assert.doesNotMatch(text, /Recent Turn Digest/);
  assert.doesNotMatch(text, /RAW_EVENTS_JSONL_UNIQUE_STDOUT/);
  assert.equal(text.split("CURRENT UNIQUE REQUEST").length - 1, 1);
  assert.equal(built.contextMessages.at(-1).role, "user");
  assert.match(built.contextMessages.at(-1).content, /CURRENT UNIQUE REQUEST/);
  assert.equal(built.metadata.contextValidation.ok, true);
});
