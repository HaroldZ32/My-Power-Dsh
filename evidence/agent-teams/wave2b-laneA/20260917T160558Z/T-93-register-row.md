# T-93 — the register row text, authored in EVIDENCE (not in the register)

**Why this file exists and not a `.mpd/TODO.md` edit:** `.mpd/TODO.md` is the INTEGRATION task's (`t25`) declared
path. This lane may not write it, so the row is minted here, verbatim-pasteable, with its measurements and their
sources named. Authored by lane A (`agent-teams-engineer`) on `t51`, stamped `20260917T…` (see the directory name).

## The row (register form)

| row | §Fix (as pasted into the register) | class | lane / task | evidence |
|---|---|---|---|---|
| **T-93** | **the dispatch re-offer family and the generated repair's seat, ONE routing class keyed on BOTH halves** — a delivery is refused when the task is TERMINAL **and** the delivery carries the SAME attempt id its completion recorded (a re-offer of finished work: never claimed, never re-worked, reported instead of re-dispatched); and a review's generated repair is routed to a seat whose deny list does **not** withhold the tools the repair needs (write-kind → a writer, or the reviewed artifact's author **while the author can write**), with a CAPTAIN ROUTE instead of an unexecutable repair when no seat can run it | routing · dispatch contract | A (`t51`) | `evidence/agent-teams/wave2b-laneA/20260917T155633Z/` |

**§home:** the dispatch-defect family's statement lives in `agent-references/troubleshooting.md` ("agent-teams dispatch
defects"); T-93 is the row the wave-2a §8.8 tail declares as the mint origin ("the rows that ROLL to wave 2b (34 ids,
minting from T-93)"). The id is cited by T-06's row and by the wave-2b lane-A acceptance.

## Why the class is keyed on BOTH halves — one measurement per half, neither alone sufficient

- **The KICK COMPOSE surface always MINTS a fresh attempt id** (lane C's `t17`, ledger §A-63: `48c3f297…`/`251420e9…`
  against the completion's `7c133ef3…`). An attempt-id EQUALITY predicate is therefore **unmeasurable** there.
- **The DISPATCH surface produces exactly `delivery.attempt_id == completion.attempt_id` ON A TERMINAL TASK**
  (nine measured instances this wave — the tallies below), and the platform's own refusal text names the shape:
  `task status cannot move from "completed"|"failed" to "claimed"`.
- Consequence, stated by the acceptance and proven by this task's own three mirrors: **a fix keyed only on
  terminality refuses both surfaces but cannot say WHICH — and cannot distinguish a re-offer from a compose/wake
  race; a fix keyed only on the equality refuses the dispatch surface and says nothing about the kick surface** (a
  terminality-only mirror reddens the class assertion, an equality-only mirror reddens it too — both are kept on
  disk as `arms-mirrorM1/M2`).

## The measured instances and their TWO variants

The family's tally GREW as the wave ran; the last reading has measuring authority and every earlier number is
provenance (the wave's usual rule). Named instances, each with the ledger entry that recorded it:

| reading | instances | source |
|---|---|---|
| three stale replays in one session | `t8`, `t9`, `t8` again | `.mpd/plans/friction-p2-wave-captain-log.md:2320` |
| a fourth stale dispatch, same variant as `t27` | `t33` | `…captain-log.md:3634` |
| the family reaches FIVE | `t35` re-offered to its own owner | `…captain-log.md:3641` |
| a SIXTH stale wake | sealed task re-offered with the id it completed | `…captain-log.md:3711` |
| the EIGHT re-offer instances | — (mirror statement) | `…captain-log.md:4063` |
| the captain's dispatch reading at `t51`'s creation | **nine** | the `t51` assignment text |

The two VARIANTS, both defeated by the same one-line guard:

1. **a stale ATTEMPT ID** — `t27`, `t33`, `t35`, `t40` re-offered to their own owner **with the attempt id they
   completed** (the dominant variant).
2. **a stale CONTRACT** — a wake carried `t28`'s **pre-amendment** contract (four items) while `t28` was already
   terminal (completed at revision 3 with six stored items). A contract payload is a delivery too, and the guard is
   the same: read the task's live status before acting; a terminal task is never re-run.

## The `reassigning: false` mechanism (why the existing stale guard never fires)

The deliveries that produced the nine instances carried **`reassigning: false` in the payload**, and the attempt id
was **not stale** — it was the same id the completion recorded. The member-facing instruction only arms on
reassignment (`a stale-attempt rejection means the captain reassigned or took over the task`), and an **attempt is
minted by a REASSIGNMENT, never by a re-offer** (ledger §A-102: a `failed` task can never be re-claimed —
`task status cannot move from "failed" to "claimed"` — so the captain's only remedy is a NEW task id). The re-offer is
therefore invisible to the stale-attempt guard by construction, which is why the class has to be named where the
delivery is decided.

## The negative control the row carries

**A team whose ONLY seat is read-only must produce a loud refusal or a captain route — never a repair that cannot
complete** (the `t18`/`t38`/`t41` pattern, measured on this wave four times). In the generated-repair half that is a
`notifyCaptain` refusal naming what each seat withholds, with the repair NOT created; in the delivery half it is the
named decline (the seat is not woken at all, and the task's own status is left exactly as it is).

## What landed with this row (t51)

- `mpd-delta reoffer-terminal-route` (`lib/scheduler.js`): the named, exported predicate `deliveryRoutingClass(tasks,
  delivery)` → `'reoffer-terminal-same-attempt'` · `'terminal-rotated'` · `'rotated'` · `'task-gone'` · `undefined`.
  It **replaces the inline terminality/rotation if-chain** in `mpd-delta terminal-dispatch-recheck` branch for
  branch (the decision table is pinned by an arm), and the decline note now names the CLASS.
- `mpd-delta repair-seat-capability` + `mpd-delta repair-seat-selection` + `mpd-delta repair-seat-required`
  (`lib/quality-gates.js`): `generatedTaskCapabilityGap` reads the member's `toolDeny` against the tools the
  generated task's halves need, `schedulableAssignee` skips a seat that cannot execute, and the generator returns a
  captain route instead of creating an unexecutable repair. The read is asserted EQUAL to the dispatch's own
  `taskCapabilityGap` (now exported from `lib/scheduler.js`) on every member of a fixture team.
- Readings: 4 arms (36 `expect()`), three mirrors each red on its own half (`arms-mirrorM1/M2/M3`), the full plugin
  suite, the heal suite, `--check`, `verify:docs`, and the cross-lane watchdog reading — all in this directory.
