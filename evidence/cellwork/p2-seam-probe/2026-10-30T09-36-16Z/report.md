# P2 seam probe — every seam the DRAFT contract names, measured

**Artifact:** `evidence/cellwork/p2-seam-probe/2026-10-30T09-36-16Z/`
**Sampled:** 2026-10-30T09:36Z (commands and observed output in `output.log`).
**Lane:** dispatch-engine (P2 writer).
**Why this exists:** the DRAFT contract `.mpd/plans/cellwork-remediation-p2.md` freezes only "after P1
lands and the live seam probe passes". This is that probe. **No source file was edited.**

## 0. State the probe found

- `.mpd/plans/cellwork-remediation-p2.md` is **PRESENT and marked DRAFT** (it did not exist at
  2026-10-30T09:34Z, appeared by 09:35Z).
- **P1 has zero commits**: `HEAD == fix/cellwork-resume == origin/dev == 863c2c32`.
- The shared tree carries **four tracked P1-docs modifications** (`docs/cellwork.md`,
  `docs/cellwork.zh-CN.md`, `packages/mpd-cellwork-plugin/README.md`, `README.zh-CN.md` — the resumable
  activation text). No P1 source edit is present yet.
- Therefore P2 cannot start writing without colliding with P1 in `protocol.ts`, `state.ts`, `flow.ts`,
  `activate.ts` and the same four docs files. The writer is ready and blocked on the freeze + a clean
  tree, not on design.

## 1. Seam verdicts (each claim in the draft, checked)

| # | Draft claim | Verdict | Evidence |
|---|---|---|---|
| 1 | `mpdTeams.subscribe(workspace, listener)` exists, payload-free, 50 ms change feed | **VERIFIED** | `packages/mpd-team-core-plugin/src/index.ts` :: `MpdTeamsService.subscribe` and its `feed.subscribe` implementation; `change-feed.ts` :: `ChangeFeed` (`debounceMs ?? 50`, `subscribe` returns a disposer, listener takes no payload) |
| 2 | `writeTeam` is the record write path the feed observes | **VERIFIED** | `mpd-team-core-plugin/src/index.ts` imports and calls `writeTeam` on every board/roster mutation |
| 3 | `submitUserTurn(agent, msg)` starts a turn and returns a boolean | **VERIFIED** | `mpd-dsh-adapter-plugin/src/index.ts` :: `submitUserTurn` — returns `false` when `followup` is absent, swallows a rejected submission |
| 4 | `injectAgentMessage` queues and throws when the agent is absent | **VERIFIED** | same file :: `injectAgentMessage` — throws when the agent has no `inject()` |
| 5 | `liveAgent(agentId)` is total | **VERIFIED** | `liveAgent` returns `undefined` (registry `get`, then list scan); never throws |
| 6 | `TeamExecutor.send(caller, handle, content)` authorises by the caller object | **VERIFIED** | native backend forwards `caller` verbatim to `subagents.sendMessage.call(subagents, caller, handle, …)` (adjacency-checked: direct child / direct parent) |
| 7 | `readActiveCell` + `subcellIds` give the cell tree | **VERIFIED** | `state.ts` :: `readActiveCell`, `CellState.subcellIds` |
| 8 | `cell.activatedTasks`, `cell.cancelledTasks` | **VERIFIED** | `state.ts` (the dispatch pass already reads both) |
| 9 | `cell.activatedLoops` | **P1's addition, ABSENT today** — as expected (P1 contract A1) | `state.ts` has no such field yet |
| 10 | `CellMemberMode` / `CELL_MEMBER_MODES` / `CellSeatMode` exist and gain `"dispatcher"` | **VERIFIED the change is real** | `state.ts` :: the four current modes; `guard.ts` :: `CellSeatMode` with five |
| 11 | `seatIn` resolves a seat in the cell tree | **VERIFIED** | `caller.ts` :: `seatIn(cell, workspace, sessionId, deps)` |
| 12 | `staging.ts` stages the planning team (two members) | **VERIFIED** | `staging.ts` :: `PLANNER_MEMBER`, `SPLITTER_MEMBER`, `stagePlanningTeam` |
| 13 | A `DispatchLedger` exists to extend | **FALSE — it is NEW** (the draft says so; recorded so no one looks for one) | `dispatch.ts` has zero ledger identifiers |
| 14 | `cellwork_dispatch` takes no arguments today | **VERIFIED** | `protocol.ts` :: `parameters: { type: "object", properties: {}, additionalProperties: false }` |
| 15 | `cellwork_supervise` takes no arguments today | **VERIFIED** | same shape |

**Net: every seam the draft names is real.** The P2 design stands on measured ground; the delivery
authority is the one borrowed premise, and it is already declared as a bound (§7.1 of the draft).

## 2. Flags for the freeze (small, but they change the contract text)

- **F1 — a third tool-schema change is missing from §6.** §3.1 says the manual pass keeps "a `force`
  flag to ignore the ledger". `cellwork_dispatch` takes NO arguments today, so a `force` INPUT is a
  tool-schema change; §6's mounted-boot list names only `cellwork_supervise detail` and
  `cellwork_dispatcher_gate`. Decide: `force` is an internal parameter of `dispatchOwnerOnly` (no schema
  change) or a third input (add it to the mounted-boot proof list).
- **F2 — the busy predicate for "inject vs submitUserTurn" is unnamed.** The board's own truth is
  `memberIsBusy` (`claimed`/`in_progress` on the team record); `liveAgent(...).status` is the host's
  uninterpreted string. They can disagree (a member that finished its turn but has not closed its row, or
  vice versa). The contract should name ONE predicate; my recommendation is the BOARD (`memberIsBusy`),
  because it is the cell's recorded truth and it is already the dispatch rule.
- **F3 — no stated degradation for an absent feed.** `ctx.get("mpdTeams", false)` can be undefined, and
  `mpdTeams.subscribe` itself swallows an internal failure into a no-op disposer
  (`try { return feed.subscribe(…) } catch { return (): void => {} }`). An auto engine that never
  receives a notification looks identical to a cell with no ready work. The contract needs one line: an
  absent service (or a subscription that could not be established) journals `auto-dispatch-unavailable`
  once and leaves the manual `cellwork_dispatch` path — the same shape as the `mpd_verify_*` degrade
  rule.
- **F4 — the additive-state rule from P1 must be repeated.** The draft adds `dispatcherGate` (and
  `mode:"dispatcher"`). P1's A1 is explicit: do NOT bump `CELLWORK_STATE_VERSION`, and `readCell` must
  tolerate a record without the new field. The draft does not say it; without that line a state bump
  would lock out every existing cell (and VEdit's wedged one).
- **F5 — member prompts do not live in `prompts.ts`.** `prompts.ts` holds ONLY `CELLWORK_USAGE`; the
  planner and splitter prompts are inline in `staging.ts`. Adding `dispatcherPrompt` to `prompts.ts` is a
  new precedent — either follow `staging.ts` or say that member prompts move to `prompts.ts` in this
  phase (the latter is a bigger diff and touches P1-overlapping files).
- **F6 — the explicit "run once after start / after activate" hooks are redundant and costly.** Both
  `cellwork_start`'s staging and a successful `cellwork_activate` write the team record, so the feed
  fires by itself. Adding hooks edits P1-owned `flow.ts`/`activate.ts` (merge-conflict surface) for no
  new behaviour. Recommendation: drop them from §3.2, keep the feed as the only bell, and if a
  belt-and-braces initial pass is wanted put it in the new module (`auto-dispatch.ts`) behind the same
  `subscribe` seam.

## 3. Readiness statement

I have not written a source line: the contract is DRAFT, P1 owns overlapping files and the four docs
files are dirty in the shared tree. On a freeze + a clean/landed P1, my first slice is the pure half that
touches no P1 file: `dispatch.ts` :: `planDispatch` extraction + the `test/auto-dispatch.test.ts`
decision matrix (contract §3.1/§4, first bullet). The engine, the dispatcher seat and the tool-schema
changes follow once P1's protocol.ts/state.ts edits are in.

## 4. Evidence index

- `output.log` — every command with its observed output (git refs, tree state, seam greps).
- `result.json` — the machine-readable verdict table and flags.
- P2 draft contract: `.mpd/plans/cellwork-remediation-p2.md`.
- Prior recon (pre-contract): `evidence/cellwork/p2-recon/2026-10-30T09-34-08Z/report.md`.
