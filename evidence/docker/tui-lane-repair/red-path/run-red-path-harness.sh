#!/usr/bin/env bash
# RED-path harness for the Docker TUI lane (docker/tui-lane.sh), FROZEN at
# sha256 226cdb1c84b9eff09a3260aa9aec33abe40bacb87358c833dcb5db9557094b00.
#
# WHY THIS EXISTS
#   The independent verdict evidence/docker/tui-lane-verify/2026-10-08T12-06Z/verdict.md recorded FAIL on
#   one point (finding F1, §5.4): every run of the repaired lane was GREEN, so the repaired RED ending —
#   the terminal `tui.laneExit false` record plus the ABSENCE of the second, false `abort=exit-…` record
#   — was never observed, and §6.3 adds that the genuine-abort branch the same predicate guards was
#   never observed either. A green run cannot distinguish the repaired lane from the broken one, because
#   the EXIT net's guard is never reached.
#
# HOW IT IS FAITHFUL
#   This harness neither copies, paraphrases nor rewrites any of the lane's decision logic. It EXTRACTS
#   two byte ranges out of the frozen file itself (revision pinned by sha256, required tokens asserted
#   before use) and runs them in a real bash under the lane's own `set -uo pipefail`:
#     * prologue  — `json_escape`, `record`, the ERR trap handler `on_err` and the EXIT net `on_exit`:
#                   everything that decides WHICH records get published, installed at the same point in
#                   the script's lifetime as the lane installs them (before its first arm at line 172);
#     * epilogue  — the real terminal summary: the awk census over STATE_FILE, the green/red branch and
#                   the red ending `record tui.laneExit false …; LANE_EXIT_RECORDED=1; exit 1`.
#   The arms differ ONLY in what the lane would have reached before that ending, and they record that
#   through the lane's OWN `record` function with the lane's OWN 21 arm names. Nothing about the
#   container's arm bodies (npm / dsh / tmux / probes) touches the predicate under test: the predicate
#   reads the exit status of the script and the value of LANE_EXIT_RECORDED, nothing else.
#
#   The one stand-in is the scratch environment (STATE_FILE and the three path variables the lane
#   requires); every arm writes its own state file under arms/<arm-name>/.
#
# ARMS
#   d-green   all 21 arms true                      -> expect the green ending, exit 0, no abort claim
#   a-red     the four fixture arms false (the       -> expect the RED ending, exit 1, NO abort record
#             2026-10-08 08:52 baseline state)          (this is the repaired behaviour, half 1)
#   b-exitnet a `set -u` unbound-variable abort      -> expect the EXIT net to publish
#             (the lane's own 2026-10-06 incident)      `abort=exit-1 net=EXIT-trap` (half 2)
#   c-errtrap an unguarded step failing with code 9  -> expect the ERR trap to publish the abort and the
#             (the shape of lane line 172)              the EXIT net to stay silent (half 2)
#   a-red-nofix  FALSIFIABILITY CONTROL, NOT EVIDENCE ABOUT THE LANE: the a-red arm with the ONE line
#             `LANE_EXIT_RECORDED=1` deleted from the extracted epilogue -> the harness must then
#             reproduce the PRE-REPAIR double report (`abort=exit-1 net=EXIT-trap` beside the terminal
#             record), i.e. the measured 2026-10-08T08-52-23Z baseline defect. Without this arm the
#             harness could be rigged to pass; with it, the harness is shown able to fail.
#
# Usage: bash evidence/docker/tui-lane-repair/red-path/run-red-path-harness.sh
set -uo pipefail

EXPECTED_LANE_SHA="226cdb1c84b9eff09a3260aa9aec33abe40bacb87358c833dcb5db9557094b00"
OUT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$OUT/../../../.." && pwd)"
LANE="$REPO_ROOT/docker/tui-lane.sh"
EXTRACT="$OUT/extracted"
ARMS_DIR="$OUT/arms"

FAILURES=0
assert() {
  local label="$1" got="$2" want="$3"
  if [ "$got" = "$want" ]; then
    printf 'ASSERT PASS  %-62s got=%s\n' "$label" "$got"
  else
    printf 'ASSERT FAIL  %-62s got=[%s] want=[%s]\n' "$label" "$got" "$want"
    FAILURES=$((FAILURES + 1))
  fi
}
assert_zero() {
  local label="$1" got="$2"
  if [ "$got" = "0" ]; then
    printf 'ASSERT PASS  %-62s got=%s\n' "$label" "$got"
  else
    printf 'ASSERT FAIL  %-62s got=[%s] want=[0]\n' "$label" "$got"
    FAILURES=$((FAILURES + 1))
  fi
}
# matches <file> <fixed-string> — the COUNT of matching lines; `grep -c` prints 0 on a no-match exit.
matches() { grep -cF -- "$2" "$1" 2>/dev/null || true; }

printf '=== RED-path harness for the Docker TUI lane ===\n'
printf 'harness=%s\n' "$OUT/run-red-path-harness.sh"
printf 'harness sha256=%s\n' "$(sha256sum "$OUT/run-red-path-harness.sh" | awk '{print $1}')"
printf 'bash=%s\n\n' "$(bash --version | head -1)"

# ── 1. the frozen artifact ────────────────────────────────────────────────────────────────────────
printf -- '--- 1. the frozen artifact ---\n'
ACTUAL_LANE_SHA="$(sha256sum "$LANE" | awk '{print $1}')"
printf 'lane=%s\nlane sha256=%s\nexpected sha256=%s\n' "$LANE" "$ACTUAL_LANE_SHA" "$EXPECTED_LANE_SHA"
if [ "$ACTUAL_LANE_SHA" != "$EXPECTED_LANE_SHA" ]; then
  printf 'REFUSING: the lane is not at the frozen revision; every observation below would be void.\n'
  exit 2
fi
printf 'lane sha256 matches the freeze (FROZEN, unmodified by this harness: this file only ever READS it).\n\n'

# ── 2. extract the two byte ranges from the frozen file ───────────────────────────────────────────
printf -- '--- 2. extracted byte ranges (verbatim, no rewriting) ---\n'
mkdir -p "$EXTRACT" "$ARMS_DIR"
awk '/^json_escape\(\) \{/,/^trap .on_exit. EXIT$/' "$LANE" > "$EXTRACT/prologue.sh"
awk '/^# Summarise: every tui\.\* record this lane owns/,0' "$LANE" > "$EXTRACT/epilogue.sh"
printf 'prologue.sh: %s lines, sha256=%s\n  first=[%s]\n  last =[%s]\n' \
  "$(wc -l < "$EXTRACT/prologue.sh")" "$(sha256sum "$EXTRACT/prologue.sh" | awk '{print $1}')" \
  "$(head -1 "$EXTRACT/prologue.sh")" "$(tail -1 "$EXTRACT/prologue.sh")"
printf 'epilogue.sh: %s lines, sha256=%s\n  first=[%s]\n  last =[%s]\n\n' \
  "$(wc -l < "$EXTRACT/epilogue.sh")" "$(sha256sum "$EXTRACT/epilogue.sh" | awk '{print $1}')" \
  "$(head -1 "$EXTRACT/epilogue.sh")" "$(tail -1 "$EXTRACT/epilogue.sh")"

printf -- '--- 2b. the extracted text carries the mechanism under test ---\n'
for token in 'record() {' 'LANE_EXIT_RECORDED=0' "trap 'on_err' ERR" "trap 'on_exit' EXIT" 'abort=exit-$code net=EXIT-trap'; do
  assert "prologue carries: $token" "$(matches "$EXTRACT/prologue.sh" "$token")" "1"
done
for token in 'TUI_SUMMARY=' '"name":"tui\.' 'LANE_EXIT_RECORDED=1' 'exit 1'; do
  assert "epilogue carries: $token" "$(matches "$EXTRACT/epilogue.sh" "$token")" "1"
done
printf '\n'

# ── 3. emit the arms ──────────────────────────────────────────────────────────────────────────────
# The 21 arm names this lane writes before its terminal record, read out of the frozen file.
LANE_ARMS=(
  tui.hostInstall tui.pluginAddHost tui.pluginAddBundle tui.compose tui.presetPreference tui.presetRow
  tui.mpdTuiRow tui.agentTeamRows tui.teamFixtureBound tui.teamSceneOtherSessionInvisible
  tui.teamSceneOpened tui.teamGraphDrawn tui.teamGraphEdges tui.teamGraphContent tui.mergedPanelOpens
  tui.mergedPanelOrder tui.hostDashboardKeyIntact tui.noDirectTuiSeam tui.boot tui.noFatalSignatures
  tui.sessionPreset
)
printf -- '--- 3. arm generation ---\n'
assert "the lane writes 21 tui.* arm records before its terminal record" "${#LANE_ARMS[@]}" "21"

emit_seeds() {
  local bad=" $1 " name status
  for name in "${LANE_ARMS[@]}"; do
    status=true
    case "$bad" in *" $name "*) status=false ;; esac
    printf 'record %s %s "arm seed: this lane arm ran and recorded through the lane own record helper" "seed=red-path-harness"\n' "$name" "$status"
  done
}

emit_arm() {
  local arm="$1" bad="$2" kind="$3" dir="$ARMS_DIR/$1"
  mkdir -p "$dir"
  {
    printf '#!/usr/bin/env bash\n'
    printf '# GENERATED by run-red-path-harness.sh — arm %s. Regenerate; do not edit.\n' "$arm"
    printf '# The prologue and epilogue blocks are EXTRACTED VERBATIM from the frozen docker/tui-lane.sh.\n'
    printf 'set -uo pipefail\n'
    printf 'ARM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"\n'
    printf 'STATE_FILE="$ARM_DIR/state.jsonl"\n'
    printf 'FACTS_FILE="$ARM_DIR/facts.txt"\n'
    printf 'APP_DIR="$ARM_DIR/app"\n'
    printf 'WORK_DIR="$ARM_DIR/work"\n'
    printf 'TUI_DIR="$ARM_DIR/tui"\n'
    printf 'mkdir -p "$APP_DIR" "$WORK_DIR" "$TUI_DIR"\n'
    printf ': > "$STATE_FILE"\n'
    printf '\n# ── extracted prologue: the reporting helper and BOTH nets ──\n'
  } > "$dir/arm.sh"
  cat "$EXTRACT/prologue.sh" >> "$dir/arm.sh"
  printf '\n# ── arm body: what this run of the lane reached ──\n' >> "$dir/arm.sh"
  emit_seeds "$bad" >> "$dir/arm.sh"
  case "$kind" in
    terminal)
      printf '\n# ── extracted epilogue: the real terminal summary and the real ending ──\n' >> "$dir/arm.sh"
      cat "$EXTRACT/epilogue.sh" >> "$dir/arm.sh"
      ;;
    terminal-nofix)
      printf '\n# ── extracted epilogue with the repair line DELETED (falsifiability control only) ──\n' >> "$dir/arm.sh"
      grep -v '^LANE_EXIT_RECORDED=1$' "$EXTRACT/epilogue.sh" >> "$dir/arm.sh"
      ;;
    exit-net)
      printf '\n# ── genuine abort, EXIT-net class: the lane 2026-10-06 measured incident (set -u unbound) ──\n' >> "$dir/arm.sh"
      printf 'printf "%%s" "$MERGED_TITLE_HITS"\n' >> "$dir/arm.sh"
      ;;
    err-trap)
      printf '\n# ── genuine abort, ERR-trap class: an UNGUARDED step fails (the shape of lane line 172) ──\n' >> "$dir/arm.sh"
      printf 'node -e "process.exit(9)"\n' >> "$dir/arm.sh"
      ;;
  esac
  chmod +x "$dir/arm.sh"
}

emit_arm d-green "" terminal
emit_arm a-red "tui.teamSceneOpened tui.teamGraphDrawn tui.teamGraphEdges tui.teamGraphContent" terminal
emit_arm b-exitnet "" exit-net
emit_arm c-errtrap "" err-trap
emit_arm a-red-nofix "tui.teamSceneOpened tui.teamGraphDrawn tui.teamGraphEdges tui.teamGraphContent" terminal-nofix
printf 'arms written under %s\n\n' "$ARMS_DIR"

run_arm() {
  local dir="$ARMS_DIR/$1"
  bash "$dir/arm.sh" > "$dir/console.log" 2> "$dir/console.err"
  printf '%s' "$?" > "$dir/exit-code.txt"
}

# ── 4. ARM d-green: the control that the harness reproduces the wave's own GREEN record ───────────
printf -- '--- 4. ARM d-green — the wave GREEN ending (fidelity control) ---\n'
run_arm d-green
D_DIR="$ARMS_DIR/d-green"
printf 'process exit=%s\n' "$(cat "$D_DIR/exit-code.txt")"
printf 'console.log:\n'
cat "$D_DIR/console.log"
printf 'state.jsonl (tui.laneExit only):\n'
grep -F '"name":"tui.laneExit"' "$D_DIR/state.jsonl" || true
assert "d-green process exit" "$(cat "$D_DIR/exit-code.txt")" "0"
assert "d-green tui.laneExit records written" "$(matches "$D_DIR/state.jsonl" '"name":"tui.laneExit"')" "1"
assert "d-green terminal record is the all-green one" "$(matches "$D_DIR/state.jsonl" '"ok":true')" "22"
assert_zero "d-green abort claims anywhere" "$(matches "$D_DIR/console.log" 'abort=')"
printf '\n'

# ── 5. ARM a-red: THE REPAIRED BEHAVIOUR (half 1) ─────────────────────────────────────────────────
printf -- '--- 5. ARM a-red — an ORDINARY red terminal exit (half 1, the repaired behaviour) ---\n'
run_arm a-red
A_DIR="$ARMS_DIR/a-red"
printf 'process exit=%s\n' "$(cat "$A_DIR/exit-code.txt")"
printf 'console.log:\n'
cat "$A_DIR/console.log"
printf 'state.jsonl (tui.laneExit + the four red arms):\n'
grep -F '"name":"tui.laneExit"' "$A_DIR/state.jsonl" || true
grep -F '"name":"tui.teamSceneOpened"' "$A_DIR/state.jsonl" || true
grep -F '"name":"tui.teamGraphDrawn"' "$A_DIR/state.jsonl" || true
grep -F '"name":"tui.teamGraphEdges"' "$A_DIR/state.jsonl" || true
grep -F '"name":"tui.teamGraphContent"' "$A_DIR/state.jsonl" || true
printf 'the lane OWN summary line (records/failed) as written by the epilogue awk census:\n'
grep -F 'records=21 failed=4' "$A_DIR/state.jsonl" || true
assert "a-red process exit" "$(cat "$A_DIR/exit-code.txt")" "1"
assert "a-red tui.laneExit records written (exactly ONE record)" "$(matches "$A_DIR/state.jsonl" '"name":"tui.laneExit"')" "1"
assert "a-red terminal record says the lane FINISHED with failing assertions" "$(matches "$A_DIR/state.jsonl" 'the TUI lane finished with failing or missing assertions')" "1"
assert "a-red the terminal record counts records=21 failed=4" "$(matches "$A_DIR/state.jsonl" 'records=21 failed=4')" "1"
assert_zero "a-red abort=exit- claims in console.log (half 1)" "$(matches "$A_DIR/console.log" 'abort=exit-')"
assert_zero "a-red abort=exit- claims in state.jsonl (half 1)" "$(matches "$A_DIR/state.jsonl" 'abort=exit-')"
assert_zero "a-red EXIT-net claims anywhere" "$(matches "$A_DIR/console.log" 'net=EXIT-trap')"
printf '\n'

# ── 6. ARM b-exitnet: GENUINE ABORT, EXIT-net class (half 2) ──────────────────────────────────────
printf -- '--- 6. ARM b-exitnet — a GENUINE abort the ERR trap cannot see (half 2) ---\n'
run_arm b-exitnet
B_DIR="$ARMS_DIR/b-exitnet"
printf 'process exit=%s\n' "$(cat "$B_DIR/exit-code.txt")"
printf 'console.err:\n'
cat "$B_DIR/console.err"
printf 'console.log:\n'
cat "$B_DIR/console.log"
printf 'state.jsonl (tui.laneExit):\n'
grep -F '"name":"tui.laneExit"' "$B_DIR/state.jsonl" || true
assert "b-exitnet process exit" "$(cat "$B_DIR/exit-code.txt")" "1"
assert "b-exitnet the EXIT net PUBLISHED the abort record" "$(matches "$B_DIR/state.jsonl" 'abort=exit-1 net=EXIT-trap')" "1"
assert "b-exitnet the abort record must not claim a completed run" "$(matches "$B_DIR/state.jsonl" 'without the ERR trap seeing it')" "1"
printf '\n'

# ── 7. ARM c-errtrap: GENUINE ABORT, ERR-trap class (half 2) ──────────────────────────────────────
printf -- '--- 7. ARM c-errtrap — a GENUINE abort the ERR trap DOES see (half 2) ---\n'
run_arm c-errtrap
C_DIR="$ARMS_DIR/c-errtrap"
printf 'process exit=%s\n' "$(cat "$C_DIR/exit-code.txt")"
printf 'console.log:\n'
cat "$C_DIR/console.log"
printf 'state.jsonl (tui.laneExit):\n'
grep -F '"name":"tui.laneExit"' "$C_DIR/state.jsonl" || true
assert "c-errtrap process exit (the failing step code 9 is preserved)" "$(cat "$C_DIR/exit-code.txt")" "9"
assert "c-errtrap the ERR trap PUBLISHED the abort record" "$(matches "$C_DIR/state.jsonl" 'the TUI lane aborted (exit 9)')" "1"
assert "c-errtrap exactly ONE tui.laneExit record (no double-report)" "$(matches "$C_DIR/state.jsonl" '"name":"tui.laneExit"')" "1"
assert_zero "c-errtrap the EXIT net did NOT add a second record" "$(matches "$C_DIR/state.jsonl" 'net=EXIT-trap')"
printf '\n'

# ── 8. ARM a-red-nofix: FALSIFIABILITY CONTROL (must reproduce the pre-repair double report) ──────
printf -- '--- 8. ARM a-red-nofix — the same red run with the ONE repair line deleted (control) ---\n'
run_arm a-red-nofix
N_DIR="$ARMS_DIR/a-red-nofix"
printf 'process exit=%s\n' "$(cat "$N_DIR/exit-code.txt")"
printf 'BOTH tui.laneExit records this arm wrote (the double report):\n'
grep -F '"name":"tui.laneExit"' "$N_DIR/state.jsonl" || true
assert "a-red-nofix process exit" "$(cat "$N_DIR/exit-code.txt")" "1"
assert "a-red-nofix TWO tui.laneExit records (the pre-repair double report)" "$(matches "$N_DIR/state.jsonl" '"name":"tui.laneExit"')" "2"
assert "a-red-nofix the SECOND record is the false abort claim" "$(matches "$N_DIR/state.jsonl" 'abort=exit-1 net=EXIT-trap')" "1"
assert "a-red-nofix the FIRST record still says the lane finished with failures" "$(matches "$N_DIR/state.jsonl" 'the TUI lane finished with failing or missing assertions')" "1"
printf 'CONTROL READING: the harness CAN fail — deleting `LANE_EXIT_RECORDED=1` from the red ending\n'
printf 'reproduces the measured 2026-10-08T08-52-23Z defect, so the a-red reading above is caused by\n'
printf 'that line and not by the harness being unable to observe an abort.\n\n'

# ── 9. verdict of the harness itself ──────────────────────────────────────────────────────────────
printf -- '--- 9. harness verdict ---\n'
printf 'assertions failed=%d\n' "$FAILURES"
printf 'lane sha256 after all arms=%s\n' "$(sha256sum "$LANE" | awk '{print $1}')"
if [ "$FAILURES" = "0" ]; then printf 'HARNESS RESULT: PASS (every paired observation held)\n'; else printf 'HARNESS RESULT: FAIL (%d assertion(s) red)\n' "$FAILURES"; fi
exit "$FAILURES"
