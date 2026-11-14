#!/usr/bin/env bash
# T16 mount arm — installs THIS CHECKOUT (or a `git archive HEAD` export) through the official
# one-command flow into an ISOLATED profile at a CLEAN ANCHOR, then dumps the composition and boots.
#
#   bash mount-arm.sh <rc1|rc2> <work|head> <port>
#
# CLEAN ANCHOR (contract A6): the harness AND the DSH_HOME/profile/cwd all live under
# /home/haroldzhao/.t21-verify, which is OUTSIDE /home/haroldzhao/MyProj/DshProj/My-Power-Dsh, so
# `createRequire` cannot climb into the checkout's own node_modules.
set -uo pipefail
ARM="${1:?usage: mount-arm.sh rc1|rc2 work|head <port>}"
TREE="${2:?}"
PORT="${3:?}"
REPO=/home/haroldzhao/MyProj/DshProj/My-Power-Dsh
EVID="$REPO/evidence/verify-022rc2/2026-11-14T05-12-17Z-t21"
ANCHOR=/home/haroldzhao/.t21-verify
HARNESS="$ANCHOR/host-$ARM"
RUN="$ANCHOR/runs/$ARM-$TREE"
OUT="$EVID/mount-$ARM-$TREE"

[ -x "$HARNESS/bin/dsh" ] || { echo "harness missing: $HARNESS" >&2; exit 2; }
rm -rf "$RUN"
mkdir -p "$RUN/dsh-home" "$RUN/user-home" "$RUN/xdg" "$RUN/workspace" "$OUT"

if [ "$TREE" = head ]; then
  SRC="$RUN/src"
  mkdir -p "$SRC"
  git -C "$REPO" archive HEAD | tar -x -C "$SRC" || { echo "archive failed" >&2; exit 3; }
else
  SRC="$REPO"
fi

export DSH_HOME="$RUN/dsh-home"
export HOME="$RUN/user-home"
export XDG_RUNTIME_DIR="$RUN/xdg"
export PATH="$HARNESS/bin:$PATH"
cd "$RUN/workspace" || exit 90

{
  echo "arm=$ARM tree=$TREE port=$PORT"
  echo "anchor=$ANCHOR (outside the checkout: $(case "$ANCHOR" in "$REPO"*) echo NO;; *) echo YES;; esac))"
  echo "harness=$(command -v dsh)"
  echo "harness-version=$(dsh --version 2>&1 | head -1)"
  echo "source=$SRC"
  echo "repo-realpath=$(realpath "$REPO")"
  echo "src-realpath=$(realpath "$SRC")"
  echo "dsh-home=$DSH_HOME"
  echo "home=$HOME"
  echo "cwd=$PWD"
} | tee "$OUT/env.log"

echo "== plugin add =="
dsh plugin --profile t21 add "$SRC" > "$OUT/install.log" 2>&1
echo "INSTALL_EXIT=$?" | tee -a "$OUT/install.log"

echo "== profile location (must be outside the checkout) =="
realpath "$DSH_HOME/profiles/t21" | tee -a "$OUT/env.log"

echo "== dump-config =="
dsh --profile t21 --dump-config > "$OUT/dump-config.yml" 2> "$OUT/dump-config.err"
echo "DUMP_EXIT=$?" | tee -a "$OUT/env.log"

echo "== boot (25s, port $PORT) =="
timeout --signal=TERM 25 dsh --profile t21 --port "$PORT" --no-open > "$OUT/boot.raw.log" 2>&1
echo "BOOT_EXIT=$?" | tee -a "$OUT/env.log"

# The boot log may carry a per-session URL token; it is masked before anything leaves the run dir.
sed -E 's/token=[^ &"[:space:]]+/token=<masked>/g; s/([?&]token=)[^ &"[:space:]]+/\1<masked>/g' \
  "$OUT/boot.raw.log" > "$OUT/boot.log"
rm -f "$OUT/boot.raw.log"

echo "== guard log =="
cp "$RUN/workspace/.mpd/logs/mpd-patch-guards.log" "$OUT/guard.log" 2>/dev/null || echo "(no guard log)" > "$OUT/guard.log"
cat "$OUT/guard.log"

echo "== signals =="
{
  echo "rows=$(grep -c '^  - id:' "$OUT/dump-config.yml" 2>/dev/null || echo 0)"
  for pat in 'did not activate' 'already registered' 'has been registered' 'agentTeams' 'team:policy' 'Failed to' 'Error:'; do
    n=$(grep -c -- "$pat" "$OUT/boot.log" 2>/dev/null || true)
    echo "boot[$pat]=${n:-0}"
  done
} | tee -a "$OUT/env.log"

echo "== team rows in dump-config =="
grep -n -A2 'id: mpd-.*agent-team' "$OUT/dump-config.yml" 2>/dev/null | head -40 | tee "$OUT/team-rows.txt"
echo "ARM-DONE $ARM $TREE"
