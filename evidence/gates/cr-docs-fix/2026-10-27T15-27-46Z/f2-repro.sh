#!/usr/bin/env bash
# f2-repro.sh — the executable criterion for finding F2 (duplicate `append_step` for step 14b).
#
# WHAT IT DOES. It runs the REAL `append_step` and `run_step` functions extracted from the file under
# test, twice:
#   BEFORE  the sequence committed at HEAD (`git show HEAD:docker/entrypoint.sh`), i.e. `run_step …`
#           followed by the explicit `append_step 14b-user-surface …`;
#   AFTER   the sequence in the working tree, which calls `run_step …` and nothing else.
# The subject is `$STEPS_INDEX` — the same file the report reads — so the assertion is a row count on
# the artifact, not a reading of the source.
#
# Usage: bash f2-repro.sh   (from the repo root; exits 0 only when BEFORE=2 rows and AFTER=1 row)
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

log() { :; }                       # the entrypoint's logger is irrelevant to the row count
source_functions() {               # $1 = entrypoint text, sourced functions into this shell
  eval "$(awk '/^append_step\(\)/,/^}/' "$1")"
  eval "$(awk '/^run_step\(\)/,/^}/' "$1")"
}

run_case() {                       # $1 = label, $2 = entrypoint text, $3 = shell snippet
  STEPS_DIR="$WORK/$1/steps"; mkdir -p "$STEPS_DIR"
  STEPS_INDEX="$WORK/$1/steps.tsv"; : > "$STEPS_INDEX"
  STEP_TIMEOUT=60
  # The variables the 14b block reads, set the way the entrypoint sets them before it runs the block.
  APP_DIR="$ROOT"; STATE_FILE="$WORK/$1/state.ndjson"; : > "$STATE_FILE"
  OUT_DIR="$WORK/$1/out"; mkdir -p "$OUT_DIR/us"
  USER_SURFACE_PROFILE="$WORK/$1/profile"; mkdir -p "$USER_SURFACE_PROFILE"
  source_functions "$2"
  ( eval "$3" ) >"$WORK/$1/stdout.log" 2>&1
  printf '\n[%s] STEPS_INDEX rows=%s\n' "$1" "$(wc -l < "$STEPS_INDEX" | tr -d ' ')"
  sed -n '1,4p' "$WORK/$1/stdout.log" | sed "s/^/[$1 stdout] /"
  printf '[%s] step ids in order: %s\n' "$1" "$(cut -f1 "$STEPS_INDEX" | paste -sd, -)"
  printf '[%s] counted: %s\n' "$1" "$(cut -f1 "$STEPS_INDEX" | sort | uniq -c | awk '{printf "%s x%s; ", $2, $1}')"
  printf '[%s] raw steps.tsv (id<TAB>exit<TAB>seconds<TAB>log<TAB>cmd):\n' "$1"
  cut -f1,2 "$STEPS_INDEX" | sed "s/^/[$1 row] /"
}

git -C "$ROOT" show HEAD:docker/entrypoint.sh >"$WORK/pre.sh"
BEFORE_SNIPPET="$(sed -n '/^  run_step 14b-user-surface/,/^  append_step 14b-user-surface/p' "$WORK/pre.sh")"
AFTER_SNIPPET="$(sed -n '/^  run_step 14b-user-surface/,/--ndjson-out "\$STATE_FILE"/p' "$ROOT/docker/entrypoint.sh")"

printf '=== BEFORE: the sequence at HEAD (git show HEAD:docker/entrypoint.sh) ===\n%s\n' "$BEFORE_SNIPPET"
printf '=== AFTER: the sequence in the working tree (docker/entrypoint.sh) ===\n%s\n' "$AFTER_SNIPPET"

run_case before "$WORK/pre.sh" "$BEFORE_SNIPPET"
run_case after "$ROOT/docker/entrypoint.sh" "$AFTER_SNIPPET"
run_case after_else_arm "$ROOT/docker/entrypoint.sh" \
  'append_step 14b-user-surface 1 0 "14b-user-surface.log" "node skills/dsh-qa/scripts/user-surface-mount.ts (profile absent)"'

before_rows=$(wc -l <"$WORK/before/steps.tsv" | tr -d ' ')
after_rows=$(wc -l <"$WORK/after/steps.tsv" | tr -d ' ')
else_rows=$(wc -l <"$WORK/after_else_arm/steps.tsv" | tr -d ' ')
printf '\n[verdict] before=%s after=%s else-arm=%s\n' "$before_rows" "$after_rows" "$else_rows"
if [ "$before_rows" = 2 ] && [ "$after_rows" = 1 ] && [ "$else_rows" = 1 ]; then
  printf '[verdict] PASS — the duplicate row is gone and the non-`run_step` else arm still writes its own row\n'
  exit 0
fi
printf '[verdict] FAIL — expected before=2, after=1, else-arm=1\n'
exit 1
