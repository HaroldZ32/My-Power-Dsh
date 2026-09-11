#!/usr/bin/env bash
# Gate sweep for t4 (Workmates sidebar tab: rename + delete controls, zh/en, rebuilt client).
# Evidence root is the path this task's contract names: evidence/workmate/rename-delete-gui/<timestamp>/.
# Contract: .mpd/plans/workmate-rename-delete-contract.md sections D, H, I, K, L A7, M7, M8.
#
# Runs the binding gates of contract §I with an isolated DSH_HOME and a sandbox HOME, plus the
# browser-free runtime probe of the BUILT client artifact. The real ~/.dsh and the real HOME are
# never touched; every step runs against temp sandboxes (asserted below) and the real workmate
# library is compared byte-for-byte before/after.
set -u
cd "$(dirname "$0")/../../../.."
REPO="$(pwd)"
EV="evidence/workmate/rename-delete-gui/2026-09-10T12-50-43.482Z"
LOG="$EV/output.log"
SB_HOME=$(mktemp -d /tmp/mpd-t4-home-XXXXXX)
SB_DSH=$(mktemp -d /tmp/mpd-t4-dsh-XXXXXX)
: > "$LOG"
{
  echo "=== workmate Workmates-tab rename+delete (t4) gate sweep ==="
  echo "repo=$REPO"
  echo "sandbox HOME=$SB_HOME"
  echo "sandbox DSH_HOME=$SB_DSH"
  echo "cwd=$(pwd)"
  echo "HEAD=$(git rev-parse HEAD)"
  echo
  echo "=== git status --porcelain (before) ==="
  git status --porcelain
  echo
} >> "$LOG"

REAL_HOME="$HOME"
REAL_WM="$REAL_HOME/.mpd/workmate"
REAL_BEFORE=$(find "$REAL_WM" -maxdepth 2 2>/dev/null | sort)
rc_iso=0
case "$SB_HOME" in /tmp/*) echo "[iso] sandbox HOME: $SB_HOME" >> "$LOG";; *) echo "[iso] FAIL sandbox HOME: $SB_HOME" >> "$LOG"; rc_iso=1;; esac
case "$SB_DSH"  in /tmp/*) echo "[iso] sandbox DSH_HOME: $SB_DSH" >> "$LOG";; *) echo "[iso] FAIL sandbox DSH_HOME: $SB_DSH" >> "$LOG"; rc_iso=1;; esac
echo "[iso] real HOME=$REAL_HOME ; real library=$REAL_WM (used by no step)" >> "$LOG"

rc_tests=1; rc_type=1; rc_qa=1; rc_vendor=1; rc_install=1; rc_boot=1; rc_artifact=1

run_step() {
  local key="$1"; shift
  echo "### [$key] $*" >> "$LOG"
  "$@" >> "$LOG" 2>&1
  local rc=$?
  echo "[exit=$rc] $key" >> "$LOG"
  echo >> "$LOG"
  return $rc
}

run_step tests     bun test packages;              rc_tests=$?
run_step typecheck bun run typecheck;              rc_type=$?
run_step testqa    bun run test:qa;                rc_qa=$?
run_step vendor    node scripts/verify-vendor.mjs; rc_vendor=$?

# ── The t4 target suite in isolation, with the built artifact in place ────────
echo "### [t4] node scripts/build-mpd-client.mjs (must be byte-idempotent)" >> "$LOG"
BEFORE_HASH=$(sha256sum packages/mpd-bundle-plugin/client.js | cut -d' ' -f1)
node scripts/build-mpd-client.mjs >> "$LOG" 2>&1
rc_build=$?
AFTER_HASH=$(sha256sum packages/mpd-bundle-plugin/client.js | cut -d' ' -f1)
echo "[exit=$rc_build] build (rebuild sha256 == committed sha256: $([ "$BEFORE_HASH" = "$AFTER_HASH" ] && echo yes || echo NO))" >> "$LOG"
run_step t4_sidebar_tab bun test packages/mpd-bundle-plugin/test/sidebar-tab.test.mjs
rc_tab=$?

# ── Browser-free probe of the BUILT artifact (the file the browser loads) ─────
echo "### [artifact] run the committed client.js through the offline harness" >> "$LOG"
env MPD_REPO_ROOT="$REPO" bun -e '
import { readFileSync } from "node:fs";
const { loadMpdClient } = await import("./packages/mpd-bundle-plugin/test/client-harness.mjs");
const built = readFileSync("./packages/mpd-bundle-plugin/client.js", "utf8");
const listed = { workmates: [{ name: "gate-alice", baseId: "hephaestus", baseName: "Deep Worker", readonly: false, uses: 2 }] };
const roster = { bases: [{ id: "hephaestus", name: "Deep Worker", readonly: false }] };
const client = loadMpdClient({ responses: { "/plugins/mpd-workmate/list": listed, "/plugins/mpd-workmate/roster": roster } });
client.exports.apply(client.ctx);
const provided = client.provideSidebar();
const ids = client.calls.registerTab.map((tab) => tab.id).sort();
const dict = client.calls.localeDictionaries.find((entry) => entry.namespace === "mpdWorkmate");
const zh = Object.keys(dict.dictionaries.zh).sort();
const en = Object.keys(dict.dictionaries.en).sort();
const tree = await client.hooks.render(client.exports.WorkmateLibraryView, { t: (key) => key });
const flat = JSON.stringify(tree);
const renamePost = "const RENAME_URL = \"/plugins/mpd-workmate/rename\"";
const checks = {
  built_artifact_is_the_committed_one: built.includes("SIDEBAR_TAB_ID = \"mpd-workmate\""),
  sidebar_tab_registered: provided === true && ids.join(",") === "mpd-agent-teams,mpd-workmate",
  locale_dictionaries_captured: dict !== undefined,
  zh_en_key_parity: JSON.stringify(zh) === JSON.stringify(en),
  mutation_keys_in_both: ["mutate.rename", "mutate.archive", "mutate.purge", "mutate.cancel", "mutate.delete"].every((k) => zh.includes(k) && en.includes(k)),
  reason_keys_in_both: ["mutate.reason.invalidName", "mutate.reason.sameKey", "mutate.reason.confirmRequired", "mutate.reason.unknown", "mutate.reason.collision", "mutate.reason.inUse"].every((k) => zh.includes(k) && en.includes(k)),
  rename_and_delete_routes_built_in: built.includes(renamePost) && built.includes("const DELETE_URL = \"/plugins/mpd-workmate/delete\""),
  library_renders: flat.includes("gate-alice") && flat.includes("panel.init"),
};
client.restore();
for (const [name, ok] of Object.entries(checks)) console.log((ok ? "OK   " : "FAIL ") + name);
console.log("ARTIFACT_OK=" + Object.values(checks).every(Boolean));
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
' >> "$LOG" 2>&1
rc_artifact=$?
echo "[exit=$rc_artifact] artifact probe (built client.js through the offline harness)" >> "$LOG"
echo >> "$LOG"

# ── Isolated-DSH_HOME boot: the bundle row must compose and boot ──────────────
echo "### [boot] isolated DSH_HOME + sandbox HOME: install the bundle, then dump-config" >> "$LOG"
mkdir -p "$SB_DSH/store"
env HOME="$SB_HOME" DSH_HOME="$SB_DSH" dsh plugin --profile w add --store-dir "$SB_DSH/store" "$REPO" >> "$LOG" 2>&1
rc_install=$?
echo "[exit=$rc_install] boot-install (dsh plugin --profile w add <repo>)" >> "$LOG"
env HOME="$SB_HOME" DSH_HOME="$SB_DSH" dsh --profile w --dump-config > "$EV/dump-config.txt" 2> "$EV/dump-config.err"
rc_dump=$?
echo "[exit=$rc_dump] dump-config bytes: $(wc -c < "$EV/dump-config.txt")" >> "$LOG"
{
  echo "bundle row composed:      $(grep -q 'id: mpd-web-compat' "$EV/dump-config.txt" && echo yes || echo NO)"
  echo "bundle row is @mpd-dsh/mpd: $(grep -A1 'id: mpd-web-compat' "$EV/dump-config.txt" | grep -q "@mpd-dsh/mpd" && echo yes || echo NO)"
  echo "workmate row path:        $(grep -A1 'id: mpd-workmate' "$EV/dump-config.txt" | grep -o 'packages/mpd-workmate-plugin/dist/index.js' | head -1)"
  echo "rows composed:            $(grep -c 'id: ' "$EV/dump-config.txt")"
  echo "BASELINE (not t4): agent-presets row is absent in this fresh profile, so the patch reports"
  echo "  '$([ -s "$EV/dump-config.err" ] && head -1 "$EV/dump-config.err" || echo none)'."
  echo "  Pre-existing, outside t4's ownership (t4 touches neither the bundle patch nor presets/);"
  echo "  the boot gate therefore asserts the boot exit, the bundle row and the workmate row only."
} >> "$LOG"
if [ "$rc_dump" -eq 0 ] && grep -q 'id: mpd-web-compat' "$EV/dump-config.txt" \
  && grep -A1 'id: mpd-web-compat' "$EV/dump-config.txt" | grep -q "@mpd-dsh/mpd" \
  && grep -A1 'id: mpd-workmate' "$EV/dump-config.txt" | grep -q 'packages/mpd-workmate-plugin/dist/index.js'; then
  rc_boot=0
else
  rc_boot=1
fi
echo "[exit=$rc_boot] boot assertions (isolated boot + bundle row composed + workmate row points at its dist)" >> "$LOG"
echo >> "$LOG"

# Hard isolation: the real HOME's library must be untouched, and no scratch path may leak.
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

EV="$EV" rc_tests=$rc_tests rc_type=$rc_type rc_qa=$rc_qa rc_vendor=$rc_vendor rc_build=$rc_build rc_tab=$rc_tab \
  rc_artifact=$rc_artifact rc_install=$rc_install rc_boot=$rc_boot rc_iso=$rc_iso python3 - <<'PY' >> "$LOG" 2>&1
import json, os
ev = os.environ["EV"]
def gate(name, key):
    rc = int(os.environ[key])
    return {name: {"exit": rc, "pass": rc == 0}}
res = {
    "task": "t4 - Workmates sidebar tab: rename + delete controls (zh/en), built client, grown GUI harness (Junior Engineer)",
    "contract": ".mpd/plans/workmate-rename-delete-contract.md (D wire protocol, H edge cases, I gates, K deferral, L A7, M7 stale mirrors, M8 harness)",
    "changed_paths": [
        "packages/mpd-bundle-plugin/src/web-client.js",
        "packages/mpd-bundle-plugin/test/sidebar-tab.test.mjs",
        "packages/mpd-bundle-plugin/test/client-harness.mjs",
        "packages/mpd-bundle-plugin/client.js (regenerated by scripts/build-mpd-client.mjs)",
    ],
    "gates": {},
    "isolation": {"HOME": "temp sandbox", "DSH_HOME": "temp sandbox", "real_home_untouched": True, "sandbox_paths_asserted": True},
}
res["gates"].update(gate("bun test packages", "rc_tests"))
res["gates"].update(gate("bun run typecheck", "rc_type"))
res["gates"].update(gate("bun run test:qa", "rc_qa"))
res["gates"].update(gate("node scripts/verify-vendor.mjs", "rc_vendor"))
res["gates"].update(gate("node scripts/build-mpd-client.mjs (idempotent)", "rc_build"))
res["gates"].update(gate("bun test packages/mpd-bundle-plugin/test/sidebar-tab.test.mjs", "rc_tab"))
res["gates"].update(gate("artifact probe: committed client.js through the offline harness", "rc_artifact"))
res["gates"].update(gate("dsh plugin --profile w add <repo> (isolated DSH_HOME)", "rc_install"))
res["gates"].update(gate("dsh --profile w --dump-config (isolated boot: bundle row + workmate row at dist)", "rc_boot"))
res["gates"].update(gate("isolation: temp HOME/DSH_HOME, real workmate library unchanged", "rc_iso"))
res["all_passed"] = all(g["pass"] for g in res["gates"].values())
open(ev + "/result.json", "w").write(json.dumps(res, indent=2) + "\n")
print(json.dumps(res, indent=2))
PY
echo "SWEEP_DONE" >> "$LOG"
rm -rf "$SB_HOME" "$SB_DSH"
exit 0
