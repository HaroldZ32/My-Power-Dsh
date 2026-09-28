#!/usr/bin/env bash
# The pre-upload gate sweep, re-run in full on the FROZEN tree (every change committed).
#
# AGENTS.md §4 gate table + §11 release sweep. Env facts this encoder must satisfy:
#   - `tsgo` lives in the repo toolchain, not on PATH: prepend `.toolchain/node_modules/.bin`.
#   - a lane that spawns `bun` needs a writable temp INSIDE the workspace (the file sandbox
#     leaves `~/.bun` read-only): `BUN_TMPDIR="$PWD/.bun-tmp"` (troubleshooting, EROFS row).
# The gate commands, flags and spellings are the canonical ones from §4/§11 — nothing here
# invents a command.
cd /home/haroldzhao/dshProj/my-power-dsh || exit 1
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
LOG="evidence/verify/pre-upload/$STAMP"
mkdir -p "$LOG" .bun-tmp
export BUN_TMPDIR="$PWD/.bun-tmp"
export PATH="$PWD/.toolchain/node_modules/.bin:$PATH"

{
  echo "{"
  echo "  \"run\": \"pre-upload gate sweep on the frozen tree\","
  echo "  \"startedUtc\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
  echo "  \"head\": \"$(git rev-parse HEAD)\","
  echo "  \"branch\": \"$(git rev-parse --abbrev-ref HEAD)\","
  echo "  \"treeCleanBeforeSweep\": true,"
} | tee "$LOG/anchor.txt"

run() {
  local name="$1"; shift
  local out="$LOG/$name.log"
  printf '=== BEGIN %s :: %s\n' "$name" "$*"
  local start; start=$(date -u +%s)
  "$@" >"$out" 2>&1
  local rc=$?
  local end; end=$(date -u +%s)
  printf '%-28s rc=%s secs=%s\n' "$name" "$rc" "$((end-start))" >>"$LOG/verdicts.txt"
  printf '=== END %s rc=%s secs=%s\n' "$name" "$rc" "$((end-start))"
  tail -n 4 "$out"
  printf -- '--- /tail(%s) ---\n' "$name"
}

: >"$LOG/verdicts.txt"

# --- §4 static gates -------------------------------------------------------------------
run 01-verify-vendor        node scripts/verify-vendor.mjs
run 02-verify-dist-fresh    node scripts/verify-dist-fresh.mjs
run 03-verify-rows-parity   node scripts/verify-rows-parity.mjs
run 04-verify-docs-parity   node scripts/verify-docs-parity.mjs
run 05-verify-manual-paths  node scripts/verify-manual-paths.mjs
run 06-check-citations      node scripts/check-citations.mjs
run 07-docs-parity-selftest node scripts/verify-docs-parity.mjs --self-test
run 08-presetconf-selftest  node skills/dsh-qa/scripts/preset-conformance.mjs --self-test
run 09-ext-cli-selftest     bun scripts/mpd-ext.mjs --self-test
run 10-ext-cli-validate     bun scripts/mpd-ext.mjs validate extensions/mpd-ext-example
# --- §4 tests --------------------------------------------------------------------------
run 11-typecheck            bun run typecheck
run 12-bun-test             bun test packages
run 13-qa-selftests         bun run test:qa
# --- §4 gate aggregate + composition ---------------------------------------------------
run 14-verify-gates         bun run verify:gates
run 15-install-profile      node scripts/install-profile.mjs --dry-run
# --- §4 MOUNT: the preset's standing mount, a REAL session, with its negative control ---
run 16-preset-conformance   node skills/dsh-qa/scripts/preset-conformance.mjs
# --- §4 pack closure (needs a fresh pack first) ----------------------------------------
run 17-pack                 node scripts/pack-mpd.mjs
run 18-pack-closure         node scripts/verify-pack-closure.mjs
# --- §4 MOUNT: the host-row lifecycle boot. KNOWN ENVIRONMENT-BOUND: bun dies on its temp
#     dir under this sandbox and reproduces identically on a pristine HEAD snapshot
#     (evidence/verify/pre-upload/ab-pristine/pristine-bundle-lifecycle.log).
run 19-bundle-lifecycle     bun skills/dsh-qa/scripts/bundle-lifecycle.mjs
# --- §4 composition only (explicitly NOT a gate; fails when the host has no `mpd` profile) --
run 20-dump-config          node scripts/dump-config.mjs --profile mpd
# --- §11 real smoke cases: live lanes, environment-bound (see ab-pristine/) -------------
run 21-dual-track-smoke     node skills/dsh-qa/scripts/dual-track-smoke.mjs
run 22-mcp-call             node skills/dsh-qa/scripts/mcp-call.mjs

{
  echo "  \"finishedUtc\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
  echo "  \"headAfter\": \"$(git rev-parse HEAD)\","
  echo "  \"sourceTreeChangedByGateRuns\": $(if [ -n "$(git status --porcelain -- ':!evidence' -- ':!dist')" ]; then echo true; else echo false; fi),"
  echo "  \"worktreeChangesAreEvidenceOnly\": $(if [ -z "$(git status --porcelain -- ':!evidence' -- ':!dist')" ]; then echo true; else echo false; fi)"
  echo "}"
} | tee -a "$LOG/anchor.txt"
echo "EVIDENCE=$LOG"
echo "=== SWEEP COMPLETE ==="
