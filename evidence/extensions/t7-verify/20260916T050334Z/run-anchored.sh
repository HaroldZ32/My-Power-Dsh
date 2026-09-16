#!/usr/bin/env bash
# t7 attempt-2 ANCHORED re-run on the captain's instruction.
#
# The captain's requirement: the verdict must NOT be presented as "on revision 8777e43"
# alone, because the repair (t13) is uncommitted — the tree is dirty. So the four files
# that carry the repair are digested BEFORE and AFTER the run, and the run ABORTS with
# exit 9 if any of their digests changes mid-run (no verdict is published in that case).
# dist/ artifacts are gitignored build output; they are pinned too, as extra context.
set -u
cd /root/dshProj/my-power-dsh
OUT="evidence/extensions/t7-verify/20260916T050334Z"

FOUR="scripts/pack-mpd.mjs skills/dsh-qa/SKILL.md skills/dsh-qa/scripts/extension-mcp-bridge.mjs VENDOR_LOCK.json"
EXTRA="packages/mpd-ext-plugin/dist/index.js packages/mpd-mcp-lsp/dist/cli.js packages/mpd-bundle/cordis.patch.yml skills/dsh-qa/scripts/extension-lifecycle.mjs skills/dsh-qa/scripts/extension-isolation.mjs"

digest() {
  echo "=== git rev-parse HEAD ==="
  git rev-parse HEAD
  echo "=== git status --porcelain ==="
  git status --porcelain
  echo "=== sha256 of THE FOUR REPAIR FILES ==="
  sha256sum $FOUR
  echo "=== sha256 of the rest of the lane subject (gitignored dist includes build output) ==="
  sha256sum $EXTRA
}

digest > "$OUT/pin-pre.txt" 2>&1
sha256sum $FOUR | awk '{print $1}' > "$OUT/four-pre.sha"

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

digest > "$OUT/pin-post.txt" 2>&1
sha256sum $FOUR | awk '{print $1}' > "$OUT/four-post.sha"

if diff -q "$OUT/four-pre.sha" "$OUT/four-post.sha" > /dev/null; then
  echo "FOUR-FILE DIGESTS STABLE ACROSS THE RUN"
  echo "T7A2-ANCHOR-DONE"
else
  echo "DIGEST-CHANGED: one of the four repair files changed during the run — NO VERDICT"
  diff "$OUT/four-pre.sha" "$OUT/four-post.sha"
  exit 9
fi
