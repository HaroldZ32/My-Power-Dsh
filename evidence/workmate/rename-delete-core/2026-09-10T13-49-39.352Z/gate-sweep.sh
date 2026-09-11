#!/usr/bin/env bash
# t15 gate sweep — repair: the workmate mutation tools' declared output schemas now accept the values
# they return (contract §C tool surface, §D wire protocol).
#
# Runs every binding gate that t15 can own, plus the two checks that matter for THIS defect:
#   1) the package suite, which now contains the harness-validator regression lock;
#   2) an isolated-DSH_HOME boot that installs the bundle and asserts the workmate row composes AND
#      that the REBUILT dist declares `ok` in both mutation schemas (the live artifact, not the src).
# Everything runs in temp sandboxes under /tmp; the real ~/.dsh and the real HOME are never touched.
# Usage: bash gate-sweep.sh
set -u
cd "$(dirname "$0")/../../../.."
REPO="$(pwd)"
EV="$(cd "$(dirname "$0")" && pwd)"
LOG="$EV/gate-sweep.log"
SB_DSH=$(mktemp -d /tmp/mpd-t15-gate-dsh-XXXXXX)
SB_HOME=$(mktemp -d /tmp/mpd-t15-gate-home-XXXXXX)
: > "$LOG"
{
  echo "=== t15 gate sweep: output-schema repair ==="
  echo "repo=$REPO"
  echo "sandbox DSH_HOME=$SB_DSH"
  echo "sandbox HOME=$SB_HOME"
  echo "HEAD=$(git rev-parse HEAD)"
  echo
  echo "=== git status --porcelain (t15 delta) ==="
  git status --porcelain packages/mpd-workmate-plugin
  echo
} >> "$LOG"

rc_isolation=0
case "$SB_DSH" in /tmp/*) ;; *) rc_isolation=1;; esac
case "$SB_HOME" in /tmp/*) ;; *) rc_isolation=1;; esac
REAL_LIB="$HOME/.mpd/workmate"
BEFORE=$(find "$REAL_LIB" -maxdepth 2 2>/dev/null | sort)

rc=0
run_step() {
  local key="$1"; shift
  echo "### [$key] $*" >> "$LOG"
  "$@" >> "$LOG" 2>&1
  local rc=$?
  echo "[exit=$rc] $key" >> "$LOG"
  echo >> "$LOG"
  return $rc
}

# The live artifact must be the FIXED source compiled.
run_step build  bun build packages/mpd-workmate-plugin/src/index.ts --target node --format esm --outfile packages/mpd-workmate-plugin/dist/index.js; rc_build=$?
OK_DECL=$(grep -c 'ok: { type: "boolean"' packages/mpd-workmate-plugin/dist/index.js 2>/dev/null || true)
OK_DECL=${OK_DECL:-0}
echo "[dist] 'ok: { type: \"boolean\" }' declarations in the rebuilt dist: $OK_DECL (must be 2)" >> "$LOG"
[ "$OK_DECL" -eq 2 ] || rc_build=1

run_step tests      bun test packages/mpd-workmate-plugin/test; rc_tests=$?
run_step typecheck  bun run typecheck;                          rc_type=$?
run_step routes     bun test packages/mpd-workmate-plugin/test/rename-delete.test.ts -t "§D status/reason matrix"; rc_routes=$?

# Isolated boot: the bundle composes AND the workmate row resolves to the rebuilt dist.
mkdir -p "$SB_DSH/store"
env HOME="$SB_HOME" DSH_HOME="$SB_DSH" dsh plugin --profile h add --store-dir "$SB_DSH/store" "$REPO" >> "$LOG" 2>&1
rc_install=$?
env HOME="$SB_HOME" DSH_HOME="$SB_DSH" dsh --profile h --dump-config > "$EV/dump-config.txt" 2> "$EV/dump-config.err"
rc_dump=$?
{
  echo "### [boot] dump-config exit=$rc_dump bytes=$(wc -c < "$EV/dump-config.txt")"
  echo "workmate row: $(grep -A1 'id: mpd-workmate' "$EV/dump-config.txt" | grep -o 'packages/mpd-workmate-plugin/dist/index.js' | head -1)"
  echo "bundle row:   $(grep -A1 'id: mpd-web-compat' "$EV/dump-config.txt" | grep -o '@mpd-dsh/mpd' | head -1)"
} >> "$LOG"
if [ "$rc_install" -eq 0 ] && [ "$rc_dump" -eq 0 ] \
  && grep -A1 'id: mpd-workmate' "$EV/dump-config.txt" | grep -q 'packages/mpd-workmate-plugin/dist/index.js' \
  && grep -A1 'id: mpd-web-compat' "$EV/dump-config.txt" | grep -q '@mpd-dsh/mpd'; then
  rc_boot=0
else
  rc_boot=1
fi
echo "[exit=$rc_boot] boot (bundle + workmate row resolved to its dist)" >> "$LOG"

AFTER=$(find "$REAL_LIB" -maxdepth 2 2>/dev/null | sort)
if [ "$BEFORE" != "$AFTER" ]; then rc_isolation=1; fi
echo "[exit=$rc_isolation] isolation (temp HOME/DSH_HOME, real workmate library unchanged)" >> "$LOG"

echo "=== git status --porcelain (after) ===" >> "$LOG"
git status --porcelain >> "$LOG" 2>&1

EV="$EV" rc_build=$rc_build rc_tests=$rc_tests rc_type=$rc_type rc_routes=$rc_routes rc_install=$rc_install rc_boot=$rc_boot rc_isolation=$rc_isolation python3 - <<'PY' >> "$LOG" 2>&1
import json, os
ev = os.environ["EV"]
def gate(name, key):
    rc = int(os.environ[key])
    return {name: {"exit": rc, "pass": rc == 0}}
res = {
    "task": "t15 - repair: workmate mutation tools conform to their declared output schemas",
    "contract": ".mpd/plans/workmate-rename-delete-contract.md sections C (tool surface) and D (wire protocol)",
    "fix": "declare `ok: { type: \"boolean\" }` in both mutation tools' output.schema and require it (rename: ok,name,from / delete: ok,name,archived,purged); the value keeps `ok`, the §D route bodies keep their own `ok`",
    "changed_paths": [
        "packages/mpd-workmate-plugin/src/index.ts",
        "packages/mpd-workmate-plugin/dist/index.js",
        "packages/mpd-workmate-plugin/test/rename-delete.test.ts",
    ],
    "gates": {},
    "isolation": {"HOME": "temp sandbox", "DSH_HOME": "temp sandbox", "real_home_untouched": True},
}
res["gates"].update(gate("bun build src/index.ts -> dist/index.js (rebuilt, dist declares ok twice)", "rc_build"))
res["gates"].update(gate("bun test packages/mpd-workmate-plugin/test (incl. the harness-validator regression lock)", "rc_tests"))
res["gates"].update(gate("bun run typecheck", "rc_type"))
res["gates"].update(gate("route matrix unchanged (§D status/reason/headers)", "rc_routes"))
res["gates"].update(gate("dsh plugin --profile h add <repo> (isolated DSH_HOME)", "rc_install"))
res["gates"].update(gate("dsh --profile h --dump-config (bundle + workmate row at dist)", "rc_boot"))
res["gates"].update(gate("isolation: temp HOME/DSH_HOME, real workmate library unchanged", "rc_isolation"))
res["all_passed"] = all(g["pass"] for g in res["gates"].values())
open(ev + "/gate-sweep-result.json", "w").write(json.dumps(res, indent=2) + "\n")
print(json.dumps(res, indent=2))
PY
rm -rf "$SB_DSH" "$SB_HOME"
exit 0
