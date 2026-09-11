#!/usr/bin/env bash
# t5 INDEPENDENT verification driver 5b/5 — `vendor-agent-teams.mjs` must still EXIT 1 when the
# delta guard refuses. Run in a throw-away copy of scripts/ + packages/mpd-agent-teams-plugin/lib,
# so the real adopted files are never touched. Two runs: the F3 refusal fixture (expected exit 1,
# guard message on stderr) and the canonical control (expected exit 0), which proves the exit 1
# is caused by the refusal and not by a broken environment.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../../../.." && pwd)"
EV="$(cd "$HERE/.." && pwd)"
HOST_NM="${DSH_HOST_NM:-/root/.nvm/versions/node/v24.16.0/lib/node_modules/@deepseek-ai/dsh/node_modules}"
LOG="$EV/vendor-refusal.log"
: > "$LOG"

run_case() {
    local mode="$1" # refusal | control
    local sb
    sb="$(mktemp -d /tmp/mpd-t5-vendor-XXXXXX)"
    mkdir -p "$sb/scripts" "$sb/packages/mpd-agent-teams-plugin"
    cp "$REPO/scripts/vendor-agent-teams.mjs" "$REPO/scripts/patch-agent-teams-fixes.mjs" "$REPO/scripts/patch-agent-teams-client.mjs" "$sb/scripts/"
    cp -r "$REPO/packages/mpd-agent-teams-plugin/lib" "$sb/packages/mpd-agent-teams-plugin/lib"
    if [ "$mode" = "refusal" ]; then
        MODE="$mode" FIXTURE="$sb/packages/mpd-agent-teams-plugin/lib/quality-gates.js" node -e '
            const fs = require("node:fs")
            const file = process.env.FIXTURE
            const lines = fs.readFileSync(file, "utf8").split("\n")
            const begin = lines.findIndex((line) => /^\s*\/\/#region mpd-delta scope-glob \(/.test(line))
            const end = lines.findIndex((line, at) => at > begin && line.trim() === "//#endregion mpd-delta scope-glob")
            lines.splice(end, 1)
            lines.splice(begin, 1)
            fs.writeFileSync(file, lines.join("\n"))
        '
    fi
    local sha_before sha_after
    sha_before="$(sha256sum "$sb/packages/mpd-agent-teams-plugin/lib/quality-gates.js" | awk '{print $1}')"
    (
        cd "$sb" && DSH_HOST_NM="$HOST_NM" timeout 420 node scripts/vendor-agent-teams.mjs
    ) > "$EV/vendor-refusal.$mode.log" 2>&1
    local rc=$?
    sha_after="$(sha256sum "$sb/packages/mpd-agent-teams-plugin/lib/quality-gates.js" | awk '{print $1}')"
    {
        echo "=== case=$mode exit=$rc ==="
        echo "quality-gates.js sha before=$sha_before after=$sha_after"
        echo "guard-refusal line(s):"
        grep -c "mpd delta guard refused the healed tree" "$EV/vendor-refusal.$mode.log" || true
        grep "mpd delta guard refused the healed tree" "$EV/vendor-refusal.$mode.log" | head -2 || true
        echo "tail:"
        tail -3 "$EV/vendor-refusal.$mode.log"
        echo
    } >> "$LOG"
    echo "case=$mode exit=$rc guard_refusals=$(grep -c 'mpd delta guard refused the healed tree' "$EV/vendor-refusal.$mode.log" || true) qg_before=$sha_before qg_after=$sha_after"
    rm -rf "$sb"
}

run_case refusal
run_case control
