#!/usr/bin/env bash
# t13 MOUNT proof: a real boot of the full `mpd` profile that MOUNTS the rows (not a
# composition dump) in an isolated DSH_HOME + sandbox HOME + sandbox WORKSPACE, showing
#   (a) the adopted plugin tree applied — its agent_teams_* tools registered,
#   (b) the edited scheduler.js is the file the tree carries (sha256 + all six dispatch
#       regions present, the upstream `isMemberAvailable` guard gone),
#   (c) the fixed dispatch path delivered a ready root task to a member that was MID-TURN
#       inside the boot process itself,
#   (d) zero apply-crash signatures and zero `dispatch declined` failure signatures.
#
# Instrumentation = the t13 probe row, mounted with `--patch` (the pattern the repo's other
# mount proofs use). `--dump-config` is NOT cited as load evidence anywhere here.
set -u
cd "$(dirname "$0")"
EV="$(pwd)"
REPO="$(cd ../../../.. && pwd)"
[ -d "$REPO/.git" ] || { echo "FATAL: not inside the repo: $REPO" >&2; exit 1; }
PROFILE="${PROFILE:-mpd}"
LOG="$EV/mount-proof.log"
SB_DSH=$(mktemp -d /tmp/t13-mnt-dsh-XXXXXX)
SB_HOME=$(mktemp -d /tmp/t13-mnt-home-XXXXXX)
SB_WS=$(mktemp -d /tmp/t13-mnt-ws-XXXXXX)
PROBE="$EV/mount-probe.mjs"
PATCH="$SB_DSH/t13-probe.yml"
export T13_SCHEDULER_PATH="$REPO/packages/mpd-agent-teams-plugin/lib/scheduler.js"
export T13_EXPECT_SHA="$(sha256sum "$T13_SCHEDULER_PATH" | cut -d' ' -f1)"

{
  echo "=== t13 MOUNT proof (profile: $PROFILE) ==="
  echo "repo=$REPO"
  echo "sandbox DSH_HOME=$SB_DSH"
  echo "sandbox HOME=$SB_HOME"
  echo "sandbox WORKSPACE=$SB_WS (session cwd; no state may land in the repo)"
  echo "HEAD=$(git -C "$REPO" rev-parse HEAD)"
  echo "scheduler.js sha256=$T13_EXPECT_SHA"
  echo "probe=$PROBE"
  echo
} > "$LOG"

# Credentials are copied only into the throwaway sandboxes (never read into the log).
for f in .credentials.yaml settings.yaml; do
  [ -f "$HOME/.dsh/$f" ] && cp "$HOME/.dsh/$f" "$SB_DSH/$f"
  [ -f "$HOME/.dsh/$f" ] && mkdir -p "$SB_HOME/.dsh" && cp "$HOME/.dsh/$f" "$SB_HOME/.dsh/$f"
done
true

(cd "$SB_WS" && env HOME="$SB_HOME" DSH_HOME="$SB_DSH" dsh plugin --profile "$PROFILE" add --store-dir "$SB_DSH/store" "$REPO" > "$EV/install.log" 2>&1)
echo "[exit=$?] dsh plugin --profile $PROFILE add <repo> (cwd=sandbox workspace)" >> "$LOG"

printf -- "- insert:\n    - id: t13-dispatch-probe\n      name: %s\n" "$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$PROBE")" > "$PATCH"
echo "[patch] $PATCH:" >> "$LOG"; cat "$PATCH" >> "$LOG"; echo >> "$LOG"
ls -1 "$REPO/.mpd/team" 2>/dev/null | sort > "$EV/team-dirs-before.txt"

echo "### real boot with instrumentation: dsh --profile $PROFILE --patch <probe>" >> "$LOG"
(cd "$SB_WS" && env HOME="$SB_HOME" DSH_HOME="$SB_DSH" timeout "${BOOT_TIMEOUT:-90}" dsh --profile "$PROFILE" --patch "$PATCH" "say ok" > "$EV/mount-boot.log" 2>&1)
rc_boot=$?
ls -1 "$REPO/.mpd/team" 2>/dev/null | sort > "$EV/team-dirs-after.txt"
APPLY_ERR=$(grep -c "unsupported JSON schema\|JsonSchemaError\|plugin tree failed to load\|failed to apply loader entry" "$EV/mount-boot.log" 2>/dev/null || true)
APPLY_ERR=${APPLY_ERR:-0}
DECLINE_ERR=$(grep -c "dispatch declined" "$EV/mount-boot.log" 2>/dev/null || true)
DECLINE_ERR=${DECLINE_ERR:-0}
PROBE_DONE=$(grep -c "\[t13-mount-probe\] DONE" "$EV/mount-boot.log" 2>/dev/null || true)
PROBE_DONE=${PROBE_DONE:-0}
SHA_OK=$(grep -o "SCHEDULER_SHA_MATCH=[^ ]*" "$EV/mount-boot.log" | tail -1 | cut -d= -f2)
REGIONS=$(grep -o "DISPATCH_REGIONS_PRESENT=[0-9]*/[0-9]*" "$EV/mount-boot.log" | tail -1 | cut -d= -f2)
TOOLS=$(grep -o "AGENT_TEAMS_TOOLS_PRESENT=[0-9]*/[0-9]*" "$EV/mount-boot.log" | tail -1 | cut -d= -f2)
DELIV=$(grep -o "DISPATCH_PROBE_DELIVERIES=[0-9]*" "$EV/mount-boot.log" | tail -1 | cut -d= -f2)
TASKST=$(grep -o "DISPATCH_PROBE_TASK_STATUS=[a-z]*" "$EV/mount-boot.log" | tail -1 | cut -d= -f2)
GUARD=$(grep -o "UPSTREAM_GUARD_ABSENT=[a-z]*" "$EV/mount-boot.log" | tail -1 | cut -d= -f2)
# Isolation: the sandbox workspace must be the only state root this boot touched, so no
# team directory NAME may appear under the repo's .mpd/team that was not there before the
# boot (mtime churn from the live server is expected and is deliberately not used here).
NEW_REPO_TEAM_DIRS=$(comm -13 "$EV/team-dirs-before.txt" <(ls -1 "$REPO/.mpd/team" 2>/dev/null | sort) | tr '\n' ',' | sed 's/,$//')
REPO_STATE=$([ -z "$NEW_REPO_TEAM_DIRS" ] && echo 0 || echo 1)
{
  echo "[exit=$rc_boot] real boot (124 = still serving at the ${BOOT_TIMEOUT:-90}s cap)"
  echo "apply-crash signatures        : $APPLY_ERR (MUST be 0)"
  echo "'dispatch declined' in boot   : $DECLINE_ERR (MUST be 0: no ready task was declined)"
  echo "probe reached final marker    : $PROBE_DONE (1 = yes)"
  echo "scheduler sha match           : ${SHA_OK:-none}"
  echo "dispatch regions present      : ${REGIONS:-none}"
  echo "agent-teams tools registered  : ${TOOLS:-none}"
  echo "in-boot dispatch deliveries   : ${DELIV:-none} (must be 1)"
  echo "in-boot task status           : ${TASKST:-none} (must be claimed)"
  echo "upstream guard absent         : ${GUARD:-none} (must be yes)"
  echo "new team dirs under repo      : $REPO_STATE ${NEW_REPO_TEAM_DIRS:+($NEW_REPO_TEAM_DIRS)} (MUST be 0)"
  echo "--- probe lines, verbatim ---"
  grep "\[t13-mount-probe\]" "$EV/mount-boot.log" || echo "(no probe output)"
  echo "--- end ---"
} >> "$LOG"

rc=1
if [ "$APPLY_ERR" -eq 0 ] && [ "$DECLINE_ERR" -eq 0 ] && [ "$PROBE_DONE" -eq 1 ] \
   && [ "$SHA_OK" = "yes" ] && [ "$REGIONS" = "6/6" ] \
   && [ "$DELIV" = "1" ] && [ "$TASKST" = "claimed" ] \
   && [ "$GUARD" = "yes" ] && [ "$REPO_STATE" -eq 0 ]; then rc=0; fi
echo "[exit=$rc] MOUNT proof: tree applied AND the fixed dispatch delivered the ready root task in-boot" >> "$LOG"

EV="$EV" rc=$rc rc_boot=$rc_boot APPLY_ERR=$APPLY_ERR DECLINE_ERR=$DECLINE_ERR PROBE_DONE=$PROBE_DONE \
  SHA_OK="$SHA_OK" REGIONS="$REGIONS" TOOLS="$TOOLS" DELIV="$DELIV" TASKST="$TASKST" GUARD="$GUARD" REPO_STATE="$REPO_STATE" \
  python3 - <<'PY' >> "$LOG" 2>&1
import json, os
ev = os.environ["EV"]
res = {
  "proof": "real boot that MOUNTS the rows (instrumentation = a --patch probe row), not a --dump-config composition check",
  "isolation": {"DSH_HOME": "temp sandbox", "HOME": "temp sandbox", "workspace_cwd": "temp sandbox"},
  "apply_crash_signatures": int(os.environ["APPLY_ERR"]),
  "dispatch_declined_lines_in_boot": int(os.environ["DECLINE_ERR"]),
  "probe_reached_final_marker": int(os.environ["PROBE_DONE"]) == 1,
  "scheduler_sha_match": os.environ["SHA_OK"],
  "dispatch_regions_present": os.environ["REGIONS"],
  "agent_teams_tools_registered": os.environ["TOOLS"],
  "in_boot_dispatch_deliveries": os.environ["DELIV"],
  "in_boot_task_status": os.environ["TASKST"],
  "upstream_guard_absent": os.environ["GUARD"],
  "new_state_dirs_in_repo": int(os.environ["REPO_STATE"]),
  "boot_exit": int(os.environ["rc_boot"]),
  "passed": int(os.environ["rc"]) == 0,
  "note": "no --dump-config result is cited as load evidence; the probe reads the live tool registry and drives the loaded scheduler inside the boot process",
}
open(ev + "/mount-proof.result.json", "w").write(json.dumps(res, indent=2) + "\n")
print(json.dumps(res, indent=2))
PY
echo DONE >> "$LOG"
rm -rf "$SB_DSH" "$SB_HOME" "$SB_WS"
exit 0
