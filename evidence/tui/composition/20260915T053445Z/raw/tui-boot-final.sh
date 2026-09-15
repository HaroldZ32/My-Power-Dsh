#!/usr/bin/env bash
# t5 live lane, final pass (on the completed manifest): one isolated dsh-TUI boot
# that captures (1) the boot pane, (2) the host's OWN `/preset` answer — a
# captured TUI SCREEN naming the active preset, which is the strongest form of
# the "TUI sessions default to mpd" clause (AC-11 / the captain's F1 remedy), and
# (3) `/plugins check <absolute path to dsh-plugin.json>` on the final manifest.
#
# Never a pipe on stdout (the host requires a TTY); one tmux server per process.
#
# Usage: bash tui-boot-final.sh <evidence-dir>
set -uo pipefail
R=/root/dshProj/my-power-dsh
Q="$R/.mpd/recon/qa"
OUT="$1"
SOCK="$Q/t5-tui-final.sock"
WS="$Q/t5-ws"
LOG="$OUT/raw/tui-final-pane.log"

mkdir -p "$OUT/raw" "$WS"
rm -f "$SOCK" "$LOG"
tmux -S "$SOCK" kill-server 2>/dev/null || true
tmux -S "$SOCK" new-session -d -s tui -x 220 -y 50 -c "$WS"
tmux -S "$SOCK" pipe-pane -t tui -o "cat > '$LOG'"
tmux -S "$SOCK" send-keys -t tui \
  "env -i PATH='$PATH' DSH_HOME='$Q/dshhome' HOME='$Q/home' npm_config_cache='$Q/npm-cache' PNPM_HOME='$Q/pnpm-home' XDG_CONFIG_HOME='$Q/config' XDG_DATA_HOME='$Q/data' TERM=xterm-256color dsh-tui" Enter
echo "[tui-boot-final] launched, waiting 75s for the boot"
sleep 75
tmux -S "$SOCK" capture-pane -p -J -t tui > "$OUT/raw/final-boot.pane.txt"

echo "[tui-boot-final] /preset (the host's own answer)"
tmux -S "$SOCK" send-keys -t tui "/preset" Enter
sleep 15
tmux -S "$SOCK" capture-pane -p -J -t tui > "$OUT/raw/final-preset.pane.txt"

echo "[tui-boot-final] Esc out of the preset picker (an overlay owns the keyboard)"
tmux -S "$SOCK" send-keys -t tui Escape
sleep 5
tmux -S "$SOCK" capture-pane -p -J -t tui > "$OUT/raw/final-preset-closed.pane.txt"

echo "[tui-boot-final] /plugins check <manifest file>"
tmux -S "$SOCK" send-keys -t tui "/plugins check $R/dsh-plugin.json" Enter
sleep 20
tmux -S "$SOCK" capture-pane -p -J -t tui > "$OUT/raw/final-plugins-check.pane.txt"

tmux -S "$SOCK" kill-server 2>/dev/null || true
echo "[tui-boot-final] done"
