import { Button } from "@nous-research/ui/ui/components/button";
import { Input } from "@/components/ui/input";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import {
  CHAT_PROJECTS_CHANGED_EVENT,
  redouApi,
  notifyChatProjectsChanged,
  type ChatProject,
  type ChatTask,
} from "@/lib/api";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  BookOpenText,
  CheckCircle2,
  Circle,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  ListPlus,
  MessageSquare,
  PackagePlus,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";

interface Props {
  channel: string;
  selectedProjectId: string | null;
  selectedTaskId: string | null;
  onClearSelection?(): void;
  onSelect(project: ChatProject, task: ChatTask | null): void;
}

type ContextEditorTarget =
  | { scope: "project"; projectId: string; kind: "rules"; title: string }
  | {
      scope: "task";
      projectId: string;
      taskId: string;
      kind: "rules" | "context";
      title: string;
    };

interface ContextEditorState {
  content: string;
  error: string | null;
  loading: boolean;
  path: string;
  saving: boolean;
  target: ContextEditorTarget | null;
}

type DeleteTarget =
  | { scope: "project"; project: ChatProject }
  | { scope: "task"; project: ChatProject; task: ChatTask };

type RenameTarget =
  | { scope: "project"; projectId: string }
  | { scope: "task"; projectId: string; taskId: string };

function ContextFileEditorDialog({
  editor,
  onChange,
  onClose,
  onSave,
}: {
  editor: ContextEditorState;
  onChange(value: string): void;
  onClose(): void;
  onSave(): void;
}) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const open = Boolean(editor.target);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, open]);

  if (!open || !editor.target) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="context-editor-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-md border border-border bg-card shadow-2xl">
        <div className="flex min-w-0 items-center gap-3 border-b border-border px-4 py-3">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h2 id="context-editor-title" className="truncate text-sm font-semibold text-midground">
              {editor.target.title}
            </h2>
            <div className="truncate text-xs text-muted-foreground" title={editor.path}>
              {editor.path}
            </div>
          </div>
          <button
            type="button"
            className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-background/40 hover:text-midground"
            title={copy.close}
            aria-label={copy.close}
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {editor.error && (
          <div className="border-b border-destructive/30 bg-destructive/5 px-4 py-2 text-xs text-destructive">
            {editor.error}
          </div>
        )}

        <textarea
          value={editor.loading ? copy.loading : editor.content}
          onChange={(event) => onChange(event.target.value)}
          disabled={editor.loading || editor.saving}
          spellCheck={false}
          className="min-h-[24rem] flex-1 resize-none bg-background/35 p-4 font-mono text-sm leading-6 text-midground outline-none placeholder:text-muted-foreground disabled:opacity-70"
        />

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <Button type="button" outlined onClick={onClose} disabled={editor.saving}>
            {copy.cancel}
          </Button>
          <Button
            type="button"
            prefix={<Save />}
            onClick={onSave}
            disabled={editor.loading || editor.saving}
          >
            {editor.saving ? copy.saving : copy.save}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function compactPath(path: string, max = 36): string {
  if (!path) return "No local workspace";
  if (path.length <= max) return path;
  return `...${path.slice(Math.max(0, path.length - max + 3))}`;
}

const COPY = {
  zh: {
    projects: "项目",
    noWorkspace: "未选择本地空间",
    refresh: "刷新项目",
    newProject: "新建项目",
    projectName: "项目名称",
    workspacePath: "本地空间路径",
    browse: "浏览",
    cancel: "取消",
    create: "创建",
    choose: "选择",
    close: "关闭",
    loading: "加载中...",
    projectRules: "项目规则",
    save: "保存",
    saving: "保存中...",
    newTask: "新建任务",
    add: "添加",
    deleteProject: "删除项目",
    deleteTask: "删除任务",
    deleteProjectTitle: "删除项目？",
    deleteTaskTitle: "删除任务？",
    deleteProjectDescription: (name: string) =>
      `将从 Redou 删除项目“${name}”及其中所有任务、规则、上下文和消息。不会删除本地工作目录。此操作无法撤销。`,
    deleteTaskDescription: (name: string) =>
      `将删除任务“${name}”的规则、上下文、消息和附件。不会删除项目或本地工作目录。此操作无法撤销。`,
    pickerMissing: "桌面目录选择器不可用，请直接粘贴路径。",
    justNow: "刚刚",
    yesterday: "昨天",
    minutesAgo: (value: number) => `${value} 分钟前`,
    hoursAgo: (value: number) => `${value} 小时前`,
    daysAgo: (value: number) => `${value} 天前`,
  },
  en: {
    projects: "Projects",
    noWorkspace: "No local workspace",
    refresh: "Refresh projects",
    newProject: "New project",
    projectName: "Project name",
    workspacePath: "Workspace path",
    browse: "browse",
    cancel: "Cancel",
    create: "create",
    choose: "choose",
    close: "Close",
    loading: "Loading...",
    projectRules: "Project Rules",
    save: "save",
    saving: "Saving...",
    newTask: "New task",
    add: "add",
    deleteProject: "Delete project",
    deleteTask: "Delete task",
    deleteProjectTitle: "Delete project?",
    deleteTaskTitle: "Delete task?",
    deleteProjectDescription: (name: string) =>
      `Delete "${name}" from Redou, including all tasks, rules, context, and messages. The local workspace folder will not be deleted. This cannot be undone.`,
    deleteTaskDescription: (name: string) =>
      `Delete "${name}" task rules, context, messages, and attachments. The project and local workspace folder will not be deleted. This cannot be undone.`,
    pickerMissing: "Desktop directory picker is unavailable. Paste a path instead.",
    justNow: "just now",
    yesterday: "yesterday",
    minutesAgo: (value: number) => `${value}m ago`,
    hoursAgo: (value: number) => `${value}h ago`,
    daysAgo: (value: number) => `${value}d ago`,
  },
} as const;

function relativeTime(ts: number, copy: (typeof COPY)["zh"] | (typeof COPY)["en"]): string {
  const delta = Date.now() / 1000 - ts;
  if (delta < 60) return copy.justNow;
  if (delta < 3600) return copy.minutesAgo(Math.floor(delta / 60));
  if (delta < 86400) return copy.hoursAgo(Math.floor(delta / 3600));
  if (delta < 172800) return copy.yesterday;
  return copy.daysAgo(Math.floor(delta / 86400));
}

function inputClass(className?: string): string {
  return cn(
    "h-8 rounded-md border-border bg-background/40 px-2 text-sm text-midground",
    "placeholder:text-muted-foreground focus-visible:border-foreground/25 focus-visible:ring-foreground/30",
    className,
  );
}

type TaskTreeStatus = "idle" | "queued" | "running" | "completed" | "failed" | "interrupted";

const TASK_TREE_STATUS_LABEL: Record<TaskTreeStatus, string> = {
  idle: "Idle",
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  interrupted: "Interrupted",
};

function taskTreeStatus(task: ChatTask): TaskTreeStatus {
  const runtimeStatus = String(task.runtime_status || "").trim().toLowerCase();
  if (task.is_active || runtimeStatus === "running") return "running";
  if (Number(task.queue_depth || 0) > 0 || runtimeStatus === "queued") return "queued";
  if (["interrupted", "stopped", "aborted", "cancelled", "canceled"].includes(runtimeStatus)) {
    return "interrupted";
  }
  if (["failed", "error"].includes(runtimeStatus)) return "failed";
  if (["completed", "complete", "done", "finished"].includes(runtimeStatus) || task.session_id) {
    return "completed";
  }
  return "idle";
}

function TaskTreeStatusGlyph({ task }: { task: ChatTask }) {
  const status = taskTreeStatus(task);
  const label = TASK_TREE_STATUS_LABEL[status];
  const baseClass = "grid h-4 w-4 shrink-0 place-items-center";

  if (status === "running") {
    return (
      <span className={baseClass} role="img" aria-label={label} title={label}>
        <RefreshCw className="h-3.5 w-3.5 animate-spin text-success" />
      </span>
    );
  }

  if (status === "queued") {
    return (
      <span className={baseClass} role="img" aria-label={label} title={label}>
        <Circle className="h-3.5 w-3.5 fill-warning/25 text-warning" />
      </span>
    );
  }

  if (status === "failed" || status === "interrupted") {
    return (
      <span
        className={cn(baseClass, "rounded-full border border-destructive/40 bg-destructive/10 text-destructive")}
        role="img"
        aria-label={label}
        title={label}
      >
        <X className="h-3 w-3" />
      </span>
    );
  }

  if (status === "completed") {
    return (
      <span className={baseClass} role="img" aria-label={label} title={label}>
        <CheckCircle2 className="h-4 w-4 text-success/80" />
      </span>
    );
  }

  return (
    <span className={baseClass} role="img" aria-label={label} title={label}>
      <MessageSquare className="h-4 w-4 text-muted-foreground" />
    </span>
  );
}

export function ProjectTaskPanel({
  onClearSelection,
  onSelect,
  selectedProjectId,
  selectedTaskId,
}: Props) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const openWorkspaceFolderLabel =
    locale === "zh" ? "\u6253\u5f00\u6587\u4ef6\u5939" : "Open folder";
  const [projects, setProjects] = useState<ChatProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [packagingTaskKey, setPackagingTaskKey] = useState<string | null>(null);
  const [extractingRuleKey, setExtractingRuleKey] = useState<string | null>(null);
  const [projectFormOpen, setProjectFormOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editor, setEditor] = useState<ContextEditorState>({
    content: "",
    error: null,
    loading: false,
    path: "",
    saving: false,
    target: null,
  });
  const selectPanelItem = useCallback(
    (project: ChatProject, task: ChatTask | null) => {
      onSelect(project, task);
    },
    [onSelect],
  );

  const selectedProject =
    projects.find((project) => project.id === selectedProjectId) ??
    projects[0] ??
    null;
  const selectedTask =
    selectedProject?.tasks.find((task) => task.id === selectedTaskId) ??
    selectedProject?.tasks[0] ??
    null;
  const packageSkillLabel = locale === "zh" ? "打包 Skill" : "Package as skill";
  const packageSkillBusyLabel = locale === "zh" ? "正在打包 Skill..." : "Packaging skill...";
  const packageSkillDone = useCallback(
    (name: string) => (locale === "zh" ? `已打包 Skill: ${name}` : `Packaged skill: ${name}`),
    [locale],
  );
  const extractRulesLabel = locale === "zh" ? "提取规则" : "Extract rules";
  const extractTaskRulesLabel = locale === "zh" ? "提取任务规则" : "Extract task rules";
  const extractProjectRulesLabel = locale === "zh" ? "提取项目规则" : "Extract project rules";
  const extractRulesBusyLabel = locale === "zh" ? "正在提取规则..." : "Extracting rules...";
  const extractRulesDone = useCallback(
    (target: "task" | "project", count: number) => {
      const targetName =
        locale === "zh"
          ? target === "project"
            ? "项目规则"
            : "任务规则"
          : target === "project"
            ? "project rules"
            : "task rules";
      if (count > 0) {
        return locale === "zh"
          ? `已提取 ${count} 条规则到${targetName}`
          : `Extracted ${count} rule(s) to ${targetName}`;
      }
      return locale === "zh"
        ? `${targetName}没有新增规则`
        : `No new ${targetName} were added`;
    },
    [locale],
  );

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await redouApi.getChatProjects();
      setProjects(data.projects);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void loadProjects();
    });
    return () => {
      cancelled = true;
    };
  }, [loadProjects]);

  useEffect(() => {
    let refreshTimer: number | null = null;
    const refreshSoon = (delay = 0) => {
      if (refreshTimer !== null) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void loadProjects();
      }, delay);
    };
    const onProjectsChanged = () => refreshSoon();
    const unsubscribeAgent = redouApi.onAgentEvent((payload) => {
      const event = payload.event;
      if (event.type === "raw_log") {
        if (String(event.content || "").includes("Hermes local runtime started")) {
          refreshSoon(75);
        }
        return;
      }
      if (event.type === "queue_update") {
        refreshSoon(75);
        return;
      }
      if (event.type === "done" || event.type === "error") {
        refreshSoon(150);
        return;
      }
      if (event.type !== "assistant_delta") {
        refreshSoon(100);
      }
    });

    window.addEventListener(CHAT_PROJECTS_CHANGED_EVENT, onProjectsChanged);
    return () => {
      unsubscribeAgent();
      window.removeEventListener(CHAT_PROJECTS_CHANGED_EVENT, onProjectsChanged);
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }
    };
  }, [loadProjects]);

  const pickDirectory = useCallback(async (setter: (path: string) => void) => {
    const picker = window.redouDesktop?.pickDirectory;
    if (!picker) {
      setError(copy.pickerMissing);
      return;
    }
    const picked = await picker();
    if (picked) setter(picked);
  }, [copy.pickerMissing]);

  const openWorkspaceFolder = useCallback(async (targetPath: string) => {
    const trimmedPath = targetPath.trim();
    if (!trimmedPath) {
      setError(copy.noWorkspace);
      return;
    }

    setError(null);
    try {
      const result = await redouApi.openLocalPath(trimmedPath);
      if (!result.ok) {
        throw new Error(result.message || `Could not open path: ${trimmedPath}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [copy.noWorkspace]);

  const closeRename = useCallback(() => {
    setRenameTarget(null);
    setRenameDraft("");
    setRenaming(false);
  }, []);

  const beginProjectRename = useCallback((project: ChatProject) => {
    setRenameTarget({ scope: "project", projectId: project.id });
    setRenameDraft(project.name);
    setError(null);
  }, []);

  const beginTaskRename = useCallback((project: ChatProject, task: ChatTask) => {
    setRenameTarget({ scope: "task", projectId: project.id, taskId: task.id });
    setRenameDraft(task.title);
    setError(null);
  }, []);

  const saveRename = useCallback(async () => {
    if (!renameTarget || renaming) return;
    const nextName = renameDraft.trim();
    if (!nextName) {
      closeRename();
      return;
    }

    setRenaming(true);
    setError(null);
    try {
      if (renameTarget.scope === "project") {
        const currentProject = projects.find((project) => project.id === renameTarget.projectId);
        if (!currentProject || currentProject.name === nextName) {
          closeRename();
          return;
        }
        const result = await redouApi.updateChatProject(renameTarget.projectId, {
          name: nextName,
        });
        setProjects((prev) =>
          prev.map((project) =>
            project.id === result.project.id ? result.project : project,
          ),
        );
      } else {
        const currentProject = projects.find((project) => project.id === renameTarget.projectId);
        const currentTask = currentProject?.tasks.find((task) => task.id === renameTarget.taskId);
        if (!currentTask || currentTask.title === nextName) {
          closeRename();
          return;
        }
        const result = await redouApi.updateChatTask(renameTarget.projectId, renameTarget.taskId, {
          title: nextName,
        });
        setProjects((prev) =>
          prev.map((project) =>
            project.id === result.project.id ? result.project : project,
          ),
        );
      }
      notifyChatProjectsChanged();
      closeRename();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRenaming(false);
    }
  }, [closeRename, projects, renameDraft, renameTarget, renaming]);

  const renameInputKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRename();
      }
    },
    [closeRename],
  );

  const createProject = useCallback(async () => {
    const result = await redouApi.createChatProject({
      name: projectName.trim() || copy.newProject,
      workspace_path: workspacePath.trim() || null,
    });
    setProjects((prev) => [result.project, ...prev]);
    notifyChatProjectsChanged();
    const task = result.project.tasks[0];
    selectPanelItem(result.project, task ?? null);
    setProjectFormOpen(false);
    setProjectName("");
    setWorkspacePath("");
  }, [copy.newProject, projectName, selectPanelItem, workspacePath]);

  const createTask = useCallback(async () => {
    if (!selectedProject) return;
    const inheritedModelProvider = selectedTask?.model_provider?.trim() ?? "";
    const inheritedModel = selectedTask?.model?.trim() ?? "";
    const result = await redouApi.createChatTask(selectedProject.id, {
      title: taskTitle.trim() || copy.newTask,
      ...(inheritedModelProvider || inheritedModel
        ? {
            model_provider: inheritedModelProvider || null,
            model: inheritedModel || null,
          }
        : {}),
    });
    setProjects((prev) =>
      prev.map((project) =>
        project.id === result.project.id ? result.project : project,
      ),
    );
    notifyChatProjectsChanged();
    selectPanelItem(result.project, result.task);
    setTaskTitle("");
  }, [copy.newTask, selectedProject, selectedTask, selectPanelItem, taskTitle]);

  const selectProject = useCallback(
    (project: ChatProject) => {
      const task =
        project.tasks.find((item) => item.id === selectedTaskId) ??
        project.tasks[0] ??
        null;
      selectPanelItem(project, task);
    },
    [selectPanelItem, selectedTaskId],
  );

  const selectFirstAvailable = useCallback(
    (
      nextProjects: ChatProject[],
      currentProjectId?: string | null,
      currentTaskId?: string | null,
    ) => {
      const nextProject =
        nextProjects.find((project) => project.id === currentProjectId) ??
        nextProjects[0] ??
        null;
      const nextTask =
        nextProject?.tasks.find((task) => task.id === currentTaskId) ??
        nextProject?.tasks[0] ??
        null;
      if (nextProject && nextTask) {
        selectPanelItem(nextProject, nextTask);
        return;
      }
      if (nextProject) {
        selectPanelItem(nextProject, null);
        return;
      }
      onClearSelection?.();
    },
    [onClearSelection, selectPanelItem],
  );

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setError(null);
    try {
      if (deleteTarget.scope === "project") {
        const deletingSelectedProject = deleteTarget.project.id === selectedProjectId;
        const result = await redouApi.deleteChatProject(deleteTarget.project.id);
        setProjects(result.projects);
        notifyChatProjectsChanged();
        if (deletingSelectedProject) {
          selectFirstAvailable(
            result.projects,
            result.current_project_id,
            result.current_task_id,
          );
        }
      } else {
        const deletingSelectedTask =
          deleteTarget.project.id === selectedProjectId &&
          deleteTarget.task.id === selectedTaskId;
        const result = await redouApi.deleteChatTask(
          deleteTarget.project.id,
          deleteTarget.task.id,
        );
        setProjects((prev) =>
          prev.map((project) =>
            project.id === result.project.id ? result.project : project,
          ),
        );
        notifyChatProjectsChanged();
        if (deletingSelectedTask) {
          selectFirstAvailable(
            [result.project],
            result.project.id,
            result.current_task_id || result.next_task?.id,
          );
        }
      }
      setDeleteTarget(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }, [
    deleteTarget,
    selectFirstAvailable,
    selectedProjectId,
    selectedTaskId,
  ]);

  const openContextEditor = useCallback((target: ContextEditorTarget) => {
    setEditor({
      content: "",
      error: null,
      loading: true,
      path: "",
      saving: false,
      target,
    });

    const request =
      target.scope === "project"
        ? redouApi.getProjectContextFile(target.projectId, target.kind)
        : redouApi.getTaskContextFile(target.projectId, target.taskId, target.kind);

    request
      .then((result) => {
        setEditor((current) =>
          current.target === target
            ? {
                ...current,
                content: result.content,
                loading: false,
                path: result.path,
              }
            : current,
        );
      })
      .catch((e) => {
        setEditor((current) =>
          current.target === target
            ? {
                ...current,
                error: e instanceof Error ? e.message : String(e),
                loading: false,
              }
            : current,
        );
      });
  }, []);

  const closeContextEditor = useCallback(() => {
    setEditor((current) => ({ ...current, target: null }));
  }, []);

  const saveContextEditor = useCallback(() => {
    const target = editor.target;
    if (!target) return;

    setEditor((current) => ({ ...current, error: null, saving: true }));
    const request =
      target.scope === "project"
        ? redouApi.updateProjectContextFile(target.projectId, target.kind, editor.content)
        : redouApi.updateTaskContextFile(
            target.projectId,
            target.taskId,
            target.kind,
            editor.content,
          );

    request
      .then((result) => {
        setEditor((current) => ({
          ...current,
          content: result.content,
          path: result.path,
          saving: false,
          target: null,
        }));
      })
      .catch((e) => {
        setEditor((current) => ({
          ...current,
          error: e instanceof Error ? e.message : String(e),
          saving: false,
        }));
      });
  }, [editor.content, editor.target]);

  const packageTaskAsSkill = useCallback(
    async (project: ChatProject, task: ChatTask) => {
      const taskKey = `${project.id}:${task.id}`;
      setPackagingTaskKey(taskKey);
      setError(null);
      setActionNotice(null);
      try {
        const result = await redouApi.packageTaskSkill(project.id, task.id);
        setProjects((prev) =>
          prev.map((item) =>
            item.id === result.project.id ? result.project : item,
          ),
        );
        notifyChatProjectsChanged();
        setActionNotice(packageSkillDone(result.skillName));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setPackagingTaskKey((current) => (current === taskKey ? null : current));
      }
    },
    [packageSkillDone],
  );

  const extractRulesFromTaskContext = useCallback(
    async (project: ChatProject, task: ChatTask, target: "task" | "project") => {
      const ruleKey = `${target}:${project.id}:${task.id}`;
      setExtractingRuleKey(ruleKey);
      setError(null);
      setActionNotice(null);
      try {
        const result = await redouApi.extractTaskRules(project.id, task.id, target);
        setProjects((prev) =>
          prev.map((item) =>
            item.id === result.project.id ? result.project : item,
          ),
        );
        notifyChatProjectsChanged();
        setActionNotice(extractRulesDone(target, result.rulesAdded.length));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setExtractingRuleKey((current) => (current === ruleKey ? null : current));
      }
    },
    [extractRulesDone],
  );

  const deleteTitle =
    deleteTarget?.scope === "project"
      ? copy.deleteProjectTitle
      : copy.deleteTaskTitle;
  const deleteDescription =
    deleteTarget?.scope === "project"
      ? copy.deleteProjectDescription(deleteTarget.project.name)
      : deleteTarget
        ? copy.deleteTaskDescription(deleteTarget.task.title)
        : "";

  return (
    <>
    <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border border-border bg-background-base/70 py-3 text-midground shadow-[0_18px_48px_rgba(0,0,0,0.28)] normal-case">
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 pb-2">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {copy.projects}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-card/60 hover:text-midground"
            title={copy.refresh}
            aria-label={copy.refresh}
            onClick={() => void loadProjects()}
            disabled={loading}
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>
          <button
            type="button"
            className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-card/60 hover:text-midground"
            title={copy.newProject}
            aria-label={copy.newProject}
            onClick={() => setProjectFormOpen((value) => !value)}
          >
            <FolderPlus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-3 mb-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {actionNotice && (
        <div className="mx-3 mb-2 rounded-md border border-success/40 bg-success/5 px-3 py-2 text-xs text-success">
          {actionNotice}
        </div>
      )}

      {projectFormOpen && (
        <div className="mx-3 mb-3 space-y-2 rounded-lg border border-border bg-card/50 p-2 shadow-sm">
          <Input
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            placeholder={copy.projectName}
            className={inputClass()}
          />
          <div className="flex min-w-0 gap-1.5">
            <Input
              value={workspacePath}
              onChange={(event) => setWorkspacePath(event.target.value)}
              placeholder={copy.workspacePath}
              className={inputClass("min-w-0")}
            />
            <Button
              size="sm"
              outlined
              className="h-8 shrink-0 border-border bg-card/40 px-2 text-midground"
              onClick={() => void pickDirectory(setWorkspacePath)}
            >
              {copy.browse}
            </Button>
          </div>
          <Button
            size="sm"
            prefix={<Plus />}
            className="h-8 bg-midground text-background-base"
            onClick={() => void createProject()}
          >
            {copy.create}
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-3">
        <div className="space-y-1">
          {projects.map((project) => {
            const activeProject = project.id === selectedProject?.id;
            const editingProject =
              renameTarget?.scope === "project" && renameTarget.projectId === project.id;
            const tasks = project.tasks;
            const selectedTaskForProject = activeProject ? selectedTask : null;
            const selectedTaskKey = selectedTaskForProject
              ? `${project.id}:${selectedTaskForProject.id}`
              : "";
            const extractingProjectRules = selectedTaskForProject
              ? extractingRuleKey === `project:${selectedTaskKey}`
              : false;
            const packagingSelectedTask = selectedTaskForProject
              ? packagingTaskKey === selectedTaskKey
              : false;

            return (
              <div key={project.id} className="min-w-0">
                <div
                  className={cn(
                    "group flex h-10 w-full min-w-0 items-center gap-1 rounded-md px-2 transition-colors",
                    activeProject
                      ? "bg-card/45 text-midground"
                      : "text-muted-foreground hover:bg-card/60 hover:text-midground",
                  )}
                >
                  {editingProject ? (
                    <form
                      className="flex min-w-0 flex-1 items-center gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void saveRename();
                      }}
                    >
                      <Folder className="h-5 w-5 shrink-0" />
                      <input
                        autoFocus
                        value={renameDraft}
                        onChange={(event) => setRenameDraft(event.target.value)}
                        onFocus={(event) => event.currentTarget.select()}
                        onKeyDown={renameInputKeyDown}
                        disabled={renaming}
                        className="h-7 min-w-0 flex-1 rounded border border-border/70 bg-background/55 px-2 text-sm font-medium text-midground outline-none focus-visible:border-foreground/25 focus-visible:ring-1 focus-visible:ring-foreground/30 disabled:opacity-60"
                      />
                      <button
                        type="submit"
                        className="grid h-7 w-7 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-success/10 hover:text-success disabled:opacity-50"
                        title={copy.save}
                        aria-label={copy.save}
                        disabled={renaming}
                      >
                        <Save className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="grid h-7 w-7 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-card/70 hover:text-midground disabled:opacity-50"
                        title={copy.cancel}
                        aria-label={copy.cancel}
                        onClick={closeRename}
                        disabled={renaming}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => selectProject(project)}
                        onDoubleClick={() => beginProjectRename(project)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <Folder className="h-5 w-5 shrink-0" />
                        <span className="truncate text-sm font-medium">{project.name}</span>
                      </button>
                      <button
                        type="button"
                        className="grid h-7 w-7 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-card/70 hover:text-midground"
                        title={copy.projectName}
                        aria-label={`${copy.projectName}: ${project.name}`}
                        onClick={() => beginProjectRename(project)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="grid h-7 w-7 shrink-0 place-items-center rounded text-muted-foreground/80 transition-colors hover:bg-destructive/10 hover:text-destructive"
                        title={copy.deleteProject}
                        aria-label={`${copy.deleteProject}: ${project.name}`}
                        onClick={() => setDeleteTarget({ scope: "project", project })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>

                {activeProject && (
                  <div className="pb-3">
                    <div className="mx-2 mt-1 flex min-w-0 items-center gap-2 rounded-md border border-border/60 bg-background/25 px-2 py-1.5 text-xs text-muted-foreground">
                      <HardDrive className="h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate" title={project.workspace_path}>
                        {project.workspace_path
                          ? compactPath(project.workspace_path)
                          : copy.noWorkspace}
                      </span>
                      <button
                        type="button"
                        className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-card/60 hover:text-midground disabled:cursor-not-allowed disabled:opacity-45"
                        title={project.workspace_path ? openWorkspaceFolderLabel : copy.noWorkspace}
                        aria-label={
                          project.workspace_path ? openWorkspaceFolderLabel : copy.noWorkspace
                        }
                        onClick={() => void openWorkspaceFolder(project.workspace_path)}
                        disabled={!project.workspace_path}
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="mx-2 my-1 space-y-1">
                      <button
                        type="button"
                        className="inline-flex h-8 w-full min-w-0 items-center justify-center gap-1.5 rounded-md border border-border/60 bg-background/25 px-2 text-xs text-muted-foreground transition-colors hover:bg-card/60 hover:text-midground"
                        title="PROJECT_RULES.md"
                        onClick={() =>
                          openContextEditor({
                            scope: "project",
                            projectId: project.id,
                            kind: "rules",
                            title: "PROJECT_RULES.md",
                          })
                        }
                      >
                        <BookOpenText className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{copy.projectRules}</span>
                      </button>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          className="inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md border border-border/60 bg-background/25 px-2 text-xs text-muted-foreground transition-colors hover:bg-card/60 hover:text-midground disabled:cursor-not-allowed disabled:opacity-50"
                          title={extractingProjectRules ? extractRulesBusyLabel : extractProjectRulesLabel}
                          aria-label={selectedTaskForProject ? `${extractProjectRulesLabel}: ${selectedTaskForProject.title}` : extractProjectRulesLabel}
                          onClick={() =>
                            selectedTaskForProject &&
                            void extractRulesFromTaskContext(project, selectedTaskForProject, "project")
                          }
                          disabled={!selectedTaskForProject || extractingProjectRules}
                        >
                          {extractingProjectRules ? (
                            <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" />
                          ) : (
                            <ListPlus className="h-3.5 w-3.5 shrink-0" />
                          )}
                          <span className="truncate">{extractRulesLabel}</span>
                        </button>
                        <button
                          type="button"
                          className="inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md border border-border/60 bg-background/25 px-2 text-xs text-muted-foreground transition-colors hover:bg-success/10 hover:text-success disabled:cursor-not-allowed disabled:opacity-50"
                          title={packagingSelectedTask ? packageSkillBusyLabel : packageSkillLabel}
                          aria-label={selectedTaskForProject ? `${packageSkillLabel}: ${selectedTaskForProject.title}` : packageSkillLabel}
                          onClick={() =>
                            selectedTaskForProject &&
                            void packageTaskAsSkill(project, selectedTaskForProject)
                          }
                          disabled={!selectedTaskForProject || packagingSelectedTask}
                        >
                          {packagingSelectedTask ? (
                            <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" />
                          ) : (
                            <PackagePlus className="h-3.5 w-3.5 shrink-0" />
                          )}
                          <span className="truncate">{packageSkillLabel}</span>
                        </button>
                      </div>
                    </div>

                    <form
                      className="mx-2 mb-1 flex items-center gap-1.5 rounded-md border border-border/60 bg-background/30 px-2 py-1"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void createTask();
                      }}
                    >
                      <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <input
                        value={taskTitle}
                        onChange={(event) => setTaskTitle(event.target.value)}
                        placeholder={copy.newTask}
                        className="h-7 min-w-0 flex-1 bg-transparent text-sm text-midground outline-none placeholder:text-muted-foreground"
                      />
                      <button
                        type="submit"
                        className="rounded px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-card/60 hover:text-midground"
                      >
                        {copy.add}
                      </button>
                    </form>

                    <div className="space-y-0.5">
                      {tasks.map((task) => {
                        const activeTask = task.id === selectedTask?.id;
                        const taskKey = `${project.id}:${task.id}`;
                        const extractingTaskRules = extractingRuleKey === `task:${taskKey}`;
                        const editingTask =
                          renameTarget?.scope === "task" &&
                          renameTarget.projectId === project.id &&
                          renameTarget.taskId === task.id;
                        return (
                          <div
                            key={task.id}
                            className={cn(
                              "group flex min-h-9 w-full min-w-0 items-center gap-1 rounded-md px-2 py-1.5 transition-colors",
                              activeTask
                                ? "border border-success/35 bg-success/[0.07] text-midground"
                                : "text-midground/75 hover:bg-card/55 hover:text-midground",
                            )}
                          >
                            {editingTask ? (
                              <form
                                className="flex min-w-0 flex-1 items-center gap-2"
                                onSubmit={(event) => {
                                  event.preventDefault();
                                  void saveRename();
                                }}
                              >
                                <TaskTreeStatusGlyph task={task} />
                                <input
                                  autoFocus
                                  value={renameDraft}
                                  onChange={(event) => setRenameDraft(event.target.value)}
                                  onFocus={(event) => event.currentTarget.select()}
                                  onKeyDown={renameInputKeyDown}
                                  disabled={renaming}
                                  className="h-7 min-w-0 flex-1 rounded border border-border/70 bg-background/55 px-2 text-sm text-midground outline-none focus-visible:border-foreground/25 focus-visible:ring-1 focus-visible:ring-foreground/30 disabled:opacity-60"
                                />
                                <button
                                  type="submit"
                                  className="grid h-7 w-7 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-success/10 hover:text-success disabled:opacity-50"
                                  title={copy.save}
                                  aria-label={copy.save}
                                  disabled={renaming}
                                >
                                  <Save className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  className="grid h-7 w-7 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-card/70 hover:text-midground disabled:opacity-50"
                                  title={copy.cancel}
                                  aria-label={copy.cancel}
                                  onClick={closeRename}
                                  disabled={renaming}
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </form>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => selectPanelItem(project, task)}
                                  onDoubleClick={() => beginTaskRename(project, task)}
                                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                >
                                  <TaskTreeStatusGlyph task={task} />
                                  <span className="min-w-0 flex-1 truncate text-[0.95rem]">
                                    {task.title}
                                  </span>
                                  <span className="shrink-0 text-xs text-muted-foreground">
                                    {relativeTime(task.updated_at, copy)}
                                  </span>
                                  {activeTask && (
                                    <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  className="grid h-7 w-7 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-card/70 hover:text-midground"
                                  title={copy.newTask}
                                  aria-label={`${copy.newTask}: ${task.title}`}
                                  onClick={() => beginTaskRename(project, task)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  className="grid h-7 w-7 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-card/70 hover:text-midground"
                                  title="TASK_RULES.md"
                                  aria-label="TASK_RULES.md"
                                  onClick={() =>
                                    openContextEditor({
                                      scope: "task",
                                      projectId: project.id,
                                      taskId: task.id,
                                      kind: "rules",
                                      title: "TASK_RULES.md",
                                    })
                                  }
                                >
                                  <BookOpenText className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  className="grid h-7 w-7 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-card/70 hover:text-midground"
                                  title="TASK_CONTEXT.md"
                                  aria-label="TASK_CONTEXT.md"
                                  onClick={() =>
                                    openContextEditor({
                                      scope: "task",
                                      projectId: project.id,
                                      taskId: task.id,
                                      kind: "context",
                                      title: "TASK_CONTEXT.md",
                                    })
                                  }
                                >
                                  <FileText className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  className="grid h-7 w-7 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-success/10 hover:text-success disabled:cursor-not-allowed disabled:opacity-50"
                                  title={extractingTaskRules ? extractRulesBusyLabel : extractTaskRulesLabel}
                                  aria-label={`${extractTaskRulesLabel}: ${task.title}`}
                                  onClick={() => void extractRulesFromTaskContext(project, task, "task")}
                                  disabled={extractingTaskRules}
                                >
                                  {extractingTaskRules ? (
                                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <ListPlus className="h-3.5 w-3.5" />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  className="grid h-7 w-7 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                                  title={copy.deleteTask}
                                  aria-label={`${copy.deleteTask}: ${task.title}`}
                                  onClick={() =>
                                    setDeleteTarget({ scope: "task", project, task })
                                  }
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
    <ContextFileEditorDialog
      editor={editor}
      onChange={(value) =>
        setEditor((current) => ({
          ...current,
          content: value,
        }))
      }
      onClose={closeContextEditor}
      onSave={saveContextEditor}
    />
    <DeleteConfirmDialog
      open={Boolean(deleteTarget)}
      loading={deleting}
      title={deleteTitle}
      description={deleteDescription}
      onCancel={() => {
        if (!deleting) setDeleteTarget(null);
      }}
      onConfirm={() => void confirmDelete()}
    />
    </>
  );
}
