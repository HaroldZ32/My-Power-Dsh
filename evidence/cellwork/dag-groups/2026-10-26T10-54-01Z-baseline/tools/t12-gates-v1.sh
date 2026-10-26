#!/usr/bin/env bash
# T12 (Amendment 8 R1/R2 re-verification) gate batch. Reads the tree; writes only the row evidence dir.
# Usage: bash t12-gates-v1.sh <row-evidence-dir>
set -u
EV="${1:?row evidence dir required}"
WS="$(cd "$(dirname "$0")" && git rev-parse --show-toplevel)"
cd "$WS" || exit 1
BASE=evidence/cellwork/dag-groups/2026-10-26T10-54-01Z-baseline
SCOPE=(packages/mpd-graph-core scripts/verify-graph-model.ts)
sandwich() { find "${SCOPE[@]}" -type f | LC_ALL=C sort | xargs sha256sum; }
mkdir -p "$EV"

echo "== declared-by-writer hashes (T11 freeze mail 2026-10-26T11:59:04Z)"
cat > "$EV/declared.sha256" <<'DECLARED'
a931c54bd057e751410767c0dca88696a0da703b945e8e458ed82c22b95a4d6e  packages/mpd-graph-core/src/types.ts
aec6635985077f7f434d88bb33818c8903be5ed000fdc381799d3ad458987f8c  packages/mpd-graph-core/src/model.ts
f990feef7d1830bd5d4b189169d0bb390b246ca1e7e901d2815bc06d9939f9f0  packages/mpd-graph-core/src/index.ts
b706f9f235cec46e963ba73b37beb55a39ed35043eee36958139438db9a14f13  packages/mpd-graph-core/test/model-groups.test.ts
80cdb3d7b1c40b5852b122f26024ed46f6d8043c629e96197bf88ab8ff6084dd  packages/mpd-graph-core/README.md
8ace034b6b4e27d1d82b3503109502e20dbc3fd822b728df3a1625b8664a42fe  packages/mpd-graph-core/README.zh-CN.md
7978afbeaf16d68dac1f7d3db67a5fa42d10465d4a7a92dd0340af436479f3cd  packages/mpd-graph-core/dist/index.js
92573a09982cda099f2902b0af1557b9c5179099b1ffd44531af5ca73424ca46  scripts/verify-graph-model.ts
DECLARED
sha256sum -c "$EV/declared.sha256" > "$EV/declared-check.log" 2>&1; echo "declared-check exit=$?"; cat "$EV/declared-check.log"

echo; echo "== hash sandwich: start $(date -u +%Y-%m-%dT%H:%M:%SZ)"
sandwich > "$EV/scope-start.sha256"; sha256sum "$EV/scope-start.sha256"
echo "== settle window 50 s"; sleep 50
sandwich > "$EV/scope-postsettle.sha256"; sha256sum "$EV/scope-postsettle.sha256"

echo; echo "== MY OWN PROBE (Amendment 8 R1/R2, black-box on the BUILT dist) — must be ALL PASS"
bun "$BASE/tools/probe-t12.mjs" > "$EV/probe-t12.log" 2>&1; echo "probe exit=$?"; cat "$EV/probe-t12.log"

echo; echo "== the built-in fixture must NOW produce a frame->frame edge (R2)"
node scripts/verify-graph-model.ts --grouped --emit > "$EV/emit-grouped.raw" 2>&1; echo "grouped-emit exit=$?"
python3 - > "$EV/grouped-frame-edges.txt" 2>&1 <<'PY'
import json, re
raw = open('evidence/cellwork/dag-groups/' + __import__('os').listdir('evidence/cellwork/dag-groups')[-1], 'r') if False else None
PY
python3 - "$EV/emit-grouped.raw" > "$EV/grouped-frame-edges.txt" 2>&1 <<'PY'
import json, sys
raw = open(sys.argv[1], encoding='utf-8', errors='replace').read()
body = raw[:raw.rstrip().rfind('}') + 1]
m = json.loads(body)
groups = [g['id'] for g in m.get('groups', [])]
print('groups:', groups)
print('edges:', [f"{e['from']}->{e['to']}[{e['source']}]" for e in m['edges']])
cross = [e for e in m['edges'] if e['from'] in groups and e['to'] in groups]
print('frame->frame edges:', [f"{e['from']}->{e['to']}" for e in cross])
print('RESULT:', 'PASS — the built-in fixture produces a frame->frame edge' if cross else 'FAIL — no frame->frame edge in the built-in fixture')
print('groups payload:', json.dumps(m.get('groups', []))[:400])
PY
cat "$EV/grouped-frame-edges.txt"

echo; echo "== gate arms (both directions + grouped arms)"
node scripts/verify-graph-model.ts --self-test > "$EV/gate-selftest.log" 2>&1; echo "selftest exit=$?"; tail -2 "$EV/gate-selftest.log"
node scripts/verify-graph-model.ts > "$EV/gate-flat.log" 2>&1; echo "flat exit=$?"; cat "$EV/gate-flat.log"
node scripts/verify-graph-model.ts --grouped > "$EV/gate-grouped.log" 2>&1; echo "grouped exit=$?"; cat "$EV/gate-grouped.log"
node scripts/verify-graph-model.ts --grouped --seed-wrong-anchor > "$EV/gate-wrong-anchor.log" 2>&1; echo "wrong-anchor exit=$? (expect non-zero)"; head -3 "$EV/gate-wrong-anchor.log"

echo; echo "== graph-core suite"
( bun test packages/mpd-graph-core ) > "$EV/tests-graph-core.log" 2>&1; echo "tests exit=$?"
grep -E '^ [0-9]+ (pass|fail|skip)|^Ran ' "$EV/tests-graph-core.log" | tail -4
( bun test packages/mpd-graph-core/test/model-groups.test.ts ) > "$EV/tests-model-groups.log" 2>&1
grep -E '^\s*\((pass|fail)\)' "$EV/tests-model-groups.log" | sed -E 's/\[[0-9.]+ms\]//' > "$EV/model-groups-arms.txt"; wc -l < "$EV/model-groups-arms.txt"

echo; echo "== INDEPENDENT BACKWARD PIN (my own pre-wave captures, JSON-only)"
node scripts/verify-graph-model.ts --board .mpd/team/teams/team-20261026095605866-z559-008.json --plan .mpd/plans/cellwork-w3-contract.md --emit > "$EV/emit-real.raw" 2>/dev/null
node scripts/verify-graph-model.ts --board "$BASE/board-synthetic.json" --plan "$BASE/plan-synthetic.md" --emit > "$EV/emit-synthetic.raw" 2>/dev/null
grep -v '^\[verify-graph-model\]' "$EV/emit-real.raw" > "$EV/emit-real.jsononly"
grep -v '^\[verify-graph-model\]' "$EV/emit-synthetic.raw" > "$EV/emit-synthetic.jsononly"
echo "-- want dd4af9c3… and 2f521a23…"; sha256sum "$EV/emit-real.jsononly" "$EV/emit-synthetic.jsononly"
diff -q "$BASE/model-nogroups.jsononly" "$EV/emit-real.jsononly" && echo "REAL IDENTICAL"
diff -q "$BASE/model-nogroups-synthetic.jsononly" "$EV/emit-synthetic.jsononly" && echo "SYNTHETIC IDENTICAL"
echo "-- groups key count (want 0 0):"; grep -c '"groups"' "$EV/emit-real.jsononly" "$EV/emit-synthetic.jsononly"
echo "-- determinism 3x:"; for i in 1 2 3; do node scripts/verify-graph-model.ts --board .mpd/team/teams/team-20261026095605866-z559-008.json --plan .mpd/plans/cellwork-w3-contract.md --emit 2>/dev/null | grep -v '^\[verify-graph-model\]' | sha256sum; done | tee "$EV/determinism-3x.txt"

echo; echo "== dist freshness (graph-core only) + full table"
node scripts/verify-dist-fresh.ts --only mpd-graph-core > "$EV/dist-fresh-graph-core.log" 2>&1; echo "graph-core dist exit=$?"; tail -1 "$EV/dist-fresh-graph-core.log"
bun run verify:docs > "$EV/verify-docs.log" 2>&1; echo "docs exit=$?"; tail -1 "$EV/verify-docs.log"
bun run verify:comments > "$EV/comments-root.log" 2>&1; echo "comments exit=$?"; tail -1 "$EV/comments-root.log"
bun run typecheck > "$EV/typecheck-root.log" 2>&1; echo "typecheck exit=$?"; tail -3 "$EV/typecheck-root.log"
( bun test packages ) > "$EV/tests-full.log" 2>&1; echo "full exit=$?"; grep -E '^ [0-9]+ (pass|fail|skip)|^Ran ' "$EV/tests-full.log" | tail -4
grep -E '^\s*\(fail\)' "$EV/tests-full.log" | sort -u > "$EV/tests-full-failures.txt"; cat "$EV/tests-full-failures.txt"

echo; echo "== hash sandwich: end $(date -u +%Y-%m-%dT%H:%M:%SZ)"
sandwich > "$EV/scope-end.sha256"; sha256sum "$EV/scope-end.sha256"
if diff -q "$EV/scope-start.sha256" "$EV/scope-end.sha256" >/dev/null; then echo "SANDWICH OK: start == end (after settle)"; else echo "SANDWICH BROKEN"; diff "$EV/scope-start.sha256" "$EV/scope-end.sha256"; fi
