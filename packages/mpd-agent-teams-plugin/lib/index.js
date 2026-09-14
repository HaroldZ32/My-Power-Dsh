/**
 * AgentTeams for DeepSeek Harness.
 *
 * A host-plane plugin that registers the `agent_teams_*` tools and one usage
 * section into the global system prompt. After installation any session can
 * run multi-agent teamwork through natural language (e.g. "use AgentTeams to research X"):
 * the model creates a team (it becomes the captain), spawns members as
 * durable continuable subagents, breaks the goal into tasks with
 * dependencies, wakes members with messages, relays reports, and collects
 * results.
 *
 * Installation (bundle): `dsh plugin --profile <name> add @nanmicoder/dsh-agent-teams`
 * (or a local path). The bundle patch mounts this plugin row into the host
 * composition; the tools register into the shared `tools` registry and the
 * usage section into the global system prompt, so the plugin needs no realm.
 *
 * @module dsh-agent-teams
 */
import z from '../_deps/schemastery/lib/index.mjs';
import { createUserMessage } from '../_deps/dsh-llm/lib/index.js';
import { haltTeamWork, registerAgentTeamsTools, stagedPlanApprovedContext, } from "./tools.js";
import { installAgentTeamsGestureBoundary, registerAgentTeamsCommand } from "./command.js";
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectArchivedTeamsActivity, collectTeamsActivity } from "./snapshot.js";
import { findTeamByCaptain } from "./state.js";
import { formatProfilesForPrompt } from "./profiles.js";
import { qualityPlanningPrompt } from "./quality-gates.js";
import { installInterjectionExpirySweep, installSessionTeamPolicy } from "./session-start.js";
import { installTeamCapabilities } from "./capabilities.js";
import { TEAM_TOOL_NAMES } from "./tool-names.js";
import { RequestBodyError, authenticatedWebRoutes, readJsonRequest } from "./web-routes.js";
/** Web-server service key candidates, newest first. */
const WEB_SERVER_KEYS = ['webServer', 'httpServer'];
/** Workspace registry service key candidates, newest first. */
const WORKSPACE_KEYS = ['workspaceRegistry', 'workspace'];
export const name = 'agent-teams';
export const inject = ['tools', 'llm', 'subagents', 'systemPrompt', 'agents'];
// `z.object()` has an implicit `{}` default in Schemastery.  Fallback routes
// are optional, so model absence explicitly; otherwise a missing route is
// validated as an empty object and fails on the required provider/model keys.
const fallbackRouteConfig = z.union([
    z.object({ provider: z.string().required(), model: z.string().required() }),
    z.const(undefined),
]);
export const Config = z.object({
    stateDir: z.string().default('.mpd/team'),
    memberProvider: z.string().default('spawn'),
    memberModel: z.string(),
    executionPrompt: z.string(),
    fallback: fallbackRouteConfig,
    profiles: z.dict(z.object({
        description: z.string(),
        protocol: z.string(),
        executionPrompt: z.string(),
        fallback: fallbackRouteConfig,
        members: z.array(z.object({
            name: z.string().required(),
            role: z.string(),
            provider: z.string(),
            model: z.string(),
            reasoning_effort: z.string(),
            executionPrompt: z.string(),
            fallback: fallbackRouteConfig,
        })).min(1).required(),
        taskPlanning: z.union([z.const('captain'), z.const('seed')]),
        reviewPolicy: z.object({
            requirementsMinRounds: z.natural().min(1),
            requirementsMaxRounds: z.natural().min(1),
            codeMaxRounds: z.natural().min(1),
            maxRepairAttempts: z.natural().min(1),
            requiredReviewers: z.array(z.string()),
        }),
        tasks: z.array(z.object({
            id: z.string().required(),
            subject: z.string().required(),
            description: z.string(),
            assignee: z.string(),
            dependencies: z.array(z.string()),
        })),
    })).default({}),
    memberMaxDepth: z.natural().default(1),
    maxMembers: z.natural().min(1).default(16),
    // Configuration plane aligned to upstream team_mode (measured at
    // `/root/dshProj/oh-my-openagent` packages/team-core/src/config.ts:6-14),
    // with the user's decision that OUR ceilings stay the more permissive local
    // values. Every key is absent-safe: an old profile without them boots on
    // these defaults (exercised by the self-test and the headless boot).
    maxParallelMembers: z.natural().min(1).default(8),
    maxMessagesPerRun: z.natural().min(1).default(10000),
    maxWallClockMinutes: z.natural().min(1).default(120),
    maxMemberTurns: z.natural().min(1).default(500),
    messagePayloadMaxBytes: z.natural().min(1024).default(32768),
    recipientUnreadMaxBytes: z.natural().min(1024).default(262144),
    mailboxPollIntervalMs: z.natural().min(500).default(3000),
    enforcement: z.union([z.const('enforce'), z.const('observe')]).default('enforce'),
    // R3: age threshold before an EMPTY STAGED team counts as residue and is
    // archived at the next session start (default 1 hour).
    reclaimStaleAfterMs: z.natural().default(3600000),
    promptSectionOrder: z.natural().default(117),
    slashCommand: z.boolean().default(true),
    // Session-start team policy: a session starts with NO team unless the
    // mechanical complexity gate fires (see lib/session-start.js). `mode` keeps
    // its three legacy values and defaults to 'off' = no auto-provision and no
    // unconditional notice; `autoRoute` is the DECOUPLED mechanical gate and
    // defaults ON, so the complexity gate is evaluated without a mandatory team.
    sessionTeamPolicy: z.object({
        mode: z.union([z.const('off'), z.const('auto'), z.const('instruct')]).default('off'),
        autoRoute: z.boolean().default(true),
        profile: z.string(),
        presets: z.array(z.string()),
        name: z.string().default('MPD Default'),
        description: z.string(),
        approval: z.union([z.const('required'), z.const('automatic')]).default('required'),
    }).default({ mode: 'off', autoRoute: true }),
});
/** The model-facing usage policy: when and how to drive AgentTeams. */
export function usageSectionText(toolNames, profilesText = '') {
    return `When the user asks to run something with AgentTeams (e.g. "use AgentTeams to do X"), or an activation message from the /agent-teams slash command arrives, you are the captain of a multi-agent team. Follow this protocol:
1. Call agent_teams_create with a team name, the goal as description, and approval="required". This creates a staged plan and must not spawn members or schedule work. Use approval="automatic" only when the user explicitly asks to skip review and run immediately.
2. Call agent_teams_add_member once per role the goal needs (researcher, engineer, reviewer, ...). In staging these are editable roster entries, not running subagents. By default a member snapshots your current provider/model/reasoning route; use a different route only when the goal or user requires it.
3. Analyze the goal and create the smallest useful task DAG while staged. Every agent_teams_create_task call must include a non-empty subject, including verification and review tasks. Independent work should be parallel; dependencies are only genuine prerequisites. Finish the complete roster and DAG, tell the user the Web plan is ready, then end this turn. Never call agent_teams_approve during the planning turn. The user may click Approve & Run, explicitly approve in a later user turn, return to chat to request changes, or discard the plan. The review UI injects an authoritative control message for return/discard actions: follow it exactly and never infer that a missing or paused team should be recreated. When the user returns to chat, first ask one concise clarification question without editing or recreating; after their answer, call agent_teams_edit_plan once with an ordered atomic batch, update downstream dependencies/assignees before removals, summarize the revision, and wait for review again. Never inspect or edit .agent-teams state files or plugin source code to revise a plan. Only explicit approval may call agent_teams_approve.
4. After approval, the final member configuration is spawned atomically and the scheduler starts ready work. Lead by delegation: monitor with agent_teams_status, send guidance with agent_teams_send_message, and let idle teammates execute ready work. Do not duplicate a teammate's work merely because its turn is slow. If the user requires every member to contribute or report, create one task per required contribution (or message each member directly); never wait for an unassigned member to produce work it was never given.
5. If the user explicitly asks to pause a running member, its open attempt remains parked after interruption; after answering the user, send that same member guidance with agent_teams_send_message so it continues the same attempt. Do not interrupt members for an ordinary user question that did not request a pause. If work must change owner, restart from scratch, or be taken over, call agent_teams_reassign_task first. Prefer another idle member or a retry with the same member. Use assignee=captain only for one ready task that you will personally drive to a terminal status in this same turn; never start a second captain takeover while one is unfinished, and never end your turn with captain-owned work open. Reassignment revokes the old attempt and waits for that member to quiesce, preventing late results from overwriting the new attempt.
6. Tasks carry attempt_id capabilities. Members must use the current attempt_id for updates; stale-attempt errors mean ownership changed. Check status after progress notifications until every required task is terminal and every member is idle/ready; do not busy-poll or require reports from members with no assigned work.
7. If the user names a configured profile / template / fixed roster, pass that name as profile= to agent_teams_create. After a successful profile create, do not recreate the same members. Seed profiles provide their template tasks; captain-planning profiles provide only the roster and guardrails, so you must design their DAG while staged. Add repair or retry tasks when review/test fails, but never make a new task depend on a failed task. Do not send_message to start the next stage; the scheduler assigns ready work after approval. Watch every required task until it is terminal before deleting the team. Never perform a real deployment without explicit user confirmation.
8. Quality kinds (requirements, implementation, verification, review, repair, integration) need a contract: non-empty objective and acceptance; implementation/repair also need inScope and verify. Review/requirements can complete only with verdict=pass; needs_revision/reject must fail with findings. The system then opens repair + next review that depend on the successful source, never the failed review. Do not approve your own implementation. create_task no longer silently resumes a halted team — call agent_teams_resume with a reason, or create_task({resume:true, resumeReason}).
9. ${qualityPlanningPrompt()}
10. Present the team's results to the user, then agent_teams_delete the team unless the user wants to keep working with it. Stopping a team aborts the Captain's current turn as well as member work; only a later explicit user turn may resume it.

Tools: ${toolNames}${profilesText === '' ? '' : `\n\n${profilesText}`}`;
}
export function apply(ctx, config) {
    const resolved = {
        stateDir: config.stateDir ?? '.agent-teams',
        memberProvider: config.memberProvider ?? 'spawn',
        memberModel: config.memberModel,
        executionPrompt: config.executionPrompt,
        fallback: config.fallback,
        memberMaxDepth: config.memberMaxDepth ?? 1,
        maxMembers: config.maxMembers ?? 16,
        maxParallelMembers: config.maxParallelMembers ?? 8,
        maxMessagesPerRun: config.maxMessagesPerRun ?? 10000,
        maxWallClockMinutes: config.maxWallClockMinutes ?? 120,
        maxMemberTurns: config.maxMemberTurns ?? 500,
        messagePayloadMaxBytes: config.messagePayloadMaxBytes ?? 32768,
        recipientUnreadMaxBytes: config.recipientUnreadMaxBytes ?? 262144,
        mailboxPollIntervalMs: config.mailboxPollIntervalMs ?? 3000,
        enforcement: config.enforcement ?? 'enforce',
        reclaimStaleAfterMs: config.reclaimStaleAfterMs ?? 3600000,
        profiles: config.profiles ?? {},
        sessionTeamPolicy: {
            mode: config.sessionTeamPolicy?.mode ?? 'off',
            autoRoute: config.sessionTeamPolicy?.autoRoute ?? true,
            profile: config.sessionTeamPolicy?.profile,
            presets: config.sessionTeamPolicy?.presets ?? [],
            name: config.sessionTeamPolicy?.name ?? 'MPD Default',
            description: config.sessionTeamPolicy?.description,
            approval: config.sessionTeamPolicy?.approval ?? 'required',
        },
    };
    // Provider registration is a sibling plugin's effect (`subagent-spawn` /
    // `subagent-fork` rows), which can land after this mount under the Loader's
    // concurrent activation — so capability validation happens at the first
    // member spawn (`spawnMember`), the earliest point the provider list is
    // settled, rather than here.
    // Exported for TDD / docs checks. Not a public runtime API.
    const agentTeamsRuntime = registerAgentTeamsTools(ctx, resolved);
    // Agent-scoped usage section + member tool restriction. Installed after all
    // business definitions registered: the captain prefix is snapshotted once,
    // and a member is identified from durable state (pending spawn, retired
    // index, or live team record) before its first prompt assembly.
    installTeamCapabilities(ctx, {
        stateDir: resolved.stateDir,
        isPendingMember: agentTeamsRuntime.isPendingMember,
        order: config.promptSectionOrder ?? 117,
        // Keep the bounded profile directory available without extra tool calls.
        captainPrompt: () => usageSectionText(TEAM_TOOL_NAMES.join(', '), formatProfilesForPrompt(config.profiles ?? {})),
    });
    // Session-start team policy (off by default; the bundle enables it for the
    // MPD main agent). Installed AFTER tool registration so the shared profile
    // init path is available for provisioning.
    installSessionTeamPolicy(ctx, resolved);
    //#region mpd-delta interjection-expiry-registration (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
    // R1 dormancy fix: install the expiry sweep HERE, in the composition root, and
    // UNCONDITIONALLY — not inside installSessionTeamPolicy. The sweep is bookkeeping every
    // session needs, not a feature of auto-routing, so gating it behind the team policy
    // (which returns early when `sessionTeamPolicy.mode` is off) would silently reintroduce
    // the hole this closes: a dormant team's past-due interjection requests would never
    // resolve and their requesters would never be told that silence is a DENY.
    //
    // The function itself lives in session-start.js with the rest of the session-start
    // behaviour; only its REGISTRATION is a composition-root concern.
    installInterjectionExpirySweep(ctx, resolved);
    //#endregion mpd-delta interjection-expiry-registration
    // Deterministic activation surfaces: the closed-namespace `/agent-teams`
    // host command (surfaces in the Web GUI slash menu via the Harness
    // ui-commands client) and the plain-text gesture boundary for surfaces
    // without command adjudication (headless CLI). Both default on; a profile
    // can disable them to keep the natural-language trigger exclusive.
    //
    // `commands` is registered lazily (not a required inject): it ships in the
    // base bundle of every standard profile, but a minimal composition that
    // omits the command registry keeps the plugin fully functional — the fiber
    // never pends on it and simply never gains the slash command.
    if (config.slashCommand ?? true) {
        // R4: every explicit entry point (the generic command, each generated profile
        // command, and the plain-text gesture boundary) receives the resolved config so
        // it can stage-or-ask in the SAME turn instead of leaving the team to the model.
        const explicitOpts = () => ({ ctx, config: resolved });
        ctx.inject(['commands'], (commandCtx) => {
            registerAgentTeamsCommand(commandCtx, () => config.profiles ?? {}, explicitOpts);
        });
        installAgentTeamsGestureBoundary(ctx, () => config.profiles ?? {}, explicitOpts);
    }
    else {
        // R4 silent-failure requirement: a deployment that disables the slash command
        // still recognises the gesture text, so it must say the command is disabled
        // rather than staying quiet.
        installAgentTeamsGestureBoundary(ctx, () => config.profiles ?? {}, () => ({
            ctx,
            config: { ...resolved, slashCommand: false, explicitDisabled: true },
        }));
    }
    // The activity panel data/artwork routes need the Web server and the
    // workspace registry, which headless profiles do not mount; under
    // concurrent activation they may also bind after this plugin. Register the
    // routes lazily: try now, then on each service binding event. In a webless
    // profile the plugin stays tool-only and never blocks boot.
    let webRegistered = false;
    const registerWebSurface = () => {
        if (webRegistered)
            return;
        const rawWebServer = (ctx.get(WEB_SERVER_KEYS[0]) ?? ctx.get(WEB_SERVER_KEYS[1]));
        const workspaceRegistry = (ctx.get(WORKSPACE_KEYS[0]) ?? ctx.get(WORKSPACE_KEYS[1]));
        if (rawWebServer === undefined || workspaceRegistry === undefined)
            return;
        // These routes serve workspace team state and accept plan mutations, so
        // they run inside the host's browser-authentication fence and fail
        // closed (503) when the Connection service is unavailable.
        const webServer = authenticatedWebRoutes(rawWebServer, () => ctx.get('connection'));
        webRegistered = true;
        // Activity panel data route: the browser floater polls this for team
        // snapshots (disk truth + live subagent activity). Mirrors the Claude
        // Code desktop watcher's server-side snapshot pattern.
        ctx.effect(() => webServer.register({
            kind: 'exact',
            path: '/plugins/dsh-agent-teams/state',
            handler: async (req, res) => {
                const url = new URL(req.url ?? '/', 'http://x');
                const roots = workspaceRegistry.list().map((workspace) => ({
                    workspace: workspace.title,
                    stateRoot: join(workspace.path, resolved.stateDir),
                }));
                // ?archived=1 serves teams moved to archive/ (post-delete review).
                const snapshots = url.searchParams.get('archived') === '1'
                    ? await collectArchivedTeamsActivity(ctx, roots)
                    : await collectTeamsActivity(ctx, roots);
                const body = JSON.stringify({ teams: snapshots });
                res.writeHead(200, {
                    'content-type': 'application/json; charset=utf-8',
                    'cache-control': 'no-store',
                });
                res.end(body);
            },
        }), 'agent-teams: activity route');
        ctx.effect(() => webServer.register({
            kind: 'exact',
            path: '/plugins/dsh-agent-teams/halt',
            handler: async (req, res) => {
                if (req.method !== 'POST') {
                    res.writeHead(405, { allow: 'POST', 'cache-control': 'no-store' });
                    res.end();
                    return;
                }
                let payload;
                try {
                    payload = await readJsonRequest(req);
                }
                catch (error) {
                    res.writeHead(error instanceof RequestBodyError ? error.status : 400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'invalid request body' }));
                    return;
                }
                const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : '';
                const teamId = typeof payload.teamId === 'string' ? payload.teamId.trim() : '';
                if (sessionId === '' || teamId === '') {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'sessionId and teamId are required' }));
                    return;
                }
                const captain = ctx.agents.get(sessionId);
                if (captain === undefined) {
                    res.writeHead(409, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'captain session is not attached' }));
                    return;
                }
                const workspace = captain.session.header.cwd ?? process.cwd();
                const stateRoot = join(workspace, resolved.stateDir);
                const team = await findTeamByCaptain(stateRoot, captain.id);
                if (team === undefined || team.id !== teamId) {
                    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'team not found for this captain' }));
                    return;
                }
                try {
                    const result = await haltTeamWork({
                        ctx,
                        stateRoot,
                        teamId,
                        captain,
                    });
                    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify(result));
                }
                catch (error) {
                    ctx.logger.warn(`agent-teams: halt failed for ${teamId}: ${String(error)}`);
                    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'failed to stop the team' }));
                }
            },
        }), 'agent-teams: halt route');
        ctx.effect(() => webServer.register({
            kind: 'exact',
            path: '/plugins/dsh-agent-teams/plan',
            handler: async (req, res) => {
                if (req.method !== 'POST') {
                    res.writeHead(405, { allow: 'POST', 'cache-control': 'no-store' });
                    res.end();
                    return;
                }
                let payload;
                try {
                    payload = await readJsonRequest(req);
                }
                catch (error) {
                    res.writeHead(error instanceof RequestBodyError ? error.status : 400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'invalid request body' }));
                    return;
                }
                const sessionId = typeof payload['sessionId'] === 'string' ? payload['sessionId'].trim() : '';
                const teamId = typeof payload['teamId'] === 'string' ? payload['teamId'].trim() : '';
                const action = typeof payload['action'] === 'string' ? payload['action'] : '';
                if (sessionId === '' || teamId === '' || action === '') {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'sessionId, teamId, and action are required' }));
                    return;
                }
                const captain = ctx.agents.get(sessionId);
                if (captain === undefined) {
                    res.writeHead(409, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'captain session is not attached' }));
                    return;
                }
                const workspace = captain.session.header.cwd ?? process.cwd();
                const stateRoot = join(workspace, resolved.stateDir);
                const team = await findTeamByCaptain(stateRoot, captain.id);
                if (team === undefined || team.id !== teamId) {
                    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'team not found for this captain' }));
                    return;
                }
                try {
                    if (action === 'approve') {
                        const approved = await agentTeamsRuntime.approveStagedTeam(captain, teamId);
                        // The browser receives the HTTP result, so the model needs its own
                        // control message. steer wakes an idle captain or joins its next
                        // step; the tool approve path already returns to the model itself.
                        try {
                            captain.steer(createUserMessage({
                                content: [{ type: 'text', text: stagedPlanApprovedContext(team.name) }],
                                source: { kind: 'plugin', plugin: 'dsh-agent-teams' },
                            }));
                        }
                        catch (error) {
                            // Approval is already committed. Do not report a failed approval
                            // and invite a retry that could duplicate the user's action.
                            ctx.logger.warn(`agent-teams: approval notification failed for ${teamId}: ${String(error)}`);
                        }
                        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ ok: true, phase: 'running', ...approved }));
                        return;
                    }
                    if (action === 'continue') {
                        const continued = await agentTeamsRuntime.continueStagedPlanning(captain, teamId);
                        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ ok: true, phase: 'staged', review: 'awaiting_feedback', ...continued }));
                        return;
                    }
                    if (action === 'discard') {
                        const discarded = await agentTeamsRuntime.discardStagedTeam(captain, teamId);
                        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ ok: true, phase: 'archived', ...discarded }));
                        return;
                    }
                    const dependencies = Array.isArray(payload['dependencies'])
                        ? payload['dependencies'].filter((item) => typeof item === 'string')
                        : [];
                    let mutation;
                    if (action === 'update_member') {
                        if (typeof payload['memberName'] !== 'string'
                            || typeof payload['provider'] !== 'string'
                            || typeof payload['model'] !== 'string')
                            throw new Error('memberName, provider, and model are required');
                        mutation = {
                            action,
                            memberName: payload['memberName'],
                            provider: payload['provider'],
                            model: payload['model'],
                            ...typeof payload['role'] === 'string' || payload['role'] === null ? { role: payload['role'] } : {},
                            ...typeof payload['reasoningEffort'] === 'string' || payload['reasoningEffort'] === null
                                ? { reasoningEffort: payload['reasoningEffort'] }
                                : {},
                            ...typeof payload['executionPrompt'] === 'string' || payload['executionPrompt'] === null
                                ? { executionPrompt: payload['executionPrompt'] }
                                : {},
                        };
                    }
                    else if (action === 'update_task') {
                        if (typeof payload['taskId'] !== 'string' || typeof payload['subject'] !== 'string') {
                            throw new Error('taskId and subject are required');
                        }
                        mutation = {
                            action,
                            taskId: payload['taskId'],
                            subject: payload['subject'],
                            dependencies,
                            ...typeof payload['description'] === 'string' || payload['description'] === null
                                ? { description: payload['description'] }
                                : {},
                            ...typeof payload['assignee'] === 'string' || payload['assignee'] === null
                                ? { assignee: payload['assignee'] }
                                : {},
                        };
                    }
                    else if (action === 'add_task') {
                        if (typeof payload['subject'] !== 'string')
                            throw new Error('subject is required');
                        mutation = {
                            action,
                            subject: payload['subject'],
                            dependencies,
                            ...typeof payload['description'] === 'string' || payload['description'] === null
                                ? { description: payload['description'] }
                                : {},
                            ...typeof payload['assignee'] === 'string' || payload['assignee'] === null
                                ? { assignee: payload['assignee'] }
                                : {},
                        };
                    }
                    else if (action === 'remove_task') {
                        if (typeof payload['taskId'] !== 'string')
                            throw new Error('taskId is required');
                        mutation = { action, taskId: payload['taskId'] };
                    }
                    else {
                        throw new Error(`unknown plan action "${action}"`);
                    }
                    const updated = await agentTeamsRuntime.updateStagedPlan(captain, teamId, mutation);
                    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ ok: true, phase: updated.phase, members: updated.members.length, tasks: updated.tasks.length }));
                }
                catch (error) {
                    res.writeHead(409, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'plan operation failed' }));
                }
            },
        }), 'agent-teams: plan route');
        // Whale mascot artwork: serve the packaged V2 role/action images to the
        // activity panel. An explicit allowlist guards the route (no path
        // traversal); the images ship with the bundle (files: assets/).
        const artDir = fileURLToPath(new URL('../assets/agent-teams/', import.meta.url));
        const ART_ALLOWLIST = new Set([
            'team-lead-v2.png',
            'member-researcher-v2.png', 'member-engineer-v2.png',
            'member-qa-v2.png', 'member-designer-v2.png',
            'member-security-v2.png', 'member-docs-v2.png',
            'member-data-v2.png', 'member-operator-v2.png',
            'action-working-v2.png', 'action-thinking-v2.png',
            'action-reporting-v2.png', 'action-celebrating-v2.png',
            'action-sleeping-v2.png', 'action-sending-v2.png',
        ]);
        ctx.effect(() => webServer.register({
            kind: 'prefix',
            path: '/plugins/dsh-agent-teams/assets',
            handler: async (req, res) => {
                let name;
                try {
                    name = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname.split('/').pop() ?? '');
                }
                catch {
                    // Malformed percent-encoding: treat as an unknown asset, not a 400.
                    res.writeHead(404);
                    res.end();
                    return;
                }
                if (!ART_ALLOWLIST.has(name)) {
                    res.writeHead(404);
                    res.end();
                    return;
                }
                try {
                    const data = await readFile(join(artDir, name));
                    res.writeHead(200, {
                        'content-type': 'image/png',
                        'cache-control': 'public, max-age=86400',
                    });
                    res.end(data);
                }
                catch (error) {
                    ctx.logger.warn(`agent-teams: artwork read failed for ${name}: ${String(error)}`);
                    res.writeHead(404);
                    res.end();
                }
            },
        }), 'agent-teams: artwork route');
    };
    registerWebSurface();
    ctx.on('internal/service', (name) => {
        if (WEB_SERVER_KEYS.includes(name)
            || WORKSPACE_KEYS.includes(name)) {
            registerWebSurface();
        }
    });
    // Bounded polling fallback: cordis' service-binding notifications are
    // scope-filtered, so services that bind after this plugin in a different
    // scope (e.g. a home that installed a headless profile before the web
    // one) never reach the event listener above. Poll briefly so the surface
    // still registers once both services exist.
    const surfacePoll = setInterval(() => {
        if (webRegistered) {
            clearInterval(surfacePoll);
            return;
        }
        try {
            registerWebSurface();
        }
        catch { /* keep polling */ }
    }, 2000);
    ctx.effect(() => clearInterval(surfacePoll));
}
