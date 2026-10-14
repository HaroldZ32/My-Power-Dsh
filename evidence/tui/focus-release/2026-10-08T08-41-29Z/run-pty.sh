#!/usr/bin/env bash
# THE REAL-PTY ARM (F-b + S-b) — Escape must return the keyboard to the chat, and the keyed status row
# must not present another session's team as the reader's own.
#
# THE WALK IS THE PREVIOUS LANE'S OWN RECIPE, kept so the two runs are comparable: seed a board bound to
# `sess-other`, boot a FRESH session, open the sidebar with `/mpd panel`, press Escape, then TYPE A
# COMMAND. The pre-fix walk on the same host with the same script
# (evidence/tui/session-scope-and-push/2026-10-08T08-22-12Z/pty/run.log:41-42) reads
#   [08:23:11] --- [5] re-opening the full-screen scene for the CALLING session
#   [08:24:41] scene NOT rendered in 90s
# — the typed `/mpd team` never reached the registry. This run asserts the post-fix outcome.
#
# ISOLATION IS THREE THINGS (AGENTS.md §7): DSH_HOME=<sandbox>, HOME=<sandbox>, and a SANDBOXED
# WORKSPACE the boot is pointed at. The real ~/.dsh is only ever READ, to copy the profile and the
# credentials once.
set -uo pipefail

REPO=/home/haroldzhao/MyProj/DshProj/My-Power-Dsh
EVID="$REPO/evidence/tui/focus-release/2026-10-08T08-41-29Z"
OUT="$EVID/pty"
mkdir -p "$OUT"
LOG="$OUT/run.log"
exec > >(tee -a "$LOG") 2>&1

log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
log "=== F-b/S-b real-PTY arm utc-start=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

SB="$(mktemp -d /tmp/mpd-fr-XXXXXX)"
SOCK="/tmp/tui-fr.sock"; SESS=tui-fr; COLS=140; ROWS=44
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
# The bundle the sandbox loads IS this checkout: pin the artifact the run actually exercised.
log "bundle dist sha256=$(sha256sum "$REPO/packages/mpd-tui-plugin/dist/index.js" | cut -d' ' -f1)"

# ── THE SEED: the board of a session that is NOT the one about to boot ────────────────────────────
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

tmux -f /dev/null -S "$SOCK" new-session -d -s "$SESS" -x "$COLS" -y "$ROWS" -c "$WS" || log "tmux new-session FAILED"
tmux -S "$SOCK" pipe-pane -t "$SESS" -o "cat > '$OUT/pane-stream.log'" 2>/dev/null || true
BOOT="env -i 'PATH=$PATH' 'DSH_HOME=$SB/dshhome' 'HOME=$SB/home' 'TERM=xterm-256color' 'DSH_TUI_LANG=en' 'DSH_TUI_NO_LAUNCHPAD=1' 'DSH_TUI_WORKSPACE_TARGET=$WS' 'npm_config_cache=$SB/npm-cache' 'XDG_CONFIG_HOME=$SB/config' 'XDG_DATA_HOME=$SB/data' dsh-tui"
tmux -S "$SOCK" send-keys -t "$SESS" "$BOOT" Enter 2>/dev/null || log "send-keys FAILED"

keys() { tmux -S "$SOCK" send-keys -t "$SESS" "$@" 2>/dev/null || true; }
pane_joined() { tmux -S "$SOCK" capture-pane -p -J -t "$SESS" 2>/dev/null; }
GRID="$(tmux -S "$SOCK" display -p -t "$SESS" '#{pane_width}x#{pane_height}' 2>/dev/null || echo unknown)"
log "tmux grid: $GRID"; printf '%s\n' "$GRID" >"$OUT/grid.txt"

cap() {
  local name="$1" at; at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
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
# The keyed status row, as the last line that starts with `mpd:` in a capture.
status_row() { grep -aE '^ *mpd:' "$OUT/$1.txt" | tail -1 | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'; }
# The chat composer row (`⌸ ❯ …`), which is where a typed character would appear if the CHAT had focus.
composer_row() { grep -aE '⌸ *❯' "$OUT/$1.txt" | head -1 | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'; }

log "waiting for the chat frame ..."
waited=0
until pane_joined | grep -qE '❯|esc to interrupt' && ! pane_joined | grep -qE '跳过引导|Get started|Tell me what'; do
  [ "$waited" -ge 150 ] && { log "FATAL: no chat frame in 150s"; cap "boot-stuck"; tmux -S "$SOCK" kill-server 2>/dev/null; exit 1; }
  sleep 1; waited=$((waited+1))
done
sleep 3; cap "A0-chat"

# ══ STEP 1 · THE PANEL IS OPENED: its body must deny ownership of the OTHER board, and the STATUS ROW
#            must show that same board as a workspace-level summary rather than as the reader's own ══
log "--- [1] /mpd panel (the OTHER session's board is the only one on disk)"
keys "/mpd panel" Enter
wait_marker 'view (boxes|list|rail)|no team in this session' 90 && log "panel rendered" || log "panel marker NOT seen in 90s"
sleep 4; cap "P1-panel-open"
log "P1 panel-body marker : $(grep -ac 'no team in this session' "$OUT/P1-panel-open.txt") occurrence(s)"
log "P1 status row        : $(status_row P1-panel-open)"
log "P1 status marker     : $(grep -ac '(workspace-level)' "$OUT/P1-panel-open.txt") occurrence(s) on the row"

# ══ STEP 2 · THE FOCUS PRECONDITION: a panel-handled key must be SWALLOWED while the page holds the
#            keyboard, otherwise the Escape assertion below would prove nothing ═════════════════════
log "--- [2] pressing a panel key ('j') with the page open: the composer must NOT echo it"
keys j
sleep 2; cap "P2-panel-key-j"
log "P2 composer row      : $(composer_row P2-panel-key-j)"
if composer_row P2-panel-key-j | grep -qE '❯ *j'; then
  log "P2 PRECONDITION FAILED: the composer echoed 'j' — the panel did NOT hold the keyboard"
  printf 'failed\n' >"$OUT/focus-precondition.txt"
else
  log "P2 PRECONDITION HELD: 'j' was consumed by the page; the composer is still empty"
  printf 'held\n' >"$OUT/focus-precondition.txt"
fi

# ══ STEP 3 · ESCAPE, THEN A TYPED COMMAND (F-b) ═══════════════════════════════════════════════════
# NOTHING IS PINNED, so the page must leave the press to the host, whose own fallback moves the focus
# back to the chat — and the command typed afterwards must REACH the registry.
log "--- [3] Escape with nothing pinned, then '/mpd team' typed from the composer"
keys Escape
sleep 2; cap "P3-after-escape"
log "P3 status row        : $(status_row P3-after-escape)"
# THE TWO-PART PROOF. First the KEYSTROKES must reach the CHAT COMPOSER (pre-fix they were swallowed
# and the composer stayed empty), then the COMMAND REGISTRY must answer.
keys "/mpd team"
sleep 2; cap "P3b-composer-echo"
log "P3b composer row     : $(composer_row P3b-composer-echo)"
if composer_row P3b-composer-echo | grep -q 'mpd team'; then
  log "F-b HALF 1 PASS: the typed text appears in the CHAT composer — the keyboard is back"
  printf 'ok\n' >"$OUT/composer-reached.txt"
else
  log "F-b HALF 1 FAIL: the composer did NOT echo the typed text"
  printf 'swallowed\n' >"$OUT/composer-reached.txt"
fi
TYPED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '%s\n' "$TYPED_AT" >"$OUT/typed-at.txt"
log "submitting the command @ $TYPED_AT"
keys Enter
# THE SCENE'S OWN HEADER, not the DAG's: this session has NO team of its own (the only board on disk
# belongs to `sess-other`), so the scene renders the CALLEE's session-empty state and no DAG — which is
# exactly the session-scoping repair Lane TD landed. The marker therefore names the SCENE, not the graph.
if wait_marker 'MPD team · [0-9]+x[0-9]+|task dependency graph' 45; then
  log "F-b HALF 2 PASS: the command REGISTRY answered — the full-screen scene rendered"
  printf 'ok\n' >"$OUT/command-reached.txt"
else
  log "F-b HALF 2 FAIL: no scene in 45s — the command was swallowed again"
  printf 'swallowed\n' >"$OUT/command-reached.txt"
fi
sleep 3; cap "P4-command-reached"
log "P4 scene marker      : $(grep -acE 'MPD team · [0-9]+x[0-9]+|task dependency graph' "$OUT/P4-command-reached.txt") occurrence(s)"
log "P4 other-name count  : $(grep -ac 'OTHERBOARD' "$OUT/P4-command-reached.txt") occurrence(s)"
log "P4 state-2 rows      : marker=$(grep -ac 'no team in this session' "$OUT/P4-command-reached.txt") count=$(grep -ac 'none bound to this session' "$OUT/P4-command-reached.txt") scope-token=$(grep -ac 'workspace-level' "$OUT/P4-command-reached.txt")"

# ══ STEP 4 · THE STATUS ROW'S OWN WORDS, from the command that prints the SAME sentence ═══════════
# `/mpd status` echoes the keyed row's text (plus the state mark), so it is the command-level witness
# that the row a reader sees is the marked one.
log "--- [4] Escape from the scene, then a second typed command"
keys Escape; sleep 2; cap "P5-scene-after-escape"
keys "/mpd status" Enter
if wait_marker 'mpd: team OTHERBOARD.*workspace-level' 45; then
  log "STEP 4 PASS: '/mpd status' answered with the MARKED row — the keyboard is back on the composer"
  printf 'ok\n' >"$OUT/second-command.txt"
else
  log "STEP 4: the marked '/mpd status' output was NOT seen in 45s"
  printf 'not-seen\n' >"$OUT/second-command.txt"
fi
sleep 2; cap "P6-status-command"
log "P6 status output     : $(grep -aE 'mpd: ' "$OUT/P6-status-command.txt" | tail -1 | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"

log "=== utc-end=$(date -u +%Y-%m-%dT%H:%M:%SZ) sandbox=$SB evidence=$OUT"
printf '%s\n' "$SB" >"$OUT/sandbox-path.txt"
tmux -S "$SOCK" kill-server 2>/dev/null || true
log "tmux server stopped"
