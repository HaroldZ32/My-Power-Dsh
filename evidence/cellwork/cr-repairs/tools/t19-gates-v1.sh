#!/usr/bin/env bash
# T19 (CR-R1: 8 findings, cellwork + team-core). Reads the tree; writes only the row evidence dir.
# Usage: bash t19-gates-v1.sh <row-evidence-dir>
set -u
EV="${1:?row evidence dir required}"
WS="$(cd "$(dirname "$0")" && git rev-parse --show-toplevel)"
cd "$WS" || exit 1
PRE=evidence/cellwork/dag-groups/2026-10-26T12-08-40Z-T14/tests-full.log   # pre-repair arm baseline
SCOPE=(packages/mpd-cellwork-plugin packages/mpd-team-core-plugin)
sandwich() { find "${SCOPE[@]}" -type f | LC_ALL=C sort | xargs sha256sum; }
mkdir -p "$EV"

if [ -f "$1/declared.sha256" ]; then
  echo "== declared-by-writer hashes vs measured"
  sha256sum -c "$EV/declared.sha256" > "$EV/declared-check.log" 2>&1; echo "declared-check exit=$?"; cat "$EV/declared-check.log"
fi

echo; echo "== hash sandwich: start $(date -u +%Y-%m-%dT%H:%M:%SZ)"
sandwich > "$EV/scope-start.sha256"; sha256sum "$EV/scope-start.sha256"
echo "== settle window 50 s"; sleep 50
sandwich > "$EV/scope-postsettle.sha256"; sha256sum "$EV/scope-postsettle.sha256"

echo; echo "== the two suites"
( bun test packages/mpd-cellwork-plugin ) > "$EV/tests-cellwork.log" 2>&1; echo "cellwork exit=$?"
grep -E '^ [0-9]+ (pass|fail|skip)|^Ran ' "$EV/tests-cellwork.log" | tail -3
( bun test packages/mpd-team-core-plugin ) > "$EV/tests-team-core.log" 2>&1; echo "team-core exit=$?"
grep -E '^ [0-9]+ (pass|fail|skip)|^Ran ' "$EV/tests-team-core.log" | tail -3
grep -hE '^\s*\((pass|fail)\)' "$EV/tests-cellwork.log" "$EV/tests-team-core.log" | sed -E 's/^\s*//; s/\[[0-9.]+ms\]//' | sort > "$EV/arms-this-row.txt"
wc -l < "$EV/arms-this-row.txt"

echo; echo "== NEW arms vs the pre-repair tree (a fix without a falsifiable arm is a FAIL)"
( bun test packages ) > "$EV/tests-full.log" 2>&1; echo "full exit=$?"
grep -E '^ [0-9]+ (pass|fail|skip)|^Ran ' "$EV/tests-full.log" | tail -3
grep -E '^\s*\(fail\)' "$EV/tests-full.log" | sort -u > "$EV/tests-full-failures.txt"; cat "$EV/tests-full-failures.txt"
grep -hE '^\s*\(pass\)' "$PRE" | sed -E 's/^\s*\(pass\) //; s/ \[[0-9.]+ms\]$//' | sort -u > "$EV/arms-pre.txt"
grep -hE '^\s*\(pass\)' "$EV/tests-full.log" | sed -E 's/^\s*\(pass\) //; s/ \[[0-9.]+ms\]$//' | sort -u > "$EV/arms-post.txt"
comm -13 "$EV/arms-pre.txt" "$EV/arms-post.txt" > "$EV/arms-added.txt"
echo "-- arms ADDED since the pre-repair tree: $(wc -l < "$EV/arms-added.txt")"; cat "$EV/arms-added.txt"
echo "-- arms REMOVED since the pre-repair tree (want none):"; comm -23 "$EV/arms-pre.txt" "$EV/arms-post.txt" | tee "$EV/arms-removed.txt"

echo; echo "== dist freshness for the two touched packages"
for p in mpd-cellwork-plugin mpd-team-core-plugin; do
  node scripts/verify-dist-fresh.ts --only "$p" > "$EV/dist-fresh-$p.log" 2>&1; echo "$p dist exit=$?"; tail -1 "$EV/dist-fresh-$p.log"
done

echo; echo "== typecheck + comments"
bun run typecheck > "$EV/typecheck-root.log" 2>&1; echo "typecheck exit=$?"; tail -3 "$EV/typecheck-root.log"
bun run verify:comments > "$EV/comments-root.log" 2>&1; echo "comments exit=$?"; tail -1 "$EV/comments-root.log"

echo; echo "== scope metadata (stat only)"
git status --porcelain -- "${SCOPE[@]}" > "$EV/scope-status.log" 2>&1; wc -l < "$EV/scope-status.log"
git diff --stat -- "${SCOPE[@]}" > "$EV/scope-diffstat.log" 2>&1; tail -4 "$EV/scope-diffstat.log"

echo; echo "== hash sandwich: end $(date -u +%Y-%m-%dT%H:%M:%SZ)"
sandwich > "$EV/scope-end.sha256"; sha256sum "$EV/scope-end.sha256"
if diff -q "$EV/scope-start.sha256" "$EV/scope-end.sha256" >/dev/null; then echo "SANDWICH OK: start == end (after settle)"; else echo "SANDWICH BROKEN"; diff "$EV/scope-start.sha256" "$EV/scope-end.sha256"; fi
