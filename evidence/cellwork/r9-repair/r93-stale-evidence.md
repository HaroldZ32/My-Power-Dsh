# R9.3 — CodeRabbit round 2, "the stop-path cancel loop can hang `cellwork_stop`" — VERDICT: STALE (no change)

Date: 2026-11-10. Contract: `.mpd/plans/cellwork-coderabbit-round2.md` §R9.3.
Subject: `packages/mpd-cellwork-plugin/src/consults.ts:654-666` (`clearCellConsults`, the loop
`cellwork_stop` awaits) and the `mpdConsults.cancel` seam it calls.

## What the finding claims

The loop awaits `service.cancel(consultId)` per consult IN SEQUENCE, and `cellwork_stop` awaits the hook
before archiving, so a hung cancel would block the stop.

## Why it is STALE

The seam is SYNCHRONOUS end to end, and it never awaits a child. Each hop:

1. **Caller** — `packages/mpd-cellwork-plugin/src/consults.ts:661`
   `await Promise.resolve(service.cancel(consultId))`. The declared seam type is
   `cancel?: (consultId: string) => unknown` (`consults.ts:79`); `Promise.resolve()` of a non-thenable
   yields one microtask and cannot hang.

2. **Service facade** — `packages/mpd-roles-plugin/src/consults.ts:201`
   `cancel: (consultId: string): ConsultView => deps.supervisor.cancel(consultId)`. The return type is
   `ConsultView`, NOT a promise: the service cannot await anything on this path.

3. **Supervisor** — `packages/mpd-roles-plugin/src/spawn-async.ts:235` declares
   `cancel(consultId: string): ConsultOutcome`; the body at `:805-833` is: a `Map` lookup
   (`requireRecord`), a state assignment, `clearTimer(...)` (synchronous `clearTimeout`), a
   try/catch-wrapped `record.handle?.interrupt()`, then `finish(...)`. There is NO `await` in the
   function. `finish` (`:427-446`) clears a timer, releases a slot, calls `record.resolve(...)` (a
   Promise resolve — scheduling, not blocking) and `notifySettled(...)` in a try/catch.

4. **Handle interrupt** — `packages/mpd-dsh-adapter-plugin/src/index.ts:501` declares
   `interrupt(): void`; the implementation at `:3812-3845` calls `subagents.interrupt.call(...)`
   synchronously and, when the host answers a THENABLE, attaches `void Promise.resolve(outcome).catch(abortRaw)`
   and RETURNS — it never awaits it. With the seam absent or refusing, it calls `raw.abort()` in a
   try/catch and returns. So `interrupt()` is immediate and cannot block the loop.

5. **The one observer on the settle path** — `notifySettled` (`spawn-async.ts:419-427`) calls
   `record.onSettled` inside try/catch. Cellwork's observer
   (`packages/mpd-cellwork-plugin/src/consults.ts:447-463`) is explicitly FIRE-AND-FORGET
   (`void recordConsultRow(...)`, comment "the supervisor's settlement path … must not await a disk
   write"), so even its row write is not awaited. The only synchronous work it can do is the
   `appendJournal` of a late settlement (`:454`), a bounded local file append — not a wait on the child.

A hung CHILD cannot hang this loop: `cancel` marks the record `interrupted`, clears the deadman timer,
fires a best-effort interrupt and settles the record locally; it never waits for the child to exit.

## Bound (honest)

If a HOST implementation of `subagents.interrupt` itself blocked synchronously, the adapter would block
before this loop too; that is a host defect, not the awaited-cancel hazard the finding names. Nothing in
this bundle awaits a consult cancel, so no timeout/bound is added and NO source file changed for R9.3.

## Evidence commands

- `grep -n "cancel" packages/mpd-roles-plugin/src/spawn-async.ts` (signature at :235, body at :805)
- `sed -n 800,835p packages/mpd-roles-plugin/src/spawn-async.ts` (no `await` in the body)
- `sed -n 3805,3850p packages/mpd-dsh-adapter-plugin/src/index.ts` (`interrupt(): void`, `.catch` attached, not awaited)
- `sed -n 650,667p packages/mpd-cellwork-plugin/src/consults.ts` (the loop, unchanged)
