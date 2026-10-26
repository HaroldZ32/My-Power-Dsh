#!/usr/bin/env bash
# T16 (review of T15: TUI coupling-inventory repair). Reads the tree; writes only the row evidence dir.
# Usage: bash t16-gates-v1.sh <row-evidence-dir>
set -u
EV="${1:?row evidence dir required}"
WS="$(cd "$(dirname "$0")" && git rev-parse --show-toplevel)"
cd "$WS" || exit 1
SCOPE=(packages/mpd-tui-plugin packages/mpd-dsh-adapter-plugin)
sandwich() { find "${SCOPE[@]}" -type f | LC_ALL=C sort | xargs sha256sum; }
mkdir -p "$EV"

echo "== hash sandwich: start $(date -u +%Y-%m-%dT%H:%M:%SZ)"
sandwich > "$EV/scope-start.sha256"; sha256sum "$EV/scope-start.sha256"
echo "== settle window 50 s"; sleep 50
sandwich > "$EV/scope-postsettle.sha256"; sha256sum "$EV/scope-postsettle.sha256"

echo; echo "== TUI dist byte-identity vs T6's verified build (want 684fa6f777a2feda8be6ab9a94e0776681147188dd6022ae4c674554182ea9ec)"
sha256sum packages/mpd-tui-plugin/dist/index.js | tee "$EV/tui-dist.sha256"

echo; echo "== the independence gate: full output + its own self-test"
( bun test packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts ) > "$EV/coupling-gate.log" 2>&1; echo "coupling exit=$?"
grep -E 'frozen inventory|couplings in the band|SELF-TEST|^ [0-9]+ (pass|fail)' "$EV/coupling-gate.log" | head -8
echo "-- the TUI entries the frozen inventory now carries:"
grep -n 'mpd-tui-plugin' packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts > "$EV/inventory-tui-lines.txt" 2>&1; cat "$EV/inventory-tui-lines.txt"
echo "-- every mpd-graph-core mention in the inventory file (the repair's design decision):"
grep -n -B2 -A2 'mpd-graph-core' packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts > "$EV/inventory-graph-core-lines.txt" 2>&1; cat "$EV/inventory-graph-core-lines.txt"

echo; echo "== suites this repair touches"
( bun test packages/mpd-tui-plugin ) > "$EV/tests-tui.log" 2>&1; echo "tui exit=$?"; grep -E '^ [0-9]+ (pass|fail|skip)|^Ran ' "$EV/tests-tui.log" | tail -4
( bun test packages/mpd-dsh-adapter-plugin ) > "$EV/tests-adapter.log" 2>&1; echo "adapter exit=$?"; grep -E '^ [0-9]+ (pass|fail|skip)|^Ran ' "$EV/tests-adapter.log" | tail -4

echo; echo "== dist freshness (tui + adapter)"
node scripts/verify-dist-fresh.ts --only mpd-tui-plugin > "$EV/dist-fresh-tui.log" 2>&1; echo "tui dist exit=$?"; tail -1 "$EV/dist-fresh-tui.log"
node scripts/verify-dist-fresh.ts --only mpd-dsh-adapter-plugin > "$EV/dist-fresh-adapter.log" 2>&1; echo "adapter dist exit=$?"; tail -1 "$EV/dist-fresh-adapter.log"

echo; echo "== structural GroupedGroup (the REDUCE route) present in the TUI dist?"
for token in GroupedGroup groupFrame DAG_GROUP_CHARS collapsedGroups; do printf '%-18s %s\n' "$token" "$(grep -c "$token" packages/mpd-tui-plugin/dist/index.js)"; done | tee "$EV/structural-tokens.txt"

echo; echo "== docs + comments + typecheck + full suite"
bun run verify:docs > "$EV/verify-docs.log" 2>&1; echo "docs exit=$?"; tail -1 "$EV/verify-docs.log"
bun run verify:comments > "$EV/comments-root.log" 2>&1; echo "comments exit=$?"; tail -1 "$EV/comments-root.log"
bun run typecheck > "$EV/typecheck-root.log" 2>&1; echo "typecheck exit=$?"; tail -3 "$EV/typecheck-root.log"
( bun test packages ) > "$EV/tests-full.log" 2>&1; echo "full exit=$?"; grep -E '^ [0-9]+ (pass|fail|skip)|^Ran ' "$EV/tests-full.log" | tail -4
grep -E '^\s*\(fail\)' "$EV/tests-full.log" | sort -u > "$EV/tests-full-failures.txt"; cat "$EV/tests-full-failures.txt"

echo; echo "== scope metadata (stat only)"
git status --porcelain -- "${SCOPE[@]}" > "$EV/scope-status.log" 2>&1; wc -l < "$EV/scope-status.log"
git diff --stat -- "${SCOPE[@]}" > "$EV/scope-diffstat.log" 2>&1; tail -4 "$EV/scope-diffstat.log"

echo; echo "== hash sandwich: end $(date -u +%Y-%m-%dT%H:%M:%SZ)"
sandwich > "$EV/scope-end.sha256"; sha256sum "$EV/scope-end.sha256"
if diff -q "$EV/scope-start.sha256" "$EV/scope-end.sha256" >/dev/null; then echo "SANDWICH OK: start == end (after settle)"; else echo "SANDWICH BROKEN"; diff "$EV/scope-start.sha256" "$EV/scope-end.sha256"; fi
