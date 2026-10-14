#Requires -Version 5.1
<#
.SYNOPSIS
  No-excuse rule checker for Go files - PowerShell twin of check-no-excuse-rules.sh.

.DESCRIPTION
  Mirrors the philosophy of the python / typescript / rust checkers: only rules that can be
  enforced by pure text matching live here. Everything semantic belongs to
  golangci-lint + nilaway + go test -race.

  Rules, reported to stderr as GitHub-Actions annotations:
    silent-err             discarding err with `_ = err` in non-test code
    panic-in-lib           panic( outside package main and outside tests
    log-fatal-in-lib       log.Fatal / log.Panic outside package main and outside tests
    no-init-func           init() functions
    time-sleep             time.Sleep in non-test code
    ctx-background-in-lib  context.Background() outside package main and outside tests
    old-interface-empty    interface{} instead of any (Go 1.18+)
    fmt-print-in-lib       fmt.Print* outside package main and outside tests
    nolint-no-reason       //nolint without a trailing `// reason`
    todo-no-owner          TODO / FIXME / XXX without a (#issue) or @owner

  An exemption marker `// no-excuse-ok: <reason>` anywhere on a line suppresses every rule
  for that line. Generated files are skipped: *.pb.go, *.connect.go, *.gen.go, *_string.go,
  or a `// Code generated ... DO NOT EDIT.` marker within the first five lines.

  Regexes are matched case-sensitively, the way bash `=~` and `case` match.

.PARAMETER Files
  The Go files to check. A path that is not an existing file, or does not end in .go, is
  skipped silently - pass files, not packages.

.EXAMPLE
  pwsh skills/programming/scripts/go/check-no-excuse-rules.ps1 ./internal/store/store.go

.NOTES
  Exit codes: 0 = clean, 1 = violations found, 2 = no arguments.
#>

[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Files
)

$ErrorActionPreference = 'Stop'

# Line-comment marker, generated-file marker, and the per-rule patterns (see the .sh twin).
$ReCodeGenerated = '^// Code generated .* DO NOT EDIT\.$'
$RePackageLine = '^package '
$ReNoExcuseOk = '//\s*no-excuse-ok:\s*.+'
$ReSilentErrBare = '^\s*_\s*=\s*err\s*$'
$ReSilentErrMore = '^\s*_\s*=\s*err\s*[^a-zA-Z0-9_].*$'
$RePanic = '[^a-zA-Z0-9_]panic\('
$RePanicFirst = '^\s*panic\('
$ReLogFatal = 'log\.(Fatal|Panic)(f|ln)?\('
$ReInitFunc = '^func\s+init\(\)\s*\{'
$ReTimeSleep = 'time\.Sleep\('
$ReCtxBackground = 'context\.Background\(\)'
$ReOldInterface = 'interface\{\}'
$ReFmtPrint = 'fmt\.(Print|Println|Printf)\('
$ReNolint = '//nolint(:|$| )'
$ReNolintReason = '//nolint:[a-zA-Z0-9_,-]+\s+//\s*[^\s]'
$ReTodo = '(TODO|FIXME|XXX)(\s|:)'
$ReTodoOwner = '(TODO|FIXME|XXX).*[(@\[]'

$script:Violations = 0

function Write-Report([string]$File, [int]$Line, [string]$Rule, [string]$Detail) {
    [Console]::Error.WriteLine("::error file=$File,line=$Line::[$Rule] $Detail")
    $script:Violations++
}

function Test-GoTestFile([string]$Path) {
    return $Path.EndsWith('_test.go')
}

function Test-GoGeneratedFile([string]$Path) {
    foreach ($suffix in @('.pb.go', '.connect.go', '.gen.go', '_string.go')) {
        if ($Path.EndsWith($suffix)) { return $true }
    }
    $head = @(Get-Content -LiteralPath $Path -TotalCount 5 -Encoding UTF8 -ErrorAction SilentlyContinue)
    foreach ($line in $head) {
        if ($line -cmatch $ReCodeGenerated) { return $true }
    }
    return $false
}

function Get-GoPackageLine([string]$Path) {
    $head = @(Get-Content -LiteralPath $Path -TotalCount 5 -Encoding UTF8 -ErrorAction SilentlyContinue)
    foreach ($line in $head) {
        if ($line -cmatch $RePackageLine) { return $line }
    }
    return ''
}

if (-not $Files -or $Files.Count -eq 0) {
    [Console]::Error.WriteLine("Usage: $PSCommandPath <file.go> [file.go ...]")
    exit 2
}

foreach ($file in $Files) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { continue }
    if (-not $file.EndsWith('.go')) { continue }
    if (Test-GoGeneratedFile $file) { continue }

    $inTest = 0
    if (Test-GoTestFile $file) { $inTest = 1 }

    # `head -n 5 | grep -m1 '^package '` once per file: the answer cannot change mid-run.
    $isMain = ((Get-GoPackageLine $file) -ceq 'package main')

    $lineNo = 0
    foreach ($line in @(Get-Content -LiteralPath $file -Encoding UTF8)) {
        $lineNo++
        $codeOnly = $line
        $commentAt = $line.IndexOf('//')
        if ($commentAt -ge 0) { $codeOnly = $line.Substring(0, $commentAt) }

        if ($line -cmatch $ReNoExcuseOk) { continue }

        if (($codeOnly -cmatch $ReSilentErrBare) -or ($codeOnly -cmatch $ReSilentErrMore)) {
            if ($inTest -eq 0) {
                Write-Report $file $lineNo 'silent-err' "discarding err with '_ = err' - handle the error"
            }
        }

        if (($codeOnly -cmatch $RePanic) -or ($codeOnly -cmatch $RePanicFirst)) {
            if ($inTest -eq 0 -and -not $isMain) {
                Write-Report $file $lineNo 'panic-in-lib' 'panic outside main/test - return error instead'
            }
        }

        if ($codeOnly -cmatch $ReLogFatal) {
            if ($inTest -eq 0 -and -not $isMain) {
                Write-Report $file $lineNo 'log-fatal-in-lib' 'log.Fatal/Panic outside main - return error'
            }
        }

        if ($codeOnly -cmatch $ReInitFunc) {
            Write-Report $file $lineNo 'no-init-func' 'init() ruins testability - use explicit constructor'
        }

        if ($codeOnly -cmatch $ReTimeSleep) {
            if ($inTest -eq 0) {
                Write-Report $file $lineNo 'time-sleep' 'time.Sleep in production code - use ticker/timer with ctx'
            }
        }

        if ($codeOnly -cmatch $ReCtxBackground) {
            if ($inTest -eq 0 -and -not $isMain) {
                Write-Report $file $lineNo 'ctx-background-in-lib' 'context.Background() outside main - propagate ctx as parameter'
            }
        }

        if ($codeOnly -cmatch $ReOldInterface) {
            Write-Report $file $lineNo 'old-interface-empty' "use 'any' instead of 'interface{}' (Go 1.18+)"
        }

        if ($codeOnly -cmatch $ReFmtPrint) {
            if ($inTest -eq 0 -and -not $isMain) {
                Write-Report $file $lineNo 'fmt-print-in-lib' 'fmt.Print* in library - use slog for structured logs'
            }
        }

        if ($line -cmatch $ReNolint) {
            if (-not ($line -cmatch $ReNolintReason)) {
                Write-Report $file $lineNo 'nolint-no-reason' '//nolint requires a // reason after the linter list'
            }
        }

        if ($line -cmatch $ReTodo) {
            if (-not ($line -cmatch $ReTodoOwner)) {
                Write-Report $file $lineNo 'todo-no-owner' 'TODO/FIXME requires (#issue) or @owner attribution'
            }
        }
    }
}

if ($script:Violations -gt 0) {
    [Console]::Error.WriteLine('')
    [Console]::Error.WriteLine("go-programmer: $($script:Violations) violation(s). Run also:")
    [Console]::Error.WriteLine('  gofumpt -l .')
    [Console]::Error.WriteLine('  golangci-lint run --timeout 5m ./...')
    [Console]::Error.WriteLine('  nilaway ./...')
    [Console]::Error.WriteLine('  go test -race -shuffle=on -count=1 ./...')
    exit 1
}

Write-Output "go-programmer: no-excuse rules passed for $($Files.Count) file(s)."
