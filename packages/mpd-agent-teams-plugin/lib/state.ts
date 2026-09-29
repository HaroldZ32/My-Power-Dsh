// @ts-nocheck -- vendored upstream body: renamed to .ts for this repository's source-language rule, never typed here.
/**
 * Team state persistence and pure team-logic rules.
 *
 * State lives on disk under `<workspace>/<stateDir>/<teamId>/`:
 * - `team.json` — the durable {@link TeamState} record
 * - `inbox/<agentKey>.jsonl` — one JSONL mailbox per agent (`captain` or a
 *   member name), mirroring the Claude Code AgentTeams mailbox layout
 *
 * All mutations run through an in-process per-team queue so read-modify-write
 * stays serial; `fs/promises` is used directly because the plugin owns this
 * bookkeeping (host-plane state, like session persistence) and the abstract
 * `fs` service offers no directory deletion.
 * @module dsh-agent-teams/state
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TERMINAL_TASK_STATUSES } from "./types.ts";
import { hasValidQualityTaskFields, isReviewPolicy, normalizeBlankOptionalTaskFields } from "./quality-gates.ts";
export { buildCoverageMatrix, canDeclareDelivery, classifyChangedPath, collectChangedPaths, defaultQualityDeliveryGraph, describeQualityLoop, contractContradiction, describeScopeOwner, evaluateQualityCompletion, hasValidQualityTaskFields, inScopeOverlap, isOpenTaskStatus, isQualityKind, normalizeBlankOptionalTaskFields, pathMatchesScope, planQualityFollowUp, qualityPlanningPrompt, resumeTeamState, sanitizeReviewAcceptance, sanitizeReviewObjective, scopeOwners, taskKindOf, validateCreateTask, } from "./quality-gates.ts";
/** Mailbox key of the captain. */
export const CAPTAIN_KEY = 'captain';
/** A crashed live-delivery attempt becomes retryable after this interval. */
const MAILBOX_DELIVERY_LEASE_MS = 60_000;
/** Durable deny-list for AgentTeams members that must never be resumed. */
const RETIRED_MEMBERS_FILE = 'retired-members.json';
/** In-process per-team mutation queues (promise chains). */
const locks = new Map();
/**
 * Serialize mutations of one team across the whole process.
 * @param key - the team id (or any mutation scope).
 * @param fn - the mutation to run exclusively.
 * @returns the mutation's result.
 */
export async function withTeamLock(key, fn) {
    const previous = locks.get(key) ?? Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const tail = previous.then(() => gate);
    locks.set(key, tail);
    await previous;
    try {
        return await fn();
    }
    finally {
        release();
        // Drop this key's queue entry once we are still its tail, so settled
        // teams do not leave one resolved promise chained forever (the same
        // cleanup discipline as the scheduler's serializeMember). A successor
        // that already appended itself owns the map slot; keep its entry.
        if (locks.get(key) === tail)
            locks.delete(key);
    }
}
/**
 * Keys with an in-process lock queue (held or waiting), snapshot for
 * diagnostics and leak checks. The queue promises themselves stay private.
 */
export function teamLockQueueKeys() {
    return [...locks.keys()];
}
/** Longest key emitted before truncating and appending a digest. */
const MAX_KEY_LENGTH = 48;
/** Short stable digest, used to keep otherwise-colliding keys distinct. */
function keyDigest(name) {
    return createHash('sha256').update(name).digest('hex').slice(0, 8);
}
/**
 * Fold a free-form name into a safe path/key segment.
 *
 * Unicode letters and digits survive, so CJK/Cyrillic/Greek names stay
 * distinct and readable; everything else — spaces, punctuation, path
 * separators, control characters — folds to `-`. An ASCII-only whitelist
 * mapped *every* non-Latin name onto one shared fallback, which silently
 * merged their mailboxes and rejected the second such member as a duplicate.
 *
 * A name with no letters or digits at all (pure emoji or punctuation) cannot
 * yield a readable key, so it gets a digest rather than a shared constant.
 * Over-long names are truncated with a digest appended, so names sharing a
 * long prefix stay distinct and the result stays within filesystem limits
 * (CJK costs 3 bytes per character in UTF-8).
 *
 * @param name - any user-supplied name.
 * @returns a non-empty key safe as a single path segment.
 */
export function sanitizeKey(name) {
    const cleaned = name.normalize('NFC').trim().toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, '');
    if (cleaned === '')
        return `k-${keyDigest(name)}`;
    const points = [...cleaned];
    if (points.length > MAX_KEY_LENGTH) {
        return `${points.slice(0, MAX_KEY_LENGTH).join('')}-${keyDigest(name)}`;
    }
    return cleaned;
}
//#region mpd-delta dependency-failed-unblock (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
/**
 * Whether `dependencies` still BLOCK a dependent task, and which of them failed.
 *
 * Three-state evaluation (user decision OPT-1, 2026-09-13): a dependency is
 * `satisfied` (completed), `failed-dependency` (failed) or unsatisfied
 * (pending/claimed/in_progress/cancelled/unknown). A FAILED dependency no longer
 * pins its dependents forever — the dependent stays `pending` and dispatchable,
 * while `failedDependencyIds` carries the failure so the view can say so. A
 * cancelled dependency was already non-blocking (deadlock rule) and its pending
 * dependents are released by `resolveCancelledDependencyDeadlocks`.
 * @param tasks - the team's tasks.
 * @param dependencies - task ids the candidate depends on.
 * @returns the blocking ids plus the failed ids (never both for one id).
 */
export function dependencyStates(tasks, dependencies) {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const blocking = [];
    const failed = [];
    for (const id of dependencies) {
        const status = byId.get(id)?.status;
        if (status === 'completed' || status === 'cancelled')
            continue;
        if (status === 'failed')
            failed.push(id);
        else
            blocking.push(id);
    }
    return { blocking, failed };
}
/**
 * T-64 (wave 2b, lane A): the dependency ids that name NO task — the UNRESOLVABLE ones.
 *
 * ADDITIVE BY DESIGN: `dependencyStates` keeps its exact two-bucket shape (four pins assert it,
 * and three of them live in `test/**`, outside this lane's write set), so the new bucket is a
 * READER rather than a third key. A phantom id still blocks — nothing satisfied it — and it is now
 * namable in its own right, which is what stops "unresolvable" from reading as an ordinary park.
 */
/**
 * T-29 (review R3, captain's EXTEND ruling): the ids that can NEVER be satisfied — a phantom id (no
 * such task) and the members of a dependency CYCLE (every task in the cycle waits on another member,
 * so no completion can ever satisfy it; before this the 2-cycle read as an ordinary park).
 */
function phantomDependencies(tasks, dependencies) {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    return (dependencies ?? []).filter((id) => byId.get(id) === undefined);
}
/** The first dependency cycle reachable from `dependencies`, as a PATH with its root repeated. */
function dependencyCycle(tasks, dependencies) {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    for (const root of new Set(dependencies ?? [])) {
        if (byId.get(root) === undefined)
            continue;
        const stack = [[root, [root]]];
        const seen = new Set();
        while (stack.length > 0) {
            const [id, path] = stack.pop();
            for (const next of byId.get(id)?.dependencies ?? []) {
                if (next === root)
                    return [...path, root];
                if (seen.has(next) || byId.get(next) === undefined)
                    continue;
                seen.add(next);
                stack.push([next, [...path, next]]);
            }
        }
    }
    return [];
}
export function unresolvedDependencies(tasks, dependencies) {
    return [...phantomDependencies(tasks, dependencies), ...new Set(dependencyCycle(tasks, dependencies))];
}
/**
 * T-64 (wave 2b, lane A): the status note for a task whose dependencies include an unresolvable
 * id. It NAMES the id; absence is printed as absence (an empty string), never as a phrase.
 */
export function unresolvedDependencyNote(task, tasks) {
    const dependencies = task?.dependencies ?? [];
    const parts = [...phantomDependencies(tasks, dependencies)];
    const cycle = dependencyCycle(tasks, dependencies);
    // T-29 (R3): the cycle is reported AS ITSELF — the word and the PATH, not a bare id list.
    // t43 / t30-F1: but ONLY while it still blocks. An OPT-1 FAILED member does not block, so a
    // `failed` cycle leaves `blocking` empty, the task CLAIMABLE — and a note pinned to it would tell a
    // captain that a DISPATCHABLE task has an unresolved dependency. Same for an all-COMPLETED cycle.
    // `renderStatus` appends this line to EVERY task line, so an over-claim is not cosmetic.
    if (cycle.length > 0 && dependencyStates(tasks, dependencies).blocking.length > 0)
        parts.push(`cycle ${cycle.join('\u2192')}`);
    return parts.length === 0 ? '' : ` [unresolved dep: ${parts.join(', ')}]`;
}
/**
 * Whether `dependencies` are all satisfied (every named task exists and is
 * completed) for the given task list. OPT-1: a FAILED dependency does not block.
 * @param tasks - the team's tasks.
 * @param dependencies - task ids the candidate depends on.
 * @returns the ids that still block, empty when claimable.
 */
export function unsatisfiedDependencies(tasks, dependencies) {
    return dependencyStates(tasks, dependencies).blocking;
}
//#endregion mpd-delta dependency-failed-unblock
/**
 * The allowed task status transitions, keyed by current status.
 * Terminal statuses have no outgoing transitions.
 */
export const TASK_TRANSITIONS = {
    pending: ['claimed', 'cancelled'],
    claimed: ['in_progress', 'failed', 'cancelled'],
    in_progress: ['completed', 'failed', 'cancelled'],
    completed: [],
    failed: [],
    cancelled: [],
};
/**
 * Validate one task status transition.
 * @param current - the task's current status.
 * @param next - the requested status.
 * @returns the transition error, or undefined when allowed.
 */
export function transitionError(current, next) {
    if (current === next)
        return undefined;
    if (!TASK_TRANSITIONS[current].includes(next)) {
        return `task status cannot move from "${current}" to "${next}"`;
    }
    return undefined;
}
//#region mpd-delta terminal-task-rearm-refusal (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
// T-79 STATE HALF (wave 2, lane A) — a terminal task must never be RE-ARMED.
//
// MEASURED (wave 1 and again in wave 2, `.mpd/plans/friction-p2-wave-captain-log.md` A-1): the
// scheduler re-dispatched the already-`completed` `t1` carrying the SAME stored attempt id
// (`35503430-…`); the member correctly refused with `task status cannot move from "completed" to
// "claimed"`. The primitive underneath every dispatch is HERE: `activateTaskAttempt` used to set
// `status='claimed'`, mint a FRESH attemptId, drop `handoffId`/`reassigning` and CLEAR `output`
// unconditionally, so a ticket composed over a terminal task rotated the capability, wiped the
// earned summary and left a claim the member could not honour — the terminal record was rewritten
// by the dispatch itself.
//
// The refusal is raised BEFORE the first mutation (in `beginTaskAttempt` before its `attempt`
// increment, and again in `activateTaskAttempt` for direct callers), so a refused rotation leaves
// the record byte-identical. The sanctioned revive path is unaffected: `agent_teams_reassign_task`
// routes a `failed`/`cancelled` task through `invalidateTaskAttempt` (status -> `pending`) BEFORE
// any attempt is minted, so its fresh-attempt semantics still hold; `claim_task` reaches
// `transitionError` first. A `completed` task has no revive path by design (immutable).
export function assertTaskRearmable(task) {
    if (TERMINAL_TASK_STATUSES.includes(task.status)) {
        throw new Error(`task ${task.id} is ${task.status}: the attempt rotation is REFUSED for terminal work — a terminal task is never re-armed (the record was left untouched). Retry failed/cancelled work with agent_teams_reassign_task, which re-opens it with a fresh attempt id.`);
    }
}
//#endregion mpd-delta terminal-task-rearm-refusal
/** Activate the task's current generation for one owner and return its capability id. */
export function activateTaskAttempt(task, assignee) {
    assertTaskRearmable(task);
    //#region mpd-delta composed-ticket-output-preserved (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
    // T-73 (wave 2, t24) — a COMPOSED TICKET must not silently DELETE a stored deliverable.
    //
    // MEASURED (wave 1, `t36`'s author; re-measured by this lane at HEAD `c826f16`,
    // `evidence/agent-teams/composed-ticket-output/20260917T075659Z/driver.ts`): ONE `kickMember`
    // over an `in_progress` task holding a stored deliverable left the record at `output: null`,
    // `status: claimed`, `attempt: 1 -> 2` — DETERMINISTIC, not a race, because the compose rotates
    // the attempt on EVERY dispatched ticket. The dispatch-boundary re-check (`mpd-delta
    // terminal-dispatch-recheck`, `lib/scheduler.ts`) runs AFTER this function, so it can prevent the
    // WAKE and never the WIPE. The phantom-claim family's mechanical cause is therefore a silent
    // DELETE, not a spurious wake.
    //
    // SHAPE (i) of the two the wave-1 record names (`terminal-dispatch/20260917T023700Z/result.json`,
    // `second_data_loss_vector.where_the_fix_belongs`) — chosen because it is the shape this lane can
    // EXERCISE in-process: `output` SURVIVES a rotation that stays inside the SAME generation, i.e. the
    // task is still OPEN (`claimed`/`in_progress`, so nothing invalidated it) and the incoming assignee
    // IS its current owner (the `recoverOwned` re-dispatch of the same seat). Every other rotation keeps
    // clearing `output` exactly as before: a first dispatch of a `pending` task, any generation
    // invalidated by an amend, and a handover — the reassign path clears it EXPLICITLY through
    // `invalidateTaskAttempt` before the new owner is armed. Clearing thus becomes an explicit invalidate
    // action instead of a side effect of every compose.
    //
    // Shape (ii) (snapshot before the compose + restore in the refusal path) is NOT shipped: the wave-1
    // record judges it in-process-untestable on a path no harness can steer, and this lane does not ship
    // a repair it cannot exercise.
    //
    // BOUND (stated, not hidden): a later COMPLETE on the same generation that supplies a DIFFERENT
    // summary longer than 240 chars meets T-46's existing loud replacement guard
    // (`replace_output: true` / `output_append`) instead of silently discarding the preserved bytes —
    // a refusal WITH a remedy, never a loss.
    const sameGenerationRedispatch = (task.status === 'claimed' || task.status === 'in_progress')
        && task.assignee === assignee;
    //#endregion mpd-delta composed-ticket-output-preserved
    const attemptId = randomUUID();
    task.status = 'claimed';
    task.assignee = assignee;
    task.attemptId = attemptId;
    task.handoffId = undefined;
    task.reassigning = false;
    if (!sameGenerationRedispatch)
        task.output = undefined;
    task.updatedAt = Date.now();
    return attemptId;
}
/** Start a fresh task generation for one owner. */
export function beginTaskAttempt(task, assignee) {
    assertTaskRearmable(task);
    task.attempt = (task.attempt ?? 0) + 1;
    return activateTaskAttempt(task, assignee);
}
/**
 * Revoke the current worker immediately. Clearing its capability makes old
 * updates stale; a separate handoff generation serializes async quiescence.
 */
/** Cancel one unfinished task without returning it to the ready pool. */
export function cancelUnfinishedTask(task, output) {
    if (TERMINAL_TASK_STATUSES.includes(task.status))
        return;
    task.status = 'cancelled';
    task.attemptId = undefined;
    task.handoffId = undefined;
    task.reassigning = false;
    if (output !== undefined)
        task.output = output;
    task.updatedAt = Date.now();
}
/**
 * Break cancelled-dependency deadlocks. A pending task whose dependency is
 * cancelled would otherwise never become ready (unsatisfiedDependencies never
 * clears) while still blocking delivery and any downstream chain. Cascade the
 * cancellation to PENDING dependents whose remaining dependencies are all
 * completed/cancelled, transitively (claimed/in_progress work is left to its
 * owner — only never-started dependents are released).
 * @returns the ids cancelled by this pass.
 */
export function cancelCancelledDependents(tasks, cancelledId, reason) {
    const cancelled = new Set([cancelledId]);
    const victims = [];
    let progressed = true;
    while (progressed) {
        progressed = false;
        for (const task of tasks) {
            if (cancelled.has(task.id) || task.status !== 'pending')
                continue;
            if (!task.dependencies.some((id) => cancelled.has(id)))
                continue;
            const outstanding = task.dependencies.some((id) => {
                const dep = tasks.find((item) => item.id === id);
                return dep === undefined || (dep.status !== 'completed' && dep.status !== 'cancelled');
            });
            if (outstanding)
                continue;
            cancelUnfinishedTask(task, reason);
            cancelled.add(task.id);
            victims.push(task.id);
            progressed = true;
        }
    }
    return victims;
}
/**
 * Resolve every pending task blocked only by cancelled dependencies, seeding
 * from all currently-cancelled tasks. Idempotent; safe to run on any dispatch
 * or cancellation path (also covers cold-process recovery, where a cancellation
 * may have happened before the process restarted).
 * @returns the ids cancelled by this pass.
 */
export function resolveCancelledDependencyDeadlocks(tasks, reason = 'dependency was cancelled') {
    const seeds = tasks.filter((task) => task.status === 'cancelled').map((task) => task.id);
    const victims = [];
    for (const seed of seeds)
        victims.push(...cancelCancelledDependents(tasks, seed, reason));
    return [...new Set(victims)];
}
export function invalidateTaskAttempt(task, nextAssignee, reassigning = false) {
    task.attemptId = undefined;
    task.handoffId = randomUUID();
    task.status = 'pending';
    task.assignee = nextAssignee;
    task.reassigning = reassigning;
    task.output = undefined;
    task.updatedAt = Date.now();
}
/**
 * Create the team directory structure and the initial team record.
 * @param stateRoot - resolved absolute state root directory.
 * @param state - the initial team record.
 */
//#region mpd-delta wave-labels (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
/**
 * T-12 (wave 1, t20): the team carries an EXPLICIT WAVE LABEL, and rolling a wave over is an
 * explicit captain action with a durable archive.
 *
 * Measured motivation: one team reached 86 tasks across four waves, and every `agent_teams_status`
 * re-rendered all of them — the boundary existed only as captain discipline, so the context kept
 * inflating. A record written before this delta reads as `w1`, opened at its `createdAt`.
 */
export const TEAM_WAVE_SUBDIR = 'waves';
/** The team's current wave, normalized (legacy records are `w1`). */
export function waveOf(team) {
    const raw = team === undefined || team === null ? undefined : team.wave;
    if (raw !== null && raw !== undefined && typeof raw === 'object' && typeof raw.label === 'string' && raw.label.trim() !== '') {
        return {
            label: raw.label,
            index: typeof raw.index === 'number' && Number.isFinite(raw.index) && raw.index > 0 ? raw.index : 1,
            openedAt: typeof raw.openedAt === 'number' && Number.isFinite(raw.openedAt) ? raw.openedAt : (typeof team.createdAt === 'number' ? team.createdAt : 0),
        };
    }
    return { label: 'w1', index: 1, openedAt: typeof team?.createdAt === 'number' ? team.createdAt : 0 };
}
/** The wave that follows one, opened now. */
export function nextWave(wave, now) {
    const index = (typeof wave?.index === 'number' && Number.isFinite(wave.index) ? wave.index : 1) + 1;
    return { label: `w${index}`, index, openedAt: now };
}
/**
 * Write ONE closed wave's archive record: `<stateRoot>/<teamId>/waves/<label>.json`.
 *
 * The record carries the label (so the archive names the wave it closed), the open/close
 * timestamps, and the CLOSED TASKS THEMSELVES — the live record drops them, and a boundary that
 * silently discards work would be worse than the context it saves. Durable and atomic; the
 * `waves/` directory travels with the team dir into `archive/` on delete.
 */
export async function writeWaveArchive(stateRoot, teamId, archive) {
    const dir = join(stateRoot, teamId, TEAM_WAVE_SUBDIR);
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${sanitizeKey(archive.label)}.json`);
    await atomicWriteText(path, JSON.stringify(archive, null, 2));
    return path;
}
/** Every archived wave of one team, oldest label first (a torn file is skipped, never fatal). */
export async function listWaveArchives(stateRoot, teamId) {
    const dir = join(stateRoot, teamId, TEAM_WAVE_SUBDIR);
    let names;
    try {
        names = await readdir(dir);
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
            return [];
        throw error;
    }
    const archives = [];
    for (const name of names.sort()) {
        if (!name.endsWith('.json'))
            continue;
        try {
            const parsed = JSON.parse(stripLeadingBom(await readFile(join(dir, name), 'utf8')));
            archives.push({
                label: typeof parsed.label === 'string' ? parsed.label : name.slice(0, -'.json'.length),
                opened_at: typeof parsed.openedAt === 'number' ? parsed.openedAt : null,
                closed_at: typeof parsed.closedAt === 'number' ? parsed.closedAt : null,
                archived_tasks: Array.isArray(parsed.tasks) ? parsed.tasks.length : 0,
            });
        }
        catch {
            // a torn archive record is skipped: the rest of the index still answers
        }
    }
    return archives;
}
//#endregion mpd-delta wave-labels
export async function createTeamDir(stateRoot, state) {
    const dir = join(stateRoot, state.id);
    await mkdir(join(dir, 'inbox'), { recursive: true });
    //#region mpd-delta team-revision-open (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
    // T-06 (wave 2b, lane A): the record's OPENING write stamps its first token too. Measured: this
    // function is the only OTHER `team.json` writer in `lib/**` besides `writeTeam`, and all three of
    // its call sites CREATE a fresh team (the `create_team` path and the two profile-seed drafts), so
    // there is no prior counter to preserve — a team whose status read would otherwise print
    // "unrecorded" opens at 1, and every subsequent write is the funnel's.
    bumpTeamRevision(state);
    //#endregion mpd-delta team-revision-open
    await atomicWriteText(join(dir, 'team.json'), JSON.stringify(state, null, 2));
}
/**
 * Read one team record; `undefined` when absent.
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team's sanitized id.
 */
export async function readTeam(stateRoot, teamId) {
    try {
        const raw = await readFile(join(stateRoot, teamId, 'team.json'), 'utf8');
        const value = JSON.parse(stripLeadingBom(raw));
        const team = coerceTeamState(value, teamId);
        if (team === undefined) {
            throw new Error(`invalid AgentTeams state in team "${teamId}"`);
        }
        return team;
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return undefined;
        }
        throw error;
    }
}
/**
 * Synchronously read one team record while a continuable child is being
 * composed. Harness requires child setup contributions to be synchronous;
 * this narrow boundary lets a cold-resumed member restore its durable model
 * selection before its first request can be published.
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team's sanitized id.
 * @returns the team record, or `undefined` when absent.
 */
export function readTeamSync(stateRoot, teamId) {
    try {
        const raw = readFileSync(join(stateRoot, teamId, 'team.json'), 'utf8');
        const value = JSON.parse(stripLeadingBom(raw));
        const team = coerceTeamState(value, teamId);
        if (team === undefined) {
            throw new Error(`invalid AgentTeams state in team "${teamId}"`);
        }
        return team;
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return undefined;
        }
        throw error;
    }
}
/**
 * Persist one team record (inside the caller's lock).
 * @param stateRoot - resolved absolute state root directory.
 * @param state - the record to persist.
 */
//#region mpd-delta team-revision-token (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
// T-06 (wave 2b, lane A): THE monotone revision token. The row's defect is a READ that cannot tell
// which write it observed — "claimed" printed after a terminal transition (and the reverse) — so the
// record carries a counter that moves on EVERY durable write and is printed beside the task states it
// belongs to. A COUNTER, never a clock: two writes inside the same millisecond still differ, and a
// clock that steps backwards cannot make the token regress. A legacy record (no token) reads as 0 and
// is upgraded by its next write; `isTeamState` refuses a malformed one in the same shape chain.
// (The region sits in the JSDoc→signature gap only because the applier's beforeContext must be
// UNIQUE; the JSDoc above documents `writeTeam`, not these two helpers.)
/** The team's monotone revision token; 0 for a record that never carried one. */
export function teamRevisionOf(team) {
    const value = team?.['revision'];
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
/** Advance the token in place and return the new value — the ONE bump site (see `writeTeam`). */
export function bumpTeamRevision(team) {
    const next = teamRevisionOf(team) + 1;
    team['revision'] = next;
    return next;
}
//#endregion mpd-delta team-revision-token
export async function writeTeam(stateRoot, state) {
    //#region mpd-delta team-revision-bump (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
    // T-06 (wave 2b, lane A): the bump lives in the FUNNEL, never at the call sites. Every durable
    // write goes through this function (call sites at the t50 measurement: `members.js` 3,
    // `scheduler.js` 6, `tools.js` 20, `state.js` 1), so a token bumped at a call site would leave
    // the other paths silently stale — and the arm's funnel census reddens on exactly that.
    bumpTeamRevision(state);
    //#endregion mpd-delta team-revision-bump
    await atomicWriteText(join(stateRoot, state.id, 'team.json'), JSON.stringify(state, null, 2));
}
/** Parse the durable retired-member index, rejecting malformed content. */
function parseRetiredMemberIds(raw) {
    const parsed = JSON.parse(stripLeadingBom(raw));
    if (!Array.isArray(parsed) || parsed.some(value => typeof value !== 'string' || value === '')) {
        throw new Error('invalid AgentTeams retired member index');
    }
    return new Set(parsed);
}
/**
 * Synchronous role hydration before the host's first prompt assembly: a
 * cold-resumed member must be known to be a member before it can be denied
 * captain-only tools or shown the member instructions.
 */
export function readRetiredMemberIdsSync(stateRoot) {
    try {
        return parseRetiredMemberIds(readFileSync(join(stateRoot, RETIRED_MEMBERS_FILE), 'utf8'));
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return new Set();
        }
        throw error;
    }
}
/** Read the durable set of member session ids retired by remove/delete. */
export async function readRetiredMemberIds(stateRoot) {
    try {
        return parseRetiredMemberIds(await readFile(join(stateRoot, RETIRED_MEMBERS_FILE), 'utf8'));
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return new Set();
        }
        throw error;
    }
}
/** Atomically add session ids to the durable retired-member deny-list. */
export async function recordRetiredMemberIds(stateRoot, memberIds) {
    const additions = memberIds.filter(id => id !== '');
    if (additions.length === 0)
        return;
    await withTeamLock(`retired-members:${stateRoot}`, async () => {
        const retired = await readRetiredMemberIds(stateRoot);
        for (const id of additions)
            retired.add(id);
        await mkdir(stateRoot, { recursive: true });
        await atomicWriteText(join(stateRoot, RETIRED_MEMBERS_FILE), `${JSON.stringify([...retired].sort(), null, 2)}\n`);
    });
}
/**
 * Find the team owned by one captain session (at most one per captain).
 * @param stateRoot - resolved absolute state root directory.
 * @param captainSessionId - the owning session id.
 * @returns the team record, or undefined when the captain leads no team.
 */
export async function findTeamByCaptain(stateRoot, captainSessionId) {
    let entries;
    try {
        entries = await readdir(stateRoot, { withFileTypes: true });
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return undefined;
        }
        throw error;
    }
    let found;
    for (const entry of entries) {
        if (!entry.isDirectory())
            continue;
        const team = await readTeam(stateRoot, entry.name);
        if (team?.captainSessionId === captainSessionId) {
            if (found !== undefined && found.id !== team.id) {
                throw new Error(`captain session leads multiple active teams ("${found.id}", "${team.id}"); archive one before continuing`);
            }
            found = team;
        }
    }
    return found;
}
/**
 * Find the team in which one session is an active participant.
 * Captains match `captainSessionId`; members match their durable child session
 * id. Removed members no longer have access to team-scoped tools.
 * @param stateRoot - resolved absolute state root directory.
 * @param agentSessionId - calling captain/member session id.
 * @returns the team record, or undefined when the caller belongs to no team.
 */
export async function findTeamByParticipant(stateRoot, agentSessionId) {
    let entries;
    try {
        entries = await readdir(stateRoot, { withFileTypes: true });
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return undefined;
        }
        throw error;
    }
    let found;
    for (const entry of entries) {
        if (!entry.isDirectory())
            continue;
        const team = await readTeam(stateRoot, entry.name);
        const participates = team?.captainSessionId === agentSessionId
            || team?.members.some((member) => member.id === agentSessionId && member.status !== 'removed') === true;
        if (participates && team !== undefined) {
            if (found !== undefined && found.id !== team.id) {
                throw new Error(`agent session belongs to multiple active teams ("${found.id}", "${team.id}"); the target team is ambiguous`);
            }
            found = team;
        }
    }
    return found;
}
/** Build a fresh message record. */
export function createMessage(from, to, content) {
    return { id: randomUUID(), from, to, content, ts: Date.now() };
}
/**
 * Append one message to an agent's mailbox (JSONL).
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team id.
 * @param agentKey - `captain` or a member name.
 * @param message - the message to append.
 */
export async function appendMailbox(stateRoot, teamId, agentKey, message) {
    const file = join(stateRoot, teamId, 'inbox', `${sanitizeKey(agentKey)}.jsonl`);
    await mkdir(join(stateRoot, teamId, 'inbox'), { recursive: true });
    let existing = '';
    try {
        existing = await readFile(file, 'utf8');
    }
    catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
            throw error;
        }
    }
    const separator = existing !== '' && !existing.endsWith('\n') ? '\n' : '';
    await atomicWriteText(file, `${existing}${separator}${JSON.stringify(message)}\n`);
}
//#region mpd-delta message-channel-r1 (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
/**
 * P1e (t47): the duplicate window is a CONFIGURED value with its own default, NOT the delivery lease
 * constant it used to borrow. MEASURED basis: the lease is 60 s, while the exact-repeat groups this
 * mailbox actually produced sit at a median of 43.3 s and a maximum of 1,131.6 s — so the borrowed
 * constant could only see 4 of 7, and across every team and archive 2,084 records carry `dupCount`
 * with EVERY value 1, i.e. no fold has ever happened. 30 min covers all seven; `0` (or any
 * non-positive value) DISABLES the fold — proven by an arm, not by this sentence.
 */
export const MAILBOX_DEDUP_WINDOW_DEFAULT_MS = 30 * 60 * 1000;
/**
 * P1b (t49): the retention window for the AUTOMATIC prune. MEASURED justification for 7 days: the
 * longest exact-repeat gap this mailbox ever produced is 1,131.6 s (19 min) and the dedup window is
 * 30 min, so a week is ~500x beyond any evidence the fold could still need; meanwhile the workspace
 * holds 116 inbox files / 3,302 records (largest 1.0 MB / 410 records) with NO automatic tombstone
 * ever created — so the window is long enough to keep anything reviewable and short enough to
 * actually reclaim. 0 disables the prune (proven by an arm).
 */
export const MAILBOX_RETENTION_DEFAULT_MS = 7 * 24 * 60 * 60 * 1000;
/** How many records one bounded prune may reclaim (the sweep never becomes a scan of the mailbox). */
export const MAILBOX_RETENTION_BATCH = 64;
/** Back-compat alias: the default window, no longer the lease constant. */
export const MAILBOX_DEDUP_WINDOW_MS = MAILBOX_DEDUP_WINDOW_DEFAULT_MS;
/** Interjection requests still unanswered after this are DENIED by default. */
export const INTERJECTION_TTL_MS = 30 * 60 * 1000;
/** Lane that holds interjection REQUESTS awaiting the captain's decision. */
export const INTERJECTION_QUEUE = 'interjections';
/** Message kind marking a first-class interjection request. */
export const INTERJECTION_KIND = 'interjection-request';
/** The R1 delivery-idempotency key: sender + recipient + content. */
export function messageDedupKey(message) {
    return `${message.from}\u0000${message.to}\u0000${message.content}`;
}
/**
 * P1d (t48): every existing record a message would REPEAT — same identity, same recipient, same
 * content — at ANY age. The fold window decides FOLDABILITY, never VISIBILITY: a sender must be able
 * to see a repeat from three days ago, which is the whole point of the pre-send gate. Cleared
 * tombstones are not repeats (their content is empty by construction).
 */
export function mailboxDuplicatesFor(existing, message, windowMs) {
    const key = messageDedupKey(message);
    return (existing ?? [])
        .filter((candidate) => candidate.tombstone !== true && messageDedupKey(candidate) === key)
        .map((candidate) => ({
            id: candidate.id,
            ts: candidate.ts,
            dup_count: candidate.dupCount ?? 1,
            within_fold_window: Number.isFinite(windowMs) && windowMs > 0 && Math.abs(message.ts - candidate.ts) <= windowMs,
        }))
        .sort((left, right) => right.ts - left.ts);
}
/**
 * Fold one message into the mailbox for DELIVERY idempotency: when the same
 * (from,to,content) was appended inside the window, the existing record's
 * `dupCount` is incremented and NO second record is written, so a redelivery can
 * never make the recipient act twice. The window is measured on `ts`, and a record
 * that is already delivered/read is still folded — the point is to stop the ACTION,
 * not to shrink the file; nothing is ever physically deleted.
 * @returns the record that now holds the message (new or folded).
 */
export async function appendMailboxDeduped(stateRoot, teamId, agentKey, message, options = {}) {
    // P1e: `windowMs <= 0` is OFF — a configured 0 must fold NOTHING, not "fold only same-millisecond
    // records", which is what `Math.abs(...) <= 0` would have meant.
    const windowMs = options.windowMs ?? MAILBOX_DEDUP_WINDOW_DEFAULT_MS;
    const foldable = Number.isFinite(windowMs) && windowMs > 0;
    const existing = await readMailbox(stateRoot, teamId, agentKey);
    const key = messageDedupKey(message);
    const hit = foldable
        ? existing.find((candidate) => messageDedupKey(candidate) === key
            && Math.abs(message.ts - candidate.ts) <= windowMs)
        : undefined;
    if (hit !== undefined) {
        // R1: the surviving record keeps its OWN delivery/read markers. Dropping them
        // would clear a live claim (or an acknowledgement) and let a folded duplicate be
        // delivered again — exactly the duplicate ACTION this primitive exists to stop.
        const folded = {
            ...hit,
            dupCount: (hit.dupCount ?? 1) + 1,
            ...hit.deliveryClaimedAt === undefined ? {} : { deliveryClaimedAt: hit.deliveryClaimedAt },
            ...hit.deliveredAt === undefined ? {} : { deliveredAt: hit.deliveredAt },
            ...hit.readAt === undefined ? {} : { readAt: hit.readAt },
        };
        await mutateMailbox(stateRoot, teamId, agentKey, [hit.id], () => folded);
        // `_folded` is a TRANSIENT in-memory marker for the caller (the send boundary must
        // not re-deliver an already-owned payload). It is never persisted: the record kept
        // is `folded` alone, so a later fold cannot see a stale marker from an old crash.
        return { message: { ...folded, _folded: true }, folded: true };
    }
    await appendMailbox(stateRoot, teamId, agentKey, { ...message, dupCount: message.dupCount ?? 1 });
    return { message: { ...message, dupCount: message.dupCount ?? 1 }, folded: false };
}
/**
 * Clear a mailbox DOWN TO A WATERMARK: every record with `ts <= watermark` is
 * replaced in place by a tombstone, its original bytes are written to an archive
 * sidecar (`inbox/archive/<agentKey>.<watermark>.jsonl` — the recoverable copy), and
 * ONE audit event describes the operation. There is deliberately NO hard-delete
 * branch: the tombstone keeps the id/ts/from/to so the record stays reviewable, and
 * the sidecar makes the cleared bytes recoverable byte-for-byte.
 * @returns the manifest: tombstoned ids, the sidecar path, and the audit event.
 */
export async function clearMailboxToWatermark(stateRoot, teamId, agentKey, watermark, options = {}) {
    const messages = await readMailbox(stateRoot, teamId, agentKey);
    const inScope = messages.filter((message) => message.ts <= watermark && message.tombstone !== true);
    // P1c (t43, the user's directive): a WATERMARK alone can silently destroy undelivered work — the
    // measured instance is the captain's own `9999999999999` call, which tombstoned a member's entire
    // delivery view (162 records, 0 live) while the tool reported FAILURE. A record that was never
    // DELIVERED or never READ is therefore PROTECTED unless the caller passes `force: true`, and the
    // split is REPORTED so the caller sees what it was about to lose. The sidecar is what keeps the
    // operation recoverable, and this guard is what keeps it from being unnecessary.
    const protectedRecords = inScope.filter((message) => message.deliveredAt === undefined || message.readAt === undefined);
    const forced = options.force === true;
    const cleared = forced ? inScope : inScope.filter((message) => !protectedRecords.includes(message));
    const skipped = forced ? [] : protectedRecords.map((message) => message.id);
    if (cleared.length === 0) {
        return { cleared: [], skipped_unread: skipped, sidecar: undefined, audit: undefined };
    }
    const clearedIds = new Set(cleared.map((message) => message.id));
    // archive-first: the recoverable copy is written AND flushed before the live
    // file is rewritten, so an interrupted clear always leaves the bytes somewhere.
    const archiveDir = join(stateRoot, teamId, 'inbox', 'archive');
    await mkdir(archiveDir, { recursive: true });
    const sidecar = join(archiveDir, `${sanitizeKey(agentKey)}.${watermark}.jsonl`);
    await atomicWriteText(sidecar, cleared.map((message) => JSON.stringify(message)).join('\n') + '\n');
    await mutateMailbox(stateRoot, teamId, agentKey, [...clearedIds], (message) => ({
        id: message.id,
        from: message.from,
        to: message.to,
        content: '',
        ts: message.ts,
        tombstone: true,
        clearedAt: options.now ?? Date.now(),
        clearedToWatermark: watermark,
        archivedTo: sidecar,
        // R1: PRESERVE the read/delivery markers. Without them a cleared record could
        // re-open as "unread" and be delivered a second time after an acknowledgement.
        ...message.readAt === undefined ? {} : { readAt: message.readAt },
        ...message.deliveredAt === undefined ? {} : { deliveredAt: message.deliveredAt },
        ...message.dupCount === undefined ? {} : { dupCount: message.dupCount },
    }));
    const audit = {
        kind: 'mailbox-cleared',
        agentKey,
        watermark,
        clearedCount: cleared.length,
        skippedUnreadCount: skipped.length,
        clearedIds: [...clearedIds],
        sidecar,
        at: options.now ?? Date.now(),
    };
    return { cleared: [...clearedIds], skipped_unread: skipped, sidecar, audit };
}
/**
 * Read only the records that are NOT tombstones (the live view after a clear).
 *
 * TEST-ONLY BY DESIGN (t52, closing review finding F-6). It has no production caller and
 * should not grow one: the scheduler's delivery path composes
 * `deliverableUnread(readUnreadMailbox(...))`, where the tombstone filter is carried
 * INDEPENDENTLY by both `readUnreadMailbox` and `deliverableUnread`, and the claim/ack
 * markers are handled by `claimMailboxDelivery`/`acknowledgeMailbox`. Routing the
 * scheduler through this function instead would drop the lease semantics.
 *
 * It is kept because it is the clearest single-expression statement of the F-3
 * invariant ("a cleared record is never live again") and the seam tests assert it
 * directly (`test/r1-message-channel.test.mjs`, `test/t49-send-dedup-wiring.test.mjs`).
 * Deleting it would remove a cheap, direct guard on a defect that has already escaped
 * once, so it stays — explicitly labelled rather than left as an accidental orphan.
 */
export async function readLiveMailbox(stateRoot, teamId, agentKey) {
    return (await readMailbox(stateRoot, teamId, agentKey)).filter((message) => message.tombstone !== true);
}
/**
 * Enqueue a first-class interjection REQUEST. It is a normal mailbox record with
 * `kind: 'interjection-request'` and `status: 'pending'`, but it lives in its own
 * QUEUE, never in a member's ordinary inbox: the scheduler packs EVERY unread inbox
 * record verbatim and auto-delivers at the next idle edge (lib/scheduler.ts:223-228,
 * 287-298), so a request in the normal inbox would be delivered and would BYPASS the
 * captain's approval. The payload carries summary + reason + location only; the body
 * follows only after approval.
 *
 * FIELD CONTRACT (repair V1). The mailbox shape REQUIRES a non-empty `content`
 * string, and a record that fails the shape check is invisible to every reader —
 * which used to let a caller create a request that returned `status:'pending'` while
 * nobody could ever see or decide it (a silent failure). `content` is therefore
 * NORMALIZED here rather than left optional: when the caller omits it (or passes an
 * empty string) it is derived, in this fixed priority order, from
 * `summary` -> `reason` -> `location`. `id`, `from` and `ts` are REQUIRED and are
 * rejected loudly when missing, because no fallback can invent an identity or a clock.
 * @param request - the request; `id`/`from`/`ts` required, `content` optional (normalized).
 * @returns the queued request record (always carrying a readable `content`).
 * @throws when a required identity field is missing, naming the field.
 */
export async function enqueueInterjection(stateRoot, teamId, request) {
    for (const field of ['id', 'from', 'ts']) {
        const value = request?.[field];
        if (value === undefined || (typeof value === 'string' && value.trim() === '')) {
            throw new Error(`interjection request is missing required field "${field}"`);
        }
    }
    // Same fixed priority as the doc above; the first non-empty candidate wins.
    const rawContent = typeof request.content === 'string' ? request.content.trim() : '';
    const content = rawContent !== ''
        ? request.content
        : (typeof request.summary === 'string' && request.summary.trim() !== ''
            ? request.summary
            : (typeof request.reason === 'string' && request.reason.trim() !== ''
                ? request.reason
                : (typeof request.location === 'string' ? request.location : '')));
    const record = {
        ...request,
        id: request.id,
        from: request.from,
        content,
        to: INTERJECTION_QUEUE,
        kind: INTERJECTION_KIND,
        status: 'pending',
        ts: request.ts,
        expiresAt: request.ts + INTERJECTION_TTL_MS,
    };
    await appendMailbox(stateRoot, teamId, INTERJECTION_QUEUE, record);
    return record;
}
/**
 * Every line of the interjection queue that parses as JSON, WITHOUT the mailbox shape
 * check. This is how a MALFORMED record (present on disk, unreadable by the normal
 * reader) is told apart from a record that truly does not exist.
 */
async function readRawInterjectionRecords(stateRoot, teamId) {
    const file = join(stateRoot, teamId, 'inbox', `${sanitizeKey(INTERJECTION_QUEUE)}.jsonl`);
    let raw;
    try {
        raw = await readFile(file, 'utf8');
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
            return [];
        throw error;
    }
    const records = [];
    for (const rawLine of raw.split('\n')) {
        const line = stripLeadingBom(rawLine);
        if (line.trim() === '')
            continue;
        try {
            records.push(JSON.parse(line));
        }
        catch {
            // a non-JSON line cannot carry an id; it is reported by the reader's hook
        }
    }
    return records;
}
/** Every interjection request in one state, newest last. */
export async function readInterjections(stateRoot, teamId) {
    return readMailbox(stateRoot, teamId, INTERJECTION_QUEUE);
}
/**
 * Read interjections that are still AWAITING DECISION. This is the function the
 * scheduler must use instead of a blanket unread scan: pending requests are never
 * auto-delivered.
 */
export async function readPendingInterjections(stateRoot, teamId) {
    return (await readInterjections(stateRoot, teamId)).filter((record) => record.status === 'pending');
}
/**
 * Expire every pending interjection whose TTL has passed: captain silence is a
 * DEFAULT DENY, and the requesting member is notified (status `expired`).
 * @returns the expired ids.
 */
export async function expireInterjections(stateRoot, teamId, options = {}) {
    const now = options.now ?? Date.now();
    const pending = await readPendingInterjections(stateRoot, teamId);
    const expired = pending.filter((record) => typeof record.expiresAt === 'number' && record.expiresAt <= now);
    if (expired.length === 0)
        return [];
    await mutateMailbox(stateRoot, teamId, INTERJECTION_QUEUE, expired.map((record) => record.id), (record) => ({ ...record, status: 'expired', decidedAt: now }));
    // R1: silence is a DEFAULT DENY, and the requester must be TOLD. The notice is an
    // ORDINARY message (no interjection kind), so it travels the normal delivery path
    // and cannot be filtered out by the interjection gate.
    for (const record of expired) {
        if (typeof record.from !== 'string' || record.from === '')
            continue;
        await appendMailbox(stateRoot, teamId, record.from, {
            ...createExpiryNotice(record),
            id: `interjection-expired-${record.id}`,
            from: CAPTAIN_KEY,
            to: record.from,
            ts: now,
        });
    }
    return expired.map((record) => record.id);
}
/** The ordinary notice a requester receives when their interjection request expires. */
function createExpiryNotice(record) {
    const receivedAt = typeof record.ts === 'number' ? new Date(record.ts).toISOString() : '(unknown time)';
    return {
        content: `Your interjection request "${String(record.id)}" (sent ${receivedAt}) EXPIRED without a captain decision, so it is denied by default. It was not delivered to anyone.`,
    };
}
/** Record the captain's decision on one interjection request. */
export async function decideInterjection(stateRoot, teamId, interjectionId, decision, options = {}) {
    const now = options.now ?? Date.now();
    const record = (await readInterjections(stateRoot, teamId)).find((candidate) => candidate.id === interjectionId);
    if (record === undefined) {
        // Repair V1: a record that IS on disk but fails the mailbox shape check is
        // MALFORMED, not absent. Reporting it as "does not exist" hid the real cause
        // and sent the caller hunting for a wrong id.
        const present = (await readRawInterjectionRecords(stateRoot, teamId)).some((candidate) => candidate?.id === interjectionId);
        if (present) {
            throw new Error(`interjection "${interjectionId}" exists but is MALFORMED (present in the queue but not readable: the mailbox shape requires a non-empty string content and the identity fields); re-enqueue it with content, or inspect the queue file`);
        }
        throw new Error(`interjection "${interjectionId}" does not exist`);
    }
    if (record.status !== 'pending')
        throw new Error(`interjection "${interjectionId}" is already ${String(record.status)}`);
    // R1: the decision vocabulary is CLOSED. Anything else is a caller bug and must be
    // named loudly instead of being persisted as an unknown status.
    const ALLOWED_INTERJECTION_DECISIONS = ['approved', 'rejected'];
    if (!ALLOWED_INTERJECTION_DECISIONS.includes(decision)) {
        throw new Error(`invalid interjection decision "${String(decision)}"; allowed values are: ${ALLOWED_INTERJECTION_DECISIONS.join(', ')}`);
    }
    const decided = { ...record, status: decision, decidedAt: now };
    await mutateMailbox(stateRoot, teamId, INTERJECTION_QUEUE, [interjectionId], () => decided);
    // R1 "delivery after approval": the APPROVED body is re-posted as an ORDINARY message
    // in the requester's inbox. It therefore rides the existing member-prompt queue seam
    // at the next step boundary like any other mailbox work — the plugin never calls the
    // harness sendMessage/steer path for team work (AGENTS.md §12), and the requester's
    // running attempt is not restarted (frozen S4).
    if (decision === 'approved' && typeof record.from === 'string' && record.from !== '') {
        const body = typeof options.body === 'string' && options.body !== ''
            ? options.body
            : (typeof record.body === 'string' && record.body !== '' ? record.body : record.content);
        await appendMailbox(stateRoot, teamId, record.from, {
            id: `${interjectionId}-delivery`,
            from: options.captainKey ?? CAPTAIN_KEY,
            to: record.from,
            content: `Approved interjection "${interjectionId}": ${body}`,
            ts: now,
        });
    }
    return decided;
}
//#endregion mpd-delta message-channel-r1
//#region mpd-delta interjection-expiry-sweep (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
/**
 * Resolve past-due interjection requests across EVERY team under one state root.
 *
 * Why this exists: `expireInterjections` is driven from the scheduler's IDLE EDGE
 * (a member's `kickMember`), so a team that never kicks again after a request holds
 * that row `pending` past its TTL forever and the requester is never told — silence
 * is supposed to be a DEFAULT DENY, not an unresolved row. The session-start hook
 * calls this sweep once per session, so a DORMANT team still resolves its past-due
 * requests the next time anyone works in the workspace.
 *
 * Boundary (stated, not implied): expiry is still evaluated at EVENTS, never by a
 * timer. The two events are "a member became idle" (scheduler tick) and "a session
 * started in this workspace" (this sweep). A workspace nobody ever opens again
 * resolves nothing — no background clock exists.
 *
 * Best-effort per team: one unreadable team is skipped rather than aborting the
 * sweep, and a team with no pending request is not touched at all.
 * @param stateRoot - resolved absolute state root directory.
 * @param options - `now` for a deterministic measurement; otherwise wall-clock.
 * @returns `{ teamIds, expired }` — only the teams that actually expired something.
 */
export async function expireInterjectionsEverywhere(stateRoot, options = {}) {
    let entries;
    try {
        entries = await readdir(stateRoot, { withFileTypes: true });
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
            return { teamIds: [], expired: [] };
        throw error;
    }
    const teamIds = [];
    const expired = [];
    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === 'archive' || entry.name.startsWith('.'))
            continue;
        try {
            const expiredIds = await expireInterjections(stateRoot, entry.name, options);
            if (expiredIds.length > 0) {
                teamIds.push(entry.name);
                expired.push(...expiredIds);
            }
        }
        catch {
            // A single unreadable team must not abort the session-start sweep; the
            // scheduler tick still covers it once that team is kicked again.
        }
    }
    return { teamIds, expired };
}
//#endregion mpd-delta interjection-expiry-sweep
/** Read one agent's whole mailbox, oldest first./**
 * Read one agent's whole mailbox, oldest first.
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team id.
 * @param agentKey - `captain` or a member name.
 * @param onMalformedLine - optional diagnostic hook; malformed records are
 * skipped so one manually damaged line cannot make the whole team unreadable.
 * @returns the messages, empty when the mailbox does not exist yet.
 */
export async function readMailbox(stateRoot, teamId, agentKey, onMalformedLine) {
    const file = join(stateRoot, teamId, 'inbox', `${sanitizeKey(agentKey)}.jsonl`);
    try {
        const raw = await readFile(file, 'utf8');
        const messages = [];
        for (const [index, rawLine] of raw.split('\n').entries()) {
            const line = stripLeadingBom(rawLine);
            if (line.trim() === '')
                continue;
            let value;
            try {
                value = JSON.parse(line);
            }
            catch {
                onMalformedLine?.(index + 1, new Error('invalid JSON'));
                continue;
            }
            if (!isTeamMessage(value)) {
                onMalformedLine?.(index + 1, new Error('invalid message shape'));
                continue;
            }
            messages.push(value);
        }
        return messages;
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
}
/** Read only messages that have not been acknowledged by their recipient. */
export async function readUnreadMailbox(stateRoot, teamId, agentKey, onMalformedLine) {
    const now = Date.now();
    return (await readMailbox(stateRoot, teamId, agentKey, onMalformedLine))
        // R1: a TOMBSTONE is a cleared record — the payload is gone, so it must never
        // count as unread/deliverable. Kept out of this read rather than deleted, so the
        // row stays reviewable and the archive sidecar stays the recovery path.
        .filter(message => message.tombstone !== true)
        .filter(message => message.readAt === undefined
        && (message.deliveryClaimedAt === undefined
            || now - message.deliveryClaimedAt >= MAILBOX_DELIVERY_LEASE_MS));
}
async function mutateMailbox(stateRoot, teamId, agentKey, messageIds, mutate) {
    if (messageIds.length === 0)
        return;
    const file = join(stateRoot, teamId, 'inbox', `${sanitizeKey(agentKey)}.jsonl`);
    let raw;
    try {
        raw = await readFile(file, 'utf8');
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
            return;
        throw error;
    }
    const selected = new Set(messageIds);
    const lines = raw.split('\n').map((rawLine) => {
        const line = stripLeadingBom(rawLine);
        if (line.trim() === '')
            return rawLine;
        try {
            const value = JSON.parse(line);
            if (!isTeamMessage(value) || !selected.has(value.id))
                return rawLine;
            return JSON.stringify(mutate(value));
        }
        catch {
            return rawLine;
        }
    });
    await atomicWriteText(file, lines.join('\n'));
}
/** Lease selected fallback messages to one delivery path. */
export async function claimMailboxDelivery(stateRoot, teamId, agentKey, messageIds) {
    const now = Date.now();
    await mutateMailbox(stateRoot, teamId, agentKey, messageIds, message => ({
        ...message,
        deliveryClaimedAt: now,
    }));
}
/** Release a failed delivery lease so the scheduler can retry it later. */
export async function releaseMailboxDelivery(stateRoot, teamId, agentKey, messageIds) {
    await mutateMailbox(stateRoot, teamId, agentKey, messageIds, (message) => {
        const { deliveryClaimedAt: _claimed, ...released } = message;
        return released;
    });
}
/**
 * Mark selected durable mailbox records delivered/read while preserving
 * malformed lines for diagnostics. Callers serialize this with the team lock.
 */
export async function acknowledgeMailbox(stateRoot, teamId, agentKey, messageIds, options = {}) {
    const now = Date.now();
    await mutateMailbox(stateRoot, teamId, agentKey, messageIds, (message) => {
        const { deliveryClaimedAt: _claimed, ...rest } = message;
        return {
            ...rest,
            deliveredAt: message.deliveredAt ?? now,
            readAt: message.readAt ?? now,
        };
    });
    // P1b (t49): the DELIVERY path is where the backlog grows, so the retention prune rides it — no
    // timer, deterministic, and bounded per call. `retentionMs` comes from the caller's live config when
    // it has one; otherwise the single-sourced default applies (never cached at apply time).
    await pruneMailboxRetention(stateRoot, teamId, agentKey, {
        retentionMs: options.retentionMs ?? MAILBOX_RETENTION_DEFAULT_MS,
        limit: options.retentionLimit ?? MAILBOX_RETENTION_BATCH,
        now,
    });
}
/**
 * P1b (t49): reclaim DELIVERED AND ACKNOWLEDGED records older than the retention window, archive-first.
 * Eligibility (each armed independently in `self-fix-tests/t49-retention-prune.test.mjs`):
 *   (a) `deliveredAt` AND `readAt` are set — an UNREAD record is never touched;
 *   (b) the record is older than the window;
 *   (c) it is NOT currently leased (`deliveryClaimedAt` cleared or past the lease).
 * The bytes land in the sidecar BEFORE the live file is rewritten, and the tombstone keeps
 * id/ts/from/to plus its read/delivery markers, so it can never re-open as unread or be delivered
 * twice. `retentionMs <= 0` disables the prune entirely.
 */
export async function pruneMailboxRetention(stateRoot, teamId, agentKey, options = {}) {
    const windowMs = options.retentionMs ?? MAILBOX_RETENTION_DEFAULT_MS;
    if (!(Number.isFinite(windowMs) && windowMs > 0))
        return { pruned: [], sidecar: undefined, audit: undefined, disabled: true };
    const limit = Number.isSafeInteger(options.limit) && options.limit > 0 ? options.limit : MAILBOX_RETENTION_BATCH;
    const now = options.now ?? Date.now();
    const messages = await readMailbox(stateRoot, teamId, agentKey);
    const eligible = messages.filter((message) => message.tombstone !== true
        && message.deliveredAt !== undefined
        && message.readAt !== undefined
        && now - message.deliveredAt >= windowMs
        && (message.deliveryClaimedAt === undefined || now - message.deliveryClaimedAt >= MAILBOX_DELIVERY_LEASE_MS));
    if (eligible.length === 0)
        return { pruned: [], sidecar: undefined, audit: undefined, disabled: false };
    const batch = eligible.slice(0, limit);
    const prunedIds = new Set(batch.map((message) => message.id));
    const archiveDir = join(stateRoot, teamId, 'inbox', 'archive');
    await mkdir(archiveDir, { recursive: true });
    const sidecar = join(archiveDir, `${sanitizeKey(agentKey)}.retention.${now}.jsonl`);
    await atomicWriteText(sidecar, batch.map((message) => JSON.stringify(message)).join('\n') + '\n');
    await mutateMailbox(stateRoot, teamId, agentKey, [...prunedIds], (message) => ({
        id: message.id,
        from: message.from,
        to: message.to,
        content: '',
        ts: message.ts,
        tombstone: true,
        prunedAt: now,
        retentionWindowMs: windowMs,
        archivedTo: sidecar,
        ...message.readAt === undefined ? {} : { readAt: message.readAt },
        ...message.deliveredAt === undefined ? {} : { deliveredAt: message.deliveredAt },
        ...message.dupCount === undefined ? {} : { dupCount: message.dupCount },
    }));
    return {
        pruned: [...prunedIds],
        sidecar,
        disabled: false,
        audit: { kind: 'mailbox-retention-pruned', agentKey, windowMs, prunedCount: batch.length, eligibleCount: eligible.length, sidecar },
    };
}
/** Remove the optional UTF-8 BOM some editors prepend to JSON text. */
function stripLeadingBom(value) {
    return value.charCodeAt(0) === 0xFEFF ? value.slice(1) : value;
}
/** Rename attempts before falling back to a direct overwrite. */
const ATOMIC_RENAME_RETRIES = 3;
/** Pause between rename attempts, giving a briefly-locking owner time to finish. */
const ATOMIC_RENAME_RETRY_DELAY_MS = 50;
/**
 * Rename error codes worth retrying before the direct-write fallback. On
 * Windows, replacing an existing file whose target is momentarily held open
 * without FILE_SHARE_DELETE surfaces as EPERM (or EACCES/EBUSY variants);
 * EEXIST/ENOTEMPTY cover other "target busy" edge shapes.
 */
const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY', 'EEXIST', 'ENOTEMPTY']);
function isRetryableRenameError(error) {
    return error instanceof Error
        && 'code' in error
        && RETRYABLE_RENAME_CODES.has(error.code ?? '');
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Replace `file` with `content`, preferring an atomic same-directory rename of
 * an already-written temp file.
 *
 * On Windows, `rename(tmp, file)` over an existing target throws EPERM while
 * any other process keeps the target open without FILE_SHARE_DELETE (editors,
 * indexers, antivirus scans, preview panes). By that point the payload has
 * already been fully written to the temp file, so a direct overwrite of the
 * target is a content-equivalent degraded path: retry the rename a few times
 * (transient locks clear quickly), then write the target in place. Every path
 * removes the temp file; when both the atomic rename and the direct write
 * fail, the combined error surfaces as an {@link AggregateError}.
 *
 * @returns nothing once the file has been replaced by one of the two paths.
 */
export async function replaceFileAtomicOrDirect(temporary, file, content, primitives, options = {}) {
    const retries = options.retries ?? ATOMIC_RENAME_RETRIES;
    const retryDelayMs = options.retryDelayMs ?? ATOMIC_RENAME_RETRY_DELAY_MS;
    for (let attempt = 0;; attempt += 1) {
        try {
            await primitives.rename(temporary, file);
            return;
        }
        catch (error) {
            if (isRetryableRenameError(error) && attempt < retries) {
                await sleep(retryDelayMs);
                continue;
            }
            let fallbackError;
            try {
                await primitives.writeFile(file, content);
            }
            catch (writeError) {
                fallbackError = writeError;
            }
            await primitives.remove(temporary).catch(() => undefined);
            if (fallbackError !== undefined) {
                throw new AggregateError([error, fallbackError], `failed to replace "${file}" atomically (${String(error)}) or by direct write (${String(fallbackError)})`);
            }
            return;
        }
    }
}
/**
 * Atomically replace one UTF-8 state file from a same-directory temp file,
 * degrading to a direct overwrite when the atomic rename cannot proceed
 * (see {@link replaceFileAtomicOrDirect} for the Windows EPERM rationale).
 */
async function atomicWriteText(file, content) {
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
    }
    catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined);
        throw error;
    }
    await replaceFileAtomicOrDirect(temporary, file, content, {
        rename: (from, to) => rename(from, to),
        writeFile: (target, payload) => writeFile(target, payload, 'utf8'),
        remove: (path) => rm(path, { force: true }),
    });
}
/** Whether a parsed JSON value is a plain record. */
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** Whether a value is an optional string. */
function isOptionalString(value) {
    return value === undefined || typeof value === 'string';
}
/** Whether a value is a finite timestamp/counter number. */
function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}
/** Validate one member record at the durable JSON boundary. */
function isTeamMember(value) {
    if (!isRecord(value))
        return false;
    return typeof value['id'] === 'string'
        && typeof value['name'] === 'string'
        && value['name'].trim() !== ''
        && isOptionalString(value['role'])
        && isOptionalString(value['provider'])
        && isOptionalString(value['model'])
        && isOptionalString(value['reasoningEffort'])
        && isOptionalString(value['activeProvider'])
        && isOptionalString(value['activeModel'])
        && (value['executionPrompt'] === undefined || typeof value['executionPrompt'] === 'string')
        && (value['fallback'] === undefined || (isRecord(value['fallback']) && typeof value['fallback']['provider'] === 'string' && typeof value['fallback']['model'] === 'string'))
        && (value['fallbackActive'] === undefined || typeof value['fallbackActive'] === 'boolean')
        && isFiniteNumber(value['joinedAt'])
        && (value['status'] === 'idle' || value['status'] === 'working' || value['status'] === 'removed');
}
/** Validate one task record at the durable JSON boundary. */
function isTeamProfileSnapshot(value) {
    return isRecord(value)
        && typeof value['name'] === 'string'
        && value['name'].trim() !== ''
        && isOptionalString(value['description'])
        && isOptionalString(value['protocol'])
        && (value['executionPrompt'] === undefined || typeof value['executionPrompt'] === 'string')
        && (value['fallback'] === undefined || (isRecord(value['fallback']) && typeof value['fallback']['provider'] === 'string' && typeof value['fallback']['model'] === 'string'))
        && (value['taskPlanning'] === undefined || value['taskPlanning'] === 'captain' || value['taskPlanning'] === 'seed')
        && (value['reviewPolicy'] === undefined || isReviewPolicy(value['reviewPolicy']));
}
function coerceProfileSnapshot(value) {
    if (typeof value === 'string') {
        const name = value.trim();
        return name === '' ? undefined : { name };
    }
    if (!isRecord(value))
        return undefined;
    if (!isTeamProfileSnapshot(value))
        return undefined;
    return {
        name: value.name.trim(),
        ...value.description === undefined ? {} : { description: value.description },
        ...value.protocol === undefined ? {} : { protocol: value.protocol },
        ...value.taskPlanning === undefined ? {} : { taskPlanning: value.taskPlanning },
    };
}
function coerceTeamState(value, expectedId) {
    if (!isRecord(value))
        return undefined;
    if (value['profile'] !== undefined && !isTeamProfileSnapshot(value['profile']) && typeof value['profile'] !== 'string') {
        const next = { ...value };
        delete next['profile'];
        value = next;
    }
    else if (typeof value['profile'] === 'string') {
        const upgraded = coerceProfileSnapshot(value['profile']);
        value = upgraded === undefined
            ? (() => {
                const next = { ...value };
                delete next['profile'];
                return next;
            })()
            : { ...value, profile: upgraded };
    }
    if (!isRecord(value) || !Array.isArray(value['tasks'])) {
        return isTeamState(value, expectedId) ? value : undefined;
    }
    const tasks = value['tasks'].map((task) => {
        if (!isRecord(task))
            return task;
        // Tolerate legacy dirty records instead of bricking the whole team on
        // reload: blank optional fields written by older builds (or by models
        // that materialize optionals as "") are normalized to omitted, matching
        // the tool-input normalization.
        const cleaned = normalizeBlankOptionalTaskFields(task);
        if (cleaned['profileSeedId'] !== undefined && (typeof cleaned['profileSeedId'] !== 'string' || cleaned['profileSeedId'].trim() === '')) {
            const next = { ...cleaned };
            delete next['profileSeedId'];
            return next;
        }
        return cleaned;
    });
    const coerced = { ...value, tasks };
    return isTeamState(coerced, expectedId) ? coerced : undefined;
}
export function isTeamTask(value) {
    if (!isRecord(value))
        return false;
    return typeof value['id'] === 'string'
        && isOptionalString(value['profileSeedId'])
        && (value['profileSeedId'] === undefined || value['profileSeedId'].trim() !== '')
        && typeof value['subject'] === 'string'
        && isOptionalString(value['description'])
        && (value['status'] === 'pending'
            || value['status'] === 'claimed'
            || value['status'] === 'in_progress'
            || value['status'] === 'completed'
            || value['status'] === 'failed'
            || value['status'] === 'cancelled')
        && isOptionalString(value['assignee'])
        && Array.isArray(value['dependencies'])
        && value['dependencies'].every((dependency) => typeof dependency === 'string')
        && isOptionalString(value['output'])
        && (value['attempt'] === undefined
            || (Number.isSafeInteger(value['attempt']) && value['attempt'] >= 0))
        && isOptionalString(value['attemptId'])
        && isOptionalString(value['handoffId'])
        && (value['reassigning'] === undefined || typeof value['reassigning'] === 'boolean')
        && isFiniteNumber(value['createdAt'])
        && isFiniteNumber(value['updatedAt'])
        && hasValidQualityTaskFields(value);
}
/** Validate the full team record before it can participate in authorization. */
function isTeamState(value, expectedId) {
    if (!isRecord(value))
        return false;
    const validShape = value['id'] === expectedId
        && typeof value['name'] === 'string'
        && value['name'].trim() !== ''
        && isOptionalString(value['description'])
        && (value['profile'] === undefined || isTeamProfileSnapshot(value['profile']))
        && typeof value['captainSessionId'] === 'string'
        && value['captainSessionId'] !== ''
        && isFiniteNumber(value['createdAt'])
        && Array.isArray(value['members'])
        && value['members'].every(isTeamMember)
        && Array.isArray(value['tasks'])
        && value['tasks'].every(isTeamTask)
        && Number.isSafeInteger(value['taskSeq'])
        && value['taskSeq'] >= 0
        && (value['phase'] === undefined || value['phase'] === 'staged' || value['phase'] === 'running')
        && (value['planReviewState'] === undefined
            || value['planReviewState'] === 'awaiting_review'
            || value['planReviewState'] === 'awaiting_feedback')
        && (value['approvedAt'] === undefined || isFiniteNumber(value['approvedAt']))
        && (value['halted'] === undefined || typeof value['halted'] === 'boolean')
        && (value['haltedAt'] === undefined || isFiniteNumber(value['haltedAt']))
        && (value['reviewPolicy'] === undefined || isReviewPolicy(value['reviewPolicy']))
        && (value['escalated'] === undefined || typeof value['escalated'] === 'boolean');
    if (!validShape)
        return false;
    //#region mpd-delta team-revision-shape (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
    // T-06 (wave 2b, lane A): the token is validated HERE, in the same shape chain as `taskSeq` — a
    // record whose token is not a non-negative safe integer is refused at the same point a bad
    // `taskSeq` is, so a malformed token can never be read as a valid one and then re-bumped from 0.
    if (value['revision'] !== undefined && !(Number.isSafeInteger(value['revision']) && value['revision'] >= 0))
        return false;
    //#endregion mpd-delta team-revision-shape
    const members = value['members'];
    const tasks = value['tasks'];
    const memberIds = new Set();
    const memberKeys = new Set();
    const staged = value['phase'] === 'staged';
    for (const member of members) {
        const key = sanitizeKey(member.name);
        if ((!staged && member.id === '') || key === CAPTAIN_KEY || memberKeys.has(key))
            return false;
        if (member.id !== '') {
            if (memberIds.has(member.id))
                return false;
            memberIds.add(member.id);
        }
        memberKeys.add(key);
    }
    const taskIds = new Set();
    for (const task of tasks) {
        if (task.id === '' || taskIds.has(task.id))
            return false;
        taskIds.add(task.id);
    }
    return true;
}
/** Validate a mailbox record so later rendering cannot crash on `{}`/`null`. */
function isTeamMessage(value) {
    if (!isRecord(value))
        return false;
    return typeof value['id'] === 'string'
        && typeof value['from'] === 'string'
        && typeof value['to'] === 'string'
        && typeof value['content'] === 'string'
        && isFiniteNumber(value['ts'])
        && (value['deliveryClaimedAt'] === undefined || isFiniteNumber(value['deliveryClaimedAt']))
        && (value['deliveredAt'] === undefined || isFiniteNumber(value['deliveredAt']))
        && (value['readAt'] === undefined || isFiniteNumber(value['readAt']))
        // R1 additive fields; absent on every pre-existing record, so old
        // mailboxes stay readable (the shape check only widens).
        && (value['kind'] === undefined || typeof value['kind'] === 'string')
        && (value['status'] === undefined || typeof value['status'] === 'string')
        && (value['dupCount'] === undefined || (Number.isSafeInteger(value['dupCount']) && value['dupCount'] >= 1))
        && (value['tombstone'] === undefined || value['tombstone'] === true);
}
/**
 * Remove a team's whole directory (members should be interrupted first).
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team id.
 */
export async function removeTeamDir(stateRoot, teamId) {
    await rm(join(stateRoot, teamId), { recursive: true, force: true });
}
/**
 * `rename` with the same transient retry policy as the state-file atomic
 * write, for paths (like archiving a whole team directory) where there is no
 * content-equivalent direct-write degradation on Windows. A short-lived
 * delete-sharing lock on any file below the renamed path is retried a few
 * times before the error propagates.
 * @param from - source path.
 * @param to - destination path.
 */
async function renameWithRetry(from, to) {
    for (let attempt = 0;; attempt += 1) {
        try {
            await rename(from, to);
            return;
        }
        catch (error) {
            if (isRetryableRenameError(error) && attempt < ATOMIC_RENAME_RETRIES) {
                await sleep(ATOMIC_RENAME_RETRY_DELAY_MS);
                continue;
            }
            throw error;
        }
    }
}
/**
 * Archive a team instead of deleting it: the whole directory (team.json with
 * tasks and dependency graph, plus the mailboxes) moves under
 * `<stateRoot>/archive/<teamId>/` so later sessions can review how tasks were
 * planned and rebuild dependency relationships. The archive directory has no
 * team.json of its own, so the live activity scan skips it naturally.
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team id.
 */
export async function archiveTeamDir(stateRoot, teamId) {
    const archiveRoot = join(stateRoot, 'archive');
    await mkdir(archiveRoot, { recursive: true });
    const source = join(stateRoot, teamId);
    const target = join(archiveRoot, teamId);
    const previous = join(archiveRoot, `.${teamId}.previous-${randomUUID()}`);
    let displaced = false;
    try {
        // The same Windows EPERM-on-rename applies at the directory boundary: a
        // delete-sharing violation on any file below `target` blocks the move, so
        // retry the transient-lock case before giving up.
        await renameWithRetry(target, previous);
        displaced = true;
    }
    catch (error) {
        // Only ENOENT means there was nothing to displace; any other failure
        // (including a persistent EPERM lock) surfaces to the caller.
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
            throw error;
        }
    }
    try {
        await renameWithRetry(source, target);
    }
    catch (error) {
        if (displaced) {
            try {
                await renameWithRetry(previous, target);
            }
            catch (restoreError) {
                throw new AggregateError([error, restoreError], `failed to archive team "${teamId}" and restore its previous archive`);
            }
        }
        throw error;
    }
    // The new generation is authoritative. A failed cleanup only leaves a
    // hidden recovery directory, which archive discovery deliberately ignores.
    if (displaced)
        await rm(previous, { recursive: true, force: true }).catch(() => undefined);
}
//#region mpd-delta stale-staged-reclaim (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
/** Default age before an empty staged team counts as residue (1 hour). */
export const DEFAULT_RECLAIM_STALE_AFTER_MS = 3600000;
/**
 * Find the STALE EMPTY STAGED teams under one state root.
 *
 * Residual = `phase === 'staged'` AND never approved AND zero tasks AND older than
 * `staleAfterMs` — the residue the pre-gate auto-provisioning left behind. Live work
 * is never a candidate: an approved or running team, and a staged team that already
 * carries tasks (its plan may still be under review), are excluded by construction.
 * The caller's own team id is excluded separately at reclaim time so a session can
 * never archive itself.
 * @param stateRoot - resolved absolute state root directory.
 * @param options - `staleAfterMs` and the `now` clock (injectable for tests).
 * @returns one entry per candidate, newest first.
 */
export async function findStaleStagedTeams(stateRoot, options = {}) {
    const staleAfterMs = options.staleAfterMs ?? DEFAULT_RECLAIM_STALE_AFTER_MS;
    const now = options.now ?? Date.now();
    if (!Number.isFinite(staleAfterMs) || staleAfterMs < 0)
        return [];
    let entries;
    try {
        entries = await readdir(stateRoot, { withFileTypes: true });
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
            return [];
        throw error;
    }
    const candidates = [];
    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === 'archive' || entry.name.startsWith('.'))
            continue;
        const team = await readTeam(stateRoot, entry.name);
        if (team === undefined || team.phase !== 'staged' || team.approvedAt !== undefined)
            continue;
        if (!Array.isArray(team.tasks) || team.tasks.length > 0)
            continue;
        // staleAfterMs === 0 DISABLES the age gate: the criterion degrades to
        // `staged && !approvedAt && tasks.length === 0` (contract), so a threshold of 0
        // still never touches a team that carries tasks or is approved.
        if (staleAfterMs > 0) {
            if (!Number.isFinite(team.createdAt) || now - team.createdAt <= staleAfterMs)
                continue;
        }
        candidates.push({ teamId: team.id, createdAt: team.createdAt, ageMs: now - team.createdAt });
    }
    candidates.sort((left, right) => right.createdAt - left.createdAt);
    return candidates;
}
/**
 * Archive the stale empty staged teams (ARCHIVE, never a raw delete) and report the
 * manifest. `ownTeamId` is never reclaimed, so a session cannot archive its own team.
 * A per-team failure is recorded and does not abort the remaining reclamations.
 * @param stateRoot - resolved absolute state root directory.
 * @param options - `staleAfterMs`, `now`, `ownTeamId`.
 * @returns the manifest: scanned candidates plus what was archived or skipped.
 */
export async function reclaimStaleStagedTeams(stateRoot, options = {}) {
    const candidates = await findStaleStagedTeams(stateRoot, options);
    const archived = [];
    const skipped = [];
    for (const candidate of candidates) {
        if (options.ownTeamId !== undefined && candidate.teamId === options.ownTeamId) {
            skipped.push({ ...candidate, reason: 'own-session' });
            continue;
        }
        try {
            await archiveTeamDir(stateRoot, candidate.teamId);
            archived.push(candidate);
        }
        catch (error) {
            skipped.push({ ...candidate, reason: `archive-failed: ${String(error)}` });
        }
    }
    return { scanned: candidates.length, archived, skipped };
}
//#endregion mpd-delta stale-staged-reclaim
/**
 * Read one archived team (already moved under `archive/`), or undefined when
 * it was never archived.
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team id.
 */
export async function readArchivedTeam(stateRoot, teamId) {
    return readTeam(join(stateRoot, 'archive'), teamId);
}
/**
 * List every archived team id under the state root.
 * @param stateRoot - resolved absolute state root directory.
 * @returns the archived team ids, empty when the archive does not exist.
 */
export async function listArchivedTeamIds(stateRoot) {
    try {
        const entries = await readdir(join(stateRoot, 'archive'), { withFileTypes: true });
        return entries
            .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
            .map((entry) => entry.name);
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
}
/**
 * The visual state of one task: `running` while in_progress, `completed`
 * when done, `failed`/`cancelled` when terminal without success, `blocked`
 * while any dependency still BLOCKS, else `open`.
 *
 * OPT-1: a FAILED dependency does not block its dependent (the same three-state
 * rule the scheduler, claim and takeover paths use), so the panel must not render
 * such a dependent as `blocked` while the tool surface lets it be claimed. The
 * failure stays visible through `failedDependencyIds` on the snapshot.
 */
export function taskVisualState(status, tasks, dependencies) {
    if (status === 'completed')
        return 'completed';
    if (status === 'failed')
        return 'failed';
    if (status === 'cancelled')
        return 'cancelled';
    if (status === 'in_progress')
        return 'running';
    return dependencyStates(tasks, dependencies).blocking.length > 0 ? 'blocked' : 'open';
}
/** The dependency ids of one task that have FAILED (OPT-1 view parity). */
export function failedDependencyIds(tasks, dependencies) {
    return dependencyStates(tasks, dependencies).failed;
}
/**
 * Longest dependency path depth per task id (each depth = one lane column).
 */
export function taskDepthsById(tasks) {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const depths = new Map();
    const visiting = new Set();
    const depthOf = (taskId) => {
        const cached = depths.get(taskId);
        if (cached !== undefined)
            return cached;
        if (visiting.has(taskId))
            return 0;
        const task = byId.get(taskId);
        if (task === undefined)
            return 0;
        visiting.add(taskId);
        const dependencies = task.dependencies
            .filter((dependencyId) => byId.has(dependencyId))
            .sort();
        const depth = dependencies.length === 0
            ? 0
            : 1 + Math.max(...dependencies.map(depthOf));
        visiting.delete(taskId);
        depths.set(taskId, depth);
        return depth;
    };
    for (const task of tasks)
        depthOf(task.id);
    return depths;
}
