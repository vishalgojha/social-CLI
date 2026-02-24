[CmdletBinding()]
param(
  [switch]$NoGlobal,
  [switch]$SkipBuild,
  [switch]$SkipTui,
  [switch]$ForceInstallDeps,
  [switch]$SkipNodeAutoInstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
  Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Write-WarnLine([string]$Message) {
  Write-Host "WARN: $Message" -ForegroundColor Yellow
}

function Resolve-NpmCommand() {
  $npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($npmCmd) { return $npmCmd.Path }
  $npm = Get-Command npm -ErrorAction SilentlyContinue
  if ($npm) { return $npm.Path }
  return $null
}

function Invoke-Npm {
  param(
    [Parameter(Mandatory = $true)][string]$NpmPath,
    [Parameter(Mandatory = $true)][string[]]$Args
  )
  Write-Host ("npm " + ($Args -join " ")) -ForegroundColor DarkGray
  & $NpmPath @Args
  if ($LASTEXITCODE -ne 0) {
    throw "npm command failed: npm $($Args -join ' ')"
  }
}

function Normalize-PathEntry([string]$Value) {
  if (-not $Value) { return "" }
  return $Value.Trim().Trim('"').TrimEnd('\').ToLowerInvariant()
}

function Test-PathContainsEntry {
  param(
    [string]$PathValue,
    [Parameter(Mandatory = $true)][string]$Entry
  )

  $target = Normalize-PathEntry $Entry
  if (-not $target) { return $false }
  if (-not $PathValue) { return $false }

  $parts = $PathValue -split ';'
  foreach ($part in $parts) {
    if ((Normalize-PathEntry $part) -eq $target) {
      return $true
    }
  }
  return $false
}

function Ensure-NpmPrefixOnPath {
  param(
    [Parameter(Mandatory = $true)][string]$NpmPath
  )

  $prefixLine = (& $NpmPath config get prefix 2>$null | Select-Object -First 1)
  if ($LASTEXITCODE -ne 0) { return }

  $prefix = [string]$prefixLine
  if (-not $prefix) { return }
  $prefix = $prefix.Trim()
  if (-not $prefix -or $prefix -eq "undefined") { return }
  if (-not (Test-Path $prefix)) { return }

  if (-not (Test-PathContainsEntry -PathValue $env:Path -Entry $prefix)) {
    if ([string]::IsNullOrWhiteSpace($env:Path)) {
      $env:Path = $prefix
    } else {
      $env:Path = "$env:Path;$prefix"
    }
    Write-WarnLine "Added npm global bin to current PATH: $prefix"
  }

  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if (-not (Test-PathContainsEntry -PathValue $userPath -Entry $prefix)) {
    $newUserPath = if ([string]::IsNullOrWhiteSpace($userPath)) { $prefix } else { "$userPath;$prefix" }
    try {
      [Environment]::SetEnvironmentVariable("Path", $newUserPath, "User")
      Write-WarnLine "Added npm global bin to User PATH: $prefix"
      Write-WarnLine "Open a new terminal window to use 'social'."
    } catch {
      Write-WarnLine "Could not update User PATH automatically. Add this path manually: $prefix"
    }
  }
}

function Try-AutoInstallNode {
  if ($SkipNodeAutoInstall) { return }
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) { return }

  Write-Step "Node.js not found. Installing Node.js LTS with winget"
  & $winget.Source install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements --silent
  if ($LASTEXITCODE -ne 0) {
    throw "Node.js auto-install failed via winget."
  }

  # Refresh current process PATH from machine/user registry values.
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machinePath;$userPath"
}

function Install-GlobalFallback {
  param(
    [Parameter(Mandatory = $true)][string]$NpmPath,
    [Parameter(Mandatory = $true)][string]$RepoRoot
  )

  Write-WarnLine "npm link failed; trying npm pack + npm install -g fallback."

  $packOutput = (& $NpmPath pack)
  if ($LASTEXITCODE -ne 0) {
    throw "npm pack failed."
  }

  $packFile = ($packOutput | Select-Object -Last 1).Trim()
  if (-not $packFile) {
    throw "Unable to determine npm pack output file."
  }

  $packPath = Join-Path $RepoRoot $packFile
  if (-not (Test-Path $packPath)) {
    throw "Packed file not found: $packPath"
  }

  Invoke-Npm -NpmPath $NpmPath -Args @("install", "-g", $packPath)
}

$repoRoot = Split-Path -Parent $PSCommandPath
Push-Location $repoRoot
try {
  Write-Step "Starting Social CLI one-click installer"
  Write-Host "Repo: $repoRoot" -ForegroundColor Gray

  $npmPath = Resolve-NpmCommand
  if (-not $npmPath) {
    Try-AutoInstallNode
    $npmPath = Resolve-NpmCommand
  }
  if (-not $npmPath) {
    throw "npm not found. Install Node.js LTS and rerun install.cmd."
  }

  if ($ForceInstallDeps -or -not (Test-Path (Join-Path $repoRoot "node_modules"))) {
    Write-Step "Installing root dependencies"
    Invoke-Npm -NpmPath $npmPath -Args @("install", "--no-audit", "--no-fund")
  } else {
    Write-Step "Root dependencies already present (use -ForceInstallDeps to reinstall)"
  }

  if (-not $SkipTui) {
    Write-Step "Installing TUI dependencies"
    Invoke-Npm -NpmPath $npmPath -Args @("--prefix", "tools/agentic-tui", "install", "--no-audit", "--no-fund")
  }

  if (-not $SkipBuild) {
    Write-Step "Building social TypeScript targets"
    Invoke-Npm -NpmPath $npmPath -Args @("run", "build:legacy-ts")
    Invoke-Npm -NpmPath $npmPath -Args @("run", "build:social-ts")
    if (-not $SkipTui) {
      Write-Step "Building agentic TUI"
      Invoke-Npm -NpmPath $npmPath -Args @("--prefix", "tools/agentic-tui", "run", "build")
    }
  }

  if (-not $NoGlobal) {
    Write-Step "Installing global CLI command"
    try {
      Invoke-Npm -NpmPath $npmPath -Args @("link")
    } catch {
      Install-GlobalFallback -NpmPath $npmPath -RepoRoot $repoRoot
    }
    Ensure-NpmPrefixOnPath -NpmPath $npmPath
  } else {
    Write-Step "Skipping global install (-NoGlobal)"
  }

  Write-Step "Verifying install"
  $verifyHome = Join-Path $repoRoot ".social-cli-installer-check"
  if (-not (Test-Path $verifyHome)) {
    New-Item -ItemType Directory -Path $verifyHome | Out-Null
  }
  $hadSocialHome = Test-Path env:SOCIAL_CLI_HOME
  $hadMetaHome = Test-Path env:META_CLI_HOME
  $prevSocialHome = $env:SOCIAL_CLI_HOME
  $prevMetaHome = $env:META_CLI_HOME
  try {
    $env:SOCIAL_CLI_HOME = $verifyHome
    $env:META_CLI_HOME = $verifyHome

    $socialCmd = Get-Command social.cmd -ErrorAction SilentlyContinue
    if ($socialCmd) {
      & $socialCmd.Source --version
    } else {
      & node .\dist-legacy\bin\social.js --version
    }
    if ($LASTEXITCODE -ne 0) {
      throw "Unable to run social --version after install."
    }
  } finally {
    if ($hadSocialHome) { $env:SOCIAL_CLI_HOME = $prevSocialHome } else { Remove-Item env:SOCIAL_CLI_HOME -ErrorAction SilentlyContinue }
    if ($hadMetaHome) { $env:META_CLI_HOME = $prevMetaHome } else { Remove-Item env:META_CLI_HOME -ErrorAction SilentlyContinue }
    Remove-Item -Recurse -Force $verifyHome -ErrorAction SilentlyContinue
  }

  Write-Host "`nDone. Social CLI installer finished successfully." -ForegroundColor Green
  if ($NoGlobal) {
    Write-Host "Run locally: node .\dist-legacy\bin\social.js --help" -ForegroundColor Gray
  } else {
    Write-Host "Use: social --help" -ForegroundColor Gray
  }
} finally {
  Pop-Location
}
