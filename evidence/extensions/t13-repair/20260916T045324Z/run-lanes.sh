#!/usr/bin/env bash
# t13 lane re-run: the two lanes that were RED in t7, re-run for REAL after the repair.
# Managed background job; every child's stdio goes to a file (never a pipe).
set -u
cd /root/dshProj/my-power-dsh
T="evidence/extensions/t13-repair/20260916T045324Z"
: > "$T/exit-codes.txt"

run() {
  local name="$1"; shift
  local start end code
  start="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  "$@" > "$T/$name.console.log" 2>&1
  code=$?
  end="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "$name exit=$code start=$start end=$end cmd=$*" >> "$T/exit-codes.txt"
  return 0
}

run extension-mcp-bridge bun skills/dsh-qa/scripts/extension-mcp-bridge.mjs --no-skip
run extension-lifecycle bun skills/dsh-qa/scripts/extension-lifecycle.mjs --no-skip

git rev-parse HEAD > "$T/head-post.txt"
git status --porcelain >> "$T/head-post.txt"
echo "T13-LANES-DONE"
