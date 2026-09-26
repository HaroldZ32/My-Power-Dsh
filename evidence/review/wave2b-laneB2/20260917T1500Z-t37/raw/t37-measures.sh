#!/usr/bin/env bash
# t32 round-2 pass — MY OWN independent measurements of the repair.
# Fresh-/tmp rule: scratch is built, consumed and deleted INSIDE this call.
set -uo pipefail
SCRATCH=/tmp/t32-measures
REPO=/root/dshProj/my-power-dsh
D=evidence/review/wave2b-laneB2/20260917T1500Z-t37
OUT="$D/raw"
cd "$REPO"
rm -rf "$SCRATCH"; mkdir -p "$SCRATCH"
echo "== t32 independent measures =="
echo "moment_utc $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "checker $(sha256sum ./scripts/check-citations.mjs | cut -d' ' -f1) $(wc -l < ./scripts/check-citations.mjs) lines"

# ── PART A: the third direction, re-derived with MY OWN parser ────────────────────────────
python3 - "$SCRATCH" > "$OUT/A-third-direction-mine.txt" 2>&1 <<'PY'
import pathlib, re, sys
repo = pathlib.Path("/root/dshProj/my-power-dsh")
REF = re.compile(r"(design|acceptance|\bplan\b|§|\bt\d+\b)", re.I)
TOK = re.compile(r"\bA(\d+)\b")
RANGE = re.compile(r"\bA(\d+)\s*[–-]\s*A?(\d+)\b")
# the two key-producing drivers, found with MY predicate (not the checker's walk)
keys = re.compile(r'add\(\s*"A(\d+)[^"]*"')
producers = []
for p in sorted(list((repo/"skills/dsh-qa/scripts").rglob("*.mjs"))):
    if keys.search(p.read_text()):
        producers.append(p)
print("my key-producing set:", [str(p.relative_to(repo)) for p in producers])
for p in producers:
    lines = p.read_text().split("\n")
    header = []
    for line in lines:
        if line.startswith("#!") or not line.strip() or line.lstrip().startswith("//"):
            header.append(line)
        else:
            break
    ref_lines, tokens = [], set()
    for i, line in enumerate(header, 1):
        if REF.search(line):
            found = set()
            for m in TOK.finditer(line):
                found.add(int(m.group(1)))
            for m in RANGE.finditer(line):
                a, b = int(m.group(1)), int(m.group(2))
                found.update(range(min(a, b), max(a, b) + 1))
            if found:
                ref_lines.append((i, sorted(found), line.strip()[:110]))
                tokens.update(found)
    print(f"{p.relative_to(repo)}: reference lines carrying A<n> tokens = {len(ref_lines)}; token set = {sorted(tokens)}")
    for i, found, text in ref_lines:
        print(f"    line {i}: {found} :: {text}")
PY
cat "$OUT/A-third-direction-mine.txt"

# ── PART B: the hazard fixtures under the repaired revision (B2-F3 truth test) ────────────
fixture() { # $1 = root, $2 = the clause in the guide (the rot site)
  local root="$1"
  mkdir -p "$root/docs" "$root/src" "$root/evidence/extensions/docs-claims"
  printf '// fixture source\nexport const alphaSymbol = 1\nexport const betaSymbol = 2\n' > "$root/src/probe.ts"
  printf '# fixture guide\n\nSee %s for the constant.\n' "$2" > "$root/docs/extension-authoring-guide.md"
  cp "$root/docs/extension-authoring-guide.md" "$root/docs/extension-authoring-guide.zh-CN.md"
  printf '# fixture contract\n\nSee `alphaSymbol`, `src/probe.ts:2`.\n' > "$root/EXTENSIONS-FOR-AGENTS.md"
  printf '# fixture report\n\n## 12. Status\n\nSee `alphaSymbol`, `src/probe.ts:2`.\n' > "$root/docs/extension-adaptation-report.md"
  cp "$root/docs/extension-adaptation-report.md" "$root/docs/extension-adaptation-report.zh-CN.md"
  printf '// FROZEN fixture revision\nexport const frozen = true\n' > "$root/evidence/extensions/docs-claims/check-citations.mjs"
}
fixture "$SCRATCH/control" '`alphaSymbol`, `src/probe.ts:2`'
fixture "$SCRATCH/position" 'the third assertion in lane A note'
fixture "$SCRATCH/basename" '`alphaSymbol`, `probe.ts`'
fixture "$SCRATCH/rot" '`src/probe.ts:2`'
for name in control position basename rot; do
  DOCS_CLAIMS_REPO="$SCRATCH/$name" node ./scripts/check-citations.mjs --citations-only > "$OUT/B-$name.stdout.txt" 2>&1
  echo "B-$name exit=$? | $(grep -oE '[0-9]+/[0-9]+ checks passed, [0-9]+ failed' "$OUT/B-$name.stdout.txt" | head -1) | $(grep -oE '[0-9]+ citation\(s\) \(checked [0-9]+' "$OUT/B-$name.stdout.txt" | head -1)"
done

# ── PART C: the anchor scan's re-takeability (B2-F5) — TWICE, same recorded form ─────────
node ./scripts/check-citations.mjs --anchor-scan ./evidence/gates/wave2b-laneB2/20260917T142452Z --pattern ee9ec16 --out "./$D/C1-anchor-in-scope" > "$OUT/C1-anchor-in-scope.stdout.txt" 2>&1
echo "C1 (--out INSIDE the scanned root, run 1) exit=$?"
node ./scripts/check-citations.mjs --anchor-scan ./evidence/gates/wave2b-laneB2/20260917T142452Z --pattern ee9ec16 --out "./$D/C2-anchor-in-scope-2" > "$OUT/C2-anchor-in-scope-2.stdout.txt" 2>&1
echo "C2 (same form, run 2)                  exit=$?"
node ./scripts/check-citations.mjs --anchor-scan ./evidence/gates/wave2b-laneB2/20260917T142452Z --pattern ee9ec16 --out "./$D/C3-anchor-outside" > "$OUT/C3-anchor-outside.stdout.txt" 2>&1
echo "C3 (--out OUTSIDE the scanned root)    exit=$?"
echo "--- C1 summary ---"; tail -4 "$OUT/C1-anchor-in-scope.stdout.txt"
echo "--- C2 summary ---"; tail -3 "$OUT/C2-anchor-in-scope-2.stdout.txt"
echo "--- the two in-scope runs agree? ---"
diff <(grep -oE '\[anchor-scan\].*' "$OUT/C1-anchor-in-scope.stdout.txt" | tail -1) <(grep -oE '\[anchor-scan\].*' "$OUT/C2-anchor-in-scope-2.stdout.txt" | tail -1) && echo "IDENTICAL summary line across two runs" || echo "DIFFERENT summary lines"

# ── PART D: the family-boundary clause must be IN THE RECORD BYTES ───────────────────────
python3 - "$D" > "$OUT/D-clause-in-records.txt" 2>&1 <<'PY'
import json, pathlib, sys
D = pathlib.Path(sys.argv[1])
needle = "OUT OF FAMILY"
for rel in ["R1-verbatim/result.json", "R4-t80-live/result.json", "C1-anchor-in-scope/result.json"]:
    p = D / rel
    if not p.exists():
        print(f"{rel}: MISSING"); continue
    raw = p.read_bytes().decode()
    print(f"{rel}: contains '{needle}' = {needle in raw}")
PY
cat "$OUT/D-clause-in-records.txt"

rm -rf "$SCRATCH"
echo "scratch deleted: $([ -e "$SCRATCH" ] && echo NO || echo YES)"
