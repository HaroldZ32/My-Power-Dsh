#!/usr/bin/env bash
# t14 BEFORE/AFTER measurement.
#
# The package is UNTRACKED (this branch adds it), so there is no pre-fix git revision
# to check out. Two real artifacts are measured instead, and both are labelled:
#
#   BEFORE (values)  packages/mpd-ext-plugin/dist/index.js — the PRE-fix shipped build
#                    already on disk, driven through its own tools.
#   AFTER  (values)  packages/mpd-ext-plugin/src/index.ts  — the fixed source.
#   BEFORE (tests)   the two defect sites re-introduced in a copy of the fixed
#                    registry.ts (raw/reintroduce-defects.mjs), so the new cases are
#                    shown to be RED against the pre-fix behaviour.
#
# No git state is touched (only reads), the swap window lasts seconds, and it ends with
# a byte-exact restore check.
set -u
cd "$(dirname "$0")"
EV="$(pwd)"
REPO="$(cd ../../../.. && pwd)"
SRC="$REPO/packages/mpd-ext-plugin/src/registry.ts"
FIXED="$EV/raw/registry.fixed.ts"
LOG="$EV/before-after.log"

[ -d "$REPO/.git" ] || { echo "FATAL: not inside the repo: $REPO" >&2; exit 1; }
: > "$LOG"

{
  echo "=== t14 BEFORE/AFTER ==="
  echo "repo=$REPO"
  echo "fixed registry.ts sha256: $(sha256sum "$SRC" | cut -d' ' -f1)"
  echo "dist/index.js sha256 now: $(sha256sum "$REPO/packages/mpd-ext-plugin/dist/index.js" | cut -d' ' -f1)"
  echo "pre-fix dist/index.js sha256 as measured: f0277c30eccde6f9a8193f5ee1827d7f8bd59c3292a337a89f2b818ca33df72f (see before-probe.json, captured before the mandated rebuild)"
  echo
  echo "--- BEFORE (values): the pre-fix SHIPPED build, driven through its own tools ---"
} >> "$LOG"
# The dist rebuild this task REQUIRES replaces the pre-fix bundle, so the BEFORE phase
# is only re-measurable while the old artifact is still on disk. The captured
# before-probe.json is kept either way; the RED test phase below re-derives the pre-fix
# BEHAVIOUR from the fixed source, so the measurement stays reproducible.
if grep -q "annotateRoleSurfaces" "$REPO/packages/mpd-ext-plugin/dist/index.js"; then
  echo "SKIPPED: dist/index.js already carries the fix (it was rebuilt by this task);" >> "$LOG"
  echo "         keeping the before-probe.json captured from the pre-fix artifact." >> "$LOG"
else
  timeout 120 bun "$EV/raw/before-after.mjs" dist > "$EV/before-probe.json" 2>&1
  echo "exit=$?" >> "$LOG"
  cat "$EV/before-probe.json" >> "$LOG"
fi

{
  echo
  echo "--- AFTER (values): the fixed source ---"
} >> "$LOG"
timeout 120 bun "$EV/raw/before-after.mjs" src > "$EV/after-probe.json" 2>&1
echo "exit=$?" >> "$LOG"
cat "$EV/after-probe.json" >> "$LOG"

{
  echo
  echo "--- BEFORE (tests): defect sites re-introduced in src/registry.ts ---"
} >> "$LOG"
cp "$SRC" "$FIXED"
bun "$EV/raw/reintroduce-defects.mjs" "$FIXED" "$SRC" >> "$LOG" 2>&1
sha256sum "$SRC" | sed 's/^/reverted registry.ts sha256: /' >> "$LOG"
timeout 300 bun test "$REPO/packages/mpd-ext-plugin/test/core.test.ts" > "$EV/before-tests.log" 2>&1
echo "bun test core.test.ts (defects re-introduced) exit=$?" >> "$LOG"
grep -E "^\(fail\)|^ [0-9]+ (pass|fail)" "$EV/before-tests.log" >> "$LOG"

{
  echo
  echo "--- restoring the fixed registry.ts ---"
} >> "$LOG"
cp "$FIXED" "$SRC"
if ! cmp -s "$FIXED" "$SRC"; then echo "FATAL: restore was not byte-exact" >&2; exit 1; fi
sha256sum "$SRC" | sed 's/^/restored registry.ts sha256: /' >> "$LOG"

{
  echo
  echo "--- AFTER (tests): the fixed source ---"
} >> "$LOG"
timeout 300 bun test "$REPO/packages/mpd-ext-plugin/test/core.test.ts" > "$EV/after-tests.log" 2>&1
echo "bun test core.test.ts (fixed) exit=$?" >> "$LOG"
grep -E "^\(fail\)|^ [0-9]+ (pass|fail)" "$EV/after-tests.log" >> "$LOG"
echo DONE >> "$LOG"
cat "$LOG"
