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
#   tui.teamFixtureBound the seeded board is BOUND to the live session the TUI runs as — BOTH spellings
#                        the product's own `createTeam` writes — BEFORE any scene arm judges a drawing
#   tui.teamSceneOtherSessionInvisible  a session with NO bound board draws the product's OWN
#                        empty-state marker and does NOT draw the board a SIBLING session owns; the row
#                        is null (never a pass) when this boot found no sibling session to bind
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
#
# AND THE SECOND NET MUST NOT FIRE ON THE LANE'S OWN RED ENDING — MEASURED 2026-10-08, the mirror image
# of the defect above: the lane performed its whole duty, wrote its last record
# (`tui.laneExit false "the TUI lane finished with failing or missing assertions"`) and then exited 1,
# which fired the EXIT net and published a SECOND, FALSE record claiming the lane aborted and that every
# arm after that point reads as "not reached" (`evidence/docker/client-install/2026-10-08T08-52-23Z/`
# `console.log:3193-3194`, raw at `:3210`). A red run was therefore DOUBLE-reported, and the false
# reading is the one that says a finished run never finished. `LANE_EXIT_RECORDED` is the ONE predicate
# both nets read — it means "this exit already carries a `tui.laneExit` record" — so the terminal red
# path sets it BEFORE exiting, exactly as `on_err` does, and the net keeps firing for the exit NOBODY
# recorded: the ERR trap, or an exit the lane did not itself request.
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
# THE SESSION-STORE SNAPSHOT, taken BEFORE the TUI can create a session of its own. The product draws
# the CALLING session's team (the user-required behaviour this wave landed), so the board seeded in
# 4a must be BOUND to the session THIS boot creates — and that id is knowable only from the harness's
# own store, `<DSH_HOME>/sessions/<projectKey(cwd)>/<sessionId>/`. Everything already in the store at
# this instant belongs to a SIBLING session (the Web lane runs before this step and creates one), which
# is exactly what the "another session's board is invisible" arm needs — so this one snapshot answers
# both questions at once, and both answers come from the harness's own artifacts, never from a guess:
# the session that APPEARS while the TUI boots is the TUI's, and the ones already here are someone
# else's. (MEASURED 2026-10-08 on the frozen revision: the Web lane held
# `session-5cc7bb93-9e5d-407f-922c-9a581fe18975` while the TUI session was
# `7d2ced5c-bcf5-4a8f-b03c-4be6ad1ee606` — a different id, so the TUI really does create its own.)
SESSIONS_BEFORE="$TUI_DIR/sessions-before.txt"
: > "$SESSIONS_BEFORE"
if [ -d "$DSH_HOME/sessions" ]; then
  # `<projectKey>/<sessionId>` pairs, the shape the store itself uses. No reader exits early here
  # (`sort` and `sed` read their whole input), so `pipefail` cannot turn a SIGPIPE into an abort.
  (cd "$DSH_HOME/sessions" && find . -mindepth 2 -maxdepth 2 -type d | sed 's#^\./##' | sort) \
    >"$SESSIONS_BEFORE" 2>/dev/null || true
fi
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

# ── 4a. THE TEAM SCENE, on a real terminal (W3) ──────────────────────────────
# The graph is this wave's visual centrepiece and until now only unit arms had ever drawn it: the
# arms render the component through a host DOUBLE, so no real terminal had produced a single box. The
# record is written FIRST, because a scene with no team correctly renders its empty state and proving
# that would prove nothing about the drawing.
#
# AND IT MUST BE BOUND TO THIS SESSION — F1 of the 2026-10-08 repair, `evidence/docker/client-install/
# 2026-10-08T08-52-23Z`. The board below used to be seeded and then left bound to NOBODY (the index was
# written as `{"version":1,"active":{}}`), which was invisible only while the product drew the
# workspace's PRINCIPAL record. The wave deliberately changed that — the TUI draws the CALLING
# session's team — so an unbound fixture is now correctly invisible and the lane, not the product, had
# to catch up. The binding is written the way the PRODUCT's own creation path writes it
# (`packages/mpd-team-core-plugin/src/team-store.ts :: createTeam`): the index entry
# `active[sessionKey(leadSessionId)] = teamId` (`bindActiveTeam`) AND the record's
# `leadSessionId = sessionKey(leadSessionId)`. Both, because the product's own reader resolves through
# both: the `mpdTeams` service answers from the INDEX (`activeTeamId`), and its session-scoped
# degradation path matches the RECORD's `leadSessionId` against the calling session.
mkdir -p "$WORK_DIR/ws/.mpd/team/teams"
# THE `leadSessionId` BELOW IS A PLACEHOLDER AND IS EXPECTED TO BE REPLACED before `/mpd team` is
# sent: the binding step right after this heredoc rewrites it to the LIVE session id the boot
# discovered. A run that fails to discover one leaves this literal visible, which is the honest
# "unbound fixture" state rather than a plausible-looking fake id.
cat >"$WORK_DIR/ws/.mpd/team/teams/tui-scene.json" <<'TEAMJSON'
{
  "version": 1,
  "teamId": "tui-scene",
  "name": "Scene Smoke",
  "description": "proves the graph draws on a real terminal",
  "leadSessionId": "unbound-fixture",
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

# ── (i) WHICH SESSION IS THIS? — discovered from the harness's own store, then BOUND ───────────
# The id is never guessed and never defaulted: the store is read twice (the pre-boot snapshot taken
# above and the store as it is now) and the difference IS this boot's session. A store that has not
# been written yet is polled rather than worked around, because a wrong id here would silently turn
# every team-scene arm below into a claim about a board this session does not own.
SESSION_PROBE="$TUI_DIR/session-resolve.ts"
cat > "$SESSION_PROBE" <<'SESSION_PROBE_EOF'
// Which session does THIS TUI run as, and bind the lane's team fixture to it.
//
// WHY THIS EXISTS: the product draws the CALLING session's team, and a fixture is not something a
// session approved — so an unbound board is CORRECTLY invisible and the lane must bind it to the id
// the TUI runs as. The key rule is the PRODUCT'S OWN: `sessionKey` is imported from
// `packages/mpd-team-core-plugin/src/team-store.ts` (the module `createTeam` binds through), so no key
// format is invented here.
//
// PROTOCOL: exactly ONE TAB-separated line on stdout per mode — the whole contract with the lane.
//   resolve <appDir> <dshHome> <workspace> <snapshotFile>
//     -> <sessionId> <source> <projectKey> <others> <detail>
//   bind <appDir> <workspace> <sessionId> <teamId> <recordFile>
//     -> <bound> <sessionKey> <detail>
//   index <appDir> <workspace> <sessionId> <teamId>
//     -> <written> <sessionKey> <activeJson>
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

/**
 * Print the ONE protocol line and exit.
 * @param line The tab-separated fields this mode answers with.
 * @returns Never: the process exits here.
 */
function answer(line: string): never {
  process.stdout.write(line + "\n")
  process.exit(0)
}

/**
 * Every `<projectKey>/<sessionId>` pair the store holds right now, sorted.
 * @param dshHome The harness home whose `sessions` store is listed.
 * @returns The pairs; empty when the store does not exist and for every unreadable entry.
 */
function sessionDirs(dshHome: string): string[] {
  /** The `<dshHome>/sessions` root; absent until a boot writes its first store. */
  const root = join(dshHome, "sessions")
  /** The pairs found so far. */
  const found: string[] = []
  if (!existsSync(root)) return found
  for (const key of readdirSync(root)) {
    /** One project key's directory. */
    const keyDir = join(root, key)
    try { if (!statSync(keyDir).isDirectory()) continue } catch { continue }
    for (const id of readdirSync(keyDir)) {
      try { if (statSync(join(keyDir, id)).isDirectory()) found.push(key + "/" + id) } catch { /* raced */ }
    }
  }
  return found.sort()
}

/**
 * The non-empty lines of the lane's pre-boot snapshot.
 * @param file The snapshot file the lane wrote before the boot.
 * @returns The trimmed lines; empty when the file is unreadable.
 */
function snapshotLines(file: string): string[] {
  try {
    return readFileSync(file, "utf8").split("\n").map((line) => line.trim()).filter((line) => line !== "")
  } catch { return [] }
}

/**
 * The product's own `sessionKey`, imported from the checkout this container installed.
 * @param appDir The checkout root (`$APP_DIR`, which carries `packages/`).
 * @returns The key function plus the witness naming where that rule came from.
 */
async function productSessionKey(appDir: string): Promise<{ key: (sessionId: string | undefined) => string; source: string }> {
  /** The store module `createTeam` binds through, run from SOURCE (node strips the types). */
  const modulePath: string = join(appDir, "packages", "mpd-team-core-plugin", "src", "team-store.ts")
  try {
    /** The imported namespace, read field by field so a shape change cannot pass as the rule. */
    const mod: Record<string, unknown> = await import(pathToFileURL(modulePath).href) as Record<string, unknown>
    if (typeof mod.sessionKey === "function") {
      /** The product's own function, called through a cast because the import is untyped here. */
      const sessionKey = mod.sessionKey as (sessionId: string | undefined) => unknown
      return { key: (sessionId) => String(sessionKey(sessionId)), source: "import:packages/mpd-team-core-plugin/src/team-store.ts#sessionKey" }
    }
  } catch { /* the literal below is the same rule for every input that can occur here */ }
  // A FALLBACK THAT INVENTS NO RULE: `sessionKey` answers the id ITSELF for every non-empty string and
  // `"workspace"` only for an empty one, and a store directory name is never empty — so the two agree
  // on every input this probe can produce, and the witness says which of them ran.
  return { key: (sessionId) => (typeof sessionId === "string" && sessionId !== "" ? sessionId : "workspace"), source: "literal:non-empty-id-else-workspace (the import was unreachable)" }
}

/**
 * Read one JSON object.
 * @param path The file to read.
 * @returns The parsed object, or `undefined` when the file is absent or is not a plain object.
 */
function readJsonObject(path: string): Record<string, unknown> | undefined {
  try {
    /** The parsed value, usable only when it is a plain object. */
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined
  } catch { return undefined }
}

/**
 * The index file of a workspace, at the path the product's own `teamsIndexPath` names.
 * @param workspace The workspace whose `.mpd/team` tree is written.
 * @returns The absolute path of `teams.json`.
 */
function indexPathOf(workspace: string): string {
  return join(workspace, ".mpd", "team", "teams.json")
}

/**
 * Set one session's binding in the index, preserving every other entry.
 * @param workspace The workspace whose index is edited.
 * @param key The session key (the product's own rule produced it).
 * @param teamId The team id to bind.
 * @returns The `active` map read back from disk after the write.
 */
function writeIndexEntry(workspace: string, key: string, teamId: string): Record<string, string> {
  /** The file this call edits. */
  const indexPath: string = indexPathOf(workspace)
  /** The index as it is, or an empty one when it is absent or its shape is unusable. */
  const index: Record<string, unknown> = readJsonObject(indexPath) ?? { version: 1, active: {} }
  /** The `active` map, replaced when the file's own is unusable. */
  const active: Record<string, string> = (index.active !== null && typeof index.active === "object" && !Array.isArray(index.active))
    ? index.active as Record<string, string> : {}
  active[key] = teamId
  // The product's own writer shape (`writeJson`): two-space JSON with a trailing newline.
  writeFileSync(indexPath, JSON.stringify({ version: 1, active }, null, 2) + "\n")
  /** The map READ BACK from disk, so the answer is a fact rather than this write's intention. */
  const readBack: Record<string, unknown> | undefined = readJsonObject(indexPath)
  return (readBack?.active ?? {}) as Record<string, string>
}

/** The mode the lane asked for, and its arguments. */
const [mode, ...args]: string[] = process.argv.slice(2)

if (mode === "resolve") {
  /** `resolve <appDir> <dshHome> <workspace> <snapshotFile>`. */
  const [appDir, dshHome, workspace, snapshotFile] = args
  /** The pairs present at the pre-boot snapshot: every one of them is SOMEBODY ELSE's session. */
  const before: string[] = snapshotLines(snapshotFile)
  /** The pairs present now. */
  const after: string[] = sessionDirs(dshHome)
  /** The pairs this boot added. */
  const created: string[] = after.filter((pair) => !before.includes(pair))
  /** This workspace's project key, imported so the PATH shape is the harness's own. */
  let projectKey = ""
  try {
    /** The isolation helper that owns the directory-key rule. */
    const iso: Record<string, unknown> = await import(pathToFileURL(join(appDir, "skills", "dsh-qa", "scripts", "lib", "workspace-isolation.ts")).href) as Record<string, unknown>
    if (typeof iso.projectKey === "function") projectKey = String((iso.projectKey as (cwd: string) => unknown)(workspace))
  } catch { /* an empty key only narrows the fallbacks, it never widens the answer */ }
  /** The session ids already present under THIS key, i.e. genuine sibling sessions of this workspace. */
  const others: string[] = projectKey === "" ? [] : before.filter((pair) => pair.startsWith(projectKey + "/")).map((pair) => pair.slice(pair.indexOf("/") + 1))
  /** The created pair under this key, then any created pair: order is the preference. */
  const pick: string | undefined = (projectKey === "" ? undefined : created.filter((pair) => pair.startsWith(projectKey + "/"))[0]) ?? created[0]
  /** The id of the picked pair, or an empty string when this boot created none yet. */
  const sessionId: string = pick === undefined ? "" : pick.slice(pick.indexOf("/") + 1)
  /** How the id was obtained: stated, never assumed. */
  const source: string = pick === undefined ? "none"
    : (projectKey !== "" && pick.startsWith(projectKey + "/") ? "created-during-this-boot-under-this-project-key" : "created-during-this-boot-other-project-key")
  answer([
    sessionId, source, projectKey, others.join(","),
    "store=" + join(dshHome, "sessions") + ";before=" + String(before.length) + ";after=" + String(after.length) + ";created=" + created.join(","),
  ].join("\t"))
}

if (mode === "bind") {
  /** `bind <appDir> <workspace> <sessionId> <teamId> <recordFile>`. */
  const [appDir, workspace, sessionId, teamId, recordFile] = args
  if (sessionId === "" || sessionId === undefined) answer(["false", "", "no-session-id-discovered"].join("\t"))
  /** The product's own key rule. */
  const rule = await productSessionKey(appDir)
  /** The key the product's own rule produces for this session. */
  const key: string = rule.key(sessionId)
  /** The `active` map as it stands on disk after the index write. */
  const active: Record<string, string> = writeIndexEntry(workspace, key, teamId)
  /** The fixture record, rewritten so its OWN `leadSessionId` names this session too. */
  const record: Record<string, unknown> | undefined = readJsonObject(recordFile)
  if (record !== undefined) {
    record.leadSessionId = key
    writeFileSync(recordFile, JSON.stringify(record, null, 2) + "\n")
  }
  /** The record READ BACK, so the answer covers the bytes on disk. */
  const readBack: Record<string, unknown> | undefined = readJsonObject(recordFile)
  /** Both spellings the product's own `createTeam` writes must hold, or the binding is not a binding. */
  const bound: boolean = active[key] === teamId && readBack?.leadSessionId === key
  answer([
    String(bound), key,
    "index=" + indexPathOf(workspace) + ";active=" + JSON.stringify(active) + ";recordLeadSessionId=" + String(readBack?.leadSessionId ?? "(absent)") + ";keySource=" + rule.source,
  ].join("\t"))
}

if (mode === "index") {
  /** `index <appDir> <workspace> <sessionId> <teamId>`: bind a DIFFERENT session's board. */
  const [appDir, workspace, sessionId, teamId] = args
  /** The product's own key rule. */
  const rule = await productSessionKey(appDir)
  /** The key the product's own rule produces for that session. */
  const key: string = rule.key(sessionId)
  /** The `active` map read back from disk. */
  const active: Record<string, string> = writeIndexEntry(workspace, key, teamId)
  answer([String(active[key] === teamId), key, JSON.stringify(active)].join("\t"))
}

answer(["", "unknown-mode", "usage: resolve|bind|index"].join("\t"))
SESSION_PROBE_EOF

# THE POLL: the TUI writes its store record as it boots, so this waits for the pair to APPEAR rather
# than falling back to "the newest session here" — which, before the TUI has written anything, is the
# WEB lane's session, and binding THAT would leave the scene correctly empty while looking like a fix.
LIVE_SESSION_ID=""
LIVE_SESSION_SOURCE="none"
LIVE_SESSION_PROJECT_KEY=""
OTHER_SESSION_IDS=""
RESOLVE_DETAIL=""
for _ in $(seq 1 15); do
  RESOLVE_TSV="$(node "$SESSION_PROBE" resolve "$APP_DIR" "$DSH_HOME" "$WORK_DIR/ws" "$SESSIONS_BEFORE" 2>>"$TUI_DIR/session-probe.err" || true)"
  IFS=$'\t' read -r LIVE_SESSION_ID LIVE_SESSION_SOURCE LIVE_SESSION_PROJECT_KEY OTHER_SESSION_IDS RESOLVE_DETAIL <<<"$RESOLVE_TSV" || true
  [ -n "${LIVE_SESSION_ID:-}" ] && break
  sleep 3
done

# ── THE RECORD'S OWN TASK TABLE, read ONCE for EVERY arm that judges a drawing ──────────────────
# The arms take their expected values from the fixture this lane just wrote, never from a literal: a
# hard-coded id, or a hard-coded `3`, keeps passing after the renderer silently drops a task — which is
# exactly how the arm this replaces outlived the drawing it was written for. It is read HERE, before the
# first scene is opened, because the empty-state arm below asserts the ABSENCE of these same ids.
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

# ── (i-bis) ANOTHER SESSION'S BOARD IS NOT THIS SESSION'S BOARD (required behaviour 3) ──────────
# WHAT THIS PROVES: the product draws the CALLING session's team, so a session with NO bound board must
# draw the honest empty state and must NOT draw a board another session approved.
# WHY IT RUNS HERE, BEFORE the binding below: the state under test is "THIS session owns nothing while a
# SIBLING owns a board". Once the binding has run this session owns one too and the state is
# unreachable — the product's own writer (`writeIndexEntry`) only ADDS an index entry, so it cannot
# spell an unbind.
# THE INSTRUMENT IS THE ONE ALREADY CAPTURED: `resolve` above returned `OTHER_SESSION_IDS`, the
# `<projectKey>/<sessionId>` pairs the store held BEFORE this boot (in a full run, the Web lane's
# session), and the probe's `index` mode binds a team to a DIFFERENT session — exactly the state.
# NON-VACUITY IS PART OF THE ARM, not an assumption: a run whose `OTHER_SESSION_IDS` is empty has no
# other board to be invisible, so the row records `null` with that reason rather than passing on an
# assertion that could not have failed (the false-pass class the lane's ERR/EXIT header was written
# against).
# THE MARKER IS THE PRODUCT'S OWN: `NO_SESSION_TEAM_MARKER` is exported by
# `packages/mpd-tui-plugin/src/team-state.ts:57` and is the string every session-empty surface draws. It
# is READ OUT OF THAT SOURCE at run time instead of being retyped, so a product that moves the constant
# moves this arm with it, and the test is a SUBSTRING test because the real pane line carries a suffix
# (`… — stage one with agent_teams_plan, then approve it`). (Importing the export is impossible inside a
# container: `src/team-state.ts` imports sibling `src/*.js` specifiers that exist only after a build,
# and the built `dist/index.js` does not re-export the constant — both measured 2026-10-08. The source
# declaration is therefore the only reachable spelling, and an unreadable one reddens this row as null.)
OTHER_SESSION_ID="${OTHER_SESSION_IDS%%,*}"
OTHER_BOUND="false"
OTHER_KEY=""
OTHER_INDEX_DETAIL="no-index-attempted"
if [ -n "${OTHER_SESSION_ID:-}" ]; then
  OTHER_INDEX_TSV="$(node "$SESSION_PROBE" index "$APP_DIR" "$WORK_DIR/ws" "$OTHER_SESSION_ID" tui-scene 2>>"$TUI_DIR/session-probe.err" || true)"
  IFS=$'\t' read -r OTHER_BOUND OTHER_KEY OTHER_INDEX_DETAIL <<<"$OTHER_INDEX_TSV" || true
fi

# The product's empty-state marker, derived from its own source declaration — never a literal here.
MARKER_PROBE="$TUI_DIR/team-marker.ts"
cat > "$MARKER_PROBE" <<'MARKER_PROBE_EOF'
// The text of the product's `NO_SESSION_TEAM_MARKER`, read from the product's OWN source declaration so
// this lane cannot drift from the constant the product's `test/session-scope.test.ts` asserts on.
// PROTOCOL: ONE tab-separated line on stdout — the marker text, then the site it was read from. An
// empty first field means the declaration was not found and the lane must record an unmade
// measurement rather than fall back to a retyped string.
import { readFileSync } from "node:fs"
import { join } from "node:path"
const [appDir] = process.argv.slice(2)
const file = join(appDir, "packages", "mpd-tui-plugin", "src", "team-state.ts")
const site = "packages/mpd-tui-plugin/src/team-state.ts#NO_SESSION_TEAM_MARKER"
const text = readFileSync(file, "utf8")
const match = /^export const NO_SESSION_TEAM_MARKER = "([^"]*)"$/m.exec(text)
process.stdout.write([match === null ? "" : match[1], site].join("\t") + "\n")
MARKER_PROBE_EOF
OTHER_MARKER=""
OTHER_MARKER_SITE="none"
MARKER_TSV="$(node "$MARKER_PROBE" "$APP_DIR" 2>"$TUI_DIR/team-marker.err" || true)"
IFS=$'\t' read -r OTHER_MARKER OTHER_MARKER_SITE <<<"$MARKER_TSV" || true

# THE PANE IS CAPTURED ONLY ONCE THE STATE UNDER TEST REALLY EXISTS: the sibling id must differ from the
# session this TUI runs as, the sibling's key must be the one the index now carries, and the marker must
# have been read. Anything less is an unmade measurement, and no pane is judged.
OTHER_PANE_FILE="$TUI_DIR/pane-teamOtherSession.txt"
OTHER_PANE=""
OTHER_CORNERS=0
OTHER_IDS_DRAWN=""
OTHER_STATE_READY="false"
if [ -n "${OTHER_SESSION_ID:-}" ] && [ "${OTHER_SESSION_ID:-}" != "${LIVE_SESSION_ID:-}" ] \
  && [ "${OTHER_BOUND:-false}" = "true" ] && [ -n "${OTHER_KEY:-}" ] && [ -n "${OTHER_MARKER:-}" ]; then
  OTHER_STATE_READY="true"
  tmux -S "$SOCK" send-keys -t tui "/mpd team" Enter 2>/dev/null || true
  sleep 6
  capture_pane teamOtherSession
  OTHER_PANE="$(cat "$OTHER_PANE_FILE" 2>/dev/null || true)"
  # The corner census is an OBSERVATION of the same pane, not a third verdict: the two asserted
  # directions are the marker's presence and the foreign ids' absence below.
  OTHER_CORNERS=$(( $(pane_glyphs '╭' "$OTHER_PANE_FILE") + $(pane_glyphs '╮' "$OTHER_PANE_FILE") + $(pane_glyphs '╰' "$OTHER_PANE_FILE") + $(pane_glyphs '╯' "$OTHER_PANE_FILE") ))
  # The NODE-LABEL predicate is the content arm's own (`[^ ] <id> +│`, clause AC1's `<marker> <id>`
  # inside a box) — the shape this pane is PROVEN not to carry in the empty state: the F1 run reported
  # `missing=[T1,T2,T3]` on exactly this state, so a hit here means the foreign board was really drawn.
  # An `if` rather than `grep … && …`: the body must END on a zero status, or a pane with no foreign id
  # (the expected case) would hand the ERR trap a non-zero loop status to act on.
  while IFS=$'\t' read -r id subject; do
    [ -n "$id" ] || continue
    if printf '%s' "$OTHER_PANE" | grep -qE "[^ ] $id +│"; then
      OTHER_IDS_DRAWN="${OTHER_IDS_DRAWN}${OTHER_IDS_DRAWN:+,}${id}"
    fi
  done <<<"$TEAM_TASKS"
  # Close the scene again: the arms below open it for THEIR state, and this lane never sends two opens
  # without a close between them.
  tmux -S "$SOCK" send-keys -t tui Escape 2>/dev/null || true
  sleep 2
fi

OTHER_RAW="otherSession=${OTHER_SESSION_ID:-none} liveSession=${LIVE_SESSION_ID:-none} otherKey=${OTHER_KEY:-none} index=${OTHER_INDEX_DETAIL:-none} marker=[${OTHER_MARKER:-none}] markerSite=${OTHER_MARKER_SITE:-none} assertedAbsent=[${TEAM_IDS_SEEN:-none}] foundDrawn=[${OTHER_IDS_DRAWN:-none}] corners=${OTHER_CORNERS} pane=pane-teamOtherSession.txt"
if [ -z "${OTHER_SESSION_ID:-}" ]; then
  record tui.teamSceneOtherSessionInvisible null \
    "NOT MEASURED: this boot found no SIBLING session under this workspace's project key, so there IS no other session's board to be invisible and the absence direction would have asserted nothing — an unmade measurement, never a pass" \
    "$OTHER_RAW"
elif [ "${OTHER_STATE_READY:-false}" != "true" ]; then
  record tui.teamSceneOtherSessionInvisible null \
    "NOT MEASURED: the state under test could not be built — the foreign board bound as bound=${OTHER_BOUND:-false} to key=${OTHER_KEY:-none} (${OTHER_INDEX_DETAIL:-none}) for sibling session ${OTHER_SESSION_ID} while this TUI runs as ${LIVE_SESSION_ID:-none}, and the product's NO_SESSION_TEAM_MARKER was read as [${OTHER_MARKER:-none}] from ${OTHER_MARKER_SITE:-none}" \
    "$OTHER_RAW"
elif printf '%s' "$OTHER_PANE" | grep -qF "$OTHER_MARKER" && [ -z "$OTHER_IDS_DRAWN" ]; then
  record tui.teamSceneOtherSessionInvisible true \
    "a session with NO bound board drew the product's OWN empty-state marker, and the board a SIBLING session owns was NOT drawn in it: the marker is the exported constant NO_SESSION_TEAM_MARKER read out of its source declaration and matched as a SUBSTRING of the captured pane, and none of the ${TEAM_TASK_COUNT} task id(s) the sibling's record carries appeared in that same pane as a node label" \
    "$OTHER_RAW"
else
  record tui.teamSceneOtherSessionInvisible false \
    "the session-empty state did NOT hold: the marker [${OTHER_MARKER:-none}] is absent from the captured pane (markerHits=$(printf '%s' "$OTHER_PANE" | grep -cF "${OTHER_MARKER:-no-marker-read}" || true)) and/or the SIBLING session's board WAS drawn — ids found as node labels=[${OTHER_IDS_DRAWN:-none}] out of [${TEAM_IDS_SEEN:-none}], rounded corners on the pane=${OTHER_CORNERS}" \
    "$OTHER_RAW"
fi

# ── (ii) THE BINDING ITSELF, written the way the product's OWN creation path writes it ─────────
# `createTeam` (`team-store.ts`) does two things with one session id, and the fixture does both:
#   * `leadSessionId: sessionKey(input.leadSessionId)` — the record names the session, which is what the
#     session-scoped degradation path matches (`sessionRecord` → `records.find(… leadSessionId …)`);
#   * `bindActiveTeam(workspace, input.leadSessionId, teamId)` — the index maps
#     `active[sessionKey(sessionId)] = teamId`, which is what the `mpdTeams` service answers from
#     (`activeTeamId`).
# Writing only one of the two would leave the board reachable through ONE of the product's two readers.
BIND_BOUND="false"
BIND_KEY=""
BIND_DETAIL=""
if [ -n "${LIVE_SESSION_ID:-}" ]; then
  BIND_TSV="$(node "$SESSION_PROBE" bind "$APP_DIR" "$WORK_DIR/ws" "$LIVE_SESSION_ID" tui-scene \
    "$WORK_DIR/ws/.mpd/team/teams/tui-scene.json" 2>>"$TUI_DIR/session-probe.err" || true)"
  IFS=$'\t' read -r BIND_BOUND BIND_KEY BIND_DETAIL <<<"$BIND_TSV" || true
fi
BIND_RAW="session=${LIVE_SESSION_ID:-none} source=${LIVE_SESSION_SOURCE:-none} projectKey=${LIVE_SESSION_PROJECT_KEY:-none} ${BIND_DETAIL:-no-bind-attempted} resolve=${RESOLVE_DETAIL:-none}"
if [ "${BIND_BOUND:-false}" = "true" ]; then
  record tui.teamFixtureBound true \
    "the seeded board is bound to the LIVE session this TUI runs as — the id discovered from the harness's OWN store (a pre-boot snapshot differenced against the store as it is now, so the id that APPEARED during this boot is the TUI's) and keyed through the PRODUCT's own rule, imported from packages/mpd-team-core-plugin/src/team-store.ts :: sessionKey. Both spellings the product's own createTeam writes are on disk: teams.json's active[<sessionKey>] = \"tui-scene\" AND the record's leadSessionId = <sessionKey>, because the product has two readers (the mpdTeams service answers from the index; its session-scoped degradation matches the record's leadSessionId). WITHOUT this binding the scene correctly draws its empty state and every team arm below reddens — which is exactly the F1 defect of evidence/docker/client-install/2026-10-08T08-52-23Z" \
    "$BIND_RAW"
elif [ -z "${LIVE_SESSION_ID:-}" ]; then
  record tui.teamFixtureBound null \
    "the fixture could NOT be bound: this boot created no new session under <DSH_HOME>/sessions while the poll ran, so the id the TUI runs as is not knowable here — an unmade measurement, never a pass. Every team-scene arm below reads a board bound to no session, which is why they are about to redden for THIS reason and not for a drawing defect" \
    "$BIND_RAW"
else
  record tui.teamFixtureBound false \
    "the fixture was NOT bound to $LIVE_SESSION_ID: the read-back does not carry BOTH spellings on disk (expected teams.json active[<sessionKey>] = \"tui-scene\" AND the record's leadSessionId = <sessionKey>) — the scene will draw its empty state whatever the drawing code does" \
    "$BIND_RAW"
fi

tmux -S "$SOCK" send-keys -t tui "/mpd team" Enter 2>/dev/null || true
sleep 6
capture_pane team
TEAM_PANE="$(cat "$TUI_DIR/pane-team.txt" 2>/dev/null || true)"

# The record's own task table, id list and count are read ABOVE — before the first scene is opened,
# because the empty-state arm asserts the ABSENCE of these same ids. They are reused here, never
# re-derived: a second reader could answer a different question than the one the arms judge.
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
  # The 0.13.0+ branch records NOTHING here any more: it used to write `tui.mergedPanelOpens` as NULL on
  # the ground that "a host-ACCEPTED open() changes zero bytes of a tmux capture", which the
  # authoritative run's own `pane-merged.txt` REFUTES (see the classifier block below). The
  # discriminator still matters, because it selects the marker FAMILY the classifier uses — the sidebar
  # panel body on `present`, the pre-0.13 full-screen scene's strings on `absent`.
  # Focus is given back to the composer before the combo is sent, because the host's own shortcut
  # registry matches shortcuts only in the plain chat state.
  tmux -S "$SOCK" send-keys -t tui Escape 2>/dev/null || true
  sleep 2
fi
tmux -S "$SOCK" send-keys -t tui M-a 2>/dev/null || true
sleep 5
capture_pane merged
MERGED_PANE="$TUI_DIR/pane-merged.txt"

# (1) THE PANEL OPENED — and it is the MERGED one, not the team scene it came from.
#
# WHAT CHANGED AND WHY (2026-10-09, §4 S-B criterion 4). This block used to record BOTH rows as NULL on
# any host offering the panel seam, on the recorded ground that "a host-ACCEPTED open() changes zero
# bytes of a tmux capture". That ground was measured on the PRE-0.13 full-screen scene and never
# re-measured after dsh-tui moved the merged view into a SIDEBAR PANEL: the authoritative run's own
# `tui-panes/pane-merged.txt` carries the entire panel body (the tab bar with MPD's tab active, the
# `┌MPD` border, the host's `subagents  0 total` summary, `No subagents in the current session`, MPD's
# `team … phase active  tasks 1/3  members 2` header, the T1/T2/T3 DAG and `view boxes · 3 tasks · ranks
# derived`) on a 218-column pane, while the PRE-KEY capture `pane-teamClosed.txt` carries none of it.
# The rows were structurally unmeasurable, not physically so, and a null there was reading as a bound.
#
# THE CLASSIFIER IS SHARED WITH THE OFFLINE FALSIFIER (`docker/lib/tui-panel-body.ts`, exercised by
# `scripts/docker-e2e.ts --self-test` on planted panes) so the two can never drift: the shell keeps no
# marker of its own, it only reads the module's verdict. THE PRE-KEY CAPTURE IS THE CONTROL — if that
# pane already carries the panel body, the post-key pane proves nothing and the module says FALSE, which
# is exactly how this row REDDENS when the capture order or the keypress is broken.
#
# The marker FAMILY is chosen by the SAME seam discriminator the sandbox lanes use (`PANEL_SEAM`, read
# from the composed host row AND the shipped module): `present` is the 0.13.0+ sidebar panel body, and
# `absent` is the pre-0.13 full-screen scene's strings, so a host without the seam keeps its old meaning.
MERGED_PANE="$TUI_DIR/pane-merged.txt"
MERGED_TEAMCLOSED_PANE="$TUI_DIR/pane-teamClosed.txt"
MERGED_PANEL_JSON="$TUI_DIR/merged-panel.json"
node "$LIB_DIR/tui-panel-body.ts" \
  --pane "$MERGED_PANE" --control "$MERGED_TEAMCLOSED_PANE" --shape "$PANEL_SEAM" \
  --json "$MERGED_PANEL_JSON" > "$TUI_DIR/merged-panel.log" 2>&1 || true
# The classifier's own artifacts travel with the panes, so a reader re-reads the exact measurement and
# its control out of the EVIDENCE tree rather than out of a container-internal path.
cp "$MERGED_PANEL_JSON" "$PANE_DIR/merged-panel.json" 2>/dev/null || true
cp "$TUI_DIR/merged-panel.log" "$PANE_DIR/merged-panel.log" 2>/dev/null || true
MERGED_PANEL_LOG="$(cat "$TUI_DIR/merged-panel.log" 2>/dev/null || true)"
# The verdicts and their witnesses come ONLY from the module's printed contract, never from a re-grep:
# one classifier, one truth, and the offline falsifier grades the same code path.
MERGED_PANEL_OPENS="$(printf '%s\n' "$MERGED_PANEL_LOG" | grep -m1 -oE '^\[tui-panel\] OPENS=(true|false)$' | sed 's/.*=//' || true)"
MERGED_PANEL_ORDER="$(printf '%s\n' "$MERGED_PANEL_LOG" | grep -m1 -oE '^\[tui-panel\] ORDER=(true|false)$' | sed 's/.*=//' || true)"
MERGED_PANEL_REASON="$(printf '%s\n' "$MERGED_PANEL_LOG" | grep -m1 -oE '^\[tui-panel\] REASON=.*' | sed 's/^\[tui-panel\] REASON=//' || true)"
MERGED_PANEL_HITS="$(printf '%s\n' "$MERGED_PANEL_LOG" | grep -m1 -oE '^\[tui-panel\] TITLE_HITS=.*' | sed 's/^\[tui-panel\] //' || true)"
MERGED_PANEL_LINES="$(printf '%s\n' "$MERGED_PANEL_LOG" | grep -m1 -oE '^\[tui-panel\] SUB_LINE=.*' | sed 's/^\[tui-panel\] //' || true)"
MERGED_ORDER_RAW="panelSeam=$PANEL_SEAM driver=docker/lib/tui-panel-body.ts $MERGED_PANEL_HITS $MERGED_PANEL_LINES pane=pane-merged.txt control=pane-teamClosed.txt chars=$(wc -c <"$MERGED_PANE" 2>/dev/null || echo 0) controlChars=$(wc -c <"$MERGED_TEAMCLOSED_PANE" 2>/dev/null || echo 0)"
if [ "$MERGED_PANEL_OPENS" = "true" ]; then
  record tui.mergedPanelOpens true \
    "the MPD combo (alt+a, sent as tmux M-a from the plain chat state) opened the MERGED panel on a real terminal, and the PRE-KEY capture proves the combo is what opened it: ${MERGED_PANEL_REASON}" \
    "$MERGED_ORDER_RAW"
else
  record tui.mergedPanelOpens false \
    "the MPD combo did NOT open the merged panel on the captured pane, or the capture cannot attribute the panel to the combo: ${MERGED_PANEL_REASON}" \
    "$MERGED_ORDER_RAW log=$(printf '%s' "$MERGED_PANEL_LOG" | tr '\n' ' ' | tr -d '"\\')"
fi

# (2) THE ROW ORDER on the CAPTURED pane: the subagent section above the team section. The branch
# actually measured is stated in the module's own reason (this session carries no host subagent ROW, so
# the host's EMPTY-STATE line is the marker; a session with a row uses the section header instead).
if [ "$MERGED_PANEL_ORDER" = "true" ]; then
  record tui.mergedPanelOrder true \
    "the captured pane holds the subagent section ABOVE the team body — measured on the same pane the open row reads: ${MERGED_PANEL_REASON}" \
    "$MERGED_ORDER_RAW"
else
  record tui.mergedPanelOrder false \
    "the subagent section is NOT above the team body on the captured pane (or a marker is missing, or the panel did not open — an order claim about a panel that is not on screen is not a measurement): ${MERGED_PANEL_REASON}" \
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
# The floor is the number of tui.* records this lane REALLY writes BEFORE this exit record (21: the 19
# names the merged-panel group closed on, plus teamFixtureBound and teamSceneOtherSessionInvisible,
# which the F1 repair added — counted from the writers, not guessed). It is pinned so a record that
# silently disappears from the writer reddens instead of shrinking the lane's coverage (measured
# 2026-09-27: all eleven assertions green and the lane still reported laneExit=false — the inverse
# failure). `tui.laneExit` itself is NOT part of it: it is written after this count on either ending.
if [ "${TUI_BAD:-0}" = "0" ] && [ "${TUI_TOTAL:-0}" -ge 21 ]; then
  record tui.laneExit true "the TUI lane ran to completion with every assertion green" "records=$TUI_TOTAL"
  exit 0
fi
record tui.laneExit false "the TUI lane finished with failing or missing assertions" "records=$TUI_TOTAL failed=$TUI_BAD"
# This exit is REQUESTED and the record above already covers it: without this line `on_exit` would read
# an ordinary red ending as the abort it was written to catch, and publish the false second record the
# trap's own comment describes.
LANE_EXIT_RECORDED=1
exit 1
