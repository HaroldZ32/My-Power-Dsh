#!/usr/bin/env bash
# T5 shipped-bundle mount arm — parameterized by generation.
#   bash mount-shipped.sh rc1|rc2
# Installs THIS CHECKOUT through the official one-command flow into an isolated profile, dumps the
# composed config, boots the web profile and records the boot + generation-guard evidence.
# Isolation: sandbox DSH_HOME + HOME + cwd; the real ~/.dsh is never touched.
set -uo pipefail
ARM="${1:?usage: mount-shipped.sh rc1|rc2}"
REPO="/home/haroldzhao/MyProj/DshProj/My-Power-Dsh"
TS="$(cat "$REPO/.qa-tmp/t5-ts.txt")"
RUN="$REPO/evidence/verify-022rc2/$TS/mount-shipped-$ARM"
case "$ARM" in
  rc1) HARNESS="$REPO/.qa-tmp/dsh-022" ;;
  rc2) HARNESS="$REPO/.qa-tmp/dsh-022rc2" ;;
  *) echo "unknown arm $ARM"; exit 2 ;;
esac
rm -rf "$RUN"
mkdir -p "$RUN/dsh-home" "$RUN/user-home" "$RUN/xdg" "$RUN/workspace"
export DSH_HOME="$RUN/dsh-home"
export HOME="$RUN/user-home"
export XDG_RUNTIME_DIR="$RUN/xdg"
export PATH="$HARNESS/bin:$PATH"
cd "$RUN/workspace" || exit 90

echo "== dsh --version =="
dsh --version 2>&1 | head -1

echo "== plugin add (link install of the checkout) =="
dsh plugin --profile t5 add "$REPO" > "$RUN/install.log" 2>&1
echo "INSTALL_EXIT=$?"

echo "== dump-config =="
dsh --profile t5 --dump-config > "$RUN/dump-config.yml" 2> "$RUN/dump-config.err"
echo "DUMP_EXIT=$?"
echo "ROWS=$(grep -c '^- id:' "$RUN/dump-config.yml" 2>/dev/null || echo 0)"

echo "== web boot (20s) =="
timeout --signal=TERM 20 dsh --profile t5 --port 3215 --no-open > "$RUN/boot.log" 2>&1
echo "BOOT_EXIT=$?"
echo "== boot.log head (token masked) =="
head -4 "$RUN/boot.log" | sed -E 's/token=[^ &]+/token=<masked>/g'
echo "== guard log =="
cat "$RUN/workspace/.mpd/logs/mpd-patch-guards.log" 2>/dev/null || echo "(no guard log)"
