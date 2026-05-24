# Redou deep directory restructure — 2026-05-16

## Intent

This restructure separates Redou product code from the Hermes runtime fork while
keeping Hermes as a single upstream-syncable subtree.

## New layout

```text
apps/desktop/          Redou Electron desktop shell and local task bridge
vendor/hermes/         Hermes runtime fork; internal layout intentionally preserved
scripts/               Redou workspace scripts for clean export and generated checks
docs/architecture/     Redou architecture notes
assets/                Redou root assets used by launchers and docs
```

## Hermes sync boundary

`vendor/hermes` is the only Hermes sync boundary.  Its internal directories are
not split further so upstream Hermes changes can be synced by subtree diff/copy.
Redou-specific Hermes patches are listed in `vendor/hermes/REDOU_HERMES_PATCHES.md`.

## Preserved Redou-specific Hermes behavior

- Busy input defaults to queue; guide/steer remains explicit.
- Redou context assembly contract remains in `vendor/hermes/hermes_cli/redou_context.py`.
- New Redou profiles continue to use `--no-skills` where applicable, preventing automatic bundled skill seeding.
- Explicit Redou task packaging into Hermes skills is implemented inside `vendor/hermes/hermes_cli/redou_task_skill_packager.py`; desktop only collects task state and invokes that Hermes-side entry point.
- Packaged skills retain semantic task descriptions and context/source notes.

## Compatibility shims

Superseded by `docs/plans/redou-v3-slim-cleanup-2026-05-16.md`. The v3 cleanup removed root-level Hermes wrappers, the root `sitecustomize.py` shim, and the duplicate root `pyproject.toml`. Use `vendor/hermes/` as the canonical Hermes runtime root.

## Path updates

- Desktop app moved from `desktop/` to `apps/desktop/`.
- Renderer source remains with Hermes at `vendor/hermes/web/`.
- Renderer build output remains with Hermes at `vendor/hermes/hermes_cli/web_dist/`.
- TUI remains with Hermes at `vendor/hermes/ui-tui/`.
- Hermes tests moved to `vendor/hermes/tests/`.
- Root scripts now target the new paths.

## Validation performed

```bash
PYTHONPATH=vendor/hermes python3 -m py_compile \
  vendor/hermes/hermes_cli/busy_input.py \
  vendor/hermes/hermes_cli/redou_context.py \
  apps/desktop/src/dashboard_bridge.py \
  apps/desktop/src/hermes_adapter.py \
  vendor/hermes/hermes_cli/redou_task_skill_packager.py \
  apps/desktop/src/redou_context_compactor.py

node --test ./apps/desktop/tests/*.test.cjs
# 54 passed

PYTHONPATH=vendor/hermes pytest -q -o addopts='' vendor/hermes/tests/hermes_cli/test_redou_context_contract.py
# 2 passed

python3 scripts/check-generated-dirty.py
# passed after cleanup
```

## Not performed

- No `npm install` or `npm build` was run in this Linux container.
- No Windows Electron build was run.
- Hermes internal files were not split into new package folders, by design.
