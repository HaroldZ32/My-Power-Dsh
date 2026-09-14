# t49 follow-up round (sent to the captain after t49 was already terminal)

t49 was marked `completed`, so the task payload is immutable and could not absorb this round.
The captain's follow-up added one hard requirement — **exactly one `agent_teams_update_task`** —
plus three review items. All are addressed below; nothing under `skills/**` was touched.

## 1) The added requirement: exactly one task assignment (now asserted on the SHIPPED path)

New test in `test/t49-send-dedup-wiring.test.mjs` (inScope):

> "R1 WIRING: two identical sends -> exactly ONE delivery and exactly ONE task assignment"

It calls the real `agent_teams_send_message` tool twice (the shipped path, not the primitive),
counts the **mailbox** deliveries inside the recorded `subagents.prompt` calls (= 1), then drives
the real scheduler via `runtime.kickMember` and asserts the seeded task was claimed exactly once:
`status='claimed'`, `attempt=1`, one `attemptId`, assignee intact, member `working`. A second kick
adds **no** further mailbox delivery.

Why the count is split: the mailbox lane is the only lane two identical sends can duplicate. The
fixture deliberately leaves the member object `idle` forever, which is the scheduler's documented
UNOBSERVED-capability recovery path, so a later kick legitimately re-posts the *assignment* lane.
Counting both lanes together would have measured that recovery behaviour, not R1 — the earlier
draft of this test did exactly that and I corrected it rather than loosening the assertion.

Suite: 7 pass / 0 fail, 41 assertions. Full plugin suite 178 / 0; self-fix 53 / 0; delta
`--check` clean at 26 regions / 6 files; typecheck clean.

## 2) F-1 root cause — accepted, and the shipped path is now the evidence

Confirmed: the t36 QA case asserts against primitive functions, so its green result never
exercised the path a captain actually walks. The tool-boundary assertion above is the
replacement: it goes through `registerAgentTeamsTools` → the real tool → the real scheduler.

## 3) Boundary respected

`skills/**` and `VENDOR_LOCK.json` untouched. `agent-teams-messaging.mjs` **still asserts at the
primitive layer** and **still exits 1** (pre-existing case defect: it writes its own re-post under
id `ij-1-delivery`, which the library's approved-delivery append already uses, so the requester
inbox holds 2 records against its `length===1` assertion — A/B measured as unrelated to this
change). Recording it here as the finding you asked for; a separate slot should both fix that
collision and re-point the case at the shipped path.

## 4) F-3 ordering

Order honored: the tombstone filter went into `readUnreadMailbox` and the tombstone rewrite
preserved `readAt`/`deliveredAt` **before** any wiring, with the "after a clear: 0 unread, 0
deliverable" seam asserted. The scheduler-boundary gate test additionally proves a tombstone is
never delivered, with a positive control on the same kick path so the result cannot pass by the
scheduler being dead.

## 5) The "library vs capability" sweep you asked for

Full detail in `dead-capability-findings.md` and `raw/dead-capability-sweep.json`.

**F-4 (new, same class as F-1): the entire interjection DECISION lane has no production caller.**
`decideInterjection` is referenced ONLY by `test/r1-message-channel.test.mjs` and the QA script —
both call the primitive directly. There is no agent-facing tool that approves or rejects a
request, so `approved` is unreachable from a live session and the approval path the R1 contract
describes can never run in production. `enqueueInterjection` is in the same position, so the lane
is unreachable end to end. This needs a tool-surface decision (which tool exposes the decision,
and to whom), so I flagged it rather than improvising it inside a repair round.

**F-5: `clearMailboxToWatermark` has no production caller.** F-3's fix is correct and its seam is
green, but clearing is only ever invoked by tests — so that green result rests on the same
library-level path you flagged. Wiring any clear/archive tool would exercise the F-3 seam for the
first time in production.

**F-6: `readLiveMailbox` has no production consumer.** Its tombstone filter is test-only; the
scheduler composes `deliverableUnread(readUnreadMailbox(...))` instead, and `deliverableUnread`
carries the same filter independently, which is why the gate still holds.

Not dead (checked, to avoid false positives): `messageDedupKey` (internal to the dedup
primitive), `isTaskReady` and `deliverableUnread` (module-private, called by `nextReadyTask` and
both scheduler reads), `appendMailboxDeduped` and `expireInterjections` (wired this round).
