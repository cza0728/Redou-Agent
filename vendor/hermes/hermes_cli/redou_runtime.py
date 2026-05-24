"""Shared Redou runtime guardrails.

Redou Task Chat has its own project/task context system.  These helpers keep
all Redou entry points aligned so Hermes runtime features that cross task
boundaries are not exposed accidentally.
"""

from __future__ import annotations

import os
from collections.abc import Iterable, Mapping


REDOU_DISABLED_TOOLSETS: tuple[str, ...] = (
    "memory",
    "session_search",
    "tts",
)

REDOU_DISABLED_TOOLS: tuple[str, ...] = (
    "skill_manage",
    "text_to_speech",
)

REDOU_PROJECT_ID_ENV = "REDOU_PROJECT_ID"
REDOU_TASK_ID_ENV = "REDOU_TASK_ID"


def is_redou_task_runtime(env: Mapping[str, str] | None = None) -> bool:
    """Return True when the current process is running for a Redou Task."""

    source = env if env is not None else os.environ
    project_id = str(source.get(REDOU_PROJECT_ID_ENV) or "").strip()
    task_id = str(source.get(REDOU_TASK_ID_ENV) or "").strip()
    return bool(project_id and task_id)


def redou_disabled_toolsets(existing: Iterable[str] | None = None) -> list[str]:
    """Merge Redou-forced disabled toolsets with an optional caller list."""

    merged: list[str] = []
    prefix = [existing] if isinstance(existing, str) else list(existing or ())
    for name in [*prefix, *REDOU_DISABLED_TOOLSETS]:
        clean = str(name or "").strip()
        if clean and clean not in merged:
            merged.append(clean)
    return merged


def redou_disabled_tools(existing: Iterable[str] | None = None) -> list[str]:
    """Merge Redou-forced disabled tool names with an optional caller list."""

    merged: list[str] = []
    prefix = [existing] if isinstance(existing, str) else list(existing or ())
    for name in [*prefix, *REDOU_DISABLED_TOOLS]:
        clean = str(name or "").strip()
        if clean and clean not in merged:
            merged.append(clean)
    return merged
