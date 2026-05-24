import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ExternalLink,
  KeyRound,
  Link as LinkIcon,
  RefreshCw,
  Search,
  Server,
  X,
} from "lucide-react";
import { Button } from "@nous-research/ui/ui/components/button";
import { Spinner } from "@nous-research/ui/ui/components/spinner";
import { Input } from "@/components/ui/input";
import { redouApi, notifyModelOptionsChanged, type ModelSetupProvider } from "@/lib/api";
import { useI18n } from "@/i18n";

interface Props {
  onClose(): void;
  onSaved(): void;
}

const COPY = {
  zh: {
    alsoSavedAs: (env: string) => `也会保存为 ${env}。`,
    advancedConnection: "高级连接设置",
    apiKey: "API 密钥",
    baseUrl: "基础 URL",
    cancel: "取消",
    close: "关闭",
    configured: "已配置",
    configuredInConfig: "已配置在 config.yaml 中。粘贴新密钥并刷新即可替换。",
    configuredInEnv: (env: string) => `已配置在 ${env} 中。粘贴新密钥并刷新即可替换。`,
    docs: "文档",
    leaveEmpty: "留空以保留已保存的密钥",
    loadedModels: (count: number) => `已从提供方加载 ${count} 个模型。`,
    loadingModels: "正在加载模型...",
    model: "模型",
    modelResponseTimeout: "模型响应超时（秒）",
    modelResponseTimeoutHelp: "本地 vLLM、自建模型和远程私有模型建议 600 秒。云模型通常可用 120-300 秒。设置过大时，模型卡死会等待更久。",
    modelId: "模型 ID",
    noEnvRequired: "无需环境变量。",
    noMatchingProviders: "没有匹配的提供方。",
    notConfigured: "未配置",
    optional: "可选",
    optionalLocal: "本地端点可不填写。",
    pickProvider: "请选择一个提供方。",
    refreshModels: "刷新模型",
    refreshRequired: "需要刷新",
    save: "保存",
    saveKeyAndRefreshFirst: "请先保存 API 密钥并刷新模型列表，再选择模型。",
    saveKeyRefreshModels: "保存密钥并刷新模型",
    savedAsEnv: (env: string) => `保存为 ${env}。`,
    savedInConfig: "保存到 config.yaml。",
    savesTo: "保存到 config.yaml 和 .env。",
    searchProviders: "搜索提供方...",
    setMainModel: "设置主模型",
    subtitle: "选择提供方，保存 API 密钥，刷新模型列表，然后选择主模型。",
    usingSavedModels: (count: number) => `正在使用 ${count} 个已保存/默认模型。`,
  },
  en: {
    alsoSavedAs: (env: string) => `Also saved as ${env}.`,
    advancedConnection: "Advanced connection settings",
    apiKey: "API Key",
    baseUrl: "Base URL",
    cancel: "Cancel",
    close: "Close",
    configured: "Configured",
    configuredInConfig: "Configured in config.yaml. Paste a new key and refresh to replace it.",
    configuredInEnv: (env: string) => `Configured in ${env}. Paste a new key and refresh to replace it.`,
    docs: "Docs",
    leaveEmpty: "Leave empty to keep the saved key",
    loadedModels: (count: number) => `Loaded ${count} models from the provider.`,
    loadingModels: "Loading models...",
    model: "Model",
    modelResponseTimeout: "Model response timeout (seconds)",
    modelResponseTimeoutHelp: "Local vLLM, custom, and private models often need 600 seconds. Cloud models usually work well with 120-300 seconds. Larger values wait longer when a model stalls.",
    modelId: "Model ID",
    noEnvRequired: "No env var required.",
    noMatchingProviders: "No matching providers.",
    notConfigured: "Not configured",
    optional: "Optional",
    optionalLocal: "Optional for local endpoints.",
    pickProvider: "Pick a provider.",
    refreshModels: "Refresh Models",
    refreshRequired: "Refresh required",
    save: "Save",
    saveKeyAndRefreshFirst: "Save the API key and refresh the model list before choosing a model.",
    saveKeyRefreshModels: "Save Key & Refresh Models",
    savedAsEnv: (env: string) => `Saved as ${env}.`,
    savedInConfig: "Saved in config.yaml.",
    savesTo: "Saves to config.yaml and .env.",
    searchProviders: "Search providers...",
    setMainModel: "Set Main Model",
    subtitle: "Pick a provider, save the API key, refresh models, then choose the main model.",
    usingSavedModels: (count: number) => `Using ${count} saved/default models.`,
  },
} as const;

function defaultRequestTimeoutSeconds(provider: ModelSetupProvider | null): number {
  const text = [
    provider?.provider,
    provider?.label,
    provider?.custom_provider_name,
    ...(provider?.tags ?? []),
  ].filter(Boolean).join(" ").toLowerCase();
  return /local|vllm|ollama|custom/.test(text) ? 600 : 300;
}

function cleanModelSetupInput(value: string): string {
  return value.replace(/\0/g, "");
}

export function ModelSetupDialog({ onClose, onSaved }: Props) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const [providers, setProviders] = useState<ModelSetupProvider[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [modelRefreshMessage, setModelRefreshMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestTimeoutSeconds, setRequestTimeoutSeconds] = useState("600");
  const closedRef = useRef(false);

  useEffect(() => {
    closedRef.current = false;
    redouApi
      .getModelSetupCatalog()
      .then((payload) => {
        if (closedRef.current) return;
        const list = payload.providers ?? [];
        const current = payload.current;
        const currentProvider =
          list.find((p) => p.provider === current?.provider) ?? list[0];
        setProviders(list);
        if (currentProvider) {
          const modelReady =
            currentProvider.api_key_optional ||
            !currentProvider.api_key_env ||
            currentProvider.api_key_set;
          setSelectedProviderId(currentProvider.provider);
          setSelectedModel(
            modelReady
              ? current?.provider === currentProvider.provider && current?.model
                ? current.model
                : currentProvider.default_model || currentProvider.models[0] || ""
              : "",
          );
          setBaseUrl(
            current?.provider === currentProvider.provider && current?.base_url
              ? current.base_url
              : currentProvider.base_url,
          );
          setRequestTimeoutSeconds(String(
            currentProvider.request_timeout_seconds ?? defaultRequestTimeoutSeconds(currentProvider),
          ));
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));

    return () => {
      closedRef.current = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const selectedProvider = useMemo(
    () => providers.find((p) => p.provider === selectedProviderId) ?? null,
    [providers, selectedProviderId],
  );
  const requestTimeoutValue = Number(requestTimeoutSeconds);
  const requestTimeoutValid =
    Number.isInteger(requestTimeoutValue) &&
    requestTimeoutValue >= 30 &&
    requestTimeoutValue <= 3600;

  const needle = query.trim().toLowerCase();
  const filteredProviders = useMemo(() => {
    if (!needle) return providers;
    return providers.filter((provider) => {
      const haystack = [
        provider.label,
        provider.provider,
        provider.description,
        provider.region ?? "",
        ...(provider.tags ?? []),
        ...(provider.models ?? []),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [needle, providers]);

  const modelChoices = useMemo(() => {
    const choices = selectedProvider?.models ?? [];
    const current = selectedModel.trim();
    if (!current || choices.includes(current)) return choices;
    return [current, ...choices];
  }, [selectedModel, selectedProvider]);
  const apiKeyEnv = selectedProvider?.api_key_env ?? "";
  const cleanedApiKey = cleanModelSetupInput(apiKey).trim();
  const pendingApiKey = !!cleanedApiKey;
  const keyReady =
    !!selectedProvider &&
    (selectedProvider.api_key_optional ||
      !apiKeyEnv ||
      !!selectedProvider.api_key_set);
  const modelsReady = keyReady && !pendingApiKey;
  const canRefreshModels =
    !!selectedProvider &&
    !!baseUrl.trim() &&
    !refreshingModels &&
    !saving &&
    requestTimeoutValid &&
    (selectedProvider.api_key_optional ||
      !apiKeyEnv ||
      !!selectedProvider.api_key_set ||
      pendingApiKey);
  const canSave =
    !!selectedProvider &&
    modelsReady &&
    !!selectedModel.trim() &&
    !!baseUrl.trim() &&
    requestTimeoutValid &&
    !refreshingModels &&
    !saving;

  const selectProvider = (provider: ModelSetupProvider) => {
    const modelReady =
      provider.api_key_optional || !provider.api_key_env || provider.api_key_set;
    setSelectedProviderId(provider.provider);
    setSelectedModel(modelReady ? provider.default_model || provider.models[0] || "" : "");
    setBaseUrl(provider.base_url);
    setRequestTimeoutSeconds(String(provider.request_timeout_seconds ?? defaultRequestTimeoutSeconds(provider)));
    setApiKey("");
    setModelRefreshMessage(null);
    setError(null);
  };

  const refreshModels = async () => {
    if (!selectedProvider || !canRefreshModels) return;
    setRefreshingModels(true);
    setError(null);
    setModelRefreshMessage(null);
    const existingModels = (
      modelChoices.includes(selectedModel)
        ? modelChoices
        : [selectedModel, ...modelChoices]
    ).filter(Boolean);
    try {
      const result = await redouApi.refreshModelSetupModels({
        provider: selectedProvider.provider,
        model: selectedModel.trim(),
        base_url: baseUrl.trim(),
        api_key: cleanedApiKey,
        api_key_env: selectedProvider.api_key_env,
        base_url_env: selectedProvider.base_url_env,
        api_mode: selectedProvider.api_mode,
        custom_provider_name: selectedProvider.custom_provider_name,
        models: existingModels,
        request_timeout_seconds: requestTimeoutValue,
      });
      const nextModels = result.models?.length ? result.models : existingModels;
      const nextModel =
        result.default_model ||
        (selectedModel && nextModels.includes(selectedModel) ? selectedModel : "") ||
        nextModels[0] ||
        "";
      setProviders((current) =>
        current.map((provider) =>
          provider.provider === selectedProvider.provider
            ? {
                ...provider,
                api_key_set: result.api_key_set ?? provider.api_key_set,
                base_url_set: result.base_url_set ?? provider.base_url_set,
                base_url: result.base_url || baseUrl.trim(),
                models: nextModels,
                default_model: nextModel || provider.default_model,
                request_timeout_seconds: result.request_timeout_seconds ?? requestTimeoutValue,
              }
            : provider,
        ),
      );
      if (result.base_url) setBaseUrl(result.base_url);
      if (result.request_timeout_seconds) {
        setRequestTimeoutSeconds(String(result.request_timeout_seconds));
      }
      setSelectedModel(nextModel);
      setApiKey("");
      setModelRefreshMessage(
        result.warning ||
          (result.refreshed
            ? copy.loadedModels(nextModels.length)
            : copy.usingSavedModels(nextModels.length)),
      );
      notifyModelOptionsChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshingModels(false);
    }
  };

  const save = async () => {
    if (!selectedProvider || !canSave) return;
    setSaving(true);
    setError(null);
    const models = (
      modelChoices.includes(selectedModel)
        ? modelChoices
        : [selectedModel, ...modelChoices]
    ).filter(Boolean);
    try {
      await redouApi.setupMainModel({
        provider: selectedProvider.provider,
        model: selectedModel.trim(),
        base_url: baseUrl.trim(),
        api_key: cleanedApiKey,
        api_key_env: selectedProvider.api_key_env,
        base_url_env: selectedProvider.base_url_env,
        api_mode: selectedProvider.api_mode,
        custom_provider_name: selectedProvider.custom_provider_name,
        models,
        request_timeout_seconds: requestTimeoutValue,
      });
      notifyModelOptionsChanged();
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/85 p-4 backdrop-blur-sm"
      onClick={(event) => event.target === event.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="model-setup-title"
    >
      <div className="relative flex max-h-[88vh] w-full max-w-5xl flex-col border border-border bg-card shadow-2xl">
        <Button
          ghost
          size="icon"
          onClick={onClose}
          className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
          aria-label={copy.close}
        >
          <X />
        </Button>

        <header className="border-b border-border p-5 pb-4">
          <h2
            id="model-setup-title"
            className="font-display text-base uppercase tracking-wider"
          >
            {copy.setMainModel}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {copy.subtitle}
          </p>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[270px_minmax(0,1fr)]">
          <aside className="min-h-[220px] overflow-y-auto border-b border-border md:border-b-0 md:border-r">
            <div className="sticky top-0 z-10 border-b border-border bg-card p-3">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  autoFocus
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={copy.searchProviders}
                  className="h-8 pl-7 text-xs"
                />
              </div>
            </div>

            {loading && (
              <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
                <Spinner className="text-xs" /> {copy.loadingModels}
              </div>
            )}

            {!loading && filteredProviders.length === 0 && (
              <div className="p-4 text-xs italic text-muted-foreground">
                {copy.noMatchingProviders}
              </div>
            )}

            <div className="divide-y divide-border/50">
              {filteredProviders.map((provider) => {
                const active = provider.provider === selectedProviderId;
                return (
                  <button
                    key={provider.provider}
                    type="button"
                    onClick={() => selectProvider(provider)}
                    className={`flex w-full items-start gap-2 border-l-2 px-3 py-3 text-left transition-colors hover:bg-muted/35 ${
                      active
                        ? "border-l-primary bg-muted/30"
                        : "border-l-transparent"
                    }`}
                  >
                    <Server className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-xs font-medium">
                          {provider.label}
                        </span>
                        {provider.api_key_set && (
                          <span className="shrink-0 border border-primary/40 px-1 py-0.5 text-[9px] uppercase text-primary">
                            {copy.apiKey}
                          </span>
                        )}
                        {provider.region && (
                          <span className="shrink-0 border border-border px-1 py-0.5 text-[9px] uppercase text-muted-foreground">
                            {provider.region}
                          </span>
                        )}
                      </span>
                      <span className="mt-1 block truncate font-mono text-[10px] text-muted-foreground">
                        {provider.provider}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="min-h-0 overflow-y-auto">
            {!selectedProvider && !loading ? (
              <div className="p-5 text-sm text-muted-foreground">
                {copy.pickProvider}
              </div>
            ) : selectedProvider ? (
              <div className="space-y-5 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold">
                        {selectedProvider.label}
                      </h3>
                      {(selectedProvider.tags ?? []).map((tag) => (
                        <span
                          key={tag}
                          className="border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {selectedProvider.description}
                    </p>
                  </div>
                  {selectedProvider.docs_url && (
                    <a
                      href={selectedProvider.docs_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      {copy.docs} <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {copy.model}
                    </label>
                    {!modelsReady && (
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {copy.refreshRequired}
                      </span>
                    )}
                  </div>
                  {!modelsReady && (
                    <div className="border border-border bg-muted/25 px-3 py-2 text-xs text-muted-foreground">
                      {copy.saveKeyAndRefreshFirst}
                    </div>
                  )}
                  {modelRefreshMessage && (
                    <div
                      className={`border px-3 py-2 text-xs ${
                        modelRefreshMessage.startsWith("Could not")
                          ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                          : "border-primary/35 bg-primary/10 text-primary"
                      }`}
                    >
                      {modelRefreshMessage}
                    </div>
                  )}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {modelChoices.map((model) => {
                      const active = model === selectedModel;
                      return (
                        <button
                          key={model}
                          type="button"
                          onClick={() => modelsReady && setSelectedModel(model)}
                          disabled={!modelsReady}
                          className={`flex min-h-9 items-center gap-2 border px-3 py-2 text-left font-mono text-xs transition-colors ${
                            active
                              ? "border-primary bg-primary/10 text-foreground"
                              : "border-border bg-card hover:bg-muted/35"
                          } ${modelsReady ? "" : "cursor-not-allowed opacity-55"}`}
                        >
                          <Check
                            className={`h-3.5 w-3.5 shrink-0 ${
                              active ? "text-primary" : "text-transparent"
                            }`}
                          />
                          <span className="min-w-0 flex-1 break-all">{model}</span>
                        </button>
                      );
                    })}
                  </div>
                  <Input
                    value={selectedModel}
                    onChange={(event) => setSelectedModel(event.target.value)}
                    placeholder={copy.modelId}
                    disabled={!modelsReady}
                    className="h-9 font-mono text-xs"
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                        <KeyRound className="h-3 w-3" />
                        {copy.apiKey}
                      </label>
                      <span
                        className={`border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${
                          selectedProvider.api_key_set
                            ? "border-primary/40 text-primary"
                            : selectedProvider.api_key_optional || !apiKeyEnv
                              ? "border-border text-muted-foreground"
                              : "border-destructive/40 text-destructive"
                        }`}
                      >
                        {selectedProvider.api_key_set
                          ? copy.configured
                          : selectedProvider.api_key_optional || !apiKeyEnv
                            ? copy.optional
                            : copy.notConfigured}
                      </span>
                    </div>
                    <Input
                      value={apiKey}
                      onChange={(event) => setApiKey(cleanModelSetupInput(event.target.value))}
                      placeholder={
                        selectedProvider.api_key_set
                          ? copy.leaveEmpty
                          : apiKeyEnv || copy.optional
                      }
                      type="password"
                      autoComplete="off"
                      className="h-9 font-mono text-xs"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        outlined
                        onClick={refreshModels}
                        disabled={!canRefreshModels}
                        prefix={refreshingModels ? <Spinner /> : <RefreshCw />}
                      >
                        {selectedProvider.api_key_set && !cleanedApiKey
                          ? copy.refreshModels
                          : copy.saveKeyRefreshModels}
                      </Button>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {selectedProvider.api_key_set
                        ? apiKeyEnv
                          ? copy.configuredInEnv(apiKeyEnv)
                          : copy.configuredInConfig
                        : selectedProvider.api_key_optional
                        ? copy.optionalLocal
                        : apiKeyEnv
                          ? copy.savedAsEnv(apiKeyEnv)
                          : copy.noEnvRequired}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <LinkIcon className="h-3 w-3" />
                      {copy.baseUrl}
                    </label>
                    <Input
                      value={baseUrl}
                      onChange={(event) => setBaseUrl(event.target.value)}
                      placeholder="https://provider.example/v1"
                      className="h-9 font-mono text-xs"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      {selectedProvider.base_url_env
                        ? copy.alsoSavedAs(selectedProvider.base_url_env)
                        : copy.savedInConfig}
                    </p>
                  </div>
                </div>

                <details className="rounded-md border border-border bg-muted/15 px-3 py-2" open>
                  <summary className="cursor-pointer select-none text-[10px] uppercase tracking-wider text-muted-foreground">
                    {copy.advancedConnection}
                  </summary>
                  <div className="mt-3 space-y-2">
                    <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {copy.modelResponseTimeout}
                    </label>
                    <Input
                      type="number"
                      min={30}
                      max={3600}
                      value={requestTimeoutSeconds}
                      onChange={(event) => setRequestTimeoutSeconds(event.target.value)}
                      placeholder="600"
                      className="h-9 font-mono text-xs"
                    />
                    <p className={`text-[10px] ${requestTimeoutValid ? "text-muted-foreground" : "text-destructive"}`}>
                      {requestTimeoutValid
                        ? copy.modelResponseTimeoutHelp
                        : "Enter a whole number from 30 to 3600."}
                    </p>
                  </div>
                </details>

                {error && (
                  <div className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {error}
                  </div>
                )}
              </div>
            ) : null}
          </section>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-3">
          <span className="text-xs text-muted-foreground">
            {copy.savesTo}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button outlined onClick={onClose} disabled={saving}>
              {copy.cancel}
            </Button>
            <Button onClick={save} disabled={!canSave} prefix={saving ? <Spinner /> : null}>
              {copy.save}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
