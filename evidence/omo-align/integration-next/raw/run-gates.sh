#!/usr/bin/env bash
# t47 integration gate sweep. Runs the eight gates the close-out contract names and
# records each exit code + log under evidence/omo-align/integration-next/raw/gates/.
# NOTE: this runs against the WORKING TREE (which carried t51/t52 in-flight edits at
# sweep time); the dirty-file hashes are captured alongside in dirty-at-sweep.txt.
set -u
cd /root/dshProj/my-power-dsh || exit 99
RAW=evidence/omo-align/integration-next/raw
G="$RAW/gates"
mkdir -p "$G"
{
  echo "sweep started: $(date -u +%FT%TZ)"
  echo "HEAD: $(git rev-parse HEAD)"
  echo "tracked-dirty:"
  git status --porcelain | grep -v '^??' || true
} > "$RAW/dirty-at-sweep.txt"
: > "$G/codes.txt"

run() {
  local id="$1"; shift
  echo "=== [$id] $* ===" >&2
  "$@" > "$G/$id.log" 2>&1
  local code=$?
  printf '%s\t%s\t%s\n' "$id" "$code" "$*" >> "$G/codes.txt"
  echo "=== [$id] exit=$code ===" >&2
}

run delta-check        node scripts/patch-agent-teams-fixes.mjs --check
run verify-vendor      node scripts/verify-vendor.mjs
run typecheck          bun run typecheck
run plugin-tests       bun test packages/mpd-agent-teams-plugin
run self-fix-tests     bun test packages/mpd-agent-teams-plugin/self-fix-tests
run test-qa            bun run test:qa
run preset-conformance node skills/dsh-qa/scripts/preset-conformance.mjs
run session-start-team bun skills/dsh-qa/scripts/session-start-team.mjs
run messaging-case-self-test node skills/dsh-qa/scripts/agent-teams-messaging.mjs --self-test

{
  echo "sweep finished: $(date -u +%FT%TZ)"
  cat "$G/codes.txt"
} >> "$RAW/dirty-at-sweep.txt"
echo "ALL GATES DONE"
cat "$G/codes.txt"
