# Supervision, re-teaming and async consults (long form)

Agent-facing reference. Short definitions live in `AGENTS.md` §1, §5 and §13; this file is the long
form for the three mechanisms shipped in the 2026-11-05 VEdit throughput wave. The measured incident
that motivated them is `evidence/throughput/vedit-incident-2026-11-05/report.md`; the frozen contract
is `.mpd/plans/vedit-throughput-fixes.md`.

Three planes (Agent Teams, cellwork, autoproject) converge on ONE adapter file,
`packages/mpd-dsh-adapter-plugin/src/index.ts`. Every mechanism below is placed on that shared base, so
a plane inherits it instead of re-implementing it.

## 1. Re-team: a session that has finished a team must be able to build the next one

Owner: `packages/mpd-roles-plugin/src/complexity-gate.ts` (pure) + `session-gate.ts` (wiring).

**"Leading" means a team that has NOT ended.** `readLeadingTeam` returns `leading:false` when:

- the record carries `endedAt` (an explicit `agent_teams_control end`), or
- the board is CLEAN-TERMINAL:
  `hasTasks = tasks.length > 0`, `allTerminal = every task completed|cancelled`,
  `noFailure = no task failed` → `cleanTerminal = hasTasks && allTerminal && noFailure`.

`hasTasks` is load-bearing. `every` over an empty array is vacuously true, so without it a MEMBERS-ONLY
team (approvable today — `approveTeam` refuses only "0 members AND 0 tasks") would read clean-terminal
and be auto-ended on the next pre-step. It also keeps the QA fixture
`skills/dsh-qa/scripts/session-start-team.ts` c7 (`members: 7`, `tasks: []`, `leading === true`) green
without touching `skills/**`.

**A `failed` task BLOCKS both the auto-end and the re-team.** The gate injects ONE notice asking for a
`kind=repair` row and does nothing else. A wave whose verification failed is never closed silently —
that is the answer to "could the last review FAIL and the team still be written as ended?".

**Auto-end**: a clean-terminal, member-bearing team with no `endedAt` is ended by the gate itself via
`agent_teams_control {action:"end"}` executed as the session's own agent (Lead authority, idempotent,
journaled). Failure is non-fatal: ONE warning, no retry loop. The roles plugin never writes a team
record directly.

**Settlement is re-armable.** The old once-per-process `acted` set is kept only as a derived settled
view; the settlement itself is a fire record `{planId, teamIdAtFire, firedAt}` cleared when the led team
ends or the plan is approved.

**Mid-session volume trigger.** Evaluated on every pre-step of a qualifying session
(`sessionQualifies`: captain rank + the `mpd` preset). Fires when there is no live team AND
`consultCount >= team.reteam.afterConsults` (default 4). `consultCount` counts COMPLETED
`mpd_role_spawn` / `mpd_role_spawn_async` / `mpd_workmate_spawn` calls made by THIS agent, observed
through the adapter's existing `onPostToolExecute((exec: DshToolExec) => …)` hook (`exec.name` selects
the tool, `exec.agent` attributes it). A failed or `AGENT_UNCONFIGURED` spawn does not count. State
persists in `<ws>/.mpd/session-gate/<sessionId>.json`, so a restart neither loses the count nor
re-nags.

On a fire the gate stages ONE empty plan shell through the existing `stagePlan()` ladder and injects ONE
notice marked `[AgentTeams] Re-team rule`. It creates no member and no task: the shell is INERT until
the captain extends and approves it. `team.reteam.enabled` (default true) gates only this volume
trigger; the ended-aware and auto-end rules stay in force regardless.

Because autoproject and cellwork execute their spawns AS THE SAME SESSION (`agent: exec?.agent`), their
work counts toward the same threshold — the trigger covers all three planes with no per-plane hook.

## 2. Async consults: several one-shot agents at once

Owner: `packages/mpd-roles-plugin/src/index.ts` + the adapter's async spawn seam.

`spawnAgent` keeps its documented BLOCKING contract (`run.result` awaited, normalized
`{output, structured, stopReason}`) and is re-expressed as the blocking projection
`spawnAgentAsync(spec).result`, so its consumers (`mpd_workmate_spawn`, cellwork's `cellwork_recon`) keep
their shapes while riding the same seam.

Surface:

| Tool | Behaviour |
|---|---|
| `mpd_role_spawn` | unchanged arguments and report shape; `status` may now be `"interrupted"` |
| `mpd_role_spawn_async` | returns `{consultId, role, state:"running"}` immediately |
| `mpd_role_consult` | `list` / `wait` (bounded ≤ 60 s) / `collect` (returns and releases) / `cancel` |

Concurrency is capped by `MPD_DSH_CONSULT_MAX` (default 8, the host's active-child limit); an over-cap
request queues rather than throwing.

**Deadman.** Every consult — blocking or async — is armed with a 15-minute bound
(`forceAfterMs`, default 900 000). On expiry:

- if the child's CURRENT tool call is `bash` and still in flight → **no interrupt**; record one
  `consult-long-bash` warning with the elapsed time and re-arm. There is NO age bound on this exemption:
  a legitimate verification run may take an hour.
- otherwise → write `.mpd/handoff/consult-<consultId>-<UTC instant>.md` (task, role, started, elapsed,
  last tool calls with argument excerpts, next step), interrupt the child, and settle the consult as
  `status:"interrupted"` carrying the handoff path.

The captain is never a target, and a consult never interrupts another consult's child.

**Autoproject** raises every child through `mpd_role_spawn`, so it inherits the surface with no code of
its own. Its slot ledger stays the only accounting: `autoproject.slotBoundMs` defaults to the SAME
900 000 bound (one ledger, not two timers), and an `interrupted` result produces the handoff plus a
blocked/killed slot record instead of a silent `null`.

The read-only deny list (roles, workmate, cellwork verifier) carries TEN names: `write`, `edit`,
`mpd_hashline_edit`, `bash`, `mcp__ast_grep__rewrite`, `mcp__ast_grep__scan`,
`mcp__lsp__rename_symbol`, `mcp__lsp__rename_symbol_strict`, `mpd_role_spawn_async`,
`mpd_role_consult` (the second is denied because `cancel` mutates another consult). A consult is a leaf:
the child gets the spawn tools denied in its own scope.

## 3. Force supervisor: 15 minutes, except an in-flight `bash`

Owner: `packages/mpd-team-watchdog-plugin/**` (decider) + `packages/mpd-team-core-plugin/src/team-actions.ts`
(action host).

Knobs: `forceAfterMs` (default 900 000; `0` disables; read live per tick), plus the existing
`toolInFlightMaxMs`, `warnSilenceMs`, `actionOnEscalate`.

**Owner identity.** `candidates()` indexes member sessions by BOTH the member NAME and the
`executorRef`/session id, and resolves an owner that IS a session id. This is the defect that produced
the VEdit incident: a member's own `claim` writes the session id as owner while the map was keyed by
name, so the lookup missed and the engine announced `PREDICATE FALLBACK (§4)` and degraded to a
REPORT-ONLY mode that can never hold or escalate.

**Duration.** `projectMpdTeam` carries the task's `startedAt` and `updatedAt`; a task in `in_progress`
whose elapsed time reaches `forceAfterMs` produces a `wedged` decision (once per task+attempt, with a
re-arm path for a failed action).

**Exemption.** The in-flight tool stamp records the tool NAME. While the in-flight tool is `bash`, the
member is exempt for as long as that call is open — no age bound — with ONE `long-bash` incident recorded
at the boundary. This is the only exemption.

**Action**, executed with `record.leadSessionId` as the authorising session (the watchdog holds no caller
agent; team-core publishes `mpdTeamActions`, and an absent service or missing lead session records the
incident and skips, non-fatally):

1. write `.mpd/handoff/<member>-<task>-<UTC instant>.md` (task, attempt, member, started, elapsed, last
   tool calls, review state);
2. `executor().interrupt(caller.agent, handle)` for THAT member only;
3. requeue the task `pending` with `attempt` bumped and a note naming the handoff;
4. SPLIT: one new pending, unowned task per declared write scope when the task declares two or more
   (each inheriting the handoff path); exactly one continuation task with subject prefix `[split]`
   otherwise;
5. message the captain (one mailbox row naming team, task, handoff and split rows);
6. journal `wedged-force` + one incident record.

Failure semantics: a handoff write failure aborts that member's force for this attempt (retry next tick,
at most once per attempt); an interrupt refusal is recorded and the action still requeues and splits; a
mailbox refusal (recipient past `mail.maxUndelivered`, default 8) is non-fatal — the journal row is the
durable notification and delivery is best-effort.

**The captain is NEVER a force target.** The rule covers team members only; one-shot consults are
supervised by the deadman in section 2.

## 4. Coverage matrix

| Plane | Raises a child through | Re-team | Async consults | 15-min force |
|---|---|---|---|---|
| Agent Teams | `teamExecutor.spawn` → `startContinuableChild` | yes (same session) | — | yes (watchdog) |
| cellwork seats | the same `teamExecutor.spawn` (a seat IS a team member) | yes (same session) | — | yes (watchdog, seat identity) |
| cellwork reseed / `cellwork_recon` | `startContinuableAgent` / `spawnAgent` | yes | yes (same seam) | yes (deadman) |
| autoproject | `mpd_role_spawn` → `spawnAgent` | yes (same session) | yes (inherited) | yes (deadman, `slotBoundMs` aligned) |
| workmate | `spawnAgent` | — | yes (same seam) | yes (deadman) |

## 5. What is NOT covered yet

- No cross-process supervision: a child started by another `dsh` process is invisible to this one.
- The deadman's kill path is counted and journaled; it is not a grace-period negotiation — there is no
  "ask the child to hand off first" phase. The handoff is written by the supervisor from observed state.
- The watchdog's record view is the MPD team record; a team row created by a non-executor path with no
  `executorRef` still has no identity to interrupt (the incident is recorded either way).
