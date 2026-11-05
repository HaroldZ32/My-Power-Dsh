# Review basis — declared BEFORE any implementation read

Reviewer: `reviewer-1` (independent verifier seat, read-only)
UTC instant basis written: 2026-11-05T11:20Z (session local 2026-11-05 19:20 +08:00)
Frozen contract: `.mpd/plans/vedit-throughput-fixes.md` (read in full: lines 1–235, two reads, no
truncation gaps after the second read of lines 72–211)

## Documents this verdict will rest on

| Id | Document | Scope of reliance |
|---|---|---|
| DOC-1 | `.mpd/plans/vedit-throughput-fixes.md` | the frozen acceptance contract for D1, D2, D3 and the D0 shared-base consequences |
| DOC-2 | `AGENTS.md` (repository manual: §4 gates, §5 verification law + git model, §6 adapter seam rule + TypeScript/comment rules, §7 QA discipline incl. T-88/T-90, §9 vendor, §13 glossary) | binding repository rules |
| DOC-3 | `packages/<affected>/README.md` for each package D1/D2/D3 touch | each plugin's own contract |
| DOC-4 | `agent-references/verification-flow.md`, `agent-references/glossary.md` | only if a finding needs the long form |

## Pre-committed pass criteria (derived from the contract only, no implementation known)

### D1 — RE-TEAM gate
1. `readLeadingTeam` → `leading:false` on `endedAt` present, AND on clean-terminal board even with
   `endedAt` absent.
2. Clean-terminal = every task `completed`|`cancelled` AND none `failed`; a `failed` task blocks
   auto-end AND blocks re-team, injecting exactly the one stated repair notice.
3. Auto-end calls `agent_teams_control {action:"end", …}` via `dsh.executeTool` as the session's own
   agent; failure non-fatal (ONE warning); roles plugin must NOT write team records directly.
4. Settlement re-armable via in-memory `{planId, teamIdAtFire, firedAt}` cleared when the led team
   ends or the plan is approved; a restart re-evaluates.
5. Mid-session trigger: `no live team && consultCountSinceLastFire >= team.reteam.afterConsults
   (default 4)`, counting completed `mpd_role_spawn*` / `mpd_workmate_spawn` calls by THIS agent via
   the adapter per-tool hook, persisted at `<ws>/.mpd/session-gate/<sessionId>.json` as
   `{consultCount, lastFiredAt, planId, teamIdAtFire}`.
6. On fire: exactly ONE empty plan shell via existing `stagePlan()` (`agent_teams_plan create`,
   `approval:"required"`) + ONE notice marked `[AgentTeams] Re-team rule` naming trigger, count,
   plan id, inertness. Nothing else written; no member, no task.
7. `team.reteam.enabled` (default true) turns ONLY rules 5–6 off.
8. Never fires for a child session, headerless agent, or non-`mpd` preset.

### D2 — ASYNC one-shot consults
1. ONE new adapter seam `spawnAgentAsync(spec): Promise<DshAsyncAgent>` with
   `{id, result, interrupt()}`, same activation arm as `spawnAgent`, does NOT await
   `activation.result`, disposes on settle (success/failure/interrupt), registered in the adapter's
   frozen surface test.
2. `mpd_role_spawn` re-implemented ON TOP of the async seam, unchanged arguments and report shape,
   `status` enum gains `"interrupted"`.
3. New tool `mpd_role_spawn_async` → `{consultId, role, state:"running"}` immediately; consultId
   stable for process life.
4. New tool `mpd_role_consult` with actions `list`, `wait` (timeoutMs ≤ 60s), `collect` (releases),
   `cancel`.
5. Concurrency cap `MPD_DSH_CONSULT_MAX` default 8; exceeding it QUEUES, never throws.
6. Deadman `forceAfterMs` default 900 000 for EVERY consult, blocking or async: in-flight `bash` →
   no interrupt, ONE `consult-long-bash` warning + re-arm; otherwise handoff document at
   `<ws>/.mpd/handoff/consult-<consultId>-<UTC>.md` with the five stated sections (≤400 chars per
   argument excerpt), interrupt, settle `status:"interrupted"` with handoff path + last activity;
   never interrupt the parent or a child that is not this consult's.
7. Read-only deny lists (roles, workmate, cellwork verifier) gain BOTH new tool names; leaf rule
   stays.

### D3 — FORCE supervisor
1. `candidates()` indexes member sessions by name AND `executorRef` id, resolves session-id owners;
   §4 report-only fallback no longer fires for a healthy team.
2. `projectMpdTeam` carries `startedAt` + `updatedAt`; `wedged` decision `now - startedAt >=
   forceAfterMs` (default 900 000) for `in_progress`.
3. In-flight stamp records tool NAME; `bash` younger than `toolInFlightMaxMs` → exempt, one
   `long-bash` incident, no interrupt, re-evaluate after return; ONLY exemption.
4. Force action lives beside `runDispatchBody` in `team-actions.ts`: (a) handoff
   `<ws>/.mpd/handoff/<member>-<task>-<UTC>.md` with the six stated facts; (b) `executor().interrupt`
   for THAT member's handle only; (c) requeue pending with `attempt` bumped and `note` = handoff
   path; (d) split — ≥2 declared scopes → one pending task per scope, else exactly one continuation
   row, prefix `[split]`, owned by nobody, never auto-dispatched; (e) ONE mailbox row to the captain;
   (f) journal `wedged-force` + one incident record.
5. Captain never a force target.
6. `forceAfterMs: 0` disables; read live per tick.

### D0 — shared-base consequences (binding on all three)
1. D2 implemented inside the adapter's shared spawn path; no second code path.
2. `autoproject.slotBoundMs` default = 900 000; interrupted consult → handoff + `blocked`/`killed`
   slot record, not a silent `null`; `SlotKill` remains the only accounting.
3. D3 must NOT reimplement a stop; it calls the existing adapter interrupt seam.
4. cellwork inheritance by identity; team-core never writes the CELL record.
5. D1 covers the three planes via the same-session consult counter.
6. Cross-plane tests: one D2 deadman over an autoproject-style consult; one D3 force over a
   cell-backed member.

### Cross-cutting gates this verdict will require as evidence
- `bun run typecheck` (root) clean for touched packages (DOC-2 §4 Tests).
- `bun run verify:comments` clean (DOC-2 §4, standing, user-mandated; DOC-1 cross-cutting rule).
- Per-package `bun test` for touched packages (DOC-2 §4 Tests).
- `bun run verify:docs` if any human-facing doc changed (DOC-2 §4 Doc pairs).
- `bun run verify:manifest` if any manifest/patch/row/version changed.
- Dist freshness is the INTEGRATION owner's duty (DOC-1 cross-cutting rule); a work task leaving
  `dist/` stale is expected and is NOT a finding against D1/D2/D3 — but the wave cannot PASS without
  the integration arm.
- No test edited to pass, no gate weakened (DOC-1).

## Blindness declaration

At the instant this file was written I had read: the frozen contract (DOC-1) in full, `AGENTS.md`
(the injected manual), and directory listings (`ls .mpd/reviews`, `ls .mpd/plans`) plus the team
board readout (`agent_teams_plan status`). I had NOT read, grepped or listed any file under
`packages/**`, `scripts/**`, `skills/**` or any test. No implementation was known to me when the
criteria above were fixed.

## Known bound at basis time

The board showed `T2` (D2 work) `pending` with an inactive owner and `T1`/`T3` `in_progress`, so at
basis time D2 had no visible implementation. Any verdict will state whether D2 existed when read;
an absent or partial D2 is INCOMPLETE under DOC-1 ("Anything else is INCOMPLETE and must be reported
as such") and must not be reported as a PASS.
