# t49 — R1 is WIRED at the tool boundary (repair round 2, attempt 1)

> **SUPERSEDED (t53, repair-round-3).** Read this together with `dead-capability-findings.md` in
> this same directory. The "R1 is WIRED" claim below is true **only for the dedup fold**: the
> interjection lane (`enqueueInterjection` / `decideInterjection`) and `clearMailboxToWatermark`
> still have **no production caller**, so a later reader must NOT conclude that R1's lane is
> reachable. Two further corrections, both from t50's round-2 review, are in
> `settled-pins.json` and in the `SUPERSEDED` block of `result.json`: the t36 QA case's cause
> attribution was wrong (its red is caused by the new `decideInterjection` repost in `state.js`,
> not by a pre-existing case defect — the A/B arm cited here reverted a *scheduler* line and so
> could not measure it), and the test-file pin and test count below are one revision stale.
>
> **Stale-hash footnote (t53).** This file cites the frozen contract as `35,174 B` and `36,401 B`
> at two points below. The file it names is now `39,814 B` / `3e77e6b8…` after t53 appended two
> keys (`interjectionExpiryBoundary`, `openToolSurfaceEscalation`); every pre-existing key was
> verified byte-identical after that append. `settled-pins.json` holds the current values.

Scope: `packages/mpd-agent-teams-plugin/**` + `evidence/omo-align/messaging/**`.
No git write was performed (read-only `status`/`log`/`diff` only). Repo head at measurement: `7379e28`.

## The decision this round had to make explicit

t46 returned `needs_revision` because R1 was a **library with zero call sites**. Option **(a) — wire it now — is
what this round did.** No R1 item is left "passed" on the strength of an unreferenced export.

## What was actually broken (found by writing the tool-boundary test, not by reading the code)

The durable fold (`appendMailboxDeduped`) was wired into both `agent_teams_send_message` append sites, so two
identical sends produced ONE stored record with `dupCount=2`. But the tool then ran its **live delivery** path
anyway, so the recipient was still woken TWICE — the fold changed the file, not the behaviour.

Two further defects surfaced while pinning this:

1. A folded duplicate re-ran the live delivery against an **already acknowledged** record, which is exactly the
   duplicate ACTION the fold exists to stop.
2. After a **failed** live delivery the claim is released (`releaseMailboxDelivery` strips `deliveryClaimedAt`),
   so the duplicate's live attempt could still fire — a second wake for the same payload.

Fix: a folded send (`_folded`, a transient marker returned by the primitive and never persisted) performs NO
second delivery and reports `delivered: 'duplicate'` with the surviving record's id. The scheduler keeps sole
ownership of the wake: it delivers the one surviving record exactly once when the live path did not accept it.

## Verdict: 已验证 / 未验证 / 无法验证

| Item | Status | Evidence |
|---|---|---|
| R1 fold wired into BOTH append sites | 已验证 | `t49-send-dedup-wiring.test.mjs` (captain→member and member→captain); `deliverableUnread` region compiled by the shipped applier |
| Two identical sends ⇒ exactly ONE delivery (call count) | 已验证 | test F drives the REAL scheduler (`installTeamScheduler` → `runtime.kickMember`) and counts `subagents.prompt` calls: 0 before the idle edge, **1** after, **1** after a second kick |
| A failed live delivery still yields exactly ONE scheduler delivery | 已验证 | test "two identical sends with live delivery DOWN": `first.delivered='mailbox'`, `second.delivered='duplicate'`, deliveries 0 → 1 |
| A duplicate cannot re-open an acknowledged record | 已验证 | test "duplicate AFTER an acknowledged delivery": `readAt` preserved through the fold, delivery count stays 1 |
| Expiry posts an ORDINARY message + expires on a real tick | 已验证 | `expireInterjections` driven from `kickMember`'s `mpd-delta interjection-expiry-tick`; `r1-message-channel.test.mjs` "expiry notifies the requesting member" + "TTL silence is a DENY" |
| Tombstones never deliver | 已验证 | `readUnreadMailbox` + `deliverableUnread` both filter `tombstone !== true`; seam tests "after a clear -> 0 unread and 0 deliverable" and the scheduler-boundary tombstone test with a positive control on the same kick path |
| Closed decision vocabulary | 已验证 | allow-list `['approved','rejected']`; the error names both allowed values; R1 test asserts the loud failure |
| Pin-only addenda (C1 exact, C3 restated, messaging reading) | 已验证 | `frozen-contract.json` (`messagingOperativeReading`, `pinOnlyNote`) — no primitive changed; C1 regex is byte-identical to `ENUMERATED_LINE_PATTERN`, C2/C3 verb sets identical (14 EN + 12 CJK) |
| Multi-member idle-edge auto-delivery driven from a real status event | 未验证 | the tests call `runtime.kickMember` directly, the same function the `agent/status` listener calls; a genuine multi-process captain+members idle edge is NOT drivable in isolated headless (one-shot `dsh` disposes continuable members — AGENTS.md §12) |
| `node skills/dsh-qa/scripts/agent-teams-messaging.mjs` (t36) exits 0 | 无法验证 | it exits 1 on a PRE-EXISTING case defect — see below. Not caused by this change (A/B measured) and not fixed here (`skills/**` is outside this task's scope) |

## The t36 QA case failure — measured, NOT this change

`agent-teams-messaging.mjs` exits 1 with `interjection.positive.ok=false`,
`requesterInboxAfterRepost=2`, `requester="captain"`.

Cause (reproduced standalone): the case assumes the LIBRARY does not post on approval, so it writes its own
re-post under the SAME id the library already uses. `decideInterjection(...,'approved')` appends
`id: ij-1-delivery` (from `captain`) to the requester's inbox, and the case then appends its own
`{...ordinary, id: "ij-1-delivery"}` (from `Junior Engineer`). `readUnreadMailbox` does not dedup by id, so
both are returned and the case's `length === 1` assertion fails. The case's own manual re-post is a no-op
whose only effect is the duplicate.

**A/B proof it is not this change:** reverting the `deliverableUnread` tombstone filter (the only scheduler edit
here) and re-running the case produced the IDENTICAL failure (`requesterInboxAfterRepost=2`). Passing runs on
record (00:26:51Z, 01:06:38Z) show a 1-line `junior-engineer.jsonl`; the failing runs show 2 lines. No file
under `skills/**` was modified by this task.

## Changed files

- `packages/mpd-agent-teams-plugin/lib/tools.js` — new region `mpd-delta send-dedup-delivery-guard`
- `packages/mpd-agent-teams-plugin/lib/state.js` — fold preserves read/delivery markers; `_folded` transient marker
- `packages/mpd-agent-teams-plugin/lib/scheduler.js` — `deliverableUnread` also drops tombstones
- `packages/mpd-agent-teams-plugin/lib/mpd-deltas.js` — regenerated (26 regions / 6 adopted files)
- `packages/mpd-agent-teams-plugin/test/t49-send-dedup-wiring.test.mjs` — NEW, 6 tests
- `packages/mpd-agent-teams-plugin/test/r1-message-channel.test.mjs` — R1 seam + repair V1 cases
- `evidence/omo-align/requirements/frozen-contract.json` — pin-only addenda
