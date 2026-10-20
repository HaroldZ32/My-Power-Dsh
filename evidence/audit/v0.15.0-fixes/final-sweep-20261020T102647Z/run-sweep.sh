#!/usr/bin/env bash
# Final integration sweep for the audit fix wave. Captain-run; logs become PR evidence.
set -u
ROOT="/home/haroldzhao/MyProj/DshProj/My-Power-Dsh"
cd "$ROOT" || exit 1
TS="${1:-$(date -u +%Y%m%dT%H%M%SZ)}"
OUT="$ROOT/evidence/audit/v0.15.0-fixes/final-sweep-$TS"
mkdir -p "$OUT"
LOG="$OUT/output.log"
SUMMARY="$OUT/summary.tsv"
: > "$LOG"
: > "$SUMMARY"
cp "$0" "$OUT/run-sweep.sh"

log() { printf '%s\n' "$*" | tee -a "$LOG"; }

run() {
  local name="$1"; shift
  local start end rc
  start=$(date +%s)
  log ""
  log "=== CASE $name :: $* ==="
  timeout -k 30 2400 "$@" >"$OUT/$name.log" 2>&1
  rc=$?
  end=$(date +%s)
  printf '%s\t%s\t%s\t%s\n' "$name" "$rc" "$((end - start))s" "$*" >>"$SUMMARY"
  log "CASE $name exit=$rc elapsed=$((end - start))s"
  if [ "$rc" -ne 0 ]; then
    log "--- tail $name ---"
    tail -40 "$OUT/$name.log" | tee -a "$LOG"
    log "--- end tail $name ---"
  fi
}

log "fix sweep start $(date -u +%Y-%m-%dT%H:%M:%SZ)"
log "branch=$(git rev-parse --abbrev-ref HEAD) head=$(git rev-parse HEAD)"
log "dirty=$(git status --porcelain | wc -l)"
log "node=$(node --version) bun=$(bun --version) pinned=$(.toolchain/node_modules/.bin/bun --version 2>/dev/null || echo missing) dsh=$(dsh --version 2>/dev/null | head -1)"

run vendor bun run verify:vendor
run rows bun run verify:rows
run docs bun run verify:docs
run manifest bun run verify:manifest
run comments bun run verify:comments
run no-host-override node scripts/verify-no-host-override.ts
run manual-paths node scripts/verify-manual-paths.ts
run dist-fresh node scripts/verify-dist-fresh.ts
run graph bun run verify:graph
run preset-conformance-selftest node skills/dsh-qa/scripts/preset-conformance.ts --self-test
run verify-law-selftest node skills/dsh-qa/scripts/verify-law.ts --self-test
run ext-selftest bun scripts/mpd-ext.ts --self-test
run ext-validate bun scripts/mpd-ext.ts validate extensions/mpd-ext-example
run docker-selftest node scripts/docker-e2e.ts --self-test
run typecheck bun run typecheck
run tests .toolchain/node_modules/.bin/bun test packages
run qa-selftests bun run test:qa
run lifecycle bun skills/dsh-qa/scripts/bundle-lifecycle.ts
run preset-conformance-real node skills/dsh-qa/scripts/preset-conformance.ts
run verify-law-boot node skills/dsh-qa/scripts/verify-law.ts
run delegation-gate-live node skills/dsh-qa/scripts/delegation-gate.ts
run session-start-team-live node skills/dsh-qa/scripts/session-start-team.ts
run captain-scope-live node skills/dsh-qa/scripts/captain-scope.ts
run mcp-call node skills/dsh-qa/scripts/mcp-call.ts
run dual-track-smoke node skills/dsh-qa/scripts/dual-track-smoke.ts
run docker-source-live node scripts/docker-e2e.ts --mode source --require-docker --live

log ""
log "fix sweep end $(date -u +%Y-%m-%dT%H:%M:%SZ)"
log "dirty-after=$(git status --porcelain | wc -l)"
log "--- SUMMARY ---"
cat "$SUMMARY" | tee -a "$LOG"
fail_count=$(awk -F'\t' '$2 != 0 {n++} END {print n+0}' "$SUMMARY")
log "failures=$fail_count"
exit 0
