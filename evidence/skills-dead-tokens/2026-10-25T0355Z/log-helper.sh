#!/bin/sh
# log-helper.sh — the ONE tool that produced commands.log and readings.txt in this bundle.
#
# Sourced by every measurement shell (`BUNDLE=<dir> . "$BUNDLE/log-helper.sh"`) so that
#   `run "<exact command text>"`  appends the command to commands.log, RUNS it, and appends the
#                                 exit code this shell observed — never a retyped one;
#   `treehash`                    prints the contract's pipeline output: the whole skills/ working
#                                 tree, NUL-safe sorted, reduced to one sha256;
#   `reading <id> <when>`         appends one reading to readings.txt: id, sha256, file count, UTC.
# Nothing here rewrites history: `exit=` is the real $? of the command above it, and every UTC
# stamp comes from `date -u`, never from the seat's local clock.
L="$BUNDLE/commands.log"
RD="$BUNDLE/readings.txt"

run() {
  _c="$1"
  printf '$ %s\n' "$_c" >> "$L"
  eval "$_c"
  _rc=$?
  printf '  exit=%d\n' "$_rc" >> "$L"
  return $_rc
}

treehash() {
  find skills -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1
}

reading() {
  printf '%s  %s  files=%s  %s\n' "$1" "$(treehash)" "$(find skills -type f | wc -l)" \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$RD"
  tail -n 1 "$RD"
}
