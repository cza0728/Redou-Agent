import { useCallback, useEffect, useState } from "react";
import { ExternalLink, RefreshCw, Puzzle, Trash2, Eye, EyeOff } from "lucide-react";
import type { Translations } from "@/i18n/types";
import { Link } from "react-router-dom";
import { redouApi } from "@/lib/api";
import type { HubAgentPluginRow, McpHubResponse, McpTestResponse, PluginsHubResponse } from "@/lib/api";
import { Button } from "@nous-research/ui/ui/components/button";
import { Badge } from "@nous-research/ui/ui/components/badge";
import { Select, SelectOption } from "@nous-research/ui/ui/components/select";
import { Switch } from "@nous-research/ui/ui/components/switch";
import { Spinner } from "@nous-research/ui/ui/components/spinner";
import { CommandBlock } from "@nous-research/ui/ui/components/command-block";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/useToast";
import { Toast } from "@/components/Toast";
import { useI18n } from "@/i18n";
import { PluginSlot } from "@/plugins";
import { cn } from "@/lib/utils";
import { usePageHeader } from "@/contexts/usePageHeader";

/** Select value for built-in memory (`config` uses empty string). Never use `""` — UI Select maps empty value to an empty label. */
const MEMORY_PROVIDER_BUILTIN = "__hermes_memory_builtin__";

export default function PluginsPage() {
  const [hub, setHub] = useState<PluginsHubResponse | null>(null);
  const [mcpHub, setMcpHub] = useState<McpHubResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [installId, setInstallId] = useState("");
  const [installForce, setInstallForce] = useState(false);
  const [installEnable, setInstallEnable] = useState(true);
  const [installBusy, setInstallBusy] = useState(false);
  const [mcpApiKey, setMcpApiKey] = useState("");
  const [mcpApiHost, setMcpApiHost] = useState("");
  const [mcpResourceMode, setMcpResourceMode] = useState<"local" | "url">("local");
  const [mcpForce, setMcpForce] = useState(false);
  const [mcpEnable, setMcpEnable] = useState(true);
  const [mcpBusy, setMcpBusy] = useState<"install" | "test" | "remove" | null>(null);
  const [mcpTest, setMcpTest] = useState<McpTestResponse | null>(null);
  const [rescanBusy, setRescanBusy] = useState(false);
  const [memorySel, setMemorySel] = useState(MEMORY_PROVIDER_BUILTIN);
  const [contextSel, setContextSel] = useState("compressor");
  const [providerBusy, setProviderBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  const { toast, showToast } = useToast();
  const { t } = useI18n();
  const { setEnd } = usePageHeader();

  const loadHub = useCallback(() => {
    return Promise.all([redouApi.getPluginsHub(), redouApi.getMcpHub()])
      .then(([h, mcp]) => {
        setHub(h);
        setMcpHub(mcp);
        const preset = mcp.presets.minimax;
        if (preset) {
          setMcpApiHost((current) => current || preset.default_api_host);
          setMcpResourceMode((current) => current || "local");
        }
        const p = h.providers;
        setMemorySel(p.memory_provider ? p.memory_provider : MEMORY_PROVIDER_BUILTIN);
        setContextSel(p.context_engine || "compressor");
      })
      .catch(() => showToast(t.common.loading, "error"));
  }, [showToast, t.common.loading]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void loadHub().finally(() => {
        if (!cancelled) setLoading(false);
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [loadHub]);

  const onInstall = async () => {
    const id = installId.trim();
    if (!id) {
      showToast(t.pluginsPage.installHint, "error");
      return;
    }
    setInstallBusy(true);
    try {
      const r = await redouApi.installAgentPlugin({
        identifier: id,
        force: installForce,
        enable: installEnable,
      });
      showToast(`${r.plugin_name ?? id} installed`, "success");
      if ((r.warnings?.length ?? 0) > 0) showToast(r.warnings!.join(" "), "error");
      if ((r.missing_env?.length ?? 0) > 0)
        showToast(`${t.pluginsPage.missingEnvWarn} ${r.missing_env!.join(", ")}`, "error");
      setInstallId("");
      await loadHub();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Install failed", "error");
    } finally {
      setInstallBusy(false);
    }
  };

  const onRescan = useCallback(async () => {
    setRescanBusy(true);
    try {
      const rc = await redouApi.rescanPlugins();
      showToast(
        `${t.pluginsPage.refreshDashboard} (${rc.count})`,
        "success",
      );
      await loadHub();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Rescan failed", "error");
    } finally {
      setRescanBusy(false);
    }
  }, [loadHub, showToast, t.pluginsPage.refreshDashboard]);

  useEffect(() => {
    setEnd(
      <Button
        ghost
        size="sm"
        className="shrink-0 gap-2"
        disabled={loading || rescanBusy}
        onClick={() => void onRescan()}
      >
        {rescanBusy ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" />}
        {t.pluginsPage.refreshDashboard}
      </Button>,
    );
    return () => setEnd(null);
  }, [loading, onRescan, rescanBusy, setEnd, t.pluginsPage.refreshDashboard]);

  const onSaveProviders = async () => {
    setProviderBusy(true);
    try {
      await redouApi.savePluginProviders({
        memory_provider:
          memorySel === MEMORY_PROVIDER_BUILTIN ? "" : memorySel,
        context_engine: contextSel,
      });
      showToast(t.pluginsPage.savedProviders, "success");
      await loadHub();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Save failed", "error");
    } finally {
      setProviderBusy(false);
    }
  };

  const setRuntimeLoading = async (name: string, fn: () => Promise<unknown>) => {
    setRowBusy(name);
    try {
      await fn();
      await loadHub();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed", "error");
    } finally {
      setRowBusy(null);
    }
  };

  const rows = hub?.plugins ?? [];
  const providers = hub?.providers;
  const minimaxPreset = mcpHub?.presets.minimax;
  const minimaxServer = mcpHub?.servers.find((server) => server.name === "minimax");

  const onInstallMinimaxMcp = async () => {
    setMcpBusy("install");
    setMcpTest(null);
    try {
      const result = await redouApi.installMcpServer({
        preset: "minimax",
        name: "minimax",
        apiKey: mcpApiKey.trim(),
        apiHost: mcpApiHost.trim() || minimaxPreset?.default_api_host,
        resourceMode: mcpResourceMode,
        force: mcpForce,
        enable: mcpEnable,
      });
      showToast(`${result.name} MCP installed`, "success");
      if ((result.missing_env?.length ?? 0) > 0) {
        showToast(`Missing env: ${result.missing_env!.join(", ")}`, "error");
      }
      setMcpApiKey("");
      await loadHub();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "MCP install failed", "error");
    } finally {
      setMcpBusy(null);
    }
  };

  const onTestMinimaxMcp = async () => {
    setMcpBusy("test");
    setMcpTest(null);
    try {
      const result = await redouApi.testMcpServer("minimax");
      setMcpTest(result);
      showToast(
        result.ok ? `MCP tools discovered: ${result.tools.length}` : result.error || "MCP test failed",
        result.ok ? "success" : "error",
      );
      await loadHub();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "MCP test failed", "error");
    } finally {
      setMcpBusy(null);
    }
  };

  const onRemoveMinimaxMcp = async () => {
    const ok = typeof window !== "undefined" ? window.confirm("Remove MiniMax MCP?") : false;
    if (!ok) return;
    setMcpBusy("remove");
    setMcpTest(null);
    try {
      await redouApi.removeMcpServer("minimax");
      showToast("MiniMax MCP removed", "success");
      await loadHub();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "MCP remove failed", "error");
    } finally {
      setMcpBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <PluginSlot name="plugins:top" />

      <div className={cn("flex w-full flex-col gap-8")}>

        {providers && (
          <Card>
            <CardHeader>
              <CardTitle>{t.pluginsPage.providersHeading}</CardTitle>
              <p className="text-[0.7rem] tracking-[0.08em] text-midground/55 normal-case">
                {t.pluginsPage.providersHint}
              </p>
            </CardHeader>

            <CardContent className="flex flex-col gap-6">

              <div className="grid gap-6 sm:grid-cols-2 max-w-full">
              <div className="grid gap-2 min-w-0">
                <Label htmlFor="mem-provider">{t.pluginsPage.memoryProviderLabel}</Label>

                <Select
                  id="mem-provider"
                  className="w-full"
                  value={memorySel}
                  onValueChange={setMemorySel}
                >
                  <SelectOption value={MEMORY_PROVIDER_BUILTIN}>
                    {`(${t.pluginsPage.providerDefaults})`}
                  </SelectOption>

                  {providers.memory_options.map((o) => (
                    <SelectOption key={o.name} value={o.name}>
                      {o.name}
                    </SelectOption>
                  ))}
                </Select>
              </div>

              <div className="grid gap-2 min-w-0">
                <Label htmlFor="ctx-engine">{t.pluginsPage.contextEngineLabel}</Label>

                <Select
                  id="ctx-engine"
                  className="w-full"
                  value={contextSel}
                  onValueChange={setContextSel}
                >
                  <SelectOption value="compressor">compressor</SelectOption>

                  {providers.context_options
                    .filter((o) => o.name !== "compressor")
                    .map((o) => (
                      <SelectOption key={o.name} value={o.name}>
                        {o.name}
                      </SelectOption>
                    ))}
                </Select>
              </div>
              </div>

              <Button
                className="w-fit gap-2"
                size="sm"
                disabled={providerBusy}
                onClick={() => void onSaveProviders()}
              >
                {providerBusy ? <Spinner /> : null}
                {t.pluginsPage.saveProviders}
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>{t.pluginsPage.installHeading}</CardTitle>
            <p className="text-[0.7rem] tracking-[0.08em] text-midground/55 normal-case">
              {t.pluginsPage.installHint}
            </p>
          </CardHeader>


          <CardContent className="flex flex-col gap-4">

            <div className="flex flex-col gap-2">

              <Label htmlFor="install-url">{t.pluginsPage.identifierLabel}</Label>

              <Input
                className="normal-case font-sans lowercase"
                id="install-url"
                placeholder="owner/repo or https://..."
                spellCheck={false}
                value={installId}
                onChange={(e) => setInstallId(e.target.value)}
              />
            </div>


            <div className="flex flex-wrap items-center gap-8">

              <div className="flex items-center gap-3">

                <Switch checked={installForce} onCheckedChange={setInstallForce} />

                <span className="text-[0.7rem] tracking-[0.06em] text-midforeground/85 normal-case">
                  {t.pluginsPage.forceReinstall}
                </span>
              </div>

              <div className="flex items-center gap-3">

                <Switch checked={installEnable} onCheckedChange={setInstallEnable} />

                <span className="text-[0.7rem] tracking-[0.06em] text-midforeground/85 normal-case">
                  {t.pluginsPage.enableAfterInstall}
                </span>
              </div>
            </div>

            <Button
              className="w-fit gap-2"
              size="sm"
              disabled={installBusy}
              onClick={() => void onInstall()}
            >
              {installBusy ? <Spinner /> : <Puzzle className="h-3.5 w-3.5" />}
              {t.pluginsPage.installBtn}
            </Button>

            <p className="text-[0.65rem] tracking-[0.06em] text-midforeground/55 normal-case">
              {t.pluginsPage.rescanHint}
            </p>

            <p className="text-[0.65rem] tracking-[0.06em] text-midforeground/55 normal-case">
              {t.pluginsPage.removeHint}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>MiniMax MCP</CardTitle>
            <p className="text-[0.7rem] tracking-[0.08em] text-midground/55 normal-case">
              Install the MiniMax MCP server so Redou tasks can use audio, image, and video tools through Hermes.
            </p>
          </CardHeader>

          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2 min-w-0">
                <Label htmlFor="minimax-key">MINIMAX_API_KEY</Label>
                <Input
                  id="minimax-key"
                  type="password"
                  spellCheck={false}
                  placeholder={minimaxPreset?.has_api_key ? "Already saved" : "sk-..."}
                  value={mcpApiKey}
                  onChange={(e) => setMcpApiKey(e.target.value)}
                />
              </div>

              <div className="grid gap-2 min-w-0">
                <Label htmlFor="minimax-host">API host</Label>
                <Input
                  id="minimax-host"
                  spellCheck={false}
                  value={mcpApiHost}
                  onChange={(e) => setMcpApiHost(e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2 min-w-0">
                <Label htmlFor="minimax-resource-mode">Resource mode</Label>
                <Select
                  id="minimax-resource-mode"
                  value={mcpResourceMode}
                  onValueChange={(value) => setMcpResourceMode(value === "url" ? "url" : "local")}
                >
                  <SelectOption value="local">local</SelectOption>
                  <SelectOption value="url">url</SelectOption>
                </Select>
              </div>

              <div className="flex items-center gap-3 pt-6">
                <Switch checked={mcpForce} onCheckedChange={setMcpForce} />
                <span className="text-[0.7rem] tracking-[0.06em] text-midforeground/85 normal-case">
                  Force overwrite
                </span>
              </div>

              <div className="flex items-center gap-3 pt-6">
                <Switch checked={mcpEnable} onCheckedChange={setMcpEnable} />
                <span className="text-[0.7rem] tracking-[0.06em] text-midforeground/85 normal-case">
                  Enable after install
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                className="gap-2"
                size="sm"
                disabled={mcpBusy !== null}
                onClick={() => void onInstallMinimaxMcp()}
              >
                {mcpBusy === "install" ? <Spinner /> : <Puzzle className="h-3.5 w-3.5" />}
                Install MiniMax MCP
              </Button>

              <Button
                ghost
                className="gap-2"
                size="sm"
                disabled={mcpBusy !== null || !minimaxServer}
                onClick={() => void onTestMinimaxMcp()}
              >
                {mcpBusy === "test" ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" />}
                Test
              </Button>

              {minimaxServer ? (
                <Button
                  destructive
                  ghost
                  size="sm"
                  disabled={mcpBusy !== null}
                  onClick={() => void onRemoveMinimaxMcp()}
                >
                  {mcpBusy === "remove" ? <Spinner /> : <Trash2 className="h-3.5 w-3.5" />}
                </Button>
              ) : null}

              {minimaxPreset?.docs ? (
                <a
                  className="inline-flex items-center gap-1 text-[0.7rem] text-midforeground/70 underline"
                  href={minimaxPreset.docs}
                  rel="noreferrer"
                  target="_blank"
                >
                  <ExternalLink className="h-3 w-3" />
                  docs
                </a>
              ) : null}
            </div>

            {minimaxServer ? (
              <div className="flex flex-col gap-2 rounded border border-current/15 p-3 text-[0.68rem] text-midforeground/70 normal-case">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={minimaxServer.enabled ? "success" : "destructive"}>
                    {minimaxServer.enabled ? "enabled" : "disabled"}
                  </Badge>
                  <Badge tone="outline">{minimaxServer.transport}</Badge>
                  <Badge tone="outline">{minimaxServer.package || "minimax-mcp-js"}</Badge>
                </div>
                <p className="break-all">
                  {minimaxServer.command} {minimaxServer.args.join(" ")}
                </p>
                {(minimaxServer.missing_env?.length ?? 0) > 0 ? (
                  <p className="text-danger">
                    Missing env: {minimaxServer.missing_env.join(", ")}
                  </p>
                ) : null}
              </div>
            ) : null}

            {mcpTest ? (
              <div className="flex flex-col gap-2 text-[0.68rem] text-midforeground/70 normal-case">
                <p>
                  {mcpTest.ok
                    ? `Discovered ${mcpTest.tools.length} tools.`
                    : `Test failed: ${mcpTest.error || "unknown error"}`}
                </p>
                {mcpTest.tools.length ? (
                  <p className="break-words">
                    {mcpTest.tools.slice(0, 12).map((tool) => tool.name).join(", ")}
                  </p>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-3">

          <h3 className="font-mondwest text-[0.75rem] tracking-[0.12em] text-midground/85">
            {t.pluginsPage.pluginListHeading}
          </h3>

          {loading ? (

            <div className="flex items-center gap-2 py-8 text-[0.8rem] text-midforeground/65">

              <Spinner />
              <span>{t.common.loading}</span>
            </div>
          ) : rows.length === 0 ? (

            <p className="text-[0.75rem] text-midforeground/55 normal-case">{t.common.noResults}</p>
          ) : (

            <ul className="flex flex-col gap-3">

              {rows.map((row: HubAgentPluginRow) => (

                <li key={row.name}>


                  <PluginRowCard
                    {...{ row, rowBusy, setRuntimeLoading, showToast, t }}
                  />

                </li>
              ))}
            </ul>
          )}
        </div>

        {(hub?.orphan_dashboard_plugins?.length ?? 0) > 0 ? (


          <div className="flex flex-col gap-3 opacity-95">

            <h3 className="font-mondwest text-[0.75rem] tracking-[0.12em] text-midforeground/85">
              {t.pluginsPage.orphanHeading}
            </h3>

            <ul className="flex flex-col gap-2 rounded border border-current/15 p-4">

              {hub!.orphan_dashboard_plugins.map((m) => (

                <li className="text-[0.7rem] normal-case opacity-85" key={m.name}>


                  {m.label ?? m.name} — {m.description || m.tab?.path}


                  {!m.tab?.hidden ? (


                    <Link className="ml-3 inline-flex items-center gap-1 underline" to={m.tab.path}>


                      <ExternalLink className="h-3 w-3 opacity-65" />

                      {t.pluginsPage.openTab}
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <Toast toast={toast} />
      <PluginSlot name="plugins:bottom" />
    </div>
  );
}

interface PluginRowCardProps {

  row: HubAgentPluginRow;
  rowBusy: string | null;
  setRuntimeLoading: (
    name: string,
    fn: () => Promise<unknown>,
  ) => Promise<void>;

  showToast: (msg: string, variant: "success" | "error") => void;
  t: Translations;
}

function PluginRowCard(props: PluginRowCardProps) {
  const {
    row,
    rowBusy,
    setRuntimeLoading,
    showToast,
    t,
  } = props;

  const dm = row.dashboard_manifest;

  const tabPath = dm?.tab && !dm.tab.hidden ? dm.tab.override ?? dm.tab.path : null;

  const busy = rowBusy === row.name;

  const badgeTone =
    row.runtime_status === "enabled"
      ? "success"
      : row.runtime_status === "disabled"
        ? "destructive"
        : "outline";

  return (

    <Card className={cn(busy ? "opacity-70" : undefined)}>


      <CardContent className="flex flex-col gap-4 px-6 py-4">


        <div className="flex flex-wrap items-start justify-between gap-4">


          <div className="min-w-0 flex-1">

            <div className="flex flex-wrap items-center gap-3">

              <span className="truncate font-semibold">{row.name}</span>

              <Badge tone="outline">
                {t.pluginsPage.sourceBadge}: {row.source}
              </Badge>


              <Badge tone="outline">v{row.version || "—"}</Badge>

              <Badge tone={badgeTone}>{row.runtime_status}</Badge>

              {row.auth_required ? (
                <Badge tone="destructive">{t.pluginsPage.authRequired}</Badge>
              ) : null}
            </div>

            {row.description ? (

              <p className="mt-2 max-w-2xl text-[0.7rem] tracking-[0.06em] text-midforeground/75 normal-case">
                {row.description}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">


            <Button
              disabled={busy || row.runtime_status === "enabled"}
              ghost
              size="sm"
              onClick={() => {
                void setRuntimeLoading(row.name, async () => {
                  await redouApi.enableAgentPlugin(row.name);
                  showToast(t.pluginsPage.enableRuntime, "success");
                });
              }}
            >
              {t.pluginsPage.enableRuntime}
            </Button>


            <Button
              disabled={busy || row.runtime_status === "disabled"}
              ghost
              size="sm"
              onClick={() => {
                void setRuntimeLoading(row.name, async () => {
                  await redouApi.disableAgentPlugin(row.name);
                  showToast(t.pluginsPage.disableRuntime, "success");
                });
              }}
            >
              {t.pluginsPage.disableRuntime}
            </Button>

            {tabPath ? (

              <Link
                className={cn(
                  "inline-flex items-center rounded-none px-3 py-1.5",
                  "border border-current/25 hover:bg-current/10",
                  "font-mondwest text-[0.65rem] tracking-[0.1em] uppercase",
                )}
                to={tabPath}
              >
                {t.pluginsPage.openTab}
              </Link>
            ) : null}

            {row.can_update_git ? (

              <Button
                disabled={busy}
                ghost
                size="sm"
                onClick={() => {
                  void setRuntimeLoading(row.name, async () => {
                    await redouApi.updateAgentPlugin(row.name);
                    showToast(t.pluginsPage.updateGit, "success");
                  });
                }}
              >
                {busy ? <Spinner /> : null}
                {t.pluginsPage.updateGit}
              </Button>
            ) : null}

            {row.has_dashboard_manifest ? (
              <Button
                disabled={busy}
                ghost
                size="sm"
                title={row.user_hidden ? t.pluginsPage.showInSidebar : t.pluginsPage.hideFromSidebar}
                onClick={() => {
                  void setRuntimeLoading(row.name, async () => {
                    await redouApi.setPluginVisibility(row.name, !row.user_hidden);
                  });
                }}
              >
                {row.user_hidden ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
                {row.user_hidden ? t.pluginsPage.showInSidebar : t.pluginsPage.hideFromSidebar}
              </Button>
            ) : null}

            {row.can_remove ? (


              <Button
                destructive
                disabled={busy}
                ghost
                size="sm"
                onClick={() => {
                  const ok =
                    typeof window !== "undefined"
                      ? window.confirm(t.pluginsPage.removeConfirm)
                      : false;
                  if (!ok) return;

                  void setRuntimeLoading(row.name, async () => {
                    await redouApi.removeAgentPlugin(row.name);
                    showToast(`${row.name} removed`, "success");
                  });
                }}
              >

                {busy ? <Spinner /> : <Trash2 className="h-3.5 w-3.5" />}
              </Button>
            ) : null}
          </div>
        </div>

        {dm?.slots?.length ? (

          <p className="text-[0.65rem] tracking-[0.05em] text-midforeground/55 normal-case">
            {t.pluginsPage.dashboardSlots}: {dm.slots.join(", ")}
          </p>
        ) : null}

        {row.auth_required ? (
          <CommandBlock
            label={t.pluginsPage.authRequiredHint}
            code={row.auth_command}
          />
        ) : null}

        {!row.has_dashboard_manifest && !dm ? (


          <p className="text-[0.65rem] italic text-midforeground/45 normal-case">
            {t.pluginsPage.noDashboardTab}
          </p>
        ) : null}
      </CardContent>

    </Card>
  );
}
