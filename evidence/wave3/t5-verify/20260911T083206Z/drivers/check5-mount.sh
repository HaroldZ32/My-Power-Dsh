#!/usr/bin/env bash
# t5 INDEPENDENT verification driver 5c/5 — a MOUNTING boot (never --dump-config) in an isolated
# DSH_HOME + HOME + workspace. Proves: the adopted row applies, the freshly loaded module
# registers every tool my own source scan expects, and the fixed `agent_teams_update_task`
# contract (`status` REQUIRED) is what a NEW session would get. Also asserts isolation.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../../../.." && pwd)"
EV="$(cd "$HERE/.." && pwd)"
LOG="$EV/check5-mount.log"
: > "$LOG"

# ---- 0. expected tool list from THIS driver's own scan of the adopted source ----
node -e '
const { readFileSync, writeFileSync } = require("node:fs")
const src = readFileSync(process.argv[1] + "/packages/mpd-agent-teams-plugin/lib/tools.js", "utf8")
const names = [...src.matchAll(/name:\s*'"'"'(agent_teams_[a-z_]+)'"'"'/g)].map((m) => m[1])
if (names.length === 0) throw new Error("source scan found no agent_teams tools")
writeFileSync(process.argv[1] + "/evidence/wave3/t5-verify/20260911T083206Z/drivers/expected-tools.json", JSON.stringify(names, null, 2) + "\n")
console.log("[t5] source scan expected tools: " + names.length + " -> " + names.join(", "))
' "$REPO" | tee -a "$LOG"

SB_DSH="$(mktemp -d /tmp/mpd-t5-mnt-dsh-XXXXXX)"
SB_HOME="$(mktemp -d /tmp/mpd-t5-mnt-home-XXXXXX)"
SB_WS="$(mktemp -d /tmp/mpd-t5-mnt-ws-XXXXXX)"
PROBE="$HERE/t5-mount-probe.mjs"
PATCH="$SB_DSH/mount-probe.yml"

{
    echo "=== t5 MOUNT verification ==="
    echo "repo=$REPO HEAD=$(git -C "$REPO" rev-parse HEAD)"
    echo "sandbox DSH_HOME=$SB_DSH HOME=$SB_HOME WORKSPACE=$SB_WS"
    echo "live tools.js sha256=$(sha256sum "$REPO/packages/mpd-agent-teams-plugin/lib/tools.js" | awk '{print $1}')"
    echo "live registry sha256=$(sha256sum "$REPO/packages/mpd-agent-teams-plugin/lib/mpd-deltas.js" | awk '{print $1}')"
    echo
} >> "$LOG"

for f in .credentials.yaml settings.yaml; do [ -f "$HOME/.dsh/$f" ] && cp "$HOME/.dsh/$f" "$SB_HOME/$f"; done
mkdir -p "$SB_DSH/store"
env HOME="$SB_HOME" DSH_HOME="$SB_DSH" dsh plugin --profile mpd add --store-dir "$SB_DSH/store" "$REPO" > "$EV/check5-install.log" 2>&1
RC_INSTALL=$?
echo "[exit=$RC_INSTALL] dsh plugin --profile mpd add <repo>" >> "$LOG"

LIB_JSON="$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$PROBE")"
printf -- "- insert:\n    - id: t5-agent-teams-mount-probe\n      name: %s\n" "$LIB_JSON" > "$PATCH"

( cd "$SB_WS" && env HOME="$SB_HOME" DSH_HOME="$SB_DSH" DSH_WORKSPACE_ROOT="$SB_WS" timeout "${BOOT_TIMEOUT:-90}" dsh --profile mpd --patch "$PATCH" "say ok" ) > "$EV/check5-mount-boot.log" 2>&1
RC_BOOT=$?
BOOT="$EV/check5-mount-boot.log"
APPLY_ERR=$(grep -c "unsupported JSON schema\|JsonSchemaError\|plugin tree failed to load\|failed to apply loader entry\|without inject" "$BOOT" || true)
PROBE_DONE=$(grep -c "\[t5-mount-probe\] DONE" "$BOOT" || true)
TOOLS_OK=$(grep -o "AGENT_TEAMS_TOOLS_PRESENT=[0-9]*/[0-9]*" "$BOOT" | tail -1)
STATUS_REQ=$(grep -o "UPDATE_TASK_STATUS_REQUIRED=[a-z]*" "$BOOT" | tail -1)
REQ_WORDING=$(grep -o "UPDATE_TASK_DESCRIPTION_HAS_REQUIRED_WORDING=[a-z]*" "$BOOT" | tail -1)
T4_TOOL=$(grep -o "T4_TOOL_agent_teams_task_contract=[A-Z]*" "$BOOT" | tail -1)
{
    echo
    echo "### mounted boot (profile mpd, cwd=$SB_WS)"
    echo "[exit=$RC_BOOT] (124 = still alive at the ${BOOT_TIMEOUT:-90}s cap)"
    echo "apply-crash signatures : ${APPLY_ERR:-0} (MUST be 0)"
    echo "probe reached DONE     : ${PROBE_DONE:-0} (1 = registration read completed)"
    echo "agent-teams tools      : ${TOOLS_OK:-none}"
    echo "update_task status req : ${STATUS_REQ:-none}"
    echo "required wording       : ${REQ_WORDING:-none}"
    echo "t4 tool (task contract): ${T4_TOOL:-none}"
    echo "--- probe lines ---"
    grep "\[t5-mount-probe\]" "$BOOT" || echo "(none)"
    echo "--- boot log head ---"
    head -12 "$BOOT"
} >> "$LOG"

SANDBOX_SESSIONS="$(find "$SB_DSH/sessions" -type d -name "session-*" 2>/dev/null | xargs -r -n1 basename | sort -u)"
LEAK_TEAMS=0
ATTRIBUTED=""
for d in $(find "$REPO/.mpd/team" -maxdepth 1 -name "mpd-default-*" -newermt "-25 minutes" 2>/dev/null | sort); do
    cap="$(node -e 'try{process.stdout.write(require(process.argv[1]).captainSessionId||"")}catch(e){}' "$d/team.json" 2>/dev/null || true)"
    ATTRIBUTED="$ATTRIBUTED $d(captain=$cap)"
    if [ -n "$cap" ] && printf '%s\n' "$SANDBOX_SESSIONS" | grep -qx "$cap"; then
        LEAK_TEAMS=$((LEAK_TEAMS + 1))
    fi
done
REAL_KEY="--root-dshProj-my-power-dsh--"
SESSION_LEAK=$(find "$SB_DSH/sessions" -maxdepth 1 -name "*${REAL_KEY}*" 2>/dev/null | wc -l)
echo "isolation: sandbox sessions = $(printf '%s' "$SANDBOX_SESSIONS" | tr '\n' ' ')" >> "$LOG"
echo "isolation: recent real-workspace team records and captains:$ATTRIBUTED" >> "$LOG"
echo "isolation: records attributable to this boot (want 0) = $LEAK_TEAMS" >> "$LOG"
echo "isolation: real-workspace session keys inside the sandbox (want 0) = $SESSION_LEAK" >> "$LOG"

RC_INSTALL="$RC_INSTALL" RC_BOOT="$RC_BOOT" APPLY_ERR="${APPLY_ERR:-0}" PROBE_DONE="${PROBE_DONE:-0}" \
TOOLS_OK="${TOOLS_OK:-none}" STATUS_REQ="${STATUS_REQ:-none}" REQ_WORDING="${REQ_WORDING:-none}" T4_TOOL="${T4_TOOL:-none}" \
LEAK_TEAMS="$LEAK_TEAMS" SESSION_LEAK="$SESSION_LEAK" LOG="$LOG" EV="$EV" BOOT="$BOOT" python3 - <<'PY'
import json, os
log = open(os.environ["LOG"]).read()
def num(name): return int(os.environ[name])
expected = json.load(open(os.environ["EV"] + "/drivers/expected-tools.json"))
res = {
    "driver": "check5-mount",
    "isolation": {"DSH_HOME": "temp sandbox", "HOME": "temp sandbox", "workspace": "temp sandbox (cwd of the boot)"},
    "expected_tools_from_own_source_scan": expected,
    "install": {"exit": num("RC_INSTALL")},
    "mounted_boot": {
        "exit": num("RC_BOOT"),
        "apply_crash_signatures": num("APPLY_ERR"),
        "probe_reached_done": num("PROBE_DONE") == 1,
        "agent_teams_tools_present": os.environ["TOOLS_OK"].split("=")[-1],
        "update_task_status_required": os.environ["STATUS_REQ"].split("=")[-1] == "true",
        "update_task_required_wording": os.environ["REQ_WORDING"].split("=")[-1] == "true",
        "t4_tool_agent_teams_task_contract": os.environ["T4_TOOL"].split("=")[-1],
        "probe_lines": [l for l in open(os.environ["BOOT"]).read().splitlines() if "[t5-mount-probe]" in l],
    },
    "isolation_assertions": {"records_attributable_to_this_boot": num("LEAK_TEAMS"), "real_workspace_session_keys_in_sandbox": num("SESSION_LEAK")},
    "note": "no --dump-config result is cited as load evidence; the probe reads the live tool registry of a mounted boot after a settle window",
}
res["passed"] = (
    res["install"]["exit"] == 0
    and res["mounted_boot"]["apply_crash_signatures"] == 0
    and res["mounted_boot"]["probe_reached_done"]
    and res["mounted_boot"]["agent_teams_tools_present"] == f"{len(expected)}/{len(expected)}"
    and res["mounted_boot"]["update_task_status_required"]
    and res["mounted_boot"]["update_task_required_wording"]
    and res["mounted_boot"]["t4_tool_agent_teams_task_contract"] == "REGISTERED"
    and num("LEAK_TEAMS") == 0
    and num("SESSION_LEAK") == 0
)
open(os.environ["EV"] + "/check5-mount.result.json", "w").write(json.dumps(res, indent=2) + "\n")
print(json.dumps({"driver": "check5-mount", "passed": res["passed"], "tools": res["mounted_boot"]["agent_teams_tools_present"], "apply_crash_signatures": res["mounted_boot"]["apply_crash_signatures"]}))
PY
rm -rf "$SB_DSH" "$SB_HOME" "$SB_WS"
