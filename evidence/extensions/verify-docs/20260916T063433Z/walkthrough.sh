#!/usr/bin/env bash
# t12: execute the human guide's §5 walkthrough (and the AI doc's §6 worked copy) VERBATIM,
# with only HOME sandboxed so `~/.mpd/extensions` cannot touch the real home.
# Every command below is copied from the docs; the cwd is the repository root, as the docs say.
set -u
REPO=/root/dshProj/my-power-dsh
SB=$(mktemp -d)
export HOME="$SB/home"
export TMPDIR="$SB/tmp"
mkdir -p "$HOME" "$TMPDIR" "$HOME/.mpd/extensions"
cd "$REPO" || exit 9
echo "sandbox HOME=$HOME"

step() { echo; echo "### $*"; }

step "guide §5 arm A: scaffold (no --with-mcp)"
bun scripts/mpd-ext.mjs scaffold my-extension --dir ~/.mpd/extensions 2>&1 | tail -3
echo "exit=${PIPESTATUS[0]}"

step "guide §5 step 1: validate"
bun scripts/mpd-ext.mjs validate ~/.mpd/extensions/my-extension 2>&1 | tail -4
echo "exit=${PIPESTATUS[0]}"

step "guide §5 step 2: list"
bun scripts/mpd-ext.mjs list 2>&1 | head -12
echo "exit=${PIPESTATUS[0]}"

step "guide §5 server smoke on the DEFAULT (three-kind) copy — server.mjs is expected to be absent by §5's own flag semantics"
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node ~/.mpd/extensions/my-extension/server.mjs
echo "exit=$?"

step "guide §5 arm A': scaffold with --with-mcp"
bun scripts/mpd-ext.mjs scaffold my-extension-mcp --dir ~/.mpd/extensions --with-mcp 2>&1 | tail -2
echo "exit=${PIPESTATUS[0]}"

step "guide §5 arm A': validate the four-kind copy"
bun scripts/mpd-ext.mjs validate ~/.mpd/extensions/my-extension-mcp 2>&1 | tail -4
echo "exit=${PIPESTATUS[0]}"

step "guide §5 server smoke on the four-kind copy"
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node ~/.mpd/extensions/my-extension-mcp/server.mjs
echo "exit=$?"

step "guide §5 arm B: cp -r templates/mpd-extension ~/.mpd/extensions/my-extension-copy + validate"
cp -r templates/mpd-extension ~/.mpd/extensions/my-extension-copy
bun scripts/mpd-ext.mjs validate ~/.mpd/extensions/my-extension-copy 2>&1 | tail -4
echo "exit=${PIPESTATUS[0]}"

step "AI doc §6 step 1-2: scaffold for-agents-skeleton --with-mcp + validate"
bun scripts/mpd-ext.mjs scaffold for-agents-skeleton --dir ~/.mpd/extensions --with-mcp 2>&1 | tail -2
echo "exit=${PIPESTATUS[0]}"
bun scripts/mpd-ext.mjs validate ~/.mpd/extensions/for-agents-skeleton 2>&1 | tail -4
echo "exit=${PIPESTATUS[0]}"

step "AI doc §6 step 5: project-plane variant, run from a sandbox cwd so <repo>/.mpd is untouched"
PROJ="$SB/proj"
mkdir -p "$PROJ"
ln -s "$REPO/scripts" "$PROJ/scripts"
ln -s "$REPO/templates" "$PROJ/templates"
cd "$PROJ" || exit 9
mkdir -p .mpd/extensions
bun scripts/mpd-ext.mjs scaffold for-agents-proj --dir .mpd/extensions 2>&1 | tail -2
echo "exit=${PIPESTATUS[0]}"
bun scripts/mpd-ext.mjs validate .mpd/extensions/for-agents-proj 2>&1 | tail -4
echo "exit=${PIPESTATUS[0]}"
ls -d "$PROJ/.mpd/extensions/for-agents-proj" 2>&1

step "guide §6 / AI doc §7 offline gate commands"
cd "$REPO" || exit 9
bun scripts/mpd-ext.mjs validate templates/mpd-extension 2>&1 | tail -3
echo "exit=${PIPESTATUS[0]}"
bun scripts/mpd-ext.mjs validate extensions/mpd-ext-example 2>&1 | tail -3
echo "exit=${PIPESTATUS[0]}"
bun scripts/mpd-ext.mjs --self-test 2>&1 | tail -3
echo "exit=${PIPESTATUS[0]}"

step "leftovers check: <repo>/.mpd/extensions must not exist"
ls -d "$REPO/.mpd/extensions" 2>&1

rm -rf "$SB"
echo
echo "walkthrough done"
