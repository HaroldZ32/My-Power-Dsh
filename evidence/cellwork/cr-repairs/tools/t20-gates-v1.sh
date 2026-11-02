#!/usr/bin/env bash
# T20 (CR-R2: 3 findings, TUI + compact + QA probe). Reads the tree; writes only the row evidence dir.
# Usage: bash t20-gates-v1.sh <row-evidence-dir>
set -u
EV="${1:?row evidence dir required}"
WS="$(cd "$(dirname "$0")" && git rev-parse --show-toplevel)"
cd "$WS" || exit 1
PRE=evidence/cellwork/dag-groups/2026-10-26T12-08-40Z-T14/tests-full.log   # pre-repair arm baseline
SCOPE=(packages/mpd-tui-plugin packages/mpd-team-compact-plugin skills/dsh-qa/scripts/lib/cellwork-command-probe.ts skills/dsh-qa/scripts/cellwork-command.ts)
sandwich() { sha256sum $(find "${SCOPE[@]}" -type f | LC_ALL=C sort); }
mkdir -p "$EV"

if [ -f "$EV/declared.sha256" ]; then
  echo "== declared-by-writer hashes vs measured"
  sha256sum -c "$EV/declared.sha256" > "$EV/declared-check.log" 2>&1; echo "declared-check exit=$?"; cat "$EV/declared-check.log"
fi

echo; echo "== hash sandwich: start $(date -u +%Y-%m-%dT%H:%M:%SZ)"
sandwich > "$EV/scope-start.sha256"; sha256sum "$EV/scope-start.sha256"
echo "== settle window 50 s"; sleep 50
sandwich > "$EV/scope-postsettle.sha256"; sha256sum "$EV/scope-postsettle.sha256"

echo; echo "== the two package suites"
( bun test packages/mpd-tui-plugin ) > "$EV/tests-tui.log" 2>&1; echo "tui exit=$?"
grep -E '^ [0-9]+ (pass|fail|skip)|^Ran ' "$EV/tests-tui.log" | tail -3
( bun test packages/mpd-team-compact-plugin ) > "$EV/tests-compact.log" 2>&1; echo "compact exit=$?"
grep -E '^ [0-9]+ (pass|fail|skip)|^Ran ' "$EV/tests-compact.log" | tail -3
grep -hE '^\s*\((pass|fail)\)' "$EV/tests-tui.log" "$EV/tests-compact.log" | sed -E 's/^\s*//; s/\[[0-9.]+ms\]//' | sort > "$EV/arms-this-row.txt"
wc -l < "$EV/arms-this-row.txt"

echo; echo "== the QA case: SELF-TEST (7 arms claimed) then the REAL case (no flags; isolated sandbox)"
( bun skills/dsh-qa/scripts/cellwork-command.ts --self-test ) > "$EV/qa-case-selftest.log" 2>&1; echo "qa self-test exit=$?"; tail -10 "$EV/qa-case-selftest.log"
( bun skills/dsh-qa/scripts/cellwork-command.ts ) > "$EV/qa-case.log" 2>&1; echo "qa case exit=$?"; tail -14 "$EV/qa-case.log"
echo "-- the new field + its assertion (the 3rd finding lives here):"
grep -n 'cellsAfterEmpty' skills/dsh-qa/scripts/lib/cellwork-command-probe.ts skills/dsh-qa/scripts/cellwork-command.ts > "$EV/qa-cellsAfterEmpty.txt" 2>&1; cat "$EV/qa-cellsAfterEmpty.txt"
echo "-- the case's own evidence dir for this run:"
grep -oE 'evidence/cellwork/qa/[0-9TZ.-]+-command' "$EV/qa-case.log" | head -2 | tee "$EV/qa-evidence-path.txt"

echo; echo "== NEW arms vs the pre-repair tree (a fix without a falsifiable arm is a FAIL)"
( bun test packages ) > "$EV/tests-full.log" 2>&1; echo "full exit=$?"
grep -E '^ [0-9]+ (pass|fail|skip)|^Ran ' "$EV/tests-full.log" | tail -3
grep -E '^\s*\(fail\)' "$EV/tests-full.log" | sort -u > "$EV/tests-full-failures.txt"; cat "$EV/tests-full-failures.txt"
grep -hE '^\s*\(pass\)' "$PRE" | sed -E 's/^\s*\(pass\) //; s/ \[[0-9.]+ms\]$//' | sort -u > "$EV/arms-pre.txt"
grep -hE '^\s*\(pass\)' "$EV/tests-full.log" | sed -E 's/^\s*\(pass\) //; s/ \[[0-9.]+ms\]$//' | sort -u > "$EV/arms-post.txt"
comm -13 "$EV/arms-pre.txt" "$EV/arms-post.txt" > "$EV/arms-added.txt"
echo "-- arms ADDED since the pre-repair tree: $(wc -l < "$EV/arms-added.txt")"; cat "$EV/arms-added.txt"
echo "-- arms REMOVED (want none):"; comm -23 "$EV/arms-pre.txt" "$EV/arms-post.txt" | tee "$EV/arms-removed.txt"

echo; echo "== dist freshness for the two touched packages"
for p in mpd-tui-plugin mpd-team-compact-plugin; do
  node scripts/verify-dist-fresh.ts --only "$p" > "$EV/dist-fresh-$p.log" 2>&1; echo "$p dist exit=$?"; tail -1 "$EV/dist-fresh-$p.log"
done

echo; echo "== typecheck + comments + vendor attribution (a skills/** change needs the captain's re-pin)"
bun run typecheck > "$EV/typecheck-root.log" 2>&1; echo "typecheck exit=$?"; tail -3 "$EV/typecheck-root.log"
bun run verify:comments > "$EV/comments-root.log" 2>&1; echo "comments exit=$?"; tail -1 "$EV/comments-root.log"
node scripts/verify-vendor.ts > "$EV/verify-vendor.log" 2>&1; echo "vendor exit=$?"; tail -4 "$EV/verify-vendor.log"

echo; echo "== scope metadata (stat only)"
git status --porcelain -- "${SCOPE[@]}" > "$EV/scope-status.log" 2>&1; cat "$EV/scope-status.log"

echo; echo "== hash sandwich: end $(date -u +%Y-%m-%dT%H:%M:%SZ)"
sandwich > "$EV/scope-end.sha256"; sha256sum "$EV/scope-end.sha256"
if diff -q "$EV/scope-start.sha256" "$EV/scope-end.sha256" >/dev/null; then echo "SANDWICH OK: start == end (after settle)"; else echo "SANDWICH BROKEN"; diff "$EV/scope-start.sha256" "$EV/scope-end.sha256"; fi
