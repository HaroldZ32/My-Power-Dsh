#!/usr/bin/env bash
# The wave's final authoritative sweep, run by the captain on the FROZEN revision.
# Every gate records its own exit code; the run never stops at the first red so one
# pass shows the whole board. Raw output -> output.log, the board -> summary.txt.
# NOTE: must be launched as a MANAGED background job (run_in_background), never with
# nohup inside a bash call: the sandbox is bwrap --die-with-parent, so a detached child
# dies with the call that started it (measured 2026-09-16: a nohup'd sweep died mid-run
# with its summary half-written).
cd "$(dirname "$0")/../../../.." || exit 99
LOG="$(dirname "$0")/output.log"; SUM="$(dirname "$0")/summary.txt"
: > "$LOG"; : > "$SUM"
run() {
  local name="$1"; shift
  local out; out="$(mktemp)"; local t0=$SECONDS
  echo "## $name :: $*" >> "$LOG"
  "$@" >> "$out" 2>&1; local code=$?
  cat "$out" >> "$LOG"; echo >> "$LOG"
  printf '%-20s exit=%-3s %4ss  %s\n' "$name" "$code" "$((SECONDS-t0))" "$(tail -1 "$out" | cut -c1-95)" >> "$SUM"
  rm -f "$out"
  return $code
}
{ echo "revision: $(git rev-parse --short HEAD) + working tree"
  echo "started : $(date -u +%Y-%m-%dT%H:%M:%SZ)"; echo; } >> "$SUM"
run typecheck        bun run typecheck
run vendor           node scripts/verify-vendor.mjs
run unit-tests       bun test packages
run qa-self-tests    bun run test:qa
run docs-pair-gate   bun run verify:docs
run rows-parity      node scripts/verify-rows-parity.mjs
run adopted-delta    node scripts/patch-agent-teams-fixes.mjs --check
run installer-dry    node scripts/install-profile.mjs --dry-run
run ext-cli-selftest bun scripts/mpd-ext.mjs --self-test
run ext-cli-validate bun scripts/mpd-ext.mjs validate extensions/mpd-ext-example
run boot-rows        bun skills/dsh-qa/scripts/bundle-lifecycle.mjs
run preset-mount     node skills/dsh-qa/scripts/preset-conformance.mjs
run lane-heartbeat   node skills/dsh-qa/scripts/team-watchdog-heartbeat.mjs
{ echo; echo "finished: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "reds    : $(grep -c 'exit=[^0]' "$SUM")"; } >> "$SUM"
