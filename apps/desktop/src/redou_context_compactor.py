"""One-shot Redou TASK_CONTEXT compactor.

The Electron Main Process invokes this helper only when a Redou Context Pack is
near the active model's input budget.  It returns a small JSON envelope on
stdout so the Main Process can update PROJECT_RULES.md, TASK_RULES.md, and
TASK_CONTEXT.md atomically from its side of the IPC boundary.
"""

from __future__ import annotations

import contextlib
import json
import os
import re
import sys
import traceback
from pathlib import Path

# Source checkout layout: apps/desktop/src -> repo root -> vendor/hermes.
_REDOU_PROJECT_ROOT = Path(os.environ.get("REDOU_PROJECT_ROOT", Path(__file__).resolve().parents[3]))
_HERMES_VENDOR_ROOT = Path(os.environ.get("HERMES_VENDOR_ROOT", _REDOU_PROJECT_ROOT / "vendor" / "hermes"))
if _HERMES_VENDOR_ROOT.is_dir():
    value = str(_HERMES_VENDOR_ROOT)
    if value not in sys.path:
        sys.path.insert(0, value)
from typing import Any, Dict


PROJECT_ROOT = _REDOU_PROJECT_ROOT
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


COMPACT_SYSTEM_PROMPT = """You are Redou's context compactor. You are not answering the user's task.

Your job is to compress Redou task context.

Goals:
1. Preserve information still useful for the current task.
2. Remove duplicated, outdated, irrelevant, or chatty content.
3. Rewrite TASK_CONTEXT.md into the fixed structure.
4. Extract long-term project rules for PROJECT_RULES.md.
5. Extract current task rules for TASK_RULES.md.
6. Do not fabricate files, commands, test results, experiment metrics, citations, or user intent.

Classification rules:
- PROJECT_RULES: only long-term rules useful across this project, especially rules explicitly marked by the user as default, future, always, never, or project-wide.
- TASK_RULES: only current-task goals, constraints, validation criteria, and output requirements.
- TASK_CONTEXT: current state, confirmed decisions, progress, evidence, artifacts, todo list, and open issues.

Hard rules:
1. If long-term validity is unclear, do not add to PROJECT_RULES.
2. If a rule is only temporary for this task, put it in TASK_RULES or TASK_CONTEXT.
3. If information is uncertain, put it in Open Issues.
4. Preserve file paths and commands exactly.
5. Do not mark tests or experiments as successful unless explicit success evidence exists.
6. Remove old mistakes that were later corrected.
7. Keep the compressed context concise but sufficient.

Return only valid JSON:

{
  "project_rules_to_add": [
    "..."
  ],
  "task_rules_to_add": [
    "..."
  ],
  "compressed_task_context": "# Task Context\\n\\n## A. Structured State\\n\\n### Current Brief\\n...\\n\\n### Active Constraints\\n...\\n\\n### Todo List\\n...\\n\\n### Progress Summary\\n...\\n\\n### Evidence and Artifacts\\n...\\n\\n### Open Issues\\n...\\n\\n---\\n\\n## B. Raw Turn Log\\n"
}
"""


TASK_CONTEXT_REQUIRED = (
    "# Task Context",
    "## A. Structured State",
    "### Current Brief",
    "### Active Constraints",
    "### Todo List",
    "### Progress Summary",
    "### Evidence and Artifacts",
    "### Open Issues",
    "## B. Raw Turn Log",
)


def _emit(value: Dict[str, Any]) -> int:
    sys.stdout.write(json.dumps(value, ensure_ascii=False))
    sys.stdout.flush()
    return 0 if value.get("ok") else 1


def _compact_input(payload: Dict[str, Any]) -> str:
    budget = payload.get("budget") if isinstance(payload.get("budget"), dict) else {}
    return "\n\n".join(
        [
            "# Compact Input",
            f"Compact reason: {payload.get('compactReason') or 'force'}",
            f"Model context tokens: {budget.get('modelContextTokens') or ''}",
            f"Input budget: {budget.get('inputBudget') or ''}",
            "## Current PROJECT_RULES.md",
            str(payload.get("projectRules") or ""),
            "## Current TASK_RULES.md",
            str(payload.get("taskRules") or ""),
            "## Current TASK_CONTEXT.md",
            str(payload.get("taskContext") or ""),
            "## Recent Messages",
            str(payload.get("recentMessages") or ""),
            "## Current Attachments",
            str(payload.get("attachments") or ""),
            "## Current User Request Summary",
            str(payload.get("currentUserRequest") or ""),
        ]
    )


def _extract_json(text: str) -> Dict[str, Any]:
    raw = str(text or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.IGNORECASE)
        raw = re.sub(r"\s*```$", "", raw)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        start = raw.find("{")
        end = raw.rfind("}")
        if start >= 0 and end > start:
            return json.loads(raw[start : end + 1])
        raise


def _validate_result(value: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("compact result is not an object")
    compressed = str(value.get("compressed_task_context") or "")
    missing = [marker for marker in TASK_CONTEXT_REQUIRED if marker not in compressed]
    if missing:
        raise ValueError(f"compressed_task_context missing required marker: {missing[0]}")
    return {
        "project_rules_to_add": [
            str(item).strip()
            for item in value.get("project_rules_to_add", [])
            if str(item).strip()
        ],
        "task_rules_to_add": [
            str(item).strip()
            for item in value.get("task_rules_to_add", [])
            if str(item).strip()
        ],
        "compressed_task_context": compressed.rstrip() + "\n",
    }


def _run_agent(prompt: str, provider: str, model: str) -> str:
    from run_agent import AIAgent
    from hermes_cli.redou_runtime import redou_disabled_tools, redou_disabled_toolsets

    api_key = None
    base_url = None
    api_mode = None
    credential_pool = None
    if provider:
        try:
            from hermes_cli.runtime_provider import resolve_runtime_provider

            runtime = resolve_runtime_provider(
                requested=provider,
                explicit_api_key=None,
                explicit_base_url=None,
                target_model=model or None,
            )
            provider = str(runtime.get("provider") or provider)
            api_key = str(runtime.get("api_key") or "") or None
            base_url = str(runtime.get("base_url") or "") or None
            api_mode = str(runtime.get("api_mode") or "") or None
            credential_pool = runtime.get("credential_pool")
        except Exception:
            pass

    agent = AIAgent(
        api_key=api_key,
        base_url=base_url,
        provider=provider or None,
        api_mode=api_mode,
        model=model,
        max_iterations=3,
        quiet_mode=True,
        disabled_toolsets=redou_disabled_toolsets(["skills"]),
        disabled_tools=redou_disabled_tools(),
        skip_context_files=True,
        skip_memory=True,
        credential_pool=credential_pool,
        ephemeral_system_prompt=COMPACT_SYSTEM_PROMPT,
        platform="redou",
    )
    with contextlib.redirect_stdout(sys.stderr):
        result = agent.run_conversation(prompt)
    return str((result or {}).get("final_response") or "").strip()


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        if not isinstance(payload, dict):
            raise ValueError("payload must be a JSON object")
        provider = str(payload.get("provider") or "")
        model = str(payload.get("model") or "")
        prompt = _compact_input(payload)
        first = _run_agent(prompt, provider, model)
        try:
            result = _validate_result(_extract_json(first))
        except Exception as first_error:
            repair_prompt = (
                "Repair the following invalid compact response into valid JSON only. "
                "Do not add new facts. Preserve the same schema.\n\n"
                f"Invalid response:\n{first}\n\n"
                f"Parse/validation error:\n{first_error}"
            )
            repaired = _run_agent(repair_prompt, provider, model)
            result = _validate_result(_extract_json(repaired))
        return _emit({"ok": True, "result": result})
    except Exception as exc:
        details = "".join(traceback.format_exception_only(type(exc), exc)).strip()
        return _emit({"ok": False, "error": details})


if __name__ == "__main__":
    raise SystemExit(main())
