#!/usr/bin/env bash
# copy-artifact-out.sh — rescue the live turn's workspace out of a container the lane deletes.
#
# WHY THIS EXISTS: `scripts/docker-e2e.ts` runs the acceptance container with `docker compose run
# --rm`, and the entrypoint publishes its VERDICT under /out but never the agent's WORKSPACE. The
# artifact the live turn writes (`/work/ws/snake/index.html`) therefore dies with the container. This
# watcher copies it out while the container is still alive, and keeps re-copying until the container
# disappears so the LAST copy is the finished artifact rather than a half-written one.
#
# It never reads the container's environment: `docker exec ... env` would print the staged credential.
#
#   ./copy-artifact-out.sh <repo-root> <destination-dir>
set -uo pipefail
REPO="$1"
DEST="$2"
mkdir -p "$DEST"
DEADLINE=$(( $(date +%s) + 5400 ))
SEEN=0
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  # The compose run container, found by the image it runs.
  NAMES=$(docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null | awk '$2=="mpd-docker-e2e:local"{print $1}')
  if [ -z "$NAMES" ]; then
    if [ "$SEEN" = "1" ]; then echo "[copy] container gone after $(date -u +%FT%TZ); last copy kept"; exit 0; fi
    sleep 5
    continue
  fi
  for NAME in $NAMES; do
    SEEN=1
    if docker exec "$NAME" test -e /work/ws/snake >/dev/null 2>&1; then
      rm -rf "${DEST}/snake"
      if docker cp "${NAME}:/work/ws/snake" "${DEST}/" >/dev/null 2>&1; then
        HASH=$(sha256sum "${DEST}/snake/index.html" 2>/dev/null | cut -d' ' -f1)
        echo "[copy] $(date -u +%FT%TZ) copied ${NAME}:/work/ws/snake -> ${DEST}/snake sha256=${HASH:-absent}"
        docker exec "$NAME" ls -la /work/ws > "${DEST}/ws-listing.txt" 2>&1 || true
      fi
    else
      echo "[copy] $(date -u +%FT%TZ) ${NAME}: /work/ws/snake not there yet"
    fi
  done
  sleep 3
done
echo "[copy] TIMEOUT after the deadline"
exit 1
