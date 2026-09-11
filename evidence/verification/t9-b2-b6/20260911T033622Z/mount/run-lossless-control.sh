#!/usr/bin/env bash
# t9 positive control: the same real-boot + adapter-executeTool path as run-mount-proof.sh, but the
# tools under test are synthetic (one lossy, one clean). Proves the harness snapshot IS active on
# this path, so the green mpd_verif_backends result cannot be vacuous.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../../../.." && pwd)"
[ -d "$REPO/.git" ] || { echo "FATAL: not the repo root: $REPO" >&2; exit 1; }
EV="$HERE"
LOG="$EV/lossless-control.log"
SB_DSH=$(mktemp -d /tmp/t9-ctl-dsh-XXXXXX)
SB_HOME=$(mktemp -d /tmp/t9-ctl-home-XXXXXX)
PROBE="$EV/t9-lossless-control-probe.mjs"
PATCH="$SB_DSH/t9-ctl.yml"

{
  echo "=== t9 lossless-json positive control (real boot) ==="
  echo "repo=$REPO"
  echo "HEAD=$(git -C "$REPO" rev-parse HEAD)"
  echo "sandbox DSH_HOME=$SB_DSH sandbox HOME=$SB_HOME"
  echo
} > "$LOG"

for f in .credentials.yaml settings.yaml; do [ -f "$HOME/.dsh/$f" ] && cp "$HOME/.dsh/$f" "$SB_HOME/$f"; done
mkdir -p "$SB_DSH/store"
env HOME="$SB_HOME" DSH_HOME="$SB_DSH" dsh plugin --profile mpd add --store-dir "$SB_DSH/store" "$REPO" > "$EV/control-install.log" 2>&1
echo "[exit=$?] dsh plugin --profile mpd add --store-dir <sb> <repo>" >> "$LOG"

printf -- "- insert:\n    - id: t9-lossless-control-probe\n      name: %s\n" "$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$PROBE")" > "$PATCH"
env HOME="$SB_HOME" DSH_HOME="$SB_DSH" timeout 90 dsh --profile mpd --patch "$PATCH" "say ok" > "$EV/control-boot.log" 2>&1
rc_boot=$?
APPLY_ERR=$(grep -c "unsupported JSON schema\|JsonSchemaError\|plugin tree failed to load\|failed to apply loader entry" "$EV/control-boot.log" 2>/dev/null || true)
APPLY_ERR=${APPLY_ERR:-0}
{
  echo "[exit=$rc_boot] real boot (124 = still alive at the 90s cap)"
  echo "apply-crash signatures : $APPLY_ERR (MUST be 0)"
  echo "--- t9-control lines, verbatim ---"
  grep "\[t9-control\]" "$EV/control-boot.log" || echo "(no t9-control output)"
  echo "--- end ---"
} >> "$LOG"
rm -rf "$SB_DSH" "$SB_HOME"
exit 0
