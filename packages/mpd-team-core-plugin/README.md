# mpd-team-core-plugin

**English** | [中文](./README.zh-CN.md)

The **workflow** around the official Agent Teams runtime. Harness 0.1.7-rc.2's official plugin owns the
team itself — roster, shared board, mailbox, continuable teammates — and nothing else. The retired
vendored body also carried the review points a captain actually works with: a team staged as a plan the
user can read and approve *before* anybody exists, a task contract frozen at claim time, a halt, and an
archive. Those live here.

**The mpd record is the authoritative team truth.** The roster and the board live in
`<workspace>/.mpd/team/teams/<teamId>.json`, written and read by this plugin; the official Agent Teams
service is the **fallback** for a composition that runs the official executor, reached only through
`mpd-dsh-adapter`, and no surface here treats `dsh.teamLiveTeams()` as truth. The sidecar files under
`<workspace>/.mpd/team/` are the workflow state *around* that record, never a second copy of it.

## Tools

| Tool | `action` values | What it does |
|---|---|---|
| `agent_teams_plan` | `create`, `add_member`, `create_task`, `edit`, `approve`, `delete`, `status` | stage a team as a PLAN; `approve` EXECUTES it through the TEAM EXECUTOR — the native backend raises a durable child through `ctx.subagents.startActivation` on the pinned host (harness 0.2.1+) and keeps the retired `ctx.subagents.startContinuable` only as the older-host fallback (`CONTINUABLE_START_MEMBERS`, probed newest-first by `continuableStartMember`), while the official `dsh.team*` calls are the FALLBACK, so the official plugin need not be mounted — resolves `blocked_by`/`owner` against the mpd record, persists a declared `kind` from `task.kind` or its top-level alias (an unknown word is refused), and REFUSES a plan with 0 members and 0 tasks; `delete` archives; `status` shows the record beside the official readout when that backend is active |
| `agent_teams_task` | `claim`, `contract`, `release`, `complete`, `fail`, `depend` | claim the task on the mpd record AND freeze its contract with a monotonic `attempt`; read it back; `release` frees the pairing and reopens the row to `pending`; `complete`/`fail` are the terminal verbs (owner-only, optional `note`/`expected_revision`, a `FAIL` releases its dependents); `depend` APPENDS `blocked_by` edges to an EXISTING row — idempotent (a re-added reference is a reported no-op), refused for a terminal row, for an unknown `task_id`, for a caller who is neither the row's owner nor the team's Lead, and for a SELF-EDGE or ANY CYCLE (2-node or transitive); every refusal returns BEFORE any write, so `blockedBy` and `revision` are unchanged — a cyclic edge could never satisfy the readiness rule, and `depend` appends only, so the row would be permanently not-ready — and it reports a reference that names no task: kept verbatim in `blockedBy`, named in the answer, and persisted on the row as `unresolvedBlockers` |
| `agent_teams_dispatch` | `run`, `release` | pair ready tasks with idle members, tell each member its task, and RECORD the pairing in the TEAM-SCOPED ledger; `release` frees it and reopens the row |
| `agent_teams_mail` | `send`, `unread`, `read`, `summary` | the team mailbox: durable, with a read state the official one cannot provide |
| `agent_teams_control` | `halt`, `resume` | a hold that stops new dispatch and nothing else |

`/agent-teams <what the team is for>` stages a plan from the current goal.

**The dependency guard (mpd record plane).** Every `create_task` MUST state its dependency answer —
`blocked_by: [...]` (an array, possibly empty: an explicit root) or `independent: true`; omitting both,
a non-array value, two disagreeing spellings, a self-edge or a cycle are all REFUSED, naming the task.
`approve` REFUSES two tasks whose declared write scopes overlap (a trailing `/**` stripped, then equal
or a prefix at a segment boundary; `**` and `.` cover everything; an empty scope list never overlaps)
with no dependency path between them, quoting the pair and both remedies — add the edge, or make the
scopes disjoint. `claim` REFUSES a task whose declared blockers are not satisfied, through the SAME
readiness predicate `agent_teams_dispatch` uses, while `complete`/`fail`/`release` stay open; an OPT-1
FAILED blocker still releases its dependents. **The door is closed at the tool boundary:** the team door
guard REFUSES the five official authoring verbs by whole name — `spawn_teammate`, `team_task_create`,
`team_task_list`, `team_task_get`, `team_task_update` — so no TOOL can author a task on the official
board (`send_message`, `list_agents`, `wait_agent` and `interrupt_agent` stay, for agent communication).
**The bound, declared once:** a ROW that calls the team SERVICE directly (the official-executor fallback)
is not a tool call and is NOT gated. **The door denies for EVERY agent and has NO preset bypass —
deliberately (R18).** The delegation gate releases a foreign-preset top-level session; this door does
not, because its subject is a WORKSPACE-scoped board — one `.mpd/team/teams/<id>.json` RECORD per
workspace — so releasing a foreign-preset session would let the official board and the mpd RECORD diverge
inside the SAME workspace, and this repository's own measurement (T-92, `complexity-gate.ts`) is that the
deployment's top-level session carries `agentPreset: "cordis"`: a preset-keyed release would release
exactly the session the door must bind. The mpd RECORD is still the only board, so every rule above runs
on every task a session can create through these tools.

**The DAG is visible.** `agent_teams_plan {action:"status"}` keeps its one-line summary
(`plan <id> · members N · tasks N · hold …`) and prints one line per member (`id`, `name`, `status`) and
one line per task (`id`, `owner`, `status`, `kind`, `blockedBy` — or `-` — and `subject`), so a flat
board and a wired one no longer look alike. `edit`'s read form prints the staged tasks with `subject`,
`owner` and `blockedBy`, and `id=-` on every row: approval is what mints the `T1…` ids. Because
`create_task` mints a row and approval writes `blockedBy` once, `agent_teams_task {action:"depend"}` is
the append-only verb that lets a lane added mid-run enter an existing DAG instead of becoming another
unconnected row.

**Why actions, not tools.** Every tool's name, description and parameter schema sits in the model's
context on EVERY turn. The hand-written surface had grown to 14 tools costing 7,643 characters
(~1,900 tokens) before a word of the actual task; the actions are steps of one workflow, so they are
`action` values now — 5 tools, **4,971 characters of a 5,000 budget** (~1,240 tokens), measured
2026-10-23. `test/tool-surface.test.ts` pins both the budget and the action sets, so a new tool has to
justify itself against that number.

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

- **A plan is a review point, not a queue.** `agent_teams_plan {action:"create"}` writes a plan and
  returns; the only thing that creates a teammate is `agent_teams_plan {action:"approve"}`.
  `dry_run: true` reports exactly what approval would do without doing it.
- **One staged plan per session.** Staging again replaces the unapproved plan (the previous one is
  archived); replacing an *approved* plan needs `replace: true`, because that is a deliberate act.
- **Approval is transactional in its reporting, not in its effects.** Members spawn first, then tasks
  post, with `blocked_by` resolved from planned subjects to posted task ids and `owner` resolved from
  staged member names to spawned ids. A failure stops the sequence and names where — earlier work is
  kept and reported, never rolled back, because a spawned teammate cannot be un-spawned.
- **ONE approval starts three mechanisms.** Once the team record is written — approval's last act
  before it answers — approval also anchors the wave's **persisted goal** through the optional
  `mpdGoal` service
  (objective `plan.description || plan.name`, source `team`), and seeds the **TODO checklist** with one
  `pending` item per staged task through `todo_write` when that tool is registered in the caller's own
  view. Both are ADDITIONS to an approval that already succeeded: they run only on the real `approve`
  path (`create`, `dry_run` and the empty-shell refusal never reach them), a refusal or a throw costs
  **one log line**, and neither can fail the approval. The checklist write replaces the **whole** list —
  correct at approval, because it starts a new wave — so a plan with no tasks seeds nothing rather than
  clearing a list it did not create.
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
  message is not a ledger. The ledger is **team-scoped** (each row is `teamId::taskId`), so two teams
  in one workspace that mint the same task ids never shadow each other; a team's rows are pruned when
  its record reaches the terminal phase, and a pre-scoping bare-key row is dropped and reported on the
  first pass. `release` frees the pairing **and** returns the task row to `pending` (clearing the
  owner and the start clock), so a released task can be dispatched again. **Who may release is the
  close gate's own rule: the team's Lead or the task's own owner.** An unauthorized release is
  refused **before** the pairing is freed, so a teammate can neither reopen nor unbook another
  member's row. Entries for tasks that were deleted or completed out of band are pruned first, so a
  member is never left "busy" forever.
  **Settlement** writes a member `inactive` once it owns no open task — deterministically after a
  `complete`/`fail`, and at the member's own turn boundary — which is what lets the derived phase
  reach `idle` and the compaction pass see a finished team. It runs when a captain or a lane calls
  it; it is not a background timer.
- `agent_teams_plan {action:"approve"}` cannot be rolled back.
- The **OFFICIAL** inbox has no unread count: its durable state is `messages` + `delivered` and a read
  state is not observable anywhere in it, so inventing a count from THAT plane would misreport it.
  That is a limit of the official plane only: the mpd mailbox counts unread (`unreadOf`, `summarise`
  → `MailSummary.unread`, computed oldest-first) and `agent_teams_mail {action:"unread"|"summary"}`
  reports it.
