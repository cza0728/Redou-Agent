"""Shared busy-input policy for CLI, TUI, gateway, and Redou wrappers.

A message typed while an agent is already running can be routed three ways:
- ``queue``: save it for the next turn without touching the active run;
- ``steer``: inject it into the active run through the explicit /steer path;
- ``interrupt``: cancel/redirect the active run.

The safe default is ``queue``.  It prevents accidental loss of in-flight work
and matches Redou's task-chat contract where guide/steer must be explicit.
"""

from __future__ import annotations

from typing import Final

BUSY_INPUT_QUEUE: Final[str] = "queue"
BUSY_INPUT_STEER: Final[str] = "steer"
BUSY_INPUT_INTERRUPT: Final[str] = "interrupt"
BUSY_INPUT_MODES: Final[frozenset[str]] = frozenset(
    {BUSY_INPUT_QUEUE, BUSY_INPUT_STEER, BUSY_INPUT_INTERRUPT}
)
DEFAULT_BUSY_INPUT_MODE: Final[str] = BUSY_INPUT_QUEUE


def normalize_busy_input_mode(value: object, default: str = DEFAULT_BUSY_INPUT_MODE) -> str:
    """Return a supported busy-input mode.

    Unknown values intentionally fall back to ``queue`` unless a caller passes a
    different explicit default.  Keeping this in one module avoids the previous
    split-brain behavior where CLI, gateway, and TUI each had their own fallback.
    """

    fallback = str(default or DEFAULT_BUSY_INPUT_MODE).strip().lower()
    if fallback not in BUSY_INPUT_MODES:
        fallback = DEFAULT_BUSY_INPUT_MODE
    mode = str(value or "").strip().lower()
    return mode if mode in BUSY_INPUT_MODES else fallback


__all__ = [
    "BUSY_INPUT_INTERRUPT",
    "BUSY_INPUT_MODES",
    "BUSY_INPUT_QUEUE",
    "BUSY_INPUT_STEER",
    "DEFAULT_BUSY_INPUT_MODE",
    "normalize_busy_input_mode",
]
