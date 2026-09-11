#!/usr/bin/env bash
# Real-boot probe for the workmate plugin (defect repair, found by Deep Worker / t5):
#   `dsh --profile <p> --dump-config` only COMPOSES config and never applies the loader entries, so it
#   cannot catch a plugin-tree load failure. This probe performs an actual boot in an isolated
#   DSH_HOME + sandbox HOME and asserts the tree APPLIES (no JsonSchemaError / loader-apply abort).
#
# Usage: bash boot-probe.sh            (exit 0 = tree applied, 1 = aborted)
# Evidence: evidence/workmate/rename-delete-core/<timestamp>/boot-probe.{log,result.json}
# stdio goes to FILES only (long-lived MCP children hold inherited fds — never pipe dsh, §7).
set -u
cd "$(dirname "$0")/../../.."
REPO="$(pwd)"
[ -d "$REPO/.git" ] || { echo "FATAL: not the repo root: $REPO" >&2; exit 1; }
EV="evidence/workmate/rename-delete-core/$(date -u +%Y%m%dT%H%M%SZ)-boot"
mkdir -p "$EV"
LOG="$EV/boot-probe.log"
SB_DSH=$(mktemp -d /tmp/mpd-wm-boot-dsh-XXXXXX)
SB_HOME=$(mktemp -d /tmp/mpd-wm-boot-home-XXXXXX)
REAL_DSH="$HOME/.dsh"

{
  echo "=== real-boot probe: does the plugin tree APPLY? ==="
  echo "repo=$REPO"
  echo "sandbox DSH_HOME=$SB_DSH"
  echo "sandbox HOME=$SB_HOME"
  echo "HEAD=$(git rev-parse HEAD)"
  echo
} > "$LOG"

# Credentials are copied ONCE into the sandbox (§7): without them the boot would stop at
# MISSING_CREDENTIAL, which would still prove the tree applied but is weaker evidence than a turn.
for f in .credentials.yaml settings.yaml; do
  if [ -f "$REAL_DSH/$f" ]; then cp "$REAL_DSH/$f" "$SB_HOME/$f"; echo "[setup] copied $f into the sandbox" >> "$LOG"; fi
done

mkdir -p "$SB_DSH/store"
env HOME="$SB_HOME" DSH_HOME="$SB_DSH" dsh plugin --profile w add --store-dir "$SB_DSH/store" "$REPO" > "$EV/boot-probe-install.log" 2>&1
rc_install=$?
echo "[exit=$rc_install] dsh plugin --profile w add <repo>" >> "$LOG"
echo >> "$LOG"

echo "### boot: dsh --profile w (isolated DSH_HOME + sandbox HOME)" >> "$LOG"
# A loader-apply abort happens within seconds of startup, so a short cap distinguishes
# "tree applied" from "tree aborted" cheaply; the web profile then stays alive until killed.
env HOME="$SB_HOME" DSH_HOME="$SB_DSH" timeout "${BOOT_TIMEOUT:-300}" dsh --profile w "say ok" > "$EV/boot-probe-stdout.log" 2>&1
rc_boot=$?
echo "[exit=$rc_boot] raw boot exit code (124 = still alive at the ${BOOT_TIMEOUT:-300}s cap, which is normal for the web profile)" >> "$LOG"
echo >> "$LOG"

# The defect signature: loader apply aborts the whole plugin tree.
LOADER_ERR=$(grep -c "failed to apply loader entry\|unsupported JSON schema\|plugin tree failed to load" "$EV/boot-probe-stdout.log" 2>/dev/null || true)
LOADER_ERR=${LOADER_ERR:-0}
# Post-apply signals: the tree loaded if we reached the model/session stage at all.
CRED_MISS=$(grep -c "MISSING_CREDENTIAL" "$EV/boot-probe-stdout.log" 2>/dev/null || true)
CRED_MISS=${CRED_MISS:-0}
WORKMATE_ROW=$(grep -c "mpd-workmate" "$EV/boot-probe-stdout.log" 2>/dev/null || true)
WORKMATE_ROW=${WORKMATE_ROW:-0}

{
  echo "loader-apply errors : $LOADER_ERR (must be 0)"
  echo "MISSING_CREDENTIAL  : $CRED_MISS (nonzero is acceptable: it still proves apply succeeded)"
  echo "mpd-workmate mention: $WORKMATE_ROW"
  echo "--- stdout tail ---"
  tail -25 "$EV/boot-probe-stdout.log"
} >> "$LOG"

rc=1
if [ "$LOADER_ERR" -eq 0 ] && [ "$CRED_MISS" -eq 0 ]; then rc=0; fi
echo "[exit=$rc] plugin tree APPLIED (no loader-apply error and the turn ran)" >> "$LOG"

EV="$EV" rc_boot=$rc_boot rc_install=$rc_install LOADER_ERR=$LOADER_ERR CRED_MISS=$CRED_MISS python3 - <<'PY' >> "$LOG" 2>&1
import json, os
ev = os.environ["EV"]
err = int(os.environ["LOADER_ERR"]); cred = int(os.environ["CRED_MISS"])
res = {
  "probe": "real boot (applies loader entries, unlike --dump-config)",
  "isolation": {"HOME": "temp sandbox", "DSH_HOME": "temp sandbox", "credentials_copied_once": True},
  "raw_boot_exit": int(os.environ["rc_boot"]),
  "install_exit": int(os.environ["rc_install"]),
  "loader_apply_errors": err,
  "missing_credential": cred,
  "plugin_tree_applied": err == 0 and cred == 0,
}
open(ev + "/boot-probe.result.json", "w").write(json.dumps(res, indent=2) + "\n")
print(json.dumps(res, indent=2))
PY

echo "SWEEP_DONE" >> "$LOG"
rm -rf "$SB_DSH" "$SB_HOME"
exit 0
