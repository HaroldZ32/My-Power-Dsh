#!/usr/bin/env bash
# t21 (rev-B2) review — follow-ups: the T-78 arm's own falsification (done RIGHT), the ER-2
# over-report direction on the corpus revision lane B2 actually measured, and my own
# instrument for the per-directory base rate. One bash call; scratch outside the workspace.
set -uo pipefail
SCRATCH=/tmp/t21-followup
REPO=/root/dshProj/my-power-dsh
D=evidence/review/wave2b-laneB2/20260917T1445Z
OUT="$D/raw"
cd "$REPO"
rm -rf "$SCRATCH"; mkdir -p "$SCRATCH"

echo "== t21 follow-ups =="
echo "moment_utc $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "checker $(sha256sum ./scripts/check-citations.mjs | cut -d' ' -f1) $(wc -l < ./scripts/check-citations.mjs) lines"

# ── FU-1: strip the `rules` block OUT of a copy, PROVE the strip landed on a real record, ──
#          then run the copy's own self-test and read the t78 arm's verdict.
mkdir -p "$SCRATCH/fu1/copydir"; ln -sfn "$REPO/skills" "$SCRATCH/fu1/skills"
cp ./scripts/check-citations.mjs "$SCRATCH/fu1/copydir/check-citations.mjs"
python3 - "$SCRATCH/fu1/copydir/check-citations.mjs" <<'PY'
import re, sys, pathlib
p = pathlib.Path(sys.argv[1]); before = p.read_text()
after, n = re.subn(r"\n  rules: \{\n.*?\n  \},\n", "\n", before, count=1, flags=re.S)
assert n == 1, f"rules block not found (n={n})"
p.write_text(after)
print(f"FU-1 strip: removed {len(before)-len(after)} bytes; 'rules: {{' still in source={'rules: {' in after}; 'doc_rewrite: {' still in source={'doc_rewrite: {' in after} (the header COMMENT still names it, on purpose)")
PY
node "$SCRATCH/fu1/copydir/check-citations.mjs" --citations-only --out "$SCRATCH/fu1/record-run" > "$OUT/FU1-stripped-record.stdout.txt" 2>&1
echo "FU-1 stripped copy, real record run: exit=$?"
python3 - "$SCRATCH/fu1/record-run/result.json" <<'PY'
import json, sys, pathlib
raw = pathlib.Path(sys.argv[1]).read_bytes(); doc = json.loads(raw)
text = raw.decode()
RULE = "a doc-rewrite task's verify list MUST carry the citation driver"
CMD = "node scripts/check-citations.mjs --out ./evidence/gates/<slug>/<stamp>/run"
print(f"FU-1 stripped record: bytes={len(raw)} top_level_has_rules={'rules' in doc} rule_string_present={RULE in text} command_string_present={CMD in text}")
print(f"FU-1 stripped record keys: {sorted(doc.keys())}")
PY
node "$SCRATCH/fu1/copydir/check-citations.mjs" --self-test --out "$SCRATCH/fu1/selftest" > "$OUT/FU1-stripped-selftest.stdout.txt" 2>&1
echo "FU-1 stripped self-test exit=$?"
grep -c 'negative-control:t78-record-carries-the-rule' "$OUT/FU1-stripped-selftest.stdout.txt" | sed 's/^/FU-1 t78 arm lines: /'
grep -oE '^  (ok|FAIL) +negative-control:t78-record-carries-the-rule' "$OUT/FU1-stripped-selftest.stdout.txt"
grep -oE '\[docs-claims\] [0-9]+/[0-9]+ checks passed, [0-9]+ failed' "$OUT/FU1-stripped-selftest.stdout.txt" | tail -1
grep -oE '^  FAIL +negative-control:[a-z0-9-]+' "$OUT/FU1-stripped-selftest.stdout.txt" | sort | uniq -c

# ── FU-2: the corpus revision lane B2 measured (HEAD, pre-claim-set) -> the over-report ──
mkdir -p "$SCRATCH/fu2/head-drivers"
git show HEAD:skills/dsh-qa/scripts/tui-team-surface.mjs > "$SCRATCH/fu2/head-drivers/tui-team-surface.mjs"
git show HEAD:skills/dsh-qa/scripts/lib/settings-bridge-lane.mjs > "$SCRATCH/fu2/head-drivers/settings-bridge-lane.mjs"
echo "FU-2 head-revision driver hashes:"
sha256sum "$SCRATCH/fu2/head-drivers/"*.mjs
node ./scripts/check-citations.mjs --driver-headers --dir "$SCRATCH/fu2/head-drivers" --out "./$D/FU2-head-precise" > "$OUT/FU2-head-precise.stdout.txt" 2>&1
echo "FU-2 precise rule on the pre-claim corpus: exit=$?"
node ./scripts/check-citations.mjs --driver-headers --naive --dir "$SCRATCH/fu2/head-drivers" --out "./$D/FU2-head-naive" > "$OUT/FU2-head-naive.stdout.txt" 2>&1
echo "FU-2 --naive (over-report direction)     : exit=$?"
tail -2 "$OUT/FU2-head-precise.stdout.txt"; tail -2 "$OUT/FU2-head-naive.stdout.txt"

# ── FU-3: the per-directory base rate, with MY OWN instrument (no lane flag) ──────────────
{
  echo "== FU-3 base rate, my own instrument, moment $(date -u +%Y-%m-%dT%H:%M:%SZ) =="
  echo "-- files per directory (globbed, the same split the lane names) --"
  echo "top-level  *.mjs : $(ls ./skills/dsh-qa/scripts/*.mjs 2>/dev/null | wc -l)"
  echo "top-level  all   : $(ls ./skills/dsh-qa/scripts/ 2>/dev/null | grep -c .)"
  echo "lib/       *.mjs : $(ls ./skills/dsh-qa/scripts/lib/*.mjs 2>/dev/null | wc -l)"
  echo "lib/       all   : $(ls ./skills/dsh-qa/scripts/lib/ 2>/dev/null | grep -c .)"
  echo "recursive  *.mjs : $(find ./skills/dsh-qa/scripts -name '*.mjs' | wc -l)"
  echo "-- key-producing drivers (literal 'add(\"A<n>' ...) --"
  echo "recursive in scope (.mjs)          : $(grep -rlE 'add\(\s*"A[0-9]' --include='*.mjs' ./skills/dsh-qa/scripts | wc -l)"
  echo "non-recursive in scope (top level) : $(grep -lE 'add\(\s*"A[0-9]' ./skills/dsh-qa/scripts/*.mjs 2>/dev/null | wc -l)"
  echo "'.js' file-type assumption in scope: $(grep -rlE 'add\(\s*"A[0-9]' --include='*.js' ./skills/dsh-qa/scripts | wc -l)"
  echo "whole-repo literal scan (.mjs)     : $(grep -rlE 'add\(\s*"A[0-9]' --include='*.mjs' . 2>/dev/null | wc -l)"
  echo "whole-repo literal scan (all files): $(grep -rlE 'add\(\s*"A[0-9]' . 2>/dev/null | wc -l)"
  echo "-- the two drivers lane B2 named, and what they produce --"
  grep -lE 'add\(\s*"A[0-9]' ./skills/dsh-qa/scripts/*.mjs ./skills/dsh-qa/scripts/lib/*.mjs 2>/dev/null
  echo "-- files added to the corpus since the lane's 53-file scan --"
  git status --porcelain -- skills/dsh-qa/scripts/
} > "$OUT/FU3-base-rate.txt" 2>&1
cat "$OUT/FU3-base-rate.txt"

rm -rf "$SCRATCH"
echo "FU scratch deleted: $([ -e "$SCRATCH" ] && echo NO || echo YES)"
