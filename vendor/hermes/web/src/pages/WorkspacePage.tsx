import { Button } from "@nous-research/ui/ui/components/button";
import { Badge } from "@nous-research/ui/ui/components/badge";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Copy,
  Eye,
  FileCode2,
  FileText,
  FolderOpen,
  GitBranch,
  ListChecks,
  PackageCheck,
  RefreshCw,
  Search,
  Terminal,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { usePageHeader } from "@/contexts/usePageHeader";
import { useI18n } from "@/i18n";
import { Input } from "@/components/ui/input";
import { redouApi } from "@/lib/api";
import type {
  AnalyticsResponse,
  ChatProject,
  ChatTask,
  ChatTaskMessage,
  SessionInfo,
} from "@/lib/api";
import { formatTokenCount } from "@/lib/format";
import { cn } from "@/lib/utils";

const COPY = {
  zh: {
    pageTitle: "Redou 控制台",
    refresh: "刷新",
    refreshConsole: "刷新控制台",
    sections: {
      runOverview: "运行概览",
      taskOverview: "任务总览",
      taskDetail: "任务详情",
      needsAttention: "需要处理",
      artifacts: "交付物",
      changePreview: "变更预览",
      diagnostics: "诊断日志",
    },
    metrics: {
      active: "活跃任务数",
      queued: "排队任务数",
      needsAttention: "需处理任务数",
      failed: "失败任务数",
      completed: "已完成任务数",
      todayTokens: "今日 tokens",
      todayTools: "今日工具调用次数",
    },
    currentTask: "当前任务",
    enterTask: "进入任务",
    selectTaskPrompt: "请在任务总览中选择一个任务",
    selectDetailPrompt: "请选择一个任务查看详情",
    noNeedsAttention: "暂无需要处理的事项",
    noArtifacts: "暂无交付物",
    noChanges: "暂无变更记录",
    noDiagnostics: "暂无诊断日志",
    searchPlaceholder: "搜索任务、状态、动作或模型",
    visibleTasks: "可见任务",
    allTasks: "全部任务",
    selected: "已选中",
    openFullChanges: "查看完整变更",
    expandRawLogs: "展开原始日志",
    loadingTask: "正在读取任务事件...",
    enterFailed: "无法进入任务",
    copyPath: "复制路径",
    copiedPath: "路径已复制",
    open: "打开",
    locate: "定位",
    viewLog: "查看日志",
    retry: "重试",
    ignore: "忽略",
    unavailable: "未记录",
    noCommand: "—",
    waitingStart: "等待开始",
    inferred: "推断",
    model: "模型",
    tools: "工具",
    time: "时间",
    stages: "阶段",
    taskList: "任务清单",
    status: "状态",
    stage: "阶段",
    currentTool: "当前工具",
    currentAction: "当前动作",
    currentCommand: "当前命令",
    provider: "Provider",
    modelName: "Model",
    llmCalls: "LLM 调用",
    toolCalls: "工具调用",
    tokens: "Tokens",
    duration: "运行",
    totalDuration: "总耗时",
    recentEvent: "最近事件",
    recentResult: "最近结果",
    artifactCount: "产物数量",
    completedAt: "完成时间",
    createdAt: "创建时间",
    queuePosition: "排队位置",
    entryHint: "预计执行入口",
    blockingReason: "阻塞原因",
    waitingConfirmation: "等待确认内容",
    errorSummary: "错误摘要",
    failedStage: "失败阶段",
    testSummary: "测试结果摘要",
    recentArtifacts: "最近产物",
    severity: "严重程度",
    recentTime: "最近时间",
    noRecentArtifacts: "暂无最近产物",
    noTestSummary: "未记录测试结果",
    analysisProjectName: "模型评测",
    analysisTaskTitlePrefix: "模型评测",
    analysisTasks: {
      task1: "Docker 环境实验",
      task2: "小型项目构建",
      task3: "调试修复循环",
      task4: "调研与产品方案",
      task5: "Peewee ORM 工业缺陷修复",
      task6: "Bottle 插件扩展",
      task7: "Markdown 解析器实现",
      task8: "Click CLI 框架缺陷修复",
      task9: "Jinja2 自定义扩展开发",
    },
    changes: {
      recent: "最近变更",
      added: "新增",
      modified: "修改",
      deleted: "删除",
      important: "重要变更摘要",
    },
    statuses: {
      not_started: "未开始",
      queued: "排队中",
      running: "运行中",
      needs_attention: "需处理",
      failed: "失败",
      completed: "已完成",
      cancelled: "已中断",
      paused: "暂停",
    },
    stageLabels: {
      analysis: "分析项目",
      editing: "修改代码",
      testing: "测试验证",
      packaging: "打包输出",
      finalizing: "整理结果",
    },
    stageStates: {
      completed: "✓",
      running: "→",
      pending: "○",
      failed: "×",
    },
    artifactTypes: {
      modifiedFile: "修改文件",
      document: "文档",
      skill: "Skill",
      testReport: "测试报告",
      archive: "导出包",
      runReport: "运行报告",
      pathReport: "路径契约报告",
      smokeReport: "冒烟测试报告",
      file: "文件",
    },
    severityLevels: {
      high: "高",
      medium: "中",
      low: "低",
    },
  },
  en: {
    pageTitle: "Redou Console",
    refresh: "Refresh",
    refreshConsole: "Refresh console",
    sections: {
      runOverview: "Run Overview",
      taskOverview: "Task Overview",
      taskDetail: "Task Detail",
      needsAttention: "Needs Attention",
      artifacts: "Artifacts",
      changePreview: "Change Preview",
      diagnostics: "Diagnostic Logs",
    },
    metrics: {
      active: "Active tasks",
      queued: "Queued tasks",
      needsAttention: "Needs attention",
      failed: "Failed tasks",
      completed: "Completed tasks",
      todayTokens: "Today tokens",
      todayTools: "Today tool calls",
    },
    currentTask: "Current task",
    enterTask: "进入任务",
    selectTaskPrompt: "Select a task in Task Overview",
    selectDetailPrompt: "Select a task to view details",
    noNeedsAttention: "No items need attention",
    noArtifacts: "No artifacts yet",
    noChanges: "No changes yet",
    noDiagnostics: "No diagnostic logs yet",
    searchPlaceholder: "Search tasks, status, action, or model",
    visibleTasks: "visible tasks",
    allTasks: "all tasks",
    selected: "selected",
    openFullChanges: "View full changes",
    expandRawLogs: "Expand raw logs",
    loadingTask: "Loading task events...",
    enterFailed: "Could not enter task",
    copyPath: "Copy path",
    copiedPath: "Path copied",
    open: "Open",
    locate: "Locate",
    viewLog: "View log",
    retry: "Retry",
    ignore: "Ignore",
    unavailable: "Not recorded",
    noCommand: "—",
    waitingStart: "Waiting to start",
    inferred: "inferred",
    model: "Model",
    tools: "Tools",
    time: "Time",
    stages: "Stages",
    taskList: "Task List",
    status: "Status",
    stage: "Stage",
    currentTool: "Current tool",
    currentAction: "Current action",
    currentCommand: "Current command",
    provider: "Provider",
    modelName: "Model",
    llmCalls: "LLM calls",
    toolCalls: "Tool calls",
    tokens: "Tokens",
    duration: "Running",
    totalDuration: "Total duration",
    recentEvent: "Recent event",
    recentResult: "Recent result",
    artifactCount: "Artifacts",
    completedAt: "Completed at",
    createdAt: "Created at",
    queuePosition: "Queue position",
    entryHint: "Execution entry",
    blockingReason: "Blocking reason",
    waitingConfirmation: "Waiting confirmation",
    errorSummary: "Error summary",
    failedStage: "Failed stage",
    testSummary: "Test summary",
    recentArtifacts: "Recent artifacts",
    severity: "Severity",
    recentTime: "Recent time",
    noRecentArtifacts: "No recent artifacts",
    noTestSummary: "No test summary recorded",
    analysisProjectName: "Model Benchmarks",
    analysisTaskTitlePrefix: "Model benchmark",
    analysisTasks: {
      task1: "Docker environment lab",
      task2: "Small project build",
      task3: "Debug and repair loop",
      task4: "Research and product plan",
      task5: "Peewee ORM industrial bug fixing",
      task6: "Bottle plugin extension",
      task7: "Markdown parser implementation",
      task8: "Click CLI framework bug fixing",
      task9: "Jinja2 custom extension development",
    },
    changes: {
      recent: "Recent changes",
      added: "Added",
      modified: "Modified",
      deleted: "Deleted",
      important: "Important changes",
    },
    statuses: {
      not_started: "Not Started",
      queued: "Queued",
      running: "Running",
      needs_attention: "Needs Attention",
      failed: "Failed",
      completed: "Completed",
      cancelled: "Interrupted",
      paused: "Paused",
    },
    stageLabels: {
      analysis: "Analyze Project",
      editing: "Edit Code",
      testing: "Test Verification",
      packaging: "Package Output",
      finalizing: "Finalize Result",
    },
    stageStates: {
      completed: "✓",
      running: "→",
      pending: "○",
      failed: "×",
    },
    artifactTypes: {
      modifiedFile: "Modified file",
      document: "Document",
      skill: "Skill",
      testReport: "Test report",
      archive: "Archive",
      runReport: "Run report",
      pathReport: "Path contract report",
      smokeReport: "Smoke report",
      file: "File",
    },
    severityLevels: {
      high: "High",
      medium: "Medium",
      low: "Low",
    },
  },
} as const;

type WorkspaceCopy = (typeof COPY)[keyof typeof COPY];
type Tone = "default" | "success" | "warning" | "danger";
type NormalizedTaskStatus =
  | "not_started"
  | "queued"
  | "running"
  | "needs_attention"
  | "failed"
  | "completed"
  | "cancelled"
  | "paused";
type StageKey = "analysis" | "editing" | "testing" | "packaging" | "finalizing";
type StageEventStatus = "completed" | "running" | "pending" | "failed";
type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";
type ArtifactType =
  | "modifiedFile"
  | "document"
  | "skill"
  | "testReport"
  | "archive"
  | "runReport"
  | "pathReport"
  | "smokeReport"
  | "file";

type LoadState = {
  analytics: AnalyticsResponse | null;
  currentProjectId: string;
  currentTaskId: string;
  error: string | null;
  loading: boolean;
  projects: ChatProject[];
  sessions: SessionInfo[];
};

type SelectedTaskMessageSource = {
  key: string;
  projectId: string;
  taskId: string;
  version: number;
};

type TaskEventView = {
  command: string;
  id: string;
  label: string;
  raw: Record<string, unknown> | null;
  summary: string;
  timestampMs: number;
  tool: string;
  type: string;
  success?: boolean;
};

type StageTimelineItem = {
  key: StageKey;
  label: string;
  status: StageEventStatus;
  timestampMs?: number;
};

type TodoItem = {
  id: string;
  content: string;
  status: TodoStatus;
};

type TodoUpdate = {
  items: TodoItem[];
  merge: boolean;
};

type ArtifactView = {
  changeType: "added" | "modified" | "deleted" | "unknown";
  generatedAtMs: number;
  id: string;
  name: string;
  path: string;
  taskId: string;
  taskTitle: string;
  type: ArtifactType;
};

type TaskViewModel = {
  artifactCount: number;
  artifacts: ArtifactView[];
  completedAt: number | null;
  createdAt: number;
  currentAction: string;
  currentCommand: string;
  currentStage: string;
  currentTool: string;
  durationMs: number;
  id: string;
  inferredStage: boolean;
  key: string;
  lastError: string;
  llmCalls: number;
  model: string;
  needsAttentionReason: string;
  priorityRank: number;
  projectId: string;
  projectName: string;
  provider: string;
  queueDepth: number;
  recentEvents: TaskEventView[];
  recentResult: string;
  stageTimeline: StageTimelineItem[];
  status: NormalizedTaskStatus;
  statusLabel: string;
  testSummary: string;
  title: string;
  todoItems: TodoItem[];
  tokens: number;
  toolCalls: number;
  updatedAt: number;
};

const ATTENTION_RE =
  /confirm|confirmation|permission|overwrite|blocked|waiting|needs_attention|approval|api key|provider|model config|path|skill conflict|test failed|failed|failure|error|确认|权限|覆盖|阻塞|等待|路径|冲突|测试失败|失败|错误|异常/i;
const ERROR_RE = /error|failed|failure|exception|traceback|timeout|退出|失败|错误|异常|超时/i;
const TEST_RE = /\b(pytest|node --test|npm test|pnpm test|yarn test|tests? passed|tests? failed|52 tests passed)\b|测试|验证/i;

function taskKey(projectId: string, taskId: string): string {
  return `${projectId}:${taskId}`;
}

function isAnalysisBenchmarkTask(project: ChatProject, task: ChatTask): boolean {
  return (
    project.id === "model-benchmarks" ||
    task.kind === "analysis_benchmark" ||
    Boolean(task.analysisRunId || task.analysisKey)
  );
}

function analysisTaskId(value: unknown): string {
  const match = String(value || "").match(/\btask[1-9]\b/i);
  return match ? match[0].toLowerCase() : "";
}

function analysisTaskLabel(value: unknown, copy: WorkspaceCopy): string {
  const id = analysisTaskId(value);
  const title = id ? copy.analysisTasks[id as keyof typeof copy.analysisTasks] : "";
  if (id && title) {
    return `${id}${copy === COPY.zh ? "：" : ": "}${title}`;
  }
  return cleanText(value, copy.waitingStart, 160);
}

function analysisStageEventLabel(event: TaskEventView, copy: WorkspaceCopy): string {
  const rawMetadata = isRecord(event.raw?.metadata) ? event.raw.metadata : {};
  const stage = cleanText(
    event.raw?.stage ?? rawMetadata.analysisTaskId ?? event.summary,
    "",
    120,
  );
  return analysisTaskLabel(stage || event.summary, copy);
}

function displayProjectName(project: ChatProject, task: ChatTask, copy: WorkspaceCopy): string {
  return isAnalysisBenchmarkTask(project, task) ? copy.analysisProjectName : project.name;
}

function displayTaskTitle(
  project: ChatProject,
  task: ChatTask,
  providerModel: { provider: string; model: string },
  copy: WorkspaceCopy,
): string {
  const rawTitle = cleanText(task.title, "", 220);
  if (!isAnalysisBenchmarkTask(project, task)) return rawTitle || "Task";
  if (rawTitle && !/^benchmark:/i.test(rawTitle)) return rawTitle;
  const modelLabel = [providerModel.provider, providerModel.model]
    .filter((item) => item && item !== copy.unavailable)
    .join(" / ");
  return `${copy.analysisTaskTitlePrefix}: ${modelLabel || copy.unavailable}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJsonish(value: unknown): unknown {
  let current = value;
  for (let index = 0; index < 2; index += 1) {
    if (typeof current !== "string") return current;
    const trimmed = current.trim();
    if (!trimmed) return current;
    try {
      current = JSON.parse(trimmed) as unknown;
    } catch {
      return current;
    }
  }
  return current;
}

function normalizeTodoStatus(value: unknown): TodoStatus {
  const status = String(value || "pending").trim().toLowerCase();
  if (status === "completed" || status === "in_progress" || status === "cancelled") return status;
  return "pending";
}

function todoItemsFromPayload(value: unknown): TodoItem[] {
  const payload = parseJsonish(value);
  const rawTodos = isRecord(payload) ? payload.todos : Array.isArray(payload) ? payload : null;
  if (!Array.isArray(rawTodos)) return [];
  return rawTodos
    .map((item, index) => {
      if (!isRecord(item)) return null;
      const content = cleanText(item.content, "", 500);
      if (!content) return null;
      return {
        id: cleanText(item.id, String(index + 1), 80),
        content,
        status: normalizeTodoStatus(item.status),
      };
    })
    .filter((item): item is TodoItem => item !== null);
}

function todoUpdateFromPayload(value: unknown): TodoUpdate | null {
  const payload = parseJsonish(value);
  const items = todoItemsFromPayload(payload);
  if (!items.length) return null;
  return {
    items,
    merge: isRecord(payload) && payload.merge === true,
  };
}

function todoUpdatesFromRawLog(content: string): TodoUpdate[] {
  const updates: TodoUpdate[] = [];
  const marker = /^\[(tool_start|tool_output)\]\s+todo\b.*$/gm;
  while (marker.exec(content) !== null) {
    const start = marker.lastIndex;
    const rest = content.slice(start);
    const nextMarker = rest.search(/^\[[a-z_]+\]/m);
    const payload = rest.slice(0, nextMarker >= 0 ? nextMarker : undefined).trim();
    const update = todoUpdateFromPayload(payload);
    if (update) updates.push(update);
  }
  return updates;
}

function todoUpdatesFromMessage(message: ChatTaskMessage): TodoUpdate[] {
  const metadata = isRecord(message.metadata) ? message.metadata : {};
  const event = isRecord(metadata.event) ? metadata.event : null;
  const type = cleanText(metadata.eventType ?? event?.type, "", 80);
  const name = cleanText(event?.name, "", 80);
  if (type === "tool_start" && name === "todo") {
    const update = todoUpdateFromPayload(event?.input);
    return update ? [update] : [];
  }
  if (type === "tool_output" && name === "todo") {
    const update = todoUpdateFromPayload(event?.output);
    return update ? [update] : [];
  }
  if (type === "raw_log") {
    return todoUpdatesFromRawLog(String(event?.content ?? message.content ?? ""));
  }
  if (message.role === "event" && message.content) {
    return todoUpdatesFromRawLog(String(message.content));
  }
  return [];
}

function applyTodoUpdate(current: TodoItem[], update: TodoUpdate): TodoItem[] {
  if (!update.merge) return update.items;

  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of update.items) {
    byId.set(item.id, item);
  }
  const existingIds = new Set(current.map((item) => item.id));
  return [
    ...current.map((item) => byId.get(item.id) ?? item),
    ...update.items.filter((item) => !existingIds.has(item.id)),
  ];
}

function latestTodoItemsFromMessages(messages: ChatTaskMessage[]): TodoItem[] {
  let items: TodoItem[] = [];
  let hasTodo = false;
  for (const message of messages) {
    if (message.role === "user") {
      items = [];
      hasTodo = false;
      continue;
    }
    for (const update of todoUpdatesFromMessage(message)) {
      items = applyTodoUpdate(items, update);
      hasTodo = true;
    }
  }
  return hasTodo ? items : [];
}

function messageRunMode(message: ChatTaskMessage): "execute" | "plan" {
  const metadata = isRecord(message.metadata) ? message.metadata : {};
  const event = isRecord(metadata.event) ? metadata.event : null;
  const eventMetadata = event && isRecord(event.metadata) ? event.metadata : {};
  return metadata.runMode === "plan" || eventMetadata.runMode === "plan" ? "plan" : "execute";
}

function latestRunModeFromMessages(messages: ChatTaskMessage[]): "execute" | "plan" {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") return messageRunMode(message);
  }
  return "execute";
}

function cleanText(value: unknown, fallback = "", maxLength = 160): string {
  const text = String(value ?? "")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "sk-...redacted")
    .replace(/\s+/g, " ")
    .trim();
  const safe = text || fallback;
  if (safe.length <= maxLength) return safe;
  return `${safe.slice(0, maxLength - 1).trimEnd()}...`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "");
}

function numberOrZero(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function timestampMs(value: unknown, fallback = Date.now()): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function findSelectedTaskMessageSource(
  selectedTaskKey: string | null,
  projects: ChatProject[],
): SelectedTaskMessageSource | null {
  if (!selectedTaskKey) return null;
  for (const project of projects) {
    for (const task of project.tasks || []) {
      if (taskKey(project.id, task.id) === selectedTaskKey) {
        return {
          key: selectedTaskKey,
          projectId: project.id,
          taskId: task.id,
          version: timestampMs(
            task.updatedAt ?? task.updated_at ?? task.createdAt ?? task.created_at,
            0,
          ),
        };
      }
    }
  }
  return null;
}

function taskCreatedMs(task: ChatTask): number {
  return timestampMs(task.createdAt ?? task.created_at, Date.now());
}

function taskUpdatedMs(task: ChatTask): number {
  return timestampMs(task.updatedAt ?? task.updated_at, taskCreatedMs(task));
}

function formatDuration(ms: number, detailed = false): string {
  const safeMs = Math.max(0, Number.isFinite(ms) ? ms : 0);
  const totalSeconds = Math.floor(safeMs / 1000);
  const seconds = totalSeconds % 60;
  const minutesTotal = Math.floor(totalSeconds / 60);
  const minutes = minutesTotal % 60;
  const hours = Math.floor(minutesTotal / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutesTotal > 0) return detailed ? `${minutesTotal}m ${seconds}s` : `${minutesTotal}m`;
  return `${seconds}s`;
}

function formatRelativeTime(ms: number | null | undefined, locale: "zh" | "en"): string {
  if (!ms || !Number.isFinite(ms)) return locale === "zh" ? "未知" : "unknown";
  const deltaSeconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (locale === "zh") {
    if (deltaSeconds < 60) return "刚刚";
    if (deltaSeconds < 3600) return `${Math.floor(deltaSeconds / 60)} 分钟前`;
    if (deltaSeconds < 86400) return `${Math.floor(deltaSeconds / 3600)} 小时前`;
    if (deltaSeconds < 172800) return "昨天";
    return `${Math.floor(deltaSeconds / 86400)} 天前`;
  }
  if (deltaSeconds < 60) return "just now";
  if (deltaSeconds < 3600) return `${Math.floor(deltaSeconds / 60)}m ago`;
  if (deltaSeconds < 86400) return `${Math.floor(deltaSeconds / 3600)}h ago`;
  if (deltaSeconds < 172800) return "yesterday";
  return `${Math.floor(deltaSeconds / 86400)}d ago`;
}

function formatDateTime(ms: number | null, locale: "zh" | "en"): string {
  if (!ms || !Number.isFinite(ms)) return locale === "zh" ? "未记录" : "Not recorded";
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

function formatClock(ms: number, locale: "zh" | "en"): string {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

function isToday(ms: number): boolean {
  const date = new Date(ms);
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function statusLabel(status: NormalizedTaskStatus, copy: WorkspaceCopy): string {
  return copy.statuses[status];
}

function statusTone(status: NormalizedTaskStatus): Tone {
  if (status === "running" || status === "completed") return "success";
  if (status === "queued" || status === "paused" || status === "not_started") return "warning";
  if (status === "failed" || status === "needs_attention") return "danger";
  return "default";
}

function badgeTone(status: NormalizedTaskStatus): "outline" | "secondary" | "success" | "warning" | "destructive" {
  const tone = statusTone(status);
  if (tone === "success") return "success";
  if (tone === "warning") return "warning";
  if (tone === "danger") return "destructive";
  return "outline";
}

function statusSymbol(status: NormalizedTaskStatus): string {
  switch (status) {
    case "running":
      return "●";
    case "needs_attention":
      return "!";
    case "failed":
      return "×";
    case "completed":
      return "✓";
    case "queued":
      return "○";
    case "paused":
      return "Ⅱ";
    case "cancelled":
      return "–";
    case "not_started":
    default:
      return "○";
  }
}

function normalizeTaskStatus(
  rawStatus: unknown,
  hints: {
    hasCompleted?: boolean;
    hasError?: boolean;
    hasStarted?: boolean;
    needsAttention?: boolean;
    queueDepth?: number;
    running?: boolean;
  } = {},
): NormalizedTaskStatus {
  if (hints.running) return "running";
  if ((hints.queueDepth ?? 0) > 0) return "queued";

  const raw = String(rawStatus || "").trim().toLowerCase();
  if (["done", "completed", "success", "succeeded"].includes(raw)) return "completed";
  if (["failed", "error"].includes(raw)) return "failed";
  if (["cancelled", "canceled", "interrupted", "stopped"].includes(raw)) return "cancelled";
  if (["blocked", "waiting", "needs_attention", "confirmation_required"].includes(raw)) {
    return "needs_attention";
  }
  if (["running", "active"].includes(raw)) return "running";
  if (["queued", "pending"].includes(raw)) return "queued";
  if (raw === "paused") return "paused";

  if (hints.needsAttention) return "needs_attention";
  if (hints.hasError) return "failed";

  if (raw === "idle") {
    if (hints.hasCompleted) return "completed";
    if (!hints.hasStarted) return "not_started";
    return "not_started";
  }
  if (hints.hasCompleted) return "completed";
  return hints.hasStarted ? "not_started" : "not_started";
}

function overviewStatusForTask(task: ChatTask, session: SessionInfo | null): NormalizedTaskStatus {
  const rawStatus = String(task.runtime_status || "").trim().toLowerCase();
  const hasStarted =
    numberOrZero(session?.message_count) > 0 ||
    Boolean(task.hermesSessionId || task.session_id);
  return normalizeTaskStatus(rawStatus, {
    hasStarted,
    needsAttention: ["blocked", "waiting", "needs_attention", "confirmation_required"].includes(rawStatus),
    queueDepth: numberOrZero(task.queue_depth ?? session?.queue_depth),
    running: Boolean(task.is_active ?? session?.is_active),
  });
}

function truthyFailureText(value: unknown): string {
  if (value == null || value === false) return "";
  const text = typeof value === "string" ? value.trim() : JSON.stringify(value);
  return !text || text === "false" || text === "null" ? "" : text;
}

function doneEventSuccess(rawEvent: Record<string, unknown> | null): boolean {
  const metadata = rawEvent && isRecord(rawEvent.metadata) ? rawEvent.metadata : {};
  const exitCode = Number(metadata.exitCode);
  const turnExitReason = String(metadata.turnExitReason ?? metadata.turn_exit_reason ?? "").toLowerCase();
  if (
    metadata.cancelled ||
    metadata.canceled ||
    metadata.stopRequested ||
    metadata.interrupted ||
    metadata.replacedByRunId ||
    metadata.partial
  ) {
    return false;
  }
  if (
    metadata.failed === true ||
    truthyFailureText(metadata.error) ||
    truthyFailureText(metadata.failure) ||
    truthyFailureText(metadata.exception) ||
    (metadata.completed === false && /max_iterations|partial|stream|error|failed|failure|exception|invalid/.test(turnExitReason)) ||
    (Number.isFinite(exitCode) && exitCode !== 0)
  ) {
    return false;
  }
  return true;
}

function statusFromTerminalEvent(event: TaskEventView): NormalizedTaskStatus | null {
  if (event.type === "done") return doneEventSuccess(event.raw) ? "completed" : "cancelled";
  if (event.type === "error") {
    const rawMetadata = isRecord(event.raw?.metadata) ? event.raw.metadata : {};
    const text = `${event.summary} ${event.raw?.message ?? ""} ${rawMetadata.message ?? ""} ${rawMetadata.reason ?? ""}`;
    return /stopped|interrupted|cancelled|canceled|closing/i.test(text) ? "cancelled" : "failed";
  }
  return null;
}

function statusFromLatestTerminalEvent(events: TaskEventView[]): NormalizedTaskStatus | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].type === "done" && doneEventSuccess(events[index].raw)) {
      for (let previous = index - 1; previous >= 0; previous -= 1) {
        if (events[previous].type === "user") break;
        const text = `${events[previous].summary} ${events[previous].raw?.content ?? ""} ${events[previous].raw?.message ?? ""}`;
        if (/stream stalled mid tool-call|stream interrupted before completion/i.test(text)) {
          return "cancelled";
        }
      }
    }
    const status = statusFromTerminalEvent(events[index]);
    if (status) return status;
  }
  return null;
}

function messageEvent(message: ChatTaskMessage, index: number): TaskEventView | null {
  const metadata = isRecord(message.metadata) ? message.metadata : {};
  const rawEvent = isRecord(metadata.event) ? metadata.event : null;
  const rawEventMetadata = rawEvent && isRecord(rawEvent.metadata) ? rawEvent.metadata : {};
  const type = cleanText(metadata.eventType ?? rawEvent?.type ?? message.role, "", 80);
  if (!type) return null;

  const timestamp = timestampMs(
    rawEvent?.timestamp ??
      rawEvent?.createdAt ??
      rawEventMetadata.timestamp ??
      rawEventMetadata.createdAt ??
      message.createdAt,
    Date.now(),
  );
  const command = cleanText(
    rawEvent?.command ?? rawEventMetadata.command ?? metadata.command,
    "",
    220,
  );
  const tool = cleanText(
    rawEvent?.name ??
      rawEventMetadata.tool ??
      rawEventMetadata.toolName ??
      (type.startsWith("command_") ? "terminal" : ""),
    "",
    80,
  );
  const successValue = rawEvent?.success ?? rawEventMetadata.success;
  const success =
    typeof successValue === "boolean"
      ? successValue
      : type === "done"
        ? doneEventSuccess(rawEvent)
      : type === "command_end" || type === "tool_end"
        ? !ERROR_RE.test(message.content)
        : undefined;
  const summary = summarizeEventMessage(type, message, rawEvent, command, tool);
  return {
    command,
    id: cleanText(metadata.id ?? rawEventMetadata.id ?? `${message.createdAt}-${index}`, `${index}`),
    label: eventLabel(type, tool, command),
    raw: rawEvent,
    summary,
    timestampMs: timestamp,
    tool,
    type,
    ...(success == null ? {} : { success }),
  };
}

function summarizeEventMessage(
  type: string,
  message: ChatTaskMessage,
  rawEvent: Record<string, unknown> | null,
  command: string,
  tool: string,
): string {
  if (type === "command_start") return command || cleanText(message.content, "terminal", 160);
  if (type === "tool_start") return tool ? `tool started: ${tool}` : cleanText(message.content, "tool started", 160);
  if (type === "file_changed") {
    return cleanText(rawEvent?.summary ?? rawEvent?.path ?? message.content, "file changed", 180);
  }
  if (type === "error") return cleanText(rawEvent?.message ?? rawEvent?.details ?? message.content, "error", 220);
  if (type === "done") {
    const rawMetadata = rawEvent && isRecord(rawEvent.metadata) ? rawEvent.metadata : {};
    if (!doneEventSuccess(rawEvent)) {
      return cleanText(
        rawMetadata.error ?? rawMetadata.turnExitReason ?? rawMetadata.turn_exit_reason ?? rawEvent?.summary ?? message.content,
        "interrupted",
        160,
      );
    }
    return cleanText(rawEvent?.summary ?? message.content, "done", 120);
  }
  if (type === "run_stage") {
    return cleanText(rawEvent?.label ?? rawEvent?.stage ?? message.content, "stage event", 140);
  }
  if (type === "skill_packaged") {
    return cleanText(message.metadata.skillPath ?? message.content, "skill packaged", 180);
  }
  return cleanText(message.content, type, 180);
}

function eventLabel(type: string, tool: string, command: string): string {
  if (type === "command_start") return command || "terminal";
  if (type === "tool_start" || type === "tool_output" || type === "tool_end") return tool || "tool";
  if (type === "file_changed") return "file";
  if (type === "run_stage") return "stage";
  return type.replace(/_/g, " ");
}

function usageFromMessages(messages: ChatTaskMessage[]) {
  return messages.reduce(
    (total, message) => {
      const metadata = isRecord(message.metadata) ? message.metadata : {};
      const event = isRecord(metadata.event) ? metadata.event : {};
      const eventMetadata = isRecord(event.metadata) ? event.metadata : {};
      const source = { ...metadata, ...eventMetadata };
      total.input += numberOrZero(source.inputTokens ?? source.input_tokens);
      total.output += numberOrZero(source.outputTokens ?? source.output_tokens);
      total.apiCalls += numberOrZero(source.apiCalls ?? source.api_calls);
      return total;
    },
    { apiCalls: 0, input: 0, output: 0 },
  );
}

function providerModelFrom(task: ChatTask, session: SessionInfo | null, copy: WorkspaceCopy) {
  const providerFromTask = cleanText(task.model_provider, "", 80);
  const modelFromTask = cleanText(task.model, "", 120);
  const sessionModel = cleanText(session?.model, "", 180);
  if (providerFromTask || modelFromTask) {
    return {
      provider: providerFromTask || copy.unavailable,
      model: modelFromTask || copy.unavailable,
    };
  }
  if (sessionModel.includes("/")) {
    const [provider, ...rest] = sessionModel.split("/");
    return {
      provider: cleanText(provider, copy.unavailable, 80),
      model: cleanText(rest.join("/"), copy.unavailable, 120),
    };
  }
  return {
    provider: copy.unavailable,
    model: sessionModel || copy.unavailable,
  };
}

function hasCompletedEvent(events: TaskEventView[]): boolean {
  return events.some((event) => event.type === "done" && event.success !== false);
}

function lastError(events: TaskEventView[]): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === "error" || event.success === false || ERROR_RE.test(event.summary)) {
      return cleanText(event.summary, "error", 220);
    }
  }
  return "";
}

function latestResult(events: TaskEventView[]): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (
      event.type === "command_end" ||
      event.type === "tool_end" ||
      event.type === "command_output" ||
      event.type === "tool_output"
    ) {
      return cleanText(event.summary, event.success === false ? "failed" : "success", 160);
    }
  }
  return "";
}

function currentEvent(events: TaskEventView[]): TaskEventView | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type !== "raw_log" || event.summary) return event;
  }
  return null;
}

function taskEventRunId(event: TaskEventView | null): string {
  if (!event) return "";
  const rawMetadata = isRecord(event.raw?.metadata) ? event.raw.metadata : {};
  return cleanText(event.raw?.runId ?? rawMetadata.runId, "", 160);
}

function latestRunIdFromEvents(events: TaskEventView[]): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const runId = taskEventRunId(events[index]);
    if (runId) return runId;
  }
  return "";
}

function latestTurnRuntimeEvents(events: TaskEventView[]): TaskEventView[] {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].type === "user") return events.slice(index + 1);
  }
  return events;
}

function runtimeStageEventFromTask(task: ChatTask): TaskEventView | null {
  const rawStage = isRecord(task.current_stage) ? task.current_stage : null;
  if (!rawStage) return null;

  const stage = cleanText(rawStage.stage, "", 80);
  const label = cleanText(rawStage.label ?? stage, "", 140);
  const status = cleanText(rawStage.status, "running", 40);
  if (!stage && !label) return null;

  const timestamp = timestampMs(
    rawStage.timestamp ?? rawStage.createdAt ?? task.last_active ?? task.updatedAt ?? task.updated_at,
    Date.now(),
  );
  return {
    command: "",
    id: `runtime-stage-${stage || label}-${timestamp}`,
    label: "stage",
    raw: {
      ...rawStage,
      type: "run_stage",
      stage,
      status,
      label,
      runId: task.active_run_id ?? undefined,
    },
    summary: label || stage,
    timestampMs: timestamp,
    tool: "",
    type: "run_stage",
  };
}

function currentActionFromEvent(event: TaskEventView | null, copy: WorkspaceCopy): string {
  if (!event) return copy.waitingStart;
  if (event.type === "command_start") return cleanText(event.summary, "运行命令", 160);
  if (event.type === "tool_start") return cleanText(event.summary, "调用工具", 160);
  if (event.type === "file_changed") return cleanText(event.summary, "更新文件", 160);
  if (event.type === "assistant_message") return copy.stageLabels.finalizing;
  if (event.type === "done") return copy.stageLabels.finalizing;
  if (event.type === "error") return cleanText(event.summary, "处理错误", 160);
  if (event.type === "run_stage") return analysisStageEventLabel(event, copy);
  return cleanText(event.summary, copy.waitingStart, 160);
}

function currentToolFromEvent(event: TaskEventView | null, copy: WorkspaceCopy): string {
  if (!event) return copy.noCommand;
  if (event.type.startsWith("command_")) return "terminal";
  if (event.tool) return event.tool;
  if (event.type === "file_changed") return "file";
  if (event.type === "run_stage") return copy.stage;
  if (event.type.startsWith("assistant_")) return "LLM";
  return copy.noCommand;
}

function buildStageTimeline(
  events: TaskEventView[],
  copy: WorkspaceCopy,
): { currentStage: string; inferredStage: boolean; timeline: StageTimelineItem[] } {
  const latestEvents = latestTurnRuntimeEvents(events);
  const latestRunId = latestRunIdFromEvents(latestEvents);
  const explicitStageEvents = latestEvents.filter((event) => {
    if (event.type !== "run_stage") return false;
    const eventRunId = taskEventRunId(event);
    return latestRunId ? eventRunId === latestRunId : true;
  });
  if (explicitStageEvents.length > 0) {
    const byStage = new Map<string, TaskEventView>();
    for (const event of explicitStageEvents) {
      const stageName = analysisStageEventLabel(event, copy);
      byStage.set(stageName, event);
    }
    const timeline = Array.from(byStage.entries()).map(([name, event]) => {
      const rawStage = cleanText(event.raw?.stage, "", 80).toLowerCase();
      const rawStatus = cleanText(event.raw?.status, "running", 40).toLowerCase();
      const eventStatus: StageEventStatus =
        rawStatus === "completed" || rawStatus === "done"
          ? "completed"
          : rawStatus === "failed" || rawStatus === "error"
            ? "failed"
            : rawStatus === "pending"
              ? "pending"
              : "running";
      return {
        key: "analysis" as StageKey,
        label: name,
        terminal: rawStage === "done" || rawStage === "completed",
        status: eventStatus,
        timestampMs: event.timestampMs,
      };
    });
    const active =
      [...timeline].reverse().find((item) => item.terminal && item.status === "completed") ??
      [...timeline].reverse().find((item) => item.status === "running") ??
      [...timeline].reverse().find((item) => item.status === "failed") ??
      timeline.find((item) => item.status === "pending") ??
      [...timeline].reverse().find((item) => item.status === "completed") ??
      timeline.at(-1);
    return {
      currentStage: active?.label ?? copy.stageLabels.analysis,
      inferredStage: false,
      timeline,
    };
  }

  return {
    currentStage: "",
    inferredStage: false,
    timeline: [],
  };
}

function artifactTypeForPath(pathValue: string, metadataType = ""): ArtifactType {
  const lower = `${pathValue} ${metadataType}`.toLowerCase();
  if (lower.endsWith("skill.md") || /skill/.test(lower)) return "skill";
  if (/\.(zip|7z|tar|tgz|gz)$/.test(lower) || /archive|export|package/.test(lower)) return "archive";
  if (/smoke/.test(lower)) return "smokeReport";
  if (/path|contract/.test(lower)) return "pathReport";
  if (/test|pytest|junit|coverage/.test(lower)) return "testReport";
  if (/\.(md|txt|pdf|docx)$/.test(lower)) return "document";
  if (/\.(json|html|xml)$/.test(lower)) return "runReport";
  return "modifiedFile";
}

function artifactName(pathValue: string): string {
  const clean = pathValue.replace(/\\/g, "/").replace(/\/+$/, "");
  return clean.split("/").filter(Boolean).at(-1) || pathValue || "artifact";
}

function normalizeChangeType(value: unknown): ArtifactView["changeType"] {
  const raw = String(value || "").toLowerCase();
  if (["added", "add", "created", "create", "new"].includes(raw)) return "added";
  if (["deleted", "delete", "removed", "remove"].includes(raw)) return "deleted";
  if (["modified", "modify", "updated", "update", "changed", "change"].includes(raw)) return "modified";
  return "unknown";
}

const ARTIFACT_PATH_RE =
  /(?:[A-Za-z]:\\[^\s`"'<>|]+|\/[^\s`"'<>|]+)\.(?:html?|css|js|jsx|ts|tsx|mjs|cjs|json|md|txt|csv|xml|ya?ml|png|jpe?g|gif|webp|svg|pdf|docx?|xlsx?|pptx?|zip|7z|tar|tgz|gz)/gi;

function artifactPathsFromText(value: unknown): string[] {
  const text = String(value || "");
  const paths = new Set<string>();
  for (const match of text.matchAll(ARTIFACT_PATH_RE)) {
    const pathValue = String(match[0] || "").replace(/[.,;:)\]}]+$/g, "").trim();
    if (pathValue) paths.add(pathValue);
  }
  return Array.from(paths);
}

function extractArtifacts(
  project: ChatProject,
  task: ChatTask,
  events: TaskEventView[],
): ArtifactView[] {
  const byPath = new Map<string, ArtifactView>();
  for (const event of events) {
    if (event.type === "file_changed") {
      const pathValue = cleanText(event.raw?.path ?? event.summary, "", 500);
      if (!pathValue) continue;
      byPath.set(pathValue, {
        changeType: normalizeChangeType(event.raw?.changeType ?? event.raw?.change_type),
        generatedAtMs: event.timestampMs,
        id: `${task.id}:${pathValue}`,
        name: artifactName(pathValue),
        path: pathValue,
        taskId: task.id,
        taskTitle: task.title,
        type: artifactTypeForPath(pathValue),
      });
    }
    if (event.type === "skill_packaged") {
      const pathValue = cleanText(event.raw?.skillPath ?? event.raw?.path ?? event.summary, "", 500);
      if (!pathValue) continue;
      byPath.set(pathValue, {
        changeType: "added",
        generatedAtMs: event.timestampMs,
        id: `${task.id}:skill:${pathValue}`,
        name: artifactName(pathValue),
        path: pathValue,
        taskId: task.id,
        taskTitle: task.title,
        type: "skill",
      });
    }
    if (event.type === "assistant_message" || event.type === "raw_log") {
      const sourceText = event.raw?.content ?? event.raw?.message ?? event.summary;
      for (const pathValue of artifactPathsFromText(sourceText)) {
        if (byPath.has(pathValue)) continue;
        byPath.set(pathValue, {
          changeType: "added",
          generatedAtMs: event.timestampMs,
          id: `${task.id}:mentioned:${pathValue}`,
          name: artifactName(pathValue),
          path: pathValue,
          taskId: task.id,
          taskTitle: task.title,
          type: artifactTypeForPath(pathValue, "mentioned"),
        });
      }
    }
  }

  return Array.from(byPath.values())
    .map((artifact) => ({
      ...artifact,
      path: artifact.path || project.path || task.contextPath || "",
    }))
    .sort((a, b) => b.generatedAtMs - a.generatedAtMs)
    .slice(0, 20);
}

function testSummary(events: TaskEventView[], copy: WorkspaceCopy): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const text = `${event.command} ${event.summary}`;
    if (TEST_RE.test(text)) return cleanText(text, copy.noTestSummary, 160);
  }
  return copy.noTestSummary;
}

function completedAtFrom(events: TaskEventView[], session: SessionInfo | null): number | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === "done") {
      const completedAt = event.raw?.metadata && isRecord(event.raw.metadata)
        ? event.raw.metadata.completedAt
        : event.raw?.completedAt;
      return timestampMs(completedAt ?? event.timestampMs, event.timestampMs);
    }
  }
  if (session?.ended_at && !session.is_active) return timestampMs(session.ended_at);
  return null;
}

function durationFrom(
  events: TaskEventView[],
  task: ChatTask,
  session: SessionInfo | null,
  status: NormalizedTaskStatus,
): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type !== "done") continue;
    const metadata = event.raw?.metadata && isRecord(event.raw.metadata) ? event.raw.metadata : event.raw ?? {};
    const duration = numberOrZero(metadata.durationMs ?? metadata.duration_ms);
    if (duration > 0) return duration;
  }
  const startedMs = timestampMs(task.run_started_at ?? session?.run_started_at ?? session?.started_at ?? task.created_at);
  const endedMs =
    status === "running"
      ? Date.now()
      : completedAtFrom(events, session) ?? timestampMs(session?.last_active ?? task.updated_at, Date.now());
  return Math.max(0, endedMs - startedMs);
}

function priorityRank(status: NormalizedTaskStatus, updatedAt: number): number {
  const ageDays = (Date.now() - updatedAt) / 86_400_000;
  switch (status) {
    case "needs_attention":
      return 10;
    case "running":
      return 20;
    case "queued":
      return 30;
    case "failed":
      return 40;
    case "completed":
      return ageDays <= 7 ? 50 : 70;
    case "not_started":
      return 60;
    case "paused":
      return 65;
    case "cancelled":
      return 80;
    default:
      return 90;
  }
}

function buildTaskViewModel(
  project: ChatProject,
  task: ChatTask,
  events: ChatTaskMessage[],
  artifactsInput: ArtifactView[],
  options: {
    copy: WorkspaceCopy;
    session: SessionInfo | null;
  },
): TaskViewModel {
  const { copy, session } = options;
  const eventViews = events
    .map((message, index) => messageEvent(message, index))
    .filter((event): event is TaskEventView => Boolean(event))
    .sort((a, b) => a.timestampMs - b.timestampMs);
  const runtimeStageEvent = runtimeStageEventFromTask(task);
  const displayEventViews =
    runtimeStageEvent &&
    !eventViews.some((event) => event.type === "run_stage" && event.timestampMs >= runtimeStageEvent.timestampMs)
      ? [...eventViews, runtimeStageEvent].sort((a, b) => a.timestampMs - b.timestampMs)
      : eventViews;
  const usage = usageFromMessages(events);
  const tokensFromSession = numberOrZero(session?.input_tokens) + numberOrZero(session?.output_tokens);
  const tokens = tokensFromSession || usage.input + usage.output;
  const toolCalls =
    numberOrZero(session?.tool_call_count) ||
    displayEventViews.filter((event) => event.type === "tool_start" || event.type === "command_start").length;
  const llmCalls =
    numberOrZero((session as SessionInfo & { api_calls?: number })?.api_calls) ||
    usage.apiCalls ||
    events.filter((message) => message.role === "assistant").length;
  const current = currentEvent(displayEventViews);
  const error = lastError(displayEventViews);
  const preview = cleanText(session?.preview, "", 220);
  const hasStarted =
    displayEventViews.length > 0 ||
    numberOrZero(session?.message_count) > 0 ||
    Boolean(task.hermesSessionId || task.session_id);
  const needsAttention = ATTENTION_RE.test(`${preview} ${error} ${current?.summary ?? ""}`);
  const terminalStatus = statusFromLatestTerminalEvent(displayEventViews);
  const hasCompleted = terminalStatus === "completed" || (!terminalStatus && (hasCompletedEvent(displayEventViews) || task.runtime_status === "completed"));
  const status = normalizeTaskStatus(terminalStatus ?? task.runtime_status, {
    hasCompleted,
    hasError: Boolean(error),
    hasStarted,
    needsAttention: needsAttention && !session?.is_active && (terminalStatus ?? task.runtime_status) !== "completed",
    queueDepth: numberOrZero(task.queue_depth ?? session?.queue_depth),
    running: Boolean(task.is_active ?? session?.is_active),
  });
  const showStageTimeline = latestRunModeFromMessages(events) === "plan";
  const stage = showStageTimeline
    ? buildStageTimeline(displayEventViews, copy)
    : { currentStage: "", inferredStage: false, timeline: [] };
  const providerModel = providerModelFrom(task, session, copy);
  const artifacts = artifactsInput.length > 0 ? artifactsInput : extractArtifacts(project, task, displayEventViews);
  const createdAt = taskCreatedMs(task);
  const updatedAt = Math.max(
    taskUpdatedMs(task),
    timestampMs(session?.last_active, 0),
    displayEventViews.at(-1)?.timestampMs ?? 0,
  );
  const completedAt = completedAtFrom(displayEventViews, session);
  const durationMs = durationFrom(displayEventViews, task, session, status);
  const statusText = statusLabel(status, copy);
  const todoItems = latestTodoItemsFromMessages(events);
  return {
    artifactCount: artifacts.length,
    artifacts,
    completedAt,
    createdAt,
    currentAction: currentActionFromEvent(current, copy),
    currentCommand: current?.command || copy.noCommand,
    currentStage: stage.currentStage,
    currentTool: currentToolFromEvent(current, copy),
    durationMs,
    id: task.id,
    inferredStage: stage.inferredStage,
    key: taskKey(project.id, task.id),
    lastError: error,
    llmCalls,
    model: providerModel.model,
    needsAttentionReason: error || preview || current?.summary || statusText,
    priorityRank: priorityRank(status, updatedAt),
    projectId: project.id,
    projectName: displayProjectName(project, task, copy),
    provider: providerModel.provider,
    queueDepth: numberOrZero(task.queue_depth ?? session?.queue_depth),
    recentEvents: [...displayEventViews].slice(-10).reverse(),
    recentResult: latestResult(displayEventViews),
    stageTimeline: stage.timeline,
    status,
    statusLabel: statusText,
    testSummary: testSummary(displayEventViews, copy),
    title: displayTaskTitle(project, task, providerModel, copy),
    todoItems,
    tokens,
    toolCalls,
    updatedAt,
  };
}

function changeSummary(artifacts: ArtifactView[]) {
  return artifacts.reduce(
    (summary, artifact) => {
      if (artifact.changeType === "added") summary.added += 1;
      else if (artifact.changeType === "deleted") summary.deleted += 1;
      else summary.modified += 1;
      return summary;
    },
    { added: 0, deleted: 0, modified: 0 },
  );
}

function parentPath(pathValue: string): string {
  const normalized = pathValue.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return pathValue;
  return pathValue.slice(0, index);
}

export default function WorkspacePage() {
  const navigate = useNavigate();
  const { setEnd, setTitle } = usePageHeader();
  const { locale } = useI18n();
  const copy = COPY[locale];
  const [state, setState] = useState<LoadState>({
    analytics: null,
    currentProjectId: "",
    currentTaskId: "",
    error: null,
    loading: true,
    projects: [],
    sessions: [],
  });
  const [query, setQuery] = useState("");
  const [selectedTaskKey, setSelectedTaskKey] = useState<string | null>(null);
  const [selectedMessages, setSelectedMessages] = useState<{
    error: string | null;
    key: string | null;
    loading: boolean;
    messages: ChatTaskMessage[];
  }>({ error: null, key: null, loading: false, messages: [] });
  const [notice, setNotice] = useState<string | null>(null);
  const refreshSeqRef = useRef(0);
  const silentRefreshTimerRef = useRef<number | null>(null);

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    const refreshSeq = ++refreshSeqRef.current;
    if (!options?.silent) {
      setState((prev) => ({ ...prev, loading: true, error: null }));
    }
    const [sessionsResult, analyticsResult, projectsResult] = await Promise.allSettled([
      redouApi.getSessions(200),
      redouApi.getAnalytics(7),
      redouApi.getChatProjects(),
    ]);
    const failures = [sessionsResult, analyticsResult, projectsResult].filter(
      (result) => result.status === "rejected",
    ).length;
    const projectsResponse =
      projectsResult.status === "fulfilled" ? projectsResult.value : null;
    setState((prev) => {
      if (refreshSeq !== refreshSeqRef.current) return prev;
      return {
        analytics: analyticsResult.status === "fulfilled" ? analyticsResult.value : prev.analytics,
        currentProjectId: projectsResponse?.current_project_id ?? prev.currentProjectId,
        currentTaskId: projectsResponse?.current_task_id ?? prev.currentTaskId,
        error: failures > 0 ? "部分任务数据暂时不可用" : null,
        loading: false,
        projects: projectsResponse?.projects ?? prev.projects,
        sessions: sessionsResult.status === "fulfilled" ? sessionsResult.value.sessions : prev.sessions,
      };
    });
  }, []);

  const scheduleSilentRefresh = useCallback(() => {
    if (silentRefreshTimerRef.current != null) return;
    silentRefreshTimerRef.current = window.setTimeout(() => {
      silentRefreshTimerRef.current = null;
      void refresh({ silent: true });
    }, 350);
  }, [refresh]);

  const selectedTaskMessageSource = useMemo(
    () => findSelectedTaskMessageSource(selectedTaskKey, state.projects),
    [selectedTaskKey, state.projects],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    const pollId = window.setInterval(() => {
      void refresh({ silent: true });
    }, 3_000);
    const offAgentEvent = window.redouDesktop?.onAgentEvent?.(() => {
      scheduleSilentRefresh();
    });
    const offAnalysisEvent = window.redouDesktop?.onAnalysisEvent?.(() => {
      scheduleSilentRefresh();
    });
    return () => {
      window.clearInterval(pollId);
      if (silentRefreshTimerRef.current != null) {
        window.clearTimeout(silentRefreshTimerRef.current);
        silentRefreshTimerRef.current = null;
      }
      offAgentEvent?.();
      offAnalysisEvent?.();
    };
  }, [refresh, scheduleSilentRefresh]);

  useLayoutEffect(() => {
    setTitle(copy.pageTitle);
    setEnd(
      <div className="hidden min-w-0 items-center justify-end gap-1.5 sm:flex">
        <Button
          outlined
          size="icon"
          onClick={() => void refresh()}
          aria-label={copy.refreshConsole}
          title={copy.refresh}
          disabled={state.loading}
        >
          <RefreshCw className={cn(state.loading && "animate-spin")} />
        </Button>
      </div>,
    );
    return () => {
      setTitle(null);
      setEnd(null);
    };
  }, [copy, refresh, setEnd, setTitle, state.loading]);

  const sessionByTask = useMemo(() => {
    const map = new Map<string, SessionInfo>();
    for (const session of state.sessions) {
      if (session.projectId && session.taskId) {
        map.set(taskKey(session.projectId, session.taskId), session);
      }
    }
    return map;
  }, [state.sessions]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!selectedTaskMessageSource) {
        setSelectedMessages((prev) =>
          prev.key === null && !prev.loading && prev.messages.length === 0 && !prev.error
            ? prev
            : { error: null, key: null, loading: false, messages: [] },
        );
        return;
      }
      const { key, projectId, taskId } = selectedTaskMessageSource;
      setSelectedMessages((prev) => ({
        error: null,
        key,
        loading: prev.key !== key,
        messages: prev.key === key ? prev.messages : [],
      }));
      redouApi
        .getChatTaskMessages(projectId, taskId)
        .then((result) => {
          if (cancelled) return;
          setSelectedMessages({
            error: result.warnings?.[0] ?? null,
            key,
            loading: false,
            messages: result.messages ?? [],
          });
        })
        .catch((error) => {
          if (cancelled) return;
          setSelectedMessages({
            error: errorMessage(error),
            key,
            loading: false,
            messages: [],
          });
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [selectedTaskMessageSource]);

  const taskViewModels = useMemo(() => {
    return state.projects.flatMap((project) =>
      (project.tasks || []).map((task) => {
        const key = taskKey(project.id, task.id);
        const messages = selectedMessages.key === key ? selectedMessages.messages : [];
        return buildTaskViewModel(project, task, messages, [], {
          copy,
          session: sessionByTask.get(key) ?? null,
        });
      }),
    );
  }, [copy, selectedMessages.key, selectedMessages.messages, sessionByTask, state.projects]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (taskViewModels.length === 0) {
        if (selectedTaskKey) setSelectedTaskKey(null);
        return;
      }
      if (selectedTaskKey && taskViewModels.some((task) => task.key === selectedTaskKey)) return;
      const currentKey =
        state.currentProjectId && state.currentTaskId
          ? taskKey(state.currentProjectId, state.currentTaskId)
          : null;
      const nextKey =
        (currentKey && taskViewModels.some((task) => task.key === currentKey)
          ? currentKey
          : null) ?? taskViewModels[0].key;
      setSelectedTaskKey(nextKey);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedTaskKey, state.currentProjectId, state.currentTaskId, taskViewModels]);

  const selectedTask = useMemo(
    () => taskViewModels.find((task) => task.key === selectedTaskKey) ?? null,
    [selectedTaskKey, taskViewModels],
  );

  const sortedTasks = useMemo(
    () =>
      [...taskViewModels].sort((a, b) => {
        if (a.priorityRank !== b.priorityRank) return a.priorityRank - b.priorityRank;
        return b.updatedAt - a.updatedAt;
      }),
    [taskViewModels],
  );

  const filteredTasks = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase();
    if (!cleanQuery) return sortedTasks;
    return sortedTasks.filter((task) =>
      [
        task.title,
        task.projectName,
        task.statusLabel,
        task.currentAction,
        task.currentTool,
        task.provider,
        task.model,
      ]
        .join(" ")
        .toLowerCase()
        .includes(cleanQuery),
    );
  }, [query, sortedTasks]);

  const overview = useMemo(() => {
    const allTasks = state.projects.flatMap((project) =>
      (project.tasks || []).map((task) => ({
        session: sessionByTask.get(taskKey(project.id, task.id)) ?? null,
        task,
      })),
    );
    const statuses = allTasks.map(({ session, task }) => overviewStatusForTask(task, session));
    const todaySessions = state.sessions.filter((session) =>
      isToday(timestampMs(session.last_active ?? session.started_at, 0)),
    );
    const todayTokensFromSessions = todaySessions.reduce(
      (sum, session) => sum + numberOrZero(session.input_tokens) + numberOrZero(session.output_tokens),
      0,
    );
    const todayTools = todaySessions.reduce(
      (sum, session) => sum + numberOrZero(session.tool_call_count),
      0,
    );
    const todayKey = new Date().toISOString().slice(0, 10);
    const todayAnalytics = state.analytics?.daily.find((entry) => entry.day === todayKey) ?? null;
    const todayTokensFromAnalytics =
      todayAnalytics
        ? numberOrZero(todayAnalytics.input_tokens) + numberOrZero(todayAnalytics.output_tokens)
        : 0;
    return {
      active: statuses.filter((status) => status === "running").length,
      completed: statuses.filter((status) => status === "completed").length,
      failed: statuses.filter((status) => status === "failed").length,
      needsAttention: statuses.filter((status) => status === "needs_attention").length,
      queued: statuses.filter((status) => status === "queued").length,
      todayTokens: todayTokensFromAnalytics || todayTokensFromSessions,
      todayTools: numberOrZero(todayAnalytics?.tool_calls) || todayTools,
    };
  }, [sessionByTask, state.analytics?.daily, state.projects, state.sessions]);

  const needsAttentionTasks = useMemo(
    () =>
      taskViewModels
        .filter((task) => task.status === "needs_attention")
        .sort((a, b) => a.priorityRank - b.priorityRank || b.updatedAt - a.updatedAt)
        .slice(0, 8),
    [taskViewModels],
  );

  const selectedArtifacts = selectedTask?.artifacts ?? [];
  const selectedChanges = changeSummary(selectedArtifacts);

  const enterTask = useCallback(
    async (task: TaskViewModel | null = selectedTask) => {
      if (!task) {
        setNotice(copy.selectTaskPrompt);
        return;
      }
      try {
        setNotice(null);
        await redouApi.setActiveChatTask(task.projectId, task.id);
        navigate("/chat");
      } catch (error) {
        setNotice(`${copy.enterFailed}: ${errorMessage(error)}`);
      }
    },
    [copy.enterFailed, copy.selectTaskPrompt, navigate, selectedTask],
  );

  const copyArtifactPath = useCallback(
    async (artifact: ArtifactView) => {
      try {
        await navigator.clipboard.writeText(artifact.path);
        setNotice(copy.copiedPath);
      } catch (error) {
        setNotice(errorMessage(error));
      }
    },
    [copy.copiedPath],
  );

  const openArtifact = useCallback(async (artifact: ArtifactView, locate = false) => {
    const target = locate ? parentPath(artifact.path) : artifact.path;
    if (!target) return;
    const result = await redouApi.openLocalPath(target);
    if (!result.ok) setNotice(result.message ?? "Path could not be opened.");
  }, []);

  return (
    <div className="redou-workspace flex min-h-0 min-w-0 flex-1 flex-col gap-3 normal-case text-midground">
      {notice && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          {notice}
        </div>
      )}

      <section className="grid min-h-0 min-w-0 gap-3 xl:grid-cols-[minmax(280px,0.82fr)_minmax(460px,1.55fr)_minmax(330px,1fr)]">
        <div className="grid min-h-0 min-w-0 gap-3">
          <RunOverviewPanel
            copy={copy}
            overview={overview}
          />
          <NeedsAttentionPanel
            copy={copy}
            locale={locale}
            tasks={needsAttentionTasks}
          />
        </div>

        <TaskOverviewPanel
          copy={copy}
          filteredTasks={filteredTasks}
          loading={state.loading}
          onEnterTask={(task) => void enterTask(task)}
          query={query}
          selectedTaskKey={selectedTaskKey}
          setQuery={setQuery}
          setSelectedTaskKey={setSelectedTaskKey}
          totalTasks={taskViewModels.length}
        />

        <TaskDetailPanel
          copy={copy}
          locale={locale}
          loading={selectedMessages.loading}
          selectedTask={selectedTask}
          selectedTaskError={selectedMessages.error}
        />
      </section>

      <section className="grid min-h-0 min-w-0 gap-3 xl:grid-cols-[minmax(300px,0.9fr)_minmax(0,1.35fr)_minmax(320px,0.9fr)]">
        <ArtifactsPanel
          artifacts={selectedArtifacts}
          copy={copy}
          locale={locale}
          onCopy={copyArtifactPath}
          onLocate={(artifact) => void openArtifact(artifact, true)}
          onOpen={(artifact) => void openArtifact(artifact)}
        />
        <ChangePreviewPanel
          artifacts={selectedArtifacts}
          changes={selectedChanges}
          copy={copy}
          onEnterTask={() => void enterTask()}
          selectedTask={selectedTask}
        />
        <DiagnosticsPanel
          copy={copy}
          events={selectedTask?.recentEvents ?? []}
          locale={locale}
          loading={selectedMessages.loading}
        />
      </section>
    </div>
  );
}

function RunOverviewPanel({
  copy,
  overview,
}: {
  copy: WorkspaceCopy;
  overview: {
    active: number;
    completed: number;
    failed: number;
    needsAttention: number;
    queued: number;
    todayTokens: number;
    todayTools: number;
  };
}) {
  const metrics = [
    { label: copy.metrics.active, tone: "success" as Tone, value: overview.active },
    { label: copy.metrics.queued, tone: "warning" as Tone, value: overview.queued },
    { label: copy.metrics.needsAttention, tone: "danger" as Tone, value: overview.needsAttention },
    { label: copy.metrics.failed, tone: "danger" as Tone, value: overview.failed },
    { label: copy.metrics.completed, tone: "success" as Tone, value: overview.completed },
    { label: copy.metrics.todayTokens, tone: "default" as Tone, value: formatTokenCount(overview.todayTokens) },
    { label: copy.metrics.todayTools, tone: "default" as Tone, value: formatTokenCount(overview.todayTools) },
  ];
  return (
    <Panel title={copy.sections.runOverview} icon={Activity}>
      <div className="grid min-w-0 grid-cols-2 gap-2">
        {metrics.map((metric) => (
          <MetricTile
            key={metric.label}
            label={metric.label}
            tone={metric.tone}
            value={String(metric.value)}
          />
        ))}
      </div>
    </Panel>
  );
}

function TaskOverviewPanel({
  copy,
  filteredTasks,
  loading,
  onEnterTask,
  query,
  selectedTaskKey,
  setQuery,
  setSelectedTaskKey,
  totalTasks,
}: {
  copy: WorkspaceCopy;
  filteredTasks: TaskViewModel[];
  loading: boolean;
  onEnterTask: (task: TaskViewModel) => void;
  query: string;
  selectedTaskKey: string | null;
  setQuery: (value: string) => void;
  setSelectedTaskKey: (value: string) => void;
  totalTasks: number;
}) {
  return (
    <Panel
      title={copy.sections.taskOverview}
      icon={ListChecks}
      end={
        <Badge tone="outline" className="shrink-0 text-[10px]">
          {filteredTasks.length}/{totalTasks}
        </Badge>
      }
      className="min-h-[31rem]"
    >
      <div className="mb-3 flex min-w-0 items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-8 pl-8 text-xs"
            placeholder={copy.searchPlaceholder}
          />
        </div>
        <Badge tone={loading ? "warning" : "secondary"} className="text-[10px]">
          {loading ? copy.refresh : copy.allTasks}
        </Badge>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
        {filteredTasks.length === 0 ? (
          <EmptyState icon={ListChecks} label={copy.selectTaskPrompt} />
        ) : (
          filteredTasks.map((task) => (
            <TaskOverviewCard
              key={task.key}
              copy={copy}
              selected={task.key === selectedTaskKey}
              task={task}
              onEnterTask={onEnterTask}
              onSelect={() => setSelectedTaskKey(task.key)}
            />
          ))
        )}
      </div>
    </Panel>
  );
}

function TaskOverviewCard({
  copy,
  onEnterTask,
  onSelect,
  selected,
  task,
}: {
  copy: WorkspaceCopy;
  onEnterTask: (task: TaskViewModel) => void;
  onSelect: () => void;
  selected: boolean;
  task: TaskViewModel;
}) {
  const detailParts = [
    task.currentTool,
    task.currentAction,
    formatDuration(task.durationMs),
    task.provider,
    `LLM ${formatTokenCount(task.llmCalls)}`,
    `Tool ${formatTokenCount(task.toolCalls)}`,
    `${formatTokenCount(task.tokens)} tokens`,
    task.artifactCount > 0 ? `${task.artifactCount} ${copy.artifactCount}` : "",
  ].filter(Boolean);
  const canRetry = task.status === "failed";
  return (
    <div
      className={cn(
        "group min-w-0 rounded-lg border px-3 py-2 transition-colors",
        selected
          ? "border-success/55 bg-success/[0.08]"
          : "border-border bg-card/45 hover:border-midground/35 hover:bg-card/70",
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        <button
          type="button"
          onClick={onSelect}
          className="flex min-w-0 flex-1 items-start gap-2 rounded-sm text-left text-midground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-success"
        >
          <span
            className={cn(
              "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-mono-ui text-xs",
              task.status === "running" && "border-success/40 text-success",
              task.status === "queued" && "border-warning/40 text-warning",
              task.status === "needs_attention" && "border-destructive/50 text-destructive",
              task.status === "failed" && "border-destructive/50 text-destructive",
              task.status === "completed" && "border-success/35 text-success",
              (task.status === "not_started" || task.status === "cancelled" || task.status === "paused") &&
                "border-border text-muted-foreground",
            )}
          >
            {statusSymbol(task.status)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{task.title}</div>
              <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {task.projectName}
              </div>
            </div>
            <div className="mt-1 truncate text-xs text-muted-foreground">
              {detailParts.join(" · ")}
            </div>
          </div>
        </button>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge tone={badgeTone(task.status)} className="text-[10px]">
            {task.statusLabel}
          </Badge>
          <div className="flex items-center gap-1">
            {canRetry && (
              <TaskActionIconButton
                icon={RefreshCw}
                label={copy.retry}
                onClick={() => onEnterTask(task)}
                tone="danger"
              />
            )}
            <TaskActionIconButton
              icon={ArrowRight}
              label={copy.enterTask}
              onClick={() => onEnterTask(task)}
            />
            <TaskActionIconButton
              icon={Terminal}
              label={copy.viewLog}
              onClick={onSelect}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function TaskDetailPanel({
  copy,
  loading,
  locale,
  selectedTask,
  selectedTaskError,
}: {
  copy: WorkspaceCopy;
  loading: boolean;
  locale: "zh" | "en";
  selectedTask: TaskViewModel | null;
  selectedTaskError: string | null;
}) {
  return (
    <Panel
      title={copy.sections.taskDetail}
      icon={Activity}
      end={
        selectedTask ? (
          <Badge tone={badgeTone(selectedTask.status)} className="text-[10px]">
            {selectedTask.statusLabel}
          </Badge>
        ) : null
      }
      className="min-h-[20rem]"
    >
      {!selectedTask ? (
        <EmptyState icon={Activity} label={copy.selectDetailPrompt} />
      ) : (
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
          <div className="min-w-0">
            <div className="truncate text-base font-semibold">{selectedTask.title}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span>{copy.status}: {selectedTask.statusLabel}</span>
              {selectedTask.stageTimeline.length > 0 && (
                <>
                  <span>·</span>
                  <span>
                    {copy.stage}: {selectedTask.currentStage}
                    {selectedTask.inferredStage ? ` (${copy.inferred})` : ""}
                  </span>
                </>
              )}
            </div>
          </div>

          {loading && (
            <div className="rounded-md border border-border bg-black/10 px-2 py-1 text-xs text-muted-foreground">
              {copy.loadingTask}
            </div>
          )}
          {selectedTaskError && (
            <div className="rounded-md border border-warning/30 bg-warning/10 px-2 py-1 text-xs text-warning">
              {selectedTaskError}
            </div>
          )}

          <StatusSpecificDetails copy={copy} locale={locale} task={selectedTask} />
        </div>
      )}
    </Panel>
  );
}

function StatusSpecificDetails({
  copy,
  locale,
  task,
}: {
  copy: WorkspaceCopy;
  locale: "zh" | "en";
  task: TaskViewModel;
}) {
  if (task.status === "running") {
    return (
      <>
        <DetailGrid
          rows={[
            [copy.currentTool, task.currentTool],
            [copy.currentAction, task.currentAction],
            [copy.currentCommand, task.currentCommand],
          ]}
        />
        <DetailSection title={copy.model}>
          <DetailGrid
            rows={[
              [copy.provider, task.provider],
              [copy.modelName, task.model],
              [copy.llmCalls, formatTokenCount(task.llmCalls)],
              [copy.tokens, formatTokenCount(task.tokens)],
            ]}
          />
        </DetailSection>
        <DetailSection title={copy.tools}>
          <DetailGrid
            rows={[
              [copy.currentTool, task.currentTool],
              [copy.toolCalls, formatTokenCount(task.toolCalls)],
              [copy.recentResult, task.recentResult || copy.unavailable],
            ]}
          />
        </DetailSection>
        <DetailSection title={copy.time}>
          <DetailGrid
            rows={[
              [copy.duration, formatDuration(task.durationMs, true)],
              [copy.recentEvent, formatRelativeTime(task.updatedAt, locale)],
            ]}
          />
        </DetailSection>
        <TaskProgressDetails copy={copy} task={task} />
      </>
    );
  }

  if (task.status === "completed") {
    return (
      <>
        <DetailGrid
          rows={[
            [copy.completedAt, formatDateTime(task.completedAt, locale)],
            [copy.totalDuration, formatDuration(task.durationMs, true)],
            [copy.provider, task.provider],
            [copy.modelName, task.model],
            [copy.llmCalls, formatTokenCount(task.llmCalls)],
            [copy.toolCalls, formatTokenCount(task.toolCalls)],
            [copy.tokens, formatTokenCount(task.tokens)],
            [copy.artifactCount, String(task.artifactCount)],
            [copy.testSummary, task.testSummary],
          ]}
        />
        <DetailSection title={copy.recentArtifacts}>
          {task.artifacts.slice(0, 3).length > 0 ? (
            <div className="space-y-1">
              {task.artifacts.slice(0, 3).map((artifact) => (
                <div key={artifact.id} className="truncate text-xs text-muted-foreground">
                  {artifact.name}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">{copy.noRecentArtifacts}</div>
          )}
        </DetailSection>
        <TaskProgressDetails copy={copy} task={task} />
      </>
    );
  }

  if (task.status === "needs_attention") {
    return (
      <>
        <DetailGrid
          rows={[
            [copy.blockingReason, task.needsAttentionReason],
            [copy.waitingConfirmation, task.currentAction],
            [copy.recentEvent, formatRelativeTime(task.updatedAt, locale)],
          ]}
        />
        <TaskProgressDetails copy={copy} task={task} />
      </>
    );
  }

  if (task.status === "failed") {
    return (
      <>
        <DetailGrid
          rows={[
            [copy.errorSummary, task.lastError || task.needsAttentionReason],
            [copy.failedStage, task.currentStage],
            [copy.currentTool, task.currentTool],
            [copy.currentCommand, task.currentCommand],
          ]}
        />
        <TaskProgressDetails copy={copy} task={task} />
      </>
    );
  }

  if (task.status === "cancelled") {
    return (
      <>
        <DetailGrid
          rows={[
            [copy.status, task.statusLabel],
            [copy.recentResult, task.lastError || task.needsAttentionReason],
            [copy.totalDuration, formatDuration(task.durationMs, true)],
            [copy.provider, task.provider],
            [copy.modelName, task.model],
          ]}
        />
        <TaskProgressDetails copy={copy} task={task} />
      </>
    );
  }

  return (
    <>
      <DetailGrid
        rows={[
          [copy.status, task.statusLabel],
          [copy.queuePosition, task.queueDepth > 0 ? String(task.queueDepth) : copy.noCommand],
          [copy.createdAt, formatDateTime(task.createdAt, locale)],
          [copy.provider, task.provider],
          [copy.modelName, task.model],
        ]}
      />
      <TaskProgressDetails copy={copy} task={task} />
    </>
  );
}

function TaskProgressDetails({
  copy,
  task,
}: {
  copy: WorkspaceCopy;
  task: TaskViewModel;
}) {
  return (
    <>
      {task.stageTimeline.length > 0 && <StageTimeline copy={copy} timeline={task.stageTimeline} />}
      {task.todoItems.length > 0 && <TaskTodoList copy={copy} items={task.todoItems} />}
    </>
  );
}

function TaskTodoList({
  copy,
  items,
}: {
  copy: WorkspaceCopy;
  items: TodoItem[];
}) {
  return (
    <DetailSection title={copy.taskList}>
      <ol className="space-y-1.5">
        {items.map((item, index) => (
          <li
            key={`${item.id}-${index}`}
            className={cn(
              "grid grid-cols-[1rem_1.5rem_1fr] items-start gap-2 rounded-md px-1.5 py-1 text-xs leading-5",
              item.status === "in_progress" && "bg-warning/5 text-midground",
              item.status === "completed" && "text-muted-foreground",
              item.status === "pending" && "text-muted-foreground",
              item.status === "cancelled" && "text-muted-foreground/60",
            )}
          >
            <span
              className={cn(
                "mt-0.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border",
                item.status === "completed" && "border-success/35 bg-success/10",
                item.status === "in_progress" && "border-warning/35 bg-warning/15",
                item.status === "cancelled" && "border-muted-foreground/35",
                item.status === "pending" && "border-muted-foreground/35",
              )}
              aria-label={item.status}
            />
            <span className="pt-px text-[11px] tabular-nums text-muted-foreground/70">
              {index + 1}
            </span>
            <span
              className={cn(
                "min-w-0 break-words",
                item.status === "in_progress" && "font-medium",
                (item.status === "completed" || item.status === "cancelled") &&
                  "line-through decoration-current/35",
              )}
            >
              {item.content}
            </span>
          </li>
        ))}
      </ol>
    </DetailSection>
  );
}

function NeedsAttentionPanel({
  copy,
  locale,
  tasks,
}: {
  copy: WorkspaceCopy;
  locale: "zh" | "en";
  tasks: TaskViewModel[];
}) {
  return (
    <Panel
      title={copy.sections.needsAttention}
      icon={AlertCircle}
      end={
        <Badge tone={tasks.length > 0 ? "destructive" : "success"} className="text-[10px]">
          {tasks.length}
        </Badge>
      }
      className="min-h-[14rem]"
    >
      {tasks.length === 0 ? (
        <EmptyState icon={CheckCircle2} label={copy.noNeedsAttention} />
      ) : (
        <div className="flex min-h-0 flex-col gap-2 overflow-y-auto pr-1">
          {tasks.map((task) => (
            <div key={task.key} className="rounded-lg border border-border bg-card/45 p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{task.title}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {cleanText(task.needsAttentionReason, task.statusLabel, 110)}
                  </div>
                </div>
                <Badge tone={task.status === "failed" ? "destructive" : "warning"} className="shrink-0 text-[10px]">
                  {task.status === "failed" ? copy.severityLevels.high : copy.severityLevels.medium}
                </Badge>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span>{task.projectName}</span>
                <span>·</span>
                <span>{formatRelativeTime(task.updatedAt, locale)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function ArtifactsPanel({
  artifacts,
  copy,
  locale,
  onCopy,
  onLocate,
  onOpen,
}: {
  artifacts: ArtifactView[];
  copy: WorkspaceCopy;
  locale: "zh" | "en";
  onCopy: (artifact: ArtifactView) => void;
  onLocate: (artifact: ArtifactView) => void;
  onOpen: (artifact: ArtifactView) => void;
}) {
  return (
    <Panel
      title={copy.sections.artifacts}
      icon={PackageCheck}
      end={<Badge tone="outline" className="text-[10px]">{artifacts.length}</Badge>}
      className="min-h-[14rem]"
    >
      {artifacts.length === 0 ? (
        <EmptyState icon={PackageCheck} label={copy.noArtifacts} />
      ) : (
        <div className="flex min-h-0 flex-col gap-2 overflow-y-auto pr-1">
          {artifacts.slice(0, 8).map((artifact) => (
            <div key={artifact.id} className="rounded-lg border border-border bg-card/45 p-2.5">
              <div className="truncate text-sm font-medium">{artifact.name}</div>
              <div className="mt-1 truncate text-xs text-muted-foreground">
                {copy.artifactTypes[artifact.type]} · {artifact.taskTitle} · {formatRelativeTime(artifact.generatedAtMs, locale)}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <IconButton label={copy.open} onClick={() => onOpen(artifact)} icon={Eye} />
                <IconButton label={copy.locate} onClick={() => onLocate(artifact)} icon={FolderOpen} />
                <IconButton label={copy.copyPath} onClick={() => onCopy(artifact)} icon={Copy} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function ChangePreviewPanel({
  artifacts,
  changes,
  copy,
  onEnterTask,
  selectedTask,
}: {
  artifacts: ArtifactView[];
  changes: { added: number; deleted: number; modified: number };
  copy: WorkspaceCopy;
  onEnterTask: () => void;
  selectedTask: TaskViewModel | null;
}) {
  return (
    <Panel
      title={copy.sections.changePreview}
      icon={GitBranch}
      end={
        <TaskActionIconButton
          disabled={!selectedTask}
          icon={Eye}
          label={copy.openFullChanges}
          onClick={onEnterTask}
        />
      }
      className="min-h-56"
    >
      {artifacts.length === 0 ? (
        <EmptyState icon={FileCode2} label={copy.noChanges} />
      ) : (
        <div className="grid min-h-0 gap-3 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <div className="rounded-lg border border-border bg-black/15 p-3">
            <div className="mb-2 text-sm font-medium">{copy.changes.recent}</div>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <Badge tone="success" className="text-[10px]">
                {copy.changes.added} {changes.added}
              </Badge>
              <Badge tone="warning" className="text-[10px]">
                {copy.changes.modified} {changes.modified}
              </Badge>
              <Badge tone="destructive" className="text-[10px]">
                {copy.changes.deleted} {changes.deleted}
              </Badge>
            </div>
          </div>
          <div className="min-h-0 overflow-y-auto pr-1">
            <div className="mb-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
              {copy.changes.important}
            </div>
            <ul className="space-y-1.5">
              {artifacts.slice(0, 8).map((artifact) => (
                <li key={artifact.id} className="flex min-w-0 items-start gap-2 text-sm">
                  <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate font-mono-ui text-xs">{artifact.path}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Panel>
  );
}

function DiagnosticsPanel({
  copy,
  events,
  loading,
  locale,
}: {
  copy: WorkspaceCopy;
  events: TaskEventView[];
  loading: boolean;
  locale: "zh" | "en";
}) {
  return (
    <Panel
      title={copy.sections.diagnostics}
      icon={Terminal}
      end={loading ? <Badge tone="warning" className="text-[10px]">{copy.refresh}</Badge> : null}
      className="min-h-56 opacity-90"
    >
      {events.length === 0 ? (
        <EmptyState icon={Terminal} label={copy.noDiagnostics} />
      ) : (
        <div className="flex min-h-0 flex-col gap-3">
          <div className="space-y-1.5">
            {events.slice(0, 6).map((event) => (
              <div
                key={event.id}
                className="grid grid-cols-[3.5rem_1fr] gap-2 rounded-md border border-border/60 bg-black/10 px-2 py-1.5 text-xs"
              >
                <span className="font-mono-ui text-muted-foreground">{formatClock(event.timestampMs, locale)}</span>
                <span className="min-w-0 truncate">
                  {event.label} {event.success === false ? "失败" : "成功"}
                </span>
              </div>
            ))}
          </div>
          <details className="rounded-lg border border-border bg-black/15">
            <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground">
              {copy.expandRawLogs}
            </summary>
            <pre className="max-h-64 overflow-auto border-t border-border p-3 font-mono-ui text-xs leading-6 text-muted-foreground">
              {events
                .map((event) => {
                  const raw = event.raw ? JSON.stringify(event.raw, null, 2) : event.summary;
                  return `${formatClock(event.timestampMs, locale)} ${event.type}\n${raw}`;
                })
                .join("\n\n")}
            </pre>
          </details>
        </div>
      )}
    </Panel>
  );
}

function Panel({
  children,
  className,
  end,
  icon: Icon,
  title,
}: {
  children: ReactNode;
  className?: string;
  end?: ReactNode;
  icon: ComponentType<{ className?: string }>;
  title: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-background-base/62",
        className,
      )}
    >
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <h3 className="truncate font-expanded text-xs font-bold uppercase tracking-[0.12em]">
            {title}
          </h3>
        </div>
        {end}
      </div>
      <div className="flex min-h-0 flex-1 flex-col p-3">{children}</div>
    </div>
  );
}

function MetricTile({
  label,
  tone,
  value,
}: {
  label: string;
  tone: Tone;
  value: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-lg border bg-card/45 px-3 py-2",
        tone === "success" && "border-success/25",
        tone === "warning" && "border-warning/25",
        tone === "danger" && "border-destructive/30",
        tone === "default" && "border-border",
      )}
    >
      <div className="truncate text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono-ui text-xl leading-none text-midground">{value}</div>
    </div>
  );
}

function DetailSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="rounded-lg border border-border bg-black/10 p-2.5">
      <div className="mb-2 font-mono-ui text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

function DetailGrid({ rows }: { rows: Array<[string, string]> }) {
  return (
    <div className="grid gap-1.5 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="grid min-w-0 grid-cols-[7.5rem_minmax(0,1fr)] gap-2">
          <span className="text-xs text-muted-foreground">{label}</span>
          <span className="min-w-0 break-words text-xs text-midground">{value || "—"}</span>
        </div>
      ))}
    </div>
  );
}

function StageTimeline({
  copy,
  timeline,
}: {
  copy: WorkspaceCopy;
  timeline: StageTimelineItem[];
}) {
  return (
    <DetailSection title={copy.stages}>
      <div className="space-y-1.5">
        {timeline.map((stage) => (
          <div key={`${stage.key}-${stage.label}`} className="flex min-w-0 items-center gap-2 text-xs">
            <span
              className={cn(
                "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-mono-ui",
                stage.status === "completed" && "border-success/35 text-success",
                stage.status === "running" && "border-warning/35 text-warning",
                stage.status === "failed" && "border-destructive/40 text-destructive",
                stage.status === "pending" && "border-border text-muted-foreground",
              )}
            >
              {copy.stageStates[stage.status]}
            </span>
            <span className="truncate">{stage.label}</span>
          </div>
        ))}
      </div>
    </DetailSection>
  );
}

function EmptyState({
  icon: Icon,
  label,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <div className="flex min-h-28 min-w-0 flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border px-3 text-center text-muted-foreground">
      <Icon className="h-5 w-5" />
      <div className="mt-2 text-sm">{label}</div>
    </div>
  );
}

function IconButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button outlined size="xs" onClick={onClick} title={label} aria-label={label}>
      <Icon className="h-3.5 w-3.5" />
    </Button>
  );
}

function TaskActionIconButton({
  disabled = false,
  icon: Icon,
  label,
  onClick,
  tone = "default",
}: {
  disabled?: boolean;
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  tone?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        if (disabled) return;
        onClick();
      }}
      className={cn(
        "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border/70 bg-black/10 text-muted-foreground transition-colors hover:border-midground/50 hover:text-midground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-success disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border/70 disabled:hover:text-muted-foreground",
        tone === "danger" && "border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}
