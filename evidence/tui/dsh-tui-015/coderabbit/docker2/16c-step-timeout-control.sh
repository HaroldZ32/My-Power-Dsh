#!/usr/bin/env bash
# 16c-owed-cases STEP-BUDGET CONTROL — wave fix/coderabbit-pr42, docker lane, item (3).
#
# WHAT THIS IS, AND WHAT IT IS NOT: a SHELL-TEXT + BEHAVIOURAL control, never a Docker run. No image is
# built and no container boots. It extracts the SHIPPED bytes of `docker/entrypoint.sh` (the `run_step`
# function, the `STEP_TIMEOUT` default, the 16c call site), assembles them into a throwaway harness whose
# PATH carries a RECORDING `timeout` shim, and asserts the argv the shipped code really hands to
# `timeout` — the budget the step would get. The shim exits 0 without executing the child, so nothing is
# installed and no case runs.
#
# ARMS (green unless marked red)
#   G1 shipped         the 16c call site carries the raised budget constant
#   G2 behaviour       the shipped prelude + shipped run_step hand `3600` to `timeout` (recorded argv)
#   G3 ordering        that budget EXCEEDS the case's OWN npm budget, read live from mcp-call.ts
#   G4 log             the raise is LOGGED with the value it replaced (900 s)
#   G5 operator        MPD_E2E_STEP_TIMEOUT=5000 still WINS: the raised value is a FLOOR, not a cap
#   G6 driver pins     the two literals `scripts/docker-e2e.ts --self-test` pins inside `run_step` survive
#   R1 red / numeric   the shipped block with 3600 reverted to the OLD 900 -> G2/G3 must FAIL
#   R2 red / pre-fix   the AUTHENTIC pre-fix bytes (`git show HEAD:…`) -> G2/G3 must FAIL
#   R3 control-of-control  red=R1 differs from shipped by EXACTLY the 3600->900 substitution
#
# Usage: bash 16c-step-timeout-control.sh   (cwd = repository root; writes only under $TMPDIR)
set -uo pipefail

REPO="${REPO:-$(pwd)}"
ENTRYPOINT="$REPO/docker/entrypoint.sh"
CASE="$REPO/skills/dsh-qa/scripts/mcp-call.ts"
RAISED_EXPECTED=3600
WORK="$(mktemp -d "${TMPDIR:-/tmp}/16c-budget-control.XXXXXX")"
SHIM_DIR="$WORK/bin"
HEAD_COPY="$WORK/head-entrypoint.sh"
FAILED=0

mkdir -p "$SHIM_DIR" "$WORK/steps"
# The recording `timeout`: it writes the argv it was handed, then exits 0 WITHOUT running the child.
# `$@` EXCLUDES the script name, so the budget — `timeout <opts> <budget> <cmd…>` — lands at index 1.
cat > "$SHIM_DIR/timeout" <<'SHIM'
#!/usr/bin/env bash
i=0
for a in "$@"; do printf '%d\t%s\n' "$i" "$a"; i=$((i + 1)); done > "$TIMEOUT_SHIM_RECORD"
exit 0
SHIM
chmod +x "$SHIM_DIR/timeout"

printf '[16c-budget] workdir=%s\n' "$WORK"
printf '[16c-budget] entrypoint=%s sha256=%s\n' "$ENTRYPOINT" "$(sha256sum "$ENTRYPOINT" | cut -d' ' -f1)"
printf '[16c-budget] case-budget-source=%s sha256=%s\n' "$CASE" "$(sha256sum "$CASE" | cut -d' ' -f1)"

# assertion recorder: every arm prints one line and a non-`true` counts.
assert() { # assert <arm> <true|false> <detail>
  printf '[16c-budget] %s=%s — %s\n' "$1" "$2" "$3"
  [ "$2" = true ] || FAILED=$((FAILED + 1))
}

# line_of <ere> <file> — the FIRST matching line number, which is what the extractor anchors on.
line_of() { grep -nE -- "$1" "$2" | head -n1 | cut -d: -f1; }

# fn_of <name> <file> — the whole SHIPPED `name() { … }`, one-liner or multi-line body alike.
fn_of() {
  local start end
  start="$(line_of "^$1\\(\\) \\{" "$2")"
  [ -n "$start" ] || return 1
  if sed -n "${start}p" "$2" | grep -q '}$'; then
    sed -n "${start}p" "$2"
  else
    end="$(awk -v s="$start" 'NR>=s && /^\}$/ {print NR; exit}' "$2")"
    sed -n "${start},${end}p" "$2"
  fi
}

# build_harness <source-file> <mode> <out> — assemble the shipped pieces into a runnable harness.
#   shipped     = the shipped default line + the shipped 16c prelude + the shipped call site
#   numeric-red = `shipped`, with ONLY the raised constant reverted to the OLD 900
#   prefix-red  = the pre-fix call site alone (no prelude), i.e. the 900 s default decides
build_harness() {
  local src="$1" mode="$2" out="$3" call_start call_end prelude_start
  call_start="$(line_of '^run_step 16c-owed-cases' "$src")"
  call_end=$((call_start + 1))
  {
    printf '%s\n' '#!/usr/bin/env bash' 'set -uo pipefail'
    printf '%s\n' 'STEPS_DIR="$WORK/steps"; mkdir -p "$STEPS_DIR"'
    printf '%s\n' 'STATE_FILE="$WORK/state.ndjson"; STEPS_INDEX="$WORK/steps.tsv"; : > "$STATE_FILE"; : > "$STEPS_INDEX"'
    printf '%s\n' 'LIB_DIR=/opt/mpd-e2e/lib; APP_DIR=/opt/app; OUT_DIR="$WORK/out"; QA_HOME="$WORK/qa-home"; mkdir -p "$OUT_DIR"'
    fn_of log "$src"
    fn_of append_step "$src"
    fn_of run_step "$src"
    sed -n "$(line_of '^STEP_TIMEOUT="\$\{MPD_E2E_STEP_TIMEOUT:-[0-9]+\}"$' "$src")p" "$src"
    case "$mode" in
      shipped | numeric-red)
        prelude_start="$(line_of '^OWED_CASES_TIMEOUT=[0-9]+$' "$src")"
        sed -n "${prelude_start},$((call_start - 1))p" "$src"
        ;;
      prefix-red) ;; # deliberately NO prelude: the pre-fix bytes are the bare call site
    esac
    sed -n "${call_start},${call_end}p" "$src"
  } > "$out"
  if [ "$mode" = numeric-red ]; then sed -i 's/^OWED_CASES_TIMEOUT=3600$/OWED_CASES_TIMEOUT=900/' "$out"; fi
  return 0
}

# budget_of <harness> <tag> [env args…] — runs it and echoes the budget argv the shim recorded.
budget_of() {
  local harness="$1" tag="$2"; shift 2
  local rec="$WORK/record-$tag.txt"
  : > "$rec"
  ( export TIMEOUT_SHIM_RECORD="$rec" PATH="$SHIM_DIR:$PATH" WORK="$WORK"; env "$@" bash "$harness" ) \
    > "$WORK/log-$tag.txt" 2>&1
  awk -F'\t' '$1==1 {print $2; exit}' "$rec"
}

# ── the bytes under control ──────────────────────────────────────────────────────────────────────
build_harness "$ENTRYPOINT" shipped "$WORK/shipped.sh"
build_harness "$ENTRYPOINT" numeric-red "$WORK/numeric-red.sh"
git -C "$REPO" show HEAD:docker/entrypoint.sh > "$HEAD_COPY" 2>/dev/null
printf '[16c-budget] pre-fix-bytes=git show HEAD:docker/entrypoint.sh sha256=%s\n' "$(sha256sum "$HEAD_COPY" | cut -d' ' -f1)"
build_harness "$HEAD_COPY" prefix-red "$WORK/prefix-red.sh"

for h in shipped numeric-red prefix-red; do
  if bash -n "$WORK/$h.sh"; then :; else assert "harness-$h-parses" false "the assembled harness does not parse"; fi
done

# ── G1: the shipped call site carries the raised constant ────────────────────────────────────────
PRELUDE_START="$(line_of '^OWED_CASES_TIMEOUT=[0-9]+$' "$ENTRYPOINT")"
CALL_START="$(line_of '^run_step 16c-owed-cases' "$ENTRYPOINT")"
SHIPPED_PRELUDE="$(sed -n "${PRELUDE_START},$((CALL_START - 1))p" "$ENTRYPOINT")"
if printf '%s\n' "$SHIPPED_PRELUDE" | grep -qE '^OWED_CASES_TIMEOUT=3600$'; then
  assert G1-shipped-carries-the-raised-budget true \
    "verbatim: $(printf '%s' "$SHIPPED_PRELUDE" | grep -E '^OWED_CASES_TIMEOUT=' | head -n1) (entrypoint lines ${PRELUDE_START}..$((CALL_START - 1)))"
else
  assert G1-shipped-carries-the-raised-budget false "the 16c prelude does not carry OWED_CASES_TIMEOUT=3600"
fi

# ── G2: the shipped code hands the raised budget to `timeout` (recorded argv, child never runs) ──
G2="$(budget_of "$WORK/shipped.sh" shipped -u MPD_E2E_STEP_TIMEOUT)"
assert G2-shipped-hands-3600-to-timeout "$([ "$G2" = "$RAISED_EXPECTED" ] && echo true || echo false)" \
  "recorded timeout argv index 1 = ${G2:-<none>}"
printf '[16c-budget]   G2-timeout-argv='; paste -sd'|' "$WORK/record-shipped.txt"
printf '[16c-budget]   G2-harness-log='; grep -F 'budget raised' "$WORK/log-shipped.txt" || printf '<no raise logged>\n'

# ── G3: the ORDERING — the step budget must exceed the case's OWN npm budget ─────────────────────
CASE_MS="$(grep -oE 'const INSTALL_TIMEOUT_MS = [0-9]+' "$CASE" | grep -oE '[0-9]+$')"
CASE_S="$((CASE_MS / 1000))"
assert G3-step-exceeds-the-cases-own-budget "$([ "${G2:-0}" -gt "$CASE_S" ] && echo true || echo false)" \
  "step=${G2}s vs case=${CASE_S}s (INSTALL_TIMEOUT_MS=${CASE_MS} ms read from $(basename "$CASE"))"

# ── G4: the raise is logged WITH the value it replaced ───────────────────────────────────────────
if grep -qF 'budget raised from 900s to 3600s' "$WORK/log-shipped.txt"; then
  assert G4-raise-is-logged-with-the-old-value true "observed: $(grep -F 'budget raised' "$WORK/log-shipped.txt" | head -n1)"
else
  assert G4-raise-is-logged-with-the-old-value false "no 'budget raised from 900s to 3600s' line in the harness log"
fi

# ── G5: an operator's LARGER global budget still wins (the raise is a floor, not a cap) ──────────
G5="$(budget_of "$WORK/shipped.sh" operator MPD_E2E_STEP_TIMEOUT=5000)"
assert G5-operators-larger-budget-still-wins "$([ "$G5" = 5000 ] && echo true || echo false)" \
  "MPD_E2E_STEP_TIMEOUT=5000 -> recorded timeout budget=${G5:-<none>}s"

# ── G6: the two literals the docker-e2e driver self-test pins inside `run_step` survive ──────────
if grep -qF 'timeout --kill-after=15 "$STEP_TIMEOUT"' "$ENTRYPOINT" && grep -qF 'KILLED BY THE ${STEP_TIMEOUT}s STEP TIMEOUT' "$ENTRYPOINT"; then
  assert G6-driver-pinned-literals-survive true \
    'run_step still carries `timeout --kill-after=15 "$STEP_TIMEOUT"` and `KILLED BY THE ${STEP_TIMEOUT}s STEP TIMEOUT` (the two literals scripts/docker-e2e.ts --self-test pins, checks 8c.5)'
else
  assert G6-driver-pinned-literals-survive false "a literal scripts/docker-e2e.ts --self-test pins is gone from run_step"
fi

# ── R1: RED — the SAME shipped block with 3600 reverted to the OLD 900 ───────────────────────────
R1="$(budget_of "$WORK/numeric-red.sh" numeric-red -u MPD_E2E_STEP_TIMEOUT)"
assert R1-red-numeric-effective-budget-is-the-old-value "$([ "$R1" = 900 ] && echo true || echo false)" \
  "3600->900 in the prelude -> recorded timeout budget=${R1:-<none>}s (the value the shipped bytes produced before the fix)"
assert R1-red-numeric-fails-the-ordering-arm "$([ "${R1:-0}" -gt "$CASE_S" ] && echo false || echo true)" \
  "with ${R1}s the G3 ordering arm reads false against the case's ${CASE_S}s budget"

# ── R2: RED — the AUTHENTIC pre-fix bytes (git show HEAD), whose 900 s default decides ────────────
R2="$(budget_of "$WORK/prefix-red.sh" prefix-red -u MPD_E2E_STEP_TIMEOUT)"
assert R2-red-prefix-effective-budget-is-the-old-value "$([ "$R2" = 900 ] && echo true || echo false)" \
  "git show HEAD:docker/entrypoint.sh (no prelude) -> the default applies -> recorded timeout budget=${R2:-<none>}s"
if grep -qF 'budget raised' "$WORK/log-prefix-red.txt"; then
  assert R2-red-prefix-logs-no-raise false "the pre-fix bytes must not log a raise"
else
  assert R2-red-prefix-logs-no-raise true "the pre-fix bytes log no raise (there is nothing to raise)"
fi

# ── R3: control-of-control — R1 differs from shipped by EXACTLY the numeric substitution ─────────
DIFF_LINES="$(diff <(sed 's/^OWED_CASES_TIMEOUT=3600$/OWED_CASES_TIMEOUT=900/' "$WORK/shipped.sh") "$WORK/numeric-red.sh" | wc -l)"
assert R3-red-touches-nothing-but-the-number "$([ "$DIFF_LINES" -eq 0 ] && echo true || echo false)" \
  "numeric-red == shipped with the single 3600->900 substitution (diff lines=${DIFF_LINES})"

printf '[16c-budget] FAILED=%d\n' "$FAILED"
printf '[16c-budget] workdir-kept=%s\n' "$WORK"
exit "$([ "$FAILED" -eq 0 ] && echo 0 || echo 1)"
