# Vendor re-pin — cellwork activate-mint wave

Branch: fix/cellwork-activate-mint
Timestamp (UTC): 2026-11-11T13-14-55Z

## Step results
1. `node scripts/verify-vendor.ts` -> exit 1. First failure line verbatim:
   `[verify-vendor] FAIL - asset skills treeSha mismatch`
   Every other asset printed `asset OK` (7 of 7): specs/dsh-go, mpd-mcp-codegraph dist,
   mpd-hashline vendor, mpd-autoproject boulder vendor, mpd-schemastery, mpd-bundle adopted,
   mpd-bundle client.js. Drift is confined to the `skills` asset.
2. `node scripts/repin-vendor.ts --write --i-know-this-is-the-captains-step` -> exit 0.
   `WRITE : applied 1 field change(s)`. Only `skills.treeSha`
   4510bff19106ee5d00c72c6b752210763cbaf2de60facb3dbb6ff1c794f32c91 ->
   f58bd90ae4e0d0d1dee936e6a8124deb6b193456950d74024b866f84dd550676.
   fileCount stayed 392 (basis: `git index (392 shipped file(s))`).
3. `node scripts/repin-vendor.ts --check` -> exit 0 (`CHECK : GREEN - lock matches the working
   tree (drift=0, problems=0)`). `node scripts/verify-vendor.ts` -> exit 0
   (`PASS - 8 shipped asset(s) fingerprinted`).
4. `git diff --stat VENDOR_LOCK.json` -> `1 file changed, 1 insertion(+), 1 deletion(-)`;
   changed field names = `"treeSha"` only, inside the `skills` block. No other asset touched.
5. `git status --porcelain | grep -v '^??'` -> 13 modified files + VENDOR_LOCK.json; the new
   `skills/dsh-qa/scripts/cellwork-activate-mint.ts` is untracked (`??`). No other unexpected path.

## BLOCKER for the commit (must be resolved by the captain)
The fingerprint is computed over `git ls-files` (the INDEX), by design
(`scripts/lib/asset-files.ts`: "inside a git work tree the file list is `git ls-files` - the index").
The new QA script is untracked, so it is NOT in the 392-file basis; measured:
  `git ls-files skills | wc -l` = 392 ; `find skills -type f | wc -l` = 395
  (the other 2 on-disk files are the gitignored `skills/frontend/references/design/*.md`).
Once the captain stages the new script the index becomes 393 files and `treeSha`/`fileCount`
change again. Committing the current lock would therefore redden `verify-vendor` in CI.
Correct order: `git add` the wave's files (including the new script) -> re-run the re-pin
`--write` (same one-field change, now over the commit index) -> verify both gates -> commit.

### Measured expected value after staging (read-only, `expected-after-staging.ts`)
{"fileCount":393,"treeSha":"2997619a891615643e81f91ae051f99f79f23053fae6fdc45165a3904baad3de"}
The currently written lock (392 / f58bd9…) is therefore NOT valid for the eventual commit; after
staging, `verify-vendor.ts` fails at the COUNT check first (`scripts/verify-vendor.ts:344`:
`asset.fileCount !== meta.fileCount` -> `asset skills count drifted: 393 vs 392`) before the fold.

## Evidence files
verify-vendor-before.log, repin.log, repin-check.log, verify-vendor-after.log, vendor-lock.diff,
expected-after-staging.{ts,log}, summary.md

## After staging (index = 393 files) — FINAL re-pin
6. `node scripts/repin-vendor.ts --write --i-know-this-is-the-captains-step` -> exit 0,
   `applied 2 field change(s)`; `skills.treeSha f58bd90a… -> 2997619a…`, `fileCount 392 -> 393`.
7. `node scripts/repin-vendor.ts --check` -> exit 0, `CHECK : GREEN (drift=0, problems=0)`.
8. `node scripts/verify-vendor.ts` -> exit 0, `asset OK: skills 393 files`,
   `PASS - 8 shipped asset(s)`, zero `count drifted` lines.
9. Lock actual value: fileCount 393, treeSha 2997619a891615643e81f91ae051f99f79f23053fae6fdc45165a3904baad3de.
   `git diff HEAD -- VENDOR_LOCK.json` = only `skills.fileCount` + `skills.treeSha`; no other asset.
10. remaining commit-time trap: `VENDOR_LOCK.json` is `MM` — the STAGED blob is still the old
   392 / f58bd90a value (`staged-vs-worktree.txt`). The captain must `git add VENDOR_LOCK.json`
   again before committing, else CI's vendor gate fails at `393 vs 392`.
   New evidence logs created after the staging pass are untracked and need `git add` too.
