# CORRECTION (nested beside the sealed t14 evidence) — clean-form readings and the copy audit

**Task:** t14 (review-C) · **Reviewer:** code-reviewer · **Written:** 2026-09-17T08:2xZ (after the captain's T-89 heads-up)
**Rule being applied:** `bun test <positional-arg>` is a **SUBSTRING FILTER**, not a path. A leading `./` makes it a PATH.
`result.json` was not edited; this page is the correction BESIDE it.

## 1. The audit

| reading | command form | copies matching the filter at that moment? | verdict |
|---|---|---|---|
| lane suites (`bun test packages/mpd-team-watchdog-plugin`, `…/test/lane-c-wave2.test.ts`) | substring form, taken **before** the 16 MB mirror existed | none | clean |
| my revert-state runs (decline-seam neutered; hold-refusal unreachable) | absolute path **of the mirror** (`$M/packages/mpd-team-watchdog-plugin/test/lane-c-wave2.test.ts`) | none — the filter is the MIRROR's path, not a substring of the real file's path | clean (the KICK arm's own RED, 9 pass / 3 fail each time) |
| the live driver / mpd-bg / typecheck / dist-fresh / verify:docs | not `bun test <dir>` at all | — | clean |

## 2. The clean-form readings (PATH form, re-taken with no copies in the tree)

```
bun test ./packages/mpd-team-watchdog-plugin                             -> 139 pass / 0 fail, exit 0, 13 files
bun test ./packages/mpd-team-watchdog-plugin/test/lane-c-wave2.test.ts   ->  12 pass / 0 fail, exit 0, 1 file
bun test ./packages/mpd-team-watchdog-plugin/test/holds-lifecycle.test.ts->  20 pass / 0 fail, exit 0, 1 file
```
Raw: `CORRECTION-clean-form.out`. The discovered file count is the anchor: **13 / 1 / 1** — a set, not an accumulation.

## 3. The copy — already deleted, and why

The 16 MB mirror (`revert/lc-mirror`, a `cp -r packages` copy) was deleted **during my own review**, immediately after the two revert runs, as the disclosed pollution-vector discipline; every `.out` survived (`revert/lc-mirror-{baseline,nodecline,nohold}.out`). This happened BEFORE the captain's "do not delete on my account" instruction, so nothing was removed on his account. `find evidence/review -name '*.test.*'` is empty.

**Reconstructible if wanted:** the mirror was `cp -r packages <dest>`; both revert recipes are recorded in `commandsRun` (neuter `function noteDispatchDecline(…)`; `if (memberHold !== undefined)` → `if (false)`), and the pinned hashes are in `PIN-1`/`PIN-2`.
