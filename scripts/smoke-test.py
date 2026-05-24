#!/usr/bin/env python3
"""Redou source smoke test.

This suite intentionally avoids network installs and generated bundles. It checks
that the slim source layout is coherent, that Redou desktop code can load, and
that Hermes-owned prompt/runtime helpers still pass their focused regressions.
"""
from __future__ import annotations

import os
import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
import signal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HERMES = ROOT / "vendor" / "hermes"
SKIP_ASYNC_ENV = "REDOU_SMOKE_SKIP_ASYNC"
DEV_INSTALL_HINT = (
    "Install Hermes development dependencies in the Python environment used "
    "for smoke validation:\n"
    "  python -m pip install -e vendor/hermes[dev]"
)


def redou_venv_python() -> Path | None:
    if os.name != "nt":
        return None
    appdata = os.environ.get("APPDATA")
    if not appdata:
        return None
    return Path(appdata) / "Redou Agent" / "runtime" / "venv" / "Scripts" / "python.exe"


def recommended_python_text() -> str:
    return (
        "Use a development Python environment with Hermes dev dependencies "
        "installed. The Redou runtime venv may omit test-only packages."
    )


def module_available(module_name: str) -> bool:
    return importlib.util.find_spec(module_name) is not None


def dependency_error(package_name: str, module_name: str, reason: str, install_hint: str) -> str:
    return (
        f"Missing Python dependency for smoke tests: {package_name} (module: {module_name}).\n"
        f"Current Python: {sys.executable}\n"
        f"Why it is needed: {reason}\n"
        f"Recommended Python:\n  {recommended_python_text()}\n"
        f"Fix:\n  {install_hint}"
    )


def require_module(package_name: str, module_name: str, reason: str, install_hint: str) -> None:
    if module_available(module_name):
        return
    raise SystemExit(dependency_error(package_name, module_name, reason, install_hint))


def require_base_python_smoke_dependencies() -> None:
    require_module(
        "PyYAML",
        "yaml",
        "Hermes config loading imports yaml during the Python smoke tests.",
        DEV_INSTALL_HINT,
    )
    require_module(
        "pytest",
        "pytest",
        "smoke-test.py runs focused Hermes pytest suites.",
        DEV_INSTALL_HINT,
    )


def should_skip_async_tests() -> bool:
    return os.environ.get(SKIP_ASYNC_ENV, "").strip().lower() in {"1", "true", "yes", "on"}


def require_async_pytest_dependency() -> bool:
    if module_available("pytest_asyncio"):
        return True
    if should_skip_async_tests():
        print(
            f"\nSkipping Hermes gateway restart-drain smoke tests because {SKIP_ASYNC_ENV}=1 "
            "and pytest-asyncio is not installed.",
            flush=True,
        )
        return False
    raise SystemExit(
        dependency_error(
            "pytest-asyncio",
            "pytest_asyncio",
            "vendor/hermes/tests/gateway/test_restart_drain.py contains async pytest tests.",
            f"{DEV_INSTALL_HINT}\n"
            f"Or explicitly skip only these async smoke tests with {SKIP_ASYNC_ENV}=1.",
        )
    )


def run(label: str, args: list[str], *, cwd: Path | None = None, env: dict[str, str] | None = None, timeout: int = 180) -> None:
    print(f"\n==> {label}", flush=True)
    print("$ " + " ".join(args), flush=True)
    merged_env = os.environ.copy()
    merged_env.setdefault("PYTHONDONTWRITEBYTECODE", "1")
    if env:
        merged_env.update(env)

    output_file = tempfile.NamedTemporaryFile("w+b", delete=False)
    output_path = Path(output_file.name)
    proc: subprocess.Popen[bytes] | None = None
    try:
        try:
            proc = subprocess.Popen(
                args,
                cwd=str(cwd or ROOT),
                env=merged_env,
                stdout=output_file,
                stderr=subprocess.STDOUT,
                start_new_session=(os.name != "nt"),
            )
            returncode = proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired as exc:
            if proc is not None:
                _terminate_process_group(proc)
            raise SystemExit(f"{label} timed out after {timeout}s") from exc
        finally:
            if proc is not None:
                _terminate_process_group(proc)
            output_file.close()

        output = output_path.read_text(encoding="utf-8", errors="replace")
        if output.strip():
            safe_output = output.rstrip().encode(sys.stdout.encoding or "utf-8", errors="replace").decode(
                sys.stdout.encoding or "utf-8",
                errors="replace",
            )
            print(safe_output, flush=True)
        if returncode != 0:
            raise SystemExit(f"{label} failed with exit code {returncode}")
    finally:
        try:
            output_path.unlink()
        except OSError:
            pass


def _terminate_process_group(proc: subprocess.Popen[bytes]) -> None:
    if os.name == "nt":
        return
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    except OSError:
        return


def with_process_timeout(args: list[str], seconds: int) -> list[str]:
    if os.name == "nt":
        return args
    timeout_bin = shutil.which("timeout")
    if timeout_bin:
        return [timeout_bin, str(seconds), *args]
    return args


def cleanup_test_debris() -> None:
    for path in ROOT.rglob("__pycache__"):
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
    for path in ROOT.rglob(".pytest_cache"):
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
    for path in ROOT.rglob("*.pyc"):
        try:
            path.unlink()
        except OSError:
            pass



def assert_path_contract() -> None:
    service = ROOT / "apps" / "desktop" / "src" / "services" / "redouLocalService.cjs"
    service_impl = ROOT / "apps" / "desktop" / "src" / "services" / "local-service" / "index.cjs"
    service_dir = service_impl.parent
    skill_service_impl = ROOT / "apps" / "desktop" / "src" / "services" / "local-service" / "skills" / "skillService.cjs"
    packager = HERMES / "hermes_cli" / "redou_task_skill_packager.py"
    docs = ROOT / "docs" / "architecture" / "source-and-generated-paths.md"
    readme = ROOT / "README.md"
    for required in [service, service_impl, skill_service_impl, packager, docs, readme]:
        if not required.exists():
            raise SystemExit(f"required path contract file is missing: {required.relative_to(ROOT)}")

    facade_text = service.read_text(encoding="utf-8")
    skill_service_text = skill_service_impl.read_text(encoding="utf-8")
    packager_text = packager.read_text(encoding="utf-8")
    docs_text = docs.read_text(encoding="utf-8")
    readme_text = readme.read_text(encoding="utf-8")

    service_sources = sorted(service_dir.rglob("*.cjs"))

    def source_tree_contains(snippet: str) -> bool:
        return any(snippet in path.read_text(encoding="utf-8") for path in service_sources)

    service_snippets = [
        "projectHermesHome(project) {\n    return this.projectContextDir(project);",
        "projectSkillsDir(project)",
        "const promptDir = path.join(workspace, REDOU_CONTEXT_DIR, REDOU_ANALYSIS_DIR, \"prompts\");",
    ]
    skill_service_snippets = [
        "REDOU_PROJECT_SKILLS_DIR: this.helpers.projectSkillsDir(project)",
        "targetSkillsDir: this.helpers.projectSkillsDir(project)",
    ]
    if 'module.exports = require("./local-service/index.cjs");' not in facade_text:
        raise SystemExit("redouLocalService.cjs must remain a thin local-service facade")

    missing = [snippet for snippet in service_snippets if not source_tree_contains(snippet)]
    if missing:
        raise SystemExit("path contract snippets are missing from local-service source tree:\n" + "\n".join(missing))
    missing = [snippet for snippet in skill_service_snippets if snippet not in skill_service_text]
    if missing:
        raise SystemExit("path contract snippets are missing from local-service/skills/skillService.cjs:\n" + "\n".join(missing))

    if "targetSkillsDir" not in packager_text or "REDOU_PROJECT_SKILLS_DIR" not in packager_text:
        raise SystemExit("Hermes task skill packager must validate/use the project skill target path")
    if "<workspace>/.redou/skills/task-packages/" not in docs_text:
        raise SystemExit("source/generated path doc must describe project skill output paths")
    if "docs/architecture/source-and-generated-paths.md" not in readme_text:
        raise SystemExit("README must link to the runtime data path contract")

    scanned_files = [service, *service_sources, ROOT / "README.md"]
    for path in scanned_files:
        text = path.read_text(encoding="utf-8")
        if ".redou-analysis" in text:
            raise SystemExit(f"legacy .redou-analysis path remains in {path.relative_to(ROOT)}")
    print("path contract audit passed")


def assert_desktop_packaging_contract() -> None:
    package_path = ROOT / "apps" / "desktop" / "package.json"
    linux_install_shortcut_path = ROOT / "Install Redou Agent.sh"
    linux_launch_shortcut_path = ROOT / "Launch Redou Agent.sh"
    linux_install_path = ROOT / "install-redou-agent.sh"
    linux_start_path = ROOT / "start-redou-agent.sh"
    linux_launcher_generator_path = ROOT / "scripts" / "create-redou-linux-launchers.sh"
    installer_include_path = ROOT / "apps" / "desktop" / "build" / "installer.nsh"
    prerequisite_script_path = ROOT / "apps" / "desktop" / "build" / "install-prerequisites.ps1"
    main_path = ROOT / "apps" / "desktop" / "src" / "main.cjs"
    platform_runtime_path = ROOT / "apps" / "desktop" / "src" / "platformRuntime.cjs"
    preload_path = ROOT / "apps" / "desktop" / "src" / "preload.cjs"
    service_dir = ROOT / "apps" / "desktop" / "src" / "services" / "local-service"

    package_json = json.loads(package_path.read_text(encoding="utf-8"))
    scripts = package_json.get("scripts", {})
    build = package_json.get("build", {})
    extra_resources = build.get("extraResources", [])
    publish = build.get("publish", [])

    if build.get("productName") != "RedouAgent":
        raise SystemExit("desktop build productName must stay RedouAgent so install paths do not contain spaces")
    prebuild = scripts.get("prebuild", "")
    if "../../vendor/hermes/web" not in prebuild or "run build" not in prebuild:
        raise SystemExit("desktop package prebuild must build the Hermes renderer before electron-builder")
    if scripts.get("build:win") != "electron-builder --win nsis":
        raise SystemExit("desktop package must keep an explicit Windows build script")
    build_linux = scripts.get("build:linux", "")
    if "--linux" not in build_linux or "AppImage" not in build_linux or "deb" not in build_linux:
        raise SystemExit("desktop package must expose an explicit Linux AppImage/deb build script")
    if "electron-updater" not in package_json.get("dependencies", {}):
        raise SystemExit("desktop package must include electron-updater for in-app release updates")
    if "src/**/*.py" not in build.get("asarUnpack", []):
        raise SystemExit("desktop package must unpack Python bridge scripts from app.asar")
    if not any(
        item.get("provider") == "github" and item.get("owner") == "herb711" and item.get("repo") == "RedouAgent"
        for item in publish
        if isinstance(item, dict)
    ):
        raise SystemExit("desktop package must configure GitHub publish metadata for electron-updater latest.yml")
    if not any(
        item.get("from") == "../../vendor/hermes" and item.get("to") == "vendor/hermes"
        for item in extra_resources
        if isinstance(item, dict)
    ):
        raise SystemExit("desktop package must include vendor/hermes as an extraResource")

    nsis = build.get("nsis", {})
    if nsis.get("oneClick") is not False:
        raise SystemExit("desktop installer must use assisted NSIS mode so users can choose install options")
    if nsis.get("allowToChangeInstallationDirectory") is not True:
        raise SystemExit("desktop installer must allow users to choose the installation directory")
    if nsis.get("shortcutName") != "Redou Agent":
        raise SystemExit("desktop installer shortcuts must keep the visible Redou Agent name")
    if nsis.get("include") != "build/installer.nsh":
        raise SystemExit("desktop installer must include the Redou NSIS environment-check page")

    linux = build.get("linux", {})
    linux_targets = linux.get("target", [])
    if "AppImage" not in linux_targets or "deb" not in linux_targets:
        raise SystemExit("desktop package must build Linux AppImage and deb artifacts")
    if linux.get("category") != "Development":
        raise SystemExit("desktop Linux package must declare a desktop category")
    linux_desktop_entry = linux.get("desktop", {}).get("entry", {})
    if linux_desktop_entry.get("Name") != "Redou Agent":
        raise SystemExit("desktop Linux launcher must keep the visible Redou Agent name")
    linux_icon = ROOT / "apps" / "desktop" / str(linux.get("icon", ""))
    if linux_icon.name != "redou-agent.png" or not linux_icon.exists():
        raise SystemExit("desktop Linux package must use a bundled PNG icon")
    deb = build.get("deb", {})
    deb_depends = deb.get("depends", [])
    required_deb_depends = [
        "libgtk-3-0",
        "libnss3",
        "python3.12 | python3.11 | python3 (>= 3.11)",
        "python3.12-venv | python3.11-venv | python3-venv",
        "python3-pip",
        "nodejs",
        "npm",
        "git",
        "bash",
    ]
    missing = [dependency for dependency in required_deb_depends if dependency not in deb_depends]
    if missing:
        raise SystemExit("desktop deb package must declare apt runtime dependencies:\n" + "\n".join(missing))

    installer_include_text = installer_include_path.read_text(encoding="utf-8")
    required_installer_snippets = [
        "customPageAfterChangeDir",
        "RedouPrereqPagePre",
        "RedouPrereqPageLeave",
        "install-prerequisites.ps1",
    ]
    missing = [snippet for snippet in required_installer_snippets if snippet not in installer_include_text]
    if missing:
        raise SystemExit("desktop NSIS environment-check page is incomplete:\n" + "\n".join(missing))

    prerequisite_script_text = prerequisite_script_path.read_text(encoding="utf-8")
    required_prerequisite_snippets = [
        "Python.Python.3.12",
        "OpenJS.NodeJS.LTS",
        "Git.Git",
        "winget.exe",
        "Node.js 20+",
        "Python 3.11+",
        "Git for Windows (Git Bash)",
    ]
    missing = [snippet for snippet in required_prerequisite_snippets if snippet not in prerequisite_script_text]
    if missing:
        raise SystemExit("desktop prerequisite installer script is incomplete:\n" + "\n".join(missing))

    main_text = main_path.read_text(encoding="utf-8")
    platform_runtime_text = platform_runtime_path.read_text(encoding="utf-8")
    if "app.isPackaged" not in main_text or "process.resourcesPath" not in main_text:
        raise SystemExit("desktop main must resolve packaged runtime resources from process.resourcesPath")
    if "Bundled renderer was not found" not in main_text:
        raise SystemExit("packaged desktop must fail clearly when the bundled renderer is missing")
    required_packaged_runtime_snippets = [
        "preparePackagedHermesInstallSource",
        "hermes-install-source",
        "pythonRuntimeMarkerMatches",
        "hermesSourceStamp",
        "HERMES_VENDOR_ROOT: pythonHermesRoot()",
        "venvPythonPath(venvDir)",
    ]
    missing = [snippet for snippet in required_packaged_runtime_snippets if snippet not in main_text]
    if missing:
        raise SystemExit("packaged desktop must stage Hermes Python sources before pip install:\n" + "\n".join(missing))
    required_platform_runtime_snippets = [
        'process.platform === "win32"',
        'path.join(venvDir, "Scripts", "python.exe")',
        'path.join(venvDir, "bin", "python")',
        '"python3.12"',
        '"python3.11"',
        "Git for Windows",
    ]
    missing = [snippet for snippet in required_platform_runtime_snippets if snippet not in platform_runtime_text]
    if missing:
        raise SystemExit("desktop platform runtime must preserve Windows and Linux launch paths:\n" + "\n".join(missing))

    linux_install_text = linux_install_path.read_text(encoding="utf-8")
    linux_start_text = linux_start_path.read_text(encoding="utf-8")
    linux_install_shortcut_text = linux_install_shortcut_path.read_text(encoding="utf-8")
    linux_launch_shortcut_text = linux_launch_shortcut_path.read_text(encoding="utf-8")
    linux_launcher_generator_text = linux_launcher_generator_path.read_text(encoding="utf-8")
    required_linux_script_snippets = [
        "python3-venv",
        "REDOU_PYTHON",
        "npm",
        "vendor/hermes/hermes_cli/web_dist/index.html",
        "create-redou-linux-launchers.sh",
    ]
    missing = [snippet for snippet in required_linux_script_snippets if snippet not in linux_install_text]
    if missing:
        raise SystemExit("Linux source installer script is incomplete:\n" + "\n".join(missing))
    if "run build:linux" not in linux_start_text or "node_modules/electron/dist/electron" not in linux_start_text:
        raise SystemExit("Linux start script must support launch and Linux package build")
    if "install-redou-agent.sh" not in linux_install_shortcut_text:
        raise SystemExit("Linux friendly install shortcut must delegate to install-redou-agent.sh")
    if "start-redou-agent.sh" not in linux_launch_shortcut_text:
        raise SystemExit("Linux friendly launch shortcut must delegate to start-redou-agent.sh")
    required_launcher_generator_snippets = [
        "redou-agent.desktop",
        "Launch Redou Agent.sh",
        "update-desktop-database",
        "XDG_DATA_HOME",
    ]
    missing = [snippet for snippet in required_launcher_generator_snippets if snippet not in linux_launcher_generator_text]
    if missing:
        raise SystemExit("Linux desktop launcher generator is incomplete:\n" + "\n".join(missing))
    required_update_snippets = [
        "electron-updater",
        "autoUpdater.checkForUpdates",
        "autoUpdater.downloadUpdate",
        "autoUpdater.quitAndInstall",
        'ipcMain.handle("redou:app:update"',
    ]
    missing = [snippet for snippet in required_update_snippets if snippet not in main_text]
    if missing:
        raise SystemExit("desktop main must expose an Electron updater flow:\n" + "\n".join(missing))

    preload_text = preload_path.read_text(encoding="utf-8")
    if "updateApp" not in preload_text or "redou:app:update" not in preload_text:
        raise SystemExit("desktop preload must expose the app update IPC bridge")

    service_sources = sorted(service_dir.rglob("*.cjs"))
    service_text = "\n".join(path.read_text(encoding="utf-8") for path in service_sources)
    required_service_snippets = [
        "app.asar.unpacked",
        'desktopSourcePath("dashboard_bridge.py")',
        'desktopSourcePath("hermes_adapter.py")',
        'desktopSourcePath("redou_context_compactor.py")',
    ]
    missing = [snippet for snippet in required_service_snippets if snippet not in service_text]
    if missing:
        raise SystemExit("desktop service packaged script path handling is incomplete:\n" + "\n".join(missing))

    print("desktop packaging contract passed")


def assert_absent(paths: list[str]) -> None:
    missing = []
    for rel in paths:
        if (ROOT / rel).exists():
            missing.append(rel)
    if missing:
        raise SystemExit("Legacy compatibility files should be removed:\n" + "\n".join(f"  {item}" for item in missing))
    print("legacy root compatibility files are absent")


def main() -> int:
    cleanup_test_debris()
    assert_absent([
        "sitecustomize.py",
        "pyproject.toml",
        "hermes",
        "run_agent.py",
        "cli.py",
        "mcp_serve.py",
        "batch_runner.py",
        "rl_cli.py",
        "mini_swe_runner.py",
    ])
    assert_path_contract()
    assert_desktop_packaging_contract()
    require_base_python_smoke_dependencies()

    py_files = [
        "apps/desktop/src/dashboard_bridge.py",
        "apps/desktop/src/hermes_adapter.py",
        "apps/desktop/src/redou_context_compactor.py",
        "vendor/hermes/hermes_cli/busy_input.py",
        "vendor/hermes/hermes_cli/redou_context.py",
        "vendor/hermes/hermes_cli/redou_task_skill_packager.py",
        "vendor/hermes/hermes_cli/skill_manage_bridge.py",
    ]
    compile_probe = """from pathlib import Path\nimport sys\nfor rel in sys.argv[1:]:\n    path = Path(rel)\n    compile(path.read_text(encoding='utf-8'), str(path), 'exec')\nprint(f'compiled {len(sys.argv) - 1} python files')\n"""
    run("Python syntax compile", [sys.executable, "-c", compile_probe, *py_files])

    node = shutil.which("node")
    if node:
        run("Desktop service facade syntax", [node, "--check", "apps/desktop/src/services/redouLocalService.cjs"])
        run("Desktop local service syntax", [node, "--check", "apps/desktop/src/services/local-service/index.cjs"])
        run("Desktop artifact service syntax", [node, "--check", "apps/desktop/src/services/local-service/artifacts/artifactService.cjs"])
        run("Desktop log service syntax", [node, "--check", "apps/desktop/src/services/local-service/logs/logService.cjs"])
        run("Desktop plugin service syntax", [node, "--check", "apps/desktop/src/services/local-service/plugins/pluginService.cjs"])
        run("Desktop skill service syntax", [node, "--check", "apps/desktop/src/services/local-service/skills/skillService.cjs"])
        run("Desktop task skill client syntax", [node, "--check", "apps/desktop/src/services/redouTaskSkillClient.cjs"])
        run("Desktop main syntax", [node, "--check", "apps/desktop/src/main.cjs"])
        desktop_tests = sorted(str(path.relative_to(ROOT)) for path in (ROOT / "apps" / "desktop" / "tests").glob("*.test.cjs"))
        run("Desktop unit tests", [node, "--test", "--test-force-exit", "--test-reporter=dot", *desktop_tests], timeout=120)
    else:
        print("node not found; skipped desktop JavaScript smoke tests")

    py_env = {"PYTHONPATH": str(HERMES) + os.pathsep + os.environ.get("PYTHONPATH", "")}
    run(
        "Hermes Redou context contract tests",
        with_process_timeout([sys.executable, "-m", "pytest", "-q", "-o", "addopts=", "vendor/hermes/tests/hermes_cli/test_redou_context_contract.py"], 60),
        env=py_env,
        timeout=90,
    )
    if require_async_pytest_dependency():
        run(
            "Hermes gateway restart-drain smoke tests",
            with_process_timeout([sys.executable, "-m", "pytest", "-q", "-o", "addopts=", "vendor/hermes/tests/gateway/test_restart_drain.py"], 90),
            env=py_env,
            timeout=120,
        )
    run(
        "Hermes TUI gateway selected smoke tests",
        with_process_timeout([
            sys.executable,
            "-m",
            "pytest",
            "-q",
            "-o",
            "addopts=",
            "vendor/hermes/tests/test_tui_gateway_server.py::test_dispatch_rejects_non_object_request",
            "vendor/hermes/tests/test_tui_gateway_server.py::test_prompt_submit_expands_context_refs",
            "vendor/hermes/tests/test_tui_gateway_server.py::test_startup_runtime_resolves_short_alias_without_network",
        ], 90),
        env=py_env,
        timeout=120,
    )
    run("Path contract check", [sys.executable, "scripts/check-path-contract.py"])
    cleanup_test_debris()
    run("Generated/debris check", [sys.executable, "scripts/check-generated-dirty.py"])
    print("\nSmoke test completed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
