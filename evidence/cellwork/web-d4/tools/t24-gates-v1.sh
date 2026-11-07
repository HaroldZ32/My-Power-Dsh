#!/usr/bin/env bash
# T24 (web D4 FULL acceptance: recursive variable-column geometry). Reads the tree; writes only the row dir.
# Usage: bash t24-gates-v1.sh <row-evidence-dir>   (write <EV>/declared.sha256 BEFORE running)
set -u
EV="${1:?row evidence dir required}"
WS="$(cd "$(dirname "$0")" && git rev-parse --show-toplevel)"
cd "$WS" || exit 1
SCOPE=(packages/mpd-bundle-plugin)
sandwich() { find "${SCOPE[@]}" -type f | LC_ALL=C sort | xargs sha256sum; }
mkdir -p "$EV"

if [ -f "$EV/declared.sha256" ]; then
  echo "== declared-by-writer hashes vs measured"
  sha256sum -c "$EV/declared.sha256" > "$EV/declared-check.log" 2>&1; echo "declared-check exit=$?"; cat "$EV/declared-check.log"
fi

echo; echo "== hash sandwich: start $(date -u +%Y-%m-%dT%H:%M:%SZ)"
sandwich > "$EV/scope-start.sha256"; sha256sum "$EV/scope-start.sha256"
echo "== settle window 50 s"; sleep 50
sandwich > "$EV/scope-postsettle.sha256"; sha256sum "$EV/scope-postsettle.sha256"

echo; echo "== bundle suite"
( bun test packages/mpd-bundle-plugin ) > "$EV/tests-bundle.log" 2>&1; echo "bundle exit=$?"
grep -E '^ [0-9]+ (pass|fail|skip)|^Ran ' "$EV/tests-bundle.log" | tail -3
grep -hE '^\s*\((pass|fail)\).*(D4|nested|nest|frame|group|recurs)' "$EV/tests-bundle.log" | sed -E 's/^\s*//; s/\[[0-9.]+ms\]//' > "$EV/d4-arms.txt"; cat "$EV/d4-arms.txt"
( bun test packages/mpd-bundle-plugin/test/client-built-frames.test.ts ) > "$EV/tests-built-frames.log" 2>&1; echo "built-frames exit=$?"
grep -E '^\s*\((pass|fail)\)' "$EV/tests-built-frames.log" | sed -E 's/^\s*//; s/\[[0-9.]+ms\]//' | tee "$EV/built-frames-arms.txt"

echo; echo "== the BUILT client: channel + RECURSION markers"
for token in 'mpd-dag-group' 'data-mpd-group' 'data-mpd-frames' 'layoutFrame' 'groups.length === 0'; do
  printf '%-22s %s\n' "$token" "$(grep -c -- "$token" packages/mpd-bundle-plugin/client.js)"
done | tee "$EV/client-tokens.txt"
sha256sum packages/mpd-bundle-plugin/client.js | tee -a "$EV/client-tokens.txt"; wc -c packages/mpd-bundle-plugin/client.js | tee -a "$EV/client-tokens.txt"

echo; echo "== FLAT-path guard must survive (byte-identical flat path) + nested emission visible"
python3 - "$EV" <<'PY' | tee "$EV/built-structure.txt"
import sys
src = open('packages/mpd-bundle-plugin/client.js', encoding='utf-8', errors='replace').read()
flat = src.replace('\n', ' ')
for needle, label in [('graph.groups === undefined', 'frames-layer guard'),
                      ('data-mpd-group', 'frame rect publish'),
                      ('layoutFrame', 'recursive layout function'),
                      ('frameOrigin', 'frame origin arithmetic')]:
    i = flat.find(needle)
    print(f'--- {label} (`{needle}`) at {i} ---')
    if i >= 0:
        print(flat[max(0, i-200):i+260])
    print()
PY

echo; echo "== README pair: the delivered recursion must be CLAIMED and the old bound RETIRED"
grep -n -i 'recursi\|nest\|collapse\|not claimed\|interior' packages/mpd-bundle-plugin/README.md > "$EV/readme-en.txt" 2>&1; cat "$EV/readme-en.txt"
grep -n -i '递归\|嵌套\|折叠\|未声称\|内部' packages/mpd-bundle-plugin/README.zh-CN.md > "$EV/readme-zh.txt" 2>&1; cat "$EV/readme-zh.txt"

echo; echo "== flat expectations must not have been relaxed (test-file diff, metadata only)"
git diff HEAD -- packages/mpd-bundle-plugin/test/team-view.test.ts > "$EV/test-diff.patch" 2>&1
grep -nE '^-' "$EV/test-diff.patch" | grep -viE '^-{3}' | grep -iE 'data-mpd|curve|overlaps|expect' | head -20 | tee "$EV/test-diff-removals.txt"
echo "-- (an empty list means no existing flat expectation was deleted)"

echo; echo "== dist freshness + typecheck + comments + docs"
node scripts/verify-dist-fresh.ts --only mpd-bundle-plugin > "$EV/dist-fresh-bundle.log" 2>&1; echo "dist exit=$?"; tail -1 "$EV/dist-fresh-bundle.log"
bun run typecheck > "$EV/typecheck-root.log" 2>&1; echo "typecheck exit=$?"; tail -3 "$EV/typecheck-root.log"
bun run verify:comments > "$EV/comments-root.log" 2>&1; echo "comments exit=$?"; tail -1 "$EV/comments-root.log"
bun run verify:docs > "$EV/verify-docs.log" 2>&1; echo "docs exit=$?"; tail -1 "$EV/verify-docs.log"

echo; echo "== scope metadata (stat only)"
git status --porcelain -- "${SCOPE[@]}" > "$EV/scope-status.log" 2>&1; cat "$EV/scope-status.log"
git diff --stat -- "${SCOPE[@]}" > "$EV/scope-diffstat.log" 2>&1; tail -5 "$EV/scope-diffstat.log"

echo; echo "== hash sandwich: end $(date -u +%Y-%m-%dT%H:%M:%SZ)"
sandwich > "$EV/scope-end.sha256"; sha256sum "$EV/scope-end.sha256"
if diff -q "$EV/scope-start.sha256" "$EV/scope-end.sha256" >/dev/null; then echo "SANDWICH OK: start == end (after settle)"; else echo "SANDWICH BROKEN"; diff "$EV/scope-start.sha256" "$EV/scope-end.sha256"; fi
