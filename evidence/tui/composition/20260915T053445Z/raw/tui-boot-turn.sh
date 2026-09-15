#!/usr/bin/env bash
# t5 live lane, turn pass: boot dsh-TUI with the bundle as the third patch layer
# and drive ONE trivial turn, so the harness writes a `request/header` record —
# the repo's own tool-list evidence (skills/dsh-qa/scripts/lib/session-evidence.mjs:
# `request/header.data.header.tools[]`). This gives the per-package compatibility
# ledger a live, per-tool observation instead of a composition-only claim.
#
# Credentials: copied ONCE into the ephemeral sandbox (AGENTS.md §7 / §10); the
# real home is never written.
#
# Usage: bash tui-boot-turn.sh <evidence-dir> <real-dsh-home>
set -uo pipefail
R=/root/dshProj/my-power-dsh
Q="$R/.mpd/recon/qa"
OUT="$1"
REAL="$2"
SOCK="$Q/t5-tui-turn.sock"
WS="$Q/t5-ws"
LOG="$OUT/raw/tui-turn-pane.log"

mkdir -p "$OUT/raw" "$WS" "$Q/dshhome"
for f in .credentials.yaml settings.yaml; do
  [ -f "$REAL/$f" ] && cp -f "$REAL/$f" "$Q/dshhome/$f" && echo "[turn] copied $f into the sandbox"
done

rm -f "$SOCK" "$LOG"
tmux -S "$SOCK" kill-server 2>/dev/null || true
tmux -S "$SOCK" new-session -d -s tui -x 220 -y 50 -c "$WS"
tmux -S "$SOCK" pipe-pane -t tui -o "cat > '$LOG'"
tmux -S "$SOCK" send-keys -t tui \
  "env -i PATH='$PATH' DSH_HOME='$Q/dshhome' HOME='$Q/home' npm_config_cache='$Q/npm-cache' PNPM_HOME='$Q/pnpm-home' XDG_CONFIG_HOME='$Q/config' XDG_DATA_HOME='$Q/data' TERM=xterm-256color dsh-tui" Enter
echo "[turn] launched, waiting 75s"
sleep 75
tmux -S "$SOCK" capture-pane -p -J -t tui > "$OUT/raw/turn-boot.pane.txt"

echo "[turn] sending one trivial prompt"
tmux -S "$SOCK" send-keys -t tui "Reply with the single word: ok"
sleep 2
tmux -S "$SOCK" send-keys -t tui Enter
sleep 60
tmux -S "$SOCK" capture-pane -p -J -t tui > "$OUT/raw/turn-reply.pane.txt"

tmux -S "$SOCK" kill-server 2>/dev/null || true
echo "[turn] done"
