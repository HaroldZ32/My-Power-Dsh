#!/usr/bin/env bash
# selection-probe.sh — E1-c: run docker/entrypoint.sh's OWN prompt-selection expression, extracted.
#
# The function and the default-prompt literal are EXTRACTED FROM THE SHIPPED ENTRYPOINT and never
# re-typed here, so this probe cannot pass while the file says something else. Three cases are run:
# the knob UNSET, set to the EMPTY string, and set to a marker value. The marker case is also the
# negative control: it must differ from the default byte-for-byte, so an implementation that ignored
# the knob and always returned the default would FAIL case 3, and one that always returned the knob
# (treating empty as a value) would FAIL cases 1 and 2.
#
# Usage: bash selection-probe.sh [repo-root]   (the repo root defaults to four levels up)
set -euo pipefail

# The repository root: argv[1] when given (so the probe can be run on a copy), otherwise derived from
# this script's own location inside evidence/docker/live-prompt-knob/<stamp>/.
PROBE_SELF="$(cd "$(dirname "$0")" && pwd)"
REPO="${1:-$(cd "$PROBE_SELF/../../../.." && pwd)}"
ENTRYPOINT="$REPO/docker/entrypoint.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAILS=0

# fail <message> — record a probe failure without aborting, so one run reports every case.
fail() {
  printf '[probe] FAIL %s\n' "$1"
  FAILS=$((FAILS + 1))
}

# identify <label> <value> — print a value's identity (bytes, sha256, first line) instead of dumping it.
identify() {
  printf '  %s bytes=%s sha256=%s firstLine="%s"\n' \
    "$1" \
    "$(printf '%s' "$2" | wc -c | tr -d '[:space:]')" \
    "$(printf '%s' "$2" | sha256sum | cut -d' ' -f1)" \
    "$(printf '%s' "$2" | sed -n '1p')"
}

echo "repo:              $REPO"
echo "entrypoint:        $ENTRYPOINT"
echo "entrypoint sha256: $(sha256sum "$ENTRYPOINT" | awk '{print $1}')"
echo

# ── extraction 1: the selection function, verbatim ────────────────────────────
FUNC_FIRST="$(grep -n '^live_prompt_select() {' "$ENTRYPOINT" | cut -d: -f1)"
FUNC_LAST="$(awk '/^live_prompt_select\(\) \{/{f=1} f&&/^\}$/{print NR; exit}' "$ENTRYPOINT")"
awk '/^live_prompt_select\(\) \{/{f=1} f{print} f&&/^\}$/{exit}' "$ENTRYPOINT" > "$WORK/select.sh"
if [ ! -s "$WORK/select.sh" ]; then
  echo "[probe] FATAL: no live_prompt_select function in $ENTRYPOINT" >&2
  exit 2
fi
echo "--- extracted selection expression (entrypoint lines $FUNC_FIRST..$FUNC_LAST) ---"
cat "$WORK/select.sh"
echo "--- end of extracted expression ---"
echo

# ── extraction 2: the default-prompt assignment, verbatim, evaluated as bash ──
DEFAULT_SRC="$(grep -m1 '^  LIVE_PROMPT_DEFAULT=' "$ENTRYPOINT" || true)"
if [ -z "$DEFAULT_SRC" ]; then
  echo "[probe] FATAL: no LIVE_PROMPT_DEFAULT assignment in $ENTRYPOINT" >&2
  exit 2
fi
DEFAULT_LINE_NO="$(grep -n -m1 '^  LIVE_PROMPT_DEFAULT=' "$ENTRYPOINT" | cut -d: -f1)"
# shellcheck disable=SC2086 # the SHIPPED assignment line IS the expression under test.
eval "$DEFAULT_SRC"
echo "--- extracted default literal (entrypoint line $DEFAULT_LINE_NO) ---"
printf '%s\n' "$DEFAULT_SRC"
echo "--- end of extracted literal ---"
identify "default" "$LIVE_PROMPT_DEFAULT"
echo

# The extracted function is the ONLY selection logic this probe runs.
# shellcheck source=/dev/null
. "$WORK/select.sh"

# ── the three cases ──────────────────────────────────────────────────────────
echo "=== case 1: MPD_E2E_LIVE_PROMPT UNSET ==="
unset MPD_E2E_LIVE_PROMPT
SELECTED_UNSET="$(live_prompt_select "$LIVE_PROMPT_DEFAULT" "${MPD_E2E_LIVE_PROMPT:-}")"
identify "selected" "$SELECTED_UNSET"
[ "$SELECTED_UNSET" = "$LIVE_PROMPT_DEFAULT" ] || fail "case 1: unset knob did not keep the default"
[ "$(printf '%s' "$SELECTED_UNSET" | sha256sum)" = "$(printf '%s' "$LIVE_PROMPT_DEFAULT" | sha256sum)" ] || fail "case 1: unset knob changed the default's bytes"
echo

echo "=== case 2: MPD_E2E_LIVE_PROMPT set to the EMPTY string ==="
MPD_E2E_LIVE_PROMPT=""
SELECTED_EMPTY="$(live_prompt_select "$LIVE_PROMPT_DEFAULT" "${MPD_E2E_LIVE_PROMPT:-}")"
identify "selected" "$SELECTED_EMPTY"
[ "$SELECTED_EMPTY" = "$LIVE_PROMPT_DEFAULT" ] || fail "case 2: an empty knob did not keep the default"
[ "$(printf '%s' "$SELECTED_EMPTY" | sha256sum)" = "$(printf '%s' "$LIVE_PROMPT_DEFAULT" | sha256sum)" ] || fail "case 2: an empty knob changed the default's bytes"
echo

echo "=== case 3: MPD_E2E_LIVE_PROMPT set to a MARKER (negative control) ==="
MARKER='E1-MARKER: write a playable snake game to /out/snake.html'
MPD_E2E_LIVE_PROMPT="$MARKER"
SELECTED_MARKER="$(live_prompt_select "$LIVE_PROMPT_DEFAULT" "${MPD_E2E_LIVE_PROMPT:-}")"
identify "selected" "$SELECTED_MARKER"
identify "marker  " "$MARKER"
[ "$SELECTED_MARKER" = "$MARKER" ] || fail "case 3: the marker was not substituted verbatim"
[ "$SELECTED_MARKER" != "$LIVE_PROMPT_DEFAULT" ] || fail "case 3: the marker case returned the default (negative control tripped)"
[ "$(printf '%s' "$SELECTED_MARKER" | sha256sum)" = "$(printf '%s' "$MARKER" | sha256sum)" ] || fail "case 3: the marker's bytes changed"
echo

if [ "$FAILS" -ne 0 ]; then
  printf '[probe] %s CASE(S) FAILED\n' "$FAILS"
  exit 1
fi
printf '[probe] all 3 cases passed against the extracted expression\n'
echo

# ── the EVIDENCE block step 15 actually runs (contract §2.3) ──────────────────
# The `fact`/`log` calls are deliberately OUTSIDE the extracted range: the probe runs the shipped
# computation that produces the note (override -> source label -> byte count -> first line -> note)
# and asserts the note's content, so "which prompt ran" is proven to be stated, not assumed.
echo "=== the note block step 15 runs, extracted and executed for two cases ==="
NOTE_FIRST="$(grep -n '^  LIVE_PROMPT_OVERRIDE=' "$ENTRYPOINT" | cut -d: -f1)"
NOTE_LAST="$(grep -n '^  LIVE_PROMPT_NOTE=' "$ENTRYPOINT" | cut -d: -f1)"
awk -v a="$NOTE_FIRST" -v b="$NOTE_LAST" 'NR>=a && NR<=b' "$ENTRYPOINT" > "$WORK/note.sh"
echo "--- extracted note block (entrypoint lines $NOTE_FIRST..$NOTE_LAST) ---"
cat "$WORK/note.sh"
echo "--- end of extracted note block ---"

MARKER='E1-MARKER: write a playable snake game to /out/snake.html'
MARKER_BYTES="$(printf '%s' "$MARKER" | wc -c | tr -d '[:space:]')"

MPD_E2E_LIVE_PROMPT="$MARKER"
# shellcheck source=/dev/null
. "$WORK/note.sh"
printf '  case marker: %s\n' "$LIVE_PROMPT_NOTE"
[ "$LIVE_PROMPT_SOURCE" = "caller (MPD_E2E_LIVE_PROMPT)" ] || fail "note block: marker case did not label the source as the caller"
[ "$LIVE_PROMPT_BYTES" = "$MARKER_BYTES" ] || fail "note block: marker case reported bytes=$LIVE_PROMPT_BYTES, expected $MARKER_BYTES"
[ "$LIVE_PROMPT_FIRST_LINE" = "$MARKER" ] || fail "note block: marker case's first line is not the marker"
[ "$LIVE_PROMPT" = "$MARKER" ] || fail "note block: marker case did not select the marker"
case "$LIVE_PROMPT_NOTE" in *"promptSource=caller (MPD_E2E_LIVE_PROMPT)"*) ;; *) fail "note block: the note does not name the caller source" ;; esac

DEFAULT_BYTES="$(printf '%s' "$LIVE_PROMPT_DEFAULT" | wc -c | tr -d '[:space:]')"
unset MPD_E2E_LIVE_PROMPT
# shellcheck source=/dev/null
. "$WORK/note.sh"
printf '  case unset:  %s\n' "$LIVE_PROMPT_NOTE"
[ "$LIVE_PROMPT_SOURCE" = "default" ] || fail "note block: unset case did not label the source as default"
[ "$LIVE_PROMPT_BYTES" = "$DEFAULT_BYTES" ] || fail "note block: unset case reported bytes=$LIVE_PROMPT_BYTES, expected $DEFAULT_BYTES"
[ "$LIVE_PROMPT" = "$LIVE_PROMPT_DEFAULT" ] || fail "note block: unset case did not run the default prompt"
case "$LIVE_PROMPT_NOTE" in *"promptSource=default bytes=$DEFAULT_BYTES"*) ;; *) fail "note block: the unset note does not state the default and its byte length" ;; esac
echo

if [ "$FAILS" -ne 0 ]; then
  printf '[probe] %s CHECK(S) FAILED\n' "$FAILS"
  exit 1
fi
printf '[probe] selection (3 cases) + evidence note (2 cases) all passed against extracted code\n'
