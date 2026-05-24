param(
  [switch]$Desktop,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$Root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$IconDir = Join-Path $Root "assets\icons"
$LogoPng = Join-Path $Root "logo.png"
$LaunchIcon = Join-Path $IconDir "redou-agent.ico"
$InstallIcon = Join-Path $IconDir "redou-agent-install.ico"
$IconSizes = @(16, 24, 32, 48, 64, 128, 256)

Add-Type -AssemblyName System.Drawing

function New-Color {
  param([string]$Hex)
  return [System.Drawing.ColorTranslator]::FromHtml($Hex)
}

function New-RoundedRectanglePath {
  param(
    [System.Drawing.RectangleF]$Rect,
    [float]$Radius
  )

  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $Radius * 2
  $path.AddArc($Rect.X, $Rect.Y, $diameter, $diameter, 180, 90)
  $path.AddArc($Rect.Right - $diameter, $Rect.Y, $diameter, $diameter, 270, 90)
  $path.AddArc($Rect.Right - $diameter, $Rect.Bottom - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($Rect.X, $Rect.Bottom - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-ResizedPngBytes {
  param(
    [System.Drawing.Image]$Source,
    [int]$Size,
    [double]$PaddingRatio = 0.0
  )

  $bitmap = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

    $padding = [float]($Size * $PaddingRatio)
    $target = [System.Drawing.RectangleF]::new($padding, $padding, $Size - (2 * $padding), $Size - (2 * $padding))
    $graphics.DrawImage($Source, $target)
  } finally {
    $graphics.Dispose()
  }

  $stream = [System.IO.MemoryStream]::new()
  try {
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    return $stream.ToArray()
  } finally {
    $stream.Dispose()
    $bitmap.Dispose()
  }
}

function New-InstallPngBytes {
  param([int]$Size)

  $bitmap = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.ScaleTransform(($Size / 256.0), ($Size / 256.0))

    $backgroundPath = New-RoundedRectanglePath -Rect ([System.Drawing.RectangleF]::new(24, 24, 208, 208)) -Radius 44
    $backgroundBrush = [System.Drawing.SolidBrush]::new((New-Color "#2563EB"))
    $highlightBrush = [System.Drawing.SolidBrush]::new(([System.Drawing.Color]::FromArgb(48, 255, 255, 255)))
    $shadowBrush = [System.Drawing.SolidBrush]::new(([System.Drawing.Color]::FromArgb(42, 15, 23, 42)))

    $graphics.FillPath($backgroundBrush, $backgroundPath)
    $graphics.FillEllipse($highlightBrush, [System.Drawing.RectangleF]::new(48, 34, 142, 92))
    $graphics.FillEllipse($shadowBrush, [System.Drawing.RectangleF]::new(51, 203, 154, 24))

    $trayPath = New-RoundedRectanglePath -Rect ([System.Drawing.RectangleF]::new(58, 162, 140, 48)) -Radius 14
    $trayBrush = [System.Drawing.SolidBrush]::new((New-Color "#EFF6FF"))
    $trayLinePen = [System.Drawing.Pen]::new((New-Color "#93C5FD"), 8)
    $graphics.FillPath($trayBrush, $trayPath)
    $graphics.DrawLine($trayLinePen, 84, 188, 172, 188)

    $arrowBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
    $arrowPoints = @(
      [System.Drawing.PointF]::new(110, 55),
      [System.Drawing.PointF]::new(146, 55),
      [System.Drawing.PointF]::new(146, 118),
      [System.Drawing.PointF]::new(174, 118),
      [System.Drawing.PointF]::new(128, 164),
      [System.Drawing.PointF]::new(82, 118),
      [System.Drawing.PointF]::new(110, 118)
    )
    $graphics.FillPolygon($arrowBrush, [System.Drawing.PointF[]]$arrowPoints)

    $backgroundPath.Dispose()
    $trayPath.Dispose()
    $backgroundBrush.Dispose()
    $highlightBrush.Dispose()
    $shadowBrush.Dispose()
    $trayBrush.Dispose()
    $trayLinePen.Dispose()
    $arrowBrush.Dispose()
  } finally {
    $graphics.Dispose()
  }

  $stream = [System.IO.MemoryStream]::new()
  try {
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    return $stream.ToArray()
  } finally {
    $stream.Dispose()
    $bitmap.Dispose()
  }
}

function Write-IcoFile {
  param(
    [array]$Entries,
    [string]$DestinationPath
  )

  $stream = [System.IO.File]::Create($DestinationPath)
  $writer = [System.IO.BinaryWriter]::new($stream)
  try {
    $writer.Write([UInt16]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]$Entries.Count)

    $offset = 6 + (16 * $Entries.Count)
    foreach ($entry in $Entries) {
      $dimension = if ($entry.Size -ge 256) { 0 } else { $entry.Size }
      $writer.Write([byte]$dimension)
      $writer.Write([byte]$dimension)
      $writer.Write([byte]0)
      $writer.Write([byte]0)
      $writer.Write([UInt16]1)
      $writer.Write([UInt16]32)
      $writer.Write([UInt32]$entry.Bytes.Length)
      $writer.Write([UInt32]$offset)
      $offset += $entry.Bytes.Length
    }

    foreach ($entry in $Entries) {
      $writer.Write([byte[]]$entry.Bytes)
    }
  } finally {
    $writer.Dispose()
    $stream.Dispose()
  }
}

function Convert-PngToIco {
  param(
    [string]$SourcePng,
    [string]$DestinationIco
  )

  if (-not (Test-Path $SourcePng)) {
    throw "Missing source image: $SourcePng"
  }

  $source = [System.Drawing.Image]::FromFile($SourcePng)
  try {
    $entries = @()
    foreach ($size in $IconSizes) {
      $entries += [pscustomobject]@{
        Size = $size
        Bytes = New-ResizedPngBytes -Source $source -Size $size
      }
    }
    Write-IcoFile -Entries $entries -DestinationPath $DestinationIco
  } finally {
    $source.Dispose()
  }
}

function New-InstallIco {
  param([string]$DestinationIco)

  $entries = @()
  foreach ($size in $IconSizes) {
    $entries += [pscustomobject]@{
      Size = $size
      Bytes = New-InstallPngBytes -Size $size
    }
  }
  Write-IcoFile -Entries $entries -DestinationPath $DestinationIco
}

function New-RedouShortcut {
  param(
    [string]$ShortcutPath,
    [string]$TargetPath,
    [string]$IconPath,
    [string]$Description
  )

  if (-not (Test-Path $TargetPath)) {
    throw "Missing shortcut target: $TargetPath"
  }

  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($ShortcutPath)
  $shortcut.TargetPath = $TargetPath
  $shortcut.WorkingDirectory = $Root
  $shortcut.IconLocation = "$IconPath,0"
  $shortcut.Description = $Description
  $shortcut.Save()
}

New-Item -ItemType Directory -Force -Path $IconDir | Out-Null

if ($Force -or -not (Test-Path $LaunchIcon)) {
  Convert-PngToIco -SourcePng $LogoPng -DestinationIco $LaunchIcon
  Write-Host "Created $LaunchIcon"
}

if ($Force -or -not (Test-Path $InstallIcon)) {
  New-InstallIco -DestinationIco $InstallIcon
  Write-Host "Created $InstallIcon"
}

$shortcutLocations = @($Root)
if ($Desktop) {
  $desktopPath = [Environment]::GetFolderPath("DesktopDirectory")
  if (-not [string]::IsNullOrWhiteSpace($desktopPath)) {
    $shortcutLocations += $desktopPath
  }
}

foreach ($location in $shortcutLocations | Select-Object -Unique) {
  New-RedouShortcut `
    -ShortcutPath (Join-Path $location "Launch Redou Agent.lnk") `
    -TargetPath (Join-Path $Root "Launch Redou Agent.cmd") `
    -IconPath $LaunchIcon `
    -Description "Launch Redou Agent"
  Write-Host "Created $(Join-Path $location 'Launch Redou Agent.lnk')"

  New-RedouShortcut `
    -ShortcutPath (Join-Path $location "Install Redou Agent.lnk") `
    -TargetPath (Join-Path $Root "Install Redou Agent.cmd") `
    -IconPath $InstallIcon `
    -Description "Install Redou Agent dependencies"
  Write-Host "Created $(Join-Path $location 'Install Redou Agent.lnk')"
}
