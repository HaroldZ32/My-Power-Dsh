#!/usr/bin/env bash
# rev-B2 review: FALSIFY THE T-78 ARM ITSELF (criterion 1's "shown to REDDEN on a seeded rot"),
# plus a clean re-run of the seeded mailbox-id anchor scan.
#
# The FIRST attempt at this (raw/run-seeded-arms.sh, arm "E6") was INVALID and is recorded as such:
# its strip step asserted `"doc_rewrite" not in file`, which is TRUE only if the header comment that
# mentions `rules.doc_rewrite` is gone too — so the assert fired, the strip was never written, and
# E6 ran a PRISTINE copy (identical 4278 B record in E6 and E8). Instrument failure, not a finding.
# The correct invariant is the RULE STRING's absence, and the strip is verified before the run.
#
#   bash evidence/review/wave2b-laneB2/<stamp>/raw/e6b-falsify-t78-arm.sh   (one bash call: /tmp is per-call)
set -uo pipefail
S=/tmp/revb2-e6b
REPO=/root/dshProj/my-power-dsh
D=evidence/review/wave2b-laneB2/20260917T142943Z
OUT="$D/raw"
cd "$REPO"
rm -rf "$S"; mkdir -p "$S/e1" "$S/e6/copydir" "$S/e6/docs" "$S/e6/src" "$S/e6/evidence/extensions/docs-claims"

# ── E1b: a seeded mailbox-record-id anchor, into a FRESH output dir ─────────────────────
cat > "$S/e1/note.md" <<'EOF'
# seeded rot: a mailbox record id used as the evidence anchor
The finding is recorded in inbox message ee9ec16-4a2b-4c8d-9f01-2de3f4a5b6c7 (read while present).
The artifact path evidence/review/t-4g-address/20260917T101512Z/probe-matrix.txt is the anchor.
EOF
node ./scripts/check-citations.mjs --anchor-scan "$S/e1" --pattern ee9ec16 --out "./$D/seeded-e1-mailbox-id-v2" > "$OUT/E1b-anchor-scan-seeded.stdout.txt" 2>&1
echo "E1b seeded mailbox-id anchor: exit=$? (expect 1)"

# ── E6b: strip the T-78 rule block from a COPY, VERIFY the strip, then run the copy ─────
cp scripts/check-citations.mjs "$S/e6/copydir/check-citations.mjs"
ln -sfn "$REPO/skills" "$S/e6/skills"
printf '// fixture\nexport const alphaSymbol = 1\n' > "$S/e6/src/probe.ts"
printf '# fixture guide\n\nSee `alphaSymbol`, `src/probe.ts:2`.\n' > "$S/e6/docs/extension-authoring-guide.md"
cp "$S/e6/docs/extension-authoring-guide.md" "$S/e6/docs/extension-authoring-guide.zh-CN.md"
printf '# fixture contract\n\nSee `alphaSymbol`, `src/probe.ts:2`.\n' > "$S/e6/EXTENSIONS-FOR-AGENTS.md"
printf '# fixture report\n\n## 12. Status\n\nSee `alphaSymbol`, `src/probe.ts:2`.\n' > "$S/e6/docs/extension-adaptation-report.md"
cp "$S/e6/docs/extension-adaptation-report.md" "$S/e6/docs/extension-adaptation-report.zh-CN.md"
printf '// FROZEN fixture revision\nexport const frozen = true\n' > "$S/e6/evidence/extensions/docs-claims/check-citations.mjs"
python3 - "$S/e6/copydir/check-citations.mjs" <<'PY'
import re, sys, pathlib
RULE = "a doc-rewrite task's verify list MUST carry the citation driver"
p = pathlib.Path(sys.argv[1]); before = p.read_text()
after, n = re.subn(r"\n  rules: \{\n.*?\n  \},\n", "\n", before, count=1, flags=re.S)
assert n == 1, f"rule block not found (n={n})"
assert RULE not in after, "the RULE string survived the strip"
p.write_text(after)
print(f"E6b copy: removed {len(before) - len(after)} B; RULE string absent={RULE not in after}; bytes {len(before)} -> {len(after)}")
PY
node "$S/e6/copydir/check-citations.mjs" --citations-only --out "$S/e6/record" > "$OUT/E6b-stripped-run.stdout.txt" 2>&1
echo "E6b stripped copy, plain run: exit=$?"
echo -n "E6b RULE occurrences in the stripped copy's OWN record: "; grep -c "doc-rewrite task's verify list" "$S/e6/record/result.json"; echo "  (0 = the record cannot satisfy the arm)"
node "$S/e6/copydir/check-citations.mjs" --self-test --out "$S/e6/selftest" > "$OUT/E6b-stripped-selftest.stdout.txt" 2>&1
echo "E6b stripped copy --self-test: exit=$?"
echo "--- the wave-2b arm lines in the STRIPPED copy (t78 MUST be a failure) ---"
grep -n 't78-record-carries-the-rule\|t82-retention-diffable\|immutability-second-run-refused' "$OUT/E6b-stripped-selftest.stdout.txt" | sed 's/\(.\{200\}\).*/\1…/'
echo "--- the same three arm lines in the PRISTINE copy (E8 control, from the prior call) ---"
grep -n 't78-record-carries-the-rule' "$OUT/E8-control-selftest.stdout.txt" | sed 's/\(.\{200\}\).*/\1…/'
rm -rf "$S"
echo "scratch deleted: $([ -e "$S" ] && echo NO || echo YES)"
