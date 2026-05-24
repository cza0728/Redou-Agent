/**
 * ChatSidebar — structured-events panel that sits next to the xterm.js
 * terminal in the dashboard Chat tab.
 *
 * Legacy structured-events panel for the browser dashboard transport.
 * Redou Desktop no longer connects this component to the standalone
 * dashboard server; if it is mounted, it surfaces a clear Desktop TODO.
 */

import { Button } from "@nous-research/ui/ui/components/button";
import { Badge } from "@nous-research/ui/ui/components/badge";
import { Card } from "@/components/ui/card";

import { ModelPickerDialog } from "@/components/ModelPickerDialog";
import { ToolCall, type ToolEntry } from "@/components/ToolCall";
import { GatewayClient, type ConnectionState } from "@/lib/gatewayClient";

import { cn } from "@/lib/utils";
import { AlertCircle, ChevronDown, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

interface SessionInfo {
  cwd?: string;
  model?: string;
  provider?: string;
  credential_warning?: string;
}

const STATE_LABEL: Record<ConnectionState, string> = {
  idle: "idle",
  connecting: "connecting",
  open: "live",
  closed: "closed",
  error: "error",
};

const STATE_TONE: Record<
  ConnectionState,
  "secondary" | "warning" | "success" | "destructive"
> = {
  idle: "secondary",
  connecting: "warning",
  open: "success",
  closed: "secondary",
  error: "destructive",
};

interface ChatSidebarProps {
  channel: string;
  className?: string;
}

export function ChatSidebar({ channel, className }: ChatSidebarProps) {
  // `version` bumps on reconnect; gw is derived so we never call setState
  // for it inside an effect (React 19's set-state-in-effect rule). The
  // counter is the dependency on purpose — it's not read in the memo body,
  // it's the signal that says "rebuild the client".
  const [version, setVersion] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const gw = useMemo(() => new GatewayClient(), [version]);

  const [state, setState] = useState<ConnectionState>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [info, setInfo] = useState<SessionInfo>({});
  const [tools, setTools] = useState<ToolEntry[]>([]);
  const [modelOpen, setModelOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const offState = gw.onState(setState);

    const offSessionInfo = gw.on<SessionInfo>("session.info", (ev) => {
      if (ev.session_id) {
        setSessionId(ev.session_id);
      }

      if (ev.payload) {
        setInfo((prev) => ({ ...prev, ...ev.payload }));
      }
    });

    const offError = gw.on<{ message?: string }>("error", (ev) => {
      const message = ev.payload?.message;

      if (message) {
        setError(message);
      }
    });

    // Adopt whichever session the gateway hands us. session.create on the
    // sidecar is independent of the PTY pane's session by design — we
    // only need a sid to drive the model picker's slash.exec calls.
    gw.connect()
      .then(() => {
        if (cancelled) {
          return;
        }
        return gw.request<{ session_id: string }>("session.create", {});
      })
      .then((created) => {
        if (cancelled || !created?.session_id) {
          return;
        }
        setSessionId(created.session_id);
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setError(e.message);
        }
      });

    return () => {
      cancelled = true;
      offState();
      offSessionInfo();
      offError();
      gw.close();
    };
  }, [gw]);

  // Legacy browser-dashboard event transport is intentionally disabled in
  // Redou Desktop. TODO: route this sidebar through IPC if it is mounted again.
  useEffect(() => {
    void channel;
    const timer = window.setTimeout(() => {
      setError(
        "Legacy dashboard event stream is disabled in Redou Desktop. " +
          "TODO: route sidebar events through Electron IPC before re-enabling this panel.",
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [channel, version]);

  const reconnect = useCallback(() => {
    setError(null);
    setTools([]);
    setVersion((v) => v + 1);
  }, []);

  // Picker hands us a fully-formed slash command (e.g. "/model anthropic/...").
  // Fire-and-forget through `slash.exec`; the TUI pane will render the result
  // via PTY, so the sidebar doesn't need to surface output of its own.
  const onModelSubmit = useCallback(
    (slashCommand: string) => {
      if (!sessionId) {
        return;
      }

      void gw.request("slash.exec", {
        session_id: sessionId,
        command: slashCommand,
      });
      setModelOpen(false);
    },
    [gw, sessionId],
  );

  const canPickModel = state === "open" && !!sessionId;
  const modelLabel = (info.model ?? "—").split("/").slice(-1)[0] ?? "—";
  const banner = error ?? info.credential_warning ?? null;

  return (
    <aside
      className={cn(
        "flex h-full w-full min-w-0 shrink-0 flex-col gap-3 overflow-y-auto overflow-x-hidden pr-1 normal-case lg:w-80",
        className,
      )}
    >
      <Card className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            model
          </div>

          <Button
            ghost
            size="sm"
            disabled={!canPickModel}
            onClick={() => setModelOpen(true)}
            suffix={
              canPickModel ? (
                <ChevronDown className="opacity-60" />
              ) : undefined
            }
            className="self-start min-w-0 px-0 py-0 normal-case tracking-normal text-sm font-medium hover:underline disabled:no-underline"
            title={info.model ?? "switch model"}
          >
            <span className="truncate">{modelLabel}</span>
          </Button>
        </div>

        <Badge tone={STATE_TONE[state]}>{STATE_LABEL[state]}</Badge>
      </Card>

      {banner && (
        <Card className="flex items-start gap-2 border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />

          <div className="min-w-0 flex-1">
            <div className="wrap-break-word text-destructive">{banner}</div>

            {error && (
              <Button
                size="sm"
                outlined
                className="mt-1"
                onClick={reconnect}
                prefix={<RefreshCw />}
              >
                reconnect
              </Button>
            )}
          </div>
        </Card>
      )}

      <Card className="flex min-h-0 flex-none flex-col px-2 py-2">
        <div className="px-1 pb-2 text-xs uppercase tracking-wider text-muted-foreground">
          tools
        </div>

        <div className="flex min-h-0 flex-col gap-1.5">
          {tools.length === 0 ? (
            <div className="px-2 py-4 text-center text-xs text-muted-foreground">
              no tool calls yet
            </div>
          ) : (
            tools.map((t) => <ToolCall key={t.id} tool={t} />)
          )}
        </div>
      </Card>

      {modelOpen && canPickModel && sessionId && (
        <ModelPickerDialog
          gw={gw}
          sessionId={sessionId}
          onClose={() => setModelOpen(false)}
          onSubmit={onModelSubmit}
        />
      )}
    </aside>
  );
}
