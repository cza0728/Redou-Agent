param(
  [string]$Output = "RedouAgent-clean.zip",
  [switch]$IncludeGenerated
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Resolve-Path (Join-Path $ScriptDir "..")
$ArgsList = @("$ScriptDir/export-clean.py", "--root", "$Root", "--output", $Output)
if ($IncludeGenerated) { $ArgsList += "--include-generated" }
python @ArgsList
