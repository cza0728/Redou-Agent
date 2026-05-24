const fs = require("fs");
const path = require("path");
const { PROFILE_RUNTIME_CONFIG_KEYS, REDOU_SKILLS_DIR } = require("../constants.cjs");
const { compact, safeSegment, uniqueStrings } = require("../shared/textUtils.cjs");
const { mkdirp, readText, writeJsonAtomic } = require("../shared/fileUtils.cjs");
const { isoNow } = require("../shared/timeUtils.cjs");
const { topLevelYamlBlock, yamlBlockListValues, yamlScalar, yamlString } = require("../shared/yamlUtils.cjs");

class ProfileMethods {
  rootModelConfigBlock() {
    const configPath = path.join(this.hermesHome, "config.yaml");
    return topLevelYamlBlock(readText(configPath), "model") || "model:\n  provider: auto\n  model: ''";
  }

  rootMainModelSelection() {
    const block = this.rootModelConfigBlock();
    const selection = { provider: "", model: "" };
    const lines = block.split(/\r?\n/);
    const inlineModel = lines[0]?.match(/^model:\s+(.+)$/);
    if (inlineModel) {
      selection.model = yamlScalar(inlineModel[1]);
    }

    for (const line of lines.slice(1)) {
      const match = line.match(/^\s+([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
      if (!match) continue;
      const key = match[1];
      const value = yamlScalar(match[2]);
      if (key === "provider") {
        selection.provider = value;
      } else if ((key === "default" || key === "model") && value) {
        selection.model = value;
      }
    }
    return selection;
  }

  taskModelSelection(task) {
    return {
      provider: String(task?.model_provider || "").trim(),
      model: String(task?.model || "").trim(),
    };
  }

  recordedModelSelectionFromTask(task) {
    if (!task?.messagesPath) return { provider: "", model: "" };
    const { messages } = this.loadMessagesFile(task.messagesPath, { taskId: task.id });
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const metadata = messages[index]?.metadata;
      const eventMetadata = metadata?.event?.metadata;
      const candidates = [
        metadata,
        metadata?.context,
        eventMetadata,
        eventMetadata?.context,
      ].filter((item) => item && typeof item === "object");
      for (const candidate of candidates) {
        const provider = String(candidate.modelProvider || candidate.provider || "").trim();
        const model = String(candidate.model || "").trim();
        if (provider || model) {
          return { provider, model };
        }
      }
    }
    return { provider: "", model: "" };
  }

  modelSelectionForNewTask(project, body = {}) {
    const hasExplicitModel =
      Object.prototype.hasOwnProperty.call(body, "model_provider") ||
      Object.prototype.hasOwnProperty.call(body, "model");
    if (hasExplicitModel) {
      return {
        model_provider: String(body.model_provider || "").trim(),
        model: String(body.model || "").trim(),
      };
    }

    const state = this.getState();
    const currentTask =
      state.current_project_id === project.id
        ? project.tasks.find((task) => task.id === state.current_task_id)
        : null;
    const recentTask =
      currentTask ||
      [...project.tasks].sort(
        (left, right) => Number(right.updated_at || 0) - Number(left.updated_at || 0),
      )[0] ||
      null;
    const recentSelection = this.taskModelSelection(recentTask);
    if (recentSelection.provider || recentSelection.model) {
      return {
        model_provider: recentSelection.provider,
        model: recentSelection.model,
      };
    }
    const recordedSelection = this.recordedModelSelectionFromTask(recentTask);
    if (recordedSelection.provider || recordedSelection.model) {
      return {
        model_provider: recordedSelection.provider === "auto" ? "" : recordedSelection.provider,
        model: recordedSelection.model,
      };
    }

    const mainSelection = this.rootMainModelSelection();
    return {
      model_provider: mainSelection.provider === "auto" ? "" : mainSelection.provider,
      model: mainSelection.model,
    };
  }

  rootRuntimeConfigBlocks() {
    const configPath = path.join(this.hermesHome, "config.yaml");
    const text = readText(configPath);
    const blocks = [];
    for (const key of PROFILE_RUNTIME_CONFIG_KEYS) {
      const block = topLevelYamlBlock(text, key);
      if (block) blocks.push(block);
    }
    if (!blocks.some((block) => /^model:/m.test(block))) {
      blocks.unshift("model:\n  provider: auto\n  model: ''");
    }
    return blocks.join("\n");
  }

  existingProfileSkillsBlock(profileHome) {
    return topLevelYamlBlock(readText(path.join(profileHome, "config.yaml")), "skills");
  }

  renderManagedProfileSkillsConfig(profileHome) {
    const existingBlock = this.existingProfileSkillsBlock(profileHome);
    const disabled = uniqueStrings(yamlBlockListValues(existingBlock, "disabled"));
    const lines = ["skills:", "  disabled:"];
    if (disabled.length) {
      for (const name of disabled) {
        const rendered = /^[A-Za-z0-9._-]+$/.test(name) ? name : yamlString(name);
        lines.push(`    - ${rendered}`);
      }
    } else {
      lines.push("    []");
    }
    return lines.join("\n");
  }

  writeManagedProfileConfig(profileHome, workspacePath) {
    const configPath = path.join(profileHome, "config.yaml");
    const runtimeConfigBlocks = this.rootRuntimeConfigBlocks();
    const skillsConfigBlock = this.renderManagedProfileSkillsConfig(profileHome);
    const text = [
      "# Redou managed Hermes profile.",
      "# Redou stores project rules, task context, uploads, and task-packaged skills under the project .redou directory when a workspace is set.",
      runtimeConfigBlocks,
      skillsConfigBlock,
      "terminal:",
      `  cwd: ${yamlString(workspacePath || this.projectRoot)}`,
      "memory:",
      "  enabled: false",
      "approvals:",
      "  mode: manual",
      "",
    ].join("\n");

    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, text, "utf8");
      return;
    }

    const current = readText(configPath);
    if (current.startsWith("# Redou managed Hermes profile.")) {
      fs.writeFileSync(configPath, text, "utf8");
      return;
    }

    const workspacePathFile = path.join(profileHome, "redou-workspace.json");
    writeJsonAtomic(workspacePathFile, {
      workspacePath: workspacePath || this.projectRoot,
      note: "Non-managed config.yaml was left untouched; Redou binds this workspace through child process cwd and REDOU metadata.",
      updatedAt: isoNow(),
    });
  }

  ensureProjectHermesProfile(project) {
    const profileName = project.hermesProfile && project.hermesProfile !== "default"
      ? project.hermesProfile
      : this.desiredProjectProfileName(project.id);
    const profileHome = this.projectHermesHome(project);

    for (const dir of ["memories", "sessions", "skills", "skins", "logs", "plans", "workspace", "cron", "home"]) {
      mkdirp(path.join(profileHome, dir));
    }

    const workspacePath = project.path || project.workspace_path || "";
    const profileInfo = {
      name: profileName,
      projectId: project.id,
      projectName: project.name,
      workspacePath,
      appDataPath: project.appDataPath,
      contextPath: this.projectContextDir(project),
      hermesHomePath: profileHome,
      skillsPath: path.join(profileHome, REDOU_SKILLS_DIR),
      createdAt: isoNow(),
      memoryPolicy: "Redou project .redou files are primary. Hermes memory is project-local and auxiliary only.",
    };
    writeJsonAtomic(path.join(profileHome, "redou-profile.json"), profileInfo);
    writeJsonAtomic(path.join(profileHome, "profile.json"), profileInfo);
    this.writeManagedProfileConfig(profileHome, workspacePath);

    project.hermesProfile = profileName;
    project.hermesHomePath = profileHome;
    project.skillsPath = path.join(profileHome, REDOU_SKILLS_DIR);
    delete project.hermesProfileWarning;
    return profileName;
  }

}

function installProfileMethods(target) {
  for (const name of Object.getOwnPropertyNames(ProfileMethods.prototype)) {
    if (name === "constructor") continue;
    Object.defineProperty(target.prototype, name, Object.getOwnPropertyDescriptor(ProfileMethods.prototype, name));
  }
}

module.exports = { installProfileMethods };
