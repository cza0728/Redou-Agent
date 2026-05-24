#!/usr/bin/env python3
"""Validate Redou's simplified source/runtime path contract.

The check is intentionally source-based so it can run without Electron, npm
install, or a populated userData directory. It catches the regressions that used
to cause project rules or packaged skills to drift back into appData/profile
compatibility paths.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVICE_FACADE = ROOT / "apps" / "desktop" / "src" / "services" / "redouLocalService.cjs"
SERVICE = ROOT / "apps" / "desktop" / "src" / "services" / "local-service" / "index.cjs"
SERVICE_DIR = SERVICE.parent
DASHBOARD = ROOT / "apps" / "desktop" / "src" / "dashboard_bridge.py"
PACKAGER = ROOT / "vendor" / "hermes" / "hermes_cli" / "redou_task_skill_packager.py"
DOC = ROOT / "docs" / "architecture" / "source-and-generated-paths.md"

LEGACY_ROOT_FILES = [
    "sitecustomize.py",
    "pyproject.toml",
    "hermes",
    "run_agent.py",
    "cli.py",
    "mcp_serve.py",
    "batch_runner.py",
    "rl_cli.py",
    "mini_swe_runner.py",
]


def fail(message: str) -> None:
    print(f"path contract failed: {message}")
    raise SystemExit(1)


def require_contains(path: Path, needle: str) -> None:
    text = path.read_text(encoding="utf-8")
    if needle not in text:
        fail(f"{path.relative_to(ROOT)} is missing expected text: {needle}")


def require_not_contains(path: Path, needle: str) -> None:
    text = path.read_text(encoding="utf-8")
    if needle in text:
        fail(f"{path.relative_to(ROOT)} still contains deprecated text: {needle}")


def service_sources() -> list[Path]:
    return sorted(SERVICE_DIR.rglob("*.cjs"))


def require_service_contains(needle: str) -> None:
    for path in service_sources():
        if needle in path.read_text(encoding="utf-8"):
            return
    fail(f"{SERVICE_DIR.relative_to(ROOT)} source tree is missing expected text: {needle}")


def require_service_not_contains(needle: str) -> None:
    for path in service_sources():
        if needle in path.read_text(encoding="utf-8"):
            fail(f"{path.relative_to(ROOT)} still contains deprecated text: {needle}")


def main() -> int:
    for rel in LEGACY_ROOT_FILES:
        if (ROOT / rel).exists():
            fail(f"legacy root compatibility file still exists: {rel}")

    require_contains(SERVICE_FACADE, 'module.exports = require("./local-service/index.cjs");')
    require_service_contains('const REDOU_CONTEXT_DIR = ".redou";')
    require_service_contains('projectHermesHome(project) {\n    return this.projectContextDir(project);')
    require_service_contains('projectSkillsDir(project) {\n    return path.join(this.projectContextDir(project), REDOU_SKILLS_DIR);')
    require_service_contains('messagesPath: path.join(root, TASK_MESSAGES_FILE)')
    require_service_contains('profileHome: this.projectHermesHome(project)')
    require_service_contains('HERMES_HOME: this.projectHermesHome(project)')
    require_service_not_contains('profileHomeForProject')
    require_service_not_contains('this.profileHome(project.hermesProfile)')
    require_service_not_contains('path.join(this.hermesHome, "profiles"')
    require_service_not_contains('chat-projects.json.migration-complete')

    require_contains(DASHBOARD, 'profile_home = context_dir.resolve()')
    require_contains(DASHBOARD, '"profileHome": str(profile_home.resolve())')
    require_not_contains(DASHBOARD, 'context_dir / REDOU_HERMES_DIR')
    require_not_contains(DASHBOARD, 'hermes_home / "profiles"')

    require_contains(PACKAGER, 'Path(profile_home) / "skills"')
    require_contains(PACKAGER, 'references/task-context.md')
    require_contains(PACKAGER, 'references/task-transcript.md')

    if not DOC.exists():
        fail("docs/architecture/source-and-generated-paths.md is missing")
    require_contains(DOC, '<workspace>/.redou/skills/task-packages/<skill-name>/SKILL.md')
    require_contains(DOC, '%APPDATA%/Redou Agent/appData/projects/<project-id>/project.json')

    print("path contract check passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
