#!/bin/bash
cd /home/haroldzhao/dshProj/my-power-dsh
export PATH="$PWD/.toolchain/node_modules/.bin:$PATH"
export BUN_TMPDIR="$PWD/.bun-tmp"
OUT="evidence/optimize/full-pass/20260927T211536Z-after/pack-ab-verdicts.txt"
: > "$OUT"
P=$(mktemp -d)
git archive HEAD | tar -x -C "$P"
ln -s "$PWD/node_modules" "$P/node_modules"
ln -s "$PWD/.toolchain" "$P/.toolchain"
mkdir -p "$P/.bun-tmp"
cd "$P"
node scripts/pack-mpd.mjs > /tmp/pack-ab-pack.log 2>&1
echo "pristine pack exit=$?" | tee -a "/home/haroldzhao/dshProj/my-power-dsh/$OUT"
for lane in relocate-smoke skill-catalog-probe; do
  start=$(date +%s)
  timeout 600 bun "skills/dsh-qa/scripts/$lane.mjs" --no-skip > "/tmp/pack-ab-$lane.log" 2>&1
  echo "TREE=pristine+pack LANE=$lane exit=$? s=$(( $(date +%s) - start ))" | tee -a "/home/haroldzhao/dshProj/my-power-dsh/$OUT"
  tail -2 "/tmp/pack-ab-$lane.log" | cut -c1-200 | tee -a "/home/haroldzhao/dshProj/my-power-dsh/$OUT"
done
echo PACKABDONE | tee -a "/home/haroldzhao/dshProj/my-power-dsh/$OUT"
