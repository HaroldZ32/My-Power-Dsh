#!/usr/bin/env bash
# docker/ui/entrypoint.sh — the UI-VIEW container.
#
# WHY THIS EXISTS. The Web GUI and the TUI cannot be reviewed from the developer host: the
# sandbox there cannot install the harness globally, and a UI verdict taken from a
# `--dump-config` or from reading component source is a GUESS, not an observation. This
# container installs the bundle exactly as a client would, then HOLDS BOTH SURFACES OPEN so
# they can be inspected from outside:
#   • the Web app on port 3080, published to the host by docker/ui/docker-compose.yml;
#   • the TUI inside tmux, captured with `docker exec … tmux capture-pane`.
#
# It is an INSPECTION harness, not a gate: it asserts nothing about the bundle. The verdict
# for the install path stays with `scripts/docker-e2e.ts`.
set -uo pipefail

: "${MPD_UI_PORT:=3080}"
LOG_DIR=/data
mkdir -p "$LOG_DIR"

log() { printf '[ui] %s\n' "$*"; }

# ── 1. the client-side toolchain (same order the E2E container uses) ───────────
export DEBIAN_FRONTEND=noninteractive
# ASK ABOUT EACH TOOL, NOT ABOUT `node`. MEASURED 2026-10-05: this block was guarded by
# `command -v node`, and the shared E2E image ships `node`/`npm` but NOT `bun`, `dsh`, `pnpm`, `tmux`
# or `socat`. The guard therefore skipped the whole install, the entrypoint then died at its first
# `bun install` and its first `dsh plugin … add` with "command not found", and the container sat
# there looking healthy while the Web log held 63 bytes. A health guard that asks about a DIFFERENT
# tool than the ones it installs is not a guard.
if ! command -v bun >/dev/null 2>&1 || ! command -v dsh >/dev/null 2>&1 || ! command -v tmux >/dev/null 2>&1; then
  log "apt + bun + pnpm + dsh (one or more of them were missing)"
  apt-get update -qq >"$LOG_DIR/apt.log" 2>&1
  apt-get install -y -qq --no-install-recommends curl git ca-certificates unzip xz-utils tmux socat >>"$LOG_DIR/apt.log" 2>&1
  # `node` itself may already exist (baked into the image); it is installed only when absent, because
  # overwriting the image's own node under a different prefix is how two `node`s end up disagreeing.
  if ! command -v node >/dev/null 2>&1; then
    curl -fsSL "https://nodejs.org/dist/v24.19.0/node-v24.19.0-linux-x64.tar.xz" -o /tmp/node.tar.xz 2>>"$LOG_DIR/apt.log"
    mkdir -p /opt/toolchain/node && tar -xJf /tmp/node.tar.xz -C /opt/toolchain/node --strip-components=1
    export PATH="/opt/toolchain/node/bin:$PATH"
  fi
  if ! command -v bun >/dev/null 2>&1; then
    curl -fsSL https://bun.sh/install | bash >>"$LOG_DIR/apt.log" 2>&1
    export BUN_INSTALL=/root/.bun
    export PATH="$BUN_INSTALL/bin:$PATH"
  fi
  command -v pnpm >/dev/null 2>&1 || npm i -g pnpm@11.23.0 >>"$LOG_DIR/apt.log" 2>&1
  # The harness CLI: the Web app and both `plugin add` calls are all `dsh`, so a container without it
  # cannot produce a single screenshot.
  command -v dsh >/dev/null 2>&1 || npm i -g "@deepseek-ai/dsh@${MPD_UI_DSH_VERSION:-0.2.0-rc.2}" >>"$LOG_DIR/apt.log" 2>&1
fi
export PATH="/opt/toolchain/node/bin:/root/.bun/bin:$PATH"
# Fail LOUDLY and EARLY rather than booting into a silently half-built container.
for tool in node bun pnpm dsh tmux; do
  command -v "$tool" >/dev/null 2>&1 || { log "FATAL: $tool is still not on PATH after the toolchain step — see ${LOG_DIR}/apt.log"; }
done

# ── 2. the two sandboxes: one profile per surface, both inside /data ──────────
export HOME=/data/home
export DSH_HOME=/data/dsh-web
mkdir -p "$HOME" "$DSH_HOME"

# The bundle is COPIED here by the image build; a rebuild of `dist/` is what makes the
# container serve THIS revision rather than whatever was committed.
cd /src || exit 1
log "bun install + rebuild dists"
bun install >>"$LOG_DIR/install.log" 2>&1
for entry in packages/*/src/index.ts packages/mpd-ext-plugin/src/sdk.ts; do
  case "$entry" in packages/mpd-agent-teams-plugin/*) continue ;; esac
  out="$(dirname "$entry")/../dist/index.js"
  [ "$(basename "$entry")" = "sdk.ts" ] && out="packages/mpd-ext-plugin/dist/sdk.js"
  bun build "$entry" --target node --format esm --outfile "$out" >>"$LOG_DIR/rebuild.log" 2>&1
done
node scripts/build-mpd-client.ts >>"$LOG_DIR/rebuild.log" 2>&1

log "dsh plugin --profile web add ."
dsh plugin --profile web add . >>"$LOG_DIR/plugin-web.log" 2>&1

# ── 3. the Web surface, held open ─────────────────────────────────────────────
# The harness REFUSES `--host 0.0.0.0` on purpose — "it would expose remote code execution
# to the network" (measured: the boot died with that exact message and the container then
# exited). That refusal is correct and is NOT worked around by weakening the harness: the
# app keeps its loopback bind and a socat RELAY inside the container carries the published
# port to it. Only the host's own loopback can reach the mapping the compose file declares.
#
# The relay also means the browser's Host header is the HOST port, so the app's own
# browser-trust fence must be told that authority, or every /api call answers unauthorized.
WEB_PORT=3080
TRUSTED="127.0.0.1:${MPD_UI_HOST_PORT:-3081}"
log "starting the Web app on 127.0.0.1:${WEB_PORT} (trusted authority ${TRUSTED})"
( dsh --profile web --port "$WEB_PORT" --no-open --trusted-host "$TRUSTED" >"$LOG_DIR/web.log" 2>&1 ) &
WEB_PID=$!

# Wait for the app to print its launch URL before relaying: the relay cannot serve a port
# that nothing is listening on, and a premature start would make the first page load fail
# with a connection error that reads like a bundle defect.
for _ in $(seq 1 60); do
  sleep 2
  grep -q "token=" "$LOG_DIR/web.log" 2>/dev/null && break
  kill -0 "$WEB_PID" 2>/dev/null || break
done
if ! grep -q "token=" "$LOG_DIR/web.log" 2>/dev/null; then
  log "the Web app never printed a token line — see ${LOG_DIR}/web.log"
else
  log "relaying 0.0.0.0:${MPD_UI_HOST_PORT:-3081} -> 127.0.0.1:${WEB_PORT}"
  ( socat -d -d "TCP-LISTEN:${MPD_UI_HOST_PORT:-3081},fork,reuseaddr,bind=0.0.0.0" "TCP:127.0.0.1:${WEB_PORT}" >"$LOG_DIR/relay.log" 2>&1 ) &
  RELAY_PID=$!
fi

# ── 3b. the CAPTURE tooling, inside the container ─────────────────────────────
# The reviewer's browser lives HERE, not on the host: the harness refuses an external bind, and a
# headless Chromium in the same container needs no published port at all. Installed into /data
# (the named volume) so a restart keeps it — measured 2026-09-27: after `down -v` the volume was
# empty, the capture died with ERR_MODULE_NOT_FOUND on `playwright`, and the screenshots the
# reviewer was reading were the PREVIOUS run's.
export PLAYWRIGHT_BROWSERS_PATH=/data/pw-browsers
if [ ! -d "$LOG_DIR/node_modules/playwright" ]; then
  log "installing the capture tooling (playwright + chromium)"
  ( cd "$LOG_DIR" && npm init -y >/dev/null 2>&1 \
    && npm i playwright@1.49.1 >>"$LOG_DIR/pw-install.log" 2>&1 \
    && npx playwright install --with-deps chromium >>"$LOG_DIR/pw-install.log" 2>&1 )
fi
# THE VOLUME KEEPS THE BROWSER, NOT ITS LIBRARIES. Only the browser download and the npm package
# live under /data; the apt packages `--with-deps` pulls in belong to the CONTAINER LAYER and are
# gone the moment the container is recreated, while the volume survives and makes the guard above
# skip. Measured 2026-09-28: a rebuilt image + recreated container kept
# `/data/node_modules/playwright`, skipped this whole block, and the first capture died with
# `headless_shell: error while loading shared libraries: libglib-2.0.so.0`. So the second guard
# keys on a LIBRARY, not on the directory the first guard already finds.
if ! ldconfig -p 2>/dev/null | grep -q 'libglib-2\.0\.so\.0'; then
  log "installing chromium's system libraries (playwright install-deps)"
  ( cd "$LOG_DIR" && npx playwright install-deps chromium >>"$LOG_DIR/pw-install.log" 2>&1 ) \
    || log "install-deps failed — the capture step will fail on missing shared libraries; see ${LOG_DIR}/pw-install.log"
fi
cp -f /opt/mpd-e2e/capture.mts "$LOG_DIR/capture.mts" 2>/dev/null || true
# The tooling lives in a NAMED VOLUME, so a rebuilt image does not replace what is already there.
# MEASURED 2026-10-05: `/data/capture.ts` survived the rename, the runner kept invoking it, and the
# capture died on `Cannot use import statement outside a module` while looking like a script bug.
# The stale name is therefore REMOVED here, not merely left beside the new one.
rm -f "$LOG_DIR/capture.ts"
cp -f /opt/mpd-e2e/run-capture.sh "$LOG_DIR/run-capture.sh" 2>/dev/null || true

# ── 4. the TUI surface, held open in tmux ─────────────────────────────────────
#
# THE LANGUAGE IS PINNED EXPLICITLY, and that is a measurement discipline, not a preference: `env -i`
# strips every locale variable, the container has no `LANG`, and the host's own chain ends in `zh` — so
# an unpinned pane would silently be the zh render and an "is the TUI bilingual" capture could compare
# two zh panes and call it parity. `zh` is the default because it matches the host's default; set
# MPD_UI_TUI_LANG=en for the English render. The same variable is pinned in restart-tui.sh, so a
# restart cannot change the language under a reviewer.
# A second sandbox HOME so a TUI boot can never disturb the Web profile, and its own DSH_HOME.
log "starting the TUI inside tmux (socket /data/tui.sock)"
npm i -g "@deepseek-harness-tui/dsh-tui@${MPD_UI_TUI_VERSION:-0.13.0}" >>"$LOG_DIR/tui-install.log" 2>&1
DSH_HOME=/data/dsh-tui HOME=/data/home-tui mkdir -p /data/dsh-tui /data/home-tui /data/ws
DSH_HOME=/data/dsh-tui HOME=/data/home-tui dsh plugin --profile dsh-tui add "@deepseek-harness-tui/dsh-tui@${MPD_UI_TUI_VERSION:-0.13.0}" >>"$LOG_DIR/tui-add.log" 2>&1
( cd /src && DSH_HOME=/data/dsh-tui HOME=/data/home-tui dsh plugin --profile dsh-tui add . >>"$LOG_DIR/tui-add.log" 2>&1 )
tmux -f /dev/null -S /data/tui.sock new-session -d -s tui -x 220 -y 50 -c /data/ws
tmux -S /data/tui.sock pipe-pane -t tui -o "cat > /data/tui-pane.log" 2>/dev/null || true
tmux -S /data/tui.sock send-keys -t tui \
  "env -i 'PATH=$PATH' 'DSH_HOME=/data/dsh-tui' 'HOME=/data/home-tui' 'TERM=xterm-256color' 'DSH_TUI_LANG=${MPD_UI_TUI_LANG:-zh}' 'DSH_TUI_WORKSPACE_TARGET=/data/ws' dsh-tui" Enter

# Keep the container alive and publish where the surfaces are, so an inspector (or the
# ui-view driver) can find them without guessing.
{
  printf 'web=0.0.0.0:%s\n' "$MPD_UI_PORT"
  printf 'tui_socket=/data/tui.sock\n'
  printf 'tui_pane_log=/data/tui-pane.log\n'
} > "$LOG_DIR/surfaces.txt"
log "ready — web=:${MPD_UI_PORT} (token in ${LOG_DIR}/web.log), tui=/data/tui.sock (PID ${WEB_PID})"
# HOLD THE CONTAINER OPEN. A dying Web app must not take the inspection surface with it
# (measured: `wait $WEB_PID` ended the container with exit 1 the moment the app refused a
# flag, and every log written to /data went with it) — the logs are also mirrored to the
# bind mount so a post-mortem survives the container.
mkdir -p /data-out
( while :; do sleep 5; cp -f "$LOG_DIR"/web.log "$LOG_DIR"/relay.log "$LOG_DIR"/surfaces.txt /data-out/ 2>/dev/null; done ) &
log "holding the container open; surfaces at /data (mirrored to /data-out)"
while :; do
  sleep 30
  if ! kill -0 "$WEB_PID" 2>/dev/null; then
    log "the Web app exited (see ${LOG_DIR}/web.log); the TUI tmux server stays up for inspection"
    break
  fi
done
tail -f /dev/null
