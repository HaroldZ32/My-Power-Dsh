#!/usr/bin/env bash
# T26 (CR-R3: stale GraphGeometry comment + mixed-height nested port parity). Writes only the row dir.
set -u
EV="${1:?row evidence dir required}"
WS="$(cd "$(dirname "$0")" && git rev-parse --show-toplevel)"
cd "$WS" || exit 1
SCOPE=(packages/mpd-bundle-plugin)
sandwich() { find "${SCOPE[@]}" -type f | LC_ALL=C sort | xargs sha256sum; }
mkdir -p "$EV"

echo "== declared hashes (relay: client.js 80263122…, 858478 B) vs measured"
echo "client.js measured: $(sha256sum packages/mpd-bundle-plugin/client.js | cut -c1-12)  $(wc -c < packages/mpd-bundle-plugin/client.js) B"

echo; echo "== hash sandwich: start $(date -u +%Y-%m-%dT%H:%M:%SZ)"
sandwich > "$EV/scope-start.sha256"; sha256sum "$EV/scope-start.sha256"
echo "== settle window 50 s"; sleep 50
sandwich > "$EV/scope-postsettle.sha256"; sha256sum "$EV/scope-postsettle.sha256"

echo; echo "== bundle suite (229 claimed) + the new arm"
( bun test packages/mpd-bundle-plugin ) > "$EV/tests-bundle.log" 2>&1; echo "bundle exit=$?"
grep -E '^ [0-9]+ (pass|fail|skip)|^Ran ' "$EV/tests-bundle.log" | tail -3
grep -hE '^\s*\((pass|fail)\).*(T25|mixed height|parit|T23 ·|D4 narrow)' "$EV/tests-bundle.log" | sed -E 's/^\s*//; s/\[[0-9.]+ms\]//' | tee "$EV/t25-arms.txt"

echo; echo "== F1: the STALE claim must be gone from the BUILT artifact, the nested truth documented, layoutFlat KEPT"
{ echo "-- stale vocabulary (want 0 hits each):"
  for bad in 'interior is COLLAPSED' 'NOT claimed by this build' 'recursive, variable-column geometry (a subcell' 'no frame of its own yet'; do
    printf '   %-52s %s\n' "$bad" "$(grep -c -- "$bad" packages/mpd-bundle-plugin/client.js)"
  done
  echo "-- kept flat path:"
  printf '   layoutFlat          %s\n' "$(grep -c -- 'layoutFlat' packages/mpd-bundle-plugin/client.js)"
  printf '   layoutNested        %s\n' "$(grep -c -- 'layoutNested' packages/mpd-bundle-plugin/client.js)"
  echo "-- the nested/ flat distinction in the comment (context around the geometry contract):"
} | tee "$EV/f1-comment.txt"
python3 - "$EV" <<'PY' | tee -a "$EV/f1-comment.txt"
import sys
src=open('packages/mpd-bundle-plugin/client.js',encoding='utf-8',errors='replace').read()
flat=src.replace('\n',' ')
for needle in ['GraphGeometry.groups','each rectangle ENCLOSES','ENCLOSE','interior + FRAME_PAD','innermost','declares no groups']:
    i=flat.find(needle)
    print(f'--- `{needle}` at {i} ---')
    if i>=0: print(flat[max(0,i-330):i+330])
    print()
PY

echo; echo "== F2: snapToParity in the BUILT artifact, and the arm's own body"
{ printf 'snapToParity        %s\n' "$(grep -c -- 'snapToParity' packages/mpd-bundle-plugin/client.js)"
  printf 'portStepOf          %s\n' "$(grep -c -- 'portStepOf' packages/mpd-bundle-plugin/client.js)"
} | tee "$EV/f2-artifact.txt"
python3 - "$EV" <<'PY' | tee -a "$EV/f2-artifact.txt"
src=open('packages/mpd-bundle-plugin/client.js',encoding='utf-8',errors='replace').read()
flat=src.replace('\n',' ')
i=flat.find('snapToParity')
print('--- 520 chars around snapToParity ---')
print(flat[max(0,i-300):i+520] if i>=0 else 'ABSENT')
PY
python3 - "$EV" <<'PY' | tee "$EV/f2-arm-body.txt"
p='packages/mpd-bundle-plugin/test/team-view.test.ts'
src=open(p,encoding='utf-8').read()
i=src.find('T25 · mixed heights keep the nested lanes apart')
print('ARM at', i)
print('\n'.join(src[i:].split('\n')[:56]) if i>=0 else 'ARM NOT FOUND')
PY

echo; echo "== flat expectations untouched by this row (metadata only)"
git diff HEAD -- packages/mpd-bundle-plugin/test/team-view.test.ts > "$EV/test-diff.patch" 2>&1
grep -nE '^-' "$EV/test-diff.patch" | grep -viE '^-{3}' | grep -iE 'data-mpd|curve|overlaps|expect' | head -10 | tee "$EV/test-diff-removals.txt"
echo "-- (empty = no existing expectation deleted)"

echo; echo "== gates"
node scripts/verify-dist-fresh.ts --only mpd-bundle-plugin > "$EV/dist-fresh-bundle.log" 2>&1; echo "dist exit=$?"; tail -1 "$EV/dist-fresh-bundle.log"
bun run typecheck > "$EV/typecheck-root.log" 2>&1; echo "typecheck exit=$?"; tail -2 "$EV/typecheck-root.log"
bun run verify:comments > "$EV/comments-root.log" 2>&1; echo "comments exit=$?"; tail -1 "$EV/comments-root.log"
bun run verify:docs > "$EV/verify-docs.log" 2>&1; echo "docs exit=$?"; tail -1 "$EV/verify-docs.log"

echo; echo "== scope metadata (stat only)"
git status --porcelain -- "${SCOPE[@]}" | tee "$EV/scope-status.log"
git diff --stat -- "${SCOPE[@]}" | tail -4 | tee "$EV/scope-diffstat.log"

echo; echo "== hash sandwich: end $(date -u +%Y-%m-%dT%H:%M:%SZ)"
sandwich > "$EV/scope-end.sha256"; sha256sum "$EV/scope-end.sha256"
if diff -q "$EV/scope-start.sha256" "$EV/scope-end.sha256" >/dev/null; then echo "SANDWICH OK: start == end (after settle)"; else echo "SANDWICH BROKEN"; diff "$EV/scope-start.sha256" "$EV/scope-end.sha256"; fi
