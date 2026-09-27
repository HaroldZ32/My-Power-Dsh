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

| Tool | `action` values | What it does |
|---|---|---|
| `agent_teams_plan` | `create`, `add_member`, `create_task`, `edit`, `approve`, `delete`, `status` | stage a team as a PLAN; `approve` EXECUTES it (spawn + post + resolve `blocked_by`/`owner`); `delete` archives; `status` shows the sidecar beside the official roster and board |
| `agent_teams_task` | `claim`, `contract`, `release` | claim on the official board AND freeze the task's contract with a monotonic `attempt`; read it back; free a dispatched task |
| `agent_teams_dispatch` | `run`, `release` | pair ready tasks with idle members, tell each member its task, and RECORD the pairing |
| `agent_teams_mail` | `send`, `unread`, `read`, `summary` | the team mailbox: durable, with a read state the official one cannot provide |
| `agent_teams_control` | `halt`, `resume` | a hold that stops new dispatch and nothing else |

`/agent-teams <what the team is for>` stages a plan from the current goal.

**Why actions, not tools.** Every tool's name, description and parameter schema sits in the model's
context on EVERY turn. The hand-written surface had grown to 14 tools costing 7,643 characters
(~1,900 tokens) before a word of the actual task; the actions are steps of one workflow, so they are
`action` values now — 5 tools, 4,717 characters (~1,180 tokens). `test/tool-surface.test.ts` pins both
the budget and the action sets, so a new tool has to justify itself against that number.

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
- **THE MAILBOX IS OURS**, because the official one cannot answer the question a captain asks. Its
  durable state is `messages` + `delivered`, and "read" is not observable anywhere in it, so "did they
  SEE it?" has no answer there. `agent_teams_mail` owns `sent → delivered → read`: the record lives in
  `<workspace>/.mpd/team/mailbox.jsonl` (append-only, so a crash costs the last line and never the
  file), delivery still rides the official transport so a member really receives the message, and
  `read` is an explicit acknowledgement by the recipient.
- Absorbed from the official implementation, each earned there: a message is TARGETED at a live member
  resolved by name, a member cannot message itself, a member's UNDELIVERED backlog is BOUNDED (the
  official `TEAM_MAILBOX_FULL`), and the queue keeps insertion order.
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
