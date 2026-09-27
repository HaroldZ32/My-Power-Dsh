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
- **Everything is workspace-scoped** through `dsh.workspaceRoot(exec)`, never the process cwd.

## Configuration

None. The plugin declares `tools` and `commands` and resolves both through the adapter.

## Known limits

- The hold is a **record**, not a scheduler: this plugin owns no dispatch loop, so `agent_teams_halt`
  stops what a captain or a scheduled lane reads as "do not dispatch", and nothing else can be implied.
- `agent_teams_approve` cannot be rolled back.
- The mailbox has no unread count: the official inbox exposes no read state, and inventing one would
  misreport it.
