const WATCHDOG_HOLD_SERVICE = 'mpdWatchdog';
function watchdogHoldOf(ctx, teamId, workspace) {
    try {
        const watchdog = typeof ctx?.get === 'function' ? ctx.get(WATCHDOG_HOLD_SERVICE, false) : undefined;
        const view = typeof watchdog?.isHeld === 'function' ? watchdog.isHeld(teamId, workspace) : undefined;
        if (view === undefined || view === null || view.held !== true)
            return undefined;
        return { holdId: String(view.holdId ?? ''), at: 0, reason: String(view.reason ?? ''), source: null };
    }
    catch {
        return undefined;
    }
}
const freshTeamProbeId = 'probe-team';
/**
 * The `agent_teams_*` model-facing tools.
 *
 * The captain (the agent that created the team) orchestrates: members are
 * continuable subagents it spawns and wakes. Members share the same tools and
 * drive their own task state, mirroring the Claude Code AgentTeams flow:
 * create team → add members → create tasks with dependencies → claim/assign →
 * work → report → status → delete.
 * @module dsh-agent-teams/tools
 */
import { createUserMessage } from '../_deps/dsh-llm/lib/index.ts';
import { defineTool } from '../_deps/dsh-tools/lib/index.ts';
import { join } from 'node:path';
//#region mpd-delta artifact-channel-imports (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
// T-09/T-10 (wave 1, t19): the artifact channel is the FIRST file-writing code in this
// adopted module, and the guard needs path arithmetic + lstat. Two import statements from
// the same specifier keep the upstream line above byte-untouched (purely ADDITIVE region).
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
//#endregion mpd-delta artifact-channel-imports
import { randomUUID } from 'node:crypto';
import { appendTeamEvent, captainSessionOf } from "./events.ts";
import { acknowledgeMailbox, appendMailbox, appendMailboxDeduped, archiveTeamDir, beginTaskAttempt, CAPTAIN_KEY, clearMailboxToWatermark, createMessage, createTeamDir, decideInterjection, enqueueInterjection, findTeamByCaptain, findTeamByParticipant, cancelUnfinishedTask, invalidateTaskAttempt, readInterjections, readPendingInterjections, readUnreadMailbox, recordRetiredMemberIds, releaseMailboxDelivery, readTeam, sanitizeKey, transitionError, unsatisfiedDependencies, withTeamLock, writeTeam, removeTeamDir, validateCreateTask, evaluateQualityCompletion, planQualityFollowUp, resumeTeamState, buildCoverageMatrix, canDeclareDelivery, describeQualityLoop, sanitizeReviewAcceptance, sanitizeReviewObjective, taskKindOf, resolveCancelledDependencyDeadlocks, normalizeBlankOptionalTaskFields, dependencyStates, describeScopeOwner, scopeOwners, waveOf, nextWave, writeWaveArchive, listWaveArchives, isOpenTaskStatus, contractContradiction, inScopeOverlap, pathMatchesScope, } from "./state.ts";
import { deliverToMember, installRetiredMemberGuard, installMemberSelectionRuntime, interruptMember, memberActivity, resolveMemberLlmSelection, spawnMember, steerCaptainReport, validateMemberLlmSelections, } from "./members.ts";
export { steerCaptainReport } from "./members.ts";
import { TERMINAL_TASK_STATUSES } from "./types.ts";
import { installTeamScheduler } from "./scheduler.ts";
import { resolveTeamProfile } from "./profiles.ts";
/** The caller agent, or a loud failure for non-agent callers. */
function requireCaptain(exec) {
    if (!exec.agent) {
        throw new Error('agent_teams tools require a calling agent (exec.agent was undefined)');
    }
    return exec.agent;
}
/** The captain's workspace directory (team state root parent). */
function workspaceOf(agent) {
    return agent.session.header.cwd ?? process.cwd();
}
/** Resolved absolute state root. */
function stateRootOf(workspace, config) {
    return join(workspace, config.stateDir);
}
/** Process-local lock key scoped by workspace state root and team id. */
function teamLockKey(stateRoot, teamId) {
    return `team:${stateRoot}:${teamId}`;
}
/** Process-local lock key enforcing one active team per captain session. */
function captainLockKey(stateRoot, captainId) {
    return `captain:${stateRoot}:${captainId}`;
}
/** The team this captain currently leads, or a loud failure. */
async function requireCaptainTeam(workspace, config, captain) {
    const team = await findTeamByCaptain(stateRootOf(workspace, config), captain.id);
    if (team === undefined) {
        throw new Error('you are not leading any team yet — call agent_teams_create first');
    }
    return team;
}
/** The team this captain or active member currently participates in. */
async function requireParticipantTeam(workspace, config, caller) {
    const team = await findTeamByParticipant(stateRootOf(workspace, config), caller.id);
    if (team === undefined) {
        throw new Error('you do not lead or belong to any active team yet');
    }
    return team;
}
/** Re-derive a caller's role from fresh state while holding the team lock. */
function participantIdentityOf(team, agentId) {
    if (team.captainSessionId === agentId)
        return { kind: 'captain', name: CAPTAIN_KEY };
    const member = team.members.find((candidate) => candidate.id === agentId && candidate.status !== 'removed');
    return member === undefined ? undefined : { kind: 'member', name: member.name };
}
/** Fresh state for a team that still exists; never falls back to stale lookup data. */
async function requireFreshTeam(stateRoot, teamId) {
    const fresh = await readTeam(stateRoot, teamId);
    if (fresh === undefined)
        throw new Error(`team "${teamId}" is no longer active`);
    return fresh;
}
/** Fresh state with captain authorization rechecked inside the lock. */
async function requireFreshCaptainTeam(stateRoot, teamId, captainId) {
    const fresh = await requireFreshTeam(stateRoot, teamId);
    if (fresh.captainSessionId !== captainId) {
        throw new Error(`only the captain of team "${fresh.name}" may perform this operation`);
    }
    return fresh;
}
/** Fresh state and caller identity rechecked inside the lock. */
async function requireFreshParticipant(stateRoot, teamId, callerId) {
    const fresh = await requireFreshTeam(stateRoot, teamId);
    const identity = participantIdentityOf(fresh, callerId);
    if (identity === undefined)
        throw new Error(`you are no longer an active participant in team "${fresh.name}"`);
    return { team: fresh, identity };
}
/** Look up one live (non-removed) member by display name. */
function requireMember(team, name) {
    const member = team.members.find((candidate) => candidate.name === name && candidate.status !== 'removed');
    if (member === undefined) {
        throw new Error(`no active member named "${name}" in team "${team.name}"`);
    }
    return member;
}
/** Look up one task by id. */
function requireTask(team, taskId) {
    const task = team.tasks.find((candidate) => candidate.id === taskId);
    if (task === undefined) {
        throw new Error(`no task "${taskId}" in team "${team.name}" — use agent_teams_status to list tasks`);
    }
    return task;
}
function requireStagedTeam(team) {
    if (team.phase !== 'staged') {
        throw new Error(`team "${team.name}" is already running; its plan can no longer be edited`);
    }
    if (team.halted === true)
        throw new Error(`team "${team.name}" is halted, not awaiting plan approval`);
}
function trimmedOptional(value) {
    const trimmed = value?.trim();
    return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}
/** Validate references and cycles before a staged graph can be saved or run. */
function validateStagedGraph(team, requireRunnable) {
    const members = team.members.filter((member) => member.status !== 'removed');
    if (requireRunnable && members.length === 0)
        throw new Error('add at least one member before approving the plan');
    if (requireRunnable && team.tasks.length === 0)
        throw new Error('add at least one task before approving the plan');
    const memberNames = new Set(members.map((member) => member.name));
    const taskIds = new Set(team.tasks.map((task) => task.id));
    for (const task of team.tasks) {
        if (task.subject.trim() === '')
            throw new Error(`task "${task.id}" must have a subject`);
        if (task.assignee !== undefined && task.assignee !== CAPTAIN_KEY && !memberNames.has(task.assignee)) {
            throw new Error(`task "${task.id}" assignee "${task.assignee}" is not an active member`);
        }
        for (const dependency of task.dependencies) {
            if (dependency === task.id)
                throw new Error(`task "${task.id}" cannot depend on itself`);
            if (!taskIds.has(dependency))
                throw new Error(`task "${task.id}" depends on unknown task "${dependency}"`);
        }
    }
    const visiting = new Set();
    const visited = new Set();
    const byId = new Map(team.tasks.map((task) => [task.id, task]));
    const visit = (taskId) => {
        if (visiting.has(taskId))
            throw new Error(`task dependency graph contains a cycle at "${taskId}"`);
        if (visited.has(taskId))
            return;
        visiting.add(taskId);
        for (const dependency of byId.get(taskId)?.dependencies ?? [])
            visit(dependency);
        visiting.delete(taskId);
        visited.add(taskId);
    };
    for (const task of team.tasks)
        visit(task.id);
}
function memberOpenTask(team, memberName, exceptTaskId) {
    return team.tasks.find(task => task.id !== exceptTaskId
        && task.assignee === memberName
        && (task.status === 'claimed' || task.status === 'in_progress'));
}
/** Captain work is immediate, not a durable scheduler lane: allow one unfinished takeover at a time. */
function captainOpenTask(team, exceptTaskId) {
    return team.tasks.find(task => task.id !== exceptTaskId
        && task.assignee === CAPTAIN_KEY
        && !TERMINAL_TASK_STATUSES.includes(task.status));
}
async function waitForMemberIdle(ctx, member, signal) {
    if (member.id === '')
        return;
    const live = ctx.agents.get(member.id);
    if (live === undefined)
        return;
    if (signal.aborted)
        throw signal.reason;
    let onAbort;
    const aborted = new Promise((_resolve, reject) => {
        onAbort = () => reject(signal.reason ?? new Error('task reassignment was cancelled'));
        signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
        await Promise.race([live.whenIdle(), aborted]);
    }
    finally {
        signal.removeEventListener('abort', onAbort);
    }
}
/** Stop every currently-resident member activation for one halted team.
 *
 * Interrupt requests only cancel the member's current model turn and retain its
 * activation. Draining the selected direct children is the stronger lifecycle
 * boundary: it waits for the activation handles to release, so a child cannot
 * keep executing after the captain-chat Stop control has reported success.
 */
async function stopTeamMemberActivations(ctx, captain, members, signal) {
    const activeMembers = members.filter((member) => member.id !== '' && member.status !== 'removed');
    const memberIds = activeMembers.map((member) => member.id);
    if (memberIds.length === 0)
        return;
    for (const memberId of memberIds)
        interruptMember(ctx, captain, memberId);
    // `drainContinuableChildren` is available in the current runtime and releases
    // the selected activation handles. Keep the quiescence fallback for pre-rc.8
    // hosts, where interrupt is the strongest available lifecycle operation.
    const runtime = ctx.subagents;
    if (runtime.drainContinuableChildren !== undefined) {
        try {
            await runtime.drainContinuableChildren(captain, memberIds);
            return;
        }
        catch (error) {
            // Do not claim the browser action stopped work when the runtime could not
            // release all selected child activations. The HTTP route surfaces this
            // failure instead of returning a false successful stop.
            ctx.logger.warn(`agent-teams: failed to drain halted members: ${String(error)}`);
            throw error;
        }
    }
    const fallbackSignal = signal ?? new AbortController().signal;
    const results = await Promise.allSettled(activeMembers.map((member) => waitForMemberIdle(ctx, member, fallbackSignal)));
    const failed = results.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected')
        throw failed.reason;
}
export async function haltTeamWork(input) {
    const halted = await withTeamLock(teamLockKey(input.stateRoot, input.teamId), async () => {
        const fresh = await requireFreshCaptainTeam(input.stateRoot, input.teamId, input.captain.id);
        if (fresh.halted === true) {
            return {
                teamName: fresh.name,
                cancelledTasks: fresh.tasks.filter((task) => task.status === 'cancelled').length,
                alreadyHalted: true,
                members: fresh.members.filter((member) => member.id !== '' && member.status !== 'removed').map((member) => ({ ...member })),
            };
        }
        const now = Date.now();
        let cancelledTasks = 0;
        for (const task of fresh.tasks) {
            if (TERMINAL_TASK_STATUSES.includes(task.status))
                continue;
            cancelUnfinishedTask(task, 'Stopped from the captain chat.');
            cancelledTasks += 1;
        }
        for (const member of fresh.members) {
            if (member.status === 'removed')
                continue;
            member.status = 'idle';
        }
        fresh.halted = true;
        fresh.haltedAt = now;
        await writeTeam(input.stateRoot, fresh);
        appendTeamEvent(input.ctx, captainSessionOf(input.ctx, fresh.captainSessionId, input.captain.session), 'agent-teams/team-halted', {
            teamId: fresh.id,
            cancelledTasks,
        });
        return {
            teamName: fresh.name,
            cancelledTasks,
            alreadyHalted: false,
            members: fresh.members.filter((member) => member.id !== '' && member.status !== 'removed').map((member) => ({ ...member })),
        };
    });
    // Persist the stop boundary first, then abort the Captain before draining
    // children. Otherwise its current model turn can observe `halted`, call
    // resume, and race the still-running HTTP stop request.
    input.captain.cancel({ kind: 'user' }, { keepInbox: true });
    await stopTeamMemberActivations(input.ctx, input.captain, halted.members, input.signal);
    // Interrupting a child emits a trailing subagent-settled notification. That
    // notification can start a fresh Captain turn after the first cancellation,
    // so close the stop boundary again once every child activation has drained.
    // Queued user input is preserved both times; only runtime-generated work is
    // prevented from silently resuming the halted team.
    input.captain.cancel({ kind: 'user' }, { keepInbox: true });
    return {
        teamName: halted.teamName,
        cancelledTasks: halted.cancelledTasks,
        alreadyHalted: halted.alreadyHalted,
    };
}
/** Context queued after the human approves a staged plan from the Web UI. */
export function stagedPlanApprovedContext(teamName) {
    return [
        `The user approved the staged AgentTeams plan "${teamName}" from the pre-run review UI.`,
        'Approval has committed; the scheduler owns dispatch of the approved team. Do not approve again, recreate the roster, or send messages merely to start assigned tasks.',
        'Acknowledge the approval and handle any reports or user work already pending. Yield only when waiting for members is the remaining action. Their reports will wake you automatically; do not busy-poll status or keep a turn running just to wait.',
        'On a report, inspect the result and coordinate the next necessary action. If work has since been halted, respect that state and resume only on an explicit user request.',
    ].join('\n');
}
/** Context queued after the human rejects a staged plan. */
export function stagedPlanDiscardContext(teamName) {
    return [
        `The user discarded the staged AgentTeams plan "${teamName}" from the pre-run review UI.`,
        'That decision is final for this draft: it has been archived, no members were created, and no tasks may run.',
        'Do not call agent_teams_create, agent_teams_approve, or recreate a replacement team merely because the old team is no longer active.',
        'Wait for a later explicit user request. If the next user message is unrelated to AgentTeams, answer it normally and do not start a team.',
    ].join('\n');
}
/** Model-facing continuation that turns the review UI back into a conversation. */
export function stagedPlanFeedbackContext(teamName) {
    return [
        `The user selected "Return to chat and revise" for the staged AgentTeams plan "${teamName}".`,
        'The existing staged plan is still the only draft. Do not create a replacement team, approve it, spawn members, edit the plan, or start work in this turn.',
        'Ask the user one concise, concrete question about what they want changed, then stop and wait for their answer.',
        'After the user answers, revise this same staged roster and DAG with one atomic agent_teams_edit_plan call, summarize the changes, and ask the user to review the updated plan again.',
    ].join('\n');
}
/**
 * Register every `agent_teams_*` tool into the shared tools registry.
 * @param ctx - the plugin context (injects `tools`).
 * @param config - resolved tool config.
 */
export function registerAgentTeamsTools(ctx, config) {
    installRetiredMemberGuard(ctx, config.stateDir);
    const memberSelections = installMemberSelectionRuntime(ctx, config.stateDir, (workspace, teamId, memberName) => (
        scheduler.kickMember(workspace, teamId, memberName)
    ));
    const scheduler = installTeamScheduler(ctx, { stateDir: config.stateDir, executionPrompt: config.executionPrompt });
    const updateStagedPlanBatch = async (captain, teamId, mutations, signal) => {
        if (mutations.length === 0)
            throw new Error('at least one staged plan operation is required');
        const workspace = workspaceOf(captain);
        const stateRoot = stateRootOf(workspace, config);
        return withTeamLock(teamLockKey(stateRoot, teamId), async () => {
            const fresh = await requireFreshCaptainTeam(stateRoot, teamId, captain.id);
            requireStagedTeam(fresh);
            for (const mutation of mutations) {
                if (mutation.action === 'update_member') {
                    const member = requireMember(fresh, mutation.memberName);
                    if (member.id !== '')
                        throw new Error(`staged member "${member.name}" was already spawned`);
                    const selection = await resolveMemberLlmSelection(ctx, captain, {
                        provider: mutation.provider,
                        model: mutation.model,
                        reasoningEffort: trimmedOptional(mutation.reasoningEffort),
                        fallback: member.fallback,
                    }, signal);
                    member.role = trimmedOptional(mutation.role);
                    member.provider = selection.provider;
                    member.model = selection.model;
                    member.reasoningEffort = selection.reasoningEffort;
                    member.executionPrompt = trimmedOptional(mutation.executionPrompt);
                }
                else if (mutation.action === 'update_task') {
                    const task = requireTask(fresh, mutation.taskId);
                    if (task.status !== 'pending' || (task.attempt ?? 0) !== 0) {
                        throw new Error(`task "${task.id}" has already started and cannot be edited`);
                    }
                    const subject = mutation.subject.trim();
                    if (subject === '')
                        throw new Error('task subject must not be empty');
                    task.subject = subject;
                    task.description = trimmedOptional(mutation.description);
                    task.assignee = trimmedOptional(mutation.assignee);
                    task.dependencies = [...new Set(mutation.dependencies.map((item) => item.trim()).filter(Boolean))];
                    task.updatedAt = Date.now();
                }
                else if (mutation.action === 'add_task') {
                    const subject = mutation.subject.trim();
                    if (subject === '')
                        throw new Error('task subject must not be empty');
                    //#region mpd-delta edit-plan-add-task-apply (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
                    // T-03 (wave 1, t14): the SAME gate create_task runs, so a staged-plan edit
                    // can no longer add an unknown kind or an incomplete quality contract and
                    // persist it as legacy `work`. The refusal text is the gate's own, i.e.
                    // exactly as loud as create_task's.
                    const gate = validateCreateTask(fresh, {
                        subject,
                        description: trimmedOptional(mutation.description),
                        dependencies: [...new Set((mutation.dependencies ?? []).map((item) => item.trim()).filter(Boolean))],
                        assignee: trimmedOptional(mutation.assignee),
                        kind: mutation.kind,
                        objective: mutation.objective,
                        inScope: mutation.inScope,
                        outOfScope: mutation.outOfScope,
                        acceptance: mutation.acceptance,
                        verify: mutation.verify,
                    });
                    if (!gate.ok)
                        throw new Error(gate.error ?? 'edit_plan add_task rejected by quality gates');
                    fresh.taskSeq += 1;
                    const now = Date.now();
                    fresh.tasks.push({
                        id: `t${fresh.taskSeq}`,
                        subject,
                        description: trimmedOptional(mutation.description),
                        status: 'pending',
                        assignee: trimmedOptional(mutation.assignee),
                        dependencies: [...new Set(mutation.dependencies.map((item) => item.trim()).filter(Boolean))],
                        attempt: 0,
                        kind: mutation.kind ?? 'work',
                        ...mutation.objective === undefined ? {} : { objective: mutation.objective },
                        ...mutation.inScope === undefined ? {} : { inScope: [...mutation.inScope] },
                        ...mutation.outOfScope === undefined ? {} : { outOfScope: [...mutation.outOfScope] },
                        ...mutation.acceptance === undefined ? {} : { acceptance: [...mutation.acceptance] },
                        ...mutation.verify === undefined ? {} : { verify: [...mutation.verify] },
                        createdAt: now,
                        updatedAt: now,
                    });
                    //#endregion mpd-delta edit-plan-add-task-apply
                }
                else if (mutation.action === 'remove_task') {
                    const task = requireTask(fresh, mutation.taskId);
                    const dependent = fresh.tasks.find((candidate) => candidate.dependencies.includes(task.id));
                    if (dependent !== undefined) {
                        throw new Error(`task "${task.id}" is still required by "${dependent.id}"; update that dependency before removing the task`);
                    }
                    fresh.tasks = fresh.tasks.filter((candidate) => candidate.id !== task.id);
                }
                else {
                    const member = requireMember(fresh, mutation.memberName);
                    if (member.id !== '')
                        throw new Error(`staged member "${member.name}" was already spawned`);
                    const owned = fresh.tasks.filter((task) => task.assignee === member.name);
                    if (owned.length > 0) {
                        throw new Error(`member "${member.name}" still owns planned tasks: ${owned.map((task) => task.id).join(', ')}; update or remove those tasks first`);
                    }
                    fresh.members = fresh.members.filter((candidate) => candidate !== member);
                }
            }
            validateStagedGraph(fresh, false);
            fresh.planReviewState = 'awaiting_review';
            await writeTeam(stateRoot, fresh);
            return fresh;
        });
    };
    const updateStagedPlan = async (captain, teamId, mutation, signal) => (updateStagedPlanBatch(captain, teamId, [mutation], signal));
    const approveStagedTeam = async (captain, teamId, signal) => {
        const workspace = workspaceOf(captain);
        const stateRoot = stateRootOf(workspace, config);
        const runSignal = signal ?? new AbortController().signal;
        const approved = await withTeamLock(teamLockKey(stateRoot, teamId), async () => {
            const fresh = await requireFreshCaptainTeam(stateRoot, teamId, captain.id);
            requireStagedTeam(fresh);
            // A staged removal has no child session to retain in history. Drop those
            // placeholders before transitioning to the stricter running shape.
            fresh.members = fresh.members.filter((member) => member.status !== 'removed');
            validateStagedGraph(fresh, true);
            const spawned = [];
            try {
                const selections = new Map();
                for (const member of fresh.members) {
                    if (member.id !== '')
                        continue;
                    const selection = await resolveMemberLlmSelection(ctx, captain, {
                        provider: member.provider,
                        model: member.model,
                        reasoningEffort: member.reasoningEffort,
                        fallback: member.fallback,
                    }, runSignal);
                    selections.set(member, selection);
                    member.provider = selection.provider;
                    member.model = selection.model;
                    member.reasoningEffort = selection.reasoningEffort;
                }
                // This is the approval commit barrier: resolve and validate the whole
                // final roster before spawning even the first durable child.
                await validateMemberLlmSelections(ctx, [...selections.values()], runSignal);
                for (const [member, selection] of selections) {
                    await spawnMember(ctx, memberRuntime(config), memberSelections, selection, captain, fresh, member, config.stateDir, runSignal);
                    spawned.push(member);
                }
                if (fresh.members.some((member) => member.id === '')) {
                    throw new Error('one or more staged members could not be spawned');
                }
                fresh.phase = 'running';
                delete fresh.planReviewState;
                fresh.approvedAt = Date.now();
                await writeTeam(stateRoot, fresh);
                return { teamId: fresh.id, members: fresh.members.length, tasks: fresh.tasks.length };
            }
            catch (error) {
                await recordRetiredMemberIds(stateRoot, spawned.map((member) => member.id)).catch(() => undefined);
                for (const member of spawned) {
                    if (member.id !== '')
                        interruptMember(ctx, captain, member.id);
                }
                throw error;
            }
        });
        try {
            await scheduler.kickTeam(workspace, teamId, captain);
        }
        catch (error) {
            // Approval is already durably committed. A transient wake-up failure is
            // recoverable by the next status/member lifecycle kick and must not make
            // the UI report that an already-running team failed to approve.
            ctx.logger.warn(`agent-teams: post-approval kick failed for "${teamId}": ${String(error)}`);
        }
        return approved;
    };
    const continueStagedPlanning = async (captain, teamId) => {
        const workspace = workspaceOf(captain);
        const stateRoot = stateRootOf(workspace, config);
        const prepared = await withTeamLock(teamLockKey(stateRoot, teamId), async () => {
            const fresh = await requireFreshCaptainTeam(stateRoot, teamId, captain.id);
            requireStagedTeam(fresh);
            if (fresh.planReviewState === 'awaiting_feedback') {
                return { teamName: fresh.name, alreadyWaiting: true };
            }
            fresh.planReviewState = 'awaiting_feedback';
            await writeTeam(stateRoot, fresh);
            return { teamName: fresh.name, alreadyWaiting: false };
        });
        if (prepared.alreadyWaiting)
            return { teamId, alreadyWaiting: true };
        // End any planning turn that is still producing tool calls. A plugin
        // follow-up submitted after cancellation is queued as the next turn by the
        // Harness Agent contract, so it cannot race ahead and recreate the team.
        captain.cancel({ kind: 'user' }, { keepInbox: true });
        try {
            captain.followup(createUserMessage({
                content: [{ type: 'text', text: stagedPlanFeedbackContext(prepared.teamName) }],
                source: { kind: 'plugin', plugin: 'dsh-agent-teams' },
            }));
        }
        catch (error) {
            // Do not leave the durable UI in a false waiting state when the live
            // Captain disappeared between lookup and delivery.
            await withTeamLock(teamLockKey(stateRoot, teamId), async () => {
                const fresh = await requireFreshCaptainTeam(stateRoot, teamId, captain.id);
                requireStagedTeam(fresh);
                if (fresh.planReviewState === 'awaiting_feedback') {
                    fresh.planReviewState = 'awaiting_review';
                    await writeTeam(stateRoot, fresh);
                }
            });
            throw error;
        }
        return { teamId, alreadyWaiting: false };
    };
    const discardStagedTeam = async (captain, teamId) => {
        const workspace = workspaceOf(captain);
        const stateRoot = stateRootOf(workspace, config);
        const discarded = await withTeamLock(teamLockKey(stateRoot, teamId), async () => {
            const fresh = await requireFreshCaptainTeam(stateRoot, teamId, captain.id);
            requireStagedTeam(fresh);
            appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/plan-discarded', {
                teamId: fresh.id,
            });
            // A staged plan owns no child sessions. Archiving releases the captain
            // immediately while retaining the rejected graph for later inspection.
            await archiveTeamDir(stateRoot, fresh.id);
            return { teamId: fresh.id, teamName: fresh.name };
        });
        // Preserve this control fact for the next genuine user turn, then abort the
        // still-running Captain turn. Without both operations a late model step can
        // observe the missing active team and incorrectly create it again.
        try {
            captain.inject(createUserMessage({
                content: [{ type: 'text', text: stagedPlanDiscardContext(discarded.teamName) }],
                source: { kind: 'plugin', plugin: 'dsh-agent-teams' },
            }));
        }
        catch (error) {
            // The archive is already authoritative. Cancellation still prevents a
            // late step from recreating work; failure to park extra context is only a
            // live-delivery warning and must not turn a successful discard into 409.
            ctx.logger.warn(`agent-teams: failed to inject discard context for "${discarded.teamId}": ${String(error)}`);
        }
        captain.cancel({ kind: 'user' }, { keepInbox: true });
        return { teamId: discarded.teamId };
    };
    const runtime = {
        isPendingMember: memberSelections.isPendingMember,
        updateStagedPlan,
        updateStagedPlanBatch,
        approveStagedTeam,
        continueStagedPlanning,
        discardStagedTeam,
    };
    ctx.tools.register(defineTool({
        name: 'agent_teams_create',
        description: 'Create a team. Use approval=required for a two-phase plan: members and tasks remain unspawned/unclaimed until the user reviews the Web plan and explicitly approves it. Optional profiles expand their configured roster; seed profiles also expand template tasks, while captain profiles leave the graph for the Captain to design. approval=automatic preserves the legacy immediate-execution path.',
        parameters: {
            name: { type: 'string', required: true, description: 'Name for the new team (used as its stable id).' },
            description: { type: 'string', description: 'Team purpose / the goal the team will work on.' },
            profile: { type: 'string', description: 'Optional configured profile name.' },
            approval: {
                type: 'string',
                enum: ['required', 'automatic'],
                description: 'required stages the plan for explicit user review; automatic starts immediately. Defaults to automatic for API compatibility.',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    team_id: { type: 'string', required: true },
                    team_name: { type: 'string', required: true },
                    state_dir: { type: 'string', required: true },
                    phase: { type: 'string', required: true },
                    profile: { type: 'string' },
                    task_planning: { type: 'string' },
                    members: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { member_name: { type: 'string', required: true }, member_id: { type: 'string', required: true }, provider: { type: 'string', required: true }, model: { type: 'string', required: true }, reasoning_effort: { type: 'string' }, status: { type: 'string', required: true } } } },
                    tasks: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { task_id: { type: 'string', required: true }, seed_id: { type: 'string', required: true }, subject: { type: 'string', required: true }, status: { type: 'string', required: true }, kind: { type: 'string' }, assignee: { type: 'string' }, dependencies: { type: 'array', items: { type: 'string' }, required: true } } } },
                },
            },
            render: (args, value) => [{
                    type: 'text',
                    text: value.phase === 'staged'
                        ? `Team "${value.team_name}" plan created under ${value.state_dir}. It is staged: finish the roster and DAG, then wait for the user to edit and approve it. Do not start or approve it yourself.`
                        : `Team "${value.team_name}" created (id ${value.team_id}) under ${value.state_dir}. You are the captain.`,
                }],
        },
        async execute(args, exec) {
            const captain = requireCaptain(exec);
            const workspace = workspaceOf(captain);
            const stateRoot = stateRootOf(workspace, config);
            const teamName = args.name.trim();
            if (teamName === '')
                throw new Error('team name must not be empty');
            const teamId = sanitizeKey(teamName);
            const staged = args.approval === 'required';
            // Some models materialize optional parameters as "" instead of
            // omitting them (issue #99). The profile is optional, so treat a
            // blank value exactly like an omitted one instead of failing every
            // create call.
            const profileName = args.profile !== undefined && args.profile.trim() !== ''
                ? args.profile.trim()
                : undefined;
            const created = await withTeamLock(captainLockKey(stateRoot, captain.id), async () => {
                const current = await findTeamByParticipant(stateRoot, captain.id);
                if (current !== undefined) {
                    const relationship = current.captainSessionId === captain.id ? 'lead' : 'belong to';
                    const guidance = current.captainSessionId === captain.id
                        ? 'Use agent_teams_status and continue the existing team. Do not delete and recreate it merely to continue work. End it only when the user explicitly wants a separate new team.'
                        : 'Continue your assigned member work and report to your captain; do not create a separate team.';
                    throw new Error(`you already ${relationship} team "${current.name}" (id ${current.id}). ${guidance}`);
                }
                return withTeamLock(teamLockKey(stateRoot, teamId), async () => {
                    const existing = await readTeam(stateRoot, teamId);
                    if (existing !== undefined) {
                        throw new Error(`team id "${teamId}" is taken by another captain — pick a different team name`);
                    }
                    if (profileName === undefined) {
                        const state = {
                            name: teamName,
                            id: teamId,
                            description: args.description,
                            captainSessionId: captain.id,
                            createdAt: Date.now(),
                            members: [],
                            tasks: [],
                            taskSeq: 0,
                            ...staged ? { phase: 'staged', planReviewState: 'awaiting_review' } : {},
                        };
                        await createTeamDir(stateRoot, state);
                        return { committed: true, state };
                    }
                    return initializeProfileTeam({
                        ctx,
                        config,
                        memberSelections,
                        captain,
                        exec,
                        stateRoot,
                        teamName,
                        teamId,
                        profileName,
                        description: args.description,
                        staged,
                    });
                });
            });
            if (created.committed) {
                try {
                    await scheduler.kickTeam(workspace, created.state.id, captain);
                }
                catch (error) {
                    ctx.logger.warn(`agent-teams: post-create kick failed for "${created.state.id}": ${String(error)}`);
                }
                try {
                    appendTeamEvent(ctx, captain.session, 'agent-teams/team-created', {
                        teamId: created.state.id,
                        captainSessionId: captain.id,
                        name: created.state.name,
                        ...created.state.description !== undefined ? { description: created.state.description } : {},
                        ...created.state.profile?.name === undefined ? {} : { profile: created.state.profile.name },
                    });
                    for (const member of created.state.members) {
                        appendTeamEvent(ctx, captain.session, 'agent-teams/member-added', {
                            teamId: created.state.id,
                            memberId: member.id,
                            name: member.name,
                            ...member.role === undefined ? {} : { role: member.role },
                        });
                    }
                    for (const task of created.state.tasks) {
                        appendTeamEvent(ctx, captain.session, 'agent-teams/task-created', {
                            teamId: created.state.id,
                            taskId: task.id,
                            subject: task.subject,
                            dependencies: task.dependencies,
                            ...task.assignee === undefined ? {} : { assignee: task.assignee },
                        });
                    }
                }
                catch (error) {
                    ctx.logger.warn(`agent-teams: post-create events failed for "${created.state.id}": ${String(error)}`);
                }
            }
            const persisted = await readTeam(stateRoot, created.state.id).catch(() => undefined);
            const snapshot = persisted ?? created.state;
            if (snapshot.profile === undefined) {
                return {
                    team_id: snapshot.id,
                    team_name: snapshot.name,
                    state_dir: join(stateRoot, snapshot.id),
                    phase: snapshot.phase ?? 'running',
                };
            }
            return {
                team_id: snapshot.id,
                team_name: snapshot.name,
                state_dir: join(stateRoot, snapshot.id),
                phase: snapshot.phase ?? 'running',
                profile: snapshot.profile.name,
                task_planning: snapshot.profile.taskPlanning ?? 'seed',
                members: snapshot.members.map((member) => ({
                    member_name: member.name,
                    member_id: member.id,
                    provider: member.provider ?? '',
                    model: member.model ?? '',
                    ...member.reasoningEffort === undefined ? {} : { reasoning_effort: member.reasoningEffort },
                    status: member.status,
                })),
                tasks: snapshot.tasks.map((task) => ({
                    task_id: task.id,
                    seed_id: task.profileSeedId ?? '',
                    subject: task.subject,
                    status: task.status,
                    ...task.kind === undefined ? {} : { kind: task.kind },
                    ...task.assignee === undefined ? {} : { assignee: task.assignee },
                    dependencies: task.dependencies,
                })),
            };
        },
    }));
    ctx.tools.register(defineTool({
        name: 'agent_teams_edit_plan',
        description: 'Atomically revise the current staged AgentTeams plan without spawning members or scheduling tasks. Use this when the user continues chatting to change a plan that is waiting for approval. Submit dependent edits in order (update downstream dependencies or assignees, then remove tasks, then remove unused members). Never inspect or edit .agent-teams state files or plugin source code to revise a plan.',
        parameters: {
            operations: {
                type: 'array',
                required: true,
                description: 'One atomic, ordered batch of staged-plan edits. If any operation is invalid, none of the edits are saved.',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        action: {
                            type: 'string',
                            required: true,
                            enum: ['update_member', 'update_task', 'add_task', 'remove_task', 'remove_member'],
                        },
                        member_name: { type: 'string', description: 'Member name for update_member or remove_member.' },
                        task_id: { type: 'string', description: 'Task id for update_task or remove_task.' },
                        subject: { type: 'string', description: 'Required for add_task; optional replacement for update_task.' },
                        description: { type: 'string', description: 'Optional task description.' },
                        assignee: { type: 'string', description: 'Optional task assignee; an empty string moves it to the shared pool.' },
                        dependencies: { type: 'array', items: { type: 'string' }, description: 'Complete replacement dependency list for a task.' },
                        //#region mpd-delta edit-plan-quality-contract (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
                        // T-03 (wave 1, t14): add_task accepted ONLY subject/description/assignee/
                        // dependencies, so revising a staged plan could not EXPRESS a quality
                        // contract at all and the apply branch hard-coded `kind: 'work'` — a
                        // staged quality task was silently downgraded to legacy work. These
                        // fields carry the contract through the edit and are validated by the
                        // SAME gate create_task runs (see the apply branch).
                        kind: { type: 'string', description: 'Task kind for add_task (work, requirement, requirements, implementation, repair, verification, review, integration). Quality kinds require objective/acceptance and — for implementation/repair — inScope.' },
                        objective: { type: 'string', description: 'Declared objective; required by the quality gate for a quality kind.' },
                        acceptance: { type: 'array', items: { type: 'string' }, description: 'Complete acceptance list; required by the quality gate for a quality kind.' },
                        inScope: { type: 'array', items: { type: 'string' }, description: 'Workspace-relative POSIX paths the task may change (implementation/repair).' },
                        outOfScope: { type: 'array', items: { type: 'string' }, description: 'Paths the task must NOT change.' },
                        verify: { type: 'array', items: { type: 'string' }, description: 'Verification commands this task must run.' },
                        //#endregion mpd-delta edit-plan-quality-contract
                        role: { type: 'string', description: 'Optional member role.' },
                        provider: { type: 'string', description: 'Optional member provider; defaults to the current staged route.' },
                        model: { type: 'string', description: 'Optional member model; defaults to the current staged route.' },
                        reasoning_effort: { type: 'string', description: 'Optional member reasoning effort.' },
                        execution_prompt: { type: 'string', description: 'Optional member-specific execution prompt.' },
                    },
                },
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    status: { type: 'string', required: true },
                    team_id: { type: 'string', required: true },
                    members: { type: 'number', required: true },
                    tasks: { type: 'number', required: true },
                    dependencies: { type: 'number', required: true },
                    roster: { type: 'array', items: { type: 'string' }, required: true },
                    graph: { type: 'array', items: { type: 'string' }, required: true },
                },
            },
            render: (_args, value) => [{
                    type: 'text',
                    text: `Staged plan updated atomically (${value.members} members, ${value.tasks} tasks, ${value.dependencies} dependencies). No members were spawned and no tasks were scheduled.\n${value.graph.join('\n')}`,
                }],
        },
        async execute(args, exec) {
            const captain = requireCaptain(exec);
            const workspace = workspaceOf(captain);
            const team = await requireCaptainTeam(workspace, config, captain);
            requireStagedTeam(team);
            if (args.operations.length === 0)
                throw new Error('at least one staged plan operation is required');
            const mutations = args.operations.map((operation, index) => {
                const label = `operation ${index + 1} (${operation.action})`;
                if (operation.action === 'update_member') {
                    const memberName = operation.member_name?.trim() ?? '';
                    if (memberName === '')
                        throw new Error(`${label} requires member_name`);
                    const member = requireMember(team, memberName);
                    return {
                        action: 'update_member',
                        memberName,
                        role: operation.role ?? member.role,
                        provider: operation.provider?.trim() || member.provider || '',
                        model: operation.model?.trim() || member.model || '',
                        reasoningEffort: operation.reasoning_effort ?? member.reasoningEffort,
                        executionPrompt: operation.execution_prompt ?? member.executionPrompt,
                    };
                }
                if (operation.action === 'update_task') {
                    const taskId = operation.task_id?.trim() ?? '';
                    if (taskId === '')
                        throw new Error(`${label} requires task_id`);
                    const task = requireTask(team, taskId);
                    return {
                        action: 'update_task',
                        taskId,
                        subject: operation.subject ?? task.subject,
                        description: operation.description ?? task.description,
                        assignee: operation.assignee ?? task.assignee,
                        dependencies: operation.dependencies ?? task.dependencies,
                    };
                }
                if (operation.action === 'add_task') {
                    const subject = operation.subject?.trim() ?? '';
                    if (subject === '')
                        throw new Error(`${label} requires a non-empty subject`);
                    return {
                        action: 'add_task',
                        subject,
                        description: operation.description,
                        assignee: operation.assignee,
                        dependencies: operation.dependencies ?? [],
                        //#region mpd-delta edit-plan-add-task-mutation (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
                        // T-03 (wave 1, t14): carry the quality contract into the staged mutation.
                        kind: operation.kind,
                        objective: operation.objective,
                        acceptance: operation.acceptance,
                        inScope: operation.inScope,
                        outOfScope: operation.outOfScope,
                        verify: operation.verify,
                        //#endregion mpd-delta edit-plan-add-task-mutation
                    };
                }
                if (operation.action === 'remove_task') {
                    const taskId = operation.task_id?.trim() ?? '';
                    if (taskId === '')
                        throw new Error(`${label} requires task_id`);
                    return { action: 'remove_task', taskId };
                }
                const memberName = operation.member_name?.trim() ?? '';
                if (memberName === '')
                    throw new Error(`${label} requires member_name`);
                return { action: 'remove_member', memberName };
            });
            const updated = await updateStagedPlanBatch(captain, team.id, mutations, exec.signal);
            return {
                status: 'staged',
                team_id: updated.id,
                members: updated.members.length,
                tasks: updated.tasks.length,
                dependencies: updated.tasks.reduce((sum, task) => sum + task.dependencies.length, 0),
                roster: updated.members.map((member) => `${member.name} (${member.role || 'member'}; ${member.provider ?? ''}/${member.model ?? ''})`),
                graph: updated.tasks.map((task) => `${task.id}: ${task.subject} -> ${task.assignee || 'shared'}${task.dependencies.length === 0 ? '' : `; depends on ${task.dependencies.join(', ')}`}`),
            };
        },
    }));
    ctx.tools.register(defineTool({
        name: 'agent_teams_approve',
        description: 'Approve and start a staged team plan. Call this only in response to an explicit user approval in a new user turn; never call it during the turn that created or edited the plan. The Web Approve & Run button uses the same runtime directly.',
        parameters: {
            confirmation: { type: 'string', required: true, description: 'The user\'s explicit approval statement.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    status: { type: 'string', required: true },
                    team_id: { type: 'string', required: true },
                    members: { type: 'number', required: true },
                    tasks: { type: 'number', required: true },
                },
            },
            render: (_args, value) => [{
                    type: 'text',
                    text: `Team ${value.team_id} approved and running (${value.members} members, ${value.tasks} tasks).`,
                }],
        },
        async execute(args, exec) {
            if (args.confirmation.trim() === '')
                throw new Error('explicit user approval text is required');
            const captain = requireCaptain(exec);
            const workspace = workspaceOf(captain);
            const team = await requireCaptainTeam(workspace, config, captain);
            const approved = await approveStagedTeam(captain, team.id, exec.signal);
            return { status: 'running', team_id: approved.teamId, members: approved.members, tasks: approved.tasks };
        },
    }));
    ctx.tools.register(defineTool({
        name: 'agent_teams_add_member',
        description: 'Add a member to the team roster. In a staged team this only adds an editable plan row and does not spawn a child; approval spawns the final configuration. In a running team it creates the durable continuable member immediately.',
        parameters: {
            //#region mpd-delta member-tool-deny-param (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
            // A read-only member must be able to SAY so, or the mechanical restriction is
            // unreachable for runtime-added members (the roster profile carries the same
            // list as data). The seven names are the ones the one-shot path denies.
            toolDeny: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional tool names this member must never call. Read-only members pass the seven write-capable names the one-shot roster path denies: write, edit, mpd_hashline_edit, bash, mcp__ast_grep__rewrite, mcp__ast_grep__scan, mcp__lsp__rename.',
            },
            //#endregion mpd-delta member-tool-deny-param
            name: { type: 'string', required: true, description: 'Unique member name inside the team.' },
            role: { type: 'string', description: 'Role of the member (e.g. researcher, engineer, reviewer).' },
            provider: { type: 'string', description: 'Optional LLM provider route. Use only when the user explicitly requests a different provider; requires model.' },
            model: { type: 'string', description: 'Optional model override. Omit for the captain\'s current model (or the configured memberModel default).' },
            reasoning_effort: { type: 'string', description: 'Optional reasoning effort override: one of the target model\'s supported effort ids, or "default" to force its default. When omitted, the captain\'s effort is inherited only for the same provider/model; a changed route uses the target default.' },
            executionPrompt: { type: 'string', description: 'Optional member-specific execution prompt. It remains editable while staged.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    member_name: { type: 'string', required: true },
                    member_id: { type: 'string', required: true },
                    provider: { type: 'string', required: true },
                    model: { type: 'string', required: true },
                    reasoning_effort: { type: 'string' },
                    status: { type: 'string', required: true },
                    phase: { type: 'string', required: true },
                },
            },
            render: (args, value) => [{
                    type: 'text',
                    text: value.phase === 'staged'
                        ? `Member "${value.member_name}" added to the staged roster (${value.provider}/${value.model}); no child was spawned.`
                        : `Member "${value.member_name}" added (subagent id ${value.member_id}, ${value.provider}/${value.model}${value.reasoning_effort === undefined ? '' : `, reasoning ${value.reasoning_effort}`}, status ${value.status}).`,
                }],
        },
        async execute(args, exec) {
            const captain = requireCaptain(exec);
            const workspace = workspaceOf(captain);
            const stateRoot = stateRootOf(workspace, config);
            const team = await requireCaptainTeam(workspace, config, captain);
            const created = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id);
                const memberName = args.name.trim();
                if (memberName === '')
                    throw new Error('member name must not be empty');
                const memberKey = sanitizeKey(memberName);
                if (memberKey === CAPTAIN_KEY) {
                    throw new Error(`member name "${args.name}" is reserved for the captain`);
                }
                if (fresh.members.some((candidate) => sanitizeKey(candidate.name) === memberKey)) {
                    throw new Error(`member name "${args.name}" has already been used in team "${fresh.name}"`);
                }
                if (fresh.members.filter((candidate) => candidate.status !== 'removed').length >= config.maxMembers) {
                    throw new Error(`team "${fresh.name}" is at its member cap (${config.maxMembers})`);
                }
                const selection = await resolveMemberLlmSelection(ctx, captain, {
                    provider: args.provider,
                    model: args.model,
                    defaultModel: config.memberModel,
                    reasoningEffort: args.reasoning_effort,
                    fallback: config.fallback,
                }, exec.signal);
                const member = {
                    id: '',
                    name: memberName,
                    role: args.role,
                    provider: selection.provider,
                    model: selection.model,
                    reasoningEffort: selection.reasoningEffort,
                    executionPrompt: trimmedOptional(args.executionPrompt),
                    //#region mpd-delta member-tool-deny-add (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
                    // DEFECT (measured 2026-09-14): a member added at runtime could not declare
                    // itself read-only, so `agent_teams_add_member` produced a "read-only" member
                    // that still held write/edit/bash. The roster path carries `toolDeny` as
                    // profile data; the runtime path accepts the same list here.
                    ...(args.toolDeny === undefined ? {} : { toolDeny: [...args.toolDeny] }),
                    //#endregion mpd-delta member-tool-deny-add
                    joinedAt: Date.now(),
                    status: 'idle',
                };
                if (fresh.phase !== 'staged') {
                    await spawnMember(ctx, memberRuntime(config), memberSelections, selection, captain, fresh, member, config.stateDir, exec.signal);
                }
                fresh.members.push(member);
                try {
                    await writeTeam(stateRoot, fresh);
                }
                catch (error) {
                    // The continuable child is already live, but the durable team record
                    // never saw it. Retire the orphan so it disappears from subagent
                    // listings and cannot be resumed, then surface the write failure.
                    if (member.id !== '') {
                        await recordRetiredMemberIds(stateRoot, [member.id]).catch(() => undefined);
                        interruptMember(ctx, captain, member.id);
                    }
                    throw error;
                }
                appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/member-added', {
                    teamId: fresh.id,
                    memberId: member.id,
                    name: member.name,
                    ...member.role !== undefined ? { role: member.role } : {},
                });
                return {
                    member_name: member.name,
                    member_id: member.id,
                    provider: selection.provider,
                    model: selection.model,
                    ...selection.reasoningEffort === undefined
                        ? {}
                        : { reasoning_effort: selection.reasoningEffort },
                    status: member.status,
                    phase: fresh.phase ?? 'running',
                };
            });
            await scheduler.kickMember(workspace, team.id, created.member_name, captain);
            return created;
        },
    }));
    ctx.tools.register(defineTool({
        name: 'agent_teams_remove_member',
        description: 'Remove a member safely: revoke its current attempts, return all unfinished owned tasks to the shared pending pool, interrupt its live turn, and mark it removed.',
        parameters: {
            name: { type: 'string', required: true, description: 'Name of the member to remove.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    member_name: { type: 'string', required: true },
                    status: { type: 'string', required: true },
                    requeued_tasks: { type: 'array', items: { type: 'string' }, required: true },
                },
            },
            render: (args, value) => [{
                    type: 'text',
                    text: `Member "${value.member_name}" removed (status ${value.status}); requeued tasks: ${value.requeued_tasks.join(', ') || 'none'}.`,
                }],
        },
        async execute(args, exec) {
            const captain = requireCaptain(exec);
            const workspace = workspaceOf(captain);
            const stateRoot = stateRootOf(workspace, config);
            const team = await requireCaptainTeam(workspace, config, captain);
            const revoked = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id);
                const member = requireMember(fresh, args.name);
                const requeued = [];
                for (const task of fresh.tasks) {
                    if (task.assignee !== member.name || task.status === 'completed')
                        continue;
                    invalidateTaskAttempt(task);
                    task.reassigning = false;
                    requeued.push(task.id);
                }
                member.status = 'removed';
                await writeTeam(stateRoot, fresh);
                appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/member-removed', {
                    teamId: fresh.id,
                    memberId: member.id,
                });
                return { member: { ...member }, requeued };
            });
            if (revoked.member.id !== '') {
                await recordRetiredMemberIds(stateRoot, [revoked.member.id]);
                interruptMember(ctx, captain, revoked.member.id);
                await waitForMemberIdle(ctx, revoked.member, exec.signal);
            }
            await scheduler.kickTeam(workspace, team.id, captain);
            return {
                member_name: revoked.member.name,
                status: revoked.member.status,
                requeued_tasks: revoked.requeued,
            };
        },
    }));
    ctx.tools.register(defineTool({
        name: 'agent_teams_create_task',
        description: 'Create a task in your team\'s task list. Every call must include a non-empty subject, including verification and review tasks. Tasks can depend on other tasks (dependencies): a task is only claimable once every dependency is completed. Optionally assign it to a member, who still claims it before working.',
        parameters: {
            subject: { type: 'string', required: true, description: 'Required non-empty title for this task. Never omit it, including for verification or review tasks.' },
            description: { type: 'string', description: 'What needs to be done, in detail.' },
            dependencies: {
                type: 'array',
                items: { type: 'string' },
                description: 'Task ids this task depends on (must be completed before this task can be claimed).',
            },
            assignee: { type: 'string', description: 'Optional member name this task is intended for.' },
            kind: {
                type: 'string',
                enum: ['work', 'requirements', 'implementation', 'verification', 'review', 'repair', 'integration'],
                description: 'Task kind. Defaults to work (legacy, no quality gates). Quality kinds require a contract.',
            },
            round: { type: 'number', description: '1-based review / requirements / repair round.' },
            objective: { type: 'string', description: 'Required non-empty objective for quality kinds.' },
            inScope: { type: 'array', items: { type: 'string' }, description: 'Workspace-relative POSIX paths this task may change.' },
            outOfScope: { type: 'array', items: { type: 'string' }, description: 'Workspace-relative POSIX paths this task must not change.' },
            acceptance: { type: 'array', items: { type: 'string' }, description: 'Acceptance criteria. Required for quality kinds.' },
            verify: { type: 'array', items: { type: 'string' }, description: 'Verification commands. Required for implementation/repair.' },
            deliverables: { type: 'array', items: { type: 'string' }, description: 'Expected deliverable paths or names.' },
            nonGoals: { type: 'array', items: { type: 'string' }, description: 'Explicit non-goals.' },
            reviewedTaskId: { type: 'string', description: 'Task being reviewed. Required for kind=review.' },
            sourceTaskId: { type: 'string', description: 'Source implementation/artifact. Required for kind=repair.' },
            sourceFindingIds: { type: 'array', items: { type: 'string' }, description: 'Finding ids this repair must close.' },
            coverageOf: { type: 'array', items: { type: 'string' }, description: 'User-constraint / goal items this task covers.' },
            resume: { type: 'boolean', description: 'If true, clear halted in the same lock before creating the task.' },
            resumeReason: { type: 'string', description: 'Required non-empty reason when resume=true.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    task_id: { type: 'string', required: true },
                    subject: { type: 'string', required: true },
                    status: { type: 'string', required: true },
                    assignee: { type: 'string' },
                },
            },
            render: (args, value) => [{
                    type: 'text',
                    text: `Task "${value.subject}" created as ${value.task_id} (status ${value.status}${value.assignee ? `, assigned to ${value.assignee}` : ''}).`,
                }],
        },
        async execute(args, exec) {
            const captain = requireCaptain(exec);
            const workspace = workspaceOf(captain);
            const stateRoot = stateRootOf(workspace, config);
            const team = await requireCaptainTeam(workspace, config, captain);
            // Some models materialize optional parameters as "" instead of
            // omitting them (issue #105). Normalize blank optional fields to
            // omitted before validation so a blank value can neither be rejected
            // spuriously nor be persisted into team.json, where it would brick
            // the team on reload.
            const input = normalizeBlankOptionalTaskFields(args);
            const created = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id);
                const gate = validateCreateTask(fresh, {
                    subject: input.subject,
                    description: input.description,
                    dependencies: input.dependencies,
                    assignee: input.assignee,
                    kind: input.kind,
                    round: input.round,
                    objective: input.objective,
                    inScope: input.inScope,
                    outOfScope: input.outOfScope,
                    acceptance: input.acceptance,
                    verify: input.verify,
                    deliverables: input.deliverables,
                    nonGoals: input.nonGoals,
                    reviewedTaskId: input.reviewedTaskId,
                    sourceTaskId: input.sourceTaskId,
                    sourceFindingIds: input.sourceFindingIds,
                    coverageOf: input.coverageOf,
                    resume: input.resume,
                    resumeReason: input.resumeReason,
                });
                if (!gate.ok)
                    throw new Error(gate.error ?? 'create_task rejected by quality gates');
                if (fresh.halted === true) {
                    const resumed = resumeTeamState(fresh, args.resumeReason ?? '');
                    if (resumed.status !== 'resumed' || resumed.team === undefined) {
                        throw new Error(resumed.error ?? 'team is halted; call agent_teams_resume or pass resume=true with resumeReason');
                    }
                    fresh.halted = false;
                    fresh.haltedAt = undefined;
                    appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/team-resumed', {
                        teamId: fresh.id,
                        reason: args.resumeReason ?? '',
                    });
                }
                // Use the gate-normalized dependency list (a review's
                // reviewedTaskId is auto-wired in, so it can never dispatch
                // before its source completes).
                const dependencies = gate.task.dependencies ?? args.dependencies ?? [];
                for (const dependency of dependencies) {
                    if (!fresh.tasks.some((task) => task.id === dependency)) {
                        throw new Error(`dependency "${dependency}" does not exist in team "${fresh.name}"`);
                    }
                }
                if (args.assignee !== undefined)
                    requireMember(fresh, args.assignee);
                const kind = gate.kind ?? 'work';
                const objective = kind === 'review' || kind === 'requirements'
                    ? sanitizeReviewObjective(input.objective)
                    : input.objective;
                const acceptance = kind === 'review' || kind === 'requirements'
                    ? sanitizeReviewAcceptance(input.acceptance)
                    : input.acceptance;
                const task = {
                    id: `t${fresh.taskSeq + 1}`,
                    subject: args.subject,
                    description: args.description,
                    status: 'pending',
                    assignee: args.assignee,
                    dependencies,
                    attempt: 0,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    kind,
                    ...args.round === undefined ? {} : { round: args.round },
                    ...objective === undefined ? {} : { objective },
                    ...input.inScope === undefined ? {} : { inScope: input.inScope },
                    ...input.outOfScope === undefined ? {} : { outOfScope: input.outOfScope },
                    ...acceptance === undefined ? {} : { acceptance },
                    ...input.verify === undefined ? {} : { verify: input.verify },
                    ...input.deliverables === undefined ? {} : { deliverables: input.deliverables },
                    ...input.nonGoals === undefined ? {} : { nonGoals: input.nonGoals },
                    ...input.reviewedTaskId === undefined ? {} : { reviewedTaskId: input.reviewedTaskId },
                    ...input.sourceTaskId === undefined ? {} : { sourceTaskId: input.sourceTaskId },
                    ...input.sourceFindingIds === undefined ? {} : { sourceFindingIds: input.sourceFindingIds },
                    ...input.coverageOf === undefined ? {} : { coverageOf: input.coverageOf },
                };
                fresh.taskSeq += 1;
                fresh.tasks.push(task);
                await writeTeam(stateRoot, fresh);
                appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/task-created', {
                    teamId: fresh.id,
                    taskId: task.id,
                    subject: task.subject,
                    dependencies: task.dependencies,
                    ...task.assignee !== undefined ? { assignee: task.assignee } : {},
                    ...task.kind === undefined ? {} : { kind: task.kind },
                    ...task.round === undefined ? {} : { round: task.round },
                });
                return {
                    task_id: task.id,
                    subject: task.subject,
                    status: task.status,
                    ...task.assignee !== undefined ? { assignee: task.assignee } : {},
                };
            });
            await scheduler.kickTeam(workspace, team.id, captain);
            return created;
        },
    }));
    ctx.tools.register(defineTool({
        name: 'agent_teams_reassign_task',
        description: 'Atomically retry, reassign, or let the captain take over one ready unfinished/failed task. The old attempt is revoked before its member is interrupted, so late updates cannot overwrite the new owner. Use assignee="captain" only when you will finish that task in this turn; a captain can own only one unfinished takeover at a time, and an unfinished takeover returns to the member pool when the captain becomes idle.',
        parameters: {
            task_id: { type: 'string', required: true, description: 'Task to retry/reassign.' },
            assignee: { type: 'string', required: true, description: 'Active member name, or "captain" for captain takeover.' },
            reason: { type: 'string', description: 'Why the task is being retried or reassigned.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    task_id: { type: 'string', required: true },
                    previous_assignee: { type: 'string', required: true },
                    assignee: { type: 'string', required: true },
                    status: { type: 'string', required: true },
                    attempt: { type: 'number', required: true },
                    attempt_id: { type: 'string' },
                },
            },
            render: (_args, value) => [{
                    type: 'text',
                    text: `Task ${value.task_id} reassigned ${value.previous_assignee || 'unassigned'} → ${value.assignee} (attempt ${value.attempt}, status ${value.status}${value.attempt_id ? `, attempt_id ${value.attempt_id}` : ''}).`,
                }],
        },
        async execute(args, exec) {
            const captain = requireCaptain(exec);
            const workspace = workspaceOf(captain);
            const stateRoot = stateRootOf(workspace, config);
            const team = await requireCaptainTeam(workspace, config, captain);
            const target = args.assignee.trim();
            if (target === '')
                throw new Error('reassignment assignee must not be empty');
            const revoked = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id);
                const task = requireTask(fresh, args.task_id);
                if (task.status === 'completed')
                    throw new Error(`completed task ${task.id} is immutable and cannot be reassigned`);
                if (task.reassigning === true)
                    throw new Error(`task ${task.id} is already being reassigned`);
                const targetMember = target === CAPTAIN_KEY ? undefined : requireMember(fresh, target);
                if (target === CAPTAIN_KEY) {
                    const busy = captainOpenTask(fresh, task.id);
                    if (busy !== undefined) {
                        throw new Error(`captain is busy with ${busy.id}; complete or reassign it before taking over ${task.id}`);
                    }
                    const pending = unsatisfiedDependencies(fresh.tasks, task.dependencies);
                    if (pending.length > 0) {
                        throw new Error(`task ${task.id} is blocked by unfinished dependencies: ${pending.join(', ')} — complete them before captain takeover`);
                    }
                }
                else if (targetMember !== undefined) {
                    const busy = memberOpenTask(fresh, targetMember.name, task.id);
                    if (busy !== undefined) {
                        throw new Error(`member "${targetMember.name}" is busy with ${busy.id}; finish or reassign it first`);
                    }
                }
                const previousAssignee = task.assignee ?? '';
                const previousMember = (task.status !== 'claimed' && task.status !== 'in_progress')
                    || task.assignee === undefined || task.assignee === CAPTAIN_KEY
                    ? undefined
                    : fresh.members.find(member => member.name === task.assignee && member.status !== 'removed');
                invalidateTaskAttempt(task, target, true);
                await writeTeam(stateRoot, fresh);
                return {
                    previousAssignee,
                    previousMember: previousMember === undefined ? undefined : { ...previousMember },
                    handoffId: task.handoffId,
                };
            });
            let quiescenceError;
            if (revoked.previousMember !== undefined) {
                interruptMember(ctx, captain, revoked.previousMember.id);
                try {
                    await waitForMemberIdle(ctx, revoked.previousMember, exec.signal);
                }
                catch (error) {
                    quiescenceError = error;
                }
            }
            await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id);
                const task = requireTask(fresh, args.task_id);
                if (task.handoffId !== revoked.handoffId || task.assignee !== target || task.reassigning !== true) {
                    throw new Error(`task ${task.id} changed during reassignment; refusing to overwrite the newer state`);
                }
                task.reassigning = false;
                // Persist the retry/reassignment reason as structured state so
                // the next assignee sees it in the assignment prompt.
                if (args.reason !== undefined && args.reason.trim() !== '')
                    task.reassignReason = args.reason.trim();
                if (quiescenceError === undefined && target === CAPTAIN_KEY) {
                    beginTaskAttempt(task, CAPTAIN_KEY);
                    // The captain is already in the turn that requested takeover; there
                    // is no later member claim handshake to move claimed -> in_progress.
                    task.status = 'in_progress';
                    task.updatedAt = Date.now();
                }
                await writeTeam(stateRoot, fresh);
                appendTeamEvent(ctx, captain.session, 'agent-teams/task-updated', {
                    teamId: fresh.id,
                    taskId: task.id,
                    status: task.status,
                    assignee: task.assignee,
                    ...args.reason === undefined ? {} : { output: `Reassigned: ${args.reason}` },
                });
            });
            if (quiescenceError !== undefined)
                throw quiescenceError;
            if (target !== CAPTAIN_KEY)
                await scheduler.kickMember(workspace, team.id, target, captain);
            const current = await readTeam(stateRoot, team.id);
            const task = current === undefined ? undefined : requireTask(current, args.task_id);
            if (task === undefined)
                throw new Error(`team "${team.name}" ended during reassignment`);
            return {
                task_id: task.id,
                previous_assignee: revoked.previousAssignee,
                assignee: task.assignee ?? '',
                status: task.status,
                attempt: task.attempt ?? 0,
                ...task.attemptId === undefined ? {} : { attempt_id: task.attemptId },
            };
        },
    }));
    ctx.tools.register(defineTool({
        name: 'agent_teams_claim_task',
        description: 'Members claim their own ready task or read their existing attempt_id. Captains must use reassign_task to assign and wake a member; claim_task does not dispatch work. A member cannot own a second unfinished task. The returned attempt_id is required for updates and becomes stale after retry/reassignment.',
        parameters: {
            task_id: { type: 'string', required: true, description: 'The task id to claim.' },
            assignee: { type: 'string', description: 'Deprecated: claim_task only supports a member claiming its own task. Captains must use reassign_task.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    task_id: { type: 'string', required: true },
                    status: { type: 'string', required: true },
                    assignee: { type: 'string', required: true },
                    attempt: { type: 'number', required: true },
                    attempt_id: { type: 'string' },
                },
            },
            render: (args, value) => [{
                    type: 'text',
                    text: `Task ${value.task_id} claimed by ${value.assignee} (attempt ${value.attempt}${value.attempt_id ? `, attempt_id ${value.attempt_id}` : ''}, status ${value.status}).`,
                }],
        },
        async execute(args, exec) {
            const caller = requireCaptain(exec);
            const workspace = workspaceOf(caller);
            const stateRoot = stateRootOf(workspace, config);
            const team = await requireParticipantTeam(workspace, config, caller);
            return withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                const { team: fresh, identity } = await requireFreshParticipant(stateRoot, team.id, caller.id);
                const task = requireTask(fresh, args.task_id);
                if (task.reassigning === true) {
                    throw new Error(`task ${task.id} is being reassigned; wait for the handoff to finish`);
                }
                let assignee = task.assignee;
                if (identity.kind === 'captain') {
                    // A captain may read the capability of its already-started takeover,
                    // but must never create a member claim without dispatching it (#125):
                    // a claim with no assignment prompt leaves the member idle forever.
                    if (args.assignee !== undefined || task.assignee !== CAPTAIN_KEY
                        || (task.status !== 'claimed' && task.status !== 'in_progress')) {
                        throw new Error('claim_task is for members claiming their own task; captains must use agent_teams_reassign_task to assign and wake a member');
                    }
                }
                else {
                    if (args.assignee !== undefined) {
                        throw new Error('members cannot set assignee when claiming a task');
                    }
                    if (assignee !== undefined && assignee !== identity.name) {
                        throw new Error(`task ${task.id} is assigned to "${assignee}", not you`);
                    }
                    assignee = identity.name;
                }
                // Authorization must happen before the idempotent return: another
                // member must not receive a false success for somebody else's task.
                if (task.status === 'claimed' || task.status === 'in_progress') {
                    if (assignee === undefined || task.assignee !== assignee) {
                        throw new Error(`task ${task.id} is already claimed by "${task.assignee ?? 'nobody'}"`);
                    }
                    return {
                        task_id: task.id,
                        status: task.status,
                        assignee,
                        attempt: task.attempt ?? 0,
                        ...task.attemptId === undefined ? {} : { attempt_id: task.attemptId },
                    };
                }
                const pending = unsatisfiedDependencies(fresh.tasks, task.dependencies);
                if (pending.length > 0) {
                    throw new Error(`task ${task.id} is blocked by unfinished dependencies: ${pending.join(', ')} — complete them first`);
                }
                const transition = transitionError(task.status, 'claimed');
                if (transition !== undefined)
                    throw new Error(transition);
                if (assignee === undefined) {
                    throw new Error('claiming an unassigned task needs an assignee (claim on behalf of a member)');
                }
                const busy = memberOpenTask(fresh, assignee, task.id);
                if (busy !== undefined) {
                    throw new Error(`member "${assignee}" is busy with ${busy.id}; finish or reassign it first`);
                }
                const attemptId = beginTaskAttempt(task, assignee);
                //#region mpd-delta claim-contract-version-stamp (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
                // T-02 (wave 1, t14): remember the contract REVISION this attempt was claimed
                // under. A captain (or a member at claim time) can amend a contract while the
                // attempt keeps living, so `contractVersion` may move ahead of
                // `attemptContractVersion`; a reviewer sees the pair through
                // agent_teams_task_contract and knows the attempt worked a STALE revision.
                task.attemptContractVersion = task.contractVersion ?? 1;
                //#endregion mpd-delta claim-contract-version-stamp
                await writeTeam(stateRoot, fresh);
                appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/task-updated', {
                    teamId: fresh.id,
                    taskId: task.id,
                    status: task.status,
                    assignee: task.assignee,
                });
                return {
                    task_id: task.id,
                    status: task.status,
                    assignee: task.assignee ?? '',
                    attempt: task.attempt ?? 0,
                    attempt_id: attemptId,
                };
            });
        },
    }));
    //#region mpd-delta update-task-amend-helper (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
    /**
     * The first field an update would actually CHANGE on a TERMINAL task, or
     * undefined when the call is a pure no-op. Wave-4 DEFECT 3: comparing only
     * `status`/`output` let a `findings`/`acceptanceResults`/`commandsRun`/
     * `changedPaths`/`verdict` update report success while persisting nothing.
     * @param task - the terminal task as stored.
     * @param args - the update payload.
     * @returns the changed field's name, or undefined.
     */
    function terminalTaskChangedField(task, args) {
        const candidates = [
            ['status', args.status],
            ['output', args.output],
            ['verdict', args.verdict],
            ['changedPaths', args.changedPaths],
            ['findings', args.findings],
            ['acceptanceResults', args.acceptanceResults],
            ['commandsRun', args.commandsRun],
        ];
        for (const [name, next] of candidates) {
            if (next === undefined)
                continue;
            if (JSON.stringify(next) !== JSON.stringify(task[name] ?? undefined))
                return name;
        }
        return undefined;
    }
    /**
     * The nodes an amendment invalidates: the amended task plus every TRANSITIVE
     * DEPENDENT (a node whose dependency closure reaches the amended task). Upstream
     * `task.definition` walks the same direction (`dag.definition.amended.
     * invalidatedNodeIds`). Nodes UPSTREAM of the amendment keep their cached
     * results; affected completed nodes are reset so the scheduler re-runs them.
     * @param tasks - the team's task list.
     * @param amendedId - the id of the task whose definition changed.
     * @returns the invalidated ids, amended first.
     */
    function amendedInvalidatedIds(tasks, amendedId) {
        const dependents = new Set();
        let grew = true;
        // Reachability transitively: seed with direct dependents, then grow while any
        // new node's dependents join.
        const direct = (id) => tasks.filter((candidate) => (candidate.dependencies ?? []).includes(id)).map((candidate) => candidate.id);
        for (const id of direct(amendedId))
            dependents.add(id);
        while (grew) {
            grew = false;
            for (const id of [...dependents]) {
                for (const next of direct(id)) {
                    if (!dependents.has(next)) {
                        dependents.add(next);
                        grew = true;
                    }
                }
            }
        }
        return [amendedId, ...dependents];
    }
    /** Whether an `amend` payload actually changes the task definition. */
    function amendChangesDefinition(task, amend) {
        const sameList = (current, next) => {
            const left = [...(current ?? [])].sort();
            const right = [...next].sort();
            return left.length === right.length && left.every((item, index) => item === right[index]);
        };
        if (amend.subject !== undefined && amend.subject !== task.subject)
            return true;
        if (amend.description !== undefined && amend.description !== (task.description ?? ''))
            return true;
        if (amend.dependencies !== undefined && !sameList(task.dependencies, amend.dependencies))
            return true;
        if (amend.acceptance !== undefined && !sameList(task.acceptance, amend.acceptance))
            return true;
        if (amend.verify !== undefined && !sameList(task.verify, amend.verify))
            return true;
        if (amend.inScope !== undefined && !sameList(task.inScope, amend.inScope))
            return true;
        if (amend.outOfScope !== undefined && !sameList(task.outOfScope, amend.outOfScope))
            return true;
        return false;
    }
    //#endregion mpd-delta update-task-amend-helper
    //#region mpd-delta path-ownership-tools (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
    // T-01 (wave 1, t20): ownership becomes QUERYABLE and REPAIRABLE. Before this, the only way
    // past an `inScope overlaps <id>` refusal was delete + re-create, which renumbers the task and
    // downgrades it; the query and the repair below use the refusal's OWN match rule
    // (`pathMatchesScope`), so the answer can never drift from the gate.
    ctx.tools.register(defineTool({
        name: 'agent_teams_path_owner',
        description: 'READ-ONLY preflight: who owns a workspace path? Lists every write task whose inScope matches it, with the matching patterns, any outOfScope pattern that excludes it, and the repair call to move the path. Use it BEFORE declaring inScope, and to answer "who owns <path>" when a create was refused.',
        parameters: {
            path: { type: 'string', description: 'Workspace-relative path, e.g. "packages/foo/src/index.ts" or "packages/foo/src/**".' },
            open_only: { type: 'boolean', description: 'Only tasks that can still be dispatched (pending/claimed/in_progress).' },
        },
        output: {
            schema: { type: 'object', additionalProperties: true, properties: {} },
            render: (_args, value) => [{ type: 'text', text: renderScopeOwners(value) }],
        },
        async execute(args, exec) {
            const caller = requireCaptain(exec);
            const workspace = workspaceOf(caller);
            const stateRoot = stateRootOf(workspace, config);
            const located = await requireParticipantTeam(workspace, config, caller);
            const { team } = await withTeamLock(teamLockKey(stateRoot, located.id), () => requireFreshParticipant(stateRoot, located.id, caller.id));
            const owners = scopeOwners(team, args.path, { openOnly: args.open_only === true });
            return {
                path: String(args.path ?? ''),
                open_only: args.open_only === true,
                owners,
                open_owners: owners.filter((owner) => owner.open),
                repair: owners.length === 0
                    ? null
                    : { tool: 'agent_teams_move_path', path: String(args.path ?? ''), from_task: owners[0].task_id },
                note: owners.length === 0
                    ? 'no write task declares this path in scope: the path is free to declare'
                    : 'a create whose inScope collides with an OPEN owner is refused by the overlap gate; repair it with the move_path call above instead of recreating a task',
            };
        },
    }));
    ctx.tools.register(defineTool({
        name: 'agent_teams_move_path',
        description: 'CAPTAIN ONLY: move ONE path pattern from the task that currently owns it to another task, WITHOUT remove+re-add — both tasks keep their id, status and attempt, so nothing is renumbered or downgraded. The donor loses the pattern from inScope, the target gains it (and any matching outOfScope pattern is carved out so the move is effective). Refuses a path the donor does not own, an unknown or terminal target, and a move that would contradict the target or collide with another open write task.',
        parameters: {
            path: { type: 'string', description: 'The exact inScope pattern to move, e.g. "packages/foo/**".' },
            to_task: { type: 'string', description: 'Task id that should own the pattern.' },
            from_task: { type: 'string', description: 'Task id that currently owns it. Omit to infer it when exactly ONE open write task matches the path.' },
        },
        output: {
            schema: { type: 'object', additionalProperties: true, properties: {} },
            render: (_args, value) => [{ type: 'text', text: renderMovePath(value) }],
        },
        async execute(args, exec) {
            const captain = requireCaptain(exec);
            const workspace = workspaceOf(captain);
            const stateRoot = stateRootOf(workspace, config);
            const located = await requireCaptainTeam(workspace, config, captain);
            return withTeamLock(teamLockKey(stateRoot, located.id), async () => {
                const fresh = await requireFreshCaptainTeam(stateRoot, located.id, captain.id);
                const path = String(args.path ?? '').trim();
                if (path === '')
                    throw new Error('path is required');
                const targetId = String(args.to_task ?? '').trim();
                const target = fresh.tasks.find((task) => task.id === targetId);
                if (target === undefined)
                    throw new Error(`to_task "${targetId}" does not exist in team "${fresh.name}"`);
                if (!isOpenTaskStatus(target.status))
                    throw new Error(`to_task "${targetId}" is ${target.status}: a moved path must land on a task that can still run`);
                const matches = fresh.tasks.filter((task) => Array.isArray(task.inScope) && task.inScope.includes(path));
                if (matches.length === 0)
                    throw new Error(`no task declares "${path}" in inScope; nothing to move`);
                let donor = matches[0];
                if (args.from_task !== undefined && String(args.from_task).trim() !== '') {
                    const named = matches.find((task) => task.id === String(args.from_task).trim());
                    if (named === undefined)
                        throw new Error(`from_task "${String(args.from_task)}" does not declare "${path}" in inScope (owners: ${matches.map((task) => task.id).join(', ')})`);
                    donor = named;
                }
                else if (matches.length > 1) {
                    throw new Error(`"${path}" is declared by ${matches.length} tasks (${matches.map((task) => task.id).join(', ')}); pass from_task explicitly`);
                }
                if (donor.id === target.id)
                    throw new Error(`"${path}" is already owned by "${donor.id}"`);
                const donorBefore = donor.inScope.length;
                const donorScope = donor.inScope.filter((pattern) => pattern !== path);
                const targetScope = [...(target.inScope ?? [])];
                if (!targetScope.includes(path))
                    targetScope.push(path);
                // The donor's own outOfScope must not exclude what it still owns, and the target's
                // outOfScope must not silently exclude the path it just gained — carve both.
                donor.outOfScope = (donor.outOfScope ?? []).filter((pattern) => !targetScope.includes(pattern) || !pathMatchesScope(path, pattern));
                donor.inScope = donorScope;
                target.outOfScope = (target.outOfScope ?? []).filter((pattern) => !pathMatchesScope(path, pattern));
                target.inScope = targetScope;
                const targetContract = contractContradiction(target.inScope ?? [], target.outOfScope ?? []);
                if (targetContract !== undefined) {
                    donor.inScope = donor.inScope.concat(path);
                    throw new Error(`moving "${path}" to "${target.id}" would contradict its contract: "${targetContract.inScope}" is forbidden by outOfScope "${targetContract.outOfScope}"`);
                }
                for (const other of fresh.tasks) {
                    if (other.id === donor.id || other.id === target.id)
                        continue;
                    if (!isOpenTaskStatus(other.status))
                        continue;
                    const overlap = inScopeOverlap(target.inScope, other.inScope ?? []);
                    if (overlap.length > 0)
                        throw new Error(`moving "${path}" to "${target.id}" would overlap ${describeScopeOwner({ task_id: other.id, subject: other.subject ?? '', status: other.status, assignee: other.assignee ?? '' })} at ${overlap.join(', ')}`);
                }
                const now = Date.now();
                donor.updatedAt = now;
                target.updatedAt = now;
                await writeTeam(stateRoot, fresh);
                return {
                    moved: true,
                    path,
                    from_task: donor.id,
                    from_scope_after: donor.inScope,
                    from_scope_size_before: donorBefore,
                    to_task: target.id,
                    to_scope_after: target.inScope,
                    preserved: { ids: [donor.id, target.id], statuses: [donor.status, target.status], attempts: [donor.attemptId ?? '', target.attemptId ?? ''] },
                    note: 'both tasks kept their id, status and attempt — no remove+re-add',
                };
            });
        },
    }));
    ctx.tools.register(defineTool({
        name: 'agent_teams_rollover',
        description: 'CAPTAIN ONLY: close the current WAVE of this team and open the next one. Refused while ANY task is non-terminal (a wave rolls over when its work is done, never mid-flight — the refusal names the open ids). On success the closed wave is archived durably under <team>/waves/<label>.json WITH its tasks, the live task list is emptied, and the wave label advances (w1 -> w2). Status shows the label and the archived waves, so the boundary no longer lives in the captain\'s discipline.',
        parameters: {
            wave_label: { type: 'string', description: 'Optional label to record for the CLOSED wave (defaults to the current label).' },
            reason: { type: 'string', description: 'Optional note recorded in the archive record.' },
        },
        output: {
            schema: { type: 'object', additionalProperties: true, properties: {} },
            render: (_args, value) => [{ type: 'text', text: renderRollover(value) }],
        },
        async execute(args, exec) {
            const captain = requireCaptain(exec);
            const workspace = workspaceOf(captain);
            const stateRoot = stateRootOf(workspace, config);
            const located = await requireCaptainTeam(workspace, config, captain);
            return withTeamLock(teamLockKey(stateRoot, located.id), async () => {
                const fresh = await requireFreshCaptainTeam(stateRoot, located.id, captain.id);
                const current = waveOf(fresh);
                const open = fresh.tasks.filter((task) => !TERMINAL_TASK_STATUSES.includes(task.status));
                if (open.length > 0) {
                    throw new Error(`wave "${current.label}" cannot roll over: ${open.length} task(s) are still non-terminal (${open.map((task) => `${task.id}:${task.status}`).join(', ')}); finish, cancel or reassign them first — a wave boundary never cancels work`);
                }
                const now = Date.now();
                const closedLabel = typeof args.wave_label === 'string' && args.wave_label.trim() !== '' ? args.wave_label.trim() : current.label;
                const archive = {
                    team_id: fresh.id,
                    team_name: fresh.name,
                    label: closedLabel,
                    openedAt: current.openedAt,
                    closedAt: now,
                    closedBy: captain.id,
                    ...args.reason === undefined ? {} : { reason: String(args.reason) },
                    tasks: fresh.tasks,
                    counts: {
                        total: fresh.tasks.length,
                        completed: fresh.tasks.filter((task) => task.status === 'completed').length,
                        failed: fresh.tasks.filter((task) => task.status === 'failed').length,
                        cancelled: fresh.tasks.filter((task) => task.status === 'cancelled').length,
                    },
                };
                const archivePath = await writeWaveArchive(stateRoot, fresh.id, archive);
                const next = nextWave(current, now);
                fresh.wave = next;
                fresh.waveHistory = [...(Array.isArray(fresh.waveHistory) ? fresh.waveHistory : []), { label: closedLabel, closedAt: now, archivedTasks: fresh.tasks.length, archive: relative(stateRoot, archivePath).split('\\').join('/') }];
                fresh.tasks = [];
                fresh.taskSeq = 0;
                fresh.updatedAt = now;
                await writeTeam(stateRoot, fresh);
                appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/wave-rollover', {
                    teamId: fresh.id,
                    closedWave: closedLabel,
                    nextWave: next.label,
                    archivedTasks: archive.counts.total,
                });
                return {
                    rolled_over: true,
                    closed_wave: closedLabel,
                    next_wave: next.label,
                    archived_tasks: archive.counts.total,
                    counts: archive.counts,
                    archive_path: archivePath,
                    wave_history: fresh.waveHistory,
                    note: 'the closed wave\'s tasks live in the archive record; the live list starts empty',
                };
            });
        },
    }));
    /** Render the who-owns answer (T-01). */
    function renderScopeOwners(value) {
        const owners = Array.isArray(value.owners) ? value.owners : [];
        if (owners.length === 0) {
            return `No write task declares "${value.path}" in scope${value.open_only ? ' (open tasks only)' : ''}: the path is free to declare.`;
        }
        const lines = [`Owners of "${value.path}"${value.open_only ? ' (open tasks only)' : ''}:`];
        for (const owner of owners) {
            lines.push(`  - ${owner.task_id} [${owner.kind}/${owner.status}]${owner.assignee === '' ? '' : ` ${owner.assignee}`}${owner.subject === '' ? '' : ` — ${owner.subject}` } via ${owner.matched.join(', ')}${owner.excluded_by.length > 0 ? ` (also matched by outOfScope ${owner.excluded_by.join(', ')}, so it may NOT write it)` : ''}`);
        }
        if (value.repair !== null && value.repair !== undefined) {
            lines.push(`Repair without remove+re-add: agent_teams_move_path { path: "${value.repair.path}", from_task: "${value.repair.from_task}", to_task: "<the task that should own it>" }`);
        }
        return lines.join('\n');
    }
    /** Render the move-path result (T-01). */
    function renderMovePath(value) {
        if (value.moved !== true) {
            return `Move refused: ${String(value.error ?? 'unknown reason')}`;
        }
        return `Moved "${value.path}" from ${value.from_task} to ${value.to_task}.\n  ${value.from_task} inScope: ${value.from_scope_after.join(', ') || '(none)'}\n  ${value.to_task} inScope: ${value.to_scope_after.join(', ') || '(none)'}\n  ${String(value.note)}`;
    }
    /** Render the rollover result (T-12). */
    function renderRollover(value) {
        if (value.rolled_over !== true) {
            return `Rollover refused: ${String(value.error ?? 'unknown reason')}`;
        }
        const counts = value.counts ?? {};
        return `Wave ${value.closed_wave} closed and archived (${value.archived_tasks} task(s): ${counts.completed ?? 0} completed, ${counts.failed ?? 0} failed, ${counts.cancelled ?? 0} cancelled).\n  archive: ${value.archive_path}\n  now working: ${value.next_wave}\n  ${String(value.note)}`;
    }
    //#endregion mpd-delta path-ownership-tools
    ctx.tools.register(defineTool({
        name: 'agent_teams_update_task',
        //#region mpd-delta update-task-contract (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
        description: 'Update a task status/output. `status` is REQUIRED on every call: a payload-only update repeats the current status explicitly, because an omitted status persists the rest of the payload while leaving the task unchanged (wave-2 DEFECT 6). Members must supply the current attempt_id returned by claim_task; an omitted attempt_id is rejected as missing (never misreported as a stale attempt) and a stale attempt is rejected after takeover/reassignment. Split an oversized update into several small calls and end with a minimal {task_id, status, attempt_id[, verdict]} call. Terminal results are immutable. A captain must use reassign_task(assignee="captain") before updating member-owned work.',
        //#endregion mpd-delta update-task-contract
        parameters: {
            task_id: { type: 'string', required: true, description: 'The task id to update.' },
            //#region mpd-delta update-task-required-status-param (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
            // Wave-2 DEFECT 6: an OVERSIZED arguments payload lost its trailing `status` key at
            // emission time, so the rest of the payload persisted while the task stayed in
            // `in_progress` and the tool reported the unchanged state back. The key was never
            // emitted — the raw provider fragment stream is byte-identical to the assembled
            // arguments and the harness parse is key-lossless, so no layer inside the plugin can
            // size-check the loss. REQUIRING the parameter makes the omission loud at the tool
            // boundary (the argument validator answers `missing required property "status"`),
            // and a payload-only update now repeats the current status explicitly.
            status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed', 'failed', 'cancelled'],
                required: true,
                description: 'New status (pending, in_progress, completed, failed, cancelled). REQUIRED: a payload-only update repeats the current status; an omitted status cannot silently leave the task unchanged. `pending` is how a captain amends a task that has NOT started yet (wave-4: without it, a defective contract on a pending task was unfixable by any surface).',
            },
            //#endregion mpd-delta update-task-required-status-param
            output: { type: 'string', description: 'Result summary; set when completing or failing.' },
            //#region mpd-delta terminal-output-append (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
            // T-52 (wave 1, t14): a completed task's `output` was immutable, so a summary that
            // was lost or truncated at completion could never be repaired — measured 2026-09-16,
            // when a real summary was lost on a terminal task and the only offered remedy was
            // reassign_task (which re-runs the work and discards the record). This parameter is
            // an APPEND-ONLY repair: it may only EXTEND the stored output, never replace it, and
            // it is accepted on a TERMINAL task only. Every other terminal field stays immutable.
            output_append: { type: 'string', description: 'APPEND-only repair of a TERMINAL task\'s stored output: the text is appended to the existing result summary (never replaces it). Use this when a summary was lost or truncated at completion; supply `output` instead while the task is still running.' },
            //#endregion mpd-delta terminal-output-append
            //#region mpd-delta artifact-channel-params (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
            // T-09/T-10 (wave 1, t19): the FIRST-CLASS artifact channel. A long deliverable no
            // longer has to fit the result cap (its tail was being dropped), and a READ-ONLY seat
            // gets a sanctioned evidence write without `write`/`edit`/`bash`. The guards are
            // mechanical (apply region + helper): workspace-relative only, no `..`, never inside
            // the team state dir, only regular files, append-or-create so the channel can never
            // destroy a byte, and a read-only seat may only write under `evidence/**`.
            artifact: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    path: { type: 'string', required: true },
                    text: { type: 'string', required: true },
                },
                description: 'Attach a LONG deliverable: {path, text} writes the full text to a workspace-relative path and records the path and byte count on the task. Append-or-create (never truncates); a seat whose write/edit/bash are denied may only use evidence/**.',
            },
            replace_output: { type: 'boolean', description: 'Confirm that `output` REPLACES an existing stored summary longer than 240 chars. Omit it to be refused loudly and use output_append to extend instead.' },
            //#endregion mpd-delta artifact-channel-params
            attempt_id: { type: 'string', description: 'Current execution capability returned by claim_task (required for members when present on the task).' },
            verdict: {
                type: 'string',
                enum: ['pass', 'needs_revision', 'reject'],
                description: 'Required for completing requirements/review. needs_revision and reject must fail the task.',
            },
            findings: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        id: { type: 'string', required: true },
                        severity: { type: 'string', enum: ['low', 'medium', 'high', 'blocker'], required: true },
                        problem: { type: 'string', required: true },
                        requiredFix: { type: 'string', required: true },
                        file: { type: 'string' },
                        line: { type: 'number' },
                        resolved: { type: 'boolean' },
                    },
                },
                description: 'Structured review findings. Required when verdict is needs_revision or reject; each item needs id, severity, problem, and requiredFix.',
            },
            changedPaths: {
                type: 'array',
                items: { type: 'string' },
                description: 'Workspace-relative POSIX paths changed by this implementation/repair.',
            },
            acceptanceResults: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        criterion: { type: 'string', required: true },
                        status: { type: 'string', enum: ['passed', 'failed'], required: true },
                        evidence: { type: 'string' },
                    },
                },
                description: 'Acceptance evidence in contract order: {criterion, status:"passed"|"failed", evidence?}. Supply one item per acceptance criterion.',
            },
            commandsRun: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        command: { type: 'string', required: true },
                        status: { type: 'string', enum: ['passed', 'failed'], required: true },
                        exitCode: { type: 'number' },
                        evidence: { type: 'string' },
                    },
                },
                description: 'Verification evidence in contract order: {command, status:"passed"|"failed", exitCode?, evidence?}. Supply one item per verify command.',
            },
            // S2 (mass-ulw "revision without re-running completed work"): a CAPTAIN may
            // amend a task's definition on a RUNNING team. A real change re-runs the
            // amended task AND its TRANSITIVE DEPENDENTS (their input changed), while
            // any completed node whose own definition is unchanged and whose transitive
            // dependencies did not change KEEPS its cached result — exactly the upstream
            // amend semantics (dag.definition.amended.invalidatedNodeIds). Tasks upstream
            // of the amendment are never touched.
            amend: {
                type: 'object',
                additionalProperties: false,
                description: 'Amend a task definition. A real change re-runs this task and its transitive dependents; unaffected completed nodes keep their results.',
                properties: {
                    subject: { type: 'string', description: 'Replacement subject.' },
                    description: { type: 'string', description: 'Replacement description.' },
                    dependencies: { type: 'array', items: { type: 'string' }, description: 'Complete replacement dependency list.' },
                    acceptance: { type: 'array', items: { type: 'string' }, description: 'Complete replacement acceptance list.' },
                    //#region mpd-delta update-task-amend-scope (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
                    // Wave-4 GAP 5 (measured live): `inScope`/`outOfScope` were amendable by
                    // NOBODY — no captain surface exposed them and a scope is frozen once the
                    // task exists — so a captain-authored scope defect could only be repaired
                    // by failing the task and re-running its dependents (measured twice in one
                    // wave, each costing a fail-and-retry cycle). They are plain definition
                    // fields, amended exactly like the other lists. The region ends BEFORE
                    // `verify` on purpose: the closing braces after it are not a unique
                    // anchor window, and the applier refuses a far-away or ambiguous one.
                    inScope: { type: 'array', items: { type: 'string' }, description: 'Complete replacement of the workspace-relative POSIX paths this task may change.' },
                    outOfScope: { type: 'array', items: { type: 'string' }, description: 'Complete replacement of the paths this task must NOT change.' },
                    //#endregion mpd-delta update-task-amend-scope
                    verify: { type: 'array', items: { type: 'string' }, description: 'Complete replacement verify list.' },
                },
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    task_id: { type: 'string', required: true },
                    status: { type: 'string', required: true },
                    output: { type: 'string' },
                    attempt: { type: 'number', required: true },
                    attempt_id: { type: 'string' },
                    //#region mpd-delta artifact-channel-result (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
                    // T-09: the task RESULT records where the full text landed, so a deliverable that
                    // cannot fit the summary is never "somewhere on disk" the reader cannot name.
                    artifact_path: { type: 'string' },
                    artifact_bytes: { type: 'number' },
                    //#endregion mpd-delta artifact-channel-result
                },
            },
            render: (args, value) => [{
                    type: 'text',
                    text: `Task ${value.task_id} attempt ${value.attempt} → ${value.status}${value.output !== undefined ? `\nOutput: ${value.output}` : ''}`,
                }],
        },
        async execute(args, exec) {
            { const __held = watchdogHoldOf(ctx, freshTeamProbeId, workspaceOf(exec.agent)); if (__held !== undefined) throw new Error(`team ${freshTeamProbeId} is held by the team watchdog (hold ${__held.holdId}); the team must be released with the watchdog's own session-watchdog-resume action before any further work`); }
            const caller = requireCaptain(exec);
            const workspace = workspaceOf(caller);
            const stateRoot = stateRootOf(workspace, config);
            const team = await requireParticipantTeam(workspace, config, caller);
            const updated = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                const { team: fresh, identity } = await requireFreshParticipant(stateRoot, team.id, caller.id);
                const task = requireTask(fresh, args.task_id);
                //#region mpd-delta update-task-amend-owned-task (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
                // T-02 (wave 1, t14): an OWNED task's contract used to be unrepairable from both
                // ends — the captain had to reassign (a takeover that revokes the live attempt)
                // before it could correct a wrong acceptance/inScope, and the owner could not amend
                // at all (the member branch below refused, and the repair workaround "the owner
                // self-amends at claim time" did not exist). Measured 2026-09-17 on this wave's own
                // t9: both ends refused. An AMEND is a DEFINITION-only action, so it is allowed on a
                // member-owned task now; every other captain write on that task still refuses here,
                // exactly as before. REPLACEMENT-SHAPED: the upstream `if (...)` was rewritten, so a
                // re-materialize makes the applier REFUSE loudly (file byte-untouched) instead of
                // silently restoring the old unrepairable guard; remedy = restore the region or
                // re-author it plus `--write-registry`.
                if (identity.kind === 'captain'
                    && args.amend === undefined
                    && task.assignee !== undefined
                    && task.assignee !== CAPTAIN_KEY) {
                    throw new Error(`task ${task.id} is owned by member "${task.assignee}"; call agent_teams_reassign_task with assignee="captain" before takeover`);
                }
                //#endregion mpd-delta update-task-amend-owned-task
                if (identity.kind === 'member') {
                    if (task.assignee !== identity.name) {
                        throw new Error(`task ${task.id} is assigned to "${task.assignee ?? 'nobody'}", not you`);
                    }
                    //#region mpd-delta member-amend-at-claim-time (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
                    // T-02 (wave 1, t14): a member MAY amend the contract of a task it owns AT CLAIM
                    // TIME — the one window where the contract has been read but no work has been
                    // recorded yet, i.e. exactly when a contradictory or wrong acceptance is
                    // discovered. The amend branch below returns before any status/output write, so
                    // this cannot lose work; anywhere else (in_progress, terminal) the amendment
                    // stays a captain action and is refused LOUDLY, never silently ignored
                    // (wave-4 DEFECT 2 kept: a silent no-op is worse than a refusal).
                    const amendOnly = args.amend !== undefined
                        && args.output === undefined && args.verdict === undefined
                        && args.findings === undefined && args.acceptanceResults === undefined
                        && args.commandsRun === undefined && args.changedPaths === undefined;
                    if (args.amend !== undefined && task.status !== 'claimed') {
                        throw new Error(`task ${task.id} is ${task.status}: a member may amend a contract ONLY at claim time (status "claimed"); ask the captain to amend it otherwise`);
                    }
                    //#endregion mpd-delta member-amend-at-claim-time
                    //#region mpd-delta update-task-required-attempt-id (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
                    // Wave-2 DEFECT 5: `task.attemptId !== undefined && args.attempt_id !== task.attemptId`
                    // compares an OMITTED attempt_id as unequal, so a payload that dropped the parameter
                    // surfaced as `stale attempt … stop work and request fresh assignment` and cost a
                    // captain reassign cycle while the attempt was actually current. Branch on the
                    // omission FIRST and say the parameter is required; the stale wording stays reserved
                    // for a present-but-mismatched id. T-02 (t14) adds ONE carve-out: an amend-ONLY call
                    // may omit the id (the amend branch returns before any write, so an omitted
                    // capability cannot lose work); a SUPPLIED id is still validated below.
                    if (task.attemptId !== undefined && (args.attempt_id === undefined || args.attempt_id === '')) {
                        if (amendOnly !== true)
                            throw new Error(`attempt_id is required for task ${task.id}: call agent_teams_claim_task to read the current attempt_id, then repeat this update with attempt_id="<value>"`);
                    }
                    //#endregion mpd-delta update-task-required-attempt-id
                    if (task.attemptId !== undefined && args.attempt_id !== undefined && args.attempt_id !== '' && args.attempt_id !== task.attemptId) {
                        throw new Error(`stale attempt for task ${task.id}: expected the current attempt_id; stop work and request fresh assignment`);
                    }
                }
                //#region mpd-delta artifact-channel-apply (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
                // T-09/T-10 (wave 1, t19): the artifact attach is its OWN atomic operation — it
                // validates, writes the file and records it on the task under the same lock, then
                // returns. It never touches status/output/verdict, so it is legal on a RUNNING and
                // on a TERMINAL task alike (repairing the evidence of a finished task is the same
                // class as T-52's append-only output repair).
                if (args.artifact !== undefined) {
                    const record = writeTaskArtifact(workspace, stateRoot, fresh, identity, args.artifact);
                    task.artifacts = [...(task.artifacts ?? []), record];
                    task.updatedAt = Date.now();
                    await writeTeam(stateRoot, fresh);
                    appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/task-artifact', {
                        teamId: fresh.id,
                        taskId: task.id,
                        path: record.path,
                        bytes: record.bytes,
                        appended: record.appended,
                    });
                    return {
                        task_id: task.id,
                        status: task.status,
                        attempt: task.attempt ?? 0,
                        artifact_path: record.path,
                        artifact_bytes: record.bytes,
                        ...task.attemptId === undefined ? {} : { attempt_id: task.attemptId },
                    };
                }
                //#endregion mpd-delta artifact-channel-apply
                if (TERMINAL_TASK_STATUSES.includes(task.status)) {
                    //#region mpd-delta terminal-output-append-apply (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
                    // T-52 (wave 1, t14): the ONE terminal mutation that is allowed. The stored
                    // bytes are never rewritten — the new value STARTS with the old one — so a
                    // reviewer still reads the original summary and sees exactly what was added.
                    if (args.output_append !== undefined) {
                        const appended = args.output_append.trim();
                        if (appended === '')
                            throw new Error('output_append must not be blank; omit it to leave the terminal result unchanged');
                        const before = task.output ?? '';
                        task.output = before === '' ? appended : `${before}\n\n${appended}`;
                        task.updatedAt = Date.now();
                        await writeTeam(stateRoot, fresh);
                        appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/task-output-appended', {
                            teamId: fresh.id,
                            taskId: task.id,
                            addedChars: appended.length,
                        });
                        return {
                            task_id: task.id,
                            status: task.status,
                            attempt: task.attempt ?? 0,
                            output: task.output,
                            ...task.attemptId === undefined ? {} : { attempt_id: task.attemptId },
                        };
                    }
                    //#endregion mpd-delta terminal-output-append-apply
                    //#region mpd-delta update-task-amend-terminal (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
                    // S2: an amendment is an explicit captain action on the DEFINITION, so a
                    // real change is allowed to revive a terminal task (and re-runs its
                    // transitive dependents) instead of being refused as an immutable
                    // terminal write. A no-op amendment still repeats the terminal state.
                    if (args.amend !== undefined && identity.kind === 'captain' && amendChangesDefinition(task, args.amend)) {
                        const invalidated = new Set(amendedInvalidatedIds(fresh.tasks, task.id));
                        const invalidatedIds = [];
                        for (const candidate of fresh.tasks) {
                            if (!invalidated.has(candidate.id))
                                continue;
                            invalidatedIds.push(candidate.id);
                            candidate.status = 'pending';
                            candidate.attempt = (candidate.attempt ?? 0) + 1;
                            candidate.attemptId = undefined;
                            candidate.verdict = undefined;
                            candidate.findings = undefined;
                            candidate.acceptanceResults = undefined;
                            candidate.commandsRun = undefined;
                            candidate.reviewedAt = undefined;
                        }
                        if (args.amend.subject !== undefined)
                            task.subject = args.amend.subject;
                        if (args.amend.description !== undefined)
                            task.description = args.amend.description;
                        if (args.amend.dependencies !== undefined)
                            task.dependencies = [...args.amend.dependencies];
                        if (args.amend.acceptance !== undefined)
                            task.acceptance = [...args.amend.acceptance];
                        if (args.amend.verify !== undefined)
                            task.verify = [...args.amend.verify];
                        if (args.amend.inScope !== undefined)
                            task.inScope = [...args.amend.inScope];
                        if (args.amend.outOfScope !== undefined)
                            task.outOfScope = [...args.amend.outOfScope];
                        task.updatedAt = Date.now();
                        await writeTeam(stateRoot, fresh);
                        appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/task-amended', {
                            teamId: fresh.id,
                            taskId: task.id,
                            invalidatedNodeIds: invalidatedIds,
                        });
                        return {
                            task_id: task.id,
                            status: task.status,
                            attempt: task.attempt ?? 0,
                        };
                    }
                    //#endregion mpd-delta update-task-amend-terminal
                    //#region mpd-delta update-task-terminal-immutable-fields (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
                    // Wave-4 DEFECT 3 (measured live): the terminal guard compared only
                    // `status` and `output`, so a changed `verdict` / `findings` /
                    // `acceptanceResults` / `commandsRun` / `changedPaths` answered
                    // SUCCESS and persisted NOTHING — a member's findings update echoed
                    // success while `resolved` stayed false in team.json. Every mutable
                    // field is compared now, and any real change is refused LOUDLY.
                    {
                        const changedField = terminalTaskChangedField(task, args);
                        if (changedField !== undefined) {
                            throw new Error(`terminal task ${task.id} is immutable: ${changedField} would change; use agent_teams_reassign_task to retry failed/cancelled work`);
                        }
                    }
                    //#endregion mpd-delta update-task-terminal-immutable-fields
                    const sameStatus = args.status === undefined || args.status === task.status;
                    const sameOutput = args.output === undefined || args.output === task.output;
                    if (!sameStatus || !sameOutput) {
                        throw new Error(`terminal task ${task.id} is immutable; use agent_teams_reassign_task to retry failed/cancelled work`);
                    }
                    return {
                        task_id: task.id,
                        status: task.status,
                        attempt: task.attempt ?? 0,
                        ...task.attemptId === undefined ? {} : { attempt_id: task.attemptId },
                        ...task.output !== undefined ? { output: task.output } : {},
                    };
                }
                // Blank optional list entries (e.g. changedPaths:[""]) must not be
                // persisted: hasValidQualityTaskFields rejects them on reload and
                // would brick the whole team state (issue #105 class).
                const input = normalizeBlankOptionalTaskFields(args);
                const findings = parseFindings(args.findings);
                const acceptanceResults = parseAcceptanceResults(args.acceptanceResults);
                const commandsRun = parseCommandResults(args.commandsRun);
                //#region mpd-delta update-task-amend-running (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
                // S2 on a non-terminal task: amend the definition and reset ONLY the amended
                // task plus its transitive dependents, so completed nodes whose inputs did
                // not change keep their cached results and the scheduler re-runs the rest.
                // T-02 (wave 1, t14) adds TWO things here:
                //   * a member may amend AT CLAIM TIME (the member-amend region above admitted
                //     only status "claimed"), so the gate below admits that one member case;
                //   * an IN-FLIGHT task (claimed/in_progress) keeps its attempt and its owner:
                //     invalidating it would be the takeover T-02 exists to remove. Nothing is
                //     invalidated for an in-flight task because its output does not exist yet —
                //     the dependents run later, against the amended contract.
                // Every real amendment is STAMPED (contractVersion/By/At) so a verifier can see
                // which revision an attempt was claimed under (claim_task stamps
                // attemptContractVersion, exposed by agent_teams_task_contract).
                if (args.amend !== undefined
                    && (identity.kind === 'captain' || (identity.kind === 'member' && task.status === 'claimed'))) {
                    if (amendChangesDefinition(task, args.amend)) {
                        const inflight = task.status === 'claimed' || task.status === 'in_progress';
                        const invalidated = new Set(inflight ? [] : amendedInvalidatedIds(fresh.tasks, task.id));
                        const invalidatedIds = [];
                        for (const candidate of fresh.tasks) {
                            if (!invalidated.has(candidate.id))
                                continue;
                            invalidatedIds.push(candidate.id);
                            candidate.status = 'pending';
                            candidate.attempt = (candidate.attempt ?? 0) + 1;
                            candidate.attemptId = undefined;
                            candidate.verdict = undefined;
                            candidate.findings = undefined;
                            candidate.acceptanceResults = undefined;
                            candidate.commandsRun = undefined;
                            candidate.reviewedAt = undefined;
                        }
                        if (args.amend.subject !== undefined)
                            task.subject = args.amend.subject;
                        if (args.amend.description !== undefined)
                            task.description = args.amend.description;
                        if (args.amend.dependencies !== undefined)
                            task.dependencies = [...args.amend.dependencies];
                        if (args.amend.acceptance !== undefined)
                            task.acceptance = [...args.amend.acceptance];
                        if (args.amend.verify !== undefined)
                            task.verify = [...args.amend.verify];
                        if (args.amend.inScope !== undefined)
                            task.inScope = [...args.amend.inScope];
                        if (args.amend.outOfScope !== undefined)
                            task.outOfScope = [...args.amend.outOfScope];
                        task.contractVersion = (task.contractVersion ?? 1) + 1;
                        task.contractAmendedAt = Date.now();
                        task.contractAmendedBy = identity.kind === 'captain' ? CAPTAIN_KEY : identity.name;
                        task.updatedAt = Date.now();
                        await writeTeam(stateRoot, fresh);
                        appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/task-amended', {
                            teamId: fresh.id,
                            taskId: task.id,
                            invalidatedNodeIds: invalidatedIds,
                            contractVersion: task.contractVersion,
                            amendedBy: task.contractAmendedBy,
                            inflight,
                        });
                        // Wave-4 DEFECT 1 (measured live: the tool call never returned —
                        // "interrupted after it was recorded, but no result durably
                        // recorded"). `scheduler.kickTeam` -> `kickMember` -> `withTeamLock`
                        // re-acquires THIS team's key, and `withTeamLock` is a plain
                        // non-reentrant promise chain, so kicking from inside the lock
                        // deadlocks the tool forever. The kick belongs OUTSIDE: the call
                        // site below the lock already kicks once for every path through
                        // this tool (amend included), so returning here is enough.
                        return {
                            task_id: task.id,
                            status: task.status,
                            attempt: task.attempt ?? 0,
                        };
                    }
                }
                //#endregion mpd-delta update-task-amend-running
                const gate = evaluateQualityCompletion(task, {
                    status: args.status,
                    output: args.output,
                    verdict: args.verdict,
                    findings,
                    changedPaths: input.changedPaths,
                    acceptanceResults,
                    commandsRun,
                });
                if (!gate.ok)
                    throw new Error(gate.error ?? 'update_task rejected by quality gates');
                if (args.status !== undefined) {
                    const transition = transitionError(task.status, args.status);
                    if (transition !== undefined)
                        throw new Error(transition);
                    task.status = args.status;
                }
                //#region mpd-delta output-append-any-status (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
                // T-46 (wave 1, t19): a LONG deliverable posted in parts was last-write-wins —
                // measured: a four-part freeze collapsed to `[PART 4/4 …]`, ~24 KB lost while every
                // participant believed the parts concatenate. `output_append` now EXTENDS the stored
                // summary on ANY status (the TERMINAL case is handled above and returns), and a
                // REPLACEMENT that would discard a stored summary longer than 240 chars is refused
                // unless the caller explicitly confirms it with replace_output: true. REPLACEMENT-
                // SHAPED: it rewrote the upstream `if (args.output !== undefined) task.output = …`
                // pair, so a re-materialize makes the applier refuse loudly.
                if (args.output !== undefined && args.output_append !== undefined)
                    throw new Error(`task ${task.id}: supply either output (replace) or output_append (extend), not both`);
                if (args.output_append !== undefined) {
                    const appended = args.output_append.trim();
                    if (appended === '')
                        throw new Error('output_append must not be blank; omit it to leave the result unchanged');
                    const base = task.output ?? '';
                    task.output = base === '' ? appended : `${base}\n\n${appended}`;
                }
                if (args.output !== undefined) {
                    const stored = task.output ?? '';
                    if (stored.length > 240 && !args.output.includes(stored) && args.replace_output !== true)
                        throw new Error(`task ${task.id} already holds ${stored.length} chars of output: \`output\` REPLACES it (last-write-wins) and would DISCARD that text — repeat the call with output_append to extend it, or with replace_output: true to confirm a real replacement`);
                    task.output = args.output;
                }
                //#endregion mpd-delta output-append-any-status
                if (args.verdict !== undefined)
                    task.verdict = args.verdict;
                if (findings !== undefined)
                    task.findings = findings;
                if (input.changedPaths !== undefined)
                    task.changedPaths = input.changedPaths;
                if (acceptanceResults !== undefined)
                    task.acceptanceResults = acceptanceResults;
                if (commandsRun !== undefined)
                    task.commandsRun = commandsRun;
                task.updatedAt = Date.now();
                const followUp = (task.status === 'failed' && (task.verdict === 'needs_revision' || task.verdict === 'reject'))
                    ? applyQualityFollowUp(fresh, task)
                    : undefined;
                if (followUp?.escalated === true) {
                    await appendMailbox(stateRoot, fresh.id, CAPTAIN_KEY, createMessage(CAPTAIN_KEY, CAPTAIN_KEY, `Quality-gate loop escalated after ${task.id} (${task.kind ?? 'review'} verdict=${task.verdict}). Automatic repair/review stopped.`));
                }
                if (followUp?.notifyCaptain !== undefined) {
                    await appendMailbox(stateRoot, fresh.id, CAPTAIN_KEY, createMessage(CAPTAIN_KEY, CAPTAIN_KEY, followUp.notifyCaptain));
                }
                if (task.status === 'cancelled') {
                    // Break dependency deadlocks: pending dependents blocked only
                    // by the just-cancelled task are cancelled too (transitively).
                    resolveCancelledDependencyDeadlocks(fresh.tasks, `dependency "${task.id}" was cancelled; task released from the pending pool`);
                }
                await writeTeam(stateRoot, fresh);
                appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/task-updated', {
                    teamId: fresh.id,
                    taskId: task.id,
                    status: task.status,
                    ...task.assignee !== undefined ? { assignee: task.assignee } : {},
                    ...task.output !== undefined ? { output: task.output } : {},
                    ...task.verdict === undefined ? {} : { verdict: task.verdict },
                    ...task.round === undefined ? {} : { round: task.round },
                });
                for (const created of followUp?.created ?? []) {
                    appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/task-created', {
                        teamId: fresh.id,
                        taskId: created.id,
                        subject: created.subject,
                        dependencies: created.dependencies,
                        ...created.assignee === undefined ? {} : { assignee: created.assignee },
                        ...created.kind === undefined ? {} : { kind: created.kind },
                        ...created.round === undefined ? {} : { round: created.round },
                    });
                }
                return {
                    task_id: task.id,
                    status: task.status,
                    attempt: task.attempt ?? 0,
                    ...task.attemptId === undefined ? {} : { attempt_id: task.attemptId },
                    ...task.output !== undefined ? { output: task.output } : {},
                };
            });
            await scheduler.kickTeam(workspace, team.id, team.captainSessionId === caller.id ? caller : undefined);
            return updated;
        },
    }));
    ctx.tools.register(defineTool({
        name: 'agent_teams_send_message',
        description: 'Send a message to the captain or to a teammate. Messages go straight into the recipient\'s mailbox; when the captain agent is online the plugin also schedules live delivery (member recipients get the message as their next turn; a running captain sees it at the nearest model step). No relay is involved: teammates talk to each other directly, exactly like the Claude Code AgentTeams mailbox model.',
        parameters: {
            to: { type: 'string', required: true, description: 'Recipient: "captain" or a member name.' },
            content: { type: 'string', required: true, description: 'The message text.' },
            from: { type: 'string', description: 'Sender (defaults to the caller: the captain, or the calling member).' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    message_id: { type: 'string', required: true },
                    from: { type: 'string', required: true },
                    to: { type: 'string', required: true },
                    delivered: { type: 'string', required: true, description: 'live (accepted by the live captain), wake (member recipient woken), or mailbox (durable inbox only).' },
                },
            },
            render: (args, value) => [{
                    type: 'text',
                    text: `Message ${value.message_id} ${value.from} → ${value.to} delivered via ${value.delivered}.`,
                }],
        },
        async execute(args, exec) {
            const caller = requireCaptain(exec);
            const workspace = workspaceOf(caller);
            const stateRoot = stateRootOf(workspace, config);
            const team = await requireParticipantTeam(workspace, config, caller);
            const to = args.to.trim();
            const prepared = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                const { team: fresh, identity } = await requireFreshParticipant(stateRoot, team.id, caller.id);
                const from = identity.name;
                // `from` may only be the caller's own identity: impersonating another
                // member (or the captain) would poison the mailbox and event records.
                if (args.from !== undefined && args.from !== from) {
                    throw new Error(`agent_teams_send_message: "from" must be your own identity ("${from}"), not "${args.from}"`);
                }
                //#region mpd-delta message-payload-ceiling (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
                // configPlane alignment (upstream team_mode.message_payload_max_bytes):
                // messagePayloadMaxBytes (frozen local default 32768, min 1024) is a REAL
                // ceiling at the send boundary, and `enforcement` mirrors upstream —
                // 'enforce' (default) blocks the over-limit send, 'observe' logs only.
                {
                    const payloadMaxBytes = config.messagePayloadMaxBytes ?? 32768;
                    const bytes = Buffer.byteLength(args.content, 'utf8');
                    if (bytes > payloadMaxBytes) {
                        const overLimit = `agent_teams_send_message: payload is ${bytes} bytes, over messagePayloadMaxBytes=${payloadMaxBytes}`;
                        if ((config.enforcement ?? 'enforce') === 'observe')
                            ctx.logger.warn(overLimit);
                        else
                            throw new Error(`${overLimit}; split the message or raise the config key (set enforcement="observe" to log only)`);
                    }
                }
                //#endregion mpd-delta message-payload-ceiling
                if (to === CAPTAIN_KEY) {
                    //#region mpd-delta send-dedup-wiring (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
                    // R1 wiring: an identical (from,to,content) inside the 60 s window folds
                    // into the surviving record's dupCount instead of appending a second one,
                    // so the recipient can deliver/act at most once. The record is never
                    // physically deleted and the window/priority live in lib/state.ts.
                    const pending = { ...createMessage(from, CAPTAIN_KEY, args.content), deliveryClaimedAt: Date.now() };
                    const { message, folded } = await appendMailboxDeduped(stateRoot, fresh.id, CAPTAIN_KEY, pending);
                    //#endregion mpd-delta send-dedup-wiring
                    appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/message-sent', {
                        teamId: fresh.id,
                        messageId: message.id,
                        from,
                        to: CAPTAIN_KEY,
                        content: args.content,
                        ts: message.ts,
                        ...folded ? { foldedDuplicate: true, dupCount: message.dupCount } : {},
                    });
                    return { kind: 'captain', fresh, identity, message, from };
                }
                if (fresh.halted === true) {
                    throw new Error(`team "${fresh.name}" is halted; call agent_teams_resume before waking a member`);
                }
                const recipient = requireMember(fresh, to);
                // R1 wiring (same rule as the captain path above).
                const pendingMember = { ...createMessage(from, recipient.name, args.content), deliveryClaimedAt: Date.now() };
                const { message, folded } = await appendMailboxDeduped(stateRoot, fresh.id, recipient.name, pendingMember);
                appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/message-sent', {
                    teamId: fresh.id,
                    messageId: message.id,
                    from,
                    to: recipient.name,
                    content: args.content,
                    ts: message.ts,
                });
                return { kind: 'member', fresh, identity, message, from, recipient };
            });
            // Resolve the exact live captain only after releasing the state lock.
            // The plugin mailbox is already durable if live delivery cannot proceed.
            const captain = ctx.agents.get(prepared.fresh.captainSessionId);
            //#region mpd-delta send-dedup-delivery-guard (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
            // R1: when this send FOLDED into an existing record (`_folded`, a transient marker
            // from the state primitive — never persisted), the recipient must NOT be woken a
            // second time: the fold is precisely the "act at most once" guarantee. And such a
            // second delivery would be pure waste anyway — a SUCCESS would only re-acknowledge
            // an already-acknowledged record, while a FAILURE would release the claim and hand
            // the very same record to the scheduler, so the durable record is unchanged either
            // way while the recipient may have acted twice. The scheduler therefore still owns
            // the wake: it delivers the one surviving record exactly once when the live path
            // did not accept it (unread + unclaimed), and delivers nothing once it was acked.
            if (prepared.message._folded === true) {
                return {
                    message_id: prepared.message.id,
                    from: prepared.from,
                    to: prepared.kind === 'captain' ? CAPTAIN_KEY : prepared.recipient.name,
                    delivered: 'duplicate',
                };
            }
            //#endregion mpd-delta send-dedup-delivery-guard
            if (prepared.kind === 'captain') {
                let delivered = 'mailbox';
                if (captain !== undefined && prepared.identity.kind === 'member') {
                    delivered = steerCaptainReport(captain, prepared.from, args.content) ? 'live' : 'mailbox';
                }
                if (delivered === 'live') {
                    await withTeamLock(teamLockKey(stateRoot, prepared.fresh.id), () => (acknowledgeMailbox(stateRoot, prepared.fresh.id, CAPTAIN_KEY, [prepared.message.id])));
                }
                else {
                    await withTeamLock(teamLockKey(stateRoot, prepared.fresh.id), () => (releaseMailboxDelivery(stateRoot, prepared.fresh.id, CAPTAIN_KEY, [prepared.message.id])));
                }
                return { message_id: prepared.message.id, from: prepared.from, to: CAPTAIN_KEY, delivered };
            }
            let delivered = 'mailbox';
            if (captain !== undefined && prepared.recipient.id !== '') {
                const senderText = prepared.from === CAPTAIN_KEY
                    ? args.content
                    : `Message from team member ${prepared.from}:\n\n${args.content}`;
                const text = `AgentTeams state policy: inspect ${config.stateDir}/${prepared.fresh.id}/ read-only; never edit team.json or inbox files directly. Use agent_teams_* tools for team state.\n\n${senderText}`;
                const accepted = await deliverToMember(ctx, captain, prepared.recipient.id, text, exec.signal);
                delivered = accepted ? 'wake' : 'mailbox';
                if (accepted) {
                    await withTeamLock(teamLockKey(stateRoot, prepared.fresh.id), () => (acknowledgeMailbox(stateRoot, prepared.fresh.id, prepared.recipient.name, [prepared.message.id])));
                }
            }
            if (delivered === 'mailbox') {
                await withTeamLock(teamLockKey(stateRoot, prepared.fresh.id), () => (releaseMailboxDelivery(stateRoot, prepared.fresh.id, prepared.recipient.name, [prepared.message.id])));
            }
            return {
                message_id: prepared.message.id,
                from: prepared.from,
                to: prepared.recipient.name,
                delivered,
            };
        },
    }));
    //#region mpd-delta task-contract (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
    ctx.tools.register(defineTool({
        name: 'agent_teams_task_contract',
        description: 'Read ONE task\'s contract exactly as it was declared: kind/round/objective, inScope/outOfScope, acceptance/verify, dependencies, assignee, attempt id, plus the completion payload it will be judged on. Read-only, works for any status including a task that is already running, and available to the captain and to any member of the team. Use it instead of guessing a running task\'s contract from its subject.',
        parameters: {
            task_id: { type: 'string', description: 'Task id from the shared task list, e.g. "t4".' },
        },
        output: {
            schema: { type: 'object', additionalProperties: true, properties: {} },
            render: (_args, value) => [{ type: 'text', text: renderTaskContract(value) }],
        },
        async execute(args, exec) {
            const caller = requireCaptain(exec);
            const workspace = workspaceOf(caller);
            const stateRoot = stateRootOf(workspace, config);
            const located = await requireParticipantTeam(workspace, config, caller);
            const taskId = args.task_id?.trim() ?? '';
            if (taskId === '')
                throw new Error('task_id is required');
            const { team } = await withTeamLock(teamLockKey(stateRoot, located.id), () => requireFreshParticipant(stateRoot, located.id, caller.id));
            const task = team.tasks.find((item) => item.id === taskId);
            if (task === undefined) {
                const known = team.tasks.map((item) => item.id).join(', ');
                throw new Error(`task "${taskId}" does not exist in team "${team.name}" (known tasks: ${known || 'none'})`);
            }
            return taskContractView(task, team.tasks);
        },
    }));
    //#endregion mpd-delta task-contract
    ctx.tools.register(defineTool({
        name: 'agent_teams_status',
        description: 'Team snapshot: members with live activity and tasks with status/assignee/dependencies/output. Captains also see every team mailbox; members see only their own inbox. Use after mailbox progress deliveries or for an explicit status request. After dispatch, end your turn while members work; do not repeatedly poll.',
        parameters: {},
        output: {
            schema: { type: 'object', additionalProperties: true, properties: {} },
            render: (_args, value) => [{ type: 'text', text: renderStatus(value) }],
        },
        async execute(_args, exec) {
            const caller = requireCaptain(exec);
            const workspace = workspaceOf(caller);
            const stateRoot = stateRootOf(workspace, config);
            const located = await requireParticipantTeam(workspace, config, caller);
            if (located.captainSessionId === caller.id) {
                await scheduler.kickTeam(workspace, located.id, caller);
            }
            const { team, identity } = await withTeamLock(teamLockKey(stateRoot, located.id), () => requireFreshParticipant(stateRoot, located.id, caller.id));
            const activity = memberActivity(ctx, team.members.map((member) => member.id));
            const members = team.members
                .filter((member) => member.status !== 'removed')
                .map((member) => ({
                name: member.name,
                role: member.role ?? '',
                provider: member.provider ?? '',
                model: member.model ?? '',
                reasoning_effort: member.reasoningEffort ?? '',
                status: member.status,
                activity: member.id !== '' ? (activity.get(member.id) ?? 'unknown') : 'unspawned',
            }));
            const tasks = team.tasks.map((task) => ({
                id: task.id,
                subject: task.subject,
                status: task.status,
                assignee: task.assignee ?? '',
                dependencies: task.dependencies,
                attempt: task.attempt ?? 0,
                attempt_id: task.attemptId ?? '',
                reassigning: task.reassigning === true,
                kind: taskKindOf(task),
                ...task.round === undefined ? {} : { round: task.round },
                ...task.verdict === undefined ? {} : { verdict: task.verdict },
                findings_open: (task.findings ?? []).filter((finding) => finding.resolved !== true).length,
                ...task.profileSeedId === undefined ? {} : { seed_id: task.profileSeedId },
                ...task.output !== undefined ? { output: task.output } : {},
            }));
            const mailboxWarnings = [];
            let mailboxWarningCount = 0;
            const reportMalformed = (agentKey) => (lineNumber) => {
                mailboxWarningCount += 1;
                if (mailboxWarnings.length < 10) {
                    mailboxWarnings.push(`${agentKey} mailbox line ${lineNumber}`);
                }
            };
            const captainInbox = identity.kind === 'captain'
                ? await readUnreadMailbox(stateRoot, team.id, CAPTAIN_KEY, reportMalformed(CAPTAIN_KEY))
                : [];
            const memberInboxes = {};
            const visibleMembers = identity.kind === 'captain'
                ? members
                : members.filter((member) => member.name === identity.name);
            for (const member of visibleMembers) {
                const messages = await readUnreadMailbox(stateRoot, team.id, member.name, reportMalformed(member.name));
                if (messages.length > 0) {
                    memberInboxes[member.name] = {
                        count: messages.length,
                        latest: messages[messages.length - 1]?.content.slice(0, 200) ?? '',
                    };
                }
            }
            const coverage = buildCoverageMatrix([...new Set(team.tasks.flatMap((item) => item.coverageOf ?? []))], team.tasks).map((row) => ({
                goal_item: row.goal_item,
                task_ids: [...row.task_ids],
                status: row.status,
                ...row.evidence === undefined ? {} : { evidence: row.evidence },
            }));
            const deliveryCheck = canDeclareDelivery(team);
            const delivery = { ok: deliveryCheck.ok, blockers: [...deliveryCheck.blockers] };
            const loop = describeQualityLoop(team);
            const result = {
                team_id: team.id,
                team_name: team.name,
                description: team.description ?? '',
                phase: team.phase ?? 'running',
                //#region mpd-delta wave-status (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
                // T-12 (wave 1, t20): the wave boundary is EXPLICIT state, not captain discipline —
                // the label is on every status render and the closed waves are listed beside it.
                wave: {
                    label: waveOf(team).label,
                    index: waveOf(team).index,
                    opened_at: waveOf(team).openedAt,
                    archived: await listWaveArchives(stateRoot, team.id),
                },
                //#endregion mpd-delta wave-status
                halted: loop.halted,
                escalated: loop.escalated,
                loop_state: loop.state,
                loop_summary: loop.summary,
                deliverable: loop.deliverable,
                coverage,
                delivery,
                ...team.profile === undefined ? {} : {
                    profile: {
                        name: team.profile.name,
                        ...team.profile.protocol === undefined
                            ? {}
                            : { protocol: team.profile.protocol.slice(0, 240) },
                        ...team.profile.taskPlanning === undefined ? {} : { task_planning: team.profile.taskPlanning },
                    },
                },
                viewer: identity.name,
                members,
                tasks,
                captain_inbox: captainInbox.slice(-10).map((message) => ({
                    from: message.from,
                    content: message.content,
                    ts: message.ts,
                })),
                member_inboxes: memberInboxes,
                mailbox_warnings: mailboxWarnings,
                mailbox_warning_count: mailboxWarningCount,
            };
            const acknowledged = identity.kind === 'captain'
                ? captainInbox.map(message => message.id)
                : await readUnreadMailbox(stateRoot, team.id, identity.name).then(messages => messages.map(message => message.id));
            if (acknowledged.length > 0) {
                await withTeamLock(teamLockKey(stateRoot, team.id), () => (acknowledgeMailbox(stateRoot, team.id, identity.kind === 'captain' ? CAPTAIN_KEY : identity.name, acknowledged)));
            }
            return result;
        },
    }));
    ctx.tools.register(defineTool({
        name: 'agent_teams_resume',
        description: 'Explicitly resume a halted team. Requires a non-empty reason. Does not recreate cancelled tasks; only still-pending work is scheduled.',
        parameters: {
            reason: { type: 'string', required: true, description: 'Why the team is being resumed.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    status: { type: 'string', required: true },
                    team_id: { type: 'string', required: true },
                    reason: { type: 'string', required: true },
                },
            },
            render: (_args, value) => [{
                    type: 'text',
                    text: value.status === 'already_running'
                        ? `Team ${value.team_id} is already running.`
                        : `Team ${value.team_id} resumed (${value.reason}).`,
                }],
        },
        async execute(args, exec) {
            const captain = requireCaptain(exec);
            const workspace = workspaceOf(captain);
            const stateRoot = stateRootOf(workspace, config);
            const team = await requireCaptainTeam(workspace, config, captain);
            const result = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id);
                const resumed = resumeTeamState(fresh, args.reason);
                if (resumed.status === 'rejected')
                    throw new Error(resumed.error ?? 'resume rejected');
                if (resumed.status === 'resumed') {
                    fresh.halted = false;
                    fresh.haltedAt = undefined;
                    await writeTeam(stateRoot, fresh);
                    appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/team-resumed', {
                        teamId: fresh.id,
                        reason: args.reason,
                    });
                }
                return {
                    status: resumed.status,
                    team_id: fresh.id,
                    reason: args.reason,
                };
            });
            if (result.status === 'resumed')
                await scheduler.kickTeam(workspace, team.id, captain);
            return result;
        },
    }));
    ctx.tools.register(defineTool({
        name: 'agent_teams_delete',
        description: 'End and archive your team: interrupts members and moves the current tasks and mailboxes out of active state for later inspection. Use when the work is done or explicitly abandoned. A same-name archive replaces its previous generation.',
        parameters: {},
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    deleted: { type: 'boolean', required: true },
                    team_name: { type: 'string', required: true },
                },
            },
            render: (args, value) => [{
                    type: 'text',
                    text: `Team "${value.team_name}" ended and archived.`,
                }],
        },
        async execute(_args, exec) {
            const captain = requireCaptain(exec);
            const workspace = workspaceOf(captain);
            const stateRoot = stateRootOf(workspace, config);
            const team = await requireCaptainTeam(workspace, config, captain);
            const members = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id);
                // Include previously removed members so deleting a pre-fix team also
                // retires durable catalog entries left behind by remove_member.
                const roster = fresh.members.map(member => ({ ...member }));
                for (const member of fresh.members) {
                    if (member.status === 'removed')
                        continue;
                    member.status = 'removed';
                    for (const task of fresh.tasks) {
                        if (task.assignee === member.name && !TERMINAL_TASK_STATUSES.includes(task.status))
                            invalidateTaskAttempt(task);
                    }
                }
                await writeTeam(stateRoot, fresh);
                return roster;
            });
            await recordRetiredMemberIds(stateRoot, members.map(member => member.id));
            for (const member of members) {
                if (member.id === '')
                    continue;
                interruptMember(ctx, captain, member.id);
            }
            const quiescence = await Promise.allSettled(members.map(member => waitForMemberIdle(ctx, member, exec.signal)));
            for (const result of quiescence) {
                if (result.status === 'rejected') {
                    ctx.logger.warn(`agent-teams: member did not quiesce cleanly before team archive: ${String(result.reason)}`);
                }
            }
            await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id);
                appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/team-deleted', {
                    teamId: fresh.id,
                });
                // Archive, not delete: tasks (with their dependency graph) and the
                // mailboxes stay on disk for later review and dependency rebuilds.
                await archiveTeamDir(stateRoot, fresh.id);
            });
            return { deleted: true, team_name: team.name };
        },
    }));
    //#region mpd-delta interjection-tools (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
    // R1's interjection lane was a LIBRARY: enqueueInterjection / decideInterjection /
    // clearMailboxToWatermark had no production caller, so no agent could ask to interject,
    // no captain could decide, and nothing could clear. These three tools are the
    // production entry points. THREE separate tools (not one tool with an `action`) and
    // deliberately NOT folded into agent_teams_send_message: the send path must never
    // carry un-approved content, which is the bypass this wave exists to prevent.
    //
    // AUTHORIZATION IS ENFORCED HERE, at the tool boundary, and it fails LOUDLY with a
    // reason the caller can act on — a description is not a guarantee.
    //   request : any participant, only under its OWN identity
    //   decide  : the captain of THIS team only
    //   clear   : the captain may clear ANY mailbox; a member may clear ONLY its own
    ctx.tools.register(defineTool({
        name: 'agent_teams_interject_request',
        description: 'Ask the captain for permission to interject. The request is queued in a separate lane, carries ONLY a summary + reason + location (never the body it wants to deliver), and is NOT delivered to anyone: a pending request is invisible to the scheduler until the captain approves it with agent_teams_interject_decide. Use this when something must be said out of turn so errors are caught in time.',
        parameters: {
            summary: { type: 'string', required: true, description: 'What you want to say or do, in one line.' },
            reason: { type: 'string', required: true, description: 'Why it cannot wait for your normal turn.' },
            location: { type: 'string', required: true, description: 'Where the problem is (file, symbol, task id).' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    request_id: { type: 'string', required: true },
                    from: { type: 'string', required: true },
                    status: { type: 'string', required: true },
                    expires_at: { type: 'number', required: true },
                    delivered_to_anyone: { type: 'boolean', required: true, description: 'Always false: a pending request is never auto-delivered.' },
                },
            },
            render: (args, value) => [{
                    type: 'text',
                    text: `Interjection request ${value.request_id} from ${value.from} is ${value.status} (expires ${new Date(value.expires_at).toISOString()}). It was delivered to nobody; the captain must approve it.`,
                }],
        },
        async execute(args, exec) {
            const caller = requireCaptain(exec);
            const workspace = workspaceOf(caller);
            const stateRoot = stateRootOf(workspace, config);
            const team = await requireParticipantTeam(workspace, config, caller);
            const request = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                const { team: fresh, identity } = await requireFreshParticipant(stateRoot, team.id, caller.id);
                // The requester is ALWAYS the caller. There is no `from` argument to spoof:
                // a member asking "as" someone else would poison the approval record.
                const record = await enqueueInterjection(stateRoot, fresh.id, {
                    id: randomUUID(),
                    from: identity.name,
                    ts: Date.now(),
                    summary: args.summary,
                    reason: args.reason,
                    location: args.location,
                });
                appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/interjection-requested', {
                    teamId: fresh.id,
                    requestId: record.id,
                    from: identity.name,
                    location: args.location,
                });
                return record;
            });
            return {
                request_id: request.id,
                from: request.from,
                status: request.status,
                expires_at: request.expiresAt,
                delivered_to_anyone: false,
            };
        },
    }));
    ctx.tools.register(defineTool({
        name: 'agent_teams_interject_decide',
        description: 'Captain only: approve or reject a pending interjection request. An approved request is re-posted into the requester\'s own inbox as an ORDINARY message, so the existing member-queue seam delivers it at the next step boundary; a rejected one posts nothing. Silence past the request\'s expiry is a DENY, and the requester is told. Alternatively use action "list" to see what is pending.',
        parameters: {
            request_id: { type: 'string', description: 'The request to decide. Required unless action is "list".' },
            decision: { type: 'string', description: 'Either "approved" or "rejected" (no other value is accepted). Required unless action is "list".' },
            action: { type: 'string', description: 'Omit (or "decide") to record a decision; "list" to only report pending requests.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    action: { type: 'string', required: true },
                    pending: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
                    request_id: { type: 'string' },
                    status: { type: 'string' },
                    requester: { type: 'string' },
                },
            },
            render: (args, value) => {
                const pendingLines = value.pending.length === 0
                    ? ['No pending interjection request.']
                    : value.pending.map((entry) => `  ${entry.id} from ${entry.from} (expires ${new Date(entry.expires_at).toISOString()}): ${entry.summary} — ${entry.reason} @ ${entry.location}`);
                const decidedLine = value.request_id === undefined
                    ? []
                    : [`${value.request_id} is ${value.status}; the requester ${value.requester} was notified through its own inbox.`];
                return [{ type: 'text', text: [...pendingLines, ...decidedLine].join('\n') }];
            },
        },
        async execute(args, exec) {
            const caller = requireCaptain(exec);
            const workspace = workspaceOf(caller);
            const stateRoot = stateRootOf(workspace, config);
            const team = await requireParticipantTeam(workspace, config, caller);
            const action = args.action ?? 'decide';
            return withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                // AUTHZ: the captain of THIS team, re-derived from fresh state. A member
                // passing this tool is refused loudly, and the message says why.
                const fresh = await requireFreshCaptainTeam(stateRoot, team.id, caller.id);
                const pending = (await readPendingInterjections(stateRoot, fresh.id)).map((record) => ({
                    id: record.id,
                    from: record.from,
                    summary: record.summary ?? record.content,
                    reason: record.reason ?? '',
                    location: record.location ?? '',
                    expires_at: typeof record.expiresAt === 'number' ? record.expiresAt : 0,
                }));
                if (action === 'list') {
                    return { action: 'list', pending };
                }
                if (action !== 'decide') {
                    throw new Error(`agent_teams_interject_decide: unknown action "${String(action)}"; the only allowed values are "list" and "decide"`);
                }
                if (typeof args.request_id !== 'string' || args.request_id.trim() === '') {
                    throw new Error('agent_teams_interject_decide requires "request_id" (or action "list" to only report pending requests)');
                }
                if (args.decision !== 'approved' && args.decision !== 'rejected') {
                    throw new Error(`agent_teams_interject_decide: decision must be one of: approved, rejected — received "${String(args.decision)}"`);
                }
                const decided = await decideInterjection(stateRoot, fresh.id, args.request_id.trim(), args.decision);
                appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/interjection-decided', {
                    teamId: fresh.id,
                    requestId: decided.id,
                    requester: decided.from,
                    status: decided.status,
                });
                return { action: 'decide', pending, request_id: decided.id, status: decided.status, requester: decided.from };
            });
        },
    }));
    ctx.tools.register(defineTool({
        name: 'agent_teams_mailbox_clear',
        description: 'Clear a mailbox DOWN TO A WATERMARK. Every record at or before the watermark is replaced by a tombstone whose original bytes are archived first (recoverable sidecar), so nothing is ever hard-deleted and a cleared record can never be delivered again. Authorization: the captain may clear ANY mailbox; a member may clear ONLY its own.',
        parameters: {
            watermark: { type: 'number', required: true, description: 'Clear every record whose ts is <= this value.' },
            agent: { type: 'string', description: 'Which mailbox: "captain" or a member name. Defaults to your own mailbox. A member may only name itself.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    agent: { type: 'string', required: true },
                    cleared: { type: 'array', required: true, items: { type: 'string' } },
                    archived_to: { type: 'string' },
                    unread_after: { type: 'number', required: true },
                },
            },
            render: (args, value) => [{
                    type: 'text',
                    text: `Cleared ${value.cleared.length} record(s) from the "${value.agent}" mailbox${value.archived_to === undefined ? '' : `; original bytes archived at ${value.archived_to}`}. ${value.unread_after} unread record(s) remain.`,
                }],
        },
        async execute(args, exec) {
            const caller = requireCaptain(exec);
            const workspace = workspaceOf(caller);
            const stateRoot = stateRootOf(workspace, config);
            const team = await requireParticipantTeam(workspace, config, caller);
            if (!Number.isFinite(args.watermark)) {
                throw new Error('agent_teams_mailbox_clear requires a numeric "watermark"');
            }
            return withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                const { team: fresh, identity } = await requireFreshParticipant(stateRoot, team.id, caller.id);
                // AUTHZ, enforced here: the captain may clear any mailbox, a member only its
                // own. Defaulting to the caller's own key keeps a member from having to name
                // itself (and from being able to name anyone else).
                const target = args.agent === undefined || args.agent.trim() === '' ? identity.name : args.agent.trim();
                if (identity.kind === 'member' && target !== identity.name) {
                    throw new Error(`only the captain may clear another participant's mailbox: you are "${identity.name}" and asked to clear "${target}"`);
                }
                if (identity.kind === 'member' && target === CAPTAIN_KEY) {
                    throw new Error(`only the captain may clear the captain mailbox; you are "${identity.name}"`);
                }
                if (identity.kind === 'captain' && target !== CAPTAIN_KEY) {
                    // captain clearing a member: the name must exist, so a typo cannot
                    // silently clear nothing.
                    requireMember(fresh, target);
                }
                const manifest = await clearMailboxToWatermark(stateRoot, fresh.id, target, args.watermark);
                appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/mailbox-cleared', {
                    teamId: fresh.id,
                    agentKey: target,
                    watermark: args.watermark,
                    clearedCount: manifest.cleared.length,
                    by: identity.name,
                });
                // The seam that proves the F-3 fix on a REAL path: a cleared record must
                // not be unread afterwards (this is the assertion the round-2 review asked
                // to see executed through the tool surface, not only through the primitive).
                const unreadAfter = await readUnreadMailbox(stateRoot, fresh.id, target);
                return {
                    agent: target,
                    cleared: manifest.cleared.map((record) => record.id),
                    ...manifest.sidecar === undefined ? {} : { archived_to: manifest.sidecar },
                    unread_after: unreadAfter.length,
                };
            });
        },
    }));
    //#endregion mpd-delta interjection-tools
    return runtime;
}
// Shared staged/instant profile-team creation, used by the create tool AND by
// the session-start team policy (lib/session-start.ts) so both paths produce
// byte-identical team state. Exported for that sibling module; not a public API.
export async function initializeProfileTeam(input) {
    const profile = resolveTeamProfile(input.config.profiles, input.profileName, input.config.maxMembers);
    const selections = [];
    for (const template of profile.members) {
        selections.push(await resolveMemberLlmSelection(input.ctx, input.captain, {
            provider: template.provider,
            model: template.model,
            defaultModel: input.config.memberModel,
            reasoningEffort: template.reasoningEffort,
            fallback: template.fallback ?? profile.fallback ?? input.config.fallback,
        }, input.exec.signal));
    }
    await validateMemberLlmSelections(input.ctx, selections, input.exec.signal);
    const now = Date.now();
    const seedToActual = new Map(profile.tasks.map((template, index) => [template.id, `t${index + 1}`]));
    const draft = {
        name: input.teamName,
        id: input.teamId,
        description: input.description,
        profile: {
            name: profile.name,
            ...profile.description === undefined ? {} : { description: profile.description },
            ...profile.protocol === undefined ? {} : { protocol: profile.protocol },
            ...profile.executionPrompt === undefined ? {} : { executionPrompt: profile.executionPrompt },
            ...profile.fallback === undefined ? {} : { fallback: profile.fallback },
            taskPlanning: profile.taskPlanning,
            ...profile.reviewPolicy === undefined ? {} : { reviewPolicy: profile.reviewPolicy },
        },
        ...profile.reviewPolicy === undefined ? {} : { reviewPolicy: profile.reviewPolicy },
        captainSessionId: input.captain.id,
        createdAt: now,
        //#region mpd-delta wave-create (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
        // T-12 (wave 1, t20): a team is BORN with its wave label written down, not inferred later.
        wave: { label: 'w1', index: 1, openedAt: now },
        waveHistory: [],
        //#endregion mpd-delta wave-create
        ...input.staged ? { phase: 'staged', planReviewState: 'awaiting_review' } : {},
        members: profile.members.map((template, index) => {
            const selection = selections[index];
            return {
                id: '',
                name: template.name,
                role: template.role,
                provider: selection.provider,
                model: selection.model,
                reasoningEffort: selection.reasoningEffort,
                executionPrompt: template.executionPrompt ?? profile.executionPrompt ?? input.config.executionPrompt,
                ...selection.fallback === undefined ? {} : { fallback: selection.fallback },
                joinedAt: now,
                status: 'idle',
            };
        }),
        tasks: profile.tasks.map((template, index) => ({
            id: `t${index + 1}`,
            profileSeedId: template.id,
            subject: template.subject,
            description: template.description,
            status: 'pending',
            assignee: template.assignee,
            dependencies: template.dependencies.map((dependency) => seedToActual.get(dependency) ?? dependency),
            attempt: 0,
            createdAt: now,
            updatedAt: now,
        })),
        taskSeq: profile.tasks.length,
    };
    if (input.staged) {
        await createTeamDir(input.stateRoot, draft);
        return { committed: true, state: draft };
    }
    const spawned = [];
    try {
        for (const member of draft.members) {
            const selection = selections[spawned.length];
            await spawnMember(input.ctx, memberRuntime(input.config), input.memberSelections, selection, input.captain, draft, member, input.config.stateDir, input.exec.signal);
            spawned.push(member);
        }
        if (draft.members.some((member) => member.id === '')) {
            throw new Error(`failed to initialize profile "${profile.name}": a spawned member is missing its child id`);
        }
        await createTeamDir(input.stateRoot, draft);
        return { committed: true, state: draft };
    }
    catch (error) {
        const cleanupErrors = [];
        try {
            await removeTeamDir(input.stateRoot, draft.id);
        }
        catch (cleanupError) {
            cleanupErrors.push(cleanupError);
        }
        try {
            await recordRetiredMemberIds(input.stateRoot, spawned.map((member) => member.id));
        }
        catch (cleanupError) {
            cleanupErrors.push(cleanupError);
        }
        for (const member of spawned) {
            try {
                interruptMember(input.ctx, input.captain, member.id);
            }
            catch (cleanupError) {
                cleanupErrors.push(cleanupError);
            }
        }
        if (cleanupErrors.length > 0) {
            throw new AggregateError([error, ...cleanupErrors], `failed to initialize profile "${profile.name}"`);
        }
        throw error;
    }
}
function parseFindings(value) {
    if (value === undefined)
        return undefined;
    if (!Array.isArray(value))
        throw new Error('findings must be an array');
    return value.map((item, index) => {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) {
            throw new Error(`findings[${index}] must be an object`);
        }
        const raw = item;
        if (typeof raw['id'] !== 'string' || raw['id'].trim() === '')
            throw new Error(`findings[${index}].id is required`);
        if (raw['severity'] !== 'low' && raw['severity'] !== 'medium' && raw['severity'] !== 'high' && raw['severity'] !== 'blocker') {
            throw new Error(`findings[${index}].severity is invalid`);
        }
        if (typeof raw['problem'] !== 'string' || raw['problem'].trim() === '')
            throw new Error(`findings[${index}].problem is required`);
        if (typeof raw['requiredFix'] !== 'string' || raw['requiredFix'].trim() === '')
            throw new Error(`findings[${index}].requiredFix is required`);
        return {
            id: raw['id'].trim(),
            severity: raw['severity'],
            problem: raw['problem'],
            requiredFix: raw['requiredFix'],
            // A blank optional file must be omitted, not persisted: durable-state
            // validation requires non-empty optional strings (issue #105 class).
            ...typeof raw['file'] === 'string' && raw['file'].trim() !== '' ? { file: raw['file'] } : {},
            ...typeof raw['line'] === 'number' ? { line: raw['line'] } : {},
            ...typeof raw['resolved'] === 'boolean' ? { resolved: raw['resolved'] } : {},
        };
    });
}
function parseAcceptanceResults(value) {
    if (value === undefined)
        return undefined;
    if (!Array.isArray(value))
        throw new Error('acceptanceResults must be an array');
    return value.map((item, index) => {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) {
            throw new Error(`acceptanceResults[${index}] must be an object`);
        }
        const raw = item;
        if (typeof raw['criterion'] !== 'string' || raw['criterion'].trim() === '') {
            throw new Error(`acceptanceResults[${index}].criterion is required`);
        }
        if (raw['status'] !== 'passed' && raw['status'] !== 'failed') {
            throw new Error(`acceptanceResults[${index}].status must be passed or failed`);
        }
        return {
            criterion: raw['criterion'],
            status: raw['status'],
            ...typeof raw['evidence'] === 'string' ? { evidence: raw['evidence'] } : {},
        };
    });
}
function parseCommandResults(value) {
    if (value === undefined)
        return undefined;
    if (!Array.isArray(value))
        throw new Error('commandsRun must be an array');
    return value.map((item, index) => {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) {
            throw new Error(`commandsRun[${index}] must be an object`);
        }
        const raw = item;
        if (typeof raw['command'] !== 'string' || raw['command'].trim() === '') {
            throw new Error(`commandsRun[${index}].command is required`);
        }
        if (raw['status'] !== 'passed' && raw['status'] !== 'failed') {
            throw new Error(`commandsRun[${index}].status must be passed or failed`);
        }
        return {
            command: raw['command'],
            status: raw['status'],
            ...typeof raw['exitCode'] === 'number' ? { exitCode: raw['exitCode'] } : {},
            ...typeof raw['evidence'] === 'string' ? { evidence: raw['evidence'] } : {},
        };
    });
}
export function applyQualityFollowUp(team, closed) {
    const planned = planQualityFollowUp(team, closed);
    if (planned.escalated === true)
        team.escalated = true;
    const created = [];
    const existing = [...team.tasks];
    const now = Date.now();
    const idBySubject = new Map();
    for (const draft of planned.created) {
        team.taskSeq += 1;
        const id = `t${team.taskSeq}`;
        if (draft.id !== undefined)
            idBySubject.set(draft.id, id);
        if (draft.subject !== undefined)
            idBySubject.set(draft.subject, id);
        const dependencies = (draft.dependencies ?? []).map((dependency) => {
            if (team.tasks.some((item) => item.id === dependency))
                return dependency;
            return idBySubject.get(dependency) ?? dependency;
        });
        const next = {
            id,
            subject: draft.subject ?? `${draft.kind}-round-${draft.round ?? 1}`,
            status: 'pending',
            assignee: draft.assignee,
            dependencies,
            attempt: 0,
            createdAt: now,
            updatedAt: now,
            kind: draft.kind,
            ...draft.round === undefined ? {} : { round: draft.round },
            ...draft.objective === undefined ? {} : { objective: draft.objective },
            ...draft.inScope === undefined ? {} : { inScope: draft.inScope },
            ...draft.outOfScope === undefined ? {} : { outOfScope: draft.outOfScope },
            ...draft.acceptance === undefined ? {} : { acceptance: draft.acceptance },
            ...draft.verify === undefined ? {} : { verify: draft.verify },
            ...draft.sourceTaskId === undefined ? {} : { sourceTaskId: draft.sourceTaskId },
            ...draft.sourceFindingIds === undefined ? {} : { sourceFindingIds: draft.sourceFindingIds },
            ...draft.reviewedTaskId === undefined ? {} : { reviewedTaskId: idBySubject.get(draft.reviewedTaskId) ?? draft.reviewedTaskId },
            ...draft.reasonTaskId === undefined ? {} : { reasonTaskId: idBySubject.get(draft.reasonTaskId) ?? draft.reasonTaskId },
        };
        team.tasks.push(next);
        created.push(next);
    }
    // A staged full delivery plan may already contain downstream integration
    // work that points at the first requirements/review gate. When that gate
    // opens an automatic revision loop, move only still-pending downstream
    // edges to the new terminal gate so the approved plan can continue after
    // the repair instead of waiting forever on an intentionally failed task.
    const replacement = created.at(-1);
    if (replacement !== undefined) {
        for (const task of existing) {
            if (task.status !== 'pending' || !task.dependencies.includes(closed.id))
                continue;
            task.dependencies = task.dependencies.map((dependency) => (dependency === closed.id ? replacement.id : dependency));
            task.updatedAt = now;
        }
    }
    return { created, escalated: planned.escalated === true, ...planned.notifyCaptain === undefined ? {} : { notifyCaptain: planned.notifyCaptain } };
}
/** Build the `memberRuntime` config handed to member helpers. */
function memberRuntime(config) {
    return {
        provider: config.memberProvider,
        maxDepth: config.memberMaxDepth,
        executionPrompt: config.executionPrompt,
        fallback: config.fallback,
    };
}
/** Render the status snapshot as compact text for the model. */
//#region mpd-delta artifact-channel-helper (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
/** The write-capable names a seat can lose: a seat that denies any of them is READ-ONLY here. */
const ARTIFACT_WRITE_NAMES = ['write', 'edit', 'bash'];
/**
 * T-09/T-10 (wave 1, t19): write ONE artifact and return the record stored on the task.
 *
 * Append-or-create on purpose: the channel must never be able to DESTROY a byte, which is
 * what makes it safe to hand to a seat whose `write`/`edit`/`bash` are denied. The guards
 * are mechanical and each one has its own refusal: relative path, no `..` segment, inside
 * the workspace, never inside the team state dir, target absent or a REGULAR file (a
 * directory, symlink or device is refused), and — for a seat whose own `toolDeny` names a
 * write-capable tool — only under `evidence/**`.
 * @param workspace - the calling session's workspace (absolute).
 * @param stateRoot - the configured team state root (absolute).
 * @param team - the fresh team record (the member entry carries `toolDeny`).
 * @param identity - the caller's identity (`captain` or the member name).
 * @param artifact - the raw `{path, text}` argument.
 */
function writeTaskArtifact(workspace, stateRoot, team, identity, artifact) {
    const rawPath = typeof artifact?.path === 'string' ? artifact.path.trim() : '';
    const text = typeof artifact?.text === 'string' ? artifact.text : '';
    if (rawPath === '')
        throw new Error('artifact.path is required');
    if (text === '')
        throw new Error('artifact.text is required (a zero-byte artifact records nothing)');
    if (isAbsolute(rawPath))
        throw new Error(`artifact.path must be workspace-relative; got the absolute path "${rawPath}"`);
    if (rawPath.split(/[\\/]+/).some((segment) => segment === '..'))
        throw new Error(`artifact.path must not traverse upward (".."): "${rawPath}"`);
    const root = resolve(workspace);
    const resolved = resolve(root, rawPath);
    if (resolved !== root && !resolved.startsWith(root + sep))
        throw new Error(`artifact.path must stay inside the workspace (${root}); got "${rawPath}"`);
    const stateAbs = resolve(stateRoot);
    if (resolved === stateAbs || resolved.startsWith(stateAbs + sep))
        throw new Error(`artifact.path must not point inside the team state dir (${stateAbs}); team state is not a deliverable store`);
    const relativePath = relative(root, resolved).split(sep).join('/');
    const memberEntry = team.members.find((candidate) => candidate.name === identity.name);
    const denied = new Set(memberEntry?.toolDeny ?? []);
    const readOnly = identity.kind !== 'captain' && ARTIFACT_WRITE_NAMES.some((name) => denied.has(name));
    if (readOnly && !relativePath.startsWith('evidence/'))
        throw new Error(`a READ-ONLY seat (write/edit/bash denied) may write artifacts only under evidence/** — its sanctioned append-only channel; got "${relativePath}"`);
    let existing = false;
    try {
        const stats = lstatSync(resolved);
        if (!stats.isFile())
            throw new Error(`artifact.path "${relativePath}" already exists and is not a regular file; the artifact channel never touches directories, symlinks or devices`);
        existing = true;
    }
    catch (error) {
        if (error?.code !== 'ENOENT')
            throw error;
    }
    const prior = existing ? readFileSync(resolved, 'utf8') : '';
    mkdirSync(dirname(resolved), { recursive: true });
    // The lexical check above cannot see a SYMLINKED directory: `evidence/link -> /elsewhere`
    // resolves lexically inside the workspace and then writes through the link. Re-check the
    // REAL parent after mkdir, so the containment rule holds for the bytes too.
    const realParent = realpathSync(dirname(resolved));
    if (realParent !== root && !realParent.startsWith(root + sep))
        throw new Error(`artifact.path resolves outside the workspace through a symlinked directory (${realParent}); the artifact channel never writes through a link`);
    writeFileSync(resolved, existing ? `${prior}\n${text}` : text);
    return {
        path: relativePath,
        bytes: text.length,
        total_bytes: prior.length + text.length + (existing ? 1 : 0),
        appended: existing,
        at: Date.now(),
        by: identity.kind === 'captain' ? CAPTAIN_KEY : identity.name,
    };
}
//#endregion mpd-delta artifact-channel-helper
//#region mpd-delta task-contract-render (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
/** A contract list rendered in the SAME spelling the assignment prompt uses. */
function contractList(value) {
    if (!Array.isArray(value) || value.length === 0)
        return [];
    return value.filter((item) => typeof item === 'string' && item.trim() !== '');
}
/**
 * The read-only contract view returned by `agent_teams_task_contract`.
 * Deliberately mirrors the `Contract:` block of the assignment prompt
 * (`scheduler.js` `assignmentPrompt`) so the captain reads exactly what the
 * member received, and includes the completion payload the task will be judged
 * on so the gate can be checked before the member finishes.
 */
function taskContractView(task, allTasks = []) {
    const list = (value) => contractList(value);
    return {
        task_id: task.id,
        subject: task.subject,
        kind: taskKindOf(task),
        ...task.round === undefined ? {} : { round: task.round },
        status: task.status,
        assignee: task.assignee ?? '',
        attempt: task.attempt ?? 0,
        attempt_id: task.attemptId ?? '',
        // T-02 (wave 1, t14): the contract REVISION pair. `contract_version` moves whenever the
        // definition is amended; `attempt_contract_version` is the revision the live attempt was
        // claimed under (stamped in claim_task). A reviewer compares the two: when they differ,
        // this attempt is working a revision the captain has since corrected.
        contract_version: task.contractVersion ?? 1,
        attempt_contract_version: task.attemptContractVersion ?? 1,
        ...task.contractAmendedAt === undefined ? {} : { contract_amended_at: task.contractAmendedAt },
        ...task.contractAmendedBy === undefined ? {} : { contract_amended_by: task.contractAmendedBy },
        dependencies: task.dependencies ?? [],
        // OPT-1: a FAILED dependency does not block the dependent, so the view must
        // carry the failure explicitly or the information would be lost silently.
        failed_dependencies: dependencyStates(allTasks, task.dependencies ?? []).failed,
        objective: task.objective ?? '',
        in_scope: list(task.inScope),
        out_of_scope: list(task.outOfScope),
        acceptance: list(task.acceptance),
        verify: list(task.verify),
        deliverables: list(task.deliverables),
        non_goals: list(task.nonGoals),
        ...task.reviewedTaskId === undefined ? {} : { reviewed_task_id: task.reviewedTaskId },
        ...task.sourceTaskId === undefined ? {} : { source_task_id: task.sourceTaskId },
        ...task.sourceFindingIds === undefined ? {} : { source_finding_ids: task.sourceFindingIds },
        ...task.coverageOf === undefined ? {} : { coverage_of: task.coverageOf },
        ...task.reasonTaskId === undefined ? {} : { reason_task_id: task.reasonTaskId },
        ...task.reassignReason === undefined ? {} : { reassign_reason: task.reassignReason },
        acceptance_results: task.acceptanceResults ?? [],
        commands_run: task.commandsRun ?? [],
        changed_paths: task.changedPaths ?? [],
        ...task.verdict === undefined ? {} : { verdict: task.verdict },
        findings_open: (task.findings ?? []).filter((finding) => finding.resolved !== true).length,
    };
}
/** Render a `taskContractView` for the model: contract first, evidence second. */
function renderTaskContract(value) {
    const contract = value;
    const list = (items) => (Array.isArray(items) && items.length > 0 ? items.join(', ') : '(none)');
    const lines = [
        `Task ${contract.task_id} [${contract.status}] ${contract.kind}${contract.round === undefined ? '' : ` round ${contract.round}`} — ${contract.subject}`,
        `Assignee: ${contract.assignee || 'unassigned'} (attempt ${contract.attempt}${contract.attempt_id === '' ? '' : `, attempt_id ${contract.attempt_id}`})`,
        // T-02 (t14): the revision pair, rendered so a reviewing seat cannot miss a mid-flight
        // contract correction. Same revision = the attempt works what the captain declared.
        `Contract revision: ${contract.contract_version}${contract.attempt_contract_version === contract.contract_version ? '' : ` — AMENDED since this attempt was claimed (claimed under revision ${contract.attempt_contract_version})`}`,
        `Dependencies: ${list(contract.dependencies)}`,
        'Contract:',
        `  Objective: ${contract.objective === '' ? '(none)' : contract.objective}`,
        `  In scope: ${list(contract.in_scope)}`,
        `  Out of scope: ${list(contract.out_of_scope)}`,
        `  Acceptance: ${list(contract.acceptance)}`,
        `  Verify: ${list(contract.verify)}`,
        ...contract.deliverables.length === 0 ? [] : [`  Deliverables: ${list(contract.deliverables)}`],
        ...contract.non_goals.length === 0 ? [] : [`  Non-goals: ${list(contract.non_goals)}`],
        ...contract.reviewed_task_id === undefined ? [] : [`  Reviewed task: ${contract.reviewed_task_id}`],
        ...contract.source_task_id === undefined ? [] : [`  Source task: ${contract.source_task_id}`],
        ...contract.reason_task_id === undefined ? [] : [`  Reason task: ${contract.reason_task_id}`],
        ...contract.coverage_of === undefined ? [] : [`  Coverage of: ${list(contract.coverage_of)}`],
        ...contract.reassign_reason === undefined ? [] : [`  Reassignment reason: ${contract.reassign_reason}`],
        'Completion payload so far:',
        `  acceptanceResults: ${JSON.stringify(contract.acceptance_results)}`,
        `  commandsRun: ${JSON.stringify(contract.commands_run)}`,
        `  changedPaths: ${JSON.stringify(contract.changed_paths)}`,
        ...contract.verdict === undefined ? [] : [`Verdict: ${contract.verdict}`],
        `Open findings: ${contract.findings_open}`,
    ];
    return lines.join('\n');
}
//#endregion mpd-delta task-contract-render
function renderStatus(value) {
    const team = value;
    const flags = [
        team.halted ? 'halted' : undefined,
        team.escalated ? 'escalated' : undefined,
        team.deliverable ? 'deliverable' : undefined,
        team.loop_state && team.loop_state !== 'running' && team.loop_state !== 'halted' && team.loop_state !== 'escalated'
            ? team.loop_state
            : undefined,
    ].filter((item) => item !== undefined);
    const lines = [
        `Team "${team.team_name}"${team.description ? ` — ${team.description}` : ''}${flags.length > 0 ? ` [${flags.join(', ')}]` : ''}`,
        //#region mpd-delta wave-render (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
        // T-12 (wave 1, t20): the wave boundary is visible on EVERY status render, with the
        // closed waves beside it — the captain no longer has to remember which wave it is in.
        ...(team.wave === undefined ? [] : [`Wave: ${team.wave.label} (open since ${new Date(team.wave.opened_at).toISOString()})${(team.wave.archived ?? []).length === 0 ? '' : ` · archived: ${(team.wave.archived ?? []).map((entry) => `${entry.label}→${entry.archived_tasks} task(s) at ${entry.closed_at === null ? '?' : new Date(entry.closed_at).toISOString()}`).join(', ')}`}`]),
        //#endregion mpd-delta wave-render
//#region mpd-delta status-pause-mechanisms (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
        // T-19 (wave 1, adopted side): TWO pause mechanisms can stop this team and only ONE
        // of them is an agent-teams record. `halted` is ours and is rendered above (and in
        // the payload). The team watchdog's PRESERVING hold lives in the watchdog's own
        // store, and this surface no longer reads it: the reader region that used to sit in
        // this file went with the two tool-boundary guards, because a hold must stop NEW
        // DISPATCH only and must never refuse a member's own claim/update/kick. So this line
        // NAMES both mechanisms and DEFERS the hold to its owner instead of guessing at it —
        // and it adds no resume verb: releasing a hold stays the watchdog's own
        // `session-watchdog-resume`, a captain action.
        `Pause: agent-teams halt ${team.halted ? 'ACTIVE' : 'not active'} · team watchdog hold: not read on this surface — run session-watchdog-status (released only by its own session-watchdog-resume)`,
//#endregion mpd-delta status-pause-mechanisms
        ...team.profile === undefined ? [] : [`Profile: ${team.profile.name}${team.profile.task_planning ? ` [${team.profile.task_planning}]` : ''}${team.profile.protocol ? ` — ${team.profile.protocol}` : ''}`],
        ...team.loop_summary ? [`Loop: ${team.loop_state ?? ''} — ${team.loop_summary}`.replace(/^Loop:  — /u, 'Loop: ')] : [],
        `Viewing as: ${team.viewer}`,
        `Members (${team.members.length}):`,
        ...team.members.map((member) => {
            const route = member.provider && member.model ? ` · ${member.provider}/${member.model}` : '';
            const effort = member.reasoning_effort ? ` · reasoning ${member.reasoning_effort}` : '';
            return `  - ${member.name} [${member.role}] ${member.status}/${member.activity}${route}${effort}`;
        }),
        `Tasks (${team.tasks.length}):`,
        ...team.tasks.map((task) => {
            const deps = task.dependencies.length > 0 ? ` (deps: ${task.dependencies.join(',')})` : '';
            const output = task.output !== undefined ? `\n      output: ${task.output.slice(0, 300)}` : '';
            const handoff = task.reassigning ? ' (reassigning)' : '';
            const seed = task.seed_id === undefined || task.seed_id === '' ? '' : ` seed ${task.seed_id}`;
            const kind = task.kind ? ` ${task.kind}` : '';
            const round = task.round === undefined ? '' : ` r${task.round}`;
            const verdict = task.verdict === undefined ? '' : ` verdict ${task.verdict}`;
            return `  - ${task.id} [${task.status}]${kind}${round}${verdict} attempt ${task.attempt}${handoff}${seed} ${task.subject} → ${task.assignee || 'unassigned'}${deps}${output}`;
        }),
        ...team.coverage === undefined || team.coverage.length === 0 ? [] : [
            'Coverage:',
            ...team.coverage.map((row) => `  - ${row.goal_item}: ${row.status} (${row.task_ids.join(',') || 'none'})`),
        ],
        ...team.delivery === undefined ? [] : [
            `Delivery: ${team.delivery.ok ? 'ok' : `blocked (${team.delivery.blockers.join('; ')})`}`,
        ],
        `Captain inbox (${team.captain_inbox.length}):`,
        ...team.captain_inbox.map((message) => `  - [${message.from}] ${message.content.slice(0, 200)}`),
    ];
    for (const [name, inbox] of Object.entries(team.member_inboxes)) {
        lines.push(`Member inbox ${name} (${inbox.count}): latest — ${inbox.latest.slice(0, 120)}`);
    }
    if (team.mailbox_warning_count > 0) {
        lines.push(`Mailbox warnings (${team.mailbox_warning_count}; malformed lines were skipped; showing up to 10):`, ...team.mailbox_warnings.map((warning) => `  - ${warning}`));
    }
    return lines.join('\n');
}
