const fs = require("fs");
const { spawnSync } = require("child_process");

const TASK_SKILL_CATEGORY = "task-packages";
const PACKAGER_TIMEOUT_MS = 45000;

function compact(value, max = 300) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max).trimEnd() : text;
}

function resolvePythonExecutable(pythonPath) {
  if (pythonPath && fs.existsSync(pythonPath)) return pythonPath;
  if (process.env.PYTHON) return process.env.PYTHON;
  return process.platform === "win32" ? "python" : "python3";
}

function parsePackagerJson(stdout, stderr) {
  const stdoutLines = String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const rawJson = stdoutLines[stdoutLines.length - 1] || "";
  try {
    return rawJson ? JSON.parse(rawJson) : null;
  } catch (error) {
    throw new Error(`Hermes task skill packager returned invalid JSON: ${compact(stdout || stderr || error.message, 500)}`);
  }
}

function callHermesTaskSkillPackager({
  pythonPath,
  cwd,
  env,
  payload,
  timeoutMs = PACKAGER_TIMEOUT_MS,
}) {
  const pythonExecutable = resolvePythonExecutable(pythonPath);
  const result = spawnSync(pythonExecutable, ["-m", "hermes_cli.redou_task_skill_packager"], {
    cwd,
    env,
    input: `${JSON.stringify(payload || {})}\n`,
    encoding: "utf8",
    shell: false,
    timeout: timeoutMs,
    windowsHide: true,
  });

  if (result.error) {
    throw new Error(`Hermes task skill packager failed to start: ${result.error.message}`);
  }

  const parsed = parsePackagerJson(result.stdout, result.stderr);
  if (result.status !== 0 || !parsed?.ok) {
    const message = parsed?.error || result.stderr || result.stdout || `exit ${result.status}`;
    throw new Error(`Hermes task skill packager failed: ${compact(message, 600)}`);
  }

  return parsed.result || { success: false, error: "Hermes task skill packager returned no result." };
}

module.exports = {
  TASK_SKILL_CATEGORY,
  PACKAGER_TIMEOUT_MS,
  callHermesTaskSkillPackager,
};
