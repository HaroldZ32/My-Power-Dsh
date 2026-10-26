#!/usr/bin/env bash
# T4 (D1, graph-core) gate batch. Read-only against the tree; writes only inside the row evidence dir.
# Usage: bash t4-gates.sh <row-evidence-dir>
set -u
EV="${1:?row evidence dir required}"
WS="$(cd "$(dirname "$0")/../../../../../.." && pwd)"
cd "$WS" || exit 1
BASE=evidence/cellwork/dag-groups/2026-10-26T10-54-01Z-baseline
SCOPE=(packages/mpd-graph-core scripts/verify-graph-model.ts)
sandwich() {
  find "${SCOPE[@]}" -type f | LC_ALL=C sort | xargs sha256sum
}

echo "== row dir: $EV"
mkdir -p "$EV"

echo "== hash sandwich: start ($(date -u +%Y-%m-%dT%H:%M:%SZ))"
sandwich > "$EV/scope-start.sha256"
sha256sum "$EV/scope-start.sha256" | tee "$EV/scope-start.aggregate"

echo "== settle window 50s"
sleep 50
sandwich > "$EV/scope-postsettle.sha256"
sha256sum "$EV/scope-postsettle.aggregate" | tee "$EV/scope-postsettle.aggregate.raw"
sha256sum "$EV/scope-postsettle.sha256" | tee -a "$EV/scope-postsettle.aggregate.raw"

echo "== package tests"
( bun test packages/mpd-graph-core ) > "$EV/tests-graph-core.log" 2>&1
echo "tests exit=$?" | tee "$EV/tests-graph-core.exit"

echo "== graph-model gate self-test (group arm + seeded negative)"
( node scripts/verify-graph-model.ts --self-test ) > "$EV/gate-selftest.log" 2>&1
echo "selftest exit=$?" | tee -a "$EV/gate-selftest.log"
( node scripts/verify-graph-model.ts --help ) > "$EV/gate-help.log" 2>&1

echo "== backward pin A/B (JSON-only, trailing oracle lines stripped)"
grep -v '^\[verify-graph-model\]' "$BASE/model-nogroups.json" > "$BASE/model-nogroups.jsononly"
grep -v '^\[verify-graph-model\]' "$BASE/model-nogroups-synthetic.json" > "$BASE/model-nogroups-synthetic.jsononly"
node scripts/verify-graph-model.ts --board .mpd/team/teams/team-20261026095605866-z559-008.json --plan .mpd/plans/cellwork-w3-contract.md --emit > "$EV/emit-real.raw" 2>"$EV/emit-real.err"
echo "emit-real exit=$?"
node scripts/verify-graph-model.ts --board "$BASE/board-synthetic.json" --plan "$BASE/plan-synthetic.md" --emit > "$EV/emit-synthetic.raw" 2>"$EV/emit-synthetic.err"
echo "emit-synthetic exit=$?"
grep -v '^\[verify-graph-model\]' "$EV/emit-real.raw" > "$EV/emit-real.jsononly"
grep -v '^\[verify-graph-model\]' "$EV/emit-synthetic.raw" > "$EV/emit-synthetic.jsononly"
echo "-- A/B hashes (want dd4af9c3… and 2f521a23…):"
sha256sum "$EV/emit-real.jsononly" "$EV/emit-synthetic.jsononly"
echo "-- groups key count (want 0,0):"
grep -c '"groups"' "$EV/emit-real.jsononly" "$EV/emit-synthetic.jsononly"
echo "-- diff vs baseline:"
diff -q "$BASE/model-nogroups.jsononly" "$EV/emit-real.jsononly" && echo "real IDENTICAL"
diff -q "$BASE/model-nogroups-synthetic.jsononly" "$EV/emit-synthetic.jsononly" && echo "synthetic IDENTICAL"
echo "-- determinism: three emits of the real pair, byte-compared"
for i in 1 2 3; do node scripts/verify-graph-model.ts --board .mpd/team/teams/team-20261026095605866-z559-008.json --plan .mpd/plans/cellwork-w3-contract.md --emit 2>/dev/null | grep -v '^\[verify-graph-model\]' | sha256sum; done | tee "$EV/determinism-3x.txt"

echo "== README pair names groups"
grep -c 'group' packages/mpd-graph-core/README.md packages/mpd-graph-core/README.zh-CN.md | tee "$EV/readme-group-counts.txt"

echo "== scope metadata (stat only, no content)"
git diff --stat -- "${SCOPE[@]}" > "$EV/scope-diffstat.log" 2>&1
git status --porcelain -- "${SCOPE[@]}" > "$EV/scope-status.log" 2>&1

echo "== hash sandwich: end ($(date -u +%Y-%m-%dT%H:%M:%SZ))"
sandwich > "$EV/scope-end.sha256"
sha256sum "$EV/scope-end.sha256" | tee "$EV/scope-end.aggregate"
if diff -q "$EV/scope-start.sha256" "$EV/scope-end.sha256" >/dev/null; then
  echo "SANDWICH OK: start == end"
else
  echo "SANDWICH BROKEN: the tree moved during the batch"
  diff "$EV/scope-start.sha256" "$EV/scope-end.sha256"
fi
