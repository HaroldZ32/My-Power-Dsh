#!/usr/bin/env bash
# T10 (D6 documentation) gate batch. Docs-only subject; reads the tree, writes only the row evidence dir.
set -u
EV="${1:?row evidence dir required}"
WS="$(cd "$(dirname "$0")" && git rev-parse --show-toplevel)"
cd "$WS" || exit 1
SCOPE=(docs/cellwork.md docs/cellwork.zh-CN.md docs/tui-dag-renderer.md docs/tui-dag-renderer.zh-CN.md packages/mpd-cellwork-plugin/README.md packages/mpd-cellwork-plugin/README.zh-CN.md)
sandwich() { sha256sum "${SCOPE[@]}"; }
mkdir -p "$EV"

echo "== declared-by-writer hashes (T9 freeze mail 2026-10-26T12:15:17Z)"
cat > "$EV/declared.sha256" <<'DECLARED'
38a45ac7c4cb2727b3482a23a1c06ff1088aa3347725eac0341d16abb1dc1a92  docs/cellwork.md
8696ccf5a4fe536eecb4a15d2e3b2b67f0711fc6e7564fb68e464164e1b5408d  docs/cellwork.zh-CN.md
6aa9c06f48f63776613949aecf73ac0cd2bb5d02da6c25cf579280c70153fbdb  docs/tui-dag-renderer.md
e707ac3b971daa123f61edfd684812d112086becb23b3484682891b694ccd0ec  docs/tui-dag-renderer.zh-CN.md
e19011c251bfdb116475fea96dc70e50b0f86ec7bf4b3c210ee7b644487bfef8  packages/mpd-cellwork-plugin/README.md
d431285c0f7ed1afe9ca5f2697284280cbd813f47d92624f6c53bcd223c59e3f  packages/mpd-cellwork-plugin/README.zh-CN.md
DECLARED
sha256sum -c "$EV/declared.sha256" > "$EV/declared-check.log" 2>&1; echo "declared-check exit=$?"; cat "$EV/declared-check.log"

echo; echo "== hash sandwich: start $(date -u +%Y-%m-%dT%H:%M:%SZ)"
sandwich > "$EV/scope-start.sha256"; sha256sum "$EV/scope-start.sha256" | tee "$EV/scope-start.aggregate"
echo "== settle window 50 s"; sleep 50
sandwich > "$EV/scope-postsettle.sha256"; sha256sum "$EV/scope-postsettle.sha256" | tee "$EV/scope-postsettle.aggregate"

echo; echo "== CHECK 1: the FALSE 'parent_team_id is deferred' bullet must be GONE (EN + zh), and the implicit seam named"
{ echo "-- the old bullet (want NO MATCH):"
  grep -n 'parent_team_id. is deferred\|parent_team_id` is deferred\|parent_team_id 推迟' docs/cellwork.md docs/cellwork.zh-CN.md || echo "   (NO MATCH — retired)"
  echo "-- the seam (implicit derivation) named:"
  grep -n -i 'implicit' docs/cellwork.md | head -4
  echo "-- the zh twin's seam wording:"
  grep -n '隐式\|implicit' docs/cellwork.zh-CN.md | head -4
  echo "-- the web deferral bound, stated rather than implied (want an explicit NOT-delivered sentence):"
  grep -n -i 'web' docs/cellwork.md | head -8
  grep -n -i 'web' docs/cellwork.zh-CN.md | head -6
} > "$EV/check1-seam-and-web-bound.txt" 2>&1; cat "$EV/check1-seam-and-web-bound.txt"

echo; echo "== CHECK 2: the cellwork README pair carries the D5 subsection (both languages, heading parity)"
{ grep -n '^#\+ ' packages/mpd-cellwork-plugin/README.md | wc -l
  grep -n '^#\+ ' packages/mpd-cellwork-plugin/README.zh-CN.md | wc -l
  echo "-- the EN subsection:"; grep -n -i 'nested\|group box' packages/mpd-cellwork-plugin/README.md | head -6
  echo "-- the zh subsection:"; grep -n -i '嵌套\|分组盒子\|子单元' packages/mpd-cellwork-plugin/README.zh-CN.md | head -6
} > "$EV/check2-cellwork-readme.txt" 2>&1; cat "$EV/check2-cellwork-readme.txt"

echo; echo "== CHECK 3: the renderer decision record pair (nested-group decision, glyph family, collapse rule)"
{ echo "-- new subsection present in both:"
  grep -n '3\.1 Nested groups\|3\.1 .*嵌套' docs/tui-dag-renderer.md docs/tui-dag-renderer.zh-CN.md
  echo "-- glyph family / port / crossing / collapse vocabulary (EN):"
  grep -n 'DAG_GROUP_CHARS\|collapsedGroups\|hitTestGroup\|groupId\|╧\|╫\|half' docs/tui-dag-renderer.md | head -10
  echo "-- the same in zh:"
  grep -n 'DAG_GROUP_CHARS\|collapsedGroups\|hitTestGroup\|╧\|╫' docs/tui-dag-renderer.zh-CN.md | head -10
  echo "-- existing headings must NOT be renamed (the six original section titles):"
  grep -n '^## \|^### ' docs/tui-dag-renderer.md
} > "$EV/check3-renderer-doc.txt" 2>&1; cat "$EV/check3-renderer-doc.txt"

echo; echo "== heading-tree parity per pair (structure, not just counts)"
for pair in "docs/cellwork.md docs/cellwork.zh-CN.md" "docs/tui-dag-renderer.md docs/tui-dag-renderer.zh-CN.md" "packages/mpd-cellwork-plugin/README.md packages/mpd-cellwork-plugin/README.zh-CN.md"; do
  set -- $pair
  en=$(grep -c '^#\+ ' "$1"); zh=$(grep -c '^#\+ ' "$2")
  en2=$(grep -c '^## ' "$1"); zh2=$(grep -c '^## ' "$2")
  echo "$1  h=$en h2=$en2   |   $2  h=$zh h2=$zh2   $( [ "$en" = "$zh" ] && [ "$en2" = "$zh2" ] && echo SAME || echo DIFF )"
  echo "   switch link under the title: en=$(sed -n '1,4p' "$1" | grep -c '\.zh-CN\.md') zh=$(sed -n '1,4p' "$2" | grep -c '\.md)')"
done | tee "$EV/heading-parity.txt"

echo; echo "== docs gate (pairs, links, CJK, resolution)"
bun run verify:docs > "$EV/verify-docs.log" 2>&1; echo "docs exit=$?"; tail -1 "$EV/verify-docs.log"

echo; echo "== no claim exceeds what the wave delivered (spot check on absolute web claims)"
grep -n -i 'web.*render\|renders.*web\|web panel shows\|web frame' docs/cellwork.md docs/tui-dag-renderer.md > "$EV/web-claims.txt" 2>&1; cat "$EV/web-claims.txt"

echo; echo "== scope metadata (stat only) + full-suite sanity"
git status --porcelain -- "${SCOPE[@]}" > "$EV/scope-status.log" 2>&1; wc -l < "$EV/scope-status.log"
git status --porcelain -- docs/ packages/ scripts/ | grep -v '^??' > "$EV/tree-dirty.log" 2>&1; wc -l < "$EV/tree-dirty.log"

echo; echo "== hash sandwich: end $(date -u +%Y-%m-%dT%H:%M:%SZ)"
sandwich > "$EV/scope-end.sha256"; sha256sum "$EV/scope-end.sha256" | tee "$EV/scope-end.aggregate"
if diff -q "$EV/scope-start.sha256" "$EV/scope-end.sha256" >/dev/null; then echo "SANDWICH OK: start == end (after settle)"; else echo "SANDWICH BROKEN"; diff "$EV/scope-start.sha256" "$EV/scope-end.sha256"; fi
