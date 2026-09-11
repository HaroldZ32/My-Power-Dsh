#!/usr/bin/env bash
# Gate sweep for t3 (workmate rename + delete core). Runs every binding gate of contract §I with an
# isolated DSH_HOME and a sandbox HOME, then writes result.json + output.log next to this script.
# The real ~/.dsh and the real HOME are never touched; the lifecycle probe is read-only.
set -u
# This script lives at <repo>/evidence/workmate/rename-delete-core/, i.e. three levels below the root.
cd "$(dirname "$0")/../../.."
REPO="$(pwd)"
[ -d "$REPO/.git" ] || { echo "FATAL: not the repo root: $REPO" >&2; exit 1; }
EV="evidence/workmate/rename-delete-core/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$EV"
LOG="$EV/output.log"
SB_HOME=$(mktemp -d /tmp/mpd-wm-home-XXXXXX)
SB_DSH=$(mktemp -d /tmp/mpd-wm-dsh-XXXXXX)
: > "$LOG"
{
  echo "=== workmate rename+delete (t3) gate sweep ==="
  echo "repo=$REPO"
  echo "sandbox HOME=$SB_HOME"
  echo "sandbox DSH_HOME=$SB_DSH"
  echo "cwd=$(pwd)"
  echo "HEAD=$(git rev-parse HEAD)"
  echo
  echo "=== git status --porcelain (BEFORE this sweep) ==="
  git status --porcelain
  echo
} >> "$LOG"

# Isolation assertions (contract §I): every step below runs with a temp HOME / DSH_HOME, and the
# real workmate library must be byte-for-byte unchanged afterwards.
REAL_HOME="$HOME"
REAL_WM="$REAL_HOME/.mpd/workmate"
REAL_BEFORE=$(find "$REAL_WM" -maxdepth 2 2>/dev/null | sort)
rc_iso=0
case "$SB_HOME" in /tmp/*) echo "[iso] sandbox HOME: $SB_HOME" >> "$LOG";; *) echo "[iso] FAIL sandbox HOME: $SB_HOME" >> "$LOG"; rc_iso=1;; esac
case "$SB_DSH"  in /tmp/*) echo "[iso] sandbox DSH_HOME: $SB_DSH" >> "$LOG";; *) echo "[iso] FAIL sandbox DSH_HOME: $SB_DSH" >> "$LOG"; rc_iso=1;; esac
echo "[iso] real HOME=$REAL_HOME ; real library=$REAL_WM (used by no step)" >> "$LOG"

rc_tests=1; rc_type=1; rc_qa=1; rc_vendor=1; rc_boot=1; rc_live=1

rc=0
run_step() {
  local key="$1"; shift
  echo "### [$key] $*" >> "$LOG"
  "$@" >> "$LOG" 2>&1
  rc=$?
  echo "[exit=$rc] $key" >> "$LOG"
  echo >> "$LOG"
}

run_step tests     bun test packages;             rc_tests=$rc
run_step typecheck bun run typecheck;             rc_type=$rc
run_step testqa    bun run test:qa;               rc_qa=$rc
run_step vendor    node scripts/verify-vendor.mjs; rc_vendor=$rc
# the contract's own verify list (t3.acceptance[6] + t3.verify)
run_step verify-suite   bun test packages/mpd-workmate-plugin/test/workmate.test.ts; rc_vsuite=$rc
run_step verify-build   bun build packages/mpd-workmate-plugin/src/index.ts --target node --format esm --outfile packages/mpd-workmate-plugin/dist/index.js; rc_vbuild=$rc
run_step verify-newtest bun test packages/mpd-workmate-plugin/test/rename-delete.test.ts; rc_vnew=$rc

echo "### [boot] isolated DSH_HOME + sandbox HOME: install the bundle, then dump-config" >> "$LOG"
# NOTE: --dump-config only COMPOSES config and never APPLIES loader entries, so it cannot catch a
# plugin-tree load abort (a schema union did exactly that once). The real-boot step below is the gate
# that catches that class; this dump step is kept only to assert row composition and the dist path.
mkdir -p "$SB_DSH/store"
env HOME="$SB_HOME" DSH_HOME="$SB_DSH" dsh plugin --profile w add --store-dir "$SB_DSH/store" "$REPO" >> "$LOG" 2>&1
rc_install=$?
echo "[exit=$rc_install] boot-install (dsh plugin --profile w add <repo>)" >> "$LOG"
env HOME="$SB_HOME" DSH_HOME="$SB_DSH" dsh --profile w --dump-config > "$EV/dump-config.txt" 2> "$EV/dump-config.err"
rc_boot=$?
echo "[exit=$rc_boot] boot (dump bytes: $(wc -c < "$EV/dump-config.txt"))" >> "$LOG"
# The boot check only means something if it asserts THIS plugin's row and the artifact behind it.
grep -n "mpd-workmate" "$EV/dump-config.txt" >> "$LOG" 2>&1 || echo "NO mpd-workmate row in dump" >> "$LOG"
DIST="packages/mpd-workmate-plugin/dist/index.js"
# `grep -c` prints 0 AND exits 1 on no match, so swallow only the status (`|| true`), never append.
RENAME_HITS=$(grep -c "mpd_workmate_rename" "$DIST" 2>/dev/null || true)
DELETE_HITS=$(grep -c "mpd_workmate_delete" "$DIST" 2>/dev/null || true)
DEAD_HITS=$(grep -c "str_replace_editor\|apply_patch" "$DIST" 2>/dev/null || true)
RENAME_HITS=${RENAME_HITS:-0}; DELETE_HITS=${DELETE_HITS:-0}; DEAD_HITS=${DEAD_HITS:-0}
{
  echo "row present:        $(grep -q 'id: mpd-workmate' "$EV/dump-config.txt" && echo yes || echo NO)"
  echo "row path is dist:   $(grep -A6 'id: mpd-workmate' "$EV/dump-config.txt" | grep -q 'packages/mpd-workmate-plugin/dist/index.js' && echo yes || echo NO)"
  echo "dist rename tool:   $RENAME_HITS occurrence(s)"
  echo "dist delete tool:   $DELETE_HITS occurrence(s)"
  echo "dist dead names:    $DEAD_HITS occurrence(s) (must be 0)"
} >> "$LOG"
if grep -q 'id: mpd-workmate' "$EV/dump-config.txt" && [ "$RENAME_HITS" -ge 1 ] && [ "$DELETE_HITS" -ge 1 ] && [ "$DEAD_HITS" -eq 0 ]; then
  rc_boot=0
else
  rc_boot=1
fi
echo "[exit=$rc_boot] boot assertions (row composed + dist carries rename/delete + no dead names)" >> "$LOG"
echo >> "$LOG"

# THE gate for this class: a real boot that actually APPLIES the plugin tree (see boot-probe.sh).
echo "### [bootreal] real boot: does the plugin tree APPLY? (dump-config cannot answer this)" >> "$LOG"
BOOT_TIMEOUT=90 bash evidence/workmate/rename-delete-core/boot-probe.sh >> "$LOG" 2>&1
rc_bootreal=$?
BOOTEV=$(ls -d evidence/workmate/rename-delete-core/*-boot 2>/dev/null | tail -1)
echo "[exit=$rc_bootreal] bootreal (evidence: ${BOOTEV:-none})" >> "$LOG"
grep -E "loader-apply errors|MISSING_CREDENTIAL" "$BOOTEV/boot-probe.log" >> "$LOG" 2>&1 || true
echo >> "$LOG"

# Live §E(b) gate probe: cwd = repo (REAL team records), HOME = sandbox (library never touched).
echo "### [livegate] busyTeams against the REAL .mpd/team records (read-only, no mutation)" >> "$LOG"
env HOME="$SB_HOME" bun -e '
import { busyTeams } from "./packages/mpd-workmate-plugin/src/index.ts"
const keys = ["architect", "senior-engineer", "oracle-1", "oracle-2", "nonexistent-key"]
const out = {}
for (const k of keys) out[k] = busyTeams(k)
console.log(JSON.stringify(out, null, 2))
const ok = out["architect"].length > 0 && out["oracle-1"].length === 0 && out["nonexistent-key"].length === 0
console.log("LIVE_GATE_OK=" + ok)
process.exit(ok ? 0 : 1)
' >> "$LOG" 2>&1
rc_live=$?
echo "[exit=$rc_live] livegate" >> "$LOG"
echo >> "$LOG"

echo "=== git status --porcelain (after) ===" >> "$LOG"
git status --porcelain >> "$LOG" 2>&1
echo "HEAD=$(git rev-parse HEAD)" >> "$LOG"

REAL_AFTER=$(find "$REAL_WM" -maxdepth 2 2>/dev/null | sort)
if [ "$REAL_BEFORE" = "$REAL_AFTER" ]; then
  echo "[iso] real workmate library UNCHANGED by the sweep" >> "$LOG"
else
  echo "[iso] FAIL: the real workmate library changed during the sweep" >> "$LOG"
  rc_iso=1
fi
echo "[exit=$rc_iso] isolation assertions" >> "$LOG"

EV="$EV" rc_tests=$rc_tests rc_type=$rc_type rc_qa=$rc_qa rc_vendor=$rc_vendor rc_vsuite=$rc_vsuite rc_vbuild=$rc_vbuild rc_vnew=$rc_vnew rc_install=$rc_install rc_boot=$rc_boot rc_bootreal=$rc_bootreal rc_live=$rc_live rc_iso=$rc_iso python3 - <<'PY' >> "$LOG" 2>&1
import json, os
ev = os.environ["EV"]
def gate(name, key):
    rc = int(os.environ[key])
    return {name: {"exit": rc, "pass": rc == 0}}
res = {
    "task": "t3 - workmate rename + delete core (Senior Engineer)",
    "contract": ".mpd/plans/workmate-rename-delete-contract.md (sections A-M)",
    "gates": {},
    "isolation": {"HOME": "temp sandbox", "DSH_HOME": "temp sandbox", "real_home_untouched": True, "lifecycle_probe": "read-only busyTeams, no mutation"},
}
res["gates"].update(gate("bun test packages", "rc_tests"))
res["gates"].update(gate("bun run typecheck", "rc_type"))
res["gates"].update(gate("bun run test:qa", "rc_qa"))
res["gates"].update(gate("node scripts/verify-vendor.mjs", "rc_vendor"))
res["gates"].update(gate("verify: bun test packages/mpd-workmate-plugin/test/workmate.test.ts", "rc_vsuite"))
res["gates"].update(gate("verify: bun build src/index.ts -> dist/index.js (rebuild)", "rc_vbuild"))
res["gates"].update(gate("verify: bun test packages/mpd-workmate-plugin/test/rename-delete.test.ts", "rc_vnew"))
res["gates"].update(gate("dsh plugin --profile w add <repo> (isolated DSH_HOME)", "rc_install"))
res["gates"].update(gate("dsh --profile w --dump-config: mpd-workmate row composed + dist carries rename/delete", "rc_boot"))
res["gates"].update(gate("REAL boot (applies the plugin tree; dump-config cannot) - no loader-apply abort", "rc_bootreal"))
res["gates"].update(gate("live busyTeams probe against real .mpd/team (read-only)", "rc_live"))
res["gates"].update(gate("isolation: temp HOME/DSH_HOME, real workmate library unchanged", "rc_iso"))
res["all_passed"] = all(g["pass"] for g in res["gates"].values())
open(ev + "/result.json", "w").write(json.dumps(res, indent=2) + "\n")
print(json.dumps(res, indent=2))
PY
echo "SWEEP_DONE" >> "$LOG"
rm -rf "$SB_HOME" "$SB_DSH"
exit 0
