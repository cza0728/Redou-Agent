# Generated / Do-not-edit Areas

This workspace separates Redou shell code from the vendored Hermes runtime.  Do
not hand-edit generated outputs; edit the source and rebuild instead.

## Generated paths

- `vendor/hermes/hermes_cli/web_dist/` — built from `vendor/hermes/web/`.
- `vendor/hermes/web/dist/` — Vite build output if generated directly.
- `vendor/hermes/web/public/ds-assets/` — copied by `vendor/hermes/web/scripts/sync-assets.mjs`.
- `vendor/hermes/web/public/fonts/` — copied by `vendor/hermes/web/scripts/sync-assets.mjs`.
- `vendor/hermes/ui-tui/dist/` — TUI TypeScript/Babel build output.
- `vendor/hermes/ui-tui/packages/hermes-ink/dist/` — local Ink package build output.
- `apps/desktop/dist/` — Electron build output.
- `vendor/hermes/website/build/` and `vendor/hermes/website/out/` — website build output.

## Clean source export

Use:

```bash
python scripts/export-clean.py --output RedouAgent-clean.zip
```

Use `--include-generated` only when you intentionally need a runnable snapshot
that keeps existing bundles.
