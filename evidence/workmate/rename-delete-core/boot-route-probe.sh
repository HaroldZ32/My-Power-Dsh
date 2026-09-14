#!/usr/bin/env bash
# Real-boot ROUTE probe for the workmate plugin (defect-repair evidence, found by Deep Worker / t5).
#
# Why this exists: `dsh --profile w --dump-config` only COMPOSES config and never applies loader
# entries, so it cannot catch a plugin-tree load failure. A union in a tool output schema
# (`archived: { type: ["string","null"] }`) therefore passed the dump-config gate while a real boot
# aborted with `unsupported JSON schema … plugin tree failed to load` and took the whole profile down.
#
# This probe boots for real in an isolated DSH_HOME + sandbox HOME and then REQUIRES the plugin's own
# route to answer over HTTP, which proves in one shot: the tree applied, this row mounted, and the new
# mutation route is live on the real harness. stdio goes to FILES only (long-lived MCP children hold
# inherited fds — never pipe dsh, §7).
set -u
cd "$(dirname "$0")/../../.."
REPO="$(pwd)"
[ -d "$REPO/.git" ] || { echo "FATAL: not the repo root: $REPO" >&2; exit 1; }
PORT="${PORT:-45761}"
EV="evidence/workmate/rename-delete-core/$(date -u +%Y%m%dT%H%M%SZ)-bootroute"
mkdir -p "$EV"
LOG="$EV/boot-route.log"
SB_DSH=$(mktemp -d /tmp/mpd-wm-rt-dsh-XXXXXX)
SB_HOME=$(mktemp -d /tmp/mpd-wm-rt-home-XXXXXX)
REAL_DSH="$HOME/.dsh"

{
  echo "=== real-boot route probe ==="
  echo "repo=$REPO port=$PORT"
  echo "sandbox DSH_HOME=$SB_DSH"
  echo "sandbox HOME=$SB_HOME"
  echo "HEAD=$(git rev-parse HEAD)"
  echo
} > "$LOG"

for f in .credentials.yaml settings.yaml; do
  if [ -f "$REAL_DSH/$f" ]; then cp "$REAL_DSH/$f" "$SB_HOME/$f"; echo "[setup] copied $f into the sandbox" >> "$LOG"; fi
done

mkdir -p "$SB_DSH/store"
env HOME="$SB_HOME" DSH_HOME="$SB_DSH" dsh plugin --profile w add --store-dir "$SB_DSH/store" "$REPO" > "$EV/boot-route-install.log" 2>&1
rc_install=$?
echo "[exit=$rc_install] dsh plugin --profile w add <repo>" >> "$LOG"

# Boot with output to files (never a pipe), in the background, then poll the plugin route.
env HOME="$SB_HOME" DSH_HOME="$SB_DSH" dsh --profile w --port "$PORT" --no-open > "$EV/boot-route-stdout.log" 2>&1 &
BOOT_PID=$!
LIST_CODE=000
LIST_BODY=""
for _ in $(seq 1 150); do
  sleep 2
  LIST_CODE=$(curl -s -o "$EV/boot-route-list.json" -w "%{http_code}" --max-time 4 "http://127.0.0.1:$PORT/plugins/mpd-workmate/list" 2>/dev/null)
  LIST_CODE=${LIST_CODE:-000}
  if [ "$LIST_CODE" = "200" ]; then break; fi
  kill -0 "$BOOT_PID" 2>/dev/null || break
done
# Diagnostics: was anything listening, and is the boot process still alive?
{ echo "listening sockets on port $PORT:"; (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -c ":$PORT" ; echo "boot process alive: $(kill -0 "$BOOT_PID" 2>/dev/null && echo yes || echo no)"; } > "$EV/boot-route-diag.txt" 2>&1
LIST_BODY=$(cat "$EV/boot-route-list.json" 2>/dev/null | head -c 300)

# Live §D check on the real harness: an invalid name must answer 400 + reason "invalid-name".
RENAME_CODE=$(curl -s -o "$EV/boot-route-rename.json" -w "%{http_code}" --max-time 8 -X POST -H "content-type: application/json" -d '{"name":"Alice","new_name":"bob"}' "http://127.0.0.1:$PORT/plugins/mpd-workmate/rename" 2>/dev/null)
RENAME_CODE=${RENAME_CODE:-000}
RENAME_BODY=$(cat "$EV/boot-route-rename.json" 2>/dev/null | head -c 300)

kill -TERM "$BOOT_PID" 2>/dev/null || true
sleep 2
kill -KILL "$BOOT_PID" 2>/dev/null || true

LOADER_ERR=$(grep -c "failed to apply loader entry\|unsupported JSON schema\|plugin tree failed to load" "$EV/boot-route-stdout.log" 2>/dev/null || true)
LOADER_ERR=${LOADER_ERR:-0}

{
  echo "[exit=$rc_install] install"
  echo "GET /plugins/mpd-workmate/list -> $LIST_CODE"
  echo "  body: $LIST_BODY"
  echo "POST /plugins/mpd-workmate/rename (invalid name) -> $RENAME_CODE"
  echo "  body: $RENAME_BODY"
  echo "loader-apply errors: $LOADER_ERR (must be 0)"
  echo "--- boot stdout ---"
  cat "$EV/boot-route-stdout.log"
} >> "$LOG"

rc=1
if [ "$LOADER_ERR" -eq 0 ] && [ "$LIST_CODE" = "200" ] && [ "$RENAME_CODE" = "400" ]; then rc=0; fi
echo "[exit=$rc] tree applied + workmate route live" >> "$LOG"

EV="$EV" rc=$rc rc_install=$rc_install LOADER_ERR=$LOADER_ERR LIST_CODE=$LIST_CODE RENAME_CODE=$RENAME_CODE python3 - <<'PY' >> "$LOG" 2>&1
import json, os
ev = os.environ["EV"]
err = int(os.environ["LOADER_ERR"])
list_code = os.environ["LIST_CODE"]; rename_code = os.environ["RENAME_CODE"]
res = {
  "probe": "real boot + HTTP route (dump-config cannot detect a loader-apply abort)",
  "isolation": {"HOME": "temp sandbox", "DSH_HOME": "temp sandbox", "credentials_copied_once": True},
  "install_exit": int(os.environ["rc_install"]),
  "loader_apply_errors": err,
  "get_list_status": list_code,
  "post_rename_invalid_name_status": rename_code,
  "row_mounted_and_route_live": err == 0 and list_code == "200",
  "contract_d_reason_live": rename_code == "400",
}
open(ev + "/boot-route.result.json", "w").write(json.dumps(res, indent=2) + "\n")
print(json.dumps(res, indent=2))
PY

echo "SWEEP_DONE" >> "$LOG"
rm -rf "$SB_DSH" "$SB_HOME"
exit 0
