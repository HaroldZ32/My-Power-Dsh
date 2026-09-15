#!/usr/bin/env bash
# t5 live lane, control pass: same isolated dsh-TUI boot as tui-boot.sh, but the
# host's own `/plugins check` is driven against two CONTROL manifests so the
# primary result is falsifiable:
#   control-no-decision-permissions.json -> the same manifest minus the four
#     default-deny intercept permissions (expected: a `compatible` decision)
#   control-broken.json                  -> unparsable JSON (expected: the
#     host's "Not parseable JSON" branch)
# A `waiting_authorization` result on the real manifest is only meaningful if
# this pass can produce BOTH of those outcomes.
#
# Usage: bash tui-boot-controls.sh <evidence-dir>
set -uo pipefail
R=/root/dshProj/my-power-dsh
Q="$R/.mpd/recon/qa"
OUT="$1"
SOCK="$Q/t5-tui-ctl.sock"
WS="$Q/t5-ws"
LOG="$OUT/raw/tui-controls-pane.log"

mkdir -p "$OUT/raw" "$WS"
rm -f "$SOCK" "$LOG"
tmux -S "$SOCK" kill-server 2>/dev/null || true

tmux -S "$SOCK" new-session -d -s tui -x 220 -y 50 -c "$WS"
tmux -S "$SOCK" pipe-pane -t tui -o "cat > '$LOG'"
tmux -S "$SOCK" send-keys -t tui \
  "env -i PATH='$PATH' DSH_HOME='$Q/dshhome' HOME='$Q/home' npm_config_cache='$Q/npm-cache' PNPM_HOME='$Q/pnpm-home' XDG_CONFIG_HOME='$Q/config' XDG_DATA_HOME='$Q/data' TERM=xterm-256color dsh-tui" Enter
echo "[tui-boot-controls] launched, waiting 75s for the boot"
sleep 75
tmux -S "$SOCK" capture-pane -p -J -t tui > "$OUT/raw/control-boot.pane.txt"

echo "[tui-boot-controls] control A: manifest without the decision-event permissions"
tmux -S "$SOCK" send-keys -t tui "/plugins check $OUT/raw/control-no-decision-permissions.json" Enter
sleep 20
tmux -S "$SOCK" capture-pane -p -J -t tui > "$OUT/raw/control-no-decision-permissions.pane.txt"

echo "[tui-boot-controls] control B: unparsable manifest"
tmux -S "$SOCK" send-keys -t tui "/plugins check $OUT/raw/control-broken.json" Enter
sleep 20
tmux -S "$SOCK" capture-pane -p -J -t tui > "$OUT/raw/control-broken.pane.txt"

tmux -S "$SOCK" kill-server 2>/dev/null || true
echo "[tui-boot-controls] done"
