#!/usr/bin/env bash
# T32 (T31 fix: attachModel must accept a MERGED nested model; root-frame bijection). Row dir only.
set -u
EV="${1:?row evidence dir required}"
WS="$(cd "$(dirname "$0")" && git rev-parse --show-toplevel)"
cd "$WS" || exit 1
SCOPE=(packages/mpd-tui-plugin)
mkdir -p "$EV"

echo "== the relay's declared hashes vs measured (8-char prefixes)"
for pair in "a47b4f2b packages/mpd-tui-plugin/src/team-state.ts" "423d8725 packages/mpd-tui-plugin/test/team-record-source.test.ts" "187b83bb packages/mpd-tui-plugin/dist/index.js"; do
  set -- $pair; want=$1; f=$2; got=$(sha256sum "$f" | cut -c1-8)
  [ "$want" = "$got" ] && echo "OK   $got $f" || echo "DIFF want=$want got=$got $f"
done | tee "$EV/declared-check.log"

echo; echo "== hash sandwich: start $(date -u +%Y-%m-%dT%H:%M:%SZ)"
find "${SCOPE[@]}" -type f | LC_ALL=C sort | xargs sha256sum > "$EV/scope-start.sha256"; sha256sum "$EV/scope-start.sha256"
echo "== settle window 50 s"; sleep 50
find "${SCOPE[@]}" -type f | LC_ALL=C sort | xargs sha256sum > "$EV/scope-postsettle.sha256"; sha256sum "$EV/scope-postsettle.sha256"

echo; echo "== TUI suite + the three new arms"
( bun test packages/mpd-tui-plugin ) > "$EV/tests-tui.log" 2>&1; echo "tui exit=$?"
grep -E '^ [0-9]+ (pass|fail|skip)|^Ran ' "$EV/tests-tui.log" | tail -3
grep -hE '^\s*\((pass|fail)\).*(attachModel|merged|nested|bijection|root frame|explained|group)' "$EV/tests-tui.log" | sed -E 's/^\s*//; s/\[[0-9.]+ms\]//' | sort -u > "$EV/t32-arms.txt"; cat "$EV/t32-arms.txt"
( bun test packages/mpd-tui-plugin/test/team-record-source.test.ts ) > "$EV/tests-record-source.log" 2>&1; echo "record-source exit=$?"
grep -E '^\s*\((pass|fail)\)' "$EV/tests-record-source.log" | sed -E 's/^\s*//; s/\[[0-9.]+ms\]//' | tee "$EV/record-source-arms.txt"

echo; echo "== the three arms' bodies (LIVE / FLAT / NEGATIVE)"
python3 - "$EV" <<'PY' | tee "$EV/arm-bodies.txt"
p='packages/mpd-tui-plugin/test/team-record-source.test.ts'
src=open(p,encoding='utf-8').read()
import re
names=re.findall(r'test\(\s*"([^"]{20,140})"', src)
for n in names:
    if any(k in n.lower() for k in ('merge','nested','group','flat','unexplained','root frame','box')):
        i=src.find(n)
        print('='*96); print('ARM:', n)
        print('\n'.join(src[i:].split('\n')[:52]))
PY

echo; echo "== full suite + typecheck + comments + dist"
( bun test packages ) > "$EV/tests-full.log" 2>&1; echo "full exit=$?"
grep -E '^ [0-9]+ (pass|fail|skip)|^Ran ' "$EV/tests-full.log" | tail -3
grep -E '^\s*\(fail\)' "$EV/tests-full.log" | sort -u | tee "$EV/tests-full-failures.txt"
bun run typecheck > "$EV/typecheck-root.log" 2>&1; echo "typecheck exit=$?"; tail -2 "$EV/typecheck-root.log"
bun run verify:comments > "$EV/comments-root.log" 2>&1; echo "comments exit=$?"; tail -1 "$EV/comments-root.log"
node scripts/verify-dist-fresh.ts --only mpd-tui-plugin > "$EV/dist-fresh-tui.log" 2>&1; echo "dist exit=$?"; tail -1 "$EV/dist-fresh-tui.log"

echo; echo "== the writer's claim: no doc carried the retired D3 bound (verify the search)"
grep -rn 'collapsed\|not claimed\|no frame of its own\|recursive, variable-column' packages/mpd-tui-plugin/README.md packages/mpd-tui-plugin/README.zh-CN.md | head -8 | tee "$EV/tui-readme-bound-grep.txt"
echo "-- and the dist group symbols still present:"
for t in DAG_GROUP_CHARS collapsedGroups hitTestGroup; do printf '   %-18s %s\n' "$t" "$(grep -c -- "$t" packages/mpd-tui-plugin/dist/index.js)"; done | tee -a "$EV/tui-readme-bound-grep.txt"

echo; echo "== scope metadata (stat only)"
git status --porcelain -- "${SCOPE[@]}" | tee "$EV/scope-status.log"

echo; echo "== hash sandwich: end $(date -u +%Y-%m-%dT%H:%M:%SZ)"
find "${SCOPE[@]}" -type f | LC_ALL=C sort | xargs sha256sum > "$EV/scope-end.sha256"; sha256sum "$EV/scope-end.sha256"
if diff -q "$EV/scope-start.sha256" "$EV/scope-end.sha256" >/dev/null; then echo "SANDWICH OK: start == end (after settle)"; else echo "SANDWICH BROKEN"; diff "$EV/scope-start.sha256" "$EV/scope-end.sha256"; fi
