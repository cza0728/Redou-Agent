import { Button } from "@nous-research/ui/ui/components/button";
import {
  AlertCircle,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  Code2,
  Copy,
  CornerDownRight,
  FileText,
  Image as ImageIcon,
  Info,
  ListPlus,
  Paperclip,
  Loader2,
  MessageSquare,
  PanelRight,
  Play,
  Send,
  Square,
  Target,
  Upload,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";

import { ChatTaskToolbar } from "@/components/ChatTaskToolbar";
import { ProjectTaskPanel } from "@/components/ProjectTaskPanel";
import { usePageHeader } from "@/contexts/usePageHeader";
import { useI18n } from "@/i18n";
import { CHAT_PROJECTS_CHANGED_EVENT, redouApi } from "@/lib/api";
import type {
  AgentEvent,
  BuiltContext,
  ChatAttachment,
  ChatProject,
  ChatTask,
  ChatTaskMessage,
  RiskApprovalDecision,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const CHAT_DRAFT_KEY = "redou-agent-chat-draft";
const LOCAL_CHANNEL = "redou-local-chat";
const CHAT_SCROLL_BOTTOM_THRESHOLD = 48;
const CHAT_SCROLL_SETTLE_DELAY_MS = 700;
const CHAT_COMPOSER_MIN_HEIGHT = 96;
const CHAT_COMPOSER_DEFAULT_HEIGHT = 96;
const CHAT_COMPOSER_MAX_HEIGHT = 520;
const CHAT_COMPOSER_VIEWPORT_MAX_RATIO = 0.48;
const CHAT_COMPOSER_RESIZE_STEP = 24;

function clampChatComposerHeight(height: number): number {
  const viewportMax =
    typeof window === "undefined"
      ? CHAT_COMPOSER_MAX_HEIGHT
      : Math.floor(window.innerHeight * CHAT_COMPOSER_VIEWPORT_MAX_RATIO);
  const maxHeight = Math.max(
    CHAT_COMPOSER_MIN_HEIGHT,
    Math.min(CHAT_COMPOSER_MAX_HEIGHT, viewportMax),
  );
  return Math.min(Math.max(Math.round(height), CHAT_COMPOSER_MIN_HEIGHT), maxHeight);
}

type RunState = "idle" | "loading" | "thinking" | "running" | "done" | "error" | "interrupted";
type DeliveryMode = "queue" | "guide";
type RunMode = "execute" | "plan";
type TodoPlanStatus = "pending" | "in_progress" | "completed" | "cancelled";

function isChatScrolledToBottom(node: HTMLElement): boolean {
  return node.scrollHeight - node.scrollTop - node.clientHeight <= CHAT_SCROLL_BOTTOM_THRESHOLD;
}

interface TodoPlanItem {
  id: string;
  content: string;
  status: TodoPlanStatus;
}

interface TodoPlan {
  items: TodoPlanItem[];
  updatedAt?: string;
}

interface TodoPlanUpdate extends TodoPlan {
  merge: boolean;
}

interface PlanReview {
  id: string;
  content: string;
  request: string;
  createdAt: string;
}

interface QueuedInput {
  id: string;
  content: string;
  createdAt: string;
  runMode: RunMode;
  attachments: ChatAttachment[];
}

interface ChatPermissions {
  runtime_approval_enabled?: boolean;
  approval_timeout_seconds?: number;
  prefilter_user_input?: boolean;
}

const CHAT_COPY = {
  zh: {
    projects: "项目",
    close: "关闭",
    selectTask: "选择任务",
    noProject: "未选择项目",
    noProfile: "无配置档",
    currentContext: "当前上下文",
    selectProjectTaskBeforeSending: "请先选择项目和任务，再发送消息。",
    desktopFilePickerUnavailable: "桌面文件选择器不可用。",
    droppedFilesUnavailable: "拖入的文件无法解析为本地路径。",
    status: {
      thinking: "思考中",
      running: "运行中",
      loading: "加载中",
      error: "错误",
      interrupted: "已中断",
      done: "完成",
      idle: "空闲",
    },
    mode: {
      queue: "排队",
      guide: "引导",
      queueTitle: "排到当前任务完成后执行",
      guideTitle: "插入到当前运行中的后续步骤",
      queued: (count: number) => `${count} 条排队中`,
    },
    goalMode: {
      label: "持续目标模式",
      title: "使用 Hermes goal 模式：每轮结束检查目标，未完成则继续，直到完成或达到最大续跑轮数",
      disabledTitle: "先计划模式不会激活持续目标模式",
    },
    queuedInput: {
      title: "已排队",
      detail: "当前运行完成后发送",
      guide: "引导",
      guideTitle: "改为引导当前运行",
      guideDisabled: "只有无附件的执行消息可以改为引导",
      delete: "删除",
      deleteTitle: "从队列中删除这条消息",
    },
    runMode: {
      execute: "执行",
      plan: "先计划",
      executeTitle: "直接执行这一轮请求",
      planTitle: "先生成计划，确认后再执行",
    },
    planReview: {
      title: "计划待确认",
      detail: "Redou 这轮只生成计划。确认后才会开始执行。",
      execute: "执行此计划",
      adjust: "调整计划",
      dismiss: "先不执行",
      adjustDraft: "请基于上面的计划做这些调整：",
      executePrompt: (plan: string, request: string) =>
        `请按下面已经确认的计划执行。\n\n原始需求：\n${request || "(无)"}\n\n已确认计划：\n${plan}\n\n执行要求：按计划推进；如果发现计划已经不适用，先停下来说明需要调整的地方。`,
    },
    send: {
      default: "发送",
      message: "发送消息",
      images: "发送图片",
      files: "发送文件",
      imagesAndFiles: "发送图片和文件",
    },
    skippedLines: (count: number) => `读取此任务时跳过了 ${count} 行消息。`,
    newTask: "新任务",
    emptyTitle: "未选择任务",
    emptyDetail: "选择一个任务以查看消息。",
    newTaskDetail: "发送第一条消息来开始这个任务。",
    assistantWorking: "助手正在工作...",
    jumpToLatest: "滚动到最新消息",
    dropFiles: "松开以添加文件",
    loadingTaskHistory: "正在加载任务历史...",
    askPlaceholder: "询问 Redou Agent...",
    selectProjectTaskFirst: "请先选择项目和任务",
    attachFiles: "添加图片或文件",
    stopRun: "停止当前运行",
    guideHint: "Enter 引导，Shift+Enter 换行。",
    sendHint: "Enter 发送，Shift+Enter 换行。",
    roleYou: "你",
    roleAssistant: "助手",
    code: "代码",
    copied: "已复制",
    copy: "复制",
    rawLogHidden: "原始日志已折叠",
    longOutputHidden: "长输出已折叠",
    highRiskTitle: "需要确认高风险操作",
    highRiskDetail: (reason: string) =>
      `检测到${reason}。仅在这个任务确实应该执行破坏性或系统级操作时确认。`,
    cancel: "取消",
    confirmAndSend: "确认并发送",
    contextUsage: "任务上下文用量",
    tokens: "tokens",
    autoCompressed: (before: string, after: string) =>
      `已自动压缩：${before} → ${after} tokens。`,
    loaded: "已加载",
    notLoaded: "未加载",
    includedFiles: (count: number) => `包含文件 (${count})`,
    candidateTitle: (target: string) => `${target} 候选规则`,
    candidateSummary: (target: string) => `发现 1 条 ${target} 候选规则`,
    candidateView: "查看",
    candidateCollapse: "收起",
    candidateDismiss: "忽略",
    confirmTarget: (target: string) => `确认写入 ${target}`,
    contextLabels: {
      project: "项目",
      task: "任务",
      hermesProfile: "Hermes 配置档",
      globalRules: "全局规则",
      userPreferences: "用户偏好",
      globalMemory: "全局记忆",
      projectRules: "项目规则",
      taskRules: "任务规则",
      taskContext: "任务上下文",
      recentMessages: "最近消息",
      attachments: "附件",
      images: "图片",
      contextChars: "上下文字符数",
    },
    riskReasons: {
      "recursive delete": "递归删除",
      "directory deletion": "目录删除",
      "disk formatting": "磁盘格式化",
      "system configuration change": "系统配置变更",
      "bulk overwrite": "批量覆盖",
      "inline script": "内联脚本执行",
      "remote script pipe": "远程脚本管道执行",
      "dangerous shell command": "危险 shell 命令",
    },
  },
  en: {
    projects: "Projects",
    close: "Close",
    selectTask: "Select a task",
    noProject: "No project",
    noProfile: "no profile",
    currentContext: "Current context",
    selectProjectTaskBeforeSending: "Select a Project and Task before sending.",
    desktopFilePickerUnavailable: "Desktop file picker is unavailable.",
    droppedFilesUnavailable: "Dropped files could not be resolved to local paths.",
    status: {
      thinking: "thinking",
      running: "running",
      loading: "loading",
      error: "error",
      interrupted: "interrupted",
      done: "done",
      idle: "idle",
    },
    mode: {
      queue: "Queue",
      guide: "Guide",
      queueTitle: "Run after the current task turn finishes",
      guideTitle: "Steer the active run on its next step",
      queued: (count: number) => `${count} queued`,
    },
    goalMode: {
      label: "Goal mode",
      title: "Use Hermes goal mode: after each turn Hermes checks the objective and continues until done or the turn budget is exhausted",
      disabledTitle: "Plan-first turns do not activate persistent goal mode",
    },
    queuedInput: {
      title: "Queued",
      detail: "Sends after the current run",
      guide: "Guide",
      guideTitle: "Convert to guidance for the active run",
      guideDisabled: "Only text-only execute messages can become guidance",
      delete: "Delete",
      deleteTitle: "Remove this message from the queue",
    },
    runMode: {
      execute: "Execute",
      plan: "Plan first",
      executeTitle: "Run this request directly",
      planTitle: "Generate a plan first, then wait for confirmation",
    },
    planReview: {
      title: "Plan awaiting confirmation",
      detail: "Redou only planned this turn. Execution starts after you confirm.",
      execute: "Execute this plan",
      adjust: "Adjust plan",
      dismiss: "Not now",
      adjustDraft: "Please revise the plan above with these changes:",
      executePrompt: (plan: string, request: string) =>
        `Please execute the confirmed plan below.\n\nOriginal request:\n${request || "(none)"}\n\nConfirmed plan:\n${plan}\n\nExecution instructions: follow the plan; if it is no longer valid, stop and explain what needs to change before continuing.`,
    },
    send: {
      default: "Send",
      message: "Send message",
      images: "Send images",
      files: "Send files",
      imagesAndFiles: "Send images and files",
    },
    skippedLines: (count: number) =>
      `${count} message line(s) were skipped while reading this task.`,
    newTask: "New task",
    emptyTitle: "No task selected",
    emptyDetail: "Select a task to view its messages.",
    newTaskDetail: "Send the first message to start this task.",
    assistantWorking: "Assistant is working...",
    jumpToLatest: "Scroll to latest message",
    dropFiles: "Drop files to attach",
    loadingTaskHistory: "Loading task history...",
    askPlaceholder: "Ask Redou Agent...",
    selectProjectTaskFirst: "Select a Project and Task first",
    attachFiles: "Attach images or files",
    stopRun: "Stop current run",
    guideHint: "Enter guides, Shift+Enter adds a line.",
    sendHint: "Enter sends, Shift+Enter adds a line.",
    roleYou: "You",
    roleAssistant: "Assistant",
    code: "code",
    copied: "copied",
    copy: "copy",
    rawLogHidden: "Raw log hidden",
    longOutputHidden: "Long output hidden",
    highRiskTitle: "High-risk action confirmation required",
    highRiskDetail: (reason: string) =>
      `Detected ${reason}. Confirm only if this task should be allowed to perform the requested destructive or system-level operation.`,
    cancel: "Cancel",
    confirmAndSend: "Confirm and send",
    contextUsage: "Task context usage",
    tokens: "tokens",
    autoCompressed: (before: string, after: string) =>
      `Auto-compressed from ${before} to ${after} tokens.`,
    loaded: "loaded",
    notLoaded: "not loaded",
    includedFiles: (count: number) => `includedFiles (${count})`,
    candidateTitle: (target: string) => `${target} Candidate`,
    candidateSummary: (target: string) => `1 ${target} candidate rule found`,
    candidateView: "View",
    candidateCollapse: "Collapse",
    candidateDismiss: "Dismiss",
    confirmTarget: (target: string) => `Confirm ${target}`,
    contextLabels: {
      project: "Project",
      task: "Task",
      hermesProfile: "hermesProfile",
      globalRules: "Global Rules",
      userPreferences: "User Preferences",
      globalMemory: "Global Memory",
      projectRules: "Project Rules",
      taskRules: "Task Rules",
      taskContext: "Task Context",
      recentMessages: "Recent messages",
      attachments: "Attachments",
      images: "Images",
      contextChars: "Context chars",
    },
    riskReasons: {
      "recursive delete": "recursive delete",
      "directory deletion": "directory deletion",
      "disk formatting": "disk formatting",
      "system configuration change": "system configuration change",
      "bulk overwrite": "bulk overwrite",
      "inline script": "inline script execution",
      "remote script pipe": "remote script pipe execution",
      "dangerous shell command": "dangerous shell command",
    },
  },
} as const;

type ChatCopy = (typeof CHAT_COPY)["zh"] | (typeof CHAT_COPY)["en"];

function readPendingChatDraft(): string {
  if (typeof window === "undefined") return "";
  const raw = window.sessionStorage.getItem(CHAT_DRAFT_KEY);
  if (!raw) return "";
  window.sessionStorage.removeItem(CHAT_DRAFT_KEY);
  return raw.trim();
}

function eventMessage(event: AgentEvent): ChatTaskMessage {
  const content =
    "content" in event && typeof event.content === "string"
      ? event.content
      : "message" in event && typeof event.message === "string"
        ? event.message
        : "command" in event && typeof event.command === "string"
          ? event.command
          : "name" in event && typeof event.name === "string"
            ? event.name
            : event.type;
  return {
    role: event.type === "assistant_message" ? "assistant" : "event",
    content,
    createdAt: new Date().toISOString(),
    metadata: { event, eventType: event.type },
    attachments: [],
  };
}

function latestAssistant(messages: ChatTaskMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const item = messages[index];
    if (item.role === "assistant" && item.content.trim()) return item.content;
  }
  return "";
}

function makeRuleCandidate(
  project: ChatProject | null,
  task: ChatTask | null,
  messages: ChatTaskMessage[],
): { scope: "project" | "task"; content: string } | null {
  const assistant = latestAssistant(messages);
  if (!assistant || !project || !task) return null;
  const stableSignal = assistant
    .split(/\n+/)
    .map((line) => line.trim())
    .find((line) => /^[-*]\s+/.test(line) || /remember|preference|always|never/i.test(line));
  if (!stableSignal) return null;
  const text = stableSignal.replace(/^[-*]\s+/, "").slice(0, 600);
  const scope = /project|\u672c\u9879\u76ee|\u5f53\u524d\u9879\u76ee|\u9879\u76ee/i.test(text) ? "project" : "task";
  return {
    scope,
    content: [
      `- Candidate ${scope} rule:`,
      `  ${text}`,
      `  Source: ${project.name} / ${task.title}`,
    ].join("\n"),
  };
}

function detectHighRiskRequest(value: string): string | null {
  const text = value.toLowerCase();
  const patterns = [
    { re: /\brm\s+-rf\b|\brmdir\s+\/s\b|\bremove-item\b.*\b-recurse\b/, label: "recursive delete" },
    { re: /\bdel(?:ete)?\b.*\b(directory|folder|repo|project)\b/, label: "directory deletion" },
    { re: /\bformat\b|\bdiskpart\b|\bmkfs\b/, label: "disk formatting" },
    { re: /\b(reg\s+add|setx|system32|group policy|registry)\b/, label: "system configuration change" },
    { re: /\b(overwrite|replace)\b.*\b(all|many|entire|whole)\b/, label: "bulk overwrite" },
    { re: /\b(node|python|python3|py|ruby|perl)\s+-[ec]\b|\bpowershell(?:\.exe)?\s+-(command|encodedcommand)\b/, label: "inline script" },
    { re: /\b(curl|wget|irm|iwr|invoke-webrequest|invoke-restmethod)\b[\s\S]{0,120}\|\s*(sh|bash|zsh|pwsh|powershell)\b/, label: "remote script pipe" },
    { re: /:\(\)\s*\{\s*:\|:&\s*\};:/, label: "dangerous shell command" },
  ];
  return patterns.find((item) => item.re.test(text))?.label ?? null;
}

function isImageAttachment(attachment: ChatAttachment): boolean {
  return /^image\//i.test(attachment.mimeType || "");
}

function fileUrlFromPath(filePath?: string): string | null {
  const raw = String(filePath || "").trim();
  if (!raw) return null;
  const normalized = raw.replace(/\\/g, "/");
  const encoded = normalized
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/^([A-Za-z])%3A$/, "$1:"))
    .join("/");
  const withLead = /^[A-Za-z]:\//.test(normalized) ? `/${encoded}` : encoded;
  return `file://${withLead}`;
}

function attachmentPreviewUrl(attachment: ChatAttachment): string | null {
  if (!isImageAttachment(attachment)) return null;
  return fileUrlFromPath(attachment.storedPath || attachment.originalPath);
}

function attachmentSendText(attachments: ChatAttachment[], copy: ChatCopy): string {
  const imageCount = attachments.filter(isImageAttachment).length;
  const fileCount = attachments.length - imageCount;
  if (imageCount > 0 && fileCount > 0) return copy.send.imagesAndFiles;
  if (imageCount > 0) return copy.send.images;
  if (fileCount > 0) return copy.send.files;
  return copy.send.default;
}

function formatCompactCount(value?: number | null): string {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return "0";
  if (number >= 1000000) return `${(number / 1000000).toFixed(1)}M`;
  if (number >= 1000) return `${(number / 1000).toFixed(1)}K`;
  return String(Math.round(number));
}

function formatContextPercent(value?: number | null): string {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0%";
  return `${number.toFixed(number >= 10 ? 0 : 1)}%`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function permissionsFromConfig(config: Record<string, unknown>): ChatPermissions {
  const raw = config.permissions;
  if (!isRecord(raw)) return {};
  const timeout = Number(raw.approval_timeout_seconds);
  return {
    runtime_approval_enabled: raw.runtime_approval_enabled !== false,
    prefilter_user_input: raw.prefilter_user_input !== false,
    approval_timeout_seconds: Number.isFinite(timeout) ? timeout : undefined,
  };
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

function normalizeTodoStatus(value: unknown): TodoPlanStatus {
  const status = String(value || "pending").trim().toLowerCase();
  if (status === "completed" || status === "in_progress" || status === "cancelled") return status;
  return "pending";
}

function todoItemsFromPayload(value: unknown): TodoPlanItem[] {
  const payload = parseJsonish(value);
  const rawTodos = isRecord(payload) ? payload.todos : Array.isArray(payload) ? payload : null;
  if (!Array.isArray(rawTodos)) return [];
  return rawTodos
    .map((item, index) => {
      if (!isRecord(item)) return null;
      const content = String(item.content || "").trim();
      if (!content) return null;
      return {
        id: String(item.id || index + 1).trim() || String(index + 1),
        content,
        status: normalizeTodoStatus(item.status),
      };
    })
    .filter((item): item is TodoPlanItem => item !== null);
}

function todoUpdateFromPayload(value: unknown, updatedAt?: string): TodoPlanUpdate | null {
  const payload = parseJsonish(value);
  const items = todoItemsFromPayload(payload);
  if (!items.length) return null;
  return {
    items,
    updatedAt,
    merge: isRecord(payload) && payload.merge === true,
  };
}

function todoUpdatesFromRawLog(content: string, updatedAt?: string): TodoPlanUpdate[] {
  const updates: TodoPlanUpdate[] = [];
  const marker = /^\[(tool_start|tool_output)\]\s+todo\b.*$/gm;
  while (marker.exec(content) !== null) {
    const start = marker.lastIndex;
    const rest = content.slice(start);
    const nextMarker = rest.search(/^\[[a-z_]+\]/m);
    const payload = rest.slice(0, nextMarker >= 0 ? nextMarker : undefined).trim();
    const update = todoUpdateFromPayload(payload, updatedAt);
    if (update) updates.push(update);
  }
  return updates;
}

function todoUpdatesFromMessage(message: ChatTaskMessage): TodoPlanUpdate[] {
  const event = eventFromMessage(message);
  // run_stage events are runtime progress for Task Details, not user-authored todos.
  if (event?.type === "tool_start" && event.name === "todo") {
    const update = todoUpdateFromPayload(event.input, message.createdAt);
    return update ? [update] : [];
  }
  if (event?.type === "tool_output" && event.name === "todo") {
    const update = todoUpdateFromPayload(event.output, message.createdAt);
    return update ? [update] : [];
  }
  if (event?.type === "raw_log") {
    return todoUpdatesFromRawLog(event.content || message.content, message.createdAt);
  }
  if (message.role === "event" && message.content) {
    return todoUpdatesFromRawLog(message.content, message.createdAt);
  }
  return [];
}

function applyTodoPlanUpdate(current: TodoPlan | null, update: TodoPlanUpdate): TodoPlan {
  if (!update.merge || !current) {
    return { items: update.items, updatedAt: update.updatedAt };
  }

  const byId = new Map(current.items.map((item) => [item.id, item]));
  for (const item of update.items) {
    byId.set(item.id, item);
  }
  const existingIds = new Set(current.items.map((item) => item.id));
  return {
    updatedAt: update.updatedAt,
    items: [
      ...current.items.map((item) => byId.get(item.id) ?? item),
      ...update.items.filter((item) => !existingIds.has(item.id)),
    ],
  };
}

function latestTodoPlanFromMessages(messages: ChatTaskMessage[]): TodoPlan | null {
  let plan: TodoPlan | null = null;
  for (const message of messages) {
    if (message.role === "user") {
      plan = null;
      continue;
    }
    for (const update of todoUpdatesFromMessage(message)) {
      plan = applyTodoPlanUpdate(plan, update);
    }
  }
  return plan?.items.length ? plan : null;
}

function messageRunMode(message: ChatTaskMessage): RunMode {
  const event = eventFromMessage(message);
  const metadata = eventMetadata(event);
  const messageMetadata = message.metadata && typeof message.metadata === "object" ? message.metadata : {};
  const value = metadata.runMode ?? messageMetadata.runMode;
  return value === "plan" ? "plan" : "execute";
}

function latestPlanReviewFromMessages(messages: ChatTaskMessage[]): PlanReview | null {
  let lastUserRequest = "";
  let review: PlanReview | null = null;
  for (const message of messages) {
    if (message.role === "user") {
      lastUserRequest = message.content.trim();
      review = null;
      continue;
    }
    if (message.role !== "assistant" || messageRunMode(message) !== "plan") continue;
    const content = message.content.trim();
    if (!content) continue;
    const event = eventFromMessage(message);
    const metadata = eventMetadata(event);
    const runId = typeof metadata.runId === "string" ? metadata.runId : "";
    review = {
      id: runId || `${message.createdAt}:${content.slice(0, 48)}`,
      content,
      request: lastUserRequest,
      createdAt: message.createdAt,
    };
  }
  return review;
}

function metadataNumber(metadata: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const raw = metadata[key];
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string" && raw.trim()) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function timestampMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function metadataTimestampMs(metadata: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const parsed = timestampMs(metadata[key]);
    if (parsed != null) return parsed;
  }
  return null;
}

function formatTurnDuration(durationMs: number): string {
  const seconds = Math.max(0, durationMs / 1000);
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${String(remainder).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  const minuteRemainder = minutes % 60;
  return `${hours}h ${String(minuteRemainder).padStart(2, "0")}m`;
}

function formatTurnCost(cost: number): string {
  if (cost >= 1) return `$${cost.toFixed(2)}`;
  if (cost >= 0.01) return `$${cost.toFixed(3)}`;
  if (cost >= 0.0001) return `$${cost.toFixed(4)}`;
  if (cost > 0) return "<$0.0001";
  return "$0";
}

function durationMsFromMetadata(metadata: Record<string, unknown>): number | null {
  return (
    metadataNumber(metadata, ["durationMs", "duration_ms", "elapsedMs", "elapsed_ms"]) ??
    (() => {
      const durationSeconds = metadataNumber(metadata, [
        "durationSeconds",
        "duration_seconds",
        "elapsedSeconds",
        "elapsed_seconds",
      ]);
      return durationSeconds == null ? null : durationSeconds * 1000;
    })()
  );
}

function turnUsageSummary(metadata: Record<string, unknown>, copy: ChatCopy): { parts: string[]; title: string } | null {
  const durationMs = durationMsFromMetadata(metadata);
  const inputTokens = metadataNumber(metadata, ["inputTokens", "input_tokens"]) ?? 0;
  const outputTokens = metadataNumber(metadata, ["outputTokens", "output_tokens"]) ?? 0;
  const cacheReadTokens = metadataNumber(metadata, ["cacheReadTokens", "cache_read_tokens"]) ?? 0;
  const cacheWriteTokens = metadataNumber(metadata, ["cacheWriteTokens", "cache_write_tokens"]) ?? 0;
  const reasoningTokens = metadataNumber(metadata, ["reasoningTokens", "reasoning_tokens"]) ?? 0;
  const tokenTotal = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
  const displayTokens = tokenTotal > 0 ? tokenTotal : reasoningTokens;
  const estimatedCost = metadataNumber(metadata, ["estimatedCostUsd", "estimated_cost_usd", "actualCostUsd", "actual_cost_usd"]);

  const parts = [
    durationMs == null ? "" : formatTurnDuration(durationMs),
    displayTokens > 0 ? `${formatCompactCount(displayTokens)} ${copy.tokens}` : "",
    estimatedCost == null ? "" : formatTurnCost(estimatedCost),
  ].filter(Boolean);
  if (parts.length === 0) return null;

  const details = [
    durationMs == null ? "" : `time ${formatTurnDuration(durationMs)}`,
    inputTokens > 0 ? `input ${formatCompactCount(inputTokens)}` : "",
    outputTokens > 0 ? `output ${formatCompactCount(outputTokens)}` : "",
    cacheReadTokens > 0 ? `cache read ${formatCompactCount(cacheReadTokens)}` : "",
    cacheWriteTokens > 0 ? `cache write ${formatCompactCount(cacheWriteTokens)}` : "",
    estimatedCost == null ? "" : `cost ${formatTurnCost(estimatedCost)}`,
  ].filter(Boolean);

  return { parts, title: details.join(" | ") || parts.join(" | ") };
}

function withDurationFallback(event: AgentEvent, message: ChatTaskMessage, startedAtMs?: number): AgentEvent {
  if (event.type !== "done") return event;
  const metadata = eventMetadata(event);
  if (durationMsFromMetadata(metadata) != null) return event;
  const completedAtMs =
    metadataTimestampMs(metadata, ["completedAt", "completed_at", "finishedAt", "finished_at", "endedAt", "ended_at"]) ??
    timestampMs(message.createdAt);
  if (startedAtMs == null || completedAtMs == null || completedAtMs < startedAtMs) return event;
  const durationMs = completedAtMs - startedAtMs;
  return {
    ...event,
    metadata: {
      ...metadata,
      startedAt: metadata.startedAt ?? new Date(startedAtMs).toISOString(),
      completedAt: metadata.completedAt ?? new Date(completedAtMs).toISOString(),
      durationMs,
      durationSeconds: Math.round(durationMs / 100) / 10,
    },
  };
}

function eventFromMessage(message: ChatTaskMessage): AgentEvent | null {
  const event = message.metadata?.event;
  if (event && typeof event === "object" && "type" in event) {
    return event as AgentEvent;
  }
  return null;
}

function eventMetadata(event: AgentEvent | null): Record<string, unknown> {
  return event?.metadata && typeof event.metadata === "object" ? event.metadata : {};
}

function truthyFailureText(value: unknown): string {
  if (value == null || value === false) return "";
  const text = typeof value === "string" ? value.trim() : JSON.stringify(value);
  return !text || text === "false" || text === "null" ? "" : text;
}

function runStateFromDoneEvent(event: AgentEvent): RunState {
  const metadata = eventMetadata(event);
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
    return "interrupted";
  }
  if (
    metadata.failed === true ||
    truthyFailureText(metadata.error) ||
    truthyFailureText(metadata.failure) ||
    truthyFailureText(metadata.exception) ||
    (metadata.completed === false && /max_iterations|error|failed|failure|exception|invalid/.test(turnExitReason)) ||
    (Number.isFinite(exitCode) && exitCode !== 0)
  ) {
    return "error";
  }
  return "done";
}

function isRiskApprovalEvent(event: AgentEvent | null): boolean {
  return !!event && (
    event.type === "risk_approval_required" ||
    event.type === "risk_approval_allowed" ||
    event.type === "risk_approval_denied" ||
    event.type === "risk_approval_timeout" ||
    event.type === "risk_approval_invalid" ||
    event.type === "risk_approval_decision_submitted" ||
    event.type === "high_risk_command_blocked" ||
    event.type === "high_risk_command_auto_allowed"
  );
}

function riskApprovalId(event: AgentEvent | null): string {
  if (!event || !("approvalId" in event)) return "";
  return String(event.approvalId || "").trim();
}

function mergeRiskApprovalMessage(existing: ChatTaskMessage, update: AgentEvent): ChatTaskMessage {
  const currentEvent = eventFromMessage(existing);
  if (!currentEvent || currentEvent.type !== "risk_approval_required") return existing;
  const nextEvent: AgentEvent = {
    ...currentEvent,
    metadata: {
      ...eventMetadata(currentEvent),
      approvalStatus: update.type,
      approvalDecision: "decision" in update ? update.decision : undefined,
      approvalUpdate: update,
      approvalUpdatedAt: new Date().toISOString(),
    },
  };
  return {
    ...existing,
    metadata: {
      ...existing.metadata,
      event: nextEvent,
      eventType: nextEvent.type,
    },
  };
}

function messageMetadata(message: ChatTaskMessage): Record<string, unknown> {
  return message.metadata && typeof message.metadata === "object" ? message.metadata : {};
}

function inputEnvelopeFromMessage(message: ChatTaskMessage): Record<string, unknown> | null {
  const envelope = messageMetadata(message).inputEnvelope;
  return isRecord(envelope) ? envelope : null;
}

function queuedInputFromMessage(message: ChatTaskMessage): QueuedInput | null {
  if (message.role !== "user") return null;
  const metadata = messageMetadata(message);
  const envelope = inputEnvelopeFromMessage(message);
  const deliveryMode = String(metadata.deliveryMode ?? envelope?.deliveryMode ?? "").trim().toLowerCase();
  const status = String(envelope?.status ?? metadata.status ?? "pending").trim().toLowerCase();
  const id = String(metadata.queueId ?? envelope?.id ?? "").trim();
  if (deliveryMode !== "queue" || status !== "pending" || !id) return null;
  return {
    id,
    content: message.content,
    createdAt: message.createdAt,
    runMode: metadata.runMode === "plan" ? "plan" : "execute",
    attachments: Array.isArray(message.attachments) ? message.attachments : [],
  };
}

function isPendingQueuedInputMessage(message: ChatTaskMessage): boolean {
  return queuedInputFromMessage(message) !== null;
}

function isQueueBookkeepingMessage(message: ChatTaskMessage): boolean {
  const event = eventFromMessage(message);
  return event?.type === "queue_update" && Boolean(eventMetadata(event).queueState);
}

function messageDisplayTimestampMs(message: ChatTaskMessage): number {
  const metadata = messageMetadata(message);
  const envelope = inputEnvelopeFromMessage(message);
  const deliveryMode = String(metadata.deliveryMode ?? envelope?.deliveryMode ?? "").trim().toLowerCase();
  const consumedAt = deliveryMode === "queue" ? timestampMs(envelope?.consumedAt) : null;
  return consumedAt ?? timestampMs(message.createdAt) ?? 0;
}

function visibleChatMessages(messages: ChatTaskMessage[]): ChatTaskMessage[] {
  return messages
    .map((message, index) => ({ message, index, timestamp: messageDisplayTimestampMs(message) }))
    .filter((item) => !isPendingQueuedInputMessage(item.message) && !isQueueBookkeepingMessage(item.message))
    .sort((a, b) => a.timestamp - b.timestamp || a.index - b.index)
    .map((item) => item.message);
}

function queuedInputsFromMessages(messages: ChatTaskMessage[]): QueuedInput[] {
  const byId = new Map<string, QueuedInput>();
  for (const message of messages) {
    const queued = queuedInputFromMessage(message);
    if (queued) byId.set(queued.id, queued);
  }
  return Array.from(byId.values()).sort(
    (a, b) => (timestampMs(a.createdAt) ?? 0) - (timestampMs(b.createdAt) ?? 0),
  );
}

function removeQueuedInputMessage(messages: ChatTaskMessage[], queueId: string): ChatTaskMessage[] {
  return messages.filter((message) => queuedInputFromMessage(message)?.id !== queueId);
}

function markQueuedInputMessageStarted(
  messages: ChatTaskMessage[],
  queueId: string,
  runId: string | undefined,
): ChatTaskMessage[] {
  const consumedAt = new Date().toISOString();
  return messages.map((message) => {
    if (queuedInputFromMessage(message)?.id !== queueId) return message;
    const metadata = messageMetadata(message);
    const envelope = inputEnvelopeFromMessage(message);
    return {
      ...message,
      metadata: {
        ...metadata,
        ...(runId ? { runId } : {}),
        inputEnvelope: {
          ...(envelope ?? {}),
          ...(runId ? { runId } : {}),
          status: "consumed",
          consumedAt,
        },
      },
    };
  });
}

function eventRunKey(event: AgentEvent | null, message: ChatTaskMessage): string {
  const metadata = eventMetadata(event);
  const messageMetadata = message.metadata && typeof message.metadata === "object" ? message.metadata : {};
  const candidate = metadata.runId ?? messageMetadata.runId ?? metadata.hermesSessionId ?? messageMetadata.hermesSessionId;
  return typeof candidate === "string" || typeof candidate === "number" ? String(candidate) : "";
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function formatLogValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatEventForRawLog(event: AgentEvent, message: ChatTaskMessage): string {
  switch (event.type) {
    case "raw_log":
      return event.content || message.content;
    case "command_start":
      return [`[command_start] ${event.command}`, event.cwd ? `cwd: ${event.cwd}` : ""].filter(Boolean).join("\n");
    case "command_output":
      return `[command_output]\n${event.content || message.content}`;
    case "command_end":
      return `[command_end] ${event.success ? "completed" : "failed"}${
        event.exitCode == null ? "" : ` (exit ${event.exitCode})`
      }`;
    case "tool_start":
      return [`[tool_start] ${event.name}`, formatLogValue(event.input)].filter(Boolean).join("\n");
    case "tool_output":
      return [`[tool_output] ${event.name}`, formatLogValue(event.output)].filter(Boolean).join("\n");
    case "tool_end":
      return `[tool_end] ${event.name}: ${event.success ? "completed" : "failed"}`;
    case "file_changed":
      return [`[file_changed] ${event.path}`, event.summary || "", event.changeType ? `changeType: ${event.changeType}` : ""]
        .filter(Boolean)
        .join("\n");
    case "queue_update":
      return event.message || `[queue] ${event.queued} queued`;
    case "run_stage":
      return [`[run_stage] ${event.label || event.stage || "stage"}`, event.status ? `status: ${event.status}` : "", event.details || ""]
        .filter(Boolean)
        .join("\n");
    case "risk_approval_required":
      return [
        "[risk_approval_required]",
        event.reason ? `reason: ${event.reason}` : "",
        event.cwd ? `cwd: ${event.cwd}` : "",
        event.command ? `command: ${event.command}` : "",
      ].filter(Boolean).join("\n");
    case "risk_approval_allowed":
    case "risk_approval_denied":
    case "risk_approval_timeout":
    case "risk_approval_invalid":
    case "risk_approval_decision_submitted":
    case "high_risk_command_blocked":
    case "high_risk_command_auto_allowed":
      return [
        `[${event.type}]`,
        event.decision ? `decision: ${event.decision}` : "",
        event.reason ? `reason: ${event.reason}` : "",
        event.command ? `command: ${event.command}` : "",
      ].filter(Boolean).join("\n");
    case "error":
      return [`[error] ${event.message}`, event.details || ""].filter(Boolean).join("\n");
    case "done":
      return runStateFromDoneEvent(event) === "interrupted"
        ? "[done] This turn was interrupted."
        : runStateFromDoneEvent(event) === "error"
          ? "[done] This turn ended with an error."
          : "[done] This turn finished.";
    case "assistant_message":
    case "assistant_delta":
      return event.content || message.content;
  }
}

function rawLogMessageFromEvent(message: ChatTaskMessage, event: AgentEvent): ChatTaskMessage | null {
  const content = formatEventForRawLog(event, message).trim();
  if (!content) return null;
  const rawEvent: AgentEvent = {
    type: "raw_log",
    content,
    metadata: eventMetadata(event),
  };
  return {
    ...message,
    role: "event",
    content,
    metadata: {
      ...message.metadata,
      event: rawEvent,
      eventType: "raw_log",
      foldedEventType: event.type,
    },
  };
}

function isPseudoThinkingEvent(event: AgentEvent | null): event is Extract<AgentEvent, { type: "tool_start" | "tool_output" | "tool_end" }> {
  return (
    !!event &&
    (event.type === "tool_start" || event.type === "tool_output" || event.type === "tool_end") &&
    event.name === "_thinking"
  );
}

function pseudoThinkingContent(event: Extract<AgentEvent, { type: "tool_start" | "tool_output" | "tool_end" }>, message: ChatTaskMessage): string {
  if (event.type === "tool_output") {
    return typeof event.output === "string" ? event.output : JSON.stringify(event.output ?? "", null, 2);
  }
  if (event.type === "tool_start" && typeof event.input === "string") return event.input;
  return message.content;
}

function hasEquivalentAssistant(
  messages: ChatTaskMessage[],
  currentIndex: number,
  content: string,
  runKey: string,
): boolean {
  const normalized = normalizedText(content);
  if (!normalized) return false;
  return messages.some((candidate, index) => {
    if (index === currentIndex || candidate.role !== "assistant") return false;
    const event = eventFromMessage(candidate);
    if (isPseudoThinkingEvent(event)) return false;
    const candidateRunKey = eventRunKey(event, candidate);
    if (runKey && candidateRunKey && runKey !== candidateRunKey) return false;
    return normalizedText(candidate.content) === normalized;
  });
}

function mergeRawLogMessage(existing: ChatTaskMessage, incoming: ChatTaskMessage, event: Extract<AgentEvent, { type: "raw_log" }>): ChatTaskMessage {
  const existingEvent = eventFromMessage(existing);
  const existingContent =
    existingEvent?.type === "raw_log" && existingEvent.content ? existingEvent.content : existing.content;
  const nextContent = [existingContent, event.content || incoming.content]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join("\n");
  const nextEvent: AgentEvent = {
    type: "raw_log",
    content: nextContent,
    metadata: {
      ...eventMetadata(existingEvent),
      ...eventMetadata(event),
    },
  };
  return {
    ...existing,
    content: nextContent,
    metadata: {
      ...existing.metadata,
      event: nextEvent,
      eventType: "raw_log",
    },
  };
}

function normalizeChatMessages(messages: ChatTaskMessage[]): ChatTaskMessage[] {
  const normalized: ChatTaskMessage[] = [];
  const rawLogsByRun = new Map<string, number>();
  const riskApprovalsById = new Map<string, number>();
  const runStartedAtByRun = new Map<string, number>();

  messages.forEach((message) => {
    const event = eventFromMessage(message);
    const runKey = eventRunKey(event, message);
    if (!runKey) return;
    const metadata = eventMetadata(event);
    const startedAt =
      metadataTimestampMs(metadata, ["startedAt", "started_at", "runStartedAt", "run_started_at"]) ??
      timestampMs(message.createdAt);
    if (startedAt == null) return;
    const existing = runStartedAtByRun.get(runKey);
    if (existing == null || startedAt < existing) runStartedAtByRun.set(runKey, startedAt);
  });

  messages.forEach((message, index) => {
    const event = eventFromMessage(message);
    if (message.role === "user" || (message.role === "assistant" && event?.type !== "assistant_delta")) {
      normalized.push(message);
      return;
    }

    if (isPseudoThinkingEvent(event)) {
      const content = pseudoThinkingContent(event, message).trim();
      if (!content || hasEquivalentAssistant(messages, index, content, eventRunKey(event, message))) return;
      normalized.push({
        ...message,
        role: "assistant",
        content,
        metadata: {
          ...message.metadata,
          normalizedFromEventType: event.type,
        },
      });
      return;
    }

    if (event) {
      if (event.type === "run_stage") {
        normalized.push(message);
        return;
      }

      if (isRiskApprovalEvent(event)) {
        const approvalId = riskApprovalId(event);
        if (event.type === "risk_approval_required") {
          if (approvalId) riskApprovalsById.set(approvalId, normalized.length);
          normalized.push(message);
          return;
        }
        const existingIndex = approvalId ? riskApprovalsById.get(approvalId) : undefined;
        if (existingIndex !== undefined) {
          normalized[existingIndex] = mergeRiskApprovalMessage(normalized[existingIndex], event);
          return;
        }
        normalized.push(message);
        return;
      }

      if (event.type === "done") {
        const runKey = eventRunKey(event, message);
        const displayEvent = withDurationFallback(event, message, runStartedAtByRun.get(runKey));
        const normalizedMessage = rawLogMessageFromEvent(
          {
            ...message,
            metadata: {
              ...message.metadata,
              event: displayEvent,
              eventType: displayEvent.type,
            },
          },
          displayEvent,
        );
        if (normalizedMessage) normalized.push(normalizedMessage);
        return;
      }

      const normalizedMessage = rawLogMessageFromEvent(message, event);
      if (!normalizedMessage) return;
      const normalizedEvent = eventFromMessage(normalizedMessage);
      const runKey = eventRunKey(normalizedEvent, normalizedMessage);
      const existingIndex = runKey ? rawLogsByRun.get(runKey) : undefined;

      if (existingIndex !== undefined && normalizedEvent?.type === "raw_log") {
        normalized[existingIndex] = mergeRawLogMessage(normalized[existingIndex], normalizedMessage, normalizedEvent);
        return;
      }

      if (runKey) rawLogsByRun.set(runKey, normalized.length);
      normalized.push(normalizedMessage);
      return;
    }

    if (message.role === "event" || message.role === "tool" || message.role === "system") {
      const rawEvent: AgentEvent = {
        type: "raw_log",
        content: message.content,
        metadata: message.metadata,
      };
      const normalizedMessage = rawLogMessageFromEvent(message, rawEvent);
      if (!normalizedMessage) return;
      normalized.push(normalizedMessage);
      return;
    }

    normalized.push(message);
  });

  return normalized;
}

function appendAgentEvent(messages: ChatTaskMessage[], event: AgentEvent): ChatTaskMessage[] {
  return normalizeChatMessages([...messages, eventMessage(event)]);
}

export default function ChatPage({ isActive = true }: { isActive?: boolean }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedProjectId = searchParams.get("project");
  const selectedTaskId = searchParams.get("task");
  const [projects, setProjects] = useState<ChatProject[]>([]);
  const [messages, setMessages] = useState<ChatTaskMessage[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [draft, setDraft] = useState(readPendingChatDraft);
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [attachmentWarnings, setAttachmentWarnings] = useState<string[]>([]);
  const [draggingAttachments, setDraggingAttachments] = useState(false);
  const [composerHeight, setComposerHeight] = useState(CHAT_COMPOSER_DEFAULT_HEIGHT);
  const [composerResizing, setComposerResizing] = useState(false);
  const [pendingRisk, setPendingRisk] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<ChatPermissions>({});
  const [streaming, setStreaming] = useState("");
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [runState, setRunState] = useState<RunState>("idle");
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>("queue");
  const [runMode, setRunMode] = useState<RunMode>("execute");
  const [goalMode, setGoalMode] = useState(false);
  const [dismissedPlanReviewIds, setDismissedPlanReviewIds] = useState<Set<string>>(() => new Set());
  const [queuedCount, setQueuedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [context, setContext] = useState<BuiltContext["metadata"] | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [appliedRuleCandidateKey, setAppliedRuleCandidateKey] = useState<string | null>(null);
  const [applyingRuleCandidateKey, setApplyingRuleCandidateKey] = useState<string | null>(null);
  const [dismissedRuleCandidateKey, setDismissedRuleCandidateKey] = useState<string | null>(null);
  const [expandedRuleCandidateKey, setExpandedRuleCandidateKey] = useState<string | null>(null);
  const [mobilePanelOpenRaw, setMobilePanelOpenRaw] = useState(false);
  const [narrow, setNarrow] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(max-width: 1023px)").matches
      : false,
  );
  const composingRef = useRef(false);
  const dragDepthRef = useRef(0);
  const composerResizeRef = useRef<{
    startY: number;
    startHeight: number;
    previousCursor: string;
    previousUserSelect: string;
  } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);
  const programmaticScrollRef = useRef(false);
  const scrollSettleTimerRef = useRef<number | null>(null);
  const selectedIdsRef = useRef<{ projectId: string | null; taskId: string | null }>({
    projectId: selectedProjectId,
    taskId: selectedTaskId,
  });
  const streamingRef = useRef("");
  const { setEnd } = usePageHeader();
  const { t, locale } = useI18n();
  const copy = CHAT_COPY[locale];

  useLayoutEffect(() => {
    selectedIdsRef.current = { projectId: selectedProjectId, taskId: selectedTaskId };
  }, [selectedProjectId, selectedTaskId]);

  useEffect(() => {
    const onResize = () => {
      setComposerHeight((height) => clampChatComposerHeight(height));
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    return () => {
      const resize = composerResizeRef.current;
      if (!resize) return;
      document.body.style.cursor = resize.previousCursor;
      document.body.style.userSelect = resize.previousUserSelect;
      composerResizeRef.current = null;
    };
  }, []);

  const isCurrentSelection = useCallback((projectId: string | null, taskId: string | null) => {
    const current = selectedIdsRef.current;
    return current.projectId === projectId && current.taskId === taskId;
  }, []);

  const setSelectedRoute = useCallback(
    (
      projectId: string | null,
      taskId: string | null,
      options: { replace?: boolean } = {},
    ) => {
      selectedIdsRef.current = { projectId, taskId };
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        if (projectId) {
          next.set("project", projectId);
        } else {
          next.delete("project");
        }
        if (taskId) {
          next.set("task", taskId);
        } else {
          next.delete("task");
        }
        next.delete("resume");
        return next;
      }, options);
    },
    [setSearchParams],
  );

  const finishComposerResize = useCallback(() => {
    const resize = composerResizeRef.current;
    if (!resize) return;
    composerResizeRef.current = null;
    document.body.style.cursor = resize.previousCursor;
    document.body.style.userSelect = resize.previousUserSelect;
    setComposerResizing(false);
  }, []);

  const beginComposerResize = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const body = document.body;
    composerResizeRef.current = {
      startY: event.clientY,
      startHeight: composerHeight,
      previousCursor: body.style.cursor,
      previousUserSelect: body.style.userSelect,
    };
    body.style.cursor = "ns-resize";
    body.style.userSelect = "none";
    setComposerResizing(true);
  }, [composerHeight]);

  useEffect(() => {
    if (!composerResizing) return;
    const onMouseMove = (event: MouseEvent) => {
      const resize = composerResizeRef.current;
      if (!resize) return;
      event.preventDefault();
      setComposerHeight(clampChatComposerHeight(resize.startHeight + resize.startY - event.clientY));
    };
    const onMouseUp = () => {
      finishComposerResize();
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [composerResizing, finishComposerResize]);

  const onComposerResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setComposerHeight((height) => clampChatComposerHeight(height + CHAT_COMPOSER_RESIZE_STEP));
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setComposerHeight((height) => clampChatComposerHeight(height - CHAT_COMPOSER_RESIZE_STEP));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setComposerHeight(CHAT_COMPOSER_MIN_HEIGHT);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setComposerHeight(clampChatComposerHeight(CHAT_COMPOSER_MAX_HEIGHT));
    }
  }, []);

  const settleProgrammaticScroll = useCallback((delayMs: number) => {
    if (scrollSettleTimerRef.current !== null) {
      window.clearTimeout(scrollSettleTimerRef.current);
    }
    scrollSettleTimerRef.current = window.setTimeout(() => {
      programmaticScrollRef.current = false;
      scrollSettleTimerRef.current = null;
      const node = scrollerRef.current;
      if (!node) return;
      const atBottom = isChatScrolledToBottom(node);
      autoScrollRef.current = atBottom;
      setShowJumpToLatest(!atBottom);
    }, delayMs);
  }, []);

  const scrollToLatest = useCallback((behavior: ScrollBehavior = "smooth") => {
    const node = scrollerRef.current;
    if (!node) return;
    autoScrollRef.current = true;
    programmaticScrollRef.current = true;
    setShowJumpToLatest(false);
    node.scrollTo({ top: node.scrollHeight, behavior });
    settleProgrammaticScroll(behavior === "smooth" ? CHAT_SCROLL_SETTLE_DELAY_MS : 80);
  }, [settleProgrammaticScroll]);

  const handleMessagesScroll = useCallback(() => {
    const node = scrollerRef.current;
    if (!node || programmaticScrollRef.current) return;
    const atBottom = isChatScrolledToBottom(node);
    autoScrollRef.current = atBottom;
    setShowJumpToLatest(!atBottom);
  }, []);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? projects[0] ?? null,
    [projects, selectedProjectId],
  );
  const selectedTask = useMemo(
    () =>
      selectedProject?.tasks.find((task) => task.id === selectedTaskId) ??
      selectedProject?.tasks[0] ??
      null,
    [selectedProject, selectedTaskId],
  );
  const mobilePanelOpen = isActive && mobilePanelOpenRaw;
  const portalRoot = typeof document !== "undefined" ? document.body : null;

  const refreshProjects = useCallback(async () => {
    const data = await redouApi.getChatProjects();
    setProjects(data.projects);
    const currentSelection = selectedIdsRef.current;
    const currentProject = currentSelection.projectId
      ? data.projects.find((project) => project.id === currentSelection.projectId) ?? null
      : null;
    const currentTask = currentProject && currentSelection.taskId
      ? currentProject.tasks.find((task) => task.id === currentSelection.taskId) ?? null
      : null;

    if (currentTask) {
      return;
    }

    if (currentProject && currentProject.tasks.length === 0) {
      if (currentSelection.taskId) {
        setSelectedRoute(currentProject.id, null, { replace: true });
      }
      return;
    }

    const nextProject =
      currentProject ??
      data.projects.find((project) => project.id === data.current_project_id) ??
      data.projects[0] ??
      null;
    const nextTask =
      nextProject?.tasks.find((task) => task.id === currentSelection.taskId) ??
      nextProject?.tasks.find((task) => task.id === data.current_task_id) ??
      nextProject?.tasks[0] ??
      null;

    if (nextProject) {
      const nextTaskId = nextTask?.id ?? null;
      if (
        currentSelection.projectId !== nextProject.id ||
        currentSelection.taskId !== nextTaskId
      ) {
        setSelectedRoute(nextProject.id, nextTaskId, { replace: true });
      }
    } else if (currentSelection.projectId || currentSelection.taskId) {
      setSelectedRoute(null, null, { replace: true });
    }
  }, [setSelectedRoute]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      void refreshProjects().catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    });
    return () => {
      cancelled = true;
    };
  }, [refreshProjects]);

  useEffect(() => {
    return () => {
      if (scrollSettleTimerRef.current !== null) {
        window.clearTimeout(scrollSettleTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const onProjectsChanged = () => {
      void refreshProjects().catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
      });
    };
    window.addEventListener(CHAT_PROJECTS_CHANGED_EVENT, onProjectsChanged);
    return () => window.removeEventListener(CHAT_PROJECTS_CHANGED_EVENT, onProjectsChanged);
  }, [refreshProjects]);

  useEffect(() => {
    let cancelled = false;
    autoScrollRef.current = true;
    programmaticScrollRef.current = false;
    if (scrollSettleTimerRef.current !== null) {
      window.clearTimeout(scrollSettleTimerRef.current);
      scrollSettleTimerRef.current = null;
    }
    queueMicrotask(() => {
      if (!cancelled) setShowJumpToLatest(false);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedProjectId, selectedTaskId]);

  const loadTaskMessages = useCallback(async (projectId: string | null, taskId: string | null) => {
    streamingRef.current = "";
    setStreaming("");
    setCurrentRunId(null);
    if (!projectId || !taskId) {
      setMessages([]);
      setWarnings([]);
      setContext(null);
      setPendingAttachments([]);
      setAttachmentWarnings([]);
      setDraggingAttachments(false);
      setPendingRisk(null);
      setDismissedPlanReviewIds(new Set());
      setQueuedCount(0);
      setRunState("idle");
      return;
    }
    setMessages([]);
    setWarnings([]);
    setContext(null);
    setPendingAttachments([]);
    setAttachmentWarnings([]);
    setDraggingAttachments(false);
    setPendingRisk(null);
    setDismissedPlanReviewIds(new Set());
    setQueuedCount(0);
    setRunState("loading");
    try {
      const loaded = await redouApi.getChatTaskMessages(projectId, taskId);
      if (!isCurrentSelection(projectId, taskId)) return;
      setMessages(normalizeChatMessages(loaded.messages));
      setWarnings(loaded.warnings);
      setQueuedCount(Math.max(0, Number(loaded.queue_depth || 0)));
      setCurrentRunId(loaded.active_run_id || null);
      const built = await redouApi.buildTaskContext({
        projectId,
        taskId,
        userInput: "",
        preview: true,
      });
      if (!isCurrentSelection(projectId, taskId)) return;
      setContext(built.metadata);
      setError(null);
      setRunState(loaded.is_active ? "running" : "idle");
    } catch (e) {
      if (!isCurrentSelection(projectId, taskId)) return;
      setError(e instanceof Error ? e.message : String(e));
      setRunState("error");
    }
  }, [isCurrentSelection]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void loadTaskMessages(selectedProjectId, selectedTaskId);
    });
    return () => {
      cancelled = true;
    };
  }, [loadTaskMessages, selectedProjectId, selectedTaskId]);

  useEffect(() => {
    let cancelled = false;
    redouApi
      .getConfig()
      .then((config) => {
        if (!cancelled) setPermissions(permissionsFromConfig(config));
      })
      .catch(() => {
        if (!cancelled) setPermissions({});
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (runMode === "plan" && deliveryMode === "guide") {
      const timer = window.setTimeout(() => setDeliveryMode("queue"), 0);
      return () => window.clearTimeout(timer);
    }
  }, [deliveryMode, runMode]);

  useEffect(() => {
    if (runMode === "plan" && goalMode) {
      const timer = window.setTimeout(() => setGoalMode(false), 0);
      return () => window.clearTimeout(timer);
    }
  }, [goalMode, runMode]);

  useEffect(() => {
    const unsubscribe = redouApi.onAgentEvent((payload) => {
      if (!isCurrentSelection(payload.projectId, payload.taskId)) return;
      const { event } = payload;
      if (event.type !== "done") {
        setCurrentRunId(payload.runId);
      }
      if (event.type === "queue_update") {
        const metadata = eventMetadata(event);
        const queueId = String(metadata.queueId || "").trim();
        const queueState = String(metadata.queueState || "").trim();
        const activeRunId = String(metadata.activeRunId || payload.runId || "").trim() || undefined;
        setQueuedCount(Math.max(0, Number(event.queued || 0)));
        setMessages((current) => {
          if (!queueId) return appendAgentEvent(current, event);
          if (queueState === "deleted" || queueState === "guided") {
            return appendAgentEvent(removeQueuedInputMessage(current, queueId), event);
          }
          if (queueState === "started") {
            return appendAgentEvent(markQueuedInputMessageStarted(current, queueId, activeRunId), event);
          }
          return appendAgentEvent(current, event);
        });
        setRunState("running");
        return;
      }
      if (event.type === "assistant_delta") {
        setStreaming((current) => {
          const next = current + event.content;
          streamingRef.current = next;
          return next;
        });
        setRunState("running");
        return;
      }
      if (event.type === "assistant_message") {
        streamingRef.current = "";
        setStreaming("");
        setMessages((current) => appendAgentEvent(current, event));
        setRunState("running");
        return;
      }
      if (event.type === "done") {
        const terminalState = runStateFromDoneEvent(event);
        const pendingStreaming = streamingRef.current.trim();
        streamingRef.current = "";
        setStreaming("");
        setMessages((current) => {
          let next = current;
          if (
            pendingStreaming &&
            normalizedText(latestAssistant(current)) !== normalizedText(pendingStreaming)
          ) {
            next = appendAgentEvent(next, {
              type: "assistant_message",
              content: pendingStreaming,
              metadata: event.metadata,
            });
          }
          return appendAgentEvent(next, event);
        });
        setRunState(terminalState);
        setCurrentRunId(null);
        return;
      }
      if (event.type === "error") {
        streamingRef.current = "";
        setStreaming("");
        setMessages((current) => appendAgentEvent(current, event));
        setRunState("error");
        setError(event.message);
        return;
      }
      setMessages((current) => appendAgentEvent(current, event));
      if (event.type !== "raw_log") setRunState("running");
    });
    return unsubscribe;
  }, [isCurrentSelection]);

  useLayoutEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    if (!autoScrollRef.current) {
      setShowJumpToLatest(!isChatScrolledToBottom(node));
      return;
    }
    scrollToLatest("auto");
  }, [messages, streaming, scrollToLatest]);

  useEffect(() => {
    const mql = window.matchMedia("(max-width: 1023px)");
    const sync = () => setNarrow(mql.matches);
    sync();
    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!isActive || !narrow) {
      setEnd(null);
      return;
    }
    setEnd(
      <Button
        ghost
        onClick={() => setMobilePanelOpenRaw(true)}
        aria-expanded={mobilePanelOpen}
        aria-controls="chat-side-panel"
        className="shrink-0 rounded border border-current/20 px-2 py-1 text-[0.65rem] font-medium tracking-wide normal-case text-midground/80 hover:bg-midground/5 hover:text-midground"
      >
        <span className="inline-flex items-center gap-1.5">
          <PanelRight className="h-3 w-3 shrink-0" />
          {copy.projects}
        </span>
      </Button>,
    );
    return () => setEnd(null);
  }, [copy.projects, isActive, mobilePanelOpen, narrow, setEnd]);

  useEffect(() => {
    if (!mobilePanelOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobilePanelOpenRaw(false);
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [mobilePanelOpen]);

  const selectTask = useCallback(
    (project: ChatProject, task: ChatTask | null) => {
      const nextTaskId = task?.id ?? null;
      if (project.id === selectedProjectId && nextTaskId === selectedTaskId) {
        return;
      }
      setSelectedRoute(project.id, nextTaskId);
      const request = task
        ? redouApi.setActiveChatTask(project.id, task.id)
        : redouApi.setActiveChatProject(project.id);
      void request.catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
      });
    },
    [selectedProjectId, selectedTaskId, setSelectedRoute],
  );

  const clearTaskSelection = useCallback(() => {
    setSelectedRoute(null, null);
  }, [setSelectedRoute]);

  const inputDisabled = !selectedProjectId || !selectedTaskId || runState === "loading";
  const agentBusy = runState === "thinking" || runState === "running";
  const activeRunId = currentRunId ?? selectedTask?.active_run_id ?? null;
  const stopDisabled = !activeRunId && !(agentBusy && selectedProjectId && selectedTaskId);
  const displayMessages = useMemo(() => visibleChatMessages(messages), [messages]);
  const queuedInputs = useMemo(() => queuedInputsFromMessages(messages), [messages]);

  const appendQueuedInput = useCallback(
    ({
      attachments,
      queueId,
      requestedDeliveryMode,
      runMode: inputRunMode,
      targetRunId,
      userInput,
    }: {
      attachments: ChatAttachment[];
      queueId: string;
      requestedDeliveryMode: DeliveryMode;
      runMode: RunMode;
      targetRunId?: string;
      userInput: string;
    }) => {
      const queuedAt = new Date().toISOString();
      setMessages((current) => [
        ...removeQueuedInputMessage(current, queueId),
        {
          role: "user",
          content: userInput,
          createdAt: queuedAt,
          metadata: {
            projectId: selectedProjectId,
            taskId: selectedTaskId,
            runMode: inputRunMode,
            deliveryMode: "queue",
            requestedDeliveryMode,
            queueId,
            queuedAt,
            inputEnvelope: {
              id: queueId,
              text: userInput,
              deliveryMode: "queue",
              status: "pending",
              ...(targetRunId ? { targetRunId } : {}),
            },
          },
          attachments,
        },
      ]);
    },
    [selectedProjectId, selectedTaskId],
  );

  const send = useCallback(async (options: { riskConfirmed?: boolean } = {}) => {
    if (!selectedProjectId || !selectedTaskId) {
      setError(copy.selectProjectTaskBeforeSending);
      return;
    }
    const userInput = draft.trim();
    const attachments = pendingAttachments;
    if (!userInput && attachments.length === 0) return;
    const busy = runState === "running" || runState === "thinking";
    const risk = permissions.prefilter_user_input === false ? null : detectHighRiskRequest(userInput);
    if (risk && !options.riskConfirmed) {
      setPendingRisk(risk);
      return;
    }
    const requestedRunMode = runMode;
    const requestedGoalMode = requestedRunMode === "execute" && goalMode;
    const effectiveDeliveryMode: DeliveryMode = requestedRunMode === "plan"
      ? "queue"
      : busy
      ? deliveryMode === "guide" && attachments.length === 0
        ? "guide"
        : "queue"
      : "queue";
    setDraft("");
    setPendingAttachments([]);
    setAttachmentWarnings([]);
    setPendingRisk(null);
    setStreaming("");
    setError(null);
    if (requestedRunMode === "plan") setRunMode("execute");
    if (!busy) setRunState("thinking");
    if (!busy) {
      setMessages((current) => [
        ...current,
        {
          role: "user",
          content: userInput,
          createdAt: new Date().toISOString(),
          metadata: {
            projectId: selectedProjectId,
            taskId: selectedTaskId,
            runMode: requestedRunMode,
            deliveryMode: "immediate",
          },
          attachments,
        },
      ]);
    }
    try {
      const response = await redouApi.sendChatMessage({
        projectId: selectedProjectId,
        taskId: selectedTaskId,
        userInput,
        deliveryMode: effectiveDeliveryMode,
        runMode: requestedRunMode,
        goalMode: requestedGoalMode,
        attachments,
        riskConfirmed: options.riskConfirmed === true,
        runtimeApprovalEnabled: permissions.runtime_approval_enabled !== false,
        approvalTimeoutSeconds: permissions.approval_timeout_seconds,
      });
      if (response.queueDepth !== undefined) {
        setQueuedCount(Math.max(0, Number(response.queueDepth || 0)));
      }
      if (busy && response.queued && response.queueId) {
        appendQueuedInput({
          attachments,
          queueId: response.queueId,
          requestedDeliveryMode: effectiveDeliveryMode,
          runMode: requestedRunMode,
          targetRunId: response.runId,
          userInput,
        });
      }
      if (response.warning) setError(response.warning);
      setCurrentRunId(response.ok ? response.runId : null);
      if (response.context) setContext(response.context);
      if (!response.ok && response.warning) {
        setError(response.warning);
        setRunState("error");
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const event = { type: "error", message } satisfies AgentEvent;
      setError(message);
      setRunState("error");
      setMessages((current) => appendAgentEvent(current, event));
    }
  }, [appendQueuedInput, copy.selectProjectTaskBeforeSending, deliveryMode, draft, goalMode, pendingAttachments, permissions, runMode, runState, selectedProjectId, selectedTaskId]);

  const executePlan = useCallback(async (plan: PlanReview) => {
    if (!selectedProjectId || !selectedTaskId) {
      setError(copy.selectProjectTaskBeforeSending);
      return;
    }
    const userInput = copy.planReview.executePrompt(plan.content, plan.request);
    const busy = runState === "running" || runState === "thinking";
    const effectiveDeliveryMode: DeliveryMode = "queue";
    setDismissedPlanReviewIds((current) => {
      const next = new Set(current);
      next.add(plan.id);
      return next;
    });
    setStreaming("");
    setError(null);
    if (!busy) setRunState("thinking");
    if (!busy) {
      setMessages((current) => [
        ...current,
        {
          role: "user",
          content: userInput,
          createdAt: new Date().toISOString(),
          metadata: {
            projectId: selectedProjectId,
            taskId: selectedTaskId,
            runMode: "execute",
            planReviewId: plan.id,
            deliveryMode: "immediate",
          },
          attachments: [],
        },
      ]);
    }
    try {
      const response = await redouApi.sendChatMessage({
        projectId: selectedProjectId,
        taskId: selectedTaskId,
        userInput,
        deliveryMode: effectiveDeliveryMode,
        runMode: "execute",
        attachments: [],
        riskConfirmed: false,
        runtimeApprovalEnabled: true,
        approvalTimeoutSeconds: permissions.approval_timeout_seconds,
      });
      if (response.queueDepth !== undefined) {
        setQueuedCount(Math.max(0, Number(response.queueDepth || 0)));
      }
      if (busy && response.queued && response.queueId) {
        appendQueuedInput({
          attachments: [],
          queueId: response.queueId,
          requestedDeliveryMode: effectiveDeliveryMode,
          runMode: "execute",
          targetRunId: response.runId,
          userInput,
        });
      }
      if (response.warning) setError(response.warning);
      setCurrentRunId(response.ok ? response.runId : null);
      if (response.context) setContext(response.context);
      if (!response.ok && response.warning) {
        setError(response.warning);
        setRunState("error");
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const event = { type: "error", message } satisfies AgentEvent;
      setError(message);
      setRunState("error");
      setMessages((current) => appendAgentEvent(current, event));
    }
  }, [appendQueuedInput, copy.planReview, copy.selectProjectTaskBeforeSending, permissions.approval_timeout_seconds, runState, selectedProjectId, selectedTaskId]);

  const updateQueuedInput = useCallback(async (queued: QueuedInput, action: "delete" | "guide") => {
    if (!selectedProjectId || !selectedTaskId) return;
    setError(null);
    try {
      const response = await redouApi.updateQueuedChatMessage({
        projectId: selectedProjectId,
        taskId: selectedTaskId,
        queueId: queued.id,
        action,
      });
      if (response.queueDepth !== undefined) {
        setQueuedCount(Math.max(0, Number(response.queueDepth || 0)));
      }
      if (!response.ok) {
        if (response.message) setError(response.message);
        return;
      }
      setMessages((current) => removeQueuedInputMessage(current, queued.id));
      if (response.runId) setCurrentRunId(response.runId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [selectedProjectId, selectedTaskId]);

  const adjustPlan = useCallback((plan: PlanReview) => {
    setDraft(`${copy.planReview.adjustDraft}\n`);
    setRunMode("plan");
    setDismissedPlanReviewIds((current) => {
      const next = new Set(current);
      next.add(plan.id);
      return next;
    });
    window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
  }, [copy.planReview.adjustDraft]);

  const stop = useCallback(async () => {
    const runId = currentRunId ?? selectedTask?.active_run_id ?? null;
    try {
      const response = runId
        ? await redouApi.stopChatRun(runId)
        : selectedProjectId && selectedTaskId
          ? await redouApi.stopChatTask(selectedProjectId, selectedTaskId)
          : null;
      if (!response) return;
      if (!response.ok) {
        if (response.message) setError(response.message);
        return;
      }
      setCurrentRunId(null);
      setRunState("error");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [currentRunId, selectedProjectId, selectedTask?.active_run_id, selectedTaskId]);

  const attachFilePaths = useCallback(async (filePaths: string[]) => {
    if (!selectedProjectId || !selectedTaskId) return;
    const uniquePaths = Array.from(new Set(filePaths.map((file) => file.trim()).filter(Boolean)));
    if (!uniquePaths.length) return;
    try {
      const result = await redouApi.copyTaskAttachments(selectedProjectId, selectedTaskId, uniquePaths);
      setPendingAttachments((current) => [...current, ...result.attachments]);
      setAttachmentWarnings(result.warnings);
    } catch (e) {
      setAttachmentWarnings([e instanceof Error ? e.message : String(e)]);
    }
  }, [selectedProjectId, selectedTaskId]);

  const addAttachments = useCallback(async () => {
    if (!selectedProjectId || !selectedTaskId) return;
    const picker = window.redouDesktop?.pickFiles;
    if (!picker) {
      setAttachmentWarnings([copy.desktopFilePickerUnavailable]);
      return;
    }
    const files = await picker();
    await attachFilePaths(files);
  }, [attachFilePaths, copy.desktopFilePickerUnavailable, selectedProjectId, selectedTaskId]);

  const filePathsFromDrop = useCallback((files: FileList): string[] => {
    const resolvePath = window.redouDesktop?.getFilePath;
    return Array.from(files)
      .map((file) => {
        if (resolvePath) return resolvePath(file);
        return (file as File & { path?: string }).path || "";
      })
      .filter(Boolean);
  }, []);

  const attachClipboardImage = useCallback(async () => {
    if (!selectedProjectId || !selectedTaskId) return;
    try {
      const result = await redouApi.pasteClipboardImageAttachment(selectedProjectId, selectedTaskId);
      setPendingAttachments((current) => [...current, ...result.attachments]);
      setAttachmentWarnings(result.warnings);
    } catch (e) {
      setAttachmentWarnings([e instanceof Error ? e.message : String(e)]);
    }
  }, [selectedProjectId, selectedTaskId]);

  const onAttachmentDragEnter = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDraggingAttachments(true);
  }, []);

  const onAttachmentDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = inputDisabled ? "none" : "copy";
    if (!inputDisabled) setDraggingAttachments(true);
  }, [inputDisabled]);

  const onAttachmentDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDraggingAttachments(false);
  }, []);

  const onAttachmentDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setDraggingAttachments(false);
    if (inputDisabled) return;
    const filePaths = filePathsFromDrop(event.dataTransfer.files);
    if (!filePaths.length) {
      setAttachmentWarnings([copy.droppedFilesUnavailable]);
      return;
    }
    void attachFilePaths(filePaths);
  }, [attachFilePaths, copy.droppedFilesUnavailable, filePathsFromDrop, inputDisabled]);

  const onAttachmentPaste = useCallback((event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (inputDisabled) return;
    const filePaths = filePathsFromDrop(event.clipboardData.files);
    if (filePaths.length > 0) {
      event.preventDefault();
      void attachFilePaths(filePaths);
      return;
    }

    const items = Array.from(event.clipboardData.items || []);
    const types = Array.from(event.clipboardData.types || []);
    const hasImage =
      items.some((item) => item.type.toLowerCase().startsWith("image/")) ||
      types.some((type) => type.toLowerCase().startsWith("image/"));
    const hasFiles = types.includes("Files");
    const hasText = Boolean(
      event.clipboardData.getData("text/plain") || event.clipboardData.getData("text/html"),
    );
    if (!hasImage && !hasFiles && (hasText || types.length > 0)) return;
    if (!hasImage && !hasFiles && !window.redouDesktop?.pasteClipboardImageAttachment) return;
    event.preventDefault();
    void attachClipboardImage();
  }, [attachClipboardImage, attachFilePaths, filePathsFromDrop, inputDisabled]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter") return;
      if (event.shiftKey || composingRef.current || event.nativeEvent.isComposing) return;
      event.preventDefault();
      void send();
    },
    [send],
  );

  const applyRuleCandidate = useCallback(async () => {
    if (!selectedProject || !selectedTask) return;
    const candidate = makeRuleCandidate(selectedProject, selectedTask, displayMessages);
    if (!candidate) return;
    const key = `${candidate.scope}:${candidate.content}`;
    setApplyingRuleCandidateKey(key);
    setError(null);
    try {
      if (candidate.scope === "project") {
        const current = await redouApi.getProjectContextFile(selectedProject.id, "rules");
        const next = `${current.content.trimEnd()}\n\n${candidate.content}\n`;
        await redouApi.updateProjectContextFile(selectedProject.id, "rules", next);
      } else {
        const current = await redouApi.getTaskContextFile(selectedProject.id, selectedTask.id, "rules");
        const next = `${current.content.trimEnd()}\n\n${candidate.content}\n`;
        await redouApi.updateTaskContextFile(selectedProject.id, selectedTask.id, "rules", next);
      }
      setAppliedRuleCandidateKey(key);
      const built = await redouApi.buildTaskContext({
        projectId: selectedProject.id,
        taskId: selectedTask.id,
        userInput: "",
        preview: true,
      });
      setContext(built.metadata);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplyingRuleCandidateKey((current) => (current === key ? null : current));
    }
  }, [displayMessages, selectedProject, selectedTask]);

  const statusLabel =
    runState === "thinking"
      ? copy.status.thinking
      : runState === "running"
        ? copy.status.running
        : runState === "loading"
          ? copy.status.loading
          : runState === "error"
            ? copy.status.error
            : runState === "interrupted"
              ? copy.status.interrupted
            : runState === "done"
              ? copy.status.done
              : copy.status.idle;
  const ruleCandidate = makeRuleCandidate(selectedProject, selectedTask, displayMessages);
  const ruleCandidateKey = ruleCandidate ? `${ruleCandidate.scope}:${ruleCandidate.content}` : null;
  const latestTodoPlan = useMemo(() => latestTodoPlanFromMessages(displayMessages), [displayMessages]);
  const latestPlanReview = useMemo(() => latestPlanReviewFromMessages(displayMessages), [displayMessages]);
  const visiblePlanReview =
    latestPlanReview &&
    !dismissedPlanReviewIds.has(latestPlanReview.id) &&
    runState !== "thinking" &&
    runState !== "running"
      ? latestPlanReview
      : null;
  const modeCopy = copy.mode;
  const runModeCopy = copy.runMode;
  const goalModeCopy = copy.goalMode;
  const goalModeDisabled = runMode === "plan";
  const sendDisabled = (!draft.trim() && pendingAttachments.length === 0) || inputDisabled;
  const sendTitle = draft.trim() ? copy.send.message : attachmentSendText(pendingAttachments, copy);

  const mobileProjectPortal =
    isActive &&
    narrow &&
    portalRoot &&
    createPortal(
      <>
        {mobilePanelOpen && (
          <Button
            ghost
            aria-label={t.app.closeModelTools}
            onClick={() => setMobilePanelOpenRaw(false)}
            className="fixed inset-0 z-[55] block bg-black/60 p-0 backdrop-blur-sm"
          />
        )}
        <div
          id="chat-side-panel"
          role="complementary"
          className={cn(
            "fixed right-0 top-0 z-[60] flex h-dvh max-h-dvh w-80 min-w-0 flex-col border-l border-current/20 bg-background-base/95 text-midground backdrop-blur-sm transition-transform duration-200",
            mobilePanelOpen ? "translate-x-0" : "pointer-events-none translate-x-full",
          )}
        >
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-current/20 px-5">
            <span className="font-bold tracking-[0.12em]">{copy.projects}</span>
            <Button ghost size="icon" onClick={() => setMobilePanelOpenRaw(false)} aria-label={copy.close}>
              <X />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <ProjectTaskPanel
              channel={LOCAL_CHANNEL}
              selectedProjectId={selectedProjectId}
              selectedTaskId={selectedTaskId}
              onClearSelection={clearTaskSelection}
              onSelect={selectTask}
            />
          </div>
        </div>
      </>,
      portalRoot,
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 normal-case">
      {mobileProjectPortal}
      <div className="flex min-h-0 flex-1 flex-col gap-2 lg:flex-row lg:gap-3">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
          <ChatTaskToolbar
            channel={LOCAL_CHANNEL}
            selectedProjectId={selectedProjectId}
            selectedTaskId={selectedTaskId}
          />

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background-base/70">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-midground">
                  {selectedTask?.title ?? copy.selectTask}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {selectedProject?.name ?? copy.noProject} · {selectedProject?.hermesProfile ?? copy.noProfile}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge state={runState} label={statusLabel} />
                <Button outlined size="sm" prefix={<Info />} onClick={() => setContextOpen((value) => !value)}>
                  {copy.currentContext}
                </Button>
              </div>
            </div>

            {contextOpen && <ContextPanel context={context} project={selectedProject} task={selectedTask} />}

            {warnings.length > 0 && (
              <div className="border-b border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
                {copy.skippedLines(warnings.length)}
              </div>
            )}

            {error && (
              <div className="border-b border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}

            <div className="relative min-h-0 flex-1">
              <div
                ref={scrollerRef}
                onScroll={handleMessagesScroll}
                className="h-full min-h-0 space-y-3 overflow-y-auto px-3 py-4"
              >
                {!selectedTask ? (
                  <EmptyChat />
                ) : displayMessages.length === 0 && !streaming && queuedInputs.length === 0 ? (
                  <EmptyChat title={copy.newTask} detail={copy.newTaskDetail} />
                ) : (
                  displayMessages.map((message, index) => (
                    <MessageBubble key={`${message.createdAt}-${index}`} message={message} />
                  ))
                )}
                {streaming && (
                  <MessageBubble
                    message={{
                      role: "assistant",
                      content: streaming,
                      createdAt: new Date().toISOString(),
                      metadata: { streaming: true },
                      attachments: [],
                    }}
                    streaming
                  />
                )}
                {(runState === "thinking" || runState === "running") && (
                  <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {copy.assistantWorking}
                  </div>
                )}
                {latestTodoPlan && <TodoPlanCard plan={latestTodoPlan} />}
                {visiblePlanReview && (
                  <PlanReviewCard
                    onAdjust={() => adjustPlan(visiblePlanReview)}
                    onDismiss={() =>
                      setDismissedPlanReviewIds((current) => {
                        const next = new Set(current);
                        next.add(visiblePlanReview.id);
                        return next;
                      })
                    }
                    onExecute={() => void executePlan(visiblePlanReview)}
                  />
                )}
              </div>
              {showJumpToLatest && (
                <Button
                  ghost
                  size="icon"
                  type="button"
                  onClick={() => scrollToLatest("smooth")}
                  aria-label={copy.jumpToLatest}
                  title={copy.jumpToLatest}
                  className="absolute bottom-4 right-4 z-10 h-10 w-10 rounded-full border border-border bg-background-base/90 text-midground shadow-lg shadow-black/30 backdrop-blur transition hover:bg-card hover:text-midground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ChevronDown className="h-5 w-5" />
                </Button>
              )}
            </div>

            {ruleCandidate &&
              ruleCandidateKey &&
              ruleCandidateKey !== appliedRuleCandidateKey &&
              ruleCandidateKey !== dismissedRuleCandidateKey &&
              runState === "done" && (
              <RuleCandidates
                candidate={ruleCandidate}
                applying={applyingRuleCandidateKey === ruleCandidateKey}
                expanded={expandedRuleCandidateKey === ruleCandidateKey}
                onToggle={() =>
                  setExpandedRuleCandidateKey((current) => (current === ruleCandidateKey ? null : ruleCandidateKey))
                }
                onDismiss={() => setDismissedRuleCandidateKey(ruleCandidateKey)}
                onApplyRule={() => void applyRuleCandidate()}
              />
            )}

            <div className="shrink-0 border-t border-border bg-card/45 p-3">
              {pendingRisk && (
                <RiskConfirmation
                  reason={pendingRisk}
                  onCancel={() => setPendingRisk(null)}
                  onConfirm={() => void send({ riskConfirmed: true })}
                />
              )}
              {(pendingAttachments.length > 0 || attachmentWarnings.length > 0) && (
                <AttachmentTray
                  attachments={pendingAttachments}
                  warnings={attachmentWarnings}
                  onRemove={(id) =>
                    setPendingAttachments((current) => current.filter((item) => item.id !== id))
                  }
                />
              )}
              {queuedInputs.length > 0 && (
                <QueuedInputTray
                  items={queuedInputs}
                  activeRun={agentBusy}
                  onDelete={(item) => void updateQueuedInput(item, "delete")}
                  onGuide={(item) => void updateQueuedInput(item, "guide")}
                />
              )}
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex h-8 overflow-hidden rounded-md border border-border bg-background/35">
                    {(
                      [
                        { mode: "execute" as const, icon: Play, label: runModeCopy.execute, title: runModeCopy.executeTitle },
                        { mode: "plan" as const, icon: ListPlus, label: runModeCopy.plan, title: runModeCopy.planTitle },
                      ]
                    ).map(({ mode, icon: Icon, label, title }) => {
                      const active = runMode === mode;
                      return (
                        <button
                          key={mode}
                          type="button"
                          title={title}
                          aria-pressed={active}
                          onClick={() => setRunMode(mode)}
                          className={cn(
                            "inline-flex h-8 items-center gap-1.5 px-2.5 text-xs font-medium transition-colors",
                            active
                              ? "bg-midground text-background-base"
                              : "text-muted-foreground hover:bg-card/60 hover:text-midground",
                          )}
                        >
                          <Icon className="h-3.5 w-3.5 shrink-0" />
                          <span>{label}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="inline-flex h-8 overflow-hidden rounded-md border border-border bg-background/35">
                    {(
                      [
                        { mode: "queue" as const, icon: ListPlus, label: modeCopy.queue, title: modeCopy.queueTitle },
                        { mode: "guide" as const, icon: CornerDownRight, label: modeCopy.guide, title: modeCopy.guideTitle },
                      ]
                    ).map(({ mode, icon: Icon, label, title }) => {
                      const active = deliveryMode === mode;
                      const disabled = runMode === "plan" && mode === "guide";
                      return (
                        <button
                          key={mode}
                          type="button"
                          title={title}
                          aria-pressed={active}
                          disabled={disabled}
                          onClick={() => setDeliveryMode(mode)}
                          className={cn(
                            "inline-flex h-8 items-center gap-1.5 px-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45",
                            active
                              ? "bg-midground text-background-base"
                              : "text-muted-foreground hover:bg-card/60 hover:text-midground",
                          )}
                        >
                          <Icon className="h-3.5 w-3.5 shrink-0" />
                          <span>{label}</span>
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    title={goalModeDisabled ? goalModeCopy.disabledTitle : goalModeCopy.title}
                    aria-pressed={goalMode}
                    disabled={goalModeDisabled}
                    onClick={() => setGoalMode((value) => !value)}
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45",
                      goalMode
                        ? "bg-midground text-background-base"
                        : "bg-background/35 text-muted-foreground hover:bg-card/60 hover:text-midground",
                    )}
                  >
                    <Target className="h-3.5 w-3.5 shrink-0" />
                    <span>{goalModeCopy.label}</span>
                  </button>
                </div>
                {queuedCount > 0 && (
                  <span className="inline-flex h-7 items-center rounded-md border border-warning/35 bg-warning/5 px-2 text-xs text-warning">
                    {modeCopy.queued(queuedCount)}
                  </span>
                )}
              </div>
              <div
                className={cn(
                  "relative flex min-h-24 gap-2 rounded-lg border border-border bg-background/40 p-2 transition-colors",
                  composerResizing && "border-foreground/30 ring-1 ring-foreground/25",
                  draggingAttachments && !inputDisabled && "border-success/50 bg-success/10",
                )}
                style={{ height: composerHeight }}
                onDragEnter={onAttachmentDragEnter}
                onDragOver={onAttachmentDragOver}
                onDragLeave={onAttachmentDragLeave}
                onDrop={onAttachmentDrop}
              >
                <div
                  role="separator"
                  aria-label="Resize message input"
                  aria-orientation="horizontal"
                  aria-valuemin={CHAT_COMPOSER_MIN_HEIGHT}
                  aria-valuemax={clampChatComposerHeight(CHAT_COMPOSER_MAX_HEIGHT)}
                  aria-valuenow={composerHeight}
                  tabIndex={0}
                  title="Drag to resize input"
                  className={cn(
                    "absolute -top-1 left-3 right-3 z-20 h-3 cursor-ns-resize touch-none rounded-full outline-none",
                    "after:absolute after:left-1/2 after:top-1/2 after:h-1 after:w-14 after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-full after:bg-border after:opacity-0 after:transition-opacity",
                    "hover:after:opacity-100 focus-visible:after:opacity-100 focus-visible:ring-2 focus-visible:ring-foreground/30",
                    composerResizing && "after:bg-foreground/45 after:opacity-100",
                  )}
                  onMouseDown={beginComposerResize}
                  onKeyDown={onComposerResizeKeyDown}
                />
                {draggingAttachments && !inputDisabled && (
                  <div className="pointer-events-none absolute inset-1 z-10 grid place-items-center rounded-md border border-success/40 bg-background-base/90 text-xs font-medium text-success">
                    <span className="inline-flex items-center gap-2">
                      <Upload className="h-4 w-4" />
                      {copy.dropFiles}
                    </span>
                  </div>
                )}
                <textarea
                  ref={textareaRef}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onPaste={onAttachmentPaste}
                  onKeyDown={onKeyDown}
                  onCompositionStart={() => {
                    composingRef.current = true;
                  }}
                  onCompositionEnd={() => {
                    composingRef.current = false;
                  }}
                  disabled={inputDisabled}
                  className="min-h-20 flex-1 resize-none bg-transparent px-2 py-1 text-sm leading-6 text-midground outline-none placeholder:text-muted-foreground"
                  placeholder={
                    selectedProjectId && selectedTaskId
                      ? runState === "loading" ? copy.loadingTaskHistory : copy.askPlaceholder
                      : copy.selectProjectTaskFirst
                  }
                />
                <div className="flex shrink-0 flex-col gap-2">
                  <Button outlined size="icon" onClick={() => void addAttachments()} disabled={inputDisabled} title={copy.attachFiles} aria-label={copy.attachFiles}>
                    <Paperclip className="h-4 w-4" />
                  </Button>
                  <Button size="icon" onClick={() => void send()} disabled={sendDisabled} title={sendTitle} aria-label={sendTitle}>
                    <Send className="h-4 w-4" />
                  </Button>
                  <Button outlined size="icon" onClick={() => void stop()} disabled={stopDisabled} title={copy.stopRun} aria-label={copy.stopRun}>
                    <Square className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {agentBusy && deliveryMode === "guide"
                  ? copy.guideHint
                  : copy.sendHint}
              </div>
            </div>
          </div>
        </div>

        {!narrow && (
          <div className="flex min-h-0 shrink-0 flex-col overflow-hidden lg:h-full lg:w-[22rem]">
            <ProjectTaskPanel
              channel={LOCAL_CHANNEL}
              selectedProjectId={selectedProjectId}
              selectedTaskId={selectedTaskId}
              onClearSelection={clearTaskSelection}
              onSelect={selectTask}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function TodoPlanCard({ plan }: { plan: TodoPlan }) {
  const { locale } = useI18n();
  const title = locale === "zh" ? "任务清单" : "Task List";
  return (
    <div className="flex justify-start" aria-live="polite">
      <div className="w-full max-w-[min(48rem,92%)] rounded-lg border border-border/70 bg-card/55 px-3 py-2 shadow-sm">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          <ListPlus className="h-3.5 w-3.5" />
          {title}
        </div>
        <ol className="space-y-1">
          {plan.items.map((item, index) => (
            <li
              key={`${item.id}-${index}`}
              className={cn(
                "grid grid-cols-[1rem_1.5rem_1fr] items-start gap-2 rounded-md px-1.5 py-1 text-sm leading-5",
                item.status === "in_progress" && "bg-warning/5 text-midground",
                item.status === "completed" && "text-muted-foreground",
                item.status === "pending" && "text-muted-foreground",
                item.status === "cancelled" && "text-muted-foreground/60",
              )}
            >
              <TodoStatusMarker status={item.status} />
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
      </div>
    </div>
  );
}

function PlanReviewCard({
  onAdjust,
  onDismiss,
  onExecute,
}: {
  onAdjust(): void;
  onDismiss(): void;
  onExecute(): void;
}) {
  const { locale } = useI18n();
  const copy = CHAT_COPY[locale].planReview;
  return (
    <div className="flex justify-start" aria-live="polite">
      <div className="w-full max-w-[min(48rem,92%)] rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 shadow-sm">
        <div className="mb-1 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-warning">
          <ListPlus className="h-3.5 w-3.5" />
          {copy.title}
        </div>
        <div className="text-xs leading-5 text-muted-foreground">{copy.detail}</div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" type="button" onClick={onExecute} title={copy.execute} aria-label={copy.execute}>
            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
            {copy.execute}
          </Button>
          <Button outlined size="sm" type="button" onClick={onAdjust} title={copy.adjust} aria-label={copy.adjust}>
            <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
            {copy.adjust}
          </Button>
          <Button ghost size="sm" type="button" onClick={onDismiss} title={copy.dismiss} aria-label={copy.dismiss}>
            <X className="mr-1.5 h-3.5 w-3.5" />
            {copy.dismiss}
          </Button>
        </div>
      </div>
    </div>
  );
}

function QueuedInputTray({
  activeRun,
  items,
  onDelete,
  onGuide,
}: {
  activeRun: boolean;
  items: QueuedInput[];
  onDelete(item: QueuedInput): void;
  onGuide(item: QueuedInput): void;
}) {
  const { locale } = useI18n();
  const copy = CHAT_COPY[locale].queuedInput;
  return (
    <div className="mb-2 space-y-2" aria-live="polite">
      {items.map((item, index) => {
        const canGuide = activeRun && item.runMode === "execute" && item.attachments.length === 0;
        return (
          <div
            key={item.id}
            className="rounded-md border border-warning/35 bg-warning/5 px-2.5 py-2 text-xs shadow-sm"
          >
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex min-w-0 items-center gap-2 font-medium text-warning">
                <ListPlus className="h-3.5 w-3.5 shrink-0" />
                <span>{copy.title}</span>
                <span className="text-muted-foreground">#{index + 1}</span>
                <span className="text-muted-foreground">{copy.detail}</span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  outlined
                  size="sm"
                  type="button"
                  disabled={!canGuide}
                  onClick={() => onGuide(item)}
                  title={canGuide ? copy.guideTitle : copy.guideDisabled}
                  aria-label={canGuide ? copy.guideTitle : copy.guideDisabled}
                  className="h-7 px-2 text-[11px]"
                >
                  <CornerDownRight className="mr-1 h-3.5 w-3.5" />
                  {copy.guide}
                </Button>
                <Button
                  ghost
                  size="sm"
                  type="button"
                  onClick={() => onDelete(item)}
                  title={copy.deleteTitle}
                  aria-label={copy.deleteTitle}
                  className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                >
                  <X className="mr-1 h-3.5 w-3.5" />
                  {copy.delete}
                </Button>
              </div>
            </div>
            <div className="max-h-16 overflow-y-auto whitespace-pre-wrap break-words rounded border border-border/50 bg-background/35 px-2 py-1.5 text-sm leading-5 text-midground">
              {item.content}
            </div>
            {item.attachments.length > 0 && <AttachmentList attachments={item.attachments} />}
          </div>
        );
      })}
    </div>
  );
}

function TodoStatusMarker({ status }: { status: TodoPlanStatus }) {
  if (status === "completed") {
    return <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-success" aria-label="completed" />;
  }
  if (status === "in_progress") {
    return (
      <span className="mt-1 flex h-3.5 w-3.5 items-center justify-center" role="img" aria-label="in progress">
        <span className="h-2.5 w-2.5 rounded-full bg-warning shadow-[0_0_0_3px_rgba(245,158,11,0.12)] animate-pulse" />
      </span>
    );
  }
  if (status === "cancelled") {
    return <X className="mt-0.5 h-3.5 w-3.5 text-muted-foreground/60" aria-label="cancelled" />;
  }
  return (
    <span className="mt-1 flex h-3.5 w-3.5 items-center justify-center" role="img" aria-label="pending">
      <span className="h-2.5 w-2.5 rounded-full border border-muted-foreground/45" />
    </span>
  );
}

function StatusBadge({ label, state }: { label: string; state: RunState }) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs",
        state === "error" && "border-destructive/40 bg-destructive/5 text-destructive",
        state === "interrupted" && "border-warning/40 bg-warning/5 text-warning",
        state === "done" && "border-success/40 bg-success/5 text-success",
        (state === "thinking" || state === "running" || state === "loading") &&
          "border-warning/40 bg-warning/5 text-warning",
        state === "idle" && "border-border bg-card/50 text-muted-foreground",
      )}
    >
      {state === "thinking" || state === "running" || state === "loading" ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : state === "done" ? (
        <CheckCircle2 className="h-3.5 w-3.5" />
      ) : state === "interrupted" ? (
        <AlertTriangle className="h-3.5 w-3.5" />
      ) : state === "error" ? (
        <AlertCircle className="h-3.5 w-3.5" />
      ) : (
        <MessageSquare className="h-3.5 w-3.5" />
      )}
      {label}
    </span>
  );
}

function EmptyChat({ detail, title }: { detail?: string; title?: string }) {
  const { locale } = useI18n();
  const copy = CHAT_COPY[locale];
  return (
    <div className="flex min-h-72 flex-col items-center justify-center rounded-lg border border-dashed border-border px-4 text-center">
      <Bot className="mb-3 h-8 w-8 text-muted-foreground" />
      <div className="text-sm font-semibold">{title ?? copy.emptyTitle}</div>
      <div className="mt-1 max-w-sm text-xs text-muted-foreground">{detail ?? copy.emptyDetail}</div>
    </div>
  );
}

function MessageBubble({ message, streaming = false }: { message: ChatTaskMessage; streaming?: boolean }) {
  const { locale } = useI18n();
  const copy = CHAT_COPY[locale];
  const [copied, setCopied] = useState(false);
  const copyableText = message.content.trim();
  const copyMessage = useCallback(() => {
    if (!copyableText) return;
    void navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1000);
    });
  }, [copyableText, message.content]);
  if (message.role === "event") {
    const event = eventFromMessage(message);
    return event ? (
      <EventCard event={event} />
    ) : (
      <EventCard event={{ type: "raw_log", content: message.content }} />
    );
  }
  const mine = message.role === "user";
  return (
    <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[min(48rem,88%)] rounded-lg border px-3 py-2 text-sm leading-6",
          mine
            ? "border-success/30 bg-success/10 text-midground"
            : "border-border bg-card/65 text-midground",
        )}
      >
        <div className="mb-1 flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          <span className="inline-flex min-w-0 items-center gap-2">
            {mine ? copy.roleYou : copy.roleAssistant}
            {streaming && <Loader2 className="h-3 w-3 animate-spin" />}
          </span>
          {copyableText && (
            <button
              type="button"
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border/60 bg-background/35 text-muted-foreground/80 transition hover:border-border hover:bg-card hover:text-midground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={copyMessage}
              title={copied ? copy.copied : copy.copy}
              aria-label={copied ? copy.copied : copy.copy}
            >
              {copied ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
        <MarkdownLite content={message.content} />
        {(message.attachments?.length ?? 0) > 0 && <AttachmentList attachments={message.attachments} />}
      </div>
    </div>
  );
}

function MarkdownLite({ content }: { content: string }) {
  const parts = useMemo(() => {
    const segments: Array<{ kind: "text" | "code"; value: string; lang?: string }> = [];
    const re = /```([A-Za-z0-9_-]*)\n([\s\S]*?)```/g;
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      if (match.index > last) segments.push({ kind: "text", value: content.slice(last, match.index) });
      segments.push({ kind: "code", lang: match[1], value: match[2] });
      last = re.lastIndex;
    }
    if (last < content.length) segments.push({ kind: "text", value: content.slice(last) });
    return segments;
  }, [content]);

  return (
    <div className="space-y-2">
      {parts.map((part, index) =>
        part.kind === "code" ? (
          <CodeBlock key={index} code={part.value} lang={part.lang} />
        ) : (
          <TextMarkdown key={index} text={part.value} />
        ),
      )}
    </div>
  );
}

function TextMarkdown({ text }: { text: string }) {
  const lines = text.split(/\n{2,}/).filter((line) => line.trim());
  return (
    <>
      {lines.map((line, index) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("#")) {
          return (
            <div key={index} className="font-semibold">
              {trimmed.replace(/^#+\s*/, "")}
            </div>
          );
        }
        return (
          <p key={index} className="whitespace-pre-wrap break-words">
            {trimmed}
          </p>
        );
      })}
    </>
  );
}

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const { locale } = useI18n();
  const copy = CHAT_COPY[locale];
  const [copied, setCopied] = useState(false);
  return (
    <div className="overflow-hidden rounded-md border border-border bg-black/30">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Code2 className="h-3.5 w-3.5" />
          {lang || copy.code}
        </span>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-card"
          onClick={() => {
            void navigator.clipboard.writeText(code).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1000);
            });
          }}
        >
          <Copy className="h-3 w-3" />
          {copied ? copy.copied : copy.copy}
        </button>
      </div>
      <pre className="max-h-[32rem] overflow-auto p-3 text-xs leading-5">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function approvalStatusFromEvent(event: AgentEvent): {
  label: string;
  tone: "pending" | "allowed" | "denied" | "timeout" | "invalid";
} {
  const metadata = eventMetadata(event);
  const status = String(metadata.approvalStatus || event.type || "");
  if (status === "risk_approval_allowed" || status === "high_risk_command_auto_allowed") {
    return { label: "Allowed", tone: "allowed" };
  }
  if (status === "risk_approval_denied" || status === "high_risk_command_blocked") {
    return { label: "Denied", tone: "denied" };
  }
  if (status === "risk_approval_timeout") return { label: "Timed out, command denied", tone: "timeout" };
  if (status === "risk_approval_invalid") return { label: "Invalid decision", tone: "invalid" };
  return { label: "Waiting for approval", tone: "pending" };
}

function RiskApprovalCard({ event }: { event: AgentEvent }) {
  const [submitting, setSubmitting] = useState<RiskApprovalDecision | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const metadata = eventMetadata(event);
  const status = approvalStatusFromEvent(event);
  const final = status.tone !== "pending";
  const command = "command" in event ? String(event.command || "") : "";
  const cwd = "cwd" in event ? String(event.cwd || "") : "";
  const reason = "reason" in event ? String(event.reason || "") : "";
  const approvalId = riskApprovalId(event);
  const projectId = String(("projectId" in event ? event.projectId : "") || metadata.projectId || "");
  const taskId = String(("taskId" in event ? event.taskId : "") || metadata.taskId || "");
  const runId = String(("runId" in event ? event.runId : "") || metadata.runId || "");
  const allowedDecisions =
    event.type === "risk_approval_required" && Array.isArray(event.allowedDecisions)
      ? event.allowedDecisions
      : [];
  const expiresAt =
    event.type === "risk_approval_required" && event.expiresAt
      ? new Date(event.expiresAt).toLocaleString()
      : "";

  const resolve = async (decision: RiskApprovalDecision) => {
    if (submitting || final) return;
    setSubmitting(decision);
    setLocalError(null);
    try {
      const result = await redouApi.resolveRiskApproval({
        projectId,
        taskId,
        runId,
        approvalId,
        decision,
      });
      if (!result.ok) {
        setLocalError(result.message || "Approval decision was not accepted.");
        setSubmitting(null);
      }
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
      setSubmitting(null);
    }
  };

  const toneClass =
    status.tone === "allowed"
      ? "border-success/40 bg-success/5 text-success"
      : status.tone === "pending"
        ? "border-warning/40 bg-warning/5 text-warning"
        : "border-destructive/40 bg-destructive/5 text-destructive";

  return (
    <div className="rounded-lg border border-warning/45 bg-card/70 px-3 py-3 text-xs text-midground shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
            High-risk command approval required
          </div>
          <div className="mt-1 text-muted-foreground">
            {reason || "The agent generated a command that needs approval before it can run."}
          </div>
        </div>
        <span className={cn("shrink-0 rounded border px-2 py-1 text-[11px]", toneClass)}>
          {status.label}
        </span>
      </div>
      <div className="mt-2 grid gap-1.5 text-[11px] text-muted-foreground">
        {cwd && <div><span className="font-medium text-midground">cwd:</span> {cwd}</div>}
        {"riskLevel" in event && event.riskLevel && (
          <div><span className="font-medium text-midground">risk:</span> {event.riskLevel}</div>
        )}
        {expiresAt && <div><span className="font-medium text-midground">expires:</span> {expiresAt}</div>}
      </div>
      {command && (
        <details className="mt-2 rounded-md border border-border/60 bg-background/40">
          <summary className="cursor-pointer px-2 py-1.5 text-[11px] text-muted-foreground">
            Full command
          </summary>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words px-2 pb-2 font-mono text-xs leading-5 text-midground">
            {command}
          </pre>
        </details>
      )}
      {localError && (
        <div className="mt-2 rounded border border-destructive/35 bg-destructive/10 px-2 py-1.5 text-destructive">
          {localError}
        </div>
      )}
      {event.type === "risk_approval_required" && !final && (
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          {allowedDecisions.includes("allow_once") && (
            <Button size="sm" disabled={!!submitting} onClick={() => void resolve("allow_once")}>
              {submitting === "allow_once" ? "Submitting..." : "Allow once"}
            </Button>
          )}
          {allowedDecisions.includes("allow_session") && (
            <Button size="sm" outlined disabled={!!submitting} onClick={() => void resolve("allow_session")}>
              {submitting === "allow_session" ? "Submitting..." : "Allow similar this task"}
            </Button>
          )}
          {allowedDecisions.includes("allow_always") && (
            <Button size="sm" outlined disabled={!!submitting} onClick={() => void resolve("allow_always")}>
              {submitting === "allow_always" ? "Submitting..." : "Always allow"}
            </Button>
          )}
          {allowedDecisions.includes("deny") && (
            <Button size="sm" outlined disabled={!!submitting} onClick={() => void resolve("deny")}>
              {submitting === "deny" ? "Submitting..." : "Deny"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function EventCard({ event }: { event: AgentEvent }) {
  const { locale } = useI18n();
  const copy = CHAT_COPY[locale];
  if (event.type === "run_stage") return null;
  if (isRiskApprovalEvent(event)) return <RiskApprovalCard event={event} />;
  const content = event.type === "raw_log" ? event.content : formatEventForRawLog(event, eventMessage(event));
  const usage = turnUsageSummary(eventMetadata(event), copy);
  if (usage) {
    return (
      <details className="group mx-auto w-fit max-w-full text-xs text-muted-foreground">
        <summary
          className="flex cursor-pointer list-none select-none items-center gap-1.5 rounded-full border border-border/60 bg-card/35 px-2 py-1 text-[11px] leading-none text-muted-foreground hover:border-border hover:bg-card/55 [&::-webkit-details-marker]:hidden"
          title={usage.title}
        >
          <CheckCircle2 className="h-3 w-3 shrink-0 text-success" />
          {usage.parts.map((part, index) => (
            <span key={part} className="inline-flex items-center gap-1">
              {index > 0 && <span className="text-muted-foreground/45">/</span>}
              <span>{part}</span>
            </span>
          ))}
        </summary>
        {content.trim() && (
          <pre className="mt-2 max-h-64 max-w-[min(44rem,88vw)] overflow-auto rounded-md border border-border/50 bg-card/30 p-2 whitespace-pre-wrap break-words">
            {content}
          </pre>
        )}
      </details>
    );
  }
  return (
    <details className="rounded-lg border border-border/60 bg-card/30 px-3 py-2 text-xs text-muted-foreground">
      <summary className="cursor-pointer select-none">{copy.rawLogHidden}</summary>
      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words">{content}</pre>
    </details>
  );
}

function LongText({ children }: { children: string }) {
  const { locale } = useI18n();
  const copy = CHAT_COPY[locale];
  const text = String(children || "");
  if (text.length < 800) {
    return <pre className="whitespace-pre-wrap break-words text-xs leading-5 text-midground">{text}</pre>;
  }
  return (
    <details className="text-xs">
      <summary className="flex cursor-pointer items-center gap-1 text-muted-foreground">
        <ChevronDown className="h-3 w-3" />
        {copy.longOutputHidden}
      </summary>
      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words leading-5 text-midground">{text}</pre>
    </details>
  );
}

function formatBytes(value?: number): string {
  const size = Number(value || 0);
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function AttachmentList({ attachments }: { attachments: ChatAttachment[] }) {
  return (
    <div className="mt-2 grid gap-1.5">
      {attachments.map((attachment) => {
        const previewUrl = attachmentPreviewUrl(attachment);
        return (
          <span
            key={attachment.id}
            className={cn(
              "inline-flex max-w-full items-center gap-2 rounded-md border border-border/70 bg-background/35 px-2 py-1.5 text-xs text-muted-foreground",
              previewUrl && "pr-3",
            )}
            title={attachment.storedPath || attachment.originalPath || attachment.name}
          >
            {previewUrl ? (
              <img
                src={previewUrl}
                alt={attachment.name}
                className="h-12 w-16 shrink-0 rounded object-cover"
              />
            ) : (
              <FileText className="h-4 w-4 shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
            {formatBytes(attachment.size) && <span className="shrink-0 opacity-70">{formatBytes(attachment.size)}</span>}
          </span>
        );
      })}
    </div>
  );
}

function AttachmentTray({
  attachments,
  onRemove,
  warnings,
}: {
  attachments: ChatAttachment[];
  onRemove(id: string): void;
  warnings: string[];
}) {
  return (
    <div className="mb-2 rounded-md border border-border/70 bg-background/25 px-2 py-2 text-xs">
      {attachments.length > 0 && (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {attachments.map((attachment) => {
            const previewUrl = attachmentPreviewUrl(attachment);
            return (
              <button
                key={attachment.id}
                type="button"
                className="inline-flex min-w-0 items-center gap-2 rounded-md border border-border/70 bg-card/50 p-1.5 text-left text-muted-foreground hover:text-midground"
                title={attachment.storedPath || attachment.name}
                onClick={() => onRemove(attachment.id)}
              >
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt={attachment.name}
                    className="h-12 w-14 shrink-0 rounded object-cover"
                  />
                ) : isImageAttachment(attachment) ? (
                  <ImageIcon className="h-4 w-4 shrink-0" />
                ) : (
                  <FileText className="h-4 w-4 shrink-0" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{attachment.name}</span>
                  {formatBytes(attachment.size) && (
                    <span className="block truncate text-[11px] opacity-70">{formatBytes(attachment.size)}</span>
                  )}
                </span>
                <X className="h-3 w-3 shrink-0" />
              </button>
            );
          })}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="mt-2 space-y-1 text-warning">
          {warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function RiskConfirmation({
  onCancel,
  onConfirm,
  reason,
}: {
  onCancel(): void;
  onConfirm(): void;
  reason: string;
}) {
  const { locale } = useI18n();
  const copy = CHAT_COPY[locale];
  const localizedReason =
    copy.riskReasons[reason as keyof typeof copy.riskReasons] ?? reason;

  return (
    <div className="mb-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-midground">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{copy.highRiskTitle}</div>
          <div className="mt-1 text-muted-foreground">
            {copy.highRiskDetail(localizedReason)}
          </div>
        </div>
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <Button size="sm" outlined onClick={onCancel}>{copy.cancel}</Button>
        <Button size="sm" onClick={onConfirm}>{copy.confirmAndSend}</Button>
      </div>
    </div>
  );
}

function ContextPanel({
  context,
  project,
  task,
}: {
  context: BuiltContext["metadata"] | null;
  project: ChatProject | null;
  task: ChatTask | null;
}) {
  const { locale } = useI18n();
  const copy = CHAT_COPY[locale];
  const files = context?.includedFiles ?? [];
  const contextTokens = context?.contextTokens ?? 0;
  const contextMaxTokens = context?.contextMaxTokens ?? 128000;
  const contextPercent = context?.contextPercent ?? 0;
  const contextRatio = Math.max(0, Math.min(100, contextPercent));
  const compression = context?.contextCompression;
  return (
    <div className="border-b border-border bg-card/35 px-3 py-3 text-xs">
      <div className="mb-2 flex items-center gap-2 font-semibold text-midground">
        <Info className="h-4 w-4" />
        {copy.currentContext}
      </div>
      <div className="mb-3 rounded-md border border-border/70 bg-background/30 px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium text-midground">{copy.contextUsage}</span>
          <span className="text-muted-foreground">
            {formatCompactCount(contextTokens)} / {formatCompactCount(contextMaxTokens)} {copy.tokens} ({formatContextPercent(contextPercent)})
          </span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/25">
          <div
            className={cn(
              "h-full rounded-full transition-[width]",
              contextPercent >= 100
                ? "bg-destructive"
                : contextPercent >= 85
                  ? "bg-warning"
                  : "bg-success",
            )}
            style={{ width: `${contextRatio}%` }}
          />
        </div>
        {context?.contextCompressed && compression && (
          <div className="mt-2 text-muted-foreground">
            {copy.autoCompressed(formatCompactCount(compression.beforeTokens), formatCompactCount(compression.afterTokens))}
          </div>
        )}
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <InfoRow label={copy.contextLabels.project} value={project?.name ?? context?.projectId ?? "-"} />
        <InfoRow label={copy.contextLabels.task} value={task?.title ?? context?.taskId ?? "-"} />
        <InfoRow label={copy.contextLabels.hermesProfile} value={context?.hermesProfile ?? project?.hermesProfile ?? "-"} />
        <InfoRow label={copy.contextLabels.projectRules} value={context?.projectRulesPath ?? project?.rulesPath ?? "-"} />
        <InfoRow label={copy.contextLabels.taskRules} value={context?.taskRulesPath ?? task?.rulesPath ?? "-"} />
        <InfoRow label={copy.contextLabels.taskContext} value={context?.taskContextPath ?? task?.contextPath ?? "-"} />
        <InfoRow label={copy.contextLabels.recentMessages} value={String(context?.recentMessageCount ?? 0)} />
        <InfoRow label={copy.contextLabels.attachments} value={String(context?.attachmentCount ?? 0)} />
        <InfoRow label={copy.contextLabels.images} value={String(context?.imageAttachmentCount ?? 0)} />
        <InfoRow label={copy.contextLabels.contextChars} value={String(context?.contextChars ?? context?.contextLength ?? 0)} />
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-muted-foreground">{copy.includedFiles(files.length)}</summary>
        <div className="mt-2 space-y-1">
          {files.map((file) => (
            <code key={file} className="block truncate rounded bg-black/20 px-2 py-1" title={file}>
              {file}
            </code>
          ))}
        </div>
      </details>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-muted-foreground">{label}</div>
      <div className="truncate text-midground" title={value}>{value}</div>
    </div>
  );
}

function ruleCandidatePreview(content: string): string {
  return (
    content
      .split(/\n+/)
      .map((line) => line.trim())
      .find((line) => line && !/^[-*]\s*Candidate\b/i.test(line) && !/^Source:/i.test(line)) ??
    content.trim()
  ).replace(/^[-*]\s+/, "");
}

function RuleCandidates({
  candidate,
  applying,
  expanded,
  onToggle,
  onDismiss,
  onApplyRule,
}: {
  candidate: { scope: "project" | "task"; content: string };
  applying?: boolean;
  expanded: boolean;
  onToggle(): void;
  onDismiss(): void;
  onApplyRule(): void;
}) {
  const { locale } = useI18n();
  const copy = CHAT_COPY[locale];
  const target = candidate.scope === "project" ? "PROJECT_RULES.md" : "TASK_RULES.md";
  const preview = ruleCandidatePreview(candidate.content);
  return (
    <div className="border-t border-border bg-card/35 px-3 py-2">
      <div className="flex min-w-0 flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-w-0 items-center gap-2 rounded-md px-1 py-1 text-left transition hover:bg-card/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background/35 text-muted-foreground">
            <Info className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium text-midground">{copy.candidateSummary(target)}</span>
            <span className="block truncate text-xs text-muted-foreground" title={preview}>
              {preview}
            </span>
          </span>
        </button>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button type="button" size="sm" ghost onClick={onToggle} aria-expanded={expanded}>
            <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
            {expanded ? copy.candidateCollapse : copy.candidateView}
          </Button>
          <Button type="button" size="sm" outlined disabled={applying} onClick={onApplyRule}>
            <ListPlus className="h-4 w-4" />
            {applying ? "..." : copy.confirmTarget(target)}
          </Button>
          <Button type="button" size="sm" ghost disabled={applying} onClick={onDismiss}>
            <X className="h-4 w-4" />
            {copy.candidateDismiss}
          </Button>
        </div>
      </div>
      {expanded && (
        <div className="mt-2 rounded-md border border-border/70 bg-background/25 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            <FileText className="h-4 w-4" />
            {copy.candidateTitle(target)}
          </div>
          <LongText>{candidate.content}</LongText>
          <Button className="mt-2" type="button" size="sm" outlined disabled={applying} onClick={onApplyRule}>
            {applying ? "..." : copy.confirmTarget(target)}
          </Button>
        </div>
      )}
    </div>
  );
}
