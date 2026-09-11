#!/usr/bin/env bash
# t12 MOUNT proof: a real boot of the full profile that MOUNTS the rows (not a composition dump),
# showing the whole tree loading plus every workmate tool registering and one tool answering.
#
# Instrumentation = the mount-probe.mjs overlay row (mounted with `--patch`, the pattern the repo's
# roles probe uses). --dump-config is NOT used as load evidence anywhere here: it composes rows
# without mounting them, which is exactly how the original green check missed this defect class.
set -u
cd "$(dirname "$0")/../../.."
REPO="$(pwd)"
[ -d "$REPO/.git" ] || { echo "FATAL: not the repo root: $REPO" >&2; exit 1; }
PROFILE="${PROFILE:-mpd}"
EV="evidence/workmate/rename-delete-core/$(date -u +%Y%m%dT%H%M%SZ)-mount"
mkdir -p "$EV"
LOG="$EV/mount-proof.log"
SB_DSH=$(mktemp -d /tmp/mpd-wm-mnt-dsh-XXXXXX)
SB_HOME=$(mktemp -d /tmp/mpd-wm-mnt-home-XXXXXX)
PROBE="$REPO/evidence/workmate/rename-delete-core/mount-probe.mjs"
PATCH="$SB_DSH/mount-probe.yml"

{
  echo "=== t12 MOUNT proof (profile: $PROFILE) ==="
  echo "repo=$REPO"
  echo "sandbox DSH_HOME=$SB_DSH"
  echo "sandbox HOME=$SB_HOME"
  echo "HEAD=$(git rev-parse HEAD)"
  echo "probe=$PROBE"
  echo "src type-array occurrences : $(grep -c 'type: \[' packages/mpd-workmate-plugin/src/index.ts || true)"
  echo "dist type-array occurrences: $(grep -c 'type: \[' packages/mpd-workmate-plugin/dist/index.js || true)"
  echo "delete schema (src): $(grep -o 'archived: { [^}]*}[^,]*' packages/mpd-workmate-plugin/src/index.ts | head -1)"
  echo
} > "$LOG"

for f in .credentials.yaml settings.yaml; do [ -f "$HOME/.dsh/$f" ] && cp "$HOME/.dsh/$f" "$SB_HOME/$f"; done
mkdir -p "$SB_DSH/store"
env HOME="$SB_HOME" DSH_HOME="$SB_DSH" dsh plugin --profile "$PROFILE" add --store-dir "$SB_DSH/store" "$REPO" > "$EV/install.log" 2>&1
echo "[exit=$?] dsh plugin --profile $PROFILE add <repo>" >> "$LOG"

# The overlay adds ONLY the probe row; the boot carries the full bundle.
printf -- "- insert:\n    - id: mount-probe\n      name: %s\n" "$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$PROBE")" > "$PATCH"
echo "[patch] $PATCH:" >> "$LOG"; cat "$PATCH" >> "$LOG"; echo >> "$LOG"

echo "### real boot with registration instrumentation: dsh --profile $PROFILE --patch <probe>" >> "$LOG"
env HOME="$SB_HOME" DSH_HOME="$SB_DSH" timeout "${BOOT_TIMEOUT:-60}" dsh --profile "$PROFILE" --patch "$PATCH" "say ok" > "$EV/mount-boot.log" 2>&1
rc_boot=$?
APPLY_ERR=$(grep -c "unsupported JSON schema\|JsonSchemaError\|plugin tree failed to load\|failed to apply loader entry" "$EV/mount-boot.log" 2>/dev/null || true)
APPLY_ERR=${APPLY_ERR:-0}
PROBE_DONE=$(grep -c "\[mount-probe\] DONE" "$EV/mount-boot.log" 2>/dev/null || true)
PROBE_DONE=${PROBE_DONE:-0}
TOOLS_OK=$(grep -o "WORKMATE_TOOLS_PRESENT=[0-9]*/[0-9]*" "$EV/mount-boot.log" | tail -1)
{
  echo "[exit=$rc_boot] real boot (124 = alive at the ${BOOT_TIMEOUT:-60}s cap, normal for a serving profile)"
  echo "apply-crash signatures : $APPLY_ERR (MUST be 0)"
  echo "probe completed        : $PROBE_DONE (1 = the probe reached its final marker)"
  echo "workmate tools present : ${TOOLS_OK:-none}"
  echo "--- mount-probe lines, verbatim ---"
  grep "\[mount-probe\]" "$EV/mount-boot.log" || echo "(no mount-probe output)"
  echo "--- boot log, verbatim ---"
  cat "$EV/mount-boot.log"
  echo "--- end ---"
} >> "$LOG"

rc=1
if [ "$APPLY_ERR" -eq 0 ] && [ "$PROBE_DONE" -eq 1 ] && [ "$TOOLS_OK" = "WORKMATE_TOOLS_PRESENT=7/7" ]; then rc=0; fi
echo "[exit=$rc] MOUNT proof: tree applied AND 7/7 workmate tools registered" >> "$LOG"

EV="$EV" rc=$rc rc_boot=$rc_boot APPLY_ERR=$APPLY_ERR PROBE_DONE=$PROBE_DONE TOOLS_OK="$TOOLS_OK" python3 - <<'PY' >> "$LOG" 2>&1
import json, os
ev = os.environ["EV"]
res = {
  "proof": "real boot that MOUNTS the rows (registration instrumentation via a --patch probe row)",
  "isolation": {"HOME": "temp sandbox", "DSH_HOME": "temp sandbox"},
  "apply_crash_signatures": int(os.environ["APPLY_ERR"]),
  "probe_reached_final_marker": int(os.environ["PROBE_DONE"]) == 1,
  "workmate_tools_registered": os.environ["TOOLS_OK"].split("=")[-1] if os.environ["TOOLS_OK"] else None,
  "boot_exit": int(os.environ["rc_boot"]),
  "passed": int(os.environ["rc"]) == 0 if "rc" in os.environ else False,
  "note": "no --dump-config result is cited as load evidence; the mount probe reads the live tool registry after a settle window",
}
open(ev + "/mount-proof.result.json", "w").write(json.dumps(res, indent=2) + "\n")
print(json.dumps(res, indent=2))
PY
echo DONE >> "$LOG"
rm -rf "$SB_DSH" "$SB_HOME"
exit 0
