#!/usr/bin/env bash
# T5 (D2 + D5 + Amendment 7) gate batch. Reads the tree; writes only inside the row evidence dir.
# Usage: bash t5-gates-v1.sh <row-evidence-dir>
set -u
EV="${1:?row evidence dir required}"
WS="$(cd "$(dirname "$0")" && git rev-parse --show-toplevel)"
cd "$WS" || exit 1
SCOPE=(packages/mpd-team-core-plugin packages/mpd-cellwork-plugin)
sandwich() { find "${SCOPE[@]}" -type f | LC_ALL=C sort | xargs sha256sum; }
mkdir -p "$EV"

echo "== hash sandwich: start $(date -u +%Y-%m-%dT%H:%M:%SZ)"
sandwich > "$EV/scope-start.sha256"; sha256sum "$EV/scope-start.sha256"
echo "== settle window 50 s"; sleep 50
sandwich > "$EV/scope-postsettle.sha256"; sha256sum "$EV/scope-postsettle.sha256"

echo; echo "== per-package suites"
( bun test packages/mpd-team-core-plugin ) > "$EV/tests-team-core.log" 2>&1; echo "team-core exit=$?"
grep -E '^ [0-9]+ (pass|fail|skip)|^Ran ' "$EV/tests-team-core.log" | tail -4
( bun test packages/mpd-cellwork-plugin ) > "$EV/tests-cellwork.log" 2>&1; echo "cellwork exit=$?"
grep -E '^ [0-9]+ (pass|fail|skip)|^Ran ' "$EV/tests-cellwork.log" | tail -4
( bun test packages/mpd-team-core-plugin/test/nested-teams.test.ts ) > "$EV/tests-nested-teams.log" 2>&1; echo "nested-teams exit=$?"
grep -E '^\s*\((pass|fail)\)' "$EV/tests-nested-teams.log" | sed -E 's/\[[0-9.]+ms\]//' > "$EV/nested-teams-arms.txt"; wc -l < "$EV/nested-teams-arms.txt"
grep -E '^\s*\((pass|fail)\).*D5|^\s*\((pass|fail)\).*sub-cell|^\s*\((pass|fail)\).*sub-?team' "$EV/tests-cellwork.log" | sed -E 's/\[[0-9.]+ms\]//' > "$EV/cellwork-d5-arms.txt"; cat "$EV/d5-arms.log" 2>/dev/null; cat "$EV/cellwork-d5-arms.txt"

echo; echo "== the independence gate (attribution: whose edges are red)"
( bun test packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts ) > "$EV/tests-coupling.log" 2>&1; echo "coupling exit=$?"
grep -E 'unfrozen|stale|mpd-graph-core' "$EV/tests-coupling.log" | head -12 > "$EV/coupling-detail.txt"; cat "$EV/coupling-detail.txt"

echo; echo "== dist freshness (this row's two packages)"
node scripts/verify-dist-fresh.ts --only mpd-team-core-plugin > "$EV/dist-fresh-team-core.log" 2>&1; echo "team-core dist exit=$?"; tail -2 "$EV/dist-fresh-team-core.log"
node scripts/verify-dist-fresh.ts --only mpd-cellwork-plugin > "$EV/dist-fresh-cellwork.log" 2>&1; echo "cellwork dist exit=$?"; tail -2 "$EV/dist-fresh-cellwork.log"

echo; echo "== D2 claims, artifact-level (built dist)"
DIST=packages/mpd-team-core-plugin/dist/index.js
{
  echo "-- symbols present:"
  for token in parentTeamId deriveParentTeam assertParentChainAcyclic framedBoardOf groupInputsOf groupsOf isLiveTeam; do
    printf '   %-26s %s\n' "$token" "$(grep -c "$token" "$DIST")"
  done
  echo "-- Amendment 7 qualification (expect the qualification + same-frame blockedBy map):"
  grep -n 'row.id}`\|own.has(reference)' "$DIST" | head -4
  echo "-- groups omitted for a childless team (backward pin), expect the '{}' fallback:"
  grep -n 'groups.length === 0 ? {}' "$DIST" | head -2
  echo "-- /state projection: tasks come from the RECORD (no model pseudo-nodes) and rank from the model:"
  grep -n 'record.tasks.map((task)' "$DIST" | head -2
  grep -n 'rank: rankOf.get(task.id)' "$DIST" | head -2
  echo "-- derivation rules present (roster+not-lead, >1 refine, cycle):"
  grep -c 'readArchivedPlanIndex\|recordNamesMember(record, caller)' "$DIST"
} > "$EV/d2-artifact.txt" 2>&1; cat "$EV/d2-artifact.txt"

echo; echo "== README pair state (D2 nested section; D5 nested-groups sentence)"
grep -n -i 'nested team' packages/mpd-team-core-plugin/README.md packages/mpd-team-core-plugin/README.zh-CN.md > "$EV/readme-team-core-nested.txt" 2>&1; cat "$EV/readme-team-core-nested.txt"
{ echo "-- cellwork README pair, any mention of nested groups / parentTeamId (D5 names this sentence):"
  grep -n -i 'nested\|嵌套\|parentTeamId\|parent team\|subcell group' packages/mpd-cellwork-plugin/README.md packages/mpd-cellwork-plugin/README.zh-CN.md || echo "   (NO MATCH in either file)"
} > "$EV/readme-cellwork-d5.txt" 2>&1; cat "$EV/readme-cellwork-d5.txt"

echo; echo "== docs + comments + typecheck"
bun run verify:docs > "$EV/verify-docs.log" 2>&1; echo "docs exit=$?"; tail -1 "$EV/verify-docs.log"
bun run verify:comments > "$EV/comments-root.log" 2>&1; echo "comments exit=$?"; tail -1 "$EV/comments-root.log"
bun run typecheck > "$EV/typecheck-root.log" 2>&1; echo "typecheck exit=$?"; tail -3 "$EV/typecheck-root.log"

echo; echo "== full suite (tests gate; foreign reds expected)"
( bun test packages ) > "$EV/tests-full.log" 2>&1; echo "full exit=$?"
grep -E '^ [0-9]+ (pass|fail|skip)|^Ran ' "$EV/tests-full.log" | tail -4
grep -E '^\s*\(fail\)' "$EV/tests-full.log" | sort -u > "$EV/tests-full-failures.txt"; cat "$EV/tests-full-failures.txt"

echo; echo "== scope metadata (stat only)"
git status --porcelain -- "${SCOPE[@]}" > "$EV/scope-status.log" 2>&1
git diff --stat -- "${SCOPE[@]}" > "$EV/scope-diffstat.log" 2>&1; tail -3 "$EV/scope-diffstat.log"

echo; echo "== hash sandwich: end $(date -u +%Y-%m-%dT%H:%M:%SZ)"
sandwich > "$EV/scope-end.sha256"; sha256sum "$EV/scope-end.sha256"
if diff -q "$EV/scope-start.sha256" "$EV/scope-end.sha256" >/dev/null; then echo "SANDWICH OK: start == end (after settle)"; else echo "SANDWICH BROKEN"; diff "$EV/scope-start.sha256" "$EV/scope-end.sha256"; fi
