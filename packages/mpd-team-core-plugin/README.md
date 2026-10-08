# mpd-team-core-plugin

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
| `agent_teams_plan` | `create`, `add_member`, `create_task`, `edit`, `approve`, `delete`, `status` | stage a team as a PLAN; `approve` EXECUTES it through the TEAM EXECUTOR — the native backend over `ctx.subagents.startContinuable` is the DEFAULT and the official `dsh.team*` calls are the FALLBACK, so the official plugin need not be mounted — resolves `blocked_by`/`owner` against the mpd record, and REFUSES a plan with 0 members and 0 tasks; `delete` archives; `status` shows the record beside the official readout when that backend is active |
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

## The change feed — publish, do not poll

Every team mutation **publishes**. The record at `<workspace>/.mpd/team/teams/<teamId>.json` is the one
source of team truth, and it now announces its own changes, so a surface re-reads when something
happened instead of every 1000–2000 ms.

### The service (`mpdTeams`)

| Member | Signature | Contract |
|---|---|---|
| `subscribe` | `(workspace: string, listener: () => void) => () => void` | Called at most once per change window, **never inside the writer's stack**. The disposer is idempotent. |
| `revision` | `(workspace: string) => number` | A monotonic counter of the change windows this process has OBSERVED for that workspace. `0` for a workspace never seen. A client that reconnects compares its own number against the stream's `hello` frame to detect a missed notification. |

- **No matter who wrote it.** This process's own writes (`writeTeam`, `writeTeamsIndex`, `deleteTeam`)
  notify through a hook on the store, and a write by **another process** — a second session, a CLI, a
  container lane — is seen by a non-recursive `fs.watch` on `<workspace>/.mpd/team` (the index) and
  `<workspace>/.mpd/team/teams` (the records). Both funnel into the same per-workspace window.
- **Coalescing.** A burst inside one window is ONE listener call, and the revision counts the window,
  not the writes in it. The window is FIXED (50 ms by default), never extended by a late arrival, so a
  continuously busy team cannot postpone its own notification forever. The first write of a burst
  notifies on its own: it is the one that opens the window.
- **Containment.** A throwing listener is swallowed for that call and reported once; it cannot break
  the writer, the other listeners or the boot.
- **Lazy and released.** The watchers for a workspace are armed on its first subscriber and closed with
  its last; every watcher, timer and hook is released on row dispose.
- **Degradation, never failure.** If `fs.watch` (or the workspace) refuses, the feed still delivers
  in-process notifications and writes **ONE** bounded log line per workspace saying the watch is off.
  A refused arming is retried on the next subscriber or change, so a directory that appears later is
  picked up rather than watched by nobody forever.

### The route (`GET /plugins/mpd-team/events`)

Server-Sent Events, under the same `/plugins/mpd-team/*` family as the four JSON routes (the host
throws on a duplicate exact route, and `/plugins/events` belongs to the harness's own HMR row).
The workspace and session are resolved from the request **per request**, exactly as the JSON routes
resolve them.

```
HTTP/1.1 200 OK
content-type: text/event-stream; charset=utf-8
cache-control: no-store, no-transform
connection: keep-alive
x-accel-buffering: no

retry: 1000

event: hello
data: {"rev":7}

data: {"rev":8}

: ping
```

- On connect: `retry: 1000`, then one `event: hello` frame carrying the current revision; the head is
  flushed explicitly so a client reports OPEN before any change exists.
- On every feed change: one unnamed `data:` frame (the client's default `message` event).
- A `: ping` comment every 15 s, so no proxy drops an idle stream.
- `req.on("close")` disposes the subscription and clears the interval; nothing survives the client
  leaving.
- A composition with **no feed** answers `503` with a JSON body rather than holding a dead stream open.

### Bounds, stated rather than implied

- The watch is **two non-recursive directory watches** per armed workspace: Linux inotify has no
  recursive mode, and a record is a child of `teams/` while the index is a child of `.mpd/team`.
- Creating those directories is a deliberate side effect of subscribing (a watch cannot be armed on a
  path that does not exist), so a surface that subscribes may create empty
  `<workspace>/.mpd/team/teams/`.
- On a network filesystem, or one whose kernel inotify watch limit is exhausted, the watch degrades
  exactly as an unwritable workspace does: in-process only, one log line.
- The feed follows the **team record and the teams index**. The sidecar files (the staged plan, the
  contracts, the hold, the mailbox) are not published by it.
- `revision` is **per process**. Two processes serving the same workspace each count their own windows.

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
