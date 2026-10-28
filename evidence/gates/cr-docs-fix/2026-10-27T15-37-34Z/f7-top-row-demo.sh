#!/usr/bin/env bash
# f7-top-row-demo.sh — executable criterion for finding F7 (the crop's top row comes from the SAVED pane).
#
# WHAT IT PROVES. The REAL `team_top_row` function, extracted from docker/ui/tui-capture.sh, is run
# against a saved pane file whose team border sits on row 3 (0-based, the index the crop uses). The same
# bytes are then fed to the OLD implementation (a live `capture-pane` piped into the old one-liner) with
# a "live" screen on which a redraw/scroll moved that border to row 0. The two answers differ; only the
# saved-file answer addresses the same rows `measure_band` measures.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# The function under test, extracted verbatim from the file (the script itself is not sourceable: it has
# top-level execution and needs tmux).
awk '/^team_top_row\(\)/,/^}/' "$ROOT/docker/ui/tui-capture.sh" >"$WORK/team_top_row.body"
eval "$(cat "$WORK/team_top_row.body")"

# The saved pane text: the exact bytes `measure_band` measures. The team border is on 0-based row 3.
printf 'line0\nline1\nline2\n\u250c MPD team | task dependency graph\nline4\n' >"$WORK/saved.pane.txt"
# What a THIRD live capture could have seen after a redraw/scroll: the same border on row 0.
printf '\u250c MPD team | task dependency graph\nline1\nline2\nline3\nline4\n' >"$WORK/live.pane.txt"

# The OLD implementation, reproduced verbatim from git HEAD (a live `capture-pane` piped in).
old_team_top_row() {
  cat "$1" | python3 -c 'import sys
rows = [line.rstrip("\n") for line in sys.stdin]
hits = [index for index, line in enumerate(rows) if "\u250c" in line and "MPD team" in line]
print(hits[0] if hits else 0)'
}

saved_row="$(team_top_row "$WORK/saved.pane.txt")"
live_row="$(old_team_top_row "$WORK/live.pane.txt")"
missing_row="$(team_top_row "$WORK/does-not-exist.pane.txt")"

printf 'saved-file top row  (the code under test): %s\n' "$saved_row"
printf 'live-screen top row (the old behaviour):    %s\n' "$live_row"
printf 'missing saved file  (fallback):             %s\n' "$missing_row"
printf 'function body reads a live capture:         %s\n' "$(grep -qE 'pane_rows|capture-pane' "$WORK/team_top_row.body" && echo yes || echo no)"
printf 'call site passes the saved pane file:       %s\n' "$(grep -qE 'team_top_row "\$EVIDENCE_DIR/tui-team-dag\.pane\.txt"' "$ROOT/docker/ui/tui-capture.sh" && echo yes || echo no)"

rc=0
[ "$saved_row" = "3" ] || { printf '!! expected the saved-file row to be 3\n'; rc=1; }
[ "$live_row" = "0" ] || { printf '!! expected the live-screen row to be 0\n'; rc=1; }
[ "$saved_row" != "$live_row" ] || { printf '!! the demo did not separate the saved bytes from the live screen\n'; rc=1; }
[ "$missing_row" = "0" ] || { printf '!! expected the missing-file fallback to be 0\n'; rc=1; }
grep -qE 'pane_rows|capture-pane' "$WORK/team_top_row.body" && { printf '!! the function still reads a live capture\n'; rc=1; }
grep -qE 'team_top_row "\$EVIDENCE_DIR/tui-team-dag\.pane\.txt"' "$ROOT/docker/ui/tui-capture.sh" || { printf '!! the call site does not pass the saved pane file\n'; rc=1; }
if [ "$rc" -eq 0 ]; then
  printf '\n[verdict] PASS — the top row is derived from the saved pane; a moved live border cannot shift the crop\n'
else
  printf '\n[verdict] FAIL\n'
fi
exit "$rc"
