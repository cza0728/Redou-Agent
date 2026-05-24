# Redou Agent Refactor Summary — 2026-05-16

## What changed

This refactor focuses on preventing prompt/context drift and patch regression as the project grows.

### 1. Unified busy-input policy

Added `hermes_cli/busy_input.py` as the shared source of truth for busy-input modes:

- `queue` is the default safe behavior.
- `steer` remains available for explicit guidance into the active run.
- `interrupt` remains available for explicit interruption/replacement behavior.

CLI, gateway, and TUI now use the same normalizer instead of maintaining separate fallback logic.

### 2. Redou context contract hardening

`hermes_cli/redou_context.py` now builds structured context messages and validates the prompt boundary:

- The current user request appears exactly once.
- The current user request is the final `user` message.
- Queued future messages are excluded until their own turn is consumed.
- Guide/control events are excluded from ordinary conversation history.
- Raw command/tool/event logs are summarized instead of replayed.
- Secret-like values are redacted before entering prompts or raw task logs.

This mirrors the Desktop-side context contract and reduces the chance that a model replies to a previous request.

### 3. Cleaner export path

Added clean export scripts:

- `scripts/export-clean.py`
- `scripts/export-clean.ps1`

They exclude common drift sources such as `.git`, `node_modules`, `__pycache__`, `.pytest_cache`, logs, `.env`, `.lnk`, and build/cache debris. Use `--include-generated` when you need a runnable snapshot with generated bundles.

### 4. Regression coverage

Added/updated tests around:

- queue/steer/interrupt default behavior;
- Redou context filtering of queued inputs, guide events, raw events;
- secret redaction in prompt text and raw task log;
- TUI/gateway busy input fallback consistency.

## Verification performed in this environment

```text
python -m py_compile hermes_cli/busy_input.py hermes_cli/redou_context.py cli.py gateway/run.py tui_gateway/server.py
# passed

node --test ./desktop/tests/*.test.cjs
# 54 passed

pytest -q -o addopts='' tests/hermes_cli/test_redou_context_contract.py
# 2 passed

pytest -q -o addopts='' tests/gateway/test_restart_drain.py tests/test_tui_gateway_server.py
# 188 passed, 2 failed in this container because input.detect_drop imports cli.py and the optional `fire` package is not installed here.
```

A broader pytest command including CLI busy-input tests could not complete here because this container is missing the optional `fire` Python package required to import `cli.py`. The observed failure was an import-time `ModuleNotFoundError: No module named 'fire'`, not a failed assertion in the refactored logic.

## Recommended next step

The next high-value refactor is to extract the duplicated Desktop-side context helpers from `desktop/src/services/redouLocalService.cjs` into smaller service modules, but that should be done in a separate step with focused tests because the file currently owns project storage, runtime launching, context assembly, queues, and analytics.
