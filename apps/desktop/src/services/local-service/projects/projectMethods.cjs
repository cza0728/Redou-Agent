const path = require("path");
const { DEFAULT_CHAT_PROJECT_NAME, DEFAULT_CHAT_TASK_TITLE } = require("../constants.cjs");
const { ANALYSIS_WORKSPACE_PROJECT_ID, ANALYSIS_WORKSPACE_TASK_KIND } = require("../analysis/benchmarkUtils.cjs");
const { appendDedupeRules, projectWorkspaceOutputRule, redact } = require("../context/contextUtils.cjs");
const { compact, safeSegment } = require("../shared/textUtils.cjs");
const { isoNow } = require("../shared/timeUtils.cjs");

class ProjectMethods {
  getChatProjects() {
    this.ensureInitialized();
    const state = this.getState();
    const projects = this.readAllProjects().map((project) => this.decorateProjectRuntime(project));
    const current = this.resolveCurrentChatSelection(projects, state);
    if (
      current.current_project_id !== (state.current_project_id || "") ||
      current.current_task_id !== (state.current_task_id || "")
    ) {
      this.saveState(current);
    }
    return {
      version: 2,
      current_project_id: current.current_project_id,
      current_task_id: current.current_task_id,
      projects,
    };
  }

  ensureDefaultChatProject() {
    const projects = this.readAllProjects();
    if (projects.length > 0) {
      return { ok: true, seeded: false, project: projects[0] };
    }
    const result = this.createChatProject({
      name: DEFAULT_CHAT_PROJECT_NAME,
      initial_task_title: DEFAULT_CHAT_TASK_TITLE,
    });
    return { ...result, seeded: true };
  }

  createChatProject(body = {}) {
    const name = compact(body.name, 120) || "New Project";
    const id = safeSegment(`${name}-${Date.now().toString(36)}`, `project-${Date.now().toString(36)}`);
    const createdAt = isoNow();
    const project = this.ensureProject({
      id,
      name,
      path: compact(body.workspace_path || body.path, 1000),
      hermesProfile: this.desiredProjectProfileName(id),
      createdAt,
      updatedAt: createdAt,
      tasks: [],
    });
    appendDedupeRules(project.rulesPath, [projectWorkspaceOutputRule(project.path || project.workspace_path)]);
    const taskTitle = compact(body.initial_task_title || body.task_title, 160) || "New Task";
    const task = this.ensureTask(project, {
      id: `task-${Date.now().toString(36)}`,
      projectId: project.id,
      title: taskTitle,
      createdAt,
      updatedAt: createdAt,
    });
    const saved = this.writeProject({ ...project, tasks: [task] });
    this.saveState({ current_project_id: saved.id, current_task_id: task.id });
    this.log(`redou project open projectId=${project.id} projectPath=${redact(project.path)} hermesProfile=${project.hermesProfile}`);
    return { ok: true, project: saved };
  }

  updateChatProject(projectId, body = {}) {
    const project = this.readProject(projectId);
    if (!project) throw new Error("Project not found");
    const hasWorkspaceUpdate =
      Object.prototype.hasOwnProperty.call(body, "workspace_path") ||
      Object.prototype.hasOwnProperty.call(body, "path");
    const requestedWorkspacePath = hasWorkspaceUpdate
      ? compact(body.workspace_path ?? body.path, 1000)
      : project.path;
    if (hasWorkspaceUpdate && requestedWorkspacePath !== project.path) {
      throw new Error("Project workspace path is fixed after project creation.");
    }
    const next = {
      ...project,
      name: body.name == null ? project.name : compact(body.name, 120) || project.name,
      path: project.path,
      updatedAt: isoNow(),
    };
    const saved = this.ensureProject(next);
    return { ok: true, project: saved };
  }

  deleteChatProject(projectId) {
    this.ensureInitialized();
    const project = this.readProject(projectId);
    if (!project) throw new Error("Project not found");
    if (this.hasActiveRunFor(project.id)) {
      throw new Error("Stop the running task before deleting this project.");
    }

    const deletedTaskIds = project.tasks.map((task) => task.id);
    const analysisCleanup = project.id === ANALYSIS_WORKSPACE_PROJECT_ID
      ? this.deleteAnalysisWorkspaceProjectData()
      : { deletedPaths: [] };
    this.removeAppDataDir(this.projectsDir(), this.projectDir(project.id), "project");

    const projects = this.readAllProjects();
    const nextProject = projects[0] || null;
    const nextTask = nextProject?.tasks?.[0] || null;
    this.saveState({
      current_project_id: nextProject?.id || "",
      current_task_id: nextTask?.id || "",
    });
    this.log(`redou project delete projectId=${project.id} taskCount=${deletedTaskIds.length}`);
    return {
      ok: true,
      deleted_project_id: project.id,
      deleted_task_ids: deletedTaskIds,
      deleted_analysis_paths: analysisCleanup.deletedPaths || [],
      current_project_id: nextProject?.id || "",
      current_task_id: nextTask?.id || "",
      projects,
    };
  }

  createChatTask(projectId, body = {}) {
    const project = this.readProject(projectId);
    if (!project) throw new Error("Project not found");
    const title = compact(body.title, 160) || "New Task";
    const id = safeSegment(`${title}-${Date.now().toString(36)}`, `task-${Date.now().toString(36)}`);
    const createdAt = isoNow();
    const modelSelection = this.modelSelectionForNewTask(project, body);
    const task = this.ensureTask(project, {
      id,
      projectId: project.id,
      title,
      createdAt,
      updatedAt: createdAt,
      model_provider: modelSelection.model_provider,
      model: modelSelection.model,
    });
    const saved = this.writeProject({
      ...project,
      updatedAt: isoNow(),
      tasks: [...project.tasks, task],
    });
    this.saveState({ current_project_id: project.id, current_task_id: task.id });
    this.log(`redou task open projectId=${project.id} taskId=${task.id} messagesPath=${redact(task.messagesPath)} loadedMessages=0`);
    return { ok: true, project: saved, task: saved.tasks.find((item) => item.id === task.id) || task };
  }

  updateChatTask(projectId, taskId, body = {}, options = {}) {
    const project = this.readProject(projectId);
    if (!project) throw new Error("Project not found");
    let selected = null;
    const tasks = project.tasks.map((task) => {
      if (task.id !== taskId) return task;
      selected = this.ensureTask(project, {
        ...task,
        title: body.title == null ? task.title : compact(body.title, 160) || task.title,
        hermesSessionId: body.hermesSessionId ?? body.session_id ?? task.hermesSessionId,
        session_id: body.hermesSessionId ?? body.session_id ?? task.session_id,
        model_provider: body.model_provider == null ? task.model_provider : body.model_provider || "",
        model: body.model == null ? task.model : body.model || "",
        updatedAt: isoNow(),
      });
      return selected;
    });
    if (!selected) throw new Error("Task not found");
    const saved = this.writeProject({ ...project, updatedAt: isoNow(), tasks });
    if (options.activate !== false) {
      this.saveState({ current_project_id: project.id, current_task_id: taskId });
    }
    return {
      ok: true,
      project: saved,
      task: saved.tasks.find((item) => item.id === taskId) || selected,
    };
  }

  deleteChatTask(projectId, taskId) {
    const project = this.readProject(projectId);
    if (!project) throw new Error("Project not found");
    const taskIndex = project.tasks.findIndex((task) => task.id === taskId);
    if (taskIndex < 0) throw new Error("Task not found");
    if (this.hasActiveRunFor(project.id, taskId)) {
      throw new Error("Stop the running task before deleting it.");
    }

    const task = project.tasks[taskIndex];
    const analysisCleanup =
      project.id === ANALYSIS_WORKSPACE_PROJECT_ID || task.kind === ANALYSIS_WORKSPACE_TASK_KIND
        ? this.deleteAnalysisWorkspaceTaskData(task)
        : { deletedPaths: [], removedResults: 0 };
    const remainingTasks = project.tasks.filter((item) => item.id !== taskId);
    const saved = this.writeProject({
      ...project,
      updatedAt: isoNow(),
      tasks: remainingTasks,
    });
    this.removeAppDataDir(
      path.join(this.projectDir(project.id), "tasks"),
      this.taskDir(project.id, task.id),
      "task",
    );
    this.removeAppDataDir(
      path.join(this.projectContextDir(project), "tasks"),
      this.taskContextDir(project, task.id),
      "task context",
    );

    const nextTask =
      saved.tasks[Math.min(taskIndex, saved.tasks.length - 1)] || null;
    const state = this.getState();
    const stateProjectId = state.current_project_id || project.id;
    const stateTaskExists = saved.tasks.some((item) => item.id === state.current_task_id);
    const deletedCurrentTask =
      state.current_project_id === project.id && state.current_task_id === taskId;
    const currentTaskId =
      deletedCurrentTask || (state.current_project_id === project.id && !stateTaskExists)
        ? nextTask?.id || ""
        : state.current_task_id || "";
    this.saveState({
      current_project_id: stateProjectId,
      current_task_id: currentTaskId,
    });
    this.log(`redou task delete projectId=${project.id} taskId=${task.id}`);
    return {
      ok: true,
      project: saved,
      deleted_task_id: task.id,
      deleted_analysis_paths: analysisCleanup.deletedPaths || [],
      deleted_analysis_results: analysisCleanup.removedResults || 0,
      next_task: nextTask,
      current_project_id: stateProjectId,
      current_task_id: currentTaskId,
    };
  }

  findProjectAndTask(projectId, taskId) {
    const project = this.readProject(projectId);
    if (!project) return { project: null, task: null };
    const task = project.tasks.find((item) => item.id === taskId) || null;
    if (!task) return { project, task: null };
    return { project: this.ensureProject(project), task: this.ensureTask(project, task) };
  }

  loadMessagesFile(file, context = {}) {
    return this.logService.loadMessagesFile(file, context);
  }

  getChatTaskMessages(projectId, taskId) {
    const { project, task } = this.findProjectAndTask(projectId, taskId);
    if (!project || !task) {
      return {
        projectId,
        taskId,
        messagesPath: "",
        hermesSessionId: "",
        messages: [],
        warnings: ["Project or task metadata was not found."],
        is_active: false,
        active_run_id: null,
        queue_depth: 0,
        run_started_at: null,
        last_active: null,
      };
    }
    const { messages, warnings } = this.loadMessagesFile(task.messagesPath, { projectId, taskId });
    const runtime = this.taskRuntimeSnapshot(project.id, task.id);
    this.log(`redou task open projectId=${projectId} taskId=${taskId} messagesPath=${redact(task.messagesPath)} loadedMessages=${messages.length}`);
    return {
      projectId,
      taskId,
      messagesPath: task.messagesPath,
      hermesSessionId: task.hermesSessionId || "",
      messages,
      warnings,
      ...runtime,
    };
  }

  callHermesTaskSkillPackager(project, payload) { return this.skillService.callHermesTaskSkillPackager(project, payload); }

  packageTaskSkill(projectId, taskId) {
    return this.skillService.packageTaskSkill(
      projectId,
      taskId,
      (project, payload) => this.callHermesTaskSkillPackager(project, payload),
    );
  }

  setActiveChatProject(projectId) {
    const project = this.readProject(projectId);
    if (!project) throw new Error("Project not found");
    const task = this.latestTaskForProject(project);
    this.saveState({ current_project_id: project.id, current_task_id: task?.id || "" });
    this.log(`redou project selected projectId=${project.id} taskId=${task?.id || ""}`);
    return { ok: true, project: this.ensureProject(project), task: task || null };
  }

  setActiveChatTask(projectId, taskId) {
    const { project, task } = this.findProjectAndTask(projectId, taskId);
    if (!project || !task) throw new Error("Project or task not found");
    this.saveState({ current_project_id: project.id, current_task_id: task.id });
    this.log(`redou task selected projectId=${project.id} taskId=${task.id} messagesPath=${redact(task.messagesPath)}`);
    return { ok: true, project, task };
  }

  appendTaskMessage(projectId, taskId, role, content, metadata = {}, attachments = []) {
    return this.logService.appendTaskMessage(projectId, taskId, role, content, metadata, attachments);
  }

  appendTaskEventJsonl(task, event) {
    return this.logService.appendTaskEventJsonl(task, event);
  }

  readTaskEvents(task) {
    return this.logService.readTaskEvents(task);
  }

  updateUserInputEnvelopeStatus(projectId, taskId, envelopeId, patch = {}) {
    return this.logService.updateUserInputEnvelopeStatus(projectId, taskId, envelopeId, patch);
  }

  removeQueuedUserInputMessage(projectId, taskId, queueId) {
    return this.logService.removeQueuedUserInputMessage(projectId, taskId, queueId);
  }

}

function installProjectMethods(target) {
  for (const name of Object.getOwnPropertyNames(ProjectMethods.prototype)) {
    if (name === "constructor") continue;
    Object.defineProperty(target.prototype, name, Object.getOwnPropertyDescriptor(ProjectMethods.prototype, name));
  }
}

module.exports = { installProjectMethods };
