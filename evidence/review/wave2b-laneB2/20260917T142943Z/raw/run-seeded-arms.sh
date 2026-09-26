#!/usr/bin/env bash
# rev-B2 review: EVERY seeded arm in ONE bash call, because this harness gives each bash call a
# FRESH /tmp (AGENTS.md T-23) — a scratch built in one call is gone in the next. The scratch is
# built, consumed and DELETED inside this call; the derivation itself is raw/scratch-derivation.v2.sh.
#
#   bash evidence/review/wave2b-laneB2/<stamp>/raw/run-seeded-arms.sh
set -uo pipefail
SCRATCH=/tmp/revb2-scratch
REPO=/root/dshProj/my-power-dsh
D=evidence/review/wave2b-laneB2/20260917T142943Z
OUT="$D/raw"
cd "$REPO"

bash "$D/raw/scratch-derivation.v2.sh" "$SCRATCH" > "$OUT/E0-scratch-build.log" 2>&1
echo "E0 scratch build: exit=$?"

# ── E1: a SEEDED mailbox-record-id anchor used as evidence (expect exit 1) ──────────────
node ./scripts/check-citations.mjs --anchor-scan "$SCRATCH/e1" --pattern ee9ec16 --out "./$D/seeded-e1-mailbox-id" > "$OUT/E1-anchor-scan-seeded.stdout.txt" 2>&1
echo "E1 mailbox-id anchor       : exit=$? (expect 1)"

# ── E2–E4b: the citation hazards, each fixture root carrying exactly one seeded shape ───
for E in e2 e3 e4 e4b; do
  DOCS_CLAIMS_REPO="$SCRATCH/$E" node ./scripts/check-citations.mjs --citations-only > "$OUT/E-$E.stdout.txt" 2>&1
  code=$?
  echo "E-$E                        : exit=$code ($(grep -oE '[0-9]+/[0-9]+ checks passed, [0-9]+ failed' "$OUT/E-$E.stdout.txt" | head -1))"
done

# ── E5: the T-80 rot seeded into copies of the two real key-producing drivers ───────────
node ./scripts/check-citations.mjs --driver-headers --dir "$SCRATCH/e5a" --out "./$D/seeded-e5a-claimed-but-unasserted" > "$OUT/E5a-claimed-but-unasserted.stdout.txt" 2>&1
echo "E5a claimed-but-unasserted : exit=$? (expect 1)"
node ./scripts/check-citations.mjs --driver-headers --dir "$SCRATCH/e5b" --out "./$D/seeded-e5b-asserted-but-unclaimed" > "$OUT/E5b-asserted-but-unclaimed.stdout.txt" 2>&1
echo "E5b asserted-but-unclaimed : exit=$? (expect 1)"

# ── E6: the T-78 arm's OWN falsification — a copy of the checker with the rule block gone ─
node "$SCRATCH/e6/copydir/check-citations.mjs" --self-test --out "$SCRATCH/e6/selftest" > "$OUT/E6-t78-arm-falsified.stdout.txt" 2>&1
echo "E6 stripped-copy self-test : exit=$? (the t78 arm must NOT be ok)"
node "$SCRATCH/e8/copydir/check-citations.mjs" --self-test --out "$SCRATCH/e8/selftest" > "$OUT/E8-control-selftest.stdout.txt" 2>&1
echo "E8 pristine-copy self-test : exit=$? (the control: every arm must be ok)"

# ── E8b: the T-82 retention pair, reproduced on a PRISTINE copy with my own one-line change ─
COPY="$SCRATCH/e8/copydir/check-citations.mjs"
mark() { python3 - "$1" "$2" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1]); tag = sys.argv[2]
lines = [l for l in p.read_text().split("\n") if not l.startswith("// ARM CHANGE")]
assert lines[0].startswith("#!"), lines[0]
lines.insert(1, f"// ARM CHANGE {tag}")
p.write_text("\n".join(lines))
PY
}
mark "$COPY" A; node "$COPY" --citations-only --out "$SCRATCH/e8/runA" > "$OUT/E8b-runA.stdout.txt" 2>&1; echo "E8b runA (ARM CHANGE A): exit=$?"
mark "$COPY" B; node "$COPY" --citations-only --out "$SCRATCH/e8/runB" > "$OUT/E8b-runB.stdout.txt" 2>&1; echo "E8b runB (ARM CHANGE B): exit=$?"
mark "$COPY" C; node "$COPY" --citations-only --out "$SCRATCH/e8/runC" > "$OUT/E8b-runC.stdout.txt" 2>&1
mark "$COPY" C; node "$COPY" --citations-only --out "$SCRATCH/e8/runD" > "$OUT/E8b-runD.stdout.txt" 2>&1
echo "E8b runC/runD (identical copies): exits=$?"

diff -u "$SCRATCH/e8/runA/revisions/checker.mjs" "$SCRATCH/e8/runB/revisions/checker.mjs" > "$OUT/E8b-diff-CHANGED-pair.txt"; echo "E8b diff changed pair  : exit=$? (expect 1 = non-empty)"
diff -u "$SCRATCH/e8/runA/revisions/superseded.mjs" "$SCRATCH/e8/runB/revisions/superseded.mjs" > "$OUT/E8b-diff-UnCHANGED-pair.txt"; echo "E8b diff unchanged pair: exit=$? (expect 0 = EMPTY)"
diff -u "$SCRATCH/e8/runC/revisions/checker.mjs" "$SCRATCH/e8/runD/revisions/checker.mjs" > "$OUT/E8b-diff-SAME-copy-pair.txt"; echo "E8b diff same-copy pair: exit=$? (expect 0 = EMPTY)"
wc -c "$OUT/E8b-diff-CHANGED-pair.txt" "$OUT/E8b-diff-UnCHANGED-pair.txt" "$OUT/E8b-diff-SAME-copy-pair.txt"

echo "--- the three wave-2b arms in the stripped copy (E6) ---"
grep -n 't78-record-carries-the-rule\|t82-retention-diffable\|immutability-second-run-refused' "$OUT/E6-t78-arm-falsified.stdout.txt" | sed 's/\(.\{240\}\).*/\1…/'
echo "--- the same three arms in the pristine copy (E8, control) ---"
grep -n 't78-record-carries-the-rule\|t82-retention-diffable\|immutability-second-run-refused' "$OUT/E8-control-selftest.stdout.txt" | sed 's/\(.\{240\}\).*/\1…/'

rm -rf "$SCRATCH"
echo "scratch deleted: $([ -e "$SCRATCH" ] && echo NO || echo YES)"
