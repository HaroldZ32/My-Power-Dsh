#!/usr/bin/env bash
# t14: independent falsifiability check of t13's F1 assertion (child-side tool set).
# Read-only with respect to skills/** and VENDOR_LOCK.json: this script only RUNS the shipped case,
# re-runs the reviewer's own instrumented copy, and records the gate state.
set -u
cd "$(dirname "$0")/../../.."
REPO="$(pwd)"
[ -d "$REPO/.git" ] || { echo "FATAL: not the repo root: $REPO" >&2; exit 1; }
EV="evidence/workmate/rename-delete-core/$(date -u +%Y%m%dT%H%M%SZ)-t14"
mkdir -p "$EV"
LOG="$EV/t14.log"

{
  echo "=== t14: independent falsifiability check of the F1 assertion ==="
  echo "repo=$REPO"
  echo "HEAD=$(git rev-parse HEAD)"
  echo "measured_at_utc=$(date -u +%H:%M:%S)"
  echo
  echo "--- sequencing precondition: lock newer than newest skills/** file? ---"
  echo "VENDOR_LOCK.json      mtime $(date -u -r VENDOR_LOCK.json +%H:%M:%S)"
  find skills -type f -exec stat -c '%Y %n' {} \; | sort -rn | head -3 | while read t p; do echo "skills newest         mtime $(date -u -d @$t +%H:%M:%S)  $p"; done
  echo
} > "$LOG"

# ── A) the SHIPPED case (its own assertion, run by node as the task specifies) ────────────────────
echo "### A) node skills/dsh-qa/scripts/readonly-deny.mjs  (the shipped guard)" >> "$LOG"
node skills/dsh-qa/scripts/readonly-deny.mjs > "$EV/shipped-case.log" 2>&1
SHIPPED_RC=$?
echo "[exit=$SHIPPED_RC] shipped case" >> "$LOG"
grep -E "\[readonly-deny\] (ok=|PASS|FAIL)" "$EV/shipped-case.log" | tail -3 >> "$LOG"
echo >> "$LOG"

# ── B) the REVIEWER's instrumented copy (independent instrument, same lanes) ─────────────────────
# NOTE: this copy carries the reviewer's own per-request tool-set instrumentation and pre-dates t13,
# so it measures the lanes without relying on the author's classifier.
echo "### B) bun evidence/workmate/rename-delete-core/probe-enforce.mjs  (reviewer instrument)" >> "$LOG"
bun "$REPO/evidence/workmate/rename-delete-core/probe-enforce.mjs" > "$EV/reviewer-probe.log" 2>&1
PROBE_RC=$?
echo "[exit=$PROBE_RC] reviewer probe" >> "$LOG"
grep -E "\[readonly-deny\] (ok=|PASS|FAIL)" "$EV/reviewer-probe.log" | tail -3 >> "$LOG"
echo >> "$LOG"

# ── C) gate state at measurement time (re-run, per the task's transient-red instruction) ─────────
echo "### C) node scripts/verify-vendor.mjs" >> "$LOG"
node scripts/verify-vendor.mjs > "$EV/verify-vendor.log" 2>&1
VENDOR_RC=$?
echo "[exit=$VENDOR_RC] verify-vendor" >> "$LOG"
grep -E "FAIL|PASS|mismatch|drifted" "$EV/verify-vendor.log" | head -4 >> "$LOG"
echo "VENDOR_LOCK.json mtime now: $(date -u -r VENDOR_LOCK.json +%H:%M:%S)" >> "$LOG"
find skills -type f -exec stat -c '%Y %n' {} \; | sort -rn | head -1 | while read t p; do echo "newest skills file now:     $(date -u -d @$t +%H:%M:%S)  $p"; done >> "$LOG"
echo >> "$LOG"

echo "--- reviewer probe raw trace (per-request tool sets) ---" >> "$LOG"
grep -o '"stubTrace":\[.*\]' "$EV/reviewer-probe.log" | head -2 >> "$LOG"

EV="$EV" SHIPPED_RC=$SHIPPED_RC PROBE_RC=$PROBE_RC VENDOR_RC=$VENDOR_RC python3 - <<'PY' >> "$LOG" 2>&1
import glob, json, os, re
ev = os.environ["EV"]
def lanes(path):
    text = open(path).read()
    out = {}
    for m in re.finditer(r'stubTrace":\[(.*?)\]', text, re.S):
        try:
            arr = json.loads("[" + m.group(1) + "]")
        except Exception:
            continue
        out.setdefault("traces", []).append(arr)
    return out
res = {
  "task": "t14 - independent falsifiability check of the F1 assertion",
  "shipped_case_exit": int(os.environ["SHIPPED_RC"]),
  "reviewer_probe_exit": int(os.environ["PROBE_RC"]),
  "verify_vendor_exit": int(os.environ["VENDOR_RC"]),
  "reviewer_probe_lanes": lanes(os.path.join(ev, "reviewer-probe.log")),
}
open(os.path.join(ev, "t14.result.json"), "w").write(json.dumps(res, indent=2) + "\n")
print(json.dumps(res, indent=2)[:1200])
PY
echo DONE >> "$LOG"
exit 0
