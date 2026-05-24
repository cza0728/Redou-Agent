"""Redou run-stage event helpers for Hermes.

This module is intentionally small and transport-neutral.  Hermes can build a
standard ``run_stage`` event here, then hand it to an existing callback or event
stream without changing the core tool-call protocol.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Callable, Dict, MutableSet, Optional, Tuple


RUN_STAGE_LABELS: Dict[str, str] = {
    "understanding": "理解任务",
    "inspecting": "检查项目",
    "planning": "制定方案",
    "editing": "修改文件",
    "testing": "测试验证",
    "packaging": "打包输出",
    "summarizing": "整理结果",
    "blocked": "等待处理",
    "done": "完成",
    "failed": "失败",
}

RUN_STAGE_STATUSES = {
    "started",
    "running",
    "completed",
    "skipped",
    "blocked",
    "failed",
}

_READ_SEARCH_TOOLS = {
    "read_file",
    "search_files",
    "web_search",
    "web_extract",
    "web_crawl",
    "browser_navigate",
    "browser_snapshot",
    "browser_console",
    "browser_get_images",
    "browser_vision",
    "session_search",
}

_EDIT_TOOLS = {
    "write_file",
    "patch",
    "skill_manage",
}

_TEST_COMMAND_RE = re.compile(
    r"\b("
    r"pytest|python\s+-m\s+pytest|node\s+--test|npm\s+(?:run\s+)?test|"
    r"pnpm\s+(?:run\s+)?test|yarn\s+test|vitest|jest|mocha|"
    r"npm\s+(?:run\s+)?(?:build|lint)|pnpm\s+(?:run\s+)?(?:build|lint)|"
    r"yarn\s+(?:build|lint)|eslint|tsc|ruff|mypy|tox|go\s+test|"
    r"cargo\s+test|mvn\s+test|gradle\s+test|check-path-contract"
    r")\b",
    re.IGNORECASE,
)

_PACKAGE_COMMAND_RE = re.compile(
    r"\b(zip|tar|gzip|7z|archive|packag(?:e|ing)|export|bundle|dist)\b",
    re.IGNORECASE,
)

_INSPECT_COMMAND_RE = re.compile(
    r"\b(rg|grep|find|ls|dir|cat|type|Get-Content|Select-String|tree|pwd|git\s+status|git\s+diff)\b",
    re.IGNORECASE,
)

_EDIT_COMMAND_RE = re.compile(
    r"\b(apply_patch|write|sed\s+-i|perl\s+-pi|python\s+.*(?:write_text|open\(.+['\"]w)|"
    r"npm\s+pkg|git\s+apply)\b",
    re.IGNORECASE,
)


def _utc_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def emit_run_stage(
    stage: str,
    label: Optional[str] = None,
    status: str = "running",
    details: Optional[str] = None,
    task_id: Optional[str] = None,
    run_id: Optional[str] = None,
    turn_id: Optional[str] = None,
    *,
    emitter: Optional[Callable[[Dict[str, Any]], None]] = None,
    dedupe_cache: Optional[MutableSet[Tuple[str, str, str]]] = None,
) -> Optional[Dict[str, Any]]:
    """Build and optionally emit a Redou/Hermes ``run_stage`` event.

    Returns the event when built.  If validation or downstream emission fails,
    returns ``None`` so stage reporting can never fail the user task.
    """

    try:
        stage_key = str(stage or "").strip()
        status_key = str(status or "running").strip()
        if stage_key not in RUN_STAGE_LABELS:
            return None
        if status_key not in RUN_STAGE_STATUSES:
            status_key = "running"

        short_details = str(details or "").strip()
        if len(short_details) > 240:
            short_details = short_details[:237].rstrip() + "..."

        dedupe_key = (stage_key, status_key, short_details)
        if dedupe_cache is not None:
            if dedupe_key in dedupe_cache:
                return None
            dedupe_cache.add(dedupe_key)

        event: Dict[str, Any] = {
            "type": "run_stage",
            "stage": stage_key,
            "label": (str(label).strip() if label else RUN_STAGE_LABELS[stage_key]),
            "status": status_key,
            "source": "hermes",
            "timestamp": _utc_iso(),
        }
        if short_details:
            event["details"] = short_details
        if task_id:
            event["taskId"] = str(task_id)
        if run_id:
            event["runId"] = str(run_id)
        if turn_id:
            event["turnId"] = str(turn_id)

        if emitter is not None:
            emitter(event)
        return event
    except Exception:
        return None


def infer_run_stage_from_tool(tool_name: str, args: Optional[Dict[str, Any]] = None) -> Optional[Tuple[str, str]]:
    """Return ``(stage, details)`` for a tool call when it is obvious."""

    name = str(tool_name or "").strip()
    lower_name = name.lower()
    payload = args if isinstance(args, dict) else {}
    command = str(
        payload.get("command")
        or payload.get("cmd")
        or payload.get("code")
        or payload.get("shell_command")
        or ""
    )

    if lower_name in _READ_SEARCH_TOOLS or lower_name.startswith("browser_"):
        return "inspecting", f"正在使用 {name} 读取或搜索项目上下文"

    if lower_name in _EDIT_TOOLS or any(token in lower_name for token in ("write", "patch", "edit", "file")):
        return "editing", f"正在使用 {name} 修改文件或项目状态"

    if lower_name == "terminal" or "shell" in lower_name or "command" in lower_name or lower_name == "execute_code":
        if _TEST_COMMAND_RE.search(command):
            return "testing", "正在运行测试、构建、lint 或路径检查"
        if _PACKAGE_COMMAND_RE.search(command):
            return "packaging", "正在打包、导出或整理交付物"
        if _EDIT_COMMAND_RE.search(command):
            return "editing", "正在通过命令修改文件"
        if _INSPECT_COMMAND_RE.search(command):
            return "inspecting", "正在通过命令检查项目结构或文件"

    return None


class RunStageEmitter:
    """Per-turn de-duplicating wrapper around ``emit_run_stage``."""

    def __init__(self, emitter: Optional[Callable[[Dict[str, Any]], None]] = None) -> None:
        self._emitter = emitter
        self._dedupe_cache: set[Tuple[str, str, str]] = set()

    def reset(self) -> None:
        self._dedupe_cache.clear()

    def emit(
        self,
        stage: str,
        label: Optional[str] = None,
        status: str = "running",
        details: Optional[str] = None,
        task_id: Optional[str] = None,
        run_id: Optional[str] = None,
        turn_id: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        return emit_run_stage(
            stage,
            label,
            status,
            details,
            task_id,
            run_id,
            turn_id,
            emitter=self._emitter,
            dedupe_cache=self._dedupe_cache,
        )
