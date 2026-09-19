// mpd-owned bridge module — the adopted agent-teams plugin's ONE route to a DeepSeek Harness seam (LOCAL ADAPTATION; see agent-references/agent-teams-deltas.md).
//#region mpd-delta adapter-ctx-bridge (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
/**
 * The adapter-backed plugin context for the adopted agent-teams plugin.
 *
 * WHY (AGENTS.md §6): `packages/mpd-agent-teams-plugin/lib` is adopted upstream main code that used
 * to reach every harness seam on its own `ctx` (`ctx.tools.register`, `ctx.agents`, `ctx.subagents`,
 * `ctx.commands`, `ctx.systemPrompt`, `ctx.llm`, `ctx.on`, `agent.ctx.*`, `agent.followup`,
 * `agent.cancel`). That was the ONE documented exception to the adapter rule — a harness release
 * that reshapes a seam would have to be absorbed across the whole adopted tree instead of in
 * `packages/mpd-dsh-adapter-plugin`. This module closes it: the composition root builds ONE facade
 * per plugin instance and hands it to every consumer, so each adopted file keeps calling `ctx.<seam>`
 * while the bridge routes the call through the mounted `mpdDsh` adapter.
 *
 * Resolution (D2 / T-50, mirroring `createLazyDshAdapter` in the adapter row, but WITHOUT ever
 * building a private adapter — that fallback stays inside the adapter row itself):
 *   - probe `resolveCtx.get('mpdDsh', true)` per access; on a hit cache the adapter and never
 *     re-probe; a miss is NEVER cached and is re-probed on every access;
 *   - a strict miss + a non-strict hit is the PENDING window (the service is registered but its
 *     fiber is not ACTIVE yet — the loader applies sibling rows concurrently);
 *   - a strict + non-strict miss is ABSENT: the facade then serves the raw cordis ctx, which is
 *     exactly today's behaviour, plus one greppable witness line telling the operator that the
 *     adapter row must sit ABOVE the agent-teams row.
 *
 * Witness lines are emitted ONCE per mode per plugin instance (per `resolveCtx`, shared by the
 * scoped facades `inject` derives) through the CONSOLE: a headless boot has no logger sink, and the
 * sibling rows (`mpd-dsh-adapter`, `mpd-ext`, `mpd-roles`, …) report their own adapter identity the
 * same way, which is what makes these lines greppable in a boot log — and therefore falsifiable.
 *
 * Parity (contract §4): with the adapter absent every property executes TODAY'S EXACT expression
 * (same receiver, same throw). The only tolerated difference is where the adapter's own never-crash
 * contract already is more tolerant than the raw service (`liveAgent`/`liveAgents`/`onEvent`).
 *
 * Two contract REVISIONS are implemented here on purpose, both recorded because they change the
 * pre-revision behaviour:
 *   - F1: `agentScopeOf` (and the facade's `agentScope`) ALWAYS return ONE shape
 *     `{ context, tools, on, effect }` in EVERY arm — the raw-ctx arm BUILDS that shape instead of
 *     returning the raw ctx, whose `.context` read is `undefined` (the measured defect: the member
 *     setup then parked on its failure listener). `context` keeps the raw ctx's IDENTITY.
 *   - F2: `steerAgentTurn` / `injectAgentMessage` expose the Agent's `steer`/`inject` seams, gated on
 *     `capabilities().agentTurnSteer` / `.agentTurnInject` (throwing verbatim forwarders, D9 rule).
 * Every adapter seam is resolved through ONE presence+capability gate (`seam(name, flag)`): a missing
 * method OR a flag the adapter reports as `false` serves the raw lane, so an older/partial adapter
 * degrades per seam instead of taking the boot down.
 * @module dsh-agent-teams/mpd-adapter-ctx
 */

/** The service name the mounted adapter is resolved by (`mpd-dsh-adapter` exports it as SERVICE_NAME). */
const MPD_DSH_SERVICE = 'mpdDsh';

/** The three resolution outcomes, as the frozen witness strings (one line per mode per plugin instance). */
export const ADAPTER_WITNESS = {
    mounted: '[agent-teams] adapter: mpdDsh mounted — harness seams routed through mpd-dsh-adapter',
    pending: '[agent-teams] adapter: mpdDsh pending (provider not ACTIVE) — serving the raw cordis ctx for now and re-probing on every access',
    absent: '[agent-teams] adapter: mpdDsh ABSENT — serving the raw cordis ctx (warn once); mpd-dsh-adapter must sit ABOVE the agent-teams row',
    /**
     * BR-1: a member the raw agent ctx cannot provide is handed a NO-OP. NOT a fourth resolution
     * mode — it rides the same sink under the same once-per-instance discipline — but it IS a
     * privilege event: a member that cannot be tool-restricted loses its restriction.
     */
    substituted: '[agent-teams] adapter: per-agent scope substituted a NO-OP for a member the agent ctx cannot provide — a member that cannot be tool-restricted is a MEMBER PRIVILEGE LOSS, not a cosmetic degrade',
};

/**
 * The BR-1 witness line: the substituted member NAMES plus the privilege-loss consequence. The
 * tolerance stays (never a throw — the plugin's doctrine is degrade-with-a-warning), but a silent
 * member-privilege loss is exactly the class this bridge refuses to leave anonymous.
 */
export function adapterSubstitutionWitness(members) {
    return `${ADAPTER_WITNESS.substituted} [substituted: ${members.join(', ')}]`;
}

/**
 * Resolution + witness state per root context, so the scoped facade `inject` derives (frozen
 * wrapping: `createAgentTeamsCtx(scoped, { resolveCtx })`) reports the SAME single witness line
 * instead of repeating it for every scoped ctx the plugin ever injects.
 */
const WITNESS_STATE = new WeakMap();

/** One witness line, emitted on the console by default (a boot log captures it; a logger level does not). */
function defaultWitness(line, level) {
    try {
        (level === 'warn' ? console.warn : console.log)(line);
    }
    catch {
        // A log sink must never take the plugin down (same rule as the adapter's own warning).
    }
}

/**
 * One contained service probe. `strict: true` asks cordis for an ACTIVE provider only; `strict:
 * false` sees the registration regardless of fiber state, which is what distinguishes PENDING from
 * ABSENT. A ctx that cannot answer (a scoped proxy, an inject-filtered ctx, a test double) is a
 * miss, never a crash.
 */
function probeMpdDsh(resolveCtx, strict) {
    const get = resolveCtx?.get;
    if (typeof get !== 'function')
        return undefined;
    try {
        const value = get.call(resolveCtx, MPD_DSH_SERVICE, strict);
        return value === undefined || value === null ? undefined : value;
    }
    catch {
        return undefined;
    }
}

/**
 * The adapter's OWN capability report, snapshotted once per adapter object.
 *
 * `capabilities()` is the adapter's published degrade signal (one boolean per seam); it is read at
 * most once per mounted adapter because the adapter itself is cached on a successful probe. An
 * adapter without `capabilities()` — or one whose report throws — yields `undefined`, and then the
 * method's presence alone decides (never a crash, never a boot abort).
 */
const CAPABILITY_SNAPSHOT = new WeakMap();
function capabilitiesOf(dsh) {
    const keyable = dsh !== null && (typeof dsh === 'object' || typeof dsh === 'function');
    if (!keyable)
        return undefined;
    if (CAPABILITY_SNAPSHOT.has(dsh))
        return CAPABILITY_SNAPSHOT.get(dsh);
    let snapshot;
    try {
        snapshot = typeof dsh.capabilities === 'function' ? dsh.capabilities() : undefined;
    }
    catch {
        snapshot = undefined;
    }
    CAPABILITY_SNAPSHOT.set(dsh, snapshot);
    return snapshot;
}

/**
 * One adapter method, bound to the adapter object, or `undefined` when this adapter cannot serve it
 * (no such method, or its capability flag is reported `false`).
 */
function seamMethod(dsh, name, flag) {
    if (dsh === undefined || typeof dsh[name] !== 'function')
        return undefined;
    if (flag !== undefined) {
        const capabilities = capabilitiesOf(dsh);
        if (capabilities !== null && typeof capabilities === 'object' && capabilities[flag] === false)
            return undefined;
    }
    const method = dsh[name];
    return (...args) => method.call(dsh, ...args);
}

/** A disposer that does nothing: the per-member degrade of the uniform scope shape (F1). */
const DISPOSE_NOTHING = () => { };

/** Read one member of a ctx without letting a hostile/proxy ctx throw (F1: per-member independence). */
function readScopeMember(scoped, name) {
    try {
        return scoped?.[name];
    }
    catch {
        return undefined;
    }
}

/**
 * The ONE scope shape every arm returns (contract §4, F1): `{ context, tools, on, effect }`.
 *
 * `context` keeps the raw ctx's IDENTITY (so `setup(scope.context, agent)` is byte-for-byte today's
 * `setup(agent.ctx, agent)`), and each of the other three members is resolved INDEPENDENTLY — a
 * missing (or throwing) member degrades to a no-op for THAT member only, never discarding the rest.
 * The pre-F1 formula returned the raw ctx itself here, which is exactly the measured defect: reading
 * `scope.context` yielded `undefined` and `installContinuableMemberSetup` parked the member on its
 * failure listener, silently disabling member model selection.
 */
function scopeShapeFrom(scoped, report) {
    const tools = readScopeMember(scoped, 'tools');
    const on = readScopeMember(scoped, 'on');
    const effect = readScopeMember(scoped, 'effect');
    const usableTools = tools !== null && typeof tools === 'object' && typeof tools.restrict === 'function';
    // BR-1: NAME every member handed a no-op instead of leaving the degrade anonymous.
    // `tools.restrict` is the security-relevant one — a member that cannot be tool-restricted loses
    // its restriction — while `context` names the degenerate case where the identity itself is gone.
    const substituted = [];
    if (scoped === undefined || scoped === null)
        substituted.push('context');
    if (!usableTools)
        substituted.push('tools.restrict');
    if (typeof on !== 'function')
        substituted.push('on');
    if (typeof effect !== 'function')
        substituted.push('effect');
    if (substituted.length > 0 && typeof report === 'function')
        report(substituted, scoped);
    return {
        context: scoped,
        tools: usableTools
            ? tools
            : { restrict: () => DISPOSE_NOTHING },
        on: (...args) => (typeof on === 'function' ? on.apply(scoped, args) : DISPOSE_NOTHING),
        effect: (...args) => (typeof effect === 'function' ? effect.apply(scoped, args) : DISPOSE_NOTHING),
    };
}

/**
 * Whether a scope an ADAPTER returned can be used as the shape: every member it promises must be
 * present and callable, and `context` must exist (without it the identity guarantee is lost). An
 * unusable result falls through to `scopeShapeFrom(agent?.ctx)` — the same per-member build.
 */
function isUsableScope(scope) {
    return scope !== null && typeof scope === 'object'
        && 'context' in scope
        && scope.tools !== null && typeof scope.tools === 'object' && typeof scope.tools.restrict === 'function'
        && typeof scope.on === 'function'
        && typeof scope.effect === 'function';
}

/** The shared resolution/witness state for one root context (a fresh record when it cannot be keyed). */
function resolutionState(resolveCtx) {
    const keyable = resolveCtx !== null && (typeof resolveCtx === 'object' || typeof resolveCtx === 'function');
    if (!keyable)
        return { mounted: undefined, notified: undefined, substituted: undefined };
    const existing = WITNESS_STATE.get(resolveCtx);
    if (existing !== undefined)
        return existing;
    const created = { mounted: undefined, notified: undefined, substituted: undefined };
    WITNESS_STATE.set(resolveCtx, created);
    return created;
}

/**
 * Build the facade the adopted agent-teams plugin drives instead of the raw cordis ctx.
 *
 * @param targetCtx - the raw plugin context every fallback expression is bound to.
 * @param options.resolveCtx - the ctx the adapter is probed on; defaults to `targetCtx`. The
 *   composition root passes the RAW plugin ctx so a scoped/proxy ctx can never fail the probe.
 * @param options.witness - optional `(line, level) => void` sink (tests); defaults to the console.
 * @returns the facade: exactly the properties the adopted tree reads, nothing else.
 */
export function createAgentTeamsCtx(targetCtx, options = {}) {
    const resolveCtx = options.resolveCtx ?? targetCtx;
    const sink = typeof options.witness === 'function' ? options.witness : defaultWitness;
    const state = resolutionState(resolveCtx);

    /** Report one resolution mode once (per plugin instance, not per access). */
    function witness(mode, level) {
        if (state.notified === mode)
            return;
        state.notified = mode;
        try {
            sink(ADAPTER_WITNESS[mode], level);
        }
        catch {
            // Never take a plugin down because a sink misbehaved.
        }
    }

    /**
     * BR-1: report the NO-OP substitution ONCE per plugin instance (the same discipline and the same
     * sink as the three mode witnesses). The tolerance stays — a missing seam degrades with a warning
     * instead of taking the tree down — but a member that cannot be tool-restricted loses its
     * restriction, so the substitution must never be silent.
     */
    function reportSubstitution(members) {
        if (state.substituted !== undefined)
            return;
        state.substituted = members.join(', ');
        try {
            sink(adapterSubstitutionWitness(members), 'warn');
        }
        catch {
            // A log sink must never take the plugin down (same rule as the mode witnesses).
        }
    }

    /** T-50 resolution: cache ONLY a success; re-probe every miss; a miss serves the fallback column. */
    function adapter() {
        if (state.mounted !== undefined)
            return state.mounted;
        const active = probeMpdDsh(resolveCtx, true);
        if (active !== undefined) {
            state.mounted = active;
            witness('mounted', 'info');
            return active;
        }
        if (probeMpdDsh(resolveCtx, false) !== undefined)
            witness('pending', 'warn');
        else
            witness('absent', 'warn');
        return undefined;
    }

    /** One adapter seam method for THIS access, or `undefined` when the raw ctx must serve it. */
    function seam(name, flag) {
        return seamMethod(adapter(), name, flag);
    }

    return {
        tools: {
            register: (definition) => {
                const register = seam('registerHostTool', 'toolsRegisterHost');
                // VERBATIM passthrough: `defineTool(...)` output is already harness-shaped, and
                // `registerTool` would rebuild it (dropping presentCall/presentResult/… and
                // replacing execute), so the SAME object reference must reach `tools.register`.
                return register === undefined ? targetCtx.tools.register(definition) : register(definition);
            },
        },
        agents: {
            get: (agentId) => {
                const liveAgent = seam('liveAgent');
                return liveAgent === undefined ? targetCtx.agents.get(agentId) : liveAgent(agentId);
            },
            list: () => {
                const liveAgents = seam('liveAgents');
                return liveAgents === undefined ? targetCtx.agents.list() : liveAgents();
            },
        },
        subagents: {
            getProvider: (name) => {
                const provider = seam('subagentProvider', 'subagentsProvider');
                return provider === undefined ? targetCtx.subagents.getProvider(name) : provider(name);
            },
            list: () => {
                const providers = seam('subagentProviders', 'subagentsProvider');
                return providers === undefined ? targetCtx.subagents.list() : providers();
            },
            startContinuable: (spec) => {
                const start = seam('startContinuableAgent', 'subagentsContinuable');
                // A member that cannot be spawned must be LOUD: the raw expression throws
                // synchronously and the adapter's forwarder preserves both the throw and the
                // service's own promise rejections.
                return start === undefined ? targetCtx.subagents.startContinuable(spec) : start(spec);
            },
            interrupt: (targetSessionId, authority) => {
                const interrupt = seam('interruptAgent', 'subagentsInterrupt');
                return interrupt === undefined
                    ? targetCtx.subagents.interrupt(targetSessionId, authority)
                    : interrupt(targetSessionId, authority);
            },
            runtime: () => {
                // Gated on the adapter's own `subagents` flag (its exact spelling of "the service
                // exists"): every one of the fourteen mediated methods sits behind a capability
                // flag, and a `false` here is equivalent to the service being absent.
                const runtime = seam('subagentRuntime', 'subagents');
                // The Harness-generation ladder (`prompt`/`followup`/`[HOST_PROMPT_QUEUE]`/
                // `sendMessage`) reads and patches THIS object, so it must be the runtime
                // itself — identity-preserving, never a projection of the facade.
                return runtime === undefined ? targetCtx.subagents : runtime();
            },
        },
        commands: {
            register: (definition) => {
                const register = seam('registerCommand', 'commandsRegister');
                return register === undefined ? targetCtx.commands.register(definition) : register(definition);
            },
        },
        systemPrompt: {
            section: (section) => {
                const registerSection = seam('registerPromptSection', 'systemPromptSection');
                // THROW-shaped on purpose: the plugin's usage section is mandatory, so a
                // composition that cannot register it must be loud rather than silently mute.
                return registerSection === undefined ? targetCtx.systemPrompt.section(section) : registerSection(section);
            },
        },
        llm: {
            listModels: (provider) => {
                const listModels = seam('llmListModels', 'llmListModels');
                return listModels === undefined ? targetCtx.llm.listModels(provider) : listModels(provider);
            },
            resolveCallConfig: (config, signal) => {
                const resolveCallConfig = seam('llmResolveCallConfig', 'llmResolveCallConfig');
                return resolveCallConfig === undefined
                    ? targetCtx.llm.resolveCallConfig(config, signal)
                    : resolveCallConfig(config, signal);
            },
        },
        agentScope: (agent) => {
            const scope = seam('agentScope', 'agentScope');
            if (scope !== undefined) {
                const provided = scope(agent);
                // The adapter's own shape when it is usable; otherwise the SAME per-member build the
                // fallback arm uses — no arm returns a raw cordis ctx in place of the shape (F1).
                if (isUsableScope(provided))
                    return provided;
            }
            return scopeShapeFrom(agent?.ctx, reportSubstitution);
        },
        startAgentTurn: (agent, message) => {
            const start = seam('startAgentTurn', 'agentTurnStart');
            // Fallback = today's EXACT expression, RETURNED verbatim: the throw inside the caller's
            // own try/catch (contract D9) and the expression's own value travel unchanged.
            if (start === undefined)
                return agent.followup(message);
            return start(agent, message);
        },
        cancelAgentTurn: (agent, cause, cancelOptions) => {
            const cancel = seam('cancelAgentTurn', 'agentTurnCancel');
            if (cancel === undefined)
                return agent.cancel(cause, cancelOptions);
            return cancel(agent, cause, cancelOptions);
        },
        steerAgentTurn: (agent, message) => {
            const steer = seam('steerAgentTurn', 'agentTurnSteer');
            // Fallback = today's EXACT expression, returned verbatim; the throw inside the caller's
            // own try/catch (F2 requires the throw preserved) travels unchanged.
            if (steer === undefined)
                return agent.steer(message);
            return steer(agent, message);
        },
        injectAgentMessage: (agent, message) => {
            const inject = seam('injectAgentMessage', 'agentTurnInject');
            // NOTE the two `inject` spellings: this is the AGENT's `inject(message)`, not the cordis
            // `ctx.inject(deps, callback)` seam (which the facade passes through untouched below).
            if (inject === undefined)
                return agent.inject(message);
            return inject(agent, message);
        },
        on: (event, handler, ...listenerOptions) => {
            const onEvent = seam('onEvent');
            // The facade ALWAYS returns a disposer: callers store it and call it on teardown,
            // while a non-callable answer (or a stub service) must not become a TypeError later.
            // The FALLBACK forwards every listener option — `installInterjectionExpirySweep`
            // registers with `{ global: true, prepend: true }`, and dropping them would silently
            // change which events this plugin hears.
            if (onEvent === undefined) {
                const dispose = targetCtx.on(event, handler, ...listenerOptions);
                // A cordis `on` answers the effect disposer; a stub service may answer anything, and
                // callers store the result and call it on teardown (frozen §4: "always a function").
                return typeof dispose === 'function' ? dispose : () => { };
            }
            // The adapter owns the subscription's identity (residual R1): its frozen `onEvent`
            // signature takes the event and the handler only.
            return onEvent(event, handler) ?? (() => { });
        },
        effect: (callback, label) => targetCtx.effect(callback, label),
        get: (name, strict) => targetCtx.get(name, strict),
        inject: (deps, callback) => targetCtx.inject(deps, (scoped) => callback(createAgentTeamsCtx(scoped, { resolveCtx }))),
        logger: targetCtx.logger,
    };
}

/**
 * The per-agent scope of one Agent — ALWAYS the ONE shape `{ context, tools, on, effect }`.
 *
 * MOUNTED arm: the facade's `agentScope(agent)` result when it is usable (the adapter's own shape).
 * FALLBACK arm (no facade in the chain, adapter absent/pending, or an unusable adapter result): the
 * shape is BUILT from the raw `agent.ctx` by `scopeShapeFrom`, per member, with `context` keeping that
 * ctx's identity — so `setup(scope.context, agent)` is byte-for-byte today's `setup(agent.ctx, agent)`.
 *
 * With a plain-object test ctx the shape is assembled from the SAME `agent.ctx` members, which is why
 * every existing plain-object-ctx test stays green with zero edits.
 *
 * @param ctx - the facade (or the raw ctx outside the composition root).
 * @param agent - the live Agent handle.
 */
/**
 * BR-1: the report gate for the RAW-ctx lane. `createAgentTeamsCtx` gates on its per-instance
 * `state`; this lane (`agentScopeOf` outside the composition root, where there is no facade carrying
 * a sink) has no instance at hand, so the gate is the ctx that cannot provide the members — one
 * report per ctx, plus one for the degenerate unkeyable case. Never on the happy path: a ctx exposing
 * all four members reports nothing.
 */
const REPORTED_SUBSTITUTIONS = new WeakSet();
let reportedUnkeyableSubstitution = false;

function reportRawSubstitution(members, scoped) {
    const keyable = scoped !== null && (typeof scoped === 'object' || typeof scoped === 'function');
    if (keyable) {
        if (REPORTED_SUBSTITUTIONS.has(scoped))
            return;
        REPORTED_SUBSTITUTIONS.add(scoped);
    }
    else {
        if (reportedUnkeyableSubstitution)
            return;
        reportedUnkeyableSubstitution = true;
    }
    defaultWitness(adapterSubstitutionWitness(members), 'warn');
}

export function agentScopeOf(ctx, agent) {
    const provided = typeof ctx?.agentScope === 'function' ? ctx.agentScope(agent) : undefined;
    return isUsableScope(provided) ? provided : scopeShapeFrom(agent?.ctx, reportRawSubstitution);
}

/**
 * The subagent delivery RUNTIME the Harness-generation ladder operates on (contract D6): the
 * adapter's `subagentRuntime()` through a facade, today's raw `ctx.subagents` otherwise.
 *
 * The adapter owns WHICH object the ladder operates on; the ladder's own policy (which generation's
 * method it reads, and the retired-member guard's patching) stays in the plugin (residual R2).
 *
 * @param ctx - the facade (or the raw ctx outside the composition root).
 */
export function subagentRuntimeOf(ctx) {
    const subagents = ctx?.subagents;
    return subagents !== undefined && typeof subagents.runtime === 'function' ? subagents.runtime() : subagents;
}

/**
 * One live Agent by id: the facade's routed `agents.get` (the mounted adapter's `liveAgent`) when the
 * ctx offers it, else today's service-lookup expression.
 *
 * WHY THE SECOND LANE EXISTS (measured, not speculative): the retired-member guard's sender lookup
 * used to be `ctx.get?.('agents')?.get(…)`, and every PRE-EXISTING unit test hands that guard a
 * plain-object ctx that carries the registry ONLY through `get('agents')` — replacing the expression
 * outright made the guard admit a resumed retired member (test
 * `harness-compat.test.ts: retired-member guard covers every resumable face`). Keeping the tolerant
 * lane HERE is what lets the production path be adapter-routed while the fallback stays byte-parity;
 * the alternative was a raw fallback expression inside an ADOPTED file, which the bridge exists to
 * prevent.
 *
 * @param ctx - the facade (or any ctx-shaped object).
 * @param agentId - the session id to resolve.
 */
export function liveAgentOf(ctx, agentId) {
    const agents = ctx?.agents;
    if (agents !== undefined && typeof agents.get === 'function')
        return agents.get(agentId);
    const lookup = ctx?.get?.('agents');
    return lookup === undefined ? undefined : lookup.get(agentId);
}
//#endregion mpd-delta adapter-ctx-bridge
// mpd-owned bridge module END — the two comment lines around the single region are the registry's skeleton context.
