#!/usr/bin/env bash
# docker/ui/shoot-team-dag.sh — capture the Web Team view of the nested fixture AND gate the framing.
#
# WHAT IT ENFORCES. `docker/ui/shoot-team-dag.mts` writes the PNG and a facts file carrying `web.boxes`
# (the graph's own CSS coordinates) plus the rect that was photographed; this wrapper then runs
# `docker/ui/measure-shots.py web`, which refuses a capture whose boxes fall outside the image, whose
# graph content does not fit its viewport, or whose view starts off scroll origin. A future re-shoot is
# therefore never "looks fine": it is measured, the exit status is the measurement's, and a rejected
# capture is DELETED before this script exits (an unmeasured PNG must not survive in the deliverable).
# The same holds when the FACTS file cannot be copied back: nothing could measure that PNG, so it is
# deleted before the exit (CodeRabbit N2, PR #75).
#
# WHY A WRAPPER AT ALL. The browser, the Chromium build and the profile under test live INSIDE the
# UI-VIEW container; the rasterizer-independent measurement lives on the host (Pillow). The wrapper is
# the seam: it copies the two scripts in, pulls the PNG + facts back, and runs the gate here.
#
# Usage:
#   MPD_UI_URL='http://127.0.0.1:3081/?token=…' docker/ui/shoot-team-dag.sh \
#     --out evidence/…/web-team-dag-groups.png --facts evidence/…/shot-facts.json [--locale en-US|zh-CN]
# Environment:
#   MPD_UI_CONTAINER  the compose service's container name (default ui-ui-1)
#   MPD_UI_URL        the tokenised URL `dsh web` printed (required; the token is per boot)
set -uo pipefail

CONTAINER="${MPD_UI_CONTAINER:-ui-ui-1}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="" FACTS="" LOCALE="en-US" WIDTH=2900 HEIGHT=1500
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="${2:-}"; shift 2 ;;
    --out=*) OUT="${1#--out=}"; shift ;;
    --facts) FACTS="${2:-}"; shift 2 ;;
    --facts=*) FACTS="${1#--facts=}"; shift ;;
    --locale) LOCALE="${2:-}"; shift 2 ;;
    --locale=*) LOCALE="${1#--locale=}"; shift ;;
    --width) WIDTH="${2:-}"; shift 2 ;;
    --height) HEIGHT="${2:-}"; shift 2 ;;
    *) printf '[shoot-team-dag] unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done
[ -n "$OUT" ] && [ -n "$FACTS" ] || { printf '[shoot-team-dag] --out and --facts are required\n' >&2; exit 2; }
[ -n "${MPD_UI_URL:-}" ] || { printf '[shoot-team-dag] set MPD_UI_URL to the tokenised `dsh web` URL\n' >&2; exit 2; }
command -v docker >/dev/null 2>&1 || { printf '[shoot-team-dag] docker is not on PATH\n' >&2; exit 2; }
command -v python3 >/dev/null 2>&1 || { printf '[shoot-team-dag] python3 (Pillow) is required for the gate\n' >&2; exit 2; }
docker inspect "$CONTAINER" >/dev/null 2>&1 || { printf '[shoot-team-dag] container %s is not running\n' "$CONTAINER" >&2; exit 2; }

RUN=/data/shots-fix2
mkdir -p "$(dirname "$OUT")" "$(dirname "$FACTS")"
docker exec "$CONTAINER" mkdir -p "$RUN" || exit 2
docker cp "$HERE/shoot-team-dag.mts" "$CONTAINER:$RUN/shoot-team-dag.mts" >/dev/null || exit 2
docker cp "$HERE/measure-shots.py" "$CONTAINER:$RUN/measure-shots.py" >/dev/null || exit 2

printf '[shoot-team-dag] capturing %sx%s %s\n' "$WIDTH" "$HEIGHT" "$LOCALE"
docker exec -e "PLAYWRIGHT_BROWSERS_PATH=/data/pw-browsers" "$CONTAINER" \
  bash -lc "cd /data && node $RUN/shoot-team-dag.mts '$MPD_UI_URL' $RUN/capture.png $RUN/shot-facts.json $WIDTH $HEIGHT $LOCALE"
status=$?
if [ "$status" -ne 0 ]; then
  printf '[shoot-team-dag] the capture script failed (exit %s); no PNG was copied\n' "$status" >&2
  exit "$status"
fi
docker cp "$CONTAINER:$RUN/capture.png" "$OUT" >/dev/null || exit 2
# N2 (CodeRabbit, PR #75): the facts file is copied AFTER the PNG, and the measurement below reads it.
# A failure here would otherwise leave an UNMEASURED PNG in the deliverable path, so the PNG is deleted
# before the script exits with the same code (2) this step has always used.
docker cp "$CONTAINER:$RUN/shot-facts.json" "$FACTS" >/dev/null || {
  facts_status=$?
  rm -f "$OUT"
  printf '[shoot-team-dag] the facts file could not be copied (exit %s); the unmeasured PNG was deleted\n' "$facts_status" >&2
  exit 2
}

printf '[shoot-team-dag] measuring the framing (docker/ui/measure-shots.py web)\n'
python3 "$HERE/measure-shots.py" web --facts "$FACTS" --png "$OUT" --json "${FACTS%.json}.measure.json" --label "$(basename "$OUT")"
measure_status=$?
if [ "$measure_status" -ne 0 ]; then
  rm -f "$OUT"
  printf '[shoot-team-dag] the measurement REJECTED %s (exit %s) — the PNG was deleted\n' "$(basename "$OUT")" "$measure_status" >&2
  exit "$measure_status"
fi
