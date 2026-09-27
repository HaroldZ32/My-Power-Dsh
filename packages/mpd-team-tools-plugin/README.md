# mpd-team-tools-plugin

**English** | [中文](./README.zh-CN.md)

The **workflow** around the official Agent Teams runtime. Harness 0.1.7-rc.2's official plugin owns the
team itself — roster, shared board, mailbox, continuable teammates — and nothing else. The retired
vendored body also carried the review points a captain actually works with: a team staged as a plan the
user can read and approve *before* anybody exists, a task contract frozen at claim time, a halt, and an
archive. Those live here.

The roster and the board are **never** duplicated: they stay the official service's, read and written
through `mpd-dsh-adapter`. This plugin keeps only what the official service has no field for, under
`<workspace>/.mpd/team/`.

## Tools

| Tool | Inputs | Result |
|---|---|---|
| `agent_teams_create` | `name`, `description?`, `approval?`, `replace?` | stages a plan for this session; **nothing is created** |
| `agent_teams_add_member` | `name`, `prompt`, `description?`, `role?` | appends one teammate to the staged plan |
| `agent_teams_create_task` | `subject`, `description`, `blocked_by?`, `write_scopes?`, `owner?` | appends one shared task to the staged plan |
| `agent_teams_edit_plan` | `members?`, `tasks?`, `description?` | reads the plan back, or replaces its lists atomically |
| `agent_teams_approve` | `dry_run?` | **executes** it: spawns every member through `spawn_teammate`, posts every task to the official board, assigns owners |
| `agent_teams_delete` | — | archive-first: moves the plan to `.mpd/team/archive/<planId>/` |
| `agent_teams_claim_task` | `task_id`, `claimant?` | claims on the official board **and** freezes the contract with a monotonic `attempt` |
| `agent_teams_task_contract` | `task_id?` | one frozen contract, or every contract newest-claim-first |
| `agent_teams_halt` | `reason` | records a hold: new dispatch stops, the team and its members stay alive |
| `agent_teams_resume` | — | clears the hold |
| `agent_teams_dispatch` | `dry_run?`, `limit?` | **pairs ready tasks with idle members** and tells each member to work its task; one pass, recorded |
| `agent_teams_dispatch_release` | `task_id` | frees a dispatched task so it can be dispatched again |
| `agent_teams_mailbox` | `watch?` | how many messages are WAITING for this agent, from the harness's own inbox events |
| `agent_teams_status` | — | the staged plan and the halt **beside** the official roster and board |

`/agent-teams <what the team is for>` stages a plan from the current goal.

## Semantics

- **A plan is a review point, not a queue.** `agent_teams_create` writes a plan and returns; the only
  thing that creates a teammate is `agent_teams_approve`. `dry_run: true` reports exactly what approval
  would do without doing it.
- **One staged plan per session.** Staging again replaces the unapproved plan (the previous one is
  archived); replacing an *approved* plan needs `replace: true`, because that is a deliberate act.
- **Approval is transactional in its reporting, not in its effects.** Members spawn first, then tasks
  post, with `blocked_by` resolved from planned subjects to posted task ids and `owner` resolved from
  staged member names to spawned ids. A failure stops the sequence and names where — earlier work is
  kept and reported, never rolled back, because a spawned teammate cannot be un-spawned.
- **A contract is what a task MEANT when it was claimed.** `attempt` is monotonic per task and is the
  only place "the Nth attempt at t4" is answerable: the official board's `revision` moves for every
  mutation, so it cannot stand in for an attempt.
- **A halt is not an ending.** It records a hold; no member is interrupted and nothing is archived.
- **The mailbox count is the harness's own arithmetic, not an estimate.** The agent inbox emits
  `agent/inbox/inserted` when a message enters, `agent/inbox/claimed` when the loop takes it and
  `agent/inbox/discarded` when it is dropped — all three dispatched through the AGENT's scope carrier
  (their `dsh-scope` subject resolver is `args[0]["agent"]`). `inserted − claimed − discarded` is
  therefore "waiting, not yet taken", subscribed through the adapter's per-agent seam. `watch: true`
  attaches the counter to the calling agent (idempotent); the count clamps at zero, because a session
  that was already running when the counter attached may have taken messages this observer never saw.
- **Everything is workspace-scoped** through `dsh.workspaceRoot(exec)`, never the process cwd.

## Configuration

None. The plugin declares `tools` and `commands` and resolves both through the adapter.

## Known limits

- The hold **stops dispatch** (`agent_teams_dispatch` refuses the whole pass and names the reason) and
  does nothing else: no member is interrupted and no task is rewritten.
- `agent_teams_dispatch` pairs ONE task with ONE member per pass and records the pairing in
  `.mpd/team/dispatch.json`, so a second pass cannot hand the same task to a second teammate — a
  message is not a ledger. Entries for tasks that were deleted or completed out of band are pruned
  first, so a member is never left "busy" forever. It runs when a captain or a lane calls it; it is
  not a background timer.
- `agent_teams_approve` cannot be rolled back.
- The mailbox has no unread count: the official inbox exposes no read state, and inventing one would
  misreport it.
