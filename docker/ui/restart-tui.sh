#!/usr/bin/env bash
# docker/ui/restart-tui.sh — THE one place that starts the container's TUI session.
#
# WHY IT IS A SCRIPT AND NOT A LINE IN THE ENTRYPOINT. Three callers need the same session: the
# entrypoint's boot, `docker/ui/tui-capture.sh` (which must restart it once per LANGUAGE, because
# `DSH_TUI_LANG` is read at boot and cannot be switched under a running session), and a human who
# wants the surface back after poking at it. A second copy of this recipe is how the copies drift —
# and the drift is not cosmetic: the two onboarding lines below are what stand between a working
# surface and a first-run WIZARD that swallows every `/mpd …` keystroke, which is a defect this
# repository has already measured once.
#
# Usage: restart-tui.sh [en|zh]     (default: $MPD_UI_TUI_LANG, else zh)
set -uo pipefail
export PATH=/opt/toolchain/node/bin:/root/.bun/bin:$PATH

SOCK="${MPD_UI_TUI_SOCK:-/data/tui.sock}"
SESSION="${MPD_UI_TUI_SESSION:-tui}"
WORKSPACE="${MPD_UI_TUI_WORKSPACE:-/data/ws}"
TUI_HOME="${MPD_UI_TUI_HOME:-/data/home-tui}"
# The grid the session is created at. `capture-pane` reads the PANE, so this is the whole geometry a
# capture inherits — there is no attached client, and therefore no tmux status row inside the pane.
COLS="${MPD_UI_TUI_COLS:-160}"
ROWS="${MPD_UI_TUI_ROWS:-44}"
# The locale is an ARGUMENT first and an env var second, so a capture run cannot inherit a language
# from whoever happened to export it last.
LANG_KIND="${1:-${MPD_UI_TUI_LANG:-zh}}"

mkdir -p "$TUI_HOME/.dsh-tui" "$WORKSPACE"
# ── the two prefs that decide WHICH screen the TUI lands on ───────────────────
# (1) ONBOARDING. A home that has never completed setup is walked through dsh-tui's four-step
#     first-run wizard INSTEAD of reaching a chat session, and the wizard draws the same `❯` a chat
#     composer does — so a readiness check that only looks for a prompt passes on the WRONG screen.
#     MEASURED in this lane's own history: the boot arm passed on the landing surface while every
#     `/mpd …` keystroke went into its composer and was sent to the MODEL. The shape written here is
#     the one the installed `lib/types/onboardingPrefs.js` requires — it fires unless
#     `{completed:true, version:>=1}` — and it is the same pair docker/tui-lane.sh writes.
printf '{\n  "completed": true,\n  "version": 1\n}\n' >"$TUI_HOME/.dsh-tui/onboarding.json"
# (2) THE AGENT PRESET. dsh-tui persists this itself when a user picks one; writing it is how a
#     scripted boot lands on the `mpd` preset rather than on the host's default, and without the mpd
#     preset the `/mpd` command has no plugin behind it to answer.
printf '{\n  "preset": "mpd"\n}' >"$TUI_HOME/.dsh-tui/agent-preset.json"

tmux -S "$SOCK" kill-session -t "$SESSION" 2>/dev/null || true
sleep 1
# NO LAUNCHPAD, and again the shape is the host's own: `DSH_TUI_NO_LAUNCHPAD=1` skips the ASCII-art
# splash that would otherwise precede the chat surface and be captured as the first scene.
tmux -f /dev/null -S "$SOCK" new-session -d -s "$SESSION" -x "$COLS" -y "$ROWS" -c "$WORKSPACE" 2>/dev/null
tmux -S "$SOCK" pipe-pane -t "$SESSION" -o "cat > /data/tui-pane.log" 2>/dev/null || true
# `env -i` so the session inherits NOTHING from the caller: a leaked host HOME/DSH_HOME would make the
# capture show another profile's state, and a leaked locale would silently decide the language.
tmux -S "$SOCK" send-keys -t "$SESSION" \
  "env -i 'PATH=$PATH' 'DSH_HOME=${MPD_UI_TUI_DSH_HOME:-/data/dsh-tui}' 'HOME=$TUI_HOME' 'TERM=xterm-256color' 'DSH_TUI_LANG=$LANG_KIND' 'DSH_TUI_NO_LAUNCHPAD=1' 'DSH_TUI_WORKSPACE_TARGET=$WORKSPACE' 'npm_config_cache=$TUI_HOME/.npm' dsh-tui" Enter 2>/dev/null || true
printf '[restart-tui] session %s on %s at %sx%s, DSH_TUI_LANG=%s\n' "$SESSION" "$SOCK" "$COLS" "$ROWS" "$LANG_KIND"
