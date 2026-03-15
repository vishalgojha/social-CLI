$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$tui = Join-Path $root "social-tui\social-tui.exe"
$env:SOCIAL_BIN = Join-Path $env:APPDATA "npm\\social.cmd"
if (-not (Test-Path $tui)) {
  Write-Host "social-tui binary not found at $tui"
  Write-Host "Build it with:"
  Write-Host "  cd $root\social-tui"
  Write-Host "  go build -o social-tui ."
  exit 1
}
& $tui @args
