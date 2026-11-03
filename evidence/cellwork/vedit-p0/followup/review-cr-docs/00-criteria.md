# Review CR-docs — criteria (fixed by the T25 brief BEFORE any file was read, 2026-11-03T08:10Z)

**Row:** T25 (board), re-review of `T23` (CodeRabbit round-1 docs fix). **Writer:** `se-cellwork`.
**Loop:** `loop-20261103T080819-893695` (T23). **Contract:** the CR1 findings on PR #93 + `AGENTS.md` §4/§7.

These are the captain's stated criteria, transcribed verbatim in intent before I opened a single file; the
verification runs below are all against them.

1. **(a)** `skills/dsh-qa/scripts/tui-admission.ts` says **THREE** live boots and NAMES each: BOOT 1 = the
   shipped `/plugin check` + `/plugin list` + loader line + chat turn; BOOT 2 = the clone's three grant
   states + revocation; BOOT 3 = the shipped manifest WITH one grant, the grant staged BEFORE the boot, ONE
   `/plugin check`, exactly ONE decision line so a swallowed step reddens.
2. **(a)** the `Evidence ->` directory list includes `shipped-granted/`; the `shipped-bond` typo is fixed;
   the 0.15.0 `/plugins`→`/plugin` rename note sits under the item it belongs to (the BOOT-1 check).
3. **(b)** `SKILL.md`'s `tui-admission` row says THREE boots and names the third; the T14-corrected
   shipped / clone / conditional-`inapplicable`-arm3 wording is intact; the row still parses as a table row.
4. **(c)** the change is comment/documentation ONLY — the code must be byte-identical once comments are
   removed.
5. **(d)** `--self-test`, `--static-only`, `test:qa`, `typecheck`, `comments` stay green.
6. **Expected red:** the skills corpus `treeSha` pending the captain's SECOND re-pin; nothing else.

**Bounds declared in advance:** the live lane is NOT re-run (a comment-only change cannot alter behaviour and
the proof in (4) is structural); lane B's in-flight `packages/mpd-team-core-plugin/**` files are outside this
row; no code edits by this seat; evidence only under `review-cr-docs/**`.
