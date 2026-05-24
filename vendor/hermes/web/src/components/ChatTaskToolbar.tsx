import { Badge } from "@nous-research/ui/ui/components/badge";
import {
  CHAT_PROJECTS_CHANGED_EVENT,
  MODEL_OPTIONS_CHANGED_EVENT,
  redouApi,
  type AgentEvent,
  type ChatProject,
  type ChatTask,
  type ModelOptionProvider,
} from "@/lib/api";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import type { ToolEntry } from "@/components/ToolCall";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Layers3,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

interface Props {
  channel: string;
  selectedProjectId: string | null;
  selectedTaskId: string | null;
}

const TOOL_LIMIT = 12;

const COPY = {
  zh: {
    selectTask: "选择任务",
    noProject: "未选择项目",
    modelUnset: "\u6a21\u578b\u672a\u8bbe\u7f6e",
    tools: "工具",
    idle: "空闲",
    running: (count: number) => `${count} 运行中`,
    calls: (count: number) => `${count} 次调用`,
    disconnected: "工具状态断开",
  },
  en: {
    selectTask: "Select a task",
    noProject: "No project selected",
    modelUnset: "model unset",
    tools: "tools",
    idle: "idle",
    running: (count: number) => `${count} running`,
    calls: (count: number) => `${count} calls`,
    disconnected: "tools feed disconnected",
  },
} as const;

function selectClass(className?: string): string {
  return cn(
    "h-8 min-w-0 rounded-md border border-border/80 bg-background/50 px-2 text-xs outline-none",
    "focus-visible:border-foreground/25 focus-visible:ring-1 focus-visible:ring-foreground/30",
    "disabled:cursor-not-allowed disabled:opacity-50",
    className,
  );
}

function shortModel(provider: string, model: string, fallback: string): string {
  if (!provider || !model) return fallback;
  return `${provider}/${model}`.replace(/^minimax-cn\//, "minimax/");
}

export function ChatTaskToolbar({
  selectedProjectId,
  selectedTaskId,
}: Props) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const [project, setProject] = useState<ChatProject | null>(null);
  const [task, setTask] = useState<ChatTask | null>(null);
  const [modelProviders, setModelProviders] = useState<ModelOptionProvider[]>([]);
  const [modelProviderDraft, setModelProviderDraft] = useState("");
  const [modelDraft, setModelDraft] = useState("");
  const [configModelProvider, setConfigModelProvider] = useState("");
  const [configModel, setConfigModel] = useState("");
  const [tools, setTools] = useState<ToolEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<"model" | null>(null);
  const selectedIdsRef = useRef<{ projectId: string | null; taskId: string | null }>({
    projectId: selectedProjectId,
    taskId: selectedTaskId,
  });

  useLayoutEffect(() => {
    selectedIdsRef.current = { projectId: selectedProjectId, taskId: selectedTaskId };
  }, [selectedProjectId, selectedTaskId]);

  const providerOptions = useMemo(() => {
    const syntheticProviders: ModelOptionProvider[] = [];
    if (
      modelProviderDraft &&
      !modelProviders.some((provider) => provider.slug === modelProviderDraft)
    ) {
      syntheticProviders.push({
        name: modelProviderDraft,
        slug: modelProviderDraft,
        models: modelDraft ? [modelDraft] : [],
      });
    }
    if (
      !modelProviderDraft &&
      configModelProvider &&
      configModelProvider !== "auto" &&
      !modelProviders.some((provider) => provider.slug === configModelProvider)
    ) {
      syntheticProviders.push({
        name: configModelProvider,
        slug: configModelProvider,
        models: configModel ? [configModel] : [],
        is_current: true,
      });
    }
    return [...syntheticProviders, ...modelProviders];
  }, [configModel, configModelProvider, modelDraft, modelProviderDraft, modelProviders]);
  const currentProviderSlug = useMemo(
    () => providerOptions.find((provider) => provider.is_current)?.slug ?? "",
    [providerOptions],
  );
  const effectiveModelProviderDraft =
    modelProviderDraft ||
    (providerOptions.some((provider) => provider.slug === configModelProvider)
      ? configModelProvider
      : "") ||
    currentProviderSlug ||
    providerOptions[0]?.slug ||
    "";
  const inheritedModelDraft = modelDraft || (!modelProviderDraft ? configModel : "");
  const providerModels = useMemo(() => {
    const listedModels =
      providerOptions.find((provider) => provider.slug === effectiveModelProviderDraft)
        ?.models ?? [];
    return Array.from(new Set([inheritedModelDraft, ...listedModels].filter(Boolean)));
  }, [effectiveModelProviderDraft, inheritedModelDraft, providerOptions]);
  const effectiveModelDraft = inheritedModelDraft || providerModels[0] || "";

  const loadContext = useCallback(async () => {
    if (!selectedProjectId || !selectedTaskId) {
      setProject(null);
      setTask(null);
      return;
    }

    try {
      const data = await redouApi.getChatProjects();
      const nextProject =
        data.projects.find((item) => item.id === selectedProjectId) ?? null;
      const nextTask =
        nextProject?.tasks.find((item) => item.id === selectedTaskId) ?? null;
      setProject(nextProject);
      setTask(nextTask);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [selectedProjectId, selectedTaskId]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void loadContext();
    });
    return () => {
      cancelled = true;
    };
  }, [loadContext]);

  useEffect(() => {
    const onProjectsChanged = () => {
      void loadContext();
    };
    window.addEventListener(CHAT_PROJECTS_CHANGED_EVENT, onProjectsChanged);
    return () => window.removeEventListener(CHAT_PROJECTS_CHANGED_EVENT, onProjectsChanged);
  }, [loadContext]);

  useEffect(() => {
    queueMicrotask(() => {
      setModelProviderDraft(task?.model_provider ?? "");
      setModelDraft(task?.model ?? "");
    });
  }, [task?.id, task?.model, task?.model_provider]);

  useEffect(() => {
    let cancelled = false;
    const loadModelOptions = () => {
      redouApi
        .getModelOptions()
        .then((result) => {
          if (cancelled) return;
          setConfigModelProvider(String(result.provider ?? ""));
          setConfigModel(String(result.model ?? ""));
          setModelProviders(
            (result.providers ?? []).filter(
              (provider) => (provider.models ?? []).length > 0,
            ),
          );
        })
        .catch(() => {
          if (!cancelled) {
            setConfigModelProvider("");
            setConfigModel("");
            setModelProviders([]);
          }
        });
    };
    const loadWhenVisible = () => {
      if (document.visibilityState === "visible") loadModelOptions();
    };

    loadModelOptions();
    window.addEventListener(MODEL_OPTIONS_CHANGED_EVENT, loadModelOptions);
    window.addEventListener("focus", loadModelOptions);
    document.addEventListener("visibilitychange", loadWhenVisible);
    return () => {
      cancelled = true;
      window.removeEventListener(MODEL_OPTIONS_CHANGED_EVENT, loadModelOptions);
      window.removeEventListener("focus", loadModelOptions);
      document.removeEventListener("visibilitychange", loadWhenVisible);
    };
  }, []);

  useEffect(() => {
    queueMicrotask(() => setTools([]));
    if (!selectedProjectId || !selectedTaskId) return;

    const toolId = (event: AgentEvent): string => {
      const metadata = event.metadata ?? {};
      const id = metadata.toolCallId;
      return typeof id === "string" && id ? id : "name" in event ? event.name : event.type;
    };

    return redouApi.onAgentEvent((payload) => {
      const current = selectedIdsRef.current;
      if (payload.projectId !== current.projectId || payload.taskId !== current.taskId) return;
      const { event } = payload;
      if (event.type === "tool_start") {
        const id = toolId(event);
        setTools((prev) =>
          [
            ...prev,
            {
              kind: "tool" as const,
              id: `tool-${id}-${Date.now()}`,
              tool_id: id,
              name: event.name,
              context: event.input ? JSON.stringify(event.input).slice(0, 240) : undefined,
              status: "running" as const,
              startedAt: Date.now(),
            },
          ].slice(-TOOL_LIMIT),
        );
        return;
      }
      if (event.type === "tool_output") {
        const id = toolId(event);
        setTools((prev) =>
          prev.map((tool) =>
            tool.tool_id === id || tool.name === event.name
              ? {
                  ...tool,
                  preview:
                    typeof event.output === "string"
                      ? event.output.slice(0, 240)
                      : JSON.stringify(event.output ?? {}).slice(0, 240),
                }
              : tool,
          ),
        );
        return;
      }
      if (event.type === "tool_end") {
        const id = toolId(event);
        setTools((prev) =>
          prev.map((tool) =>
            tool.tool_id === id || tool.name === event.name
              ? {
                  ...tool,
                  status: event.success ? "done" : "error",
                  completedAt: Date.now(),
                }
              : tool,
          ),
        );
        return;
      }
      if (event.type === "done" || event.type === "error") {
        setTools((prev) =>
          prev.map((tool) =>
            tool.status === "running"
              ? {
                  ...tool,
                  status: event.type === "error" ? "error" : "done",
                  completedAt: Date.now(),
                }
              : tool,
          ),
        );
      }
    });
  }, [selectedProjectId, selectedTaskId]);

  const updateTaskModel = useCallback(
    async (provider: string, model: string) => {
      if (!project || !task) return;
      setSaving("model");
      setModelProviderDraft(provider);
      setModelDraft(model);
      try {
        const result = await redouApi.updateChatTask(project.id, task.id, {
          model_provider: provider || null,
          model: model || null,
        });
        setProject(result.project);
        setTask(result.task);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(null);
      }
    },
    [project, task],
  );

  const runningTools = tools.filter((tool) => tool.status === "running").length;
  const recentTools = tools.slice(-3).reverse();

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-card/80 px-2 py-1.5 text-midground shadow-[0_8px_28px_rgba(0,0,0,0.16)] normal-case">
      <div className="flex min-w-[12rem] flex-1 items-center gap-2 overflow-hidden px-1">
        <Layers3 className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium leading-tight">
            {task?.title ?? copy.selectTask}
          </div>
          <div className="truncate text-[0.68rem] leading-tight text-muted-foreground">
            {project?.name ?? copy.noProject}
          </div>
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-1.5 rounded-md border border-border/60 bg-background/25 px-1.5 py-1">
        <Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <select
          value={effectiveModelProviderDraft}
          disabled={!task || saving === "model"}
          onChange={(event) => {
            const provider = event.target.value;
            const firstModel =
              providerOptions.find((item) => item.slug === provider)?.models?.[0] ??
              "";
            void updateTaskModel(provider, provider ? firstModel : "");
          }}
          className={selectClass("w-32")}
          title={shortModel(effectiveModelProviderDraft, effectiveModelDraft, copy.modelUnset)}
        >
          {providerOptions.length === 0 && (
            <option value="">{copy.modelUnset}</option>
          )}
          {providerOptions.map((provider) => (
            <option key={provider.slug} value={provider.slug}>
              {provider.name || provider.slug}
            </option>
          ))}
        </select>

        <select
          value={providerModels.includes(effectiveModelDraft) ? effectiveModelDraft : ""}
          disabled={!task || !effectiveModelProviderDraft || providerModels.length === 0 || saving === "model"}
          onChange={(event) => void updateTaskModel(effectiveModelProviderDraft, event.target.value)}
          className={selectClass("w-44")}
          title={shortModel(effectiveModelProviderDraft, effectiveModelDraft, copy.modelUnset)}
        >
          {providerModels.length === 0 && (
            <option value="">{copy.modelUnset}</option>
          )}
          {providerModels.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
      </div>

      <div className="flex min-w-0 items-center gap-1.5 rounded-md border border-border/60 bg-background/25 px-2 py-1">
        <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">{copy.tools}</span>
        <Badge tone={runningTools > 0 ? "warning" : "outline"} className="h-6 text-[0.65rem]">
          {runningTools > 0 ? copy.running(runningTools) : copy.calls(tools.length)}
        </Badge>
        <div className="hidden max-w-[18rem] items-center gap-1 overflow-hidden xl:flex">
          {recentTools.length === 0 ? (
            <span className="truncate text-xs text-muted-foreground">
              {copy.idle}
            </span>
          ) : (
            recentTools.map((tool) => (
              <span
                key={tool.id}
                className={cn(
                  "inline-flex max-w-24 items-center gap-1 truncate rounded-md px-1.5 py-1 text-[0.68rem]",
                  tool.status === "error"
                    ? "bg-destructive/10 text-destructive"
                    : tool.status === "running"
                      ? "bg-warning/10 text-warning"
                      : "bg-muted/35 text-muted-foreground",
                )}
                title={tool.context ? `${tool.name} ${tool.context}` : tool.name}
              >
                {tool.status === "done" && <CheckCircle2 className="h-3 w-3 shrink-0" />}
                {tool.status === "error" && <AlertCircle className="h-3 w-3 shrink-0" />}
                <span className="truncate">{tool.name}</span>
              </span>
            ))
          )}
        </div>
      </div>

      {error && (
        <div className="flex min-w-0 items-center gap-1 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="max-w-[18rem] truncate">{error}</span>
        </div>
      )}
    </div>
  );
}
