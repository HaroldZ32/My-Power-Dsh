# The drive surface

**English** | [中文](drive-surface.zh-CN.md)

The **drive surface** is the set of seams through which something that is not a model turn moves this
bundle: a phone, a script, a panel or a curl. Before this wave the bundle could only be driven from
inside a conversation — a plan was approved and a dispatch pass ran only through the two team tools'
handlers, and `ask_user_question` could only be answered by a surface that already implemented the
harness's own question UI. Three seams close that gap, and they share one property: **nothing in them
needs a live tool call**.

The repository's assembly is described in [`design.md`](design.md); the routes follow the discipline of
the bundle's oldest mutating route, the team watchdog's pause/resume pair.

## 1. What a caller has to supply

Every seam is addressed by a **session id**, because the bundle's state root is resolved per session
(`session header cwd → DSH_WORKSPACE_ROOT → process.cwd()`). The **team action** routes take it as the
`?sessionId=` query parameter — never as a body field, so a request cannot smuggle its own scope. The
**question relay** is the exception and is deliberately looser: its `GET` takes `sessionId` as an optional
*filter* (omit it and the whole queue is listed), and its answer route needs no session at all — the opaque
parked-question id already names a request that belongs to the session that asked it. A client that applies
the team-action rule to the relay will reject valid relay calls.

A **live agent** is the second thing. Approving a plan raises child agents, and dispatching a pass sends
messages; both hand the harness a live `Agent` object, which a session id alone does not produce. A
route therefore resolves the agent from the harness's live registry, and when the session is not live it
answers `409` instead of guessing. **That refusal happens before the first write**: no team record, no
spawn, no message, no dispatch window.

## 2. The team action plane

### The service

`mpdTeamActions` is published by the `mpd-team-core` row and carries the two actions the tools used to
own:

| Member | Input | Success |
|---|---|---|
| `approve` | `{ sessionId }` | `{ ok: true, plan, team, created }` — `created.unresolved` when a blocker named no task |
| `dispatch` | `{ sessionId, limit?, dryRun? }` | `{ ok: true, pairs, skipped }` |

The bodies are the tool handlers' own bodies, moved into an exec-free module: same validation order,
same store writes, same ordering of spawn/send/write/archive. The tool handlers now build a caller from
their tool-call context and delegate, so a tool caller observes the reply it always observed. The one
permitted difference is the refusal above.

### The two routes

| Route | Body | Narrow reply |
|---|---|---|
| `POST /plugins/mpd-team/approve` | parsed, then ignored | `{ ok: true, team: { id, name, memberCount, taskCount }, created: string[] }` |
| `POST /plugins/mpd-team/dispatch` | `{ limit?: number, dryRun?: boolean }` | `{ ok: true, pairs: [{ taskId, memberId, memberName }], skipped: [...] }` |

The guard order is the bundle's standing one and it is not negotiable: the host fence
(`dsh.webRequestRejection`) runs **first**, then the route's own `405` (with an `allow` header), then a
64 KiB byte cap enforced **before** parsing (`413`), then a JSON parse at the boundary (`400`), then the
session and its liveness (`400`/`409`), and only then the action. A reply never carries a store object
and never carries a filesystem path; an unexpected throw becomes a generic `500` with the detail going
to the row log.

## 3. The question relay

### Why a relay

`ask_user_question` reaches the harness service `userQuestions`, which dispatches a waterfall event. On
a desktop that waterfall is answered by the terminal UI; on a phone there is no such client, so the
question fails with `NO_PROVIDER` and the turn learns nothing. The `mpd-roles` row now registers **one
more answerer** and parks what nobody claims.

### The attach gate

The relay calls the next answerer first and only acts on a `NO_PROVIDER` rejection — so a desktop that
answered the question itself keeps it, and the relay never steals a question. Two bounds make it safe on
an unattended engine:

- it parks only when a client has polled recently (15 s window), so an engine with no panel open
  re-raises `NO_PROVIDER` immediately instead of hanging a turn for two minutes;
- a parked question expires after 120 s, and the expiry **re-throws the original error** rather than
  inventing an answer. A question is never answered by silence.

Answers are matched by **option label**, never by index: a UI that renumbers its buttons cannot answer
the wrong choice. An unknown label is refused and the question stays parked.

### The two routes

| Route | Purpose |
|---|---|
| `GET /plugins/mpd-roles/questions?sessionId=` | `{ ok: true, pending: [{ id, sessionId?, createdAt, questions }] }` — this poll is what attaches a client |
| `POST /plugins/mpd-roles/questions/answer` | `{ id, answers: [{ id, selected: [label], custom? }] }` → `{ ok: true, answered: true }` |

`404` means the id is unknown or expired, `400` a malformed body or an unknown label, `413` a body over
64 KiB. The same fence-first order applies, and the `GET` carries its own `405` guard like every other
route in this bundle.

## 4. The DSH Go native panel

### The manifest

The root package declares a DSH Go protocol-1 manifest (`dshGo`) with **one panel**, id `mpd`, placed in
both `session.tab` and `features`, and a static fallback view at
[`dsh-go/views/mpd.json`](../dsh-go/views/mpd.json). The manifest is declarative: the app draws the JSON
component tree with its own renderer and executes none of this bundle's code.

### What the panel shows and does

The host half (`mpd-bundle-plugin`) registers the live panel through the adapter once the DSH Go bridge
is bound, polls the team record and the relay at 0.5 Hz, and pushes a narrowed snapshot only when it
changes: team status and counts, the staged plan's readiness, the ready tasks and the parked question
with its option labels. Every filesystem path stays out of the payload.

Taps map to three action families — `approve`, `dispatch`, and an `answer` button per option — which call
the services above and answer with a toast. The answer buttons are **bounded on purpose**: the panel renders
only the FIRST question item of a parked request, shows at most **four** option buttons, and each tap
submits exactly **one** label. A question set carrying more than one item therefore cannot be answered from
the panel — the relay refuses a partial batch and leaves the request parked for a client that can answer all
of it. A tap in a conversation-less placement answers "open a conversation first" instead of failing
silently, and a handler never rejects.

### Where it works

Slots are a **local-engine** capability of the DSH Go app: the bridge ships with the app's own runtime,
the relay blocks its `/dsh-go/*` namespace, and SSH support is deferred upstream. On a host without the
bridge the panel is silent — one log line, no registration — and the static view file is what a reader
sees. Tool cards are not affected by any of this.

## 5. Honest bounds

- **No Flutter app exists in this workspace.** The native half is proven against the upstream protocol
  schemas, the view budget rules (node count, depth, children, bytes), the DSH Go manifest gate and
  service doubles. A real device install is the reader's check, not an asserted result here.
- **Route guards are unit-proven behind the host fence.** The fence answers before a bare request reaches
  the route's own `405`/`400`/`413` branches, so those branches are exercised against a server double,
  exactly as the watchdog's routes are.
- **The relay claims nothing a real answerer claimed.** Its behaviour when a desktop answers is proven;
  its behaviour when both a desktop and a phone are attached is "the desktop wins", by construction.
- **A panel action needs a live session.** Without one the tap is a toast, not a queued intent.

## 6. Where the detail lives

- `mpd-team-core-plugin` — the action plane, its routes and the status map.
- `mpd-roles-plugin` — the relay, its attach gate and its routes.
- `mpd-bundle-plugin` — the panel host half, the snapshot and the view.
- `mpd-dsh-adapter-plugin` — the five seams all three consume.

Each package README beside the code is the contract; this page is the map. Repository-wide conventions,
gates and the git model are in [`../AGENTS.md`](../AGENTS.md), and the commands are in
[`development.md`](development.md).
