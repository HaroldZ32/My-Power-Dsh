#!/usr/bin/env node
// t33 (review of t24 / T-73) — the REVIEWER'S OWN driver, independent of the author's `driver.mjs`.
// It exercises the REAL primitive `packages/mpd-agent-teams-plugin/lib/state.js` directly with crafted
// records, so each clearing path and each adversarial keep/drop shape is measured on the shipped code.
//
// Question 1 (the acceptance's clearing paths): does the record still DROP `output` on
//   (a) a `pending` first dispatch, (b) an amend-invalidated generation, (c) a handover to another assignee?
// Question 2 (THE DANGEROUS DIRECTION): is there a reachable shape where the fix now KEEPS a deliverable
//   it should have dropped?
import { activateTaskAttempt, beginTaskAttempt, invalidateTaskAttempt } from "/root/dshProj/my-power-dsh/packages/mpd-agent-teams-plugin/lib/state.js"

const mk = (over = {}) => ({ id: "t1", status: "in_progress", attempt: 1, attemptId: "att-1", assignee: "Architect", dependencies: [], output: "EARNED-DELIVERABLE", ...over })
const snap = (t) => ({ status: t.status, assignee: t.assignee, attempt: t.attempt, attemptId: t.attemptId, output: t.output, handoffId: t.handoffId, reassigning: t.reassigning })
const run = (fn) => { try { return { returned: fn() } } catch (e) { return { threw: String(e.message).slice(0, 120) } } }
const out = []
function probe(id, what, task, call, expect) {
  const before = snap(task)
  const r = run(() => call(task))
  const after = snap(task)
  const kept = after.output !== undefined
  out.push({ id, what, expect, kept, before, after, ...r })
}

// ── Q1: the three clearing paths the author says still clear ───────────────────────────────
probe("drop-pending-first-dispatch", "a PENDING task's first dispatch (new generation)", mk({ status: "pending", output: "LEFTOVER" }), (t) => beginTaskAttempt(t, "Architect"), "DROP")
probe("drop-handover-compose", "a compose naming a DIFFERENT assignee (handover)", mk({ status: "in_progress", assignee: "Architect" }), (t) => activateTaskAttempt(t, "Beta"), "DROP")
probe("drop-amend-chain", "an amend-invalidated generation: invalidateTaskAttempt then the new owner arms", mk({ status: "in_progress", assignee: "Architect" }), (t) => { invalidateTaskAttempt(t, "Beta", true); const afterInvalidate = snap(t); const id = beginTaskAttempt(t, "Beta"); return { afterInvalidate, id } }, "DROP")
probe("drop-unassigned-incoming", "an OPEN task with NO assignee receiving a first owner", mk({ status: "in_progress", assignee: undefined }), (t) => beginTaskAttempt(t, "Architect"), "DROP")

// ── the fix's KEEP behaviour, reproduced ────────────────────────────────────────────────────
probe("keep-same-generation-in_progress", "the same-generation re-dispatch (open + same assignee)", mk(), (t) => beginTaskAttempt(t, "Architect"), "KEEP")
probe("keep-same-generation-claimed", "the same-generation re-dispatch from CLAIMED", mk({ status: "claimed" }), (t) => beginTaskAttempt(t, "Architect"), "KEEP")

// ── Q1b + T-79: terminal work is refused, in the SAME function ──────────────────────────────
probe("refuse-completed", "T-79: a COMPLETED task with an earned summary", mk({ status: "completed", output: "EARNED" }), (t) => beginTaskAttempt(t, "Architect"), "REFUSE")
probe("refuse-cancelled", "T-79: a CANCELLED task holding an output (cancelUnfinishedTask shape)", mk({ status: "cancelled", output: "CANCELLED-NOTE" }), (t) => beginTaskAttempt(t, "Architect"), "REFUSE")
probe("refuse-failed", "T-79: a FAILED task", mk({ status: "failed", attemptId: undefined }), (t) => beginTaskAttempt(t, "Architect"), "REFUSE")

// ── Q2: THE DANGEROUS DIRECTION — shapes that might keep what should drop ───────────────────
probe("adv-handover-in-flight", "OPEN + same assignee + reassigning/handoffId set (a handover in flight)", mk({ reassigning: true, handoffId: "h-1" }), (t) => activateTaskAttempt(t, "Architect"), "DROP?")
probe("adv-capability-revoked", "CLAIMED + same assignee + attemptId UNDEFINED (capability revoked)", mk({ status: "claimed", attemptId: undefined }), (t) => activateTaskAttempt(t, "Architect"), "DROP?")
probe("adv-stale-output-prev-attempt", "OPEN + same assignee, attempt 2, output written under attempt 1", mk({ attempt: 2, attemptId: "att-2" }), (t) => beginTaskAttempt(t, "Architect"), "DROP?")
probe("adv-owner-reused-after-cancel", "OPEN + same assignee whose cancelled generation was re-opened by hand", mk({ status: "in_progress", assignee: "Architect", output: "PRE-CANCEL" }), (t) => activateTaskAttempt(t, "Architect"), "DROP?")
probe("adv-same-name-different-seat", "OPEN + same assignee NAME, but the seat is a re-spawned member", mk({ status: "in_progress", assignee: "Architect", seat: "session-A" }), (t) => { t.seat = "session-B"; return activateTaskAttempt(t, "Architect") }, "DROP?")

console.log(JSON.stringify({ instrument: "t33 reviewer driver (real lib/state.js)", module: "packages/mpd-agent-teams-plugin/lib/state.js", probes: out }, null, 1))
