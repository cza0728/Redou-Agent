# Redou deep restructure notes

Hermes is vendored as `vendor/hermes` and should remain the synchronization boundary for upstream Hermes updates.

Redou desktop code lives in `apps/desktop`. Desktop-specific code should orchestrate UI, project/task state, and IPC only. Any capability that creates or mutates Hermes runtime assets should live under `vendor/hermes` as a Redou Hermes extension.

## Redou Hermes extensions currently kept in `vendor/hermes`

- `hermes_cli/busy_input.py` for queue/guide/interrupt_replace policy.
- `hermes_cli/redou_context.py` for Redou Context Assembly Contract support.
- `hermes_cli/redou_task_skill_packager.py` for explicit Redou task-to-Hermes-skill packaging.

Desktop invokes the task skill packager via `python -m hermes_cli.redou_task_skill_packager` and passes task/project data as JSON. The skill markdown format, metadata generation, reference file generation, redaction, and writes are therefore owned by the Hermes fork, not by the desktop shell. Redou sets project `HERMES_HOME` to the project `.redou` root, so task-packaged skills are stored in `<project-redou-root>/skills/task-packages/` rather than an app-data profile directory.
