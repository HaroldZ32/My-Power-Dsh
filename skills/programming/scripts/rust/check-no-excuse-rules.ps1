#Requires -Version 5.1
<#
.SYNOPSIS
  No-excuse rule checker for Rust files - PowerShell twin of check-no-excuse-rules.sh.

.DESCRIPTION
  Only rules that can be enforced by pure text matching live here. Everything semantic is on
  clippy + miri + nextest.

  Rules, reported to stderr as GitHub-Actions annotations:
    unwrap                    .unwrap() outside tests, unless the previous line carries
                              #[expect(clippy::unwrap_used, reason = "...")]
    expect                    .expect() outside tests, unless the previous line carries
                              #[expect(clippy::expect_used, reason = "...")]
    placeholder-macro         todo!/unimplemented!/unreachable! in committed code
    box-dyn-error             Box<dyn Error> in non-test code
    lib-panic                 panic!() in library code
    discarded-result          `let _ = call(...)`, unless the previous line carries
                              #[expect(clippy::let_underscore_must_use, reason = "...")]
    blocking-in-async         std::thread::sleep / std::fs / reqwest::blocking / .blocking_*()
                              inside an async fn or async block
    unsafe-no-safety-comment  unsafe { without // SAFETY: in the preceding 5 lines
    allow-attribute           #[allow(...)] - silence lints with #[expect(lint, reason)]
    expect-without-reason     #[expect(...)] with no `reason = "..."`
    narrowing-as-cast         possible narrowing numeric `as` cast

  Exempt: paths under tests/, benches/, examples/, build.rs, *_test.rs, and #[cfg(test)]
  regions, tracked by brace depth from the #[cfg(test)] marker.

  Regexes and path globs are matched case-sensitively, the way bash `=~` and `case` match.

.PARAMETER Files
  The Rust files to check. A path that is not an existing file, or does not end in .rs, is
  skipped silently - pass files, not packages.

.EXAMPLE
  pwsh skills/programming/scripts/rust/check-no-excuse-rules.ps1 ./src/lib.rs ./src/main.rs

.NOTES
  Exit codes: 0 = clean, 1 = violations found, 2 = no arguments.
#>

[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Files
)

$ErrorActionPreference = 'Stop'

# Region markers, exemption markers, and the per-rule patterns (see the .sh twin).
$ReCfgTest = '#\[cfg\(test\)\]'
$ReAsync = '(^|[^a-zA-Z0-9_])async(\s+(move\s*)?\{|\s+(unsafe\s+)?fn\s)'
$ReUnwrap = '\.unwrap\(\)'
$ReExpect = '\.expect\('
$ReExpectUnwrapAttr = '#\[expect\(clippy::unwrap_used,.*reason'
$ReExpectUsedAttr = '#\[expect\(clippy::expect_used,.*reason'
$ReExpectLetUnderscoreAttr = '#\[expect\(clippy::let_underscore_must_use,.*reason'
$RePlaceholder = '(todo!|unimplemented!|unreachable!|unreachable_unchecked!)'
$ReBoxDynError = 'Box<dyn\s+Error'
$RePanic = 'panic!\('
$ReDiscardedResult = 'let\s+_\s*=\s*[^;]*\('
$ReBlocking = '(thread::sleep\(|std::fs::|reqwest::blocking::|\.blocking_(recv|send|lock|read|write)\()'
$ReUnsafeBlock = 'unsafe\s*\{'
$ReSafety = '//\s*SAFETY:'
$ReAllowAttr = '#!?\[allow\('
$ReExpectAttr = '#!?\[expect\('
$ReHasReason = 'reason\s*='
$ReNarrowingCast = '(u16|u32|u64|u128|usize|i16|i32|i64|i128|isize)\s+as\s+(u8|u16|u32|i8|i16|i32)([^a-zA-Z0-9_]|$)'

$script:Violations = 0

function Write-Report([string]$File, [int]$Line, [string]$Rule, [string]$Detail) {
    [Console]::Error.WriteLine("::error file=$File,line=$Line::[$Rule] $Detail")
    $script:Violations++
}

function Get-CharCount([string]$Text, [string]$Char) {
    $count = 0
    foreach ($c in $Text.ToCharArray()) {
        if ([string]$c -ceq $Char) { $count++ }
    }
    return $count
}

function Get-LineWindow([string[]]$Lines, [int]$Start, [int]$Count) {
    if ($Start -lt 0) { $Start = 0 }
    $end = $Start + $Count - 1
    if ($end -gt ($Lines.Count - 1)) { $end = $Lines.Count - 1 }
    if ($end -lt $Start) { return '' }
    return ($Lines[$Start..$end] -join "`n")
}

function Test-RustTestPath([string]$Path) {
    # Normalize separators: the twin's globs are spelled with forward slashes.
    $norm = $Path -replace '\\', '/'
    $patterns = @('*/tests/*', '*/benches/*', '*/examples/*', '*/build.rs', '*_test.rs', 'tests/*', 'benches/*', 'examples/*')
    foreach ($pattern in $patterns) {
        if ($norm -clike $pattern) { return $true }
    }
    return $false
}

function Test-RustLibPath([string]$Path) {
    $norm = $Path -replace '\\', '/'
    if ($norm -clike '*/src/lib.rs') { return $true }
    if ($norm -clike '*/src/*/mod.rs') { return $true }
    if ($norm -clike '*/src/*.rs' -and $norm -cnotlike '*/src/main.rs' -and $norm -cnotlike '*/src/bin/*') {
        return $true
    }
    return $false
}

if (-not $Files -or $Files.Count -eq 0) {
    [Console]::Error.WriteLine("Usage: $PSCommandPath <file.rs> [file.rs ...]")
    exit 2
}

foreach ($file in $Files) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { continue }
    if (-not $file.EndsWith('.rs')) { continue }

    $inTestFile = 0
    if (Test-RustTestPath $file) { $inTestFile = 1 }
    $isLibFile = Test-RustLibPath $file

    $lines = @(Get-Content -LiteralPath $file -Encoding UTF8)
    $total = $lines.Count

    # Brace-tracked regions: a region opens at its marker line and closes once the braces
    # opened after that marker are balanced again.
    $inCfgTest = 0; $cfgDepth = 0; $cfgOpened = 0
    $inAsync = 0; $asyncDepth = 0; $asyncOpened = 0

    for ($i = 0; $i -lt $total; $i++) {
        $lineNo = $i + 1
        $line = $lines[$i]
        $prev = ''
        if ($i -gt 0) { $prev = $lines[$i - 1] }

        $codeOnly = $line
        $commentAt = $line.IndexOf('//')
        if ($commentAt -ge 0) { $codeOnly = $line.Substring(0, $commentAt) }

        $opens = Get-CharCount $codeOnly '{'
        $closes = Get-CharCount $codeOnly '}'

        if ($line -cmatch $ReCfgTest) {
            $inCfgTest = 1; $cfgDepth = 0; $cfgOpened = 0
        }
        if ($inCfgTest -eq 1) {
            $cfgDepth = $cfgDepth + $opens - $closes
            if ($opens -gt 0) { $cfgOpened = 1 }
            if ($cfgOpened -eq 1 -and $cfgDepth -le 0) { $inCfgTest = 0 }
        }

        if ($inAsync -eq 0 -and $codeOnly -cmatch $ReAsync) {
            $inAsync = 1; $asyncDepth = 0; $asyncOpened = 0
        }
        $asyncLine = $inAsync
        if ($inAsync -eq 1) {
            $asyncDepth = $asyncDepth + $opens - $closes
            if ($opens -gt 0) { $asyncOpened = 1 }
            if ($asyncOpened -eq 1 -and $asyncDepth -le 0) { $inAsync = 0 }
        }

        $exempt = 0
        if ($inTestFile -eq 1) { $exempt = 1 }
        if ($inCfgTest -eq 1) { $exempt = 1 }

        if ($exempt -eq 0) {
            if (($codeOnly -cmatch $ReUnwrap) -and -not ($prev -cmatch $ReExpectUnwrapAttr)) {
                Write-Report $file $lineNo 'unwrap' '.unwrap() outside tests - use ? / ok_or / let-else, or for a proven invariant use .expect() behind #[expect(clippy::expect_used, reason = "...")]'
            }

            if (($codeOnly -cmatch $ReExpect) -and -not ($prev -cmatch $ReExpectUsedAttr)) {
                Write-Report $file $lineNo 'expect' '.expect() outside tests - use ?, or for a proven invariant annotate the previous line with #[expect(clippy::expect_used, reason = "...")]'
            }

            if ($codeOnly -cmatch $RePlaceholder) {
                Write-Report $file $lineNo 'placeholder-macro' 'todo!/unimplemented!/unreachable! in committed code'
            }

            if ($codeOnly -cmatch $ReBoxDynError) {
                Write-Report $file $lineNo 'box-dyn-error' 'Box<dyn Error> in non-test code - use anyhow::Error (apps) or thiserror enum (libs)'
            }

            if ($isLibFile -and ($codeOnly -cmatch $RePanic)) {
                Write-Report $file $lineNo 'lib-panic' 'panic!() in library code - return Result'
            }

            if (($codeOnly -cmatch $ReDiscardedResult) -and -not ($prev -cmatch $ReExpectLetUnderscoreAttr)) {
                Write-Report $file $lineNo 'discarded-result' 'let _ = call() drops its result - propagate or handle the error; log it on a best-effort path'
            }

            if ($asyncLine -eq 1 -and ($codeOnly -cmatch $ReBlocking)) {
                Write-Report $file $lineNo 'blocking-in-async' 'blocking call inside async code - use tokio::time::sleep / tokio::fs / the async client, or move it into spawn_blocking'
            }
        }

        if ($codeOnly -cmatch $ReUnsafeBlock) {
            $start = 0
            if ($i -gt 5) { $start = $i - 5 }
            $window = Get-LineWindow $lines $start ($i - $start + 1)
            if (-not ($window -cmatch $ReSafety)) {
                Write-Report $file $lineNo 'unsafe-no-safety-comment' 'unsafe block without // SAFETY: comment in preceding 5 lines'
            }
        }

        if ($codeOnly -cmatch $ReAllowAttr) {
            Write-Report $file $lineNo 'allow-attribute' '#[allow(...)] - use #[expect(lint, reason = "...")] so the exception fails once the lint stops firing'
        }

        if ($codeOnly -cmatch $ReExpectAttr) {
            $attr = Get-LineWindow $lines $i 4
            if (-not ($attr -cmatch $ReHasReason)) {
                Write-Report $file $lineNo 'expect-without-reason' '#[expect(...)] needs reason = "..." naming why the lint does not apply'
            }
        }

        # Heuristic flag for human review; exact analysis belongs to clippy::cast_possible_truncation.
        if ($codeOnly -cmatch $ReNarrowingCast) {
            Write-Report $file $lineNo 'narrowing-as-cast' "possible narrowing 'as' cast - use TryFrom / try_into() for fallible conversion"
        }
    }
}

if ($script:Violations -gt 0) {
    [Console]::Error.WriteLine('')
    [Console]::Error.WriteLine("rust-programmer: $($script:Violations) violation(s). Fix before declaring work done.")
    [Console]::Error.WriteLine('')
    [Console]::Error.WriteLine('Then run the full toolchain gate:')
    [Console]::Error.WriteLine('  cargo fmt --all -- --check')
    [Console]::Error.WriteLine('  cargo clippy --all-targets --all-features -- -D warnings')
    [Console]::Error.WriteLine('  cargo nextest run --all-targets --all-features && cargo test --doc')
    [Console]::Error.WriteLine('  cargo +nightly miri nextest run --all-features    # if unsafe touched')
    [Console]::Error.WriteLine('  cargo machete')
    [Console]::Error.WriteLine('  cargo deny check')
    exit 1
}

Write-Output "rust-programmer: no-excuse rules passed for $($Files.Count) file(s)."
