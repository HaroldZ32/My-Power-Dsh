#!/usr/bin/env bash
# t21 (rev-B2) review — final batch: MY OWN seeded T-80 rot, the T-82 arm's own
# falsification, the line-count re-take, and the anchor scans re-run.
set -uo pipefail
SCRATCH=/tmp/t21-final
REPO=/root/dshProj/my-power-dsh
D=evidence/review/wave2b-laneB2/20260917T1445Z
OUT="$D/raw"
cd "$REPO"
rm -rf "$SCRATCH"; mkdir -p "$SCRATCH"

echo "== t21 final batch =="
echo "moment_utc $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "checker $(sha256sum ./scripts/check-citations.mjs | cut -d' ' -f1)"

# ── FU-4: MY OWN T-80 seeds on copies of the two real drivers ─────────────────────────────
mkdir -p "$SCRATCH/fu4/a" "$SCRATCH/fu4/b"
cp ./skills/dsh-qa/scripts/tui-team-surface.mjs "$SCRATCH/fu4/a/seeded-claim.mjs"
cp ./skills/dsh-qa/scripts/lib/settings-bridge-lane.mjs "$SCRATCH/fu4/b/seeded-underclaim.mjs"
python3 - "$SCRATCH/fu4" <<'PY'
import pathlib, sys
root = pathlib.Path(sys.argv[1])
a = root / "a" / "seeded-claim.mjs"
text = a.read_text()
lines = text.split("\n")
# the driver's own claim block names A1-A8 and A10; the seed ADDS A11 to the claim set
lines.insert(1, "// CHECKS A11 as well (t21 review seed: A11 is claimed and never asserted)")
a.write_text("\n".join(lines))
b = root / "b" / "seeded-underclaim.mjs"
text = b.read_text()
assert "CLAIMS the assertion keys A1–A5" in text, "the claim block shape moved"
b.write_text(text.replace("CLAIMS the assertion keys A1–A5", "CLAIMS the assertion keys A1–A3"))
print("FU-4 seeds written; the under-claim seed asserts A1-A5 and claims A1-A3")
PY
node ./scripts/check-citations.mjs --driver-headers --dir "$SCRATCH/fu4/a" --out "./$D/FU4-seed-claimed-but-unasserted" > "$OUT/FU4-seed-claimed.stdout.txt" 2>&1
echo "FU-4 seed A (claimed-but-unasserted A11): exit=$? (expect 1)"
grep -oE 'FAIL driver:.*' "$OUT/FU4-seed-claimed.stdout.txt" | cut -c1-220
node ./scripts/check-citations.mjs --driver-headers --dir "$SCRATCH/fu4/b" --out "./$D/FU4-seed-asserted-but-unclaimed" > "$OUT/FU4-seed-unclaimed.stdout.txt" 2>&1
echo "FU-4 seed B (asserted-but-unclaimed A4,A5): exit=$? (expect 1)"
grep -oE 'FAIL driver:.*' "$OUT/FU4-seed-unclaimed.stdout.txt" | cut -c1-220

# ── FU-5: the T-82 arm's OWN falsification — retention made a no-op in a COPY ─────────────
mkdir -p "$SCRATCH/fu5/copydir"; ln -sfn "$REPO/skills" "$SCRATCH/fu5/skills"
cp ./scripts/check-citations.mjs "$SCRATCH/fu5/copydir/check-citations.mjs"
python3 - "$SCRATCH/fu5/copydir/check-citations.mjs" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1]); text = p.read_text()
needle = "function retainRevision(source, target, label) {"
assert text.count(needle) == 1, "retainRevision not found once"
p.write_text(text.replace(needle, needle + "\n  return // t21 review seed: retention disabled in this COPY"))
print("FU-5 retention disabled in the copy")
PY
node "$SCRATCH/fu5/copydir/check-citations.mjs" --self-test --out "$SCRATCH/fu5/selftest" > "$OUT/FU5-retention-disabled-selftest.stdout.txt" 2>&1
echo "FU-5 retention-disabled self-test exit=$?"
grep -oE '^  (ok|FAIL) +negative-control:(t82-retention-diffable|immutability-second-run-refused|t78-record-carries-the-rule).*' "$OUT/FU5-retention-disabled-selftest.stdout.txt" | cut -c1-190
grep -oE '^  FAIL +negative-control:[a-z0-9-]+' "$OUT/FU5-retention-disabled-selftest.stdout.txt" | sort | uniq -c

# ── FU-6: the line counts (the lane's record says 1143 for the "after" revision) ──────────
{
  echo "== FU-6 line counts, moment $(date -u +%Y-%m-%dT%H:%M:%SZ) =="
  echo "wc -l  scripts/check-citations.mjs                 : $(wc -l < ./scripts/check-citations.mjs)"
  echo "non-empty lines (grep -c .) same file              : $(grep -c . ./scripts/check-citations.mjs)"
  echo "python split('\\n') length same file               : $(python3 -c 'import pathlib,sys; print(len(pathlib.Path(sys.argv[1]).read_text().split(chr(10))))' ./scripts/check-citations.mjs)"
  echo "wc -l  evidence/extensions/docs-claims/check-citations.mjs (frozen): $(wc -l < ./evidence/extensions/docs-claims/check-citations.mjs)"
  echo "wc -l  the lane's retained revisions/checker.mjs    : $(wc -l < ./evidence/gates/wave2b-laneB2/20260917T142452Z/citation-run/revisions/checker.mjs)"
  echo "python split('\\n') the lane's retained checker.mjs  : $(python3 -c 'import pathlib,sys; print(len(pathlib.Path(sys.argv[1]).read_text().split(chr(10))))' ./evidence/gates/wave2b-laneB2/20260917T142452Z/citation-run/revisions/checker.mjs)"
  echo "the lane's record field                            : $(python3 -c 'import json; print(json.load(open("evidence/gates/wave2b-laneB2/20260917T142452Z/result.json"))["revisions"]["durable_checker"]["lines"])')"
} > "$OUT/FU6-line-counts.txt" 2>&1
cat "$OUT/FU6-line-counts.txt"

# ── FU-7: the addendum-A(3) anchor scans, re-run on the lane's own record dir ─────────────
node ./scripts/check-citations.mjs --anchor-scan ./evidence/gates/wave2b-laneB2/20260917T142452Z --pattern ee9ec16 --out "./$D/FU7-anchor-scan-ee9ec16" > "$OUT/FU7-anchor-ee9ec16.stdout.txt" 2>&1
echo "FU-7 lane dir, pattern ee9ec16 : exit=$? (expect 0)"
tail -2 "$OUT/FU7-anchor-ee9ec16.stdout.txt"
node ./scripts/check-citations.mjs --anchor-scan ./evidence/gates/wave2b-laneB2/20260917T142452Z --pattern '"dupCount"' --out "./$D/FU7-anchor-scan-dupcount" > "$OUT/FU7-anchor-dupcount.stdout.txt" 2>&1
echo "FU-7 lane dir, pattern dupCount: exit=$? (expect 0)"
tail -2 "$OUT/FU7-anchor-dupcount.stdout.txt"
node ./scripts/check-citations.mjs --anchor-scan ./$D --pattern ee9ec16 --out "./$D/FU7-anchor-scan-mine" > "$OUT/FU7-anchor-mine.stdout.txt" 2>&1
echo "FU-7 MY OWN review dir, pattern ee9ec16: exit=$? (expect 0 = this review's records cite no mailbox id)"
tail -2 "$OUT/FU7-anchor-mine.stdout.txt"

rm -rf "$SCRATCH"
echo "FU scratch deleted: $([ -e "$SCRATCH" ] && echo NO || echo YES)"
