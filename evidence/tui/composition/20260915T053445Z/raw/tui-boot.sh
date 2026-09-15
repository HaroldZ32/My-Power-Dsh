#!/usr/bin/env bash
# t5 live lane: boot dsh-TUI with the bundle as the THIRD patch layer inside an
# isolated sandbox, capture the pane + the raw ANSI log, drive the host's own
# `/plugins check <abs dsh-plugin.json>` and stop the server. A tmux server does
# not survive a shell invocation, so this script owns the whole lifecycle.
#
# Usage: bash tui-boot.sh <evidence-dir>
set -uo pipefail
R=/root/dshProj/my-power-dsh
Q="$R/.mpd/recon/qa"
OUT="$1"
SOCK="$Q/t5-tui.sock"
WS="$Q/t5-ws"
LOG="$OUT/raw/tui-pane.log"

mkdir -p "$OUT/raw" "$WS"
rm -f "$SOCK" "$LOG"
tmux -S "$SOCK" kill-server 2>/dev/null || true

tmux -S "$SOCK" new-session -d -s tui -x 220 -y 50 -c "$WS"
tmux -S "$SOCK" pipe-pane -t tui -o "cat > '$LOG'"

tmux -S "$SOCK" send-keys -t tui \
  "env -i PATH='$PATH' DSH_HOME='$Q/dshhome' HOME='$Q/home' npm_config_cache='$Q/npm-cache' PNPM_HOME='$Q/pnpm-home' XDG_CONFIG_HOME='$Q/config' XDG_DATA_HOME='$Q/data' TERM=xterm-256color dsh-tui" Enter
echo "[tui-boot] launched, waiting 75s for the boot"
sleep 75
tmux -S "$SOCK" capture-pane -p -J -t tui > "$OUT/raw/boot.pane.txt"

echo "[tui-boot] driving /plugins check"
tmux -S "$SOCK" send-keys -t tui "/plugins check $R/dsh-plugin.json" Enter
sleep 20
tmux -S "$SOCK" capture-pane -p -J -t tui > "$OUT/raw/plugins-check.pane.txt"

echo "[tui-boot] driving /plugins (host descriptor)"
tmux -S "$SOCK" send-keys -t tui "/plugins" Enter
sleep 15
tmux -S "$SOCK" capture-pane -p -J -t tui > "$OUT/raw/plugins-descriptor.pane.txt"

tmux -S "$SOCK" kill-server 2>/dev/null || true
echo "[tui-boot] done; panes under $OUT/raw"
