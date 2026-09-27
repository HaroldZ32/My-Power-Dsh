#!/bin/bash
cd /home/haroldzhao/dshProj/my-power-dsh
export PATH="$PWD/.toolchain/node_modules/.bin:$PATH"
D="evidence/optimize/full-pass/$(cat .opt/baseline-ts)-baseline"
echo "started $(date -u +%Y-%m-%dT%H:%M:%SZ) PATH=$PATH"
run() { name="$1"; shift; echo "=== $name ==="; "$@" > "$D/$name.log" 2>&1; echo "$name exit=$?"; }
run typecheck bun run typecheck
run bun-test bun test packages
run verify-gates node ./scripts/verify-gates.mjs
run qa-selftests node scripts/run-qa-selftests.mjs
echo "finished $(date -u +%Y-%m-%dT%H:%M:%SZ)"
