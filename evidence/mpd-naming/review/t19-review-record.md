# t19 review record — verdict PASS (transcribed by the captain)

Source: the t19 task output (authoritative payload lives in the team task record for
`mpd-default-e1f54e18`), transcribed verbatim in substance by the captain because the reviewer is a
read-only member and cannot write files. Judged bytes, not prose, at HEAD
`53d617e6c2d29dfadec06278bc4130061055378e` (dirty: 39 modified product files + 9 untracked
evidence dirs). Attempt `728ab7ff`.

## VERDICT: PASS — 7 findings (2 medium, 5 low; none high, none blocker)

## Two actions required before landing (both medium; neither is a product-byte defect)

**F1 — the lock is NOT yet committed.** t18's verification record states
`head_moved_since_freeze: "3c1a850 -> 53d617e (t17's LOCK re-pin landed as a commit)"`. That
parenthetical is FALSE: `git show --stat 53d617e` is the docs lane only, and
`git status --porcelain VENDOR_LOCK.json` is ` M` with
`git diff --numstat 3c1a850..HEAD -- VENDOR_LOCK.json` EMPTY. The landing commit MUST carry
`VENDOR_LOCK.json` together with the `skills/**` change set (AGENTS.md §9/§11), otherwise every other
clone fails `verify-vendor` on the skills treeSha.

**F2 — the frozen rename target differs from the landed name.** t13's rename_list froze
`docs/omo-parity-ledger{,.zh-CN}.md -> docs/parity-ledger{,.zh-CN}.md`; t15 landed
`docs/upstream-parity-ledger{,.zh-CN}.md` (the name the captain specified in the t15 task, chosen
because it describes the document's actual subject: parity against the pinned upstream baseline). The
owner requirement is satisfied and the landed name is better, but the frozen shape is unsatisfied and
its KH-01/KH-02 `where` fields cite a path that no longer exists — which is exactly why the frozen
KEEP driver reports 20/21. Disposition: the landed name stands; the freeze is NOT edited (it is a
hashed evidence artifact cited by t17/t18/t19); see captain ruling R17.

## What passes on the bytes

- ruling (a): `git grep -n omo_ -- skills/ast-grep` = 0; the helper is `mpd_*`.
- ruling (b): codegraph `MIGRATION_ID` (:8819/:8877) + the `[upstream]`/`[senpi]` reads
  (:8850/:8851/:8854) and the lsp `.codex/lsp-client.json` + `.codex/lsp-install-decisions.json`
  discovery defaults (:366/:367) all PRESENT and allowlisted as KF-03/KF-04.
- ruling (c): `OMO_CODEX_*` = 0 hits repo-wide; no `GIT_BASH_ENV_KEY` and no `source:"env"` branch
  left (22651 -> 22137 B).
- Exactly ONE re-pin (4 value lines: skills f6bb2053->a0f1febb, gitbash 0484a8ff->6458a82e,
  lsp 9f41d425->a7cebcf9, lockedAt) and it EQUALS the recomputation (frozen `recompute-lock.mjs` =
  MATCH; `node scripts/verify-vendor.mjs` = PASS exit 0); no second committed lock change; astgrep
  f06bba31 and codegraph ab287cdc recomputed-equal and untouched.
- `evidence/**` byte-identical (no ` M evidence/...`, only `??` new dirs); `docs/omo-parity-gap.md`,
  `docs/plan-*.md` and `PLAN.md` untouched.
- Bilingual: 27 pairs, 0 without a sibling, 0 touched-pair desyncs, heading parity on all 12 touched
  pairs, reciprocal switch links under the titles, no dangling `omo-parity-ledger` reference anywhere
  outside history.
- No allowlisted KEEP was renamed.
- Gates the reviewer ran itself: `verify-vendor` exit 0 PASS, `bun run typecheck` exit 0,
  `bun test packages` 408 pass / 0 fail. It did NOT re-run `test:qa`, the MOUNT boot, the
  build-mcp reproducibility check or codegraph-smoke — it read t18's filed logs for those and says so
  in its coverage statement.

## Other findings (low)

1. t16's finding F3 is stale: `ast_grep_helper.py:205/:250` now read "MPD runtime resolution" /
   "MPD runtime dirs" and `AGENTS.md:23` reads "MPD caches"; `git grep -n omo_ -- skills/ast-grep` is
   empty.
2. The frozen allowlist has no entry-level enumeration for the third-party skill bodies that still
   carry the trigram (21 x `skills/lsp-setup/references/*/README.md`, `lsp-setup/SKILL.md:86`,
   `review-work/SKILL.md:30`). The class is documented (KP-05 / F7) and no wave-touched file is
   affected, but G2's entry-level closure is then not mechanically demonstrable without one
   enumerating entry — supplied by captain ruling R17 rather than by editing the freeze.
3. G9's frozen count (3 untracked evidence entries) is stale at 9: the subject grew, the intent (no
   tracked evidence modified) still holds.

## Reviewer's own caveat

The reviewer is read-only by design and wrote no file this turn; the review record therefore exists
in the t19 task output (and here, transcribed). It filed a coverage statement naming exactly which
verifications it re-ran itself and which it read from t18's logs.
