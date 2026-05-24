param(
  [switch]$CleanAfter
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$DesktopDir = Join-Path $Root "apps\desktop"
$WebDir = Join-Path $Root "vendor\hermes\web"
$RendererEntry = Join-Path $Root "vendor\hermes\hermes_cli\web_dist\index.html"
$DesktopElectron = Join-Path $DesktopDir "node_modules\electron\dist\electron.exe"
$StartScript = Join-Path $Root "start-redou-agent.ps1"
$SmokeSetupScript = Join-Path $PSScriptRoot "setup-dev-smoke-venv.ps1"
$SmokeVenvDir = Join-Path $env:TEMP "redou-agent-smoke-venv"
$SmokeVenvPython = Join-Path $SmokeVenvDir "Scripts\python.exe"
$SmokeVenvScripts = Join-Path $SmokeVenvDir "Scripts"

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

function Resolve-Npm {
  $candidates = New-Object System.Collections.Generic.List[string]
  $nodeHome = "C:\Program Files\nodejs"
  if (Test-Path -LiteralPath $nodeHome) {
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
    if ([System.IO.Path]::IsPathRooted($candidate) -and -not (Test-Path -LiteralPath $candidate)) {
      continue
    }
    try {
      & $candidate --version >$null 2>$null
      if ($LASTEXITCODE -eq 0) {
        return $candidate
      }
    } catch {
      continue
    }
  }

  throw "npm.cmd was not found. Install Node.js 20+ and rerun this script."
}

function Assert-ProjectRoot {
  $current = (Resolve-Path -LiteralPath ".").Path
  if ($current -ine $Root) {
    throw "Run this script from the Redou project root. Current: $current Expected: $Root"
  }

  $required = @(
    "package.json",
    "apps\desktop\package.json",
    "vendor\hermes\web\package.json",
    "start-redou-agent.ps1"
  )
  foreach ($rel in $required) {
    $path = Join-Path $Root $rel
    if (-not (Test-Path -LiteralPath $path)) {
      throw "Project root check failed; missing $rel"
    }
  }
  Write-Ok "Project root verified"
}

function Show-GitStatus {
  Write-Step "Checking git status"
  $status = & git -C $Root status --short
  if ($LASTEXITCODE -ne 0) {
    Write-Warn "Could not read git status"
    return
  }
  if ($status) {
    Write-Warn "Working tree has uncommitted changes:"
    $status | ForEach-Object { Write-Host "  $_" }
  } else {
    Write-Ok "Working tree is clean"
  }
}

function Get-FileHashes {
  param([string[]]$Paths)

  $hashes = @{}
  foreach ($path in $Paths) {
    if (Test-Path -LiteralPath $path) {
      $hashes[$path] = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    } else {
      $hashes[$path] = $null
    }
  }
  return $hashes
}

function Assert-FileHashesUnchanged {
  param(
    [hashtable]$Before,
    [string[]]$Paths
  )

  foreach ($path in $Paths) {
    $beforeHash = $Before[$path]
    $afterHash = $null
    if (Test-Path -LiteralPath $path) {
      $afterHash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    }
    if ($beforeHash -ne $afterHash) {
      throw "Dependency install changed package metadata unexpectedly: $path"
    }
  }
}

function Invoke-NpmInProject {
  param(
    [string]$ProjectDir,
    [string[]]$Arguments
  )

  Push-Location $ProjectDir
  try {
    Write-Host "npm.cmd $($Arguments -join ' ')"
    & $script:Npm @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "npm.cmd $($Arguments -join ' ') failed in $ProjectDir with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

function Get-RedouElectronProcesses {
  if (-not (Test-Path -LiteralPath $DesktopElectron)) {
    return @()
  }

  $expectedPath = [System.IO.Path]::GetFullPath($DesktopElectron)
  return @(
    Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" -ErrorAction SilentlyContinue |
      Where-Object {
        try {
          $_.ExecutablePath -and ([System.IO.Path]::GetFullPath($_.ExecutablePath) -ieq $expectedPath)
        } catch {
          $false
        }
      }
  )
}

function Assert-DesktopIdle {
  $running = Get-RedouElectronProcesses
  if ($running.Count -gt 0) {
    $ids = ($running | ForEach-Object { $_.ProcessId }) -join ", "
    throw "Redou Desktop is already running from this checkout (electron PID: $ids). Close it before installing dependencies."
  }
}

function Install-NpmProject {
  param(
    [string]$ProjectDir,
    [string]$Label
  )

  Write-Step "Installing $Label dependencies"
  if (-not (Test-Path -LiteralPath (Join-Path $ProjectDir "package.json"))) {
    throw "Missing package.json in $ProjectDir"
  }

  $packageFiles = @(
    (Join-Path $ProjectDir "package.json"),
    (Join-Path $ProjectDir "package-lock.json")
  )
  $hashes = Get-FileHashes -Paths $packageFiles

  if (Test-Path -LiteralPath (Join-Path $ProjectDir "package-lock.json")) {
    Invoke-NpmInProject -ProjectDir $ProjectDir -Arguments @("ci", "--no-fund", "--no-audit", "--progress=false")
  } else {
    Invoke-NpmInProject -ProjectDir $ProjectDir -Arguments @("install", "--no-fund", "--no-audit", "--progress=false")
  }

  Assert-FileHashesUnchanged -Before $hashes -Paths $packageFiles
  Write-Ok "$Label dependencies are ready"
}

function Prepare-DevSmokeVenv {
  Write-Step "Preparing dev smoke venv"
  if (-not (Test-Path -LiteralPath $SmokeSetupScript)) {
    Write-Warn "setup-dev-smoke-venv.ps1 not found; skipping dev smoke venv preparation"
    return
  }

  $needsSetup = -not (Test-Path -LiteralPath $SmokeVenvPython)
  if (-not $needsSetup) {
    & $SmokeVenvPython -c "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('yaml') and importlib.util.find_spec('pytest_asyncio') else 1)"
    $needsSetup = $LASTEXITCODE -ne 0
  }

  if ($needsSetup) {
    & powershell -ExecutionPolicy Bypass -File $SmokeSetupScript
  } else {
    Write-Ok "Dev smoke venv already has required modules"
  }

  if (Test-Path -LiteralPath $SmokeVenvScripts) {
    $env:PATH = "$SmokeVenvScripts;$env:PATH"
  }
  $env:PYTHONIOENCODING = "utf-8"
  Write-Ok "PYTHONIOENCODING=utf-8 and dev smoke venv are ready"
}

function Build-Renderer {
  Write-Step "Building renderer"
  Invoke-NpmInProject -ProjectDir $WebDir -Arguments @("run", "build")
  if (-not (Test-Path -LiteralPath $RendererEntry)) {
    throw "Renderer build did not produce $RendererEntry"
  }
  Write-Ok "Renderer entry exists: $RendererEntry"
}

function Start-RedouDesktop {
  Write-Step "Starting Redou Desktop"
  if (-not (Test-Path -LiteralPath $StartScript)) {
    throw "Missing start script: $StartScript"
  }

  $before = Get-RedouElectronProcesses
  if ($before.Count -gt 0) {
    $ids = ($before | ForEach-Object { $_.ProcessId }) -join ", "
    Write-Ok "Redou Desktop is already running (electron PID: $ids)"
    return
  }

  $launcher = Start-Process -FilePath "powershell.exe" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $StartScript) `
    -WorkingDirectory $Root `
    -PassThru `
    -WindowStyle Hidden

  $deadline = (Get-Date).AddSeconds(60)
  do {
    Start-Sleep -Seconds 2
    $running = Get-RedouElectronProcesses
    if ($running.Count -gt 0) {
      $ids = ($running | ForEach-Object { $_.ProcessId }) -join ", "
      Write-Ok "Redou Desktop electron process started (PID: $ids)"
      Write-Host ""
      Write-Host "Continue UI acceptance in the opened window: Console, Chat, Tasks, Skills, Toolsets, Plugins, Settings, and optional Analytics/Models."
      Write-Host "Codex can continue by clicking through those pages if requested."
      return
    }
  } while ((Get-Date) -lt $deadline -and -not $launcher.HasExited)

  $exitText = if ($launcher.HasExited) { "Launcher exited with code $($launcher.ExitCode)." } else { "Launcher is still running." }
  throw "Electron process was not detected within 60 seconds. $exitText"
}

function Assert-SafeDeletePath {
  param([string]$Path)

  $resolved = (Resolve-Path -LiteralPath $Path).Path
  $fullRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd("\")
  $fullPath = [System.IO.Path]::GetFullPath($resolved).TrimEnd("\")
  if ($fullPath -ieq $fullRoot -or -not $fullPath.StartsWith($fullRoot + "\", [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to delete outside project root: $fullPath"
  }
  return $fullPath
}

function Get-RelativePath {
  param([string]$Path)

  $rootUri = [System.Uri]((Join-Path $Root ".") + [System.IO.Path]::DirectorySeparatorChar)
  $pathUri = [System.Uri]$Path
  return [System.Uri]::UnescapeDataString($rootUri.MakeRelativeUri($pathUri).ToString()).Replace("/", "\")
}

function Assert-NotGitTracked {
  param([string]$Path)

  $rel = Get-RelativePath -Path $Path
  $relForGit = $rel.Replace("\", "/").TrimEnd("/")
  $tracked = & git -C $Root ls-files -- $relForGit
  if ($LASTEXITCODE -ne 0) {
    throw "Could not verify git tracking state for $rel"
  }
  if ($tracked) {
    throw "Refusing to delete git-tracked content under $rel"
  }
}

function Remove-AllowedPath {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }
  $safePath = Assert-SafeDeletePath -Path $Path
  Assert-NotGitTracked -Path $safePath
  Write-Host "Removing $safePath"
  Remove-Item -LiteralPath $safePath -Recurse -Force
}

function Clean-AcceptanceArtifacts {
  Write-Step "Cleaning acceptance dependencies and generated artifacts"

  $fixedPaths = @(
    "apps\desktop\node_modules",
    "vendor\hermes\web\node_modules",
    "vendor\hermes\hermes_cli\web_dist",
    "vendor\hermes\web\public\ds-assets",
    "vendor\hermes\web\public\fonts"
  )

  foreach ($rel in $fixedPaths) {
    Remove-AllowedPath -Path (Join-Path $Root $rel)
  }

  $cacheDirs = @()
  $cacheDirs += Get-ChildItem -LiteralPath $Root -Recurse -Force -Directory -Filter "__pycache__" -ErrorAction SilentlyContinue
  $cacheDirs += Get-ChildItem -LiteralPath $Root -Recurse -Force -Directory -Filter ".pytest_cache" -ErrorAction SilentlyContinue
  foreach ($dir in $cacheDirs | Sort-Object FullName -Descending) {
    Remove-AllowedPath -Path $dir.FullName
  }

  Write-Step "Running generated/debris check after cleanup"
  & $script:Npm run check:generated
  if ($LASTEXITCODE -ne 0) {
    throw "npm.cmd run check:generated failed after cleanup"
  }

  Write-Step "git status --short"
  & git -C $Root status --short
}

Assert-ProjectRoot
$script:Npm = Resolve-Npm
Show-GitStatus

if ($CleanAfter) {
  Clean-AcceptanceArtifacts
  exit 0
}

Assert-DesktopIdle
Install-NpmProject -ProjectDir $DesktopDir -Label "desktop shell"
Install-NpmProject -ProjectDir $WebDir -Label "renderer"
Build-Renderer
Prepare-DevSmokeVenv

Write-Step "Running desktop tests"
Invoke-NpmInProject -ProjectDir $DesktopDir -Arguments @("test")

Write-Step "Running renderer lint"
Invoke-NpmInProject -ProjectDir $WebDir -Arguments @("run", "lint")

Build-Renderer
Start-RedouDesktop
