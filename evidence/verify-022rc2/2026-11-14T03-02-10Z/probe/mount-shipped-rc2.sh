#!/usr/bin/env bash
# T5 shipped-bundle mount arm on harness 0.2.2-rc.2 / dsh-tui 0.20.0.
#
# Installs THIS CHECKOUT into an isolated profile (the official one-command flow), dumps the composed
# config so the six team rows' RESOLVED `disabled` flags are visible, then boots the web profile and
# records whether the boot emitted any activation error and exactly one generation-guard line.
# Isolation: sandbox DSH_HOME + HOME + cwd; the real ~/.dsh is never touched.
set -uo pipefail
REPO="/home/haroldzhao/MyProj/DshProj/My-Power-Dsh"
RUN="$REPO/evidence/verify-022rc2/2026-11-14T03-02-10Z/mount-shipped-rc2"
HARNESS="$REPO/.qa-tmp/dsh-022rc2"
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
grep -c '^- id:' "$RUN/dump-config.yml" 2>/dev/null || true

echo "== web boot (25s) =="
timeout --signal=TERM 25 dsh --profile t5 --port 3214 --no-open > "$RUN/boot.log" 2>&1
echo "BOOT_EXIT=$?"
echo "== boot.log (first 6 lines, token masked) =="
head -6 "$RUN/boot.log" | sed -E 's/token=[^ &]+/token=<masked>/g'
echo "== guard log =="
cat "$RUN/workspace/.mpd/logs/mpd-patch-guards.log" 2>/dev/null || echo "(no guard log)"
