# Review A6 — the T20 fix of A5-F1 (a non-vacuous `arm5d`)

**Row:** T21 (board), re-review of `T20`. **Writer:** `se-cellwork` (`99a0e207…`).
**Loop:** `loop-20261103T073101-95530c` (T20). **Contract:** `.mpd/plans/vedit-p0-followup.md` (§F1/§F2) +
the A5 finding (`evidence/cellwork/vedit-p0/followup/review-a5/REPORT.md` §2, A5-F1). **Gate authority:**
`AGENTS.md` §4, §7.

**Tree pinned at 07:38:32Z** (`gates/00-scope-start.sha256`): `tui-admission.ts` `0f93c004…` (was `98ff00ec…`
at A5), `SKILL.md` `37b68665…` (was `d6d93ca3…`), `surface-pin.ts` `0d883365…` (UNCHANGED), the team-core
enum `f5461b9d…` (UNCHANGED), contract `3e12b6f3…` (UNCHANGED), HEAD `2230607d`. The T20 deltas were measured
against a REBUILT A5 byte image (rebuilt hash `98ff00ec…` = the A5 hash): `tui-admission.ts` 8 hunks /
~71 lines, `SKILL.md` one sentence.

This file states what I will judge, and how a wrong answer would be caught, before I read the new code.

## (a) `arm5d` can no longer pass vacuously

| # | criterion | what would falsify it |
|---|---|---|
| a1 | the measurement lives in a FRESH boot (phase C) with the grant staged BEFORE the boot and exactly ONE `/plugin check` step | the step still inside a boot that carries earlier decisions; the grant written after boot; more than one step |
| a2 | `arm5d = state === "compatible" && decisions === 1` | the count term absent; `>=1`; the count taken from a different pane |
| a3 | the counter is TWO-SIDED in the self-test (a pane with 2 decisions reports 2; a pane with none reports 0) | one side only; a counter that always reports the regex count without an assertion |
| a4 | the freshness term is INDEPENDENT of the semantic half — the phase-C pane's decision count is produced by the step, not by the boot | a boot that paints a decision on its own (then `decisions === 1` could be satisfied by something other than the driven check) |
| a5 | the artifact records the count the verdict rests on (`withGrant.decisions`) | a verdict the artifact cannot be re-derived from |

## (b) the red-first proofs are non-vacuous

| # | criterion | what would falsify it |
|---|---|---|
| b1 | **I re-derive the vacuity case**: the exported predicate over a pane with TWO decisions (the clone-granted capture) yields `arm5d = false`, while the REAL phase-C pane (one decision) yields `true` | the two-decision pane still passing → the fix is cosmetic |
| b2 | the writer's live mutant claim (`phase-C step sends Escape` → `ok=false` with ONLY `arm5d:false`) is consistent with the recorded log AND with the code path | the log shows other arms false; the claim cannot follow from the code |
| b3 | the real lane is `ok=true` and exits 0 on the settled tree | a red real lane |

## (c) nothing else weakened

| # | criterion | what would falsify it |
|---|---|---|
| c1 | no other arm's definition or expected value changed; the live `ok` predicate keeps every term | a changed arm; a dropped `ok` term |
| c2 | the STATIC plane is untouched (`grants.manifestGranted`, `grants.ok`) | any hunk inside `staticAdmission`/`grants` |
| c3 | the clone's four arms and arm6 are unchanged | a moved expectation |
| c4 | gates: `--self-test`, `--static-only`, the LIVE lane, `test:qa`, `typecheck`, `comments` all exit 0 | any non-zero for a reason owned by this change |
| c5 | scope: `tui-admission.ts` (+ `SKILL.md`, which the writer edited for the docs) + evidence; no `packages/*/src`, no `VENDOR_LOCK.json`, no git write | an unstated src change; a touched lock; a commit |
| c6 | the expected red stays exactly one: `vendor` on the skills `treeSha` only | a second reason |

## Bounds declared in advance

- The LIVE lane now takes THREE boots; I run it myself and will not score it from the writer's log.
- I will NOT re-run the live MUTANT (a fourth boot, ~12 min): I re-derive its logic from the exported
  predicate over real panes and read the writer's log, and I say so.
- `lastCheckWindow` is now `export`ed; I import the SCRIPT ITSELF (not a copy) so the predicate under test
  is the shipped one.
- No code edits; evidence only under `review-a6/**`.
