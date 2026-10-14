#!/usr/bin/env bash
# Scratch driver (never shipped, gitignored by /.qa-*): run ONE dsh-qa case inside one tree.
#
# WHY IT EXISTS: the oneclick lane's QA cases run from a checkout copy that was never
# `bun install`ed, and this driver reproduces that condition locally (see .qa-oneclick/sim-oc)
# beside the source condition (sim-src). The credential is read from the real home's
# .credentials.yaml and exported inline; it is never printed.
# Usage: bash .qa-oneclick/run-case.sh <tree> <case-file> <log-file>
set -u
REPO=/home/haroldzhao/MyProj/DshProj/My-Power-Dsh
KEY=$(python3 - <<'PY'
import os, re
path = os.path.expanduser("~/.dsh/.credentials.yaml")
text = open(path, encoding="utf-8").read()
m = re.search(r"^\s*DEEPSEEK_API_KEY\s*:\s*(.+)$", text, re.M)
print(m.group(1).strip().strip('"').strip("'") if m else "")
PY
)
if [ -z "$KEY" ]; then echo "no credential" >&2; exit 3; fi
export DEEPSEEK_API_KEY="$KEY"
tree=$1
case_file=$2
log=$3
# TMPDIR inside the workspace on purpose: /tmp is a FRESH tmpfs per bash call (T-23), so the case's
# own sandboxes die with the call. Pointing TMPDIR at the scratch root keeps them inspectable.
TMPDIR="$REPO/.qa-oneclick/tmp/$(basename "$log" .log)"
rm -rf "$TMPDIR"; mkdir -p "$TMPDIR"
export TMPDIR
cd "$tree" || exit 2
start=$(date -u +%Y-%m-%dT%H:%M:%SZ)
{
  echo "=== tree=$tree case=$case_file started=$start"
  node "skills/dsh-qa/scripts/$case_file"
  echo "exit=$?"
  echo "=== finished=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$log" 2>&1
