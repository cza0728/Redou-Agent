# Redou v3 slim cleanup — 2026-05-16

## Intent

This cleanup follows the simplified product boundary:

```text
Redou = desktop UI, local state, user interaction, status/event display
Hermes = prompt execution, tools, models, skills, task-skill packaging
```

The goal is to remove compatibility cruft introduced during earlier restructures
and to keep the source tree easier to reason about.

## Removed

- Root-level Hermes wrappers: `hermes`, `run_agent.py`, `cli.py`, `mcp_serve.py`, `batch_runner.py`, `rl_cli.py`, `mini_swe_runner.py`.
- Root `sitecustomize.py` import shim.
- Root duplicate `pyproject.toml`; Hermes packaging now lives only in `vendor/hermes/pyproject.toml`.
- Redou desktop migration code for the pre-v2 `chat-projects.json` store.
- Local Redou skill-generation logic; desktop delegates task skill packaging to Hermes via `hermes_cli.redou_task_skill_packager`.

## Kept

- `apps/desktop/` as the Redou desktop/application layer.
- `vendor/hermes/` as the single upstream-syncable Hermes fork.
- Redou-specific Hermes patches, documented in `vendor/hermes/REDOU_HERMES_PATCHES.md`.
- Explicit queue / guide / interrupt_replace behavior.
- Context Assembly Contract and secret redaction.
- Manual task skill packaging with semantic descriptions and task context notes.

## New checks

Added `scripts/smoke-test.py`, also exposed as:

```bash
npm run smoke
```

The smoke suite checks:

- removed compatibility files stay absent;
- key Python bridge/runtime files compile;
- desktop CJS files parse;
- desktop unit tests pass;
- Redou/Hermes context contract tests pass;
- gateway restart-drain tests and selected quick TUI gateway tests pass when dependencies are installed;
- generated/debris check passes.

## Commands used in this cleanup

```bash
python3 scripts/smoke-test.py
python3 scripts/export-clean.py --output /mnt/data/RedouAgent_v3_slim_20260516.zip
```

## Notes

No `node_modules` are included in source archives. Web/TUI/Electron production
builds should be run after dependency installation on the target platform.
