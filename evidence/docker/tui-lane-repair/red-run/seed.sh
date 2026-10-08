#!/usr/bin/env bash
# The ONE environment precondition this red run needed, reproduced: the lane's own workspace tree
# under the /work mount starts with the team fixture's two files as symlinks to /dev/null, so the
# lane's own seed writes still EXIT 0 (they are unguarded — a read-only mount would abort on the
# ERR trap instead) while nothing they write can be read back. The lane then observes a fixture that
# is bound to no session, which is the pre-repair state, and finishes on its TERMINAL red path.
set -euo pipefail
SEED="${1:?usage: seed.sh <seed-dir>}"
mkdir -p "$SEED/ws/.mpd/team/teams"
ln -sfn /dev/null "$SEED/ws/.mpd/team/teams.json"
ln -sfn /dev/null "$SEED/ws/.mpd/team/teams/tui-scene.json"
