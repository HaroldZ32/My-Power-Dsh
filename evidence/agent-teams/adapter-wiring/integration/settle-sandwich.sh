#!/usr/bin/env bash
# Integration lane (t10 / contract lane t8): the settle sandwich AGENTS.md §7 asks for.
# Hash the wave's decisive files, wait 50 s, hash again; start == end proves the revision settled.
set -u
cd "$(dirname "$0")/../../../.." || exit 1
FILES=(
  AGENTS.md
  docs/design.md docs/design.zh-CN.md
  agent-references/agent-teams-deltas.md
  packages/mpd-dsh-adapter-plugin/README.md packages/mpd-dsh-adapter-plugin/README.zh-CN.md
  packages/mpd-dsh-adapter-plugin/src/index.ts packages/mpd-dsh-adapter-plugin/dist/index.js
  packages/mpd-agent-teams-plugin/lib/mpd-adapter-ctx.js
  packages/mpd-agent-teams-plugin/lib/index.js
  packages/mpd-agent-teams-plugin/lib/tools.js
  packages/mpd-agent-teams-plugin/lib/members.js
  packages/mpd-agent-teams-plugin/lib/command.js
  packages/mpd-agent-teams-plugin/lib/capabilities.js
  packages/mpd-agent-teams-plugin/lib/harness-compat.js
  packages/mpd-agent-teams-plugin/lib/mpd-deltas.js
  packages/mpd-agent-teams-plugin/test/adapter-bypass-inventory.test.mjs
  VENDOR_LOCK.json
)
snap() { for f in "${FILES[@]}"; do [ -f "$f" ] && sha256sum "$f"; done; }
echo "=== START $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
snap > /tmp/.t10-start
cat /tmp/.t10-start
sleep 50
echo "=== END $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
snap > /tmp/.t10-end
cat /tmp/.t10-end
echo "=== DIFF (empty == settled) ==="
diff /tmp/.t10-start /tmp/.t10-end && echo "IDENTICAL: start == end"
