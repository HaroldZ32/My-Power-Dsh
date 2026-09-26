#!/bin/bash
# The wave-2b integration sweep, hand-run in the `./` form, EVERY exit code recorded UNPIPED.
cd /root/dshProj/my-power-dsh
D="$1"
run() {
  local id="$1"; shift
  local log="$D/$id.log"
  timeout 1200 "$@" > "$log" 2>&1
  local code=$?
  printf '%-34s exit=%s\n' "$id" "$code" | tee -a "$D/SWEEP-MATRIX.txt"
}
: > "$D/SWEEP-MATRIX.txt"
echo "=== pinned revision BEFORE ===" > "$D/PINS.txt"; bash "$D/pin.sh" >> "$D/PINS.txt" 2>&1
run 01-verify-vendor          node ./scripts/verify-vendor.mjs
run 02-verify-dist-fresh      node ./scripts/verify-dist-fresh.mjs
run 03-verify-rows-parity     node ./scripts/verify-rows-parity.mjs
run 04-verify-docs-parity     node ./scripts/verify-docs-parity.mjs
run 05-preset-conformance-st  node ./skills/dsh-qa/scripts/preset-conformance.mjs --self-test
run 06-preset-conformance     node ./skills/dsh-qa/scripts/preset-conformance.mjs
run 07-bundle-lifecycle       bun ./skills/dsh-qa/scripts/bundle-lifecycle.mjs
run 08-mpd-ext-selftest       bun ./scripts/mpd-ext.mjs --self-test
run 09-pack-closure           node ./scripts/verify-pack-closure.mjs
run 10-pack-closure-selftest  node ./scripts/verify-pack-closure.mjs --self-test
run 11-verify-manual-paths    node ./scripts/verify-manual-paths.mjs
run 12-typecheck              bun run typecheck
run 13-bun-test-packages      bun test ./packages
run 14-test-qa                bun run test:qa
run 15-verify-gates-runner    node ./scripts/verify-gates.mjs
echo "=== pinned revision AFTER ===" >> "$D/PINS.txt"; bash "$D/pin.sh" >> "$D/PINS.txt" 2>&1
echo "=== SWEEP COMPLETE ===" | tee -a "$D/SWEEP-MATRIX.txt"
