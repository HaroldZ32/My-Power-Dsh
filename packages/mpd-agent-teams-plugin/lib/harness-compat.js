/**
 * The audited Harness subagent boundary. Keep version-specific shapes here:
 * API presence alone is not a promise of support for future versions.
 *
 * Three host generations have carried team delivery, in order:
 *   - Alpha.2: `followup`/`registerContinuableSetup` on the service.
 *   - Alpha.5 … 0.1.2-rc.1: a host-only symbol-keyed FIFO queue
 *     (`HOST_PROMPT_QUEUE`) plus synchronous `agent/session-start` setup.
 *   - 0.1.5-rc.2+: the PUBLIC `ctx.subagents.prompt(request, signal)` seam
 *     (`{requestId, parentSessionId, childSessionId, mode:'continuable',
 *     delivery:'queue', content}` → `{messageId}`) with the same synchronous
 *     `agent/session-start` setup. The symbol queue is gone from that host.
 * `sendMessage` steers a *running* Agent in every generation and must never
 * carry team jobs.
 *
 * LOCAL ADAPTATION (mpd bundle): upstream throws when no contract exists.
 * A missing seam must never abort `apply()` here — an apply-time throw takes
 * the whole plugin tree (and the GUI boot) down, which is exactly the 0.1.2-rc.1
 * `registerContinuableSetup` incident. Install-time helpers therefore warn and
 * degrade; only the runtime delivery helper throws, where the caller already
 * treats failure as "stay in the durable mailbox".
 * @module dsh-agent-teams/harness-compat
 */
import { randomUUID } from 'node:crypto';
import { SubagentError } from '../_deps/dsh-subagent/lib/index.js';
//#region mpd-delta adapter-subagent-runtime-import (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
// D5/D6: the runtime RESOLUTION and the per-agent scope are adapter-owned; the generation ladder's
// own policy (which method of the runtime it reads, and the retired-member guard's patching) stays
// in this module.
import { agentScopeOf, liveAgentOf, subagentRuntimeOf } from "./mpd-adapter-ctx.js";
//#endregion mpd-delta adapter-subagent-runtime-import
/**
 * Exact protocol exported by `dsh-subagent/internal` in Alpha.5 … 0.1.2-rc.1.
 * That subpath does not exist in Alpha.2, so importing it statically would
 * prevent the plugin from loading there. This adapter uses the same
 * process-stable symbol and call signature as upstream `queueHostSubagentPrompt`.
 * The 0.1.5-rc.2 host dropped this symbol in favor of the public `prompt` seam,
 * so it is kept only as the fallback for the generation that needs it.
 */
export const HOST_PROMPT_QUEUE = Symbol.for('dsh.subagent.queuePrompt');
/** Plugin provenance attached to every team-authored turn. */
export const TEAM_MESSAGE_SOURCE = { kind: 'plugin', plugin: 'dsh-agent-teams' };
function unsupported(detail) {
    return new Error(`agent-teams: unsupported Harness subagent contract (${detail}); use an explicitly tested Harness version and a coherent dependency installation`);
}
/** Read child-owned history, excluding any descriptor inherited from a parent. */
export function sessionOwnEvents(session) {
    if (typeof session.ownEvents === 'function')
        return session.ownEvents.call(session);
    // Legacy session log: the inherited prefix is everything before seedLength.
    if (!Array.isArray(session.events))
        throw unsupported('missing ownEvents/legacy session log');
    return session.events.slice(session.header.seedLength ?? 0);
}
/**
 * Install the per-child setup before the first request, including cold resume.
 *
 * Modern hosts (Alpha.5/rc.1) dropped `registerContinuableSetup`; their
 * replacement is a synchronous `agent/session-start` listener, which must run
 * before prompt assembly to win the first-request race.
 *
 * `setup` is invoked as `setup(childCtx, childAgent)`. The second argument is
 * the live child Agent from the session-start payload and is ALWAYS present on
 * the modern path. It exists because a modern child ctx is a Cordis proxy that
 * refuses undeclared property reads: `childCtx.agent` throws
 * `cannot get property "agent" without inject` (the agent-scoped ctx has no
 * `agent` binding, and `agent` is not a registerable service — the host only
 * injects `agents`, plural). Callers must therefore take the Agent from the
 * argument, not from the ctx. On the legacy path the host owns the call shape
 * and the second argument is absent; legacy ctxs do carry `agent`.
 */
export function installContinuableMemberSetup(ctx, setup) {
    //#region mpd-delta adapter-subagent-runtime-install (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
    // D6: the adapter owns WHICH object this ladder operates on (`subagentRuntime()` through the
    // facade, today's raw `ctx.subagents` otherwise); the ladder below still decides which
    // generation's method it reads.
    const runtime = subagentRuntimeOf(ctx);
    //#endregion mpd-delta adapter-subagent-runtime-install
    if (typeof runtime.registerContinuableSetup === 'function') {
        // Upstream owns this registration with this.ctx.effect. Cordis resolves
        // that ctx to the accessing plugin, so its disposal revokes installations
        // even while the subagents service and child Agents remain live.
        runtime.registerContinuableSetup(setup);
        return true;
    }
    // Modern delivery is either the public `prompt` seam (0.1.5-rc.2+) or the
    // symbol queue it replaced; both rely on the same session-start setup.
    const hasDelivery = typeof runtime.prompt === 'function' || typeof runtime[HOST_PROMPT_QUEUE] === 'function';
    if (!hasDelivery || typeof runtime.sendMessage !== 'function') {
        ctx.logger?.warn?.(unsupported('missing continuable setup and modern host delivery').message);
        return false;
    }
    const installed = new WeakSet();
    const active = new Set();
    ctx.effect(() => {
        const stop = ctx.on('agent/session-start', ({ agent }) => {
            if (installed.has(agent))
                return;
            //#region mpd-delta adapter-subagent-runtime-agent-scope (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
            // D5: the child's scope is adapter-owned; with no mounted adapter (and in every existing
            // unit test, where the ctx is a plain object) this IS the raw `agent.ctx` — identity.
            const scope = agentScopeOf(ctx, agent);
            //#endregion mpd-delta adapter-subagent-runtime-agent-scope
            // Deliberately synchronous: awaiting here loses the first-request race.
            let teardown;
            try {
                // Pass the Agent explicitly: a modern child ctx is a Cordis proxy
                // that throws on `childCtx.agent` (see this function's JSDoc).
                //#region mpd-delta adapter-subagent-runtime-agent-scope-setup (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
                // F1: `agentScopeOf` returns ONE shape in every arm and `scope.context` keeps the raw
                // ctx's IDENTITY, so this is byte-for-byte today's `setup(agent.ctx, agent)`.
                teardown = setup(scope.context, agent);
                //#endregion mpd-delta adapter-subagent-runtime-agent-scope-setup
            }
            catch (error) {
                // session-start is a notification: Harness logs a thrown listener and
                // still admits the first prompt. Reject request assembly explicitly so
                // a malformed saved route cannot silently execute on a default model.
                const failure = new Error(`agent-teams: member initialization failed: ${String(error)}`, { cause: error });
                ctx.logger?.warn?.(failure.message);
                //#region mpd-delta adapter-subagent-runtime-agent-scope-request (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
                teardown = scope.on('agent/request', () => { throw failure; });
                //#endregion mpd-delta adapter-subagent-runtime-agent-scope-request
            }
            installed.add(agent);
            let disposed = false;
            const dispose = () => {
                if (disposed)
                    return;
                disposed = true;
                active.delete(dispose);
                installed.delete(agent);
                teardown();
            };
            active.add(dispose);
            // Listeners contributed to agent.ctx already follow its lifetime. Also
            // release our bookkeeping and remove them if this plugin is reloaded.
            try {
                //#region mpd-delta adapter-subagent-runtime-agent-scope-effect (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
                scope.effect(() => dispose, 'agent-teams: child compatibility setup');
                //#endregion mpd-delta adapter-subagent-runtime-agent-scope-effect
            }
            catch (error) {
                dispose();
                throw error;
            }
        });
        return () => {
            stop();
            for (const dispose of [...active])
                dispose();
        };
    }, 'agent-teams: member lifecycle compatibility');
    return true;
}
/** Queue a distinct host-authored turn; never substitute model-message steer. */
export async function queueMemberPrompt(runtime, parent, childId, content, signal) {
    const source = TEAM_MESSAGE_SOURCE;
    // 0.1.5-rc.2+: the public continuable-delivery seam. `parent` is the exact
    // live direct parent Agent, so its session id is the durable address.
    if (typeof runtime.prompt === 'function') {
        const receipt = await runtime.prompt.call(runtime, {
            requestId: randomUUID(),
            parentSessionId: parent.id,
            childSessionId: childId,
            mode: 'continuable',
            delivery: 'queue',
            content,
        }, signal);
        return receipt?.messageId ?? receipt;
    }
    if (typeof runtime.followup === 'function') {
        return runtime.followup.call(runtime, parent, childId, content, { source, signal });
    }
    const queue = runtime[HOST_PROMPT_QUEUE];
    if (typeof queue !== 'function')
        throw unsupported('missing host FIFO delivery');
    return queue.call(runtime, parent, childId, content, source, signal);
}
/**
 * Guard every resumable delivery path, preserving the native service receiver.
 *
 * Retired members keep their transcript but must not be cold-resumed by a
 * later assignment or captain message.
 */
export function guardSubagentDelivery(ctx, isRetired) {
    //#region mpd-delta adapter-subagent-runtime-guard (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
    // D6/R2: same runtime RESOLUTION as the installer above — the retired-member guard keeps
    // PATCHING that object (the adapter owns the resolution only).
    const runtime = subagentRuntimeOf(ctx);
    //#endregion mpd-delta adapter-subagent-runtime-guard
    const legacy = runtime.followup;
    const prompt = runtime.prompt;
    const queue = runtime[HOST_PROMPT_QUEUE];
    const send = runtime.sendMessage;
    if (typeof legacy !== 'function' && typeof prompt !== 'function'
        && (typeof queue !== 'function' || typeof send !== 'function')) {
        ctx.logger?.warn?.(unsupported('cannot install complete retired-member guard').message);
        return false;
    }
    ctx.effect(() => {
        const descriptors = new Map([
            ['followup', Object.getOwnPropertyDescriptor(runtime, 'followup')],
            ['prompt', Object.getOwnPropertyDescriptor(runtime, 'prompt')],
            [HOST_PROMPT_QUEUE, Object.getOwnPropertyDescriptor(runtime, HOST_PROMPT_QUEUE)],
            ['sendMessage', Object.getOwnPropertyDescriptor(runtime, 'sendMessage')],
        ]);
        let active = true;
        const check = async (sender, targetId) => {
            if (active && await isRetired(sender, targetId)) {
                throw new SubagentError(`AgentTeams member "${targetId}" was retired and cannot be resumed`, 'NOT_RESUMABLE');
            }
        };
        const guardedLegacy = async (parent, childId, content, options) => {
            await check(parent, childId);
            return legacy.call(runtime, parent, childId, content, options);
        };
        // The public prompt seam carries session ids, not the sender Agent, so
        // resolve the live parent through the agents registry for the same check.
        const guardedPrompt = async (request, signal) => {
            //#region mpd-delta adapter-subagent-runtime-agents-lookup (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
            // The service-lookup spelling disappears: the bridge resolves the live sender through the
            // adapter-routed `agents.get` in production and through today's `get('agents')` expression
            // for a plain-object ctx (which is what every pre-existing unit test hands this guard).
            const sender = liveAgentOf(ctx, request?.parentSessionId);
            //#endregion mpd-delta adapter-subagent-runtime-agents-lookup
            if (sender !== undefined) await check(sender, request.childSessionId);
            return prompt.call(runtime, request, signal);
        };
        const guardedQueue = async (parent, childId, content, source, signal) => {
            await check(parent, childId);
            return queue.call(runtime, parent, childId, content, source, signal);
        };
        const guardedSend = async (sender, targetId, content, options) => {
            await check(sender, targetId);
            return send.call(runtime, sender, targetId, content, options);
        };
        if (typeof legacy === 'function')
            runtime.followup = guardedLegacy;
        if (typeof prompt === 'function')
            runtime.prompt = guardedPrompt;
        if (typeof queue === 'function')
            runtime[HOST_PROMPT_QUEUE] = guardedQueue;
        if (typeof send === 'function')
            runtime.sendMessage = guardedSend;
        // Cordis wraps method reads in fresh Proxies. Compare the actual own
        // descriptor to restore only our contribution, including prototype methods.
        const restore = (key, installed) => {
            if (Object.getOwnPropertyDescriptor(runtime, key)?.value !== installed)
                return;
            const original = descriptors.get(key);
            if (original === undefined)
                Reflect.deleteProperty(runtime, key);
            else
                Object.defineProperty(runtime, key, original);
        };
        return () => {
            active = false;
            if (typeof legacy === 'function')
                restore('followup', guardedLegacy);
            if (typeof prompt === 'function')
                restore('prompt', guardedPrompt);
            if (typeof queue === 'function')
                restore(HOST_PROMPT_QUEUE, guardedQueue);
            if (typeof send === 'function')
                restore('sendMessage', guardedSend);
        };
    }, 'agent-teams: retired member guard');
    return true;
}
