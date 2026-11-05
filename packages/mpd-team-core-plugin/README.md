# mpd-team-core-plugin

**English** | [中文](./README.zh-CN.md)

The **workflow** around the official Agent Teams runtime. Harness 0.1.7-rc.2's official plugin owns the
team itself — roster, shared board, mailbox, continuable teammates — and nothing else. The retired
vendored body also carried the review points a captain actually works with: a team staged as a plan the
user can read and approve *before* anybody exists, a task contract frozen at claim time, a halt, an end,
and an archive. Those live here.

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
| `agent_teams_mail` | `send`, `unread`, `read`, `summary`, `permit`, `wait` | the team mailbox: ONE durable stream carrying `message`/`question`/`answer` rows, with a read state the official one cannot provide; `permit` issues a wait grant (this team's Lead only) and `wait` blocks inside it — the whole protocol is in [`docs/mail.md`](../../docs/mail.md) |
| `agent_teams_control` | `halt`, `resume`, `fence`, `unfence`, `end` | a hold that stops new dispatch and nothing else; `fence`/`unfence` close one seat; `end` closes the team for good (Lead only, idempotent) |

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

**Empty write scopes are no longer silent (C4).** A `work`/`repair`/`integration` row staged or appended
with no `write_scopes` is still CREATED, but the result carries a `warning` (rendered below the result's
own sentence and declared in the output schema): it names the consequence — the frozen contract allows
NO path, so the writer must stop on the first edit and ask the captain — and the remedy — declare the
scopes now, or amend the contract before the first write, because a scope added after approval needs a
re-freeze and a new verify loop. `requirement`/`review` rows write nothing and are exempt, so the field
does not become noise.

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

### Native tool cards (dsh-Go)

`agent_teams_plan`, `agent_teams_task` and `agent_teams_dispatch` carry
`output.presentationMeta`, so the dsh-Go app draws them as a **native card** in the chat log instead
of a generic tool row: the plan's counts, roster and board for the plan tool; the row, its
attempt/revision and its dependents for the task tool; the pairs, skips and hand-overs for the
dispatch tool. Each card is a **v1** view tree (`stack` with a title, then metrics, `keyValue`,
tables and short text) with **no `$` binding, no `actions` and no `style` key** — a chat-log entry has
no data model and no action channel, and an older app must still be able to draw it. `toolCard()`
from `packages/mpd-dsh-adapter-plugin/src/dshgo-view.ts` is the seam: a failed build, a v2 component
or a tree over **8 KiB / 40 nodes / depth 6** degrades to `{}` and the app falls back to its generic
row, so a card can never break a tool call. The builders are pure functions in `src/tool-cards.ts`,
and the unit test runs them through the SAME wrapper the registration uses.

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
resolve them. The two MUTATING routes in that same family — `POST /plugins/mpd-team/approve` and
`POST /plugins/mpd-team/dispatch` — are documented under **The action plane** below; this section
covers the read/stream family only.

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

## The action plane — exec-free actions and their two routes

The two bodies used to live inline in the `agent_teams_plan` / `agent_teams_dispatch` handlers, which
made the only surface that could drive them a model turn carrying a live tool-call context
(`exec.agent`) to spawn and send; a browser panel, a phone or a native DSH Go panel has no such
context. `src/team-actions.ts` holds those bodies now as two exec-free functions — same validation
order, same store writes, same reply fields — and the row exposes the SAME sequence three ways: the
tool handlers, the `mpdTeamActions` service and two HTTP routes. That is what lets a button (a browser
panel, a phone, a native DSH Go panel) drive a team.

### The service (`mpdTeamActions`)

The row publishes it under the id `mpdTeamActions` (the exported constant `TEAM_ACTIONS_SERVICE`)
BEFORE its tools, so a consumer that resolves it during this row's own activation finds a live member.

| Member | Signature | Contract |
|---|---|---|
| `approve` | `(input: { sessionId: string }) => Promise<TeamActionResult<TeamApprovePayload>>` | approve the plan staged by `sessionId`, as that session's live agent |
| `dispatch` | `(input: { sessionId: string; limit?: number; dryRun?: boolean }) => Promise<TeamActionResult<TeamDispatchPayload>>` | one dispatch pass for that session's team; `limit` `0`/absent means no cap, `dryRun` decides the pairing and sends nothing |

`TeamActionResult<Payload>` is `({ ok: true } & Payload) | { ok: false; error: string; unexpected?: true }`
— a RESULT, never a rejection, because a route must answer instead of throwing into the host and a panel
has to render the refusal. `unexpected` marks a caught THROW (see "One action at a time" below): the
sentence stays in `error` for the row log and the tool path, while a route answers the generic `500`
instead of forwarding it.

- `approve`'s payload: `plan` (on a real approval the persisted plan, marked approved; on the `dryRun`
  preview the staged plan unchanged), `team` (the record it wrote; ABSENT only on `dryRun`), `created`
  (`{ members: [{ name, id }], tasks: [{ subject, id }] }` — real ids on approval, empty strings on the
  preview — plus `unresolved` when a blocker named no task), and `stoppedAt` when a spawn stopped the
  sequence.
- `dispatch`'s payload: `pairs` (the pairings the transport accepted — `taskId`, `subject`, `memberId`,
  `memberName`, optional `note`), `skipped` (every task left out, with `taskId`, `subject`, `reason`)
  and, when relevant, `forgotten`, `holdRead`, `reaped`, `halted` or `refused`.
- **"not live" is an answer, not a throw.** A session the live registry does not know answers
  `{ ok: false, error: "session <id> is not live" }` from BOTH members; a session whose workspace cannot
  be attributed answers `{ ok: false, error: <the resolver's message> }`. Neither member throws for a
  bad session id.
- **Liveness matches the SESSION, not only the agent id.** `dsh.liveAgent(sessionId)` answers by AGENT id,
  so the service AND the routes fall back to a `liveAgents()` scan matching `session.id` — the same
  fallback `workspaceRootForSessionOf` and the TUI adapter already make. A host that gives an agent an id
  different from its session id is therefore live to every surface, and the refusal sentence is unchanged.
- **The caller is the TOOL path's caller.** The workspace, session id, `lineage` and the session TITLE are
  derived exactly as `where(exec)` derives them, from the resolved live agent: a resumed or forked Lead
  contributes the parent session the harness recorded, so the service (and both routes) resolves the SAME
  team its own tool calls resolve; a recorded DELEGATION CHILD contributes an EMPTY lineage and never
  inherits its captain's team.
- **A roster seat is identified by the RECORD, never by a guess.** `team-store.ts#memberIdentityOf` is the
  ONE narrowing every Lead check uses: the session's own id (a member's `name`/`executorRef`), then a
  recorded ANCESTOR (a resumed session whose parent is the member's old session), then the persona TITLE
  matched against the seat's ROLE first and then the seat's STORED name (for a W3-C-bound seat that stored
  name is the workmate slug, so a title that literally contains it names that seat). The LONGEST match
  wins — a `Plan Reviewer` title names the Plan Reviewer rather than colliding with `Reviewer` — and a
  genuine equal-length tie names a member but picks no seat, so it can borrow no Lead ancestry and cannot
  act as one seat.
- **A RECORDED Lead is never read as a member by its title:** the captain identity is checked before the
  title arm, so a Lead persona that happens to contain a roster role can never be addressed by a member id.
  (A FORKED Lead's new session id is recorded only when the churn heal runs — and the heal SKIPS any
  session the identity plane names as a member, so a fork whose title names a seat is NEVER healed on that
  record and stays identified as that seat, fail-closed, while its title keeps naming one. That is the
  stated bound.)

**The functions are exec-free.** `approveTeam(deps, caller)` and `runDispatch(deps, caller, input)`
read no cordis context and no tool exec: the clock, the executor, the approval effects, the team
resolver, the watchdog reading, the service lookup, the row log, the idle guard's dispatch window and
the two approval-time guards all arrive on `TeamActionDeps`. The caller is explicit too —
`{ workspace, sessionId, lineage, title?, agent?, signal? }`. The surface-driven difference from the tool
body is the missing agent: with `caller.agent` absent both functions answer
`{ ok: false, error: "approve needs a live agent" }` / `"dispatch needs a live agent"` **before the
first store write** — no record, no spawn, no approval effect, no dispatch window. A tool caller always
carries an agent, so its behaviour is unchanged. That refusal is what makes a route safe: a route has no
tool-call context to inherit, so it must never spawn, send or half-write a team just to discover that it
cannot act.

**One action at a time, per workspace + session.** Both functions take an in-process in-flight slot keyed
by `workspace + sessionId`, checked BEFORE the first `await` and released in a `finally`. A second caller
is REFUSED — `an approval for this session is already running` / `a dispatch pass for this session is
already running` — never queued, because a queue would hide the duplicate from the operator. That is what
keeps two concurrent approvals from minting TWO teams out of one staged plan, and two concurrent passes
from delivering the same pairing before either compare-and-set can reject it. The slot is **process-local**:
it does not coordinate two dsh processes sharing one workspace, which is a stated bound.

**A policy refusal and an unexpected failure are different answers.** The sentences the body returns
(validation and policy) stay `{ ok: false, error }`, and a route answers `400` with them. Anything that
reaches a catch is marked `unexpected: true` and keeps its message: a store failure's text may embed a
filesystem path, so the `POST` routes answer the documented generic `500` and log the detail, while the
TOOL path still rethrows the real sentence unchanged.

### The two routes (`POST /plugins/mpd-team/approve`, `POST /plugins/mpd-team/dispatch`)

| Route | Body | Success (`200`) |
|---|---|---|
| `POST /plugins/mpd-team/approve` | parsed, then IGNORED; empty or `{}` is accepted | `{ ok: true, team: { id, name, memberCount, taskCount }, created: string[] }` — `created` lists the members' executor handles, then the board's task ids |
| `POST /plugins/mpd-team/dispatch` | `{ limit?: number, dryRun?: boolean }`; `limit` a finite number `>= 0`, `dryRun` a boolean; an empty body is one uncapped pass | `{ ok: true, pairs: [{ taskId, memberId, memberName }], skipped: [{ taskId, subject, reason }] }` |

- **The session comes from `?sessionId=` and nowhere else.** It is resolved by the same
  `workspaceForRequest` the read routes use, so a request acts on the workspace that session owns; a
  body field cannot select a session (extra fields are dropped at the boundary). A request that names
  no session is a `400`.
- **The order is the contract.** The host fence (`dsh.webRequestRejection`, delegated through the
  adapter) answers `401`/`403` BEFORE the method guard, the body stream, the session lookup and the
  store; then this module's own `405` (with `allow: POST`); then the byte cap; then the JSON parse
  and the dispatch body's field validation; then session presence and liveness; only then the action.
  It is the shipped
  `mpd-team-watchdog-plugin/src/web.ts` discipline applied to a mutation.
- **The cap is 64 KiB on the RAW BYTES** (`MAX_ACTION_BODY_BYTES = 64 * 1024` = 65,536 bytes),
  enforced while streaming and BEFORE any parse: an oversized body is a `413` and never becomes a
  JavaScript value. An empty body is admitted as `undefined`.
- **The success payload is the narrow projection above** — never a store object, never a path.

| Status | When |
|---|---|
| `200` | the action succeeded; the projection above |
| `400` | malformed JSON, an invalid dispatch body (`limit`/`dryRun`, or a body that is not a JSON object), a request naming no session, or an action refusal (including an unattributable workspace) |
| `405` | any method other than `POST`; the answer carries `allow: POST` |
| `409` | the named session has no live agent — the action NEVER runs |
| `413` | the body exceeds 65,536 bytes, refused unparsed |
| `500` | an unexpected throw, or an action result marked `unexpected`; the client gets ONE generic sentence and no path (the detail goes to the row log) |

Both routes delegate to the published `mpdTeamActions` members, never to a second copy of the
sequence, so a button and a tool call run the same approval or dispatch pass. They are registered ONLY
when the composition supplies the action surface: a row that cannot act does not advertise an endpoint
that can only fail, and a read-only composition mounts the read routes alone.

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
- **A halt is not an ending; `end` is.** `halt` records a hold: no member is interrupted and nothing is
  archived, so the roster, board and bindings stay and `resume` lifts it. `end`
  (`agent_teams_control {action:"end", team_id?, reason?}`, Lead only) is the terminal verb: it stamps
  `phase: "ended"`, `endedAt` and `archivedReason` on the mpd record THROUGH THE STORE (`endTeamRecord`,
  which calls `writeTeam`), so the team stops resolving for every seat — dispatch, claim and mailbox
  writes can no longer reach it — while the record itself stays on disk as history. A repeated `end` is a
  reported no-op (`changed: false`) that keeps the first ending's instant and reason.
- **THE MAILBOX IS OURS**, because the official one cannot answer the question a captain asks. Its
  durable state is `messages` + `delivered`, and "read" is not observable anywhere in it, so "did they
  SEE it?" has no answer there. `agent_teams_mail` owns `sent → delivered → read`: the record lives in
  `<workspace>/.mpd/team/mailbox.jsonl` (append-only, so a crash costs the last line and never the
  file), delivery still rides the official transport so a member really receives the message, and
  `read` is an explicit acknowledgement by the recipient.
- Absorbed from the official implementation, each earned there: a message is TARGETED at a live member
  resolved by name, a member cannot message itself, a member's UNDELIVERED backlog is BOUNDED (the
  official `TEAM_MAILBOX_FULL`), and the queue keeps insertion order.
- **The undelivered BOUND is per TEAM, a workspace KNOB, and BOTH an acknowledgement and a delivery
  release a slot.** The bound is `mail.maxUndelivered` (default 8, `0` disables; an absent, unreadable
  or unusable value falls back to 8), read PER CALL through the config layer on the ONE `sendMany` path
  BOTH `cellwork_send` and `agent_teams_mail` traverse — so the two tools cannot disagree and "use the
  other mail tool" is not an escape. A refusal names the recipient, the current count, the bound and TWO
  recovery paths: acknowledge the inbox (`agent_teams_mail {action:"read"}` / `cellwork_inbox`) or
  reassign the rows behind it (`cellwork_dispatch {reassign:[{task_id, owner}]}`) — and writes nothing.
  It counts the rows a member was never handed AND never acknowledged — ONE shared outstanding predicate
  feeds the send bound, `summary`'s `undelivered` column and the mail tool's `unread` branch, so the
  three cannot disagree about which rows are outstanding. It is scoped to the claiming team's own rows:
  a retired team's backlog can never refuse a fresh team's mail whose member ids restart at `M1`, and an
  unstamped legacy row counts for nobody. A transport delivery frees exactly one slot; an explicit
  `read`/ack frees exactly one slot per acked row (the one release valve an operator has, and it must
  not depend on a delivery a stalled member will never trigger). `unread` with no member named resolves
  the CALLER's own member id, so a self-read cannot silently answer with somebody else's queue. A
  SUPPLIED `member` must RESOLVE: an unknown name is REFUSED with the value named and the roster listed
  (`"<name>" is not a member of this team (members: …)`), and NO mail is returned — a typo never falls
  back to the caller's own inbox.
- **ONE STREAM, THREE KINDS.** A row carries `kind` (`message` | `question` | `answer`) plus
  `replyTo`/`threadId` and the payload its kind names; a legacy row with no `kind` folds as `message`.
  A question offers LABELS and an answer echoes those label STRINGS verbatim — there is no option index
  anywhere, which is the mechanical fix for the 2026-10-31 relay defect. The envelope, the validators and
  the tolerant fold live in [`mpd-mail-protocol`](../mpd-mail-protocol/README.md); the operator's view,
  the addressing rules and the declared bounds are in [`docs/mail.md`](../../docs/mail.md).
- **ADDRESSING** accepts a member id, a member name, `captain`/`lead` (the record's `leadSessionId`,
  recorded as `toName: "captain"`), or `"*"` — a broadcast that mints ONE ROW PER RECIPIENT (members plus
  the lead, sender excluded, deduplicated) with a shared envelope and thread. There is no multi-recipient
  row, so per-recipient acknowledgement and the per-recipient bound stay honest; a broadcast that resolves
  to nobody is refused rather than reported as "sent 0". "Self" is checked against BOTH spellings of the
  sender (roster id and session id), because a row is addressed by roster id while a session names itself
  by session id.
- **ACKNOWLEDGEMENT IS THE ADDRESSEE'S.** `read` records `by` (the acking member's name, folded as
  `readBy`) and refuses an id addressed to anybody else — there is NO administrative escape. Consequence,
  stated: a captain cannot clear a stalled member's backlog on its behalf; a permit grants a WAIT, never an
  acknowledgement. The acknowledgement identity is the caller's ROSTER id (`ownMember.id`, else its session
  id for a lead with no roster row).
- **THE WAKE IS A DURABLE LINE, NOT A LOG LINE.** After each row is written, the best-effort wake-up is
  attempted and its outcome appended as `{t:"wake", id, sent, reason?, at}` — `reason` is required whenever
  `sent` is false, and a row with NO wake record is one whose attempt never happened (a reader must treat
  that as "not woken"). The shape is the canonical twin of the cellwork plane's record; the reasons each
  plane writes are enumerated in [`docs/mail.md`](../../docs/mail.md).
- **THE FOLD'S PROBLEM LIST IS EXPOSED.** A duplicated send id keeps the FIRST write and is REPORTED (I8):
  the anomalies ride on the folded state as `problems` and the web projection renders them. `problems` is
  OPTIONAL on the state (a caller-built view over a message list is not a fold result), with three
  compensating guarantees: `fold`/`readMailbox` always populate it, `scopeToTeam` carries it through, and
  two test arms assert `{messages: [], problems: []}` on a clean log.
- **DECLARED BOUNDS.** The tool INFERS `kind` from the `question`/`answer` payload and takes no `kind` or
  `threadId` parameter (a reply joins a thread through `replyTo`); the store API still accepts both for
  callers that build rows directly. The registered tool surface is asserted under a measured budget:
  **5,600 → 6,400 characters, measured 6,289** after `permit`/`wait` landed — every further widening needs
  the captain's PRIOR approval.
- **Everything is workspace-scoped** through `dsh.workspaceRoot(exec)`, never the process cwd.

### Nested teams (subcells)

A team RECORD may carry `parentTeamId`, and that one additive field is the whole topology: it names the
team this one is a subcell of, and its ABSENCE means a root team — no key is written at all, so a record
created before nested teams existed reads exactly as it did. Nothing else about a nested team changes: its
roster, board, phase and lifecycle are its own.

**The seam is DERIVED, not passed.** No `agent_teams_plan` action takes a parent argument. Approval
derives the parent from the records with three rules, and each has a test:

- a session that the parent team's ROSTER records (by the executor handle it raised, or by member name)
  nests its new team under it — this is the promoted-subcaptain case;
- a session that LEADS a team never nests under its own team, so a captain's next wave is a SIBLING, not
  a child of the previous one;
- a team that is not LIVE (ended, or whose staged plan was archived without approval) is never a parent,
  so a sub-team is not born inside a finished wave.

A session recorded on MORE THAN ONE live roster makes the box ambiguous, and approval REFUSES with a
sentence naming the teams instead of guessing. A hand-edited chain that loops — a cycle no tool can
write — also refuses, naming the loop, because the projection would otherwise never terminate.

**The projection is a tree of boxes.** `mpdTeams.graph(workspace, teamId)` walks the records, turns every
live descendant into a `GraphGroupInput` and lets `mpd-graph-core` merge it: `GraphModel.groups` is flat
and shallow-first, each group is ALSO a pseudo-node of its parent frame (`visual: "group"`), an interior
node's `depth` is its column INSIDE its own frame, and `ranks` still buckets only the ROOT frame — so a
task's `rank` on `/plugins/mpd-team/state` remains the OUTER rank. A team with no live child supplies no
groups at all, and its model is byte-identical to the one this row served before nested teams existed.

**Ids are qualified, because every team mints `T1..Tn`.** A nested team's rows reach the model as
`<teamId>::<taskId>` (the spelling `dispatch.ts#ledgerKey` already uses) while the root frame's ids stay
BARE; a blocker that names a task of the SAME frame is qualified with it, and every other reference is
kept verbatim, because that is the cross-frame edge the attachment rule anchors on a box border. A
subcell's own plan document is NOT merged into its box: the plan markdown is a workspace document, and
drawing the parent's plan-only ghosts inside a child would misstate what that child declared.

Cellwork records the parent CELL's team id on the sub-cell (`parentTeamId`) when a promoted subcaptain
registers it, so the cell log can be read against the nesting; the sub-team's own link is still the team
plane's derivation, never a second copy.

## The idle-member guard — a member with no board task acts

A team member's only authority is a board task, and this row enforces that at the TOOL BOUNDARY, not by
prompt wording. A session that is a live team's member and owns no OPEN task — no task whose `owner` is
its member name or its executor handle and whose status is `pending`, `claimed` or `in_progress` — is
MARKED idle by a per-agent `agent/pre-step` listener. It receives exactly ONE directive — "You have no
board task. Do not read, run, write, message or claim. End your turn now." — and every tool call it
attempts is DENIED with `[mpd-team] no board task is assigned to you; end your turn and wait for a
dispatch`. The denial is a tool RESULT, so a taskless member cannot read source, run a shell, write a
file, mail, claim, complete or reopen anything until the board gives it work.

- **The mark is re-evaluated on BOTH sides at every pre-step.** An open task CLEARS it — including a task
  delivered by a path this row never observes as a tool call (a cellwork dispatch arrives through
  `TeamExecutor.send`) — and no open task re-marks it. A terminal team record (stopped/archived) or a
  session no longer on the roster also clears it. The pre-step is the reliable clear, not a
  dispatch/claim hook.
- **A member being DISPATCHED is never marked.** The pass that wakes a member opens a counted DISPATCH
  WINDOW around the whole pairing — send, re-read, compare-and-set — because the native executor
  cold-resumes an absent child during the send and that child's first `agent/pre-step` can run BEFORE the
  owner is written. Inside the window the guard neither marks nor denies (a claim denied there would drop
  the very work being handed over); the window closes in the pass's `finally`, after which the
  re-evaluation finds the claimed task. A genuinely taskless member never enters a window and keeps the
  hard denial.
- **Conservative by construction.** A session in no live team, a session whose team record cannot be
  read, the team's Lead, and an explicitly registered CONTROL SEAT are never marked. The control seat is
  `registerControlSeat(sessionId)` on the `mpdTeams` service — the registration a cell's dispatcher or a
  promoted subcaptain needs while it owns no board task (the cellwork call sites land with the
  dispatcher); an ordinary member merely named `cell-*` inherits nothing, because the exemption is a
  registration and never a name prefix.
- **An ASSIGNED but unclaimed task keeps the tools open.** `pending` is an open state; the asymmetry is
  deliberate, because the dispatch turn has to call `agent_teams_task claim`. A member whose only tasks
  are `completed`, `cancelled` or `failed` is idle. A `review` task counts through its own `owner`: the
  board carries no separate "declared verifier" field.
- **The spawn preamble is the prose layer.** Every prompt handed to the executor at `approve` and at a
  mid-run `add_member` raise is prefixed with the same rule — "You are a team member. You have NO board
  task yet unless this spawn carries one…" — so a spawn-time turn starts with it in view. The tool
  denial is the guarantee; the preamble is the cheaper first layer.
- **Registered per agent, not on the row's context.** `agent/pre-step` is dispatched through the agent's
  own scope carrier: a listener installed on the ROW's context was measured SILENT on six live boots
  (2026-09-27). The guard therefore registers on every `liveAgents()` entry, re-arms on `agent/created`
  and releases on `agent/disposed`, and injects one directive per turn (once per marking when the
  harness reports no turn ordinal), so a repeated step never appends a second. A missing live registry,
  event bus or `tools.guard` seam degrades to a reported absence instead of failing the boot.

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
- **The idle mark is process-local and re-detected, never persisted.** A restart re-detects on each
  member's next pre-step; a task dispatched while the mark is set clears it at that member's next
  pre-step; a crash between the dispatch and the clear re-detects the same way.
- **A composition without this row has no guard.** Detection and denial live in this plugin; a team
  composed without `mpd-team-core` keeps only the spawn preamble's prose.
- **Without a lazy spawn the spawn turn still costs one model turn.** The guard makes it a
  one-directive, zero-tool turn, not a free one; lazy spawn is not implemented.


## Owner-only dispatch, fence, handoff and occupancy (wave W1-A)

The five tool NAMES are unchanged; their ACTIONS and record fields grew. This section is the contract
for those additions.

**Dispatch is owner-only by DEFAULT.** `agent_teams_dispatch` pairs a READY task with its DECLARED
owner. A busy, absent, FENCED or failed owner is REPORTED and the row stays pending — never
substituted. Two escapes exist and both are Lead-gated: `mode: "roster"` restores the positional
fallback, and `reassign: [{task_id, owner}]` claims the named rows for that member on the board,
journals `task-reassigned`, then delivers. A BLOCKED row is not reassignable. **Consequence worth
knowing:** `release` CLEARS the owner, so "release then dispatch" goes through `reassign` (or
`mode: "roster"`) — a combination semantic of the two verbs, not a defect.

**Seat verbs.** `agent_teams_task {action:"context"}` answers the caller's own occupancy and seat state,
and never guesses a window: `provenance` reports `observed`, `no-window` or `unavailable`.
`{action:"handoff"}` validates the seven-section document, writes it under
`.mpd/team/handoff/<teamId>/<member>-<n>.md`, flips the member to `mode:"checkpoint"` and journals
`handoff-written`. `agent_teams_control {action:"fence"|"unfence", member}` closes or reopens ONE seat
(Lead only); a fenced seat is never messaged, and its rows are repaired with `reassign`.

**Service surface.** `mpdTeams` gains `memberContext` (one seat's occupancy), `depthBudget` (a bounded
parent-chain walk with cycle detection; the limit comes from `cellwork.depthMax`, default 3),
`archivedPlans` and `cancelTasks`. `mpdTeamActions` carries the exec-free actions `fence`, `unfence`,
`handoff` and `dispatch`, so a panel button, a service caller and the tool drive the same sequence.

**Workmate binding fields.** A staged member records `workmate`, `workmateMode` (which branch bound it)
and `workmateReason` (why); `fenced: false` DELETES the fence keys, so there is exactly one on-disk
spelling of "not fenced".

**The tool-surface budget is a BOUND, not a promise:** five action-based tools plus one command stay
under 6,400 characters (`test/tool-surface.test.ts`; measured 6,399 as wave A6b closed), and each tool
DESCRIPTION stays under 700.

## The force action and its wiring (2026-11-05)

The watchdog is the DECIDER (it resolves `mpdTeams` and holds no caller agent), so it invokes the
`mpdTeamActions` service this package publishes and authorises the action with the team record's
`leadSessionId`. An absent service or a missing lead session records the incident and skips — the
tick never throws.

One force action: (1) write `.mpd/handoff/<member>-<task>-<UTC instant>.md` (task, attempt, member,
started, elapsed, last tool calls, review state); (2) `executor().interrupt(caller.agent, handle)` for
THAT member only; (3) requeue the task `pending` with `attempt` bumped and a note naming the handoff;
(4) SPLIT — one new pending, unowned task per declared write scope when the task declares two or more
(each inheriting the handoff path), otherwise exactly one continuation task with the subject prefix
`[split]`; (5) one captain mailbox row naming team, task, handoff and split rows; (6) journal
`wedged-force` plus one incident record.

Failure semantics: a handoff write failure aborts that member's force for this attempt (retried on
the next tick, at most once per attempt); an interrupt refusal is recorded and the action STILL
requeues and splits; a mailbox refusal is non-fatal — the journal row is the durable notification.
The captain is never a force target.
