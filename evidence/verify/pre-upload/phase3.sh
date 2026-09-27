#!/usr/bin/env bash
# Phase 3 gate sweep: MOUNT boots, pack closure, composition, real smoke cases.
# AGENTS.md §4 gate table + §11 release sweep. Run from the repo root.
cd /home/haroldzhao/dshProj/my-power-dsh || exit 1
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
LOG="evidence/verify/pre-upload/$STAMP"
mkdir -p "$LOG" .bun-tmp
export BUN_TMPDIR="$PWD/.bun-tmp"

echo "STAMP=$STAMP"
{
  echo "gate sweep start $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "worktree sha256 (git status --porcelain | git hash-object --stdin): $(git status --porcelain | git hash-object --stdin)"
  echo "HEAD: $(git rev-parse HEAD) ($(git rev-parse --abbrev-ref HEAD))"
} | tee "$LOG/anchor.txt"

run() {
  local name="$1"; shift
  local out="$LOG/$name.log"
  echo "=== BEGIN $name :: $* ==="
  local start; start=$(date -u +%s)
  "$@" >"$out" 2>&1
  local rc=$?
  local end; end=$(date -u +%s)
  echo "$name rc=$rc secs=$((end-start))" >>"$LOG/verdicts.txt"
  echo "=== END $name rc=$rc secs=$((end-start)) ==="
  tail -n 8 "$out"
  echo "--- /tail($name) ---"
}

: >"$LOG/verdicts.txt"

run 20-verify-gates       bun run verify:gates
run 21-preset-conformance node skills/dsh-qa/scripts/preset-conformance.mjs
run 22-dump-config        node scripts/dump-config.mjs --profile mpd
run 23-install-profile    node scripts/install-profile.mjs --dry-run
run 24-pack               node scripts/pack-mpd.mjs
run 25-pack-closure       node scripts/verify-pack-closure.mjs
run 26-bundle-lifecycle   bun skills/dsh-qa/scripts/bundle-lifecycle.mjs
run 27-dual-track-smoke   node skills/dsh-qa/scripts/dual-track-smoke.mjs
run 28-mcp-call           node skills/dsh-qa/scripts/mcp-call.mjs

{
  echo "gate sweep end $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "worktree sha256 after: $(git status --porcelain | git hash-object --stdin)"
} | tee -a "$LOG/anchor.txt"
echo "EVIDENCE=$LOG"
echo "=== PHASE3 COMPLETE ==="
