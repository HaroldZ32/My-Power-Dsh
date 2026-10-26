# mpd-team-compact-plugin

**English** | [中文](./README.zh-CN.md)

Compaction for **finished teams**: when every task of a team is terminal and every member is idle,
`mpd_team_compact_run` compacts the members' context once, together, and records what happened.
It exists so an archived team stops carrying weight — the captain decides, the members are the ones
compacted.

## Tools

| Tool | Inputs | Result |
|---|---|---|
| `mpd_team_compact_run` | `team_id?`, `force?` — defaults to every finished team in this workspace | one audit pass per team: the team outcome plus each member's outcome. A record is written only when the outcome CHANGES; `force: true` overrides |
| `mpd_team_compact_status` | `team_id?` — defaults to every team with an audit | read-only: the recorded passes (newest last), including skipped members and the reason each was skipped |

## Semantics

- **Trigger** — a team whose EVERY task is terminal AND whose members are ALL idle. The team is
  read from the **MPD TEAM RECORD** first (`mpdTeams.list(workspace)`, `.mpd/team/teams/<id>.json`
  — the AUTHORITATIVE plane, and the only one a composition on the DEFAULT native executor has),
  with the OFFICIAL Agent Teams readout (`dsh.teamLiveTeams()`) as the fallback. Neither plane
  exposes a "finished team" predicate, so the trigger is DERIVED from BOTH halves — every task
  terminal AND no member active (`teamListTasks` / `teamListMembers` on the official plane). The set
  the pass treats as terminal is `TERMINAL_TASK_STATUSES` in `src/index.ts`: **completed, deleted,
  failed, cancelled**. The harness's own union is `TeamTaskStatus = pending | in_progress | completed
  | deleted`, and its terminal half is `completed` + `deleted`; `deleted` is in the set because
  `listTasks` hides deleted rows, so a board the service reports as all-completed is terminal with or
  without it. `failed` and `cancelled` are NOT in that union — they are tolerated so that a harness
  release adding a terminal status can never make this module's destructive pass fire on unfinished
  work. The set is mirrored HERE because the official package is not resolvable by a bare specifier
  from this repository (measured `MODULE_NOT_FOUND`).
- **Who** — members only. The captain is never compacted (that is the user's `/compact`).
- **Barrier** — wait for every member to go idle, then compact them together.
- **Method** — an unconditional explicit `compactNow` driven with a REAL `AbortSignal`: one
  `AbortController` per drive, combined (through `AbortSignal.any`) with the pass's own optional
  `signal` when a caller supplied one. `undefined` is never passed, because the engine's first
  statement is `signal.throwIfAborted()`; the pre-fix call crashed there as a raw `TypeError` before
  any compaction ran. A null answer means "no safely compactable range", which is recorded as a fact,
  not as an error.
- **Cancellation** — an aborted signal is a cancellation, not a failure: that member is recorded
  `failed` with the engine's own `cancelled` code — never as an unclassified failure and never as a
  `TypeError`. The other classifications are unchanged: the six `ManualCompactionError` codes
  (`busy`, `cancelled`, `changed`, `summary`, `commit`, `persistence`) and the Cordis lifecycle
  error class read exactly as before, and an unrecognised error stays unclassified (no invented
  code).
- **Audit** — `<workspace>/.mpd/team-compact/<teamId>/`, accumulated and never overwritten. It is
  never `.mpd/team`: this plugin only ever READS a team — the record through the `mpdTeams` service,
  the official plane through the adapter — and writes nothing but its own audits.
- **Silence** — audit only. A member is never notified; a notification would push context back in.
- **Triggers** — TWO, and only one of them can reach a member. (1) `agent/status`, the harness's own
  status edge, which re-checks every finished team but fires when a released member is already gone;
  (2) the member's own turn boundary (`agent/turn-stopping`, the edge the team watchdog stamps
  `turn-end` from), which is the only moment a continuable child is still resident — its Activation
  is process-local and released on settlement. Measured 2026-09-16: 235 status-edge passes produced
  2260 `skipped-not-live` member entries and ZERO successes, which is why (2) exists. A member that
  has already been released is recorded as `skipped-not-live`: reaching it would mean materializing
  it, and that would push context back in.

## Design constraints (each one measured)

- **The engine is resolved PER MEMBER through the member's own scoped context**
  (`agent.ctx.get("compaction")`), in exactly one place: the adapter's `compactionEngineForAgent`.
  The host-plane engine is a DIFFERENT object serving a different realm, so driving a member with it
  would compact the wrong history.
- **`compaction` is deliberately NOT in `inject`.** The service is composed by the `mpd` preset, so a
  profile without that preset has none; a declared-but-unregistered service parks the row
  (`pending (waiting for service: compaction)`), which is the failure mode the contract forbids. It is
  resolved lazily at drive time and degrades with a warning.
- **`inject: ["tools"]` IS declared.** Cordis only exposes a service a context declared, and the
  adapter reads the tool registry off this row's context.
- A **staged member** (`id === ""`) has no live Agent and is skipped explicitly; a team whose captain
  is gone is recorded `not-live` rather than silently ignored.
- **`busy` is not the concurrency signal**: driving a busy member throws a Cordis lifecycle error
  (`tokenMeter` in an inactive context), classified separately from the six `ManualCompactionError`
  codes.
- **The drive signal is MANDATORY and real**: `compactNow`'s FIRST statement is
  `signal.throwIfAborted()`, so an `undefined` argument throws a `TypeError` before the engine does
  any work. Every drive therefore receives an `AbortController` signal, and the cancellation branch in
  `classifyCompactionError` is evaluated FIRST, so an aborted drive can never be filed as an
  unclassified failure.
- The `parameters` schema is **object-rooted**. A `type: null` root was measured to make the provider
  reject every model request of a mounting session, which is why the unit test and the mount-level
  `TOOL_PARAM_SCHEMAS` probe both pin it.

## State

| Path | Notes |
|---|---|
| `<workspace>/.mpd/team-compact/<teamId>/` | the audit ledger: one record per CHANGED outcome, accumulated (identical repeats are counted in the next record's `suppressed`) |

## Gates

- `bun test packages/mpd-team-compact-plugin` — the offline unit suite (`test/compaction.test.ts`).
- `bun run typecheck`.
- Boot check: the row must really APPLY (a mount proof, never `--dump-config` — AGENTS.md §4).

## Related

- Team mode from the user's side: [`../../docs/user-guide.md`](../../docs/user-guide.md) §6.
- The plugins that own the team plane: [`../mpd-team-core-plugin/README.md`](../mpd-team-core-plugin/README.md)
  (the team record, workflow and `mpdTeams` service) and
  [`../mpd-team-watchdog-plugin/README.md`](../mpd-team-watchdog-plugin/README.md) (stall detection).
  The retired vendored `mpd-agent-teams-plugin` that owned this state before them is DELETED.
