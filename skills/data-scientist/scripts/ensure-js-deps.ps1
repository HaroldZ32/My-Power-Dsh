#Requires -Version 5.1
<#
.SYNOPSIS
  Install @duckdb/node-api into a user-level cache and print its absolute import path.

.DESCRIPTION
  PowerShell twin of scripts/ensure-js-deps.sh. Installs the DuckDB Node API into a cache
  outside any repository, then writes the absolute path of its entry module to the SUCCESS
  stream as the ONLY stdout line; every log line goes to stderr. Idempotent - a re-run reuses
  the existing install.

  The cache root is $env:MPD_DATA_SCIENTIST_CACHE when set, otherwise
  $HOME\.cache\mpd-data-scientist - the same knob the bash twin reads.

.EXAMPLE
  $importPath = & scripts/ensure-js-deps.ps1
  # then, inside the Bun kernel: const { DuckDBInstance } = await import("<the printed path>")

.NOTES
  Requires bun (https://bun.sh) on PATH.
  Exit codes: 0 = path printed, 1 = bun missing or the install produced no entry module.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

function Write-Log([string]$Message) {
    [Console]::Error.WriteLine("[ensure-js-deps] $Message")
}

$cacheDir = if ($env:MPD_DATA_SCIENTIST_CACHE) {
    $env:MPD_DATA_SCIENTIST_CACHE
} else {
    Join-Path (Join-Path $HOME '.cache') 'mpd-data-scientist'
}
# Forward slashes after the cache root keep the printed path usable inside a JS import().
$importPath = Join-Path $cacheDir 'node_modules/@duckdb/node-api/lib/index.js'

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Write-Log 'bun is required (https://bun.sh); install it, or use the uv lane instead.'
    exit 1
}

if (-not (Test-Path -LiteralPath $importPath -PathType Leaf)) {
    Write-Log "installing @duckdb/node-api into $cacheDir"
    New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null

    $packageJson = Join-Path $cacheDir 'package.json'
    if (-not (Test-Path -LiteralPath $packageJson -PathType Leaf)) {
        # ASCII keeps the file BOM-free; a BOM would make the JSON unreadable to bun.
        $packageJsonBody = '{"name":"mpd-data-scientist-cache","private":true}'
        Set-Content -LiteralPath $packageJson -Value $packageJsonBody -Encoding Ascii
    }

    Push-Location -LiteralPath $cacheDir
    try {
        $bunOutput = & bun add '@duckdb/node-api'
        $bunExit = $LASTEXITCODE
    } finally {
        Pop-Location
    }
    # bun writes progress to stderr already; move its stdout there too so stdout stays clean.
    if ($bunOutput) { [Console]::Error.WriteLine(($bunOutput -join [Environment]::NewLine)) }
    if ($bunExit -ne 0) {
        Write-Log "bun add failed (exit $bunExit); inspect $cacheDir"
        exit 1
    }
}

if (-not (Test-Path -LiteralPath $importPath -PathType Leaf)) {
    Write-Log "install finished but $importPath is missing; inspect $cacheDir"
    exit 1
}

Write-Output $importPath
