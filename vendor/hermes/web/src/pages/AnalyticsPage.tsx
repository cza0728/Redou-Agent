import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import {
  BarChart3,
  Check,
  Clock3,
  Cpu,
  FileText,
  Play,
  RefreshCw,
  Square,
  TriangleAlert,
} from "lucide-react";
import { redouApi } from "@/lib/api";
import type {
  AnalysisBenchmarkResult,
  AnalysisBenchmarkTaskResult,
  AnalysisBenchmarksResponse,
  ModelOptionProvider,
  ModelOptionsResponse,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@nous-research/ui/ui/components/button";
import { Spinner } from "@nous-research/ui/ui/components/spinner";
import { Badge } from "@nous-research/ui/ui/components/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { usePageHeader } from "@/contexts/usePageHeader";
import { useI18n } from "@/i18n";
import { PluginSlot } from "@/plugins";

interface BenchmarkModelChoice {
  key: string;
  provider: string;
  model: string;
  current: boolean;
}

type AbilityScoreKey = keyof AnalysisBenchmarkResult["abilityScores"];

const ABILITY_RADAR_AXES: Array<{
  key: AbilityScoreKey;
  zh: string;
  en: string;
  titleZh: string;
  titleEn: string;
}> = [
  {
    key: "environmentConstraints",
    zh: "环境约束",
    en: "Env",
    titleZh: "环境与约束执行",
    titleEn: "Environment and constraints",
  },
  {
    key: "projectDelivery",
    zh: "项目交付",
    en: "Project",
    titleZh: "端到端项目实现",
    titleEn: "End-to-end project delivery",
  },
  {
    key: "debugRepair",
    zh: "调试修复",
    en: "Debug",
    titleZh: "复杂代码理解与调试修复",
    titleEn: "Debugging and repair",
  },
  {
    key: "frameworkExtension",
    zh: "框架扩展",
    en: "API",
    titleZh: "框架扩展与 API 集成",
    titleEn: "Framework extension and APIs",
  },
  {
    key: "parsingEdgeCases",
    zh: "解析边界",
    en: "Parser",
    titleZh: "解析与边界处理",
    titleEn: "Parsing and edge cases",
  },
  {
    key: "verificationIteration",
    zh: "验证闭环",
    en: "Verify",
    titleZh: "测试验证与迭代闭环",
    titleEn: "Verification and iteration",
  },
  {
    key: "researchProduct",
    zh: "调研方案",
    en: "Research",
    titleZh: "调研分析与产品设计",
    titleEn: "Research and product planning",
  },
  {
    key: "documentationReproducibility",
    zh: "文档复现",
    en: "Docs",
    titleZh: "文档交付与可复现性",
    titleEn: "Documentation and reproducibility",
  },
];

const STATUS_COPY: Record<string, { zh: string; en: string }> = {
  queued: { zh: "排队中", en: "Queued" },
  running: { zh: "测试中", en: "Running" },
  completed: { zh: "已完成", en: "Completed" },
  failed: { zh: "失败", en: "Failed" },
  interrupted: { zh: "已中断", en: "Interrupted" },
  pending: { zh: "未开始", en: "Pending" },
};

const COPY = {
  zh: {
    titleBadge: "模型能力评测",
    configuredModels: "已配置模型",
    searchModels: "搜索模型或提供方",
    selected: "已选",
    start: "开始测试",
    refresh: "刷新",
    noModels: "没有可测试的已配置模型",
    noResults: "还没有模型评测结果",
    runningHint: "task1-9 会按顺序执行",
    persistedHint: "同款模型重测会替换旧结果",
    queueDepth: "队列",
    overall: "综合",
    tasks: "任务",
    tokens: "Tokens",
    input: "输入",
    output: "输出",
    apiCalls: "调用",
    duration: "耗时",
    cost: "成本",
    workspace: "工作区",
    score: "得分",
    abilityRadar: "能力雷达",
    sections: "板块效果",
    error: "错误",
    current: "当前",
    agent: "Agent",
  },
  en: {
    titleBadge: "Model benchmark",
    configuredModels: "Configured models",
    searchModels: "Search models or providers",
    selected: "Selected",
    start: "Start",
    refresh: "Refresh",
    noModels: "No configured models are available",
    noResults: "No model benchmark results yet",
    runningHint: "task1-9 run in order",
    persistedHint: "Retesting the same model replaces the old result",
    queueDepth: "Queue",
    overall: "Overall",
    tasks: "Tasks",
    tokens: "Tokens",
    input: "Input",
    output: "Output",
    apiCalls: "Calls",
    duration: "Duration",
    cost: "Cost",
    workspace: "Workspace",
    score: "Score",
    abilityRadar: "Ability radar",
    sections: "Section effects",
    error: "Error",
    current: "Current",
    agent: "Agent",
  },
} as const;

function modelKey(provider: string, model: string): string {
  return `${provider || "auto"}\n${model || "default"}`;
}

function shortModel(model: string): string {
  const slash = model.indexOf("/");
  return slash > 0 ? model.slice(slash + 1) : model;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.max(0, Math.round(value || 0)));
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round((ms || 0) / 1000));
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function isLiveStatus(status: string): boolean {
  return status === "queued" || status === "running";
}

function elapsedFrom(startedAt: string | null, nowMs: number): number {
  const startedMs = startedAt ? Date.parse(startedAt) : Number.NaN;
  return Number.isFinite(startedMs) ? Math.max(0, nowMs - startedMs) : 0;
}

function taskDurationMs(task: AnalysisBenchmarkTaskResult, nowMs: number): number {
  if (!isLiveStatus(task.status)) return task.durationMs;
  return Math.max(task.durationMs || 0, elapsedFrom(task.startedAt, nowMs));
}

function totalDurationMs(result: AnalysisBenchmarkResult, nowMs: number): number {
  const taskTotal = result.tasks.reduce((sum, task) => sum + taskDurationMs(task, nowMs), 0);
  if (taskTotal > 0) return Math.max(result.totals.durationMs || 0, taskTotal);
  if (isLiveStatus(result.status)) {
    return Math.max(result.totals.durationMs || 0, elapsedFrom(result.startedAt, nowMs));
  }
  return result.totals.durationMs;
}

function hasLiveBenchmarks(benchmarks: AnalysisBenchmarksResponse | null): boolean {
  return Boolean(
    benchmarks?.results.some(
      (result) =>
        isLiveStatus(result.status) ||
        result.tasks.some((task) => isLiveStatus(task.status)),
    ),
  );
}

function formatCost(value: number): string {
  if (!value) return "$0";
  if (value >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(4)}`;
}

function statusLabel(status: string, locale: "zh" | "en"): string {
  return STATUS_COPY[status]?.[locale] ?? status;
}

function scoreColor(score: number): string {
  if (score >= 80) return "text-emerald-300";
  if (score >= 55) return "text-[#ffe6cb]";
  return "text-red-300";
}

function radarPointColor(score: number, status: string): string {
  if (isLiveStatus(status)) return "#60a5fa";
  if (score >= 80) return "#34d399";
  if (score >= 55) return "#ffe6cb";
  return "#f87171";
}

function scoreIsFinal(status: string): boolean {
  return status === "completed" || status === "failed";
}

function scoreLabel(score: number, status: string): string {
  return scoreIsFinal(status) ? `${score}` : "-";
}

function scoreValueClass(score: number, status: string): string {
  return scoreIsFinal(status) ? scoreColor(score) : "text-muted-foreground";
}

function taskScoreAverage(tasks: AnalysisBenchmarkTaskResult[]): number {
  if (tasks.length === 0) return 0;
  return Math.round(
    tasks.reduce((sum, task) => sum + Math.max(0, Math.min(100, task.score || 0)), 0) /
      tasks.length,
  );
}

function benchmarkOverallScore(result: AnalysisBenchmarkResult): number {
  const scores = Object.values(result.abilityScores ?? {});
  if (scores.length > 0) {
    return Math.round(
      scores.reduce((sum, score) => sum + Math.max(0, Math.min(100, score || 0)), 0) /
        scores.length,
    );
  }
  if (result.tasks.length > 0) return taskScoreAverage(result.tasks);
  return 0;
}

function benchmarkEvaluationTimeMs(result: AnalysisBenchmarkResult): number {
  const timestamp = result.completedAt || result.updatedAt || result.startedAt;
  const timeMs = timestamp ? Date.parse(timestamp) : Number.NaN;
  return Number.isFinite(timeMs) ? timeMs : 0;
}

function buildChoices(options: ModelOptionsResponse | null): BenchmarkModelChoice[] {
  const choices = new Map<string, BenchmarkModelChoice>();
  const add = (provider: string, model: string, current = false) => {
    const cleanProvider = String(provider || "auto").trim();
    const cleanModel = String(model || "").trim();
    if (!cleanModel) return;
    const key = modelKey(cleanProvider, cleanModel);
    const existing = choices.get(key);
    choices.set(key, {
      key,
      provider: cleanProvider,
      model: cleanModel,
      current: current || existing?.current || false,
    });
  };

  if (options?.provider && options?.model) {
    add(options.provider, options.model, true);
  }

  for (const provider of options?.providers ?? []) {
    const providerId = provider.slug || provider.name || "auto";
    const models = provider.models ?? [];
    for (const model of models) {
      add(providerId, model, Boolean(provider.is_current && model === options?.model));
    }
    if (models.length === 0 && provider.is_current && options?.model) {
      add(providerId, options.model, true);
    }
  }

  return [...choices.values()].sort((left, right) => {
    if (left.current !== right.current) return left.current ? -1 : 1;
    return `${left.provider}/${left.model}`.localeCompare(`${right.provider}/${right.model}`);
  });
}

function providerLabel(provider: ModelOptionProvider | undefined, fallback: string): string {
  return provider?.name || provider?.slug || fallback;
}

function AbilityRadarChart({ result }: { result: AnalysisBenchmarkResult }) {
  const { locale } = useI18n();
  const copy = COPY[locale === "zh" ? "zh" : "en"];
  const localeKey = locale === "zh" ? "zh" : "en";
  const axes = ABILITY_RADAR_AXES.map((axis) => ({
    key: axis.key,
    label: localeKey === "zh" ? axis.zh : axis.en,
    title: localeKey === "zh" ? axis.titleZh : axis.titleEn,
    status: result.status,
    value: Math.max(0, Math.min(100, result.abilityScores[axis.key] || 0)),
  }));
  const center = 150;
  const radius = 88;
  const labelRadius = 122;
  const angleFor = (index: number) => (Math.PI * 2 * index) / axes.length - Math.PI / 2;
  const point = (index: number, value: number) => {
    const angle = angleFor(index);
    const r = radius * (Math.max(0, Math.min(100, value)) / 100);
    return `${center + Math.cos(angle) * r},${center + Math.sin(angle) * r}`;
  };
  const polygon = axes.map((axis, index) => point(index, axis.value)).join(" ");
  const rings = [25, 50, 75, 100].map((value) =>
    axes.map((_axis, index) => point(index, value)).join(" "),
  );

  return (
    <div className="flex w-full flex-col items-center gap-2">
      <div className="font-expanded text-[10px] uppercase text-muted-foreground">
        {copy.abilityRadar}
      </div>
      <svg
        viewBox="0 0 300 300"
        className="h-64 w-full max-w-[320px]"
        role="img"
        aria-label="model benchmark ability radar"
      >
        {rings.map((ring, index) => (
          <polygon
            key={index}
            points={ring}
            fill="none"
            stroke="currentColor"
            className="text-muted-foreground/20"
            strokeWidth="1"
          />
        ))}
        {axes.map((axis, index) => {
          const angle = angleFor(index);
          const x = center + Math.cos(angle) * labelRadius;
          const y = center + Math.sin(angle) * labelRadius;
          const anchor = x < center - 10 ? "end" : x > center + 10 ? "start" : "middle";
          const valueY = y + 12;
          return (
            <g key={axis.key}>
              <title>{`${axis.label} · ${axis.title}: ${axis.value}`}</title>
              <line
                x1={center}
                y1={center}
                x2={center + Math.cos(angle) * radius}
                y2={center + Math.sin(angle) * radius}
                stroke="currentColor"
                className="text-muted-foreground/20"
                strokeWidth="1"
              />
              <text
                x={x}
                y={y}
                textAnchor={anchor}
                dominantBaseline="middle"
                className="fill-foreground font-mono-ui text-[10px]"
              >
                {axis.label}
              </text>
              <text
                x={x}
                y={valueY}
                textAnchor={anchor}
                dominantBaseline="middle"
                className="fill-muted-foreground font-mono-ui text-[8px]"
              >
                {axis.value}
              </text>
            </g>
          );
        })}
        <polygon points={polygon} fill="rgba(255,230,203,0.18)" stroke="#ffe6cb" strokeWidth="2" />
        {axes.map((axis, index) => {
          const [x, y] = point(index, axis.value).split(",").map(Number);
          return (
            <circle
              key={axis.key}
              cx={x}
              cy={y}
              r="3.5"
              fill={radarPointColor(axis.value, axis.status)}
            >
              <title>{`${axis.label} · ${axis.title}: ${axis.value}`}</title>
            </circle>
          );
        })}
      </svg>
    </div>
  );
}

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="h-2 w-full overflow-hidden bg-muted/40">
      <div
        className={cn(
          "h-full transition-all",
          score >= 80 ? "bg-emerald-400/80" : score >= 55 ? "bg-[#ffe6cb]/80" : "bg-red-400/70",
        )}
        style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
      />
    </div>
  );
}

function TaskRow({ task, nowMs }: { task: AnalysisBenchmarkTaskResult; nowMs: number }) {
  const { locale } = useI18n();
  const copy = COPY[locale === "zh" ? "zh" : "en"];
  const localeKey = locale === "zh" ? "zh" : "en";
  const [open, setOpen] = useState(false);
  const tokenTotal =
    task.inputTokens + task.outputTokens + task.cacheReadTokens + task.reasoningTokens;
  const artifacts = task.artifacts;
  const hasArtifacts = Boolean(
    artifacts?.rootPath ||
    artifacts?.batchLogPath ||
    artifacts?.reports?.length ||
    artifacts?.logs?.length ||
    artifacts?.modelResults?.length,
  );

  return (
    <div className="border-t border-border/60 first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 px-0 py-3 text-left"
      >
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="font-expanded text-xs uppercase tracking-[0.08em] text-foreground">
              {task.id.toUpperCase()}
            </span>
            <span className="truncate text-sm text-muted-foreground">{task.title}</span>
            {task.status === "running" && <Spinner className="text-primary" />}
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-4">
            <Metric label={copy.duration} value={formatDuration(taskDurationMs(task, nowMs))} icon={<Clock3 />} />
            <Metric label={copy.tokens} value={formatTokens(tokenTotal)} icon={<BarChart3 />} />
            <Metric label={copy.apiCalls} value={String(task.apiCalls || 0)} icon={<Cpu />} />
            <Metric label={copy.score} value={scoreLabel(task.score, task.status)} icon={<FileText />} valueClassName={scoreValueClass(task.score, task.status)} />
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Badge tone="secondary" className="text-[10px]">
            {statusLabel(task.status, localeKey)}
          </Badge>
          <span className={cn("font-expanded text-lg", scoreValueClass(task.score, task.status))}>
            {scoreLabel(task.score, task.status)}
          </span>
        </div>
      </button>
      {open && (
        <div className="pb-4">
          {task.error && (
            <div className="mb-3 border border-red-400/30 bg-red-500/10 p-3 text-xs text-red-200">
              <div className="mb-1 flex items-center gap-2 font-medium">
                <TriangleAlert className="h-3.5 w-3.5" />
                {copy.error}
              </div>
              <p className="whitespace-pre-wrap">{task.error}</p>
            </div>
          )}
          {hasArtifacts && (
            <div className="mb-3 border border-border/60 bg-background/25 p-3 text-xs">
              <div className="mb-2 flex items-center gap-2 font-medium text-foreground">
                <FileText className="h-3.5 w-3.5" />
                Artifacts
              </div>
              {artifacts?.rootPath && (
                <div className="mb-2 truncate font-mono-ui text-[11px] text-muted-foreground" title={artifacts.rootPath}>
                  {artifacts.rootPath}
                </div>
              )}
              {artifacts?.batchLogPath && (
                <div className="mb-2">
                  <div className="truncate font-mono-ui text-[11px] text-muted-foreground" title={artifacts.batchLogPath}>
                    Batch log: {artifacts.batchLogPath}
                  </div>
                  {artifacts.batchLogPreview && (
                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap border border-border/50 bg-background/30 p-2 font-mono-ui text-[11px] leading-4 text-muted-foreground">
                      {artifacts.batchLogPreview}
                    </pre>
                  )}
                </div>
              )}
              {[
                ["Reports", artifacts?.reports],
                ["Logs", artifacts?.logs],
                ["Model results", artifacts?.modelResults],
              ].map(([label, files]) =>
                Array.isArray(files) && files.length > 0 ? (
                  <div key={label as string} className="mt-2">
                    <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                      {label as string}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {files.map((file) => (
                        <span key={file} className="border border-border/50 bg-background/30 px-2 py-1 font-mono-ui text-[11px] text-muted-foreground">
                          {file}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null,
              )}
            </div>
          )}
          <div className="grid gap-2 md:grid-cols-2">
            {task.sections.map((section) => (
              <div key={section.id} className="border border-border/60 bg-background/25 p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="truncate text-xs font-medium text-foreground">
                    {section.label}
                  </span>
                  <span className={cn("font-mono-ui text-xs", scoreColor(section.score))}>
                    {section.score}
                  </span>
                </div>
                <ScoreBar score={section.score} />
                {section.evidence && (
                  <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                    {section.evidence}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  icon,
  valueClassName,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 border border-border/50 bg-background/20 px-2.5 py-1.5">
      <div className="flex min-w-0 items-center gap-1.5 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        <span className="h-3 w-3 shrink-0 [&>svg]:h-3 [&>svg]:w-3">{icon}</span>
        <span className="min-w-0 truncate">{label}</span>
      </div>
      <div className={cn("shrink-0 truncate font-mono-ui text-sm text-foreground", valueClassName)}>
        {value}
      </div>
    </div>
  );
}

function ModelResultCard({
  result,
  nowMs,
  comparisonMode = false,
}: {
  result: AnalysisBenchmarkResult;
  nowMs: number;
  comparisonMode?: boolean;
}) {
  const { locale } = useI18n();
  const copy = COPY[locale === "zh" ? "zh" : "en"];
  const localeKey = locale === "zh" ? "zh" : "en";
  const totalTokens =
    result.totals.inputTokens +
    result.totals.outputTokens +
    result.totals.cacheReadTokens +
    result.totals.reasoningTokens;
  const overall = benchmarkOverallScore(result);
  const overallLabel = scoreLabel(overall, result.status);

  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate text-base normal-case tracking-[0.02em]">
              {shortModel(result.model || "default")}
            </CardTitle>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono-ui">{result.provider || "auto"}</span>
              <span>·</span>
              <span>{copy.agent}: {result.agent}</span>
            </div>
          </div>
          <Badge tone="secondary" className="text-[10px]">
            {statusLabel(result.status, localeKey)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div
          className={cn(
            "grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]",
            comparisonMode && "2xl:grid-cols-1",
          )}
        >
          <div className="flex flex-col items-center justify-center border border-border/50 bg-background/20 p-3">
            <AbilityRadarChart result={result} />
            <div className="grid w-full grid-cols-3 gap-2">
              <Metric label={copy.overall} value={overallLabel} icon={<BarChart3 />} valueClassName={scoreValueClass(overall, result.status)} />
              <Metric label={copy.duration} value={formatDuration(totalDurationMs(result, nowMs))} icon={<Clock3 />} />
              <Metric label={copy.tokens} value={formatTokens(totalTokens)} icon={<Cpu />} />
            </div>
          </div>

          <div className="min-w-0">
            <div className="mb-3 grid gap-2 sm:grid-cols-4">
              <Metric label={copy.input} value={formatTokens(result.totals.inputTokens)} icon={<BarChart3 />} />
              <Metric label={copy.output} value={formatTokens(result.totals.outputTokens)} icon={<BarChart3 />} />
              <Metric label={copy.apiCalls} value={String(result.totals.apiCalls || 0)} icon={<Cpu />} />
              <Metric label={copy.cost} value={formatCost(result.totals.estimatedCostUsd)} icon={<FileText />} />
            </div>
            {result.workspacePath && (
              <div className="mb-3 truncate border border-border/50 bg-background/20 px-3 py-2 font-mono-ui text-[11px] text-muted-foreground" title={result.workspacePath}>
                {copy.workspace}: {result.workspacePath}
              </div>
            )}
            {result.summary && (result.status === "failed" || result.status === "interrupted") && (
              <div className="mb-3 border border-red-400/30 bg-red-500/10 p-3 text-xs text-red-200">
                <div className="mb-1 flex items-center gap-2 font-medium">
                  <TriangleAlert className="h-3.5 w-3.5" />
                  {copy.error}
                </div>
                <p className="whitespace-pre-wrap">{result.summary}</p>
              </div>
            )}
            <div className="border border-border/50 bg-background/15 px-4">
              {result.tasks.map((task) => (
                <TaskRow key={task.id} task={task} nowMs={nowMs} />
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AnalyticsPage() {
  const { locale } = useI18n();
  const copy = COPY[locale === "zh" ? "zh" : "en"];
  const { setAfterTitle, setEnd } = usePageHeader();
  const [benchmarks, setBenchmarks] = useState<AnalysisBenchmarksResponse | null>(null);
  const [modelOptions, setModelOptions] = useState<ModelOptionsResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextBenchmarks, nextModels] = await Promise.all([
        redouApi.getAnalysisBenchmarks(),
        redouApi.getModelOptions(),
      ]);
      setBenchmarks(nextBenchmarks);
      setModelOptions(nextModels);
      const choices = buildChoices(nextModels);
      setSelected((current) => {
        if (current.size > 0) return current;
        const first = choices.find((choice) => choice.current) ?? choices[0];
        return first ? new Set([first.key]) : current;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    try {
      cleanup = redouApi.onAnalysisEvent(() => {
        void redouApi.getAnalysisBenchmarks().then(setBenchmarks);
      });
    } catch {
      cleanup = undefined;
    }
    return cleanup;
  }, []);

  useEffect(() => {
    if (!hasLiveBenchmarks(benchmarks)) return;
    const tick = () => setNowMs(Date.now());
    const initialTimer = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [benchmarks]);

  useEffect(() => {
    if (!hasLiveBenchmarks(benchmarks)) return;
    const timer = window.setInterval(() => {
      void redouApi.getAnalysisBenchmarks().then(setBenchmarks).catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [benchmarks]);

  const providerBySlug = useMemo(() => {
    const map = new Map<string, ModelOptionProvider>();
    for (const provider of modelOptions?.providers ?? []) {
      map.set(provider.slug || provider.name || "", provider);
    }
    return map;
  }, [modelOptions]);

  const choices = useMemo(() => buildChoices(modelOptions), [modelOptions]);
  const filteredChoices = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return choices;
    return choices.filter((choice) =>
      `${choice.provider} ${choice.model}`.toLowerCase().includes(q),
    );
  }, [choices, query]);

  const selectedModels = useMemo(
    () => choices.filter((choice) => selected.has(choice.key)),
    [choices, selected],
  );
  const benchmarkResults = useMemo(
    () =>
      [...(benchmarks?.results ?? [])].sort(
        (left, right) => benchmarkEvaluationTimeMs(right) - benchmarkEvaluationTimeMs(left),
      ),
    [benchmarks?.results],
  );
  const runningCount =
    benchmarks?.results.filter((result) => isLiveStatus(result.status)).length ?? 0;
  const comparisonMode = benchmarkResults.length > 1;

  const toggleModel = (choice: BenchmarkModelChoice) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(choice.key)) next.delete(choice.key);
      else next.add(choice.key);
      return next;
    });
  };

  const start = useCallback(async () => {
    if (selectedModels.length === 0 || starting) return;
    setStarting(true);
    setError(null);
    try {
      await redouApi.startAnalysisBenchmarks({
        models: selectedModels.map(({ provider, model }) => ({ provider, model })),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }, [load, selectedModels, starting]);

  useLayoutEffect(() => {
    setAfterTitle(
      <span className="flex items-center gap-2">
        {(loading || runningCount > 0) && <Spinner className="shrink-0 text-base text-primary" />}
        <Badge tone="secondary" className="text-[10px]">
          {copy.titleBadge}
        </Badge>
        {runningCount > 0 && (
          <Badge tone="secondary" className="text-[10px]">
            {copy.queueDepth} {benchmarks?.queueDepth ?? 0}
          </Badge>
        )}
      </span>,
    );
    setEnd(
      <div className="flex w-full min-w-0 flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          size="sm"
          outlined
          onClick={() => void load()}
          disabled={loading}
          prefix={loading ? <Spinner /> : <RefreshCw />}
        >
          {copy.refresh}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => void start()}
          disabled={starting || selectedModels.length === 0}
          prefix={starting ? <Spinner /> : <Play />}
        >
          {copy.start}
        </Button>
      </div>,
    );
    return () => {
      setAfterTitle(null);
      setEnd(null);
    };
  }, [benchmarks?.queueDepth, copy, load, loading, runningCount, selectedModels.length, setAfterTitle, setEnd, start, starting]);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PluginSlot name="analytics:top" />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">{copy.configuredModels}</CardTitle>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span>{copy.selected}: {selectedModels.length}</span>
                <span>·</span>
                <span>{copy.runningHint}</span>
                <span>·</span>
                <span>{copy.persistedHint}</span>
              </div>
            </div>
            <div className="w-full sm:w-80">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={copy.searchModels}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="mb-4 border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">
              {error}
            </div>
          )}

          {loading && !benchmarks ? (
            <div className="flex items-center justify-center py-16">
              <Spinner className="text-2xl text-primary" />
            </div>
          ) : filteredChoices.length === 0 ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              {copy.noModels}
            </div>
          ) : (
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {filteredChoices.map((choice) => {
                const active = selected.has(choice.key);
                const provider = providerBySlug.get(choice.provider);
                return (
                  <button
                    key={choice.key}
                    type="button"
                    onClick={() => toggleModel(choice)}
                    className={cn(
                      "flex min-w-0 items-start gap-3 border p-3 text-left transition-colors",
                      active
                        ? "border-[#ffe6cb]/70 bg-[#ffe6cb]/10"
                        : "border-border/60 bg-background/20 hover:border-border",
                    )}
                  >
                    <span className="mt-0.5 text-muted-foreground">
                      {active ? <Check className="h-4 w-4 text-emerald-300" /> : <Square className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-mono-ui text-sm text-foreground">
                          {shortModel(choice.model)}
                        </span>
                        {choice.current && (
                          <Badge tone="secondary" className="shrink-0 text-[10px]">
                            {copy.current}
                          </Badge>
                        )}
                      </span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground">
                        {providerLabel(provider, choice.provider)} · {choice.provider}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {benchmarks && benchmarkResults.length === 0 ? (
        <Card>
          <CardContent className="py-14">
            <div className="flex flex-col items-center text-muted-foreground">
              <BarChart3 className="mb-3 h-8 w-8 opacity-45" />
              <p className="text-sm">{copy.noResults}</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid min-w-0 gap-6 2xl:grid-cols-2">
          {benchmarkResults.map((result) => (
            <ModelResultCard
              key={result.key}
              result={result}
              nowMs={nowMs}
              comparisonMode={comparisonMode}
            />
          ))}
        </div>
      )}

      <PluginSlot name="analytics:bottom" />
    </div>
  );
}
