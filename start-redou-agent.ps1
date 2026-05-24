param(
  [switch]$Build
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Test-CommandRun {
  param(
    [string]$Command,
    [string[]]$Arguments = @("--version")
  )

  if ([string]::IsNullOrWhiteSpace($Command)) {
    return $false
  }

  try {
    & $Command @Arguments >$null 2>$null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  }
}

function Resolve-Npm {
  $candidates = New-Object System.Collections.Generic.List[string]
  $nodeHome = "C:\Program Files\nodejs"
  if (Test-Path $nodeHome) {
    $env:Path = "$nodeHome;$env:Path"
  }
  $candidates.Add((Join-Path $nodeHome "npm.cmd"))

  $cmd = Get-Command "npm.cmd" -ErrorAction SilentlyContinue
  if ($cmd) {
    $candidates.Add($cmd.Source)
  }
  $candidates.Add("npm.cmd")

  foreach ($candidate in $candidates | Select-Object -Unique) {
    if ([string]::IsNullOrWhiteSpace($candidate)) {
      continue
    }
    if ([System.IO.Path]::IsPathRooted($candidate) -and -not (Test-Path $candidate)) {
      continue
    }
    if (Test-CommandRun $candidate) {
      return $candidate
    }
  }

  throw "Node.js/npm is not installed. Install Node.js LTS, then rerun this script."
}

function Get-PythonInfo {
  param([string]$PythonPath)

  if ([string]::IsNullOrWhiteSpace($PythonPath)) {
    return $null
  }
  if ($PythonPath -like "*\WindowsApps\*") {
    return $null
  }
  if ([System.IO.Path]::IsPathRooted($PythonPath) -and -not (Test-Path $PythonPath)) {
    return $null
  }

  $probe = 'import sys; print(sys.executable); print(sys.version.split()[0])'
  try {
    $output = & $PythonPath -c $probe 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $output -or $output.Count -lt 2) {
      return $null
    }
  } catch {
    return $null
  }

  return [pscustomobject]@{
    Path = [string]$output[0]
    Version = [string]$output[1]
  }
}

function Test-PythonVersion {
  param([string]$Version)

  $parts = $Version.Split(".")
  if ($parts.Count -lt 2) {
    return $false
  }
  $major = [int]$parts[0]
  $minor = [int]$parts[1]
  return ($major -gt 3) -or ($major -eq 3 -and $minor -ge 11)
}

function Add-PyLauncherCandidate {
  param(
    [System.Collections.Generic.List[string]]$Candidates,
    [string]$Version
  )

  try {
    $resolved = & py "-$Version" -c "import sys; print(sys.executable)" 2>$null
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($resolved)) {
      $Candidates.Add(([string]$resolved).Trim())
    }
  } catch {
    return
  }
}

function Resolve-Python {
  $candidates = New-Object System.Collections.Generic.List[string]
  if ($env:REDOU_PYTHON) {
    $candidates.Add($env:REDOU_PYTHON)
  }
  if ($env:LOCALAPPDATA) {
    $candidates.Add((Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"))
  }
  $candidates.Add("C:\Program Files\Python312\python.exe")
  Add-PyLauncherCandidate $candidates "3.12"
  Add-PyLauncherCandidate $candidates "3.11"

  $cmd = Get-Command "python.exe" -ErrorAction SilentlyContinue
  if ($cmd) {
    $candidates.Add($cmd.Source)
  }
  $candidates.Add("python.exe")

  foreach ($candidate in $candidates | Select-Object -Unique) {
    $info = Get-PythonInfo $candidate
    if (-not $info) {
      continue
    }
    if (-not (Test-PythonVersion $info.Version)) {
      continue
    }
    return $info
  }

  throw "Python 3.11 or newer was not found. Install Python 3.12 or set REDOU_PYTHON to python.exe."
}

function Resolve-GitBash {
  $candidates = New-Object System.Collections.Generic.List[string]
  if ($env:HERMES_GIT_BASH_PATH) {
    $candidates.Add($env:HERMES_GIT_BASH_PATH)
  }
  if ($env:LOCALAPPDATA) {
    $candidates.Add((Join-Path $env:LOCALAPPDATA "hermes\git\bin\bash.exe"))
    $candidates.Add((Join-Path $env:LOCALAPPDATA "hermes\git\usr\bin\bash.exe"))
    $candidates.Add((Join-Path $env:LOCALAPPDATA "Programs\Git\bin\bash.exe"))
  }
  $candidates.Add("C:\Program Files\Git\bin\bash.exe")
  $candidates.Add("C:\Program Files (x86)\Git\bin\bash.exe")

  $gitCommand = Get-Command "git.exe" -ErrorAction SilentlyContinue
  if ($gitCommand) {
    $gitRoot = Split-Path -Parent (Split-Path -Parent $gitCommand.Source)
    $candidates.Add((Join-Path $gitRoot "bin\bash.exe"))
    $candidates.Add((Join-Path $gitRoot "usr\bin\bash.exe"))
  }

  $bashCommand = Get-Command "bash.exe" -ErrorAction SilentlyContinue
  if ($bashCommand -and $bashCommand.Source -notlike "*\Windows\System32\bash.exe" -and $bashCommand.Source -notlike "*\Microsoft\WindowsApps\bash.exe") {
    $candidates.Add($bashCommand.Source)
  }

  foreach ($candidate in $candidates | Select-Object -Unique) {
    if ([string]::IsNullOrWhiteSpace($candidate)) {
      continue
    }
    if ([System.IO.Path]::IsPathRooted($candidate) -and -not (Test-Path -LiteralPath $candidate)) {
      continue
    }
    if (Test-CommandRun -Command $candidate -Arguments @("--version")) {
      return $candidate
    }
  }

  throw "Git for Windows (Git Bash) was not found. Install Git for Windows or set HERMES_GIT_BASH_PATH to bash.exe."
}

$Npm = Resolve-Npm
$Python = Resolve-Python
$env:REDOU_PYTHON = $Python.Path
$GitBash = Resolve-GitBash
$env:HERMES_GIT_BASH_PATH = $GitBash

if (-not $Build -and -not (Test-Path (Join-Path $Root "apps\desktop\node_modules\electron"))) {
  throw "Desktop dependencies are not installed. Run '.\Install Redou Agent.cmd' first."
}

if ($Build) {
  & $Npm --prefix (Join-Path $Root "apps\desktop") run build
  exit $LASTEXITCODE
}

& $Npm --prefix (Join-Path $Root "apps\desktop") start
exit $LASTEXITCODE
