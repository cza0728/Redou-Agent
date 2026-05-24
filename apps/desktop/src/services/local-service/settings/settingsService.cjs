class SettingsService {
  constructor({ repos, eventBus = null, dashboardBridge = null } = {}) {
    if (!repos?.settings) {
      throw new Error("SettingsService requires a settings repository.");
    }
    this.repos = repos;
    this.eventBus = eventBus;
    this.dashboardBridge = typeof dashboardBridge === "function" ? dashboardBridge : null;
  }

  getState() {
    return this.repos.settings.getState();
  }

  saveState(state) {
    const saved = this.repos.settings.saveState(state || {});
    this.eventBus?.publishSettingsChanged?.({
      source: "local-service",
      action: "saveState",
      state: saved,
    });
    return saved;
  }

  runDashboardBridge(action, payload = {}) {
    if (!this.dashboardBridge) {
      throw new Error("Dashboard settings bridge is unavailable.");
    }
    return this.dashboardBridge(action, payload);
  }

  getConfig() {
    return this.runDashboardBridge("get_config");
  }

  getConfigDefaults() {
    return this.runDashboardBridge("get_defaults");
  }

  getConfigSchema() {
    return this.runDashboardBridge("get_schema");
  }

  saveConfig(config) {
    return this.runDashboardBridge("save_config", { config });
  }

  getConfigRaw() {
    return this.runDashboardBridge("get_config_raw");
  }

  saveConfigRaw(yamlText) {
    return this.runDashboardBridge("save_config_raw", { yaml_text: yamlText });
  }

  getThemes() {
    return this.runDashboardBridge("get_themes");
  }

  setTheme(name) {
    return this.runDashboardBridge("set_theme", { name });
  }

  getLanguage() {
    return this.runDashboardBridge("get_language");
  }

  setLanguage(language) {
    return this.runDashboardBridge("set_language", { language });
  }
}

module.exports = {
  SettingsService,
};
