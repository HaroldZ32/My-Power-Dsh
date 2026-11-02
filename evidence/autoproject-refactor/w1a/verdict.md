# R-W1A — review of the team toolchain completion (board task T5)

Contract: `.mpd/plans/autoproject-refactor.md` (§4.4, §5 W1-A, C1, C2, C3, R1).
Subject: the uncommitted W1-A diff under `packages/mpd-team-core-plugin/` (13 modified files, 3 new files).
Reviewer: Reviewer (read-only on the reviewed work — nothing here was fixed by me).
Reviewed at: 2026-11-02 ~19:35–19:55 (+08:00), against the working tree, not a commit.

## Assessment (risk level: MEDIUM-HIGH)

The wave does what its contract asks: `StagedPlan` v2 with a real v1 read-compat lift, owner-only dispatch as
the default with `mode:"roster"` behind an explicit opt-in, a `reassign` repair path, the six new record fields,
`fence`/`unfence`/`handoff`, the three read methods, and the four new tool verbs — all at an honestly
re-measured 6,371 characters against the unchanged 6,400 bound (my own independent measurement, not the
report's). The package suite (515 tests), the root typecheck and the scoped comment gate are green, and the
new tests are substantive: they read the store and the journal back, they use a planted v1 plan as bytes, and
they assert the negative arm (an unknown version is still refused). What holds the wave back is the REPAIR
path: `reassign` checks whether the target can be WOKEN, but not whether it may LEGALLY take the row. The very
same pass refuses a write-scoped task on a read-only specialist through `pairingRefusal` (C7-2), and
`reassign` claims and delivers exactly that pairing while reporting `claimed:true, delivered:true` (proved by
probe, below). A second liveness arm that the cellwork implementation it claims to carry refuses — a target
whose raise FAILED — is also missing. Everything else is polish, plus a coverage hole on the new tool-boundary
code.

## Findings (ranked)

### High 1 — `reassign` bypasses the C7-2 read-only pairing guard
- **Where:** `packages/mpd-team-core-plugin/src/team-actions.ts` → `applyReassignments` (and its `ReassignDeps`,
  which never receives the roster's read-only keys).
- **What:** the target is checked for fence/checkpoint (`memberFenceReason`) and for an executor handle, then
  claimed. `pairingRefusal` — the guard the same `runDispatchBody` applies to every pairing it decides — is
  never consulted. A task carrying `writeScopes` can therefore be claimed for a read-only specialist
  (`Plan Reviewer` / `Reviewer` / `Explorer` / `Architect`), whose tool discipline denies `write`/`edit`/`bash`.
- **Proved:** `evidence/autoproject-refactor/w1a/probe-c72.log` — control pass refuses with
  `refused a WRITE-TASK-ON-READ-ONLY pairing: task T1 has write scopes (packages/x) while member "Plan
  Reviewer" is a read-only specialist`; the `reassign` call answers
  `{"taskId":"T1","owner":"Plan Reviewer","claimed":true,"delivered":true}` and the board reads
  `{"owner":"Plan Reviewer","status":"in_progress"}`.
- **Why it matters:** this is a MEASURED defect class the repository keeps a guard and a regression suite for
  (`dispatch-guard.test.ts`, C7-2). The row moves to `in_progress` where owner-only dispatch will never
  re-pair it; the only recovery is `release` then a second `reassign`. The tool reports a success, which is
  precisely what the owner-only rule exists to prevent ("a wrong pairing can never read as a right one").
- **Direction of a fix (described, not applied):** build the target's `DispatchMember` with the same
  `readonly` flag the pairing roster uses (`isReadonlyMemberName(member.name, keys) || member.role` spelling)
  and pass the roster keys into `ReassignDeps`; run `pairingRefusal(task, target)` before the claim and
  refuse with its own sentence (plus the reassign hint), exactly as `ownerOnlyDecision` does.

### Medium 1 — `reassign` accepts a FAILED or PROVISIONING target
- **Where:** `packages/mpd-team-core-plugin/src/team-actions.ts` → `applyReassignments`.
- **What:** `member.status` is copied into the member shape but only the fence reading consumes it; a seat
  whose raise FAILED (which still carries an `executorRef`) and a seat still being raised both pass every
  gate.
- **Proved:** `evidence/autoproject-refactor/w1a/probe-dead-target.log` — a `status:"failed"` seat with a
  handle receives the row: `claimed:true, delivered:true`, board `{"owner":"dead","status":"in_progress"}`.
- **Why it matters:** the implementation's own comment says the target is checked "before the claim" because
  "claiming a row for a member that cannot be woken would hide it from the next pass" — and the cellwork
  implementation it is carried from refuses exactly these two statuses (its repair R-A1: a FAILED member can
  still carry a handle). The copy dropped both arms, so the comment claims parity the code does not have.
- **Direction:** refuse `status === "failed"` and `"provisioning"` before the claim, with the one-sentence
  repair each (cellwork's own wording is a good source).

### Medium 2 — the new verb rides an authorization path the repo already treated as a vulnerability class
- **Where:** `packages/mpd-team-core-plugin/src/index.ts` → the `agent_teams_dispatch` `execute` (`run` branch)
  and `packages/mpd-team-core-plugin/src/team-actions.ts` → `runDispatchBody`.
- **What:** a member session resolves its own team through `resolveTeamRecord`'s member arm, and the `run`
  branch has no caller gate. Before this wave that meant the engine chose the pairing; with `reassign` the
  CALLER can now re-own any pending row for any named member (including itself, or a stranger). The adjacent
  `release` verb was given a caller gate under PR #60 F1 (CWE-862) for exactly this resolution reason, and this
  wave's own `fence` was made Lead-only because it is "the same class of change as assigning ownership" —
  `reassign` IS assigning ownership.
- **Why it matters:** a teammate can redirect another member's work and read the result as a successful hand-over.
- **Direction:** gate `reassign` (and arguably `mode:"roster"`) to the Lead, or document the deliberate
  delegation in the contract; the contract is silent, which my discipline reads as "not permission".

### Medium 2 (coverage) — the new tool-boundary code and output schemas have no test arm
- **Where:** `packages/mpd-team-core-plugin/test/tool-output-schema.test.ts` (unchanged), plus the new
  boundary code in `index.ts` (`readReassign` refusals, the `mode` enum check) and the four new verbs.
- **What:** that file's own claim is "EVERY plan action answers a value its own schema accepts"; no arm drives
  `agent_teams_task{context|handoff}`, `agent_teams_control{fence|unfence}`, or a malformed `reassign` / an
  unknown `mode`. The toolchain arms call the action bodies (`runDispatch`, `fenceMember`, `writeMemberHandoff`),
  never the registered tools, so the schema/reply conformance and the "refused before anything is written"
  boundary are unproven. The four declarations and the four replies do line up by inspection.
- **Direction:** add arms through the harness `call` helper for the four verbs, one malformed `reassign`
  entry, and an unknown `mode`.

### Nit 1 — the halt+reassign early return drops `forgotten` / `holdRead`
`runDispatchBody` returns `{pairs, skipped, halted, reaped?}` before the ledger prune when a reassign request
meets a hold, while the ordinary halted path also prunes, writes `forgotten` and carries `holdRead`. Same
semantics, different payload; direction: compute the prune before the hold guard or fold both into one return.

### Nit 2 — `mode` is typed `string` where this wave introduced the precise type
`TeamHandoffPayload.mode: string`, `DispatchMember.mode?: string`, `MemberContextReading.mode?: string`, while
`team-store.ts` exports `TeamMemberMode`. Direction: use the type.

### Nit 3 — `depthMaxOf` reads only the `mpdConfig` layer
`index.ts::depthMaxOf` reads `mpdConfig.get("cellwork.depthMax")`; cellwork's own reader is
`readFile("cellwork.depthMax") ?? row.depthMax`, so a row-config `depthMax` would be honoured by a
`cellwork_subteam` refusal and ignored by `depthBudget`. The shipped patch declares no row value, so there is
no live divergence; direction: read the row layer too, or document the one-layer rule.

### Nit 4 — the 6,400 budget was paid with other tools' prose
`test/tool-surface.test.ts` records the payment honestly (6,289 → 6,939 raw → 6,371 trimmed). What was
dropped from `agent_teams_mail` is behavioural guidance, not verbosity ("answers echo LABELS verbatim, never
an index", "defaults to the caller"). Headroom is now 29 characters, so the next addition must trim again;
direction: none due now, but W5 must not treat 6,371 as room to grow.

### Nit 5 — display projections do not read the new seat state
`team-store.ts::idleMembers` and the `team-web.ts` member payload still report a fenced or `checkpoint` seat
as idle, while dispatch refuses to message it. W4-A1's derived stage is the natural home; direction: derive
the seat stage from `fenced`/`mode` in the projection.

## Declined to judge

1. **`release` then dispatch needing `reassign`** — the contract names it as an intended combination
   consequence for W2 to document, so it is not a defect here.
2. **Blind `writeTeam` in `setMemberFence` / `writeMemberHandoff`** — both bodies are synchronous from
   resolve to write (no `await` between), so in-process interleaving cannot lose an update; a cross-process
   race is a pre-existing property of this store, not introduced here.
3. **Repo-wide `bun run verify:comments` is RED** — the only violation is
   `packages/mpd-autoproject-plugin/src/engine.ts` (a different lane, W1-B); `--only packages/mpd-team-core-plugin`
   PASSES, which is the claim the task actually makes (`comments-scoped.log`, `comments.log`).
4. **`team-dispatch-guard` QA arms** — the T2 note hands the five `mode:"roster"` repairs to W1-B/W1-C (T9);
   the file is outside W1-A's write scope and its gate list.
5. **The tool-schema MOUNT check** (AGENTS.md §4) — deferred to integration on purpose: dist is not rebuilt
   in the lane, so a mount now would exercise stale bytes.
6. **Dist not rebuilt** — per the contract and T-88, the captain rebuilds at integration.
7. **The claimed 6,289 "before" figure** — I re-measured the AFTER (6,371 exactly) but did not reconstruct
   the pre-wave surface.
8. **Read-only classification with `mpdRoles` absent** — the guard fails OPEN by the repo's existing rule, so
   W1-A cannot be judged for that composition.
9. **Package README / AGENTS.md prose for the new verbs** — docs are W5's declared scope.
10. **`action:"context"` using `resolveForWrite`** — the resolution can heal a forked Lead's binding (a
    record write), but the heal is narrowly gated and a read from a normal seat/member never writes; noted,
    not a defect.

## Verdict

**FAIL — request changes.** The contract's acceptance list is met (tests 515/515, typecheck, scoped comment
gate, budget 6,371 < 6,400, C1 inventory green, five tool names unchanged), but the new repair path
(`reassign`) reintroduces a measured, guarded defect class — a WRITE task claimed for a READ-ONLY seat, and
delivered as a success — and refuses neither a FAILED nor a PROVISIONING target; those must be fixed in
`applyReassignments` before W2 is built on top of it.

## Bounds of this review

Read: the frozen plan (all sections it cites plus the surrounding target module map), the complete W1-A diff
of the 13 modified files with the final source of `plan-store.ts`, `team-store.ts`, `dispatch.ts`,
`team-actions.ts`'s new region and every changed tool block in `index.ts`, the three new files, the new
526-line test file, the modified test arms, `mpd-dsh-adapter-plugin`'s `contextPressure` and
`createLazyDshAdapter`, cellwork's sibling `applyReassignments` / config reader, the QA dispatch-guard script,
and the coupling-inventory test. Did NOT read: the 227 KB `index.ts` beyond its diff, `team-web.ts` beyond the
action routes and payload interfaces, `mailbox-store.ts`, the rest of the package's suites, or any `dist/`
artifact.

Ran: `bun test packages/mpd-team-core-plugin` (515 pass, 0 fail — `test-run.log`); `bun run typecheck`
(exit 0 — `typecheck.log`); `node scripts/verify-comment-coverage.ts --only packages/mpd-team-core-plugin`
(PASS — `comments-scoped.log`); the same gate repo-wide (FAIL on the foreign file — `comments.log`); the
coupling-inventory test (2 pass); my own tool-surface measurement (`tool-surface-measure.log`, total 6,371);
and the two probes above. Could NOT run: a real mount of the changed tool schemas (needs a rebuilt dist and an
isolated `DSH_HOME` boot — integration's step), the Docker lane, or `verify:gates` repo-wide (other lanes are
mid-edit).
