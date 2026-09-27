#!/usr/bin/env bash
# Restart the container's TUI session with whatever is on /src right now, so a fix can be SEEN
# rather than assumed. Same environment the entrypoint uses.
export PATH=/opt/toolchain/node/bin:/root/.bun/bin:$PATH
tmux -S /data/tui.sock kill-session -t tui 2>/dev/null
sleep 2
rm -f /data/tui-pane.log
tmux -f /dev/null -S /data/tui.sock new-session -d -s tui -x 220 -y 50 -c /data/ws
tmux -S /data/tui.sock pipe-pane -t tui -o "cat > /data/tui-pane.log" 2>/dev/null || true
tmux -S /data/tui.sock send-keys -t tui \
  "env -i 'PATH=$PATH' 'DSH_HOME=/data/dsh-tui' 'HOME=/data/home-tui' 'TERM=xterm-256color' 'DSH_TUI_WORKSPACE_TARGET=/data/ws' dsh-tui" Enter
