#!/usr/bin/env bash
# t24 — repeat-boot insurance driver (OWNED BY THIS TASK).
#
# Question: on a CORRECTLY ORDERED tree, is the adapter fallback branch reachable?
# The loader creates sibling rows CONCURRENTLY (`cordis-plugin-loader/lib/index.js:97`,
# `Promise.allSettled(config.map((options) => this.create(options)))`), while cordis's
# `ctx.get(name, strict = true)` returns UNDEFINED — never a throw — for a provider whose
# fiber is not active (`impl.fiber.state !== 2`, `cordis/lib/index.js` _getImpl). So if the
# mpd-ext row's apply runs before the mpd-dsh-adapter fiber reaches ACTIVE, its
# `ctx.get("mpdDsh") ?? createDshAdapter(ctx)` must take the fallback branch even though the
# row order is correct.
#
# This driver installs the bundle ONCE into a pristine sandbox, then for each of N runs
# copies that pristine sandbox (so every boot starts from a clean, identically installed
# state, with a fresh workspace cwd) and boots it. It waits until BOTH rows have printed
# their summary line — a fallback warning is always emitted BEFORE its row's summary — then
# stops the boot, so a served-forever profile cannot cost us a fixed timeout per run.
#
# Written by: t24 (Junior Engineer). Writes ONLY under this task's evidence dir.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
N="${1:-5}"
BOOT_WAIT_S="${2:-150}"

RAW="$HERE/raw"
LOGS="$HERE/logs"
SANDBOX="$HERE/sandbox"
mkdir -p "$RAW" "$LOGS"
PROGRESS="$RAW/progress.log"
: > "$PROGRESS"

log() { echo "[$(date -u +%H:%M:%SZ)] $*" | tee -a "$PROGRESS"; }

log "driver start: repo=$REPO runs=$N wait=${BOOT_WAIT_S}s"
log "HEAD=$(git -C "$REPO" rev-parse HEAD)"
log "src sha256: $(sha256sum "$REPO/packages/mpd-ext-plugin/src/index.ts" "$REPO/packages/mpd-roles-plugin/src/index.ts" | tr '\n' ' ')"
log "dist sha256: $(sha256sum "$REPO/packages/mpd-ext-plugin/dist/index.js" "$REPO/packages/mpd-roles-plugin/dist/index.js" | tr '\n' ' ')"

# ---------------------------------------------------------------- pristine install (once)
PRIS="$SANDBOX/pristine"
rm -rf "$PRIS"; mkdir -p "$PRIS/dsh/store" "$PRIS/home" "$PRIS/ws"
COPIED=()
for f in .credentials.yaml settings.yaml; do
  if [ -f "$HOME/.dsh/$f" ]; then cp "$HOME/.dsh/$f" "$PRIS/home/$f" && COPIED+=("$f"); fi
done
log "credentials copied into the sandbox: ${COPIED[*]:-<none>}"
[ -f "$PRIS/home/.credentials.yaml" ] || log "WARN: no .credentials.yaml in the sandbox — a model call may fail (the row-apply lines still print)"

env HOME="$PRIS/home" DSH_HOME="$PRIS/dsh" timeout 600 \
  dsh plugin --profile rp add --store-dir "$PRIS/dsh/store" "$REPO" > "$RAW/install.log" 2>&1
log "install exit=$? (dsh plugin --profile rp add <repo>)"
ls "$PRIS/dsh/profiles" >> "$PROGRESS" 2>&1 || log "WARN: no profiles dir after install"

# Record what the pristine sandbox contains BEFORE any boot, so "clean" is checkable.
( cd "$PRIS" && find . -maxdepth 4 -not -path './dsh/store/*' | sort > "$RAW/pristine-tree.txt" )
log "pristine tree entries: $(wc -l < "$RAW/pristine-tree.txt")"

# ---------------------------------------------------------------- N boots
for i in $(seq 1 "$N"); do
  RUN="$SANDBOX/run$i"
  rm -rf "$RUN"; mkdir -p "$RUN"
  # The profile's bundle link is a RELATIVE symlink (11 x `..`), so a run dir MUST sit at the
  # same depth as the pristine dir for it to resolve. Measured trap: copying pristine into
  # run$i/pristine (one level deeper) broke the link and EVERY boot died with
  # "cannot resolve profile bundle @mpd-dsh/mpd".
  cp -a "$PRIS/." "$RUN/"
  # A fresh session workspace per boot: workspace-scoped state must not carry over.
  mkdir -p "$RUN/ws"
  BOOTLOG="$LOGS/boot-$i.log"
  : > "$BOOTLOG"

  START=$(date +%s.%N)
  ( cd "$RUN/ws" && env HOME="$RUN/home" DSH_HOME="$RUN/dsh" \
      dsh --profile rp "say ok" > "$BOOTLOG" 2>&1 ) &
  BOOT_PID=$!

  SEEN=0
  for _ in $(seq 1 "$BOOT_WAIT_S"); do
    if grep -q "\[mpd-ext\] mpdExtensions provided" "$BOOTLOG" 2>/dev/null \
       && grep -q "\[mpd-roles\] mpdRoles provided" "$BOOTLOG" 2>/dev/null; then
      SEEN=1; break
    fi
    kill -0 "$BOOT_PID" 2>/dev/null || break
    sleep 1
  done

  # Let the row-apply writes flush, then stop the boot (a web-shaped profile serves forever).
  sleep 2
  kill -TERM "$BOOT_PID" 2>/dev/null || true
  sleep 1
  kill -KILL "$BOOT_PID" 2>/dev/null || true
  wait "$BOOT_PID" 2>/dev/null
  END=$(date +%s.%N)
  ELAPSED=$(awk "BEGIN{printf \"%.1f\", $END - $START}")

  EXT_ID=$(grep -c "adapterIdentity=" "$BOOTLOG" 2>/dev/null || true)
  log "run $i: both-summary-lines=$SEEN elapsed=${ELAPSED}s adapterIdentity-lines=$EXT_ID fallback-lines=$(grep -c 'ADAPTER FALLBACK' "$BOOTLOG" 2>/dev/null || true)"
done

log "driver done"
