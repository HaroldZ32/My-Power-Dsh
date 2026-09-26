/**
 * Durable AgentTeams state types.
 *
 * A team is one directory under the state root holding `team.json` plus an
 * `inbox/` of per-agent JSONL mailboxes. Members are continuable subagents
 * whose durable child session ids are recorded in the team file, so a team
 * survives harness restarts.
 * @module dsh-agent-teams/types
 */
//#region mpd-delta deferred-kind (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
/**
 * T-13 (wave 2b, t27): `deferred` is a RECORD kind, never a work kind. A deferred task parks a row
 * the captain deliberately does not dispatch this wave — it keeps its full contract (so a reader
 * still sees what was parked and why) while every dispatch verb, the readiness predicate and the
 * two allowance predicates agree that it is not work. The three consumers that must agree with this
 * enum live in `quality-gates.js` (`isQualityKind` says false), `scheduler.js` (`isTaskReady` says
 * false) and `tools.js` (`claim_task` / `reassign_task` refuse it; `memberOpenTask` /
 * `captainOpenTask` do not count it) — each is asserted by the T-13 arms of
 * `self-fix-tests/wave2b-laneA-product-rows.test.mjs`.
 */
export const NON_DISPATCHABLE_TASK_KINDS = ['deferred'];
/** True for a task whose kind parks it: a record, never work (T-13). */
export function isNonDispatchableKind(task) {
    return NON_DISPATCHABLE_TASK_KINDS.includes(task?.kind ?? 'work');
}
//#endregion mpd-delta deferred-kind
/** Statuses after which a task can no longer be claimed or worked on. */
export const TERMINAL_TASK_STATUSES = ['completed', 'failed', 'cancelled'];
export const TASK_KINDS = [
    'requirements',
    'implementation',
    'verification',
    'review',
    'repair',
    'integration',
    'work',
    // T-13 (t27): the parked kind — accepted by `validateCreateTask`, refused by every dispatch verb.
    'deferred',
];
export const REVIEW_VERDICTS = ['pass', 'needs_revision', 'reject'];
export const FINDING_SEVERITIES = ['low', 'medium', 'high', 'blocker'];
