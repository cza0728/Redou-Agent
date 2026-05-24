const RISK_APPROVAL_DECISIONS = new Set(["allow_once", "allow_session", "allow_always", "deny"]);
const RISK_AUDIT_EVENT_TYPES = new Set([
  "risk_approval_required",
  "risk_approval_allowed",
  "risk_approval_denied",
  "risk_approval_timeout",
  "risk_approval_invalid",
  "risk_approval_decision_submitted",
  "high_risk_command_blocked",
  "high_risk_command_auto_allowed",
]);
const DEFAULT_PERMISSIONS = {
  mode: "ask",
  runtime_approval_enabled: true,
  approval_timeout_seconds: 300,
  prefilter_user_input: true,
  default_scope: "once",
  allow_session_approval: true,
  allow_always_approval: false,
  hardline_policy: "deny",
  cron_mode: "deny",
  audit_log: true,
  rules: {
    "terminal.high_risk": "inherit",
    "terminal.hardline": "deny",
    "terminal.inline_script": "inherit",
    "terminal.remote_script": "inherit",
    "terminal.destructive_file_op": "inherit",
    "terminal.git_destructive": "inherit",
    "file.write_workspace": "allow",
    "file.write_outside_workspace": "ask",
    "network.external": "allow",
    "package.install": "ask",
  },
};

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function deepMergePlain(base, override) {
  const result = { ...(base && typeof base === "object" ? base : {}) };
  if (!override || typeof override !== "object" || Array.isArray(override)) {
    return result;
  }
  for (const [key, value] of Object.entries(override)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      result[key] &&
      typeof result[key] === "object" &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMergePlain(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function normalizePermissionMode(value, fallback = "ask") {
  const mode = String(value || "").trim().toLowerCase();
  return ["deny", "ask", "smart", "allow"].includes(mode) ? mode : fallback;
}

function normalizeCronPermissionMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  return ["allow", "approve", "off", "yes"].includes(mode) ? "allow" : "deny";
}

function buildEffectivePermissions({ configPermissions = {}, inputPermissions = {}, overrides = {} } = {}) {
  const policy = deepMergePlain(
    deepMergePlain(DEFAULT_PERMISSIONS, configPermissions),
    inputPermissions,
  );
  if (Object.prototype.hasOwnProperty.call(overrides || {}, "runtimeApprovalEnabled")) {
    policy.runtime_approval_enabled = overrides.runtimeApprovalEnabled !== false;
  }
  if (overrides?.approvalTimeoutSeconds !== undefined && overrides.approvalTimeoutSeconds !== null) {
    policy.approval_timeout_seconds = overrides.approvalTimeoutSeconds;
  }
  policy.mode = normalizePermissionMode(policy.mode);
  policy.runtime_approval_enabled = policy.runtime_approval_enabled !== false;
  policy.approval_timeout_seconds = boundedInteger(policy.approval_timeout_seconds, 300, 10, 3600);
  policy.prefilter_user_input = policy.prefilter_user_input !== false;
  policy.default_scope = ["once", "session", "always"].includes(String(policy.default_scope || ""))
    ? String(policy.default_scope)
    : "once";
  policy.allow_session_approval = policy.allow_session_approval !== false;
  policy.allow_always_approval = policy.allow_always_approval === true;
  policy.hardline_policy = "deny";
  policy.cron_mode = normalizeCronPermissionMode(policy.cron_mode);
  policy.audit_log = policy.audit_log !== false;
  if (!policy.rules || typeof policy.rules !== "object" || Array.isArray(policy.rules)) {
    policy.rules = { ...DEFAULT_PERMISSIONS.rules };
  }
  return policy;
}

function buildUnattendedPermissions(policy) {
  return {
    ...policy,
    mode: policy.cron_mode === "allow" ? "allow" : "deny",
    runtime_approval_enabled: false,
  };
}

module.exports = {
  DEFAULT_PERMISSIONS,
  RISK_APPROVAL_DECISIONS,
  RISK_AUDIT_EVENT_TYPES,
  normalizePermissionMode,
  normalizeCronPermissionMode,
  buildEffectivePermissions,
  buildUnattendedPermissions,
};
