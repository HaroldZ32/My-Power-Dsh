# Cellwork remediation — P2 readiness recon (programmatic auto-dispatch)

**Artifact:** `evidence/cellwork/p2-recon/2026-10-30T09-34-08Z/report.md`
**When:** 2026-10-30T09:34Z (sampled; see `result.json` for the exact read).
**Lane:** dispatch-engine (P2 owner).
**Contract status: ABSENT.** `.mpd/plans/cellwork-remediation-p2.md` does not exist yet, and P1 has
ZERO commits: `HEAD == fix/cellwork-resume == origin/dev == 863c2c32`, tracked tree clean. P1's four
rows (`T1`-`T4`) are on the team board; only `T1` is in progress. **No source file was edited by this
recon.** This document measures the seam the P2 contract will stand on and returns ONE decision fork.

---

## 1. What exists today (measured from the tree, not remembered)

- **Dispatch is captain-only and manual.** `packages/mpd-cellwork-plugin/src/protocol.ts` ::
  `cellwork_dispatch` (`registerTool` → `dispatchOwnerOnly` with `exec.agent` as the authorizing
  caller). `docs/cellwork.md` tool table: "`cellwork_dispatch` | captain | one owner-only dispatch
  pass over the team board".
- **Activation dispatches exactly once.** `packages/mpd-cellwork-plugin/src/activate.ts` step 5 calls
  `dispatchOwnerOnly`; after that, every later wake-up is the captain's own loop —
  `docs/cellwork.md` ("The captain supervises on every wake-up") and
  `.mpd/plans/cellwork.md` §4.4 ("The captain supervises on every wake-up (task completion,
  checkpoint, requirement change)").
- **The pairing decision is already pure and reusable.** `packages/mpd-cellwork-plugin/src/dispatch.ts`
  :: `dispatchOwnerOnly(deps)` takes a record view, a `send` closure and `now`, pairs at most one task
  per member per pass, never substitutes an owner, and returns `{pairs, skipped, refused?}`. Delivery
  is the caller's: `sendThroughExecutor(dsh.teamExecutor(), captainAgent)`.
- **The plugin ALREADY subscribes to `agent/turn-stopping`.** `protocol.ts` installs the compaction
  barrier on that edge: a serial dispatch (`payload.agent`), detached work via `void runBarrier(...)`,
  `transition`/`appendJournal` after a re-read, and a per-member `inFlight` key so one turn cannot
  start two barriers. The same edge can host an auto-dispatch pass; the containment pattern is
  already in this file.
- **The adapter seams the pass needs are all present.** `packages/mpd-dsh-adapter-plugin/src/index.ts`:
  `DshAdapter.onEvent(event, handler)` forwards to `ctx.on` and returns a disposer **or `undefined`**
  (a composition with no event bus is a stated absence, not a crash); `liveAgents()` / `liveAgent(id)`
  read the host's live-session registry, keyed by "the shared session/agent id"; `DshTeamExecutor.send
  (caller, handle, content)` delivers and cold-resumes an absent child on the native backend.
- **The cell record already carries the identity the pass needs.** `CellState.captainSessionId`,
  `CellState.teamId`, `CellState.members[*].sessionId` / `executorRef` and `CellState.cancelledTasks`
  are written by the command/activation today.

## 2. The binding constraint — the one decision the contract must record

**The harness delivery seam is adjacency-checked: `subagents.sendMessage(caller, handle, …)` authorizes
only a DIRECT CHILD or the DIRECT PARENT.** This repository's own memory store records the measurement
(`.mpd/memory/agents/agent-my-power-dsh/repo/memory/reflection-mvurvx5k.md`: "the transport is the
harness `subagents.sendMessage`, which is adjacency-checked (direct child / direct parent) … member→sibling
wake is not merely un-implemented — it is ILLEGAL on the native default backend without a Lead-identity
relay"), and the adapter's native `send` forwards the caller verbatim to that seam
(`nativeTeamExecutor().send` → `subagents.sendMessage.call(subagents, caller, handle, …)`).

Consequences, in order:

1. **A "dispatcher" AGENT that is a SIBLING of the workers cannot dispatch them.** It cannot wake a
   member at all; it could only append durable mail, and the captain would have to relay — strictly
   worse than today. An exception-only dispatcher implemented as a NEW teammate is therefore not
   implementable on the native backend without re-parenting every worker under it (a sub-cell
   topology, which changes the split graph and the verification law's writer/verifier seating).
2. **The only legal authorizing sender for a member is its direct parent — the captain's live agent.**
   So a PROGRAMMATIC pass must resolve `dsh.liveAgent(cell.captainSessionId)` and deliver under it.
   A fabricated session id is exactly the P1 defect (`producerSessionId`/`producerAgent` fabricating
   `cellwork:<cellId>`); P2 must not reintroduce it in another form.
3. **When the captain's agent is not live, a pass can pair tasks but cannot deliver them.** That must be
   a journaled, reported skip (`captain-not-live`), never a throw and never a silent success.

**The fork (captain's to decide, then freeze):**

| Option | Shape | Verdict from the measurements |
|---|---|---|
| **A (recommended)** | Programmatic listener in `mpd-cellwork-plugin` on `agent/turn-stopping` (member match) + the existing activation pass; delivery under the captain's LIVE agent; exceptions surfaced durably (cell mail) and injected once when the captain is live | Legal on the native backend, zero model cost, unit-testable offline, reuses `dispatchOwnerOnly` and the containment pattern already in `protocol.ts` |
| B | A new dispatcher teammate that runs the loop and messages the captain on exceptions | **Refused by the seam** (sibling→sibling wake is illegal); would need a re-parented sub-cell topology, a split-schema change and a new role |
| C | Run the pass in the captain's `agent/pre-step` (like the checkpoint) | Legal but useless for the goal: it still needs a captain TURN, so it does not remove the captain's routine work |

## 3. Proposed contract skeleton (a proposal — the captain freezes the contract)

**R1 — trigger.** One detached dispatch pass per cell on: (a) `cellwork_activate` (already), (b) a
member's `agent/turn-stopping` whose `session.id` resolves to a member of the active cell. Coalesce per
cell: an in-flight map keyed by `cellId` (the barrier's `inFlight` pattern) absorbs concurrent edges
rather than queueing them. Never on a `stopped`/archived cell; never when `teamId` is empty.

**R2 — delivery identity.** Resolve the captain's live agent per pass via
`dsh.liveAgent(cell.captainSessionId)`; when absent, journal `dispatch-auto-skipped` with reason
`captain-not-live` and return without throwing. When the executor seam is absent, the same skip with
reason `no-executor`.

**R3 — exception classification (the core of "exception-only").** Routine skips are journaled and go
nowhere else: owner busy, owner already paired this pass, blockers unmet, row cancelled, no ready task.
EXCEPTIONS produce exactly ONE durable cell-mail row to the captain, deduped by `(taskId, reasonClass)`:
owner not on the roster, owner FAILED, owner has no executor handle, the message was refused by the
transport. The contract must ALSO decide whether these non-dispatch exceptions are in P2's scope:
a recorded verifier FAIL / repair task, a finalized requirements revision whose split is now stale, and
an accepted split awaiting `cellwork_activate` (activation stays captain-only by design).

**R4 — journal + observability.** Every automatic pass appends one `dispatch-auto` row
(`trigger`, `pairs`, `skipped`, `exceptions`, `captainLive`); a skip appends `dispatch-auto-skipped`
(`reason`). `cellwork_supervise` should gain no new field unless the contract asks (supervise is
captain-only and read-only; its lossless projection is P1's subject).

**R5 — surface.** No new tool and no tool-schema change. `cellwork_dispatch` stays as the manual
override. Decision for the contract: whether a config knob (`autoDispatch`) exists at all. My
recommendation is NO knob — the behaviour is on exactly when a cell is active and a live captain
exists, and the journal makes it auditable.

**R6 — tests.** The current fake harness (`packages/mpd-cellwork-plugin/test/cellwork.test.ts` ::
`makeHarness`) has **no event bus**, **no `subagents` service** and a live registry holding **only the
captain**. P2's arms must extend it with (i) an `on(event, handler)` capture in the fake ctx,
(ii) a fake `subagents` service exposing `startActivation`/`startContinuable` (the native executor's
`ready` probe) and `sendMessage`, (iii) member agents in `agents.list` whose `session.id` matches the
cell record. Arms: member turn-stop → one pass and one delivery; non-member turn-stop → nothing; stopped
cell → nothing; captain not live → journaled skip, no throw, no delivery; two concurrent edges → one
pass; an owner-failed row → exactly one durable exception mail; the listener returns `undefined`
synchronously (the serial-dispatch contract).

**R7 — docs.** Bilingual pairs in the same commit: `packages/mpd-cellwork-plugin/README.md` +
`README.zh-CN.md`, `docs/cellwork.md` + `docs/cellwork.zh-CN.md` (the captain's loop sentence changes:
"supervises on every wake-up" becomes "wakes only for exceptions"). `bun run verify:docs`.

## 4. Gates P2 will owe (from AGENTS.md §4, narrowed to this change)

`bun test packages/mpd-cellwork-plugin` · `bun run typecheck` · `bun run verify:comments` ·
`bun run verify:docs` · `node scripts/verify-dist-fresh.ts` **after** rebuilding
`packages/mpd-cellwork-plugin/dist/index.js` with the PINNED `.toolchain/node_modules/.bin/bun` 1.4.0 ·
`node scripts/verify-pack-closure.ts` only if the pack is refreshed · `bun run verify:rows` /
`preset-conformance` only if a row/config changes (none planned).

## 5. What I could NOT measure (bounds to carry into the contract)

1. **Whether the host wakes the captain on every member child completion.** This repository's memory
   says a release "wakes the parent's own settlement", but the exact harness edge (and whether a plugin
   can suppress it) was NOT measured here. If the captain is woken anyway, P2 removes the captain's
   WORK (dispatch + supervise), not the WAKE. The contract must not claim the wake is gone without a
   live measurement; a live `/cellwork` run is the P2 QA case (P1's declared bound 3 hands it to P2).
2. **The official-executor fallback's adjacency rules** are not measured here; the native backend is the
   default this bundle ships.
3. **No live-LLM activation was run** by this recon (none was possible: P1 is not landed and the cell
   dir `.mpd/cellwork/` does not exist in this workspace).
4. **The exact member→captain wake policy** in `cellwork_send` is a policy ladder the P3 lane will
   revisit; P2 must not rely on it for delivery.

## 6. Evidence index

- This report: `evidence/cellwork/p2-recon/2026-10-30T09-34-08Z/report.md`
- Machine-readable summary: `evidence/cellwork/p2-recon/2026-10-30T09-34-08Z/result.json`
- Contract proposals previously frozen: `.mpd/plans/cellwork-remediation-p1.md` (P1, frozen by the
  captain), `.mpd/plans/team-board-settlement.md` (the turn-stopping precedent).
