#!/usr/bin/env bash
# Mounted NEGATIVE CONTROL for t3: boots the SAME mounted path with the PRE-FIX
# dist (git HEAD) and shows the host rejecting the tool result, then restores the
# fixed dist from a workspace-persistent backup. Proves the mounted evidence
# discriminates the fix instead of being green by construction.
# Run through `bash -ic` (the LLM route key comes from ~/.bashrc).
set -u
REPO=/root/dshProj/my-power-dsh
EV="$(cd "$1" && pwd)"
SB=$(mktemp -d /tmp/mpd-t3-negctl-XXXXXX)
mkdir -p "$SB/ws"

cp "$HOME/.dsh/.credentials.yaml" "$SB/.credentials.yaml" || { echo "FATAL: no credentials"; exit 9; }
[ -f "$HOME/.dsh/settings.yaml" ] && cp "$HOME/.dsh/settings.yaml" "$SB/settings.yaml"
printf 'module dut(input wire a, output wire y);\n  assign y = a;\nendmodule\n' > "$SB/ws/dut.v"

# 1. persist the FIXED dist so the pre-fix checkout is always reversible
mkdir -p "$EV/fixed-dist"
cp "$REPO/packages/mpd-verif-plugin/dist/index.js" "$EV/fixed-dist/index.js"
sha256sum "$EV/fixed-dist/index.js" | sed 's/^/fixed-dist sha256: /'

cd "$REPO" || exit 9
export DSH_HOME="$SB"
node scripts/install-profile.mjs --yes --dsh-home "$SB" --profile mpd-headless --skip-toolchain > "$EV/negative-control.install.log" 2>&1
echo "install-profile exit: $?"

# 2. revert the dist to the pre-fix artifact
git checkout -- packages/mpd-verif-plugin/dist/index.js
echo "pre-fix dist markers:"
grep -n "licenseHint = backend" packages/mpd-verif-plugin/dist/index.js | head -2
grep -n "filelistPath: plan.filelistPath" packages/mpd-verif-plugin/dist/index.js | head -2

PROMPT_A='Call the mpd_verif_backends tool exactly three times, in this order: first with {"backend":"iverilog"}, then with {"backend":"all"}, then with {"backend":"vcs"}. Do not call any other tool. Then paste verbatim, one call per line, the exact rendered result line(s) of each call, each line prefixed by "BACKENDS1:", "BACKENDS2:" and "BACKENDS3:" respectively.'

( cd "$SB/ws" && timeout 900 dsh --profile mpd-headless --patch "$EV/mpd-verif-overlay.yml" "$PROMPT_A" > "$EV/negative-control.mounted.log" 2>&1 </dev/null )
echo "pre-fix mounted exit: $?"

# 3. restore the fixed dist and prove byte equality with the backup
cp "$EV/fixed-dist/index.js" packages/mpd-verif-plugin/dist/index.js
if cmp -s "$EV/fixed-dist/index.js" packages/mpd-verif-plugin/dist/index.js; then echo "dist restored: identical to fixed-dist backup"; else echo "FATAL: dist restore mismatch"; exit 9; fi
grep -n "licenseHint = backend" packages/mpd-verif-plugin/dist/index.js | head -2
echo "negative-control mounted done"
