// @ts-nocheck -- vendored upstream body: renamed to .ts for this repository's source-language rule, never typed here.
/**
 * Event-driven shared task scheduler.
 *
 * Claude Code teammates keep polling the shared task list after a turn. DSH
 * continuable agents instead expose explicit idle/running edges, so this
 * scheduler closes the same loop without keeping a polling turn alive: every
 * idle edge and every task-graph mutation attempts one atomic claim and wakes
 * the selected durable member. A resident member that becomes idle while it
 * still owns an open attempt is parked: only an explicit captain reassignment
 * may rotate that capability. Automatic retry is reserved for cold recovery,
 * when the durable owner is no longer resident in the live Agent registry.
 * @module dsh-agent-teams/scheduler
 */
import { join } from 'node:path';
import { deliverToMember } from "./members.ts";
import { acknowledgeMailbox, beginTaskAttempt, CAPTAIN_KEY, claimMailboxDelivery, expireInterjections, findTeamByParticipant, INTERJECTION_KIND, invalidateTaskAttempt, readTeam, readUnreadMailbox, releaseMailboxDelivery, resolveCancelledDependencyDeadlocks, unsatisfiedDependencies, withTeamLock, writeTeam, } from "./state.ts";
//#region mpd-delta terminal-dispatch-import (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
// T-07 (wave 1, t36): the delivery-boundary re-check needs the ONE terminal-status list, from
// the module that owns it, so the scheduler can never drift from the tool layer's definition.
import { TERMINAL_TASK_STATUSES, isNonDispatchableKind } from "./types.ts";
//#endregion mpd-delta terminal-dispatch-import
/** Per-dependency output cap in the assignment prompt. */
export const DEPENDENCY_OUTPUT_MAX_CHARS = 2_000;
/** Combined dependency-output budget in the assignment prompt. */
export const DEPENDENCY_OUTPUTS_TOTAL_MAX_CHARS = 12_000;
function taskProfileSeedId(task) {
    const seed = task.profileSeedId?.trim();
    return seed === undefined || seed === '' ? undefined : seed;
}
function teamProfileProtocol(team) {
    return team.profile?.protocol;
}
/**
 * Recursively collect `status=completed` ancestors of `taskId` in topological
 * order (dependencies before dependents). Cycles stop that branch only.
 * When the dispatched task names a `reasonTaskId` (a failed review whose
 * findings justify a repair / follow-up review), a labeled reason item with
 * that task's output and findings is appended — the reason must reach the
 * repair prompt even though the failed review is deliberately not a dependency.
 */
export function collectCompletedDependencyOutputs(tasks, taskId, warn) {
    const byId = new Map(tasks.map(task => [task.id, task]));
    const visiting = new Set();
    const visited = new Set();
    const ordered = [];
    const walk = (id) => {
        if (visiting.has(id)) {
            warn?.(`agent-teams: dependency cycle involving "${id}" while collecting outputs; stopping this branch`);
            return;
        }
        if (visited.has(id))
            return;
        visiting.add(id);
        const task = byId.get(id);
        if (task !== undefined) {
            for (const dependency of task.dependencies)
                walk(dependency);
            if (id !== taskId)
                ordered.push(task);
        }
        visiting.delete(id);
        visited.add(id);
    };
    walk(taskId);
    const items = ordered
        .filter(task => task.status === 'completed')
        .map((task) => {
        const profileSeedId = taskProfileSeedId(task);
        return {
            id: task.id,
            subject: task.subject,
            ...profileSeedId === undefined ? {} : { profileSeedId },
            ...task.output === undefined ? {} : { output: task.output },
        };
    });
    const task = byId.get(taskId);
    const reasonId = task?.reasonTaskId;
    if (reasonId !== undefined) {
        const reason = byId.get(reasonId);
        if (reason !== undefined) {
            items.push({
                id: reason.id,
                subject: `${reason.subject} (reason, verdict=${reason.verdict ?? 'unknown'})`,
                output: formatReasonTask(reason),
            });
        }
    }
    return items;
}
/** Format a failed review as reason material: its output plus unresolved findings. */
function formatReasonTask(task) {
    const lines = [];
    if (task.output !== undefined && task.output !== '')
        lines.push(`Output:\n${task.output}`);
    const findings = (task.findings ?? []).filter((finding) => finding.resolved !== true);
    if (findings.length > 0) {
        lines.push(`Findings (${task.verdict ?? 'needs_revision'}):`);
        for (const finding of findings) {
            const where = finding.file === undefined ? '' : ` (${finding.file}${finding.line === undefined ? '' : ':' + finding.line})`;
            lines.push(`- [${finding.severity}] ${finding.id}: ${finding.problem}${where}\n  Fix: ${finding.requiredFix}`);
        }
    }
    return lines.length > 0 ? lines.join('\n') : '(no output recorded)';
}
/** Format completed-dependency outputs with per-item and total truncation. */
export function formatDependencyOutputs(items) {
    if (items.length === 0)
        return '(none)';
    const formatted = items.map((item) => {
        const seed = item.profileSeedId === undefined ? '' : ` [${item.profileSeedId}]`;
        const raw = item.output === undefined || item.output === ''
            ? '(no output recorded)'
            : item.output;
        const truncated = raw.length > DEPENDENCY_OUTPUT_MAX_CHARS;
        const body = truncated ? `${raw.slice(0, DEPENDENCY_OUTPUT_MAX_CHARS)} [truncated]` : raw;
        return `- ${item.id}${seed} ${item.subject}:\n  ${body}`;
    });
    let selected = formatted;
    while (selected.length > 1 && selected.join('\n').length > DEPENDENCY_OUTPUTS_TOTAL_MAX_CHARS) {
        selected = selected.slice(1);
    }
    const last = selected[0];
    if (selected.length === 1 && last !== undefined && last.length > DEPENDENCY_OUTPUTS_TOTAL_MAX_CHARS) {
        selected = [`${last.slice(0, DEPENDENCY_OUTPUTS_TOTAL_MAX_CHARS)} [truncated]`];
    }
    return selected.join('\n');
}
function stateRootOf(workspace, config) {
    return join(workspace, config.stateDir);
}
function teamLockKey(stateRoot, teamId) {
    return `team:${stateRoot}:${teamId}`;
}
//#region mpd-delta watchdog-hold-reader (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
/**
 * The team watchdog's PRESERVING hold, read through the watchdog's OWN service.
 *
 * `ctx.get(name, false)` is cordis's inject-free lookup (`Context#get`: "Read a
 * service from the store without the inject requirement"), so a host-plane row can
 * consult another host-plane row's service without declaring it — which matters here,
 * because this gate lives in adopted code whose `inject` list is not ours to change.
 *
 * The SERVICE is the only read this gate performs:
 *   * synchronous and non-throwing;
 *   * hydrated at its own row's apply and updated on every hold/resume THAT process
 *     performs, and it falls back to the durable `watchdog/hold/<teamId>.json` record
 *     itself for a hold another process wrote (the view reports which it used).
 *
 * FAIL-OPEN (binding): with the watchdog row absent the service is undefined, so this
 * gate reads NOTHING — a hold-looking file on disk alone changes no dispatch decision —
 * and a throwing reader is swallowed. Dispatch then behaves exactly as it does today.
 *
 * @param ctx - the plugin context (the service store).
 * @param teamId - the team to ask about.
 * @param workspace - that team's workspace (one host serves many sessions).
 * @returns the hold view, or undefined when the team is not held.
 */
const WATCHDOG_HOLD_SERVICE = "mpdWatchdog";
function watchdogHoldOf(ctx, teamId, workspace) {
    try {
        const watchdog = typeof ctx?.get === 'function' ? ctx.get(WATCHDOG_HOLD_SERVICE, false) : undefined;
        const view = typeof watchdog?.isHeld === 'function' ? watchdog.isHeld(teamId, workspace) : undefined;
        if (view === undefined || view === null || view.held !== true)
            return undefined;
        return {
            holdId: String(view.holdId ?? ''),
            at: typeof view.at === 'number' ? view.at : 0,
            reason: String(view.reason ?? ''),
            source: view.source === undefined ? null : String(view.source),
        };
    }
    catch {
        return undefined;
    }
}
//#endregion mpd-delta watchdog-hold-reader
function liveCaptain(ctx, captainSessionId, supplied) {
    if (supplied !== undefined && supplied.id === captainSessionId)
        return supplied;
    return ctx.agents.get(captainSessionId);
}
function liveMember(ctx, member) {
    return ctx.agents.get(member.id);
}
//#region mpd-delta dispatch-decline-guard (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
/** One `dispatch declined` line per (team, member, reason) per process. */
const dispatchDeclineNotes = new Set();
/** Bound on that set: a long-lived multi-session host must not grow it without limit. */
const DISPATCH_DECLINE_NOTE_MAX = 512;
/**
 * Record WHY one kick declined to deliver a ready task.
 *
 * Every early return of the dispatch chain used to be a silent `return`, so a team parked
 * on a READY task was indistinguishable from a team with nothing to do. Measured live on
 * 2026-09-14 (team mpd-default): the post-approval kick found all six just-spawned members
 * inside their spawn/welcome turn, declined at the availability guard for every one of them
 * and delivered nothing for 59.3 s without a single log line — the captain read that as a
 * permanent stall and "fixed" it with a manual reassignment that interrupted the attempt
 * the idle edge had just delivered.
 *
 * Logged at `warn` and deduped per (team, member, reason): the FIRST occurrence — the one
 * that matters — is never lost, while a hot kick loop cannot flood the log.
 * @param logger - the plugin context logger (absent in some unit fixtures).
 * @param teamId - the team whose dispatch declined.
 * @param memberName - the addressed member, the session id for an idle edge, or `*`.
 * @param reason - the concrete condition that was false.
 */
function noteDispatchDecline(logger, teamId, memberName, reason) {
    const key = `${teamId}\u0000${memberName}\u0000${reason}`;
    if (dispatchDeclineNotes.size >= DISPATCH_DECLINE_NOTE_MAX)
        dispatchDeclineNotes.clear();
    if (dispatchDeclineNotes.has(key))
        return;
    dispatchDeclineNotes.add(key);
    logger?.warn?.(`agent-teams: dispatch declined for ${teamId}/${memberName}: ${reason}`);
}
/**
 * How the live Agent registry sees one member right now.
 *
 * The upstream `isMemberAvailable` treated EVERY non-idle live Agent as unavailable, so the
 * approval-time kick — which necessarily runs while the just-spawned members are still
 * inside their spawn/welcome turn — delivered nothing and returned silently. Task delivery
 * here is a QUEUED next turn (`queueMemberPrompt` -> `delivery: 'queue'`; the host's own
 * contract: "queue delivery targets a later turn"), so a member that is merely running its
 * own turn accepts it. Only a member that already owns an open attempt is genuinely
 * unavailable, because re-delivering would rotate that capability and duplicate the
 * assignment; the caller applies that second test against the durable task list, inside the
 * team lock. `cold` (no live Agent) keeps the upstream behaviour: eligible for one cold
 * recovery.
 * @param ctx - plugin context whose `agents` registry holds the live Agents.
 * @param member - the member whose child session id addresses the Agent.
 * @returns 'cold' | 'idle' | 'busy'.
 */
function memberActivity(ctx, member) {
    const live = liveMember(ctx, member);
    if (live === undefined)
        return 'cold';
    return live.status === 'idle' ? 'idle' : 'busy';
}
//#endregion mpd-delta dispatch-decline-guard
function ownedOpenTask(tasks, memberName) {
    return tasks.find(task => task.assignee === memberName
        && (task.status === 'claimed' || task.status === 'in_progress'));
}
//#region mpd-delta ready-task-predicate (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
/**
 * The scheduler's readiness predicate as a named, testable export: a task is
 * dispatchable when it is `pending`, not mid-reassignment, and no dependency still
 * BLOCKS it (OPT-1: a failed dependency does not block). S3's task-level resume
 * contract is exactly this predicate — a terminal task is never `pending`, so a
 * restarted process cannot re-run finished work — and the tests call it directly
 * instead of duplicating the filter inline.
 * @param tasks - the team's tasks.
 * @param task - the candidate task.
 * @returns true when the scheduler may dispatch it.
 */
export function isTaskReady(tasks, task) {
    return task.status === 'pending'
        // T-13 (wave 2b, t27): a deferred task is never offered to a seat. The filter keys on the
        // task's OWN kind, so the same shape WITHOUT the kind stays dispatchable (the negative
        // control the T-13 acceptance names).
        && !isNonDispatchableKind(task)
        && task.reassigning !== true
        && unsatisfiedDependencies([...tasks], task.dependencies).length === 0;
}
//#endregion mpd-delta ready-task-predicate
//#region mpd-delta pool-capability-guard (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
/**
 * What a task NEEDS to be executable, and what a member's `toolDeny` withholds.
 *
 * DEFECT (measured 2026-09-14, twice — the read-only Architect and Reviewer members
 * were handed pooled implementation tasks): the pool branch of `nextReadyTask` offers
 * the first ready task with no capability test, so a read-only member (the roster's six
 * read-only roles carry the seven write-capable names in `toolDeny`) received a write
 * task it could not execute, discovered the denial mid-turn and had to be reassigned
 * after its attempt was already rotating.
 *
 * The need is read from the task itself: a WRITE half from `kind`
 * (implementation/repair) or from a declared `inScope`; an EXECUTION half (verify
 * commands) from a declared `verify`. Only the tool names that make those halves
 * possible take part in the comparison.
 * @param task - the candidate task.
 * @returns which halves the task needs.
 */
export function taskCapabilityNeed(task) {
    return {
        writes: task.kind === 'implementation' || task.kind === 'repair' || (task.inScope ?? []).length > 0,
        exec: (task.verify ?? []).length > 0,
    };
}
/**
 * The tools a task needs that this member's `toolDeny` withholds (empty = it can run it).
 * @param task - the candidate task.
 * @param member - the member about to be woken, or undefined when unknown.
 * @returns the withheld tool names, in the order they are reported.
 */
// T-93 (wave 2b, lane A): EXPORTED so the generator's own seat filter (`lib/quality-gates.ts`,
// `mpd-delta repair-seat-capability`) can be asserted EQUAL to the dispatch's read on a fixture
// matrix — the same read, with the equivalence pinned rather than assumed.
export function taskCapabilityGap(task, member) {
    const denied = new Set(member?.toolDeny ?? []);
    const need = taskCapabilityNeed(task);
    const missing = [];
    if (need.writes)
        for (const tool of ['write', 'edit', 'mpd_hashline_edit'])
            if (denied.has(tool))
                missing.push(tool);
    if (need.exec && denied.has('bash'))
        missing.push('bash');
    return missing;
}
/**
 * The capability-aware pool selection the dispatch uses.
 *
 * The member's OWN task always wins: an explicit assignment is the captain's decision,
 * so it is dispatched even to a restricted member — LOUDLY, because that pairing is a
 * defect the captain should see before the member reports it. A POOLED task is
 * different: it belongs to whoever can run it, so a candidate this member cannot
 * execute is reported and LEFT IN THE POOL instead of being delivered.
 * @param tasks - the team's tasks.
 * @param member - the member about to be woken.
 * @param onWithhold - called as `(task, gap, explicit)` per skipped candidate.
 * @returns the task to deliver, or undefined when nothing is left for this member.
 */
export function nextCapableTask(tasks, member, onWithhold) {
    const reported = new Set();
    const withhold = (task, gap, explicit) => {
        if (reported.has(task.id))
            return;
        reported.add(task.id);
        onWithhold(task, gap, explicit);
    };
    // The upstream selection stays the entry point: it owns the member's own-task
    // preference and the pool order, and this guard only widens the pool scan.
    const candidate = nextReadyTask(tasks, member.name);
    if (candidate === undefined)
        return undefined;
    if (candidate.assignee === member.name) {
        const ownGap = taskCapabilityGap(candidate, member);
        if (ownGap.length > 0)
            withhold(candidate, ownGap, true);
        return candidate;
    }
    for (const task of tasks.filter(entry => isTaskReady(tasks, entry) && entry.assignee === undefined)) {
        const gap = taskCapabilityGap(task, member);
        if (gap.length > 0) {
            withhold(task, gap, false);
            continue;
        }
        return task;
    }
    return undefined;
}
//#endregion mpd-delta pool-capability-guard
function nextReadyTask(tasks, memberName) {
    const ready = tasks.filter(task => isTaskReady(tasks, task));
    return ready.find(task => task.assignee === memberName)
        ?? ready.find(task => task.assignee === undefined);
}
//#region mpd-delta reoffer-terminal-route (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
/**
 * T-93 (wave 2b, lane A): the ROUTING CLASS of one delivery, keyed on BOTH halves.
 *
 * The family this classifies, measured on this wave's own surfaces and tallied in the captain's
 * ledger: a delivery reaches a seat for work it cannot do, and the seat spends its turn proving that
 * instead of doing the ready task the re-offer displaced. The two halves are load-bearing and the
 * wave has ONE measurement for each, so neither alone covers both surfaces:
 *
 *  - TERMINALITY (`task.status` is terminal): terminal work can never be claimed — the platform's own
 *    refusal text is `task status cannot move from "completed"|"failed" to "claimed"` — so no delivery
 *    of it can be worked at all.
 *  - EQUALITY (`delivery.attemptId === task.attemptId`): the delivery carries the capability the task
 *    ALREADY records, i.e. the id its completion recorded. A REASSIGNMENT mints a FRESH attempt id
 *    (`invalidateTaskAttempt` re-opens the task, then `beginTaskAttempt` mints), and the kick compose
 *    always mints too (lane C's t17: `48c3f297…`/`251420e9…` against the completion's `7c133ef3…`), so
 *    the equality is what distinguishes a RE-OFFER of finished work from a ticket that merely lost its
 *    generation. A fix keyed only on terminality refuses both surfaces but cannot name either; a fix
 *    keyed only on the equality says nothing about the kick surface (unmeasurable there).
 *
 * @param tasks - the team's tasks, read under the same lock as the decision.
 * @param delivery - `{ taskId, attemptId }` of the composed delivery.
 * @returns `undefined` when the delivery may be handed over; otherwise the class name —
 *  `'reoffer-terminal-same-attempt'` (finished work re-offered with its own completed id: refuse,
 *  report, never re-work), `'terminal-rotated'` (the task became terminal before delivery, T-07's
 *  compose/wake race) or `'rotated'` (the generation moved on), or `'task-gone'`.
 */
export function deliveryRoutingClass(tasks, delivery) {
    const current = tasks.find((candidate) => candidate.id === delivery.taskId);
    if (current === undefined)
        return 'task-gone';
    const terminal = TERMINAL_TASK_STATUSES.includes(current.status);
    // EXACT equality, with no special case for an absent id: this reproduces the pre-T-93 decision
    // table branch for branch (it refused on `current.attemptId !== ticket.attemptId`), so the fix
    // CLASSIFIES a delivery without moving any edge of the existing refusals.
    const sameAttempt = current.attemptId === delivery.attemptId;
    if (terminal && sameAttempt)
        return 'reoffer-terminal-same-attempt';
    if (terminal)
        return 'terminal-rotated';
    if (!sameAttempt)
        return 'rotated';
    return undefined;
}
//#endregion mpd-delta reoffer-terminal-route
export function assignmentPrompt(ticket, stateDir, teamId) {
    const description = ticket.description === undefined ? '' : `\n\n${ticket.description}`;
    const seed = ticket.profileSeedId === undefined ? '' : ` [${ticket.profileSeedId}]`;
    const goal = ticket.teamDescription?.trim() || '(not provided)';
    const protocol = ticket.profileProtocol?.trim() || '(none)';
    const executionPrompt = ticket.executionPrompt?.trim();
    const kind = ticket.kind?.trim() || 'work';
    const contract = [
        `Kind: ${kind}${ticket.round === undefined ? '' : ` (round ${ticket.round})`}`,
        ticket.objective === undefined || ticket.objective === '' ? '' : `Objective: ${ticket.objective}`,
        ticket.inScope === undefined || ticket.inScope.length === 0 ? '' : `In scope: ${ticket.inScope.join(', ')}`,
        ticket.outOfScope === undefined || ticket.outOfScope.length === 0 ? '' : `Out of scope: ${ticket.outOfScope.join(', ')}`,
        ticket.acceptance === undefined || ticket.acceptance.length === 0 ? '' : `Acceptance: ${ticket.acceptance.join('; ')}`,
        ticket.verify === undefined || ticket.verify.length === 0 ? '' : `Verify: ${ticket.verify.join('; ')}`,
        ticket.reviewedTaskId === undefined ? '' : `Reviewed task: ${ticket.reviewedTaskId}`,
        ticket.reassignReason === undefined || ticket.reassignReason === '' ? '' : `Reassignment reason: ${ticket.reassignReason}`,
    ].filter((line) => line !== '').join('\n');
    const structuredCompletion = ['implementation', 'repair', 'verification', 'integration'].includes(kind)
        ? `
Structured completion payload (keep these arrays in contract order):
acceptanceResults: ${JSON.stringify((ticket.acceptance ?? []).map((criterion) => ({ criterion, status: 'passed', evidence: '<what proved it>' })))}
commandsRun: ${JSON.stringify((ticket.verify ?? []).map((command) => ({ command, status: 'passed', exitCode: 0, evidence: '<observed result>' })))}
${kind === 'implementation' || kind === 'repair' ? 'changedPaths: list the actual workspace-relative POSIX paths you changed.\n' : ''}`
        : '';
    return `AgentTeams automatic task assignment from the shared task list.

You are executing as configured member "${ticket.memberName}".
Do not start a teammate's assigned task.

Team goal:
${goal}

Profile protocol:
${protocol}
${executionPrompt === undefined || executionPrompt === '' ? '' : `
Execution guidance:
${executionPrompt}
`}
Completed dependency results:
${formatDependencyOutputs(ticket.dependencyOutputs)}
${ticket.captainMessages === undefined || ticket.captainMessages.length === 0 ? '' : `
Captain guidance (unread, delivered with this assignment):
${ticket.captainMessages.map((message) => `- ${message.content}`).join('\n')}
`}
Task: ${ticket.taskId}${seed} — ${ticket.subject}${description}
${contract === '' ? '' : `\nContract:\n${contract}\n`}
${structuredCompletion}
Attempt: ${ticket.attempt}
Attempt id: ${ticket.attemptId}

Call agent_teams_claim_task for ${ticket.taskId}; it will return this same attempt_id. Include attempt_id=${ticket.attemptId} in every agent_teams_update_task call. If it is rejected as stale, stop work because the task was reassigned. claimed cannot jump to completed. Mark in_progress first, then completed or failed. Include attempt_id on every update. Then send_message to captain and become idle.
When finishing: use status=completed only when the task's success criteria are satisfied; use status=failed when blocking findings or validation failures mean downstream work must not proceed; include a concise output in either case. Quality kinds must submit structured fields: review/requirements need verdict=pass to complete (needs_revision/reject must fail with findings); implementation/repair/verification/integration need acceptanceResults and commandsRun, while implementation/repair also need in-scope changedPaths. Use status values "passed" or "failed" inside those arrays. After the work and verification finish, call agent_teams_update_task immediately; do not wait for captain confirmation and do not continue exploring. Do not approve your own implementation. Mail is not a formal next review. Treat the dependency results above as source material. Do not ignore them. Work only this task and only its in-scope paths in this turn.

State policy: ${stateDir}/${teamId}/ is read-only diagnostics; mutate team state only through agent_teams_* tools.`;
}
//#region mpd-delta interjection-not-auto-delivered (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
/**
 * R1: drop interjection REQUESTS from an auto-delivery unread set.
 *
 * `fallbackMailboxPrompt` packs EVERY unread mailbox record verbatim and the
 * scheduler delivers it at the next idle edge, so a request written into an ordinary
 * inbox would be delivered WITHOUT the captain's approval. Pending requests are
 * therefore filtered out of both auto-delivery reads; they reach a member only after
 * `decideInterjection(..., 'approved')` re-posts them as an ordinary message.
 *
 * A cleared TOMBSTONE is dropped here as well, not only inside `readUnreadMailbox`:
 * this function is the scheduler's LAST gate before a wake-up, so it stays correct
 * even if it is handed a record set that still contains cleared rows (e.g. a caller
 * reading `readMailbox` directly). Belt-and-braces on the delivery boundary.
 * @param messages - unread mailbox records.
 * @returns the records that may auto-deliver.
 */
function deliverableUnread(messages) {
    return messages.filter((message) => message.kind !== INTERJECTION_KIND && message.tombstone !== true);
}
//#endregion mpd-delta interjection-not-auto-delivered
function fallbackMailboxPrompt(messages) {
    return [
        'AgentTeams delivered messages that were persisted while live delivery was unavailable:',
        ...messages.map(message => `\nFrom ${message.from}:\n${message.content}`),
        '\nHandle these messages in this turn. Task assignments still require agent_teams_claim_task and the current attempt_id.',
    ].join('\n');
}
/** Install one scheduler and its member activity observer. */
export function installTeamScheduler(ctx, config) {
    const memberQueues = new Map();
    // An idle edge observed by this scheduler parks the exact open capability.
    // Harness may dispose its AgentHandle after settlement, so registry absence
    // is not evidence that the owner was lost. Keep the marker sticky across
    // later kicks; only a durable attempt that this process has not observed is
    // eligible for one cold recovery. A cold process starts with an empty map,
    // so durable open attempts are still recovered after restart.
    const parkedAttempts = new Map();
    const memberQueueKey = (stateRoot, teamId, memberName) => (`${stateRoot}\u0000${teamId}\u0000${memberName}`);
    const serializeMember = async (key, operation) => {
        const previous = memberQueues.get(key) ?? Promise.resolve();
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        const tail = previous.then(() => gate);
        memberQueues.set(key, tail);
        await previous;
        try {
            return await operation();
        }
        finally {
            release();
            if (memberQueues.get(key) === tail)
                memberQueues.delete(key);
        }
    };
    const runtime = {
        //#region mpd-delta kick-team-decline-logs (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
        async kickTeam(workspace, teamId, suppliedCaptain) {
            const stateRoot = stateRootOf(workspace, config);
            const team = await readTeam(stateRoot, teamId);
            if (team === undefined)
                return noteDispatchDecline(ctx.logger, teamId, '*', 'no team record exists at this state root');
            if (team.halted === true)
                return noteDispatchDecline(ctx.logger, teamId, '*', 'the team is halted');
            if (team.phase === 'staged')
                return noteDispatchDecline(ctx.logger, teamId, '*', 'the team is still staged; approval has not committed yet');
            const teamHold = watchdogHoldOf(ctx, teamId, workspace);
            if (teamHold !== undefined)
                return noteDispatchDecline(ctx.logger, teamId, '*', `the team is held by the team watchdog (hold ${teamHold.holdId} since ${new Date(teamHold.at).toISOString()}: ${teamHold.reason})`);
            const captain = liveCaptain(ctx, team.captainSessionId, suppliedCaptain);
            if (captain === undefined)
                return noteDispatchDecline(ctx.logger, teamId, '*', 'no live captain session is resolvable, so no member turn can be authorized');
        //#endregion mpd-delta kick-team-decline-logs
            for (const member of team.members) {
                if (member.status === 'removed')
                    continue;
                await runtime.kickMember(workspace, teamId, member.name, captain);
            }
        },
        async kickMember(workspace, teamId, memberName, suppliedCaptain) {
            const stateRoot = stateRootOf(workspace, config);
            //#region mpd-delta interjection-expiry-tick (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
            // R1: the scheduler's idle edge IS the clock for "captain silence = DENY". An
            // expired request flips pending -> expired and notifies the requester; the tick
            // is best-effort so a bookkeeping failure can never block a real wake-up.
            try {
                const expired = await expireInterjections(stateRoot, teamId);
                if (expired.length > 0)
                    ctx.logger?.info?.(`agent-teams: expired ${expired.length} unanswered interjection request(s): ${expired.join(', ')}`);
            }
            catch (error) {
                ctx.logger?.warn?.(`agent-teams: interjection expiry tick failed: ${String(error)}`);
            }
            //#endregion mpd-delta interjection-expiry-tick
            const queueKey = memberQueueKey(stateRoot, teamId, memberName);
            await serializeMember(queueKey, async () => {
                let team = await readTeam(stateRoot, teamId);
                if (team === undefined || team.halted === true || team.phase === 'staged')
                    return;
                //#region mpd-delta kick-member-hold-decline (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
                // The team watchdog's PRESERVING hold, honoured where every other
                // dispatch decline is honoured. It stops NEW work and touches nothing.
                const memberHold = watchdogHoldOf(ctx, teamId, workspace);
                if (memberHold !== undefined) {
                    noteDispatchDecline(ctx.logger, teamId, memberName, `the team is held by the team watchdog (hold ${memberHold.holdId} since ${new Date(memberHold.at).toISOString()}: ${memberHold.reason})`);
                    return;
                }
                //#endregion mpd-delta kick-member-hold-decline
                const captain = liveCaptain(ctx, team.captainSessionId, suppliedCaptain);
                if (captain === undefined)
                    return;
                //#region mpd-delta kick-member-decline-logs (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
                let member = team.members.find(candidate => candidate.name === memberName && candidate.status !== 'removed');
                if (member === undefined)
                    return noteDispatchDecline(ctx.logger, team.id, memberName, 'the member is not an active member of this team');
                if (member.id === '')
                    return noteDispatchDecline(ctx.logger, team.id, memberName, 'the member has no spawned child session yet');
                // A member that is merely mid-turn can still ACCEPT a queued assignment
                // (this is the approval-time case); only one that already owns an open
                // attempt is genuinely unavailable.
                if (memberActivity(ctx, member) === 'busy' && ownedOpenTask(team.tasks, memberName) !== undefined)
                    return noteDispatchDecline(ctx.logger, team.id, memberName, 'the member is running the turn of an attempt it already owns');
                //#endregion mpd-delta kick-member-decline-logs
                // A mailbox-only fallback is real pending work. Deliver it before a
                // fresh task and acknowledge only after Harness accepts the follow-up.
                const unread = deliverableUnread(await readUnreadMailbox(stateRoot, team.id, member.name));
                if (unread.length > 0) {
                    await withTeamLock(teamLockKey(stateRoot, team.id), () => (claimMailboxDelivery(stateRoot, team.id, member.name, unread.map(message => message.id))));
                    const accepted = await deliverToMember(ctx, captain, member.id, fallbackMailboxPrompt(unread), new AbortController().signal);
                    if (accepted) {
                        await withTeamLock(teamLockKey(stateRoot, team.id), () => (acknowledgeMailbox(stateRoot, team.id, member.name, unread.map(message => message.id))));
                    }
                    else {
                        await withTeamLock(teamLockKey(stateRoot, team.id), () => (releaseMailboxDelivery(stateRoot, team.id, member.name, unread.map(message => message.id))));
                    }
                    return;
                }
                const ticket = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                    //#region mpd-delta kick-member-locked-decline-logs (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
                    const fresh = await readTeam(stateRoot, team.id);
                    if (fresh === undefined)
                        return noteDispatchDecline(ctx.logger, team.id, memberName, 'the team record disappeared while this kick waited for the lock');
                    if (fresh.halted === true)
                        return noteDispatchDecline(ctx.logger, team.id, memberName, 'the team was halted while this kick waited for the lock');
                    if (fresh.phase === 'staged')
                        return noteDispatchDecline(ctx.logger, team.id, memberName, 'the team returned to staged while this kick waited for the lock');
                        const lockedHold = watchdogHoldOf(ctx, team.id, workspace);
                        if (lockedHold !== undefined)
                            return noteDispatchDecline(ctx.logger, team.id, memberName, `the team is held by the team watchdog (hold ${lockedHold.holdId} since ${new Date(lockedHold.at).toISOString()}: ${lockedHold.reason})`);
                    const currentMember = fresh.members.find(candidate => candidate.name === memberName && candidate.status !== 'removed');
                    if (currentMember === undefined)
                        return noteDispatchDecline(ctx.logger, team.id, memberName, 'the member left the team while this kick waited for the lock');
                    if (currentMember.id === '')
                        return noteDispatchDecline(ctx.logger, team.id, memberName, 'the member has no spawned child session yet');
                    const owned = ownedOpenTask(fresh.tasks, currentMember.name);
                    if (memberActivity(ctx, currentMember) === 'busy' && owned !== undefined)
                        return noteDispatchDecline(ctx.logger, team.id, memberName, 'the member is running the turn of an attempt it already owns');
                    //#endregion mpd-delta kick-member-locked-decline-logs
                    // Resolve cancelled-dependency deadlocks before selecting the
                    // next ready task: a pending task blocked only by cancelled
                    // prerequisites would never become ready and would block
                    // delivery forever (see state.resolveCancelledDependencyDeadlocks).
                    const deadlockVictims = resolveCancelledDependencyDeadlocks(fresh.tasks, `dependency was cancelled; task released from the pending pool`);
                    // A resident idle member can intentionally leave an attempt open
                    // while waiting for guidance, or because the user paused its turn.
                    // Re-dispatching here would revoke still-valid work on every idle
                    // edge and every status kick. The idle observer parks that exact
                    // capability across normal continuable disposal; only an unobserved
                    // durable capability (cold process recovery) or a legacy open task
                    // with no capability is retried.
                    const parkedAttemptId = parkedAttempts.get(currentMember.id);
                    const recoverOwned = owned !== undefined
                        && (owned.attemptId === undefined || owned.attemptId !== parkedAttemptId);
                    //#region mpd-delta pool-capability-select (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
                    // REPLACES the upstream `nextReadyTask` call: a pooled task this member
                    // cannot execute is not delivered (see nextCapableTask) but left in the
                    // pool for a member that can, and the withholding is logged once per
                    // (team, member, reason).
                    const task = recoverOwned ? owned : owned === undefined
                        ? nextCapableTask(fresh.tasks, currentMember, (blocked, gap, explicit) => noteDispatchDecline(ctx.logger, fresh.id, currentMember.name, explicit
                            ? `task ${blocked.id} (${blocked.kind ?? 'work'}) is assigned to this member, but its toolDeny withholds ${gap.join(', ')} — dispatched anyway, expect a blocked report`
                            : `ready task ${blocked.id} (${blocked.kind ?? 'work'}) needs ${gap.join(', ')}, which this member's toolDeny withholds — left in the pool`))
                        : undefined;
                    //#endregion mpd-delta pool-capability-select
                    if (task === undefined) {
                        if (currentMember.status !== 'idle' || deadlockVictims.length > 0) {
                            currentMember.status = 'idle';
                            await writeTeam(stateRoot, fresh);
                        }
                        return undefined;
                    }
                    const previousAssignee = task.assignee;
                    const previousStatus = recoverOwned ? task.status : undefined;
                    const previousAttempt = recoverOwned ? task.attempt : undefined;
                    const previousAttemptId = recoverOwned ? task.attemptId : undefined;
                    const attemptId = beginTaskAttempt(task, currentMember.name);
                    // A recovered generation is parked before delivery. This makes each
                    // (member, attempt) recovery idempotent even if every status poll
                    // sees a disposed handle. Fresh pending work remains unparked so a
                    // genuinely lost first delivery can be recovered once.
                    if (recoverOwned)
                        parkedAttempts.set(currentMember.id, attemptId);
                    else
                        parkedAttempts.delete(currentMember.id);
                    currentMember.status = 'working';
                    // Captain messages ride along with the assignment (digest in
                    // the prompt) instead of delaying the task behind a mailbox
                    // round-trip; they are claimed now and acknowledged only
                    // after Harness accepts the delivery below.
                    const captainUnread = deliverableUnread(await readUnreadMailbox(stateRoot, fresh.id, currentMember.name))
                        .filter((message) => message.from === CAPTAIN_KEY)
                        .slice(-5);
                    if (captainUnread.length > 0) {
                        await claimMailboxDelivery(stateRoot, fresh.id, currentMember.name, captainUnread.map((message) => message.id));
                    }
                    await writeTeam(stateRoot, fresh);
                    const profileSeedId = taskProfileSeedId(task);
                    const protocol = teamProfileProtocol(fresh);
                    return {
                        taskId: task.id,
                        memberName: currentMember.name,
                        memberId: currentMember.id,
                        attempt: task.attempt ?? 1,
                        attemptId,
                        previousAssignee,
                        recoveredOwned: recoverOwned,
                        ...previousStatus === undefined ? {} : { previousStatus },
                        ...previousAttempt === undefined ? {} : { previousAttempt },
                        ...previousAttemptId === undefined ? {} : { previousAttemptId },
                        subject: task.subject,
                        description: task.description,
                        teamDescription: fresh.description,
                        ...protocol === undefined ? {} : { profileProtocol: protocol },
                        ...profileSeedId === undefined ? {} : { profileSeedId },
                        ...fresh.profile?.executionPrompt === undefined && config.executionPrompt === undefined
                            ? {}
                            : { executionPrompt: fresh.profile?.executionPrompt ?? config.executionPrompt },
                        kind: task.kind ?? 'work',
                        ...task.round === undefined ? {} : { round: task.round },
                        ...task.objective === undefined ? {} : { objective: task.objective },
                        ...task.inScope === undefined ? {} : { inScope: task.inScope },
                        ...task.outOfScope === undefined ? {} : { outOfScope: task.outOfScope },
                        ...task.acceptance === undefined ? {} : { acceptance: task.acceptance },
                        ...task.verify === undefined ? {} : { verify: task.verify },
                        ...task.reviewedTaskId === undefined ? {} : { reviewedTaskId: task.reviewedTaskId },
                        ...task.reassignReason === undefined ? {} : { reassignReason: task.reassignReason },
                        ...captainUnread.length > 0 ? { captainMessages: captainUnread.map((message) => ({ id: message.id, content: message.content })) } : {},
                        dependencyOutputs: collectCompletedDependencyOutputs(fresh.tasks, task.id, (message) => ctx.logger.warn(message)),
                    };
                });
                if (ticket === undefined)
                    return;
                //#region mpd-delta terminal-dispatch-recheck (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
                // T-07 (wave 1, t36) — THE ROUTE THAT OFFERED A TERMINAL TASK, closed at the source.
                //
                // `isTaskReady` (this file, `mpd-delta ready-task-predicate`) requires `pending`,
                // `ownedOpenTask` requires `claimed`/`in_progress`, and `nextCapableTask` filters
                // with `isTaskReady` — so EVERY selection predicate already excludes terminal work
                // (which is why `test/s1-s4-semantics.test.mjs:144-150` passes: it tests the
                // PREDICATE). The measured instance (2026-09-17) came from a different shape:
                // the ticket is COMPOSED under the team lock and DELIVERED after that lock is
                // released, so a member that finished the task inside that window was still woken
                // for it — Architect was handed the already-`completed` `t1` and its claim was
                // refused with `task status cannot move from "completed" to "claimed"`.
                //
                // The check is the LAST thing before the wake, and it refuses on the three ways
                // the ticket can be stale: the task is gone, it became TERMINAL, or its attempt
                // rotated (a newer capability owns it now). A refusal NEVER writes to the task:
                // the terminal status may be work the member legitimately earned, and a rollback
                // that "restored" `pending` over it would destroy a finished deliverable.
                const stale = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                    const latest = await readTeam(stateRoot, team.id);
                    if (latest === undefined)
                        return "the task disappeared before its assignment could be delivered";
                    // T-93 (wave 2b, lane A): the decision is the NAMED predicate (`mpd-delta
                    // reoffer-terminal-route`, keyed on BOTH halves) and the decline note names the
                    // CLASS, so a re-offer of finished work is never collapsed into the sentence that
                    // describes a compose/wake race — the two need different captain actions.
                    const routing = deliveryRoutingClass(latest.tasks, { taskId: ticket.taskId, attemptId: ticket.attemptId });
                    if (routing === undefined)
                        return undefined;
                    const current = latest.tasks.find((candidate) => candidate.id === ticket.taskId);
                    if (routing === 'task-gone' || current === undefined)
                        return "the task disappeared before its assignment could be delivered";
                    if (routing === 'reoffer-terminal-same-attempt')
                        // T-93: the boundary OBSERVES the same sentence the race produces (the task IS
                        // terminal here), so the pinned wording stays byte-for-byte and the CLASS is
                        // appended — an operator needs to tell a re-offer from a lost generation, and
                        // the routing class is what names which one this was.
                        return `task ${ticket.taskId} became ${current.status} before its assignment could be delivered (routing class ${routing}: the delivery carries the attempt id the task's own completion recorded — a RE-OFFER of finished work, not a reassignment)`;
                    if (routing === 'terminal-rotated')
                        return `task ${ticket.taskId} became ${current.status} before its assignment could be delivered`;
                    return `task ${ticket.taskId} was handed to a newer attempt before its assignment could be delivered`;
                });
                if (stale !== undefined) {
                    await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                        const latest = await readTeam(stateRoot, team.id);
                        if (latest === undefined)
                            return;
                        if (ticket.captainMessages !== undefined && ticket.captainMessages.length > 0) {
                            await releaseMailboxDelivery(stateRoot, team.id, ticket.memberName, ticket.captainMessages.map((message) => message.id));
                        }
                        parkedAttempts.delete(ticket.memberId);
                        const currentMember = latest.members.find((candidate) => candidate.name === ticket.memberName);
                        if (currentMember !== undefined && currentMember.status !== 'removed')
                            currentMember.status = 'idle';
                        await writeTeam(stateRoot, latest);
                    });
                    return noteDispatchDecline(ctx.logger, team.id, ticket.memberName, `${stale} — the member was NOT woken for it, and the task's own status was left exactly as it is`);
                }
                //#endregion mpd-delta terminal-dispatch-recheck
                const accepted = await deliverToMember(ctx, captain, ticket.memberId, assignmentPrompt(ticket, config.stateDir, team.id), new AbortController().signal);
                if (accepted) {
                    if (ticket.captainMessages !== undefined && ticket.captainMessages.length > 0) {
                        await withTeamLock(teamLockKey(stateRoot, team.id), () => (acknowledgeMailbox(stateRoot, team.id, ticket.memberName, ticket.captainMessages.map((message) => message.id))));
                    }
                    return;
                }
                // Roll back only our exact failed dispatch. A concurrent captain
                // handoff has already changed the capability and wins.
                await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                    const fresh = await readTeam(stateRoot, team.id);
                    if (fresh === undefined)
                        return;
                    if (ticket.captainMessages !== undefined && ticket.captainMessages.length > 0) {
                        await releaseMailboxDelivery(stateRoot, team.id, ticket.memberName, ticket.captainMessages.map((message) => message.id));
                    }
                    const task = fresh.tasks.find(candidate => candidate.id === ticket.taskId);
                    if (task?.attemptId !== ticket.attemptId)
                        return;
                    if (ticket.recoveredOwned === true && ticket.previousStatus !== undefined && ticket.previousAttemptId !== undefined) {
                        // Recovery delivery failed. Restore the durable generation instead
                        // of returning it to pending, then keep it parked so later status
                        // kicks cannot spend an unbounded sequence of fresh attempts.
                        task.status = ticket.previousStatus;
                        task.assignee = ticket.previousAssignee;
                        task.attempt = ticket.previousAttempt;
                        task.attemptId = ticket.previousAttemptId;
                        parkedAttempts.set(ticket.memberId, ticket.previousAttemptId);
                    }
                    else {
                        task.status = 'pending';
                        task.assignee = ticket.previousAssignee;
                        task.attemptId = undefined;
                        parkedAttempts.delete(ticket.memberId);
                    }
                    task.handoffId = undefined;
                    task.reassigning = false;
                    task.updatedAt = Date.now();
                    const currentMember = fresh.members.find(candidate => candidate.name === ticket.memberName);
                    if (currentMember !== undefined && currentMember.status !== 'removed')
                        currentMember.status = 'idle';
                    await writeTeam(stateRoot, fresh);
                });
            });
        },
    };
    const syncMemberStatus = async (agent, status) => {
        const workspace = agent.session.header.cwd ?? process.cwd();
        const stateRoot = stateRootOf(workspace, config);
        //#region mpd-delta idle-edge-no-team-log (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
        const located = await findTeamByParticipant(stateRoot, agent.id);
        if (located === undefined) {
            parkedAttempts.delete(agent.id);
            return noteDispatchDecline(ctx.logger, '(unresolved)', agent.id, `the idle edge resolved no team under ${stateRoot}`);
        }
        //#endregion mpd-delta idle-edge-no-team-log
        if (located.captainSessionId === agent.id) {
            // Captain takeover is scoped to the captain's current turn. Unlike a
            // durable member, the captain has no scheduler lane that can resume an
            // abandoned attempt later. Returning unfinished captain-owned work to
            // the shared pool on the idle edge prevents it from becoming a
            // permanently parked `claimed` task after the captain answers, is
            // interrupted, or the user switches conversations.
            if (status === 'running')
                return;
            let requeued = false;
            await withTeamLock(teamLockKey(stateRoot, located.id), async () => {
                const fresh = await readTeam(stateRoot, located.id);
                if (fresh === undefined || fresh.captainSessionId !== agent.id)
                    return;
                for (const task of fresh.tasks) {
                    if (task.assignee !== CAPTAIN_KEY
                        || task.status === 'completed'
                        || task.status === 'failed'
                        || task.status === 'cancelled')
                        continue;
                    invalidateTaskAttempt(task);
                    task.reassigning = false;
                    requeued = true;
                }
                if (requeued)
                    await writeTeam(stateRoot, fresh);
            });
            if (requeued)
                await runtime.kickTeam(workspace, located.id, agent);
            return;
        }
        //#region mpd-delta idle-edge-nonmember-log (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
        const member = located.members.find(candidate => candidate.id === agent.id && candidate.status !== 'removed');
        if (member === undefined) {
            parkedAttempts.delete(agent.id);
            return noteDispatchDecline(ctx.logger, located.id, agent.id, 'the session is not an active member of the team this edge resolved');
        }
        //#endregion mpd-delta idle-edge-nonmember-log
        await withTeamLock(teamLockKey(stateRoot, located.id), async () => {
            const fresh = await readTeam(stateRoot, located.id);
            const current = fresh?.members.find(candidate => candidate.id === agent.id && candidate.status !== 'removed');
            if (fresh === undefined || current === undefined)
                return;
            const next = status === 'running' ? 'working' : 'idle';
            if (next === 'idle') {
                const owned = ownedOpenTask(fresh.tasks, current.name);
                if (owned?.attemptId === undefined)
                    parkedAttempts.delete(agent.id);
                else
                    parkedAttempts.set(agent.id, owned.attemptId);
            }
            else {
                parkedAttempts.delete(agent.id);
            }
            if (current.status === next)
                return;
            current.status = next;
            await writeTeam(stateRoot, fresh);
        });
        if (status === 'idle')
            await runtime.kickMember(workspace, located.id, member.name);
    };
    ctx.on('agent/status', ({ agent, status }) => {
        void syncMemberStatus(agent, status).catch((error) => {
            ctx.logger.warn(`agent-teams: member status scheduling failed for ${agent.id}: ${String(error)}`);
        });
    });
    return runtime;
}
