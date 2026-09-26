#!/usr/bin/env bash
# t32 round-2 pass — arm falsification on the REPAIRED revision + the weakening diff.
# Fresh-/tmp rule: scratch built, consumed and deleted INSIDE this call.
set -uo pipefail
SCRATCH=/tmp/t32-arms
REPO=/root/dshProj/my-power-dsh
D=evidence/review/wave2b-laneB2/20260917T1500Z-t37
OUT="$D/raw"
cd "$REPO"
rm -rf "$SCRATCH"; mkdir -p "$SCRATCH"
echo "== t32 arm falsification =="
echo "moment_utc $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "checker $(sha256sum ./scripts/check-citations.mjs | cut -d' ' -f1)"

# ── W: the weakening diff, against the ROUND-1 revision the lane retained ────────────────
ROUND1=evidence/gates/wave2b-laneB2/20260917T142452Z/citation-run/revisions/checker.mjs
echo "round-1 retained sha: $(sha256sum $ROUND1 | cut -d' ' -f1)"
diff -u "$ROUND1" ./scripts/check-citations.mjs > "$OUT/W-diff-round1-to-repair.patch"; echo "W diff exit=$? (1 = differences, expected)"
grep -c '^-[^-]' "$OUT/W-diff-round1-to-repair.patch" | sed 's/^/W deleted lines (incl. replaced): /'
grep '^-[^-]' "$OUT/W-diff-round1-to-repair.patch" | head -30 > "$OUT/W-deleted-lines.txt"
cat "$OUT/W-deleted-lines.txt"

# ── E1: the T-78 arm's OWN falsification — strip the record's rules block in a COPY ──────
mkdir -p "$SCRATCH/e1/copydir"; ln -sfn "$REPO/skills" "$SCRATCH/e1/skills"
cp ./scripts/check-citations.mjs "$SCRATCH/e1/copydir/check-citations.mjs"
python3 "$REPO/evidence/review/wave2b-laneB2/20260917T1445Z/raw/strip_rules_block.py" "$SCRATCH/e1/copydir/check-citations.mjs" > "$OUT/E1-strip.txt" 2>&1 || true
cat "$OUT/E1-strip.txt"
if grep -q "rules: {" "$SCRATCH/e1/copydir/check-citations.mjs"; then
  echo "E1 strip did not remove the rules block — using the round-1 python from the review dir"
  python3 "$REPO/evidence/review/wave2b-laneB2/20260917T1445Z/raw/strip_rules_block.py" "$SCRATCH/e1/copydir/check-citations.mjs" > "$OUT/E1-strip.txt" 2>&1 || true
  cat "$OUT/E1-strip.txt"
fi
node "$SCRATCH/e1/copydir/check-citations.mjs" --citations-only --out "$SCRATCH/e1/record" > "$OUT/E1-record.stdout.txt" 2>&1
python3 - "$SCRATCH/e1/record/result.json" > "$OUT/E1-stripped-record.txt" 2>&1 <<'PY'
import json, sys, pathlib
raw = pathlib.Path(sys.argv[1]).read_bytes(); doc = json.loads(raw); text = raw.decode()
RULE = "a doc-rewrite task's verify list MUST carry the citation driver"
print("stripped record: bytes", len(raw), "| has 'rules' key:", "rules" in doc, "| rule string present:", RULE in text)
PY
cat "$OUT/E1-stripped-record.txt"
node "$SCRATCH/e1/copydir/check-citations.mjs" --self-test --out "$SCRATCH/e1/selftest" > "$OUT/E1-selftest.stdout.txt" 2>&1
echo "E1 stripped self-test exit=$?"
grep -oE '^  (ok|FAIL) +negative-control:t78-record-carries-the-rule' "$OUT/E1-selftest.stdout.txt"
grep -oE '^  FAIL +negative-control:[a-z0-9-]+' "$OUT/E1-selftest.stdout.txt" | sort | uniq -c

# ── E2: the T-82 arm's OWN falsification — retention a no-op in a COPY ───────────────────
mkdir -p "$SCRATCH/e2/copydir"; ln -sfn "$REPO/skills" "$SCRATCH/e2/skills"
cp ./scripts/check-citations.mjs "$SCRATCH/e2/copydir/check-citations.mjs"
python3 - "$SCRATCH/e2/copydir/check-citations.mjs" > "$OUT/E2-patch.txt" 2>&1 <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1]); text = p.read_text()
needle = "function retainRevision(source, target, label) {"
assert text.count(needle) == 1, "retainRevision not found once"
p.write_text(text.replace(needle, needle + "\n  return // t32 seed: retention disabled in this COPY"))
print("E2: retention disabled in the copy")
PY
cat "$OUT/E2-patch.txt"
node "$SCRATCH/e2/copydir/check-citations.mjs" --self-test --out "$SCRATCH/e2/selftest" > "$OUT/E2-selftest.stdout.txt" 2>&1
echo "E2 retention-disabled self-test exit=$?"
grep -oE '^  (ok|FAIL) +negative-control:(t82-retention-diffable|t78-record-carries-the-rule)' "$OUT/E2-selftest.stdout.txt" | cut -c1-120
grep -oE '^  FAIL +negative-control:[a-z0-9-]+' "$OUT/E2-selftest.stdout.txt" | sort | uniq -c

# ── E3: my T-80 seeds on copies of the real drivers ───────────────────────────────────────
mkdir -p "$SCRATCH/e3a" "$SCRATCH/e3b"
cp ./skills/dsh-qa/scripts/tui-team-surface.mjs "$SCRATCH/e3a/claim-seed.mjs"
cp ./skills/dsh-qa/scripts/lib/settings-bridge-lane.mjs "$SCRATCH/e3b/underclaim-seed.mjs"
python3 - "$SCRATCH" > "$OUT/E3-seeds.txt" 2>&1 <<'PY'
import pathlib, sys
root = pathlib.Path(sys.argv[1])
a = root/"e3a"/"claim-seed.mjs"; lines = a.read_text().split("\n")
lines.insert(1, "// CHECKS A11 as well (t32 seed: A11 claimed, never asserted)")
a.write_text("\n".join(lines))
b = root/"e3b"/"underclaim-seed.mjs"; t = b.read_text()
assert "CLAIMS the assertion keys A1–A5" in t, "claim block moved"
b.write_text(t.replace("CLAIMS the assertion keys A1–A5", "CLAIMS the assertion keys A1–A3"))
print("E3 seeds written")
PY
cat "$OUT/E3-seeds.txt"
node ./scripts/check-citations.mjs --driver-headers --dir "$SCRATCH/e3a" --out "./$D/E3a-claimed" > "$OUT/E3a.stdout.txt" 2>&1
echo "E3a claimed-but-unasserted exit=$? (expect 1)"; grep -oE 'FAIL driver:.*' "$OUT/E3a.stdout.txt" | cut -c1-190
node ./scripts/check-citations.mjs --driver-headers --dir "$SCRATCH/e3b" --out "./$D/E3b-underclaimed" > "$OUT/E3b.stdout.txt" 2>&1
echo "E3b asserted-but-unclaimed exit=$? (expect 1)"; grep -oE 'FAIL driver:.*' "$OUT/E3b.stdout.txt" | cut -c1-190

# ── E4: the mailbox anchor scan reddens on a seeded literal ───────────────────────────────
mkdir -p "$SCRATCH/e4"
printf 'seeded: inbox message ee9ec16-4a2b-4c8d-9f01-2de3f4a5b6c7\n' > "$SCRATCH/e4/note.md"
node ./scripts/check-citations.mjs --anchor-scan "$SCRATCH/e4" --pattern ee9ec16 --out "./$D/E4-anchor-seeded" > "$OUT/E4.stdout.txt" 2>&1
echo "E4 seeded mailbox-id scan exit=$? (expect 1)"
node ./scripts/check-citations.mjs --anchor-scan "$SCRATCH/e4" --pattern 00000000deadbeef --out "./$D/E4b-anchor-absent" > "$OUT/E4b.stdout.txt" 2>&1
echo "E4b absent-pattern control exit=$? (expect 0)"

rm -rf "$SCRATCH"
echo "scratch deleted: $([ -e "$SCRATCH" ] && echo NO || echo YES)"
