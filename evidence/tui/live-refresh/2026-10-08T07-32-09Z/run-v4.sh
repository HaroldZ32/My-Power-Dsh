#!/usr/bin/env bash
# run-v4.sh <attempt> — BIG-BOARD probe on the real dsh-tui 0.14.0 PTY.
#
# The board is 26 tasks across 16 ranks (evidence/tui/live-refresh/<stamp>/make-big-board.mjs), which
# arms BOTH frozen fallback triggers: >24 tasks (`panel-dag.ts` LIST_ROWS) and >12 ranks
# (`graph.ts` MAX_BOX_RANKS). Both surfaces are captured, their mode markers quoted, and each gets a
# refresh spot check (mutate on disk, NO key press, capture at +2s and +4s).
set -uo pipefail

REPO=/home/haroldzhao/MyProj/DshProj/My-Power-Dsh
EVID="$REPO/evidence/tui/live-refresh/2026-10-08T07-32-09Z"
ATTEMPT="${1:-big-1}"
OUT="$EVID/$ATTEMPT"
mkdir -p "$OUT"
LOG="$OUT/run.log"
exec > >(tee -a "$LOG") 2>&1

log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
log "=== attempt=$ATTEMPT utc-start=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

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

TEAMID="team-2026-10-08T07-00-00.000Z"
node "$EVID/make-big-board.mjs" "$SB/ws" "$TEAMID" | tee "$OUT/fixture-seed.log"
TEAMFILE="$SB/ws/.mpd/team/teams/$TEAMID.json"
log "record: $TEAMFILE ($(wc -c <"$TEAMFILE") bytes)"
cp -f "$TEAMFILE" "$OUT/record-before.json"
node -e '
const fs=require("node:fs");const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const depth=(id,memo=new Map())=>{if(memo.has(id))return memo.get(id);const t=r.tasks.find(x=>x.id===id);const d=t.blockedBy.length===0?0:1+Math.max(...t.blockedBy.map(p=>depth(p,memo)));memo.set(id,d);return d};
const ds=r.tasks.map(t=>depth(t.id));process.stdout.write(`tasks=${r.tasks.length} ranks=${Math.max(...ds)+1} statuses=${[...new Set(r.tasks.map(t=>t.status))].join(",")}\n`)' "$TEAMFILE" | tee "$OUT/fixture-shape.txt"

cat >"$OUT/mutate-big.mjs" <<'MUT_EOF'
// Flip two statuses and append one task on the BIG board: a change no renderer can miss.
import { readFileSync, writeFileSync } from "node:fs"
const [file, mode] = process.argv.slice(2)
const record = JSON.parse(readFileSync(file, "utf8"))
const now = new Date().toISOString()
const byId = new Map(record.tasks.map((t) => [t.id, t]))
if (mode === "big1") {
  for (const [id, status] of [["B07", "completed"], ["B08", "in_progress"], ["F03", "completed"]]) {
    const task = byId.get(id); task.status = status; task.updatedAt = now; task.revision = (task.revision ?? 1) + 1
  }
  record.tasks.push({ id: "F11", subject: "LiveProbe: appended on the big board (phase 1)", description: "Acceptance: appended", kind: "work", status: "pending", blockedBy: ["B03"], writeScopes: [], createdAt: now, updatedAt: now, revision: 1, owner: "ui-worker" })
} else {
  for (const [id, status] of [["B09", "in_progress"], ["F04", "in_progress"]]) {
    const task = byId.get(id); task.status = status; task.updatedAt = now; task.revision = (task.revision ?? 1) + 1
  }
  record.tasks.push({ id: "F12", subject: "LiveProbe: appended on the big board (phase 2)", description: "Acceptance: appended", kind: "integration", status: "pending", blockedBy: ["B04"], writeScopes: [], createdAt: now, updatedAt: now, revision: 1 })
}
writeFileSync(file, JSON.stringify(record, null, 2))
process.stdout.write(`${mode}: tasks=${record.tasks.length}\n`)
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
wait_marker() { local p="$1" t="${2:-60}" w=0; while [ "$w" -lt "$t" ]; do pane_joined | grep -qE "$p" && return 0; sleep 1; w=$((w+1)); done; return 1; }
mode_line() { grep -aoE 'view (boxes|list|rail)[^│]*' "$OUT/$1.txt" | head -1 | sed 's/[[:space:]]*$//'; }
scene_head() { grep -aE 'task dependency graph' "$OUT/$1.txt" | head -1 | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'; }
frame_diff() {
  local n; n="$(diff <(sed 's/[[:space:]]*$//' "$OUT/$1.txt") <(sed 's/[[:space:]]*$//' "$OUT/$2.txt") | grep -cE '^[<>]')"
  printf '%s vs %s: changedLines=%s\n' "$1" "$2" "$n"
  for f in "$1" "$2"; do printf '        %s: modeLine="%s" header="%s"\n' "$f" "$(mode_line "$f")" "$(scene_head "$f")"; done
}

log "waiting for the chat frame ..."
w=0
until pane_joined | grep -qE '❯|esc to interrupt' && ! pane_joined | grep -qE '跳过引导|Get started|Tell me what'; do
  [ "$w" -ge 150 ] && { log "FATAL: no chat frame in 150s"; cap "boot-stuck"; tmux -S "$SOCK" kill-server 2>/dev/null; exit 1; }
  sleep 1; w=$((w+1))
done
sleep 3; cap "00-chat"
log "chat status row: $(grep -aoE 'mpd: team[^│]*' "$OUT/00-chat.txt" | head -1)"

# ══ SCENE (opened FIRST: /mpd panel steals input focus, measured in probe-1) ══════════════════════
log "--- [B] /mpd team  (full-screen scene, KEY PRESS)"
keys "/mpd team" Enter
if wait_marker 'task dependency graph' 90; then log "B marker SEEN"; else log "B marker NOT seen in 90s"; fi
sleep 3; cap "BIG-B1-scene"
log "BIG-B1 header: '$(scene_head BIG-B1-scene)'"

log "--- [B] mutate the big board on disk (big1), NO KEY PRESS from here"
log "mutation: $(node "$OUT/mutate-big.mjs" "$TEAMFILE" big1)"
T0="$(date -u +%s%3N)"
sleep 2; cap "BIG-B2-scene-plus2s"; log "   t+$(( $(date -u +%s%3N) - T0 ))ms"
sleep 2; cap "BIG-B3-scene-plus4s"; log "   t+$(( $(date -u +%s%3N) - T0 ))ms"
frame_diff BIG-B1-scene BIG-B3-scene-plus4s | tee "$OUT/BIG-B-refresh-diff.txt"

log "--- [B] CONTROL: Escape, then re-open the scene (key presses resume)"
keys Escape; sleep 2; cap "BIG-B4-after-escape"
keys "/mpd team" Enter; sleep 4; cap "BIG-B5-scene-reopened"
log "BIG-B5 header: '$(scene_head BIG-B5-scene-reopened)'"
frame_diff BIG-B2-scene-plus2s BIG-B5-scene-reopened | tee "$OUT/BIG-B-control-diff.txt"

# ══ SIDEBAR ═══════════════════════════════════════════════════════════════════════════════════════
keys Escape; sleep 2
log "--- [A] /mpd panel  (MPD sidebar page, KEY PRESS)"
keys "/mpd panel" Enter
if wait_marker 'view (boxes|list|rail)' 60; then log "A mode line SEEN"; else log "A mode line NOT seen in 60s"; fi
sleep 4; cap "BIG-A1-sidebar"
log "BIG-A1 mode line: '$(mode_line BIG-A1-sidebar)'"

log "--- [A] mutate the big board on disk (big2), NO KEY PRESS from here"
log "mutation: $(node "$OUT/mutate-big.mjs" "$TEAMFILE" big2)"
T1="$(date -u +%s%3N)"
sleep 2; cap "BIG-A2-sidebar-plus2s"; log "   t+$(( $(date -u +%s%3N) - T1 ))ms"
sleep 2; cap "BIG-A3-sidebar-plus4s"; log "   t+$(( $(date -u +%s%3N) - T1 ))ms"
frame_diff BIG-A1-sidebar BIG-A3-sidebar-plus4s | tee "$OUT/BIG-A-refresh-diff.txt"

log "--- [A] CONTROL: re-open the sidebar page"
keys "/mpd panel" Enter; sleep 4; cap "BIG-A4-sidebar-reopened"
log "BIG-A4 mode line: '$(mode_line BIG-A4-sidebar-reopened)'"
frame_diff BIG-A2-sidebar-plus2s BIG-A4-sidebar-reopened | tee "$OUT/BIG-A-control-diff.txt"

log "=== utc-end=$(date -u +%Y-%m-%dT%H:%M:%SZ) sandbox=$SB evidence=$OUT"
printf '%s\n' "$SB" >"$OUT/sandbox-path.txt"
cp -f "$TEAMFILE" "$OUT/record-after.json"
tmux -S "$SOCK" kill-server 2>/dev/null || true
log "tmux server stopped"
