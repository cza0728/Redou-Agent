# Redou Deep Directory Layout

## Goals

- Keep Hermes in one subtree so upstream Hermes changes can be synced by comparing or replacing `vendor/hermes`.
- Keep Redou product code outside Hermes so Redou changes do not look like upstream runtime patches.
- Make the runtime boundary explicit: Hermes executes prompts and tools; Redou presents state and handles user interaction.
- Keep generated outputs, runtime debris, and old compatibility shims out of source archives.

## Layout

```text
apps/
  desktop/                 Redou Electron shell, IPC handlers, local state, task UI bridge
vendor/
  hermes/                  Hermes runtime fork; internal tree intentionally kept close to upstream
scripts/                   Redou workspace maintenance, clean export, smoke tests
docs/                      Redou architecture and cleanup notes
assets/                    Redou brand assets used by root docs / shortcuts
```

## Runtime boundary

Redou does not implement a second agent runner. Its responsibilities are:

- project/task/message persistence;
- context file editing and task state display;
- queue / guide / interrupt_replace user interaction state;
- model/key/config UI and local IPC;
- rendering Hermes runtime events as cards and status updates.

Hermes owns:

- prompt execution;
- model/provider/tool orchestration;
- skill management;
- task skill packaging internals;
- gateway/TUI/web runtime implementation.

When Redou needs execution, it calls Hermes through `vendor/hermes` with explicit
`HERMES_VENDOR_ROOT`, `HERMES_PYTHON_SRC_ROOT`, `HERMES_HOME`, and `PYTHONPATH`.

## Hermes sync rule

`vendor/hermes` is the single Hermes sync boundary. Avoid splitting its internal
packages (`hermes_cli`, `gateway`, `agent`, `tools`, `skills`, `web`, `ui-tui`,
etc.) across the workspace. Redou-specific Hermes changes should be recorded in
`vendor/hermes/REDOU_HERMES_PATCHES.md` before syncing upstream.

## No root compatibility shims

The v3 cleanup intentionally removed root-level Hermes compatibility files:

```text
hermes
run_agent.py
cli.py
mcp_serve.py
batch_runner.py
rl_cli.py
mini_swe_runner.py
sitecustomize.py
pyproject.toml
```

Use the canonical runtime location instead:

```bash
cd vendor/hermes
python -m hermes_cli.main --help
python -m run_agent --help
pip install -e .
```

This removes ambiguous duplicate entry points and makes it clear which code is
Redou product code and which code is Hermes runtime code.

## Path contract

Runtime and generated-file locations are specified in `docs/architecture/source-and-generated-paths.md`. In particular, project rules, task transcripts, uploads, and task-packaged skills live under the project `.redou/` directory when a workspace path is set.
