# KICK arm handoff — the row text for `skills/dsh-qa/scripts/watchdog-redesign.mjs` (lane D)

**Why this file exists (plan D-3):** the permanent RED→GREEN driver is
`skills/dsh-qa/scripts/watchdog-redesign.mjs`, which lives in the single-`skills/**`-writer tree
(lane D). Lane C may not edit it, so lane C ships its own instruments (see
`test/lane-c-wave2.test.ts` + `lane-c-live.mjs`, both under `test/**`/this evidence dir) and freezes
the missing row HERE, so lane D can land it without re-deriving the contract. Frozen 2026-09-17 by
`watchdog-engineer` (t10, attempt 2).

## The row to add (frozen text, verbatim)

Row id: **`kick`** (the next free row letter after (a)–(f); the wave-1 driver's own rows are (a)–(f)).

**Subject:** a HOLD stops NEW DELIVERY only — a kick is ANSWERED with a NAMED decline, claim/update
still succeed, and the SAME kick delivers after the release.

**Fixture (one sandbox workspace, one probe team):**

| element | value |
|---|---|
| state root | `<workspace>/.mpd/team` |
| team | `probe-team`, `phase: "running"`, `captainSessionId` = the live captain stub id, `createdAt`/`approvedAt` 60 s ago, `taskSeq` = 2 |
| member | `Architect` (`id` = the live member stub session id, `status: "idle"`, `joinedAt` set — `isTeamState` validates it) |
| tasks | `t1 {status:"pending", assignee:"Architect", attempt:0}` · `t2 {status:"in_progress", assignee:"Lead", attemptId:"att-t2", attempt:1}` |
| hold | the REAL sidecar + registry: `applyHold(workspace, ".mpd/team", {team_id:"probe-team", cause:"silence", ttl_ms:0}, registry)` |
| mount | `installTeamScheduler(ctx, {stateDir})` from `lib/scheduler.js`, with `ctx.get('mpdWatchdog')` bridged to the real `HoldRegistry`; deliveries counted on `ctx.subagents.prompt`; declines captured from `ctx.logger.warn` |

**The four readings (all in ONE process, same fixture):**

1. **while held** — `kickMember(workspace, "probe-team", "Architect", captain)` → the delivery seam
   records **0** prompts, and the warning names the hold: `the team is held by the team watchdog
   (hold <holdId> since <ISO> : <cause>)`. This warning IS the caller's answer: the decline is named,
   never silent.
2. **while held** — the REAL `agent_teams_claim_task` on `t1` and `agent_teams_update_task` on `t2`
   (terminal payload: `acceptanceResults` + `commandsRun` present) **SUCCEED**; `team.json` moves,
   the hold record is byte-unchanged. (Wave-1's `holdReadsFromTools === 0` pin survives.)
3. **after `session-watchdog-resume`** — the SAME `kickMember` call delivers exactly **1** prompt
   (`Task: t1` in the text).
4. **the refused kick writes nothing** — `team.json` is byte-identical across reading 1.

**RED legs (negative controls) — each must redden its own half:**

* **kick** — a scratch copy of `lib/` with the hold read neutered
  (`if (view === undefined || view === null || view.held !== true)` → `if (true)`) delivers **1**
  while held. (The RED baseline `.mpd/red-baseline` CANNOT serve here: it already contains
  `watchdogHoldOf` and the three decline sites — measured 4 hits.)
* **claim/update** — the wave-1 re-injection literal (the deleted pre-redesign guard spliced at
  `agent_teams_update_task`'s `async execute(args, exec) {`) makes the same call **throw**
  `held by the team watchdog`.

**Expected row verdict:** RED = the two controls; GREEN = the four readings; row exits 0 only when
both directions are observed.

## Reference implementation (already green, in-repo)

`packages/mpd-team-watchdog-plugin/test/lane-c-wave2.test.ts` — describe
`"T-48 — the KICK reading (frozen D-2)…"`, three tests. Read it as the executable form of this
handoff; the driver row should re-use its fixture shape.

## What the driver row must NOT do

* Do not call `session-watchdog-hold`/`-resume` as if they were the adopted tools: they are the
  watchdog's own registered tools (registered on the ADAPTER), not `agent_teams_*`.
* Do not assert a tool-schema change: all three watchdog tools stay registered
  (`test/holds-lifecycle.test.ts` pins the list) and both halves of the reading above depend on that.
* Do not carry the register's §8.4 sentence "never decline … claim_task/update_task/kick": the FROZEN
  reading (captain D-2) is *a hold stops NEW delivery while claim/update succeed and a kick is
  ANSWERED with a named decline* — the kick IS declined, by design, with a reason.
