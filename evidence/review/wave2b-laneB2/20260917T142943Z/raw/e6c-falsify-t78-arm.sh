#!/usr/bin/env bash
# rev-B2 review, third attempt at FALSIFYING THE T-78 ARM (attempts E6 and E6b were instrument
# failures, both recorded):
#   E6  asserted `"doc_rewrite" not in file` — fires on the HEADER COMMENT that names
#       `rules.doc_rewrite`, so the strip was never written and a PRISTINE copy ran (4278 B record in
#       both the "stripped" and the control run).
#   E6b asserted the RULE STRING was absent from the FILE — impossible: the arm's own constants
#       (`const RULE = ...`) carry the same literal. Same wrong invariant.
# The ARM asserts on the record's BYTES, so the correct falsification is to keep the file valid and
# empty its report's `rules` block, then show the child's record no longer satisfies the arm.
#
#   bash evidence/review/wave2b-laneB2/<stamp>/raw/e6c-falsify-t78-arm.sh   (ONE bash call: /tmp is per-call)
set -uo pipefail
S=/tmp/revb2-e6c
REPO=/root/dshProj/my-power-dsh
D=evidence/review/wave2b-laneB2/20260917T142943Z
OUT="$D/raw"
cd "$REPO"
rm -rf "$S"; mkdir -p "$S/neg/copydir" "$S/neg/docs" "$S/neg/src" "$S/neg/evidence/extensions/docs-claims" \
                     "$S/ctl/copydir" "$S/ctl/docs" "$S/ctl/src" "$S/ctl/evidence/extensions/docs-claims"

fixture() { # $1 = root: the five subject docs + one cited file, so the run is otherwise clean
  local r="$1"
  printf '// fixture\nexport const alphaSymbol = 1\n' > "$r/src/probe.ts"
  printf '# fixture guide\n\nSee `alphaSymbol`, `src/probe.ts:2`.\n' > "$r/docs/extension-authoring-guide.md"
  cp "$r/docs/extension-authoring-guide.md" "$r/docs/extension-authoring-guide.zh-CN.md"
  printf '# fixture contract\n\nSee `alphaSymbol`, `src/probe.ts:2`.\n' > "$r/EXTENSIONS-FOR-AGENTS.md"
  printf '# fixture report\n\n## 12. Status\n\nSee `alphaSymbol`, `src/probe.ts:2`.\n' > "$r/docs/extension-adaptation-report.md"
  cp "$r/docs/extension-adaptation-report.md" "$r/docs/extension-adaptation-report.zh-CN.md"
  printf '// FROZEN fixture revision\nexport const frozen = true\n' > "$r/evidence/extensions/docs-claims/check-citations.mjs"
  ln -sfn "$REPO/skills" "$r/skills"
}

for ROOT in neg ctl; do
  fixture "$S/$ROOT"
  cp scripts/check-citations.mjs "$S/$ROOT/copydir/check-citations.mjs"
done

python3 - "$S/neg/copydir/check-citations.mjs" <<'PY'
import re, sys, pathlib
p = pathlib.Path(sys.argv[1]); before = p.read_text()
after, n = re.subn(r"\n  rules: \{\n.*?\n  \},\n", "\n  rules: {},\n", before, count=1, flags=re.S)
assert n == 1, f"rule block not found (n={n})"
assert "\n    doc_rewrite: {\n" not in after, "the doc_rewrite object survived the strip"
p.write_text(after)
print(f"E6c negative copy: rules block emptied ({len(before)} -> {len(after)} B)")
PY

# (1) the mechanism: the negative copy's OWN record no longer carries the pinned rule
node "$S/neg/copydir/check-citations.mjs" --citations-only --out "$S/neg/record" > "$OUT/E6c-neg-run.stdout.txt" 2>&1
echo "E6c negative copy, plain run: exit=$?"
echo -n "E6c RULE occurrences in the negative copy's record: "; grep -c "doc-rewrite task's verify list" "$S/neg/record/result.json"
echo -n "E6c COMMAND occurrences in the negative copy's record: "; grep -c -- "--out ./evidence/gates/<slug>/<stamp>/run" "$S/neg/record/result.json"
echo    "   (0/0 = the record can no longer satisfy the arm)"
# (2) the control: the pristine copy's record does carry both
node "$S/ctl/copydir/check-citations.mjs" --citations-only --out "$S/ctl/record" > "$OUT/E6c-ctl-run.stdout.txt" 2>&1
echo -n "E6c RULE occurrences in the CONTROL copy's record: "; grep -c "doc-rewrite task's verify list" "$S/ctl/record/result.json"
# (3) the arm itself: run each copy's self-test and read the t78 arm line
node "$S/neg/copydir/check-citations.mjs" --self-test --out "$S/neg/selftest" > "$OUT/E6c-neg-selftest.stdout.txt" 2>&1
echo "E6c NEGATIVE copy --self-test: exit=$?"
node "$S/ctl/copydir/check-citations.mjs" --self-test --out "$S/ctl/selftest" > "$OUT/E6c-ctl-selftest.stdout.txt" 2>&1
echo "E6c CONTROL copy --self-test: exit=$?"
echo "--- t78 arm in the NEGATIVE copy (must be a FAIL line) ---"
grep -n 't78-record-carries-the-rule' "$OUT/E6c-neg-selftest.stdout.txt" | sed 's/\(.\{200\}\).*/\1…/'
echo "--- t78 arm in the CONTROL copy (must be ok) ---"
grep -n 't78-record-carries-the-rule' "$OUT/E6c-ctl-selftest.stdout.txt" | sed 's/\(.\{200\}\).*/\1…/'
echo "--- the negative copy's self-test total (how many arms reddened) ---"
tail -3 "$OUT/E6c-neg-selftest.stdout.txt"
echo "--- the control copy's self-test total ---"
tail -3 "$OUT/E6c-ctl-selftest.stdout.txt"
rm -rf "$S"
echo "scratch deleted: $([ -e "$S" ] && echo NO || echo YES)"
