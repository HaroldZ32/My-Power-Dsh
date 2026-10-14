#!/usr/bin/env bash
# The red-run driver: the SAME compose service the shipped driver runs, with ONE extra bind so the
# lane's own workspace can be seeded. docker/tui-lane.sh is never touched.
set -uo pipefail
cd /home/haroldzhao/MyProj/DshProj/My-Power-Dsh
EVID="$PWD/evidence/docker/tui-lane-repair/red-run"
export MPD_DOCKER_OUT="$EVID"
export BUILDX_CONFIG="$EVID/buildx"
mkdir -p "$BUILDX_CONFIG"
echo "[red-run] build start $(date -u +%Y-%m-%dT%H:%M:%SZ)"
docker compose -f docker/docker-compose.yml build
echo "[red-run] build exit=$? at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "[red-run] container start $(date -u +%Y-%m-%dT%H:%M:%SZ)"
docker compose -f docker/docker-compose.yml run --rm -T \
  -e MPD_E2E_BROWSER=1 \
  -v "$EVID/scratch:/work" \
  mpd-client
echo "[red-run] container exit=$? at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
