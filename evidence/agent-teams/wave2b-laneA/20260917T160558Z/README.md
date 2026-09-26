# t51 — T-93: the routing class, keyed on BOTH halves, plus the register row minted in evidence

Stamp `20260917T160558Z` · lane A (agent-teams-engineer) · attempt `8982beba-5362-47eb-9693-7f6a2e9ba094`.

## What T-93 is

TWO halves, both delivered here, because the frozen acceptance's observable and the captain's two-halves
constraint name different surfaces of ONE routing defect class:

1. **The generated repair's seat** (the frozen artifact): "the auto-generated repair routes to a seat that can
   execute it — write-kind tasks to a writer, or to the reviewed artifact's author; the generator reads the seat's
   deny list the way the spawn surface does."
2. **The delivery's routing class** (the captain's constraint): keyed on **terminality AND the attempt-id
   equality**, because the kick compose always MINTS an id (lane C's `t17`) while the dispatch surface produces
   exactly `delivery.attempt_id == completion.attempt_id` on a terminal task (nine instances this wave).

The register row text is `T-93-register-row.md` in this directory (`.mpd/TODO.md` is `t25`'s path).

## Shipped

| region | file | what it does |
|---|---|---|
| `mpd-delta repair-seat-capability` | `lib/quality-gates.js` | `generatedTaskCapabilityGap(task, member)` — the write half (`write`/`edit`/`mpd_hashline_edit`) and the exec half (`bash`), read from the member's `toolDeny` |
| `mpd-delta repair-seat-selection` | `lib/quality-gates.js` | `schedulableAssignee(...)`: the reviewed artifact's author is still preferred, but only while the author can EXECUTE the repair; otherwise the first capable member |
| `mpd-delta repair-seat-required` | `lib/quality-gates.js` | no capable seat ⇒ **no repair** + a `notifyCaptain` refusal naming what each seat withholds (the frozen NEG CONTROL) |
| `mpd-delta reoffer-terminal-route` | `lib/scheduler.js` | `deliveryRoutingClass(tasks, delivery)` → `'reoffer-terminal-same-attempt'` · `'terminal-rotated'` · `'rotated'` · `'task-gone'` · `undefined` |
| `mpd-delta terminal-dispatch-recheck` | `lib/scheduler.js` | MODIFIED in place: its inline if-chain is replaced branch for branch by the predicate, and the decline note names the CLASS |
| `mpd-delta pool-capability-guard` | `lib/scheduler.js` | `taskCapabilityNeed`/`taskCapabilityGap` EXPORTED (logic untouched) so the generator's read can be asserted EQUAL to the dispatch's |

The equivalence is asserted, not assumed: the arm compares `generatedTaskCapabilityGap` with the dispatch's
`taskCapabilityGap` for every member of a fixture team (`toEqual`). They are duplicated because `lib/state.js`
imports `quality-gates.js` and `scheduler.js` imports `state.js`, so importing the scheduler into the generator
would close a cycle — the row's DECISIVE clause explicitly allows "an asserted equivalence".

## Readings (all at the final revision, logs in this directory)

| command | result |
|---|---|
| `bun test ./packages/mpd-agent-teams-plugin` | **292 pass / 0 fail / 2652 expect() / 46 files**, exit 0 (`suite.log`) |
| `bun test ./packages/mpd-agent-teams-plugin/self-fix-tests/t51-reoffer-routing.test.mjs` | 4 pass / 0 fail / 36 expect() (`arms-after.log`) |
| `bun test ./packages/mpd-agent-teams-plugin/self-fix-tests/registry-context-heal.test.mjs` | 21 pass / 0 fail (`heal.log`) |
| `node scripts/patch-agent-teams-fixes.mjs --check` | exit 0 — 110 regions / 10 adopted files (`registry-check.log`) |
| `bun run verify:docs` | PASS — derived arm true: `carried **110**/10 vs derived 110/10` (`verify-docs.log`) |
| `bun test ./packages/mpd-team-watchdog-plugin` (CROSS-LANE READING) | **139 pass / 0 fail / 684 expect() / 13 files**, exit 0 (`cross-lane.log`) |

## The cross-lane break this task FOUND and REPAIRED ON ITS OWN SIDE (stated, not smoothed)

The FIRST form of the re-offer message (`task tX is completed and the delivery carries the SAME attempt id …`)
reddened lane C's pinned sentence in `packages/mpd-team-watchdog-plugin/test/lane-c-wave2.test.ts:431`:
`expected "became completed before its assignment could be delivered"` → **138 pass / 1 fail, exit 1**. The
remedy was taken in MY file, never lane C's: the re-offer message now keeps the race sentence byte-for-byte as its
first clause and APPENDS the routing class (an operator needs to tell the two apart), after which the cross-lane
reading is green again (139/0/684/13) and no lane C file was touched. The break is filed here because a
cross-lane reading that once went red is evidence about the edit, not a detail to drop.

## Red sides (one mirror per half; scratch copies outside the workspace, deleted in-call)

| mirror | neutralised | result |
|---|---|---|
| M1 | the TERMINALITY half (`const terminal = false`) | exit 1, **2 arms red** — the re-offer is no longer refused at all |
| M2 | the EQUALITY half (`const sameAttempt = false`) | exit 1, **2 arms red** — the refusal survives but the CLASS is gone |
| M3 | the capability filter (4th arg dropped) | exit 1, **2 arms red** — the repair goes back to the read-only author and the only-read-only-seats team creates one |

M1/M2 together are the proof that the fix is keyed on BOTH halves: each half, dropped alone, reddens its own arm.

## Honest bounds

- `test/**` was NOT edited (no record-shape pin moved): the four `test/**` files showing cumulative wave edits
  carry mtimes 23:34–23:41 from t47/t48/t49, while every file t51 created is stamped 00:05:50 (this task).
- **The suite's `expect()` total moved 2584 → 2652** at the same test count +4 (the new arm file's 4 tests and its
  36 `expect()` calls account for part of it; the rest is reported as MEASURED, not attributed — the same
  convention t50 used).
- The routing class is a READER: it refuses, it never writes (asserted against the record's bytes).
- `packages/*/dist/**`, `dist/mpd-package/**`, `VENDOR_LOCK.json`, `.mpd/plans/**`, `skills/**` untouched; no
  repo-wide aggregate; every path-qualified command is `./`-formed.

## Revisions (sha256, first 16)

`lib/scheduler.js a442ca63f04873d2…` · `lib/quality-gates.js d129f2b74688f29f…` · `lib/mpd-deltas.js
1a56843b1260593d…` (110 regions) · arm `self-fix-tests/t51-reoffer-routing.test.mjs 51b69be925c880c8…` ·
`agent-references/agent-teams-deltas.md 29ebe18ef93a2f54…`. Baseline pinned by t50: `lib/state.js
58d76b5c70cf8259…`, `lib/tools.js 25dfc8722c8e685e…`, registry `aa4524aebbcc3682…` (106 regions), suite
288/0/2584/45, heal 21/0, cross-lane 139/0/684/13.
