#!/usr/bin/env bash
# t2-findings verification lane (finding C.2): prove BOTH preset sources coexist in a
# live dsh-TUI roster — the bundle's own root (MPD, the active default) AND the
# HOST's shipped presets (standard / ptc / minimal / cordis), which the second
# id-target on `dsh-tui-agent-presets` could in principle have dropped by
# replacing the row's whole `config`.
#
# One tmux server for the whole pass; never a pipe on stdout.
#
# Usage: bash tui-preset-roster.sh <evidence-dir>
set -uo pipefail
R=/root/dshProj/my-power-dsh
Q="$R/.mpd/recon/qa"
OUT="$1"
SOCK="$Q/t2f-preset.sock"
WS="$Q/t5-ws"
LOG="$OUT/raw/preset-roster-pane.log"

mkdir -p "$OUT/raw" "$WS"
rm -f "$SOCK" "$LOG"
tmux -S "$SOCK" kill-server 2>/dev/null || true
tmux -S "$SOCK" new-session -d -s tui -x 220 -y 50 -c "$WS"
tmux -S "$SOCK" pipe-pane -t tui -o "cat > '$LOG'"
tmux -S "$SOCK" send-keys -t tui \
  "env -i PATH='$PATH' DSH_HOME='$Q/dshhome' HOME='$Q/home' npm_config_cache='$Q/npm-cache' PNPM_HOME='$Q/pnpm-home' XDG_CONFIG_HOME='$Q/config' XDG_DATA_HOME='$Q/data' TERM=xterm-256color dsh-tui" Enter
echo "[preset-roster] launched, waiting 75s"
sleep 75

tmux -S "$SOCK" send-keys -t tui "/preset" Enter
sleep 15
tmux -S "$SOCK" capture-pane -p -J -t tui > "$OUT/raw/preset-roster-bottom.pane.txt"

echo "[preset-roster] scrolling the roster up to the top"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  tmux -S "$SOCK" send-keys -t tui Up
  sleep 0.4
done
sleep 3
tmux -S "$SOCK" capture-pane -p -J -t tui > "$OUT/raw/preset-roster-top.pane.txt"

tmux -S "$SOCK" send-keys -t tui Escape
sleep 5
tmux -S "$SOCK" send-keys -t tui "/plugins check $R/dsh-plugin.json" Enter
sleep 20
tmux -S "$SOCK" capture-pane -p -J -t tui > "$OUT/raw/plugins-check.pane.txt"

tmux -S "$SOCK" kill-server 2>/dev/null || true
echo "[preset-roster] done"
