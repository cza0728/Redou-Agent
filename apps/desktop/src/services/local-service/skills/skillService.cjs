const fs = require("fs");
const { TASK_SKILL_CATEGORY, callHermesTaskSkillPackager } = require("../../redouTaskSkillClient.cjs");

class SkillService {
  constructor({
    dashboardBridge = null,
    env = {},
    helpers = {},
    logger = null,
  } = {}) {
    this.dashboardBridge = typeof dashboardBridge === "function" ? dashboardBridge : null;
    this.env = env;
    this.helpers = helpers;
    this.log = typeof logger === "function" ? logger : () => {};
  }

  runDashboardBridge(action, payload = {}) {
    if (!this.dashboardBridge) {
      throw new Error("Unsupported in Redou Desktop: skill dashboard bridge is unavailable.");
    }
    return this.dashboardBridge(action, payload);
  }

  getSkills() {
    return this.runDashboardBridge("get_skills", {
      profileHomes: this.helpers.projectProfileHomesForBridge?.() || [],
    });
  }

  toggleSkill(name, enabled, scope = null) {
    const payload = { name, enabled: Boolean(enabled) };
    if (scope && typeof scope === "object") {
      if (scope.profile) payload.profile = String(scope.profile);
      if (scope.profileHome) payload.profileHome = String(scope.profileHome);
      if (scope.path) payload.path = String(scope.path);
    }
    return this.runDashboardBridge("toggle_skill", payload);
  }

  deleteSkill(skill) {
    const payload = skill && typeof skill === "object" ? { ...skill } : { name: skill };
    return this.runDashboardBridge("delete_skill", payload);
  }

  mergeSkills(skills) {
    return this.runDashboardBridge("merge_skills", {
      skills: Array.isArray(skills) ? skills : [],
    });
  }

  getToolsets() {
    return this.runDashboardBridge("get_toolsets");
  }

  callHermesTaskSkillPackager(project, payload) {
    const projectRoot = this.env.projectRoot?.();
    const cwd = project.path && fs.existsSync(project.path) ? project.path : projectRoot;
    return callHermesTaskSkillPackager({
      pythonPath: this.env.pythonPath?.(),
      cwd,
      env: this.env.childEnv?.({
        HERMES_HOME: this.helpers.projectHermesHome(project),
        REDOU_APP_DATA_ROOT: this.env.appDataRoot?.(),
        REDOU_PROJECT_ID: project.id,
        REDOU_PROJECT_HERMES_HOME: this.helpers.projectHermesHome(project),
        REDOU_PROJECT_SKILLS_DIR: this.helpers.projectSkillsDir(project),
        REDOU_HERMES_PROFILE: project.hermesProfile,
        PYTHONUTF8: "1",
        PYTHONUNBUFFERED: "1",
      }),
      payload: {
        ...payload,
        workspacePath: cwd,
        projectRoot: this.helpers.projectContextDir(project),
        targetSkillsDir: this.helpers.projectSkillsDir(project),
      },
    });
  }

  packageTaskSkill(projectId, taskId, packager = (project, payload) => this.callHermesTaskSkillPackager(project, payload)) {
    const { project, task } = this.helpers.findProjectAndTask(projectId, taskId);
    if (!project || !task) throw new Error("Project or task not found");

    this.helpers.ensureProjectHermesProfile(project);
    const packagedAt = this.helpers.isoNow();
    const { messages, warnings } = this.helpers.loadMessagesFile(task.messagesPath, { projectId, taskId });
    const packageResult = packager(project, {
      category: TASK_SKILL_CATEGORY,
      packagedAt,
      profileHome: this.helpers.projectHermesHome(project),
      targetSkillsDir: this.helpers.projectSkillsDir(project),
      project: {
        id: project.id,
        name: project.name,
        path: project.path,
        workspace_path: project.workspace_path,
        hermesProfile: project.hermesProfile,
      },
      task: {
        id: task.id,
        title: task.title,
        hermesSessionId: task.hermesSessionId,
      },
      projectRules: this.helpers.readText(project.rulesPath),
      taskRules: this.helpers.readText(task.rulesPath),
      taskContext: this.helpers.readText(task.contextPath),
      messages,
      warnings,
    });

    if (!packageResult?.success) {
      throw new Error(`Hermes task skill packaging failed: ${this.helpers.compact(packageResult?.error || "unknown error", 600)}`);
    }

    const eventContent = `Packaged task as Hermes skill '${packageResult.skillName}' at ${packageResult.skillPath}`;
    this.helpers.appendTaskMessage(project.id, task.id, "event", eventContent, {
      eventType: "skill_packaged",
      manager: "hermes_redou_task_skill_packager",
      skillName: packageResult.skillName,
      skillCategory: packageResult.skillCategory,
      skillPath: packageResult.skillPath,
      skillDir: packageResult.skillDir,
      packagedAt,
      packageAction: packageResult.packageAction,
      relatedSkills: packageResult.relatedSkills || [],
    });
    const refreshed = this.helpers.findProjectAndTask(project.id, task.id);
    this.log(`redou task packaged via hermes redou_task_skill_packager projectId=${project.id} taskId=${task.id} action=${packageResult.packageAction} skill=${packageResult.skillName} path=${this.helpers.redact(packageResult.skillPath)}`);
    return {
      ok: true,
      project: refreshed.project || project,
      task: refreshed.task || task,
      skillName: packageResult.skillName,
      skillCategory: packageResult.skillCategory,
      skillDir: packageResult.skillDir,
      skillPath: packageResult.skillPath,
      references: packageResult.references || [],
      packageAction: packageResult.packageAction,
      relatedSkills: packageResult.relatedSkills || [],
      warnings: packageResult.warnings || [],
    };
  }
}

module.exports = {
  SkillService,
};
