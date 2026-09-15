# The delivery commit

| | |
|---|---|
| Branch | `feature/tui-edition` |
| Commit | `145dfde13794a996559161482672581b8e6464a7` |
| Subject | `feat(tui): add the DSH-TUI edition of the mpd bundle` |
| Size | 786 files changed, 62514 insertions(+), 15 deletions(-) |
| One-commit pairing (AGENTS.md §9/§11) | **7** `skills/**` files and **1** `VENDOR_LOCK.json` in the SAME commit |

Post-commit re-verification (`raw/post-commit.log`, taken after the commit, on the committed tree):

- `node scripts/verify-vendor.mjs` → **PASS**, `asset OK: skills 307 files` — the re-pin matches the
  committed corpus, not merely the working tree.
- The two frozen anchors as read back through git (`git show HEAD:<path> | sha256sum`) are exactly the
  pinned pair: `dsh-plugin.json` `84ed4a5d5aac3fb0…`, `packages/mpd-tui-plugin/dist/index.js`
  `5dce2563fd0e3b20…` — so the reviews (t13/t28/t30) still judge the committed bytes.
- Scope: the commit carries the plugin package, the manifest, the descriptor, the five lanes, the
  bilingual docs, the process records, the mirror/parity edits and the whole `evidence/tui/**` set.
  No `.mpd/**` and no sandbox path is staged (`.mpd/` is gitignored; `git diff --cached --name-only`
  matched `^\.mpd/|^\.qa-reloc/|node_modules` **zero** times before the commit).
- No version bump: a bump would move `dsh-plugin.json`'s digest and invalidate the review anchors.

**The team status line reads `Delivery: blocked (t23 failed without a follow-up repair)`.** That is a
mechanical reading of a `failed` task slot, not unfinished work: `t23` is the honest record of one
acceptance criterion that is unsatisfiable as written (a `tuiRenderers` transcript row the host refuses
for a bundle-layer plugin), the surface is discharged as NOT-CLAIMED item 2 / `docs/tui.md` §10 item 10,
and the disposition is stated in the AC-4 row of `ACCEPTANCE-LEDGER.md`, in `docs/tui-edition-report.md`
§4/§8 and in the ledger's second amendment. No repair task exists because none is owed; leaving the slot
failed is the honest record (AGENTS.md, the failed-dependency row).
