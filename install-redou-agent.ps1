param(
  [switch]$Launch,
  [switch]$SkipRendererBuild,
  [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$DesktopDir = Join-Path $Root "apps\desktop"
$WebDir = Join-Path $Root "vendor\hermes\web"
$RendererEntry = Join-Path $Root "vendor\hermes\hermes_cli\web_dist\index.html"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok {
  param([string]$Message)
  Write-Host "OK  $Message" -ForegroundColor Green
}

function Write-Warn {
  param([string]$Message)
  Write-Host "WARN $Message" -ForegroundColor Yellow
}

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

function Resolve-Node {
  $candidates = New-Object System.Collections.Generic.List[string]
  $nodeHome = "C:\Program Files\nodejs"
  $candidates.Add((Join-Path $nodeHome "node.exe"))

  $cmd = Get-Command "node.exe" -ErrorAction SilentlyContinue
  if ($cmd) {
    $candidates.Add($cmd.Source)
  }
  $candidates.Add("node.exe")

  foreach ($candidate in $candidates | Select-Object -Unique) {
    if ([string]::IsNullOrWhiteSpace($candidate)) {
      continue
    }
    if ([System.IO.Path]::IsPathRooted($candidate) -and -not (Test-Path $candidate)) {
      continue
    }
    if (-not (Test-CommandRun $candidate)) {
      continue
    }

    $versionText = (& $candidate --version).Trim().TrimStart("v")
    $major = [int]($versionText.Split(".")[0])
    if ($major -lt 20) {
      throw "Node.js $versionText found, but Redou Agent requires Node.js 20 or newer."
    }

    return [pscustomobject]@{
      Path = $candidate
      Version = $versionText
    }
  }

  throw "Node.js was not found. Install Node.js LTS, then rerun this installer."
}

function Resolve-Npm {
  param([string]$NodePath)

  $candidates = New-Object System.Collections.Generic.List[string]
  $nodeHome = "C:\Program Files\nodejs"
  $candidates.Add((Join-Path $nodeHome "npm.cmd"))

  if ($NodePath -and [System.IO.Path]::IsPathRooted($NodePath)) {
    $candidates.Add((Join-Path (Split-Path -Parent $NodePath) "npm.cmd"))
  }

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

  throw "npm.cmd was not found. Install Node.js LTS, then rerun this installer."
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

  throw "Python 3.11 or newer was not found. Install Python 3.12, then rerun this installer."
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

  throw "Git for Windows (Git Bash) was not found. Install Git for Windows or set HERMES_GIT_BASH_PATH to bash.exe, then rerun this installer."
}

function Invoke-Npm {
  param(
    [string]$ProjectDir,
    [string[]]$Arguments
  )

  Push-Location $ProjectDir
  try {
    & $script:Npm @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "npm $($Arguments -join ' ') failed in $ProjectDir with exit code $LASTEXITCODE."
    }
  } finally {
    Pop-Location
  }
}

function Assert-InstallTargetIdle {
  param([string]$ProjectDir)

  $electronPath = Join-Path $ProjectDir "node_modules\electron\dist\electron.exe"
  if (-not (Test-Path $electronPath)) {
    return
  }

  $expectedPath = [System.IO.Path]::GetFullPath($electronPath)
  $runningIds = New-Object System.Collections.Generic.List[string]

  foreach ($process in Get-Process -Name "electron" -ErrorAction SilentlyContinue) {
    try {
      if ($process.Path -and ([System.IO.Path]::GetFullPath($process.Path) -ieq $expectedPath)) {
        $runningIds.Add([string]$process.Id)
      }
    } catch {
      continue
    }
  }

  if ($runningIds.Count -gt 0) {
    throw "Redou Agent is currently running from this checkout (electron PID: $($runningIds -join ', ')). Close it, then rerun the installer."
  }
}

function Install-NpmProject {
  param(
    [string]$ProjectDir,
    [string]$Label
  )

  if (-not (Test-Path (Join-Path $ProjectDir "package.json"))) {
    throw "Missing package.json for $Label at $ProjectDir."
  }

  Write-Step "Installing $Label dependencies"
  Assert-InstallTargetIdle $ProjectDir

  if (Test-Path (Join-Path $ProjectDir "node_modules")) {
    Invoke-Npm -ProjectDir $ProjectDir -Arguments @("install", "--no-fund", "--no-audit", "--progress=false")
  } elseif (Test-Path (Join-Path $ProjectDir "package-lock.json")) {
    Invoke-Npm -ProjectDir $ProjectDir -Arguments @("ci", "--no-fund", "--no-audit", "--progress=false")
  } else {
    Invoke-Npm -ProjectDir $ProjectDir -Arguments @("install", "--no-fund", "--no-audit", "--progress=false")
  }
  Write-Ok "$Label dependencies are ready"
}

function Update-RedouShortcuts {
  $shortcutScript = Join-Path $Root "scripts\create-redou-shortcuts.ps1"
  if (-not (Test-Path $shortcutScript)) {
    Write-Warn "Shortcut generator not found at $shortcutScript"
    return
  }

  Write-Step "Refreshing launcher shortcuts"
  try {
    & $shortcutScript
    Write-Ok "Launcher shortcuts are ready"
  } catch {
    Write-Warn "Could not refresh launcher shortcuts: $($_.Exception.Message)"
  }
}

Set-Location $Root

Write-Step "Checking local tools"
$node = Resolve-Node
Write-Ok "Node.js $($node.Version) found at $($node.Path)"

$script:Npm = Resolve-Npm -NodePath $node.Path
$npmVersion = (& $script:Npm --version).Trim()
Write-Ok "npm $npmVersion found at $script:Npm"

# Codex CLI check
$codexCmd = Get-Command "codex" -ErrorAction SilentlyContinue
if ($codexCmd) {
  Write-Ok "Codex CLI found at $($codexCmd.Source)"
} elseif (Test-CommandRun "codex" @("--version")) {
  Write-Ok "Codex CLI is available"
} else {
  Write-Warn "Codex CLI not found. Installing via npm..."
  & $script:Npm install -g "@openai/codex"
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to install Codex CLI. Please install manually: npm install -g @openai/codex"
  }
  Write-Ok "Codex CLI installed"
}

# Python is no longer required for the runtime but kept for legacy scripts
try {
  $python = Resolve-Python
  $env:REDOU_PYTHON = $python.Path
  Write-Ok "Python $($python.Version) found at $($python.Path) (optional, for legacy scripts)"
} catch {
  Write-Warn "Python not found (optional - Codex runtime does not require Python)"
}

$gitBash = Resolve-GitBash
$env:HERMES_GIT_BASH_PATH = $gitBash
Write-Ok "Git Bash found at $gitBash"

if ($CheckOnly) {
  Write-Ok "Preflight checks completed"
  exit 0
}

Install-NpmProject -ProjectDir $DesktopDir -Label "desktop shell"

if ($SkipRendererBuild) {
  Write-Warn "Renderer dependency install and build skipped"
} else {
  Install-NpmProject -ProjectDir $WebDir -Label "renderer"
  Write-Step "Building renderer"
  Invoke-Npm -ProjectDir $WebDir -Arguments @("run", "build")
  if (-not (Test-Path $RendererEntry)) {
    throw "Renderer build did not produce $RendererEntry."
  }
  Write-Ok "Renderer build is ready"
}

Update-RedouShortcuts
Write-Step "Installation complete"
Write-Host "Run Redou Agent with:" -ForegroundColor Green
Write-Host "  .\Launch Redou Agent.lnk"
Write-Host "or:"
Write-Host "  .\Launch Redou Agent.cmd"

if ($Launch) {
  Write-Step "Launching Redou Agent"
  & (Join-Path $Root "start-redou-agent.ps1")
  exit $LASTEXITCODE
}
