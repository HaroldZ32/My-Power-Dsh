#!/usr/bin/env bash
# TUI lane for the Docker end-to-end client test (the DSH-TUI edition).
#
# WHY this lives in the container and not on the developer host: the TUI host must be
# installed from npm and booted on a real PTY. This machine's sandbox cannot install a
# global package outside the repository, so the ONLY place the TUI profile can be
# exercised end to end is a machine with a writable HOME — which is exactly what the
# container is.
#
# WHAT IT PROVES (each is a `record`; a `false` fails the run):
#   tui.hostInstall      the pinned TUI host installs and lands on PATH
#   tui.pluginAddHost    `dsh plugin --profile dsh-tui add <host>` succeeds
#   tui.pluginAddBundle  `dsh plugin --profile dsh-tui add .` (THIS bundle) succeeds
#   tui.compose          `dsh --profile dsh-tui --dump-config` composes
#   tui.registryDefaultMpd  the TUI's OWN scoped registry row is id-targeted to `mpd`
#                        (harness 0.1.7: a dsh-tui profile composes no dsh-web-app layer,
#                        so the web-plane target is skipped there; without the second
#                        id-target the TUI keeps `default: standard` while NOTHING in
#                        that composition declares a `standard` preset)
#   tui.presetRow        the `preset-mpd` row is composed in the TUI plane
#   tui.mpdTuiRow        the bundle's `mpd-tui` row is composed
#   tui.agentTeamRows    the three official Agent Teams rows are composed
#   tui.boot             the REAL TUI reaches its chat screen on a real PTY (tmux)
#   tui.noFatalSignatures  the pane/log carries no apply/module/preset failure
#   tui.sessionPreset    the session the TUI created records agentPreset=mpd
#
# Usage (env from the entrypoint's sandbox):
#   bash docker/tui-lane.sh
set -uo pipefail

STATE_FILE="${STATE_FILE:?}"
FACTS_FILE="${FACTS_FILE:?}"
APP_DIR="${APP_DIR:?}"
WORK_DIR="${WORK_DIR:?}"
TUI_VERSION="${TUI_VERSION:-0.11.1}"

TUI_DIR="$WORK_DIR/tui"
mkdir -p "$TUI_DIR"

json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"; s="${s//\"/\\\"}"; s="${s//$'\n'/ }"; s="${s//$'\r'/ }"; s="${s//$'\t'/ }"
  printf '%s' "$s"
}
record() {
  local name="$1" status="$2" reason="${3:-}" raw="${4:-}"
  case "$status" in true|false|null) ;; *) reason="invalid status ${status} refused; ${reason}"; status="null" ;; esac
  printf '{"name":"%s","ok":%s,"reason":"%s","raw":"%s"}\n' \
    "$(json_escape "$name")" "$status" "$(json_escape "$reason")" "$(json_escape "$raw")" >> "$STATE_FILE"
  printf '[record] %s=%s%s\n' "$name" "$status" "${reason:+ — $reason}"
}

# Every failure path must LEAVE A RECORD: a crash that writes nothing would read as "not
# reached" in the report and hide which assertion died. `on_err` restates the failing line
# and exits non-zero, and the entrypoint copies this step's own log into the evidence.
on_err() {
  local code=$?
  record tui.laneExit false "the TUI lane aborted (exit $code) — see this step's log; earlier tui.* records are the assertions that had already run" "line=${BASH_LINENO[0]:-$LINENO}"
  exit "$code"
}
trap 'on_err' ERR

# ── 1. the TUI host ────────────────────────────────────────────────────────────
npm i -g "@deepseek-harness-tui/dsh-tui@$TUI_VERSION" >"$TUI_DIR/install-host.log" 2>&1
HOST_EXIT=$?
TUI_BIN="$(command -v dsh-tui || true)"
if [ "$HOST_EXIT" = "0" ] && [ -n "$TUI_BIN" ]; then
  record tui.hostInstall true "the TUI host installs globally and lands on PATH" "version=$TUI_VERSION bin=$TUI_BIN"
else
  record tui.hostInstall false "the TUI host did not install or is not on PATH" "exit=$HOST_EXIT bin=${TUI_BIN:-none}"
fi

# ── 2. the TUI profile: host bundle, then THIS bundle as the third layer ───────
dsh plugin --profile dsh-tui add "@deepseek-harness-tui/dsh-tui@$TUI_VERSION" >"$TUI_DIR/add-host.log" 2>&1
ADD_HOST=$?
record tui.pluginAddHost "$([ "$ADD_HOST" = 0 ] && echo true || echo false)" \
  "the TUI host bundle installs into the dsh-tui profile" "exit=$ADD_HOST"

( cd "$APP_DIR" && dsh plugin --profile dsh-tui add . ) >"$TUI_DIR/add-bundle.log" 2>&1
ADD_BUNDLE=$?
record tui.pluginAddBundle "$([ "$ADD_BUNDLE" = 0 ] && echo true || echo false)" \
  "THIS bundle installs into the dsh-tui profile as the third patch layer" "exit=$ADD_BUNDLE"

# ── 3. composition (COMPOSITION ONLY — never cited as a load proof) ────────────
dsh --profile dsh-tui --dump-config >"$TUI_DIR/dump.yml" 2>"$TUI_DIR/dump.err"
DUMP_EXIT=$?
record tui.compose "$([ "$DUMP_EXIT" = 0 ] && echo true || echo false)" \
  "dsh --profile dsh-tui --dump-config composes (COMPOSITION ONLY, never a load proof)" "exit=$DUMP_EXIT"

# One row's own block, from `- id: <id>` to the next column-0 `- id:`.
row_block() { awk -v id="$1" '$0 ~ "^- id: " id "$" {f=1} f && NR>1 && /^- id: / && $0 !~ "^- id: " id "$" {exit} f' "$TUI_DIR/dump.yml"; }

REG_BLOCK="$(row_block dsh-tui-agent-preset-registry)"
if printf '%s' "$REG_BLOCK" | grep -qE '^\s+default: mpd$'; then
  record tui.registryDefaultMpd true \
    "the TUI's OWN scoped registry row is id-targeted to the mpd preset (user decision D10 on the 0.1.7 row model)" \
    "id=dsh-tui-agent-preset-registry default=mpd"
else
  record tui.registryDefaultMpd false \
    "the TUI registry row does not carry default: mpd, so a dsh-tui session would ask for a preset this composition does not declare" \
    "$(printf '%s' "$REG_BLOCK" | head -n 3 | tr '\n' ' ')"
fi

if grep -qE '^- id: preset-mpd$' "$TUI_DIR/dump.yml"; then
  record tui.presetRow true "the mpd preset row is composed in the TUI plane" "id=preset-mpd"
else
  record tui.presetRow false "the mpd preset row is MISSING from the TUI composition" "id=preset-mpd"
fi

if grep -qE '^- id: mpd-tui$' "$TUI_DIR/dump.yml"; then
  record tui.mpdTuiRow true "the bundle's mpd-tui row is composed in the TUI plane" "id=mpd-tui"
else
  record tui.mpdTuiRow false "the mpd-tui row is MISSING from the TUI composition" "id=mpd-tui"
fi

TEAM_ROWS="$(grep -cE '^- id: mpd-(agent|tool-agent|ui-agent)-team$' "$TUI_DIR/dump.yml" || true)"
if [ "${TEAM_ROWS:-0}" = "3" ]; then
  record tui.agentTeamRows true "all three official Agent Teams rows are composed in the TUI plane" "ids=mpd-agent-team,mpd-tool-agent-team,mpd-ui-agent-team"
else
  record tui.agentTeamRows false "the TUI composition carries ${TEAM_ROWS:-0} of the 3 official Agent Teams rows" "count=${TEAM_ROWS:-0}"
fi

# ── 4. the REAL boot on a real PTY ─────────────────────────────────────────────
SOCK="$TUI_DIR/tui.sock"
PANE_LOG="$TUI_DIR/pane.log"
: > "$PANE_LOG"
rm -f "$SOCK"
tmux -f /dev/null -S "$SOCK" new-session -d -s tui -x 220 -y 50 -c "$WORK_DIR/ws" 2>"$TUI_DIR/tmux.err"
TMUX_NEW=$?
tmux -S "$SOCK" pipe-pane -t tui -o "cat > '$PANE_LOG'" 2>/dev/null || true
# `dsh-tui` must be given the SANDBOX environment only: a leaked real HOME/DSH_HOME would
# make this run write state outside the container's throwaway home and prove nothing.
BOOT="env -i $(printf "'PATH=%s' 'DSH_HOME=%s' 'HOME=%s' 'TERM=xterm-256color' 'DSH_TUI_WORKSPACE_TARGET=%s' 'npm_config_cache=%s'" \
  "$PATH" "$DSH_HOME" "$HOME" "$WORK_DIR/ws" "${npm_config_cache:-$HOME/.npm}") dsh-tui"
tmux -S "$SOCK" send-keys -t tui "$BOOT" Enter 2>/dev/null || true

READY=0
for _ in $(seq 1 60); do
  sleep 2
  PANE="$(tmux -S "$SOCK" capture-pane -p -J -t tui 2>/dev/null || true)"
  if printf '%s' "$PANE" | grep -qE '❯|esc to interrupt|按 Esc'; then READY=1; break; fi
done
sleep 4
tmux -S "$SOCK" capture-pane -p -J -t tui >"$TUI_DIR/pane-boot.txt" 2>/dev/null || true
tmux -S "$SOCK" send-keys -t tui "/quit" Enter 2>/dev/null || true
sleep 2
tmux -S "$SOCK" kill-server 2>/dev/null || true

BOOT_TEXT="$(cat "$TUI_DIR/pane-boot.txt" "$PANE_LOG" 2>/dev/null || true)"
if [ "$TMUX_NEW" = "0" ] && [ "$READY" = "1" ]; then
  record tui.boot true "the REAL TUI booted on a real PTY and reached its chat screen" "tmux=new-session-ok ready=chat-screen"
else
  record tui.boot false "the TUI did not reach its chat screen (tmux=$TMUX_NEW ready=$READY)" \
    "$(printf '%s' "$BOOT_TEXT" | tr -d '\r' | tail -c 300 | tr '\n' ' ')"
fi

if printf '%s' "$BOOT_TEXT" | grep -qiE 'failed to apply loader entry|Cannot find module|agent-preset/invalid|not found: preset|agent/pre-step.*throw'; then
  record tui.noFatalSignatures false "the TUI boot carries a fatal apply/module/preset signature" \
    "$(printf '%s' "$BOOT_TEXT" | grep -inE 'failed to apply loader entry|Cannot find module|agent-preset/invalid|not found: preset' | head -n 2 | tr '\n' ' ')"
else
  record tui.noFatalSignatures true "no fatal apply/module/preset signature in the TUI pane or log" "scanned=pane+pane-log"
fi

# ── 5. what the harness RECORDED, not what the pane said ──────────────────────
# The session store is proof of which preset the TUI actually ran; the pane is narration.
PROBE="$TUI_DIR/store-probe.mjs"
cat > "$PROBE" <<'PROBE_EOF'
// Which preset did the TUI session ACTUALLY run? Read from the harness's own store, never
// from the pane: the record is ground truth, the pane is narration (AGENTS.md §7).
import { readdirSync, existsSync, statSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const [appDir, dshHome] = process.argv.slice(2)
const out = (value) => { console.log(JSON.stringify(value)); process.exit(0) }
try {
  const lib = await import(pathToFileURL(join(appDir, "skills", "dsh-qa", "scripts", "lib", "session-evidence.mjs")).href)
  const root = join(dshHome, "sessions")
  if (!existsSync(root)) out({ found: false, reason: "no session store at " + root })
  let newest = null
  for (const key of readdirSync(root)) {
    const dir = join(root, key)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    for (const id of readdirSync(dir)) {
      const p = join(dir, id)
      try { if (!statSync(p).isDirectory()) continue } catch { continue }
      for (const f of readdirSync(p)) {
        if (!f.startsWith("session.v") || !f.endsWith(".zstd")) continue
        const file = join(p, f)
        const m = statSync(file).mtimeMs
        if (newest === null || m > newest.m) newest = { file, m, id }
      }
    }
  }
  if (newest === null) out({ found: false, reason: "no session.v*.zstd record under " + root })
  let text = ""
  try { text = lib.decodeSessionLog(newest.file).text } catch (error) { out({ found: false, reason: "decode failed: " + String(error?.message ?? error), file: newest.file }) }
  const m = /"agentPreset"\s*:\s*"([^"]*)"/.exec(text)
  out({ found: true, sessionId: newest.id, agentPreset: m === null ? "(absent)" : m[1], bytes: text.length })
} catch (error) {
  out({ found: false, reason: "probe failed: " + String(error?.stack ?? error?.message ?? error) })
}
PROBE_EOF
PRESET_JSON="$(node "$PROBE" "$APP_DIR" "$DSH_HOME" 2>"$TUI_DIR/store.err" || true)"
if [ -z "$PRESET_JSON" ]; then
  PROBE_ERR="$(head -c 300 "$TUI_DIR/store.err" 2>/dev/null | tr '\n' ' ' | tr -d '"\\')"
  PRESET_JSON="{\"found\":false,\"reason\":\"the store probe produced no output; stderr: ${PROBE_ERR}\"}"
fi

if printf '%s' "$PRESET_JSON" | grep -q '"agentPreset":"mpd"'; then
  record tui.sessionPreset true "the session the TUI created records agentPreset=mpd (the D10 default, read from the harness's own store)" "$PRESET_JSON"
else
  record tui.sessionPreset false "the TUI session record does not carry agentPreset=mpd" "$PRESET_JSON"
fi

# Summarise: every tui.* record this lane owns, so the run cannot end without a verdict.
# ONE awk pass, deliberately: `grep -c` PRINTS its count and EXITS 1 when there is no match,
# so `$(grep -c … || echo 0)` captured "0\n0" and the comparison below could never be true
# (measured 2026-09-27: all eleven assertions green and the lane still reported laneExit=false).
TUI_SUMMARY="$(awk '/"name":"tui\./ { total++; if ($0 ~ /"ok":false/) bad++ } END { printf "%d %d", total, bad }' "$STATE_FILE" 2>/dev/null || echo "0 0")"
TUI_TOTAL="${TUI_SUMMARY%% *}"
TUI_BAD="${TUI_SUMMARY##* }"
if [ "${TUI_BAD:-0}" = "0" ] && [ "${TUI_TOTAL:-0}" -ge 11 ]; then
  record tui.laneExit true "the TUI lane ran to completion with every assertion green" "records=$TUI_TOTAL"
  exit 0
fi
record tui.laneExit false "the TUI lane finished with failing or missing assertions" "records=$TUI_TOTAL failed=$TUI_BAD"
exit 1
