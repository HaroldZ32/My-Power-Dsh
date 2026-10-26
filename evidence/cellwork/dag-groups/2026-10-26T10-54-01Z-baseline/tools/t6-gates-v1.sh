#!/usr/bin/env bash
# T6 (D3, TUI only) gate batch. Reads the tree; writes only inside the row evidence dir.
# Usage: bash t6-gates-v1.sh <row-evidence-dir>
set -u
EV="${1:?row evidence dir required}"
WS="$(cd "$(dirname "$0")" && git rev-parse --show-toplevel)"
cd "$WS" || exit 1
BASE=evidence/cellwork/dag-groups/2026-10-26T10-54-01Z-baseline
SCOPE=(packages/mpd-tui-plugin)
sandwich() { find "${SCOPE[@]}" -type f | LC_ALL=C sort | xargs sha256sum; }
mkdir -p "$EV"

echo "== declared-by-writer hashes (T3 freeze mail 2026-10-26T11:34:46Z)"
cat > "$EV/declared.sha256" <<'DECLARED'
8871b2a34ca577401b5203fecaba1dc0b855b59ad4a86e20e64215e0fee526d9  packages/mpd-tui-plugin/src/dag-groups.ts
4011fabec3d7254d46f4d41a26ee31a19f7da1875c303661052475ca48a8a33e  packages/mpd-tui-plugin/src/dag-theme.ts
3fd6d92e7f14b20cda5dab3fd240e2a1d753b915ba5584b62be285ba6fb855f5  packages/mpd-tui-plugin/src/graph.ts
7df2e7a8a667e5598eb5a314620e9663287ff4fc1af9099c25e149df82453d57  packages/mpd-tui-plugin/src/panel-dag.ts
c6b1a25000001c64eed6b21566573519654eb9794edff7cbf829770c349ca6d7  packages/mpd-tui-plugin/src/team-state.ts
6d5d772898211cf4fd94503adc414a414a08dc4ecfd2d79195fa4de4690912ca  packages/mpd-tui-plugin/src/scenes.ts
39421261023a5936d458c85346360a5e903680654870138664c3cde580c14433  packages/mpd-tui-plugin/src/subagent-scene.ts
664db0bf4d4f6680a5e7f342f331ab4e3cfe9def938b21f5d879a82762338e0d  packages/mpd-tui-plugin/test/dag-groups.test.ts
684fa6f777a2feda8be6ab9a94e0776681147188dd6022ae4c674554182ea9ec  packages/mpd-tui-plugin/dist/index.js
eb6703170c57db04f3616c0321b12b8fd2ccf011811757ef4aa5af76c960e971  packages/mpd-tui-plugin/README.md
df1d565e30d70403cf5d08db5a7e915b5febbdaf7528468cda15ee906f2283a4  packages/mpd-tui-plugin/README.zh-CN.md
DECLARED
sha256sum -c "$EV/declared.sha256" > "$EV/declared-check.log" 2>&1; echo "declared-check exit=$?"; cat "$EV/declared-check.log"

echo; echo "== hash sandwich: start $(date -u +%Y-%m-%dT%H:%M:%SZ)"
sandwich > "$EV/scope-start.sha256"; sha256sum "$EV/scope-start.sha256"
echo "== settle window 50 s"; sleep 50
sandwich > "$EV/scope-postsettle.sha256"; sha256sum "$EV/scope-postsettle.sha256"

echo; echo "== TUI suite"
( bun test packages/mpd-tui-plugin ) > "$EV/tests-tui.log" 2>&1; echo "tests exit=$?"
grep -E '^ [0-9]+ (pass|fail|skip)|^Ran ' "$EV/tests-tui.log" | tail -4
( bun test packages/mpd-tui-plugin/test/dag-groups.test.ts ) > "$EV/tests-dag-groups.log" 2>&1; echo "dag-groups exit=$?"
grep -E '^\s*\((pass|fail)\)' "$EV/tests-dag-groups.log" | sed -E 's/\[[0-9.]+ms\]//' > "$EV/dag-groups-arms.txt"; wc -l < "$EV/dag-groups-arms.txt"

echo; echo "== dist freshness (tui only)"
node scripts/verify-dist-fresh.ts --only mpd-tui-plugin > "$EV/dist-fresh-tui.log" 2>&1; echo "dist exit=$?"; tail -3 "$EV/dist-fresh-tui.log"

echo; echo "== BUILT dist carries the group code (artifact-level)"
DIST=packages/mpd-tui-plugin/dist/index.js
for token in DAG_GROUP_CHARS DAG_CHARS_ONE_CELL collapsedGroups halfGroupCells hitTestGroup GraphGroupHit DagRowClick groupId; do
  printf '%-20s %s\n' "$token" "$(grep -c "$token" "$DIST")"
done > "$EV/dist-tokens.txt"; cat "$EV/dist-tokens.txt"
python3 - "$DIST" > "$EV/dist-glyphs.txt" 2>&1 <<'PY'
import re, sys
src = open(sys.argv[1], encoding='utf-8', errors='replace').read()
def grab(name):
    m = re.search(re.escape(name) + r'\s*=\s*(\[[^]]*\]|\{[^}]*\}|"[^"]*")', src)
    return m.group(1) if m else None
g = grab('DAG_GROUP_CHARS')
n = grab('DAG_CHARS')
print('DAG_GROUP_CHARS literal found:', g is not None)
print('DAG_CHARS literal found:', n is not None)
def glyphs(expr):
    if not expr: return []
    return [s for s in re.findall(r'"([^"\\]*)"|`([^`]*)`|\'([^\'\\]*)\'', expr) for s in s if s]
gl = [s for tup in re.findall(r'"([^"]*)"|`([^`]*)`', g or '') for s in tup if s]
nl = [s for tup in re.findall(r'"([^"]*)"|`([^`]*)`', n or '') for s in tup if s]
print('group family size:', len(gl), '| node family size:', len(nl))
bad = [(s, len(s)) for s in gl for ch in s if len(ch.encode('utf-16-le'))//2 != 1]
print('group glyphs NOT one UTF-16 cell:', bad)
print('group family:', ''.join(gl))
print('shared glyphs with node family:', sorted(set(''.join(gl)) & set(''.join(nl))))
print('one-cell boolean present:', 'DAG_CHARS_ONE_CELL' in src)
PY
cat "$EV/dist-glyphs.txt"

echo; echo "== README pair nested-group sections"
grep -n 'Nested groups\|嵌套分组' packages/mpd-tui-plugin/README.md packages/mpd-tui-plugin/README.zh-CN.md > "$EV/readme-sections.txt" 2>&1; cat "$EV/readme-sections.txt"

echo; echo "== docs + comments + typecheck"
bun run verify:docs > "$EV/verify-docs.log" 2>&1; echo "docs exit=$?"; tail -2 "$EV/verify-docs.log"
bun run verify:comments > "$EV/comments-root.log" 2>&1; echo "comments exit=$?"; tail -2 "$EV/comments-root.log"
bun run typecheck > "$EV/typecheck-root.log" 2>&1; echo "typecheck exit=$?"; tail -5 "$EV/typecheck-root.log"

echo; echo "== full suite (foreign reds expected; attribution only)"
( bun test packages ) > "$EV/tests-full.log" 2>&1; echo "full exit=$?"
grep -E '^ [0-9]+ (pass|fail|skip)|^Ran ' "$EV/tests-full.log" | tail -4
grep -E '^\s*\(fail\)' "$EV/tests-full.log" | sort -u > "$EV/tests-full-failures.txt"; cat "$EV/tests-full-failures.txt"

echo; echo "== scope metadata (stat only)"
git status --porcelain -- "${SCOPE[@]}" > "$EV/scope-status.log" 2>&1
git diff --stat -- "${SCOPE[@]}" > "$EV/scope-diffstat.log" 2>&1

echo; echo "== hash sandwich: end $(date -u +%Y-%m-%dT%H:%M:%SZ)"
sandwich > "$EV/scope-end.sha256"; sha256sum "$EV/scope-end.sha256"
if diff -q "$EV/scope-start.sha256" "$EV/scope-end.sha256" >/dev/null; then echo "SANDWICH OK: start == end (after settle)"; else echo "SANDWICH BROKEN"; diff "$EV/scope-start.sha256" "$EV/scope-end.sha256"; fi
