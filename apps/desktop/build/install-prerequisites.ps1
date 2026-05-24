param(
  [switch]$Check,
  [switch]$Install
)

$ErrorActionPreference = "Stop"

function Test-CommandRun {
  param(
    [string]$Command,
    [string[]]$Arguments
  )

  if ([string]::IsNullOrWhiteSpace($Command)) {
    return $false
  }
  if ($Command -like "*\WindowsApps\*") {
    return $false
  }
  if ([System.IO.Path]::IsPathRooted($Command) -and -not (Test-Path -LiteralPath $Command)) {
    return $false
  }

  try {
    & $Command @Arguments >$null 2>$null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  }
}

function Get-PythonVersion {
  param([string]$PythonPath)

  if (-not (Test-CommandRun -Command $PythonPath -Arguments @("-c", "import sys; print(sys.version.split()[0])"))) {
    return $null
  }
  try {
    $version = (& $PythonPath -c "import sys; print(sys.version.split()[0])" 2>$null).Trim()
    return [version]$version
  } catch {
    return $null
  }
}

function Test-PythonReady {
  $candidates = New-Object System.Collections.Generic.List[string]
  if ($env:REDOU_PYTHON) {
    $candidates.Add($env:REDOU_PYTHON)
  }
  if ($env:LOCALAPPDATA) {
    $candidates.Add((Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"))
  }
  $candidates.Add("C:\Program Files\Python312\python.exe")
  $pythonCommand = Get-Command "python.exe" -ErrorAction SilentlyContinue
  if ($pythonCommand) {
    $candidates.Add($pythonCommand.Source)
  }
  $candidates.Add("python.exe")

  foreach ($candidate in $candidates | Select-Object -Unique) {
    $version = Get-PythonVersion -PythonPath $candidate
    if ($version -and ($version.Major -gt 3 -or ($version.Major -eq 3 -and $version.Minor -ge 11))) {
      return $true
    }
  }
  return $false
}

function Get-NodeVersion {
  param([string]$NodePath)

  if (-not (Test-CommandRun -Command $NodePath -Arguments @("--version"))) {
    return $null
  }
  try {
    $version = (& $NodePath --version 2>$null).Trim().TrimStart("v")
    return [version]$version
  } catch {
    return $null
  }
}

function Test-NodeReady {
  $candidates = New-Object System.Collections.Generic.List[string]
  $candidates.Add("C:\Program Files\nodejs\node.exe")
  $nodeCommand = Get-Command "node.exe" -ErrorAction SilentlyContinue
  if ($nodeCommand) {
    $candidates.Add($nodeCommand.Source)
  }
  $candidates.Add("node.exe")

  foreach ($candidate in $candidates | Select-Object -Unique) {
    $version = Get-NodeVersion -NodePath $candidate
    if ($version -and $version.Major -ge 20) {
      return $true
    }
  }
  return $false
}

function Test-GitBashReady {
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
      return $true
    }
  }
  return $false
}

function Get-MissingPrerequisites {
  $missing = New-Object System.Collections.Generic.List[string]
  if (-not (Test-PythonReady)) {
    $missing.Add("Python 3.11+")
  }
  if (-not (Test-NodeReady)) {
    $missing.Add("Node.js 20+")
  }
  if (-not (Test-GitBashReady)) {
    $missing.Add("Git for Windows (Git Bash)")
  }
  return @($missing)
}

function Get-MissingCode {
  param([string[]]$Missing)

  $code = 0
  if ($Missing -contains "Python 3.11+") {
    $code += 10
  }
  if ($Missing -contains "Node.js 20+") {
    $code += 20
  }
  if ($Missing -contains "Git for Windows (Git Bash)") {
    $code += 40
  }
  return $code
}

function Write-Status {
  param([string[]]$Missing)

  if ($Missing.Count -eq 0) {
    Write-Output "Python 3.11+ is available."
    Write-Output "Node.js 20+ is available."
    Write-Output "Git for Windows (Git Bash) is available."
    Write-Output "Redou Agent can continue installation."
    return
  }

  Write-Output "Missing runtime dependency:"
  foreach ($item in $Missing) {
    Write-Output " - $item"
  }
}

function Invoke-WingetInstall {
  param(
    [string]$Id,
    [string]$Name
  )

  $winget = Get-Command "winget.exe" -ErrorAction SilentlyContinue
  if (-not $winget) {
    throw "winget.exe was not found. Install App Installer from Microsoft Store, then rerun Redou Agent Setup."
  }

  Write-Output "Installing $Name..."
  & $winget.Source install --id $Id --source winget --silent --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) {
    throw "$Name installer failed with exit code $LASTEXITCODE."
  }
}

function Install-MissingPrerequisites {
  $missing = Get-MissingPrerequisites
  if ($missing.Count -eq 0) {
    Write-Status -Missing $missing
    return 0
  }

  if ($missing -contains "Python 3.11+") {
    Invoke-WingetInstall -Id "Python.Python.3.12" -Name "Python 3.12"
  }
  if ($missing -contains "Node.js 20+") {
    Invoke-WingetInstall -Id "OpenJS.NodeJS.LTS" -Name "Node.js LTS"
  }
  if ($missing -contains "Git for Windows (Git Bash)") {
    Invoke-WingetInstall -Id "Git.Git" -Name "Git for Windows"
  }

  $remaining = Get-MissingPrerequisites
  Write-Status -Missing $remaining
  return (Get-MissingCode -Missing $remaining)
}

if (-not $Check -and -not $Install) {
  $Check = $true
}

try {
  if ($Install) {
    exit (Install-MissingPrerequisites)
  }

  $missing = Get-MissingPrerequisites
  Write-Status -Missing $missing
  exit (Get-MissingCode -Missing $missing)
} catch {
  Write-Output $_.Exception.Message
  exit 1
}
