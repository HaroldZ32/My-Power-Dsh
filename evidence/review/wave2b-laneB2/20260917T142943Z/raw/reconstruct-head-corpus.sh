#!/usr/bin/env bash
# rev-B2 review: reproduce the lane's LIVE T-80 readings on the revision they were taken on.
#
# MEASURED PROBLEM: the corpus MOVED under this review. `skills/dsh-qa/scripts/tui-team-surface.mjs`
# and `skills/dsh-qa/scripts/lib/settings-bridge-lane.mjs` were rewritten at 14:35:00Z / 14:35:45Z —
# AFTER the lane's live scan (its record's moment: 2026-09-17T14:24:52Z) and after my first
# reproduction (~14:32Z) — so the same command now reports 2 claim sets where the lane recorded 0.
# The current files are lane D's (its HOP i: the DRIVER-side conformance is the corpus owner's edit),
# so this review must NOT touch them: it reconstructs the pinned revision in a scratch root from HEAD
# (`git archive`, read-only) and re-runs the audit there.
#
#   bash evidence/review/wave2b-laneB2/<stamp>/raw/reconstruct-head-corpus.sh   (ONE bash call)
set -uo pipefail
S=/tmp/revb2-head
REPO=/root/dshProj/my-power-dsh
D=evidence/review/wave2b-laneB2/20260917T142943Z
OUT="$D/raw"
cd "$REPO"
rm -rf "$S"; mkdir -p "$S"
git archive HEAD skills/dsh-qa/scripts | tar -x -C "$S"
echo "reconstructed $(find "$S" -name '*.mjs' | wc -l) .mjs files from HEAD under $S"
echo "reconstructed driver hashes (must equal the HEAD blobs):"
sha256sum "$S/skills/dsh-qa/scripts/tui-team-surface.mjs" "$S/skills/dsh-qa/scripts/lib/settings-bridge-lane.mjs"
git cat-file blob HEAD:skills/dsh-qa/scripts/tui-team-surface.mjs | sha256sum
git cat-file blob HEAD:skills/dsh-qa/scripts/lib/settings-bridge-lane.mjs | sha256sum

node ./scripts/check-citations.mjs --driver-headers --dir "$S/skills/dsh-qa/scripts/" \
  --out "./$D/reconstructed-head-live" > "$OUT/R11-reconstructed-head-live.stdout.txt" 2>&1
echo "R11 reconstructed HEAD, precise rule: exit=$?"
tail -3 "$OUT/R11-reconstructed-head-live.stdout.txt"

node ./scripts/check-citations.mjs --driver-headers --dir "$S/skills/dsh-qa/scripts/" --naive \
  --out "./$D/reconstructed-head-naive" > "$OUT/R12-reconstructed-head-naive.stdout.txt" 2>&1
echo "R12 reconstructed HEAD, --naive: exit=$?"
tail -3 "$OUT/R12-reconstructed-head-naive.stdout.txt"

# the CURRENT tree, same two commands, for the before/after pair (the corpus edit changed the answer)
node ./scripts/check-citations.mjs --driver-headers --out "./$D/current-tree-live" \
  > "$OUT/R13-current-tree-live.stdout.txt" 2>&1
echo "R13 current tree, precise rule: exit=$?"
tail -3 "$OUT/R13-current-tree-live.stdout.txt"
node ./scripts/check-citations.mjs --driver-headers --naive --out "./$D/current-tree-naive" \
  > "$OUT/R14-current-tree-naive.stdout.txt" 2>&1
echo "R14 current tree, --naive: exit=$?"
tail -3 "$OUT/R14-current-tree-naive.stdout.txt"

echo "--- the audit block, reconstructed HEAD ---"
node -e '
const j=require("./'"$D"'/reconstructed-head-live/result.json");
console.log("directories:",JSON.stringify(j.audit.directories));
console.log("split:",JSON.stringify(j.audit.per_directory_split));
for(const d of j.audit.matcher_error_directions) console.log("  ",d.direction,"|",d.measured);
console.log("rows:",JSON.stringify(j.drivers.map(r=>({p:r.path,keys:r.keys.length,claims:r.claims.length,ncs:r.no_claim_set}))));
'
echo "--- the audit block, CURRENT tree ---"
node -e '
const j=require("./'"$D"'/current-tree-live/result.json");
for(const d of j.audit.matcher_error_directions) console.log("  ",d.direction,"|",d.measured);
console.log("rows:",JSON.stringify(j.drivers.map(r=>({p:r.path,keys:r.keys.length,claims:r.claims.length,ncs:r.no_claim_set}))));
'
rm -rf "$S"
echo "scratch deleted: $([ -e "$S" ] && echo NO || echo YES)"
