/**
 * Session-start team policy: a session starts with NO team unless a mechanical
 * complexity signal fires.
 *
 * Upstream parity (measured on `/root/dshProj/oh-my-openagent` @ v5.0.0-beta.62,
 * `packages/team-core/src/config.ts:4`): team mode is OFF by default — a team is
 * never a mandatory precondition of a session. This module therefore does NOT
 * demand a team. It hooks the agent loop's `agent/pre-step` waterfall and, on
 * the first step of a qualifying session, evaluates a frozen complexity gate:
 *
 * - `sessionTeamPolicy.mode: 'off'` (DEFAULT) — no auto-provision and no
 *   unconditional notice. The mechanical gate below still runs when
 *   `autoRoute` is enabled.
 * - `sessionTeamPolicy.autoRoute: true` (DEFAULT) — the complexity gate is
 *   mechanically evaluated at the first pre-step. When it fires, the staged
 *   default team is provisioned (the same path `agent_teams_create` uses, so
 *   member routes and team state are byte-identical) and exactly one startup
 *   notice is injected telling the captain the session was routed BY THE GATE.
 * - `sessionTeamPolicy.mode: 'auto'` — legacy opt-in: provision unconditionally
 *   for every qualifying session (kept for explicit opt-in, not the default).
 * - `sessionTeamPolicy.mode: 'instruct'` — legacy opt-in: inject the
 *   instruction notice demanding `agent_teams_create(...)`; nothing is created.
 *
 * The gate lands on the PRE-STEP, before any sizing/scale doctrine can run, so
 * the old ordering defect (the sizing rule appearing only AFTER a team already
 * existed, and therefore never preventing one) cannot recur.
 *
 * The frozen gate (see `evidence/omo-align/requirements/frozen-contract.json`
 * `complexityGate`) is `trigger = (matchedSignals >= 2) OR anyExplicitFlag`:
 * - A (hard) explicit flag: the trimmed user text starts with `team:` or
 *   contains `!team` (case-insensitive). The marker is CONSUMED: it is removed
 *   from the goal text before it reaches the model.
 * - B (soft) deliverable verbs: >= 4 distinct matches of
 *   (align|migrate|refactor|audit|overhaul|port|rewrite|consolidate|对齐|重构|迁移|审计|移植|梳理|全量).
 * - C (soft) enumerated steps: ONE signal that fires only when TWO OR MORE of its
 *   three sub-signals hold — C1 >= 3 numbered/bulleted lines, C2 >= 3 distinct
 *   action verbs (add|build|change|check|implement|verify|设计|实现|验证|改造|补充),
 *   C3 >= 3 action clauses that pair a verb with an object. The sub-signals are
 *   aggregated here and are NEVER counted as separate top-level signals (frozen
 *   contract `complexityGate.signals.C_enumeratedSteps.revisionNote`).
 *   Trigger rule: an explicit flag OR any counted soft signal reaches the gate, so a
 *   C hit (its 2-of-3 majority already established) is sufficient — and a bare
 *   "check X, build Y, verify Z" verb sequence satisfies C1?C2?C3 exactly like the
 *   frozen complex prompt #1 does, which is a documented property of the frozen
 *   prompt set, not an implementation choice.
 * - D (soft) plan artifact: a `.mpd/plans/*.md` file exists for the session
 *   workspace at the first pre-step.
 *
 * Qualification (all must hold):
 * - the session's agent is present in the payload;
 * - the session is NOT a child session (`header.parentSession` absent) —
 *   subagent/member/workflow-worker sessions therefore never auto-provision
 *   their own team next to the captain's team;
 * - the session's agent preset is covered by the configured `presets`
 *   allow-list (empty = every top-level session). Sessions without any preset
 *   at all (the headless direct driver, legacy installs) are covered by
 *   default, because such deployments run the bundle itself.
 *
 * The policy settles once per session: after the first check (team found,
 * team provisioned, or provisioning failed) it never provisions again, so a
 * team the user deletes mid-session is NOT recreated and a new team the
 * captain creates afterwards is never fought over.
 *
 * Failure policy: a provisioning error never breaks the step — the step runs
 * unreduced and the gated notice is injected instead, so the session still gets
 * the mechanically-visible nudge.
 * @module dsh-agent-teams/session-start
 */
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createUserMessage } from '../_deps/dsh-llm/lib/index.js';
import { appendTeamEvent } from "./events.js";
import { DEFAULT_RECLAIM_STALE_AFTER_MS, findTeamByParticipant, readTeam, reclaimStaleStagedTeams, sanitizeKey, withTeamLock } from "./state.js";
import { initializeProfileTeam } from "./tools.js";
/** Default display name for the auto-provisioned default team. */
export const DEFAULT_TEAM_NAME = 'MPD Default';
/** Notice marker the injected startup message starts with. */
export const STARTUP_NOTICE_MARKER = '[AgentTeams] Session-start team rule';
//#region mpd-delta session-start-gate (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
/** Signal B: deliverable verbs (english + CJK), counted by distinct match. */
export const DELIVERABLE_VERB_PATTERN = /(align|migrate|refactor|audit|overhaul|port|rewrite|consolidate|对齐|重构|迁移|审计|移植|梳理|全量)/giu;
/** Signal C: action verbs (english + CJK), counted by distinct match. */
export const ACTION_VERB_PATTERN = /(\badd\b|\balign\b|\bbuild\b|\bchange\b|\bcheck\b|\bconsolidate\b|\bimplement\b|\bmigrate\b|\boverhaul\b|\bport\b|\brefactor\b|\brewrite\b|\bverify\b|设计|实现|验证|改造|补充)/giu;
/** Signal C: numbered / bulleted / table rows that read as enumerated steps. */
export const ENUMERATED_LINE_PATTERN = /^\s*(?:\d+[.)]|[-*|])\s/u;
/**
 * Signal C: clause separators. A single-line plan also enumerates steps through
 * its punctuation ("A: B, then C" / "X. Y"), which is what the frozen
 * `testPrompts.complex` first entry uses, so clause boundaries count as
 * enumerated steps exactly like line breaks do.
 */
export const CLAUSE_SEPARATOR_PATTERN = /[\n\r;:,.]/u;
/** Signal C: a clause that opens (optionally after a conjunction) with an imperative/action verb. */
export const CLAUSE_ACTION_PATTERN = /^\s*(?:(?:and|then|also)\s+)?(?:\b(?:add|align|audit|build|change|check|implement|migrate|refactor|rewrite|verify)\b|设计|实现|验证|改造|补充|对齐|重构|迁移|审计|移植|梳理|全量)/iu;
/** Signal B threshold: distinct deliverable-verb matches. */
export const DELIVERABLE_VERB_MIN = 4;
/** Signal C threshold: enumerated lines. */
export const ENUMERATED_LINE_MIN = 3;
/** Signal C threshold: distinct action verbs. */
export const ACTION_VERB_MIN = 3;
/** Sub-signals of C that must hold for C itself to fire (2-of-3 majority). */
export const C_SUBSIGNAL_MIN = 2;
/** Relative directory (under the session workspace) holding plan artifacts. */
export const PLANS_DIR = join('.mpd', 'plans');
/**
 * Per-agent settlement: after the policy has run for a session it never runs
 * again (see module doc). Keyed by agent id; agents are long-lived per
 * session, so this map stays bounded by live sessions.
 */
const settledFor = new Set();
/** Count distinct regex matches (case-insensitive, deduplicated by lowercased text). */
function distinctMatches(text, pattern) {
    const seen = new Set();
    for (const match of text.matchAll(pattern)) {
        seen.add(match[0].toLowerCase());
    }
    return seen.size;
}
/** Count lines that read as enumerated steps (numbered, bulleted, table rows). */
function enumeratedLineCount(text) {
    let count = 0;
    for (const line of text.split('\n')) {
        if (ENUMERATED_LINE_PATTERN.test(line))
            count += 1;
    }
    return count;
}
/**
 * Count clauses that read as enumerated steps: one clause per newline-free
 * punctuation-separated segment, plus every clause that opens with an
 * imperative/action verb.
 */
function clauseStepCount(text) {
    let count = 0;
    for (const clause of text.split(CLAUSE_SEPARATOR_PATTERN)) {
        if (CLAUSE_ACTION_PATTERN.test(clause))
            count += 1;
    }
    return count;
}
/**
 * Whether the user text carries the hard explicit flag, and the text with the
 * matched marker CONSUMED. `team:` is only an activation prefix when it opens
 * the trimmed text; a bare `!team` anywhere activates.
 * @param text - the raw user text.
 * @returns the flag verdict plus the consumed text.
 */
export function consumeExplicitFlag(text) {
    const trimmed = text.trimStart();
    const prefixMatch = /^team:\s*/iu.exec(trimmed);
    if (prefixMatch !== null) {
        return { flagged: true, text: trimmed.slice(prefixMatch[0].length) };
    }
    if (/!team/iu.test(text)) {
        return { flagged: true, text: text.replace(/!team\s*/giu, '') };
    }
    return { flagged: false, text };
}
/**
 * Evaluate the frozen complexity gate against one user text.
 * @param text - the user text (after any explicit flag was consumed).
 * @param input - the hard-flag verdict and whether a plan artifact exists.
 * @returns the gate verdict with the matched signal ids (sorted).
 */
export function evaluateComplexityGate(text, input = {}) {
    const signals = [];
    if (input.explicitFlag === true)
        signals.push('A');
    if (distinctMatches(text, DELIVERABLE_VERB_PATTERN) >= DELIVERABLE_VERB_MIN)
        signals.push('B');
    // C is ONE signal, exactly as the frozen contract requires: it is pushed only
    // after its own 2-of-3 majority is established, and C1/C2/C3 are never separate
    // top-level signals (review F1).
    const cSubSignals = [
        enumeratedLineCount(text) >= ENUMERATED_LINE_MIN,
        distinctMatches(text, ACTION_VERB_PATTERN) >= ACTION_VERB_MIN,
        clauseStepCount(text) >= ENUMERATED_LINE_MIN,
    ].filter(Boolean).length;
    if (cSubSignals >= C_SUBSIGNAL_MIN)
        signals.push('C');
    if (input.planArtifact === true)
        signals.push('D');
    // Option A (captain adjudication, user decision 2026-09-13) — see the frozen
    // contract's `complexityGate.logicRevisionNote`, which SUPERSEDES the original
    // "trigger = (matchedSignals >= 2) OR anyExplicitFlag". A satisfied C (its own
    // 2-of-3 bar) is by itself SUFFICIENT to trigger. Do NOT restore a `>= 2`
    // counted-signal threshold here: measured, the frozen complex prompts #1 and #3
    // carry no B/D/flag at all, so C is their ONLY signal and a >=2 bar makes the
    // gate unreachable against its own frozen expectation. The accepted, ledgered
    // cost is that a multi-clause request ("Check the test, build the package,
    // verify the output.") satisfies C too and therefore DOES route to a team.
    const trigger = input.explicitFlag === true || signals.length >= 1;
    return { trigger, signals };
}
/** Whether a `.mpd/plans/*.md` plan artifact exists for one workspace. */
export async function hasPlanArtifact(workspace) {
    try {
        const entries = await readdir(join(workspace, PLANS_DIR));
        return entries.some((entry) => entry.endsWith('.md'));
    }
    catch {
        return false;
    }
}
/** The text of one message's text blocks, joined; undefined when it has none. */
function messageText(message) {
    if (!Array.isArray(message?.content))
        return undefined;
    const parts = message.content
        .filter((block) => block?.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text);
    return parts.length === 0 ? undefined : parts.join('\n');
}
/** The last user-role message among the candidates, when it carries text. */
function latestUserMessage(candidates) {
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
        const message = candidates[index];
        if (message?.role !== 'user')
            continue;
        const text = messageText(message);
        if (text !== undefined)
            return { message, text };
    }
    return undefined;
}
/**
 * Consume the explicit `team:` / `!team` marker out of a claimed user message,
 * so the goal text the model receives no longer carries the activation marker.
 * Only text blocks are rewritten; a message without the marker is returned
 * unchanged.
 * @param message - the claimed user message.
 * @param source - the concatenated text the marker was detected in.
 * @returns the possibly rewritten message.
 */
export function consumeFlagFromMessage(message, source) {
    const consumed = consumeExplicitFlag(source);
    if (!consumed.flagged)
        return message;
    let changed = false;
    const content = message.content.map((block) => {
        if (block?.type !== 'text' || typeof block.text !== 'string')
            return block;
        const next = consumeExplicitFlag(block.text);
        if (next.text !== block.text) {
            changed = true;
            return { ...block, text: next.text };
        }
        return block;
    });
    return changed ? { ...message, content } : message;
}
/**
 * Whether the session-start policy is enabled at all.
 * @param policy - the normalized sessionTeamPolicy config.
 * @returns true when the legacy mode is not 'off' OR the mechanical auto-route gate is enabled.
 */
export function policyEnabled(policy) {
    if (policy === undefined)
        return false;
    return policy.autoRoute === true || (policy.mode !== undefined && policy.mode !== 'off');
}
/** Whether the mechanical complexity gate is enabled for this policy. */
export function autoRouteEnabled(policy) {
    return policy?.autoRoute === true;
}
/**
 * Whether one agent's session qualifies for the session-start policy.
 * @param policy - the normalized sessionTeamPolicy config.
 * @param agent - the stepping agent.
 * @returns true when the session should be under the team rule.
 */
export function policyQualifies(policy, agent) {
    const header = agent.session.header;
    // Child sessions (subagents, team members, workflow workers, ralph rounds)
    // already belong to a parent's team or workflow — never their own team.
    if (header.parentSession !== undefined)
        return false;
    const allowed = policy.presets ?? [];
    if (allowed.length === 0)
        return true;
    // A session that names a preset must be on the allow-list; a session
    // without any preset (headless direct driver, legacy installs) deploys the
    // bundle itself and stays covered.
    return header.agentPreset === undefined || allowed.includes(header.agentPreset);
}
/**
 * Pick a team id for the default team: the sanitized base name when free,
 * else a deterministic per-captain suffixed id (`<base>-<digest8>`), so every
 * session gets its own stable default team without colliding with earlier
 * sessions' default teams in the same workspace.
 * @param stateRoot - resolved absolute state root directory.
 * @param baseName - the configured default team display name.
 * @param captainSessionId - the owning session id (digest seed).
 * @returns the team id to use.
 * @throws when the id space is exhausted (practically unreachable).
 */
export async function availableTeamId(stateRoot, baseName, captainSessionId) {
    const base = sanitizeKey(baseName);
    if (base === '') {
        throw new Error('session-start team policy: default team name sanitizes to an empty id');
    }
    if (await readTeam(stateRoot, base) === undefined) {
        return base;
    }
    const digest = createHash('sha256').update(captainSessionId).digest('hex').slice(0, 8);
    const suffixed = `${base}-${digest}`;
    if (await readTeam(stateRoot, suffixed) === undefined) {
        return suffixed;
    }
    throw new Error(`session-start team policy: default team ids "${base}" and "${suffixed}" are both taken`);
}
/**
 * Provision the default team for one captain, using the same staged profile
 * initialization the `agent_teams_create(approval="required", profile=...)`
 * tool performs.
 * @param ctx - the plugin context (LLM service for member route resolution).
 * @param config - the resolved plugin runtime config.
 * @param policy - the normalized sessionTeamPolicy config.
 * @param agent - the captain agent.
 * @param signal - the step's abort signal.
 * @returns the created team state.
 * @throws on any provisioning failure (caller degrades to an instruction notice).
 */
export async function provisionSessionTeam(ctx, config, policy, agent, signal) {
    const workspace = agent.session.header.cwd ?? process.cwd();
    const stateRoot = join(workspace, config.stateDir);
    // One active team per captain cannot be raced: the captain lock serializes
    // this with the create tool and approve flows.
    return withTeamLock(`captain:${stateRoot}:${agent.id}`, async () => {
        const existing = await findTeamByParticipant(stateRoot, agent.id);
        if (existing !== undefined) {
            return undefined;
        }
        const teamId = await availableTeamId(stateRoot, policy.name || DEFAULT_TEAM_NAME, agent.id);
        const description = policy.description ?? `Auto-routed by the complexity gate (sessionTeamPolicy.autoRoute; staged — the captain designs the roster/DAG, then the user reviews and approves the plan in the Web panel).`;
        const created = await initializeProfileTeam({
            ctx,
            config,
            memberSelections: undefined,
            captain: agent,
            exec: { signal },
            stateRoot,
            teamName: policy.name || DEFAULT_TEAM_NAME,
            teamId,
            profileName: policy.profile,
            description,
            staged: true,
        });
        if (!created.committed) {
            throw new Error('session-start team policy: profile initialization did not commit');
        }
        appendTeamEvent(ctx, agent.session, 'agent-teams/team-created', {
            teamId: created.state.id,
            captainSessionId: agent.id,
            name: created.state.name,
            ...created.state.description === undefined ? {} : { description: created.state.description },
            ...created.state.profile?.name === undefined ? {} : { profile: created.state.profile.name },
        });
        for (const member of created.state.members) {
            appendTeamEvent(ctx, agent.session, 'agent-teams/member-added', {
                teamId: created.state.id,
                memberId: member.id,
                name: member.name,
                ...member.role === undefined ? {} : { role: member.role },
            });
        }
        return created.state;
    });
}
/**
 * The notice shown when the complexity gate provisioned a team. It states that
 * the session was ROUTED BY THE GATE — never that a team is mandatory.
 * @param team - the provisioned team state.
 * @param signals - the matched gate signal ids.
 * @returns the user-role startup notice.
 */
export function provisionedNotice(team, signals = []) {
    const profileName = team.profile?.name ?? '';
    const matched = signals.length === 0 ? 'complexity signals' : `complexity signals ${signals.join('/')}`;
    return createUserMessage({
        content: [{
            type: 'text',
            text: `${STARTUP_NOTICE_MARKER}: this session was routed by the complexity gate (${matched}) — a team is NOT a precondition of this session.
- Team "${team.name}" (id ${team.id}${profileName === '' ? '' : `, profile \`${profileName}\``}) is staged in this workspace; you are its captain.
- While it is staged, shape the roster/DAG with agent_teams_add_member / agent_teams_create_task / agent_teams_edit_plan / agent_teams_send_message, then tell the user the Web plan is ready. Members start only after the user edits and approves the plan (agent_teams_approve is yours to call only on explicit user approval).
- If the staged team does not fit this session, archive it with agent_teams_delete and continue solo with the user — that is an accepted outcome of this gate.
- You may not create a second team while leading this one.`,
        }],
        source: { kind: 'plugin', plugin: 'agent-teams', reason: 'session-start-provision' },
    });
}
/**
 * The notice shown when the legacy `instruct` mode runs or provisioning failed:
 * the captain is asked to create a team itself.
 * @param policy - the normalized sessionTeamPolicy config.
 * @returns the user-role startup notice.
 */
export function instructNotice(policy) {
    const profile = policy.profile ?? 'mpd';
    return createUserMessage({
        content: [{
            type: 'text',
            text: `${STARTUP_NOTICE_MARKER}: this deployment opted into the explicit-team instruction mode. Before doing substantive work, call agent_teams_create(approval="required", profile="${profile}") (or a profile of your choice) to stage the plan, design the task DAG while staged, and tell the user the Web plan is ready for review. Do not end the turn without a team unless the user explicitly declined teamwork.`,
        }],
        source: { kind: 'plugin', plugin: 'agent-teams', reason: 'session-start-instruct' },
    });
}
/**
 * Splice a notice into the pre-step decision after the last claimed message,
 * mirroring the placement the workspace-instructions plugin uses.
 * @param decision - the input decision from the inner waterfall chain.
 * @param claimed - the messages claimed by this step.
 * @param notice - the message to inject.
 * @returns the merged decision.
 */
export function spliceNotice(decision, claimed, notice) {
    const lastClaimedIndex = decision.messages.findLastIndex((message) => claimed.includes(message));
    const at = lastClaimedIndex < 0 ? decision.messages.length : lastClaimedIndex + 1;
    return {
        ...decision,
        messages: decision.messages.toSpliced(at, 0, notice),
    };
}
/**
 * Decide the session-start action for one step.
 * @param policy - the normalized sessionTeamPolicy config.
 * @param userText - the text of the latest claimed user message (undefined when none).
 * @param workspace - the session workspace root.
 * @returns the routing decision: which path applies and the matched signals.
 */
export async function routeDecision(policy, userText, workspace) {
    if (userText === undefined)
        return { action: 'none', signals: [] };
    if (policy.mode === 'auto')
        return { action: 'provision', signals: [] };
    if (policy.mode === 'instruct')
        return { action: 'instruct', signals: [] };
    if (autoRouteEnabled(policy)) {
        const consumed = consumeExplicitFlag(userText);
        const planArtifact = await hasPlanArtifact(workspace);
        const verdict = evaluateComplexityGate(consumed.text, { explicitFlag: consumed.flagged, planArtifact });
        if (verdict.trigger)
            return { action: 'provision', signals: verdict.signals };
    }
    return { action: 'none', signals: [] };
}
/**
 * Install the session-start team policy on a plugin context.
 *
 * The listener is registered global + prepend so it sits outermost in the
 * `agent/pre-step` waterfall (the host mounts before per-preset listeners) and
 * its returned decision is the final one. It faithfully forwards the inner
 * decision untouched on every non-provisioning step, and it lands BEFORE any
 * sizing/scale doctrine so the gate can actually prevent a team.
 * @param ctx - the plugin context (injects `agents`, `llm`, `systemPrompt`).
 * @param resolved - the resolved plugin runtime config (must carry `sessionTeamPolicy`).
 */
export function installSessionTeamPolicy(ctx, resolved) {
    const policy = resolved.sessionTeamPolicy;
    if (!policyEnabled(policy))
        return;
    ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
        // An inner listener failure (another plugin, or an abort) propagates:
        // only OUR provisioning failures degrade, and only into the notice below
        // — never into a broken decision.
        const decision = await next();
        if (decision === undefined || decision.kind === 'reject')
            return decision;
        if (agent === undefined || !policyQualifies(policy, agent))
            return decision;
        if (settledFor.has(agent.id))
            return decision;
        settledFor.add(agent.id);
        const workspace = agent.session.header.cwd ?? process.cwd();
        const user = latestUserMessage(messages);
        // R3 residue reclamation: at the session's FIRST pre-step, archive the stale
        // empty staged teams left by the pre-gate auto-provisioning. Archiving (never a
        // raw delete) keeps them reviewable, the caller's own team is excluded, and a
        // failure degrades to a warning instead of breaking the step.
        try {
            const stateRoot = join(workspace, resolved.stateDir);
            const own = await findTeamByParticipant(stateRoot, agent.id);
            const reclaim = await reclaimStaleStagedTeams(stateRoot, {
                staleAfterMs: resolved.reclaimStaleAfterMs ?? DEFAULT_RECLAIM_STALE_AFTER_MS,
                ownTeamId: own?.id,
            });
            if (reclaim.archived.length > 0) {
                ctx.logger.info(`agent-teams: archived ${reclaim.archived.length} stale staged team(s): ${reclaim.archived.map((entry) => entry.teamId).join(', ')}`);
            }
        }
        catch (error) {
            ctx.logger.warn(`agent-teams: stale-team reclamation failed for agent "${agent.id}": ${String(error)}`);
        }
        const route = await routeDecision(policy, user?.text, workspace);
        if (route.action === 'none')
            return decision;
        // A `team:` / `!team` activation marker is CONSUMED: it must not reach
        // the model as part of the goal text.
        if (route.action === 'provision' && user !== undefined) {
            const consumed = consumeExplicitFlag(user.text);
            if (consumed.flagged) {
                const rewritten = consumeFlagFromMessage(user.message, user.text);
                decision.messages = decision.messages.map((message) => message === user.message ? rewritten : message);
            }
        }
        let notice;
        if (route.action === 'provision') {
            let team;
            try {
                team = await provisionSessionTeam(ctx, resolved, policy, agent, signal);
            }
            catch (error) {
                ctx.logger.warn(`agent-teams: session-start provisioning failed for agent "${agent.id}": ${String(error)}`);
                notice = instructNotice(policy);
            }
            // A team already exists (resume/race): the session is already
            // inside one — no notice needed, and none may be invented.
            if (team === undefined && notice === undefined)
                return decision;
            if (team !== undefined)
                notice = provisionedNotice(team, route.signals);
        }
        else {
            notice = instructNotice(policy);
        }
        return spliceNotice(decision, messages, notice);
    }, { global: true, prepend: true });
}
//#endregion mpd-delta session-start-gate
/** Frozen gate id carried by the session-start complexity gate (diagnostics only). */
export const SESSION_START_GATE_ID = 'mpd-session-start-complexity-gate/1';