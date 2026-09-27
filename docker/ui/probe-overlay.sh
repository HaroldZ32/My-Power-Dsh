#!/usr/bin/env bash
export PATH=/opt/toolchain/node/bin:/root/.bun/bin:$PATH
export HOME=/data/home DSH_HOME=/data/dsh-web
pkill -f "dsh --profile web" 2>/dev/null
sleep 2
cd /src || exit 1
dsh --patch /data/overlay.yml --profile web --port 0 --no-open > /data/probe.log 2>&1 &
PID=$!
sleep 25
kill $PID 2>/dev/null
grep -viE "codegraph|watcher|Auto-sync" /data/probe.log | head -25 > /data/probe-head.txt
