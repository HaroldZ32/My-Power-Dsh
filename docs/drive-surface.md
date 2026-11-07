# The drive surface

**English** | [中文](drive-surface.zh-CN.md)

The **drive surface** is the set of seams through which something that is not a model turn moves this
bundle: a phone, a script, a panel or a curl. Before this wave the bundle could only be driven from
inside a conversation: a plan was approved and a dispatch pass ran only through the two team tools'
handlers, and `ask_user_question` could only be answered by a surface that already implemented the
harness's own question UI. Three seams close that gap, and they share one property: **nothing in them
needs a live tool call**.

The repository's assembly is described in [`design.md`](design.md); the routes follow the discipline of
the bundle's oldest mutating route, the team watchdog's pause/resume pair.

## 1. What a caller has to supply

Every seam is addressed by a **session id**, because the bundle's state root is resolved per session
(`session header cwd → DSH_WORKSPACE_ROOT → process.cwd()`). The **team action** routes take it as the
`?sessionId=` query parameter: never as a body field, so a request cannot smuggle its own scope. The
**question relay** is the exception and is deliberately looser: its `GET` takes `sessionId` as an optional
*filter* (omit it and the whole queue is listed), and its answer route needs no session at all: the opaque
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
| `approve` | `{ sessionId }` | `{ ok: true, plan, team, created }`: `created.unresolved` when a blocker named no task |
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

The relay calls the next answerer first and only acts on a `NO_PROVIDER` rejection, so a desktop that
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
| `GET /plugins/mpd-roles/questions?sessionId=` | `{ ok: true, pending: [{ id, sessionId?, createdAt, questions }] }`: this poll is what attaches a client |
| `POST /plugins/mpd-roles/questions/answer` | `{ id, answers: [{ id, selected: [label], custom? }] }` → `{ ok: true, answered: true }` |

`404` means the id is unknown or expired, `400` a malformed body or an unknown label, `413` a body over
64 KiB. The same fence-first order applies, and the `GET` carries its own `405` guard like every other
route in this bundle.

## 4. The DSH Go native surface

### The manifest

The root package declares a DSH Go protocol-1 manifest (`dshGo`: `v: 1`, `wants: ["message"]`) that
contributes **two panels**: `mpd` (the workbench) and `mpd-team` (the team board), each placed in
`session.tab`, `features` and `chat.panel`: one **composer strip** (`mpd-status`), two **composer
actions** (`mpd-dispatch`, `mpd-board`) and two **message actions** (`mpd-save-memory`, `mpd-copy-reply`).
Each panel names a hand-written STATIC fallback under `dsh-go/views/`. The manifest is declarative: the app
draws the JSON component tree with its own renderer and executes none of this bundle's code. The whole
block stays far under the 16 KiB ceiling. The gate is `node scripts/verify-dshgo-standard.ts`, a standing
`verify:gates` member: its MANIFEST and VIEW lanes keep the ids unique across slots, the per-slot counts
legal and every declared view present, view-v1 and inside the panel budget, while its HOST lane checks the
binding form below. [`dsh-go-standard.md`](dsh-go-standard.md) states the standard itself.

### The two panels

`mpd` opens three tabs. **Overview** carries the team's counters, a completion bar, the first thing that
needs attention, the ready rows and the actions. **Ask** shows the FIRST parked question only, its
options as buttons and a free-text form. **Library** holds the two read-only local lists — the workmate
library and the last memory entries with the reflection counters.

`mpd-team` opens three tabs. **Board** is a tappable row per task (a tap carries `select` plus the row id,
and the Detail tab follows it), a **per-member bar chart** (the rows each member owns), a **layered
dependency graph** and the roster underneath. The graph is a monospace `codeBlock`: one line per task —
`L2 T4 Ship it <-T2` — where the `L` level is the longest blocker chain and the arrow tail names the
incoming rows. It is wrapped in a v2 `collapsible` only when the block is big enough to hide the board
(more than six rows or three layers); a small team sees it directly, because a fold around two lines is
noise. An app below 1.0.9 gets the same layout as `steps`, one step per layer, because `codeBlock` and
`collapsible` are v2-only. **Detail** is the selected task's contract.
**Watch** is the predicate in force, the preserving hold and the last incidents.

THREE, NOT FOUR, and the number is measured rather than stylistic: the app lays the tab strip out itself
(`n = min(4, labels)` while `width / n >= 80`), and at phone width the content box stays under 320 px, so
a fourth tab always wraps onto a second row whatever its label says. Shortening the labels (a first
attempt) fixed the mid-word break but not the row. The metric tiles are also drawn OUTSIDE the hero card
for a measured reason: the app keeps a grid two columns wide only while `(width - 8) / 2 >= 136 × text
scale`, and the padded card sits under that threshold, which stacked the tiles one per row.

The host half (`mpd-bundle-plugin`) registers each panel through the adapter once the DSH Go bridge is
bound — the binding is ONE deferred `ctx.inject(["dshGo"], …)` in `mpd-dsh-adapter-plugin`, the bundle's
only sanctioned harness contact, so a bridgeless host registers nothing, logs one `dshGo=absent` line and
never polls. It then polls at 0.5 Hz (the protocol's ceiling), and pushes a narrowed model only when it
changed: ids,
names, statuses, counts, the question's own text and task titles: never a filesystem path, a token or a
credential. `view` is built from a LIVE read rather than from the push cache, because the app fetches the
view BEFORE it subscribes. The view is re-fetched only when a STRUCTURAL signature changes (the parked
question's identity, or the board's id/status set); a text-only change travels on the data push.

Taps answer effects and never reject. The workbench panel publishes `approve`, `dispatch`, `refresh`,
`answer:<n>` and `answer-custom`; the team panel publishes `select`, `back` and `refresh`, and
deliberately nothing that MUTATES. A panel tap is anonymous (it carries no agent), so a settle tap can
never own a board row, and a watchdog tap cannot name the session's workspace root; both would either
fail every time or write to the wrong store. Settling a row and pausing a team therefore stay where the
identity is: the owning member's `agent_teams_task`, and the captain's watchdog tools. The Detail and
Watchdog tabs SAY that instead of offering a button that cannot work. An answer tap acts on the identity the VIEW captured (parked id, item ids, raw
option labels), never on whatever sits in the parking lot at tap time: a question that left the queue
answers "That question is gone" and asks for a refresh instead of settling its replacement. The app runs
an effect only when it arrives within three seconds of the tap, so a slow service is acknowledged at once
with the protocol's DEFERRED shape (`{ pending: { label, timeoutMs }, result }`) and the real effect is
delivered by `result`, up to the protocol's 60-second bound.

### The visual language

The panels are view v2 and follow the app's theme. Both roots are built by the adapter's `panelView()`,
which writes `v: 2` and `accent: "app"` in ONE place, so a named or hex accent is unrepresentable. Each tab
carries exactly one `tinted` hero (the app blends the theme colour over the content background, that IS
the frosted, theme-tinted frame), its numbers as `metric` tiles inside a v2 `grid`, a `surface` section
with a header and a `divider`, and a designed `emptyState` instead of a blank tab. Statuses are
`badge`/`tone` **with a word**, so colour is never the only carrier; a member's initials lead its one
list-row title (`avatar` is the image node, and a horizontal `row` of badges would stack at phone width);
free text sets `maxLines`. A view carries no radius, size, opacity, gradient,
shadow or colour literal: the app owns those, and the kit's builders refuse one.

Older apps get the SAME tree downgraded by `adaptView`: tabs become a stack of titled sections, the grid
becomes a list, badges become text, `divider`/`spacer` disappear and every `style`/`accent` is stripped. A
metric's label AND value survive that rewrite. One builder produces both shapes, so the fallback cannot
drift from the tree it was derived from.

### The strip, the composer and the message actions

The strip is ONE line of at most 24 characters, selected by the app's locale (`3 ready · 1 active` /
`3 就绪 · 1 进行`), prefixed `❓` when a question is parked and coloured `warn` when a plan waits for
approval; it emits only when the line changed, and tapping it opens the workbench panel. `mpd-dispatch`
runs one dispatch pass over the active team. `mpd-save-memory` writes ONE memory entry whose description
is the reply's first line. `mpd-copy-reply` puts the reply on the clipboard. `mpd-board` needs no handler:
its `open panel:mpd-team` effect is static in the manifest. Every handler degrades to a toast, a missing
service, a missing conversation or a refusal never reaches the bridge as an exception.

### Tool cards

The team, roster, workmate, memory, verification, boulder and watchdog tools carry an
`output.presentationMeta` built with the adapter's `toolCard()`: a v1 card with a title, metrics and at
most one table or key/value block, no data bindings and no buttons. The builder NEVER throws and never
ships a card the app cannot draw: anything over the tool-card budget (8 KiB, 40 nodes, depth 6) or any
v2-only component degrades to `{}`, and the app then renders its own generic tool row. Each tool keeps its
existing `render` untouched, so a host without DSH Go loses nothing.

### Where it works

Slots are a **local-engine** capability of the DSH Go app: the bridge ships with the app's own runtime,
the relay blocks its `/dsh-go/*` namespace, and SSH support is deferred upstream. On a host without the
bridge the panels and the strip stay silent (one log line, no registration) and the static view files
are what a reader sees. **Tool cards are the relay-safe half**: they ride the ordinary tool result, so a
remote host still renders them.

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
- **The v2 live trees are not what the repo gate lints.** `node scripts/verify-dshgo-standard.ts` (its VIEW
  lane) checks the DECLARED
  static views; the v2 trees the panels build at runtime are covered by the package's unit tests
  (`lintDesign` in both version modes, plus the budget walk), never by that gate.
- **The rendered look is unproven here.** No Flutter app and no device in this workspace: the protocol
  shape, the budgets, the theme-token rules and the manifest are proven; the pixels are the reader's check.

## 6. Where the detail lives

- `mpd-team-core-plugin`: the action plane, its routes and the status map.
- `mpd-roles-plugin`: the relay, its attach gate and its routes.
- `mpd-bundle-plugin`: both panels, the strip and the menu handlers (`dshgo-panel.ts`,
  `dshgo-team-panel.ts`, `dshgo-surfaces.ts`), their pure view builders (`dshgo-views.ts`) and the
  bilingual copy (`dshgo-copy.ts`).
- `mpd-dsh-adapter-plugin`: the dshGo seams and the view kit (`src/dshgo-view.ts`): the component
  builders, `measureView` / `fitsBudget`, `adaptView`, `lintDesign` and `toolCard`.

- The DSH-Go standard this surface conforms to — the seven slots and their caps, the per-locale text
  limits, the view budgets, the binding requirement and the five-lane gate:
  [`dsh-go-standard.md`](dsh-go-standard.md). The three-plane matrix (DSH core, dsh-TUI, DSH-Go) is
  [`compatibility.md`](compatibility.md).

Each package README beside the code is the contract; this page is the map. Repository-wide conventions,
gates and the git model are in [`../AGENTS.md`](../AGENTS.md), and the commands are in
[`development.md`](development.md).
