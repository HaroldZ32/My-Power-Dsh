#!/usr/bin/env bash
# T-P3 — THE PUSH LATENCY, measured on the REAL PTY with a clock that can actually resolve it.
#
# WHY THIS IS A SECOND RUN. The first PTY arm (`../pty/run-pty.sh`, preserved as-is) measured with
# `date -u +%s%3N` and produced 517 ms and then NEGATIVE 343 ms — a clock that runs BACKWARDS. The
# cause is measured, not guessed: this box's `date` is uutils coreutils 0.10.0, whose `%3N` is not
# offset by the fractional second, so two calls inside one second are unordered. Every figure from that
# run's latency lines is therefore VOID, and this script replaces it.
#
# THE CLOCK HERE IS BASH'S OWN `$EPOCHREALTIME` (microseconds, no process spawn). The poll is a grep of
# the pane's stream file written by `tmux pipe-pane`, so a sample costs a few milliseconds instead of a
# whole `tmux capture-pane` — which is what made the first run's resolution ~170 ms.
#
# The board is REWRITTEN, never re-bound: same workspace, same session, same team id, a new team NAME
# each trial, so the only thing that changes is the record's contents. No key is pressed after the
# panel opens, and each trial's write and its first appearance are both stamped.
set -uo pipefail

REPO=/home/haroldzhao/MyProj/DshProj/My-Power-Dsh
EVID="$REPO/evidence/tui/session-scope-and-push/2026-10-08T08-22-12Z"
OUT="$EVID/pty-latency"
mkdir -p "$OUT"
exec > >(tee -a "$OUT/run.log") 2>&1

log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
# MICROSECONDS from bash's own clock, as an integer: printed with the dot removed, so no process is
# spawned per sample and the value is comparable by arithmetic.
now_us() { printf '%s' "${EPOCHREALTIME/./}"; }
log "=== T-P3 latency arm utc-start=$(date -u +%Y-%m-%dT%H:%M:%SZ) clock=EPOCHREALTIME bash=$BASH_VERSION"

SB="$(mktemp -d /tmp/mpd-lat-XXXXXX)"
SOCK="/tmp/tui-lat.sock"; SESS=tui-lat; COLS=140; ROWS=44
WS="$SB/ws"
mkdir -p "$SB/dshhome/profiles" "$SB/home" "$WS" "$SB/npm-cache" "$SB/pnpm-home" "$SB/config" "$SB/data"
cp -a "$HOME/.dsh/profiles/dsh-tui" "$SB/dshhome/profiles/dsh-tui"
ln -sfn "$REPO" "$SB/dshhome/profiles/dsh-tui/node_modules/@mpd-dsh/mpd"
cp "$HOME/.dsh/.credentials.yaml" "$SB/dshhome/.credentials.yaml" 2>/dev/null || true
cp "$HOME/.dsh/.anonymous-user-id" "$SB/dshhome/.anonymous-user-id" 2>/dev/null || true
mkdir -p "$SB/home/.dsh-tui"
printf '{\n  "completed": true,\n  "version": 1\n}\n' >"$SB/home/.dsh-tui/onboarding.json"
printf '{\n  "preset": "mpd"\n}\n' >"$SB/home/.dsh-tui/agent-preset.json"
log "sandbox=$SB workspace=$WS host=$(node -e 'process.stdout.write(String(require(process.argv[1]).version))' "$SB/dshhome/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui/package.json")"

# The same seeder as the first arm, copied so this run is self-contained.
cp "$EVID/pty/seed.mjs" "$OUT/seed.mjs"
log "seed OTHER: $(node "$OUT/seed.mjs" "$WS" sess-other team-other-session OTHERBOARD 0)"

tmux -f /dev/null -S "$SOCK" new-session -d -s "$SESS" -x "$COLS" -y "$ROWS" -c "$WS"
STREAM="$OUT/pane-stream.log"
tmux -S "$SOCK" pipe-pane -t "$SESS" -o "cat > '$STREAM'" 2>/dev/null || true
BOOT="env -i 'PATH=$PATH' 'DSH_HOME=$SB/dshhome' 'HOME=$SB/home' 'TERM=xterm-256color' 'DSH_TUI_LANG=en' 'DSH_TUI_NO_LAUNCHPAD=1' 'DSH_TUI_WORKSPACE_TARGET=$WS' 'npm_config_cache=$SB/npm-cache' 'XDG_CONFIG_HOME=$SB/config' 'XDG_DATA_HOME=$SB/data' dsh-tui"
tmux -S "$SOCK" send-keys -t "$SESS" "$BOOT" Enter 2>/dev/null || true
keys() { tmux -S "$SOCK" send-keys -t "$SESS" "$@" 2>/dev/null || true; }
pane_joined() { tmux -S "$SOCK" capture-pane -p -J -t "$SESS" 2>/dev/null; }
cap() {
  tmux -S "$SOCK" capture-pane -p -J -t "$SESS" >"$OUT/$1.txt" 2>/dev/null
  printf '%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$OUT/$1.at"
  log "CAPTURE $1"
}

log "waiting for the chat frame ..."
waited=0
until pane_joined | grep -qE '❯|esc to interrupt' && ! pane_joined | grep -qE '跳过引导|Get started|Tell me what'; do
  [ "$waited" -ge 150 ] && { log "FATAL: no chat frame in 150s"; cap "boot-stuck"; tmux -S "$SOCK" kill-server 2>/dev/null; exit 1; }
  sleep 1; waited=$((waited+1))
done
sleep 3

log "--- opening the SIDEBAR page; NO KEY PRESS FROM HERE until the trials are done"
keys "/mpd panel" Enter
waited=0
until pane_joined | grep -qE 'view (boxes|list|rail)|no team in this session'; do
  [ "$waited" -ge 90 ] && { log "FATAL: panel did not render in 90s"; cap "panel-stuck"; tmux -S "$SOCK" kill-server 2>/dev/null; exit 1; }
  sleep 1; waited=$((waited+1))
done
sleep 3; cap "L0-panel-other-session"
log "L0 other-name occurrences: $(grep -ac 'OTHERBOARD' "$OUT/L0-panel-other-session.txt" || true)"
log "L0 marker occurrences   : $(grep -ac 'no team in this session' "$OUT/L0-panel-other-session.txt" || true)"

SESS_DIR="$(find "$SB/dshhome/sessions" -mindepth 2 -maxdepth 2 -type d -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -1 | cut -d' ' -f2-)"
LIVE_ID="$(basename "${SESS_DIR:-none}")"
printf '%s\n' "$LIVE_ID" >"$OUT/live-session-id.txt"
log "live session id: '$LIVE_ID'"
[ "$LIVE_ID" = "none" ] && { log "FATAL: no live session id"; tmux -S "$SOCK" kill-server 2>/dev/null; exit 1; }

# ── THE TRIALS ────────────────────────────────────────────────────────────────────────────────────
#
# WHY A SIZE WATCH AND NOT A CONTENT GREP (measured, and it cost a run to learn): ink writes a MINIMAL
# cell diff, so renaming `LIVEBOARD1` to `LIVEBOARD2` puts one character on the wire — the literal
# new name never appears in the stream, and a content grep reports "never seen" for a panel that
# updated instantly. Trial 1 of the first attempt is the exception that proves the rule: there the name
# went from NOTHING to `LIVEBOARD1`, so the whole word was written and the sample is exact (85 ms).
#
# SO EACH TRIAL MEASURES THE FIRST WRITE TO THE TERMINAL AFTER THE RECORD CHANGED, guarded by an IDLE
# check: a panel with no key press and no animation writes nothing, and a trial whose idle window was
# NOT quiet is reported as `polluted` rather than counted. The content assertion for every trial is a
# capture taken afterwards, which is what proves the frame really carries that trial's name.
: >"$OUT/latency.jsonl"
size_of() { stat -c %s "$STREAM" 2>/dev/null || echo 0; }
log "--- 6 rewrite trials, panel open and untouched"
for trial in 1 2 3 4 5 6; do
  NAME="LIVEBOARD${trial}"
  # IDLE GUARD: the stream must not grow for 150 ms before the change is written.
  S_BEFORE="$(size_of)"; sleep 0.15; S_IDLE="$(size_of)"
  IDLE="true"; [ "$S_BEFORE" != "$S_IDLE" ] && IDLE="false"
  T0="$(now_us)"
  SEED_OUT="$(node "$OUT/seed.mjs" "$WS" "$LIVE_ID" team-live-session "$NAME" 0 2>&1)"
  T1=""
  waited=0
  while [ "$waited" -lt 600 ]; do
    waited=$((waited+1))
    if [ "$(size_of)" -gt "$S_IDLE" ]; then T1="$(now_us)"; break; fi
    sleep 0.002
  done
  cap "L-trial${trial}"
  SEEN_NAME="$(grep -aoE 'team [A-Za-z0-9_-]+' "$OUT/L-trial${trial}.txt" | head -1)"
  if [ -n "$T1" ]; then
    LAT_US=$(( T1 - T0 ))
    log "trial $trial: $NAME first-write latency=${LAT_US}us = $(( LAT_US / 1000 ))ms (idle=$IDLE, ticks=$waited) · frame says '${SEEN_NAME}'"
    printf '{"trial":%s,"name":"%s","idle":%s,"write_us":%s,"seen_us":%s,"latency_us":%s,"latency_ms":%s,"frame_team_line":"%s"}\n' \
      "$trial" "$NAME" "$IDLE" "$T0" "$T1" "$LAT_US" "$(( LAT_US / 1000 ))" "$SEEN_NAME" >>"$OUT/latency.jsonl"
  else
    log "trial $trial: $NAME NO WRITE SEEN in 600 ticks (idle=$IDLE) · frame says '${SEEN_NAME}'"
    printf '{"trial":%s,"name":"%s","idle":%s,"latency_us":null,"frame_team_line":"%s"}\n' "$trial" "$NAME" "$IDLE" "$SEEN_NAME" >>"$OUT/latency.jsonl"
  fi
  sleep 0.4
done
cap "L1-panel-after-trials"
log "L1 team line: $(grep -aoE 'team [A-Za-z0-9_-]+[^│]*' "$OUT/L1-panel-after-trials.txt" | head -1)"

# ── THE TICK'S OWN PHASE, for the comparison the reader has to make ───────────────────────────────
# The page's fallback tick is 1000 ms. A surface that ONLY polled would show a change at a latency
# uniformly distributed over [0, 1000) ms — so a run whose every sample is far below 1000 ms is the
# argument; this line states the baseline the samples are read against.
printf '%s\n' "the page's fallback tick is DAG_PANEL_REFRESH_MS=1000 ms: a tick-only surface samples the change at a uniform latency in [0,1000) ms" >"$OUT/tick-baseline.txt"

log "records: $(ls "$WS/.mpd/team/teams" | tr '\n' ' ')"
log "=== utc-end=$(date -u +%Y-%m-%dT%H:%M:%SZ) sandbox=$SB"
printf '%s\n' "$SB" >"$OUT/sandbox-path.txt"
tmux -S "$SOCK" kill-server 2>/dev/null || true
log "tmux server stopped"
