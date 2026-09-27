#!/bin/bash
cd /home/haroldzhao/dshProj/my-power-dsh
export PATH="$PWD/.toolchain/node_modules/.bin:$PATH"
export BUN_TMPDIR="$PWD/.bun-tmp"
D="evidence/optimize/full-pass/20260927T211536Z-after"
OUT="$D/qa-lanes-rest/verdicts.txt"
: > "$OUT"
for lane in session-start-team skill-catalog-probe software-smoke tool-output-validation ulw-command ultrawork-smoke vision-smoke web-client-adapt web-settings-bridge workmate-library workmate-team-member; do
  start=$(date +%s)
  timeout 420 bun "skills/dsh-qa/scripts/$lane.mjs" --no-skip > "$D/qa-lanes-rest/$lane.log" 2>&1
  code=$?
  dur=$(( $(date +%s) - start ))
  echo "$lane exit=$code ms=$((dur*1000))" | tee -a "$OUT"
done
echo ALLDONE | tee -a "$OUT"
