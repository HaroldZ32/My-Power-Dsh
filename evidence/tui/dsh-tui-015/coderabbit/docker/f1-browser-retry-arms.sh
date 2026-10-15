#!/usr/bin/env bash
# f1-browser-retry-arms.sh — the controls for FINDING (1): the browser mirror retry must RESET
# `BROWSER_INSTALL` before the second attempt.
#
# WHAT IS UNDER TEST: the SHIPPED retry block, EXTRACTED from `docker/entrypoint.sh` at run time (never a
# copy), so the bytes exercised are the bytes that ship. The only thing stubbed is `npx` itself — a fake
# on PATH that fails or succeeds per attempt — because the real `npx playwright install` downloads a
# ~170 MB browser and this harness must stay offline. The extracted block still runs under `bash` with
# the shipped assignments, the shipped `|| BROWSER_INSTALL=$?` capture, the shipped route string and the
# shipped retry gate.
#
# THE NEGATIVE CONTROL IS A LOCAL REVERT: the same extracted block with the `BROWSER_INSTALL=0` reset line
# removed (one line, `diff`ed below), which is the pre-fix program. On a registry sequence where the FIRST
# attempt fails and the retry SUCCEEDS, the shipped block must report install=0 and the pre-fix block must
# report the first attempt's code — that difference is the finding.
#
# NOT PROVEN HERE (stated, not implied): the real Playwright download and the CDN transport. What this
# harness drives is the shipped ROUTE/STATUS logic: the exit code the step reports, the host the later
# installs use, the route the record names, and which downstream branch that exit code selects.
#
# Usage: bash evidence/tui/dsh-tui-015/coderabbit/docker/f1-browser-retry-arms.sh
set -uo pipefail

# This driver's own directory, so the repo resolves wherever it is run from.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The repository root, five levels above this driver.
REPO="$(cd "$HERE/../../../../.." && pwd)"
# The script under test.
ENTRYPOINT="$REPO/docker/entrypoint.sh"
# The block's first line, and the `fi` that closes its retry gate — both verbatim from the shipped file.
START_MARKER='      export PLAYWRIGHT_DOWNLOAD_HOST="$PLAYWRIGHT_HOST"'
END_MARKER='      fi'
# The reset line the finding is about, at the retry block's own indentation.
RESET_LINE='        BROWSER_INSTALL=0'
# The shipped downstream predicate: an install code other than 0 is what marks every `ui.*` arm unavailable.
DOWNSTREAM_PREDICATE='if [ "$BROWSER_INSTALL" != "0" ]; then'
# A scratch root for the generated arms.
WORK="$(mktemp -d "${TMPDIR:-/tmp}/f1-browser-arms.XXXXXX")"
# How many checks disagreed with their expectation.
FAILED=0

# Check one expectation and print it.
check() {
  local name="$1" ok="$2" detail="${3:-}"
  [ "$ok" = "1" ] || FAILED=$((FAILED + 1))
  if [ -z "$detail" ]; then
    printf '[f1] %s=%s\n' "$name" "$([ "$ok" = "1" ] && echo true || echo false)"
  else
    printf '[f1] %s=%s — %s\n' "$name" "$([ "$ok" = "1" ] && echo true || echo false)" "$detail"
  fi
}

# Extract the shipped retry block: from the first `export PLAYWRIGHT_DOWNLOAD_HOST=…` to the first
# `      fi` that closes the retry gate.
BLOCK="$(awk -v start="$START_MARKER" -v end="$END_MARKER" '
  !begun && $0 == start { begun = 1 }
  begun { print; if ($0 == end) exit }
' "$ENTRYPOINT")"
# The same block with the reset line removed — the pre-fix program, one line shorter.
CONTROL_BLOCK="$(printf '%s\n' "$BLOCK" | grep -v -x "$RESET_LINE")"

check "extracted-block-is-nonempty" "$([ -n "$BLOCK" ] && echo 1 || echo 0)" "lines=$(printf '%s\n' "$BLOCK" | wc -l)"
check "extracted-block-carries-the-retry-route" "$(printf '%s\n' "$BLOCK" | grep -q 'mirror-retry-after-failure' && echo 1 || echo 0)" "the shipped block is the retry block"
check "extracted-block-carries-the-reset" "$(printf '%s\n' "$BLOCK" | grep -q -x "$RESET_LINE" && echo 1 || echo 0)" "the shipped block resets BROWSER_INSTALL before the retry"
check "control-differs-by-exactly-the-reset-line" "$([ "$(printf '%s\n' "$BLOCK" | wc -l)" -eq "$(( $(printf '%s\n' "$CONTROL_BLOCK" | wc -l) + 1 ))" ] && echo 1 || echo 0)" "shipped=$(printf '%s\n' "$BLOCK" | wc -l) control=$(printf '%s\n' "$CONTROL_BLOCK" | wc -l) lines"
check "entrypoint-carries-the-downstream-predicate" "$(grep -q -F "$DOWNSTREAM_PREDICATE" "$ENTRYPOINT" && echo 1 || echo 0)" "verbatim: $DOWNSTREAM_PREDICATE"

# Run one arm: generate a shell whose PREAMBLE seeds the shipped variables, then the extracted block
# VERBATIM, then an epilogue that reports what the block decided.
#
# $1 arm name · $2 block · $3 npx exit codes (one per attempt) · $4 initial host · $5 mirror · $6 route
run_arm() {
  local name="$1" block="$2" codes="$3" host="$4" mirror="$5" route="$6"
  local dir="$WORK/arm-$name"
  mkdir -p "$dir/ui" "$dir/bin"
  : > "$dir/browser.log"
  printf '%s\n' "$codes" | tr ' ' '\n' > "$dir/codes.txt"
  printf '0' > "$dir/calls.txt"
  # The stubbed `npx`: attempt N exits with the Nth code, and every call is traced.
  cat > "$dir/bin/npx" <<'STUB'
#!/usr/bin/env bash
n="$(cat "$STUB_STATE" 2>/dev/null || echo 0)"
n=$((n + 1))
printf '%s' "$n" > "$STUB_STATE"
code="$(sed -n "${n}p" "$STUB_CODES")"
printf 'stub-npx attempt=%s code=%s host=%s\n' "$n" "${code:-0}" "$PLAYWRIGHT_DOWNLOAD_HOST" >> "$STUB_TRACE"
exit "${code:-0}"
STUB
  chmod +x "$dir/bin/npx"
  {
    printf 'set -uo pipefail\n'
    printf 'UI_DIR=%q\n' "$dir/ui"
    printf 'BROWSER_LOG=%q\n' "$dir/browser.log"
    printf 'PLAYWRIGHT_HOST=%q\n' "$host"
    printf 'PLAYWRIGHT_MIRROR=%q\n' "$mirror"
    printf 'PLAYWRIGHT_HOST_ROUTE=%q\n' "$route"
    # The shipped flow reaches the block with BROWSER_INSTALL=0 (the npm package install succeeded).
    printf 'BROWSER_INSTALL=0\n'
    printf 'export PATH=%q\n' "$dir/bin:$PATH"
    printf 'export STUB_STATE=%q\n' "$dir/calls.txt"
    printf 'export STUB_CODES=%q\n' "$dir/codes.txt"
    printf 'export STUB_TRACE=%q\n' "$dir/trace.txt"
    printf '%s\n' "$block"
    printf 'printf "RESULT install=%%s host=%%s route=%%s calls=%%s\\n" "$BROWSER_INSTALL" "$PLAYWRIGHT_HOST" "$PLAYWRIGHT_HOST_ROUTE" "$(cat "$STUB_STATE" 2>/dev/null || echo 0)"\n'
    printf 'if [ "$BROWSER_INSTALL" != "0" ]; then echo "DOWNSTREAM=unavailable-branch"; else echo "DOWNSTREAM=lane-driven"; fi\n'
  } > "$dir/arm.sh"
  bash "$dir/arm.sh" > "$dir/out.txt" 2>&1
  printf '%s\n' "$dir"
}

# Read one `KEY=value` out of an arm's output.
field() {
  local dir="$1" key="$2"
  sed -n "s/.*\b${key}=\([^ ]*\).*/\1/p" "$dir/out.txt" | head -1
}

# ── A: the SHIPPED block, first attempt fails and the RETRY SUCCEEDS → install=0, lane driven ────────
A="$(run_arm shipped-retry-ok "$BLOCK" "7 0" "https://official.invalid" "https://mirror.invalid" "official-host-ok")"
check "A-install-0" "$([ "$(field "$A" install)" = "0" ] && echo 1 || echo 0)" "install=$(field "$A" install) (a successful retry CLEARS the failure)"
check "A-host-is-the-mirror" "$([ "$(field "$A" host)" = "https://mirror.invalid" ] && echo 1 || echo 0)" "host=$(field "$A" host)"
check "A-route-names-the-retry" "$([ "$(field "$A" route)" = "mirror-retry-after-failure" ] && echo 1 || echo 0)" "route=$(field "$A" route)"
check "A-two-npx-attempts" "$([ "$(field "$A" calls)" = "2" ] && echo 1 || echo 0)" "calls=$(field "$A" calls)"
check "A-downstream-branch-is-the-lane" "$(grep -q '^DOWNSTREAM=lane-driven$' "$A/out.txt" && echo 1 || echo 0)" "$(grep '^DOWNSTREAM=' "$A/out.txt") (the browser lane runs instead of marking all ui.* arms unavailable)"

# ── B: the SHIPPED block, BOTH attempts fail → the retry's OWN code is kept, first failure still quoted
B="$(run_arm shipped-retry-fails "$BLOCK" "7 9" "https://official.invalid" "https://mirror.invalid" "official-host-ok")"
check "B-install-is-the-retry-code" "$([ "$(field "$B" install)" = "9" ] && echo 1 || echo 0)" "install=$(field "$B" install) (the reset does not swallow the retry's failure)"
check "B-first-failure-is-quoted" "$(grep -q 'the install failed on https://official.invalid (exit 7); retrying on https://mirror.invalid' "$B/browser.log" && echo 1 || echo 0)" "$(head -1 "$B/browser.log")"
check "B-downstream-branch-is-unavailable" "$(grep -q '^DOWNSTREAM=unavailable-branch$' "$B/out.txt" && echo 1 || echo 0)" "$(grep '^DOWNSTREAM=' "$B/out.txt") (the existing failure reporting is kept)"

# ── C: the NEGATIVE CONTROL — the reset line removed locally, retry succeeds → the PRE-FIX red ───────
C="$(run_arm reverted-retry-ok "$CONTROL_BLOCK" "7 0" "https://official.invalid" "https://mirror.invalid" "official-host-ok")"
check "C-install-is-the-STALE-code" "$([ "$(field "$C" install)" = "7" ] && echo 1 || echo 0)" "install=$(field "$C" install) (a SUCCESSFUL retry still reads as failed — the reported defect)"
check "C-downstream-branch-is-unavailable" "$(grep -q '^DOWNSTREAM=unavailable-branch$' "$C/out.txt" && echo 1 || echo 0)" "$(grep '^DOWNSTREAM=' "$C/out.txt") (all ui.* arms would be reported unavailable with route=mirror-retry-after-failure)"

# ── C2: the AUTHENTIC PRE-FIX program (`git show HEAD:docker/entrypoint.sh`) → the same red ──────────
# C removes the one line from the shipped block; C2 takes the whole pre-fix block from git, so the red is
# reproduced on the bytes that were really there before this repair rather than on a reconstruction.
HEAD_BLOCK="$(git -C "$REPO" show HEAD:docker/entrypoint.sh 2>/dev/null | awk -v start="$START_MARKER" -v end="$END_MARKER" '
  !begun && $0 == start { begun = 1 }
  begun { print; if ($0 == end) exit }
')"
check "HEAD-block-extracted" "$([ -n "$HEAD_BLOCK" ] && echo 1 || echo 0)" "git show HEAD:docker/entrypoint.sh (read-only)"
check "HEAD-block-carries-NO-reset" "$(printf '%s\n' "$HEAD_BLOCK" | grep -q -x "$RESET_LINE" && echo 0 || echo 1)" "the pre-fix block never reset BROWSER_INSTALL"
C2="$(run_arm HEAD-pre-fix "$HEAD_BLOCK" "7 0" "https://official.invalid" "https://mirror.invalid" "official-host-ok")"
check "C2-install-is-the-STALE-code" "$([ "$(field "$C2" install)" = "7" ] && echo 1 || echo 0)" "install=$(field "$C2" install) (the authentic pre-fix bytes reproduce the defect)"
check "C2-downstream-branch-is-unavailable" "$(grep -q '^DOWNSTREAM=unavailable-branch$' "$C2/out.txt" && echo 1 || echo 0)" "$(grep '^DOWNSTREAM=' "$C2/out.txt")"

# ── D: the SHIPPED gate — already ON the mirror, so no retry is attempted ─────────────────────────────
D="$(run_arm shipped-already-on-mirror "$BLOCK" "7" "https://mirror.invalid" "https://mirror.invalid" "mirror-probe-ok")"
check "D-install-is-the-first-code" "$([ "$(field "$D" install)" = "7" ] && echo 1 || echo 0)" "install=$(field "$D" install)"
check "D-no-second-attempt" "$([ "$(field "$D" calls)" = "1" ] && echo 1 || echo 0)" "calls=$(field "$D" calls) (the retry gate still requires a DIFFERENT transport)"
check "D-route-untouched" "$([ "$(field "$D" route)" = "mirror-probe-ok" ] && echo 1 || echo 0)" "route=$(field "$D" route)"

printf '[f1] FAILED=%s\n' "$FAILED"
printf '[f1] workdir=%s\n' "$WORK"
[ "$FAILED" -eq 0 ] || exit 1
exit 0
