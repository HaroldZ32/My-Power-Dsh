# R21 — the producer no longer emits a flat DAG: the data plane reports what it cannot resolve

Lane: `seam-guard` (T7). Package: `packages/mpd-team-core-plugin`. The LIVE record
(`.mpd/team/teams/team-20261006135108.json`) was **never read for a write and never mutated** by this
change: every measurement below ran in a throwaway sandbox, and the fix touches only what a NEW approval
produces.

## The defect, in the captain's own terms

A staged plan wrote its blockers as the plan's own **positions** — `blocked_by: ["2"]`,
`["2","3","4","6"]`, `["7"]`, `["2","3","4","5","6"]`, `["7","8","9"]`. `NewTaskInput.blockedBy`
documented the accepted forms as "subjects or ids", `resolveBlocker` returned an unmatched reference
UNCHANGED, and `taskDepths` filtered `blockedBy` with `byId.has(candidate)` — so every reference was
accepted, nothing resolved, and the board rendered **one column, zero edges, no warning anywhere**.

## What changed (three files, no new abstraction, no renderer)

| File | Change |
|---|---|
| `src/team-store.ts` | `TeamTaskRecord.unresolvedBlockers?: string[]` (the missing fact, documented as the invariant a reader needs); `resolveBlockers()` — the ONE place the split is computed; `addTeamTask` / `updateTeamTask` store the unresolved half BESIDE `blockedBy` (which keeps the caller's text verbatim); `NewTaskInput.blockedBy` documents the three accepted forms |
| `src/plan-store.ts` | `StagedTask.blockedBy` documents the three forms and says what happens to anything else; `StagedPlan.created.unresolved` carries the durable report; `classifyBlocker()` reads one reference against the plan as written |
| `src/index.ts` | the approval mints every staged task FIRST, then maps the plan's own namespace (1-based position, subject) to the minted board ids and rewrites only the references the first pass could not resolve; the answer/plan carry the report; `create_task`/`edit` answer with the write-time reading, and the tool's own `render` paints the WARNING |

The `taskDepths` filter itself was deliberately NOT changed: it is the honest drawing rule (an edge needs
two real tasks), and R17/R20 already made the renderers survive a flat board. What was missing was the
PRODUCER-side ability to say *why*, which is what `unresolvedBlockers` is.

## Measured BEFORE → AFTER, on identical input, with the REVIEWER's own script

Input = the captain's pre-repair plan shape (ten tasks, the five position references above). BEFORE is
`fidelity-verifier`'s frozen `preRepair` fixture; AFTER is the record the real `agent_teams_plan` tool
approved from that same shape in a sandbox. Both numbers come from
`evidence/tui/dag-port/verification/one-column-repro.ts` (`--record <after-record.json>`), i.e. not from
a metric this lane graded itself:

| reading | tasks | distinctRanks | links |
|---|---|---|---|
| `preRepair` (before the fix) | 10 | **[0]** | **0** |
| `live` = my producer's record (after the fix) | 10 | **[0,1,2,3,4]** | **14** |
| the reviewer's hand-repaired reference variant | 10 | [0,1,2,3,4] | 14 |

The after-state equals the hand-repaired variant exactly: **five ranks and fourteen real edges from the
same plan text that used to produce one rank and none.**

## The failure now lands where a captain writes the plan

`agent_teams_plan {action:"create_task"}` with `blocked_by: ["7","8","9","the review task"]` answers

```
write-time reading: [{"reference":"7","form":"position"},{"reference":"8","form":"position"},
                     {"reference":"9","form":"position"},{"reference":"the review task","form":"unknown"}]
```

and its `render` paints

```
task "INTEGRATION…" staged — WARNING: blocked_by "the review task" name(s) no task this plan can resolve
(only a position like "2", a staged subject, or a board id like "T2" resolves); approval will report it
and draw no edge
```

A FORWARD position stays legal (task 3 may not be staged yet), so the reading is advisory — it never
refuses a plan. At approval the same reference is reported twice more, and the approval of the full
captain-shaped plan reports `unresolved: []` because every position now resolves:

```
approval reported unresolved: [{"taskId":"T10","references":["the review task"]}]
board: T10 blockedBy ["T7","T8","T9","the review task"] · unresolvedBlockers ["the review task"]
archived plan: created.unresolved == [{taskId:"T10", references:["the review task"]}]
```

## What a reader can now distinguish (the whole point)

`unresolvedBlockers` is **absent** when every blocker resolved and **non-empty** when one did not — so
"this task genuinely has no blockers" and "this task's blockers did not resolve" are different facts on
the record. The TUI/WEB readers can say so wherever they draw; the field's own comment states that
contract.

## Two things the captain asked to be recorded

1. **The T6 edge repair is a CAPTAIN CALL, not a mechanical mapping.** `fidelity-verifier` flagged that
   the live record's T6 went `["2"]` → `["T3"]` while a literal `position N → T<N>` mapping implies
   `["T2"]`. It is deliberate: the SEMANTIC dependency of the wiring task is the PANELS task, not the
   geometry task, and both are roots so **no rank moves either way**. The general lesson is worth more
   than the instance: *a repair that mechanically applies a correct mapping can still be wrong.*
2. **This repair path is a WORKAROUND for R21, not a substitute for it.** Repairing a board by hand is
   what the producer now does structurally: resolve the plan's own namespace at approval, report what
   cannot be resolved, and never store a reference that no reader can act on without saying so.

## Honest bounds

- The BEFORE fixture is the reviewer's frozen transcription of the live board (the live file has since
  been repaired in place); the AFTER measurement is a fresh sandbox approval of the same plan shape.
  Both are cited with the script that produced them.
- The readers' own drawing of the new fact (`unresolvedBlockers` surfacing in a panel/browser row) is
  NOT part of this change: `packages/mpd-tui-plugin/src/team-state.ts` and
  `packages/mpd-bundle-plugin/src/team-view.ts` are outside this lane's write scope. The record now
  carries the fact and its invariant is written down; wiring it into a row is a follow-up for whoever
  owns those readers.
- `mpd-team-core-plugin/dist/index.js` is STALE as of this evidence (the rebuild belongs to the
  captain's integration task): the numbers above describe `src/`, and the PTY/Docker acceptance must run
  after the rebuild.
