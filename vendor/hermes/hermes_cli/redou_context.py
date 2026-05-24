"""Redou project/task context and app-data helpers.

This module stays independent from ``hermes_cli.web_server`` so the dashboard
server and the TUI gateway child can share the same Project/Task context rules.
"""

from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from hermes_constants import get_hermes_home

LOGGER = logging.getLogger(__name__)

REDOU_APP_DATA_ENV = "REDOU_APP_DATA_ROOT"
REDOU_CHAT_PROJECTS_FILE_ENV = "REDOU_CHAT_PROJECTS_FILE"

GLOBAL_USER_FILE = "USER.md"
GLOBAL_RULES_FILE = "GLOBAL_RULES.md"
PROJECT_RULES_FILE = "PROJECT_RULES.md"
TASK_RULES_FILE = "TASK_RULES.md"
TASK_CONTEXT_FILE = "TASK_CONTEXT.md"
TASK_MESSAGES_FILE = "messages.jsonl"
REDOU_CONTEXT_DIR = ".redou"
REDOU_TASKS_DIR = "tasks"

RECENT_MESSAGE_LIMIT = 20
RECENT_MESSAGE_CONTENT_LIMIT = 4000
VALID_MESSAGE_ROLES = frozenset({"user", "assistant", "system", "tool", "event"})

_SAFE_SEGMENT_RE = re.compile(r"[^A-Za-z0-9._-]+")
_SECRET_PATTERNS: Tuple[re.Pattern[str], ...] = (
    re.compile(r"(?is)-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"(?i)(Authorization\s*:\s*Bearer\s+)[A-Za-z0-9._\-+/=]+"),
    re.compile(r"(?i)((?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|passwd|pwd)\s*[:=]\s*)(['\"]?)[^'\"\s]+\2"),
    re.compile(r"(?i)((?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|passwd|pwd)\s+)(['\"]?)[^'\"\s]+\2"),
)
_SECRET_MARKER = "[REDACTED_SECRET]"
_RAW_EVENT_TYPES = frozenset({
    "command_start",
    "command_output",
    "command_end",
    "tool_start",
    "tool_output",
    "tool_end",
    "done",
    "raw_log",
    "queue_update",
    "control_event",
    "run_stage",
})


@dataclass
class BuiltTaskContext:
    text: str
    files: List[str]
    recent_messages_count: int
    context_length: int
    hermes_profile: str
    context_messages: List[Dict[str, Any]] | None = None
    validation: Dict[str, Any] | None = None
    debug: Dict[str, Any] | None = None


def _now() -> float:
    return time.time()


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_segment(value: Any, fallback: str) -> str:
    raw = str(value or "").strip()
    clean = _SAFE_SEGMENT_RE.sub("-", raw).strip(".-_")
    return (clean[:96] or fallback).lower()


def _compact(value: Any, max_len: int = 300) -> str:
    text = " ".join(str(value or "").split())
    return text[:max_len]


def _redact_text(text: Any) -> tuple[str, int]:
    value = str(text or "")
    count = 0
    for pattern in _SECRET_PATTERNS:
        def _replace(match: re.Match[str]) -> str:
            nonlocal count
            count += 1
            if match.lastindex and match.lastindex >= 1:
                prefix = match.group(1) or ""
                return f"{prefix}{_SECRET_MARKER}"
            return _SECRET_MARKER

        value = pattern.sub(_replace, value)
    return value, count


def _redact_preview(text: str, max_len: int = 400) -> str:
    redacted, _count = _redact_text(text or "")
    redacted = redacted.replace("\r", " ").replace("\n", " ")
    return redacted[:max_len]


def _contains_unredacted_secret(text: Any) -> bool:
    value = str(text or "")
    # Treat both the new Python marker and the Desktop-side marker as already
    # redacted so validators do not flag sanitized prompts as leaks.
    redaction_markers = (_SECRET_MARKER, "[REDACTED]")
    for pattern in _SECRET_PATTERNS:
        for match in pattern.finditer(value):
            candidate = match.group(0)
            if any(marker in candidate for marker in redaction_markers):
                continue
            return True
    return False


def get_redou_app_data_root() -> Path:
    raw = os.environ.get(REDOU_APP_DATA_ENV)
    if raw:
        return Path(raw).expanduser().resolve(strict=False)
    return Path(get_hermes_home()) / "app-data"


def get_redou_chat_projects_file() -> Path:
    raw = os.environ.get(REDOU_CHAT_PROJECTS_FILE_ENV)
    if raw:
        return Path(raw).expanduser().resolve(strict=False)
    return Path(get_hermes_home()) / "chat-projects.json"


def get_global_app_data_dir() -> Path:
    return get_redou_app_data_root() / "global"


def get_project_app_data_dir(project_id: str) -> Path:
    return get_redou_app_data_root() / "projects" / _safe_segment(project_id, "project")


def get_task_app_data_dir(project_id: str, task_id: str) -> Path:
    return get_project_app_data_dir(project_id) / "tasks" / _safe_segment(task_id, "task")


def _project_workspace_path(project: Dict[str, Any]) -> str:
    return str(project.get("path") or project.get("workspace_path") or "").strip()


def get_project_context_dir(project: Dict[str, Any]) -> Path:
    workspace = _project_workspace_path(project)
    if workspace:
        return Path(workspace).expanduser().resolve(strict=False) / REDOU_CONTEXT_DIR
    return get_project_app_data_dir(str(project.get("id") or ""))


def get_task_context_dir(project: Dict[str, Any], task: Dict[str, Any]) -> Path:
    task_id = str(task.get("id") or "")
    return get_project_context_dir(project) / REDOU_TASKS_DIR / _safe_segment(task_id, "task")


def _ensure_text_file(path: Path, default_text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text(default_text, encoding="utf-8")


def _ensure_empty_file(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text("", encoding="utf-8")


def _default_task_context_text() -> str:
    return "\n".join(
        [
            "# Task Context",
            "",
            "## A. Structured State",
            "",
            "### Current Brief",
            "",
            "### Active Constraints",
            "",
            "### Todo List",
            "",
            "### Progress Summary",
            "",
            "### Evidence and Artifacts",
            "",
            "### Open Issues",
            "",
            "---",
            "",
            "## B. Raw Turn Log",
            "",
        ]
    )


def _has_task_context_shape(text: str) -> bool:
    value = str(text or "")
    return (
        re.search(r"^# Task Context\s*$", value, re.MULTILINE) is not None
        and re.search(r"^## A\. Structured State\s*$", value, re.MULTILINE) is not None
        and re.search(r"^## B\. Raw Turn Log\s*$", value, re.MULTILINE) is not None
    )


def _normalize_task_context_text(text: Any) -> str:
    value = str(text or "").replace("\r\n", "\n").rstrip()
    if not value.strip():
        return _default_task_context_text()
    if _has_task_context_shape(value):
        return value + "\n"
    legacy = re.sub(r"^\s*#\s*Task Context\s*", "", value, flags=re.IGNORECASE).strip()
    return "\n".join(
        [
            "# Task Context",
            "",
            "## A. Structured State",
            "",
            "### Current Brief",
            "",
            "### Active Constraints",
            "",
            "### Todo List",
            "",
            "### Progress Summary",
            "",
            legacy[:12000],
            "",
            "### Evidence and Artifacts",
            "",
            "### Open Issues",
            "",
            "---",
            "",
            "## B. Raw Turn Log",
            "",
        ]
    )


def _ensure_task_context_shape(path: Path) -> str:
    current = _read_text(path)
    normalized = _normalize_task_context_text(current)
    if current != normalized:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(normalized, encoding="utf-8")
    return normalized


def _has_meaningful_markdown(text: str, heading: str) -> bool:
    body = (text or "").replace("\r\n", "\n").strip()
    return bool(body and body != f"# {heading}")


def _migrate_markdown_file(source: Path, target: Path, heading: str) -> None:
    if source.resolve(strict=False) == target.resolve(strict=False):
        return
    if not source.exists():
        return
    source_text = _read_text(source)
    if not _has_meaningful_markdown(source_text, heading):
        return
    target_text = _read_text(target) if target.exists() else ""
    if _has_meaningful_markdown(target_text, heading):
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(source_text, encoding="utf-8")


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return ""
    except Exception as exc:
        LOGGER.warning("redou context: failed to read %s: %s", path, exc)
        return ""


def ensure_global_app_data() -> Dict[str, str]:
    root = get_global_app_data_dir()
    paths = {
        "userPath": root / GLOBAL_USER_FILE,
        "globalRulesPath": root / GLOBAL_RULES_FILE,
    }
    _ensure_text_file(paths["userPath"], "# User Preferences\n\n")
    _ensure_text_file(paths["globalRulesPath"], "# Global Rules\n\n")
    return {key: str(value) for key, value in paths.items()}


def ensure_project_app_data(project: Dict[str, Any]) -> Dict[str, str]:
    ensure_global_app_data()
    project_id = str(project.get("id") or "")
    app_root = get_project_app_data_dir(project_id)
    context_root = get_project_context_dir(project)
    rules_path = context_root / PROJECT_RULES_FILE
    _migrate_markdown_file(app_root / PROJECT_RULES_FILE, rules_path, "Project Rules")
    _ensure_text_file(rules_path, "# Project Rules\n\n")
    project["appDataPath"] = str(app_root)
    project["rulesPath"] = str(rules_path)
    project.pop("memoryPath", None)
    return {
        "appDataPath": str(app_root),
        "rulesPath": str(rules_path),
    }


def ensure_task_app_data(project: Dict[str, Any], task: Dict[str, Any]) -> Dict[str, str]:
    project_id = str(project.get("id") or "")
    task_id = str(task.get("id") or "")
    app_root = get_task_app_data_dir(project_id, task_id)
    context_root = get_task_context_dir(project, task)
    rules_path = context_root / TASK_RULES_FILE
    context_path = context_root / TASK_CONTEXT_FILE
    messages_path = app_root / TASK_MESSAGES_FILE
    _migrate_markdown_file(app_root / TASK_RULES_FILE, rules_path, "Task Rules")
    _migrate_markdown_file(app_root / "SUMMARY.md", context_path, "Task Summary")
    _ensure_text_file(rules_path, "# Task Rules\n\n")
    _ensure_text_file(context_path, _default_task_context_text())
    _ensure_task_context_shape(context_path)
    _ensure_empty_file(messages_path)
    task["appDataPath"] = str(app_root)
    task["rulesPath"] = str(rules_path)
    task["contextPath"] = str(context_path)
    task.pop("summaryPath", None)
    task["messagesPath"] = str(messages_path)
    session_id = _compact(task.get("hermesSessionId") or task.get("session_id"), 160)
    task["hermesSessionId"] = session_id or None
    task["session_id"] = session_id or None
    return {
        "appDataPath": str(app_root),
        "rulesPath": str(rules_path),
        "contextPath": str(context_path),
        "messagesPath": str(messages_path),
    }


def desired_project_profile_name(project: Dict[str, Any]) -> str:
    project_id = _safe_segment(project.get("id"), "project")
    name = f"redou-{project_id}".replace(".", "-")
    if not re.match(r"^[a-z0-9]", name):
        name = f"redou-{name}"
    return name[:64].rstrip("_-") or "redou-project"


def _profile_exists(name: str) -> bool:
    try:
        from hermes_cli.profiles import profile_exists

        return bool(profile_exists(name))
    except Exception:
        return False


def resolve_hermes_profile_home(name: str) -> Optional[Path]:
    try:
        from hermes_cli.profiles import resolve_profile_env

        return Path(resolve_profile_env(name)).resolve(strict=False)
    except Exception as exc:
        LOGGER.warning("redou profile: cannot resolve profile %s: %s", name, exc)
        return None


def _run_profile_create_cli(name: str) -> Optional[str]:
    cmd = [
        sys.executable,
        "-m",
        "hermes_cli.main",
        "profile",
        "create",
        name,
        "--no-alias",
        "--no-skills",
    ]
    env = os.environ.copy()
    env["HERMES_HOME"] = str(Path(get_hermes_home()).resolve(strict=False))
    try:
        result = subprocess.run(
            cmd,
            cwd=str(Path(__file__).resolve().parent.parent),
            env=env,
            capture_output=True,
            text=True,
            timeout=45,
        )
    except Exception as exc:
        return f"{type(exc).__name__}: {_redact_preview(str(exc))}"
    if result.returncode == 0:
        return None
    combined = "\n".join(part for part in (result.stdout, result.stderr) if part)
    return f"exit {result.returncode}: {_redact_preview(combined)}"


def _create_profile_internal(name: str) -> Optional[str]:
    try:
        from hermes_cli.profiles import create_profile

        create_profile(name, no_alias=True, no_skills=True)
        return None
    except FileExistsError:
        return None
    except Exception as exc:
        return f"{type(exc).__name__}: {_redact_preview(str(exc))}"


def ensure_project_hermes_profile(project: Dict[str, Any]) -> str:
    existing = _compact(project.get("hermesProfile"), 80)
    if existing and _profile_exists(existing):
        project["hermesProfile"] = existing
        project.pop("hermesProfileWarning", None)
        return existing

    desired = existing if existing and existing != "default" else desired_project_profile_name(project)
    if _profile_exists(desired):
        project["hermesProfile"] = desired
        project.pop("hermesProfileWarning", None)
        return desired

    cli_error = _run_profile_create_cli(desired)
    if cli_error is None and _profile_exists(desired):
        project["hermesProfile"] = desired
        project.pop("hermesProfileWarning", None)
        return desired

    if cli_error:
        LOGGER.warning(
            "redou profile: Hermes CLI failed for projectId=%s profile=%s: %s",
            project.get("id"),
            desired,
            cli_error,
        )

    internal_error = _create_profile_internal(desired)
    if internal_error is None and _profile_exists(desired):
        project["hermesProfile"] = desired
        project["hermesProfileWarning"] = (
            "Hermes CLI profile creation failed; used internal fallback."
        )
        return desired

    warning = (
        "Hermes profile creation failed; using default profile fallback."
        if not internal_error
        else f"Hermes profile creation failed; using default fallback: {internal_error}"
    )
    LOGGER.warning(
        "redou profile: fallback to default for projectId=%s desired=%s: %s",
        project.get("id"),
        desired,
        _redact_preview(warning),
    )
    project["hermesProfile"] = "default"
    project["hermesProfileWarning"] = warning
    return "default"


def _load_projects_store() -> Dict[str, Any]:
    path = get_redou_chat_projects_file()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        return raw if isinstance(raw, dict) else {"projects": []}
    except FileNotFoundError:
        return {"projects": []}
    except Exception as exc:
        LOGGER.warning("redou context: failed to read projects store %s: %s", path, exc)
        return {"projects": []}


def _write_projects_store(store: Dict[str, Any]) -> bool:
    path = get_redou_chat_projects_file()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(store, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(path)
        return True
    except Exception as exc:
        LOGGER.warning("redou context: failed to write projects store %s: %s", path, exc)
        return False


def _find_project_and_task(
    project_id: str,
    task_id: str,
) -> tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    store = _load_projects_store()
    for project in store.get("projects", []) or []:
        if not isinstance(project, dict) or project.get("id") != project_id:
            continue
        for task in project.get("tasks", []) or []:
            if isinstance(task, dict) and task.get("id") == task_id:
                ensure_project_app_data(project)
                ensure_task_app_data(project, task)
                return project, task
        ensure_project_app_data(project)
        return project, None
    return None, None


def set_task_hermes_session_id(
    project_id: str,
    task_id: str,
    hermes_session_id: Optional[str],
) -> bool:
    session_id = _compact(hermes_session_id, 160)
    if not project_id or not task_id or not session_id:
        return False
    store = _load_projects_store()
    changed = False
    for project in store.get("projects", []) or []:
        if not isinstance(project, dict) or project.get("id") != project_id:
            continue
        for task in project.get("tasks", []) or []:
            if not isinstance(task, dict) or task.get("id") != task_id:
                continue
            if task.get("hermesSessionId") == session_id and task.get("session_id") == session_id:
                return True
            task["hermesSessionId"] = session_id
            task["session_id"] = session_id
            now = _now()
            task["updated_at"] = now
            project["updated_at"] = now
            changed = True
            break
        break
    if not changed:
        LOGGER.warning(
            "redou messages: cannot persist hermes session projectId=%s taskId=%s",
            project_id,
            task_id,
        )
        return False
    ok = _write_projects_store(store)
    if ok:
        LOGGER.debug(
            "redou task session persisted projectId=%s taskId=%s hermesSessionId=%s",
            project_id,
            task_id,
            session_id,
        )
    return ok


def _created_at_from_value(value: Any) -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()
    try:
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(float(value), timezone.utc).isoformat()
    except Exception:
        pass
    return _iso_now()


def _normalise_message_record(
    raw: Dict[str, Any],
    *,
    project_id: str = "",
    task_id: str = "",
) -> Dict[str, Any]:
    role = _compact(raw.get("role"), 32).lower()
    if role not in VALID_MESSAGE_ROLES:
        role = "system"
    metadata = raw.get("metadata")
    metadata = dict(metadata) if isinstance(metadata, dict) else {}
    if project_id:
        metadata.setdefault("projectId", project_id)
    if task_id:
        metadata.setdefault("taskId", task_id)
    for legacy_key in (
        "projectId",
        "taskId",
        "hermesSessionId",
        "status",
        "name",
        "context",
        "toolCallId",
    ):
        if legacy_key in raw and raw.get(legacy_key) is not None:
            metadata.setdefault(legacy_key, raw.get(legacy_key))
    content = raw.get("content")
    if content is None:
        content = raw.get("text")
    return {
        "role": role,
        "content": "" if content is None else str(content),
        "createdAt": _created_at_from_value(raw.get("createdAt") or raw.get("timestamp")),
        "metadata": metadata,
    }


def load_messages_file(
    path: Path,
    *,
    project_id: str = "",
    task_id: str = "",
) -> tuple[List[Dict[str, Any]], List[str]]:
    rows: List[Dict[str, Any]] = []
    warnings: List[str] = []
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text("", encoding="utf-8")
        return rows, warnings
    try:
        for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip():
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError as exc:
                warning = f"invalid JSONL line {line_no}: {exc.msg}"
                warnings.append(warning)
                LOGGER.warning("redou messages: %s in %s", warning, path)
                continue
            if not isinstance(item, dict):
                warning = f"skipped non-object JSONL line {line_no}"
                warnings.append(warning)
                LOGGER.warning("redou messages: %s in %s", warning, path)
                continue
            rows.append(
                _normalise_message_record(
                    item,
                    project_id=project_id,
                    task_id=task_id,
                )
            )
    except Exception as exc:
        warning = f"failed to read messages: {type(exc).__name__}"
        warnings.append(warning)
        LOGGER.warning("redou messages: failed to read %s: %s", path, exc)
    return rows, warnings


def load_task_messages(project_id: str, task_id: str) -> Dict[str, Any]:
    project, task = _find_project_and_task(project_id, task_id)
    if project is None or task is None:
        LOGGER.warning(
            "redou task open: missing project/task projectId=%s taskId=%s",
            project_id,
            task_id,
        )
        return {
            "projectId": project_id,
            "taskId": task_id,
            "messagesPath": "",
            "hermesSessionId": "",
            "messages": [],
            "warnings": ["Project or task metadata was not found."],
        }
    ensure_project_app_data(project)
    ensure_task_app_data(project, task)
    messages_path = Path(str(task.get("messagesPath") or ""))
    messages, warnings = load_messages_file(
        messages_path,
        project_id=project_id,
        task_id=task_id,
    )
    hermes_session_id = str(task.get("hermesSessionId") or task.get("session_id") or "")
    LOGGER.debug(
        "redou task open projectId=%s taskId=%s messagesPath=%s loadedMessages=%s hermesSessionId=%s",
        project_id,
        task_id,
        messages_path,
        len(messages),
        hermes_session_id,
    )
    return {
        "projectId": project_id,
        "taskId": task_id,
        "messagesPath": str(messages_path),
        "hermesSessionId": hermes_session_id,
        "messages": messages,
        "warnings": warnings,
    }


def task_messages_to_transcript_rows(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for item in messages:
        role = _compact(item.get("role"), 32).lower()
        if role not in VALID_MESSAGE_ROLES or role == "event":
            continue
        content = str(item.get("content") or "")
        if not content.strip() and role != "tool":
            continue
        row: Dict[str, Any] = {"role": role, "text": content}
        metadata = item.get("metadata")
        if isinstance(metadata, dict):
            if metadata.get("name"):
                row["name"] = str(metadata.get("name"))
            if metadata.get("context"):
                row["context"] = str(metadata.get("context"))
        rows.append(row)
    return rows


def _load_recent_messages(path: Path, limit: int = RECENT_MESSAGE_LIMIT) -> List[Dict[str, Any]]:
    rows, _warnings = load_messages_file(path)
    return rows[-limit:]


def _markdown_list_text(value: Any, max_len: int = 1200) -> str:
    text = " ".join(
        line.strip()
        for line in str(value or "").replace("\r\n", "\n").split("\n")
        if line.strip()
    )
    return text[:max_len].strip()


def _strip_context_directive_lead(value: str) -> str:
    text = str(value or "").strip()
    text = re.sub(
        r"^(please\s+)?(remember|note|save|record|use this as|add this to|add to|keep in mind|以后|下次|记住|记忆|记录|保存|请记住|帮我记住)[\s:：,，-]*",
        "",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"^(this\s+)?(project|task)\s+(rule|memory|mem|instruction|preference)[\s:：,，-]*",
        "",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"^(项目|任务|本项目|本任务|当前项目|当前任务)(规则|记忆|偏好|要求)?[\s:：,，-]*",
        "",
        text,
        flags=re.IGNORECASE,
    )
    return text.strip()


def classify_context_directive(value: Any) -> Optional[Dict[str, str]]:
    raw = str(value or "").strip()
    if not raw:
        return None
    remember_re = re.compile(
        r"(remember|note this|save this|record this|keep in mind|always|never|from now on|以后|下次|以后都|总是|永远|不要|必须|记住|记忆|记录|保存|偏好|规则)",
        re.IGNORECASE,
    )
    target_re = re.compile(
        r"(project\s+(rules?|memory|mem|instruction|preference)|task\s+(rules?|instruction|preference|summary)|项目.*(规则|记忆|偏好|要求)|任务.*(规则|偏好|要求|总结)|本项目|当前项目|本任务|当前任务)",
        re.IGNORECASE,
    )
    if not remember_re.search(raw) and not target_re.search(raw):
        return None

    task_scoped = re.search(
        r"(task\s+(rules?|instruction|preference)|this task|current task|任务|本任务|当前任务)",
        raw,
        re.IGNORECASE,
    )
    project_scoped = re.search(
        r"(project\s+(rules?|memory|mem|instruction|preference)|this project|current project|项目|本项目|当前项目)",
        raw,
        re.IGNORECASE,
    )
    explicit_project_memory = re.search(
        r"(project\s+(memory|mem)|项目.*(记忆|mem)|项目mem)",
        raw,
        re.IGNORECASE,
    )
    explicit_project_rules = re.search(
        r"(project\s+(rules?|instruction|preference)|项目.*(规则|偏好|要求)|本项目|当前项目)",
        raw,
        re.IGNORECASE,
    )

    scope = "project" if project_scoped and not task_scoped else "task"
    content = _markdown_list_text(_strip_context_directive_lead(raw))
    if len(content) < 2:
        return None
    return {"scope": scope, "content": content}


def apply_context_directive(project_id: str, task_id: str, user_input: Any) -> Optional[Dict[str, Any]]:
    directive = classify_context_directive(user_input)
    if directive is None:
        return None
    project, task = _find_project_and_task(project_id, task_id)
    if project is None or task is None:
        return None
    target_path = (
        Path(str(project.get("rulesPath") or ""))
        if directive["scope"] == "project"
        else Path(str(task.get("rulesPath") or ""))
    )
    label = "PROJECT_RULES.md" if directive["scope"] == "project" else "TASK_RULES.md"
    current = _read_text(target_path)
    existing = {
        re.sub(r"^[-*]\s+", "", line.strip()).lower()
        for line in current.splitlines()
        if line.strip()
    }
    rule_key = directive["content"].strip().lower()
    already_present = rule_key in existing
    if not already_present:
        target_path.parent.mkdir(parents=True, exist_ok=True)
        entry = f"\n\n- {directive['content']}\n"
        target_path.write_text(current.rstrip() + entry, encoding="utf-8")
    return {
        **directive,
        "targetPath": str(target_path),
        "label": label,
        "alreadyPresent": already_present,
    }


def append_raw_turn_log(
    project_id: str,
    task_id: str,
    user_input: Any,
    assistant_text: Any,
) -> Optional[Dict[str, Any]]:
    user, _user_redactions = _redact_text(_markdown_list_text(user_input, 900))
    assistant, _assistant_redactions = _redact_text(_markdown_list_text(assistant_text, 1400))
    if not user and not assistant:
        return None
    project, task = _find_project_and_task(project_id, task_id)
    if project is None or task is None:
        return None
    path = Path(str(task.get("contextPath") or ""))
    current = _ensure_task_context_shape(path).rstrip()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")
    entry = "\n".join(
        [
            f"### {now}",
            "",
            "User Request:",
            user or "(empty)",
            "",
            "Assistant Summary:",
            assistant or "(empty)",
            "",
            "Observed Artifacts:",
            "- files:",
            "  []",
            "- commands:",
            "  []",
            "- errors:",
            "  []",
            "- attachments:",
            "  []",
            "",
            "Light Tags:",
            "- constraints:",
            "  []",
            "- todos:",
            "  []",
            "- evidence:",
            "  []",
            "- open_issues:",
            "  []",
            "",
        ]
    )
    next_text = f"{current}\n\n{entry}"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(next_text, encoding="utf-8")
    return {"path": str(path), "length": len(next_text)}


def update_task_summary_after_turn(
    project_id: str,
    task_id: str,
    user_input: Any,
    assistant_text: Any,
) -> Optional[Dict[str, Any]]:
    return append_raw_turn_log(project_id, task_id, user_input, assistant_text)


def _section(title: str, content: str) -> str:
    body = content.strip()
    if not body:
        body = "(empty)"
    return f"## {title}\n\n{body}"


def _split_task_context(text: str) -> tuple[str, str]:
    normalized = _normalize_task_context_text(text)
    match = re.search(r"^## B\. Raw Turn Log\s*$", normalized, re.MULTILINE)
    if not match:
        return _normalize_task_context_text(""), ""
    structured = normalized[: match.start()].rstrip()
    raw = normalized[match.end() :].strip()
    return structured, raw


# ─────────────────────────────────────────────────────────────────────────────
# Redou Context Assembly Contract
#
# These helpers keep the prompt boundary deterministic:
# - current user request appears once and is always the final user message;
# - queued future inputs and guide/control events never enter ordinary history;
# - raw command/tool event logs are summarized instead of replayed;
# - secret-like values are redacted before they enter prompt text.
# ─────────────────────────────────────────────────────────────────────────────


def _merge_metadata(message: Dict[str, Any]) -> tuple[Dict[str, Any], Dict[str, Any], Dict[str, Any], str]:
    metadata = message.get("metadata") if isinstance(message.get("metadata"), dict) else {}
    event = metadata.get("event") if isinstance(metadata.get("event"), dict) else {}
    event_metadata = event.get("metadata") if isinstance(event.get("metadata"), dict) else {}
    combined = {**metadata, **event_metadata}
    event_type = str(metadata.get("eventType") or event.get("type") or "")
    return metadata, event, combined, event_type


def _normalise_delivery_mode(value: Any, fallback: str = "new_turn") -> str:
    mode = str(value or "").strip().lower()
    return mode if mode in {"new_turn", "queue", "guide", "interrupt_replace"} else fallback


def _normalise_input_status(value: Any, fallback: str = "pending") -> str:
    status = str(value or "").strip().lower()
    return status if status in {"pending", "consumed", "completed", "cancelled"} else fallback


def _message_input_envelope(message: Dict[str, Any]) -> Optional[Dict[str, str]]:
    metadata, _event, _combined, _event_type = _merge_metadata(message)
    raw = metadata.get("inputEnvelope")
    if not isinstance(raw, dict):
        return None
    return {
        "id": str(raw.get("id") or ""),
        "text": str(raw.get("text") or ""),
        "turnId": str(raw.get("turnId") or ""),
        "runId": str(raw.get("runId") or ""),
        "deliveryMode": _normalise_delivery_mode(raw.get("deliveryMode")),
        "status": _normalise_input_status(raw.get("status")),
        "targetRunId": str(raw.get("targetRunId") or ""),
        "consumedAt": str(raw.get("consumedAt") or ""),
    }


def _is_control_event_message(message: Dict[str, Any]) -> bool:
    metadata, _event, _combined, event_type = _merge_metadata(message)
    envelope = _message_input_envelope(message)
    return bool(
        event_type == "control_event"
        or metadata.get("controlEvent") is True
        or metadata.get("controlEventType")
        or metadata.get("deliveryMode") == "guide"
        or (envelope and envelope.get("deliveryMode") == "guide")
    )


def _completed_run_ids_from_messages(messages: List[Dict[str, Any]]) -> set[str]:
    completed: set[str] = set()
    cancelled: set[str] = set()
    for message in messages or []:
        _metadata, _event, combined, event_type = _merge_metadata(message)
        run_id = str(combined.get("runId") or "")
        if not run_id:
            continue
        if event_type == "done":
            if combined.get("cancelled") or combined.get("stopRequested") or combined.get("replacedByRunId"):
                cancelled.add(run_id)
            else:
                completed.add(run_id)
        if event_type == "error" and (combined.get("cancelled") or combined.get("stopRequested")):
            cancelled.add(run_id)
    return completed - cancelled


def _scrub_current_request_echo(content: Any, current_request: str) -> str:
    source = str(content or "")
    request = str(current_request or "").strip()
    if not request or len(request) < 8:
        return source
    return source.replace(request, "[current request omitted here]")


def _is_prompt_history_message(
    message: Dict[str, Any],
    completed_run_ids: set[str],
    current_request_id: str = "",
) -> bool:
    role = str(message.get("role") or "")
    if role not in {"user", "assistant", "tool"}:
        return False
    _metadata, _event, combined, event_type = _merge_metadata(message)
    if event_type in _RAW_EVENT_TYPES:
        return False
    if _is_control_event_message(message):
        return False
    envelope = _message_input_envelope(message)
    if envelope:
        if envelope.get("id") and envelope.get("id") == current_request_id:
            return False
        if envelope.get("deliveryMode") == "guide":
            return False
        if envelope.get("status") != "completed":
            return False
    run_id = str(combined.get("runId") or "")
    if run_id and completed_run_ids and run_id not in completed_run_ids:
        return False
    return True


def _context_message(role: str, content: Any, kind: str, **metadata: Any) -> Dict[str, Any]:
    return {
        "role": role,
        "content": str(content or "").strip() or "(empty)",
        "metadata": {"redouContextKind": kind, **{k: v for k, v in metadata.items() if v not in (None, "")}},
    }


def _render_history_messages(
    messages: List[Dict[str, Any]],
    *,
    completed_run_ids: set[str],
    current_request_text: str,
    current_request_id: str,
    redaction_stats: Dict[str, int],
) -> tuple[List[Dict[str, Any]], List[str], List[str]]:
    rendered: List[Dict[str, Any]] = []
    excluded_queued: List[str] = []
    excluded_guides: List[str] = []
    for message in messages or []:
        envelope = _message_input_envelope(message)
        if envelope and envelope.get("status") in {"pending", "consumed"}:
            excluded_queued.append(envelope.get("id") or envelope.get("turnId") or "unknown")
        if envelope and envelope.get("deliveryMode") == "guide":
            excluded_guides.append(envelope.get("id") or envelope.get("turnId") or "unknown")
        if _is_control_event_message(message):
            excluded_guides.append((envelope or {}).get("id") or "control-event")
        if not _is_prompt_history_message(message, completed_run_ids, current_request_id):
            continue
        raw_content = str(message.get("content") or "")
        if len(raw_content) > RECENT_MESSAGE_CONTENT_LIMIT:
            raw_content = raw_content[:RECENT_MESSAGE_CONTENT_LIMIT] + "\n[truncated]"
        scrubbed = _scrub_current_request_echo(raw_content, current_request_text)
        redacted, redaction_count = _redact_text(scrubbed)
        redaction_stats["count"] = redaction_stats.get("count", 0) + redaction_count
        metadata, _event, combined, _event_type = _merge_metadata(message)
        rendered.append(
            _context_message(
                str(message.get("role") or "user"),
                redacted,
                "history",
                runId=str(combined.get("runId") or ""),
                turnId=(envelope or {}).get("turnId") or metadata.get("turnId"),
                inputEnvelopeId=(envelope or {}).get("id"),
            )
        )
    return rendered[-RECENT_MESSAGE_LIMIT:], sorted(set(excluded_queued)), sorted(set(excluded_guides))


def _summarize_tool_logs(
    messages: List[Dict[str, Any]],
    *,
    completed_run_ids: set[str],
    current_request_text: str,
    redaction_stats: Dict[str, int],
) -> str:
    by_run: Dict[str, Dict[str, Any]] = {}

    def ensure(run_id: str) -> Dict[str, Any]:
        key = run_id or "legacy"
        if key not in by_run:
            by_run[key] = {"commands": [], "tools": [], "files": [], "outputs": [], "errors": [], "success": None}
        return by_run[key]

    for message in messages or []:
        _metadata, event, combined, event_type = _merge_metadata(message)
        run_id = str(combined.get("runId") or "")
        if run_id and completed_run_ids and run_id not in completed_run_ids:
            continue
        if event_type not in {"command_start", "command_end", "command_output", "tool_start", "tool_end", "tool_output", "file_changed", "error"}:
            continue
        bucket = ensure(run_id)
        if event_type == "command_start" and event.get("command"):
            bucket["commands"].append(str(event.get("command")))
        elif event_type == "command_end":
            bucket["success"] = event.get("success") is not False
        elif event_type == "tool_start" and event.get("name"):
            bucket["tools"].append(str(event.get("name")))
        elif event_type == "tool_end":
            bucket["success"] = event.get("success") is not False
        elif event_type == "file_changed":
            bucket["files"].append(str(event.get("path") or event.get("summary") or ""))
        elif event_type == "error":
            bucket["errors"].append(str(event.get("message") or message.get("content") or ""))
        elif event_type in {"command_output", "tool_output"}:
            raw = event.get("output") if event_type == "tool_output" else event.get("content")
            if not isinstance(raw, str):
                raw = json.dumps(raw or {}, ensure_ascii=False)
            first_line = next((line.strip() for line in str(raw).splitlines() if line.strip()), "")
            if first_line:
                bucket["outputs"].append(first_line)

    lines: List[str] = []
    for run_id, bucket in list(by_run.items())[-4:]:
        parts: List[str] = []
        if bucket["commands"]:
            parts.append("commands: " + "; ".join(dict.fromkeys(bucket["commands"]).keys()))
        if bucket["tools"]:
            parts.append("tools: " + ", ".join(dict.fromkeys(bucket["tools"]).keys()))
        if bucket["success"] is not None:
            parts.append("result: " + ("success" if bucket["success"] else "failed"))
        if bucket["files"]:
            parts.append("files: " + ", ".join(dict.fromkeys([x for x in bucket["files"] if x]).keys()))
        if bucket["outputs"]:
            parts.append("key output: " + " | ".join(_compact(x, 220) for x in list(dict.fromkeys(bucket["outputs"]).keys())[:4]))
        if bucket["errors"]:
            parts.append("errors: " + " | ".join(_compact(x, 260) for x in list(dict.fromkeys(bucket["errors"]).keys())[:4]))
        if not parts:
            continue
        line = _scrub_current_request_echo(f"- run {run_id}: {'; '.join(parts)}", current_request_text)
        redacted, redaction_count = _redact_text(line)
        redaction_stats["count"] = redaction_stats.get("count", 0) + redaction_count
        lines.append(redacted)
    return "\n".join(lines)


def _flatten_context_messages(messages: List[Dict[str, Any]]) -> str:
    chunks = ["# Redou Context Pack", "", "The final user message below is the only authoritative Current User Request.", ""]
    for idx, message in enumerate(messages, 1):
        role = str(message.get("role") or "user")
        kind = str((message.get("metadata") or {}).get("redouContextKind") or "context")
        chunks.extend([
            f"## {idx}. {role} / {kind}",
            "",
            str(message.get("content") or "").strip() or "(empty)",
            "",
        ])
    return "\n".join(chunks).rstrip() + "\n"


def _validate_context_messages(messages: List[Dict[str, Any]], current_request_text: str, current_request_id: str = "") -> Dict[str, Any]:
    errors: List[str] = []
    prompt_text = _flatten_context_messages(messages)
    user_messages = [message for message in messages if message.get("role") == "user"]
    last_user = user_messages[-1] if user_messages else None
    current = str(current_request_text or "").strip()
    occurrences = prompt_text.count(current) if current else 0
    if not current:
        errors.append("Current User Request is empty.")
    elif occurrences != 1:
        errors.append(f"Current User Request occurrence count is {occurrences}, expected 1.")
    if not last_user or current not in str(last_user.get("content") or "") or (messages and messages[-1] is not last_user):
        errors.append("Current User Request is not the final user message.")
    non_current_text = _flatten_context_messages(messages[:-1]) if messages else ""
    if re.search(r"\b(command_start|tool_start|tool_end|queue_update|raw_log|run_stage)\b", non_current_text):
        errors.append("Prompt contains raw run event labels.")
    for message in messages:
        kind = (message.get("metadata") or {}).get("redouContextKind")
        envelope = _message_input_envelope(message)
        _metadata, _event, _combined, event_type = _merge_metadata(message)
        if kind == "history" and envelope and envelope.get("status") != "completed":
            errors.append(f"History includes non-completed turn {envelope.get('turnId') or envelope.get('id')}.")
        if kind == "history" and envelope and envelope.get("deliveryMode") == "guide":
            errors.append(f"Guide/control event appears as user history {envelope.get('id')}.")
        if kind == "history" and event_type in _RAW_EVENT_TYPES:
            errors.append(f"Raw run event {event_type} appears in conversation history.")
    if _contains_unredacted_secret(prompt_text):
        errors.append("Prompt contains an unredacted secret-like value.")
    return {
        "ok": not errors,
        "errors": errors,
        "currentRequestId": current_request_id,
        "currentRequestOccurrences": occurrences,
        "messageCount": len(messages),
    }


def _build_context_messages(
    *,
    project_rules: str,
    task_rules: str,
    structured_state: str,
    recent_messages: List[Dict[str, Any]],
    attachments: str,
    current_user_request: str,
    current_request_id: str = "",
) -> tuple[List[Dict[str, Any]], Dict[str, Any], Dict[str, Any]]:
    redaction_stats = {"count": 0}
    completed_run_ids = _completed_run_ids_from_messages(recent_messages)
    history_messages, excluded_queued, excluded_guides = _render_history_messages(
        recent_messages,
        completed_run_ids=completed_run_ids,
        current_request_text=current_user_request,
        current_request_id=current_request_id,
        redaction_stats=redaction_stats,
    )
    tool_summary = _summarize_tool_logs(
        recent_messages,
        completed_run_ids=completed_run_ids,
        current_request_text=current_user_request,
        redaction_stats=redaction_stats,
    )
    isolation = "\n".join(
        [
            "You are Redou Agent inside Redou Desktop Task Chat.",
            "Use Redou Agent as the visible product identity; Hermes is only the Local Runtime layer.",
            "The current Project is the only project boundary.",
            "The current Task is the only conversation boundary.",
            "Do not reference rules, task context, chat history, sessions, or memories from any other Project.",
            "Current User Request is the final user message and has highest priority.",
            "Queued future messages and guide/control events are not ordinary conversation history.",
            "Raw command/tool logs are summarized; do not infer from omitted raw events.",
            "Do not write transient task logs, errors, file paths, or implementation details into MEMORY.md, PROJECT_RULES.md, or TASK_RULES.md.",
        ]
    )
    project_rules_safe, count = _redact_text(project_rules)
    redaction_stats["count"] += count
    task_rules_safe, count = _redact_text(task_rules)
    redaction_stats["count"] += count
    structured_safe, count = _redact_text(_scrub_current_request_echo(structured_state, current_user_request))
    redaction_stats["count"] += count
    attachments_safe, count = _redact_text(attachments)
    redaction_stats["count"] += count
    current_safe, count = _redact_text(current_user_request)
    redaction_stats["count"] += count
    messages = [
        _context_message("system", "# Redou System Instructions\n\n" + _section("Isolation Rules", isolation), "redou_system"),
        _context_message("developer", project_rules_safe or "(empty)", "project_rules"),
        _context_message("developer", task_rules_safe or "(empty)", "task_rules"),
        _context_message("developer", structured_safe or "(empty)", "task_state"),
    ]
    if tool_summary.strip():
        messages.append(_context_message("developer", "# Tool Result Summary\n\n" + tool_summary, "tool_summary"))
    messages.extend(history_messages)
    if attachments_safe.strip():
        messages.append(_context_message("developer", attachments_safe, "attachments"))
    messages.append(
        _context_message(
            "user",
            "# Current User Request\n\n" + (current_safe.strip() or "(empty)") + "\n\n# Output Contract\n\n" + _output_contract(),
            "current_request",
            inputEnvelopeId=current_request_id,
        )
    )
    validation = _validate_context_messages(messages, current_safe, current_request_id)
    debug = {
        "includedMessageCount": len(messages),
        "includedHistoryCount": len(history_messages),
        "excludedQueuedMessageIds": excluded_queued,
        "excludedGuideControlEventIds": excluded_guides,
        "redactedSecretCount": redaction_stats.get("count", 0),
        "completedRunIds": sorted(completed_run_ids),
        "validationOk": validation.get("ok"),
    }
    return messages, validation, debug


def _output_contract() -> str:
    return "\n".join(
        [
            "You must report:",
            "1. what was done",
            "2. key result",
            "3. remaining issues",
            "4. next action",
        ]
    )



def build_task_context(project_id: str, task_id: str, user_input: str) -> BuiltTaskContext:
    """Build a structured Redou prompt for a Project/Task turn.

    Contract:
    - current user request appears exactly once;
    - it is represented as the final user message;
    - queued future inputs, guide/control events, and raw run logs are excluded;
    - tool/command events are summarized and secrets are redacted.
    """
    project, task = _find_project_and_task(project_id, task_id)
    if project is None or task is None:
        context_messages, validation, debug = _build_context_messages(
            project_rules="",
            task_rules="",
            structured_state="# Context Warning\n\nProject or task metadata was not found.",
            recent_messages=[],
            attachments="",
            current_user_request=user_input,
        )
        text = _flatten_context_messages(context_messages)
        LOGGER.warning(
            "redou context: missing project/task projectId=%s taskId=%s contextLength=%s validationOk=%s",
            project_id,
            task_id,
            len(text),
            validation.get("ok"),
        )
        return BuiltTaskContext(text, [], 0, len(text), "", context_messages, validation, debug)

    ensure_project_app_data(project)
    ensure_task_app_data(project, task)
    context_directive = apply_context_directive(project_id, task_id, user_input)

    files = [
        str(project.get("rulesPath") or ""),
        str(task.get("rulesPath") or ""),
        str(task.get("contextPath") or ""),
        str(task.get("messagesPath") or ""),
    ]
    # Load extra rows because queued/guide/raw event rows are intentionally filtered out.
    messages = _load_recent_messages(Path(str(task.get("messagesPath") or "")), RECENT_MESSAGE_LIMIT * 4)
    task_context = _ensure_task_context_shape(Path(str(task.get("contextPath") or "")))
    structured_state, _raw = _split_task_context(task_context)
    context_messages, validation, debug = _build_context_messages(
        project_rules=_read_text(Path(str(project.get("rulesPath")))),
        task_rules=_read_text(Path(str(task.get("rulesPath")))),
        structured_state=structured_state,
        recent_messages=messages,
        attachments="",
        current_user_request=user_input,
    )
    text = _flatten_context_messages(context_messages)
    hermes_profile = str(project.get("hermesProfile") or os.environ.get("REDOU_HERMES_PROFILE") or "")
    included_files = [path for path in files if path]
    debug.update({"recentMessagesLoaded": len(messages), "rawTurnLogIncluded": False})
    LOGGER.debug(
        "redou context built projectId=%s taskId=%s hermesProfile=%s files=%s recentMessages=%s includedMessages=%s contextLength=%s validationOk=%s",
        project_id,
        task_id,
        hermes_profile,
        included_files,
        len(messages),
        len(context_messages),
        len(text),
        validation.get("ok"),
    )
    if not validation.get("ok"):
        LOGGER.warning(
            "redou context validation failed projectId=%s taskId=%s errors=%s",
            project_id,
            task_id,
            validation.get("errors"),
        )
    if context_directive:
        LOGGER.debug(
            "redou context directive saved projectId=%s taskId=%s target=%s",
            project_id,
            task_id,
            context_directive.get("targetPath"),
        )
    return BuiltTaskContext(text, included_files, len(messages), len(text), hermes_profile, context_messages, validation, debug)

def append_task_message(
    project_id: str,
    task_id: str,
    role: str,
    content: Any,
    *,
    hermes_session_id: Optional[str] = None,
    status: Optional[str] = None,
) -> bool:
    project, task = _find_project_and_task(project_id, task_id)
    if project is None or task is None:
        LOGGER.warning(
            "redou messages: missing project/task projectId=%s taskId=%s role=%s",
            project_id,
            task_id,
            role,
        )
        return False
    path = Path(str(task.get("messagesPath") or ""))
    if not path:
        return False
    role_name = _compact(role, 32).lower()
    if role_name not in VALID_MESSAGE_ROLES:
        role_name = "system"
    session_id = (
        _compact(hermes_session_id, 160)
        or _compact(task.get("hermesSessionId") or task.get("session_id"), 160)
        or ""
    )
    metadata: Dict[str, Any] = {
        "projectId": project_id,
        "taskId": task_id,
    }
    if session_id:
        metadata["hermesSessionId"] = session_id
    if status:
        metadata["status"] = _compact(status, 64)
    payload: Dict[str, Any] = {
        "role": role_name,
        "content": str(content or ""),
        "createdAt": _iso_now(),
        "metadata": metadata,
    }
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=False) + "\n")
        if session_id:
            set_task_hermes_session_id(project_id, task_id, session_id)
        LOGGER.debug(
            "redou messages appended projectId=%s taskId=%s messagesPath=%s role=%s contentLength=%s hermesSessionId=%s",
            project_id,
            task_id,
            path,
            role_name,
            len(payload["content"]),
            session_id,
        )
        return True
    except Exception as exc:
        LOGGER.warning("redou messages: failed to append %s: %s", path, exc)
        return False
