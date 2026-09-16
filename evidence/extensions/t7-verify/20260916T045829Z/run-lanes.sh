#!/usr/bin/env bash
# t7 attempt-2 driver — re-run the three contract commands on the REPAIRED tree.
# The tree is shared and other writers were active during this turn, so the driver pins
# the exact artifacts the lanes exercise BEFORE and AFTER the run (HEAD alone is not
# enough: the repair lives in the working tree, uncommitted, and docs/README edits by
# other writers must be shown not to touch the lane subject).
set -u
cd /root/dshProj/my-power-dsh
OUT="evidence/extensions/t7-verify/20260916T045829Z"

pin() {
  echo "--- pin at $1 ($(date -u +%Y-%m-%dT%H:%M:%SZ)) ---"
  echo "HEAD: $(git rev-parse HEAD)"
  echo "git status --porcelain:"
  git status --porcelain
  echo "sha256 of the lane subject:"
  sha256sum \
    packages/mpd-ext-plugin/dist/index.js \
    packages/mpd-mcp-lsp/dist/cli.js \
    packages/mpd-bundle/cordis.patch.yml \
    scripts/pack-mpd.mjs \
    skills/dsh-qa/scripts/extension-lifecycle.mjs \
    skills/dsh-qa/scripts/extension-mcp-bridge.mjs \
    skills/dsh-qa/scripts/extension-isolation.mjs \
    skills/dsh-qa/SKILL.md 2>&1
}

pin pre > "$OUT/pin-pre.txt" 2>&1

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

pin post > "$OUT/pin-post.txt" 2>&1
echo "T7A2-DONE"
