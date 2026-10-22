# R1 repair — mpd-ulw-plugin test expectations pinned to the old signal set (2026-10-22)

Integration reported two failures in `packages/mpd-ulw-plugin/test/commands.test.ts` caused by R1's
expanded B lexicon (not by a defect in the shipped directive). A third assertion in the same file
carried the same stale expectation; all three are FIXED as intent updates, and
`packages/mpd-ulw-plugin/src` was NOT touched.

## Why the verdict moved

`TRIPPING_OBJECTIVE = "refactor the widget, migrate the store, audit the logs"` carries THREE
distinct deliverable verbs (refactor / migrate / audit). The expanded lexicon knows them, and the ULW
row calls `evaluateComplexityGate` with the shipped DEFAULT row (`easy`, B >= 2), so B now fires
beside C — and A beside both when the `team:` marker is consumed. The shipped directive was already
correct; only its pinned expectations were stale.

## The three edits (test expectations only)

| line (test) | old expectation | new expectation |
|---|---|---|
| mechanical staging arm (`complexity signals C`) | `complexity signals C` | `complexity signals B/C` |
| explicit-marker arm (`complexity signals A/C`) | `complexity signals A/C` | `complexity signals A/B/C` |

(`grep` for `complexity signals` in the file finds exactly these two spots; the second test is the
one the repair request named at ~523, the first at ~410 had the same class of staleness.)

## Observed results (quoted)

$ bun test packages/mpd-ulw-plugin
  24 pass
  0 fail
  209 expect() calls
  Ran 24 tests across 2 files.

$ bun test packages/mpd-roles-plugin
  169 pass
  0 fail
  1362 expect() calls
  Ran 169 tests across 9 files.

$ bun run typecheck
  $ tsgo --noEmit
  (exit 0)

Both suites are GREEN, including the roles package's F1 dist-freshness arm now that the captain's
pinned-bun rebuild has landed.

## Findings reported, NOT absorbed (outside this repair's scope)

1. `packages/mpd-ulw-plugin/src/index.ts` (the frozen ULW head) still says "any matched signal A-E:
   … E a CJK-scale instruction". Signal F exists now (easy row only) and `team.sensitivity` selects
   the row, so that sentence is stale. It is the directive's byte-stable head, so changing it is the
   CAPTAIN's decision (a prefix-cache-relevant edit), not a test fix.
2. `packages/mpd-ulw-plugin/src/index.ts` calls
   `evaluateComplexityGate(objective, { explicitFlag, activeBoulder })` — it never reads
   `team.sensitivity`, so the ULW pre-run gate always uses the shipped `easy` default. A user who
   sets `team.sensitivity: "normal"` gets the OLD thresholds on the session-start gate and the EAGER
   ones on the ULW gate. Reported for a follow-up task; the file is out of this repair's write scope.
