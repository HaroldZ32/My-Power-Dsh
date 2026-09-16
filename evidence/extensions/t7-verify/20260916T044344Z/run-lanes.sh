#!/usr/bin/env bash
# t7 lane driver — external-plugin adaptation audit wave.
# Runs the three contract commands sequentially, one console log + one exit code each.
# dsh-spawning work is executed inside a MANAGED background job (never nohup/&), with
# every child's stdio redirected to a file (AGENTS.md section 7 shell caveat).
set -u
cd /root/dshProj/my-power-dsh
OUT="$(cd "$(dirname "$0")" && pwd)"

{
  echo "command: git rev-parse HEAD"
  git rev-parse HEAD
  echo "command: git status --porcelain"
  git status --porcelain
  echo "command: ls -d dist/mpd-package"
  ls -d dist/mpd-package 2>&1
} > "$OUT/head-pre.txt" 2>&1

: > "$OUT/exit-codes.txt"

run() {
  local name="$1"; shift
  local start end code
  start="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  "$@" > "$OUT/$name.console.log" 2>&1
  code=$?
  end="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "$name exit=$code start=$start end=$end cmd=$*" >> "$OUT/exit-codes.txt"
  return 0
}

run extension-lifecycle bun skills/dsh-qa/scripts/extension-lifecycle.mjs --no-skip
run extension-mcp-bridge bun skills/dsh-qa/scripts/extension-mcp-bridge.mjs --no-skip
run extension-isolation-self-test bun skills/dsh-qa/scripts/extension-isolation.mjs --self-test

{
  echo "command: git rev-parse HEAD"
  git rev-parse HEAD
  echo "command: git status --porcelain"
  git status --porcelain
} > "$OUT/head-post.txt" 2>&1

echo "T7-LANES-DONE"
