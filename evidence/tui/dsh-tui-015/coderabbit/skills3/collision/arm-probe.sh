#!/usr/bin/env bash
# Scratch arm probe: boot ONE prepared headless profile the way skills/dsh-qa/scripts/mcp-call.ts does
# (sandbox HOME + sandbox workspace + staged credentials + the case's exact dsh argv), so the boot
# collision can be reproduced WITHOUT paying for npm on every iteration.
#
# Usage: bash .qa-mcp-repro/arm-probe.sh <prepared-DSH_HOME> <label> [extra dsh args...]
set -u
REPO="/home/haroldzhao/MyProj/DshProj/My-Power-Dsh"
ROOT="$1"; LABEL="$2"; shift 2
SB="$REPO/.qa-mcp-repro/arm-$LABEL"
LOG="$REPO/.qa-mcp-repro/$LABEL.log"
rm -rf "$SB" "$LOG"
mkdir -p "$SB/.dsh" "$SB/ws" "$ROOT"
cp "$HOME/.dsh/.credentials.yaml" "$SB/.dsh/.credentials.yaml" && chmod 600 "$SB/.dsh/.credentials.yaml"
cp "$HOME/.dsh/.credentials.yaml" "$ROOT/.credentials.yaml" && chmod 600 "$ROOT/.credentials.yaml"
if [ -f "$HOME/.dsh/settings.yaml" ]; then
  cp "$HOME/.dsh/settings.yaml" "$SB/settings.yaml"
  cp "$HOME/.dsh/settings.yaml" "$SB/.dsh/settings.yaml"
  cp "$HOME/.dsh/settings.yaml" "$ROOT/settings.yaml"
fi
cp -r "$REPO/tests/mcp-fixtures" "$SB/ws/tests/mcp-fixtures"
PROMPT='Do only one thing: list all available tool names in your current session that start with the mcp__ prefix (one per line). Do not call any tools.'
START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
( cd "$SB/ws" && DSH_HOME="$ROOT" HOME="$SB" timeout 300 node /home/haroldzhao/.nvm/versions/node/v24.21.0/lib/node_modules/@deepseek-ai/dsh/lib/bin.js --profile headless --patch "$REPO/cordis.patch.yml" "$@" "$PROMPT" > "$LOG" 2>&1 )
echo "EXIT=$? START=$START END=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "--- log head ---"
head -6 "$LOG"
echo "--- collision count ---"
grep -c "already registered" "$LOG" || true
