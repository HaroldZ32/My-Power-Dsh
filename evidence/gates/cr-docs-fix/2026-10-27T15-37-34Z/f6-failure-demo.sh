#!/usr/bin/env bash
# f6-failure-demo.sh — executable criterion for finding F6 (a rejected capture must not survive at $OUT).
#
# WHAT IT DRIVES. The REAL docker/ui/shoot-team-dag.sh, with only `docker` replaced by a stub: this host
# has no UI-VIEW container, so the stub answers the verbs the wrapper uses (`inspect`, `exec`, `cp`) and
# materializes the two artifacts the wrapper pulls back (capture.png, shot-facts.json). The measurement
# itself is the REAL docker/ui/measure-shots.py, and the wrapper's cleanup branch is the real code under
# test.
#
# Two runs on the same fixture PNG:
#   fail  facts whose box lies outside the capture -> measure exits 1 -> wrapper deletes $OUT, exits 1
#   pass  facts that fit the capture               -> measure exits 0 -> $OUT survives, wrapper exits 0
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
BIN="$WORK/bin"; FIX="$WORK/fixture"; OUTDIR="$WORK/out"; mkdir -p "$BIN" "$FIX" "$OUTDIR"

# The stub: only the verbs docker/ui/shoot-team-dag.sh calls. `cp` pulls the prepared fixture instead of
# the container's file; the two source-script copies are no-ops.
cat >"$BIN/docker" <<'STUB'
#!/usr/bin/env bash
set -uo pipefail
verb="${1:-}"; shift || true
case "$verb" in
  inspect|exec) exit 0 ;;
  cp)
    src="${1:-}"; dest="${2:-}"; dest="${dest#*:}"
    case "$(basename "$src")" in
      capture.png) mkdir -p "$(dirname "$dest")"; cp "$F6_FIXTURE/capture.png" "$dest" ;;
      shot-facts.json) mkdir -p "$(dirname "$dest")"; cp "$F6_FIXTURE/$F6_FACTS" "$dest" ;;
      *) : ;;
    esac
    exit 0 ;;
esac
exit 0
STUB
chmod +x "$BIN/docker"
python3 -c "from PIL import Image; Image.new('RGB',(400,200),(0x22,0x26,0x2E)).save('$FIX/capture.png')"
cat >"$FIX/good-facts.json" <<'JSON'
{"web":{"boxes":["0,0,144,42"],"capture":{"capturedWidth":400,"capturedHeight":200,"boxOrigin":[12,40],"graphViewport":[376,120],"scrollX":0,"scrollY":0,"deviceScaleFactor":1}}}
JSON
cat >"$FIX/cut-facts.json" <<'JSON'
{"web":{"boxes":["1000,0,144,42"],"capture":{"capturedWidth":400,"capturedHeight":200,"boxOrigin":[12,40],"graphViewport":[376,120],"scrollX":0,"scrollY":0,"deviceScaleFactor":1}}}
JSON

# $1 label, $2 facts file name inside $FIX.
run_case() {
  local label="$1" facts="$2" out="$OUTDIR/$1.png" facts_out="$OUTDIR/$1-facts.json" code
  printf '\n===== %s: FACTS=%s =====\n' "$label" "$facts"
  F6_FIXTURE="$FIX" F6_FACTS="$facts" PATH="$BIN:$PATH" MPD_UI_CONTAINER=f6-demo \
    MPD_UI_URL='http://127.0.0.1:1/?token=demo' \
    bash "$ROOT/docker/ui/shoot-team-dag.sh" --out "$out" --facts "$facts_out"
  code=$?
  printf '[%s] wrapper exit=%s\n' "$label" "$code"
  if [ -e "$out" ]; then
    printf '[%s] $OUT exists: yes (%s bytes)\n' "$label" "$(wc -c <"$out" | tr -d ' ')"
  else
    printf '[%s] $OUT exists: no\n' "$label"
  fi
  case "$label" in
    fail) [ "$code" -ne 0 ] && [ ! -e "$out" ] && { printf '[fail] PASS — a rejected capture was deleted and the exit code propagated\n'; return 0; } ;;
    pass) [ "$code" -eq 0 ] && [ -e "$out" ] && { printf '[pass] PASS — a measured capture survives (cleanup is conditional)\n'; return 0; } ;;
  esac
  printf '[%s] FAIL\n' "$label"; return 1
}

rc=0
run_case fail cut-facts.json || rc=1
run_case pass good-facts.json || rc=1
if [ "$rc" -eq 0 ]; then
  printf '\n[verdict] PASS — failure deletes $OUT + propagates the code; success keeps it\n'
else
  printf '\n[verdict] FAIL\n'
fi
exit "$rc"
