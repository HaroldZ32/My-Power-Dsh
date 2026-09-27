#!/usr/bin/env bash
# Container-side helper: boot the Web app with an EXTRA patch overlay, for UI experiments.
# Flag ORDER matters: `--patch` is a launcher flag and must precede `--profile`.
export PATH=/opt/toolchain/node/bin:/root/.bun/bin:$PATH
export HOME=/data/home DSH_HOME=/data/dsh-web
pkill -f "dsh --profile web" 2>/dev/null
sleep 2
cd /src || exit 1
dsh --patch "${1:-/data/overlay.yml}" --profile web --port 3080 --no-open --trusted-host 127.0.0.1:3081 > /data/web-overlay.log 2>&1
