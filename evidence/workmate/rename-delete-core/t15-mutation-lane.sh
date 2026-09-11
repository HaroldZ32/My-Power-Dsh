#!/usr/bin/env bash
# Falsifiability A/B for the t6-F1 defect class (output-validator rejection of a SUCCESSFUL tool call).
#
# Lane A (already measured): the repaired build -> valid-input calls pass the harness output validator.
# Lane B (this script): a sandbox COPY of the same dist with the `ok` declaration stripped from both
# output schemas — the pre-t15 shape. If my probe is a real check, the three successful mutation calls
# must now be REJECTED by the validator ("returned invalid output" / "not a declared property").
# Read-only w.r.t. packages/**: the copy and the mutation live inside the sandbox.
set -u
cd "$(dirname "$0")/../../.."
REPO="$(pwd)"
EV="evidence/workmate/rename-delete-core/t15-valid-call"
mkdir -p "$EV"
LOG="$EV/mutation-lane.log"
SB_DSH=$(mktemp -d /tmp/vcm-dsh-XXXXXX)
SB_HOME=$(mktemp -d /tmp/vcm-home-XXXXXX)
PROBE="$REPO/evidence/workmate/rename-delete-core/t15-valid-call-probe.mjs"

{
  echo "=== LANE B: pre-t15 shape (ok stripped from both output schemas) ==="
  echo "measured_at=$(date -u +%H:%M:%S)"
  echo "src_sha=$(sha256sum packages/mpd-workmate-plugin/src/index.ts | cut -c1-16)"
  echo "dist_sha=$(sha256sum packages/mpd-workmate-plugin/dist/index.js | cut -c1-16)"
  echo "dist ok-declarations (original): $(grep -c 'ok: { type: \"boolean\" },' packages/mpd-workmate-plugin/dist/index.js)"
} > "$LOG"

mkdir -p "$SB_DSH/mutated-workmate"
MUTATED="$SB_DSH/mutated-workmate/index.js"
sed 's/ok: { type: "boolean" },//g' "$REPO/packages/mpd-workmate-plugin/dist/index.js" > "$MUTATED"
{
  echo "mutated ok-declarations (must be 0): $(grep -c 'ok: { type: \"boolean\" },' "$MUTATED")"
  echo "mutated file is otherwise identical except that token: $(diff <(sed 's/ok: { type: \"boolean\" },//g' "$REPO/packages/mpd-workmate-plugin/dist/index.js") "$MUTATED" | wc -l) diff lines"
} >> "$LOG"

for f in .credentials.yaml settings.yaml; do [ -f "$HOME/.dsh/$f" ] && cp "$HOME/.dsh/$f" "$SB_HOME/$f"; done
mkdir -p "$SB_DSH/store"
env HOME="$SB_HOME" DSH_HOME="$SB_DSH" dsh plugin --profile mpd add --store-dir "$SB_DSH/store" "$REPO" >> "$LOG" 2>&1
echo "[exit=$?] install" >> "$LOG"

printf -- '- id: mpd-workmate\n  name: %s\n- insert:\n    - id: valid-call-probe\n      name: %s\n' \
  "$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$MUTATED")" \
  "$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$PROBE")" > "$SB_DSH/mutation.yml"
echo "--- patch ---" >> "$LOG"; cat "$SB_DSH/mutation.yml" >> "$LOG"

env HOME="$SB_HOME" DSH_HOME="$SB_DSH" timeout 60 dsh --profile mpd --patch "$SB_DSH/mutation.yml" "say ok" > "$EV/mutation-boot.log" 2>&1
echo "[exit=$?] boot (124 = alive at the 60s cap)" >> "$LOG"
grep -E "\[valid-call\]" "$EV/mutation-boot.log" >> "$LOG"
echo "loader-apply errors: $(grep -c 'plugin tree failed to load\|unsupported JSON schema' "$EV/mutation-boot.log")" >> "$LOG"
echo "--- mutated row actually mounted? ---" >> "$LOG"
grep -c "mutated-workmate" "$EV/mutation-boot.log" >> "$LOG"
echo DONE >> "$LOG"
rm -rf "$SB_DSH" "$SB_HOME"
exit 0
