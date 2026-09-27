#!/usr/bin/env bash
export PATH=/opt/toolchain/node/bin:/root/.bun/bin:$PATH
export HOME=/data/home DSH_HOME=/data/dsh-web
pkill -f "dsh --profile web" 2>/dev/null
sleep 2
cd /src || exit 1
timeout 35 dsh --patch /data/probe.yml --profile web --port 0 --no-open > /data/probe2.log 2>&1
