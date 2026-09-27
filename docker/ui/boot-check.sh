#!/usr/bin/env bash
export PATH=/opt/toolchain/node/bin:/root/.bun/bin:$PATH
export HOME=/data/home DSH_HOME=/data/dsh-web
pkill -f "dsh --profile web" 2>/dev/null
sleep 2
cd /data/ws || exit 1
timeout 110 dsh --profile web --port 3099 --no-open > /data/roster-boot.log 2>&1
