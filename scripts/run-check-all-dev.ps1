$ErrorActionPreference = "Stop"

$Root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$VenvDir = Join-Path $env:TEMP "redou-agent-smoke-venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
$VenvScripts = Join-Path $VenvDir "Scripts"
$SetupScript = Join-Path $PSScriptRoot "setup-dev-smoke-venv.ps1"

function Test-DevSmokeDependency {
  param([string]$ModuleName)
  & $VenvPython -c "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('$ModuleName') else 1)"
  return $LASTEXITCODE -eq 0
}

$NeedsSetup = -not (Test-Path -LiteralPath $VenvPython)
if (-not $NeedsSetup) {
  $NeedsSetup = -not (Test-DevSmokeDependency "yaml") -or -not (Test-DevSmokeDependency "pytest_asyncio")
}

if ($NeedsSetup) {
  & powershell -ExecutionPolicy Bypass -File $SetupScript
}

$env:PATH = "$VenvScripts;$env:PATH"

Push-Location $Root
try {
  Write-Host "Running npm.cmd run check:all with dev smoke venv first on PATH"
  npm.cmd run check:all

  Write-Host ""
  Write-Host "Running scripts/smoke-test.py explicitly with dev smoke venv"
  & $VenvPython scripts/smoke-test.py
} finally {
  Pop-Location
}
