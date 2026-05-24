# Redou Desktop Acceptance With Dependencies

Redou has two different validation modes. Keep them separate so a clean source
tree is not confused with a runnable development environment.

## Clean Source Validation

Clean source validation answers one question: is this checkout suitable to
commit or package as source?

It should not contain local dependency directories, generated renderer bundles,
copied design-system assets, or Python caches:

- `apps/desktop/node_modules`
- `vendor/hermes/web/node_modules`
- `vendor/hermes/hermes_cli/web_dist`
- `vendor/hermes/web/public/ds-assets`
- `vendor/hermes/web/public/fonts`
- `__pycache__`
- `.pytest_cache`

The main command is:

```powershell
npm.cmd run check:all
```

`check:generated` intentionally rejects `node_modules` and cache directories as
runtime/build debris. It also checks generated paths such as
`vendor/hermes/hermes_cli/web_dist`, `vendor/hermes/web/public/ds-assets`, and
`vendor/hermes/web/public/fonts` so they do not drift into commits.

## Dev Runtime Acceptance

Dev runtime acceptance answers a different question: can this source checkout
actually start Redou Desktop and support manual UI acceptance?

That requires local dependencies and a built renderer:

- `apps/desktop/node_modules/electron` provides the Electron binary used by
  `apps/desktop/package.json`'s `start` script.
- `vendor/hermes/web/node_modules` provides Vite, TypeScript, ESLint, React, and
  `@nous-research/ui`.
- `vendor/hermes/hermes_cli/web_dist/index.html` is the production renderer
  bundle that the Electron main process loads.

These files are required to run the app from source, but they are still ignored
or generated files and should not be committed.

## Recommended Flow

Run clean source validation when reviewing commit readiness:

```powershell
npm.cmd run check:all
```

Prepare dependencies, build the renderer, run automated checks, and launch
Redou Desktop for UI acceptance:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run-desktop-acceptance-with-deps.ps1
```

After manual UI acceptance, clean generated/dependency artifacts and return to a
commit-ready source tree:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run-desktop-acceptance-with-deps.ps1 -CleanAfter
```

The cleanup mode only removes the allowed dependency/generated/cache paths and
verifies that none of the removed paths are tracked by Git. It does not remove
`package-lock.json`, `vendor/hermes/web/src`, or Hermes Python source files.
