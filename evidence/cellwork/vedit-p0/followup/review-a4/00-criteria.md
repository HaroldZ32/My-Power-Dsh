# Review A4 — criteria frozen BEFORE the fix was read (2026-11-03T07:11Z)

**Row:** T15 (board), re-review of the T14 fix. **Writer:** `se-cellwork` (`99a0e207…`).
**Loop:** `loop-20261103T070604-6f2ccd` (T14). **Contract:** `.mpd/plans/vedit-p0-followup.md`
(§F1/§F2) + the A3 findings it repairs (`evidence/cellwork/vedit-p0/followup/review-a3/REPORT.md`).
**Gate authority:** `AGENTS.md` §4, §7.

**Tree pinned at 07:11:16Z** (`gates/00-scope-start.sha256`): `SKILL.md` `71477fbc…`, `tui-admission.ts`
`e296420c…` (was `f44f1900…` at A3), `barrier-live-engine.test.ts` `d5e37b40…` (was `deea1f1a…`),
`flow.test.ts` `ea6ff957…` (UNCHANGED), `surface-pin.ts` `805b2dba…` (UNCHANGED), contract `3e12b6f3…`
(UNCHANGED). **Hunk-map delta vs the A3 diffs** (first observation, before reading content):
`tui-admission.ts` — every hunk except the FIRST keeps its old-line range and new-line count, so the only
content change is the header; `SKILL.md` — ONE changed line; the barrier test — the arms were rewritten.

This file states what I will judge, and how a wrong answer would be caught, before I read the new code.

## (a) SKILL.md's `tui-admission` row matches the CURRENT arms

| # | criterion | what would falsify it |
|---|---|---|
| a1 | no stale promise survives: no "manifest's own four rows → waiting_authorization" static promise, no "NO-GRANT boot must say `waiting_authorization`", no applied-decision-handler claim, no "a REAL `tui/input` decision fires" | ANY of those four sentences still present in the row |
| a2 | the row states the SHIPPED live posture (compatible on both panes, NO grant, no grants hint, loader admits, a real chat turn) | the shipped posture absent, or stated as `waiting_authorization` |
| a3 | the row states the grant-clone's four live states, and arm3 as the STRING `inapplicable` (conditional), and the static control as CLONE-measured | a missing state; arm3 described as a pass or as unconditional |
| a4 | every claim in the row is checkable against `qa-live/run-artifacts/result.json` + the arm names | a claim the artifact contradicts |

## (b) the header's PREREQ codes are the ones `tuiPrereqs` really gates

| # | criterion | what would falsify it |
|---|---|---|
| b1 | `absent-dsh-binary` → dsh-tui, `absent-runtime` → tmux, `absent-fixture` → the sandbox profile, matching `lib/tui-lane.ts`'s table | the old `absent-runtime dsh-tui` mislabel; a missing tmux line |
| b2 | the measured constraints stated are ACCURATE (short socket root, warm profile, credentials) | a constraint stated that the lane does not have, e.g. a wrong socket-length number |
| b3 | the `Evidence ->` line names the directories THIS run writes | `negctl/` or `grants/` still named |

## (c) the ORDER probe is hard-coded-sleep proof (the A3-F2 residual)

| # | criterion | what would falsify it |
|---|---|---|
| c1 | **m5 REPRODUCED BY ME**: a hard-coded `await deps.sleep(200)` before the first attempt REDDENS the ORDER arm on the current tree | m5 still green (the residual survives) |
| c2 | **m2 REPRODUCED BY ME**: the configured-seam sleep reintroduced still reddens BOTH ORDER arms | m2 green — the old coverage lost while gaining the new |
| c3 | the two-sided control still observes a REAL retry delay after the first drive (`timer(40ms)`) | a control that no longer records the real retry, or one that passes vacuously |
| c4 | the main arm's discriminator is ORDER + "no delay scheduled at all", not a duration bound | a surviving `toBeLessThan` bound; a timeline filter that only records the configured ms |
| c5 | the probe cannot be fooled by a ZERO-delay timer being counted as a sleep (positive delays only), and it restores `setTimeout` in `finally` | zero-delay entries in the timeline; an unrestored patch |

## (d) the R2 `arm2` row names the move and the reason

| # | criterion | what would falsify it |
|---|---|---|
| d1 | `qa-live/report.md` §2's `arm2` row says SAME predicate, MEASUREMENT MOVED to the shipped boot, with the reason | the row still says "unchanged" |
| d2 | `lane-a/report.md` was updated so it no longer describes the retired probe (arm names, m5 row, bounds) | a lane report describing a probe that no longer exists |

## (e) no assertion weakened elsewhere

| # | criterion | what would falsify it |
|---|---|---|
| e1 | no `expect(` / `check(` removed without a named replacement; the suite is green on the settled tree | an unnamed removal; a red suite |
| e2 | the fix's scope: `SKILL.md` + `tui-admission.ts` HEADER + the barrier test (+ evidence); no `packages/*/src/**`, no `VENDOR_LOCK.json`, no git write | an unstated `src` change; a touched lock; a commit |
| e3 | `--self-test` / `--static-only` / `test:qa` still exit 0 (the header edit must not break the lane) | any non-zero exit |

## (f) the A3-F6 deferral

The `end` verb is now FROZEN (T10 PASS, T12 done) — the writer's stated deferral premise ("land when lane
B's END verb is FROZEN") is now satisfied. Judge: is the deferral still defensible, or must the one-line
pin land in this wave? Tests of a defensible deferral: the omission is recorded, its premise is honest, and
no gate relies on it. Tests of a flag: the verb is frozen, the change is one line inside the wave's own
skills re-pin, and the pin's whole purpose is to catch a REMOVED verb.

## Cross-cutting

| # | criterion | what would falsify it |
|---|---|---|
| X-a | both expected reds stay exactly two: `vendor` ONLY on the skills `treeSha`, `dist` ONLY on team-core | a second reason / a second stale target |
| X-b | the writer's own evidence (`review-fix/{gates.log,mutations.log,test-qa.log}`) matches MY runs | a claimed exit I cannot reproduce |
| X-c | no code edit by this seat; evidence only under `review-a4/**` | an edited product/test/skills file |

## Bounds declared in advance

- Two EXPECTED reds, NOT scored: the skills `treeSha` (captain's single re-pin) and the team-core `dist`
  stale (N3 repair unbuilt).
- I will not read `packages/*/src/**` to form the verdict; the mutation replay needs narrow anchor greps
  only (declared, as at A3).
- I do not re-create the pre-edit red, and I do not re-run the live TUI lane unless the header edit is
  shown to touch behaviour (it is comments-only by the writer's claim — I will verify structurally).
