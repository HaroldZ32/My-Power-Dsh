# ROUTING REFUSAL — `t25` (wave-2b integration) was dispatched to a worker seat

**Seat:** packaging-engineer (lane B). **Task offered:** `t25 — int … (CAPTAIN-owned, do not claim)`.
**Action: REFUSED, nothing claimed, no write to any surface the task owns.** Recorded here because this
lane's invariant is evidence on disk for every claim, and because wave 2a recorded the same shape four
times.

## The authority is the task's own contract

Its text, verbatim: *"**CAPTAIN-OWNED; sits unassigned in the pool on purpose, because the create
surface has no `captain` member and the captain takes it by `reassign_task` at the integration
moment.**"* and *"**NO MEMBER SHOULD CLAIM THIS TASK.** If a dispatch offers it to a worker or read-only
seat, the correct move is the refusal wave 2a recorded four times — state that the acceptance needs a
shell, writes and the git writer, and report the routing defect."*

## Why the acceptance cannot be executed by this seat (three independent reasons)

1. **The git writer.** The wave's single commit, the single re-pin and the ONE re-pack are the captain's
   alone (AGENTS.md §5: a teammate NEVER runs `commit`/`add`/`checkout`/`switch`/`reset`/`stash`/`merge`/
   `branch`/`rebase`/`tag`). Two acceptance items are literally git-writer steps.
2. **Surfaces no member may write.** `t25`'s inScope is `VENDOR_LOCK.json`, `dist/mpd-package/**`,
   `packages/*/dist/**`, `.mpd/TODO.md`, `.mpd/plans/**`, `evidence/**` — the re-pin carries the captain's
   `--i-know-this-is-the-captains-step` marker; the re-pack is "exactly ONE, after every writer is quiet";
   the register dispositions are the captain's record. My seat's write sets are lane-scoped and file-exact.
3. **Single-writer discipline.** The one re-pin and one re-pack exist precisely so that no second writer
   can land them; a worker executing them would be the collision class T-88/T-84 were written about.

## The routing defect, with its counter

The dispatch carries **Attempt 14**. Fourteen attempts on a task whose contract forbids member claims is
the defect itself, and its side effect is measurable on my seat: the scheduler reports
`packaging-engineer: next none · busy t25`, i.e. a captain-owned task is occupying a worker's capacity and
the fix is the one the contract names — **the captain takes it by `reassign_task`** (or cancels it).

## What this seat can still contribute, within its own lanes

- Re-runnable readings on request: `node ./scripts/verify-gates.mjs` (T-70's non-short-circuiting runner)
  reports all five members separately; my lane's driver regenerates its whole evidence set in one command.
- A second pair of eyes on any reading the integration wants falsified — as a supporting reading, never as
  the integration's own write or commit.
- Nothing else: the integration's evidence dir, register dispositions and git step are not mine to touch.
