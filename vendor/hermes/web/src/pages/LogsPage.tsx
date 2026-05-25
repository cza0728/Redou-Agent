import {
  useEffect,
  useLayoutEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import { FileText, RefreshCw, Send, MessageSquare, Trash2, Bot } from "lucide-react";
import { redouApi } from "@/lib/api";
import type { AnalysisLogEntry, AnalysisLogDetail } from "@/lib/api";
import { Badge } from "@nous-research/ui/ui/components/badge";
import { Button } from "@nous-research/ui/ui/components/button";
import { FilterGroup, Segmented } from "@nous-research/ui/ui/components/segmented";
import { Spinner } from "@nous-research/ui/ui/components/spinner";
import { Switch } from "@nous-research/ui/ui/components/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n";
import { usePageHeader } from "@/contexts/usePageHeader";
import { PluginSlot } from "@/plugins";

/* ── constants ── */
const FILE_OPTIONS = [
  { value: "redou", label: "Redou", title: "Redou" },
  { value: "agent", label: "agent", title: "agent.log" },
  { value: "errors", label: "问题日志", title: "问题日志" },
] as const;
type LogFile = (typeof FILE_OPTIONS)[number]["value"];
const LEVELS = ["ALL", "DEBUG", "INFO", "WARNING", "ERROR"] as const;
const COMPONENTS = ["all", "gateway", "agent", "tools", "cli", "cron"] as const;
const LINE_COUNTS = [50, 100, 200, 500] as const;

const COPY = {
  zh: {
    systemLogs: "系统日志",
    analysisLogs: "评测日志",
    selectModel: "选择评测日志",
    noAnalysisLogs: "暂无评测日志记录",
    aiChat: "AI 日志分析",
    aiChatPlaceholder: "询问AI关于日志的问题，如\"为什么第三题分数很低？\"",
    clearChat: "清空对话",
    thinking: "AI 分析中...",
    noChatYet: "选择一个评测日志后，可以在这里向 AI 提问。对话将保持记忆，可以连续追问。",
    taskSummary: "任务概要",
    status: "状态",
    score: "得分",
    duration: "耗时",
    tokens: "Tokens",
    apiCalls: "调用",
    error: "错误",
  },
  en: {
    systemLogs: "System Logs",
    analysisLogs: "Analysis Logs",
    selectModel: "Select analysis log",
    noAnalysisLogs: "No analysis log records yet",
    aiChat: "AI Log Analysis",
    aiChatPlaceholder: "Ask AI about the log, e.g. \"Why did task 3 score poorly?\"",
    clearChat: "Clear chat",
    thinking: "AI is analyzing...",
    noChatYet: "Select an analysis log, then ask AI questions here. The conversation has memory, so you can follow up.",
    taskSummary: "Task Summary",
    status: "Status",
    score: "Score",
    duration: "Duration",
    tokens: "Tokens",
    apiCalls: "Calls",
    error: "Error",
  },
} as const;

function classifyLine(line: string): "error" | "warning" | "info" | "debug" {
  const upper = line.toUpperCase();
  if (upper.includes("ERROR") || upper.includes("CRITICAL") || upper.includes("FATAL")) return "error";
  if (upper.includes("WARNING") || upper.includes("WARN")) return "warning";
  if (upper.includes("DEBUG")) return "debug";
  return "info";
}

const LINE_COLORS: Record<string, string> = {
  error: "text-destructive",
  warning: "text-warning",
  info: "text-foreground",
  debug: "text-muted-foreground/60",
};

const toOptions = <T extends string>(values: readonly T[]) =>
  values.map((v) => ({ value: v, label: v }));

const STATUS_COLORS: Record<string, string> = {
  completed: "text-emerald-300",
  running: "text-blue-300",
  queued: "text-yellow-300",
  failed: "text-red-300",
  interrupted: "text-orange-300",
};

/* ── chat message type ── */
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  model?: string;
}

/* ── System Logs Tab ── */
function SystemLogsTab() {
  const [file, setFile] = useState<LogFile>("agent");
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("ALL");
  const [component, setComponent] = useState<(typeof COMPONENTS)[number]>("all");
  const [lineCount, setLineCount] = useState<(typeof LINE_COUNTS)[number]>(100);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  const selectedFile = FILE_OPTIONS.find((o) => o.value === file) ?? FILE_OPTIONS[0];

  const fetchLogs = useCallback(() => {
    setLoading(true);
    setError(null);
    redouApi
      .getLogs({ file, lines: lineCount, level, component })
      .then((resp) => {
        setLines(resp.lines);
        setTimeout(() => {
          if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }, 50);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [file, lineCount, level, component]);

  useEffect(() => {
    const timer = window.setTimeout(fetchLogs, 0);
    return () => window.clearTimeout(timer);
  }, [fetchLogs]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <FilterGroup label={t.logs.file}>
          <Segmented value={file} onChange={(v) => setFile(v as LogFile)} options={FILE_OPTIONS.map(({ value, label }) => ({ value, label }))} />
        </FilterGroup>
        <FilterGroup label={t.logs.level}>
          <Segmented value={level} onChange={setLevel} options={toOptions(LEVELS)} />
        </FilterGroup>
        <FilterGroup label={t.logs.component}>
          <Segmented value={component} onChange={setComponent} options={toOptions(COMPONENTS)} />
        </FilterGroup>
        <FilterGroup label={t.logs.lines}>
          <Segmented value={String(lineCount)} onChange={(v) => setLineCount(Number(v) as (typeof LINE_COUNTS)[number])} options={LINE_COUNTS.map((n) => ({ value: String(n), label: String(n) }))} />
        </FilterGroup>
        <div className="flex items-center gap-2">
          <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} id="logs-auto-refresh" />
          <Label htmlFor="logs-auto-refresh" className="text-xs cursor-pointer">{t.logs.autoRefresh}</Label>
          {autoRefresh && (
            <Badge tone="success" className="text-[10px]">
              <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
              {t.common.live}
            </Badge>
          )}
        </div>
        <Button type="button" size="sm" outlined onClick={fetchLogs} disabled={loading} prefix={loading ? <Spinner /> : <RefreshCw />}>
          {t.common.refresh}
        </Button>
      </div>
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4" />
            {selectedFile.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {error && (
            <div className="bg-destructive/10 border-b border-destructive/20 p-3">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}
          <div ref={scrollRef} className="p-4 font-mono-ui text-xs leading-5 overflow-auto min-h-[400px] max-h-[calc(100vh-320px)]">
            {lines.length === 0 && !loading && (
              <p className="text-muted-foreground text-center py-8">{t.logs.noLogLines}</p>
            )}
            {lines.map((line, i) => {
              const cls = classifyLine(line);
              return (
                <div key={i} className={`${LINE_COLORS[cls]} hover:bg-secondary/20 px-1 -mx-1`}>
                  {line}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ── Analysis Logs Tab ── */
function AnalysisLogsTab() {
  const { locale } = useI18n();
  const copy = COPY[locale === "zh" ? "zh" : "en"];
  const [logEntries, setLogEntries] = useState<AnalysisLogEntry[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [logDetail, setLogDetail] = useState<AnalysisLogDetail | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const logScrollRef = useRef<HTMLDivElement>(null);

  // Load analysis log entries
  useEffect(() => {
    setLoadingList(true);
    redouApi.getAnalysisLogsList()
      .then((entries) => {
        setLogEntries(entries);
        if (entries.length > 0 && !selectedKey) {
          setSelectedKey(entries[0].key);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingList(false));
  }, []);

  // Load selected log detail
  useEffect(() => {
    if (!selectedKey) {
      setLogDetail(null);
      return;
    }
    setLoadingDetail(true);
    redouApi.getAnalysisLogDetail(selectedKey)
      .then((detail) => setLogDetail(detail))
      .catch(() => setLogDetail(null))
      .finally(() => setLoadingDetail(false));
  }, [selectedKey]);

  // Load persisted chat history when switching logs
  useEffect(() => {
    setChatMessages([]);
    setChatError(null);
    if (selectedKey) {
      redouApi.getAnalysisLogChatHistory(selectedKey)
        .then((history) => {
          if (history?.messages?.length > 0) {
            setChatMessages(history.messages.map((m) => ({ role: m.role, content: m.content })));
          }
        })
        .catch(() => {});
    }
  }, [selectedKey]);

  // Auto-scroll chat
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const sendChatMessage = useCallback(async () => {
    const msg = chatInput.trim();
    if (!msg || chatLoading) return;
    setChatInput("");
    setChatError(null);
    setChatMessages((prev) => [...prev, { role: "user", content: msg }]);
    setChatLoading(true);
    try {
      const resp = await redouApi.chatWithAnalysisLog({
        sessionKey: selectedKey,
        logKey: selectedKey,
        message: msg,
        locale: locale === "zh" ? "zh" : "en",
      });
      setChatMessages((prev) => [...prev, { role: "assistant", content: resp.reply, model: resp.model }]);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : String(err));
    } finally {
      setChatLoading(false);
    }
  }, [chatInput, chatLoading, selectedKey, locale]);

  const clearChat = useCallback(() => {
    setChatMessages([]);
    setChatError(null);
    if (selectedKey) {
      redouApi.clearAnalysisLogChat(selectedKey).catch(() => {});
    }
  }, [selectedKey]);

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  };

  const result = logDetail?.result;

  return (
    <div className="flex flex-col gap-4">
      {/* Model log selector */}
      <div className="flex items-center gap-3">
        <label className="text-xs font-medium text-muted-foreground shrink-0">{copy.selectModel}</label>
        <select
          value={selectedKey}
          onChange={(e) => setSelectedKey(e.target.value)}
          className="flex-1 min-w-0 rounded border border-border/60 bg-background/50 px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {logEntries.length === 0 && (
            <option value="">{copy.noAnalysisLogs}</option>
          )}
          {logEntries.map((entry) => (
            <option key={entry.key} value={entry.key}>
              {entry.model} ({entry.provider}) — {entry.status} — {entry.startedAt ? new Date(entry.startedAt).toLocaleString() : "N/A"}
            </option>
          ))}
        </select>
        {loadingList && <Spinner className="text-primary" />}
      </div>

      {/* Two-column layout: Log detail + AI Chat */}
      <div className="grid gap-4 lg:grid-cols-2" style={{ minHeight: "calc(100vh - 280px)" }}>
        {/* Left: Log detail viewer */}
        <Card className="min-w-0 flex flex-col">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="h-4 w-4" />
              {result ? `${result.model} (${result.provider})` : copy.selectModel}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 flex-1 flex flex-col">
            {loadingDetail ? (
              <div className="flex items-center justify-center py-16"><Spinner className="text-2xl text-primary" /></div>
            ) : !result ? (
              <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">{copy.noAnalysisLogs}</div>
            ) : (
              <div ref={logScrollRef} className="flex-1 overflow-auto p-4 text-xs" style={{ maxHeight: "calc(100vh - 380px)" }}>
                {/* Summary stats */}
                <div className="mb-4 grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <div className="border border-border/50 bg-background/20 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{copy.status}</div>
                    <div className={`font-mono-ui text-sm ${STATUS_COLORS[result.status] || "text-foreground"}`}>{result.status}</div>
                  </div>
                  <div className="border border-border/50 bg-background/20 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{copy.duration}</div>
                    <div className="font-mono-ui text-sm text-foreground">{formatDuration(result.totals?.durationMs || 0)}</div>
                  </div>
                  <div className="border border-border/50 bg-background/20 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{copy.tokens}</div>
                    <div className="font-mono-ui text-sm text-foreground">{(result.totals?.inputTokens || 0) + (result.totals?.outputTokens || 0)}</div>
                  </div>
                </div>
                {/* Per-task details */}
                <div className="mb-2 text-xs font-medium text-foreground">{copy.taskSummary}</div>
                <div className="space-y-2">
                  {result.tasks.map((task) => (
                    <div key={task.id} className="border border-border/50 bg-background/15 p-3">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-mono-ui font-medium text-foreground">{task.id.toUpperCase()}: {task.title}</span>
                        <span className={`font-mono-ui text-sm ${STATUS_COLORS[task.status] || "text-foreground"}`}>
                          {task.score}/100
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                        <span>{copy.status}: {task.status}</span>
                        <span>{copy.duration}: {formatDuration(task.durationMs || 0)}</span>
                        <span>{copy.apiCalls}: {task.apiCalls || 0}</span>
                      </div>
                      {task.error && (
                        <div className="mt-2 border border-red-400/30 bg-red-500/10 p-2 text-[11px] text-red-200 whitespace-pre-wrap">
                          {task.error}
                        </div>
                      )}
                      {task.sections && task.sections.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {task.sections.map((section) => (
                            <div key={section.id} className="flex items-center justify-between gap-2">
                              <span className="text-[11px] text-muted-foreground truncate">{section.label}</span>
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 w-16 bg-background/30 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${section.score >= 70 ? "bg-emerald-400" : section.score >= 40 ? "bg-yellow-400" : "bg-red-400"}`}
                                    style={{ width: `${Math.min(section.score, 100)}%` }}
                                  />
                                </div>
                                <span className="font-mono-ui text-[11px] w-8 text-right">{section.score}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {/* Raw summary */}
                {result.summary && (
                  <div className="mt-4 border border-border/50 bg-background/15 p-3">
                    <div className="text-[11px] font-medium text-muted-foreground mb-1">Summary</div>
                    <p className="text-[11px] text-foreground whitespace-pre-wrap">{result.summary}</p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right: AI Chat */}
        <Card className="min-w-0 flex flex-col">
          <CardHeader className="py-3 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Bot className="h-4 w-4" />
                {copy.aiChat}
              </CardTitle>
              {chatMessages.length > 0 && (
                <Button type="button" size="sm" outlined onClick={clearChat} prefix={<Trash2 className="h-3 w-3" />} className="text-[11px]">
                  {copy.clearChat}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0 flex-1 flex flex-col">
            {/* Messages area */}
            <div ref={chatScrollRef} className="flex-1 overflow-auto p-4 space-y-3" style={{ maxHeight: "calc(100vh - 440px)" }}>
              {chatMessages.length === 0 && !chatLoading && (
                <div className="flex flex-col items-center justify-center py-12 text-center text-sm text-muted-foreground">
                  <MessageSquare className="mb-3 h-8 w-8 opacity-40" />
                  <p className="max-w-xs">{copy.noChatYet}</p>
                </div>
              )}
              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                      msg.role === "user"
                        ? "bg-primary/20 text-foreground"
                        : "border border-border/50 bg-background/30 text-foreground"
                    }`}
                  >
                    {msg.content}
                    {msg.model && (
                      <div className="mt-1 text-[10px] text-muted-foreground opacity-60">via {msg.model}</div>
                    )}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex justify-start">
                  <div className="border border-border/50 bg-background/30 rounded-lg px-3 py-2 text-sm text-muted-foreground flex items-center gap-2">
                    <Spinner className="text-primary" />
                    {copy.thinking}
                  </div>
                </div>
              )}
              {chatError && (
                <div className="border border-red-400/30 bg-red-500/10 rounded-lg px-3 py-2 text-sm text-red-200">
                  {chatError}
                </div>
              )}
            </div>
            {/* Input area */}
            <div className="border-t border-border/50 p-3 flex gap-2">
              <Input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendChatMessage(); } }}
                placeholder={copy.aiChatPlaceholder}
                disabled={!selectedKey || chatLoading}
                className="flex-1"
              />
              <Button
                type="button"
                size="sm"
                onClick={() => void sendChatMessage()}
                disabled={!selectedKey || chatLoading || !chatInput.trim()}
                prefix={chatLoading ? <Spinner /> : <Send className="h-3.5 w-3.5" />}
              >
                {locale === "zh" ? "发送" : "Send"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ── Main LogsPage ── */
export default function LogsPage() {
  const { locale } = useI18n();
  const copy = COPY[locale === "zh" ? "zh" : "en"];
  const { setAfterTitle, setEnd } = usePageHeader();
  const [activeTab, setActiveTab] = useState<"system" | "analysis">("system");

  useLayoutEffect(() => {
    setAfterTitle(
      <span className="flex items-center gap-2">
        <Badge tone="secondary" className="text-[10px]">
          {activeTab === "system" ? copy.systemLogs : copy.analysisLogs}
        </Badge>
      </span>,
    );
    setEnd(null);
    return () => {
      setAfterTitle(null);
      setEnd(null);
    };
  }, [activeTab, copy, setAfterTitle, setEnd]);

  return (
    <div className="flex flex-col gap-4">
      <PluginSlot name="logs:top" />

      {/* Tab switcher */}
      <div className="flex items-center gap-1 border-b border-border/50 pb-0">
        <button
          type="button"
          onClick={() => setActiveTab("system")}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
            activeTab === "system"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <FileText className="inline h-3.5 w-3.5 mr-1.5 -mt-0.5" />
          {copy.systemLogs}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("analysis")}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
            activeTab === "analysis"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Bot className="inline h-3.5 w-3.5 mr-1.5 -mt-0.5" />
          {copy.analysisLogs}
        </button>
      </div>

      {activeTab === "system" ? <SystemLogsTab /> : <AnalysisLogsTab />}

      <PluginSlot name="logs:bottom" />
    </div>
  );
}
