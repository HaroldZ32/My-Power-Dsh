#!/usr/bin/env bash
# t42 round-4 pass — falsify-and-restore: put the SUMMING computation back into a COPY and show the
# seeded arm FAILS (the sweep must be shown able to fail), plus the scope-violations union seed.
set -uo pipefail
SCRATCH=/tmp/t42-falsify
REPO=/root/dshProj/my-power-dsh
D=evidence/review/wave2b-laneB2/20260917T1510Z-t42
OUT="$D/raw"
cd "$REPO"
rm -rf "$SCRATCH"; mkdir -p "$SCRATCH"
echo "== t42 falsify-and-restore =="
echo "moment_utc $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "checker $(sha256sum ./scripts/check-citations.mjs | cut -d' ' -f1)"

# ── A: the COPY whose per-directory counting is put BACK to the pre-fix SUMS ──────────────
mkdir -p "$SCRATCH/sum/copydir"; ln -sfn "$REPO/skills" "$SCRATCH/sum/skills"
cp ./scripts/check-citations.mjs "$SCRATCH/sum/copydir/check-citations.mjs"
python3 - "$SCRATCH/sum/copydir/check-citations.mjs" > "$OUT/F1-restore-sums.txt" 2>&1 <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1]); t = p.read_text()
pairs = [
  ("{ files: 0, key_producers: 0, key_ids: new Set(), claim_ids: new Set(), mismatched_ids: new Set(), no_claim_set: 0 }",
   "{ files: 0, key_producers: 0, key_ids: [], claim_ids: [], mismatched_ids: [], no_claim_set: 0 }"),
  ("bucket.key_ids.add(id)", "bucket.key_ids.push(id)"),
  ("bucket.claim_ids.add(id)", "bucket.claim_ids.push(id)"),
  ("bucket.mismatched_ids.add(id)", "bucket.mismatched_ids.push(id)"),
  ("keys: bucket.key_ids.size", "keys: bucket.key_ids.length"),
  ("claims: bucket.claim_ids.size", "claims: bucket.claim_ids.length"),
  ("violations: bucket.mismatched_ids.size", "violations: bucket.mismatched_ids.length"),
]
for old, new in pairs:
    n = t.count(old)
    assert n >= 1, f"pattern not found: {old}"
    t = t.replace(old, new)
    print(f"restored: {old[:48]!r} x{n}")
p.write_text(t)
print("COPY now uses the PRE-FIX summing computation (arrays, .length)")
PY
cat "$OUT/F1-restore-sums.txt"
node "$SCRATCH/sum/copydir/check-citations.mjs" --driver-headers --self-test --out "$SCRATCH/sum/selftest" > "$OUT/F1-summed-arms.stdout.txt" 2>&1
echo "F1 summed-copy self-test exit=$? (expect 1)"
grep -oE '^  (ok|FAIL) +t80-directory-scope-dedup.*' "$OUT/F1-summed-arms.stdout.txt" | cut -c1-200
tail -1 "$OUT/F1-summed-arms.stdout.txt"

# ── B: the scope-`violations` union claim, seeded by ME ───────────────────────────────────
mkdir -p "$SCRATCH/b/two"
for n in a b; do { echo "#!/usr/bin/env node"; echo "// CHECKS A1-A3 (seeded: A3 is claimed, never asserted, in BOTH files)"; echo ""; echo '  add("A1", true, "x")'; echo '  add("A2", true, "y")'; } > "$SCRATCH/b/two/$n.mjs"; done
node ./scripts/check-citations.mjs --driver-headers --dir "$SCRATCH/b/two" --out "./$D/F2-scope-violations-seed" > "$OUT/F2-scope-violations.stdout.txt" 2>&1
echo "F2 seeded overlapping mismatches exit=$? (expect 1)"
python3 - "$D/F2-scope-violations-seed/result.json" > "$OUT/F2-scope-violations.txt" 2>&1 <<'PY'
import json, pathlib, sys
d = json.loads(pathlib.Path(sys.argv[1]).read_text())
split = d["audit"]["per_directory_split"]
for k, v in split.items():
    print(f"dir {k}: keys={v['keys']} claims={v['claims']} violations={v['violations']}")
print("scope violations:", d["audit"]["violations"], "| per-row mismatches:", [ (r['path'].split('/')[-1], r['claimed_but_unasserted']) for r in d['drivers'] ])
print("=> two files in ONE directory both mismatch A3: a SUM would print 2, the UNION prints 1")
PY
cat "$OUT/F2-scope-violations.txt"

rm -rf "$SCRATCH"
echo "scratch deleted: $([ -e "$SCRATCH" ] && echo NO || echo YES)"
