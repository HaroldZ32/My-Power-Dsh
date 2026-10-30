# Team idle-member guard (P2a): a member with no task must not act

**Status:** FROZEN 2026-10-30 by the captain. Writer: dispatch-engine. Verifier: verifier-b. Docs: docs-qa;
the live QA case script is the P2a WRITER's (single `skills/**` writer). Branch:
`fix/team-idle-member-guard` (from `origin/dev`; independent of P1).

**Freeze note:** §3.1–3.3 + §3.5 are REQUIRED. §3.4 (lazy spawn) is optional and may be claimed only if
the live case proves no session exists before the first task dispatch; otherwise the one-turn bound in
§6.1 applies. The QA case script + its `skills/dsh-qa/SKILL.md` row are the writer's; docs-qa owns only
the README pair. The single `node scripts/repin-vendor.ts --write --i-know-this-is-the-captains-step` is
the captain's integration step, never a lane's.


**Incident (measured, 2026-10-30, this workspace):** the team plan approved 6 members with 1 task;
the team plane spawned all 6, and four members ran full turns without any board task — one wrote the
four doc twins ahead of its blocked T3 row, one ran a P2 seam probe, one drafted a P3 contract, one
pre-read the P2 contract. That burned tokens and resources for work the board had not authorised. The
captain's own off-board `send_message` wakes made two of those turns possible; the spawn-time turns made
the other two. Both halves need a mechanical guard, not a prose rule.

## 1. Goal

A session that is a team member but has NO task assigned on the live board performs ZERO tool calls and
ends its turn. Enforced at the tool boundary (a denial result), not by prompt wording. A taskless member
must not be able to read source, run a command, write a file, send a message or claim a task until the
board assigns it one. The spawn preamble is a second, cheaper layer; the live QA case proves the first.

## 2. Non-goals

- Cellwork auto-dispatch and the dispatcher itself (P2) — but the dispatcher/control seats are the
  declared exemption this guard must respect.
- Mail (P3), workmate (P4).
- Removing the one spawn turn unless lazy spawn (below) lands; the guard makes that turn harmless, and
  lazy spawn removes it.

## 3. Required behaviour

### 3.1 Pre-step idle detection (team-core)

A host-plane `agent/pre-step` listener in `packages/mpd-team-core-plugin` resolves the calling session:
- find the team(s) whose `members[].executorRef`/`sessionId` equals the session id (the same resolution
  `settleMember` already uses);
- read the live team record; the session has a TASK when some task has `owner === member.name` and
  `status` in `pending | claimed | in_progress`, or the member is the task's declared verifier with a
  `review` task in those states;
- if NO such task exists, inject exactly ONE directive (`enter` with one message): "You have no board
  task. Do not read, run, write, message or claim. End your turn now." and mark the session in a
  process-level `idleGuard` set.

The check must be conservative: an unknown team/record, a stopped/archived team, or a session that is the
team's `leadSessionId` is NOT marked idle (the captain/lead is not a member with tasks). A member whose
only task is `completed`/`cancelled` is idle.

### 3.2 Tool-boundary denial (the hard part)

The same row installs `dsh.guardTool(exec => string | undefined)` (the seam `installDelegationGate`
already uses). For a session in `idleGuard`, EVERY tool is denied with one line:
`"[mpd-team] no board task is assigned to you; end your turn and wait for a dispatch"`.
The denial is a tool RESULT, so the member cannot read, write, run, mail, claim or complete anything.
`agent_teams_task claim` is NOT exempt: a taskless member has nothing to claim; if a task is assigned,
the member is not in `idleGuard` (3.1). The mark is cleared:
- when the member is dispatched a task (the team dispatch path names the member and task), or
- when the member claims a task assigned to it, or
- on team stop/archive.

### 3.3 Spawn preamble (second layer)

The spawn prompt generated for `add_member` carries a fixed preamble before the caller's prompt:
"You are a team member. You have NO board task yet unless this spawn carries one. Do not read, run,
write, message or claim. Reply with one line and end your turn; the board will dispatch your task."
This is prose, not the guarantee; the 3.2 denial is the guarantee.

### 3.4 Lazy spawn (the stronger option, if it lands)

`agent_teams_plan approve` stages members WITHOUT spawning a session; the first `dispatchOwnerOnly`/
`agent_teams_dispatch` (or claim) that names a member spawns it, then sends the task. If implemented, the
idle spawn turn disappears entirely. If the executor cannot defer spawn safely, ship 3.1–3.3 and declare
the one-turn bound honestly. Do not claim lazy spawn unless the live case proves no session was created
before the first task dispatch.

### 3.5 Cellwork control-seat exemption

A cell's `cell-dispatcher` (P2) and a promoted subcaptain are team members with no board task but must
retain their control tools. The cellwork row registers a control-seat predicate with team-core (a
service method such as `registerControlSeat(sessionId)`), and 3.1/3.2 skip those sessions. Do NOT exempt
by a name prefix: the reservation must be an explicit registration, so an ordinary work member cannot
inherit it by being named `cell-*`. The cell-planner/cell-splitter are NOT control seats: they are
task-bound like any work member.

## 4. Tests and the live merge gate

Unit (team-core, offline):
- a taskless member pre-step injects the idle directive and marks the session; the guard denies `read`,
  `bash`, `write`, `agent_teams_mail`, `agent_teams_task` with the one-line text;
- a member with a `pending` task is NOT marked; a `claimed`/`in_progress` task is NOT marked; a
  `completed`-only member IS marked;
- a task dispatch clears the mark before the member's next step; a claim clears it; a team stop clears it;
- the lead/captain and a registered control seat are exempt; an unregistered `cell-*` name is NOT exempt;
- no false denial for a member whose task is assigned but not yet claimed (the dispatch turn must work).

Live QA case (merge gate, `skills/dsh-qa/scripts/`): approve a plan with TWO members and ONE ready task.
Assert from the harness session log, never model prose:
1. the task owner's session receives the task and works (a `tool/call` + non-error `tool/result`);
2. the taskless member's session log contains ZERO `tool/call` rows and the one idle directive;
3. if lazy spawn lands, the taskless member has NO session until a task is dispatched to it.
A skip is not a pass; if the live case cannot run, the guard is UNVERIFIED and must not be claimed.

## 5. Gates, docs, evidence

`bun test packages/mpd-team-core-plugin`, `bun run typecheck`, `bun run verify:comments`,
`bun run verify:docs`, `bun run test:qa`, the live case above, `node scripts/verify-dist-fresh.ts` after
the captain rebuilds dist, and the single `node scripts/repin-vendor.ts --write
--i-know-this-is-the-captains-step` if the QA case adds a `skills/**` row. Evidence under
`evidence/team/idle-member-guard/<UTC>/` (writer + verifier + live case). Update the team-core README pair
and any team docs that promise "a member acts only on its task"; no version bump unless released.

## 6. Declared bounds

1. Without lazy spawn, the spawn turn still costs one model turn; the guard makes it a one-directive turn
   with zero tools, not zero cost. This is the honest bound.
2. The pre-step runs on the team plane; a composition without the team-core row has no guard (a general
   harness limitation, stated).
3. The idle mark is process-local; a restart re-detects on the next pre-step. A task dispatched while the
   mark is set clears it; a crash between dispatch and clear re-detects.
4. A member with a task assigned but not yet claimed is allowed tools (otherwise the dispatch turn could
   not claim); this is the deliberate asymmetry, and the task's owner/status is the authority.
5. Verification blindness stays prose (repository standing bound).

## 7. Verifier instructions (verifier-b)

Read this contract and the team-core README pair first; do not read the implementation before recording
the verdict. Run the unit arms and inspect the live-case session log. Record PASS/FAIL with sources + a
gate evidence id; a FAIL needs findings with the doc source. A PASS must state whether lazy spawn landed
or the one-turn bound is declared.

## 8. Amendment 1 (pre-work, from the T5 requirement review; no code written yet)

The T5 requirement review accepted the contract with seven amendments. They are part of the acceptance
basis for T6 and T8; the verifier must judge against this section too.

A1. **Pre-step registration route.** A row-ctx `agent/pre-step` listener alone is not a reliable
subscriber (the session-start gate was measured silent on six live boots, 2026-09-27). The guard MUST use
the `packages/mpd-roles-plugin/src/session-gate.ts` route: `registerAgentPreStep(agent, ...)` for every
`liveAgents()` entry, re-armed on `agent/created` and disposed on `agent/disposed` (or the adapter's
equivalent proven route). The `tools.guard` is process-wide. A guard that is silently inert fails §4.

A2. **Mark lifecycle is re-evaluated both ways.** `dispatchOwnerOnly` delivers through
`TeamExecutor.send`, which team-core never observes, so the three explicit clears in §3.2 are not
sufficient. Every pre-step MUST re-evaluate: no open task (owner/verifier, status pending/claimed/
in_progress) → mark + inject the idle directive; an open task → CLEAR the mark and inject nothing. The
explicit clears remain optimisations. Add the arm: marked + assigned pending task + pre-step → cleared,
tools allowed (this prevents denying the member the `agent_teams_task claim` it needs first).

A3. **Fields.** Member rows carry `executorRef` (no `sessionId`); match by `executorRef` (the same
resolution `settleMember` uses) and accept an owner spelled `member.name` or `member.executorRef`. The
declared-verifier clause means the member is the `owner` of a `review` task in an open state; if a board
field cannot name it, drop the clause and say so.

A4. **Idle-terminal set.** `completed`, `cancelled` AND `failed` tasks do not make a member active.

A5. **§3.5 scope.** P2a ships the team-core registration API plus the unit arm "an unregistered `cell-*`
name is NOT exempt"; the cellwork registration call sites land in P2 (which owns the dispatcher). Do not
make P2a's acceptance depend on cellwork code that does not exist yet.

A6. **Preamble site.** The preamble is applied where the prompt is handed to the executor
(`approve`/spawn), not where `add_member` stores the row.

A7. **Live-case risk.** The case must raise TWO members through a real approve and confirm the local
model stub serves both member turns EARLY (one turn each, then idle). A skip is not a pass; the case is
the merge gate.

