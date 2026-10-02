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
#   tui.presetPreference  the DOCUMENTED USER path is performed and witnessed: the dsh-tui preference
#                        file (`<HOME>/.dsh-tui/agent-preset.json`) is written byte-exactly — against
#                        the INSTALLED writer's own output when it is reachable — and the host
#                        `dsh-tui-agent-preset-registry` row stays UNTOUCHED by the bundle (strict
#                        zero-override: the bundle id-targets no host row any more)
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
# Same default as docker/entrypoint.sh, and for the same reason: 0.12.0 is the dsh-tui release whose
# peer ranges cover the whole band this lane runs (up to and including 0.2.0-rc.2), while 0.11.2 stopped
# at 0.2.0-rc.1 and is REFUSED against a 0.2.0-rc.2 harness. Keep the two in step.
TUI_VERSION="${TUI_VERSION:-0.12.0}"

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
# ── THE USER-LEVEL PRESET PREFERENCE (the channel that REPLACED the removed override) ──────────
# The bundle used to id-target this host row with `config.default: mpd`. That override is GONE by
# design (strict zero-override, user decision 2026-10-02): a deployment default is the USER's to
# choose, and dsh-tui's own persisted preference is that channel. This lane therefore PERFORMS the
# documented user path BEFORE the TUI process starts, and `tui.sessionPreset` further down proves it
# is what made the session resolve `mpd` — nothing else selects a preset here.
#
# THE BYTES ARE THE CONTRACT, not an invention: dsh-tui's `lib/types/presetPrefs.js` persists
# `JSON.stringify({ preset }, null, 2)` — two-space JSON, NO trailing newline — into
# `<HOME>/.dsh-tui/agent-preset.json` (docs/preset-default.md, "The exact file format"). Two
# INDEPENDENT readers witness the written file: its hex (a literal the writer never produces by
# itself) and, when the installed dsh-tui is reachable, that writer's OWN output in a scratch dir.
TUI_PREF_DIR="$HOME/.dsh-tui"
TUI_PREF="$TUI_PREF_DIR/agent-preset.json"
PREF_EXPECTED_HEX="7b0a202022707265736574223a20226d7064220a7d"
PREF_WRITER="the installed dsh-tui writer was NOT reachable — the literal byte contract was used"
PREF_PARITY="not compared"
mkdir -p "$TUI_PREF_DIR"
printf '{\n  "preset": "mpd"\n}' >"$TUI_PREF"
PREF_HEX="$(od -An -tx1 "$TUI_PREF" 2>/dev/null | tr -d ' \n' || true)"
PREF_WRITER_MODULE="$(find -L "$DSH_HOME/profiles" -path '*/@deepseek-harness-tui/dsh-tui/lib/types/presetPrefs.js' -print -quit 2>/dev/null || true)"
if [ -n "$PREF_WRITER_MODULE" ] && [ -f "$PREF_WRITER_MODULE" ]; then
  PREF_WRITER_DIR="$TUI_DIR/preset-pref-writer"
  # The installed writer is pointed at a scratch data dir; ITS bytes are then compared with the file
  # this lane wrote, so a shape that drifted inside dsh-tui itself reddens THIS arm instead of passing.
  node --input-type=module -e '
    import { pathToFileURL } from "node:url"
    const [modulePath, dir] = process.argv.slice(1)
    const mod = await import(pathToFileURL(modulePath).href)
    if (typeof mod.writePresetPref !== "function") { console.error("writePresetPref absent"); process.exit(1) }
    if (mod.writePresetPref("mpd", dir) !== true) { console.error("writePresetPref refused"); process.exit(1) }
  ' "$PREF_WRITER_MODULE" "$PREF_WRITER_DIR" >"$TUI_DIR/preset-pref-writer.log" 2>&1 || true
  if [ -f "$PREF_WRITER_DIR/agent-preset.json" ]; then
    PREF_WRITER="dsh-tui@$TUI_VERSION lib/types/presetPrefs.js#writePresetPref"
    if cmp -s "$PREF_WRITER_DIR/agent-preset.json" "$TUI_PREF"; then PREF_PARITY="identical"; else PREF_PARITY="DIFFERS"; fi
  else
    PREF_WRITER="the installed dsh-tui writer was found but refused (see 12-tui step log)"
  fi
fi
# (a) THE HOST ROW IS UNTOUCHED BY THE BUNDLE. The host's OWN dsh-tui patch declares this row with
# `config.default: standard` (its cordis.patch.yml, "0.1.7 replaces directory discovery"), and the
# bundle must not replace that decision — which is exactly what the removed id-target did when it
# forced `mpd` here. So the subject is NOT "the row has no default" (the host's one is expected and
# must survive) but "the row does not carry the bundle's `mpd`": witness 1 is the composed row, and
# witness 2 is the SHIPPED layers of the INSTALLED bundle, which must name the id nowhere as a
# column-0 id-target (an `insert:` child may reuse an id; a column-0 `- id:` is an override).
TUI_BUNDLE_DIR="$DSH_HOME/profiles/dsh-tui/node_modules/@mpd-dsh/mpd"
REG_DEFAULT_MPD="$(printf '%s' "$REG_BLOCK" | grep -cE 'default[":[:space:]]*"?mpd' 2>/dev/null || true)"
REG_DEFAULT_ACTUAL="$(printf '%s' "$REG_BLOCK" | grep -m1 -oE 'default[":[:space:]]*"?[A-Za-z0-9_-]+' 2>/dev/null | sed -E 's/.*default[":[:space:]]*"?//' || true)"
REG_ID_TARGETS="$(grep -nE '^- id: dsh-tui-agent-preset-registry$' "$TUI_BUNDLE_DIR/cordis.patch.yml" "$TUI_BUNDLE_DIR/presets/mpd.patch.yml" 2>/dev/null | tr '\n' ';' || true)"
TUI_BUNDLE_LAYERS=0
for layer in cordis.patch.yml presets/mpd.patch.yml; do
  if [ -f "$TUI_BUNDLE_DIR/$layer" ]; then TUI_BUNDLE_LAYERS=$((TUI_BUNDLE_LAYERS + 1)); fi
done
if [ "$PREF_HEX" = "$PREF_EXPECTED_HEX" ] && [ "$PREF_PARITY" != "DIFFERS" ] && [ "${REG_DEFAULT_MPD:-1}" = "0" ] \
   && [ -z "$REG_ID_TARGETS" ] && [ "$TUI_BUNDLE_LAYERS" = "2" ]; then
  record tui.presetPreference true \
    "the lane performed the DOCUMENTED USER path: <HOME>/.dsh-tui/agent-preset.json written byte-exactly (21 bytes, no trailing newline) and ${PREF_WRITER} — AND the host registry row is UNTOUCHED by the bundle (its own default reads '${REG_DEFAULT_ACTUAL:-<none>}', no bundle-forced 'mpd', and the shipped layers id-target it nowhere). tui.sessionPreset is the arm that proves the preference is what resolved mpd" \
    "pref=$TUI_PREF hex=$PREF_HEX writerParity=$PREF_PARITY hostRowDefault=${REG_DEFAULT_ACTUAL:-<none>} bundleForcedMpdLines=0 shippedIdTargets=<none> layers=$TUI_BUNDLE_LAYERS/2"
else
  record tui.presetPreference false \
    "the user-level preset preference did not hold: hex=${PREF_HEX:-<unreadable>} (expected $PREF_EXPECTED_HEX) writerParity=$PREF_PARITY hostRowDefault=${REG_DEFAULT_ACTUAL:-<none>} hostRowMpdLines=${REG_DEFAULT_MPD:-?} shippedIdTargets=${REG_ID_TARGETS:-<none>} bundleLayers=${TUI_BUNDLE_LAYERS:-0}/2 bundleDir=${TUI_BUNDLE_DIR}" \
    "writer=$PREF_WRITER pref=$TUI_PREF"
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

# ── THE TEAM SCENE, on a real terminal (W3) ──────────────────────────────────
# The graph is this wave's visual centrepiece and until now only unit arms had ever drawn it: the
# arms render the component through a host DOUBLE, so no real terminal had produced a single box. The
# record is written FIRST, because a scene with no team correctly renders its empty state and proving
# that would prove nothing about the drawing.
mkdir -p "$WORK_DIR/ws/.mpd/team/teams"
cat >"$WORK_DIR/ws/.mpd/team/teams/tui-scene.json" <<'TEAMJSON'
{
  "version": 1,
  "teamId": "tui-scene",
  "name": "Scene Smoke",
  "description": "proves the graph draws on a real terminal",
  "leadSessionId": "scene-smoke",
  "phase": "active",
  "createdAt": "2026-09-30T00:00:00.000Z",
  "approvedAt": "2026-09-30T00:01:00.000Z",
  "members": [
    { "id": "m1", "name": "Senior Engineer", "description": "implements", "status": "running", "spawnedAt": "2026-09-30T00:01:00.000Z" },
    { "id": "m2", "name": "Reviewer", "description": "judges", "status": "inactive", "spawnedAt": "2026-09-30T00:01:00.000Z" }
  ],
  "tasks": [
    { "id": "T1", "subject": "freeze the contract", "description": "d", "kind": "requirement", "status": "completed", "blockedBy": [], "writeScopes": [], "owner": "Senior Engineer", "attempt": 1, "createdAt": "2026-09-30T00:01:00.000Z", "updatedAt": "2026-09-30T00:02:00.000Z", "revision": 1 },
    { "id": "T2", "subject": "build the graph", "description": "d", "kind": "work", "status": "in_progress", "blockedBy": ["T1"], "writeScopes": [], "owner": "Senior Engineer", "attempt": 1, "createdAt": "2026-09-30T00:01:00.000Z", "updatedAt": "2026-09-30T00:02:00.000Z", "revision": 1 },
    { "id": "T3", "subject": "review the graph", "description": "d", "kind": "review", "status": "pending", "blockedBy": ["T2"], "writeScopes": [], "owner": "Reviewer", "attempt": 1, "createdAt": "2026-09-30T00:01:00.000Z", "updatedAt": "2026-09-30T00:02:00.000Z", "revision": 1 }
  ],
  "nextMemberNumber": 3,
  "nextTaskNumber": 4
}
TEAMJSON
printf '{"version":1,"active":{}}' >"$WORK_DIR/ws/.mpd/team/teams.json"

tmux -S "$SOCK" send-keys -t tui "/mpd team" Enter 2>/dev/null || true
sleep 6
tmux -S "$SOCK" capture-pane -p -J -t tui >"$TUI_DIR/pane-team.txt" 2>/dev/null || true
TEAM_PANE="$(cat "$TUI_DIR/pane-team.txt" 2>/dev/null || true)"
record tui.teamSceneOpened "$(printf '%s' "$TEAM_PANE" | grep -q 'task dependency graph' && echo true || echo false)" \
  "the /mpd team scene opened on a real terminal" "chars=$(printf '%s' "$TEAM_PANE" | wc -c)"
record tui.teamGraphDrawn "$(printf '%s' "$TEAM_PANE" | grep -qE '┌.*┐' && printf '%s' "$TEAM_PANE" | grep -qE '└.*┘' && echo true || echo false)" \
  "the LAYERED BOXES were drawn: a top border, a bottom border, and the subjects inside them" "graph=boxes"
record tui.teamGraphEdges "$(printf '%s' "$TEAM_PANE" | grep -qE '┬|┴|│' && echo true || echo false)" \
  "the dependency EDGES were drawn with box-drawing junctions" "junctions=$(printf '%s' "$TEAM_PANE" | grep -coE '┬|┴|│' || echo 0)"
record tui.teamGraphContent "$(printf '%s' "$TEAM_PANE" | grep -q 'T1' && printf '%s' "$TEAM_PANE" | grep -q 'build the graph' && echo true || echo false)" \
  "the boxes carry the record's own task ids and subjects" "ids=T1 subject=build the graph"

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
PROBE="$TUI_DIR/store-probe.ts"
cat > "$PROBE" <<'PROBE_EOF'
// Which preset did the TUI session ACTUALLY run? Read from the harness's own store, never
// from the pane: the record is ground truth, the pane is narration (AGENTS.md §7).
import { readdirSync, existsSync, statSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const [appDir, dshHome] = process.argv.slice(2)
const out = (value) => { console.log(JSON.stringify(value)); process.exit(0) }
try {
  const lib = await import(pathToFileURL(join(appDir, "skills", "dsh-qa", "scripts", "lib", "session-evidence.ts")).href)
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
# The floor is the number of tui.* records this lane REALLY writes (15 since the
# R5 / zero-override update: presetPreference replaced registryDefaultMpd and the
# adapter/session-gate witnesses moved to the row log files). It is pinned so a
# record that silently disappears from the writer reddens instead of shrinking the
# lane's coverage (measured 2026-09-27: all eleven assertions green and the lane
# still reported laneExit=false — the inverse failure).
if [ "${TUI_BAD:-0}" = "0" ] && [ "${TUI_TOTAL:-0}" -ge 15 ]; then
  record tui.laneExit true "the TUI lane ran to completion with every assertion green" "records=$TUI_TOTAL"
  exit 0
fi
record tui.laneExit false "the TUI lane finished with failing or missing assertions" "records=$TUI_TOTAL failed=$TUI_BAD"
exit 1
