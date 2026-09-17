#!/bin/bash
cd /root/dshProj/my-power-dsh
sha256sum packages/mpd-agent-teams-plugin/lib/tools.js packages/mpd-agent-teams-plugin/lib/session-start.js packages/mpd-agent-teams-plugin/lib/mpd-deltas.js scripts/verify-docs-parity.mjs scripts/patch-agent-teams-fixes.mjs agent-references/agent-teams-deltas.md VENDOR_LOCK.json skills/dsh-qa/scripts/agent-teams-messaging.mjs 2>&1
node -e 'import("./packages/mpd-agent-teams-plugin/lib/mpd-deltas.js").then(m=>console.log("registry entries:", m.MPD_DELTAS.length))' 2>&1 | tail -1
git rev-parse HEAD
