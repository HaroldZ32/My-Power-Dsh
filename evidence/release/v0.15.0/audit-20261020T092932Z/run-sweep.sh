#!/usr/bin/env bash
# Full audit sweep for the v0.15.0 wave. Runtime driver, lives outside the shipped tree.
set -u
ROOT="/home/haroldzhao/MyProj/DshProj/My-Power-Dsh"
cd "$ROOT" || exit 1
TS="${1:-$(date -u +%Y%m%dT%H%M%SZ)}"
OUT="$ROOT/evidence/release/v0.15.0/audit-$TS"
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
  timeout -k 30 1800 "$@" >"$OUT/$name.log" 2>&1
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

log "sweep start $(date -u +%Y-%m-%dT%H:%M:%SZ)"
log "branch=$(git rev-parse --abbrev-ref HEAD) head=$(git rev-parse HEAD)"
log "dirty=$(git status --porcelain | wc -l)"
log "node=$(node --version) bun=$(bun --version) pinned=$(.toolchain/node_modules/.bin/bun --version 2>/dev/null || echo missing) dsh=$(dsh --version 2>/dev/null | head -1)"
log "docker=$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo none)"

run vendor bun run verify:vendor
run rows bun run verify:rows
run docs bun run verify:docs
run manifest bun run verify:manifest
run comments bun run verify:comments
run no-host-override node scripts/verify-no-host-override.ts
run manual-paths node scripts/verify-manual-paths.ts
run dist-fresh node scripts/verify-dist-fresh.ts
run pack-closure node scripts/verify-pack-closure.ts
run preset-conformance-selftest node skills/dsh-qa/scripts/preset-conformance.ts --self-test
run verify-law-selftest node skills/dsh-qa/scripts/verify-law.ts --self-test
run ext-selftest bun scripts/mpd-ext.ts --self-test
run ext-validate bun scripts/mpd-ext.ts validate extensions/mpd-ext-example
run typecheck bun run typecheck
run tests bun test
run qa-selftests bun run test:qa
run boot-bundle-lifecycle bun skills/dsh-qa/scripts/bundle-lifecycle.ts
run preset-conformance-real node skills/dsh-qa/scripts/preset-conformance.ts
run verify-law-boot node skills/dsh-qa/scripts/verify-law.ts
run dual-track-smoke node skills/dsh-qa/scripts/dual-track-smoke.ts
run mcp-call node skills/dsh-qa/scripts/mcp-call.ts
run docker-source node scripts/docker-e2e.ts --mode source --require-docker
run docker-oneclick node scripts/docker-e2e.ts --mode oneclick --require-docker

log ""
log "sweep end $(date -u +%Y-%m-%dT%H:%M:%SZ)"
log "dirty-after=$(git status --porcelain | wc -l)"
log "--- SUMMARY ---"
cat "$SUMMARY" | tee -a "$LOG"
fail_count=$(awk -F'\t' '$2 != 0 {n++} END {print n+0}' "$SUMMARY")
log "failures=$fail_count"
exit 0
