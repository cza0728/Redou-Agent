"""JSON bridge for Hermes ``skill_manage``.

Redou desktop uses this bridge only for explicit user actions from the Skills
page.  The logic remains inside the Hermes fork so skill mutation is not
implemented twice in desktop JavaScript.
"""
from __future__ import annotations

import json
import os
import sys
import traceback
from pathlib import Path
from typing import Any


def _ensure_vendor_on_path() -> None:
    root = Path(os.environ.get("HERMES_VENDOR_ROOT") or os.environ.get("HERMES_PYTHON_SRC_ROOT") or Path(__file__).resolve().parents[1]).resolve()
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))


def _read_payload() -> dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    parsed = json.loads(raw)
    return parsed if isinstance(parsed, dict) else {}


def main() -> int:
    try:
        _ensure_vendor_on_path()
        payload = _read_payload()
        action = str(payload.pop("action", "")).strip()
        if not action:
            raise ValueError("skill_manage action is required")
        from tools.skill_manager_tool import skill_manage

        raw_result = skill_manage(action=action, **payload)
        try:
            result = json.loads(raw_result)
        except Exception:
            result = {"success": False, "error": str(raw_result)}
        print(json.dumps({"ok": True, "result": result}, ensure_ascii=False))
        return 0
    except Exception as exc:  # pragma: no cover - process boundary
        print(json.dumps({
            "ok": False,
            "error": str(exc),
            "details": "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))[-4000:],
        }, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
