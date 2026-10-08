#!/usr/bin/env bash
# T4 WATCHER — waits for the Docker lane writer (board task T3) to land its repair.
#
# READ-ONLY by construction: it hashes one file, reads the board record, asks docker for
# running container names and appends to its own log. It never writes a product path, never
# runs a mutating git command and never starts a container.
#
# The signal it exits on is deliberately TWO-SIDED: either the board says T3 is `completed`,
# or the writer's own lane evidence exists AND docker/tui-lane.sh has not changed for four
# consecutive checks (a settle window), because a run that has finished while the script is
# still being edited must not be mistaken for a frozen revision.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
BOARD="$REPO/.mpd/team/teams/team-20261008114854.json"
LANE="$REPO/docker/tui-lane.sh"
REPAIR="$REPO/evidence/docker/tui-lane-repair"
LOG="$HERE/watch.log"
INTERVAL="${WATCH_INTERVAL:-15}"
MAX_CHECKS="${WATCH_MAX_CHECKS:-192}"
STABLE_NEED=4
stable=0
prev=""
state=""
for ((i = 1; i <= MAX_CHECKS; i++)); do
    now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    hash="$(sha256sum "$LANE" | cut -d' ' -f1)"
    t3="$(python3 - "$BOARD" <<'PY' 2>/dev/null
import json, sys
try:
    data = json.load(open(sys.argv[1]))
except Exception:
    print("unknown"); raise SystemExit
for task in data.get("tasks", []):
    if task.get("id") == "T3":
        print(task.get("status")); break
else:
    print("missing")
PY
)"
    repair="no"
    ls "$REPAIR"/*/driver.json >/dev/null 2>&1 && repair="yes"
    dockerNames="$(docker ps --format '{{.Names}}' 2>/dev/null | tr '\n' ',')"
    if [ "$hash" = "$prev" ]; then stable=$((stable + 1)); else stable=0; fi
    prev="$hash"
    echo "$now check=$i t3=$t3 repairEvidence=$repair hash=$hash stable=$stable docker=[$dockerNames]" >>"$LOG"
    if [ "$t3" = "completed" ]; then state="board-completed"; break; fi
    if [ "$repair" = "yes" ] && [ "$stable" -ge "$STABLE_NEED" ]; then state="evidence-stable"; break; fi
    sleep "$INTERVAL"
done
[ -z "$state" ] && state="timeout"
echo "SIGNAL=$state at $(date -u +%Y-%m-%dT%H:%M:%SZ) hash=$prev"
