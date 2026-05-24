"""Local Redou-to-Hermes adapter.

The Electron Main Process starts this script as a short-lived child process for
one Task Chat turn. It reads a JSON payload from stdin and writes structured
AgentEvent JSON lines to stdout. Any ordinary Hermes/runtime noise is redirected
to stderr so the Renderer never becomes a terminal relay.
"""

from __future__ import annotations

import contextlib
import asyncio
import json
import os
import sys
import threading
import time
import traceback
import uuid
from datetime import datetime, timezone
from pathlib import Path

# Source checkout layout: apps/desktop/src -> repo root -> vendor/hermes.
_REDOU_PROJECT_ROOT = Path(os.environ.get("REDOU_PROJECT_ROOT", Path(__file__).resolve().parents[3]))
_HERMES_VENDOR_ROOT = Path(os.environ.get("HERMES_VENDOR_ROOT", _REDOU_PROJECT_ROOT / "vendor" / "hermes"))
if _HERMES_VENDOR_ROOT.is_dir():
    value = str(_HERMES_VENDOR_ROOT)
    if value not in sys.path:
        sys.path.insert(0, value)
from typing import Any, Dict


EVENT_OUT = sys.stdout
RISK_CONFIRMED = False
PERMISSIONS_CONFIG: Dict[str, Any] = {}
RUNTIME_APPROVAL_ENABLED: bool | None = None
APPROVAL_TIMEOUT_SECONDS: int | None = None
RUN_CONTEXT: Dict[str, Any] = {}
PENDING_APPROVALS: Dict[str, Dict[str, Any]] = {}
PENDING_APPROVALS_LOCK = threading.Lock()
EVENT_LOCK = threading.Lock()
RUN_STAGE_STAGES = {
    "understanding",
    "inspecting",
    "planning",
    "editing",
    "testing",
    "packaging",
    "summarizing",
    "blocked",
    "done",
    "failed",
}
RUN_STAGE_STATUSES = {
    "started",
    "running",
    "completed",
    "skipped",
    "blocked",
    "failed",
}
PLAN_MODE_SYSTEM_CONTEXT = """
Redou Plan Mode is active for this turn.

Follow the Redou Plan Mode behavior:
- Plan only. Do not implement code or modify project files except the plan markdown file.
- You may inspect the workspace with read-only tools and commands when needed.
- Do not run mutating terminal commands, commit, push, install packages, or perform external actions.
- Write a concrete markdown plan under the Redou-managed project plan directory.
- Use the `REDOU_PLAN_DIR` environment variable when available.
- If `REDOU_PLAN_DIR` is unavailable, use `.redou/plans/` in the active workspace.
- Do not write plans under `.hermes/plans/`.
- Include the goal, current context and assumptions, proposed approach, step-by-step plan, likely files to change, tests or validation, and risks or open questions when relevant.
- After saving the plan, reply briefly with the plan summary and saved path.

The user will review the plan in Redou before any execution turn is started.
""".strip()

DEFAULT_AGENT_MAX_TURNS = 200
HARD_MAX_AGENT_MAX_TURNS = 10000


def normalize_max_turns(value: Any, fallback: int = DEFAULT_AGENT_MAX_TURNS) -> int:
    if value is None:
        return fallback
    if isinstance(value, str) and not value.strip():
        return fallback
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return fallback
    if parsed != parsed or parsed in (float("inf"), float("-inf")):
        return fallback
    return max(1, min(int(parsed // 1), HARD_MAX_AGENT_MAX_TURNS))


def configured_agent_max_turns() -> int:
    try:
        from hermes_cli.config import load_config

        config = load_config() or {}
        agent = config.get("agent") if isinstance(config, dict) else {}
        value = agent.get("max_turns") if isinstance(agent, dict) else None
        return normalize_max_turns(value, DEFAULT_AGENT_MAX_TURNS)
    except Exception:
        return DEFAULT_AGENT_MAX_TURNS


def _project_root() -> Path:
    return _REDOU_PROJECT_ROOT


def _emit(event: Dict[str, Any]) -> None:
    with EVENT_LOCK:
        EVENT_OUT.write(json.dumps(event, ensure_ascii=False) + "\n")
        EVENT_OUT.flush()


def _utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _turn_timing_metadata(started_at: str, started_monotonic: float) -> Dict[str, Any]:
    duration_ms = max(0, int(round((time.monotonic() - started_monotonic) * 1000)))
    return {
        "startedAt": started_at,
        "completedAt": _utc_iso(),
        "durationMs": duration_ms,
        "durationSeconds": round(duration_ms / 1000, 1),
    }


def _safe_json(value: Any) -> Any:
    try:
        json.dumps(value)
        return value
    except Exception:
        return str(value)


def _run_stage_object(value: Any) -> Dict[str, Any] | None:
    if isinstance(value, str):
        raw = value.strip()
        if not raw or not raw.startswith("{"):
            return None
        try:
            value = json.loads(raw)
        except Exception:
            return None
    if not isinstance(value, dict) or value.get("type") != "run_stage":
        return None
    stage = str(value.get("stage") or "").strip()
    if stage not in RUN_STAGE_STAGES:
        return None
    status = str(value.get("status") or "running").strip()
    if status not in RUN_STAGE_STATUSES:
        status = "running"
    return {
        **value,
        "type": "run_stage",
        "stage": stage,
        "status": status,
        "source": "hermes",
        "timestamp": str(value.get("timestamp") or _utc_iso()),
    }


def _strip_run_stage_json_lines(text: str) -> str:
    if _run_stage_object(text) is not None:
        return ""
    lines = str(text or "").splitlines()
    if not lines:
        return ""
    kept: list[str] = []
    for line in lines:
        if _run_stage_object(line) is not None:
            continue
        kept.append(line)
    return "\n".join(kept).strip()


def _stream_recovery_interrupted(text: str) -> bool:
    lowered = str(text or "").lower()
    return (
        "stream stalled mid tool-call" in lowered
        or "stream interrupted before completion" in lowered
    )


def _is_image_attachment(attachment: Dict[str, Any]) -> bool:
    mime = str(attachment.get("mimeType") or "").lower()
    if mime.startswith("image/"):
        return True
    suffix = Path(str(attachment.get("storedPath") or attachment.get("name") or "")).suffix.lower()
    return suffix in {".bmp", ".gif", ".heic", ".heif", ".jpeg", ".jpg", ".png", ".webp"}


def _attachment_image_paths(payload: Dict[str, Any]) -> list[str]:
    attachments = payload.get("attachments")
    if not isinstance(attachments, list):
        return []
    paths: list[str] = []
    for item in attachments:
        if not isinstance(item, dict) or not _is_image_attachment(item):
            continue
        stored_path = str(item.get("storedPath") or "").strip()
        if stored_path:
            paths.append(stored_path)
    return paths


def _enrich_with_attached_images(user_text: str, image_paths: list[str]) -> str:
    try:
        from tools.vision_tools import vision_analyze_tool
    except Exception as exc:
        hints = "\n\n".join(
            f"[The user attached an image. It is available at: {path}]"
            for path in image_paths
        )
        return f"{hints}\n\n{user_text}".strip() if hints else user_text

    prompt = (
        "Describe everything visible in this image in thorough detail. "
        "Include any text, code, data, objects, people, layout, colors, "
        "and any other notable visual information."
    )
    parts: list[str] = []
    for raw_path in image_paths:
        path = Path(raw_path)
        if not path.exists() or not path.is_file():
            continue
        hint = f"[If needed, examine it again with vision_analyze using image_url: {path}]"
        try:
            with contextlib.redirect_stdout(sys.stderr):
                result_json = asyncio.run(
                    vision_analyze_tool(image_url=str(path), user_prompt=prompt)
                )
            result = json.loads(result_json)
            description = result.get("analysis", "") if result.get("success") else ""
            if description:
                parts.append(f"[The user attached an image:\n{description}]\n{hint}")
            else:
                parts.append(f"[The user attached an image but analysis failed.]\n{hint}")
        except Exception as exc:
            parts.append(f"[The user attached an image but analysis failed ({exc}).]\n{hint}")

    prefix = "\n\n".join(parts)
    if prefix:
        return f"{prefix}\n\n{user_text}".strip() if user_text else prefix
    return user_text


def _build_run_message(
    payload: Dict[str, Any],
    user_context: str,
    provider: str,
    model: str,
) -> Any:
    image_paths = _attachment_image_paths(payload)
    if not image_paths:
        return user_context

    try:
        from agent.image_routing import build_native_content_parts, decide_image_input_mode
        from hermes_cli.config import load_config

        mode = decide_image_input_mode(provider, model, load_config())
    except Exception as exc:
        _emit(
            {
                "type": "raw_log",
                "content": f"Image routing decision failed; using text fallback: {exc}",
                "metadata": {"folded": True},
            }
        )
        mode = "text"

    if mode == "native":
        try:
            parts, skipped = build_native_content_parts(user_context, image_paths)
            if skipped:
                _emit(
                    {
                        "type": "raw_log",
                        "content": f"Skipped {len(skipped)} unreadable attached image(s).",
                        "metadata": {"folded": True, "skippedImages": skipped},
                    }
                )
            if any(isinstance(part, dict) and part.get("type") == "image_url" for part in parts):
                _emit(
                    {
                        "type": "raw_log",
                        "content": f"Attached {len(image_paths) - len(skipped)} image(s) natively for the model.",
                        "metadata": {"folded": True, "imageInputMode": "native"},
                    }
                )
                return parts
        except Exception as exc:
            _emit(
                {
                    "type": "raw_log",
                    "content": f"Native image attachment failed; using text fallback: {exc}",
                    "metadata": {"folded": True},
                }
            )

    return _enrich_with_attached_images(user_context, image_paths)


def _goal_max_turns_from_config() -> int:
    try:
        from hermes_cli.config import DEFAULT_GOAL_MAX_TURNS, load_config, normalize_goal_max_turns

        cfg = load_config() or {}
        goals_cfg = cfg.get("goals") or {}
        return normalize_goal_max_turns(
            goals_cfg.get("max_turns"),
            DEFAULT_GOAL_MAX_TURNS,
        )
    except Exception:
        return 50


def _goal_text_from_payload(payload: Dict[str, Any], user_context: str) -> str:
    for key in ("goalText", "userInput"):
        text = str(payload.get(key) or "").strip()
        if text:
            return text
    return str(user_context or "").strip()


def _tool_name(name: Any) -> str:
    text = str(name or "").strip()
    return text or "tool"


def _compact_text(value: Any, limit: int = 2000) -> str:
    text = str(value or "").strip()
    if len(text) <= limit:
        return text
    return text[: limit - 3].rstrip() + "..."


def _merge_system_context(system_context: str, content: Any) -> str:
    text = str(content or "").strip()
    current = str(system_context or "").strip()
    if not text:
        return current
    if not current:
        return text
    if text == current:
        return current
    return f"{current}\n\n{text}"


def _context_messages_to_history(
    raw_context_messages: Any,
    system_context: str = "",
    user_context: str = "",
) -> tuple[str, str, list[Dict[str, Any]]]:
    context_messages = raw_context_messages if isinstance(raw_context_messages, list) else []
    conversation_history: list[Dict[str, Any]] = []
    if not context_messages:
        return system_context, user_context, conversation_history

    last_user_index = None
    for idx, message in enumerate(context_messages):
        if isinstance(message, dict) and message.get("role") == "user":
            last_user_index = idx
    if last_user_index is None:
        return system_context, user_context, conversation_history

    current_user = context_messages[last_user_index]
    user_context = str(current_user.get("content") or "")
    for idx, message in enumerate(context_messages):
        if not isinstance(message, dict):
            continue
        role = str(message.get("role") or "")
        content = message.get("content")
        if role == "system":
            system_context = _merge_system_context(system_context, content)
            continue
        if idx == last_user_index:
            continue
        if role == "developer":
            system_context = _merge_system_context(system_context, content)
            continue
        if role in {"user", "assistant", "tool"}:
            entry = {"role": role, "content": content if content is not None else ""}
            if role == "tool" and message.get("tool_call_id"):
                entry["tool_call_id"] = str(message.get("tool_call_id"))
            if message.get("name"):
                entry["name"] = str(message.get("name"))
            conversation_history.append(entry)

    return system_context, user_context, conversation_history


def _default_permissions_config() -> Dict[str, Any]:
    try:
        from hermes_cli.config import DEFAULT_CONFIG

        permissions = DEFAULT_CONFIG.get("permissions", {})
        return dict(permissions) if isinstance(permissions, dict) else {}
    except Exception:
        return {
            "mode": "ask",
            "runtime_approval_enabled": True,
            "approval_timeout_seconds": 300,
            "prefilter_user_input": True,
            "default_scope": "once",
            "allow_session_approval": True,
            "allow_always_approval": False,
            "hardline_policy": "deny",
            "cron_mode": "deny",
            "audit_log": True,
            "rules": {},
        }


def _deep_merge_dict(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    result = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _deep_merge_dict(result[key], value)
        else:
            result[key] = value
    return result


def _normalize_permission_mode(value: Any) -> str:
    mode = str(value or "").strip().lower()
    if mode in {"deny", "ask", "smart", "allow"}:
        return mode
    return "ask"


def _coerce_timeout_seconds(value: Any, default: int = 300) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return max(10, min(3600, parsed))


def _effective_permissions() -> Dict[str, Any]:
    policy = _default_permissions_config()
    try:
        from hermes_cli.config import load_config

        loaded = load_config().get("permissions", {})
        if isinstance(loaded, dict):
            policy = _deep_merge_dict(policy, loaded)
    except Exception:
        pass
    if isinstance(PERMISSIONS_CONFIG, dict):
        policy = _deep_merge_dict(policy, PERMISSIONS_CONFIG)
    if RUNTIME_APPROVAL_ENABLED is not None:
        policy["runtime_approval_enabled"] = bool(RUNTIME_APPROVAL_ENABLED)
    if APPROVAL_TIMEOUT_SECONDS is not None:
        policy["approval_timeout_seconds"] = _coerce_timeout_seconds(
            APPROVAL_TIMEOUT_SECONDS,
            _coerce_timeout_seconds(policy.get("approval_timeout_seconds"), 300),
        )
    policy["mode"] = _normalize_permission_mode(policy.get("mode"))
    policy["approval_timeout_seconds"] = _coerce_timeout_seconds(
        policy.get("approval_timeout_seconds"), 300
    )
    policy["runtime_approval_enabled"] = policy.get("runtime_approval_enabled") is not False
    policy["allow_session_approval"] = policy.get("allow_session_approval") is not False
    policy["allow_always_approval"] = policy.get("allow_always_approval") is True
    policy["hardline_policy"] = "deny"
    return policy


def _base_risk_event(
    event_type: str,
    command: str,
    reason: str,
    *,
    approval_id: str | None = None,
    decision: str | None = None,
    metadata: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    run_id = str(RUN_CONTEXT.get("runId") or os.getenv("REDOU_RUN_ID") or "")
    event: Dict[str, Any] = {
        "type": event_type,
        "taskId": str(RUN_CONTEXT.get("taskId") or os.getenv("REDOU_TASK_ID") or ""),
        "projectId": str(RUN_CONTEXT.get("projectId") or os.getenv("REDOU_PROJECT_ID") or ""),
        "runId": run_id,
        "command": command,
        "cwd": os.getcwd(),
        "reason": reason,
        "riskLevel": "high",
        "metadata": {
            "source": "runtime_command",
            "permissionMode": _effective_permissions().get("mode", "ask"),
            **(metadata or {}),
        },
    }
    if approval_id:
        event["approvalId"] = approval_id
    if decision:
        event["decision"] = decision
    return event


def _allowed_decisions(policy: Dict[str, Any]) -> list[str]:
    decisions = ["allow_once"]
    if policy.get("allow_session_approval") is not False:
        decisions.append("allow_session")
    if policy.get("allow_always_approval") is True:
        decisions.append("allow_always")
    decisions.append("deny")
    return decisions


def _emit_blocked(command: str, reason: str, mode: str) -> None:
    _emit(
        _base_risk_event(
            "high_risk_command_blocked",
            command,
            reason,
            metadata={"permissionMode": mode},
        )
    )


def _resolve_pending_approval(control: Dict[str, Any]) -> None:
    approval_id = str(control.get("approvalId") or "").strip()
    decision = str(control.get("decision") or "").strip()
    task_id = str(control.get("taskId") or "").strip()
    run_id = str(control.get("runId") or "").strip()

    def invalid(message: str, entry: Dict[str, Any] | None = None) -> None:
        command = str((entry or {}).get("command") or "")
        reason = str((entry or {}).get("reason") or message)
        _emit(
            _base_risk_event(
                "risk_approval_invalid",
                command,
                reason,
                approval_id=approval_id or None,
                decision=decision or None,
                metadata={"message": message},
            )
        )

    with PENDING_APPROVALS_LOCK:
        entry = PENDING_APPROVALS.get(approval_id)
        if not approval_id or entry is None:
            invalid("Approval request was not found.")
            return
        if entry.get("consumed"):
            invalid("Approval request was already resolved.", entry)
            return
        if task_id and task_id != entry.get("taskId"):
            invalid("Approval taskId did not match the pending request.", entry)
            return
        if run_id and run_id != entry.get("runId"):
            invalid("Approval runId did not match the pending request.", entry)
            return
        allowed = set(entry.get("allowedDecisions") or [])
        if decision not in allowed:
            invalid("Approval decision is not allowed for this request.", entry)
            return
        if decision == "allow_always" and not entry.get("policy", {}).get("allow_always_approval"):
            invalid("Permanent approval is disabled by policy.", entry)
            return
        entry["decision"] = decision
        entry["consumed"] = True
        event = entry.get("event")
    if event is not None:
        event.set()


def _clear_pending_approvals(reason: str = "run ended") -> None:
    with PENDING_APPROVALS_LOCK:
        entries = list(PENDING_APPROVALS.values())
        PENDING_APPROVALS.clear()
    for entry in entries:
        if entry.get("consumed"):
            continue
        entry["decision"] = "deny"
        entry["consumed"] = True
        event = entry.get("event")
        if event is not None:
            event.set()


def _approval_callback(command: str, description: str, **_kwargs: Any) -> str:
    policy = _effective_permissions()
    mode = _normalize_permission_mode(policy.get("mode"))
    reason = str(description or "high-risk command")

    if mode == "deny":
        _emit_blocked(command, reason, mode)
        return "deny"

    if mode == "allow":
        _emit(
            _base_risk_event(
                "high_risk_command_auto_allowed",
                command,
                reason,
                decision="auto_allow",
                metadata={"permissionMode": mode},
            )
        )
        return "once"

    if RISK_CONFIRMED:
        _emit(
            _base_risk_event(
                "risk_approval_allowed",
                command,
                reason,
                decision="pre_confirmed_once",
                metadata={"approvalGranted": True, "permissionMode": mode},
            )
        )
        return "once"

    if mode in {"ask", "smart"}:
        if policy.get("runtime_approval_enabled") is False:
            _emit_blocked(command, reason, mode)
            return "deny"

        approval_id = str(uuid.uuid4())
        timeout_seconds = _coerce_timeout_seconds(policy.get("approval_timeout_seconds"), 300)
        now_ms = int(time.time() * 1000)
        allowed = _allowed_decisions(policy)
        wait_event = threading.Event()
        run_id = str(RUN_CONTEXT.get("runId") or os.getenv("REDOU_RUN_ID") or "")
        entry = {
            "event": wait_event,
            "command": command,
            "reason": reason,
            "taskId": str(RUN_CONTEXT.get("taskId") or os.getenv("REDOU_TASK_ID") or ""),
            "projectId": str(RUN_CONTEXT.get("projectId") or os.getenv("REDOU_PROJECT_ID") or ""),
            "runId": run_id,
            "allowedDecisions": allowed,
            "policy": policy,
            "decision": None,
            "consumed": False,
        }
        with PENDING_APPROVALS_LOCK:
            PENDING_APPROVALS[approval_id] = entry

        request_event = _base_risk_event(
            "risk_approval_required",
            command,
            reason,
            approval_id=approval_id,
            metadata={"permissionMode": mode},
        )
        request_event.update(
            {
                "mode": mode,
                "allowedDecisions": allowed,
                "createdAt": now_ms,
                "expiresAt": now_ms + timeout_seconds * 1000,
            }
        )
        _emit(request_event)

        resolved = wait_event.wait(timeout=timeout_seconds)
        with PENDING_APPROVALS_LOCK:
            stored = PENDING_APPROVALS.pop(approval_id, entry)
        decision = str(stored.get("decision") or "")
        if not resolved or not decision:
            _emit(
                {
                    **_base_risk_event(
                        "risk_approval_timeout",
                        command,
                        reason,
                        approval_id=approval_id,
                        metadata={"permissionMode": mode},
                    ),
                    "timeoutSeconds": timeout_seconds,
                }
            )
            return "deny"

        if decision == "deny":
            _emit(
                _base_risk_event(
                    "risk_approval_denied",
                    command,
                    reason,
                    approval_id=approval_id,
                    decision="deny",
                    metadata={"permissionMode": mode},
                )
            )
            return "deny"
        if decision == "allow_session" and policy.get("allow_session_approval") is not False:
            _emit(
                _base_risk_event(
                    "risk_approval_allowed",
                    command,
                    reason,
                    approval_id=approval_id,
                    decision=decision,
                    metadata={"permissionMode": mode},
                )
            )
            return "session"
        if decision == "allow_always" and policy.get("allow_always_approval") is True:
            _emit(
                _base_risk_event(
                    "risk_approval_allowed",
                    command,
                    reason,
                    approval_id=approval_id,
                    decision=decision,
                    metadata={"permissionMode": mode},
                )
            )
            return "always"
        if decision == "allow_once":
            _emit(
                _base_risk_event(
                    "risk_approval_allowed",
                    command,
                    reason,
                    approval_id=approval_id,
                    decision=decision,
                    metadata={"permissionMode": mode},
                )
            )
            return "once"

    _emit_blocked(command, reason, mode)
    return "deny"


def _configure_approval_environment() -> None:
    # Redou uses a direct approval callback. The gateway HERMES_EXEC_ASK queue
    # requires a separate notify callback and would bypass the callback above.
    os.environ["HERMES_INTERACTIVE"] = "1"
    os.environ.pop("HERMES_EXEC_ASK", None)
    os.environ.pop("HERMES_GATEWAY_SESSION", None)
    os.environ.pop("HERMES_SESSION_PLATFORM", None)
    os.environ.pop("HERMES_YOLO_MODE", None)
    try:
        os.environ["REDOU_PERMISSIONS_JSON"] = json.dumps(_effective_permissions(), default=str)
    except Exception:
        os.environ.pop("REDOU_PERMISSIONS_JSON", None)


def _configure_permissions_from_payload(payload: Dict[str, Any]) -> None:
    global PERMISSIONS_CONFIG, RUNTIME_APPROVAL_ENABLED, APPROVAL_TIMEOUT_SECONDS, RUN_CONTEXT
    permissions = payload.get("permissions")
    PERMISSIONS_CONFIG = permissions if isinstance(permissions, dict) else {}
    RUNTIME_APPROVAL_ENABLED = (
        bool(payload.get("runtimeApprovalEnabled"))
        if "runtimeApprovalEnabled" in payload
        else None
    )
    APPROVAL_TIMEOUT_SECONDS = (
        _coerce_timeout_seconds(payload.get("approvalTimeoutSeconds"), 300)
        if payload.get("approvalTimeoutSeconds") is not None
        else None
    )
    RUN_CONTEXT = {
        "projectId": str(payload.get("projectId") or os.getenv("REDOU_PROJECT_ID") or ""),
        "taskId": str(payload.get("taskId") or os.getenv("REDOU_TASK_ID") or ""),
        "runId": str(payload.get("runId") or os.getenv("REDOU_RUN_ID") or ""),
    }


def main() -> int:
    global RISK_CONFIRMED
    turn_started_at = _utc_iso()
    turn_started_monotonic = time.monotonic()
    first_line = sys.stdin.readline()
    payload = json.loads(first_line or "{}")
    RISK_CONFIRMED = payload.get("riskConfirmed") is True
    root = _project_root()
    sys.path.insert(0, str(root))
    _configure_permissions_from_payload(payload)
    _configure_approval_environment()
    workspace = str(payload.get("workspacePath") or root)

    try:
        os.chdir(workspace)
    except OSError:
        os.chdir(root)

    try:
        from run_agent import AIAgent
        from hermes_cli.redou_runtime import redou_disabled_tools, redou_disabled_toolsets
        from tools.terminal_tool import set_approval_callback
    except Exception as exc:
        _emit(
            {
                "type": "error",
                "message": "Hermes runtime could not be imported.",
                "details": "".join(traceback.format_exception_only(type(exc), exc)).strip(),
            }
        )
        _emit({"type": "done"})
        return 1

    set_approval_callback(_approval_callback)

    system_context = str(payload.get("systemContext") or "")
    user_context = str(payload.get("userContext") or "")
    run_mode = str(payload.get("runMode") or "execute").strip().lower()
    if run_mode == "plan":
        system_context = _merge_system_context(system_context, PLAN_MODE_SYSTEM_CONTEXT)
    system_context, user_context, conversation_history = _context_messages_to_history(
        payload.get("contextMessages"),
        system_context,
        user_context,
    )
    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    try:
        from tools.mcp_tool import discover_mcp_tools

        with contextlib.redirect_stdout(sys.stderr):
            mcp_tool_names = discover_mcp_tools()
        if mcp_tool_names:
            _emit(
                {
                    "type": "raw_log",
                    "content": f"MCP tools ready: {len(mcp_tool_names)} tool(s).",
                    "metadata": {
                        "folded": True,
                        "mcpToolCount": len(mcp_tool_names),
                        "mcpTools": sorted(mcp_tool_names)[:20],
                        **metadata,
                    },
                }
            )
    except Exception as exc:
        _emit(
            {
                "type": "raw_log",
                "content": f"MCP discovery skipped: {exc}",
                "metadata": {"folded": True, "mcpDiscoveryFailed": True, **metadata},
            }
        )
    session_id = str(payload.get("hermesSessionId") or "").strip() or None
    model = str(payload.get("model") or "")
    provider = str(payload.get("provider") or "")
    max_iterations = normalize_max_turns(
        payload.get("maxIterations"),
        configured_agent_max_turns(),
    )
    direct_api_key = str(payload.get("apiKey") or payload.get("api_key") or "").strip() or None
    direct_base_url = str(payload.get("baseUrl") or payload.get("base_url") or "").strip() or None
    direct_api_mode = str(payload.get("apiMode") or payload.get("api_mode") or "").strip() or None
    api_key = direct_api_key
    base_url = direct_base_url
    api_mode = direct_api_mode
    credential_pool = None
    session_db = None
    agent_holder: Dict[str, Any] = {}
    pending_steers: list[str] = []
    pending_lock = threading.Lock()
    goal_lock = threading.RLock()
    goal_state: Dict[str, Any] = {"enabled": False, "manager": None}
    goal_max_turns = _goal_max_turns_from_config()

    def current_goal_session_id() -> str:
        agent = agent_holder.get("agent")
        return str(getattr(agent, "session_id", None) or session_id or "").strip()

    def get_goal_manager() -> Any:
        sid = current_goal_session_id()
        if not sid:
            return None
        with goal_lock:
            existing = goal_state.get("manager")
            if existing is not None and getattr(existing, "session_id", None) == sid:
                return existing
            try:
                from hermes_cli.goals import GoalManager
            except Exception as exc:
                _emit(
                    {
                        "type": "raw_log",
                        "content": f"Hermes goal mode unavailable: {exc}",
                        "metadata": {"folded": True, "goalMode": True, **metadata},
                    }
                )
                return None
            manager = GoalManager(session_id=sid, default_max_turns=goal_max_turns)
            goal_state["manager"] = manager
            return manager

    def activate_goal_mode(goal_text: str, source: str) -> bool:
        text = str(goal_text or "").strip()
        if not text:
            _emit(
                {
                    "type": "raw_log",
                    "content": "Hermes goal mode was requested, but no goal text was available.",
                    "metadata": {"folded": True, "goalMode": True, "goalSource": source, **metadata},
                }
            )
            return False
        manager = get_goal_manager()
        if manager is None:
            return False
        try:
            state = manager.set(text)
        except Exception as exc:
            _emit(
                {
                    "type": "raw_log",
                    "content": f"Hermes goal mode could not be activated: {exc}",
                    "metadata": {"folded": True, "goalMode": True, "goalSource": source, **metadata},
                }
            )
            return False
        with goal_lock:
            goal_state["enabled"] = True
        _emit(
            {
                "type": "raw_log",
                "content": f"Hermes goal mode enabled ({state.max_turns}-turn budget).",
                "metadata": {
                    "folded": True,
                    "goalMode": True,
                    "goalSource": source,
                    "goalMaxTurns": state.max_turns,
                    "goalPreview": _compact_text(text, 240),
                    **metadata,
                },
            }
        )
        return True

    def redou_goal_loop_enabled() -> bool:
        with goal_lock:
            return bool(goal_state.get("enabled"))

    def control_loop() -> None:
        for raw_line in sys.stdin:
            line = raw_line.strip()
            if not line:
                continue
            try:
                command = json.loads(line)
            except Exception:
                _emit(
                    {
                        "type": "raw_log",
                        "content": "Ignored malformed Redou control message.",
                        "metadata": {"folded": True, **metadata},
                    }
                )
                continue
            if not isinstance(command, dict):
                continue
            if command.get("type") == "risk_approval_decision":
                _resolve_pending_approval(command)
                continue
            if command.get("type") != "steer":
                continue
            text = str(command.get("text") or "").strip()
            if not text:
                continue
            if command.get("goalMode") is True:
                activate_goal_mode(text, "guide")
            with pending_lock:
                agent = agent_holder.get("agent")
                if agent is None:
                    pending_steers.append(text)
                    accepted = True
                else:
                    accepted = bool(agent.steer(text))
            _emit(
                {
                    "type": "raw_log",
                    "content": "User guidance accepted for the active run."
                    if accepted
                    else "User guidance was empty and was ignored.",
                    "metadata": {
                        "folded": True,
                        "guided": accepted,
                        "guideId": command.get("guideId"),
                        **metadata,
                    },
                }
            )

    if provider in {"minimax", "minimax-cn"} and not model:
        model = os.getenv("MINIMAX_MODEL", "MiniMax-M2.7").strip() or "MiniMax-M2.7"

    if provider:
        try:
            from hermes_cli.runtime_provider import resolve_runtime_provider

            runtime = resolve_runtime_provider(
                requested=provider,
                explicit_api_key=direct_api_key,
                explicit_base_url=direct_base_url,
                target_model=model or None,
            )
            provider = str(runtime.get("provider") or provider)
            api_key = direct_api_key or str(runtime.get("api_key") or "") or None
            base_url = direct_base_url or str(runtime.get("base_url") or "") or None
            api_mode = direct_api_mode or str(runtime.get("api_mode") or "") or None
            credential_pool = runtime.get("credential_pool")
            if direct_api_key or direct_base_url:
                credential_pool = None
            _emit(
                {
                    "type": "raw_log",
                    "content": f"Resolved provider {provider} using {api_mode or 'default'} at {base_url or 'default endpoint'}.",
                    "metadata": {"folded": True, **metadata},
                }
            )
        except Exception as exc:
            _emit(
                {
                    "type": "raw_log",
                    "content": f"Provider runtime resolution fell back to direct settings: {exc}",
                    "metadata": {"folded": True, **metadata},
                }
            )

    streamed_response_parts: list[str] = []

    def stream_delta(delta: str) -> None:
        if delta:
            streamed_response_parts.append(delta)
            _emit({"type": "assistant_delta", "content": delta, "metadata": metadata})

    def status_update(kind: str, value: Any = None) -> None:
        if str(kind or "") != "run_stage":
            return
        event = _run_stage_object(value)
        if event is None:
            return
        event.setdefault("taskId", str(payload.get("taskId") or ""))
        if os.getenv("REDOU_RUN_ID"):
            event.setdefault("runId", os.getenv("REDOU_RUN_ID"))
        if payload.get("projectId"):
            event.setdefault("projectId", str(payload.get("projectId")))
        if metadata.get("currentTurnId"):
            event.setdefault("turnId", str(metadata.get("currentTurnId")))
        event["metadata"] = {
            **metadata,
            **(event.get("metadata") if isinstance(event.get("metadata"), dict) else {}),
        }
        _emit(event)

    def tool_started(tool_call_id: str, name: str, args: Any) -> None:
        _emit(
            {
                "type": "tool_start",
                "name": _tool_name(name),
                "input": _safe_json(args),
                "metadata": {"toolCallId": tool_call_id, **metadata},
            }
        )

    def tool_completed(tool_call_id: str, name: str, args: Any, result: Any) -> None:
        _emit(
            {
                "type": "tool_output",
                "name": _tool_name(name),
                "output": _safe_json(result),
                "metadata": {"toolCallId": tool_call_id, "input": _safe_json(args), **metadata},
            }
        )
        _emit(
            {
                "type": "tool_end",
                "name": _tool_name(name),
                "success": True,
                "metadata": {"toolCallId": tool_call_id, **metadata},
            }
        )

    last_reasoning_preview = ""

    def tool_progress(event_type: str, name: Any = None, preview: Any = None, args: Any = None, **kwargs: Any) -> None:
        nonlocal last_reasoning_preview
        if event_type in {"_thinking", "reasoning.available"} or _tool_name(name) == "_thinking":
            text = preview if preview is not None else name if event_type == "_thinking" else ""
            if text:
                last_reasoning_preview = _compact_text(text)
            return
        if event_type == "tool.started":
            _emit(
                {
                    "type": "tool_start",
                    "name": _tool_name(name),
                    "input": _safe_json(args),
                    "metadata": {"preview": str(preview or ""), **metadata},
                }
            )
            return
        if preview:
            _emit(
                {
                    "type": "tool_output",
                    "name": _tool_name(name),
                    "output": str(preview),
                    "metadata": {"eventType": event_type, **metadata, **kwargs},
                }
            )

    try:
        from hermes_state import SessionDB

        session_db = SessionDB()
    except Exception as exc:
        _emit(
            {
                "type": "raw_log",
                "content": f"Session usage persistence is unavailable; analytics will use Redou logs for this run: {exc}",
                "metadata": {"folded": True, **metadata},
            }
        )

    def close_session_db() -> None:
        if session_db is None:
            return
        try:
            session_db.close()
        except Exception:
            pass

    try:
        agent = AIAgent(
            api_key=api_key,
            base_url=base_url,
            provider=provider or None,
            api_mode=api_mode,
            model=model,
            max_iterations=max_iterations,
            quiet_mode=True,
            disabled_toolsets=redou_disabled_toolsets(),
            disabled_tools=redou_disabled_tools(),
            skip_context_files=True,
            skip_memory=True,
            credential_pool=credential_pool,
            ephemeral_system_prompt=system_context,
            platform="redou",
            session_id=session_id,
            session_db=session_db,
            tool_progress_callback=tool_progress,
            tool_start_callback=tool_started,
            tool_complete_callback=tool_completed,
            status_callback=status_update,
            pass_session_id=True,
        )
        with pending_lock:
            agent_holder["agent"] = agent
            early_steers = list(pending_steers)
            pending_steers.clear()
        for steer_text in early_steers:
            agent.steer(steer_text)
        threading.Thread(target=control_loop, daemon=True).start()
        if payload.get("goalMode") is True and run_mode == "execute":
            activate_goal_mode(_goal_text_from_payload(payload, user_context), "initial")

        def run_agent_turn(turn_message: Any, turn_history: Any, persist_override: Any = None) -> Dict[str, Any]:
            nonlocal last_reasoning_preview
            turn_local_started_at = _utc_iso()
            turn_local_started_monotonic = time.monotonic()
            streamed_response_parts.clear()
            last_reasoning_preview = ""
            with contextlib.redirect_stdout(sys.stderr):
                turn_result = agent.run_conversation(
                    turn_message,
                    conversation_history=turn_history or None,
                    stream_callback=stream_delta,
                    persist_user_message=persist_override,
                )
            turn_final_response = _strip_run_stage_json_lines(
                str((turn_result or {}).get("final_response") or "").strip()
            )
            turn_streamed_response = _strip_run_stage_json_lines(
                "".join(streamed_response_parts).strip()
            )
            if not turn_final_response and turn_streamed_response:
                turn_final_response = turn_streamed_response
            if not turn_final_response and last_reasoning_preview:
                turn_final_response = last_reasoning_preview
            turn_failed = bool((turn_result or {}).get("failed") or (turn_result or {}).get("error"))
            turn_stream_recovery_interrupted = _stream_recovery_interrupted(turn_final_response)
            turn_interrupted = bool((turn_result or {}).get("interrupted") or turn_stream_recovery_interrupted)
            turn_partial = bool((turn_result or {}).get("partial") or turn_stream_recovery_interrupted)
            turn_completed_raw = (turn_result or {}).get("completed")
            turn_exit_reason = str((turn_result or {}).get("turn_exit_reason") or "")
            if turn_stream_recovery_interrupted and not turn_exit_reason:
                turn_exit_reason = "stream_recovery_interrupted"
            turn_done_completed = turn_completed_raw
            if (
                turn_completed_raw is False
                and turn_final_response
                and not turn_failed
                and not turn_interrupted
                and not turn_partial
                and "max_iterations" not in turn_exit_reason
            ):
                turn_done_completed = True
            if turn_failed or turn_interrupted or turn_partial:
                turn_done_completed = False
            return {
                "result": turn_result,
                "final_response": turn_final_response,
                "result_failed": turn_failed,
                "result_interrupted": turn_interrupted,
                "result_partial": turn_partial,
                "result_completed": turn_completed_raw,
                "done_completed": turn_done_completed,
                "turn_exit_reason": turn_exit_reason,
                "timing": _turn_timing_metadata(turn_local_started_at, turn_local_started_monotonic),
            }

        run_message = _build_run_message(payload, user_context, provider, model)
        run_history = conversation_history or None
        persist_override = user_context if not isinstance(run_message, str) else None
        last_turn: Dict[str, Any] | None = None
        goal_decision: Dict[str, Any] | None = None

        while True:
            last_turn = run_agent_turn(run_message, run_history, persist_override)
            result = last_turn["result"] or {}
            final_response = str(last_turn["final_response"] or "")
            if final_response:
                _emit(
                    {
                        "type": "assistant_message",
                        "content": final_response,
                        "metadata": {
                            **metadata,
                            **last_turn["timing"],
                            "hermesSessionId": getattr(agent, "session_id", session_id),
                            "apiCalls": result.get("api_calls"),
                            "inputTokens": result.get("input_tokens"),
                            "outputTokens": result.get("output_tokens"),
                            "cacheReadTokens": result.get("cache_read_tokens"),
                            "cacheWriteTokens": result.get("cache_write_tokens"),
                            "reasoningTokens": result.get("reasoning_tokens"),
                            "estimatedCostUsd": result.get("estimated_cost_usd"),
                            "costStatus": result.get("cost_status"),
                            "costSource": result.get("cost_source"),
                            "goalMode": redou_goal_loop_enabled(),
                        },
                    }
                )
            elif result.get("failed") or result.get("error"):
                _emit(
                    {
                        "type": "run_stage",
                        "stage": "failed",
                        "label": "失败",
                        "status": "failed",
                        "source": "hermes",
                        "timestamp": _utc_iso(),
                        "details": _compact_text(result.get("error") or "Hermes runtime failed."),
                        "metadata": metadata,
                    }
                )
                _emit(
                    {
                        "type": "error",
                        "message": _compact_text(result.get("error") or "Hermes runtime failed."),
                        "metadata": {
                            **metadata,
                            "hermesSessionId": getattr(agent, "session_id", session_id),
                            "apiCalls": result.get("api_calls"),
                            "provider": provider,
                            "model": model,
                        },
                    }
                )

            run_history = result.get("messages") or run_history
            if (
                not redou_goal_loop_enabled()
                or run_mode == "plan"
                or last_turn["result_failed"]
                or last_turn["result_interrupted"]
                or last_turn["result_partial"]
                or not final_response.strip()
            ):
                break

            manager = get_goal_manager()
            if manager is None or not manager.is_active():
                break
            try:
                goal_decision = manager.evaluate_after_turn(
                    final_response,
                    user_initiated=True,
                    messages=run_history or [],
                )
            except Exception as exc:
                _emit(
                    {
                        "type": "raw_log",
                        "content": f"Hermes goal evaluation failed: {exc}",
                        "metadata": {"folded": True, "goalMode": True, **metadata},
                    }
                )
                break
            goal_message = str(goal_decision.get("message") or "")
            if goal_message:
                _emit(
                    {
                        "type": "raw_log",
                        "content": goal_message,
                        "metadata": {
                            "folded": True,
                            "goalMode": True,
                            "goalVerdict": goal_decision.get("verdict"),
                            "goalStatus": goal_decision.get("status"),
                            **metadata,
                        },
                    }
                )
            if not goal_decision.get("should_continue"):
                break
            continuation_prompt = str(goal_decision.get("continuation_prompt") or "")
            if not continuation_prompt:
                break
            run_message = continuation_prompt
            persist_override = None

        result = (last_turn or {}).get("result") or {}
        done_completed = (last_turn or {}).get("done_completed")
        result_completed = (last_turn or {}).get("result_completed")
        result_failed = bool((last_turn or {}).get("result_failed"))
        result_partial = bool((last_turn or {}).get("result_partial"))
        result_interrupted = bool((last_turn or {}).get("result_interrupted"))
        turn_exit_reason = str((last_turn or {}).get("turn_exit_reason") or "")
        _emit(
            {
                "type": "done",
                "metadata": {
                    **metadata,
                    **_turn_timing_metadata(turn_started_at, turn_started_monotonic),
                    "hermesSessionId": getattr(agent, "session_id", session_id),
                    "completed": done_completed,
                    "rawCompleted": result_completed,
                    "failed": result_failed,
                    "partial": result_partial,
                    "interrupted": result_interrupted,
                    "turnExitReason": turn_exit_reason,
                    "error": (result or {}).get("error"),
                    "apiCalls": (result or {}).get("api_calls"),
                    "inputTokens": (result or {}).get("input_tokens"),
                    "outputTokens": (result or {}).get("output_tokens"),
                    "cacheReadTokens": (result or {}).get("cache_read_tokens"),
                    "cacheWriteTokens": (result or {}).get("cache_write_tokens"),
                    "reasoningTokens": (result or {}).get("reasoning_tokens"),
                    "estimatedCostUsd": (result or {}).get("estimated_cost_usd"),
                    "costStatus": (result or {}).get("cost_status"),
                    "costSource": (result or {}).get("cost_source"),
                    "goalMode": redou_goal_loop_enabled(),
                    **(
                        {
                            "goalVerdict": goal_decision.get("verdict"),
                            "goalStatus": goal_decision.get("status"),
                            "goalReason": goal_decision.get("reason"),
                        }
                        if goal_decision
                        else {}
                    ),
                    **(
                        {"pendingSteer": (result or {}).get("pending_steer")}
                        if (result or {}).get("pending_steer")
                        else {}
                    ),
                },
            }
        )
        _clear_pending_approvals()
        close_session_db()
        return 0
    except Exception as exc:
        _emit(
            {
                "type": "run_stage",
                "stage": "failed",
                "label": "失败",
                "status": "failed",
                "source": "hermes",
                "timestamp": _utc_iso(),
                "details": str(exc),
                "metadata": metadata,
            }
        )
        _emit(
            {
                "type": "error",
                "message": str(exc),
                "details": "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))[-4000:],
                "metadata": metadata,
            }
        )
        _emit(
            {
                "type": "done",
                "metadata": {
                    **metadata,
                    **_turn_timing_metadata(turn_started_at, turn_started_monotonic),
                    "completed": False,
                    "failed": True,
                    "error": str(exc),
                    "exitCode": 1,
                    "turnExitReason": "adapter_exception",
                },
            }
        )
        _clear_pending_approvals()
        close_session_db()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
