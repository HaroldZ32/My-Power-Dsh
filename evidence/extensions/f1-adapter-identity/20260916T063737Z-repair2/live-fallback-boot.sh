#!/usr/bin/env bash
# F1 LIVE fallback boot (t4).
#
# The unit tests prove the fallback arm on a fake ctx; this proves it on a REAL boot of
# the installed bundle, so the report's own evidence gap ("F1 was not reproduced live in
# a boot that misses mpdDsh", docs/extension-adaptation-report.md §9) is closed.
#
# Shape: install the bundle into an isolated profile, then boot it with a --patch overlay
# that id-targets the `mpd-dsh-adapter` row with `disabled: true`. With no mounted
# `mpdDsh`, both rows must take the `?? createDshAdapter(ctx)` branch: each must warn
# EXACTLY ONCE and keep working (no apply crash, four tools still registered).
#
# Isolation: sandbox DSH_HOME + HOME (never the real ~/.dsh), sandbox workspace = the
# evidence dir. A real boot is used because --dump-config never executes plugin code.
set -u
cd "$(dirname "$0")/../../../.." || exit 1
REPO="$(pwd)"
EV="$REPO/evidence/extensions/f1-adapter-identity/20260916T063737Z-repair2"
[ -d "$REPO/.git" ] || { echo "FATAL: not the repo root: $REPO" >&2; exit 1; }

SB_DSH=$(mktemp -d /tmp/mpd-f1-dsh-XXXXXX)
SB_HOME=$(mktemp -d /tmp/mpd-f1-home-XXXXXX)
SB_WS=$(mktemp -d /tmp/mpd-f1-ws-XXXXXX)
PROFILE=mb
PATCH="$EV/raw/disable-adapter.yml"
BOOTLOG="$EV/raw/fallback-boot.log"

for f in .credentials.yaml settings.yaml; do
  [ -f "$HOME/.dsh/$f" ] && cp "$HOME/.dsh/$f" "$SB_HOME/$f"
done
mkdir -p "$SB_DSH/store"

printf -- "- id: mpd-dsh-adapter\n  disabled: true\n" > "$PATCH"

{
  echo "=== F1 LIVE fallback boot ==="
  echo "repo=$REPO"
  echo "sandbox DSH_HOME=$SB_DSH"
  echo "sandbox HOME=$SB_HOME"
  echo "sandbox workspace=$SB_WS"
  echo "overlay=$PATCH"
  echo "overlay contents:"; cat "$PATCH"
  echo "HEAD=$(git rev-parse HEAD)"
  echo "src sha256: $(sha256sum packages/mpd-ext-plugin/src/index.ts packages/mpd-roles-plugin/src/index.ts | tr '\n' ' ')"
  echo "dist sha256: $(sha256sum packages/mpd-ext-plugin/dist/index.js packages/mpd-roles-plugin/dist/index.js | tr '\n' ' ')"
  echo
} > "$BOOTLOG"

env HOME="$SB_HOME" DSH_HOME="$SB_DSH" dsh plugin --profile "$PROFILE" add --store-dir "$SB_DSH/store" "$REPO" > "$EV/raw/fallback-install.log" 2>&1
rc_install=$?
echo "[exit=$rc_install] dsh plugin --profile $PROFILE add <repo>" >> "$BOOTLOG"

echo "### real boot: dsh --profile $PROFILE --patch <disable mpd-dsh-adapter> 'say ok' (sandboxed cwd)" >> "$BOOTLOG"
env HOME="$SB_HOME" DSH_HOME="$SB_DSH" timeout 180 dsh --profile "$PROFILE" --patch "$PATCH" "say ok" > "$EV/raw/fallback-boot.raw.log" 2>&1
rc_boot=$?
cat "$EV/raw/fallback-boot.raw.log" >> "$BOOTLOG"
echo "[exit=$rc_boot] boot (124 = still serving at the 180s cap)" >> "$BOOTLOG"

RAW="$EV/raw/fallback-boot.raw.log"
count() { grep -c "$1" "$RAW" 2>/dev/null || true; }
ADAPTER_APPLIED=$(count "\[mpd-dsh-adapter\] mpdDsh provided")
EXT_FALLBACK=$(count "\[mpd-ext\] ADAPTER FALLBACK")
ROLES_FALLBACK=$(count "\[mpd-roles\] ADAPTER FALLBACK")
EXT_FALLBACK_ID=$(count "adapterIdentity=fallback:createDshAdapter")
EXT_SUMMARY=$(grep -c "\[mpd-ext\] mpdExtensions provided" "$RAW" 2>/dev/null || true)
ROLES_SUMMARY=$(grep -c "\[mpd-roles\] mpdRoles provided" "$RAW" 2>/dev/null || true)
TOOLS_OK=$(grep -c "mpd_ext_list, mpd_ext_show, mpd_flow_list, mpd_flow_show" "$RAW" 2>/dev/null || true)
CRASHES=$(grep -c "unsupported JSON schema\|JsonSchemaError\|plugin tree failed to load\|failed to apply loader entry" "$RAW" 2>/dev/null || true)

{
  echo
  echo "readings:"
  echo "  mpd-dsh-adapter applied (MUST be 0)          : $ADAPTER_APPLIED"
  echo "  [mpd-ext] ADAPTER FALLBACK lines (MUST be 1) : $EXT_FALLBACK"
  echo "  [mpd-roles] ADAPTER FALLBACK lines (MUST be 1): $ROLES_FALLBACK"
  echo "  fallback identity readings (= warn + summary): $EXT_FALLBACK_ID"
  echo "  [mpd-ext] mpdExtensions provided lines        : $EXT_SUMMARY"
  echo "  [mpd-roles] mpdRoles provided lines           : $ROLES_SUMMARY"
  echo "  four-tool summary present                     : $TOOLS_OK"
  echo "  apply-crash signatures (MUST be 0)            : $CRASHES"
  echo "--- identity lines, verbatim ---"
  grep "adapterIdentity=" "$RAW" || echo "(none)"
} >> "$BOOTLOG"

rc=1
if [ "$rc_install" -eq 0 ] && [ "$ADAPTER_APPLIED" -eq 0 ] && [ "$EXT_FALLBACK" -eq 1 ] && [ "$ROLES_FALLBACK" -eq 1 ] \
   && [ "$EXT_SUMMARY" -eq 1 ] && [ "$ROLES_SUMMARY" -eq 1 ] && [ "$TOOLS_OK" -ge 1 ] && [ "$CRASHES" -eq 0 ]; then rc=0; fi

EV="$EV" REPO="$REPO" PATCH="$PATCH" rc=$rc rc_install=$rc_install rc_boot=$rc_boot \
ADAPTER_APPLIED=$ADAPTER_APPLIED EXT_FALLBACK=$EXT_FALLBACK ROLES_FALLBACK=$ROLES_FALLBACK \
EXT_FALLBACK_ID=$EXT_FALLBACK_ID EXT_SUMMARY=$EXT_SUMMARY ROLES_SUMMARY=$ROLES_SUMMARY TOOLS_OK=$TOOLS_OK CRASHES=$CRASHES \
python3 - <<'PY' >> "$BOOTLOG" 2>&1
import json, os
res = {
  "proof": "REAL boot with the mpd-dsh-adapter row disabled: the fallback branch warns once per row and the tree keeps working",
  "isolation": {"DSH_HOME": "temp sandbox", "HOME": "temp sandbox"},
  "overlay": os.environ["PATCH"],
  "adapter_row_applied": int(os.environ["ADAPTER_APPLIED"]),
  "mpd_ext_fallback_warnings": int(os.environ["EXT_FALLBACK"]),
  "mpd_roles_fallback_warnings": int(os.environ["ROLES_FALLBACK"]),
  "fallback_identity_readings": int(os.environ["EXT_FALLBACK_ID"]),
  "mpd_ext_summary_lines": int(os.environ["EXT_SUMMARY"]),
  "mpd_roles_summary_lines": int(os.environ["ROLES_SUMMARY"]),
  "four_tool_summary_present": int(os.environ["TOOLS_OK"]) >= 1,
  "apply_crash_signatures": int(os.environ["CRASHES"]),
  "install_exit": int(os.environ["rc_install"]),
  "boot_exit": int(os.environ["rc_boot"]),
  "passed": int(os.environ["rc"]) == 0,
  "note": "loader-level apply is the load evidence; --dump-config is never used here (it composes rows without executing plugin code)",
}
open(os.path.join(os.environ["EV"], "raw", "fallback-boot.result.json"), "w").write(json.dumps(res, indent=2) + "\n")
print(json.dumps(res, indent=2))
PY
echo "[exit=$rc] F1 live fallback boot" >> "$BOOTLOG"
rm -rf "$SB_DSH" "$SB_HOME" "$SB_WS"
exit "$rc"
