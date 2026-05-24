class PluginService {
  constructor({ dashboardBridge = null } = {}) {
    this.dashboardBridge = typeof dashboardBridge === "function" ? dashboardBridge : null;
  }

  runDashboardBridge(action, payload = {}) {
    if (!this.dashboardBridge) {
      throw new Error("Unsupported in Redou Desktop: plugin dashboard bridge is unavailable.");
    }
    return this.dashboardBridge(action, payload);
  }

  getDashboardPlugins() {
    return this.runDashboardBridge("get_dashboard_plugins");
  }

  rescanDashboardPlugins() {
    return this.runDashboardBridge("rescan_dashboard_plugins");
  }

  getPluginsHub() {
    return this.runDashboardBridge("get_plugins_hub");
  }

  getMcpHub() {
    return this.runDashboardBridge("get_mcp_hub");
  }

  installMcpServer(body) {
    return this.runDashboardBridge(
      "install_mcp_server",
      body && typeof body === "object" ? body : {},
    );
  }

  removeMcpServer(name) {
    return this.runDashboardBridge("remove_mcp_server", { name });
  }

  testMcpServer(name) {
    return this.runDashboardBridge("test_mcp_server", { name });
  }

  installAgentPlugin(body) {
    return this.runDashboardBridge(
      "install_agent_plugin",
      body && typeof body === "object" ? body : {},
    );
  }

  enableAgentPlugin(name) {
    return this.runDashboardBridge("set_agent_plugin_enabled", { name, enabled: true });
  }

  disableAgentPlugin(name) {
    return this.runDashboardBridge("set_agent_plugin_enabled", { name, enabled: false });
  }

  updateAgentPlugin(name) {
    return this.runDashboardBridge("update_agent_plugin", { name });
  }

  removeAgentPlugin(name) {
    return this.runDashboardBridge("remove_agent_plugin", { name });
  }

  savePluginProviders(body) {
    return this.runDashboardBridge(
      "save_plugin_providers",
      body && typeof body === "object" ? body : {},
    );
  }

  setPluginVisibility(name, hidden) {
    return this.runDashboardBridge("set_plugin_visibility", {
      name,
      hidden: Boolean(hidden),
    });
  }
}

module.exports = {
  PluginService,
};
