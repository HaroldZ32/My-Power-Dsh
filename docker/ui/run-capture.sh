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
cd /data && node /data/capture.mjs --base http://127.0.0.1:3080 --token "$TOKEN" --out /data-out/shots --workspace /data/ws
