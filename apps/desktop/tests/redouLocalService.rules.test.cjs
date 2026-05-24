const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { RedouLocalService } = require("../src/services/redouLocalService.cjs");

function makeService() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "redou-rules-"));
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
  return { root, service };
}

function createProjectAndTask(service, root) {
  const workspacePath = path.join(root, "workspace");
  fs.mkdirSync(workspacePath, { recursive: true });
  const { project } = service.createChatProject({
    name: "Rules Project",
    workspace_path: workspacePath,
  });
  const task = project.tasks[0];
  service.updateChatTask(project.id, task.id, {
    model_provider: "minimax",
    model: "MiniMax-M2.7",
  });
  return { project, task };
}

test("explicit remember stores concise task rules by default and passes MiniMax selection", () => {
  const { root, service } = makeService();
  const { project, task } = createProjectAndTask(service, root);

  const response = service.sendMessage(null, {
    projectId: project.id,
    taskId: task.id,
    userInput: "记住：回答默认使用简体中文，尽量精简。现在请随便回复一句确认。",
  });

  assert.equal(response.ok, false);
  assert.match(response.warning || "", /Python runtime is unavailable/);
  assert.equal(response.context.modelProvider, "minimax");
  assert.equal(response.context.model, "MiniMax-M2.7");

  const taskRules = fs.readFileSync(task.rulesPath, "utf8");
  const projectRules = fs.readFileSync(project.rulesPath, "utf8");
  assert.match(taskRules, /- 回答默认使用简体中文，尽量精简。/);
  assert.doesNotMatch(taskRules, /现在请/);
  assert.doesNotMatch(taskRules, /Source:/);
  assert.doesNotMatch(projectRules, /回答默认使用简体中文/);
});

test("explicit project rules write to project rules and both rule files enter the prompt", () => {
  const { root, service } = makeService();
  const { project, task } = createProjectAndTask(service, root);

  service.sendMessage(null, {
    projectId: project.id,
    taskId: task.id,
    userInput: "记住：回答默认使用简体中文，尽量精简。",
  });
  service.sendMessage(null, {
    projectId: project.id,
    taskId: task.id,
    userInput: "请记住本项目规则：前端代码不要直接调用 child_process；必须通过 preload IPC。",
  });

  const projectRules = fs.readFileSync(project.rulesPath, "utf8");
  const taskRules = fs.readFileSync(task.rulesPath, "utf8");
  assert.match(projectRules, /- 前端代码不要直接调用 child_process；必须通过 preload IPC。/);
  assert.doesNotMatch(taskRules, /child_process/);

  const built = service.buildTaskContext({
    projectId: project.id,
    taskId: task.id,
    userInput: "下一轮输入应该带上哪些规则？",
  });
  assert.match(built.userContext, /## 1\. Project Rules[\s\S]*前端代码不要直接调用 child_process/);
  assert.match(built.userContext, /## 2\. Task Rules[\s\S]*回答默认使用简体中文/);
  assert.match(built.systemContext, /## Redou Identity[\s\S]*You are Redou Agent/);
  assert.match(built.systemContext, /Hermes is only the Local Runtime layer/);
  assert.match(built.systemContext, /memory and session_search toolsets are disabled/);
  assert.match(built.systemContext, /skill reading is allowed through skills_list and skill_view/);
  assert.match(built.systemContext, /skill management is disabled/);
  assert.match(built.userContext, /## 0\. Priority[\s\S]*Current User Request/);
  assert.equal(built.metadata.projectRulesPath, project.rulesPath);
  assert.equal(built.metadata.taskRulesPath, task.rulesPath);
});

test("transient requests without an explicit remember signal are not stored as rules", () => {
  const { root, service } = makeService();
  const { project, task } = createProjectAndTask(service, root);

  service.sendMessage(null, {
    projectId: project.id,
    taskId: task.id,
    userInput: "不要运行测试，只解释这段代码为什么失败。",
  });
  service.sendMessage(null, {
    projectId: project.id,
    taskId: task.id,
    userInput: "任务规则是什么？",
  });

  const expectedProjectRule = `- Keep all task outputs for this project under the configured project workspace path: ${path.resolve(project.path)}. This includes generated files, reports, logs, and other artifacts, unless the user explicitly requests otherwise.`;
  assert.equal(fs.readFileSync(project.rulesPath, "utf8").trimEnd(), `# Project Rules\n\n${expectedProjectRule}`);
  assert.equal(fs.readFileSync(task.rulesPath, "utf8"), "# Task Rules\n\n");
});

test("manual task rule extraction copies task context constraints into task rules", () => {
  const { root, service } = makeService();
  const { project, task } = createProjectAndTask(service, root);

  service.updateTaskContextFile(project.id, task.id, "context", [
    "# Task Context",
    "",
    "## A. Structured State",
    "",
    "### Current Brief",
    "",
    "### Active Constraints",
    "",
    "- Answer with a concise verification summary.",
    "- Keep renderer changes behind preload IPC.",
    "",
    "### Todo List",
    "",
    "### Progress Summary",
    "",
    "### Evidence and Artifacts",
    "",
    "### Open Issues",
    "",
    "---",
    "",
    "## B. Recent Turn Digest",
    "",
  ].join("\n"));

  const result = service.extractTaskContextRules(project.id, task.id, "task");
  assert.equal(result.target, "task");
  assert.deepEqual(result.rulesAdded, [
    "Answer with a concise verification summary.",
    "Keep renderer changes behind preload IPC.",
  ]);
  assert.match(fs.readFileSync(task.rulesPath, "utf8"), /- Answer with a concise verification summary\./);
  assert.match(fs.readFileSync(task.rulesPath, "utf8"), /- Keep renderer changes behind preload IPC\./);
  assert.doesNotMatch(fs.readFileSync(project.rulesPath, "utf8"), /preload IPC/);
});

test("manual project rule extraction writes selected task context rules into project rules", () => {
  const { root, service } = makeService();
  const { project, task } = createProjectAndTask(service, root);

  service.updateTaskContextFile(project.id, task.id, "context", [
    "# Task Context",
    "",
    "## A. Structured State",
    "",
    "### Current Brief",
    "",
    "### Project Rules",
    "",
    "- Renderer code must use preload IPC for local runtime calls.",
    "",
    "### Active Constraints",
    "",
    "### Todo List",
    "",
    "### Progress Summary",
    "",
    "### Evidence and Artifacts",
    "",
    "### Open Issues",
    "",
    "---",
    "",
    "## B. Recent Turn Digest",
    "",
  ].join("\n"));

  const result = service.extractTaskContextRules(project.id, task.id, "project");
  assert.equal(result.target, "project");
  assert.deepEqual(result.rulesAdded, [
    "Renderer code must use preload IPC for local runtime calls.",
  ]);
  assert.match(fs.readFileSync(project.rulesPath, "utf8"), /- Renderer code must use preload IPC for local runtime calls\./);
  assert.doesNotMatch(fs.readFileSync(task.rulesPath, "utf8"), /local runtime calls/);
});
