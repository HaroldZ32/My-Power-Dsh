# Older VEdit observations — checked on Band 2 (`d2032bf3`), REPORT ONLY

Contract `.mpd/plans/cellwork-vedit-p0-fix-r2.md` §0 + R1: the four Band 0/1 observations below are
CHECKED and REPORTED. Nothing here was fixed — a fix needs a captain ruling. Each entry names the
covering SYMBOL, the test that pins it and the commit that landed it (T-55: symbol first).

## O1 — `cellwork_send` could not reach a member added later via `agent_teams_plan add_member`

**Verdict: LIVE as a reachability limit, but REPORTED since `df78d1e8` (2026-10-31); the TEAM-plane tool
does reach the member.**

- `cellwork_send` (`packages/mpd-cellwork-plugin/src/protocol.ts`, the send body) resolves recipients
  from the CELL record's own seat map: `Object.values(target.members)` → `memberIds`, then the message
  addresses those seat keys. A member added to the TEAM record after the cell was materialised holds no
  cell seat, so the tool refuses with the cell roster list.
- The divergence is no longer silent: `mpd-cellwork-plugin/src/index.ts` `memberDivergence()` returns
  `missingFromCell` (live members the cell never learned) beside `missingFromTeam`, and
  `cellwork_status` reports it. Pinned by `packages/mpd-cellwork-plugin/test/status-reconcile.test.ts`
  (asserts `memberDivergence.missingFromCell` and `inSync: false`).
- The unified TEAM mailbox does reach the member: `mpd-team-core-plugin/src/index.ts` resolves
  recipients from the LIVE record (`mailTeam.members` → `resolveRecipients`), so a member added after
  approval is addressable through `agent_teams_mail`. Exercised in
  `packages/mpd-team-core-plugin/test/mail-permit.test.ts` (sends to a member of an approved team).
- Consequence: the Band 0 total-loss (a silent unreachable teammate) is dead; a team-only member still
  cannot be addressed on the CELL plane, which is the cell-seat design rather than a defect.

## O2 — the host's 8-concurrent-child cap turns a dispatch delivery into a CLAIMED-but-undelivered row

**Verdict: DEAD on the normal dispatch pass (the claim happens AFTER the delivery); the
claimed-but-undelivered shape survives only on the REASSIGN path, where it is REPORTED.**

- `packages/mpd-team-core-plugin/src/team-actions.ts`, the dispatch pass: `executor().send(...)` runs
  BEFORE `casClaimTask`, and a throw is caught into `skipped` (`the message to <member> failed: <reason>`)
  with no board write for that pair — so a cap-refused delivery leaves the row `pending`, not claimed.
- The REASSIGN path is deliberately the other order (board write first, message second) and reports the
  half-done state: `{ claimed: true, delivered: false, reason: "the row IS claimed for <member> but the
  message failed: …" }`.
- The cap itself was addressed by `44a394e1` ("slot hygiene for failed raises"): a failed raise now
  drops the roster row and hands the activation slot back — pinned by
  `packages/mpd-team-core-plugin/test/agent-slot-hygiene.test.ts`, whose own header records the measured
  `subagent limit reached (active child limit: 8)` cascade.
- BOUND: this is a code-level reading of the current symbols, not a live reproduction of the host cap in
  this lane.

## O3 — `cellwork_dispatch {reassign}` refuses a row whose blocker is still open

**Verdict: LIVE, DELIBERATE and TESTED — the same readiness predicate `claim` uses, not a regression.**

- `packages/mpd-team-core-plugin/src/team-actions.ts` (reassign): `blockingDependencies(fresh.tasks,
  current.blockedBy).blocking` is consulted before the claim, and an unmet blocker answers
  `task T ("subject") is BLOCKED by T1 ("…"): the declared blocker is not satisfied — close T1 first
  (agent_teams_task {action:"complete", task_id:"T1"}) or fail it, which releases its dependents, then
  reassign T`.
- Pinned by `packages/mpd-team-core-plugin/test/team-toolchain.test.ts` — the arm asserting
  `reassigned[0].reason` contains `BLOCKED by`, and its twin arm proving the SAME row reassigns once its
  blocker completes ("one rule, not two").
- Landed/kept by `08d0410b` and `3128fb25` (the dispatch-engine deletion wave, after 0.17.0).
- Consequence: a captain that must move blocked work closes or fails the blocker first; a reassignment
  cannot wake a member for work it cannot start.

## O4 — a member raise failure leaves a roster row without a seat

**Verdict: DEAD, fixed by `44a394e1`.**

- `packages/mpd-team-core-plugin/src/index.ts`, the `add_member` LIVE arm: a failed raise is caught, the
  roster row is dropped with `removeTeamMember(...)`, and the answer states it (`… was NOT added to team
  <id>: the raise FAILED, and its roster row was REMOVED so no failed slot is held`).
- Pinned by `packages/mpd-team-core-plugin/test/agent-slot-hygiene.test.ts` ("a failed raise leaves no
  zombie and no held slot"), which also asserts the next raise of a different member succeeds.
