#Requires -Version 5.1
<#
.SYNOPSIS
  Install polars + pyarrow for one Python interpreter into a user-level cache.

.DESCRIPTION
  PowerShell twin of scripts/ensure-py-deps.sh. Installs polars and pyarrow into a cache
  directory keyed to the interpreter's version tag (cp311, cp312, ...) and writes that site
  directory to the SUCCESS stream as the ONLY stdout line; every log line goes to stderr.
  The interpreter itself is never mutated - it is frequently an externally managed system
  Python. Idempotent - a re-run reuses the existing install.

  Pass the interpreter the kernel actually runs (for a kernel, its sys.executable):

    $site = & scripts/ensure-py-deps.ps1 $python
    # then, inside the kernel: sys.path.insert(0, "<the printed directory>")

  The cache root is $env:MPD_DATA_SCIENTIST_CACHE when set, otherwise
  $HOME\.cache\mpd-data-scientist - the same knob the bash twin reads.

.PARAMETER PythonBin
  The Python executable to install for. Default: python3.

.EXAMPLE
  $site = & scripts/ensure-py-deps.ps1 (Get-Command python).Source

.NOTES
  Requires uv on PATH - see references/uv-setup.md.
  Exit codes: 0 = site directory printed, 1 = uv/python missing or no polars landed.
#>

[CmdletBinding()]
param(
    [string]$PythonBin = 'python3'
)

$ErrorActionPreference = 'Stop'

function Write-Log([string]$Message) {
    [Console]::Error.WriteLine("[ensure-py-deps] $Message")
}

function Test-PythonBin([string]$Candidate) {
    if (Get-Command $Candidate -ErrorAction SilentlyContinue) { return $true }
    if (Test-Path -LiteralPath $Candidate -PathType Leaf) { return $true }
    return $false
}

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Log 'uv is required (see references/uv-setup.md); install it first.'
    exit 1
}

if (-not (Test-PythonBin $PythonBin)) {
    Write-Log "python executable not found: $PythonBin"
    exit 1
}

$tag = & $PythonBin -c 'import sys; print(f"cp{sys.version_info[0]}{sys.version_info[1]}")'
if ($LASTEXITCODE -ne 0) {
    Write-Log "not a working python interpreter: $PythonBin"
    exit 1
}
$tag = ("$tag").Trim()

$cacheDir = if ($env:MPD_DATA_SCIENTIST_CACHE) {
    $env:MPD_DATA_SCIENTIST_CACHE
} else {
    Join-Path (Join-Path $HOME '.cache') 'mpd-data-scientist'
}
$siteDir = Join-Path $cacheDir "py-$tag"
$polars = Join-Path $siteDir 'polars'
$pyarrow = Join-Path $siteDir 'pyarrow'

$hasPolars = Test-Path -LiteralPath $polars -PathType Container
$hasPyarrow = Test-Path -LiteralPath $pyarrow -PathType Container

if (-not $hasPolars -or -not $hasPyarrow) {
    Write-Log "installing polars + pyarrow for $tag into $siteDir"
    New-Item -ItemType Directory -Path $siteDir -Force | Out-Null

    $uvOutput = & uv pip install --python $PythonBin --target $siteDir polars pyarrow
    $uvExit = $LASTEXITCODE
    # stdout is reserved for the site directory; uv's chatter belongs on stderr.
    if ($uvOutput) { [Console]::Error.WriteLine(($uvOutput -join [Environment]::NewLine)) }
    if ($uvExit -ne 0) {
        Write-Log "uv pip install failed (exit $uvExit); inspect $siteDir"
        exit 1
    }
}

if (-not (Test-Path -LiteralPath $polars -PathType Container)) {
    Write-Log "install finished but $siteDir/polars is missing; inspect $siteDir"
    exit 1
}

Write-Output $siteDir
