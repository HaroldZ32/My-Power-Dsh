#!/usr/bin/env bash
# RED-BEFORE driver for the v0.9.1 defect fixes: run the POST-FIX test files against
# the PRE-FIX tree, so every finding has a measured red before its green.
#
#   usage: bash red-before-run.sh <evidence-dir> [<pre-fix-revision>]
#
# The worktree lives under .mpd/ (gitignored) because every bash tool call gets a
# fresh /tmp in this environment. The `--cwd` argument is LOAD-BEARING: measured
# trap — without it `bun test <relative path>` is also resolved against the main
# checkout, the same file is loaded twice (pre-fix AND post-fix) and the verdict
# is worthless (first attempt: "Ran 90 tests across 2 files" for one file argument).
set -u
REPO="$(cd "$(dirname "$0")/../../../.." && pwd)"
EV="${1:?usage: red-before-run.sh <evidence-dir> [<revision>]}"
REV="${2:-HEAD}"
WT="$REPO/.mpd/red-before"
cd "$REPO"
rm -rf "$WT"
git worktree add --detach "$WT" "$REV" > "$EV/raw/red-worktree-add.log" 2>&1
git -C "$WT" rev-parse HEAD | tee -a "$EV/raw/red-worktree-add.log"
cp packages/mpd-ext-plugin/test/core.test.ts "$WT/packages/mpd-ext-plugin/test/core.test.ts"
cp packages/mpd-ext-plugin/test/mcp.test.ts "$WT/packages/mpd-ext-plugin/test/mcp.test.ts"
cp packages/mpd-agent-teams-plugin/self-fix-tests/pool-capability-guard.test.mjs "$WT/packages/mpd-agent-teams-plugin/self-fix-tests/pool-capability-guard.test.mjs"
run() { bun test --cwd "$WT" "$WT/$2" > "$EV/raw/red-$1.log" 2>&1; echo "$1 exit=$?" >> "$EV/raw/red-$1.log"; }
run ext-core        packages/mpd-ext-plugin/test/core.test.ts
run ext-mcp         packages/mpd-ext-plugin/test/mcp.test.ts
run pool-capability packages/mpd-agent-teams-plugin/self-fix-tests/pool-capability-guard.test.mjs
git worktree remove --force "$WT"
git worktree prune
