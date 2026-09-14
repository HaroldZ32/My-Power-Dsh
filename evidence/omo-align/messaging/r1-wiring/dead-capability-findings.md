# Dead-capability sweep (same class as F-1: "written, tested, never called")

Method: for every R1 symbol, count (a) `import` bindings in `lib/**` outside its declaring
module, (b) quoted-string references (dynamic dispatch), (c) test reach. Then confirm with a
repo-wide `grep -rn` excluding `evidence/`. Script: `raw/dead-capability-sweep.mjs`.

| Symbol | Production caller | Test reach | Verdict |
|---|---|---|---|
| `appendMailboxDeduped` | `lib/tools.js` (both send sites) | yes | **wired this round** |
| `expireInterjections` | `lib/scheduler.js` (`kickMember` tick) | yes | **wired this round** |
| `clearMailboxToWatermark` | **none** | yes | **DEAD in production** |
| `readLiveMailbox` | **none** | yes | **DEAD in production** |
| `decideInterjection` | **none** | yes | **DEAD in production** |
| `enqueueInterjection` | **none** (only the QA script) | yes | **DEAD in production** |
| `readPendingInterjections` / `readInterjections` / `readRawInterjectionRecords` | none | partly | supporting reads of the dead lane |
| `messageDedupKey` | internal to `appendMailboxDeduped` | no | fine — not an entry point |
| `deliverableUnread` | `lib/scheduler.js` (2 sites) | yes | wired (module-private, correct) |
| `isTaskReady` | `lib/scheduler.js` (via `nextReadyTask`) | yes | wired (module-private) |

## F-4 (new, same defect class as F-1): the whole interjection DECISION lane is a library, not a capability

`decideInterjection` has **no production caller anywhere in the repo** — the only references
outside its own declaration are `test/r1-message-channel.test.mjs` and
`skills/dsh-qa/scripts/agent-teams-messaging.mjs`, both of which call the primitive directly.

Consequence: a live captain has no way to approve or reject a request. `approved` is reachable
only from a test or a QA script, so the approval path that the R1 contract describes
("`decideInterjection(..., 'approved')` re-posts an ordinary message") can never run from a real
session. `enqueueInterjection` is in the same position, so the lane is unreachable end to end.

This is the same defect shape t46 named for R1 as a whole: **the primitive is written and unit
tested, but nothing on the shipped path consumes it.** Fixing it is a tool-surface decision
(which tool should expose the decision, and to whom), so it is flagged rather than improvised —
it is also outside a repair round's minimal-diff boundary.

## F-5 (new): `clearMailboxToWatermark` is the F-3 mechanism with no caller

The tombstone filtering and read-marker preservation fix F-3 correctly, and the seam assertion
"after a clear: 0 unread, 0 deliverable" is green — but clearing itself is only ever invoked by
tests. Wiring any clear/archive tool would exercise the F-3 seam for the first time in
production; until then F-3's green result rests on the same library-level path the captain
already flagged as weak evidence.

## F-6: `readLiveMailbox` is an exported read with no production consumer

It is the only R1 read that filters tombstones AND excludes live-claimed records. The scheduler
never calls it (it composes `deliverableUnread(readUnreadMailbox(...))` instead), so its
tombstone filter is exercised only by tests. `deliverableUnread` carries the same filter
independently, which is why the gate still holds.
