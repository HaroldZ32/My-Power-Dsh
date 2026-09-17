#!/bin/bash
# Resume the sweep from 05 in the SAME evidence dir, foreground (managed job), never nohup.
cd /root/dshProj/my-power-dsh
D="$1"
run() {
  local id="$1"; shift
  timeout 1200 "$@" > "$D/$id.log" 2>&1
  local code=$?
  printf '%-34s exit=%s\n' "$id" "$code" >> "$D/SWEEP-MATRIX.txt"
}
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
echo "=== pinned revision AFTER (end of the resumed window) ===" >> "$D/PINS.txt"; bash "$D/pin.sh" >> "$D/PINS.txt" 2>&1
echo "=== SWEEP COMPLETE ===" >> "$D/SWEEP-MATRIX.txt"
