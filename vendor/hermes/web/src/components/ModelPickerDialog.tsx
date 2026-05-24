import { Button } from "@nous-research/ui/ui/components/button";
import { ListItem } from "@nous-research/ui/ui/components/list-item";
import { Spinner } from "@nous-research/ui/ui/components/spinner";
import { Input } from "@/components/ui/input";
import type { GatewayClient } from "@/lib/gatewayClient";
import { Check, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/i18n";

/**
 * Two-stage model picker modal.
 *
 * Mirrors ui-tui/src/components/modelPicker.tsx:
 *   Stage 1: pick provider (authenticated providers only)
 *   Stage 2: pick model within that provider
 *
 * Two invocation modes:
 *
 * 1. Chat-session mode (ChatSidebar) — pass `gw` + `sessionId`. The picker
 *    loads options via `model.options` JSON-RPC and emits the result as a
 *    slash command string (`/model <model> --provider <slug> [--global]`)
 *    through `onSubmit`, which the ChatPage pipes to `slashExec`.
 *
 * 2. Standalone mode (ModelsPage, Config settings) — pass a `loader` and
 *    `onApply`. The picker fetches options via the REST endpoint and calls
 *    `onApply(provider, model, persistGlobal)` instead of emitting a slash
 *    command.  This lets the Models page reuse the same UI without
 *    requiring an open chat PTY.
 */

interface ModelOptionProvider {
  name: string;
  slug: string;
  models?: string[];
  total_models?: number;
  is_current?: boolean;
  warning?: string;
}

interface ModelOptionsResponse {
  model?: string;
  provider?: string;
  providers?: ModelOptionProvider[];
}

interface Props {
  /** Chat-mode: when present, picker emits a slash command via onSubmit. */
  gw?: GatewayClient;
  sessionId?: string;
  onSubmit?(slashCommand: string): void;

  /** Standalone-mode: when present (and onSubmit absent), picker calls onApply. */
  loader?(): Promise<ModelOptionsResponse>;
  onApply?(args: {
    provider: string;
    model: string;
    persistGlobal: boolean;
  }): Promise<void> | void;

  onClose(): void;
  title?: string;
  /** If true, hides "Persist globally" checkbox — always saves to config.yaml. */
  alwaysGlobal?: boolean;
}

const COPY = {
  zh: {
    applying: "切换中...",
    cancel: "取消",
    close: "关闭",
    current: "当前",
    filterPlaceholder: "筛选提供方和模型...",
    loading: "加载中...",
    models: "个模型",
    noAuthenticatedProviders: "没有已认证的提供方",
    noMatches: "没有匹配项",
    noModelsForProvider: "该提供方未列出模型",
    noModelsMatch: "没有模型匹配当前筛选",
    persistGlobal: "全局保存（否则仅当前会话生效）",
    pickProvider: "选择提供方 →",
    savesToConfig: "保存到 config.yaml，应用于新会话。",
    switch: "切换",
    switchModel: "切换模型",
    unknown: "未知",
  },
  en: {
    applying: "Switching...",
    cancel: "Cancel",
    close: "Close",
    current: "current",
    filterPlaceholder: "Filter providers and models...",
    loading: "loading...",
    models: "models",
    noAuthenticatedProviders: "no authenticated providers",
    noMatches: "no matches",
    noModelsForProvider: "no models listed for this provider",
    noModelsMatch: "no models match your filter",
    persistGlobal: "Persist globally (otherwise this session only)",
    pickProvider: "pick a provider →",
    savesToConfig: "Saves to config.yaml — applies to new sessions.",
    switch: "Switch",
    switchModel: "Switch Model",
    unknown: "unknown",
  },
} as const;

type ModelPickerCopy = Record<keyof typeof COPY.zh, string>;

export function ModelPickerDialog(props: Props) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const {
    gw,
    sessionId,
    onSubmit,
    loader,
    onApply,
    onClose,
    title = copy.switchModel,
    alwaysGlobal = false,
  } = props;
  const standalone = !!loader && !!onApply;

  const [providers, setProviders] = useState<ModelOptionProvider[]>([]);
  const [currentModel, setCurrentModel] = useState("");
  const [currentProviderSlug, setCurrentProviderSlug] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSlug, setSelectedSlug] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [query, setQuery] = useState("");
  const [persistGlobal, setPersistGlobal] = useState(alwaysGlobal);
  const [applying, setApplying] = useState(false);
  const closedRef = useRef(false);

  // Load providers + models on open.
  useEffect(() => {
    closedRef.current = false;

    const promise = standalone
      ? (loader as () => Promise<ModelOptionsResponse>)()
      : (gw as GatewayClient).request<ModelOptionsResponse>(
          "model.options",
          sessionId ? { session_id: sessionId } : {},
        );

    promise
      .then((r) => {
        if (closedRef.current) return;
        const next = r?.providers ?? [];
        setProviders(next);
        setCurrentModel(String(r?.model ?? ""));
        setCurrentProviderSlug(String(r?.provider ?? ""));
        setSelectedSlug(
          (next.find((p) => p.is_current) ?? next[0])?.slug ?? "",
        );
        setSelectedModel("");
        setLoading(false);
      })
      .catch((e) => {
        if (closedRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });

    return () => {
      closedRef.current = true;
    };
    // Deliberately omit props from deps — stable for the dialog's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const selectedProvider = useMemo(
    () => providers.find((p) => p.slug === selectedSlug) ?? null,
    [providers, selectedSlug],
  );

  const models = useMemo(
    () => selectedProvider?.models ?? [],
    [selectedProvider],
  );

  const needle = query.trim().toLowerCase();

  const filteredProviders = useMemo(
    () =>
      !needle
        ? providers
        : providers.filter(
            (p) =>
              p.name.toLowerCase().includes(needle) ||
              p.slug.toLowerCase().includes(needle) ||
              (p.models ?? []).some((m) => m.toLowerCase().includes(needle)),
          ),
    [providers, needle],
  );

  const filteredModels = useMemo(
    () =>
      !needle ? models : models.filter((m) => m.toLowerCase().includes(needle)),
    [models, needle],
  );

  const canConfirm = !!selectedProvider && !!selectedModel && !applying;

  const confirm = async () => {
    if (!canConfirm || !selectedProvider) return;
    if (standalone && onApply) {
      setApplying(true);
      try {
        await onApply({
          provider: selectedProvider.slug,
          model: selectedModel,
          persistGlobal,
        });
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setApplying(false);
      }
    } else if (onSubmit) {
      const global = persistGlobal ? " --global" : "";
      onSubmit(
        `/model ${selectedModel} --provider ${selectedProvider.slug}${global}`,
      );
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/85 backdrop-blur-sm p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="model-picker-title"
    >
      <div className="relative w-full max-w-3xl max-h-[80vh] border border-border bg-card shadow-2xl flex flex-col">
        <Button
          ghost
          size="icon"
          onClick={onClose}
          className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
          aria-label={copy.close}
        >
          <X />
        </Button>

        <header className="p-5 pb-3 border-b border-border">
          <h2
            id="model-picker-title"
            className="font-display text-base tracking-wider uppercase"
          >
            {title}
          </h2>
          <p className="text-xs text-muted-foreground mt-1 font-mono">
            {copy.current}: {currentModel || `(${copy.unknown})`}
            {currentProviderSlug && ` · ${currentProviderSlug}`}
          </p>
        </header>

        <div className="px-5 pt-3 pb-2 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              autoFocus
              placeholder={copy.filterPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-7 h-8 text-sm"
            />
          </div>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-[200px_1fr] overflow-hidden">
          <ProviderColumn
            loading={loading}
            error={error}
            providers={filteredProviders}
            total={providers.length}
            selectedSlug={selectedSlug}
            query={needle}
            copy={copy}
            onSelect={(slug) => {
              setSelectedSlug(slug);
              setSelectedModel("");
            }}
          />

          <ModelColumn
            provider={selectedProvider}
            models={filteredModels}
            allModels={models}
            selectedModel={selectedModel}
            currentModel={currentModel}
            currentProviderSlug={currentProviderSlug}
            copy={copy}
            onSelect={setSelectedModel}
            onConfirm={(m) => {
              setSelectedModel(m);
              // Confirm on next tick so state settles.
              window.setTimeout(confirm, 0);
            }}
          />
        </div>

        <footer className="border-t border-border p-3 flex items-center justify-between gap-3 flex-wrap">
          {alwaysGlobal ? (
            <span className="text-xs text-muted-foreground">
              {copy.savesToConfig}
            </span>
          ) : (
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={persistGlobal}
                onChange={(e) => setPersistGlobal(e.target.checked)}
                className="cursor-pointer"
              />
              {copy.persistGlobal}
            </label>
          )}

          <div className="flex items-center gap-2 ml-auto">
            <Button outlined onClick={onClose} disabled={applying}>
              {copy.cancel}
            </Button>
            <Button onClick={confirm} disabled={!canConfirm}>
              {applying ? <Spinner /> : copy.switch}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Provider column                                                    */
/* ------------------------------------------------------------------ */

function ProviderColumn({
  loading,
  error,
  providers,
  total,
  selectedSlug,
  query,
  copy,
  onSelect,
}: {
  loading: boolean;
  error: string | null;
  providers: ModelOptionProvider[];
  total: number;
  selectedSlug: string;
  query: string;
  copy: ModelPickerCopy;
  onSelect(slug: string): void;
}) {
  return (
    <div className="border-r border-border overflow-y-auto">
      {loading && (
        <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
          <Spinner className="text-xs" /> {copy.loading}
        </div>
      )}

      {error && <div className="p-4 text-xs text-destructive">{error}</div>}

      {!loading && !error && providers.length === 0 && (
        <div className="p-4 text-xs text-muted-foreground italic">
          {query
            ? copy.noMatches
            : total === 0
              ? copy.noAuthenticatedProviders
              : copy.noMatches}
        </div>
      )}

      {providers.map((p) => {
        const active = p.slug === selectedSlug;
        return (
          <ListItem
            key={p.slug}
            active={active}
            onClick={() => onSelect(p.slug)}
            className={`items-start text-xs border-l-2 ${
              active ? "border-l-primary" : "border-l-transparent"
            }`}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-medium truncate">{p.name}</span>
                {p.is_current && <CurrentTag label={copy.current} />}
              </div>
              <div className="text-[0.65rem] text-muted-foreground/80 font-mono truncate">
                {p.slug} · {p.total_models ?? p.models?.length ?? 0} {copy.models}
              </div>
            </div>
          </ListItem>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Model column                                                       */
/* ------------------------------------------------------------------ */

function ModelColumn({
  provider,
  models,
  allModels,
  selectedModel,
  currentModel,
  currentProviderSlug,
  copy,
  onSelect,
  onConfirm,
}: {
  provider: ModelOptionProvider | null;
  models: string[];
  allModels: string[];
  selectedModel: string;
  currentModel: string;
  currentProviderSlug: string;
  copy: ModelPickerCopy;
  onSelect(model: string): void;
  onConfirm(model: string): void;
}) {
  if (!provider) {
    return (
      <div className="overflow-y-auto">
        <div className="p-4 text-xs text-muted-foreground italic">
          {copy.pickProvider}
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-y-auto">
      {provider.warning && (
        <div className="p-3 text-xs text-destructive border-b border-border">
          {provider.warning}
        </div>
      )}

      {models.length === 0 ? (
        <div className="p-4 text-xs text-muted-foreground italic">
          {allModels.length
            ? copy.noModelsMatch
            : copy.noModelsForProvider}
        </div>
      ) : (
        models.map((m) => {
          const active = m === selectedModel;
          const isCurrent =
            m === currentModel && provider.slug === currentProviderSlug;

          return (
            <ListItem
              key={m}
              active={active}
              onClick={() => onSelect(m)}
              onDoubleClick={() => onConfirm(m)}
              className="px-3 py-1.5 text-xs font-mono"
            >
              <Check
                className={`h-3 w-3 shrink-0 ${active ? "text-primary" : "text-transparent"}`}
              />
              <span className="flex-1 truncate">{m}</span>
              {isCurrent && <CurrentTag label={copy.current} />}
            </ListItem>
          );
        })
      )}
    </div>
  );
}

function CurrentTag({ label }: { label: string }) {
  return (
    <span className="text-[0.6rem] uppercase tracking-wider text-primary/80 shrink-0">
      {label}
    </span>
  );
}
