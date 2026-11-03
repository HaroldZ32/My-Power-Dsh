# Review A3 — criteria frozen BEFORE the code was read (2026-11-03T06:53Z)

**Row:** T11 (board), the REPLACEMENT formal review of T1/T2; the failed `rev-cellwork` seat is superseded.
**Loops:** T1 `loop-20261103T061032-70b5ca`, T2 `loop-20261103T061032-d4571e`. **Writer:** `se-cellwork`.
**Contract:** `.mpd/plans/vedit-p0-followup.md` §F1/§F2 (FROZEN 2026-11-03). **Gate authority:** `AGENTS.md` §4
(frozen `mpd_verify_*` table), §7 (QA discipline: assert a real artifact, never prose), §5 rule 4.
**Reference (not verdict):** `evidence/cellwork/vedit-p0/followup/review-a2/REPORT.md` + `gates/`.

**Tree pinned at 06:53:25Z** (`gates/00-scope-start.sha256`): `tui-admission.ts` `f44f1900…`,
`surface-pin.ts` `805b2dba…`, `dsh-plugin.json` `87fdb475…`, `barrier-live-engine.test.ts` `deea1f1a…`,
`flow.test.ts` `ea6ff957…`, contract `3e12b6f3…`, HEAD `2230607d`. The three T1/T2 file hashes are
IDENTICAL to the ones review-a2 pinned at 06:39Z, so the tree settled between the two reviews.

This file states what I will judge, and how a wrong answer would be caught, before I look at any of the
writer's new code. It is derived from the contract, the two lane reports and `AGENTS.md`.

## T1 (N1) — the live `tui-admission` lane re-specified for a permission-less manifest

The shipped manifest declares `"permissions": []` BY MEASURED DECISION (`776ac355`). On the live lane:

| # | criterion | what would falsify it |
|---|---|---|
| T1-a | the SHIPPED posture is asserted with **NO grants file**: `/plugin check` and `/plugin list` both `compatible`, and NO grants hint in the window | any surviving `waiting_authorization` requirement on the shipped manifest, or a grants file written for it |
| T1-b | the grant CLONE (shipped bytes + ONE `session.input.intercept@tui/input` row) drives ALL FOUR states: ungranted → `waiting_authorization`, that row granted → `compatible`, same name at an UNDECLARED scope → `waiting_authorization`, mid-session revoke → back to `waiting_authorization` | a missing state; a state asserted from the WRONG pane (the older decision above the newest — `lastCheckWindow`); the clone written over the shipped file |
| T1-c | arm3 is recorded as the STRING `"inapplicable"` **plus a reason**, never a folded `true`, and re-arms conditionally (`attributionArmsApplicable`) | `ledgerAttribution: true` with no bind; a silently deleted arm3; an unconditional arm3 kept and marked skipped |
| T1-d | the live run exits **0** on the settled tree (a PREREQ SKIP is not a pass and is not claimed as one) | non-zero exit; a `SKIP` reported as a live pass |
| T1-e | **no assertion weakened**: every removed/edited assertion is named with its replacement, and the `ok` predicate is not loosened | an unnamed removal; a dropped `ok` term; a deleted control |
| T1-f | the static half F1 landed (`--static-only` clone technique, N1 round-trip, N2 row-content control) is UNTOUCHED, and `--static-only` / `--self-test` exit 0 | a changed static block; non-zero exit |
| T1-g | `surface-pin.ts`'s negative control is restored to FALSIFIABLE (the mutated anchor still matches the live enum), not merely made green | a probe that passes because the replace is a no-op |
| T1-h | scope: only `tui-admission.ts` + `surface-pin.ts` (captain-authorised ripple) under `skills/`; `VENDOR_LOCK.json` untouched; no git write | any other `skills/**` file; a touched lock; a commit |

## T2 (N2) — the four lane-A Nits

| # | criterion | what would falsify it |
|---|---|---|
| T2-a | **N1 differing engine**: the registry HOLDS the member and answers a DIFFERENT engine; the arm asserts the handle's engine is driven and the registry's is NEVER driven | an arm where both seams return the same object; a `registry-first` implementation still passing (m1 must redden) |
| T2-b | **N2 sleep ORDER**: the discriminator is an ORDER (timeline/sequence), not a duration bound; a two-sided control proves the probe SEES a real retry sleep | any surviving `< 500 ms` bound; an order arm a 200 ms pre-sleep would still pass (m2 must redden) |
| T2-c | **N3 split description**: a black-box arm reads the REGISTERED `cellwork_split` description and requires the warnings rule's teeth | an arm reading source text; a description captured from a tool the flow plugin never registered (m4 must redden) |
| T2-d | **N4 interrupts**: `harness.interrupts.length === 0` asserted on the PROMOTED path (not only `reseeds`) | only `reseeds.length === 0`; m3 must redden |
| T2-e | no test weakened: every moved/replaced assertion NAMED (R2), additions only elsewhere, suite green; `packages/mpd-cellwork-plugin/src/**` UNCHANGED (F2) | an unnamed edit; a deleted assertion; a red suite; an unstated `src` change |
| T2-f | N5: the historical red-first log's bytes are unchanged and the report NOTES it | a rewritten log; a report silent on N5 |

## Cross-cutting

| # | criterion | what would falsify it |
|---|---|---|
| X-a | every claim in the two reports is anchored to a path on disk that EXISTS and says what is quoted | a quote with no artifact; a report claim the artifact contradicts |
| X-b | the two EXPECTED reds are exactly those two: `vendor` reds ONLY on `asset skills treeSha mismatch`, and `dist` stale ONLY for the team-core package (N3 repair, outside T1/T2) | a second vendor reason; a second stale dist package |
| X-c | the wave's frozen-table gates on the settled tree: `tests`, `typecheck`, `comments` exit 0 | any of them red for a reason owned by these changes |
| X-d | no code edit by this seat; evidence written only under `review-a3/**` | an edited product/test/skills file |

## Bounds declared in advance

- **Two reds are EXPECTED and NOT scored**: the skills `treeSha` (the captain's single re-pin) and the
  team-core `dist` stale (the N3 repair is unbuilt; the captain integrates).
- A live TUI lane needs a warm sandbox profile; if it cannot complete in my window I will say so and NOT
  score T1-d from a SKIP.
- I will not read `packages/*/src/**` before recording a verdict; tests, the QA scripts, the docs and
  black-box runs are my inputs. No FAIL is anticipated; if one is recorded, diagnosis reading opens.
- I do NOT re-create the pre-edit red: a revert is a git write, the captain's alone.
