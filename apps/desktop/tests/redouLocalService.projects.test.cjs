const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { RedouLocalService } = require("../src/services/redouLocalService.cjs");

function makeBareService() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "redou-projects-"));
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

function makeService() {
  const context = makeBareService();
  context.service.ensureInitialized();
  return context;
}

function installFakeTaskSkillPackager(service, implementation = null) {
  const calls = [];
  service.callHermesTaskSkillPackager = (project, payload) => {
    calls.push({ project, payload });
    if (implementation) {
      return implementation(project, payload, calls.length);
    }
    const skillName = `task-${project.id}-${payload.task.id}`.replace(/[^A-Za-z0-9._-]+/g, "-").toLowerCase();
    const skillDir = path.join(service.projectSkillsDir(project), payload.category || "task-packages", skillName);
    const skillPath = path.join(skillDir, "SKILL.md");
    const contextRef = path.join(skillDir, "references", "task-context.md");
    const transcriptRef = path.join(skillDir, "references", "task-transcript.md");
    fs.mkdirSync(path.dirname(contextRef), { recursive: true });
    fs.writeFileSync(skillPath, `name: ${skillName}\n`, "utf8");
    fs.writeFileSync(contextRef, payload.taskContext || "", "utf8");
    fs.writeFileSync(transcriptRef, JSON.stringify(payload.messages || []), "utf8");
    return {
      success: true,
      skillName,
      skillCategory: payload.category || "task-packages",
      skillDir,
      skillPath,
      references: [contextRef, transcriptRef],
      packageAction: calls.length > 1 ? "updated" : "created",
      relatedSkills: [],
      warnings: payload.warnings || [],
    };
  };
  return calls;
}

test("old chat-projects.json is ignored after v3 cleanup", () => {
  const { service } = makeBareService();
  fs.mkdirSync(service.hermesHome, { recursive: true });
  fs.writeFileSync(
    path.join(service.hermesHome, "chat-projects.json"),
    `${JSON.stringify({ projects: [{ id: "old", name: "Old Project", tasks: [] }] }, null, 2)}\n`,
    "utf8",
  );

  service.ensureInitialized();

  const response = service.getChatProjects();
  assert.equal(response.projects.some((project) => project.id === "old"), false);
  assert.equal(response.projects.length, 1);
  assert.equal(response.projects[0].name, "默认项目");
  assert.equal(
    fs.existsSync(path.join(service.hermesHome, "chat-projects.json.migration-complete")),
    false,
  );
});

test("first run seeds a default project and task", () => {
  const { service } = makeBareService();

  service.ensureInitialized();

  const response = service.getChatProjects();
  assert.equal(response.projects.length, 1);
  const project = response.projects[0];
  const task = project.tasks[0];
  assert.equal(project.name, "默认项目");
  assert.equal(project.path, service.defaultChatProjectWorkspacePath());
  assert.equal(project.workspace_path, service.defaultChatProjectWorkspacePath());
  assert.equal(project.contextPath, path.join(service.defaultChatProjectWorkspacePath(), ".redou"));
  assert.equal(task.title, "开始对话");
  assert.equal(response.current_project_id, project.id);
  assert.equal(response.current_task_id, task.id);
  assert.equal(fs.existsSync(project.path), true);
  assert.equal(fs.existsSync(project.rulesPath), true);
  assert.equal(fs.existsSync(task.messagesPath), true);
});

test("empty workspace default project migrates to the default project workspace", () => {
  const { service } = makeBareService();
  service.db.initDb();
  service.ensureGlobalFiles();
  const createdAt = new Date().toISOString();
  const projectId = "default-project-old";
  const taskId = "task-old";
  const fallbackContext = service.projectDir(projectId);
  const fallbackTaskContext = path.join(fallbackContext, "tasks", taskId);
  fs.mkdirSync(fallbackTaskContext, { recursive: true });
  fs.writeFileSync(path.join(fallbackContext, "PROJECT_RULES.md"), "# Project Rules\n\n- keep me\n", "utf8");
  fs.writeFileSync(path.join(fallbackTaskContext, "messages.jsonl"), "{\"role\":\"user\",\"content\":\"hello\"}\n", "utf8");
  service.db.repositories.tasks.writeProject({
    id: projectId,
    name: "默认项目",
    path: "",
    workspace_path: "",
    createdAt,
    updatedAt: createdAt,
    tasks: [
      {
        id: taskId,
        projectId,
        title: "开始对话",
        createdAt,
        updatedAt: createdAt,
      },
    ],
  });

  service.ensureInitialized();

  const project = service.readProject(projectId);
  const task = project.tasks[0];
  assert.equal(project.path, service.defaultChatProjectWorkspacePath());
  assert.equal(project.workspace_path, service.defaultChatProjectWorkspacePath());
  assert.equal(project.contextPath, path.join(service.defaultChatProjectWorkspacePath(), ".redou"));
  assert.match(fs.readFileSync(project.rulesPath, "utf8"), /keep me/);
  assert.match(fs.readFileSync(project.rulesPath, "utf8"), /configured project workspace path/);
  assert.equal(fs.readFileSync(task.messagesPath, "utf8"), "{\"role\":\"user\",\"content\":\"hello\"}\n");
});

test("default project seeding runs only once", () => {
  const { service } = makeBareService();
  service.ensureInitialized();
  const seededProject = service.getChatProjects().projects[0];

  service.deleteChatProject(seededProject.id);

  const response = service.getChatProjects();
  assert.equal(response.projects.length, 0);
  assert.equal(response.current_project_id, "");
  assert.equal(response.current_task_id, "");
});

test("project artifacts and packaged skills stay under the project .redou directory", () => {
  const { root, service } = makeService();
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  const { project } = service.createChatProject({ name: "Path Project", path: workspace });
  const task = project.tasks[0];
  const redouRoot = path.join(workspace, ".redou");

  assert.equal(project.contextPath, redouRoot);
  assert.equal(project.rulesPath, path.join(redouRoot, "PROJECT_RULES.md"));
  const projectRules = fs.readFileSync(project.rulesPath, "utf8");
  assert.match(projectRules, /Keep all task outputs for this project under the configured project workspace path/);
  assert.equal(projectRules.includes(path.resolve(workspace)), true);
  assert.equal(project.hermesHomePath, redouRoot);
  assert.equal(project.skillsPath, path.join(redouRoot, "skills"));
  assert.equal(task.messagesPath, path.join(redouRoot, "tasks", task.id, "messages.jsonl"));
  assert.equal(task.rulesPath, path.join(redouRoot, "tasks", task.id, "TASK_RULES.md"));
  assert.equal(task.contextPath, path.join(redouRoot, "tasks", task.id, "TASK_CONTEXT.md"));
  assert.equal(task.uploadsPath, path.join(redouRoot, "tasks", task.id, "uploads"));
  assert.equal(fs.existsSync(path.join(redouRoot, "config.yaml")), true);
  assert.equal(fs.existsSync(path.join(redouRoot, "redou-profile.json")), true);
  assert.equal(fs.existsSync(path.join(service.appDataRoot(), "projects", project.id, "tasks")), false);
});

test("managed project profile carries root agent and goal turn budgets", () => {
  const { root, service } = makeService();
  fs.mkdirSync(service.hermesHome, { recursive: true });
  fs.writeFileSync(
    path.join(service.hermesHome, "config.yaml"),
    [
      "model:",
      "  provider: auto",
      "  model: ''",
      "agent:",
      "  max_turns: 333",
      "goals:",
      "  max_turns: 44",
      "",
    ].join("\n"),
    "utf8",
  );
  const workspace = path.join(root, "workspace-budgets");
  fs.mkdirSync(workspace, { recursive: true });
  const { project } = service.createChatProject({ name: "Budget Project", path: workspace });

  const text = fs.readFileSync(path.join(project.hermesHomePath, "config.yaml"), "utf8");
  assert.match(text, /^agent:\n  max_turns: 333/m);
  assert.match(text, /^goals:\n  max_turns: 44/m);
});

test("project workspace path is fixed after project creation", () => {
  const { root, service } = makeService();
  const workspace = path.join(root, "workspace");
  const otherWorkspace = path.join(root, "other-workspace");
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(otherWorkspace, { recursive: true });
  const { project } = service.createChatProject({ name: "Fixed Path Project", path: workspace });

  const renamed = service.updateChatProject(project.id, { name: "Renamed Path Project" }).project;
  assert.equal(renamed.name, "Renamed Path Project");
  assert.equal(renamed.path, workspace);

  assert.throws(
    () => service.updateChatProject(project.id, { workspace_path: otherWorkspace }),
    /workspace path is fixed/i,
  );

  const persisted = service.readProject(project.id);
  assert.equal(persisted.path, workspace);
  assert.equal(persisted.workspace_path, workspace);
});

test("new tasks inherit the current task model selection", () => {
  const { service } = makeService();
  const { project } = service.createChatProject({ name: "Model Project" });
  const firstTask = project.tasks[0];

  service.updateChatTask(project.id, firstTask.id, {
    model_provider: "minimax",
    model: "MiniMax-M2.7",
  });

  const inherited = service.createChatTask(project.id, { title: "Follow-up" }).task;
  assert.equal(inherited.model_provider, "minimax");
  assert.equal(inherited.model, "MiniMax-M2.7");

  const explicit = service.createChatTask(project.id, {
    title: "Override",
    model_provider: "openai",
    model: "gpt-5.1",
  }).task;
  assert.equal(explicit.model_provider, "openai");
  assert.equal(explicit.model, "gpt-5.1");
});

test("new tasks inherit the last recorded model when the previous task used config", () => {
  const { service } = makeService();
  const { project } = service.createChatProject({ name: "Recorded Model Project" });
  const firstTask = project.tasks[0];

  service.appendTaskMessage(project.id, firstTask.id, "event", "Hermes local runtime started.", {
    event: {
      type: "raw_log",
      metadata: {
        context: {
          modelProvider: "kimi-coding-cn",
          model: "kimi-k2.5",
        },
      },
    },
  });

  const inherited = service.createChatTask(project.id, { title: "Follow-up" }).task;
  assert.equal(inherited.model_provider, "kimi-coding-cn");
  assert.equal(inherited.model, "kimi-k2.5");
});

test("background task events do not steal the active task selection", () => {
  const { service } = makeService();
  const { project } = service.createChatProject({ name: "Concurrent Project" });
  const firstTask = project.tasks[0];
  const secondTask = service.createChatTask(project.id, { title: "Background" }).task;

  service.setActiveChatTask(project.id, firstTask.id);
  service.appendTaskMessage(project.id, secondTask.id, "event", "Background task progressed.", {
    eventType: "tool_output",
    event: {
      type: "tool_output",
      name: "terminal",
      output: "still running",
    },
  });

  const state = service.getChatProjects();
  assert.equal(state.current_project_id, project.id);
  assert.equal(state.current_task_id, firstTask.id);
});

test("restart selection fallback uses the latest task and persists it", () => {
  const { service } = makeService();
  const { project } = service.createChatProject({ name: "Restore Project" });
  const latestTask = service.createChatTask(project.id, { title: "Latest Context" }).task;

  service.saveState({ current_project_id: "", current_task_id: "" });

  const emptyStateResponse = service.getChatProjects();
  assert.equal(emptyStateResponse.current_project_id, project.id);
  assert.equal(emptyStateResponse.current_task_id, latestTask.id);
  assert.equal(service.getState().current_task_id, latestTask.id);

  service.saveState({ current_project_id: project.id, current_task_id: "missing-task" });

  const staleTaskResponse = service.getChatProjects();
  assert.equal(staleTaskResponse.current_project_id, project.id);
  assert.equal(staleTaskResponse.current_task_id, latestTask.id);
  assert.equal(service.getState().current_task_id, latestTask.id);
});

test("empty projects can be selected without a task", () => {
  const { service } = makeService();
  const { project: emptyProject } = service.createChatProject({ name: "Empty Project" });
  service.deleteChatTask(emptyProject.id, emptyProject.tasks[0].id);
  service.createChatProject({ name: "Filled Project" });

  const selected = service.setActiveChatProject(emptyProject.id);
  assert.equal(selected.ok, true);
  assert.equal(selected.project.id, emptyProject.id);
  assert.equal(selected.task, null);

  const state = service.getChatProjects();
  assert.equal(state.current_project_id, emptyProject.id);
  assert.equal(state.current_task_id, "");
});

test("task packaging delegates generation to the Hermes packager", () => {
  const { service } = makeService();
  const packageCalls = installFakeTaskSkillPackager(service);
  const { project } = service.createChatProject({ name: "Skill Project" });
  const task = project.tasks[0];

  service.updateTaskContextFile(
    project.id,
    task.id,
    "rules",
    "# Task Rules\n\n- Reuse only stable rules.\n",
  );
  service.updateTaskContextFile(
    project.id,
    task.id,
    "context",
    "# Task Context\n\nSolved by checking inputs and outputs.\n",
  );
  service.appendTaskMessage(project.id, task.id, "user", "Please solve this recurring task.");
  service.appendTaskMessage(project.id, task.id, "assistant", "Use the stable workflow.");

  const result = service.packageTaskSkill(project.id, task.id);

  assert.equal(result.ok, true);
  assert.match(result.skillName, /^task-/);
  assert.equal(result.skillCategory, "task-packages");
  assert.equal(path.basename(result.skillPath), "SKILL.md");
  assert.ok(result.skillPath.includes(`${path.sep}.redou${path.sep}skills${path.sep}`) || result.skillPath.includes(`${path.sep}projects${path.sep}`));
  assert.equal(packageCalls.length, 1);
  assert.equal(packageCalls[0].payload.category, "task-packages");
  assert.equal(packageCalls[0].payload.profileHome, service.projectHermesHome(project));
  assert.equal(packageCalls[0].payload.project.id, project.id);
  assert.equal(packageCalls[0].payload.task.id, task.id);
  assert.match(packageCalls[0].payload.taskRules, /Reuse only stable rules/);
  assert.match(packageCalls[0].payload.taskContext, /checking inputs and outputs/);
  assert.equal(packageCalls[0].payload.messages.length, 2);

  const messages = service.getChatTaskMessages(project.id, task.id).messages;
  const lastMessage = messages[messages.length - 1];
  assert.equal(lastMessage.role, "event");
  assert.match(lastMessage.content, /Packaged task as Hermes skill/);
  assert.equal(lastMessage.metadata.eventType, "skill_packaged");
  assert.equal(lastMessage.metadata.manager, "hermes_redou_task_skill_packager");
  assert.equal(lastMessage.metadata.skillName, result.skillName);
});

test("task packaging surfaces Hermes packager failures", () => {
  const { service } = makeService();
  installFakeTaskSkillPackager(service, () => ({ success: false, error: "bad skill payload" }));
  const { project } = service.createChatProject({ name: "Skill Project" });
  const task = project.tasks[0];

  assert.throws(
    () => service.packageTaskSkill(project.id, task.id),
    /Hermes task skill packaging failed: bad skill payload/,
  );
});

test("task packaging records Hermes update results without local skill logic", () => {
  const { service } = makeService();
  const packageCalls = installFakeTaskSkillPackager(service);
  const { project } = service.createChatProject({ name: "Skill Project" });
  const task = project.tasks[0];

  const first = service.packageTaskSkill(project.id, task.id);
  const second = service.packageTaskSkill(project.id, task.id);

  assert.equal(first.skillName, second.skillName);
  assert.equal(first.packageAction, "created");
  assert.equal(second.packageAction, "updated");
  assert.equal(packageCalls.length, 2);
});

test("shutdown stops active Hermes runs and clears queued messages", () => {
  const { service } = makeService();
  const { project } = service.createChatProject({ name: "Shutdown Project" });
  const task = project.tasks[0];
  let killed = false;
  const child = {
    kill() {
      killed = true;
      return true;
    },
  };
  const webContents = {
    isDestroyed: () => true,
    send: () => {},
  };

  service.activeRuns.set("run-shutdown", {
    child,
    projectId: project.id,
    taskId: task.id,
    webContents,
    startedAt: new Date().toISOString(),
    startedAtMs: Date.now(),
  });
  service.taskQueues.set(service.taskQueueKey(project.id, task.id), [
    { id: "queued-1", webContents, input: { projectId: project.id, taskId: task.id } },
  ]);

  const result = service.stopAllHermesActivity("Redou Agent is closing.");

  assert.equal(killed, true);
  assert.deepEqual(result.stoppedRuns, ["run-shutdown"]);
  assert.equal(result.queuedMessages, 1);
  assert.equal(service.activeRuns.size, 0);
  assert.equal(service.taskQueues.size, 0);
  assert.equal(service.getStatus().gateway_running, false);

  const messages = service.getChatTaskMessages(project.id, task.id).messages;
  assert.match(messages[messages.length - 1].content, /Redou Agent is closing/);
});
