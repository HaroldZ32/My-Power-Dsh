#!/usr/bin/env bash
# t8 FINAL GATE SWEEP — run on the frozen tree; every gate's raw output is captured verbatim
# under evidence/wave3/integration/<stamp>/raw/. No gate is retried into green: exit codes and
# the tail of each log are recorded as produced.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
RAW="$HERE/raw"
mkdir -p "$RAW"
cd "$REPO"

run() {
    local name="$1"; shift
    local log="$RAW/gate-$name.log"
    "$@" > "$log" 2>&1
    local rc=$?
    echo "[exit=$rc] $*" | tee -a "$RAW/gate-exitcodes.txt"
    return 0
}

: > "$RAW/gate-exitcodes.txt"
{
    echo "repo=$REPO"
    echo "branch=$(git branch --show-current) HEAD=$(git rev-parse HEAD)"
    echo "tools.js sha256=$(sha256sum packages/mpd-agent-teams-plugin/lib/tools.js | awk '{print $1}')"
    echo "quality-gates.js sha256=$(sha256sum packages/mpd-agent-teams-plugin/lib/quality-gates.js | awk '{print $1}')"
    echo "VENDOR_LOCK.json sha256=$(sha256sum VENDOR_LOCK.json | awk '{print $1}')"
    echo
} >> "$RAW/gate-exitcodes.txt"

run verify-vendor node scripts/verify-vendor.mjs
run typecheck bun run typecheck
run bun-test-packages bun test packages
run test-qa bun run test:qa
run preset-conformance node skills/dsh-qa/scripts/preset-conformance.mjs
run dist-sweep node evidence/session-workspace-root/dist-repair/sweep.mjs --clean-room

{
    echo
    echo "=== tails ==="
    for name in verify-vendor typecheck bun-test-packages test-qa preset-conformance dist-sweep; do
        echo "--- $name"
        tail -6 "$RAW/gate-$name.log"
    done
} > "$RAW/gate-tails.txt"
cat "$RAW/gate-exitcodes.txt"
echo
cat "$RAW/gate-tails.txt"
