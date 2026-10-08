#!/usr/bin/env bash
# THE REAL-MACHINE ARM (T-D3 + T-P3) — the sidebar and the team scene on the installed dsh-tui 0.14.0
# PTY, drawing the CALLING session's team, and re-drawn by the PUSH.
#
# THE SCRIPT'S WHOLE SUBJECT IS SESSION SCOPE. It seeds a team bound to a session that is NOT the one
# about to boot (`sess-other`), boots a fresh session, and asserts that the sidebar and the scene do NOT
# draw it — the exact shape of the reported defect (「我new了一个session，老session的DAG图还摆在那儿」).
# Only after that does it bind a board to the LIVE session's own id (discovered from the harness's own
# session store) and measure how long the open, untouched panel takes to show it.
#
# ISOLATION IS THREE THINGS (AGENTS.md §7): DSH_HOME=<sandbox>, HOME=<sandbox>, and a SANDBOXED
# WORKSPACE the boot is pointed at — without the third, a "sandboxed" boot writes the REAL workspace's
# `.mpd/team` records. The real ~/.dsh is only ever READ, to copy a profile and credentials once.
set -uo pipefail

REPO=/home/haroldzhao/MyProj/DshProj/My-Power-Dsh
EVID="$REPO/evidence/tui/session-scope-and-push/2026-10-08T08-22-12Z"
OUT="$EVID/pty"
mkdir -p "$OUT"
LOG="$OUT/run.log"
exec > >(tee -a "$LOG") 2>&1

log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
log "=== real-PTY arm utc-start=$STAMP"

SB="$(mktemp -d /tmp/mpd-ss-XXXXXX)"
SOCK="/tmp/tui-ss.sock"; SESS=tui-ss; COLS=140; ROWS=44
WS="$SB/ws"
log "sandbox=$SB workspace=$WS"

mkdir -p "$SB/dshhome/profiles" "$SB/home" "$WS" "$SB/npm-cache" "$SB/pnpm-home" "$SB/config" "$SB/data"
cp -a "$HOME/.dsh/profiles/dsh-tui" "$SB/dshhome/profiles/dsh-tui"
ln -sfn "$REPO" "$SB/dshhome/profiles/dsh-tui/node_modules/@mpd-dsh/mpd"
cp "$HOME/.dsh/.credentials.yaml" "$SB/dshhome/.credentials.yaml" 2>/dev/null || true
cp "$HOME/.dsh/.anonymous-user-id" "$SB/dshhome/.anonymous-user-id" 2>/dev/null || true
mkdir -p "$SB/home/.dsh-tui"
printf '{\n  "completed": true,\n  "version": 1\n}\n' >"$SB/home/.dsh-tui/onboarding.json"
printf '{\n  "preset": "mpd"\n}\n' >"$SB/home/.dsh-tui/agent-preset.json"
log "sandbox host version=$(node -e 'process.stdout.write(String(require(process.argv[1]).version))' "$SB/dshhome/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui/package.json")"

# ── THE SEED: two boards, one per session, with names short enough to survive the panel's clipping ──
cat >"$OUT/seed.mjs" <<'SEED_EOF'
// Write ONE mpd team record into a workspace and bind it to a session. Usage:
//   node seed.mjs <workspace> <sessionId> <teamId> <teamName> <extraTasks>
// The record shape is the one `TeamRecord` declares in packages/mpd-team-core-plugin/src/team-store.ts.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
const [workspace, sessionId, teamId, teamName, extra] = process.argv.slice(2)
const now = new Date().toISOString()
const task = (id, subject, status) => ({ id, subject, description: `Acceptance: ${subject}`, kind: "work", status, blockedBy: [], writeScopes: [], createdAt: now, updatedAt: now, revision: 1 })
const record = {
  version: 1, teamId, name: teamName, description: `board for ${sessionId}`, leadSessionId: sessionId,
  phase: "active", createdAt: now, approvedAt: now,
  members: [{ id: "M1", name: "lead", description: "Lead", role: "Lead", route: "deepseek-official/deepseek-v4-pro", status: "running", spawnedAt: now }],
  tasks: [task("T1", "first lane", "pending"), task("T2", "second lane", "pending"), task("T3", "third lane", "pending"), task("T4", "fourth lane", "pending"), ...(Number(extra) > 0 ? [task("T5", "appended lane", "pending")] : [])],
  nextMemberNumber: 2, nextTaskNumber: 6,
}
const teamRoot = join(workspace, ".mpd", "team")
mkdirSync(join(teamRoot, "teams"), { recursive: true })
writeFileSync(join(teamRoot, "teams", `${teamId}.json`), JSON.stringify(record, null, 2))
const indexPath = join(teamRoot, "teams.json")
let index = { version: 1, active: {} }
if (existsSync(indexPath)) { try { index = JSON.parse(readFileSync(indexPath, "utf8")) } catch { index = { version: 1, active: {} } } }
index.active = { ...(index.active ?? {}), [sessionId]: teamId }
writeFileSync(indexPath, JSON.stringify(index, null, 2))
process.stdout.write(`seeded ${teamId} (${teamName}) for ${sessionId}: ${record.tasks.length} tasks\n`)
SEED_EOF

log "seed OTHER: $(node "$OUT/seed.mjs" "$WS" sess-other team-other-session OTHERBOARD 0)"
log "index now: $(cat "$WS/.mpd/team/teams.json" | tr -d '\n ')"

tmux -f /dev/null -S "$SOCK" new-session -d -s "$SESS" -x "$COLS" -y "$ROWS" -c "$WS" || log "tmux new-session FAILED"
tmux -S "$SOCK" pipe-pane -t "$SESS" -o "cat > '$OUT/pane-stream.log'" 2>/dev/null || true
BOOT="env -i 'PATH=$PATH' 'DSH_HOME=$SB/dshhome' 'HOME=$SB/home' 'TERM=xterm-256color' 'DSH_TUI_LANG=en' 'DSH_TUI_NO_LAUNCHPAD=1' 'DSH_TUI_WORKSPACE_TARGET=$WS' 'npm_config_cache=$SB/npm-cache' 'XDG_CONFIG_HOME=$SB/config' 'XDG_DATA_HOME=$SB/data' dsh-tui"
tmux -S "$SOCK" send-keys -t "$SESS" "$BOOT" Enter 2>/dev/null || log "send-keys FAILED"

keys() { tmux -S "$SOCK" send-keys -t "$SESS" "$@" 2>/dev/null || true; }
pane_joined() { tmux -S "$SOCK" capture-pane -p -J -t "$SESS" 2>/dev/null; }
GRID="$(tmux -S "$SOCK" display -p -t "$SESS" '#{pane_width}x#{pane_height}' 2>/dev/null || echo unknown)"
log "tmux grid: $GRID"; printf '%s\n' "$GRID" >"$OUT/grid.txt"

cap() {
  local name="$1" at; at="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
  tmux -S "$SOCK" capture-pane -e -p -J -t "$SESS" >"$OUT/$name.ansi" 2>/dev/null
  tmux -S "$SOCK" capture-pane -p -J -t "$SESS" >"$OUT/$name.txt" 2>/dev/null
  printf '%s\n' "$at" >"$OUT/$name.at"
  log "CAPTURE $name @ $at"
}
wait_marker() {
  local pattern="$1" timeout="${2:-60}" waited=0
  while [ "$waited" -lt "$timeout" ]; do pane_joined | grep -qE "$pattern" && return 0; sleep 1; waited=$((waited+1)); done
  return 1
}
line_of() { pane_joined | grep -E "$1" | head -1 | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'; }
# The header row the panel draws, which is where the TEAM NAME is visible.
team_line() { grep -aoE 'team [A-Za-z0-9_-]+[^│]*' "$OUT/$1.txt" | head -1; }
# How many lines differ between two plain captures (trailing whitespace ignored).
frame_diff() {
  local n
  n="$(diff <(sed 's/[[:space:]]*$//' "$OUT/$1.txt") <(sed 's/[[:space:]]*$//' "$OUT/$2.txt") | grep -cE '^[<>]')"
  printf '%s vs %s: changedLines=%s\n' "$1" "$2" "$n"
  diff <(sed 's/[[:space:]]*$//' "$OUT/$1.txt") <(sed 's/[[:space:]]*$//' "$OUT/$2.txt") | grep -E '^[<>]' | head -8 | sed 's/^/        /'
}

log "waiting for the chat frame ..."
waited=0
until pane_joined | grep -qE '❯|esc to interrupt' && ! pane_joined | grep -qE '跳过引导|Get started|Tell me what'; do
  [ "$waited" -ge 150 ] && { log "FATAL: no chat frame in 150s"; cap "boot-stuck"; tmux -S "$SOCK" kill-server 2>/dev/null; exit 1; }
  sleep 1; waited=$((waited+1))
done
sleep 3; cap "00-chat"

# ══ STEP 1 · SEEDED FOR ANOTHER SESSION: the surface must say so, and never draw that board ═══════
log "--- [1] opening the FULL-SCREEN team scene while the disk holds ANOTHER session's board"
keys "/mpd team" Enter
wait_marker 'task dependency graph|no team in this session' 90 && log "scene rendered" || log "scene marker NOT seen in 90s"
sleep 4; cap "S1-scene-other-session"
log "S1 team line : $(team_line S1-scene-other-session)"
log "S1 other-name: $(grep -ac 'OTHERBOARD' "$OUT/S1-scene-other-session.txt" || true) occurrence(s)"
log "S1 marker    : $(grep -ac 'no team in this session' "$OUT/S1-scene-other-session.txt" || true) occurrence(s)"
keys Escape; sleep 2

log "--- [2] opening the SIDEBAR page in the same session, no key press from here on"
keys "/mpd panel" Enter
wait_marker 'view (boxes|list|rail)|no team in this session' 90 && log "panel rendered" || log "panel marker NOT seen in 90s"
sleep 4; cap "P1-sidebar-other-session"
log "P1 other-name: $(grep -ac 'OTHERBOARD' "$OUT/P1-sidebar-other-session.txt" || true) occurrence(s)"
log "P1 marker    : $(grep -ac 'no team in this session' "$OUT/P1-sidebar-other-session.txt" || true) occurrence(s)"

# ══ STEP 2 · THE LIVE SESSION'S OWN ID, from the harness's own session store ══════════════════════
# `<DSH_HOME>/sessions/<projectKey(workspace)>/<sessionId>/` — the directory NAME is the session id.
SESS_DIR="$(find "$SB/dshhome/sessions" -mindepth 2 -maxdepth 2 -type d -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -1 | cut -d' ' -f2-)"
LIVE_ID="$(basename "${SESS_DIR:-none}")"
log "live session id discovered from the session store: '$LIVE_ID' (dir=$SESS_DIR)"
printf '%s\n' "$LIVE_ID" >"$OUT/live-session-id.txt"
if [ "$LIVE_ID" = "none" ] || [ -z "$LIVE_ID" ]; then log "FATAL: no live session id"; cap "no-session-id"; tmux -S "$SOCK" kill-server 2>/dev/null; exit 1; fi

# ══ STEP 3 · THE PUSH: bind a board to THIS session while the panel is open and untouched ═════════
log "--- [3] seeding the LIVE session's own board (mode=live) — NO KEY PRESS from here"
T0="$(date -u +%s%3N)"
log "seed LIVE: $(node "$OUT/seed.mjs" "$WS" "$LIVE_ID" team-live-session LIVEBOARD 0)"
# Poll for the marker as fast as the capture allows; the FIRST capture carrying it is the measurement.
HIT_AT=""; tries=0
while [ "$tries" -lt 200 ]; do
  tries=$((tries+1))
  if pane_joined | grep -q 'LIVEBOARD'; then HIT_AT="$(date -u +%s%3N)"; break; fi
  sleep 0.02
done
if [ -n "$HIT_AT" ]; then
  log "PUSH LATENCY (live board): $(( HIT_AT - T0 ))ms  (write@${T0}ms seen@${HIT_AT}ms, tries=$tries)"
  printf '%s\n' "$(( HIT_AT - T0 ))" >"$OUT/latency-live-board.ms"
else
  log "PUSH LATENCY (live board): MARKER NEVER SEEN after $tries captures"
  printf '%s\n' "never" >"$OUT/latency-live-board.ms"
fi
sleep 1; cap "P2-sidebar-live-session"
log "P2 team line  : $(team_line P2-sidebar-live-session)"
log "P2 other-name : $(grep -ac 'OTHERBOARD' "$OUT/P2-sidebar-live-session.txt" || true) occurrence(s)"

# ══ STEP 4 · THE PUSH ON A CONTENT CHANGE of the SAME record ══════════════════════════════════════
log "--- [4] rewriting the SAME record for the SAME session under the open panel (mode=rewrite)"
T2="$(date -u +%s%3N)"
log "seed LIVE v2: $(node "$OUT/seed.mjs" "$WS" "$LIVE_ID" team-live-session LIVEBOARD2 1)"
HIT2=""; tries2=0
while [ "$tries2" -lt 200 ]; do
  tries2=$((tries2+1))
  if pane_joined | grep -q 'LIVEBOARD2'; then HIT2="$(date -u +%s%3N)"; break; fi
  sleep 0.02
done
if [ -n "$HIT2" ]; then
  log "PUSH LATENCY (content rewrite): $(( HIT2 - T2 ))ms  (write@${T2}ms seen@${HIT2}ms, tries=$tries2)"
  printf '%s\n' "$(( HIT2 - T2 ))" >"$OUT/latency-content-rewrite.ms"
else
  log "PUSH LATENCY (content rewrite): MARKER NEVER SEEN after $tries2 captures"
  printf '%s\n' "never" >"$OUT/latency-content-rewrite.ms"
fi
sleep 1; cap "P3-sidebar-live-v2"
log "P3 team line  : $(team_line P3-sidebar-live-v2)"
{ frame_diff P2-sidebar-live-session P3-sidebar-live-v2; } | tee "$OUT/P-push-diff.txt"

# ══ STEP 5 · THE FULL-SCREEN SCENE, now bound to THIS session ═════════════════════════════════════
keys Escape; sleep 2
log "--- [5] re-opening the full-screen scene for the CALLING session"
keys "/mpd team" Enter
wait_marker 'task dependency graph' 90 && log "scene rendered" || log "scene NOT rendered in 90s"
sleep 3; cap "S2-scene-live-session"
log "S2 team line  : $(team_line S2-scene-live-session)"
log "S2 other-name : $(grep -ac 'OTHERBOARD' "$OUT/S2-scene-live-session.txt" || true) occurrence(s)"

# ── the final record state and the census ─────────────────────────────────────────────────────────
log "records on disk: $(ls "$WS/.mpd/team/teams" | tr '\n' ' ')"
log "index: $(cat "$WS/.mpd/team/teams.json" | tr -d '\n ')"
log "=== utc-end=$(date -u +%Y-%m-%dT%H:%M:%SZ) sandbox=$SB evidence=$OUT"
printf '%s\n' "$SB" >"$OUT/sandbox-path.txt"
tmux -S "$SOCK" kill-server 2>/dev/null || true
log "tmux server stopped"
