import { createUserMessage } from '../_deps/dsh-llm/lib/index.ts';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { findTeamByParticipant, readTeam, withTeamLock } from "./state.ts";
import { initializeProfileTeam } from "./tools.ts";
import { parseProfileInvocation, resolveProfileTaskPlanning } from "./profiles.ts";
export const AGENT_TEAMS_COMMAND = 'agent-teams';
const PROFILE_COMMAND_PREFIX = `${AGENT_TEAMS_COMMAND}-`;
const GESTURE = /^\/agent-teams(?=$|[\t\n\r ])/u;
/**
 * Convert a configured profile key into a stable, closed-namespace command
 * suffix. Only lowercase ASCII letters, digits and dashes are representable;
 * this deliberately prevents accidental command aliases for ambiguous profile
 * names such as `foo bar`, `foo_bar`, or non-ASCII keys.
 */
export function profileCommandName(profileName) {
    const normalized = profileName.trim().toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(normalized))
        return undefined;
    return `${PROFILE_COMMAND_PREFIX}${normalized}`;
}
/** Resolve a profile command only when it maps uniquely to a live profile. */
function profileForCommand(commandName, profiles) {
    const matches = Object.keys(profiles).filter((profileName) => profileCommandName(profileName) === commandName);
    return matches.length === 1 ? matches[0] : undefined;
}
/** Parse either the generic command or one generated profile alias. */
function parseCommandText(text, profiles) {
    const trimmed = text.trimStart();
    if (GESTURE.test(trimmed))
        return parseProfileInvocation(trimmed.slice(AGENT_TEAMS_COMMAND.length + 1).trim());
    if (!trimmed.startsWith(`/${PROFILE_COMMAND_PREFIX}`))
        return undefined;
    const tokenEnd = trimmed.search(/[\t\n\r ]/u);
    const commandName = trimmed.slice(1, tokenEnd === -1 ? undefined : tokenEnd);
    const profile = profileForCommand(commandName, profiles);
    if (profile === undefined)
        return undefined;
    return { profile, goal: (tokenEnd === -1 ? '' : trimmed.slice(tokenEnd)).trim() };
}
//#region mpd-delta explicit-team-fallback (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
/** Marker the R4 activation notice starts with. */
export const EXPLICIT_TEAM_NOTICE_MARKER = '[AgentTeams] Explicit team activation';
/** Marker the idempotent "ask first" inquiry starts with. */
export const EXPLICIT_TEAM_INQUIRY_MARKER = '[AgentTeams] Explicit request — a team already exists';
/** An unapproved staged team whose captain is the same WORKSPACE's session line, or any
 * staged team still awaiting a decision. A fresh headless boot carries a new session id,
 * so participant matching alone would let a second explicit call silently stage a
 * DUPLICATE plan; this finds the plan the user has not answered yet. */
async function findStagedTeamAwaitingApproval(stateRoot, agentId) {
    let entries;
    try {
        entries = await readdir(stateRoot, { withFileTypes: true });
    }
    catch {
        return undefined;
    }
    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === 'archive' || entry.name.startsWith('.'))
            continue;
        const team = await readTeam(stateRoot, entry.name);
        if (team === undefined || team.phase !== 'staged' || team.approvedAt !== undefined)
            continue;
        return team;
    }
    return undefined;
}
/**
 * R4 explicit-entry hardening: the DETERMINISTIC half of the explicit path.
 *
 * An explicit invocation (`/agent-teams`, the generated `/agent-teams-<profile>`, or a
 * plain-text gesture) must never end with "the user asked for a team and nothing
 * happened". The model keeps the primary path, but the plugin stages the team itself
 * at the point the invocation is recognised — which is the SAME TURN by construction,
 * because the recognition happens inside the command/gesture handler — and injects a
 * visible activation notice. Nothing is ever silent: if the plugin cannot stage the
 * team (for example the row is not mounted with the profile roster), it returns a
 * warning instead.
 *
 * Idempotency is "ask first" (user decision C): when the session already leads a team,
 * nothing is reused and nothing new is staged; the caller gets an explicit inquiry
 * naming the existing team and the two options.
 * @param opts - ctx, the resolved config, the agent and the requested profile/goal.
 * @returns `{kind:'staged'|'exists'|'unavailable', text, teamId?, profile?}`.
 */
export async function ensureExplicitTeam(opts) {
    const { ctx, config, agent, profileName } = opts;
    const workspace = agent?.session?.header?.cwd ?? process.cwd();
    const stateRoot = join(workspace, config.stateDir ?? '.mpd/team');
    const profile = profileName ?? 'mpd';
    try {
        const existing = await findTeamByParticipant(stateRoot, agent.id) ?? await findStagedTeamAwaitingApproval(stateRoot, agent.id);
        if (existing !== undefined) {
            const approved = existing.approvedAt !== undefined || existing.phase !== 'staged';
            return {
                kind: 'exists',
                teamId: existing.id,
                profile: existing.profile?.name,
                text: `${EXPLICIT_TEAM_INQUIRY_MARKER}: this session already leads team "${existing.name}" (id ${existing.id}, ${approved ? `phase ${existing.phase}` : 'staged, not yet approved'}). Nothing was created and nothing was reused automatically. Ask the user which they want: (a) keep using that team${approved ? ' and its task board' : ' and approve its plan'}, or (b) retire it (agent_teams_delete) and stage a fresh ${profile} team.`,
            };
        }
        if (!Array.isArray(config.profiles?.[profile]?.members) || config.profiles[profile].members.length === 0) {
            return {
                kind: 'unavailable',
                profile,
                text: `${EXPLICIT_TEAM_NOTICE_MARKER}: WARNING — an explicit team request was recognised but the "${profile}" profile roster is unavailable in this deployment, so no team could be staged. Check that the agent-teams row carries the profiles block.`,
            };
        }
        const teamId = await withTeamLock(`captain:${stateRoot}:${agent.id}`, async () => {
            const raced = await findTeamByParticipant(stateRoot, agent.id);
            if (raced !== undefined)
                return undefined;
            const base = (config.sessionTeamPolicy?.name ?? 'MPD Default');
            const sanitized = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'mpd-default';
            // A deterministic per-captain id keeps two sessions in one workspace from
            // colliding without needing a random read-modify-write.
            const id = `${sanitized}-${createHash('sha256').update(agent.id).digest('hex').slice(0, 8)}`;
            const created = await initializeProfileTeam({
                ctx,
                config,
                memberSelections: undefined,
                captain: agent,
                exec: { signal: opts.signal },
                stateRoot,
                teamName: base,
                teamId: id,
                profileName: profile,
                description: 'Staged by the R4 explicit-entry fallback (an explicit team request must never end silently).',
                staged: true,
            });
            if (!created.committed)
                throw new Error('explicit-entry staging did not commit');
            return created.state.id;
        });
        if (teamId === undefined) {
            const raced = await findTeamByParticipant(stateRoot, agent.id);
            return { kind: 'exists', teamId: raced?.id, text: `${EXPLICIT_TEAM_INQUIRY_MARKER}: a team for this session appeared while the explicit request was being handled (id ${raced?.id ?? 'unknown'}); nothing was reused automatically — ask the user which team to keep.` };
        }
        return {
            kind: 'staged',
            teamId,
            profile,
            text: `${EXPLICIT_TEAM_NOTICE_MARKER}: the plugin staged team "${config.sessionTeamPolicy?.name ?? 'MPD Default'}" (id ${teamId}, profile ${profile}, approval=required) because this session was explicitly asked for a team. No member is spawned before the user approves the Web plan; shape the roster/DAG, then tell the user the plan is ready.`,
        };
    }
    catch (error) {
        ctx.logger?.warn?.(`agent-teams: explicit-team staging failed: ${String(error)}`);
        return {
            kind: 'unavailable',
            profile,
            text: `${EXPLICIT_TEAM_NOTICE_MARKER}: WARNING — an explicit team request was recognised but staging failed (${String(error)}). No team exists; do not report success.`,
        };
    }
}
//#endregion mpd-delta explicit-team-fallback
export function invokedAgentTeamsInvocation(messages, getProfiles = () => ({})) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message === undefined || message.source.kind !== 'user')
            continue;
        for (const block of message.content) {
            if (block.type !== 'text')
                continue;
            const invocation = parseCommandText(block.text, getProfiles());
            if (invocation !== undefined)
                return invocation;
        }
    }
    return undefined;
}
export function invokedAgentTeamsGoal(messages) {
    return invokedAgentTeamsInvocation(messages)?.goal;
}
export function buildActivationDirective(goal, profile, taskPlanning = 'seed') {
    const lines = [
        'The user invoked an AgentTeams slash command. Activate the AgentTeams protocol from your instructions now: you are the captain of a multi-agent team.',
        'Call agent_teams_create with approval="required". Build the complete staged roster and DAG, then stop and ask the user to review the Web plan. Do not approve or start it in this same turn.',
    ];
    if (profile !== undefined) {
        lines.push(`Use configured AgentTeams profile "${profile}" when calling agent_teams_create.`);
        if (taskPlanning === 'captain') {
            lines.push('This profile supplies the roster and guardrails. After create, do not recreate members.', 'Derive the smallest useful task graph from the goal while the team is staged; do not ask the user whether to split, merge, serialize, or parallelize.', 'Independent supplemental work must become separate ready tasks so idle members can run in parallel. Add dependencies only for genuine prerequisites and later synthesis.');
        }
        else {
            lines.push('Do not recreate the same members or seed tasks manually.');
        }
    }
    lines.push(goal === '' ? 'The goal was not given — ask the user what the team should accomplish.' : `Goal: ${goal}`);
    return lines.join('\n');
}
/**
 * Shared R4 bridge for every explicit entry point: stage-or-ask, then hand back the
 * text to inject. Returns undefined when no config was supplied (a minimal composition
 * without the agent-teams row), in which case the caller keeps the legacy directive.
 */
async function resolveExplicitTeamText(opts) {
    if (opts.config === undefined || opts.ctx === undefined || opts.agent === undefined)
        return undefined;
    const result = await ensureExplicitTeam({ ctx: opts.ctx, config: opts.config, agent: opts.agent, profileName: opts.profileName });
    return result.text;
}
export function registerAgentTeamsCommand(ctx, getProfiles = () => ({}), getExplicitOpts = () => undefined) {
    ctx.effect(() => {
        const dispose = [];
        dispose.push(ctx.commands.register({
            name: AGENT_TEAMS_COMMAND,
            description: 'run a goal with a multi-agent team (you become the captain)',
            input: { hint: '[--profile <name>] <goal>' },
            async handler(invocation) {
                let parsed;
                try {
                    parsed = parseProfileInvocation(invocation.rawInput.trim());
                }
                catch (error) {
                    return { kind: 'error', text: String(error) };
                }
                if (parsed.profile !== undefined && !Object.keys(getProfiles()).some(key => key.trim() === parsed.profile))
                    return { kind: 'error', text: `unknown AgentTeams profile "${parsed.profile}"` };
                if (parsed.profile === undefined && parsed.goal === '')
                    return { kind: 'error', text: `Usage: /${AGENT_TEAMS_COMMAND} [--profile <name>] <goal>` };
                invocation.agent.followup(createUserMessage({ content: [{ type: 'text', text: `/${AGENT_TEAMS_COMMAND}${invocation.rawInput}` }], source: { kind: 'user' } }));
                // R4: the plugin stages (or asks) itself, in THIS turn, so the explicit
                // path cannot end with "asked for a team, nothing happened".
                const explicit = await resolveExplicitTeamText({ ...(getExplicitOpts() ?? {}), agent: invocation.agent, profileName: parsed.profile });
                return { kind: 'success', text: explicit ?? `AgentTeams activated${parsed.profile === undefined ? '' : ` with profile ${parsed.profile}`} — the captain will assemble the team.` };
            },
        }));
        for (const profileName of Object.keys(getProfiles())) {
            const commandName = profileCommandName(profileName);
            if (commandName === undefined)
                continue;
            dispose.push(ctx.commands.register({
                name: commandName,
                description: `run a goal with the AgentTeams ${profileName} profile`,
                input: { hint: '<goal>' },
                async handler(invocation) {
                    const profile = profileForCommand(commandName, getProfiles());
                    if (profile === undefined)
                        return { kind: 'error', text: `AgentTeams profile command "/${commandName}" is unavailable` };
                    invocation.agent.followup(createUserMessage({ content: [{ type: 'text', text: `/${commandName}${invocation.rawInput}` }], source: { kind: 'user' } }));
                    const explicit = await resolveExplicitTeamText({ ...(getExplicitOpts() ?? {}), agent: invocation.agent, profileName: profile });
                    return { kind: 'success', text: explicit ?? `AgentTeams activated with profile ${profile} — the captain will assemble the team.` };
                },
            }));
        }
        return () => {
            for (const unregister of dispose.reverse())
                unregister();
        };
    }, 'agent-teams: slash commands');
}
export function installAgentTeamsGestureBoundary(ctx, getProfiles = () => ({}), getExplicitOpts = () => undefined) {
    ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
        const decision = await next();
        if (decision.kind === 'reject')
            return decision;
        let invocation;
        try {
            invocation = invokedAgentTeamsInvocation(messages, getProfiles);
        }
        catch (error) {
            return { kind: 'enter', messages: [...decision.messages, createUserMessage({ content: [{ type: 'text', text: `AgentTeams profile parsing failed: ${String(error)}` }], source: { kind: 'agent-teams-command' } })] };
        }
        if (invocation === undefined)
            return decision;
        signal.throwIfAborted();
        const profiles = getProfiles();
        const explicitOpts = getExplicitOpts() ?? {};
        // R4 silent-failure requirement: with the command surface disabled the gesture
        // is still recognised, so it must SAY so instead of looking like a no-op.
        if (explicitOpts.config?.explicitDisabled === true) {
            return { kind: 'enter', messages: [...decision.messages, createUserMessage({ content: [{ type: 'text', text: `${EXPLICIT_TEAM_NOTICE_MARKER}: WARNING — an explicit AgentTeams gesture was recognised, but the slash-command surface is disabled (slashCommand:false), so it will not be handled as a command. Re-enable the row's slashCommand to use /agent-teams, or call agent_teams_create directly.` }], source: { kind: 'agent-teams-command' } })] };
        }
        const matched = invocation.profile === undefined
            ? undefined
            : Object.entries(profiles).find(([key]) => key.trim() === invocation.profile);
        const known = invocation.profile === undefined || matched !== undefined;
        let text;
        if (!known) {
            text = `AgentTeams profile "${invocation.profile}" does not exist. Available profiles: ${Object.keys(profiles).join(', ') || '(none)'}. Do not create a team.`;
        }
        else {
            // R4: same turn, deterministic. Stage the team (or produce the ask-first
            // inquiry when one already exists) and hand that text to the captain.
            const explicit = await resolveExplicitTeamText({ ...(getExplicitOpts() ?? {}), agent, profileName: invocation.profile });
            text = explicit ?? buildActivationDirective(invocation.goal, invocation.profile, resolveProfileTaskPlanning(matched?.[1]));
        }
        return { kind: 'enter', messages: [...decision.messages, createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'agent-teams-command', ...invocation.goal === '' ? {} : { goal: invocation.goal }, ...invocation.profile === undefined ? {} : { profile: invocation.profile } } })] };
    });
}
