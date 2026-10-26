#!/usr/bin/env bash
# T4 (D1, graph-core) gate batch. Reads the tree; writes only inside the row evidence dir.
# Usage: bash t4-gates-v2.sh <row-evidence-dir>
set -u
EV="${1:?row evidence dir required}"
WS="$(cd "$(dirname "$0")/../../../../../.." && pwd)"
cd "$WS" || exit 1
BASE=evidence/cellwork/dag-groups/2026-10-26T10-54-01Z-baseline
SCOPE=(packages/mpd-graph-core scripts/verify-graph-model.ts)
sandwich() { find "${SCOPE[@]}" -type f | LC_ALL=C sort | xargs sha256sum; }
mkdir -p "$EV"

echo "== declared-by-writer hashes vs measured (freeze mail 2026-10-26T11:22:20Z)"
cat > "$EV/declared.sha256" <<'DECLARED'
a931c54bd057e751410767c0dca88696a0da703b945e8e458ed82c22b95a4d6e  packages/mpd-graph-core/src/types.ts
073aaaa3db811a11bf3684d67436f12df4f108f55cbfe4dc8a2c4ee656e1402a  packages/mpd-graph-core/src/model.ts
f990feef7d1830bd5d4b189169d0bb390b246ca1e7e901d2815bc06d9939f9f0  packages/mpd-graph-core/src/index.ts
4c2b7506c90818fb8ee29a99950342a07fbdef865e9fccf96f9c4c4595421100  packages/mpd-graph-core/test/model-groups.test.ts
e8ff8c0cc2b422e4e32fddaab123b9da64847c472bee1e61cc73bef4009a012f  packages/mpd-graph-core/README.md
c789597e57e63c2107c86eb0145db8c0a774460b9b514691cf9bd48d9439a91f  packages/mpd-graph-core/README.zh-CN.md
2d7c1471f986f2852e8e19866d5360242f5ee75c216ce2379270277cf1d95297  packages/mpd-graph-core/dist/index.js
a2810b4c4846a63fbea341777d3e7e12e7ceab2c528ad9d101455160ad7cea10  scripts/verify-graph-model.ts
DECLARED
( sha256sum -c "$EV/declared.sha256" ) > "$EV/declared-check.log" 2>&1
echo "declared-check exit=$?"; cat "$EV/declared-check.log"

echo; echo "== hash sandwich: start $(date -u +%Y-%m-%dT%H:%M:%SZ)"
sandwich > "$EV/scope-start.sha256"; sha256sum "$EV/scope-start.sha256"
echo "== settle window 50 s"
sleep 50
sandwich > "$EV/scope-postsettle.sha256"; sha256sum "$EV/scope-postsettle.sha256"

echo; echo "== package tests"
( bun test packages/mpd-graph-core ) > "$EV/tests-graph-core.log" 2>&1; echo "tests exit=$?"
grep -E '^ [0-9]+ (pass|fail)|^Ran ' "$EV/tests-graph-core.log" | tail -3
( bun test packages/mpd-graph-core/test/model-groups.test.ts ) > "$EV/tests-model-groups.log" 2>&1; echo "groups-test exit=$?"

echo; echo "== graph-model gate: self-test (both directions) + grouped + negative controls"
node scripts/verify-graph-model.ts --self-test > "$EV/gate-selftest.log" 2>&1; echo "selftest exit=$?"
node scripts/verify-graph-model.ts > "$EV/gate-flat.log" 2>&1; echo "flat exit=$?"
node scripts/verify-graph-model.ts --grouped > "$EV/gate-grouped.log" 2>&1; echo "grouped exit=$?"
node scripts/verify-graph-model.ts --grouped --seed-wrong-anchor > "$EV/gate-wrong-anchor.log" 2>&1; echo "wrong-anchor exit=$? (expect non-zero)"
node scripts/verify-graph-model.ts --seed-wrong-edge > "$EV/gate-wrong-edge.log" 2>&1; echo "wrong-edge exit=$? (expect non-zero)"
node scripts/verify-graph-model.ts --help > "$EV/gate-help.log" 2>&1

echo; echo "== INDEPENDENT BACKWARD PIN (JSON-only, my own pre-wave captures)"
node scripts/verify-graph-model.ts --board .mpd/team/teams/team-20261026095605866-z559-008.json --plan .mpd/plans/cellwork-w3-contract.md --emit > "$EV/emit-real.raw" 2>"$EV/emit-real.err"; echo "emit-real exit=$?"
node scripts/verify-graph-model.ts --board "$BASE/board-synthetic.json" --plan "$BASE/plan-synthetic.md" --emit > "$EV/emit-synthetic.raw" 2>"$EV/emit-synthetic.err"; echo "emit-synthetic exit=$?"
grep -v '^\[verify-graph-model\]' "$EV/emit-real.raw" > "$EV/emit-real.jsononly"
grep -v '^\[verify-graph-model\]' "$EV/emit-synthetic.raw" > "$EV/emit-synthetic.jsononly"
echo "-- want dd4af9c303e714cfd8129d261e7c721d5dfd4a1ec8b197b4f39615a847a98fbf and 2f521a230521f97ed1de61a56684d83b8eaeba7072bfcd2ceeaeba5c1623027b"
sha256sum "$EV/emit-real.jsononly" "$EV/emit-synthetic.jsononly"
echo "-- groups key count (want 0 0):"; grep -c '"groups"' "$EV/emit-real.jsononly" "$EV/emit-synthetic.jsononly"
echo "-- byte diffs:"; diff -q "$BASE/model-nogroups.jsononly" "$EV/emit-real.jsononly" && echo "REAL IDENTICAL"
diff -q "$BASE/model-nogroups-synthetic.jsononly" "$EV/emit-synthetic.jsononly" && echo "SYNTHETIC IDENTICAL"
echo "-- determinism 3x (real pair):"
for i in 1 2 3; do node scripts/verify-graph-model.ts --board .mpd/team/teams/team-20261026095605866-z559-008.json --plan .mpd/plans/cellwork-w3-contract.md --emit 2>/dev/null | grep -v '^\[verify-graph-model\]' | sha256sum; done | tee "$EV/determinism-3x.txt"
echo "-- grouped snapshot captured:"; node scripts/verify-graph-model.ts --grouped --emit > "$EV/emit-grouped.raw" 2>&1; echo "grouped-emit exit=$?"

echo; echo "== my own black-box probe against the BUILT dist (Amendment 8 reproduction)"
bun "$BASE/tools/probe-t4.mjs" > "$EV/probe-d1.log" 2>&1; echo "probe exit=$?"

echo; echo "== dist freshness (graph-core only; the fan-out is the captain's)"
node scripts/verify-dist-fresh.ts --only mpd-graph-core > "$EV/dist-fresh-graph-core.log" 2>&1; echo "dist exit=$?"; tail -4 "$EV/dist-fresh-graph-core.log"

echo; echo "== docs pair (README pair is part of D1)"
bun run verify:docs > "$EV/verify-docs.log" 2>&1; echo "docs exit=$?"; tail -2 "$EV/verify-docs.log"

echo; echo "== root-wide gates (foreign in-flight lanes expected red)"
bun run typecheck > "$EV/typecheck-root.log" 2>&1; echo "typecheck exit=$?"
bun run verify:comments > "$EV/comments-root.log" 2>&1; echo "comments exit=$?"

echo; echo "== scope metadata (stat only)"
git diff --stat -- "${SCOPE[@]}" > "$EV/scope-diffstat.log" 2>&1
git status --porcelain -- "${SCOPE[@]}" > "$EV/scope-status.log" 2>&1

echo; echo "== hash sandwich: end $(date -u +%Y-%m-%dT%H:%M:%SZ)"
sandwich > "$EV/scope-end.sha256"; sha256sum "$EV/scope-end.sha256"
if diff -q "$EV/scope-start.sha256" "$EV/scope-end.sha256" >/dev/null; then echo "SANDWICH OK: start == end (after settle)"; else echo "SANDWICH BROKEN"; diff "$EV/scope-start.sha256" "$EV/scope-end.sha256"; fi
