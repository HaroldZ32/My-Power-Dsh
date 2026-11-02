#!/usr/bin/env bash
# T28 (agent-slot hygiene: failed raise must not leak a slot or a zombie row). Writes only the row dir.
set -u
EV="${1:?row evidence dir required}"
WS="$(cd "$(dirname "$0")" && git rev-parse --show-toplevel)"
cd "$WS" || exit 1
SCOPE=(packages/mpd-team-core-plugin packages/mpd-dsh-adapter-plugin)
sandwich() { find "${SCOPE[@]}" -type f | LC_ALL=C sort | xargs sha256sum; }
mkdir -p "$EV"

echo "== scope hashes (my measurement; the relay carried no hash list)"
sha256sum packages/mpd-team-core-plugin/src/index.ts packages/mpd-team-core-plugin/src/team-store.ts packages/mpd-team-core-plugin/src/team-web.ts packages/mpd-team-core-plugin/test/agent-slot-hygiene.test.ts packages/mpd-dsh-adapter-plugin/src/index.ts | tee "$EV/declared.sha256"

echo; echo "== hash sandwich: start $(date -u +%Y-%m-%dT%H:%M:%SZ)"
sandwich > "$EV/scope-start.sha256"; sha256sum "$EV/scope-start.sha256"
echo "== settle window 50 s"; sleep 50
sandwich > "$EV/scope-postsettle.sha256"; sha256sum "$EV/scope-postsettle.sha256"

echo; echo "== suites"
( bun test packages/mpd-team-core-plugin ) > "$EV/tests-team-core.log" 2>&1; echo "team-core exit=$?"
grep -E '^ [0-9]+ (pass|fail|skip)|^Ran ' "$EV/tests-team-core.log" | tail -3
( bun test packages/mpd-dsh-adapter-plugin ) > "$EV/tests-adapter.log" 2>&1; echo "adapter exit=$?"
grep -E '^ [0-9]+ (pass|fail|skip)|^Ran ' "$EV/tests-adapter.log" | tail -3
( bun test packages ) > "$EV/tests-full.log" 2>&1; echo "full exit=$?"
grep -E '^ [0-9]+ (pass|fail|skip)|^Ran ' "$EV/tests-full.log" | tail -3
grep -E '^\s*\(fail\)' "$EV/tests-full.log" | sort -u | tee "$EV/tests-full-failures.txt"

echo; echo "== the SIX new arms + the UPDATED arm (names, from the suites)"
grep -hE '^\s*\((pass|fail)\).*(slot|hygiene|raise|legacy|dispose|id-less|zombie|REMOVED|count)' "$EV/tests-team-core.log" "$EV/tests-adapter.log" | sed -E 's/^\s*//; s/\[[0-9.]+ms\]//' | sort -u | tee "$EV/hygiene-arms.txt"

echo; echo "== REQUIRED OUTCOME 1+3: the failed raise drops the row and a DIFFERENT member's retry succeeds"
python3 - "$EV" <<'PY' | tee "$EV/arm-repro-body.txt"
p='packages/mpd-team-core-plugin/test/agent-slot-hygiene.test.ts'
src=open(p,encoding='utf-8').read()
print('FILE LEN', len(src))
print('\n'.join(src.split('\n')[:40]))
i=src.find('test(')
print('...'); print('\n'.join(src[i:].split('\n')[:120]))
PY

echo; echo "== REQUIRED OUTCOME 2: the adapter releases the slot before refusing an id-less start"
python3 - "$EV" <<'PY' | tee "$EV/adapter-arm-body.txt"
import glob,re
hits=[]
for p in glob.glob('packages/mpd-dsh-adapter-plugin/test/*.ts'):
    s=open(p,encoding='utf-8').read()
    for m in re.finditer(r'(id-less|no child id|releaseActivation|dispose\(\))', s):
        hits.append((p, s[max(0,m.start()-80):m.start()+140].replace('\n',' ')))
for p,ctx in hits[:8]: print(p,'::',ctx[:200])
print('--- adapter arm names ---')
s=open('packages/mpd-dsh-adapter-plugin/test/team-executor.test.ts',encoding='utf-8').read()
for name in re.findall(r'test\(\s*"([^"]{10,120})"', s):
    if any(k in name.lower() for k in ('release','id-less','refus','slot','dispose')): print('  ', name)
PY

echo; echo "== REQUIRED OUTCOME 4: graph model renders TASK nodes only (artifact + arm)"
{ printf 'removeTeamMember      %s\n' "$(grep -c -- 'removeTeamMember' packages/mpd-team-core-plugin/dist/index.js)"
  printf 'releaseActivation     %s\n' "$(grep -c -- 'releaseActivation' packages/mpd-dsh-adapter-plugin/dist/index.js)"
  printf 'status !== "failed"   %s\n' "$(grep -o 'status !== "failed"' packages/mpd-team-core-plugin/dist/index.js | wc -l)"
  printf 'isLiveMember/terminal %s\n' "$(grep -o 'terminal\|FAILED_STATUS\|failed' packages/mpd-team-core-plugin/dist/index.js | wc -l)"
} | tee "$EV/artifact-symbols.txt"

echo; echo "== the UPDATED team-record arm must be an UPDATE, not a relaxation"
git diff HEAD -- packages/mpd-team-core-plugin/test/team-record.test.ts > "$EV/team-record-diff.patch" 2>&1; wc -l < "$EV/team-record-diff.patch"
grep -nE '^[-+].*(failed|running|toEqual)' "$EV/team-record-diff.patch" | head -14 | tee "$EV/team-record-diff-lines.txt"

echo; echo "== the FAN-OUT: dist freshness repo-wide (the writer rebuilt 24 dependents)"
node scripts/verify-dist-fresh.ts > "$EV/dist-fresh.log" 2>&1; echo "dist exit=$?"; tail -3 "$EV/dist-fresh.log"

echo; echo "== typecheck + comments"
bun run typecheck > "$EV/typecheck-root.log" 2>&1; echo "typecheck exit=$?"; tail -2 "$EV/typecheck-root.log"
bun run verify:comments > "$EV/comments-root.log" 2>&1; echo "comments exit=$?"; tail -1 "$EV/comments-root.log"

echo; echo "== scope metadata (stat only)"
git status --porcelain -- "${SCOPE[@]}" | tee "$EV/scope-status.log"
echo "--- dirty dists across the repo (the fan-out rebuild) ---"
git status --porcelain -- 'packages/*/dist' | wc -l | tee -a "$EV/scope-status.log"

echo; echo "== hash sandwich: end $(date -u +%Y-%m-%dT%H:%M:%SZ)"
sandwich > "$EV/scope-end.sha256"; sha256sum "$EV/scope-end.sha256"
if diff -q "$EV/scope-start.sha256" "$EV/scope-end.sha256" >/dev/null; then echo "SANDWICH OK: start == end (after settle)"; else echo "SANDWICH BROKEN"; diff "$EV/scope-start.sha256" "$EV/scope-end.sha256"; fi
