# Smoke Test Development Environment

Redou Desktop keeps the app-managed runtime venv focused on running the
application. Full source validation is a developer workflow, and it needs test
packages such as `pytest-asyncio` for the async gateway smoke tests. Those
test-only packages should not be mixed into the Redou runtime venv or production
dependencies.

Use a disposable development venv under `%TEMP%` for full validation:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-dev-smoke-venv.ps1
```

The setup script creates:

```text
%TEMP%\redou-agent-smoke-venv
```

It ensures pip is available and installs Hermes development dependencies:

```powershell
python -m pip install -e vendor/hermes[dev]
```

For the complete pre-merge validation, run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run-check-all-dev.ps1
```

The wrapper ensures the dev smoke venv exists, prepends its `Scripts` directory
to `PATH`, then runs:

```powershell
npm.cmd run check:all
python scripts/smoke-test.py
```

If an environment intentionally omits `pytest-asyncio`, set
`REDOU_SMOKE_SKIP_ASYNC=1` to skip only the async gateway smoke tests. This is a
fallback for constrained environments, not the recommended ready-to-merge path.
