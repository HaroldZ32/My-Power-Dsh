#!/usr/bin/env bash
# run.sh <attempt-name> [mode] — boot the REAL dsh-tui 0.14.0 on a tmux PTY inside a full sandbox
# (DSH_HOME / HOME / workspace all under this call's private /tmp), seed an MPD team record, open the
# MPD sidebar page and the full-screen team scene, and test whether either one refreshes when the team
# record changes on disk with NO key press.
#
# WHY THE WHOLE LIFECYCLE IS ONE BASH CALL: this harness gives every bash invocation a FRESH /tmp, so
# the sandbox, the tmux server and the captures cannot outlive the call. Evidence is written under the
# repo's evidence/ tree, which does persist.
#
# MODE: probe = boot + capture the two surfaces once (learn the markers); full = the refresh test.
set -uo pipefail

REPO=/home/haroldzhao/MyProj/DshProj/My-Power-Dsh
EVID="$REPO/evidence/tui/live-refresh/2026-10-08T07-32-09Z"
ATTEMPT="${1:-probe}"
MODE="${2:-full}"
OUT="$EVID/$ATTEMPT"
mkdir -p "$OUT"
LOG="$OUT/run.log"
exec > >(tee -a "$LOG") 2>&1

log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }

STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
log "=== attempt=$ATTEMPT mode=$MODE utc-start=$STAMP"

SB="$(mktemp -d /tmp/mpd-lr-XXXXXX)"
SOCK="/tmp/tui.sock"
SESS=tui
COLS=220
ROWS=50
log "sandbox=$SB"

# ── 1. sandbox home + profile ─────────────────────────────────────────────────
mkdir -p "$SB/dshhome/profiles" "$SB/home" "$SB/ws" "$SB/npm-cache" "$SB/pnpm-home" "$SB/config" "$SB/data" "$SB/scratch"
cp -a "$HOME/.dsh/profiles/dsh-tui" "$SB/dshhome/profiles/dsh-tui"
# The profile's `link:` dependency is RELATIVE and breaks at the sandbox depth, so it is re-pointed at
# the checkout. This is the ONLY sandbox edit to the copied profile.
ln -sfn "$REPO" "$SB/dshhome/profiles/dsh-tui/node_modules/@mpd-dsh/mpd"
# Credentials are copied into the sandbox once (never read back out, never echoed): a boot that demands
# them must not die before the surfaces render. No model turn is made in this run.
cp "$HOME/.dsh/.credentials.yaml" "$SB/dshhome/.credentials.yaml" 2>/dev/null || true
cp "$HOME/.dsh/.anonymous-user-id" "$SB/dshhome/.anonymous-user-id" 2>/dev/null || true
# The two host preference files a scripted dsh-tui boot needs (first-run wizard + agent preset).
mkdir -p "$SB/home/.dsh-tui"
printf '{\n  "completed": true,\n  "version": 1\n}\n' >"$SB/home/.dsh-tui/onboarding.json"
printf '{\n  "preset": "mpd"\n}\n' >"$SB/home/.dsh-tui/agent-preset.json"
HOSTVER="$(node -e 'process.stdout.write(String(require(process.argv[1]).version))' "$SB/dshhome/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui/package.json")"
log "sandbox host dsh-tui version=$HOSTVER  mpd link -> $(readlink -f "$SB/dshhome/profiles/dsh-tui/node_modules/@mpd-dsh/mpd")"
log "sandbox profile patch (sidePanel):"; sed -n '/sidePanel/,$p' "$SB/dshhome/profiles/dsh-tui/cordis.patch.yml" | sed 's/^/    /'

# ── 2. the team record fixture ────────────────────────────────────────────────
TEAMID="team-2026-10-05T22-30-00.000Z"
if node "$REPO/docker/ui/team-fixture.mts" "sess-live-refresh" "$SB/ws" normal >"$OUT/fixture-seed.log" 2>&1; then
  log "fixture: $(cat "$OUT/fixture-seed.log")"
else
  log "FIXTURE FAILED — see $OUT/fixture-seed.log"; cat "$OUT/fixture-seed.log"
fi
TEAMFILE="$SB/ws/.mpd/team/teams/$TEAMID.json"
[ -s "$TEAMFILE" ] && log "record written: $TEAMFILE ($(wc -c <"$TEAMFILE") bytes)" || log "RECORD MISSING"
node -e '
const fs=require("node:fs");const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
process.stdout.write("board="+r.tasks.map(t=>t.id+":"+t.status+(t.blockedBy.length?"(<-"+t.blockedBy.join(",")+")":"")).join(" ")+"\n")' "$TEAMFILE" | tee "$OUT/fixture-board.txt"

# ── 3. the mutation tool ──────────────────────────────────────────────────────
cat >"$OUT/mutate.mjs" <<'MUT_EOF'
// Mutate the seeded team record IN PLACE: flip statuses and append a task, so the drawn board and the
// mode line's task count must both change. Usage: node mutate.mjs <record.json> <mode>
import { readFileSync, writeFileSync } from "node:fs"
const [file, mode] = process.argv.slice(2)
const record = JSON.parse(readFileSync(file, "utf8"))
const byId = new Map(record.tasks.map((t) => [t.id, t]))
const now = new Date().toISOString()
const flip = (id, status, extra = {}) => {
  const task = byId.get(id)
  if (task === undefined) throw new Error(`no task ${id}`)
  task.status = status
  task.updatedAt = now
  task.revision = (task.revision ?? 1) + 1
  Object.assign(task, extra)
}
const append = (id, subject, opts = {}) => {
  record.tasks.push({
    id, subject, description: `Acceptance: ${subject}`, kind: opts.kind ?? "work", status: opts.status ?? "pending",
    blockedBy: opts.blockedBy ?? [], writeScopes: [], createdAt: now, updatedAt: now, revision: 1, ...(opts.owner ? { owner: opts.owner } : {}),
  })
}
if (mode === "bump1") {
  flip("T4", "completed", { round: 1, verdict: "pass" })
  flip("T6", "in_progress", { owner: "web-team-gui" })
  append("T7", "LiveProbe: appended by the refresh test (phase 1)", { blockedBy: ["T6"], owner: "ui-reviewer" })
} else if (mode === "bump2") {
  flip("T2", "completed")
  flip("T4", "pending")
  append("T8", "LiveProbe: appended by the refresh test (phase 2)", { blockedBy: ["T7"], kind: "integration" })
} else {
  throw new Error(`unknown mode ${mode}`)
}
writeFileSync(file, JSON.stringify(record, null, 2))
process.stdout.write(`${mode}: tasks=${record.tasks.length} statuses=${record.tasks.map((t) => t.id + ":" + t.status).join(" ")}\n`)
MUT_EOF

# ── 4. tmux boot ──────────────────────────────────────────────────────────────
tmux -f /dev/null -S "$SOCK" new-session -d -s "$SESS" -x "$COLS" -y "$ROWS" -c "$SB/ws" 2>"$OUT/tmux.err" || log "tmux new-session FAILED: $(cat "$OUT/tmux.err")"
tmux -S "$SOCK" pipe-pane -t "$SESS" -o "cat > '$OUT/pane-stream.log'" 2>/dev/null || true
BOOT="env -i 'PATH=$PATH' 'DSH_HOME=$SB/dshhome' 'HOME=$SB/home' 'TERM=xterm-256color' 'DSH_TUI_LANG=en' 'DSH_TUI_NO_LAUNCHPAD=1' 'DSH_TUI_WORKSPACE_TARGET=$SB/ws' 'npm_config_cache=$SB/npm-cache' 'XDG_CONFIG_HOME=$SB/config' 'XDG_DATA_HOME=$SB/data' dsh-tui"
log "boot: $BOOT"
tmux -S "$SOCK" send-keys -t "$SESS" "$BOOT" Enter 2>/dev/null || log "send-keys FAILED"

keys() { tmux -S "$SOCK" send-keys -t "$SESS" "$@" 2>/dev/null || true; }
pane_joined() { tmux -S "$SOCK" capture-pane -p -J -t "$SESS" 2>/dev/null; }
pane_rows() { tmux -S "$SOCK" capture-pane -p -t "$SESS" 2>/dev/null; }
pane_ansi() { tmux -S "$SOCK" capture-pane -e -p -J -t "$SESS" 2>/dev/null; }
GRID="$(tmux -S "$SOCK" display -p -t "$SESS" '#{pane_width}x#{pane_height}' 2>/dev/null || echo unknown)"
log "tmux grid reported: $GRID"
printf '%s\n' "$GRID" >"$OUT/grid.txt"

# Wait for a chat frame (the launchpad and the first-run wizard draw the SAME glyph, so both are excluded).
CHAT_RE='❯|esc to interrupt'
wait_chat() {
  local waited=0
  while [ "$waited" -lt "${1:-120}" ]; do
    local p; p="$(pane_joined)"
    if printf '%s' "$p" | grep -qE "$CHAT_RE" && ! printf '%s' "$p" | grep -qE '跳过引导|说点什么|Get started|Tell me what|Esc 跳出引导'; then
      return 0
    fi
    sleep 1; waited=$((waited + 1))
  done
  return 1
}

# One capture set: raw ANSI + plain text + a timestamp.
cap() {
  local name="$1"
  local at; at="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
  pane_ansi >"$OUT/$name.ansi"
  pane_joined >"$OUT/$name.txt"
  printf '%s\n' "$at" >"$OUT/$name.at"
  log "captured $name at $at ($(wc -c <"$OUT/$name.txt") bytes text, $(wc -c <"$OUT/$name.ansi") bytes ansi)"
}
# Wait for a marker regex on the joined pane; returns 0 on hit.
wait_marker() {
  local pattern="$1" timeout="${2:-60}" waited=0
  while [ "$waited" -lt "$timeout" ]; do
    if pane_joined | grep -qE "$pattern"; then return 0; fi
    sleep 1; waited=$((waited + 1))
  done
  return 1
}
# The pane line matching a pattern (trimmed) — the quote for the report.
line_of() { pane_joined | grep -E "$1" | head -1 | sed 's/[[:space:]]*$//'; }

log "waiting for the chat frame ..."
if ! wait_chat 150; then
  log "FATAL: no chat frame within 150s"; cap "boot-stuck"; tmux -S "$SOCK" kill-server 2>/dev/null; exit 1
fi
sleep 3
cap "00-chat"
log "chat frame reached; boot markers:"
grep -aoE 'dsh-TUI  v[0-9.]+|preset[^ ]*|mpd: [^|]*' "$OUT/00-chat.txt" | head -5 | sed 's/^/    /'

# ── 5. SURFACE A: the MPD sidebar page ───────────────────────────────────────
keys Escape; sleep 1
log '--- opening the sidebar page: /mpd panel'
keys "/mpd panel" Enter
if wait_marker 'view (boxes|list|rail)' 60; then
  log "sidebar mode line seen"
else
  log "no 'view <mode>' line within 60s; capturing anyway"
fi
sleep 4
cap "A1-sidebar-open"
log "A1 mode line: $(line_of 'view (boxes|list|rail)')"
log "A1 panel-bar candidates:"; grep -aE 'MPD|❖|⬢' "$OUT/A1-sidebar-open.txt" | head -5 | sed 's/^/    /'

if [ "$MODE" = "probe" ]; then
  log "probe mode: closing down after the sidebar capture"
else
  # ── 6. THE REFRESH TEST, sidebar: NO key press from here to the last capture ──
  log "mutating the record (bump1) with NO key press sent"
  MUT="$(node "$OUT/mutate.mjs" "$TEAMFILE" bump1)"; log "mutation: $MUT"
  T0="$(date -u +%s%3N)"
  sleep 2; cap "A2-sidebar-plus2s"; log "  +$(( $(date -u +%s%3N) - T0 ))ms"
  sleep 2; cap "A3-sidebar-plus4s"; log "  +$(( $(date -u +%s%3N) - T0 ))ms"
  sleep 4; cap "A4-sidebar-plus8s"; log "  +$(( $(date -u +%s%3N) - T0 ))ms"
  for f in A1-sidebar-open A2-sidebar-plus2s A3-sidebar-plus4s A4-sidebar-plus8s; do
    log "  $f mode line: $(grep -aE 'view (boxes|list|rail)' "$OUT/$f.txt" | head -1 | sed 's/^[[:space:]]*//')"
  done
fi

# ── 7. SURFACE B: the full-screen team scene ─────────────────────────────────
keys Escape; sleep 1
log "--- opening the full-screen scene: /mpd team"
keys "/mpd team" Enter
if wait_marker 'task dependency graph' 60; then log "scene marker 'task dependency graph' seen"; else log "scene marker NOT seen within 60s"; fi
sleep 3
cap "B1-scene-open"
log "B1 scene header: $(line_of 'task dependency graph')"

if [ "$MODE" != "probe" ]; then
  log "mutating the record (bump2) with NO key press sent"
  MUT2="$(node "$OUT/mutate.mjs" "$TEAMFILE" bump2)"; log "mutation: $MUT2"
  T1="$(date -u +%s%3N)"
  sleep 2; cap "B2-scene-plus2s"; log "  +$(( $(date -u +%s%3N) - T1 ))ms"
  sleep 2; cap "B3-scene-plus4s"; log "  +$(( $(date -u +%s%3N) - T1 ))ms"
  sleep 4; cap "B4-scene-plus8s"; log "  +$(( $(date -u +%s%3N) - T1 ))ms"
  for f in B1-scene-open B2-scene-plus2s B3-scene-plus4s B4-scene-plus8s; do
    log "  $f header: $(grep -aE 'task dependency graph' "$OUT/$f.txt" | head -1 | sed 's/^[[:space:]]*//')"
  done
fi

# ── 8. what the surfaces drew (box glyph census per frame) ───────────────────
census() {
  local file="$1"
  node -e '
const fs=require("node:fs");const s=fs.readFileSync(process.argv[1],"utf8");
const count=(re)=>(s.match(re)??[]).length;
process.stdout.write(JSON.stringify({roundedTL:count(/╭/g),roundedTR:count(/╮/g),roundedBL:count(/╰/g),roundedBR:count(/╯/g),squareTL:count(/┌/g),squareBL:count(/└/g),railGlyphs:count(/[│┃]/g),tee:count(/[├┤]/g),arrowR:count(/[▸▶→]/g),hasDenseTag:s.includes("(dense)"),hasRailTag:s.includes("graph (rail)"),hasBoxesTag:s.includes("view boxes"),hasListTag:s.includes("view list"),hasRailViewTag:s.includes("view rail")})+"\n")' "$file"
}
for f in "$OUT"/*.txt; do
  case "$f" in *00-chat*|*boot-stuck*) continue;; esac
  [ -s "$f" ] && printf 'CENSUS %s %s\n' "$(basename "$f")" "$(census "$f")"
done | tee "$OUT/census.txt"

log "record now: $(node -e 'const fs=require("node:fs");const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(r.tasks.map(t=>t.id+":"+t.status).join(" "))' "$TEAMFILE")"
log "=== utc-end=$(date -u +%Y-%m-%dT%H:%M:%SZ) sandbox=$SB evidence=$OUT"
cp -f "$SB/ws/.mpd/team/teams/$TEAMID.json" "$OUT/record-final.json" 2>/dev/null || true
tmux -S "$SOCK" kill-server 2>/dev/null || true
log "tmux server stopped"
