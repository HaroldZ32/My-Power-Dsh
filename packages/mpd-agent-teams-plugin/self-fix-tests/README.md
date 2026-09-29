# agent-teams recursive tooling fixes (self-fix-tests)

Fork-maintenance record for the recursive agent-teams tooling defects found
during the my-power-dsh audit (task `t26`, 2026-08). The adopted upstream
`README.md` / `README_ZH.md` are kept verbatim as provenance (AGENTS.md
exemption), so this fork-owned note lives here next to the tests.

## Fixed defect classes

1. **Premature review dispatch** — `validateCreateTask` (`lib/quality-gates.ts`)
   auto-wires a review's `reviewedTaskId` (and a repair's `sourceTaskId`) into
   the task's dependency list. A deps-empty review can no longer dispatch
   before its source completes, reject the not-yet-existing implementation, and
   start a false-reject loop. The `agent_teams_create_task` tool consumes the
   gate-normalized dependency list.
2. **Cancelled-dependency deadlock** — `unsatisfiedDependencies`
   (`lib/state.ts`) treats a `cancelled` dependency as satisfied (failed still
   blocks; unknown ids still block). `resolveCancelledDependencyDeadlocks`
   cascades cancellation to pending dependents blocked only by cancelled
   prerequisites, run on every dispatch and after every task cancellation, so
   no task sits `pending` forever behind a cancelled dependency while blocking
   delivery.
3. **Prompt reason delivery** — follow-up repair/review tasks carry
   `reasonTaskId` (the failed review that rejected the source), and
   `collectCompletedDependencyOutputs` (`lib/scheduler.ts`) appends a labeled
   reason item with the failed review's output and unresolved findings to the
   assignment prompt. The failed review is deliberately NOT a dependency
   ("never depend on a failed review"), yet its reason now always reaches the
   repair agent — without it the repair/review loop churns without converging.
4. **False-reject loop** — `planQualityFollowUp` (`lib/quality-gates.ts`): a
   `reject` whose reviewed source is not completed (missing / failed /
   cancelled / pending) returns `notifyCaptain` only — no automatic repair, no
   team escalation; `agent_teams_update_task` delivers that notification to the
   captain's mailbox. A genuine reject of a completed source still escalates.
5. **Assignment context** — `agent_teams_reassign_task` persists
   `task.reassignReason`; the assignment prompt renders it plus a digest of the
   member's unread captain messages (claimed on dispatch, acknowledged on
   delivery, released on rollback).
6. **`**` inScope expansion + contract consistency + contract readability**
   (wave-2 `t4`) — `lib/quality-gates.ts` `pathMatchesScope` now expands globs
   (`**` crosses separators, `*`/`?` stay inside one segment) while every
   wildcard-free declaration keeps the exact/dir-prefix semantics bit-identical;
   `contractContradiction` rejects a create-time contract no path can satisfy
   (`inScope` forbidden by its own `outOfScope`) and `repairScopeFromFindings`
   generates the repair scope so one path can never sit in both lists (the t13
   defect); `lib/tools.ts` registers the read-only `agent_teams_task_contract`
   so a RUNNING task's contract is readable. Deltas are bracketed by
   `//#region mpd-delta <id>` markers, registered in `lib/mpd-deltas.ts`, and
   re-applied/verified by `scripts/patch-agent-teams-fixes.ts` (invoked from
   `scripts/vendor-agent-teams.ts`); `scope-glob-and-contract.test.ts` pins
   both the behaviour and the guard's refusal when a delta is dropped (see also
   `test/task-contract-tool.test.ts` for the tool-level read path).
7. **Order-dependent region healing + marker prefix ambiguity** (wave-3 `t2`) —
   the registry no longer addresses a region by a LINE key (`anchor` /
   `anchorOccurrence` / `anchorMarker`); each entry carries the CONTEXT PAIR
   (`beforeContext` / `afterContext`) that brackets its seam, both windows
   measured on the region-STRIPPED skeleton of the file and required to be
   unique. That makes the heal exact under any insertion history: wave 2 left
   `tools.js` 60 diff lines away from canonical (`task-contract` re-inserted at
   1970 where canonical was 1733) because a line-keyed rule is order-dependent.
   `findRegion` now compares markers WHOLE-LINE, so the three prefix collisions
   (`scope-overlap` ⊂ `scope-overlap-normalize`, `repair-scope` ⊂
   `repair-scope-fields`, `task-contract` ⊂ `task-contract-render`) can no
   longer misdiagnose a partially stripped region as a `half-open marker pair`,
   and a partially stripped region is re-bracketed in place (byte-faithful)
   instead of being duplicated. `registry-context-heal.test.ts` holds the
   permanent byte-fidelity assertion for BOTH adopted files, the
   insertion-history cases and one fixture per colliding pair;
   `test/update-task-diagnostics.test.ts` pins the two
   `agent_teams_update_task` diagnostics (an omitted `attempt_id` reports it as
   REQUIRED instead of claiming stale ownership; `status` is a REQUIRED
   parameter so an oversized payload can no longer silently drop it).

## Run

```sh
bun test packages/mpd-agent-teams-plugin/self-fix-tests
```

Covers: review/repair dependency auto-wiring, cancelled-as-satisfied
`unsatisfiedDependencies`, deadlock cascade + idempotence, `reasonTaskId`
linkage and reason rendering, reject-without-premise captain notification,
`reasonTaskId`/`reassignReason` persistence validation, prompt injection of
`reassignReason` + captain guidance digest, `**` inScope expansion with its
over-match negative controls, the B5 no-wildcard regression set, the
contradiction guard (reject + legitimate-carve-out falsifiability), the
generated repair scope never listing a path in both lists, the vendor-refresh
guard's refusal/restore/idempotence paths, the context-pair registry's
byte-identical strip-heal for BOTH adopted files under partial insertion
histories, and the colliding-marker-pair fixtures (dangling begin / dangling
end / nested / intact control).

