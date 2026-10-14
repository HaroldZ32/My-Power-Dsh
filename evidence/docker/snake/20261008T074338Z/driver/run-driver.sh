#!/usr/bin/env bash
# run-driver.sh — invoke the LANE-E2 snake driver inside the project's own browser container.
#
# WHY A WRAPPER: the driver must run in a container that has (a) playwright 1.49.1 + its Chromium and
# (b) the shared libraries that Chromium links against. Both already exist on this machine — the
# browsers and playwright live in the named volume the project's OWN UI lane uses (`ui_ui-data`), and
# `mpd-snake-driver:local` is `mpd-docker-e2e:local` plus exactly those apt libraries. Nothing is
# installed into the operator's home and nothing is written outside the evidence directory.
#
# `--network none` IS LOAD-BEARING, not hygiene: the page is required to be self-contained, and a run
# that cannot reach the network at all is the strongest available form of that proof.
#
#   ./run-driver.sh <evidence-dir> <page-path-inside-it> <label> <budget-ms> [note]
set -euo pipefail
EVIDENCE="$1"
PAGE="$2"
LABEL="$3"
BUDGET="$4"
NOTE="${5:-}"

exec docker run --rm --network none \
  -e HOME=/tmp/driver-home -e PAGE="$PAGE" -e LABEL="$LABEL" -e BUDGET="$BUDGET" -e NOTE="$NOTE" \
  -v ui_ui-data:/pwtool:ro \
  -v "${EVIDENCE}":/out \
  --entrypoint bash mpd-snake-driver:local -lc '
    set -e
    mkdir -p /tmp/driver-home /tmp/driver
    cp /out/driver/snake-driver.v3-blob.mts /tmp/driver/snake-driver.mts
    ln -sfn /pwtool/node_modules /tmp/driver/node_modules
    export PLAYWRIGHT_BROWSERS_PATH=/pwtool/pw-browsers
    node /tmp/driver/snake-driver.mts --page "/out/$PAGE" --out /out \
      --label "$LABEL" --budget-ms "$BUDGET" --note "$NOTE"
  '
