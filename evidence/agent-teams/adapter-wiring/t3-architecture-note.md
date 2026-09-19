# t3 — Architecture note: semantics and risks of adapter-mediated seam access for the adopted agent-teams plugin

Task t3 (kind=work, round 1) · seat Architect (read-only) · wave w1 · team agent-teams-adapter-wiring.
Method: source reading only (no bash, no write/edit; this note is the task artifact). Every claim names a file + symbol;
no claim rests on a line number (T-55).

## 0. Measured state this note is anchored to

- Reviewed design: `evidence/agent-teams/adapter-wiring/requirements-contract.md` (D1–D12, §1–§11, AC1–AC16) as frozen by t1.
- Repo sources read: `packages/mpd-agent-teams-plugin/lib/{index,tools,members,capabilities,command,harness-compat,scheduler}.js`,
  `packages/mpd-dsh-adapter-plugin/src/index.ts`.
- Installed harness read: `/root/.nvm/versions/node/v24.16.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/{cordis,dsh-scope,dsh-tools,dsh-agent,dsh-agent-loop,dsh-subagent,dsh-commands,dsh-system-prompt,dsh-llm}/lib/**`.
- THE TREE MOVED DURING THIS REVIEW: `packages/mpd-dsh-adapter-plugin/src/index.ts` grew (1426 → 1833 lines as measured by two
  reads of the same path within this attempt) and now contains `registerHostTool`, `registerPromptSection`, `subagentRuntime`,
  `subagentProvider`, `subagentProviders`, `startContinuableAgent`, `interruptAgent`, `llmListModels`, `llmResolveCallConfig`,
  `agentScope` (+ the module-private `scopeOfAgentContext`), `startAgentTurn`, `cancelAgentTurn`. Findings F1–F3 are about the
  FROZEN CONTRACT; F4/F6 are checked against the code that has already landed (symbol-cited, therefore re-anchorable).

## 1. Q1 — Registration ownership: which ctx owns a tool registered through `dsh.registerHostTool`?

**Answer: the effect that unregisters the tool is owned by the ACCESSING ctx's fiber, so routing moves ownership from the
agent-teams row's fiber to the mpdDsh row's fiber. Visibility is NOT affected: the tool still lands in the single GLOBAL layer.**

Evidence, in call order:

1. `ToolRuntime.register` (dsh-tools) does exactly one thing: `return this.layers.effect(this.ctx, (layer) => layer.tools.insert(name, definition), { label: "tools.register()" })`.
   Nothing else is consulted — no per-caller registry, no scope computation.
2. `ScopedLayers.effect` (dsh-scope) computes `scopeOf(ctx)` and then `return ctx.effect(function* () { … }.bind(this), options.label)`.
   The tool's disposer is therefore created by `ctx.effect` ON THE ACCESSING CTX.
3. `this.ctx` inside a service method is the accessing ctx, not the constructing ctx: reading a method off `ctx.<service>`
   returns `createShadowMethod(ctx, fn, outer, shadow)` where `shadow = createShadow(ctx, …) = ctx.extend({ [symbols.shadow]: origin })`
   (cordis `createTraceable` / `createShadowMethod` / `createShadow`, `Service` constructor's `tracker.property = "ctx"`).
4. `ctx.effect` is the `fiber` mixin accessor (`RedlectService.constructor` → `mixin("fiber", ["runtime", "effect"])`); its receiver resolves
   `this.fiber` through the prototype chain, so the effect is collected on the nearest enclosing fiber: for `apply(ctx)`'s row ctx that is the
   ROW's fiber, for the adapter row's ctx it is the ADAPTER ROW's fiber (`Fiber.effect` → `this._disposables.push(wrapper)`).

Consequence for each sub-question:

- **Disposal / HMR**: today the 21 registrations die with the agent-teams row; routed, they die with the mpdDsh row. The plugin DROPS all 21
  returned disposers (`ctx.tools.register(defineTool({…}))` in statement position, `registerAgentTeamsTools` in `tools.js`), so nothing in this
  product observes the difference at runtime today. T-21 (no plugin-module hot reload) makes it unobservable in practice.
- **The one measurable edge**: `ToolLayer.tools` is a `NamedEntries` whose duplicate error is `tool "<name>" is already registered (… for a
  per-agent variant, register through that agent's agent.ctx instead)`. With row-owned registrations a re-apply of the agent-teams row after
  its own disposal re-registers cleanly; with adapter-owned registrations the same re-apply would THROW on the first tool. This is the only
  behavioural delta ownership buys, and it is cheap to remove: the bridge can re-anchor the disposer with
  `targetCtx.effect(() => dsh.registerHostTool(def), 'agent-teams: tool registration')`.
- **Per-agent filtering still sees the tool — verified**: `ToolRuntime.view(scope)` / `restrictableNames` / the model-facing `wireSchemas` all
  derive from `ScopedLayers.merge(scope, pick)`, which starts from `this.global` and then appends scope-chain layers. `register` with an
  UNscoped accessing ctx (`scopeOf(ctx) === undefined` → `layer = this.global`) is exactly today's placement; the adapter row's ctx is also
  unscoped, so the placement is identical. Member restriction is applied by the HARNESS, not by the plugin: `applyChildComposition`
  (dsh-subagent) calls `childCtx.tools.restrict(composition.toolFilter)` from the spawn spec the plugin passes as
  `toolFilter: { deny: [...CAPTAIN_TOOL_NAMES, ...member.toolDeny] }` (`members.js` `spawnMember`). Nothing in that path reads the plugin's ctx.
- **Repo dependence on the CURRENT owner: none found.**
  - `packages/mpd-qa-roles-probe` prints `AGENT_TEAMS_TOOLS=n/N` by reading the GLOBAL view (`ctx.tools.get(name)`); global visibility is unchanged.
  - `skills/dsh-qa/scripts/agent-teams-messaging.mjs` drives the REAL tools through `toolsModule.registerAgentTeamsTools(ctx, …)` with its OWN
    test ctx; it never runs the composition root, so the facade is not on that path.
  - `packages/mpd-agent-teams-plugin/test/t52-root-registration.test.mjs` is the ONE existing test that calls `apply(ctx, …)`; it supplies a plain
    stub ctx (no `mpdDsh`) and derives a past-due interjection through the listeners the root registered. It constrains the FALLBACK arm (D2) to
    behave exactly like today; it says nothing about the owner.
  - `packages/mpd-agent-teams-plugin/self-fix-tests/tool-boundary-hold-and-contract-seat.test.mjs` calls `installTeamCapabilities(capCtx, …)`
    with a plain ctx and asserts the recorded `restrict` filter — it constrains the bridge's plain-ctx path.

## 2. Q2 — Agent identity: does `liveAgent()`/`liveAgents()` return the same object `ctx.agents.get/list` returns?

**Answer: yes, in both of the adapter's code paths, because the harness registry stores and returns the raw Agent.**

- `dsh.liveAgents()`/`liveAgent(id)` resolve the service through the adapter's own `service()` helper (`ctx.get(name)` first, property second).
  `ctx.get(name)` and `ctx.<name>` are equivalent in cordis: both `getTraceable(accessingCtx, impl.value)` (`ReflectService.get` and
  `ReflectService.handler.get`), so the adapter receives a traceable PROXY over the same service instance the plugin would have received.
- `AgentRegistry.get(id)` returns `this.store.get(id)?.agent` and `AgentRegistry.list()` returns `[...this.store.values()].map((entry) => entry.agent)`
  (dsh-agent). Both are identity-preserving and ctx-independent — the method body only touches `this.store`, so shadow-binding cannot change the result.
- The adapter's extra tolerances (`liveAgents()` filters nullish entries and swallows a throwing `list()`; `liveAgent()` falls back to a `list()` scan
  and `String()`s the id) can only ever REPLACE a miss with a hit. `members.js` `brandedSessionId(value) { return value; }` is an identity cast, so
  `String(sessionId)` is the same string; the same-id object returned by the fallback scan is the same stored Agent.
- Where the plugin relies on Agent identity (so a projection would break it):
  1. `capabilities.js` `installTeamCapabilities`: `states = new WeakMap()` keyed by the Agent — written by `attach(agent)` from
     `ctx.on('agent/session-start', ({ agent }) => attach(agent))` and from `ctx.agents.list()`, read at prompt-assembly time by
     `text: ({ agent }) => states.get(agent)?.member ? TEAM_MEMBER_PROMPT : captainPrompt`. All three sources are the same live object:
     `emitAgentEvent(loopCtx, agent, "agent/session-start", …)` injects the loop's own Agent into the payload
     (`dsh-agent/lib/types/dispatch.js` `agentEvents`: `fused = (payload) => ({ ...payload, agent })`), and assembly uses
     `assembleContextFor(agent, signal) = { agent, scope: agent }`. A projected/wrapped Agent here would silently downgrade every member to the
     CAPTAIN prompt and would attach the wrong (or no) tool restriction.
  2. `harness-compat.js` `installContinuableMemberSetup`: `installed = new WeakSet()` keyed by the session-start payload's Agent (add/has in the
     same listener) — self-consistent, but the `Dispose` path also passes that Agent to `setup(childCtx, agent)`.
  3. The harness itself re-checks identity on every governed call: `SubagentRuntime.interrupt` / `sendMessage` / the continuation manager all throw
     `UNAUTHORIZED` on `this.ctx.agents.get(x.id) !== x` (dsh-subagent). Passing the plugin a projection would turn every member delivery into an
     UNAUTHORIZED error. So identity is not merely internal to the plugin — it is the harness's authorization model.
- Non-identity comparisons (for completeness, they are safe either way): `members.js` compares `payload.agent.id !== child.id`; `scheduler.js`
  `liveCaptain(ctx, captainSessionId, supplied)` compares `supplied.id === captainSessionId` and `parkedAttempts` is keyed by `agent.id` (string).

## 3. Q3 — Per-agent scoped ctx: what does `agent.ctx.tools.restrict` accept/return, and can an adapter-owned helper reproduce it?

**Accepted shape** (`ToolRuntime.restrict(filter)` in dsh-tools): `filter = { allow?: readonly string[]; deny?: readonly string[] }` — an empty
filter throws (`tools.restrict({}) is a no-op`), a name that is not a KNOWN global tool throws (`unknown global tool`), the reserved PTC name
`run_code` throws, and a non-scoped ctx throws (`tools.restrict() requires a scoped context (agent.ctx)` — the check is `scopeOf(this.ctx)`).
**Returns** the `ScopedLayers.effect` disposer, i.e. the exact `ctx.effect` disposer that lifts the restriction.

Recipe the helper MUST follow (measured; a deviation changes semantics):

1. `this.ctx` inside `restrict` is the accessing ctx. Through `agent.ctx.tools.restrict(…)` it resolves to
   `agent.ctx.extend({ [symbols.shadow]: toolsServiceCtx })`, so `scopeOf(this.ctx)` is the AGENT scope key and
   `ctx.effect` (→ the agent scope fiber) owns the disposer. Restriction and its lifetime are therefore per-agent, not global.
2. The receiver must be the CAPTURED `ctx.tools` proxy, not the raw ctx: the shadow wrapper only rebinds when `thisArg === outer`
   (`createShadowMethod`). `restrict.call(context, filter)` with `context = agent.ctx` would run `restrict` with `this = agent.ctx`
   (no `layers`) and throw. The landed implementation is correct here: `scopeOfAgentContext` returns
   `tools: { restrict: (filter) => restrict.call(tools, filter) }` with `tools = context.tools` captured at probe time.
3. `agent.ctx.on(event, handler)` is the `events` mixin accessor bound to the accessing ctx: `EventsService.register` stores
   `{ ctx: this.ctx, callback, …options }` and creates the disposer with `this.ctx.fiber.effect(…)`. So a listener registered on `agent.ctx` is
   (a) tagged with the AGENT scope and (b) owned by the agent scope fiber. `EventsService.dispatch` admits a listener when
   `hook.global || !filter || filter.call(thisArg, hook.ctx)` where the filter is the dispatch subject (`scopeTarget(agent, agent)` for agent
   events): an UNSCOPED `hook.ctx` is always admitted (`if (tag === void 0) return true`).
   **This is the sharp edge of D5**: if `harness-compat.js`'s failure listener were routed through the facade's `on` (the adapter row's ctx,
   unscoped) instead of through `agentScope(agent).on`, the listener `() => { throw failure }` would be admitted for EVERY agent's
   `agent/request` waterfall, turning one member's setup failure into another member's request rejection. The contract's D5/§5 choice
   (`agentScopeOf(ctx, agent)` for that site) is the correct one and must stay.
   The landed `scopeOfAgentContext` reproduces this: `on: (event, handler) => on.call(context, event, handler)` with `on = context.on` — the
   accessor is already bound to `context` (`value.bind(withProps(receiver, service))`), and `Function.prototype.call` on a bound function cannot
   re-bind it, so the registration lands on the agent ctx exactly as today. Same reasoning for `effect: (fn, label) =>
   effect.call(context, fn, label)` (the `fiber` mixin), whose disposer lands in the agent scope fiber's `_disposables`.

## 4. Q4 — The delivery ladder: what must the adapter expose for byte-identical decisions?

**Answer: a thin accessor to the LIVE runtime object is enough — and a curated wrapper is not.** The ladder's decisions stay in the plugin (D6),
and they are all PROBES of the object plus one call:

- `harness-compat.js` `installContinuableMemberSetup`: `typeof runtime.registerContinuableSetup === 'function'` (legacy Alpha.2), else
  `typeof runtime.prompt === 'function' || typeof runtime[HOST_PROMPT_QUEUE] === 'function'` AND `typeof runtime.sendMessage === 'function'`.
- `harness-compat.js` `queueMemberPrompt`: `typeof runtime.prompt === 'function'` → `runtime.prompt.call(runtime, {requestId, parentSessionId,
  childSessionId, mode:'continuable', delivery:'queue', content}, signal)`; else `runtime.followup(parent, …)`; else the symbol queue.
- `harness-compat.js` `guardSubagentDelivery`: snapshots `Object.getOwnPropertyDescriptor(runtime, key)` for `followup` / `prompt` /
  `HOST_PROMPT_QUEUE` / `sendMessage`, then ASSIGNS the guarded functions onto the object and restores by descriptor comparison.
- Measured against the installed harness: `registerContinuableSetup` is ABSENT (the modern path is live); `SubagentRuntime` exposes
  `prompt(request, signal)`, `sendMessage(sender, targetId, content, options)`, `startContinuable(spec)`, `interrupt(targetSessionId, authority)`,
  `getProvider(name)`, `list()` (dsh-subagent, the service class whose constructor is `super(ctx, "subagents")`).

Why the object must be the live service (a proxy over it is fine, a projection is not):

1. Symbol-keyed reads/writes bypass shadowing (`createTraceable`'s handler forwards `typeof prop === "symbol"` straight to the target), so
   `HOST_PROMPT_QUEUE` handling is target-accurate for any proxy over the service.
2. The guard's patch must reach the SHARED object: any other delivery path (e.g. the host's own `subagent.prompt`) must observe it. A wrapper
   object with its own `prompt`/`sendMessage` properties would make the retired-member guard effective only for deliveries the plugin makes
   itself — a real regression in coverage, invisible to a plugin-only test.
3. `SubagentRuntime.prompt` resolves `this.ctx.get("agents")?.get(parentSessionId)` and the continuation manager re-checks
   `this.ctx.agents.get(parent.id) !== parent` — both are scope-independent at the host plane, so a proxy obtained through the mpdDsh row's ctx
   behaves identically to one obtained through the agent-teams row's ctx (only effect ownership and logger attribution move).
4. `startContinuable`/`interrupt` as new adapter forwarders are safe: the plugin's spec/authority objects are passed verbatim, the promise is
   forwarded untouched (`startContinuableAgent` returns `subagents.startContinuable.call(subagents, spec)`), and the harness's own error codes
   (`DUPLICATE_CHILD`, `UNAUTHORIZED`, `NOT_RESUMABLE`) survive.

## 5. Q5 — Facade mechanics: is a facade over ctx sound for this plugin?

**Answer: yes, with three measured requirements, and the current design meets them.**

1. **The property set must be complete for this plugin.** Every `ctx.<prop>` access in the ten server files resolves to:
   `on`, `effect`, `get`, `logger`, `inject`, `tools`, `agents`, `subagents`, `commands`, `systemPrompt`, `llm` — no `ctx.emit` / `ctx.waterfall` /
   `ctx.parallel` / `ctx.serial` / `ctx.once` / `ctx.provide` / `ctx.plugin` / `ctx.runtime` / `ctx.fiber` / `Object.keys(ctx)` / `in ctx` anywhere.
   The contract's §4 property table covers that set plus the new `agentScope`/`startAgentTurn`/`cancelAgentTurn` verbs.
2. **Receiver binding is the whole game.** `on`, `effect`, `get` and `logger` must stay bound to `targetCtx`: the plugin's teardown effects
   (`capabilities.js`'s `mounted = false` + `state.dispose()` sweep, `harness-compat.js`'s guard restore, `command.js`'s command unregister,
   `index.js`'s web-route/interval effects) must die with the agent-teams row, not with the adapter row. The contract's pass-through column does this.
   `ctx.get(name, strict)` must forward the SECOND argument: `scheduler.js` uses the inject-free `ctx.get(WATCHDOG_HOLD_SERVICE, false)` form.
3. **`inject` must wrap the callback, not replace it.** The only injection site is `ctx.inject(['commands'], (commandCtx) =>
   registerAgentTeamsCommand(commandCtx, …))` (`index.js` `apply`); the wrapped callback receives a facade over the SCOPED ctx, and the command
   registration itself must still resolve `commands` from that scoped ctx.
4. **`this`-graph and enumeration hazards: none present.** The only objects that get `this`-sensitive treatment are the service objects (proxies)
   the facade hands out, and those are consumed as receiver-bound calls (`ctx.agents.get(id)`, `ctx.llm.listModels(p)`, `ctx.tools.register(def)`,
   `agent.ctx.tools.restrict(f)`). Nothing destructures the ctx, spreads it, or uses `instanceof Context`. `ctx` is captured in closures
   (`explicitOpts = () => ({ ctx, config: resolved })`, the web-route handlers, `haltTeamWork({ ctx, … })`) — all of them after the parameter
   rebinding, so they see the facade, which is the point of D1.
5. **A Proxy is not required**; a plain object with the frozen 15 properties is simpler and makes the absent-adapter column (`targetCtx.tools.register`)
   explicit. The adapter's own `createLazyDshAdapter` is a Proxy because its target is unknown at build time; the bridge's target is known.

## 6. Q6 — systemPrompt / llm / commands: accepted shapes vs the adapter's current normalization

**`ctx.systemPrompt.section(section)`** (dsh-system-prompt `SystemPrompt.section`): accepts `{ name, order, text }` where `order` MUST be a finite
number (`throw new TypeError('prompt section "…" order must be a finite number')`), `text` is a string or a provider re-evaluated per assembly, and
the name is unique within its layer (`PromptLayer.sections`, a `NamedEntries`, throws on a duplicate). `capabilities.js` passes exactly
`{ name: 'agent-teams:usage', order: config.order ?? 117, text: ({ agent }) => … }`. The provider's argument is the assembly context built by
`assembleContextFor(agent, signal) = { agent, scope: agent, …signal }`, so the `({ agent })` destructure is correct. The adapter's
`registerPromptSection` forwards the section object VERBATIM (`systemPrompt.section(section)`) and only degrades a non-callable return to a no-op —
**nothing is lost or rewritten**; `DshPromptSection` also carries an open index signature so any extra host field stays forwardable.
**Landed detail worth keeping:** the section is registered on the ADAPTER row's ctx. Both rows are host-plane/unscoped, so the registration lands in
`ScopedLayers.global` exactly as today; the only delta is again effect ownership (section lifetime). If an adapter instance were ever mounted under
an agent-scoped ctx, the section would land in that scope's layer instead — worth a one-line invariant comment on the adapter method.

**`ctx.llm.listModels(provider)`** (dsh-llm `LlmRuntime.listModels`): returns a detached `Array<{provider, id, name, description?, inputModalities?}>`,
throwing `LlmError('… INVALID_CATALOG')` on malformed metadata. `members.js` `validateMemberLlmSelections` consumes `catalog.length` and
`catalog.some((model) => model.id === selection.model)`.
**`ctx.llm.resolveCallConfig(config, signal)`** (dsh-llm `resolveCallConfig` → `resolveCallFor` → `resolveCallWithInfo`): accepts
`{provider, model, reasoningEffort?, maxTokens?, …}` and returns a config that may be the SAME object ("detached config only when a default must be
materialized"), throwing on `UNSUPPORTED_REASONING_EFFORT`. `members.js` consumes `.provider`, `.model`, `.reasoningEffort`.
**Do NOT reuse `llmCatalog()` for these.** It is a different, lossy projection: `{providers: [{id, label, models: [{id, …}]}], degraded}`, it
resolves `listProviders` + `listModels` + `resolveModelInfo` per model, it SKIPS unresolvable providers/models and marks the whole read `degraded`,
and it has no config-resolution call at all (`DshLlmCatalog` cannot carry a resolved call config). The landed implementation is correct: two thin
forwarders that `requireService("llm")` and THROW on a missing seam, so the caller's own try/catch keeps its meaning.

**`ctx.commands.register(definition)`** (dsh-commands `CommandRuntime.register` → `normalizeDefinition`): accepts
`{ name, description, input?: {hint, attachments?}, recordInput?, handler }` — the name must match `COMMAND_NAME`, `description` must be non-empty,
`input.hint` must be a non-empty string, and `handler` must return `{kind:'success'|'error'}`. The plugin registers exactly
`{ name, description, input: { hint: '[--profile <name>] <goal>' }, handler }` — no `recordInput`, no `attachments`.
**Fields the adapter's `registerCommand` would drop: `recordInput`.** It forwards `name`, `description`, `input`, `handler` only, and it REPLACES the
handler with a wrapper that spreads the invocation and adds a `submit` bound to `adapter.submitUserTurn(host.agent, msg)`. For this plugin the drop is
inert (neither registration sets `recordInput`), and the wrapper is a superset: the harness's invocation is a FROZEN
`{commandId, agent, rawInput, attachments, signal}` with the RAW Agent in `agent`, so `invocation.agent` still supports
`ctx.startAgentTurn(invocation.agent, msg)` and `getExplicitOpts()?.agent` (`command.js`). Two consequences to record: (a) the plugin must never depend
on `invocation.submit` (it does not), and (b) a future `recordInput: false` on an mpd command would be silently ignored through the adapter.
**`invocation.agent.followup(msg)` (2 sites) and `captain.followup` / `captain.cancel`**: the throw matters. `ReactLoopAgent.followup(input)` is
`this.send(input, 'next-turn', true)` and `cancel(cause, options = {})` aborts the phase — neither is documented to throw, but the plugin's call sites
rely on the CALL being able to throw (tools.js's `approveStagedTeam`-family try/catch around `captain.followup`, `steerCaptainReport`'s
`try { captain.steer(…) } catch { return false }`). D9's split (`startAgentTurn` throwing verbatim vs `submitUserTurn` swallowing into a boolean) is
therefore right, and `submitUserTurn` must stay the swallowing form for `registerCommand`'s `submit`.

## 7. Divergence ledger (severity · disposition)

| id | divergence | severity | disposition |
|---|---|---|---|
| **F1** | **`agentScopeOf` returns two DIFFERENT shapes.** Contract §4 freezes `typeof ctx?.agentScope === 'function' ? (ctx.agentScope(agent) ?? agent?.ctx) : agent?.ctx`, while §5 edits `harness-compat.js` to call `setup(scope.context, agent)`. In the adapter-absent/pending arm the value is the RAW cordis ctx, which has NO `context` member: reading `agent.ctx.context` on a live ctx walks the resolver and THROWS `cannot get property "context" without inject`, and on a plain-object test ctx it yields `undefined`. Either way `installMemberSelectionRuntime`'s setup receives no usable `childCtx`, is caught by `installContinuableMemberSetup`'s own `catch`, and the member is permanently parked on the failure listener — member model selection silently disabled AND the first request rejected. No existing test drives that path (`installMemberSelectionRuntime` / `agent/session-start` appear in NO test), so AC4/AC5 would not catch it, and AC11's negative control deliberately composes the absent mode. | **high** | **Fix the contract text, not the call sites**: `agentScopeOf` must ALWAYS return the SAME four-key shape `{context, tools, on, effect}`, with the fallback arm built from the raw ctx (`context: raw`, `tools: raw.tools`, `on: (e,h) => raw.on(e,h)`, `effect: (f,l) => raw.effect(f,l)`) and WITHOUT an all-or-nothing probe (a missing member must fail at USE time exactly as today). Recommended over `scope.context ?? scope` at each site: one shape, no call-site discipline. |
| **F2** | **The Agent-object seam inventory is incomplete.** Contract D8/§2 classify only `followup` and `cancel` as routed capabilities and put "Agent property reads (id, status, session, ctx)" in class B. Measured direct Agent-METHOD calls on the live handle: `captain.steer` (`index.js` approval notification, `members.js` `steerCaptainReport`), `captain.inject` (`tools.js` `discardStagedTeam`), `whenIdle` (`tools.js` the halt drain race, `members.js` the child drain). AC3's "ZERO raw-ctx hits" instrument cannot see them (they are Agent methods, not ctx properties), so the phase can ship with five direct harness-object calls and a green AC. | **medium** | Route the two TURN verbs with the same throwing-forwarder rule as D9 (`steerAgentTurn`, `injectAgentTurn`) — same class as `followup`/`cancel`, and `steerCaptainReport`'s try/catch depends on the throw exactly as `captain.followup` does; then leave `whenIdle` DIRECT and RECORD it in §2 as an accepted residual (an await on a handle the plugin already holds; no adapter method can make it more correct). If the captain prefers minimal surface, record ALL FIVE as B with this note as the reason — but §2 must say so, because today it does not. |
| **F3** | **Stale lane ownership in the frozen contract.** §4's header ("owner lane t3"), §5's header, §6, and AC3/AC4/AC6 ("NEW, owner t3") name t3 for the bridge + its three new test files, but in the live DAG t3 IS this read-only note and t2 is the plan review: the bridge and its tests currently have NO owning task. | **medium** | Captain re-anchors those labels to the real task ids (or creates the lane) before dispatching phase 2; otherwise the facade/tests can be assumed owned by someone who cannot write files. |
| **F4** | Registration effect ownership moves from the agent-teams row's fiber to the mpdDsh row's fiber (Q1). Nothing in the repo depends on it, but a row-level re-apply would then hit `tool "<name>" is already registered` instead of re-registering, because the plugin drops all 21 disposers. | **low** | Adopt the cheap re-anchor: the bridge's `tools.register` wraps the returned disposer in `targetCtx.effect(() => dispose, 'agent-teams: tool registration')`. Otherwise keep R1 but name this concrete consequence. |
| **F5** | The facade's `on(event, handler)` has no 3rd parameter while `EventsService.on(name, listener, options)` accepts placement options. No CURRENT call site passes options (all 7 plugin sites are two-argument), so there is no divergence today — but a future `{prepend: true}` would be silently dropped. | **low** | Forward the third argument (`on(event, handler, options)`) in the bridge; one token, removes the latent ordering trap. |
| **F6** | `registerCommand` drops `recordInput` (harness-supported: `normalizeDefinition` honours `recordInput === false` to suppress the args record in the `command/run` lifecycle event). Inert for this plugin; a silent-loss trap for a future mpd command. | **low** | Guard/document: add `...(definition.recordInput === undefined ? {} : { recordInput: definition.recordInput })` to the adapter's command spread, or state the drop in the adapter README's Wrapped-seams table. |
| **F7** | AC3 as written ("RAW-ctx seam objects that THROW when touched … ZERO raw-ctx hits") cannot distinguish the objects it must: (a) the plugin's own ctx (must never be used for seams), (b) a HOST-PROVIDED per-agent ctx (`childCtx.on('agent/error'|'agent/request-error')` in `members.js`, and the `agent.ctx` reads inside `agentScopeOf`/`scopeOfAgentContext`) which is legitimate class-C usage. | **medium** | Guard the AC before the test is written: name the instrumented objects — only the plugin/composition ctx counts as a raw hit; a per-agent ctx handed in through `setup(childCtx, child)` must be a SEPARATE fake. Otherwise the test either false-reds on legitimate code or is weakened until it proves nothing. |
| **F8** | Evidence hygiene: the tree moved while this review read it (the adapter gained the §3 methods mid-read). Counts quoted in the contract (§0 "123 entries", §6 "123 + N regions") are point-in-time measurements. | **low** | Re-measure every count at the moment the phase lands it (T-90 durable-anchor rule) and cite the artifact that carries the measurement, not the number alone. |

## 8. Residual direct usage I consider ACCEPTABLE (explicit)

Split by what the object IS, not by who calls it:

1. **Cordis core — keep direct, no adapter method is warranted**: `ctx.effect` / `ctx.inject` / `ctx.logger` / `ctx.on` (the event bus IS the
   plugin's own lifecycle), plus every non-harness `ctx.get(name)` lookup (`mpdConfig`, `WATCHDOG_HOLD_SERVICE`, `PRESERVING_HOLD_SERVICE`,
   `webServer`/`httpServer`, `workspaceRegistry`/`workspace`, `connection`) and `ctx.agents`-free cordis plumbing. These are the plugin's own
   runtime, not a harness seam; the adapter is a harness-rename absorber, and cordis is the stable substrate. (The facade still forwards them,
   which is fine — the point is that the RULE is not violated when they stay direct in a fallback arm.)
2. **Data on a live handle — keep direct**: `agent.id` / `agent.status` / `agent.session` / `agent.options` / `agent.ctx` (the last only to hand
   it back to the bridge). D8's rule is right: property reads are data, not capabilities.
3. **Values the host hands the plugin — keep direct**: the per-child scoped ctx passed to `setup(childCtx, child)` and its
   `childCtx.on('agent/error'|'agent/request-error')` registrations (`members.js`). These listeners must be tagged with the CHILD's scope; routing
   them through the adapter's ctx would change event admission. The bridge's job is only to hand over the SAME object (`scope.context`).
4. **`lib/client.js` and `_deps/**`**: out of scope by D7 — the browser bundle keeps its own `ctx.slots` usage.
5. **`whenIdle()`** (F2) and the four `captain.steer`/`captain.inject` sites: acceptable ONLY IF §2 records them; the turn verbs are better routed.

## 9. One clear recommendation

**Adopt the facade design as frozen, with three text fixes applied before the bridge lands:** (1) F1 — `agentScopeOf` returns ONE normalized
four-key shape in both arms (this is the only finding that breaks a documented behaviour if implemented literally); (2) F2 — decide and WRITE
whether `steer`/`inject`/`whenIdle` are routed or residual, so AC3's instrument and the §2 table agree; (3) F7 — scope AC3's raw-ctx instrument to
"the plugin ctx only", keeping the per-agent ctx legitimate. Rationale: the mechanics themselves are sound and already implemented correctly in the
landed adapter (`scopeOfAgentContext`'s receiver-binding of `restrict`/`on`/`effect` is exactly the preserved semantics; `registerHostTool`'s verbatim
pass-through is the only way to keep the 21 definitions `Object.is`-identical; `llmListModels`/`llmResolveCallConfig`/`registerPromptSection` are the
right thin forwarders and must not be replaced by `llmCatalog`). The three fixes are text/one-line changes; F4/F5/F6 are cheap hardening that keeps the
phase from trading a documented gap for a latent one.


## 10. Errata (same attempt, appended after the first write)

- §1 evidence item 4: "RedlectService.constructor" is a typo for `ReflectService.constructor` (cordis, `mixin("fiber", ["runtime", "effect"])`).
  The citation target is unchanged; the symbol is `ReflectService`.
- Two claims a phase-2 lane should re-verify at landing rather than trust from this note: (a) the visible-tool set for a member
  (`AGENT_TEAMS_TOOLS=n/N` from `mpd-qa-roles-probe`) is unchanged under routing — it reads the global view, which §1 argues is
  placement-invariant; (b) `t52-root-registration` stays green — it constrains the FALLBACK arm (F1's fix), not the routed arm.
