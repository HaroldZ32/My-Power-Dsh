#!/usr/bin/env bash
# t8 verification driver 5/4 — mounted boot of the agent-teams row (REAL load, not composition)
# plus the plugin suite. Isolated DSH_HOME + HOME + WORKSPACE; the real ~/.dsh and the real
# workspace .mpd are never touched.
#
#   A. bun test packages/mpd-agent-teams-plugin
#   B. dsh plugin --profile mpd add <repo> into a temp DSH_HOME, then a boot carrying the full
#      bundle plus a registration-instrumentation probe row. --dump-config is NOT used as load
#      evidence anywhere.
#   C. isolation assertions: no team record / session key leaks into the real workspace.
#
# Usage: bash check5-mount.sh
set -u
cd "$(dirname "$0")/../../../../.."
REPO="$(pwd)"
EV="${EV_OUT:-$(cd "$(dirname "$0")/.." && pwd)}"
LOG="$EV/check5-mount.log"
: > "$LOG"

SB_DSH="$(mktemp -d /tmp/mpd-t8-mnt-dsh-XXXXXX)"
SB_HOME="$(mktemp -d /tmp/mpd-t8-mnt-home-XXXXXX)"
SB_WS="$(mktemp -d /tmp/mpd-t8-mnt-ws-XXXXXX)"
PROBE="$EV/drivers/agent-teams-mount-probe.mjs"
PATCH="$SB_DSH/mount-probe.yml"

{
    echo "=== t8 MOUNT verification ==="
    echo "repo=$REPO  HEAD=$(git rev-parse HEAD)"
    echo "sandbox DSH_HOME=$SB_DSH HOME=$SB_HOME WORKSPACE=$SB_WS"
    echo "live quality-gates.js sha256=$(sha256sum packages/mpd-agent-teams-plugin/lib/quality-gates.js | awk '{print $1}')"
    echo "live registered-tool count (source scan): $(grep -c 'ctx.tools.register(defineTool' packages/mpd-agent-teams-plugin/lib/tools.js)"
    echo
} >> "$LOG"

# ---- A. plugin suite ----
( cd "$REPO" && bun test packages/mpd-agent-teams-plugin ) > "$EV/check5-plugin-suite.log" 2>&1
RC_SUITE=$?
echo "[exit=$RC_SUITE] bun test packages/mpd-agent-teams-plugin" >> "$LOG"
tail -5 "$EV/check5-plugin-suite.log" >> "$LOG"

# ---- B. install + mounted boot ----
for f in .credentials.yaml settings.yaml; do [ -f "$HOME/.dsh/$f" ] && cp "$HOME/.dsh/$f" "$SB_HOME/$f"; done
mkdir -p "$SB_DSH/store"
env HOME="$SB_HOME" DSH_HOME="$SB_DSH" dsh plugin --profile mpd add --store-dir "$SB_DSH/store" "$REPO" > "$EV/check5-install.log" 2>&1
RC_INSTALL=$?
echo "[exit=$RC_INSTALL] dsh plugin --profile mpd add <repo>" >> "$LOG"
LIB_JSON="$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$PROBE")"
printf -- "- insert:\n    - id: agent-teams-mount-probe\n      name: %s\n" "$LIB_JSON" > "$PATCH"

( cd "$SB_WS" && env HOME="$SB_HOME" DSH_HOME="$SB_DSH" DSH_WORKSPACE_ROOT="$SB_WS" timeout "${BOOT_TIMEOUT:-90}" dsh --profile mpd --patch "$PATCH" "say ok" ) > "$EV/check5-mount-boot.log" 2>&1
RC_BOOT=$?
BOOT="$EV/check5-mount-boot.log"
APPLY_ERR=$(grep -c "unsupported JSON schema\|JsonSchemaError\|plugin tree failed to load\|failed to apply loader entry\|without inject" "$BOOT" || true)
PROBE_DONE=$(grep -c "\[mount-probe\] DONE" "$BOOT" || true)
TOOLS_OK=$(grep -o "AGENT_TEAMS_TOOLS_PRESENT=[0-9]*/[0-9]*" "$BOOT" | tail -1)
T4_TOOL=$(grep -o "T4_TOOL_agent_teams_task_contract=[A-Z]*" "$BOOT" | tail -1)
{
    echo
    echo "### mounted boot (profile mpd, cwd=$SB_WS)"
    echo "[exit=$RC_BOOT] (124 = still alive at the ${BOOT_TIMEOUT:-90}s cap)"
    echo "apply-crash signatures : ${APPLY_ERR:-0} (MUST be 0)"
    echo "probe reached DONE     : ${PROBE_DONE:-0} (1 = registration read completed)"
    echo "agent-teams tools      : ${TOOLS_OK:-none}"
    echo "t4 tool (task contract): ${T4_TOOL:-none}"
    echo "--- mount-probe lines ---"
    grep "\[mount-probe\]" "$BOOT" || echo "(none)"
    echo "--- boot log head ---"
    head -20 "$BOOT"
} >> "$LOG"

# ---- C. isolation assertions (the workspace must stay clean) ----
# Attempt 2: the leak counter is ATTRIBUTED, not a bare timestamp window. The repo legitimately
# accumulates `mpd-default-*` records because the session-start team policy auto-provisions a team
# for every new session in this workspace (concurrent members included), so a time-window count
# flags other people's sessions. A leak is a record in the REAL workspace whose captain session is
# one of THIS boot's sessions.
SANDBOX_SESSIONS="$(find "$SB_DSH/sessions" -type d -name "session-*" 2>/dev/null | xargs -r -n1 basename | sort -u)"
LEAK_TEAMS=0
LEAK_DETAIL=""
ATTRIBUTED=""
for d in $(find "$REPO/.mpd/team" -maxdepth 1 -name "mpd-default-*" -newermt "-20 minutes" 2>/dev/null | sort); do
    cap="$(node -e 'try{process.stdout.write(require(process.argv[1]).captainSessionId||"")}catch(e){}' "$d/team.json" 2>/dev/null || true)"
    ATTRIBUTED="$ATTRIBUTED $d(captain=$cap)"
    if [ -n "$cap" ] && printf '%s\n' "$SANDBOX_SESSIONS" | grep -qx "$cap"; then
        LEAK_TEAMS=$((LEAK_TEAMS + 1))
        LEAK_DETAIL="$LEAK_DETAIL $d(captain=$cap)"
    fi
done
REAL_KEY="--root-dshProj-my-power-dsh--"
SESSION_LEAK=$(find "$SB_DSH/sessions" -maxdepth 1 -name "*${REAL_KEY}*" 2>/dev/null | wc -l)
echo "isolation: sandbox sessions created by this boot = $(printf '%s' "$SANDBOX_SESSIONS" | tr '\n' ' ')" >> "$LOG"
echo "isolation: real-workspace records created in the window, with their captain sessions:$ATTRIBUTED" >> "$LOG"
echo "isolation: records ATTRIBUTABLE to this boot (want 0) = $LEAK_TEAMS$LEAK_DETAIL" >> "$LOG"
echo "isolation: session keys for the real workspace in the sandbox = $SESSION_LEAK (want 0)" >> "$LOG"

RC_SUITE="$RC_SUITE" RC_INSTALL="$RC_INSTALL" RC_BOOT="$RC_BOOT" APPLY_ERR="${APPLY_ERR:-0}" PROBE_DONE="${PROBE_DONE:-0}" \
TOOLS_OK="${TOOLS_OK:-none}" T4_TOOL="${T4_TOOL:-none}" LEAK_TEAMS="$LEAK_TEAMS" SESSION_LEAK="$SESSION_LEAK" \
LOG="$LOG" EV="$EV" BOOT="$BOOT" python3 - <<'PY'
import json, os, re
log = open(os.environ["LOG"]).read()
def num(name): return int(os.environ[name])
tools_ok = os.environ["TOOLS_OK"]
res = {
    "driver": "check5-mount",
    "isolation": {"DSH_HOME": "temp sandbox", "HOME": "temp sandbox", "workspace": "temp sandbox (cwd of the boot)"},
    "plugin_suite": {"exit": num("RC_SUITE"), "tail": [l for l in open(os.environ["EV"] + "/check5-plugin-suite.log").read().splitlines() if l.strip()][-3:]},
    "install": {"exit": num("RC_INSTALL")},
    "mounted_boot": {
        "exit": num("RC_BOOT"),
        "apply_crash_signatures": num("APPLY_ERR"),
        "probe_reached_done": num("PROBE_DONE") == 1,
        "agent_teams_tools_present": tools_ok.split("=")[-1] if "=" in tools_ok else None,
        "t4_tool_agent_teams_task_contract": os.environ["T4_TOOL"].split("=")[-1] if "=" in os.environ["T4_TOOL"] else None,
        "probe_lines": [l for l in open(os.environ["BOOT"]).read().splitlines() if "[mount-probe]" in l],
    },
    "isolation_assertions": {"new_team_dirs_in_real_workspace": num("LEAK_TEAMS"), "real_workspace_session_keys_in_sandbox": num("SESSION_LEAK")},
    "note": "no --dump-config result is cited as load evidence; the probe reads the live tool registry after a settle window",
}
res["passed"] = (
    res["plugin_suite"]["exit"] == 0
    and res["install"]["exit"] == 0
    and res["mounted_boot"]["apply_crash_signatures"] == 0
    and res["mounted_boot"]["probe_reached_done"]
    and res["mounted_boot"]["agent_teams_tools_present"] == "14/14"
    and res["mounted_boot"]["t4_tool_agent_teams_task_contract"] == "REGISTERED"
    and num("LEAK_TEAMS") == 0
    and num("SESSION_LEAK") == 0
)
open(os.environ["EV"] + "/check5-mount.raw.json", "w").write(json.dumps(res, indent=2) + "\n")
print(json.dumps(res, indent=2))
PY
rm -rf "$SB_DSH" "$SB_HOME" "$SB_WS"
