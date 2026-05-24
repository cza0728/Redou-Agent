/**
 * usePlugins hook — discovers and loads dashboard plugins.
 *
 * 1. Fetches plugin manifests from the desktop plugin bridge
 * 2. Keeps browser-dashboard JS/CSS asset loading disabled in Desktop
 * 3. Waits for any already-registered in-process plugins and resolves them
 */

import { useState, useEffect } from "react";
import { redouApi } from "@/lib/api";
import type { PluginManifest, RegisteredPlugin } from "./types";
import {
  getPluginComponent,
  onPluginRegistered,
  setPluginLoadError,
} from "./registry";

export function usePlugins() {
  const [manifests, setManifests] = useState<PluginManifest[]>([]);
  const [plugins, setPlugins] = useState<RegisteredPlugin[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch manifests on mount.
  useEffect(() => {
    redouApi
      .getPlugins()
      .then((list) => {
        setManifests(list);
        if (list.length === 0) setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Browser-dashboard plugin bundles were served from the standalone HTTP
  // dashboard. Redou Desktop does not depend on that server, so asset injection
  // stays disabled until a file/protocol-based desktop loader exists.
  useEffect(() => {
    if (manifests.length === 0) return;
    for (const manifest of manifests) {
      setPluginLoadError(manifest.name, "DESKTOP_ASSET_LOADER_MISSING");
    }
    const timer = window.setTimeout(() => setLoading(false), 0);
    return () => window.clearTimeout(timer);
  }, [manifests]);

  // Listen for plugin registrations and resolve them against manifests.
  useEffect(() => {
    function resolvePlugins() {
      const resolved: RegisteredPlugin[] = [];
      for (const manifest of manifests) {
        const component = getPluginComponent(manifest.name);
        if (component) {
          resolved.push({ manifest, component });
        }
      }
      setPlugins(resolved);
      // If all plugins registered, stop loading early.
      if (resolved.length === manifests.length && manifests.length > 0) {
        setLoading(false);
      }
    }

    resolvePlugins();
    const unsub = onPluginRegistered(resolvePlugins);
    return unsub;
  }, [manifests]);

  return { plugins, manifests, loading };
}
