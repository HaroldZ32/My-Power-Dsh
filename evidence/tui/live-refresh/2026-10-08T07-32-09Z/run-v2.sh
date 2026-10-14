#!/usr/bin/env bash
# run-v2.sh <attempt-name> — the FULL live-refresh test on the real dsh-tui 0.14.0 PTY.
#
# ORDER MATTERS (learned in probe-1): `/mpd panel` moves the input focus into the host sidebar, so the
# full-screen scene MUST be opened FIRST from the composer; afterwards Escape closes the scene and the
# composer is usable again. Every step that opens a surface is a KEY PRESS; the refresh windows between
# a mutation and its captures send NO key at all, and each surface gets a RE-OPEN control afterwards so a
# frame that failed to refresh cannot be explained away by a fixture the reader never saw.
set -uo pipefail

REPO=/home/haroldzhao/MyProj/DshProj/My-Power-Dsh
EVID="$REPO/evidence/tui/live-refresh/2026-10-08T07-32-09Z"
ATTEMPT="${1:-full-1}"
OUT="$EVID/$ATTEMPT"
mkdir -p "$OUT"
LOG="$OUT/run.log"
exec > >(tee -a "$LOG") 2>&1

log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
log "=== attempt=$ATTEMPT utc-start=$STAMP"

SB="$(mktemp -d /tmp/mpd-lr-XXXXXX)"
SOCK="/tmp/tui.sock"; SESS=tui; COLS=220; ROWS=50
log "sandbox=$SB"

mkdir -p "$SB/dshhome/profiles" "$SB/home" "$SB/ws" "$SB/npm-cache" "$SB/pnpm-home" "$SB/config" "$SB/data"
cp -a "$HOME/.dsh/profiles/dsh-tui" "$SB/dshhome/profiles/dsh-tui"
ln -sfn "$REPO" "$SB/dshhome/profiles/dsh-tui/node_modules/@mpd-dsh/mpd"
cp "$HOME/.dsh/.credentials.yaml" "$SB/dshhome/.credentials.yaml" 2>/dev/null || true
cp "$HOME/.dsh/.anonymous-user-id" "$SB/dshhome/.anonymous-user-id" 2>/dev/null || true
mkdir -p "$SB/home/.dsh-tui"
printf '{\n  "completed": true,\n  "version": 1\n}\n' >"$SB/home/.dsh-tui/onboarding.json"
printf '{\n  "preset": "mpd"\n}\n' >"$SB/home/.dsh-tui/agent-preset.json"
log "sandbox host version=$(node -e 'process.stdout.write(String(require(process.argv[1]).version))' "$SB/dshhome/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui/package.json")"

TEAMID="team-2026-10-05T22-30-00.000Z"
node "$REPO/docker/ui/team-fixture.mts" "sess-live-refresh" "$SB/ws" normal >"$OUT/fixture-seed.log" 2>&1
log "fixture: $(cat "$OUT/fixture-seed.log")"
TEAMFILE="$SB/ws/.mpd/team/teams/$TEAMID.json"
cp -f "$TEAMFILE" "$OUT/record-before.json"

cat >"$OUT/mutate.mjs" <<'MUT_EOF'
// Mutate the seeded team record IN PLACE: flip statuses and append a task, so the drawn board and any
// task count must both change. Usage: node mutate.mjs <record.json> <mode>
import { readFileSync, writeFileSync } from "node:fs"
const [file, mode] = process.argv.slice(2)
const record = JSON.parse(readFileSync(file, "utf8"))
const byId = new Map(record.tasks.map((t) => [t.id, t]))
const now = new Date().toISOString()
const flip = (id, status, extra = {}) => {
  const task = byId.get(id)
  if (task === undefined) throw new Error(`no task ${id}`)
  task.status = status; task.updatedAt = now; task.revision = (task.revision ?? 1) + 1; Object.assign(task, extra)
}
const append = (id, subject, opts = {}) => {
  record.tasks.push({
    id, subject, description: `Acceptance: ${subject}`, kind: opts.kind ?? "work", status: opts.status ?? "pending",
    blockedBy: opts.blockedBy ?? [], writeScopes: [], createdAt: now, updatedAt: now, revision: 1, ...(opts.owner ? { owner: opts.owner } : {}),
  })
}
if (mode === "scene") {
  flip("T2", "completed")
  flip("T4", "pending", { verdict: undefined })
  append("T7", "LiveProbe: appended while the SCENE was open", { blockedBy: ["T6"], owner: "ui-reviewer" })
} else if (mode === "panel") {
  flip("T4", "completed")
  flip("T6", "in_progress", { owner: "web-team-gui" })
  append("T8", "LiveProbe: appended while the SIDEBAR was open", { blockedBy: ["T7"], kind: "integration" })
} else { throw new Error(`unknown mode ${mode}`) }
writeFileSync(file, JSON.stringify(record, null, 2))
process.stdout.write(`${mode}: tasks=${record.tasks.length} ${record.tasks.map((t) => t.id + ":" + t.status).join(" ")}\n`)
MUT_EOF

tmux -f /dev/null -S "$SOCK" new-session -d -s "$SESS" -x "$COLS" -y "$ROWS" -c "$SB/ws" || log "tmux new-session FAILED"
tmux -S "$SOCK" pipe-pane -t "$SESS" -o "cat > '$OUT/pane-stream.log'" 2>/dev/null || true
BOOT="env -i 'PATH=$PATH' 'DSH_HOME=$SB/dshhome' 'HOME=$SB/home' 'TERM=xterm-256color' 'DSH_TUI_LANG=en' 'DSH_TUI_NO_LAUNCHPAD=1' 'DSH_TUI_WORKSPACE_TARGET=$SB/ws' 'npm_config_cache=$SB/npm-cache' 'XDG_CONFIG_HOME=$SB/config' 'XDG_DATA_HOME=$SB/data' dsh-tui"
tmux -S "$SOCK" send-keys -t "$SESS" "$BOOT" Enter 2>/dev/null || log "send-keys FAILED"

keys() { tmux -S "$SOCK" send-keys -t "$SESS" "$@" 2>/dev/null || true; }
pane_joined() { tmux -S "$SOCK" capture-pane -p -J -t "$SESS" 2>/dev/null; }
pane_ansi() { tmux -S "$SOCK" capture-pane -e -p -J -t "$SESS" 2>/dev/null; }
GRID="$(tmux -S "$SOCK" display -p -t "$SESS" '#{pane_width}x#{pane_height}' 2>/dev/null || echo unknown)"
log "tmux grid: $GRID"; printf '%s\n' "$GRID" >"$OUT/grid.txt"

cap() {
  local name="$1" at; at="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
  pane_ansi >"$OUT/$name.ansi"; pane_joined >"$OUT/$name.txt"; printf '%s\n' "$at" >"$OUT/$name.at"
  log "CAPTURE $name @ $at"
}
wait_marker() {
  local pattern="$1" timeout="${2:-60}" waited=0
  while [ "$waited" -lt "$timeout" ]; do pane_joined | grep -qE "$pattern" && return 0; sleep 1; waited=$((waited+1)); done
  return 1
}
line_of() { pane_joined | grep -E "$1" | head -1 | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'; }
mode_line() { grep -aoE 'view (boxes|list|rail)[^│]*' "$OUT/$1.txt" | head -1; }
scene_head() { grep -aE 'task dependency graph' "$OUT/$1.txt" | head -1 | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'; }
summary_line() { grep -aoE 'tasks [0-9]+/[0-9]+[^│]*' "$OUT/$1.txt" | head -1; }
# How many lines differ between two plain captures (trailing whitespace ignored): 0 means the frame is
# byte-identical to the pre-mutation frame, which is the falsifier the refresh test rests on.
frame_diff() {
  local n
  n="$(diff <(sed 's/[[:space:]]*$//' "$OUT/$1.txt") <(sed 's/[[:space:]]*$//' "$OUT/$2.txt") | grep -cE '^[<>]')"
  printf '%s vs %s: changedLines=%s\n' "$1" "$2" "$n"
  diff <(sed 's/[[:space:]]*$//' "$OUT/$1.txt") <(sed 's/[[:space:]]*$//' "$OUT/$2.txt") | grep -E '^[<>]' | head -6 | sed 's/^/        /'
  for f in "$1" "$2"; do
    printf '        %s: modeLine="%s" summary="%s"\n' "$f" "$(mode_line "$f")" "$(summary_line "$f")"
  done
}
census() {
  node -e '
const fs=require("node:fs");const s=fs.readFileSync(process.argv[1],"utf8");
const count=(re)=>(s.match(re)??[]).length;
process.stdout.write(JSON.stringify({roundedCorners:count(/[╭╮╰╯]/g),boxGlyphsT:count(/┬/g),square:count(/[┌└]/g),verticals:count(/[│┃]/g),densTag:s.includes("(dense)"),railTag:s.includes("graph (rail)"),boxesTag:s.includes("view boxes"),listTag:s.includes("view list"),railViewTag:s.includes("view rail")})+"\n")' "$1"
}

log "waiting for the chat frame ..."
waited=0
until pane_joined | grep -qE '❯|esc to interrupt' && ! pane_joined | grep -qE '跳过引导|Get started|Tell me what'; do
  [ "$waited" -ge 150 ] && { log "FATAL: no chat frame in 150s"; cap "boot-stuck"; tmux -S "$SOCK" kill-server 2>/dev/null; exit 1; }
  sleep 1; waited=$((waited+1))
done
sleep 3; cap "00-chat"
log "chat status row: $(grep -aoE 'mpd: team[^│]*' "$OUT/00-chat.txt" | head -1)"

# ══ SURFACE B: the FULL-SCREEN team scene ════════════════════════════════════════════════════════
log "--- [B] opening the full-screen scene: /mpd team  (KEY PRESS)"
keys "/mpd team" Enter
if wait_marker 'task dependency graph' 90; then log "B marker 'task dependency graph' SEEN"; else log "B marker NOT seen in 90s"; fi
sleep 3; cap "B1-scene-open"
log "B1 header: $(scene_head B1-scene-open)"
log "B1 summary: $(summary_line B1-scene-open)"

log "--- [B] mutating the record (bump=scene, 6 -> 7 tasks), NO KEY PRESS from here"
log "mutation: $(node "$OUT/mutate.mjs" "$TEAMFILE" scene)"
T0="$(date -u +%s%3N)"
sleep 2; cap "B2-scene-plus2s"; log "   t+$(( $(date -u +%s%3N) - T0 ))ms"
sleep 2; cap "B3-scene-plus4s"; log "   t+$(( $(date -u +%s%3N) - T0 ))ms"
sleep 4; cap "B4-scene-plus8s"; log "   t+$(( $(date -u +%s%3N) - T0 ))ms"
{ frame_diff B1-scene-open B4-scene-plus8s; } | tee "$OUT/B-refresh-diff.txt"

log "--- [B] CONTROL: close (Escape) and RE-OPEN the scene (key presses resume)"
keys Escape; sleep 2; cap "B5-after-escape"; log "B5 header after escape: '$(scene_head B5-after-escape)'"
keys "/mpd team" Enter; sleep 4; cap "B6-scene-reopened"
log "B6 header: $(scene_head B6-scene-reopened)"
log "B6 summary: $(summary_line B6-scene-reopened)"
{ frame_diff B1-scene-open B6-scene-reopened; } | tee "$OUT/B-control-diff.txt"

# ══ SURFACE A: the MPD SIDEBAR page ══════════════════════════════════════════════════════════════
keys Escape; sleep 2
log "--- [A] opening the sidebar page: /mpd panel  (KEY PRESS)"
keys "/mpd panel" Enter
if wait_marker 'view (boxes|list|rail)' 60; then log "A mode line SEEN"; else log "A mode line NOT seen in 60s"; fi
sleep 4; cap "A1-sidebar-open"
log "A1 mode line: $(mode_line A1-sidebar-open)"
log "A1 summary:   $(summary_line A1-sidebar-open)"
grep -aE 'MPD|view boxes|team webui' "$OUT/A1-sidebar-open.txt" | head -4 | sed 's/^/    /'

log "--- [A] mutating the record (bump=panel, 7 -> 8 tasks), NO KEY PRESS from here"
log "mutation: $(node "$OUT/mutate.mjs" "$TEAMFILE" panel)"
T1="$(date -u +%s%3N)"
sleep 2; cap "A2-sidebar-plus2s"; log "   t+$(( $(date -u +%s%3N) - T1 ))ms"
sleep 2; cap "A3-sidebar-plus4s"; log "   t+$(( $(date -u +%s%3N) - T1 ))ms"
sleep 4; cap "A4-sidebar-plus8s"; log "   t+$(( $(date -u +%s%3N) - T1 ))ms"
{ frame_diff A1-sidebar-open A4-sidebar-plus8s; } | tee "$OUT/A-refresh-diff.txt"

log "--- [A] CONTROL: re-open the sidebar page (key presses resume) and see whether the new state is read"
keys "/mpd panel" Enter; sleep 4; cap "A5-sidebar-reopened"
log "A5 mode line: $(mode_line A5-sidebar-reopened)"
log "A5 summary:   $(summary_line A5-sidebar-reopened)"
{ frame_diff A2-sidebar-plus2s A5-sidebar-reopened; } | tee "$OUT/A-control-diff.txt"

# ── census + one-line facts ───────────────────────────────────────────────────
: >"$OUT/census.txt"
for f in "$OUT"/[AB]*.txt; do [ -s "$f" ] && printf '%s %s\n' "$(basename "$f")" "$(census "$f")" >>"$OUT/census.txt"; done
cat "$OUT/census.txt"
log "record final: $(node -e 'const fs=require("node:fs");const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(r.tasks.map(t=>t.id+":"+t.status).join(" "))' "$TEAMFILE")"
cp -f "$TEAMFILE" "$OUT/record-after.json"
log "=== utc-end=$(date -u +%Y-%m-%dT%H:%M:%SZ) sandbox=$SB evidence=$OUT"
printf '%s\n' "$SB" >"$OUT/sandbox-path.txt"
tmux -S "$SOCK" kill-server 2>/dev/null || true
log "tmux server stopped"
