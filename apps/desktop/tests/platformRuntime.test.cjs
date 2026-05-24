const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const path = require("node:path");

const {
  describePlatformPrerequisites,
  isWindowsShellScript,
  runtimePathExtras,
  venvPythonPath,
} = require("../src/platformRuntime.cjs");

test("platform runtime resolves the managed venv python path for the host OS", () => {
  const venvDir = path.join("runtime", "venv");
  const pythonPath = venvPythonPath(venvDir);

  if (process.platform === "win32") {
    assert.equal(pythonPath, path.join(venvDir, "Scripts", "python.exe"));
  } else {
    assert.equal(pythonPath, path.join(venvDir, "bin", "python"));
  }
});

test("platform runtime only treats cmd and bat files as Windows shell scripts", () => {
  assert.equal(isWindowsShellScript("npm.cmd"), process.platform === "win32");
  assert.equal(isWindowsShellScript("install.bat"), process.platform === "win32");
  assert.equal(isWindowsShellScript("npm"), false);
});

test("platform runtime exposes path extras and dependency guidance", () => {
  assert.ok(Array.isArray(runtimePathExtras()));
  assert.match(describePlatformPrerequisites(), /Python|python3/);
});

test("desktop deb package declares Linux runtime dependencies through apt", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  assert.equal(packageJson.build?.productName, "RedouAgent");
  assert.equal(packageJson.build?.linux?.desktop?.entry?.Name, "Redou Agent");
  const depends = packageJson.build?.deb?.depends || [];

  for (const dependency of [
    "libgtk-3-0",
    "libnss3",
    "python3.12 | python3.11 | python3 (>= 3.11)",
    "python3.12-venv | python3.11-venv | python3-venv",
    "python3-pip",
    "nodejs",
    "npm",
    "git",
    "bash",
  ]) {
    assert.ok(depends.includes(dependency), `missing deb dependency: ${dependency}`);
  }
});
