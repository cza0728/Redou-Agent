import { useEffect, useState } from "react";
import { redouApi } from "@/lib/api";
import type { StatusResponse } from "@/lib/api";

const POLL_MS = 3_000;

/**
 * Light-weight status poll for the app shell (sidebar). The Status page uses
 * its own faster interval; we keep this slower to avoid duplicate load.
 */
export function useSidebarStatus() {
  const [status, setStatus] = useState<StatusResponse | null>(null);

  useEffect(() => {
    const load = () => {
      redouApi
        .getStatus()
        .then(setStatus)
        .catch(() => {});
    };
    load();
    const id = setInterval(load, POLL_MS);
    const offAgentEvent = window.redouDesktop?.onAgentEvent?.(load);
    const offAnalysisEvent = window.redouDesktop?.onAnalysisEvent?.(load);
    return () => {
      clearInterval(id);
      offAgentEvent?.();
      offAnalysisEvent?.();
    };
  }, []);

  return status;
}
