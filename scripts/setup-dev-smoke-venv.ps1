$ErrorActionPreference = "Stop"

$Root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$VenvDir = Join-Path $env:TEMP "redou-agent-smoke-venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
$VenvScripts = Join-Path $VenvDir "Scripts"

function Resolve-Python {
  if ($env:PYTHON) {
    return $env:PYTHON
  }
  $python = Get-Command python -ErrorAction SilentlyContinue
  if ($python) {
    return $python.Source
  }
  $py = Get-Command py -ErrorAction SilentlyContinue
  if ($py) {
    return $py.Source
  }
  throw "Python was not found on PATH. Install Python 3.11+ or set the PYTHON environment variable."
}

$Python = Resolve-Python

if (-not (Test-Path -LiteralPath $VenvPython)) {
  Write-Host "Creating dev smoke venv at $VenvDir"
  if ((Split-Path -Leaf $Python) -ieq "py.exe") {
    & $Python -3 -m venv $VenvDir
  } else {
    & $Python -m venv $VenvDir
  }
}

Write-Host "Ensuring pip is installed in dev smoke venv"
& $VenvPython -m ensurepip --upgrade

Push-Location $Root
try {
  Write-Host "Installing Hermes development dependencies"
  & $VenvPython -m pip install -e "vendor/hermes[dev]"
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "Dev smoke venv is ready:"
Write-Host "  $VenvDir"
Write-Host ""
Write-Host "Use it for full validation:"
Write-Host "  `$env:PATH = `"$VenvScripts;`$env:PATH`""
Write-Host "  npm.cmd run check:all"
Write-Host "  & `"$VenvPython`" scripts/smoke-test.py"
Write-Host ""
Write-Host "Or run the wrapper:"
Write-Host "  powershell -ExecutionPolicy Bypass -File scripts/run-check-all-dev.ps1"
