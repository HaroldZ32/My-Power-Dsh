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
#   tui.teamSceneOpened  the /mpd team scene opens on a real terminal
#   tui.teamGraphDrawn   the team DAG BOXES are drawn, one per task the record carries (the ROUNDED
#                        corner census equals that count; the square corners are the scene FRAME's)
#   tui.teamGraphEdges   the dependency edges are drawn with box-drawing junctions
#   tui.teamGraphContent every task id READ OUT OF THE LANE'S OWN RECORD is drawn as a node label (a
#                        literal id could not catch a dropped task), and the record's own subject is
#                        reachable one keystroke away in the pinned detail body clause AC1 moved it to
#   tui.mergedPanelOpens the MPD combo (alt+a / `M-a`) opens the MERGED panel: its own title, the
#                        host's subagent section, AND the team body the team-scene arm proves
#   tui.mergedPanelOrder on the CAPTURED pane, the subagent section sits ABOVE the team section
#                        (the host's empty-state line when this session has no subagent row)
#   tui.hostDashboardKeyIntact  the Ctrl+A SPLIT, both phases in ONE session: with the seeded team
#                        present Ctrl+A opens the MPD merged panel, and after the team record is
#                        REMOVED the same key no longer opens it (the hook re-reads the projection
#                        per press). An unconditional take-over fails the second phase; a take-over
#                        that never happens fails the first. The host dashboard's own title is
#                        recorded as an observation, because this container does not always render it
#   tui.noDirectTuiSeam  the wave's own D6 gate (no file outside the TUI adapter names a `ctx.tui*`
#                        seam) runs on a byte-verified copy of the INSTALLED tree — or is recorded as
#                        an unmade measurement, never as a pass
#   tui.boot             the REAL TUI reaches its chat screen on a real PTY (tmux)
#   tui.noFatalSignatures  the pane/log carries no apply/module/preset failure
#   tui.sessionPreset    the session the TUI created records agentPreset=mpd
#
# EVERY pane an assertion judges is ALSO written into the run's evidence dir (`$OUT_DIR/tui-panes/`,
# one raw text file per captured step), so a reader re-reads the exact screen instead of the verdict.
#
# Usage (env from the entrypoint's sandbox):
#   bash docker/tui-lane.sh
set -uo pipefail

STATE_FILE="${STATE_FILE:?}"
FACTS_FILE="${FACTS_FILE:?}"
APP_DIR="${APP_DIR:?}"
WORK_DIR="${WORK_DIR:?}"
# Same default as docker/entrypoint.sh, and for the same reason: 0.14.0 is the dsh-tui release this
# bundle targets, and its peer ranges still cover the whole band this lane runs (up to and including
# 0.2.0-rc.2), while 0.11.2 stopped at 0.2.0-rc.1 and is REFUSED against a 0.2.0-rc.2 harness. (0.13.0
# and 0.12.0 were the pins before it.) Keep the two in step.
TUI_VERSION="${TUI_VERSION:-0.14.0}"
# The apparatus library (docker/lib/live-verdict.ts) and the caller's live-arm switch. Both are handed
# over by docker/entrypoint.sh, which also owns the credential staging — the TUI cannot run a real
# turn without them, and a missing LIB_DIR then reddens live.tui.* instead of passing silently.
LIB_DIR="${LIB_DIR:-/opt/mpd-e2e/lib}"
LIVE="${LIVE:-0}"
LIVE_BUDGET_MS="${MPD_E2E_LIVE_BUDGET_MS:-300000}"

TUI_DIR="$WORK_DIR/tui"
mkdir -p "$TUI_DIR"
# The panes this lane asserts on are EVIDENCE, so every capture lands in the RUN's own evidence dir
# as well as in the scratch tree: the screen an assertion judged must be re-readable without
# rerunning the container. `OUT_DIR` is handed over by docker/entrypoint.sh (it is the mounted /out);
# a lane run by hand falls back to a directory beside its own scratch files.
EVIDENCE_DIR="${OUT_DIR:-$TUI_DIR}"
PANE_DIR="$EVIDENCE_DIR/tui-panes"
mkdir -p "$PANE_DIR"

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
#
# THE ERR TRAP ALONE IS NOT ENOUGH — MEASURED 2026-10-06 in this lane: a `set -u` unbound-variable
# abort (`MERGED_TITLE_HITS: unbound variable`) exited the script WITHOUT running `on_err`, so seven
# arms were reported "not reached" and the driver still printed `ok=true` (evidence
# `evidence/docker/client-install/2026-10-06T11-11-30Z`). That is a false pass, so the EXIT trap below
# is the second net: it leaves the record for any non-zero exit the ERR trap did not already record.
LANE_EXIT_RECORDED=0
on_err() {
  local code=$?
  LANE_EXIT_RECORDED=1
  record tui.laneExit false "the TUI lane aborted (exit $code) — see this step's log; earlier tui.* records are the assertions that had already run" "line=${BASH_LINENO[0]:-$LINENO}"
  exit "$code"
}
trap 'on_err' ERR
on_exit() {
  local code=$?
  if [ "$code" != "0" ] && [ "$LANE_EXIT_RECORDED" = "0" ]; then
    record tui.laneExit false "the TUI lane exited with $code without the ERR trap seeing it (an immediate abort such as a set -u unbound variable) — earlier tui.* records are the assertions that had already run, and every arm after this point reads as 'not reached'" "abort=exit-$code net=EXIT-trap"
  fi
}
trap 'on_exit' EXIT

# capture_pane <step> — snapshot the WHOLE pane (wrapped lines joined, so a row reads as one line)
# to the scratch file AND to the run's evidence dir: the captured text IS the artifact the assertions
# below judge, so it has to outlive the container. A capture that returns nothing leaves an empty
# file and the assertion reading it reddens on its own — this helper never fails the lane itself.
capture_pane() {
  local step="$1"
  tmux -S "$SOCK" capture-pane -p -J -t tui >"$TUI_DIR/pane-$step.txt" 2>/dev/null || true
  cp "$TUI_DIR/pane-$step.txt" "$PANE_DIR/pane-$step.txt" 2>/dev/null || true
}

# pane_line_of <ERE> <file> — the 1-based line of the FIRST match, or 0 when the pattern is absent,
# so a MISSING marker can never be compared as a line number and pass an order arm by accident.
pane_line_of() {
  local found
  found="$(grep -n -m1 -E "$1" "$2" 2>/dev/null | cut -d: -f1 || true)"
  printf '%s' "${found:-0}"
}

# pane_hits <ERE> <file> — how many lines match, or 0 for a missing file or no match.
# `|| true` and NOT `|| echo 0`: `grep -c` already PRINTS its count on a no-match exit, so an
# `echo 0` fallback would append a SECOND value and every numeric test below would then fail.
pane_hits() {
  local count
  count="$(grep -cE "$1" "$2" 2>/dev/null || true)"
  printf '%s' "${count:-0}"
}

# pane_glyphs <glyph> <file> — how many times ONE glyph OCCURS, or 0 for a missing file or no match.
# An OCCURRENCE count, deliberately not `pane_hits`' line count: two boxes in the SAME rank are drawn
# side by side on ONE row, so a line count would read two drawn boxes as one. `-F`, because a corner
# glyph is a character to find and never a pattern.
pane_glyphs() {
  local count
  count="$(grep -oF "$1" "$2" 2>/dev/null | wc -l || true)"
  printf '%s' "${count:-0}"
}

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
# THE 0.13.0 FIRST-RUN WIZARD, neutralised the way the HOST itself decides it. Since 0.13.0 an
# ordinary launch lands on the launchpad, and a home that has never completed setup is walked through
# the four-step first-run wizard INSTEAD of reaching a chat session. BOTH screens carry a `❯`, so a
# readiness check that only looks for a prompt is satisfied by them — measured 2026-10-06 in this very
# lane: `tui.boot` passed on the launchpad while every `/mpd …` keystroke went into its composer and
# was sent to the MODEL, so the seven surface arms failed with titleHits=0 (evidence
# `evidence/docker/client-install/2026-10-06T10-55-26Z`). The wizard's state is read from the installed
# `lib/types/onboardingPrefs.js` (it fires unless `{completed:true,version:>=1}`) and the launchpad is
# skipped by `DSH_TUI_NO_LAUNCHPAD=1` — both applied below, and both recorded in the boot capture.
printf '{\n  "completed": true,\n  "version": 1\n}\n' >"$TUI_PREF_DIR/onboarding.json"
ONBOARDING_HEX="$(od -An -tx1 "$TUI_PREF_DIR/onboarding.json" 2>/dev/null | tr -d ' \n' || true)"
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
BOOT="env -i $(printf "'PATH=%s' 'DSH_HOME=%s' 'HOME=%s' 'TERM=xterm-256color' 'DSH_TUI_WORKSPACE_TARGET=%s' 'npm_config_cache=%s' 'DSH_TUI_NO_LAUNCHPAD=%s'" \
  "$PATH" "$DSH_HOME" "$HOME" "$WORK_DIR/ws" "${npm_config_cache:-$HOME/.npm}" "1") dsh-tui"
tmux -S "$SOCK" send-keys -t tui "$BOOT" Enter 2>/dev/null || true

# READINESS IS THE CHAT SCREEN, NOT MERELY A PROMPT GLYPH. The launchpad and the first-run wizard both
# draw a `❯`, so the OLD check here (a bare `❯`) reported ready while the session was still on a
# landing screen — which is exactly how the 2026-10-06 run passed `tui.boot` and then failed every
# surface arm. A real chat frame must therefore show the composer AND carry none of the landing
# markers, and the landing markers are recorded so a future host that renames them is visible instead
# of silently returning to the old false pass.
LANDING_MARKERS='说点什么|第 [0-9]+ */ *[0-9]+ 步|Esc 跳过引导|跳过引导'
READY=0
for _ in $(seq 1 60); do
  sleep 2
  PANE="$(tmux -S "$SOCK" capture-pane -p -J -t tui 2>/dev/null || true)"
  if printf '%s' "$PANE" | grep -qE '❯|esc to interrupt|按 Esc' && ! printf '%s' "$PANE" | grep -qE "$LANDING_MARKERS"; then READY=1; break; fi
done
sleep 4
capture_pane boot
BOOT_PANE="$(cat "$TUI_DIR/pane-boot.txt" 2>/dev/null || true)"
# How many landing markers the boot capture still carries; `tui.boot` (recorded once, after the
# session is closed) is the arm that judges it, and this count is its evidence.
BOOT_LANDING_HITS="$(printf '%s' "$BOOT_PANE" | grep -cE "$LANDING_MARKERS" || true)"

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
capture_pane team
TEAM_PANE="$(cat "$TUI_DIR/pane-team.txt" 2>/dev/null || true)"

# ── THE RECORD'S OWN TASK TABLE, read ONCE for the two arms that judge the drawing ──
# Both arms take their expected values from the fixture this lane just wrote, never from a literal: a
# hard-coded id, or a hard-coded `3`, keeps passing after the renderer silently drops a task — which is
# exactly how the arm this replaces outlived the drawing it was written for.
TEAM_TASKS_PROBE="$TUI_DIR/team-tasks.ts"
cat > "$TEAM_TASKS_PROBE" <<'TEAMTASKS_EOF'
// One `<id>\t<subject>` line per task in the lane's OWN team fixture: the assertions below read their
// expected values from the record, so no literal can stand in for a value the record does not carry.
import { readFileSync } from "node:fs"
const [recordPath] = process.argv.slice(2)
const record = JSON.parse(readFileSync(recordPath, "utf8"))
for (const task of record.tasks ?? []) process.stdout.write(`${task.id}\t${task.subject ?? ""}\n`)
TEAMTASKS_EOF
TEAM_TASKS="$(node "$TEAM_TASKS_PROBE" "$WORK_DIR/ws/.mpd/team/teams/tui-scene.json" 2>"$TUI_DIR/team-tasks.err" || true)"
# The record's own task COUNT and id list, from the table above: the number a box census is compared
# against, and the list the label arm walks. Zero tasks means the record itself was unreadable.
TEAM_TASK_COUNT=0
TEAM_IDS_SEEN=""
while IFS=$'\t' read -r id subject; do
  [ -n "$id" ] || continue
  TEAM_TASK_COUNT=$((TEAM_TASK_COUNT + 1))
  TEAM_IDS_SEEN="${TEAM_IDS_SEEN}${TEAM_IDS_SEEN:+,}${id}"
done <<<"$TEAM_TASKS"

record tui.teamSceneOpened "$(printf '%s' "$TEAM_PANE" | grep -q 'task dependency graph' && echo true || echo false)" \
  "the /mpd team scene opened on a real terminal" "chars=$(printf '%s' "$TEAM_PANE" | wc -c)"
# ── THE BOXES, COUNTED — the FRAME is not the drawing ─────────────────────────
# The arm this replaces grepped `┌.*┐`/`└.*┘`, and the scene FRAME satisfies BOTH of those on its own:
# measured on the captured pane (2026-10-07) there is exactly ONE `┌…┐` row and ONE `└…┘` row — the
# frame's own top and bottom, rows 2 and 49 — against three boxes, so it stayed green with every box
# gone and never looked at the rounded corner set (`╭ ╮ ╰ ╯`, the theme's `DAG_CHARS`) the boxes are
# actually drawn with. A box IS its four corners, and `drawBoxes` writes exactly one of each per task
# it draws, so the census must EQUAL the record's own task count: a dropped box loses all four of its
# corners. The SUBJECT is not asserted here — clause AC1 took it out of the boxes, and
# `tui.teamGraphContent` below is the arm that proves where it went. One reach is stated rather than
# tested: a board whose ranks exceed the boxed path's cap (12) falls back to the RAIL, which draws no
# boxes at all and so reddens this arm deliberately, not by accident.
TEAM_BOX_TL="$(pane_glyphs '╭' "$TUI_DIR/pane-team.txt")"
TEAM_BOX_TR="$(pane_glyphs '╮' "$TUI_DIR/pane-team.txt")"
TEAM_BOX_BL="$(pane_glyphs '╰' "$TUI_DIR/pane-team.txt")"
TEAM_BOX_BR="$(pane_glyphs '╯' "$TUI_DIR/pane-team.txt")"
TEAM_BOX_RAW="corners=╭${TEAM_BOX_TL} ╮${TEAM_BOX_TR} ╰${TEAM_BOX_BL} ╯${TEAM_BOX_BR} tasksFromRecord=${TEAM_TASK_COUNT} ids=${TEAM_IDS_SEEN:-none} pane=pane-team.txt"
if [ "$TEAM_TASK_COUNT" -gt 0 ] \
  && [ "$TEAM_BOX_TL" = "$TEAM_TASK_COUNT" ] && [ "$TEAM_BOX_TR" = "$TEAM_TASK_COUNT" ] \
  && [ "$TEAM_BOX_BL" = "$TEAM_TASK_COUNT" ] && [ "$TEAM_BOX_BR" = "$TEAM_TASK_COUNT" ]; then
  record tui.teamGraphDrawn true \
    "the LAYERED BOXES were drawn: the ROUNDED corner census equals the record's own task count, one box per task, which a dropped box reddens (the square corners the old arm matched belong to the scene FRAME; the subjects are NOT claimed here, because clause AC1 moved them to the pinned detail body that tui.teamGraphContent asserts)" \
    "$TEAM_BOX_RAW"
else
  record tui.teamGraphDrawn false \
    "the boxes were NOT drawn one per task: the record carries ${TEAM_TASK_COUNT} task(s) and the pane's rounded corners are ╭${TEAM_BOX_TL} ╮${TEAM_BOX_TR} ╰${TEAM_BOX_BL} ╯${TEAM_BOX_BR}, each of which must equal the task count" \
    "$TEAM_BOX_RAW"
fi
record tui.teamGraphEdges "$(printf '%s' "$TEAM_PANE" | grep -qE '┬|┴|│' && echo true || echo false)" \
  "the dependency EDGES were drawn with box-drawing junctions" "junctions=$(printf '%s' "$TEAM_PANE" | grep -coE '┬|┴|│' || echo 0)"
# ── THE CONTENT ARM: the RECORD's own ids and subject ─────────────────────────
# The values come from the task table read above, never from a literal. Commit 6fdfc012 froze clause
# AC1, which limits a node label to `<marker> <id>` and moves the subject into the PINNED DETAIL BODY;
# the subject is therefore asserted THERE — the body a reader reaches — and not in a box that no longer
# draws it (the arm above counts the boxes and claims no subject inside them).
# (a) EVERY id the record carries must be DRAWN — as a NODE LABEL, not as a string somewhere on the
# screen: the label is `<marker> <id>` inside a box (AC1), so the id sits after a marker and before the
# box's own right border. A later detail row (`T1 · …`) cannot satisfy this, because there the id is
# followed by `·` rather than by the border.
TEAM_MISSING=""
while IFS=$'\t' read -r id subject; do
  [ -n "$id" ] || continue
  printf '%s' "$TEAM_PANE" | grep -qE "[^ ] $id +│" || TEAM_MISSING="${TEAM_MISSING}${TEAM_MISSING:+,}${id}"
done <<<"$TEAM_TASKS"

# (b) THE SUBJECT IS REACHABLE, one keystroke away. `j` is the scene's OWN alias for one step down the
# drawing order (`scenes.ts` `moveFocus`: `input === "j"` → `setPinned(...)`), and `moveFocus` leaves a
# PIN behind — the same state a click leaves, and the state the detail body renders (`focus = hover ??
# pinned`). It is a plain character, so nothing in the tmux transport has to be parsed as a key.
tmux -S "$SOCK" send-keys -t tui j 2>/dev/null || true
sleep 3
capture_pane teamPinned
TEAM_PINNED_PANE="$(cat "$TUI_DIR/pane-teamPinned.txt" 2>/dev/null || true)"
TEAM_FOCUS_ID=""
TEAM_DETAIL=""
while IFS=$'\t' read -r id subject; do
  [ -n "$id" ] && [ -n "$subject" ] || continue
  # The body's own row is `<id> · <kind> · <subject>` (`scenes.ts`): the id LEADS it and the record's
  # own subject follows on the SAME row. Both tests are fixed-string, so punctuation in a subject stays
  # literal — and the pane must also NAME this id as the focus, so the row is the pinned task's own body
  # rather than a coincidence elsewhere on the screen.
  TEAM_DETAIL_LINE="$(printf '%s' "$TEAM_PINNED_PANE" | grep -F "$id · " | grep -F "$subject" | head -n1 || true)"
  if [ -n "$TEAM_DETAIL_LINE" ] && printf '%s' "$TEAM_PINNED_PANE" | grep -qF "focus $id "; then
    TEAM_FOCUS_ID="$id"
    TEAM_DETAIL="$(printf '%s' "$TEAM_DETAIL_LINE" | sed -e 's/^[[:space:]]*│[[:space:]]*//' -e 's/│[[:space:]]*$//' -e 's/[[:space:]]*$//')"
  fi
done <<<"$TEAM_TASKS"
# THE PIN IS A MODE, and the lane's own `Escape` below closes the scene only while NOTHING is pinned
# (`scenes.ts`: the escape arm unpins while a task IS pinned and closes otherwise), so this arm releases
# its own pin here and leaves the scene exactly as it found it — the `Escape` below still closes it.
tmux -S "$SOCK" send-keys -t tui Escape 2>/dev/null || true
sleep 2

TEAM_CONTENT_RAW="ids=${TEAM_IDS_SEEN:-none} fromRecord=${TEAM_TASK_COUNT} labelsExpected=${TEAM_TASK_COUNT} missing=[${TEAM_MISSING:-none}] pane=pane-team.txt chars=$(printf '%s' "$TEAM_PANE" | wc -c) pinnedFocus=${TEAM_FOCUS_ID:-none} detail=[${TEAM_DETAIL:-none}] pinnedPane=pane-teamPinned.txt"
if [ "$TEAM_TASK_COUNT" -gt 0 ] && [ -z "$TEAM_MISSING" ] && [ -n "$TEAM_FOCUS_ID" ]; then
  record tui.teamGraphContent true \
    "every task id the lane's OWN record carries is drawn as a node label AND the record's own subject is reachable one keystroke away in the pinned detail body, where clause AC1 moved it (a literal id would keep passing after a dropped task)" \
    "$TEAM_CONTENT_RAW"
else
  record tui.teamGraphContent false \
    "the pane does not carry the record's own data: ids read from the record=${TEAM_TASK_COUNT} missing=[${TEAM_MISSING:-none}] pinnedFocus=[${TEAM_FOCUS_ID:-none}] — each record id must be DRAWN, and one 'j' keystroke must reach a task's own subject in the pinned detail body" \
    "$TEAM_CONTENT_RAW"
fi

# ── 4b. THE MERGED PANEL: the host's own subagent rows ABOVE the MPD team body ──
# WHAT OPENS IT, AND WHAT MUST NOT — two arms below pin the split:
#   * `alt+a` is the MPD-owned combo (`packages/mpd-tui-plugin/src/shortcuts.ts`, SHORTCUT_BINDINGS:
#     `{ combo: "alt+a", … action: "openSubagents" }`, which the plugin refuses to move onto the
#     host's key);
#   * `Ctrl+A` is the HOST's own subagent dashboard (`dsh-tui` 0.12.0 `utils/keymap.js`:
#     `{ id: 'dashboard', defaults: ['ctrl+a'] }`) and must keep working.
# On a real terminal the combo is `M-a`, and the scene is CLOSED FIRST — not for convenience: the
# host's own shortcut registry documents that "overlays (pickers, dialogs, scenes, the session
# browser) own the keyboard while open; shortcuts match only in the plain chat state"
# (`lib/types/dsh-adapter/shortcuts.js`), so the combo is sent from the CHAT state. The team scene's
# `Escape` closes it because nothing is pinned (`scenes.ts`: the escape arm unpins only while a task
# IS pinned, and closes otherwise) — the content arm above released its own pin before this point.
tmux -S "$SOCK" send-keys -t tui Escape 2>/dev/null || true
sleep 2
capture_pane teamClosed
# ── THE VERSION DISCRIMINATOR (dsh-tui 0.13.0) ─────────────────────────────────
# 0.13.0 added `ctx.tuiPanels`. On a host that OFFERS the seam the merged view is the SIDEBAR panel —
# `alt+a`, `/mpd subagents` and `/mpd panel` all route through `tuiPanels.open()` — and the legacy
# Ctrl+A host-input contact stays INERT; on a host WITHOUT it the pre-0.13.0 behaviour is the contract
# (a full-screen merged scene from `alt+a`, and a Ctrl+A take-over). The two arms below therefore read
# the SAME discriminator the sandbox lane uses (`hostPanelSeam()`): the composed host row AND the
# shipped module, so a half-migrated host cannot be misread as either generation.
TUI_PANEL_ROW="$(grep -cE '^- id: dsh-tui-panels$' "$TUI_DIR/dump.yml" 2>/dev/null || true)"
TUI_PANEL_MODULE="$(find -L "$DSH_HOME/profiles" -path '*/@deepseek-harness-tui/dsh-tui/lib/types/dsh-adapter/panels.js' -print -quit 2>/dev/null || true)"
if [ "${TUI_PANEL_ROW:-0}" -gt 0 ] && [ -n "$TUI_PANEL_MODULE" ]; then
  PANEL_SEAM="present"
else
  PANEL_SEAM="absent"
fi
if [ "$PANEL_SEAM" = "present" ]; then
  # NOT MEASURABLE IN A PANE, recorded as such rather than as a pass. On this host the merged view is
  # the SIDEBAR panel (`alt+a` / `/mpd subagents` / `/mpd panel` all route through `tuiPanels.open()`),
  # and this lane's evidence channel is a tmux capture. MEASURED 2026-10-06 across four container runs
  # (`evidence/docker/client-install/`): a host-ACCEPTED `open()` changes ZERO bytes of the capture, and
  # the routed command's own printed line does not reach the pane either — the transcript stays empty
  # while the same command's `command/run` + `command/done` records ARE written to the session store.
  # The dashboard asks for a VERDICT, not for a hopeful grep, so this arm declares the bound and names
  # the assertion that does carry the proof on the SAME host version: `skills/dsh-qa/scripts/
  # tui-panels.ts` + `tui-deps-ctrla.ts` read the store and assert the host's own `list()` read-back id
  # (`act1:team`) plus an accepted open (both PASS on 0.13.0, evidence/tui/lanes/).
  record tui.mergedPanelOpens null \
    "the merged view's OPEN is not pane-observable on this host: with the 0.13.0 panel seam present it is a sidebar panel, a host-ACCEPTED open() changes zero bytes of a tmux capture, and the routed command's printed line does not reach the transcript either. The panel registration + accepted open ARE asserted, store-backed, by the sandbox lanes on the SAME host version (tui-panels, tui-deps-ctrla). Full-screen surfaces that this lane CAN see on this host are covered by the team-scene arms above" \
    "panelSeam=$PANEL_SEAM rowHits=${TUI_PANEL_ROW:-0} module=${TUI_PANEL_MODULE:+present} proofOwner=skills/dsh-qa/scripts/tui-panels.ts,tui-deps-ctrla.ts"
  # Give the composer focus back before the next arms, in case an interactive opened earlier.
  tmux -S "$SOCK" send-keys -t tui Escape 2>/dev/null || true
  sleep 2
fi
tmux -S "$SOCK" send-keys -t tui M-a 2>/dev/null || true
sleep 5
capture_pane merged
MERGED_PANE="$TUI_DIR/pane-merged.txt"

# (1) THE PANEL OPENED — and it is the MERGED one, not the team scene it came from: its own title
# line, the subagent section this scene exists to add (the section header always renders; without a
# host subagent row the panel also carries the host's own empty-state line), and the team body's
# record markers `tui.teamGraphContent` above already proves are drawn.
MERGED_TITLE_HITS="$(pane_hits 'MPD subagents \+ team' "$MERGED_PANE")"
MERGED_SUB_HITS="$(pane_hits 'subagents +[0-9]+ total|No subagents in the current session' "$MERGED_PANE")"
MERGED_TEAM_HITS="$(pane_hits 'build the graph|task dependency graph' "$MERGED_PANE")"
if [ "$PANEL_SEAM" != "present" ] && [ "$MERGED_TITLE_HITS" -gt 0 ] && [ "$MERGED_SUB_HITS" -gt 0 ] && [ "$MERGED_TEAM_HITS" -gt 0 ]; then
  record tui.mergedPanelOpens true \
    "the MPD combo (alt+a, sent as tmux M-a from the plain chat state) opened the MERGED panel on a real terminal: the pane carries the scene's own title, its subagent section, and the team body the /mpd team arm proves is drawn" \
    "title=\"MPD subagents + team\" titleHits=$MERGED_TITLE_HITS subagentSectionHits=$MERGED_SUB_HITS teamBodyHits=$MERGED_TEAM_HITS pane=pane-merged.txt chars=$(wc -c <"$MERGED_PANE" 2>/dev/null || echo 0)"
elif [ "$PANEL_SEAM" != "present" ]; then
  record tui.mergedPanelOpens false \
    "the MPD combo did NOT open the merged panel: titleHits=$MERGED_TITLE_HITS subagentSectionHits=$MERGED_SUB_HITS teamBodyHits=$MERGED_TEAM_HITS (each must be > 0) — the pane is the screen alt+a produced after Escape closed the team scene" \
    "pane=pane-merged.txt chars=$(wc -c <"$MERGED_PANE" 2>/dev/null || echo 0) head=$(head -c 200 "$MERGED_PANE" 2>/dev/null | tr '\n' ' ' | tr -d '"\\')"
fi

# (2) THE ROW ORDER on the CAPTURED pane: the subagent section above the team section. The branch
# actually measured is stated in the record, because the two are different screens: a session with no
# host subagent row renders the host's own EMPTY-STATE line, and one with a row renders the row.
# Whichever branch it is, the marker's line index must be > 0 and BELOW the team body's first marker.
MERGED_SUB_HEAD_LINE="$(pane_line_of 'subagents +[0-9]+ total' "$MERGED_PANE")"
MERGED_SUB_EMPTY_LINE="$(pane_line_of 'No subagents in the current session' "$MERGED_PANE")"
MERGED_TEAM_LINE="$(pane_line_of 'task dependency graph|build the graph' "$MERGED_PANE")"
if [ "$MERGED_SUB_EMPTY_LINE" -gt 0 ]; then
  MERGED_SUB_LINE="$MERGED_SUB_EMPTY_LINE"
  MERGED_SUB_BRANCH="the host's own empty-state line (this session carries NO host subagent row)"
else
  MERGED_SUB_LINE="$MERGED_SUB_HEAD_LINE"
  MERGED_SUB_BRANCH="the subagent section header (this session carries at least one host subagent row)"
fi
MERGED_ORDER_RAW="subagentMarker=line ${MERGED_SUB_LINE:-0} [${MERGED_SUB_BRANCH}] teamMarker=line ${MERGED_TEAM_LINE:-0} header=line ${MERGED_SUB_HEAD_LINE:-0} emptyState=line ${MERGED_SUB_EMPTY_LINE:-0} pane=pane-merged.txt"
if [ "$PANEL_SEAM" = "present" ]; then
  # NOT MEASURABLE HERE, and recorded as such rather than as a pass: on this host the merged body
  # lives in a SIDEBAR panel whose rows a tmux capture does not carry (measured: a byte-identical
  # capture around a host-ACCEPTED open). The order is asserted by the unit arms instead
  # (`packages/mpd-tui-plugin/test/panel.test.ts` renders the panel through a host double and checks
  # the two sections' order), and the pre-0.13.0 branch below keeps the pane-level assertion alive for
  # a host that still renders the merged view full-screen.
  record tui.mergedPanelOrder null \
    "the merged body's section order is NOT observable on this host: with the panel seam present the merged view is a sidebar panel and its rows do not reach a tmux capture, so this arm is not attempted here (the order is covered by the plugin's unit arms). Recording it as a pass would be a claim the pane does not carry" \
    "panelSeam=$PANEL_SEAM orderCoveredBy=packages/mpd-tui-plugin/test/panel.test.ts $MERGED_ORDER_RAW"
elif [ "${MERGED_SUB_LINE:-0}" -gt 0 ] && [ "${MERGED_TEAM_LINE:-0}" -gt 0 ] && [ "${MERGED_SUB_LINE:-0}" -lt "${MERGED_TEAM_LINE:-0}" ]; then
  record tui.mergedPanelOrder true \
    "the captured pane holds the subagent section ABOVE the team section — measured marker: ${MERGED_SUB_BRANCH}, at line ${MERGED_SUB_LINE}, above the team body's first marker at line ${MERGED_TEAM_LINE}" \
    "$MERGED_ORDER_RAW"
else
  record tui.mergedPanelOrder false \
    "the subagent section is NOT above the team section on the captured pane (or a marker is missing, which compares as line 0): ${MERGED_ORDER_RAW}" \
    "$MERGED_ORDER_RAW"
fi

# ── 4c. THE `Ctrl+A` SPLIT (the user's 2026-10-05 decision, measured in TWO phases) ──
# This replaces the pre-wave contract "MPD must never take the host's key". The user asked for the
# opposite in ONE case and for the host's behaviour in every other, so the arm now measures BOTH
# halves in the SAME session and is green only when both hold:
#   PHASE A — a team IS present (`tui-scene.json` seeded above, 3 tasks): `Ctrl+A` MUST open MPD's
#             merged panel. A take-over that never happens fails here.
#   PHASE B — the team record REMOVED, nothing else changed: `Ctrl+A` MUST NOT open that panel any
#             more (the hook re-reads the projection at KEYPRESS time). An UNCONDITIONAL take-over
#             fails here.
# The host's own dashboard title is recorded as an OBSERVATION in phase B: this container does not
# always render it (the pre-wave lane documented the same limit), so its absence is information and
# never a silent pass — phase B's falsifier is its own pane, where the MPD title must be ABSENT.
tmux -S "$SOCK" send-keys -t tui Escape 2>/dev/null || true
sleep 2
capture_pane mergedClosed
MERGED_AFTER_CLOSE="$(pane_hits 'MPD subagents \+ team' "$TUI_DIR/pane-mergedClosed.txt")"
tmux -S "$SOCK" send-keys -t tui C-a 2>/dev/null || true
sleep 3
capture_pane ctrlATeam
# The host's dashboard title is i18n (`subagent-dashboard-title`): English " Subagent Dashboard " and
# Chinese " 子代理面板 ". The lane boots `env -i` with NO LANG, and dsh-tui's own detectLocaleLang()
# returns 'zh' for an ABSENT locale — so BOTH spellings are the host's title, and matching only the
# English one would call a working host dashboard broken.
PHASE_A_PANE="$TUI_DIR/pane-ctrlATeam.txt"
PHASE_A_MPD_HITS="$(pane_hits 'MPD subagents \+ team' "$PHASE_A_PANE")"
PHASE_A_HOST_HITS="$(pane_hits 'Subagent Dashboard|子代理面板' "$PHASE_A_PANE")"
# PHASE B: remove the record and press the SAME key again, from the chat screen.
tmux -S "$SOCK" send-keys -t tui Escape 2>/dev/null || true
sleep 2
rm -f "$WORK_DIR/ws/.mpd/team/teams/tui-scene.json" "$WORK_DIR/ws/.mpd/team/teams.json"
sleep 3
tmux -S "$SOCK" send-keys -t tui C-a 2>/dev/null || true
sleep 3
capture_pane ctrlANoTeam
PHASE_B_PANE="$TUI_DIR/pane-ctrlANoTeam.txt"
PHASE_B_MPD_HITS="$(pane_hits 'MPD subagents \+ team' "$PHASE_B_PANE")"
PHASE_B_HOST_HITS="$(pane_hits 'Subagent Dashboard|子代理面板' "$PHASE_B_PANE")"
if [ "$PANEL_SEAM" = "present" ]; then
  # THE EXPECTATION FLIPS ON THIS HOST (frozen R4). 0.13.0 offers the panel seam, so the legacy
  # host-input contact stays INERT and `Ctrl+A` keeps the host's own dashboard meaning: with the team
  # present MPD's merged title must NOT appear, and it must still not appear after the team is
  # removed. The host's own dashboard title is an OBSERVATION in both phases, because this container
  # does not always render it — the falsifier is the ABSENCE of MPD's title, which one green arm per
  # phase cannot fake.
  if [ "${PHASE_A_MPD_HITS:-0}" -eq 0 ] && [ "${PHASE_B_MPD_HITS:-0}" -eq 0 ]; then
    record tui.hostDashboardKeyIntact true \
      "Ctrl+A stayed the HOST's key on this host, as frozen R4 requires wherever the panel seam is present: with the seeded team present it did NOT open MPD's merged panel, and after the team record was removed it still did not. The panel is reached through MPD's own entry points instead (tui.mergedPanelOpens above proves /mpd panel)" \
      "panelSeam=$PANEL_SEAM phaseA=no-mpd-panel mpdTitleHits=$PHASE_A_MPD_HITS hostDashboardTitleHits=$PHASE_A_HOST_HITS phaseB=team-record-removed mpdTitleHits=$PHASE_B_MPD_HITS hostDashboardTitleHits=$PHASE_B_HOST_HITS"
  else
    record tui.hostDashboardKeyIntact false \
      "the version gate did NOT hold: with the panel seam PRESENT, Ctrl+A produced MPD's merged panel (phaseA mpdTitleHits=$PHASE_A_MPD_HITS, phaseB mpdTitleHits=$PHASE_B_MPD_HITS) — on this host Ctrl+A must stay the host's key (frozen R4)" \
      "panelSeam=$PANEL_SEAM phaseA mpdTitleHits=$PHASE_A_MPD_HITS hostDashboardTitleHits=$PHASE_A_HOST_HITS phaseB mpdTitleHits=$PHASE_B_MPD_HITS pane=pane-ctrlATeam.txt,pane-ctrlANoTeam.txt"
  fi
elif [ "${MERGED_AFTER_CLOSE:-0}" -gt 0 ]; then
  record tui.hostDashboardKeyIntact false \
    "the CONTROL COULD NOT BE RUN: Escape left the merged panel on screen, so the pane Ctrl+A acted on is not the chat screen — this arm proves nothing about the split and must not be read as a pass" \
    "afterEscape=merged-panel-still-open mpdTitleHits=$MERGED_AFTER_CLOSE pane=pane-mergedClosed.txt"
elif [ "${PHASE_A_MPD_HITS:-0}" -gt 0 ] && [ "${PHASE_B_MPD_HITS:-0}" -eq 0 ]; then
  record tui.hostDashboardKeyIntact true \
    "the Ctrl+A split holds on a real terminal: with the seeded team present Ctrl+A opened MPD's merged panel AND the host dashboard title is absent from that pane; after REMOVING the team record the SAME key no longer opened it (the hook re-reads the projection per press). The host dashboard title in the second pane is recorded as an observation only" \
    "phaseA=mpd-merged-panel mpdTitleHits=$PHASE_A_MPD_HITS hostDashboardTitleHits=$PHASE_A_HOST_HITS phaseB=team-record-removed mpdTitleHits=$PHASE_B_MPD_HITS hostDashboardTitleHits=$PHASE_B_HOST_HITS pane=pane-ctrlATeam.txt,pane-ctrlANoTeam.txt"
elif [ "${PHASE_A_MPD_HITS:-0}" -eq 0 ]; then
  record tui.hostDashboardKeyIntact false \
    "the TAKE-OVER DID NOT HAPPEN: with the seeded team present Ctrl+A did not open MPD's merged panel (mpdTitleHits=$PHASE_A_MPD_HITS), while alt+a is what opens that panel (tui.mergedPanelOpens above). Either the host contact never armed in this container or the hook declined a team it should have served" \
    "phaseA=no-mpd-panel mpdTitleHits=$PHASE_A_MPD_HITS hostDashboardTitleHits=$PHASE_A_HOST_HITS phaseB mpdTitleHits=$PHASE_B_MPD_HITS pane=pane-ctrlATeam.txt"
else
  record tui.hostDashboardKeyIntact false \
    "UNCONDITIONAL TAKE-OVER: after the team record was REMOVED, Ctrl+A still produced the merged panel — the key no longer follows the team projection (an empty workspace must keep the host's own behaviour)" \
    "phaseA mpdTitleHits=$PHASE_A_MPD_HITS phaseB=no-team mpdTitleHits=$PHASE_B_MPD_HITS hostDashboardTitleHits=$PHASE_B_HOST_HITS pane=pane-ctrlANoTeam.txt"
fi

# ── 4d. THE WAVE'S OWN D6 GATE, on a byte-verified copy of the INSTALLED tree ───
# `packages/mpd-tui-adapter-plugin/test/no-direct-tui-access.test.ts` is the executable form of
# "no file outside the TUI adapter may name a `ctx.tui*` seam". It scans `packages/mpd-*/src/**`
# from the ROOT IT IS RUN OUT OF (`resolve(import.meta.url, "..", "..", "..")`), and in a container
# the installed bundle can sit UNDER node_modules, where node refuses to strip types — so the SUBJECT
# is copied to a scratch root and every copied byte is compared before the gate runs, the same move
# docker/entrypoint.sh makes for verify-no-host-override ("the subject stays the INSTALLED bytes,
# only the runner's location changes"). A subject that cannot be verified is NEVER reported as a pass.
SEAM_GATE_REL="packages/mpd-tui-adapter-plugin/test/no-direct-tui-access.test.ts"
SEAM_GATE_SRC=""
for candidate in "$TUI_BUNDLE_DIR" "$APP_DIR"; do
  if [ -f "$candidate/$SEAM_GATE_REL" ]; then SEAM_GATE_SRC="$candidate"; break; fi
done
SEAM_SUBJECT="not compared"
SEAM_CODE=0
SEAM_OUT=""
if [ -n "$SEAM_GATE_SRC" ] && command -v node >/dev/null 2>&1; then
  SEAM_DIR="$TUI_DIR/seam-gate-subject"
  rm -rf "$SEAM_DIR"
  mkdir -p "$SEAM_DIR/packages/mpd-tui-adapter-plugin/test"
  for pkg in "$SEAM_GATE_SRC"/packages/mpd-*; do
    [ -d "$pkg/src" ] || continue
    mkdir -p "$SEAM_DIR/packages/$(basename "$pkg")"
    cp -RL "$pkg/src" "$SEAM_DIR/packages/$(basename "$pkg")/src" 2>/dev/null || true
  done
  cp "$SEAM_GATE_SRC/$SEAM_GATE_REL" "$SEAM_DIR/$SEAM_GATE_REL" 2>/dev/null || true
  SEAM_DRIFT=""
  while IFS= read -r rel; do
    if [ ! -f "$SEAM_GATE_SRC/packages/$rel" ]; then SEAM_DRIFT="$SEAM_DRIFT missing:$rel"
    elif ! cmp -s "$SEAM_GATE_SRC/packages/$rel" "$SEAM_DIR/packages/$rel"; then SEAM_DRIFT="$SEAM_DRIFT differs:$rel"; fi
  done < <(cd "$SEAM_DIR/packages" && find . -type f -name '*.ts' | sed 's#^\./##' | sort)
  if [ -z "$SEAM_DRIFT" ] && cmp -s "$SEAM_GATE_SRC/$SEAM_GATE_REL" "$SEAM_DIR/$SEAM_GATE_REL"; then
    SEAM_SUBJECT="byte-identical (cmp over every copied .ts and the gate file itself)"
  else
    SEAM_SUBJECT="DRIFTED:${SEAM_DRIFT:- <gate file>}"
  fi
  SEAM_OUT="$(node "$SEAM_DIR/$SEAM_GATE_REL" 2>&1)" || SEAM_CODE=$?
fi
SEAM_VERDICT="$(printf '%s\n' "$SEAM_OUT" | grep -m1 -E '^RESULT: (PASS|FAIL)' || true)"
SEAM_SCANNED="$(printf '%s\n' "$SEAM_OUT" | grep -m1 -E '^scanned: ' || true)"
SEAM_FINDING="$(printf '%s\n' "$SEAM_OUT" | grep -m1 -E '^[^ ].*:[0-9]+ ' || true)"
if [ -z "$SEAM_GATE_SRC" ] || ! command -v node >/dev/null 2>&1; then
  record tui.noDirectTuiSeam null \
    "the D6 seam gate was NOT RUN: ${SEAM_GATE_SRC:-no bundle dir carries $SEAM_GATE_REL}$(command -v node >/dev/null 2>&1 && echo '' || echo ' and node is not on PATH') — an unmade measurement, deliberately not a pass" \
    "gate=not-run source=${SEAM_GATE_SRC:-none} node=$(command -v node 2>/dev/null || echo none)"
elif [ "$SEAM_SUBJECT" != "byte-identical (cmp over every copied .ts and the gate file itself)" ]; then
  record tui.noDirectTuiSeam null \
    "the D6 seam gate ran on a copy that is NOT byte-identical to the installed tree, so its verdict would not be about the installed bytes — recorded as an unmade measurement, never as a pass" \
    "gate=not-run subject=$SEAM_SUBJECT source=$SEAM_GATE_SRC"
elif [ "$SEAM_CODE" -eq 0 ] && printf '%s' "$SEAM_VERDICT" | grep -q 'RESULT: PASS'; then
  record tui.noDirectTuiSeam true \
    "the D6 gate (no file outside mpd-tui-adapter-plugin names a ctx.tui* seam) passed on a byte-identical copy of the INSTALLED tree, executed where node can strip types" \
    "gate exit=0 subject=$SEAM_SUBJECT source=$SEAM_GATE_SRC ${SEAM_SCANNED:-<no scanned line>} ${SEAM_VERDICT}"
else
  record tui.noDirectTuiSeam false \
    "the D6 gate named a violation in the installed tree (exit=$SEAM_CODE): ${SEAM_VERDICT:-<no verdict line>} ${SEAM_FINDING}" \
    "gate exit=$SEAM_CODE subject=$SEAM_SUBJECT source=$SEAM_GATE_SRC ${SEAM_SCANNED:-<no scanned line>} ${SEAM_FINDING:-<no finding line>}"
fi

# ── 4c. a LIVE turn on the TUI plane, typed into the real PTY ─────────────────
# WHY HERE, AND NOT AFTER THIS LANE EXITS: the block below quits the app and kills the tmux server, so
# a turn driven afterwards would have no terminal to type into. Typing the prompt into the pane is the
# only way to prove the TUI's OWN input path (keystrokes -> agent -> store) rather than an API.
#
# The verdict is read from the session store, scoped by `--since`, exactly like the Web and headless
# arms (AGENTS.md §7: a real artifact, never the pane's narration). The pane is captured on both sides
# of the turn, because a pane that never echoed the prompt is the first thing a human wants to see.
if [ "$LIVE" = "1" ]; then
  TUI_LIVE_SINCE="$(date +%s%3N)"
  capture_pane live-before
  tmux -S "$SOCK" send-keys -t tui Escape 2>/dev/null || true
  sleep 1
  # The prompt asks for ONE MPD tool so `live.tui.mpdToolCalled` is a statement about this bundle's
  # tool plane inside the TUI, not about the model's mood.
  TUI_PROMPT="Call the mpd_config_get tool once (it takes no arguments), then reply with exactly: DONE"
  tmux -S "$SOCK" send-keys -t tui "$TUI_PROMPT" Enter 2>/dev/null || true
  sleep 2
  capture_pane live-sent
  if command -v node >/dev/null 2>&1; then
    node "$LIB_DIR/live-verdict.ts" --dsh-home "$DSH_HOME" --workspace "$WORK_DIR/ws" --label tui \
      --state "$STATE_FILE" --since "$TUI_LIVE_SINCE" --wait "$LIVE_BUDGET_MS" || true
  else
    record live.tui.turnStarted null "node is not on PATH, so the TUI live verdict could not be read — an unmade measurement, never a pass" "node=absent"
  fi
  capture_pane live-after
else
  node "$LIB_DIR/live-verdict.ts" --label tui --state "$STATE_FILE" \
    --unavailable "not attempted: a live turn needs MPD_E2E_LIVE=1 and a credential forwarded by name; the mount assertions are the credential-free maximum" || true
fi

tmux -S "$SOCK" send-keys -t tui Escape 2>/dev/null || true
sleep 1
tmux -S "$SOCK" send-keys -t tui "/quit" Enter 2>/dev/null || true
sleep 2
tmux -S "$SOCK" kill-server 2>/dev/null || true

BOOT_TEXT="$(cat "$TUI_DIR/pane-boot.txt" "$PANE_LOG" 2>/dev/null || true)"
if [ "$TMUX_NEW" = "0" ] && [ "$READY" = "1" ]; then
  record tui.boot true "the REAL TUI booted on a real PTY and reached its CHAT screen (the composer is drawn and no 0.13.0 landing marker is on screen)" "tmux=new-session-ok ready=chat-screen noLaunchpad=1 onboardingHex=${ONBOARDING_HEX:0:16}… landingMarkerHits=${BOOT_LANDING_HITS:-0}"
else
  record tui.boot false "the TUI did not reach its chat screen (tmux=$TMUX_NEW ready=$READY landingMarkerHits=${BOOT_LANDING_HITS:-0} — the landing markers are 0.13.0's launchpad/first-run wizard, so a non-zero count means the session never left a landing screen)" \
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
# The floor is the number of tui.* records this lane REALLY writes BEFORE this exit record (19 since
# the merged-panel group landed: the closed R5/zero-override set of 15 plus mergedPanelOpens,
# mergedPanelOrder, hostDashboardKeyIntact and noDirectTuiSeam — counted from the writers, not
# guessed). It is pinned so a record that silently disappears from the writer reddens instead of
# shrinking the lane's coverage (measured 2026-09-27: all eleven assertions green and the lane
# still reported laneExit=false — the inverse failure).
if [ "${TUI_BAD:-0}" = "0" ] && [ "${TUI_TOTAL:-0}" -ge 19 ]; then
  record tui.laneExit true "the TUI lane ran to completion with every assertion green" "records=$TUI_TOTAL"
  exit 0
fi
record tui.laneExit false "the TUI lane finished with failing or missing assertions" "records=$TUI_TOTAL failed=$TUI_BAD"
exit 1
