#!/usr/bin/env bash
# Final verification sequence for the roles-plugin writer lane (evidence capture).
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$DIR/output.log"
REPO="$(cd "$DIR/../../../../.." && pwd)"
cd "$REPO" || exit 1
: > "$LOG"
run() {
  echo "===== \$ $* =====" >> "$LOG"
  "$@" >> "$LOG" 2>&1
  local rc=$?
  echo "----- exit: $rc" >> "$LOG"
  echo "[$rc] $*"
  return 0
}
{
  echo "UTC: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "REPO: $REPO"
  echo "HEAD: $(git rev-parse HEAD)"
  echo "BRANCH: $(git rev-parse --abbrev-ref HEAD)"
} >> "$LOG"
echo "" >> "$LOG"
run .toolchain/node_modules/.bin/bun test ./packages/mpd-roles-plugin/test/
run node skills/dsh-qa/scripts/session-start-team.ts --self-test
run bun run typecheck
run .toolchain/node_modules/.bin/bun build packages/mpd-roles-plugin/src/index.ts --target node --format esm --outfile packages/mpd-roles-plugin/dist/index.js
echo "===== post-build re-run: unit tests =====" >> "$LOG"
run .toolchain/node_modules/.bin/bun test ./packages/mpd-roles-plugin/test/
run node scripts/verify-comment-coverage.ts
{
  echo "===== changed files ====="
  git status --porcelain packages/mpd-roles-plugin/src packages/mpd-roles-plugin/test packages/mpd-roles-plugin/dist/index.js skills/dsh-qa/scripts/session-start-team.ts
  echo "===== diffstat ====="
  git diff --stat packages/mpd-roles-plugin/src packages/mpd-roles-plugin/test packages/mpd-roles-plugin/dist/index.js skills/dsh-qa/scripts/session-start-team.ts
} >> "$LOG"
echo "DONE"
