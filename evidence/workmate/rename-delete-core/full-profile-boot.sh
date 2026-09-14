#!/usr/bin/env bash
# FULL-PROFILE boot check for the workmate plugin (captain request, t3 P1 blocker).
#
# Runs BOTH checks on the FULL profile in an isolated DSH_HOME + sandbox HOME:
#   1) `dsh --profile mpd --dump-config`              (composes every row of the full profile)
#   2) a REAL boot `dsh --profile mpd`                (APPLIES the tree — the check that catches a
#                                                      loader-apply abort such as a JSON-schema union)
# Check (2) exists because dump-config only composes rows and never executes plugin code: while the
# broken schema was on disk, a full-profile --dump-config exited 0 with the mpd-workmate row present
# and a real boot aborted with `plugin tree failed to load`. Both outputs are recorded verbatim.
# stdio goes to FILES only (long-lived MCP children hold inherited fds — never pipe dsh, §7).
set -u
cd "$(dirname "$0")/../../.."
REPO="$(pwd)"
[ -d "$REPO/.git" ] || { echo "FATAL: not the repo root: $REPO" >&2; exit 1; }
PROFILE="${PROFILE:-mpd}"
EV="evidence/workmate/rename-delete-core/$(date -u +%Y%m%dT%H%M%SZ)-fullboot"
mkdir -p "$EV"
LOG="$EV/full-boot.log"
SB_DSH=$(mktemp -d /tmp/mpd-wm-full-dsh-XXXXXX)
SB_HOME=$(mktemp -d /tmp/mpd-wm-full-home-XXXXXX)
REAL_DSH="$HOME/.dsh"

{
  echo "=== FULL-PROFILE boot check (profile: $PROFILE) ==="
  echo "repo=$REPO"
  echo "sandbox DSH_HOME=$SB_DSH"
  echo "sandbox HOME=$SB_HOME"
  echo "HEAD=$(git rev-parse HEAD)"
  echo "src schema line:   $(grep -c 'type: \["string", "null"\]' packages/mpd-workmate-plugin/src/index.ts) type-array occurrence(s)"
  echo "dist schema line:  $(grep -c 'type: \["string", "null"\]' packages/mpd-workmate-plugin/dist/index.js) type-array occurrence(s)"
  echo
} > "$LOG"

for f in .credentials.yaml settings.yaml; do
  if [ -f "$REAL_DSH/$f" ]; then cp "$REAL_DSH/$f" "$SB_HOME/$f"; echo "[setup] copied $f into the sandbox" >> "$LOG"; fi
done

mkdir -p "$SB_DSH/store"
env HOME="$SB_HOME" DSH_HOME="$SB_DSH" dsh plugin --profile "$PROFILE" add --store-dir "$SB_DSH/store" "$REPO" > "$EV/install.log" 2>&1
rc_install=$?
echo "[exit=$rc_install] dsh plugin --profile $PROFILE add <repo>" >> "$LOG"
echo >> "$LOG"

# ── check 1: full-profile dump-config ──────────────────────────────────────────────────────────
echo "### check 1: dsh --profile $PROFILE --dump-config" >> "$LOG"
env HOME="$SB_HOME" DSH_HOME="$SB_DSH" dsh --profile "$PROFILE" --dump-config > "$EV/dump-config.txt" 2> "$EV/dump-config.err"
rc_dump=$?
MPD_ROWS=$(grep -c "^ *- id: mpd-\|id: agent-teams\|id: mpd-web-compat" "$EV/dump-config.txt" 2>/dev/null || true)
MPD_ROWS=${MPD_ROWS:-0}
WORKMATE_ROW=$(grep -c "id: mpd-workmate" "$EV/dump-config.txt" 2>/dev/null || true)
WORKMATE_ROW=${WORKMATE_ROW:-0}
{
  echo "[exit=$rc_dump] dump-config (bytes: $(wc -c < "$EV/dump-config.txt"))"
  echo "mpd rows in the full profile: $MPD_ROWS"
  echo "id: mpd-workmate present: $WORKMATE_ROW"
  grep -n -A3 "id: mpd-workmate" "$EV/dump-config.txt" | head -8
  echo
} >> "$LOG"

# ── check 2: REAL boot on the same full profile ────────────────────────────────────────────────
echo "### check 2: REAL boot: dsh --profile $PROFILE (applies the tree)" >> "$LOG"
env HOME="$SB_HOME" DSH_HOME="$SB_DSH" timeout "${BOOT_TIMEOUT:-120}" dsh --profile "$PROFILE" "say ok" > "$EV/boot-stdout.log" 2>&1
rc_boot=$?
LOADER_ERR=$(grep -c "failed to apply loader entry\|unsupported JSON schema\|plugin tree failed to load" "$EV/boot-stdout.log" 2>/dev/null || true)
LOADER_ERR=${LOADER_ERR:-0}
{
  echo "[exit=$rc_boot] real boot (124 = still alive at the ${BOOT_TIMEOUT:-120}s cap, normal for a serving profile)"
  echo "loader-apply errors: $LOADER_ERR (MUST be 0)"
  echo "--- boot stdout, verbatim ---"
  cat "$EV/boot-stdout.log"
  echo "--- end boot stdout ---"
} >> "$LOG"

rc=1
if [ "$LOADER_ERR" -eq 0 ] && [ "$WORKMATE_ROW" -ge 1 ]; then rc=0; fi
echo "[exit=$rc] full-profile checks: dump row present AND no loader-apply abort" >> "$LOG"

EV="$EV" rc_dump=$rc_dump rc_boot=$rc_boot rc_install=$rc_install LOADER_ERR=$LOADER_ERR MPD_ROWS=$MPD_ROWS WORKMATE_ROW=$WORKMATE_ROW PROFILE="$PROFILE" python3 - <<'PY' >> "$LOG" 2>&1
import json, os
ev = os.environ["EV"]
res = {
  "check": "FULL profile (%s) in an isolated DSH_HOME + sandbox HOME" % os.environ["PROFILE"],
  "install_exit": int(os.environ["rc_install"]),
  "dump_config_exit": int(os.environ["rc_dump"]),
  "mpd_rows_in_full_profile": int(os.environ["MPD_ROWS"]),
  "mpd_workmate_row_present": int(os.environ["WORKMATE_ROW"]) >= 1,
  "real_boot_exit": int(os.environ["rc_boot"]),
  "loader_apply_errors": int(os.environ["LOADER_ERR"]),
  "verdict": "plugin tree APPLIED on the full profile"
             if int(os.environ["LOADER_ERR"]) == 0 and int(os.environ["WORKMATE_ROW"]) >= 1 else "FAILED",
  "note": "--dump-config alone cannot close this class (it never applies plugin code); the real boot is the decisive check",
}
open(ev + "/full-boot.result.json", "w").write(json.dumps(res, indent=2) + "\n")
print(json.dumps(res, indent=2))
PY

echo "SWEEP_DONE" >> "$LOG"
rm -rf "$SB_DSH" "$SB_HOME"
exit 0
