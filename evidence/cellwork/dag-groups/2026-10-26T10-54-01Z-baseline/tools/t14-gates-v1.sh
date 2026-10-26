#!/usr/bin/env bash
# T14 (review of T13's no-op repair: Amendment 9 R1/R2 as history + the inventory's current state).
set -u
EV="${1:?row evidence dir required}"
WS="$(cd "$(dirname "$0")" && git rev-parse --show-toplevel)"
cd "$WS" || exit 1
SCOPE=(packages/mpd-cellwork-plugin packages/mpd-team-core-plugin packages/mpd-dsh-adapter-plugin)
sandwich() { find "${SCOPE[@]}" -type f | LC_ALL=C sort | xargs sha256sum; }
mkdir -p "$EV"

echo "== hash sandwich: start $(date -u +%Y-%m-%dT%H:%M:%SZ)"
sandwich > "$EV/scope-start.sha256"; sha256sum "$EV/scope-start.sha256"
echo "== settle window 50 s"; sleep 50
sandwich > "$EV/scope-postsettle.sha256"; sha256sum "$EV/scope-postsettle.sha256"

echo; echo "== the two Amendment-9 reds, re-measured"
( bun test packages/mpd-cellwork-plugin ) > "$EV/tests-cellwork.log" 2>&1; echo "cellwork exit=$?"
grep -E '^ [0-9]+ (pass|fail|skip)|^Ran ' "$EV/tests-cellwork.log" | tail -3
grep -E '^\s*\((pass|fail)\).*(D5|sub-cell|collision|cellId|parent)' "$EV/tests-cellwork.log" | sed -E 's/\[[0-9.]+ms\]//' > "$EV/cellwork-d5-arms.txt"; cat "$EV/cellwork-d5-arms.txt"
( bun test packages/mpd-team-core-plugin ) > "$EV/tests-team-core.log" 2>&1; echo "team-core exit=$?"
grep -E '^ [0-9]+ (pass|fail|skip)|^Ran ' "$EV/tests-team-core.log" | tail -3
( bun test packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts ) > "$EV/coupling-gate.log" 2>&1; echo "coupling exit=$?"
grep -E 'frozen inventory|RESULT:|SELF-TEST' "$EV/coupling-gate.log" | head -5
echo "-- team-core's graph-model entries (the R2 preferred fix: the frozen import must be unchanged):"
grep -n 'mpd-team-core-plugin/src/graph-model.ts' packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts > "$EV/inventory-team-core-lines.txt"; cat "$EV/inventory-team-core-lines.txt"

echo; echo "== the R1 root-cause machinery is in the BUILT cellwork dist"
{
  echo "-- freeCellId (the collision-safe minter):"; grep -n 'function freeCellId' packages/mpd-cellwork-plugin/dist/index.js | head -2
  echo "-- used for the sub-cell id (not cellIdAt):"; grep -n 'freeCellId(caller.workspace' packages/mpd-cellwork-plugin/dist/index.js | head -2
  echo "-- parentTeamId on the cell record:"; grep -c 'parentTeamId' packages/mpd-cellwork-plugin/dist/index.js
} > "$EV/r1-artifact.txt" 2>&1; cat "$EV/r1-artifact.txt"

echo; echo "== dist freshness (this row's packages)"
for p in mpd-cellwork-plugin mpd-team-core-plugin; do
  node scripts/verify-dist-fresh.ts --only "$p" > "$EV/dist-fresh-$p.log" 2>&1; echo "$p dist exit=$?"; tail -1 "$EV/dist-fresh-$p.log"
done

echo; echo "== repo-wide gates"
bun run verify:docs > "$EV/verify-docs.log" 2>&1; echo "docs exit=$?"; tail -1 "$EV/verify-docs.log"
bun run verify:comments > "$EV/comments-root.log" 2>&1; echo "comments exit=$?"; tail -1 "$EV/comments-root.log"
bun run typecheck > "$EV/typecheck-root.log" 2>&1; echo "typecheck exit=$?"; tail -3 "$EV/typecheck-root.log"
( bun test packages ) > "$EV/tests-full.log" 2>&1; echo "full exit=$?"; grep -E '^ [0-9]+ (pass|fail|skip)|^Ran ' "$EV/tests-full.log" | tail -3
grep -E '^\s*\(fail\)' "$EV/tests-full.log" | sort -u > "$EV/tests-full-failures.txt"; cat "$EV/tests-full-failures.txt"

echo; echo "== hash sandwich: end $(date -u +%Y-%m-%dT%H:%M:%SZ)"
sandwich > "$EV/scope-end.sha256"; sha256sum "$EV/scope-end.sha256"
if diff -q "$EV/scope-start.sha256" "$EV/scope-end.sha256" >/dev/null; then echo "SANDWICH OK: start == end (after settle)"; else echo "SANDWICH BROKEN"; diff "$EV/scope-start.sha256" "$EV/scope-end.sha256"; fi
