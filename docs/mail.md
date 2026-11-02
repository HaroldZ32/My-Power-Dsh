# The mail plane (`agent_teams_mail`, `cellwork_send`)

**English** | [中文](./mail.zh-CN.md)

Every agent-to-agent message in this bundle travels ONE durable stream, `<workspace>/.mpd/team/mailbox.jsonl`.
The team plane (`agent_teams_mail`) and the cellwork view (`cellwork_send` / `cellwork_inbox`) are two
surfaces over that same log, so a member reads its mail the same way whichever plane wrote it.

The structured payloads — the `question` / `answer` envelope, the validators and the tolerant fold — live
in [`mpd-mail-protocol`](../packages/mpd-mail-protocol/README.md). This page is the operator's view: what a
row is, who may address whom, who may acknowledge what, when a wait is allowed to block, and what is
deliberately NOT guaranteed.

## One stream, three kinds

A row's `kind` says what it carries, and a row written before this protocol existed has no `kind` at all —
the fold reads it as `message`, so old logs stay readable.

| `kind` | carries | folded as |
|---|---|---|
| `message` | subject + body only | a plain row |
| `question` | `question: { questionId, header?, question, options[], multiSelect? }` | a row whose offered LABELS an answer must echo |
| `answer` | `answer: { questionId, answerTo, selected[], custom? }` | a row that answers ONE `question` row |

`questionId` is stable across a broadcast's fan-out, so an answer names the question without naming a row.
A reply may also carry `replyTo` (the row it replies to) and `threadId`; the fold resolves a thread's
identity — explicit id first, else the `replyTo`'s thread, else the row's own id — in one pass.

## Why labels, never an index

A live cell run on 2026-10-31 measured the defect this design removes: `ask_user_question`'s answer carries
labels and no index, cellwork mail was free text, and every relayed "option number" was composed by a model
— so the number drifted between the asker, the panel and the answer, and the wrong option was reported back
as chosen.

**There is no index field anywhere.** Labels are unique within their question and carry their own stable
ordinal (`A. …`, `B. …` or `1) …`), and an answer repeats the offered label STRINGS. A mismatch is a string
mismatch, so it is refused mechanically — and the refusal carries the full valid label list, including the
answers given through a `wait` (see below).

## Addressing

`agent_teams_mail { action: "send", to: … }` accepts four spellings, resolved against the calling team's
record:

- **a member id** (`M1`) or **a member name** (`Senior Engineer`) — the roster row it names.
- **`captain`** or **`lead`** — the team record's `leadSessionId`, recorded as `toName: "captain"` whatever
  alias was used. A team that records no lead refuses the spelling and lists what it does offer.
- **`"*"`** — a BROADCAST: one durable row per recipient (every member plus the lead, the sender excluded,
  deduplicated), all sharing the envelope and ONE thread. There is no multi-recipient row, which is what
  keeps per-recipient acknowledgement and the per-recipient backlog bound honest. A broadcast that resolves
  to nobody is refused rather than reported as "sent 0".

A member cannot message itself. "Self" is checked against BOTH spellings of the sender — its roster id
(`fromMemberId`) and its session id (`fromId`) — because a row is addressed by roster id while a session
names itself by session id.

## Acknowledgement ownership

Delivery and reading are separate facts, and this mailbox is the only place the second one is recorded.

- A `send` row is opened undelivered and unread; the transport's acceptance adds `delivered`; the recipient's
  acknowledgement adds `read` with `by` (the acking member's display name, folded as `readBy`).
- **Only the row's ADDRESSEE may acknowledge it.** There is no administrative escape: an id addressed to
  somebody else is refused, with the addressee named, and the row stays unread. The acknowledgement is made
  as the caller's own member identity (its roster id, or its session id when it has no roster row).
- A member's UNDELIVERED backlog is BOUNDED (8 per recipient, per team): a stalled member cannot silently
  accumulate work, and an ACK — not a delivery — releases a slot.
- **Consequence, stated rather than discovered:** a captain CANNOT clear a stalled member's backlog by
  acknowledging on its behalf. It is refused like any other non-addressee. A permit (below) grants a WAIT,
  never an acknowledgement on another member's behalf.

## The permit-bounded wait

Mail is non-blocking by default. A blocking wait is a GRANTED EXCEPTION, recorded as its own durable line in
`<workspace>/.mpd/team/permits.jsonl`:

```
{ t: "permit", permitId, issuerId, issuerName, holderId, holderName,
  scope: "answer" | "message", ttlMs, expiresAt, questionId?, at }
```

- `agent_teams_mail { action: "permit", holder, scope?, ttlMs?, questionId? }` — **only the team's Lead**
  (its recorded `leadSessionId` and lead history) may issue one, and only for a member of its own team.
  TTL defaults to 60 s and is clamped to 600 s; `questionId` narrows the grant to one question.
- `agent_teams_mail { action: "wait", permitId, messageId, timeoutMs? }` — refuses without a permit, on an
  expired or foreign permit, on a target the permit's scope does not cover, and on a target the HOLDER did
  not send: a wait is an ASKER waiting on its own question, so answering one addressed to you is a `send`,
  never a wait, and another member's question would leak the labels its answers carry. Every refusal names
  the caller's captain. The timeout defaults to 15 s and is clamped to 60 s.
- The wait polls the mailbox at 50 ms and is bounded TWICE: a wall-clock deadline and a poll ceiling
  (`ceil(timeoutMs / interval) + 1`), so it cannot spin even under an injected clock. `timeoutMs: 0` is
  exactly one read and a timeout. A cancelled call returns `reason: "aborted"`.
- A `scope: "answer"` grant returns the assembled ANSWERS (each with its `questionId`, `answerTo` and the
  selected labels); a `scope: "message"` grant returns the reply ROWS.

## Delivery: durable first, woken best-effort

A row is written BEFORE any wake-up is attempted, and the attempt's outcome is a separate durable line:

```
{ t: "wake", id, sent: boolean, reason?: string, at }
```

`reason` is required whenever `sent` is false. A row with NO `wake` record is one whose attempt was never
made (the process stopped between the two appends), which a reader must treat as "not woken", never as
success.

Each plane spells the reasons ITS attempt produced, and both write them into the same shape. The cellwork
plane refuses a wake-up when the mail crosses a cell boundary (durable only — no Lead authority over the
other cell), when the addressed recipient is the captain (the Lead has no executor handle in this
composition), when a member sends without the captain's Lead authority, when the recipient was never raised
(no handle), and when the composition exposes no team executor at all. The team plane refuses when the
recipient is the lead (no member row) or has no handle, and records a transport refusal with the transport's
own message. A row whose wake-up was refused is still unread, so `cellwork_supervise` lists it under
`wakeFailures[]` and the team plane's `summary` counts it in the `undelivered` column — the `wake` line is
what says WHY.

## The log on disk

`mailbox.jsonl` is append-only: one JSON record per line, never rewritten, so a crash mid-write costs the
last line and never the file.

| record | meaning |
|---|---|
| `send` | opens a message: addressing, `kind`, the envelope, `teamId`/`cellId` stamps |
| `delivered` | the transport accepted the row (it is still unread) |
| `read` | the addressee acknowledged it, with `by` |
| `wake` | one wake-up attempt and, when refused, why |

The fold tolerates a torn last line, a legacy row with no `kind`, a state row whose `send` line was lost, and
a FOREIGN record kind (the cellwork `wake` row shares this file), and it reports every anomaly it can see —
a duplicated send id keeps the FIRST write and says so. Those reports are exposed as `problems` on the folded
state, and the team web panel renders them.

## The cellwork view over the same stream

`cellwork_send` writes into the SAME log through the shared store's atomic fan-out, stamped with the cell's
`teamId` and an additive `cellId` the view scopes by; a cross-cell sender also stamps `fromCell`. Its
arguments are the cell-shaped spelling of the same protocol: `kind` (inferred from `options` for a question,
from `selected`/`custom` for an answer), `options`/`multiSelect`, `replyTo`, `selected`/`custom`,
`questionId`, and `broadcast: true` for one row per seat of the target cell (sender excluded).

A pre-unification `<cell>/mail.jsonl` is still read and merged into the view in `at` order; an
acknowledgement for one of ITS rows is appended back to that file, while a unified row is acknowledged
through the store's ownership-checked path. That is the one-way migration boundary: a NEW row is readable by
this build, and a reader from a PREVIOUS build would not see it in the cell file at all.

## Declared bounds

- **The team tool infers `kind`.** `agent_teams_mail` takes `question` / `answer` payload OBJECTS and derives
  the kind from whichever is present (neither means `message`), so the payload and the kind cannot disagree.
  There is no `kind` parameter, and no `threadId` parameter either — a reply joins a thread through
  `replyTo`, and an answer derives it from `answerTo`. The store API still accepts an explicit `kind` and
  `threadId` for callers that build rows directly (`cellwork_send` does its own spelling).
- **`problems` is OPTIONAL on the folded state**, deliberately, not by oversight: a caller-built VIEW over a
  message list (the permit/wait path hands `{ messages }` to a reader) is not a fold result and must not
  invent a diagnostic list. The compensating guarantees are mechanical: `fold`/`readMailbox` ALWAYS populate
  it, `scopeToTeam` carries it through, and two test arms assert `{ messages: [], problems: [] }` on a clean
  log — so an absent list can never hide an anomaly.
- **The acknowledgement identity is the ROSTER id** (`ownMember.id`, else the caller's session id for a lead
  that has no roster row). A caller that passes its session id where a roster id is expected is refused, not
  silently matched.
- **Tool-surface budget: 5,600 → 6,400 characters, measured 6,289** (headroom 111) after the permit/wait
  parameters landed. The number is asserted by a test arm, re-baselined twice in this wave with the
  measurement recorded in the test itself, and any further widening needs the captain's PRIOR approval.
- **No cross-workspace mail.** A mailbox stays workspace-scoped; there is no transport between workspaces.

## Tests and evidence

- `packages/mpd-mail-protocol` — the envelope, I1–I8, the fold's tolerance, and the whole-problem-list
  refusals: `bun test packages/mpd-mail-protocol`.
- `packages/mpd-team-core-plugin` — the store (bounds, ownership, wake records, fold problems), the tool
  surface (addressing, broadcast fan-out, permit/wait) and the web projection:
  `bun test packages/mpd-team-core-plugin`.
- `packages/mpd-cellwork-plugin` — the cell view, the legacy-log merge and ack-once semantics:
  `bun test packages/mpd-cellwork-plugin`.
- Documentation parity, including this page and its twin: `bun run verify:docs`.
