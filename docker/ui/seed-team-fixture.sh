#!/usr/bin/env bash
# docker/ui/seed-team-fixture.sh — seed a team record into the UI-VIEW container so the Web Team tab
# and the TUI team scene have a board to render.
#
# WHY THIS EXISTS: both surfaces render `<workspace>/.mpd/team/teams/<teamId>.json`, and a fresh
# container has an EMPTY board — a screenshot of an empty Team tab proves the wiring and NOTHING about
# the dependency graph, which is the thing this wave changes. A board with a real dependency chain is
# what makes the rendering falsifiable.
#
# WHAT IT IS: a FIXTURE carrier, nothing more. The record is built by `docker/ui/team-fixture.mts` (the
# repository's own source language, spelled `.mts` so Node treats it as ESM regardless of the
# container's package.json) and run there. It asserts no product claim — the install path is proven by
# scripts/docker-e2e.ts and the tool path by the QA cases.
#
# USAGE (from the host, with the stack up):
#   docker/ui/seed-team-fixture.sh                      # the normal board
#   docker/ui/seed-team-fixture.sh --board=malformed    # absent blocker endpoint + dependency cycle
#   docker/ui/seed-team-fixture.sh --board=cjk          # pure-CJK subjects (the CJK drawing clause)
#   docker/ui/seed-team-fixture.sh --clear              # remove the seeded record
set -uo pipefail

CONTAINER="${MPD_UI_CONTAINER:-ui-ui-1}"
BOARD="normal"
for argument in "$@"; do
  case "$argument" in
    --board=*) BOARD="${argument#--board=}" ;;
    --clear) BOARD="clear" ;;
  esac
done

# The script lives in this file's own directory, so it works from any working directory.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Where the two sources land inside the container. Both travel because the CLI imports the module
# beside it: a one-file copy fails with ERR_MODULE_NOT_FOUND on exactly the import that matters.
DEST=/tmp/mpd-fixture

if [ "$BOARD" = "clear" ]; then
  docker exec -i "$CONTAINER" bash -lc 'rm -rf /data/ws/.mpd/team/teams /data/ws/.mpd/team/teams.json && echo cleared'
  exit 0
fi

case "$BOARD" in
  normal|malformed|cjk) ;;
  *) echo "unknown board '$BOARD' (expected normal|malformed|cjk|--clear)" >&2; exit 2 ;;
esac

for source in "$HERE/team-fixture.mts" "$HERE/team-fixture-records.mts"; do
  [ -s "$source" ] || { echo "missing fixture source: $source" >&2; exit 2; }
done

# HOW THE FILES TRAVEL: `docker cp` into a container directory, then run them in place.
#
# TWO EARLIER SHAPES ARE RECORDED HERE BECAUSE BOTH FAILED, and each failed SILENTLY enough to cost a
# debugging pass (2026-10-05):
#   * an ENVIRONMENT VARIABLE — `docker exec -e NAME` (the INHERITING form, no `=value`) delivered an
#     EMPTY string in this environment even for `A=hello1234567890`, while `-e NAME=value` and
#     `--env-file` both worked, so the base64 payload arrived empty and the decoder wrote zero-byte
#     files. Do not route a payload through `-e NAME` here.
#   * a STDIN SPLIT relying on `awk` to separate two base64 blobs — correct in principle, but it needs
#     the awk program nested inside a quoted `bash -lc` payload, and the quote layers mangled it.
# `docker cp` has neither problem: no quoting, no size ceiling, no environment.
docker exec -i "$CONTAINER" bash -lc "rm -rf '$DEST' && mkdir -p '$DEST'"
docker cp "$HERE/team-fixture.mts" "$CONTAINER:$DEST/team-fixture.mts" >/dev/null
docker cp "$HERE/team-fixture-records.mts" "$CONTAINER:$DEST/team-fixture-records.mts" >/dev/null

# BOARD is a plain value (`normal` / `malformed`), so the explicit `-e NAME=value` form is safe here.
docker exec -i -e BOARD="$BOARD" "$CONTAINER" bash -lc '
set -e
WS=/data/ws
cd "$WS"

# ── 1. the sources really arrived ────────────────────────────────────────────────────────────────
for part in team-fixture.mts team-fixture-records.mts; do
  [ -s "/tmp/mpd-fixture/$part" ] || { echo "fixture source \"$part\" did not arrive" >&2; exit 3; }
done

# ── 2. bind the board to EVERY session of this workspace ─────────────────────────────────────────
# The store keys a workspace directory by its path with separators folded into dashes (`/data/ws` ->
# `--data-ws--`), and one capture run adds one session.
#
# EVERY SESSION IS BOUND, deliberately: MEASURED 2026-10-05, the store held TWO sessions, `ls | head -1`
# picked the older, the fixture bound a team to a session the sidebar was NOT rendering, and the panel
# correctly showed its empty state — a fixture that looks broken while the code under test is right.
# Binding all of them removes the guess, because the panel renders whichever session its props name.
SESSKEY=$(ls -1 /data/dsh-web/sessions 2>/dev/null | grep -i "data-ws" | head -1)
if [ -z "$SESSKEY" ]; then echo "no /data/ws session in the store — run the capture once to create one" >&2; exit 2; fi
for sid in $(ls -1 "/data/dsh-web/sessions/$SESSKEY"); do
  # `node <file>.mts` is how this repository runs its own TypeScript: Node strips the types.
  node /tmp/mpd-fixture/team-fixture.mts "$sid" "$WS" "$BOARD"
done

# ── 3. the workspace config the SETTINGS panel binds to ──────────────────────────────────────────
# WHY IT IS PART OF THIS FIXTURE: the MPD settings card reads `<workspace>/.mpd/mpd.jsonc`, so on an
# unseeded workspace every control correctly renders EMPTY — and an `<input>`'"'"'s VALUE never appears in
# `innerText`, so neither the text dump nor an empty box can witness that the card is BOUND to the real
# entry. Seeding two known values lets the capture read them back through `input.value`
# (`checks.mpdControlsBound`), which is the difference between "the section rendered" and "the card is
# driving the real config".
cat > "$WS/.mpd/mpd.jsonc" <<'"'"'MPD_JSONC_EOF'"'"'
{
  // Seeded by docker/ui/seed-team-fixture.sh so the settings panel has real values to render.
  "hashline": { "maxDiffChars": 20000 },
  "commentChecker": { "autoCheck": true },
  "memory": { "vcs": "git" }
}
MPD_JSONC_EOF
echo "seeded $WS/.mpd/mpd.jsonc (hashline.maxDiffChars=20000, commentChecker.autoCheck=true)"
'
