#!/usr/bin/env bash
# Independent re-run of the 9 frozen gates + the two-sided skill case (t17).
# Every gate logs to its own file; exit codes are collected into codes.txt.
set -u
cd /root/dshProj/my-power-dsh || exit 99
RAW=evidence/omo-align/verification/raw/gates
mkdir -p "$RAW"
: > "$RAW/codes.txt"

run() {
  local id="$1"; shift
  echo "=== [$id] $* ===" >&2
  "$@" > "$RAW/$id.log" 2>&1
  local code=$?
  printf '%s\t%s\t%s\n' "$id" "$code" "$*" >> "$RAW/codes.txt"
  echo "=== [$id] exit=$code ===" >&2
}

run typecheck bun run typecheck
run test-plugin bun test packages/mpd-agent-teams-plugin
run test-packages bun test packages
run install-selftest node scripts/install-profile.mjs --self-test
run install-dryrun node scripts/install-profile.mjs --dry-run
run preset-conformance node skills/dsh-qa/scripts/preset-conformance.mjs
run bundle-lifecycle bun skills/dsh-qa/scripts/bundle-lifecycle.mjs
run patch-check node scripts/patch-agent-teams-fixes.mjs --check
run verify-vendor node scripts/verify-vendor.mjs
run session-start-team bun skills/dsh-qa/scripts/session-start-team.mjs

echo "ALL GATES DONE"
cat "$RAW/codes.txt"
