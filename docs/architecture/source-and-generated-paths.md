# Redou source and generated path contract

This document is the canonical path contract for the restructured Redou Agent
workspace. It keeps the product boundary simple:

```text
Hermes executes prompts, models, tools, and skills.
Redou displays state, persists project/task interaction state, and handles user interaction.
```

## Source tree

```text
apps/desktop/
  Redou Electron shell, preload bridge, IPC handlers, local state service.

vendor/hermes/
  Hermes runtime fork. Keep this subtree close to upstream Hermes so upstream
  updates can be synced by comparing/replacing one directory. Redou-specific
  Hermes patches are recorded in vendor/hermes/REDOU_HERMES_PATCHES.md.

scripts/
  Workspace maintenance only: clean export, path contract check, generated
  artifact check, smoke test.

docs/
  Architecture, path, and cleanup notes.
```

The repository root intentionally does not contain old Hermes compatibility
entry points such as `hermes`, `run_agent.py`, `cli.py`, `sitecustomize.py`, or a
duplicate root `pyproject.toml`.

## Project-bound generated content

When a Redou project is bound to a workspace, all project-local generated content
lives under:

```text
<workspace>/.redou/
```

For projects without a workspace path, the same structure falls back to:

```text
%APPDATA%/Redou Agent/appData/projects/<project-id>/
```

### Project root files

```text
<workspace>/.redou/PROJECT_RULES.md
```

Project-level rules edited from Redou. These are user-facing project rules and
should travel with the project.

```text
<workspace>/.redou/config.yaml
<workspace>/.redou/redou-profile.json
<workspace>/.redou/profile.json
```

Project-local Hermes home/config used when Hermes executes a prompt for this
project. Redou copies runtime model config from the global Hermes home but keeps
project sessions, memories, logs, and skills local to this `.redou` directory.

### Task files

```text
<workspace>/.redou/tasks/<task-id>/TASK_RULES.md
<workspace>/.redou/tasks/<task-id>/TASK_CONTEXT.md
<workspace>/.redou/tasks/<task-id>/messages.jsonl
<workspace>/.redou/tasks/<task-id>/uploads/
<workspace>/.redou/tasks/<task-id>/task.json
```

Task rules, task context, transcript, uploads, and task metadata. The transcript
is project-local because it is part of the task state and may be used for manual
skill packaging.

### Task-packaged skills

```text
<workspace>/.redou/skills/task-packages/<skill-name>/SKILL.md
<workspace>/.redou/skills/task-packages/<skill-name>/references/task-context.md
<workspace>/.redou/skills/task-packages/<skill-name>/references/task-transcript.md
```

Manual task packaging is a Hermes-side feature implemented by
`vendor/hermes/hermes_cli/redou_task_skill_packager.py`. Redou desktop collects
project/task state and calls that Hermes module. The packager writes to the
project-local Hermes home, so task-packaged skills are not stored in Electron
`userData` profile directories.

## App-level generated content

Electron `userData` is reserved for app/runtime state that is not project-local.
On Windows this is usually under `%APPDATA%/Redou Agent/`; on macOS/Linux it uses
Electron's platform-specific `userData` path.

```text
%APPDATA%/Redou Agent/runtime/
~/.config/Redou Agent/runtime/
```

Python runtime/venv and runtime markers prepared by the desktop app.
The managed Python executable is platform-specific:

```text
%APPDATA%/Redou Agent/runtime/venv/Scripts/python.exe
~/.config/Redou Agent/runtime/venv/bin/python
```

```text
%APPDATA%/Redou Agent/hermes-home/config.yaml
%APPDATA%/Redou Agent/hermes-home/.env
~/.config/Redou Agent/hermes-home/config.yaml
~/.config/Redou Agent/hermes-home/.env
```

Global Hermes config and provider credentials managed by Redou's model setup UI.
Project runs copy the relevant runtime config into the project-local `.redou`
config and merge `.env` values into the child process environment.

```text
%APPDATA%/Redou Agent/appData/global/USER.md
%APPDATA%/Redou Agent/appData/global/GLOBAL_RULES.md
~/.config/Redou Agent/appData/global/USER.md
~/.config/Redou Agent/appData/global/GLOBAL_RULES.md
```

Global user preferences and global rules edited from Redou.

```text
%APPDATA%/Redou Agent/appData/projects/<project-id>/project.json
~/.config/Redou Agent/appData/projects/<project-id>/project.json
```

Project index metadata used by the desktop app. It points at the project-local
`.redou` files. It should not contain task transcripts, task uploads, or packaged
skill bodies.

```text
%APPDATA%/Redou Agent/appData/state.json
%APPDATA%/Redou Agent/appData/analysis/
%APPDATA%/Redou Agent/logs/
~/.config/Redou Agent/appData/state.json
~/.config/Redou Agent/appData/analysis/
~/.config/Redou Agent/logs/
```

Active project/task selection, model benchmark/analysis output, and desktop
startup logs.

## Generated source artifacts

These directories are generated build artifacts and should not be edited by
hand:

```text
vendor/hermes/hermes_cli/web_dist/
vendor/hermes/web/dist/
vendor/hermes/web/public/ds-assets/
vendor/hermes/web/public/fonts/
vendor/hermes/ui-tui/dist/
vendor/hermes/ui-tui/packages/hermes-ink/dist/
apps/desktop/dist/
```

Use source directories and build scripts instead. `scripts/check-generated-dirty.py`
keeps generated artifacts and runtime debris out of clean source archives.

## Checks

Use these commands before packaging:

```bash
python scripts/check-path-contract.py
python scripts/check-generated-dirty.py
python scripts/smoke-test.py
```

`smoke-test.py` is a development validation suite. For the full async gateway
checks, install Hermes dev dependencies in the Python environment used for
smoke validation:

```bash
python -m pip install -e vendor/hermes[dev]
```

On Windows, use the helper scripts instead of modifying the Redou runtime venv:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-dev-smoke-venv.ps1
powershell -ExecutionPolicy Bypass -File scripts/run-check-all-dev.ps1
```

See `docs/development/smoke-tests.md` for the development venv workflow.

If that environment intentionally omits test-only packages, set
`REDOU_SMOKE_SKIP_ASYNC=1` to skip only the async gateway smoke tests.

`check-path-contract.py` verifies that project-local rules, messages, and skills
stay under `.redou`, and that old root compatibility shims remain removed.

Equivalent symbolic form used by tests and code comments:

```text
<project-redou-root>/skills/task-packages/<skill-name>/SKILL.md
<project-redou-root>/tasks/<task-id>/messages.jsonl
```
