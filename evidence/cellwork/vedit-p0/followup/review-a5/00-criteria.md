# Review A5 — criteria frozen BEFORE the T18 fix was read (2026-11-03T07:25Z)

**Row:** T19 (board), re-review of `T18`. **Writer:** `se-cellwork` (`99a0e207…`).
**Loop:** `loop-20261103T071704-813e2a` (T18). **Contract:** `.mpd/plans/vedit-p0-followup.md` (§F1/§F2) +
the A4 findings (`evidence/cellwork/vedit-p0/followup/review-a4/REPORT.md`, A4-F1 Nit / A4-F2 flag).
**Gate authority:** `AGENTS.md` §4, §7.

**Tree pinned at 07:25:00Z** (`gates/00-scope-start.sha256`): `SKILL.md` `d6d93ca3…` (was `71477fbc…` at
A4), `tui-admission.ts` `98ff00ec…` (was `e296420c…`), `surface-pin.ts` `0d883365…` (was `805b2dba…`),
`packages/mpd-team-core-plugin/src/index.ts` `f5461b9d…` (lane B's frozen enum), the barrier test
`d5e37b40…` (UNCHANGED since A4), contract `3e12b6f3…` (UNCHANGED), HEAD `2230607d`.

This file states what I will judge, and how a wrong answer would be caught, before I read the new code.

## (a) A4-F1 — the "even WITH a grant" claim is MEASURED on BOTH planes

| # | criterion | what would falsify it |
|---|---|---|
| a1 | STATIC: a NEW `grants.manifestGranted` decision (shipped manifest + the clone's ONE row) is `compatible` AND folded into `grants.ok` | the field absent; `compatible` not required by `ok`; the shipped manifest not actually negotiated WITH the row |
| a2 | LIVE: a NEW `shipped.withGrant`/`arm5d` re-checks the SHIPPED manifest INSIDE the granted boot (while the grants file holds the row) and the lane is green | the step reading a pane captured before the grant was written; a stale pane; the arm not in `ok` |
| a3 | NO permission-less arm was touched (arm1/arm1NoHint/arm2/arm3/arm4/arm5/arm5b/arm5c and the static `manifestDecision`/`ungranted`/`granted`/`wrongScope` expectations unchanged), and `ok` only GAINED a term | any weakened/removed term; a changed expectation; a dropped arm |
| a4 | `SKILL.md`'s sentence states the MEASURED pair accurately (no grant AND with the row granted), matching the artifacts | the row still claiming something unmeasured, or overstating (e.g. "any grant") |
| a5 | the artifacts on disk carry `manifestGranted` and the live step's verdict | a claim whose artifact is absent or disagrees |

## (b) A4-F2 — the `end` verb is PINNED and the pin is falsifiable

| # | criterion | what would falsify it |
|---|---|---|
| b1 | `surface-pin.ts`'s `agent_teams_control` pinned set contains `end`, and the file's live enum really offers it | the pinned set without `end`; a pin against an enum that lacks it (would already be red) |
| b2 | **m6 REPRODUCED BY ME**: with `end` removed from the live enum, BOTH the live case and `--self-test` go RED naming `no longer offers action 'end'` | either stays green; a different problem message |
| b3 | the pin stays a SUBSET assertion (a future ADDED verb is tolerated) and no other surface assertion was weakened | a set-equality check smuggled in; a relaxed pin elsewhere; a deleted control |
| b4 | the file's change is minimal (the pinned array + its comment) | unrelated edits in the same file |

## (c) gates on the settled tree

| # | criterion | what would falsify it |
|---|---|---|
| c1 | `surface-pin.ts` live **and** `--self-test` exit 0 | either non-zero |
| c2 | `tui-admission.ts` `--self-test`, `--static-only` **and the LIVE lane** exit 0, with the new arm5d line in my own run | any non-zero; a live run without the new step |
| c3 | `test:qa`, `typecheck`, `comments` exit 0 (frozen-table gates, recorded on the loop) | any red for a reason owned by these changes |
| c4 | the two EXPECTED reds stay exactly two: `vendor` ONLY on the skills `treeSha`, `dist` ONLY on team-core | a second reason / a second stale target |
| c5 | scope: `SKILL.md` + `surface-pin.ts` + `tui-admission.ts` (+ evidence); no `packages/*/src` change of the writer's, no `VENDOR_LOCK.json`, no git write | an unstated src change; a touched lock; a commit |

## Bounds declared in advance

- Two EXPECTED reds, NOT scored (skills `treeSha`; team-core `dist`).
- The live lane reuses the warm `.mpd/sb/tui-admission` root; the `absent-fixture` SKIP is not exercised.
- For m6 I must mutate a file the case READS (`packages/mpd-team-core-plugin/src/index.ts`); I will do it in
  ONE shell invocation with a guaranteed restore (`trap`), verify the byte-identical restore by hash, and
  state it. This is the same declared deviation as A3/A4 (narrow anchor, restored, no lasting edit).
- I do not re-read `packages/*/src/**` beyond the anchor; the verdict rests on the contract, the reports,
  the deliverables and black-box runs.
