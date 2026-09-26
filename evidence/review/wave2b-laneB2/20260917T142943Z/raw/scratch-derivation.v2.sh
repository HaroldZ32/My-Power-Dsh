#!/usr/bin/env bash
# rev-B2 review, scratch derivation (T-89). Builds EVERY seeded fixture under a scratch root
# OUTSIDE the workspace; nothing here writes into the repository. It MUST be run inside the same
# bash call that consumes the scratch, because this harness gives each bash call a FRESH /tmp
# (AGENTS.md T-23), so a scratch built in one call is gone in the next.
#
#   bash evidence/review/wave2b-laneB2/<stamp>/raw/scratch-derivation.v2.sh /tmp/revb2-scratch
#
# E1     a MAILBOX-RECORD-ID-SHAPED anchor used as evidence (T-90's class)
# E2     a LINE-NUMBER-ONLY anchor (T-72/T-55 rot class)
# E3     an arm cited by POSITION (an ordinal; no path, no symbol)
# E4/E4b an ABBREVIATED PATH (basename only; ellipsis form)
# E5a    a T-80 claim the code never asserts      (CLAIMED-BUT-UNASSERTED)
# E5b    a T-80 under-claiming header             (ASSERTED-BUT-UNCLAIMED)
# E6     a COPY of the checker with the T-78 rule block REMOVED (the arm's own falsification)
# E8     a PRISTINE copy of the checker (the control for E6; also the T-82 retention pair's subject)
set -uo pipefail
SCRATCH="${1:?usage: scratch-derivation.sh <scratch-root>}"
REPO=/root/dshProj/my-power-dsh
rm -rf "$SCRATCH"
mkdir -p "$SCRATCH"

# ── E1: a mailbox record id used as the evidence anchor ─────────────────────────────────
mkdir -p "$SCRATCH/e1"
cat > "$SCRATCH/e1/note.md" <<'EOF'
# seeded rot: a mailbox record id used as the evidence anchor
The finding is recorded in inbox message ee9ec16-4a2b-4c8d-9f01-2de3f4a5b6c7 (read while present).
The artifact path evidence/review/t-4g-address/20260917T101512Z/probe-matrix.txt is the anchor.
EOF

# ── the citation-fixture maker (the same subject layout the checker's own fixtures use) ─
make_fixture() { # $1 = root  $2 = the anchor clause written into the human GUIDE (the rot site)
  local root="$1" anchor="$2"
  mkdir -p "$root/docs" "$root/src" "$root/evidence/extensions/docs-claims"
  printf '// fixture\nexport const alphaSymbol = 1\nexport const betaSymbol = 2\n' > "$root/src/probe.ts"
  printf '# fixture guide\n\nSee %s for the constant.\n' "$anchor" > "$root/docs/extension-authoring-guide.md"
  cp "$root/docs/extension-authoring-guide.md" "$root/docs/extension-authoring-guide.zh-CN.md"
  printf '# fixture contract\n\nSee `alphaSymbol`, `src/probe.ts:2`.\n' > "$root/EXTENSIONS-FOR-AGENTS.md"
  printf '# fixture report\n\n## 12. Status\n\nSee `alphaSymbol`, `src/probe.ts:2`.\n' > "$root/docs/extension-adaptation-report.md"
  cp "$root/docs/extension-adaptation-report.md" "$root/docs/extension-adaptation-report.zh-CN.md"
  # the frozen revision a copy's retention step copies as the UNCHANGED pair
  printf '// FROZEN fixture revision — identical in every run (the unchanged pair)\nexport const frozen = true\n' > "$root/evidence/extensions/docs-claims/check-citations.mjs"
}

make_fixture "$SCRATCH/e2" '`src/probe.ts:2`'                              # line-number-only
make_fixture "$SCRATCH/e3" "the third assertion in lane A's wave-2a note"  # cited by POSITION
make_fixture "$SCRATCH/e4" '`alphaSymbol`, `probe.ts`'                     # abbreviated path
make_fixture "$SCRATCH/e4b" '`alphaSymbol`, `.../src/probe.ts`'            # ellipsis path
make_fixture "$SCRATCH/e6" '`alphaSymbol`, `src/probe.ts:2`'               # E6 copy root
make_fixture "$SCRATCH/e8" '`alphaSymbol`, `src/probe.ts:2`'               # E8 copy root

# ── E5: a T-80 rot seeded into COPIES of the two real key-producing drivers ─────────────
mkdir -p "$SCRATCH/e5a" "$SCRATCH/e5b"
cp "$REPO/skills/dsh-qa/scripts/lib/settings-bridge-lane.mjs" "$SCRATCH/e5a/claimed-but-unasserted.mjs"
cp "$REPO/skills/dsh-qa/scripts/tui-team-surface.mjs" "$SCRATCH/e5b/asserted-but-unclaimed.mjs"
python3 - "$SCRATCH" <<'PY'
import sys, pathlib
root = pathlib.Path(sys.argv[1])
a = root / "e5a" / "claimed-but-unasserted.mjs"   # keys A1-A5; header claims A1-A9
lines = a.read_text().split("\n"); lines.insert(1, "// checks A1-A9 (seeded rot: A9 is claimed, never asserted)")
a.write_text("\n".join(lines))
b = root / "e5b" / "asserted-but-unclaimed.mjs"     # keys A1-A10; header claims A1-A3 only
lines = b.read_text().split("\n"); lines.insert(1, "// checks A1-A3 (seeded rot: the code asserts more than the header claims)")
b.write_text("\n".join(lines))
PY

# ── E6 / E8: two COPIES of the checker, each at its own fixture root ────────────────────
for ROOT in e6 e8; do
  mkdir -p "$SCRATCH/$ROOT/copydir"
  ln -sfn "$REPO/skills" "$SCRATCH/$ROOT/skills"   # the copy's `../skills/...` import
  cp "$REPO/scripts/check-citations.mjs" "$SCRATCH/$ROOT/copydir/check-citations.mjs"
done
# E6: strip the T-78 rule block from the COPY and assert the strip landed
python3 - "$SCRATCH/e6/copydir/check-citations.mjs" <<'PY'
import re, sys, pathlib
p = pathlib.Path(sys.argv[1])
before = p.read_text()
after, n = re.subn(r"\n  rules: \{\n.*?\n  \},\n", "\n", before, count=1, flags=re.S)
assert n == 1, f"rule block not found (n={n})"
assert "doc_rewrite" not in after, "doc_rewrite survived the strip"
p.write_text(after)
print(f"E6 copy: removed {len(before) - len(after)} bytes; doc_rewrite present={('doc_rewrite' in after)}")
PY
# E8: the pristine copy is the control; ALSO record both copies' hashes
sha256sum "$SCRATCH/e6/copydir/check-citations.mjs" "$SCRATCH/e8/copydir/check-citations.mjs" > "$SCRATCH/copies.sha256"
echo "scratch built at $SCRATCH"
cat "$SCRATCH/copies.sha256"
find "$SCRATCH" -maxdepth 2 -type d | sort
