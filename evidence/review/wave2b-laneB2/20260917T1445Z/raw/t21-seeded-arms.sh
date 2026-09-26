#!/usr/bin/env bash
# t21 (rev-B2) review — the reviewer's OWN seeded arms, one bash call.
#
# T-89 / T-23: every scratch fixture is built under $SCRATCH (OUTSIDE the workspace), consumed and
# DELETED inside this same call, because each bash call gets a fresh /tmp. Nothing here writes into
# the repository: the only in-repo writes are the --out paths under evidence/review/wave2b-laneB2/**
# (this review's inScope) and the stdout captures under <stamp>/raw/.
#
#   bash evidence/review/wave2b-laneB2/<stamp>/raw/t21-seeded-arms.sh
set -uo pipefail
SCRATCH=/tmp/t21-revb2-scratch
REPO=/root/dshProj/my-power-dsh
D=evidence/review/wave2b-laneB2/20260917T1445Z
OUT="$D/raw"
cd "$REPO"
rm -rf "$SCRATCH"; mkdir -p "$SCRATCH"

echo "== t21 review: seeded arms =="
echo "moment_utc $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "checker_pinned $(sha256sum ./scripts/check-citations.mjs | cut -d' ' -f1) $(wc -l < ./scripts/check-citations.mjs) lines"

# ── the citation-fixture maker: the subject layout the checker's own arms use ─────────────
fixture() { # $1 = root, $2 = the clause written into the human guide (the rot site)
  local root="$1"
  mkdir -p "$root/docs" "$root/src" "$root/evidence/extensions/docs-claims"
  printf '// fixture source\nexport const alphaSymbol = 1\nexport const betaSymbol = 2\n' > "$root/src/probe.ts"
  printf '# fixture guide\n\nSee %s for the constant.\n' "$2" > "$root/docs/extension-authoring-guide.md"
  cp "$root/docs/extension-authoring-guide.md" "$root/docs/extension-authoring-guide.zh-CN.md"
  printf '# fixture contract\n\nSee `alphaSymbol`, `src/probe.ts:2`.\n' > "$root/EXTENSIONS-FOR-AGENTS.md"
  printf '# fixture report\n\n## 12. Status\n\nSee `alphaSymbol`, `src/probe.ts:2`.\n' > "$root/docs/extension-adaptation-report.md"
  cp "$root/docs/extension-adaptation-report.md" "$root/docs/extension-adaptation-report.zh-CN.md"
  printf '// FROZEN fixture revision — identical in every run (the unchanged pair)\nexport const frozen = true\n' > "$root/evidence/extensions/docs-claims/check-citations.mjs"
}

fixture "$SCRATCH/control" '`alphaSymbol`, `src/probe.ts:2`'   # the GREEN control
fixture "$SCRATCH/a2-lineonly" '`src/probe.ts:2`'              # hazard b: line-number-only anchor
fixture "$SCRATCH/a3-position" 'the third assertion in lane A note'  # hazard a: cited by POSITION
fixture "$SCRATCH/a4-abbrev"   '`alphaSymbol`, `probe.ts`'     # hazard c: abbreviated path
fixture "$SCRATCH/a4b-ellipsis" '`alphaSymbol`, `.../src/probe.ts`'  # hazard c': ellipsis path
fixture "$SCRATCH/a8" '`alphaSymbol`, `src/probe.ts:2`'        # retention-pair root

run_citations() { # $1 = root, $2 = label
  DOCS_CLAIMS_REPO="$SCRATCH/$1" node ./scripts/check-citations.mjs --citations-only > "$OUT/A-$2.stdout.txt" 2>&1
  local code=$?
  echo "A-$2 : exit=$code | $(grep -oE '[0-9]+/[0-9]+ checks passed, [0-9]+ failed' "$OUT/A-$2.stdout.txt" | head -1) | $(grep -oE '[0-9]+ line-number-only anchor\(s\)' "$OUT/A-$2.stdout.txt" | head -1)"
  return 0
}

run_citations control    control
run_citations a2-lineonly a2-line-number-only
run_citations a3-position a3-position
run_citations a4-abbrev   a4-abbreviated-path
run_citations a4b-ellipsis a4b-ellipsis-path

# ── hazard d: a MAILBOX-RECORD-ID anchor used as evidence (T-90) ─────────────────────────
mkdir -p "$SCRATCH/d-mailbox"
printf '# seeded rot\nThe finding is in inbox message ee9ec16-4a2b-4c8d-9f01-2de3f4a5b6c7 (read while present).\nThe artifact evidence/review/t-4g-address/20260917T101512Z/probe-matrix.txt is the anchor.\n' > "$SCRATCH/d-mailbox/note.md"
node ./scripts/check-citations.mjs --anchor-scan "$SCRATCH/d-mailbox" --pattern ee9ec16 --out "./$D/A-d1-anchor-scan-seeded" > "$OUT/A-d1-anchor-scan-seeded.stdout.txt" 2>&1
echo "A-d1 seeded mailbox-id scan : exit=$? (expect 1)"
node ./scripts/check-citations.mjs --anchor-scan "$SCRATCH/d-mailbox" --pattern 00000000deadbeef --out "./$D/A-d2-anchor-scan-absent" > "$OUT/A-d2-anchor-scan-absent.stdout.txt" 2>&1
echo "A-d2 absent-pattern control : exit=$? (expect 0)"

# ── T-78: the arm's OWN falsification — a copy with the record's rule block REMOVED ──────
mkdir -p "$SCRATCH/a6/copydir"; ln -sfn "$REPO/skills" "$SCRATCH/a6/skills"
cp ./scripts/check-citations.mjs "$SCRATCH/a6/copydir/check-citations.mjs"
python3 - "$SCRATCH/a6/copydir/check-citations.mjs" <<'PY'
import re, sys, pathlib
p = pathlib.Path(sys.argv[1]); before = p.read_text()
after, n = re.subn(r"\n  rules: \{\n.*?\n  \},\n", "\n", before, count=1, flags=re.S)
assert n == 1, f"rule block not found (n={n})"
assert "doc_rewrite" not in after, "doc_rewrite survived the strip"
p.write_text(after)
print(f"A-a6 stripped copy: removed {len(before)-len(after)} bytes; doc_rewrite present={'doc_rewrite' in after}")
PY
node "$SCRATCH/a6/copydir/check-citations.mjs" --self-test --out "$SCRATCH/a6/selftest" > "$OUT/A-a6-t78-stripped-selftest.stdout.txt" 2>&1
echo "A-a6 stripped-copy self-test: exit=$? (the t78 arm must be FAIL here)"
grep -E 't78-record-carries-the-rule' "$OUT/A-a6-t78-stripped-selftest.stdout.txt" | head -2

# ── the T-78 record bytes, read from THIS review's own run (not the lane's) ──────────────
python3 - "./$D/run-verbatim/result.json" <<'PY'
import json, sys, pathlib
raw = pathlib.Path(sys.argv[1]).read_bytes()
doc = json.loads(raw)
rules = doc.get("rules", {}).get("doc_rewrite", {})
print(f"A-t78 my record: bytes={len(raw)} rule_present={'a doc-rewrite task' in raw.decode()} command={rules.get('command')!r} params={len(rules.get('parameters', {}))}")
PY

# ── T-82: retention — two runs, a ONE-LINE change between them, on a PRISTINE copy ──────
mkdir -p "$SCRATCH/a8/copydir"; ln -sfn "$REPO/skills" "$SCRATCH/a8/skills"
cp ./scripts/check-citations.mjs "$SCRATCH/a8/copydir/check-citations.mjs"
COPY="$SCRATCH/a8/copydir/check-citations.mjs"
mark() { python3 - "$1" "$2" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1]); tag = sys.argv[2]
lines = [l for l in p.read_text().split("\n") if not l.startswith("// ARM CHANGE")]
assert lines[0].startswith("#!"), lines[0]
lines.insert(1, f"// ARM CHANGE {tag}")
p.write_text("\n".join(lines))
PY
}
mark "$COPY" A; node "$COPY" --citations-only --out "$SCRATCH/a8/runA" --out "$SCRATCH/a8/runA" > "$OUT/A-a8-runA.stdout.txt" 2>&1; echo "A-a8 runA exit=$?"
mark "$COPY" B; node "$COPY" --citations-only --out "$SCRATCH/a8/runB" > "$OUT/A-a8-runB.stdout.txt" 2>&1; echo "A-a8 runB exit=$?"
mark "$COPY" C; node "$COPY" --citations-only --out "$SCRATCH/a8/runC" > "$OUT/A-a8-runC.stdout.txt" 2>&1
node "$COPY" --citations-only --out "$SCRATCH/a8/runD" > "$OUT/A-a8-runD.stdout.txt" 2>&1
echo "A-a8 runC/runD exit=$? (identical copies)"
ls "$SCRATCH/a8/runA/revisions" "$SCRATCH/a8/runB/revisions" > "$OUT/A-a8-retained-listing.txt" 2>&1
diff -u "$SCRATCH/a8/runA/revisions/checker.mjs" "$SCRATCH/a8/runB/revisions/checker.mjs" > "$OUT/A-a8-diff-changed-pair.txt"; echo "A-a8 diff CHANGED pair   : exit=$? (expect 1, non-empty)"
diff -u "$SCRATCH/a8/runA/revisions/superseded.mjs" "$SCRATCH/a8/runB/revisions/superseded.mjs" > "$OUT/A-a8-diff-unchanged-pair.txt"; echo "A-a8 diff UNCHANGED pair : exit=$? (expect 0, EMPTY)"
diff -u "$SCRATCH/a8/runC/revisions/checker.mjs" "$SCRATCH/a8/runD/revisions/checker.mjs" > "$OUT/A-a8-diff-same-copy-pair.txt"; echo "A-a8 diff SAME-COPY pair : exit=$? (expect 0, EMPTY)"
wc -c "$OUT/A-a8-diff-changed-pair.txt" "$OUT/A-a8-diff-unchanged-pair.txt" "$OUT/A-a8-diff-same-copy-pair.txt"
grep -c 'ARM CHANGE B' "$OUT/A-a8-diff-changed-pair.txt" | sed 's/^/A-a8 the changed pair names the changed line: /'

# ── T-80's ER-2 over-report direction, reproduced with the checker's own --naive mode ────
echo "-- driver hashes BEFORE my live re-scan --"
sha256sum ./skills/dsh-qa/scripts/tui-team-surface.mjs ./skills/dsh-qa/scripts/lib/settings-bridge-lane.mjs
node ./scripts/check-citations.mjs --driver-headers --out "./$D/A-b1-driver-headers-live" > "$OUT/A-b1-driver-headers-live.stdout.txt" 2>&1
echo "A-b1 driver-headers live     : exit=$?"
node ./scripts/check-citations.mjs --driver-headers --naive --out "./$D/A-b2-driver-headers-naive" > "$OUT/A-b2-driver-headers-naive.stdout.txt" 2>&1
echo "A-b2 driver-headers --naive  : exit=$? (the over-report direction)"
echo "-- driver hashes AFTER my live re-scan --"
sha256sum ./skills/dsh-qa/scripts/tui-team-surface.mjs ./skills/dsh-qa/scripts/lib/settings-bridge-lane.mjs
tail -3 "$OUT/A-b1-driver-headers-live.stdout.txt"
tail -3 "$OUT/A-b2-driver-headers-naive.stdout.txt"

rm -rf "$SCRATCH"
echo "A-scratch deleted: $([ -e "$SCRATCH" ] && echo NO || echo YES)"
