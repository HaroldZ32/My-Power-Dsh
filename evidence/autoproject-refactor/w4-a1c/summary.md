# W4-A1c — derived team stage (first-match table) + the fenced-seat-is-idle fix

Board row **T46**. Scope: `packages/mpd-team-core-plugin/{src,test}` ONLY. `dist/` NOT rebuilt; no git
command run; no new tool verb and NO tool-description sentence (the surface stays at its measured size —
`tool-surface.test.ts` and the coupling inventory both pass unchanged).

## 1. NEW `src/stage.ts` — the classification, once

`teamStage(record, taskId?)` returns the discriminated `TeamStage`; `stageLabel(stage)` returns the ONE token
every surface renders (`person:blocked` / `working:queued` / `working` / `idle` / `ended`).

THE TABLE, first match wins (this order IS the contract, and it is written at the top of the file):

| # | Stage | Read from (existing fields only) |
|---|---|---|
| 1 | `person(failed)` | a task `status:"failed"` |
| 2 | `person(review)` | a `kind:"review"` task whose `verdict` is not `pass` |
| 3 | `person(blocked)` | an open, unclaimed task whose `blockedBy` is unresolved (`taskVisual === "blocked"`) |
| 4 | `person(delivery)` | every task terminal, none failed, and the record is not `ended` |
| 5 | `person(answer)` | nothing in flight AND a non-running member carries a `handoff` |
| 6 | `working(queued?)` | a task claimed/in progress; `queued` = a ready unowned task waits behind it |
| 7 | `idle` | live, nothing in flight, nothing waiting on a human |
| 8 | `ended` | `endedAt` set (`derivePhase`) |

`person(blocked)` OUTRANKS `working` deliberately: a blocked row is the fact that will not change by
itself, and a surface that says "working" over a board that cannot advance is the defect this fixes.

PURE and TOTAL: it reads only record fields, never writes, never persists a `stage`, and normalizes both
collections so a partial record classifies instead of throwing (an arm drives `{} as TeamRecord`, which is
what caught a real throw in the web route during this work).

## 2. Wiring (additive only — no existing key's meaning moved)

- `mpdTeams.summary(record)` → `{ ...summariseTeam(record), stage }`. The counts are untouched; `stage` rides
  beside them, and the service interface declares it.
- `mpdTeams.visual(record, taskId)` → the task's own visual, EXCEPT that a `running` row of a team whose
  stage is `person(...)` answers the reason (`blocked`/`failed`/`review`/`delivery`/`answer`). A board that
  cannot advance is never drawn as working.
- `team-web.ts` team payload gains `stage` (additive beside `phase`, which keeps meaning "is it live").
- `cellwork_supervise` — **DECLARED NOT DONE**: its per-member line renders the CELL's own rows (mode,
  handoff-ready, context ratio), not a `TeamRecord`, so wiring the stage there would need a new `mpdTeams`
  read plus a row field — beyond the one-line allowance the task grants, and the stage is already reachable
  as `mpdTeams.summary(record).stage` for that consumer.

## 3. The fenced-seat fix (R-W1A nit)

`team-store.ts::idleMembers` now excludes `member.fenced === true` — one exclusion fixes BOTH surfaces,
because `team-web.ts` builds its `idle` set from that same function. The member payload renders
`status: "fenced"` for such a seat (the field is typed `string`), so the panel never advertises a seat the
dispatch pass can no longer message.

## 4. Gates (command + observed result)

| Command | Result |
|---|---|
| `bun test packages` | **3272 pass / 6 skip / 0 fail** (baseline 3265; +7 new arms), 48 500+ asserts, exit 0 |
| `bun test packages/mpd-team-core-plugin` | **552 pass / 0 fail** |
| `bun run typecheck` (`tsgo --noEmit`) | **0 errors**, exit 0 |
| `bun run verify:comments` | **VERDICT: PASS**, exit 0 |
| `tool-surface.test.ts` + `cross-package-coupling-inventory.test.ts` | 8 pass / 0 fail — the surface budget is unchanged (no verb, no description sentence) and the inventory is still `{unfrozen:[], stale:[]}` |

## 5. The new arms and how each is falsifiable

`test/stage.test.ts` (7 arms):
1. **ORDER** — a record with one `in_progress` row AND one blocked row classifies `person:blocked` and
   explicitly NOT `working`; reordering the table reddens it.
2. **Ranking** — failed beats review beats blocker beats in-flight (all four present → `person:failed`).
3. **Review** — `verdict:"changes"` → `person:review`; `verdict:"pass"` → `person:delivery` (the negative
   control that stops every completed review from counting as a person stage).
4. **delivery / working / ended** — a finished board is `person:delivery`, an in-flight one with ready work
   behind it is `working:queued`, one without is `working`, and an `endedAt` record is `ended` (so a
   finished board is never re-framed as awaiting acceptance after the team was closed).
5. **answer** — a stopped seat carrying a handoff is `person:answer`.
6. **TOTALITY** — `teamStage({} as TeamRecord)` answers `idle` instead of throwing.
7. **FENCED SEAT** — `idleMembers` excludes it (the arm asserts the excluded name list), and the web
   payload renders `fenced`.

REMOVING THE DERIVATION REDDENS: arms 1 and 4 assert the stage AGAINST `derivePhase`'s word (a live,
blocked team is `active` by phase but `person:blocked` by stage), and arm 7 asserts the exclusion — drop the
`fenced` guard or reorder the table and at least one of those arms goes red.

## 6. Could NOT prove

1. No live boot / no dist rebuild (out of scope), so the TUI scene and the browser panel are proved through
   their projections (`teamStage`, the service pair, the web payload builder), not through a rendered UI.
2. `cellwork_supervise` is unchanged (declared above), so its per-member line still shows the pre-stage
   vocabulary.
3. `person(answer)` reads only `handoff` presence: a handoff that carries no question still classifies as
   `answer` — the record has no field that distinguishes them, and inventing one would be a persisted truth.
