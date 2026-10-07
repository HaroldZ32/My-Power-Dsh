#!/usr/bin/env bash
# docker/ui/tui-capture.sh — the DSH-TUI edition of this bundle, captured as REAL PIXELS.
#
# WHAT IT DRIVES. The `tui` tmux session on /data/tui.sock runs the real `dsh-tui` against this bundle;
# nothing here is a mock or a re-enactment. This script restarts that session in the requested language,
# opens each MPD surface, reads the pane back and rasterizes it.
#
# HOW BYTES BECOME PIXELS. The pane is read with `tmux capture-pane -e -p -J`: tmux is ITSELF a terminal
# emulator and has already resolved every cell, every attribute and every explicit colour, so the byte
# stream is what the TUI really emitted — not a re-typed transcript — and `docker/ui/tui-render.py` only
# has to paint the grid it is handed. WHAT THIS IS NOT: it is not a screenshot of xterm(1) on a display
# server. That arrangement was tried FIRST and MEASURED IMPOSSIBLE in this image — Xvfb starts and stays
# alive, but `xdpyinfo`, `xwd` and `import` all time out against it (exit 124, zero bytes), so no X
# client can be served. The xterm.js fallback that replaced it is GONE too: it was never what produced
# the shipped tiles (see evidence/docs/readme-0.12.0/image-provenance.md), and keeping a second,
# contradicting renderer beside this one is how a lane ends up shipping an image no recipe reproduces.
#
# WHERE THE RASTERIZER RUNS, and why it is not a detail. The UI-VIEW image ships no `python3` at all
# (measured: `exec: "python3": executable file not found in $PATH`), so this script runs INSIDE the
# container — the entrypoint invokes it — and depends on the interpreter that entrypoint installs. Its
# apt step therefore carries `python3 python3-pil fonts-dejavu-core fonts-noto-cjk` and its health guard
# asks for `python3` too; a capture that ran before that step would die on a bare "command not found"
# that reads like a missing script rather than a missing interpreter.
#
# ── THE MARKER RULE, AND THE DEFECT IT EXISTS TO PREVENT ──────────────────────────────────────────
# A PNG of a loading, splash or EMPTY screen is a defect that LOOKS like a result, and dsh-tui's first-run
# wizard and its launchpad both draw the same `❯` a chat composer does. So every scene below waits on a
# string with a bounded timeout, and a marker that never arrives SKIPS the PNG and fails the run rather
# than writing a hopeful image.
#
# THE TRAP THIS FILE ENCODES, PAID FOR ONCE ALREADY: a capture gated on the fixture team's own name
# (`Dual Surface Demo`) fired on the CHAT screen, because the chat screen's keyed status line ALSO reads
# `mpd: team Dual Surface Demo 5·2/6 · …`. The marker was not unique to the surface it gated, and the run
# produced an image that looked plausible and was of the WRONG SCREEN. Therefore:
#   1. every scene marker below is a string only THAT surface emits — the team DAG scene's own section
#      heading, the sidebar box's own border title, the keyed status row's own key — and the fixture
#      team's NAME is deliberately NOT used as a marker anywhere; and
#   2. `assert_chat_frame` asserts, on the settled chat frame and BEFORE any scene opens, that NEITHER
#      SCENE marker is on screen. A marker that is already present before its scene opens cannot be
#      evidence that the scene opened, so the run REFUSES rather than gating on a string that is there
#      either way. The STATUS-LINE marker is the deliberate EXCEPTION and is asserted PRESENT instead:
#      the keyed row IS a chat-surface element, so demanding its absence would refuse every run — which
#      is exactly what the first end-to-end run of this script did before this note was written. Absence
#      is the right test only for a marker that gates a SCENE.
#
# Usage: tui-capture.sh [--lang en|zh] [--out <base-dir>] [--evidence <dir>]
#   --lang      the app locale AND the output subdirectory's language (default $MPD_UI_TUI_LANG, zh)
#   --out       the BASE directory; the language directory is appended (default /data-out/readme, the
#               compose bind mount), so a run writes /data-out/readme/en and /data-out/readme/zh-CN
#   --evidence  where the pane text, the raw ANSI and the ledger land (default /data/tui-evidence)
# RE-RUNNABLE: every file is rewritten in place, so a second run overwrites rather than accumulates.
set -uo pipefail

# ── fixed geometry of this lane ───────────────────────────────────────────────
SOCK="${MPD_UI_TUI_SOCK:-/data/tui.sock}"
SESSION="${MPD_UI_TUI_SESSION:-tui}"
# This script's own directory, so the renderer and the session starter beside it are found however the
# caller invokes it.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RENDER="$HERE/tui-render.py"
# Scratch inside the container's writable volume, never in the deliverable directory: a reader must never
# have to ask which of two files beside a PNG is the figure.
SCRATCH="${MPD_UI_TUI_SCRATCH:-/data/tui-scratch}"
# How long one scene's marker may take. Generous because the first scene after a session restart waits on
# the TUI's own boot in a shared-CPU container; a marker that misses this bound is a real miss.
MARKER_TIMEOUT="${MPD_UI_TUI_MARKER_TIMEOUT:-120}"
# The rasterizer's scale. 2 is what the README's existing terminal tiles were rendered at.
SCALE="${MPD_UI_TUI_SCALE:-2}"

# ── the crop table, in CELLS of the pane grid (half-open bands) ───────────────
# WHAT PRODUCED THESE NUMBERS. The terminal tiles the README already ships are WINDOWS into a full-pane
# render, not whole panes: `tui-team-dag.png` is the upper-left window over the panel header, the member
# rows and the DAG; `tui-workmates.png` is the sidebar column; `tui-status-line.png` is a three-row strip
# around the keyed row. The fractions below are those tiles measured back from the captures that produced
# them (panes of 158x45 in English and 218x51 in 简体中文 — see the default_* helpers), so this lane
# reproduces the framing the page already uses instead of inventing a new one.
#
# AS FRACTIONS, NOT COLUMN NUMBERS, deliberately: a fraction survives an overridden geometry. Measured
# back, 0.614/0.689 reproduce 97x31 of 158x45 and 134x35 of 218x51 for the team window, and 0.45
# reproduces the 20- and 22-row sidebar windows.
TEAM_WIN_W_FRAC="0.614"
TEAM_WIN_H_FRAC="0.689"
SIDEBAR_WIN_H_FRAC="0.45"
# Cells of headroom a text-anchored window keeps past the text it frames.
STATUS_PAD_COLS=2

# ── the pane geometry the shipped tiles used, per locale ──────────────────────
# READ OFF THE CAPTURES THEMSELVES: the team panel's own title row reports the terminal size dsh-tui
# measured, and the shipped English pane reported `156x42` under a 158x45 capture while the 简体中文 one
# reported `216x48` under 218x51 (the measured size is the pane minus 2 columns and 3 rows). Env overrides
# win, so any geometry can be re-shot without editing this file.
default_cols() { [ "$1" = "en" ] && printf '158' || printf '218'; }
default_rows() { [ "$1" = "en" ] && printf '45' || printf '51'; }

# ── arguments ─────────────────────────────────────────────────────────────────
LANG_KIND="${MPD_UI_TUI_LANG:-zh}"
OUT_BASE=/data-out/readme
EVIDENCE_BASE=/data/tui-evidence
while [ $# -gt 0 ]; do
  case "$1" in
    --lang) LANG_KIND="${2:-}"; shift 2 ;;
    --lang=*) LANG_KIND="${1#--lang=}"; shift ;;
    --out) OUT_BASE="${2:-}"; shift 2 ;;
    --out=*) OUT_BASE="${1#--out=}"; shift ;;
    --evidence) EVIDENCE_BASE="${2:-}"; shift 2 ;;
    --evidence=*) EVIDENCE_BASE="${1#--evidence=}"; shift ;;
    *) printf '[tui-capture] unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done
case "$LANG_KIND" in
  en|zh) : ;;
  *) printf '[tui-capture] --lang wants en or zh, got %s\n' "$LANG_KIND" >&2; exit 2 ;;
esac

# The output directory carries the README's OWN language directory name, so publishing a run is a straight
# copy (`cp -r out/readme/en/* docs/assets/images/`, `… zh-CN/* docs/assets/images/zh-CN/`) with no
# renaming step in between that could drop or swap a file.
LANG_DIR_NAME="$LANG_KIND"
[ "$LANG_KIND" = "zh" ] && LANG_DIR_NAME="zh-CN"
OUT_DIR="$OUT_BASE/$LANG_DIR_NAME"
EVIDENCE_DIR="$EVIDENCE_BASE/$LANG_KIND"
MANIFEST="$EVIDENCE_DIR/tui-manifest.json"
ITEMS="$EVIDENCE_DIR/.tui-items.jsonl"

COLS="${MPD_UI_TUI_COLS:-$(default_cols "$LANG_KIND")}"
ROWS="${MPD_UI_TUI_ROWS:-$(default_rows "$LANG_KIND")}"

log() { printf '[tui-capture] %s\n' "$*"; }

# ── the evidence ledger ───────────────────────────────────────────────────────
# One row per figure, appended as the run proceeds, then folded into ONE manifest at the end: a reviewer
# reads the manifest and sees, per file, the marker that justified it and the pane line that matched it,
# so a wrong-frame image can be spotted without re-running anything. The manifest is written WHOLE at the
# end — a truncated object-per-line file is still valid JSON that lies about its tail. `jq` is deliberately
# not used (it is not installed and must not be): `node` is in the image and is already the toolchain every
# script here uses.
json_string() { node -e 'process.stdout.write(JSON.stringify(process.argv[1] ?? ""))' -- "$1"; }
# Record one item: the name, whether its marker was seen, the marker regex, the pane line that matched, the
# PNG path, and a note naming the window and the geometry it was taken at.
record() {
  printf '{"name":%s,"ok":%s,"marker":%s,"matchedLine":%s,"file":%s,"note":%s}\n' \
    "$(json_string "$1")" "$2" "$(json_string "$3")" "$(json_string "$4")" \
    "$(json_string "$5")" "$(json_string "$6")" >>"$ITEMS"
}

# ── reading the pane ──────────────────────────────────────────────────────────
# The pane as SCREEN ROWS. This is the ONLY form whose line number is a row number: `-J` joins a wrapped
# logical line into one output line, which is better for matching a marker and useless for arithmetic on
# rows. Every band below is computed from THIS capture.
pane_rows() { tmux -S "$SOCK" capture-pane -p -t "$SESSION" 2>/dev/null; }
# The pane as JOINED TEXT, for markers only (a marker split across a wrap still matches here) and as the
# human-readable evidence stored beside each PNG. No crop is ever taken from this view.
pane_joined() { tmux -S "$SOCK" capture-pane -p -J -t "$SESSION" 2>/dev/null; }
# The pane's bytes WITH their colour escapes — the stream the rasterizer paints.
pane_ansi() { tmux -S "$SOCK" capture-pane -e -p -J -t "$SESSION" 2>/dev/null; }
# Send one keystroke sequence, including the trailing Enter when the caller passes one.
keys() { tmux -S "$SOCK" send-keys -t "$SESSION" "$@" 2>/dev/null || true; }
# Wait until the pane carries `$1`, up to `$2` seconds. The poll is on the PANE, never on a sleep: a fixed
# sleep is a bet on the host's speed that silently loses on a loaded machine.
wait_marker() {
  local pattern="$1" timeout="${2:-$MARKER_TIMEOUT}" waited=0
  while [ "$waited" -lt "$timeout" ]; do
    if pane_joined | grep -qE "$pattern"; then return 0; fi
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}
# Wait for a marker to DISAPPEAR. Used after a scene closes, because a scene still painted would otherwise
# be read as the next one.
wait_absent() {
  local pattern="$1" timeout="${2:-30}" waited=0
  while [ "$waited" -lt "$timeout" ]; do
    if ! pane_joined | grep -qE "$pattern"; then return 0; fi
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}
# The LAST row matching a marker. The latest match is the live surface when a transcript echoes the same
# words twice, and every marker is chosen to sit on one row, so the index IS a row index.
row_of() { pane_rows | grep -nE "$1" | tail -1 | cut -d: -f1; }
# The pane line that matched `$1`, trimmed — the human-readable half of the proof.
line_of() { pane_joined | grep -E "$1" | head -1 | sed 's/[[:space:]]*$//'; }
# The 1-based index of the first CELL at which a marker starts on the first row that carries it. It is
# computed in Python, not awk: awk's RSTART counts BYTES under the C locale, every box-drawing glyph in the
# prefix is 3 bytes there, and a byte index would put the sidebar window off by dozens of cells.
col_of() {
  pane_rows | grep -E "$1" | head -1 | \
    python3 -c 'import re,sys; line=sys.stdin.readline().rstrip("\n"); m=re.search(sys.argv[1], line); print(m.start()+1 if m else "")' "$1"
}
# How many CELLS a row's text occupies, counting an East-Asian wide glyph as the two columns it takes — the
# unit every crop in this file is expressed in.
cells_of() {
  printf '%s' "$1" | python3 -c 'import sys,unicodedata as u; s=sys.stdin.read(); print(sum(0 if u.combining(c) else (2 if u.east_asian_width(c) in ("W","F") else 1) for c in s))'
}

# ── the renderer, and the ONE crop primitive ──────────────────────────────────
# Render one band of the captured stream into the deliverable directory. The band is a WINDOW onto the grid
# tmux already laid out, never a re-layout, and a non-zero exit means no usable PNG was produced.
# $1 captured ANSI file, $2 the figure's own name, $3 the row band, $4 the column band.
render_band() {
  local ansi="$1" name="$2" rows_band="$3" cols_band="$4"
  python3 "$RENDER" "$ansi" "$OUT_DIR/$name.png" "--rows=$rows_band" "--cols=$cols_band" "--scale=$SCALE"
}

# ── THE MARKERS ───────────────────────────────────────────────────────────────
# Each names the surface that emits it and NOTHING else, so a hit is evidence that the surface opened
# rather than evidence that the app is alive.
#   team scene  : the DAG section's own heading, drawn only by the team scene.
#   workmates   : the sidebar box's own border title, drawn only by the workmate panel.
#   status line : the keyed row's own key, `mpd: … boulder … workmate …`.
# `mpd:`, `boulder` and `workmate` are NOT localized (measured in both locales: 简体中文 spells the other
# words 团队/计划 but leaves these tokens alone), and `workmate` covers both the English plural and the
# Chinese singular, so one pattern serves both runs.
TEAM_MARKER='task dependency graph'
WORKMATES_MARKER='MPD workmate'
STATUS_MARKER='mpd: .*boulder .*workmate'

# A CHAT FRAME, not a prompt glyph: the launchpad and the first-run wizard both draw the `❯` a composer
# draws, so accepting a bare glyph reports ready on a landing screen. The landing markers are listed in
# both languages because the pane's language is the point of this run.
is_chat_frame() {
  local pane
  pane="$(pane_joined)"
  printf '%s' "$pane" | grep -qE '❯|esc to interrupt' || return 1
  printf '%s' "$pane" | grep -qE '跳过引导|说点什么|Esc 跳出引导|Get started|Tell me what' && return 1
  return 0
}

# THE TRAP, ENFORCED. A marker that is ALREADY on screen before its scene opens cannot be evidence that the
# scene opened — that is exactly how a capture gated on the team's own name fired on the chat screen. This
# runs on the settled chat frame and REFUSES the whole run when a SCENE marker is on it, because every later
# gate would then be gating on a string that is present either way.
#
# THE STATUS-LINE MARKER IS DELIBERATELY NOT IN THAT SET. The keyed status row is a CHAT-SURFACE element:
# it is on the chat screen by definition, and the figure that shows it is a crop OF the chat screen. It is
# therefore asserted PRESENT here — which is both the precondition scene 3 needs and a second, independent
# proof that the frame this runs on really is the chat frame.
assert_chat_frame() {
  local pane nonunique=0
  pane="$(pane_joined)"
  if ! is_chat_frame; then
    log "FATAL: the TUI never reached a chat frame — see $EVIDENCE_DIR/restart.log"
    return 1
  fi
  for marker in "$TEAM_MARKER" "$WORKMATES_MARKER"; do
    if printf '%s' "$pane" | grep -qE "$marker"; then
      log "FATAL: the scene marker '$marker' is ALREADY on the chat screen — it cannot gate a scene"
      nonunique=1
    fi
  done
  if [ "$nonunique" -ne 0 ]; then
    log "FATAL: refusing to capture; a non-unique marker is the defect this lane already shipped once"
  fi
  if ! printf '%s' "$pane" | grep -qE "$STATUS_MARKER"; then
    log "note: the keyed status row is not on the chat frame yet; scene 3 waits for it on its own"
  fi
  return "$nonunique"
}

# ── preconditions ─────────────────────────────────────────────────────────────
# Ask about EACH tool this script uses, not about one of them: the blocked case here is "the rasterizer is
# missing while tmux works", and a guard that checks the wrong tool lets the run die later inside a
# subshell whose error nobody reads.
for tool in tmux node python3; do
  command -v "$tool" >/dev/null 2>&1 || { log "FATAL: $tool is not on PATH (the entrypoint installs it)"; exit 3; }
done
[ -s "$RENDER" ] || { log "FATAL: $RENDER is missing — the rasterizer ships beside this script"; exit 3; }

# ── the session, in the requested language ────────────────────────────────────
# The restart is DELEGATED to restart-tui.sh — THE one place that knows how to start this session
# (onboarding neutralised, launchpad off, preset pinned, locale and geometry passed). A second copy of that
# recipe here is how the two copies drift, and drifting is exactly what puts a first-run wizard back on
# screen where a chat surface was expected.
restart_session() {
  MPD_UI_TUI_COLS="$COLS" MPD_UI_TUI_ROWS="$ROWS" \
    bash "$HERE/restart-tui.sh" "$LANG_KIND" >"$EVIDENCE_DIR/restart.log" 2>&1
  log "session restarted: ${COLS}x${ROWS}, DSH_TUI_LANG=$LANG_KIND"
}

# ── the scenes ────────────────────────────────────────────────────────────────
# Every name below is one of the README's own file names, so the set this script produces is the set the
# page references and there is no renaming step in between that could drop one.
capture_scenes() {
  local failed=0 ansi="$SCRATCH/scene.ansi" height band_rows band_cols
  height="$(pane_rows | wc -l | tr -d ' ')"
  [ -n "$height" ] && [ "$height" -gt 0 ] || height="$ROWS"
  # The windows, in cells, from the pane this run actually has.
  local team_cols team_rows sidebar_rows
  team_cols="$(python3 -c "print(max(1, round($COLS * $TEAM_WIN_W_FRAC)))")"
  team_rows="$(python3 -c "print(max(1, round($height * $TEAM_WIN_H_FRAC)))")"
  sidebar_rows="$(python3 -c "print(max(1, round($height * $SIDEBAR_WIN_H_FRAC)))")"

  # 1) `/mpd team` — the layered task-dependency DAG, the figure the dual-surface story rests on. THE
  #    MARKER IS THE SCENE'S OWN SECTION HEADING, never the fixture team's name: the name also appears on
  #    the chat screen (see the trap note at the top) and cannot gate a scene.
  log "scene 1/3: /mpd team"
  keys Escape; sleep 1
  keys "/mpd team" Enter
  if wait_marker "$TEAM_MARKER"; then
    pane_joined >"$EVIDENCE_DIR/tui-team-dag.pane.txt"
    pane_ansi >"$ansi"; cp -f "$ansi" "$EVIDENCE_DIR/tui-team-dag.ansi"
    band_rows="0:$team_rows"; band_cols="0:$team_cols"
    if render_band "$ansi" "tui-team-dag" "$band_rows" "$band_cols" >/dev/null; then
      record "tui-team-dag" true "$TEAM_MARKER" "$(line_of "$TEAM_MARKER")" "$OUT_DIR/tui-team-dag.png" \
        "rows=$band_rows cols=$band_cols scale=$SCALE lang=$LANG_KIND geometry=${COLS}x${height}"
    else
      record "tui-team-dag" false "$TEAM_MARKER" "" "" "renderer failed"; failed=1
    fi
  else
    record "tui-team-dag" false "$TEAM_MARKER" "" "" "marker never appeared in ${MARKER_TIMEOUT}s"; failed=1
  fi
  keys Escape; sleep 1
  wait_absent "$TEAM_MARKER" 15 || log "note: the team scene is still painted; the next marker gates anyway"

  # 2) THE HOST SIDE PANEL on the MPD workmate page — `Ctrl+B` toggles it, and the panel box's own border
  #    title is the marker, so no chat-screen string can satisfy it. The window is anchored on the
  #    sidebar's own left edge, FOUND IN THE PANE rather than assumed from a column number, which is why it
  #    follows the pane instead of drifting off the figure when the geometry changes.
  log "scene 2/3: the MPD workmate sidebar page (Ctrl+B)"
  keys C-b
  if wait_marker '┌MPD workmate' 60; then
    pane_joined >"$EVIDENCE_DIR/tui-workmates.pane.txt"
    pane_ansi >"$ansi"; cp -f "$ansi" "$EVIDENCE_DIR/tui-workmates.ansi"
    local box_col sidebar_left
    box_col="$(col_of '┌MPD workmate')"
    sidebar_left=$(( ${box_col:-1} - 1 ))
    [ "$sidebar_left" -ge 0 ] || sidebar_left=0
    band_rows="0:$sidebar_rows"; band_cols="$sidebar_left:$COLS"
    if render_band "$ansi" "tui-workmates" "$band_rows" "$band_cols" >/dev/null; then
      record "tui-workmates" true '┌MPD workmate' "$(line_of '┌MPD workmate')" "$OUT_DIR/tui-workmates.png" \
        "rows=$band_rows cols=$band_cols scale=$SCALE sidebar_left=$sidebar_left lang=$LANG_KIND"
    else
      record "tui-workmates" false '┌MPD workmate' "" "" "renderer failed"; failed=1
    fi
  else
    record "tui-workmates" false '┌MPD workmate' "" "" "the sidebar never opened within 60s"; failed=1
  fi
  keys C-b; sleep 1
  wait_absent '┌MPD workmate' 15 || log "note: the sidebar is still painted"

  # 3) THE KEYED STATUS LINE — a THREE-ROW STRIP around the keyed row itself, taken from the CHAT screen.
  #    One row reads as a fragment and a whole screen around one row proves nothing about the row, so the
  #    band is the row plus one gutter row either side, and the columns are measured from the text the row
  #    actually carries (it is shorter in 简体中文, where two of its words are wide glyphs and a column
  #    count taken from the English row would cut them).
  log "scene 3/3: the keyed status line"
  if wait_marker '^[[:space:]]*mpd: ' 45; then
    pane_joined >"$EVIDENCE_DIR/tui-status-line.pane.txt"
    pane_ansi >"$ansi"; cp -f "$ansi" "$EVIDENCE_DIR/tui-status-line.ansi"
    local status_row status_text status_cols top bottom
    status_row="$(row_of '^[[:space:]]*mpd: ')"
    status_text="$(line_of '^[[:space:]]*mpd: ' | sed 's/^[[:space:]]*//')"
    status_cols="$(cells_of "$status_text")"
    status_cols=$(( status_cols + STATUS_PAD_COLS ))
    [ "$status_cols" -le "$COLS" ] || status_cols="$COLS"
    [ "${status_row:-0}" -gt 0 ] || status_row="$height"
    top=$(( status_row - 2 )); [ "$top" -ge 0 ] || top=0
    bottom=$(( status_row + 1 ))
    band_rows="$top:$bottom"; band_cols="0:$status_cols"
    if render_band "$ansi" "tui-status-line" "$band_rows" "$band_cols" >/dev/null; then
      record "tui-status-line" true '^[[:space:]]*mpd: ' "$status_text" "$OUT_DIR/tui-status-line.png" \
        "rows=$band_rows cols=$band_cols scale=$SCALE status_row=$status_row lang=$LANG_KIND"
    else
      record "tui-status-line" false '^[[:space:]]*mpd: ' "" "" "renderer failed"; failed=1
    fi
  else
    record "tui-status-line" false '^[[:space:]]*mpd: ' "" "" "the keyed status row never appeared"; failed=1
  fi

  return "$failed"
}

# ── run ───────────────────────────────────────────────────────────────────────
log "language=$LANG_KIND out=$OUT_DIR geometry=${COLS}x${ROWS} scale=$SCALE"
mkdir -p "$OUT_DIR" "$EVIDENCE_DIR" "$SCRATCH"
: >"$ITEMS"

# The workspace state the three scenes read. The seeding lives in the repository's own fixture script so
# the Web and TUI sets show the SAME run; when it is absent or has no docker CLI to reach the container
# with, the run continues and the manifest records what was captured as it stood.
SEEDER="$HERE/seed-team-fixture.sh"
if [ -f "$SEEDER" ] && command -v docker >/dev/null 2>&1; then
  MPD_UI_CONTAINER="${MPD_UI_CONTAINER:-ui-ui-1}" bash "$SEEDER" >>"$EVIDENCE_DIR/seed.log" 2>&1 \
    || log "note: fixture seeding failed (see $EVIDENCE_DIR/seed.log); capturing the workspace as it stands"
else
  log "note: no fixture seeder reachable here — the workspace is captured as it stands"
fi

restart_session
if ! wait_marker '❯|esc to interrupt' 120; then
  log "FATAL: the TUI never produced a chat frame after the restart — see $EVIDENCE_DIR/restart.log"
  exit 1
fi
sleep 2
assert_chat_frame || exit 1

capture_scenes
SCENE_STATUS=$?

# The ledger, written whole. `jq` is not installed and must not be: `node` is, and it is already the
# toolchain every script here uses.
node -e '
const fs = require("node:fs")
const [itemsPath, manifestPath, lang, out, method] = process.argv.slice(1)
const items = fs.readFileSync(itemsPath, "utf8").split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line))
const ok = items.filter((item) => item.ok === true).length
fs.writeFileSync(manifestPath, JSON.stringify({ lang, out, method, captured: ok, expected: items.length, failed: items.length - ok, items }, null, 2) + "\n")
console.log(`[tui-capture] manifest: ${ok}/${items.length} captures justified by a marker -> ${manifestPath}`)
' "$ITEMS" "$MANIFEST" "$LANG_KIND" "$OUT_DIR" \
  "dsh-tui pane bytes (tmux capture-pane -e -p -J) rasterized by docker/ui/tui-render.py; the page background is the lane's stated choice (#22262E)"

# A run where any marker missed exits non-zero: a caller that reads only the exit code must not be able to
# take a partial set for a complete one.
if [ "$SCENE_STATUS" -ne 0 ]; then
  log "INCOMPLETE: at least one marker never appeared — read $MANIFEST before using these images"
  exit 1
fi
log "done — $(ls -1 "$OUT_DIR" | wc -l) image(s) in $OUT_DIR"
