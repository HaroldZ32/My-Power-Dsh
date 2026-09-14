#!/usr/bin/env bash
# t4 (B4) MOUNT proof: a real boot of the full profile that MOUNTS the rows (never a composition
# dump), showing the plugin tree loading with 0 apply-crash signatures, the hashline row present in
# the LIVE tool registry, and the fixed `mpd_hashline_edit` parameters answering real read/edit calls
# with `lines` as BOTH a single string and an array of strings.
#
# Instrumentation = the mount-probe.mjs overlay row (mounted with `--patch`, the pattern this repo's
# roles probe uses). --dump-config is NOT used as load evidence anywhere here: it composes rows
# without ever executing plugin code, which is exactly how this defect class stays invisible.
set -u
cd "$(dirname "$0")/../../.."
REPO="$(pwd)"
[ -d "$REPO/.git" ] || { echo "FATAL: not the repo root: $REPO" >&2; exit 1; }
PROFILE="${PROFILE:-mpd}"
EV="evidence/hashline/schema-union-fix/$(date -u +%Y%m%dT%H%M%SZ)-mount"
mkdir -p "$EV"
LOG="$EV/mount-proof.log"
SB_DSH=$(mktemp -d /tmp/mpd-hl-mnt-dsh-XXXXXX)
SB_HOME=$(mktemp -d /tmp/mpd-hl-mnt-home-XXXXXX)
PROBE="$REPO/evidence/hashline/schema-union-fix/mount-probe.mjs"
PATCH="$SB_DSH/mount-probe.yml"

{
  echo "=== t4 (B4) MOUNT proof (profile: $PROFILE) ==="
  echo "repo=$REPO"
  echo "sandbox DSH_HOME=$SB_DSH"
  echo "sandbox HOME=$SB_HOME"
  echo "HEAD=$(git rev-parse HEAD)"
  echo "probe=$PROBE"
  echo "src type-array occurrences : $(grep -cE 'type:\s*\[' packages/mpd-hashline-plugin/src/index.ts || true)"
  echo "dist type-array occurrences: $(grep -cE 'type:\s*\[' packages/mpd-hashline-plugin/dist/index.js || true)"
  echo "lines node (src): $(grep -o 'lines: { oneOf[^}]*}[^]]*]' packages/mpd-hashline-plugin/src/index.ts | head -1)"
  echo
} > "$LOG"

for f in .credentials.yaml settings.yaml; do [ -f "$HOME/.dsh/$f" ] && cp "$HOME/.dsh/$f" "$SB_HOME/$f"; done
mkdir -p "$SB_DSH/store"
env HOME="$SB_HOME" DSH_HOME="$SB_DSH" dsh plugin --profile "$PROFILE" add --store-dir "$SB_DSH/store" "$REPO" > "$EV/install.log" 2>&1
echo "[exit=$?] dsh plugin --profile $PROFILE add <repo>" >> "$LOG"

# The overlay adds ONLY the probe row; the boot carries the full bundle.
printf -- "- insert:\n    - id: hashline-mount-probe\n      name: %s\n" "$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$PROBE")" > "$PATCH"
echo "[patch] $PATCH:" >> "$LOG"; cat "$PATCH" >> "$LOG"; echo >> "$LOG"

echo "### real boot with registration instrumentation: dsh --profile $PROFILE --patch <probe>" >> "$LOG"
env HOME="$SB_HOME" DSH_HOME="$SB_DSH" timeout "${BOOT_TIMEOUT:-75}" dsh --profile "$PROFILE" --patch "$PATCH" "say ok" > "$EV/mount-boot.log" 2>&1
rc_boot=$?
APPLY_ERR=$(grep -c "unsupported JSON schema\|JsonSchemaError\|plugin tree failed to load\|failed to apply loader entry" "$EV/mount-boot.log" 2>/dev/null || true)
APPLY_ERR=${APPLY_ERR:-0}
PROBE_DONE=$(grep -c "\[hashline-probe\] DONE" "$EV/mount-boot.log" 2>/dev/null || true)
PROBE_DONE=${PROBE_DONE:-0}
TOOLS_OK=$(grep -o "HASHLINE_TOOLS_PRESENT=[0-9]*/[0-9]*" "$EV/mount-boot.log" | tail -1)
LIVE_TYPE_ARRAY=$(grep -o "LIVE_SCHEMA_TYPE_ARRAY=[a-zA-Z]*" "$EV/mount-boot.log" | tail -1)
EDIT_STRING=$(grep -o "EDIT_LINES_STRING=[a-z]*" "$EV/mount-boot.log" | tail -1)
EDIT_ARRAY=$(grep -o "EDIT_LINES_ARRAY=[a-z]*" "$EV/mount-boot.log" | tail -1)
READ_OK=$(grep -o "READ=ok" "$EV/mount-boot.log" | tail -1)
{
  echo "[exit=$rc_boot] real boot (124 = alive at the ${BOOT_TIMEOUT:-75}s cap, normal for a serving profile)"
  echo "apply-crash signatures : $APPLY_ERR (MUST be 0)"
  echo "probe completed        : $PROBE_DONE (1 = the probe reached its final marker)"
  echo "hashline tools present : ${TOOLS_OK:-none}"
  echo "live schema type array : ${LIVE_TYPE_ARRAY:-none} (must be LIVE_SCHEMA_TYPE_ARRAY=absent)"
  echo "real read              : ${READ_OK:-none}"
  echo "real edit (string)     : ${EDIT_STRING:-none}"
  echo "real edit (array)      : ${EDIT_ARRAY:-none}"
  echo "--- mount-probe lines, verbatim ---"
  grep "\[hashline-probe\]" "$EV/mount-boot.log" || echo "(no mount-probe output)"
  echo "--- boot log, verbatim ---"
  cat "$EV/mount-boot.log"
  echo "--- end ---"
} >> "$LOG"

rc=1
if [ "$APPLY_ERR" -eq 0 ] && [ "$PROBE_DONE" -eq 1 ] && [ "$TOOLS_OK" = "HASHLINE_TOOLS_PRESENT=4/4" ] \
   && [ "$LIVE_TYPE_ARRAY" = "LIVE_SCHEMA_TYPE_ARRAY=absent" ] && [ "$READ_OK" = "READ=ok" ] \
   && [ "$EDIT_STRING" = "EDIT_LINES_STRING=ok" ] && [ "$EDIT_ARRAY" = "EDIT_LINES_ARRAY=ok" ]; then rc=0; fi
echo "[exit=$rc] MOUNT proof: tree applied AND 4/4 hashline tools registered AND real read/edit ok" >> "$LOG"

EV="$EV" rc=$rc rc_boot=$rc_boot APPLY_ERR=$APPLY_ERR PROBE_DONE=$PROBE_DONE TOOLS_OK="$TOOLS_OK" \
  LIVE_TYPE_ARRAY="$LIVE_TYPE_ARRAY" EDIT_STRING="$EDIT_STRING" EDIT_ARRAY="$EDIT_ARRAY" READ_OK="$READ_OK" \
  python3 - <<'PY' >> "$LOG" 2>&1
import json, os
ev = os.environ["EV"]
res = {
  "proof": "real boot that MOUNTS the rows (registration instrumentation via a --patch probe row)",
  "isolation": {"HOME": "temp sandbox", "DSH_HOME": "temp sandbox"},
  "apply_crash_signatures": int(os.environ["APPLY_ERR"]),
  "probe_reached_final_marker": int(os.environ["PROBE_DONE"]) == 1,
  "hashline_tools_registered": (os.environ["TOOLS_OK"].split("=")[-1] if os.environ["TOOLS_OK"] else None),
  "live_registered_schema_type_array": os.environ["LIVE_TYPE_ARRAY"].split("=")[-1] if os.environ["LIVE_TYPE_ARRAY"] else None,
  "real_read": os.environ["READ_OK"] or None,
  "real_edit_lines_string": (os.environ["EDIT_STRING"].split("=")[-1] if os.environ["EDIT_STRING"] else None),
  "real_edit_lines_array": (os.environ["EDIT_ARRAY"].split("=")[-1] if os.environ["EDIT_ARRAY"] else None),
  "boot_exit": int(os.environ["rc_boot"]),
  "passed": int(os.environ["rc"]) == 0,
  "note": "no --dump-config result is cited as load evidence; the mount probe reads the LIVE tool registry after a settle window and then makes real tool calls",
}
open(ev + "/mount-proof.result.json", "w").write(json.dumps(res, indent=2) + "\n")
print(json.dumps(res, indent=2))
PY
echo DONE >> "$LOG"
rm -rf "$SB_DSH" "$SB_HOME"
exit 0
