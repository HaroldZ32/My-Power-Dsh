# t53 — T-11: the per-member next-claimable/capacity view (the plan's A/2 carrier)

Stamp `20260917T161700Z` · lane A (agent-teams-engineer) · attempt `4eaca879-ecff-4a22-8608-561e0c039f0f`.

## The DO-WHEN (read from the frozen acceptance artifact's own T-11 section, not from prose)

- DELIVERABLE: a per-member next-claimable/capacity view on the readable surfaces, **fed by the scheduler's own ready-set
  helper** (never a second implementation). OBSERVABLE: in a chain (`t1 → t2`) the view names the ready task for the idle
  member and shows the blocked one as blocked; a member holding an in-progress task is not shown as ready for it.
  DECISIVE: the view's ready set equals the scheduler's ready set for the same revision, compared mechanically.
  NEG CONTROL: zero ready tasks prints `none`; a busy member is not listed as claimable.

## Shipped — five regions in `lib/tools.js`

| region | what it does |
|---|---|
| `mpd-delta capacity-view-import` | imports `isTaskReady` from `./scheduler.js` — the helper is the ONLY readiness rule the view uses |
| `mpd-delta member-capacity-view` | `memberCapacityView(team)` → one row per live member: `{name, busy_task, next_claimable, ready, blocked, pool}`; `readyOf`/`blockedOf` both call the helper, so a task it refuses is NAMED as blocked instead of dropped |
| `mpd-delta status-capacity-bind` | the single computation on the same record the task lines render from |
| `mpd-delta status-capacity-payload` | the same rows reach a structured reader |
| `mpd-delta status-capacity-render` | one line per member, ALWAYS: `Capacity (next claimable per member, from the scheduler’s own ready-set helper):` then `  - <name>: next <id|none> · busy <id> · blocked <ids> · pool <ids>` — absence printed as absence, never an omitted line |

## The readings (both, as the row asks)

`arms-after.log` (arm 2) prints the comparison itself:

```
[T-11] scheduler ready set: ["t1"]
[T-11] view ready set:      ["t1"]
```

and asserts `expect(viewReady).toEqual(schedulerReady)` over the row's own `ready` sets — then repeats it after `t1`
completes (both move to `["t2"]` together, so the equality is not a lucky first snapshot). Arm 1 reads the chain's
observable exactly (`Idle.next_claimable === "t1"`, `Idle.blocked === ["t2"]`, `Busy.next_claimable === null`,
`Busy.busy_task === "t3"`). Arm 3 is the negative control: zero ready ⇒ every row `next none` AND the lines are PRINTED
(`["  - Idle: next none", "  - Busy: next none"]`), and a ready POOLED task exists while the member holding work stays
unclaimable. Arm 4 is the helper wiring, DECLARED as wiring (never counted as the behavioural reading).

RED SIDE (`arms-mirrorM1-second-predicate.txt`): the mirror replaces the helper call with a SECOND predicate
(`status === 'pending'`). The blocked `t2` then leaks into the view's ready set and **exit 1 with THREE arms red —
including the DECISIVE one** (1 pass / 3 fail). That is why the row's own READY set is exposed on the row: an earlier
comparison that unioned only `next_claimable` + `pool` did NOT redden under this mutation, and the arm was strengthened
rather than left green for the wrong reason.

## The sequencing that held it back (stated from the artifacts, not inferred)

`.mpd/plans/friction-p2-wave-2b.md:108` records the A/2 carrier as **"T-11 (carried separately for size) … declared on
creation, file-exact, after A-1 is terminal"**, and the acceptance's own T-11 section ends with **"Prereq: A-1
terminal; the file-exact set is declared at creation (§1)"** — so the absence was BY DESIGN (and rev-A ruled it
COMPLIANT rather than a miss). The precondition now holds: **A-1 is `t13`, terminal for hours**, and this carrier is the
task the plan reserved for it. No artifact was edited to make this true.

## Readings (all at the final revision)

| command | result |
|---|---|
| `bun test ./packages/mpd-agent-teams-plugin` | **299 pass / 0 fail / 2755 expect() / 48 files**, exit 0 (`suite.log`) |
| `bun test …/self-fix-tests/t53-member-capacity.test.mjs` | 4 pass / 0 fail / 20 expect() (`arms-after.log`) |
| `bun test …/self-fix-tests/registry-context-heal.test.mjs` | 21 pass / 0 fail (`heal.log`) |
| `node scripts/patch-agent-teams-fixes.mjs --check` | exit 0 — 118 regions / 10 adopted files (`registry-check.log`) |
| `bun run verify:docs` | PASS — `carried **118**/10 vs derived 118/10` (`verify-docs.log`) |
| `bun test ./packages/mpd-team-watchdog-plugin` (CROSS-LANE READING) | **139 pass / 0 fail / 684 expect() / 13 files**, exit 0 (`cross-lane.log`) |

`--write-registry` ran in the same change (113 → 118 regions) and the count sentence in
`agent-references/agent-teams-deltas.md` moved with it (a first attempt at that sentence asserted on an anchor that does
not exist — `verify:docs` went RED with `carried 113 vs derived 118` and the edit was re-applied against the real text;
the red reading is left in the git-visible sequence of this task rather than smoothed).

Counts that moved: suite 295/2695/47 → 299/2755/48 — the new arm contributes 4 tests / 20 `expect()`; the remaining
`expect()` growth (the two render lines the new block adds to every status render in the suite) is reported as MEASURED,
not attributed. NO `test/**` file was edited; no pinned surface in another lane was re-worded.
`packages/*/dist/**`, `dist/mpd-package/**`, `VENDOR_LOCK.json`, `.mpd/plans/**`, `skills/**` untouched; no repo-wide
aggregate; every path-qualified command is `./`-formed with its discovered file count.
