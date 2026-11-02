#!/usr/bin/env bash
# T22 (web D4 NARROW seam) gate batch. Reads the tree; writes only the row evidence dir.
# Usage: bash t22-gates-v1.sh <row-evidence-dir>
set -u
EV="${1:?row evidence dir required}"
WS="$(cd "$(dirname "$0")" && git rev-parse --show-toplevel)"
cd "$WS" || exit 1
SCOPE=(packages/mpd-bundle-plugin)
sandwich() { find "${SCOPE[@]}" -type f | LC_ALL=C sort | xargs sha256sum; }
mkdir -p "$EV"

echo "== T21's declared hashes (relay, 2026-10-26T13:2xZ) vs measured"
cat > "$EV/declared.sha256" <<'DECLARED'
37e505f800000000000000000000000000000000000000000000000000000000  packages/mpd-bundle-plugin/src/team-view.ts
DECLARED
for pair in "37e505f8 packages/mpd-bundle-plugin/src/team-view.ts" "cb238921 packages/mpd-bundle-plugin/test/team-view.test.ts" "368b6ec2 packages/mpd-bundle-plugin/test/client-built-frames.test.ts" "be8d472c packages/mpd-bundle-plugin/client.js" "f84ad95b packages/mpd-bundle-plugin/dist/index.js"; do
  set -- $pair; want=$1; f=$2; got=$(sha256sum "$f" | cut -c1-8)
  [ "$want" = "$got" ] && echo "OK   $got $f" || echo "DIFF want=$want got=$got $f"
done | tee "$EV/declared-check.log"

echo; echo "== hash sandwich: start $(date -u +%Y-%m-%dT%H:%M:%SZ)"
sandwich > "$EV/scope-start.sha256"; sha256sum "$EV/scope-start.sha256"
echo "== settle window 50 s"; sleep 50
sandwich > "$EV/scope-postsettle.sha256"; sha256sum "$EV/scope-postsettle.sha256"

echo; echo "== bundle suite (the row's own gates)"
( bun test packages/mpd-bundle-plugin ) > "$EV/tests-bundle.log" 2>&1; echo "bundle exit=$?"
grep -E '^ [0-9]+ (pass|fail|skip)|^Ran ' "$EV/tests-bundle.log" | tail -3
( bun test packages/mpd-bundle-plugin/test/client-built-frames.test.ts ) > "$EV/tests-built-frames.log" 2>&1; echo "built-frames exit=$?"
grep -E '^\s*\((pass|fail)\)' "$EV/tests-built-frames.log" | sed -E 's/^\s*//; s/\[[0-9.]+ms\]//' > "$EV/built-frames-arms.txt"; cat "$EV/built-frames-arms.txt"
echo "-- the frame/group arms in team-view.test.ts:"
grep -E '^\s*\((pass|fail)\).*(group|frame|mpd-dag)' "$EV/tests-bundle.log" | sed -E 's/^\s*//; s/\[[0-9.]+ms\]//' | head -20 > "$EV/team-view-group-arms.txt"; cat "$EV/team-view-group-arms.txt"

echo; echo "== the BUILT client carries the channel (the contract's D4 line)"
for token in 'mpd-dag-group' 'data-mpd-group' 'data-mpd-frames' 'mpd-dag-node'; do
  printf '%-18s %s\n' "$token" "$(grep -c -- "$token" packages/mpd-bundle-plugin/client.js)"
done | tee "$EV/client-tokens.txt"
sha256sum packages/mpd-bundle-plugin/client.js | tee -a "$EV/client-tokens.txt"
wc -c packages/mpd-bundle-plugin/client.js | tee -a "$EV/client-tokens.txt"

echo; echo "== flat path vs HEAD (the TRAP: unchanged when no group)"
git show HEAD:packages/mpd-bundle-plugin/client.js > "$EV/client-head.js" 2>/dev/null
echo "HEAD client.js sha: $(sha256sum "$EV/client-head.js" | cut -c1-12) | now: $(sha256sum packages/mpd-bundle-plugin/client.js | cut -c1-12)"
echo "-- group tokens in HEAD's client (want 0):"; grep -c -- 'mpd-dag-group' "$EV/client-head.js" || true

echo; echo "== README pair: the BOUND must be truthful (interior collapsed, recursion NOT delivered)"
grep -n -i 'collapsed\|recursion\|not delivered\|narrow\|frame' packages/mpd-bundle-plugin/README.md > "$EV/readme-bound-en.txt" 2>&1; cat "$EV/readme-bound-en.txt"
grep -n -i '折叠\|递归\|未交付\|窄\|帧' packages/mpd-bundle-plugin/README.zh-CN.md > "$EV/readme-bound-zh.txt" 2>&1; cat "$EV/readme-bound-zh.txt"

echo; echo "== dist freshness (bundle) + typecheck + comments + docs"
node scripts/verify-dist-fresh.ts --only mpd-bundle-plugin > "$EV/dist-fresh-bundle.log" 2>&1; echo "dist exit=$?"; tail -1 "$EV/dist-fresh-bundle.log"
bun run typecheck > "$EV/typecheck-root.log" 2>&1; echo "typecheck exit=$?"; tail -3 "$EV/typecheck-root.log"
bun run verify:comments > "$EV/comments-root.log" 2>&1; echo "comments exit=$?"; tail -1 "$EV/comments-root.log"
bun run verify:docs > "$EV/verify-docs.log" 2>&1; echo "docs exit=$?"; tail -1 "$EV/verify-docs.log"

echo; echo "== scope metadata (stat only)"
git status --porcelain -- "${SCOPE[@]}" > "$EV/scope-status.log" 2>&1; cat "$EV/scope-status.log"
git diff --stat -- "${SCOPE[@]}" > "$EV/scope-diffstat.log" 2>&1; tail -4 "$EV/scope-diffstat.log"

echo; echo "== hash sandwich: end $(date -u +%Y-%m-%dT%H:%M:%SZ)"
sandwich > "$EV/scope-end.sha256"; sha256sum "$EV/scope-end.sha256"
if diff -q "$EV/scope-start.sha256" "$EV/scope-end.sha256" >/dev/null; then echo "SANDWICH OK: start == end (after settle)"; else echo "SANDWICH BROKEN"; diff "$EV/scope-start.sha256" "$EV/scope-end.sha256"; fi
