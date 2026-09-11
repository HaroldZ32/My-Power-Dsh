#!/usr/bin/env bash
# t9 independent MOUNT proof (verifier-written). Real boot that MOUNTS the bundle rows in an
# isolated DSH_HOME + sandbox HOME, with the t9-mount-probe overlay row making real tool calls.
# --dump-config is deliberately NOT used anywhere: it composes rows and never executes plugin code.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../../../.." && pwd)"
[ -d "$REPO/.git" ] || { echo "FATAL: not the repo root: $REPO" >&2; exit 1; }
EV="$HERE"
LOG="$EV/mount-proof.log"
SB_DSH=$(mktemp -d /tmp/t9-mnt-dsh-XXXXXX)
SB_HOME=$(mktemp -d /tmp/t9-mnt-home-XXXXXX)
PROBE="$EV/t9-mount-probe.mjs"
PATCH="$SB_DSH/t9-probe.yml"

{
  echo "=== t9 independent MOUNT proof ==="
  echo "repo=$REPO"
  echo "HEAD=$(git -C "$REPO" rev-parse HEAD)"
  echo "date=$(date -u +%FT%TZ)"
  echo "sandbox DSH_HOME=$SB_DSH"
  echo "sandbox HOME=$SB_HOME"
  echo "precondition iverilog=$(command -v iverilog || echo absent) verilator=$(command -v verilator || echo absent) vcs=$(command -v vcs || echo absent)"
  echo "VENDOR_LOCK skills treeSha=$(node -e "console.log(require('$REPO/VENDOR_LOCK.json').assets.skills.treeSha)")"
  echo "VENDOR_LOCK mtime=$(stat -c %y "$REPO/VENDOR_LOCK.json")"
  echo
} > "$LOG"

for f in .credentials.yaml settings.yaml; do [ -f "$HOME/.dsh/$f" ] && cp "$HOME/.dsh/$f" "$SB_HOME/$f"; done
mkdir -p "$SB_DSH/store"
env HOME="$SB_HOME" DSH_HOME="$SB_DSH" dsh plugin --profile mpd add --store-dir "$SB_DSH/store" "$REPO" > "$EV/install.log" 2>&1
echo "[exit=$?] dsh plugin --profile mpd add --store-dir <sb> <repo>" >> "$LOG"

# The overlay adds ONLY the probe row; the boot carries the full bundle patch.
printf -- "- insert:\n    - id: t9-mount-probe\n      name: %s\n" "$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$PROBE")" > "$PATCH"
echo "[patch] $PATCH:" >> "$LOG"; cat "$PATCH" >> "$LOG"; echo >> "$LOG"

echo "### real boot with the probe row: dsh --profile mpd --patch <probe> 'say ok'" >> "$LOG"
env HOME="$SB_HOME" DSH_HOME="$SB_DSH" timeout 150 dsh --profile mpd --patch "$PATCH" "say ok" > "$EV/mount-boot.log" 2>&1
rc_boot=$?
APPLY_ERR=$(grep -c "unsupported JSON schema\|JsonSchemaError\|plugin tree failed to load\|failed to apply loader entry" "$EV/mount-boot.log" 2>/dev/null || true)
APPLY_ERR=${APPLY_ERR:-0}
PROBE_DONE=$(grep -c "\[t9-probe\] DONE=ok" "$EV/mount-boot.log" 2>/dev/null || true)
PROBE_DONE=${PROBE_DONE:-0}
TOOLS_LINE=$(grep -o "\[t9-probe\] TOOLS=.*" "$EV/mount-boot.log" | tail -1 | sed 's/^\[t9-probe\] TOOLS=//')
{
  echo "[exit=$rc_boot] real boot (124 = still alive at the 150s cap, normal for a serving profile)"
  echo "apply-crash signatures : $APPLY_ERR (MUST be 0)"
  echo "probe final marker     : $PROBE_DONE (1 = probe ran to its end)"
  echo "live tools             : ${TOOLS_LINE:-none}"
  echo "--- t9-probe lines, verbatim ---"
  grep "\[t9-probe\]" "$EV/mount-boot.log" || echo "(no t9-probe output)"
  echo "--- end ---"
} >> "$LOG"

EV="$EV" rc_boot=$rc_boot APPLY_ERR=$APPLY_ERR PROBE_DONE=$PROBE_DONE python3 - <<'PY' >> "$LOG" 2>&1
import json, os, re
ev = os.environ["EV"]
log = open(os.path.join(ev, "mount-boot.log"), encoding="utf-8", errors="replace").read()
line = lambda key: (re.search(r"\[t9-probe\] " + key + r"=(.*)", log) or [None, None])[1]
num = lambda s: int(s or 0)

b3 = {}
for sel in ["IVERILOG", "VERILATOR", "ALL", "VCS"]:
    raw = line("B3_" + sel)
    undef = line("B3_" + sel + "_SHAPE")
    m = re.search(r"ok=(\w+) isError=(\w+) error=(.*?) count=(\d+) undef=(\[.*?\])$", raw or "")
    shape = re.search(r"undef=(\[.*\])$", raw or "")
    b3[sel] = {
        "raw": raw,
        "ok": (m.group(1) if m else None),
        "isError": (m.group(2) if m else None),
        "error": (m.group(3) if m else None),
        "count": num(m.group(4)) if m else None,
        "undef_paths": json.loads(shape.group(1)) if shape else None,
        "shape": undef,
    }
res = {
    "proof": "real boot that MOUNTS the rows (registration instrumentation via a --patch probe row)",
    "isolation": {"DSH_HOME": "temp sandbox", "HOME": "temp sandbox"},
    "verifier": "Reviewer (t9), probe written independently of the implementers' evidence",
    "apply_crash_signatures": num(os.environ["APPLY_ERR"]),
    "probe_final_marker": num(os.environ["PROBE_DONE"]) == 1,
    "boot_exit": int(os.environ["rc_boot"]),
    "b3_backends": b3,
    "b4": {
        "live_type_array": line("B4_LIVE_TYPE_ARRAY"),
        "live_lines_node": line("B4_LIVE_LINES_NODE"),
        "live_params_undef_paths": line("B4_LIVE_PARAMS_UNDEF_PATHS"),
        "read": line("B4_READ"),
        "edit_lines_string": line("B4_EDIT_LINES_STRING"),
        "edit_lines_array": line("B4_EDIT_LINES_ARRAY"),
        "final_content": line("B4_FINAL_CONTENT"),
    },
    "b5": {"main": line("B5_MAIN"), "main_value": line("B5_MAIN_VALUE"), "on_disk_no_content": line("B5_ONDISK_NO_CONTENT")},
    "note": "no --dump-config result is cited as load evidence",
}
open(os.path.join(ev, "result.json"), "w").write(json.dumps(res, indent=2) + "\n")
print(json.dumps(res, indent=2))
PY
echo "DONE" >> "$LOG"
rm -rf "$SB_DSH" "$SB_HOME"
exit 0
