const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const PYTHON_ENV = "REDOU_PYTHON";
const GIT_BASH_ENV = "HERMES_GIT_BASH_PATH";

let gitBashLookupComplete = false;
let cachedGitBashPath = "";

function isWindowsAppExecutionAlias(candidate) {
  return String(candidate || "").toLowerCase().includes("\\windowsapps\\");
}

function isWindowsShellScript(command) {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(String(command || ""));
}

function commandWorks(command, args = ["--version"], options = {}) {
  if (!command) return false;
  try {
    const result = spawnSync(command, args, {
      ...options,
      env: options.env || process.env,
      encoding: "utf8",
      shell: isWindowsShellScript(command),
      windowsHide: true,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

function collectCommandOutput(command, args) {
  try {
    const result = spawnSync(command, args, {
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.status !== 0 || !result.stdout) return [];
    return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function isWslBashLauncher(candidate) {
  const normalized = path.normalize(String(candidate || "")).toLowerCase();
  return (
    normalized.endsWith("\\windows\\system32\\bash.exe")
    || normalized.endsWith("\\microsoft\\windowsapps\\bash.exe")
  );
}

function addGitBashCandidates(candidates, gitPath) {
  if (!gitPath || !path.isAbsolute(gitPath)) return;
  const gitRoot = path.dirname(path.dirname(gitPath));
  candidates.push(path.join(gitRoot, "bin", "bash.exe"));
  candidates.push(path.join(gitRoot, "usr", "bin", "bash.exe"));
}

function gitBashMissingMessage() {
  return [
    "Git for Windows (Git Bash) was not found.",
    "Redou/Hermes uses Git Bash to run local terminal tools on Windows.",
    "Install Git for Windows, or set HERMES_GIT_BASH_PATH to your bash.exe path, then restart Redou Agent.",
  ].join(" ");
}

function resolveGitBashPath(options = {}) {
  const required = Boolean(options.required);
  if (process.platform !== "win32") return "";
  if (gitBashLookupComplete) {
    if (required && !cachedGitBashPath) throw new Error(gitBashMissingMessage());
    return cachedGitBashPath;
  }

  const candidates = [
    process.env[GIT_BASH_ENV],
    path.join(process.env.LOCALAPPDATA || "", "hermes", "git", "bin", "bash.exe"),
    path.join(process.env.LOCALAPPDATA || "", "hermes", "git", "usr", "bin", "bash.exe"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Git", "bin", "bash.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Git", "bin", "bash.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Git", "bin", "bash.exe"),
  ].filter(Boolean);

  for (const gitPath of collectCommandOutput("where.exe", ["git.exe"])) {
    addGitBashCandidates(candidates, gitPath);
  }
  for (const bashPath of collectCommandOutput("where.exe", ["bash.exe"])) {
    if (!isWslBashLauncher(bashPath)) candidates.push(bashPath);
  }

  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate || !path.isAbsolute(candidate)) continue;
    const normalized = path.normalize(candidate);
    const key = normalized.toLowerCase();
    if (seen.has(key) || isWslBashLauncher(normalized)) continue;
    seen.add(key);
    if (fs.existsSync(normalized)) {
      cachedGitBashPath = normalized;
      process.env[GIT_BASH_ENV] = normalized;
      break;
    }
  }

  gitBashLookupComplete = true;
  if (required && !cachedGitBashPath) throw new Error(gitBashMissingMessage());
  return cachedGitBashPath;
}

function gitRuntimePathExtras(gitBashPath) {
  if (!gitBashPath) return [];
  const bashDir = path.dirname(gitBashPath);
  const bashParent = path.dirname(bashDir);
  const gitRoot = path.basename(bashParent).toLowerCase() === "usr"
    ? path.dirname(bashParent)
    : bashParent;
  return [
    bashDir,
    path.join(gitRoot, "cmd"),
    path.join(gitRoot, "usr", "bin"),
    path.join(gitRoot, "mingw64", "bin"),
  ];
}

function runtimePathExtras() {
  if (process.platform === "win32") {
    const gitBashPath = resolveGitBashPath();
    return [
      path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Python312"),
      "C:\\Program Files\\nodejs",
      ...gitRuntimePathExtras(gitBashPath),
    ].filter(Boolean);
  }

  return [];
}

function pythonInfo(pythonPath, env = process.env) {
  if (!pythonPath || isWindowsAppExecutionAlias(pythonPath)) return null;
  if (path.isAbsolute(pythonPath) && !fs.existsSync(pythonPath)) return null;

  try {
    const result = spawnSync(
      pythonPath,
      ["-c", "import sys; print(sys.executable); print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')"],
      {
        env,
        encoding: "utf8",
        shell: false,
        windowsHide: true,
      },
    );
    const lines = String(result.stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (result.status !== 0 || lines.length < 2) return null;
    return { path: lines[0], version: lines[1] };
  } catch {
    return null;
  }
}

function pythonVersionSupported(version) {
  const parts = String(version || "").split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return false;
  return parts[0] > 3 || (parts[0] === 3 && parts[1] >= 11);
}

function pythonMissingMessage() {
  if (process.platform === "linux") {
    return [
      "Python 3.11 or newer was not found.",
      "Install Python 3.11+ with venv support, for example: sudo apt install python3.12 python3.12-venv python3-pip.",
      `If Python is installed in a custom location, set ${PYTHON_ENV} to its executable path.`,
    ].join(" ");
  }

  const commandName = process.platform === "win32" ? "python.exe" : "python3";
  return `Python 3.11 or newer was not found. Install Python 3.11+ or set ${PYTHON_ENV} to ${commandName}.`;
}

function resolvePython(options = {}) {
  const env = options.env || process.env;
  const candidates = process.platform === "win32"
    ? [
        env[PYTHON_ENV],
        path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Python312", "python.exe"),
        "C:\\Program Files\\Python312\\python.exe",
        "python.exe",
      ]
    : [
        env[PYTHON_ENV],
        "/usr/local/bin/python3.12",
        "/usr/bin/python3.12",
        "/bin/python3.12",
        "/usr/local/bin/python3.11",
        "/usr/bin/python3.11",
        "/bin/python3.11",
        "python3.12",
        "python3.11",
        "python3",
        "python",
      ];

  for (const candidate of candidates.filter(Boolean)) {
    const info = pythonInfo(candidate, env);
    if (info && pythonVersionSupported(info.version)) return info.path || candidate;
  }

  throw new Error(pythonMissingMessage());
}

function resolveNpm(options = {}) {
  const env = options.env || process.env;
  const candidates = process.platform === "win32"
    ? [
        path.join("C:\\Program Files\\nodejs", "npm.cmd"),
        "npm.cmd",
        "npm",
      ]
    : [
        "/usr/local/bin/npm",
        "/usr/bin/npm",
        "/bin/npm",
        "npm",
      ];

  for (const candidate of candidates) {
    if (path.isAbsolute(candidate) && !fs.existsSync(candidate)) continue;
    if (commandWorks(candidate, ["--version"], { env })) return candidate;
  }
  throw new Error("npm was not found. Install Node.js LTS.");
}

function venvPythonPath(venvDir) {
  return process.platform === "win32"
    ? path.join(venvDir, "Scripts", "python.exe")
    : path.join(venvDir, "bin", "python");
}

function resolveCodex(options = {}) {
  const env = options.env || process.env;

  // Check explicit env var first
  if (env.CODEX_BINARY && fs.existsSync(env.CODEX_BINARY)) {
    return env.CODEX_BINARY;
  }

  const candidates = process.platform === "win32"
    ? [
        path.join(process.env.APPDATA || "", "npm", "codex.cmd"),
        path.join(process.env.LOCALAPPDATA || "", "Programs", "codex", "codex.exe"),
        "codex.cmd",
        "codex.exe",
        "codex",
      ]
    : [
        "/usr/local/bin/codex",
        "/usr/bin/codex",
        path.join(process.env.HOME || "", ".local", "bin", "codex"),
        "codex",
      ];

  // First pass: return absolute paths that exist on disk (fast, no spawn needed)
  for (const candidate of candidates.filter(Boolean)) {
    if (path.isAbsolute(candidate) && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Second pass: try executing non-absolute candidates
  for (const candidate of candidates.filter(Boolean)) {
    if (path.isAbsolute(candidate)) continue;
    if (commandWorks(candidate, ["--version"], { env })) return candidate;
  }

  return null;
}

function describePlatformPrerequisites() {
  if (process.platform === "win32") {
    return "Install Codex CLI (npm install -g @openai/codex), Node.js 20+, and Git for Windows.";
  }
  if (process.platform === "linux") {
    return "Install Codex CLI (npm install -g @openai/codex), nodejs, npm, git, and bash.";
  }
  return "Install Codex CLI (npm install -g @openai/codex), Node.js 20+, git, and bash.";
}

module.exports = {
  GIT_BASH_ENV,
  PYTHON_ENV,
  commandWorks,
  describePlatformPrerequisites,
  isWindowsShellScript,
  resolveCodex,
  resolveGitBashPath,
  resolveNpm,
  resolvePython,
  runtimePathExtras,
  venvPythonPath,
};
