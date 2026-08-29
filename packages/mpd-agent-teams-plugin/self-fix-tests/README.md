# agent-teams recursive tooling fixes (self-fix-tests)

Fork-maintenance record for the recursive agent-teams tooling defects found
during the my-power-dsh audit (task `t26`, 2026-08). The adopted upstream
`README.md` / `README_ZH.md` are kept verbatim as provenance (AGENTS.md
exemption), so this fork-owned note lives here next to the tests.

## Fixed defect classes

1. **Premature review dispatch** — `validateCreateTask` (`lib/quality-gates.js`)
   auto-wires a review's `reviewedTaskId` (and a repair's `sourceTaskId`) into
   the task's dependency list. A deps-empty review can no longer dispatch
   before its source completes, reject the not-yet-existing implementation, and
   start a false-reject loop. The `agent_teams_create_task` tool consumes the
   gate-normalized dependency list.
2. **Cancelled-dependency deadlock** — `unsatisfiedDependencies`
   (`lib/state.js`) treats a `cancelled` dependency as satisfied (failed still
   blocks; unknown ids still block). `resolveCancelledDependencyDeadlocks`
   cascades cancellation to pending dependents blocked only by cancelled
   prerequisites, run on every dispatch and after every task cancellation, so
   no task sits `pending` forever behind a cancelled dependency while blocking
   delivery.
3. **Prompt reason delivery** — follow-up repair/review tasks carry
   `reasonTaskId` (the failed review that rejected the source), and
   `collectCompletedDependencyOutputs` (`lib/scheduler.js`) appends a labeled
   reason item with the failed review's output and unresolved findings to the
   assignment prompt. The failed review is deliberately NOT a dependency
   ("never depend on a failed review"), yet its reason now always reaches the
   repair agent — without it the repair/review loop churns without converging.
4. **False-reject loop** — `planQualityFollowUp` (`lib/quality-gates.js`): a
   `reject` whose reviewed source is not completed (missing / failed /
   cancelled / pending) returns `notifyCaptain` only — no automatic repair, no
   team escalation; `agent_teams_update_task` delivers that notification to the
   captain's mailbox. A genuine reject of a completed source still escalates.
5. **Assignment context** — `agent_teams_reassign_task` persists
   `task.reassignReason`; the assignment prompt renders it plus a digest of the
   member's unread captain messages (claimed on dispatch, acknowledged on
   delivery, released on rollback).

## Run

```sh
bun test packages/mpd-agent-teams-plugin/self-fix-tests
```

Covers: review/repair dependency auto-wiring, cancelled-as-satisfied
`unsatisfiedDependencies`, deadlock cascade + idempotence, `reasonTaskId`
linkage and reason rendering, reject-without-premise captain notification,
`reasonTaskId`/`reassignReason` persistence validation, and prompt injection of
`reassignReason` + captain guidance digest.
