#!/usr/bin/env bash
# Container-side capture runner: boot the Web app, wait for its launch token, drive the browser.
#   run-capture.sh [extra-patch-file]
export PATH=/opt/toolchain/node/bin:/root/.bun/bin:$PATH
export HOME=/data/home DSH_HOME=/data/dsh-web
# Playwright installed its browsers while HOME was /root; the app must look THERE, not under the
# sandbox HOME (measured: "Executable doesn't exist at /data/home/.cache/ms-playwright/…").
export PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright
pkill -f "dsh --profile web" 2>/dev/null
sleep 2
mkdir -p /data/ws
cd /src || exit 1
EXTRA=()
[ -n "${1:-}" ] && [ -f "${1:-}" ] && EXTRA=(--patch "$1")
dsh "${EXTRA[@]}" --profile web --port 3080 --no-open --trusted-host 127.0.0.1:3081 > /data/web.log 2>&1 &
for _ in $(seq 1 90); do sleep 2; grep -q "token=" /data/web.log 2>/dev/null && break; done
TOKEN=$(grep -o "token=[A-Za-z0-9_-]*" /data/web.log | head -1 | cut -d= -f2)
echo "token-len=${#TOKEN}"
[ "${#TOKEN}" -eq 0 ] && { echo "NO TOKEN — boot log:"; tail -12 /data/web.log; exit 1; }
cd /data && node /data/capture.mjs --base http://127.0.0.1:3080 --token "$TOKEN" --out /data-out/shots --workspace /data/ws
