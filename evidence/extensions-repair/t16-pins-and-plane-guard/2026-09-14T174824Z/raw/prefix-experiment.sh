#!/usr/bin/env bash
# t16 "fails before the fix" driver: builds a throwaway COPY of the packages (never the repo),
# reverts ONE fix per experiment in the copy, and runs the pinned test file there.
# Usage: bash evidence/extensions-repair/t16-pins-and-plane-guard/<ts>/raw/prefix-experiment.sh <repo-root>
set -euo pipefail
REPO="${1:-/root/dshProj/my-power-dsh}"
PKGS="mpd-ext-plugin mpd-roles-plugin mpd-dsh-adapter-plugin mpd-workmate-plugin mpd-bundle"

copy_tree() {
  local dest="$1"
  mkdir -p "$dest/packages"
  for p in $PKGS; do cp -r "$REPO/packages/$p" "$dest/packages/"; done
}

echo "### A) PRE-FIX seam declaration (REQUIRED_SEAMS -> []), ext core tests"
A="$(mktemp -d)"
copy_tree "$A"
python3 - "$A" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1]) / "packages/mpd-ext-plugin/src/index.ts"
s = p.read_text()
old = 'export const REQUIRED_SEAMS = ["tools", "skills"] as const'
assert old in s, "seam declaration not found"
p.write_text(s.replace(old, 'export const REQUIRED_SEAMS: readonly string[] = [] as const'))
PY
(cd "$A" && bun test packages/mpd-ext-plugin/test/core.test.ts 2>&1 | grep -E "^\(fail\)|^ *[0-9]+ (pass|fail)") || true
rm -rf "$A"

echo
echo "### B) PRE-FIX roster (plane guard neutered), roles tests"
B="$(mktemp -d)"
copy_tree "$B"
python3 - "$B" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1]) / "packages/mpd-roles-plugin/src/index.ts"
s = p.read_text()
old = 'const PROJECT_ONLY_PLANE = "project"'
assert old in s, "plane constant not found"
p.write_text(s.replace(old, 'const PROJECT_ONLY_PLANE = "__reverted_for_the_experiment__"'))
PY
(cd "$B" && bun test packages/mpd-roles-plugin/test/roles.test.ts 2>&1 | grep -E "^\(fail\)|Expected:|Received:|^ *[0-9]+ (pass|fail)") || true
rm -rf "$B"
