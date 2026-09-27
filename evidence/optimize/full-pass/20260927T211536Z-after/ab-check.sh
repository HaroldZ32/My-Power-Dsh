#!/bin/bash
cd /home/haroldzhao/dshProj/my-power-dsh
export PATH="$PWD/.toolchain/node_modules/.bin:$PATH"
export BUN_TMPDIR="$PWD/.bun-tmp"
OUT="evidence/optimize/full-pass/20260927T211536Z-after/ab-verdicts.txt"
: > "$OUT"
P=$(mktemp -d)
git archive HEAD | tar -x -C "$P"
ln -s "$PWD/node_modules" "$P/node_modules"
ln -s "$PWD/.toolchain" "$P/.toolchain"
mkdir -p "$P/.bun-tmp"

run() { # tree label lane timeout
  local tree="$1" label="$2" lane="$3" tmo="$4"
  if [ "$tree" = "after" ]; then cd /home/haroldzhao/dshProj/my-power-dsh; else cd "$P"; fi
  local start=$(date +%s)
  timeout "$tmo" bun "skills/dsh-qa/scripts/$lane.mjs" --no-skip > "/tmp/ab-$label-$lane.log" 2>&1
  local code=$?
  echo "TREE=$label LANE=$lane exit=$code s=$(( $(date +%s) - start ))" | tee -a "/home/haroldzhao/dshProj/my-power-dsh/$OUT"
  tail -2 "/tmp/ab-$label-$lane.log" | cut -c1-200 | tee -a "/home/haroldzhao/dshProj/my-power-dsh/$OUT"
}
run after after workmate-library 600
run after after session-start-team 1500
run pristine pristine workmate-library 600
run pristine pristine session-start-team 1500
echo ABDONE | tee -a "/home/haroldzhao/dshProj/my-power-dsh/$OUT"
