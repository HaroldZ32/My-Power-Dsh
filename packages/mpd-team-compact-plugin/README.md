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

- **Trigger** — a team whose EVERY task is terminal AND whose members are ALL idle. 0.1.7: the
  retired `.mpd/team/<teamId>/team.json` is gone, and the OFFICIAL Agent Teams service exposes no
  "finished team" predicate either, so the trigger is DERIVED from BOTH halves of its live readout —
  every task terminal (`teamListTasks`) AND no member active (`teamListMembers`). The terminal
  vocabulary is mirrored in `src/index.ts` (`TERMINAL_TASK_STATUSES`, official
  `TeamTaskStatus = pending | in_progress | completed | deleted`) because the official package is not
  resolvable by a bare specifier from this repository (measured `MODULE_NOT_FOUND`).
- **Who** — members only. The captain is never compacted (that is the user's `/compact`).
- **Barrier** — wait for every member to go idle, then compact them together.
- **Method** — an unconditional explicit `compactNow`. A null answer means "no safely compactable
  range", which is recorded as a fact, not as an error.
- **Audit** — `<workspace>/.mpd/team-compact/<teamId>/`, accumulated and never overwritten. It is
  never `.mpd/team`: no harness team file lives there any more — the board is the harness's, in the
  Lead Session log, and this plugin only ever READS it through the adapter.
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
- The `parameters` schema is **object-rooted**. A `type: null` root was measured to make the provider
  reject every model request of a mounting session, which is why the unit test and the mount-level
  `TOOL_PARAM_SCHEMAS` probe both pin it.

## State

| Path | Notes |
|---|---|
| `<workspace>/.mpd/team-compact/<teamId>/` | the audit ledger: one record per CHANGED outcome, accumulated (identical repeats are counted in the next record's `suppressed`) |

## Gates

- `bun test packages/mpd-team-compact-plugin` — the offline unit suite (`test/compaction.test.mjs`).
- `bun run typecheck`.
- Boot check: the row must really APPLY (a mount proof, never `--dump-config` — AGENTS.md §4).

## Related

- Team mode from the user's side: [`../../docs/user-guide.md`](../../docs/user-guide.md) §6.
- The plugin that owns `.mpd/team`: [`../mpd-agent-teams-plugin/README.md`](../mpd-agent-teams-plugin/README.md).
