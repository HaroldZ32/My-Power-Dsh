/**
 * Session-start team policy: mechanical enforcement that every qualifying
 * session begins inside a team.
 *
 * Prompt-level guidance ("use AgentTeams for team work") is not enough — a
 * session can quietly run solo. This module hooks the agent loop's
 * `agent/pre-step` waterfall and, on the first step of a qualifying session,
 * makes sure the session's agent leads a team:
 *
 * - `mode: 'auto'` (bundle default for MPD): when the captain has no team in
 *   the workspace state root yet, provision the configured default team
 *   (profile roster, staged with approval=required — the same path the
 *   `agent_teams_create` tool uses, so member routes and team state are
 *   byte-identical), then inject one startup notice into the step's messages
 *   telling the captain the team exists, that the session runs through it,
 *   and how to replace it if it does not fit.
 * - `mode: 'instruct'`: only inject the notice demanding
 *   `agent_teams_create(approval="required", profile=...)` before
 *   substantive work; nothing is created for the captain.
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
 * unreduced and an instruction notice is injected instead, so the session
 * still gets the mechanically-visible nudge.
 * @module dsh-agent-teams/session-start
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createUserMessage } from '../_deps/dsh-llm/lib/index.ts';
import { appendTeamEvent } from "./events.ts";
import { findTeamByParticipant, readTeam, sanitizeKey, withTeamLock } from "./state.ts";
import { initializeProfileTeam } from "./tools.ts";
/** Default display name for the auto-provisioned default team. */
export const DEFAULT_TEAM_NAME = 'MPD Default';
/** Notice marker the injected startup message starts with. */
export const STARTUP_NOTICE_MARKER = '[AgentTeams] Session-start team rule';
/**
 * Per-agent settlement: after the policy has run for a session it never runs
 * again (see module doc). Keyed by agent id; agents are long-lived per
 * session, so this map stays bounded by live sessions.
 */
const settledFor = new Set();
/**
 * Whether the policy is enabled.
 * @param policy - the normalized sessionTeamPolicy config.
 * @returns true when mode is not 'off'.
 */
export function policyEnabled(policy) {
    return policy?.mode !== undefined && policy.mode !== 'off';
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
        const description = policy.description ?? `Auto-provisioned default team for this session (session-start team policy; staged — the captain designs the roster/DAG, then the user reviews and approves the plan in the Web panel).`;
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
 * The notice shown when a default team was provisioned.
 * @param team - the provisioned team state.
 * @returns the user-role startup notice.
 */
export function provisionedNotice(team) {
    const profileName = team.profile?.name ?? '';
    return createUserMessage({
        content: [{
            type: 'text',
            text: `${STARTUP_NOTICE_MARKER}: this session must run inside a team — one has been provisioned for you.
- Team "${team.name}" (id ${team.id}${profileName === '' ? '' : `, profile \`${profileName}\``}) is staged in this workspace; you are its captain.
- While it is staged, shape the roster/DAG with agent_teams_add_member / agent_teams_create_task / agent_teams_edit_plan / agent_teams_send_message, then tell the user the Web plan is ready. Members start only after the user edits and approves the plan (agent_teams_approve is yours to call only on explicit user approval).
- You may not create a second team while leading this one. If the default team does not fit this session, archive it with agent_teams_delete first, then create a fresh one with agent_teams_create(approval="required", profile="${profileName || 'mpd'}").
- Never run a session outside a team: when this session resumes, its team is resumed automatically.`,
        }],
        source: { kind: 'plugin', plugin: 'agent-teams', reason: 'session-start-provision' },
    });
}
/**
 * The notice shown when the policy runs in `instruct` mode or provisioning
 * failed: the captain must create a team itself.
 * @param policy - the normalized sessionTeamPolicy config.
 * @returns the user-role startup notice.
 */
export function instructNotice(policy) {
    const profile = policy.profile ?? 'mpd';
    return createUserMessage({
        content: [{
            type: 'text',
            text: `${STARTUP_NOTICE_MARKER}: before doing substantive work in this session you MUST lead a team — call agent_teams_create(approval="required", profile="${profile}") (or a profile of your choice) to stage the plan, design the task DAG while staged, and tell the user the Web plan is ready for review. Do not end the turn without a team unless the user explicitly declined teamwork.`,
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
    return {
        ...decision,
        messages: decision.messages.toSpliced(lastClaimedIndex + 1, 0, notice),
    };
}
/**
 * Install the session-start team policy on a plugin context.
 *
 * The listener is registered global + prepend so it sits outermost in the
 * `agent/pre-step` waterfall (the host mounts before per-preset listeners) and
 * its returned decision is the final one. It faithfully forwards the inner
 * decision untouched on every non-provisioning step.
 * @param ctx - the plugin context (injects `agents`, `llm`, `systemPrompt`).
 * @param resolved - the resolved plugin runtime config (must carry `sessionTeamPolicy`).
 */
export function installSessionTeamPolicy(ctx, resolved) {
    const policy = resolved.sessionTeamPolicy;
    if (policy === undefined || policy.mode === 'off')
        return;
    ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
        // An inner listener failure (another plugin, or an abort) propagates:
        // only OUR provisioning failures degrade, and only into the
        // instruction notice below — never into a broken decision.
        const decision = await next();
        if (decision === undefined || decision.kind === 'reject')
            return decision;
        if (agent === undefined || !policyQualifies(policy, agent))
            return decision;
        if (settledFor.has(agent.id))
            return decision;
        settledFor.add(agent.id);
        let notice;
        if (policy.mode === 'auto') {
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
                notice = provisionedNotice(team);
        }
        else if (policy.mode === 'instruct') {
            notice = instructNotice(policy);
        }
        else {
            return decision;
        }
        return spliceNotice(decision, messages, notice);
    }, { global: true, prepend: true });
}