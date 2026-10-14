#Requires -Version 5.1
<#
.SYNOPSIS
  Install or upgrade uv on Windows.

.DESCRIPTION
  PowerShell twin of scripts/setup-uv.sh. Upgrades an existing uv (uv self update, then
  winget), or installs it through the official installer with a winget fallback, makes
  %USERPROFILE%\.local\bin resolvable for this session, and verifies with `uv --version`.

  The bash twin refuses to run under Git Bash / MSYS / Cygwin and points here instead; on
  macOS and Linux use `bash scripts/setup-uv.sh`.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/setup-uv.ps1

.NOTES
  Exit codes: 0 = uv is on PATH, 1 = uv could not be installed or found.
#>

[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Step([string]$Message) { Write-Host "[setup-uv] $Message" }

Write-Step "detected os=$([System.Runtime.InteropServices.RuntimeInformation]::OSDescription) arch=$([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture)"

$uv = Get-Command uv -ErrorAction SilentlyContinue
if ($null -ne $uv) {
    $current = (& uv --version) | Select-Object -First 1
    Write-Step "uv already installed ($current) - upgrading"
    & uv self update 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Step "uv self update unavailable (package-manager install) - trying winget"
        if (Get-Command winget -ErrorAction SilentlyContinue) {
            & winget upgrade --id=astral-sh.uv -e --accept-source-agreements --accept-package-agreements 2>$null
            if ($LASTEXITCODE -ne 0) { & winget install --id=astral-sh.uv -e --accept-source-agreements --accept-package-agreements }
        } else {
            Write-Step "no winget; keeping current uv (already functional)"
        }
    }
} else {
    Write-Step "uv not found - installing latest via the official installer"
    $installed = $false
    try {
        powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
        $installed = $true
    } catch {
        Write-Step "official installer failed ($($_.Exception.Message)) - trying winget"
        if (Get-Command winget -ErrorAction SilentlyContinue) {
            & winget install --id=astral-sh.uv -e --accept-source-agreements --accept-package-agreements
            $installed = ($LASTEXITCODE -eq 0)
        }
    }
    if (-not $installed -and $null -eq (Get-Command uv -ErrorAction SilentlyContinue)) {
        Write-Step "FAIL: could not install uv - install it manually per references/uv-setup.md"
        exit 1
    }
}

if ($null -eq (Get-Command uv -ErrorAction SilentlyContinue)) {
    $localBin = Join-Path $env:USERPROFILE '.local\bin'
    if (Test-Path (Join-Path $localBin 'uv.exe')) { $env:Path = "$localBin;$env:Path" }
}

if ($null -eq (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Step "FAIL: uv still not on PATH after install - add %USERPROFILE%\.local\bin to PATH and retry"
    exit 1
}

Write-Step "OK: $((& uv --version) | Select-Object -First 1)"
