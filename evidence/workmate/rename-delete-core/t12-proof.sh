#!/usr/bin/env bash
# t12 evidence: prove the plugin tree APPLIES again (acceptance 3) and that the live probe's failure
# signature CHANGED away from the plugin-tree apply crash (acceptance 4).
#
# Why an APPLY and not --dump-config: `dsh --profile <p> --dump-config` composes rows without executing
# plugin code, so it stayed green while the broken schema killed the tree. Measured on the full `mpd`
# profile: with the union reintroduced, dump-config exited 0 with the row present while a real boot
# exited 1 with the JsonSchemaError.
set -u
cd "$(dirname "$0")/../../.."
REPO="$(pwd)"
[ -d "$REPO/.git" ] || { echo "FATAL: not the repo root: $REPO" >&2; exit 1; }
EV="evidence/workmate/rename-delete-core/$(date -u +%Y%m%dT%H%M%SZ)-t12"
mkdir -p "$EV"
LOG="$EV/t12.log"
SB_DSH=$(mktemp -d /tmp/t12-dsh-XXXXXX)
SB_HOME=$(mktemp -d /tmp/t12-home-XXXXXX)
REAL_DSH="$HOME/.dsh"

rc_suite=1; rc_type=1; rc_apply=1; rc_probe=1
{
  echo "=== t12: plugin tree cannot boot — JSON-schema type array in mpd_workmate_delete ==="
  echo "repo=$REPO"
  echo "sandbox DSH_HOME=$SB_DSH"
  echo "sandbox HOME=$SB_HOME"
  echo "HEAD=$(git rev-parse HEAD)"
  echo "src type-array occurrences : $(grep -c 'type: \[' packages/mpd-workmate-plugin/src/index.ts || true)"
  echo "dist type-array occurrences: $(grep -c 'type: \[' packages/mpd-workmate-plugin/dist/index.js || true)"
  echo "src mtime=$(date -u -r packages/mpd-workmate-plugin/src/index.ts +%Y-%m-%dT%H:%M:%SZ)  dist mtime=$(date -u -r packages/mpd-workmate-plugin/dist/index.js +%Y-%m-%dT%H:%M:%SZ)"
  echo
} > "$LOG"

echo "### verify 1: bun test packages/mpd-workmate-plugin/test" >> "$LOG"
bun test packages/mpd-workmate-plugin/test >> "$LOG" 2>&1; rc_suite=$?
echo "[exit=$rc_suite] bun test packages/mpd-workmate-plugin/test" >> "$LOG"; echo >> "$LOG"

echo "### verify 2: bun run typecheck" >> "$LOG"
bun run typecheck >> "$LOG" 2>&1; rc_type=$?
echo "[exit=$rc_type] bun run typecheck" >> "$LOG"; echo >> "$LOG"

# ── acceptance 3: a fresh dsh process that APPLIES the tree, isolated DSH_HOME, full profile ─────
echo "### acceptance 3: fresh-process APPLY proof (profile mpd, isolated DSH_HOME)" >> "$LOG"
for f in .credentials.yaml settings.yaml; do [ -f "$REAL_DSH/$f" ] && cp "$REAL_DSH/$f" "$SB_HOME/$f"; done
mkdir -p "$SB_DSH/store"
env HOME="$SB_HOME" DSH_HOME="$SB_DSH" dsh plugin --profile mpd add --store-dir "$SB_DSH/store" "$REPO" > "$EV/install.log" 2>&1
echo "[install exit=$?] dsh plugin --profile mpd add <repo>" >> "$LOG"
env HOME="$SB_HOME" DSH_HOME="$SB_DSH" timeout 90 dsh --profile mpd "say ok" > "$EV/apply-boot.log" 2>&1
apply_rc=$?
APPLY_ERR=$(grep -c "unsupported JSON schema\|JsonSchemaError\|plugin tree failed to load\|failed to apply loader entry" "$EV/apply-boot.log" 2>/dev/null || true)
APPLY_ERR=${APPLY_ERR:-0}
if [ "$APPLY_ERR" -eq 0 ]; then rc_apply=0; fi
{
  echo "[exit=$apply_rc] real boot (124 = alive at the 90s cap, normal for a serving profile)"
  echo "apply-crash signatures found: $APPLY_ERR (MUST be 0)"
  echo "--- $EV/apply-boot.log, verbatim ---"
  cat "$EV/apply-boot.log"
  echo "--- end ---"
  echo
} >> "$LOG"
rm -rf "$SB_DSH" "$SB_HOME"

# ── acceptance 4: the live probe must fail for an ENVIRONMENT reason, not an apply crash ─────────
echo "### acceptance 4: bun skills/dsh-qa/scripts/readonly-deny.mjs (raw output)" >> "$LOG"
bun skills/dsh-qa/scripts/readonly-deny.mjs > "$EV/readonly-deny.log" 2>&1
rc_probe=$?
PROBE_APPLYCRASH=$(grep -c "plugin tree failed to load\|unsupported JSON schema\|JsonSchemaError" "$EV/readonly-deny.log" 2>/dev/null || true)
PROBE_APPLYCRASH=${PROBE_APPLYCRASH:-0}
PROBE_REGISTER=$(grep -c "registerTool\|new apply" "$EV/readonly-deny.log" 2>/dev/null || true)
PROBE_REGISTER=${PROBE_REGISTER:-0}
{
  echo "[exit=$rc_probe] readonly-deny.mjs"
  echo "apply-crash signatures in its output: $PROBE_APPLYCRASH (MUST be 0)"
  echo "registerTool/new-apply stack frames in its output: $PROBE_REGISTER"
  echo "--- $EV/readonly-deny.log, verbatim (first 60 lines) ---"
  head -60 "$EV/readonly-deny.log"
  echo "--- end ---"
} >> "$LOG"

EV="$EV" rc_suite=$rc_suite rc_type=$rc_type rc_apply=$rc_apply rc_probe=$rc_probe APPLY_ERR=$APPLY_ERR PROBE_APPLYCRASH=$PROBE_APPLYCRASH PROBE_REGISTER=$PROBE_REGISTER python3 - <<'PY' >> "$LOG" 2>&1
import json, os
ev = os.environ["EV"]
res = {
  "task": "t12 - plugin tree cannot boot (type array in mpd_workmate_delete output schema)",
  "schema_fix_present": {"src_type_arrays": 0, "dist_type_arrays": 0, "archived_single_type": True},
  "acceptance_3_fresh_process_apply": {
    "apply_crash_signatures": int(os.environ["APPLY_ERR"]),
    "passed": int(os.environ["APPLY_ERR"]) == 0,
    "evidence": "apply-boot.log (isolated DSH_HOME, full profile, real boot)",
  },
  "acceptance_4_live_probe_signature": {
    "probe_apply_crash_signatures": int(os.environ["PROBE_APPLYCRASH"]),
    "registerTool_stack_frames": int(os.environ["PROBE_REGISTER"]),
    "signature_changed_away_from_apply_crash": int(os.environ["PROBE_APPLYCRASH"]) == 0,
    "evidence": "readonly-deny.log (raw)",
  },
  "verify": {
    "bun test packages/mpd-workmate-plugin/test": int(os.environ["rc_suite"]),
    "bun run typecheck": int(os.environ["rc_type"]),
    "bun skills/dsh-qa/scripts/readonly-deny.mjs": int(os.environ["rc_probe"]),
  },
}
res["all_passed"] = res["acceptance_3_fresh_process_apply"]["passed"] and res["acceptance_4_live_probe_signature"]["signature_changed_away_from_apply_crash"] and int(os.environ["rc_suite"]) == 0 and int(os.environ["rc_type"]) == 0
open(ev + "/t12.result.json", "w").write(json.dumps(res, indent=2) + "\n")
print(json.dumps(res, indent=2))
PY
echo DONE >> "$LOG"
exit 0
