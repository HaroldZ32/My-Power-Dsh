#!/usr/bin/env bash
# Container-side capture runner: boot the Web app, wait for the launch token, drive the browser.
#   run-capture.sh [extra-patch-file]
export PATH=/opt/toolchain/node/bin:/root/.bun/bin:$PATH
export HOME=/data/home DSH_HOME=/data/dsh-web
# Playwright installed its browsers while HOME was /root; look THERE, not under the sandbox HOME.
# The browsers live in the named volume beside the app, so a restart keeps them.
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/data/pw-browsers}"
pkill -f "dsh --profile web" 2>/dev/null
sleep 2
mkdir -p /data/ws
# MEASURED: the app's DEFAULT WORKSPACE comes from its own cwd. Started from /src it answered
# "Unable to create default workspace", and a session created through the API does not appear
# under Sessions until its cwd is a registered Workspace — so the whole GUI review stalled on a
# native directory picker a headless run cannot drive. Starting from a writable scratch
# directory instead is the cheap, non-invasive way in.
# ── workspace fixture ─────────────────────────────────────────────────────────
# A session created through the API does not appear under Sessions until its cwd is a
# registered WORKSPACE, and the UI's own add-workspace path opens a NATIVE directory picker a
# headless run cannot drive. The store is plain JSON, so the fixture writes the record the
# controller projects (`{id, path, title, sessionIds, createdAt, updatedAt}`) into
# `<DSH_HOME>/storages/workspace.json`. This is a UI fixture, not a product claim: what it
# makes visible is the SIDEBAR, which is what the review is about.
WS_ID="ws-mpd-ui"
NOW=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
mkdir -p "$DSH_HOME/storages"
node -e '
const fs = require("node:fs")
const [file, id, path, now] = process.argv.slice(1)
let store = { unit: { name: "workspace", version: 2 }, global: { initialized: true, workspaceIds: [], archivedSessionIds: [], pinnedSessionIds: [] }, tables: { workspaces: {} } }
try { const current = JSON.parse(fs.readFileSync(file, "utf8")); if (current && current.tables) store = current } catch {}
store.tables.workspaces = store.tables.workspaces || {}
store.tables.workspaces[id] = { id, path, title: "ws", sessionIds: [], createdAt: now, updatedAt: now }
store.global.workspaceIds = [id]
fs.writeFileSync(file, JSON.stringify(store, null, 2) + "\n")
' "$DSH_HOME/storages/workspace.json" "$WS_ID" /data/ws "$NOW"
echo "seeded workspace $WS_ID -> /data/ws"

cd /data/ws || exit 1
EXTRA=()
[ -n "${1:-}" ] && [ -f "${1:-}" ] && EXTRA=(--patch "$1")
dsh "${EXTRA[@]}" --profile web --port 3080 --no-open --trusted-host 127.0.0.1:3081 > /data/web.log 2>&1 &
for _ in $(seq 1 90); do sleep 2; grep -q "token=" /data/web.log 2>/dev/null && break; done
TOKEN=$(grep -o "token=[A-Za-z0-9_-]*" /data/web.log | head -1 | cut -d= -f2)
echo "token-len=${#TOKEN}"
[ "${#TOKEN}" -eq 0 ] && { echo "NO TOKEN — boot log:"; tail -12 /data/web.log; exit 1; }
# ── ONE PASS, BECAUSE THE DRIVER SEEDS ITS OWN BOARD ─────────────────────────────────────────────
# MEASURED 2026-10-05: the app renders the NEWEST session of the workspace and the driver creates a
# fresh session every run, so a board seeded BEFORE the run belonged to the previous session — the
# panel showed its empty state, correctly, and the capture read as a broken graph. `capture.mts` now
# seeds the session it just created, right before it reloads the page, which closes that race. The
# tooling it needs lives in /tmp/mpd-fixture (put there by docker/ui/seed-team-fixture.sh).
mkdir -p /data-out/shots
cd /data
# SEED EVERY SESSION OF THE WORKSPACE, HERE, immediately before the browser asks.
#
# WHY NOT EARLIER, AND WHY NOT ONE SESSION: MEASURED 2026-10-05, the app does not render the session a
# caller creates through the RPC — it renders one of its own choosing (observed: the panel requested
# `/plugins/mpd-team/plan?sessionId=<id>` for a session that had never been seeded, while the seeded id
# sat unused on disk). Binding EVERY session in the store removes the guess entirely: whatever the app
# decides to show, its team is there. The fixture is idempotent (one team id, rewritten in place).
# MPD_UI_BOARD picks the shape (`normal` | `malformed`); the driver seeds the same one inside the run,
# so this pre-pass and the graded pass cannot disagree about which board is on screen.
BOARD_KIND="${MPD_UI_BOARD:-normal}"

# ── THE FIXTURE TOOLING MUST EXIST BEFORE THE DRIVER RUNS ─────────────────────────────────────────
# The driver imports `seedBoard` from /tmp/mpd-fixture to bind the board to the session IT observes.
# MEASURED 2026-10-06: that directory is NOT in the named volume — it is written by
# `docker/ui/seed-team-fixture.sh` — so a RECREATED container made the driver log "no board fixture
# available" and the panel rendered its empty state while everything else looked healthy. A hard
# prerequisite is checked here rather than discovered as an empty screenshot.
if [ ! -s /tmp/mpd-fixture/team-fixture.mts ] || [ ! -s /tmp/mpd-fixture/team-fixture-records.mts ]; then
  echo "[capture] fixture tooling absent in /tmp/mpd-fixture — the caller must run docker/ui/seed-team-fixture.sh first" >&2
  echo "[capture] continuing: the panel will render whatever is on disk, and the report will say so" >&2
fi
for sid in $(ls -1 /data/dsh-web/sessions/--data-ws-- 2>/dev/null); do
  node /tmp/mpd-fixture/team-fixture.mts "$sid" /data/ws "$BOARD_KIND" >/dev/null 2>&1 || true
done
echo "[capture] bound the board to $(ls -1 /data/dsh-web/sessions/--data-ws-- | wc -l) session(s)"

# MPD_UI_LANG sets the BROWSER locale, which is what decides the Web plane's language (the harness
# delegates to the browser when no explicit preference is stored). The Chinese run writes to its own
# directory so it cannot overwrite the English artifacts.
LANG_KIND="${MPD_UI_LANG:-}"
OUT_DIR=/data-out/shots
[ -n "$LANG_KIND" ] && OUT_DIR="/data-out/shots-$LANG_KIND"
mkdir -p "$OUT_DIR"
# An ARRAY, not `${VAR:+--flag "$VAR"}`: measured 2026-10-06, that expansion did not survive into the
# child's argv, so the chrome-locale flag was silently dropped and the "Chinese" run wrote its report
# over the English one. An array cannot word-split or vanish.
LANG_ARGS=()
[ -n "$LANG_KIND" ] && LANG_ARGS=(--lang "$LANG_KIND")
# THE README CROPS GO BESIDE THE FULL SHOTS, NOT INSIDE THEM: `--out` is a step-by-step QA record
# whose file names must stay stable for the lanes that compare them, while `--readme` is the curated
# figure set the page links, and it carries the SAME locale split so the two language sets cannot
# overwrite each other.
README_DIR=/data-out/readme
[ -n "$LANG_KIND" ] && README_DIR="/data-out/readme/$LANG_KIND"
node /data/capture.mts --base http://127.0.0.1:3080 --token "$TOKEN" --out "$OUT_DIR" --readme "$README_DIR" --workspace /data/ws --board "$BOARD_KIND" "${LANG_ARGS[@]}"
