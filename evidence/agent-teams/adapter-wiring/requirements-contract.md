# Requirements contract (FROZEN) — agent-teams reaches every harness seam through mpd-dsh-adapter

Task: t1 (kind=requirements, round 1) · seat: Planner (read-only) · wave: w1 · team: agent-teams-adapter-wiring
Measured by the requirements seat on 2026-09-19 against the live tree (every count below is re-measured today, not copied from the brief).
OBJECTIVE (user, verbatim): 工程内部的agent-teams也接入mpd-dsh-adapter-plugin — the adopted agent-teams plugin
(`packages/mpd-agent-teams-plugin`, MIT, first-class main code) must reach DeepSeek Harness THROUGH `packages/mpd-dsh-adapter-plugin`,
closing the AGENTS.md §6 documented exception. No team-protocol behaviour change. `lib/client.js`, `_deps/**`, any upstream re-vendor and `skills/**` are OUT of scope.

## 0. Corrections to the brief (measured 2026-09-19; the brief's numbers are provenance, these are authority)

| Claim in the brief | Measured | Note |
|---|---|---|
| `ctx.tools.register` × 33 in tools.js | **21** (`tools.js:677…3228`, 21 `defineTool(` calls, 21 tool names `agent_teams_*`) | 33 was a mis-count |
| `ctx.agents.get` × 12 | **10 live** (tools 2, members 3, scheduler 2, index 2, events 1) + **2 inside `lib/mpd-deltas.js` registry BLOCKS** (recorded text, not live code) | 10 + 2 = the brief's 12 |
| `ctx.on` × 10 | **8** (scheduler 1, index 1, capabilities 1, command 1, session-start 2, harness-compat 2 [1 of them `agent.ctx.on`]) | — |
| delta registry 146 entries | **123 entries across 10 files** — the **t1-TIME** measurement (2026-09-19T14:22Z, before any bridge-lane region landed; live markers at that moment: 123) — via `node -e "import('./packages/mpd-agent-teams-plugin/lib/mpd-deltas.js').then(m=>console.log(m.MPD_DELTAS.length))"` | **HISTORICAL correction with its own moment, NOT a present claim** (t17 item 4): 146 was not a state of this tree at t1 time. The tree NOW measures exactly 146 entries / 13 files for a DIFFERENT reason — the bridge lane's regions landed — so the authority for the current count is §6's MEASURED REGISTRY STATE (+ its re-measure rule), never this row |
| seam list complete | **two Agent-object turn-engine methods were missing**: `captain.followup` (tools.js:617) and `captain.cancel` (tools.js:372, 379, 615, 666) | covered by D8 below |
| `@mpd-dsh/agent-teams` version | `0.1.16-rc.3-mpd`; `_deps/**` is the ONLY VENDOR_LOCK-covered subtree | editing `lib/**` does not redden `verify:vendor` |

## 1. Frozen design decisions (D1–D7 from the captain, recorded verbatim in effect; D8–D12 added by this seat)

- **D1** ONE adapter-backed ctx FACADE, built in the composition root (`lib/index.js` apply), is handed to every consumer
  (`registerAgentTeamsTools`, `installTeamCapabilities`, `installSessionTeamPolicy`, `installInterjectionExpirySweep`,
  the `commands` inject callback, `installAgentTeamsGestureBoundary`, `haltTeamWork` and every later `input.ctx`/`ctx` user).
- **D2** The facade resolves `ctx.get('mpdDsh')` LAZILY with T-50 semantics; when the adapter is absent it WARNS ONCE and serves the
  raw cordis ctx — today's behaviour exactly. It never builds a private adapter (that fallback lives only inside the adapter row itself).
- **D3** The bridge is a NEW mpd-owned file **`packages/mpd-agent-teams-plugin/lib/mpd-adapter-ctx.js`** (name prefix `mpd-`, see D10).
- **D4** Edits to adopted files happen ONLY inside `//#region mpd-delta <id>` regions; `lib/mpd-deltas.js` changes only via
  `node scripts/patch-agent-teams-fixes.mjs --write-registry`.
- **D5** Per-agent scoped access is adapter-owned: child/agent scopes are reached through the bridge's `agentScopeOf`, never by new
  direct `agent.ctx.*` seam calls.
- **D6** `harness-compat.js`'s Harness-generation ladder (`registerContinuableSetup` / `prompt` / `HOST_PROMPT_QUEUE` / `followup` / `sendMessage`)
  and the retired-member guard's patching REMAIN policy in the plugin; the adapter owns WHICH object the ladder operates on.
- **D7 (amended by t25 — see §8's named exception and §12 addendum A5)** Out of scope: `lib/client.js`, `_deps/**`, team-protocol behaviour, upstream re-vendor,
  `skills/**`, `packages/mpd-bundle/cordis.patch.yml` (no row change). **The `skills/**` clause carries ONE NAMED AUTHORIZED EXCEPTION** (§8): the wave's QA-corpus defect
  V-1 blocked AC12/AC13, and the captain authorized ONE scoped change set plus the wave's single `VENDOR_LOCK.json` re-pin. Nothing else in this decision moved.
- **D8 (added; extended in revision 6 by F2)** The Agent-object rule: the adapter hands out the RAW Agent (identity preserved); property reads (`id`/`status`/`session`/`ctx`)
  stay direct BY DESIGN (they are data on the live handle). The FOUR turn-engine METHODS the plugin calls are capabilities and ARE routed as THROWING VERBATIM
  FORWARDERS: `followup` via `startAgentTurn` (see D9), `cancel` via `cancelAgentTurn`, `steer` via `steerAgentTurn`, `inject` via `injectAgentMessage` (§3 rows 11–14,
  sites in §2). `whenIdle` is recorded **Class B** with its reason in §2 (a quiescence await on the live handle, not a capability that changes the session), and that
  classification is ASSERTED by the closure scanner (AC15), so the Class-B set cannot grow silently.
- **D9 (added)** `startAgentTurn(agent, message)` is a THROWING verbatim forwarder to `agent.followup(message)`; it is NOT
  `submitUserTurn` (which swallows into a boolean). Reason: `tools.js:617` depends on the throw inside its own try/catch — a swallowing
  call would change behaviour. `submitUserTurn` keeps its documented boolean contract for every existing consumer (none uses it today).
- **D10 (added; re-worded in revision 3, then by the captain's ruling R1 — option (b) of the t11 acceptance)** mpd-owned modules are named `lib/mpd-*.js`, and
  mpd-owned-ness is derived from that FILE NAME **plus FULL reconstruction from that file's registry entries** (`beforeContext + block + afterContext + "\n"`,
  exactly one region — D11). **No registry field can be relied on, because there is none.** The create-on-missing rule is DERIVED AT HEAL TIME from the registry
  alone, inside the applier owned SOLELY by the guard lane (contract lane t4 = team task t6, inScope `scripts/patch-agent-teams-fixes.mjs`); the registry keeps its
  five existing keys (`file`/`id`/`beforeContext`/`afterContext`/`block`) and `--write-registry` is unchanged. The `create: true` flag is DELETED: nothing in this
  contract requires it, and nothing ever depended on its emission (R1).
- **D11 (added)** The bridge file is a SINGLE region with EXACTLY ONE non-region skeleton line on each side, so that
  `beforeContext + block + afterContext` reproduces the file (registry-restorability by construction, D10 + AC8). **LOAD-BEARING (addendum A1 — see §12):** the two
  skeleton lines MUST be textually DIFFERENT strings, because each half of the context pair MUST occur EXACTLY ONCE in the region-stripped skeleton — an identical pair
  makes both halves ambiguous and the bridge UNREGISTERABLE (so `--write-registry` and the heal path both refuse it).
- **D12 (added)** `inject = ['tools','llm','subagents','systemPrompt','agents']` on the plugin row is UNCHANGED (boot ordering, no pend).

## 2. Seam inventory (measured 2026-09-19; server files only)

Classes: **A** = routed through the adapter · **B** = stays direct (stated reason) · **C** = value handed to the plugin by the host.

| Seam | File:symbol | Count | Class | Adapter method / reason |
|---|---|---|---|---|
| `ctx.tools.register(def)` | tools.js — every `agent_teams_*` definition site | 21 | A | `registerHostTool(def)` (verbatim passthrough; see §3.1 why `registerTool` cannot serve it) |
| `ctx.agents.get(id)` | tools.js ×2, members.js ×3, scheduler.js ×2, index.js ×2, events.js ×1 | 10 | A | `liveAgent(id)` (exists; returns the RAW Agent) |
| `ctx.agents.list()` | capabilities.js:116 | 1 | A | `liveAgents()` (exists) |
| `ctx.subagents.getProvider` | members.js:575 | 1 | A | `subagentProvider(name)` (NEW) |
| `ctx.subagents.list` | members.js:577 | 1 | A | `subagentProviders()` (NEW) |
| `ctx.subagents.startContinuable` | members.js:590 | 1 | A | `startContinuableAgent(spec)` (NEW; throws preserved) |
| `ctx.subagents.interrupt` | members.js:651 | 1 | A | `interruptAgent(targetId, authority)` (NEW) |
| `ctx.subagents` as the delivery RUNTIME | members.js:634 (`queueMemberPrompt(ctx.subagents,…)`), harness-compat.js:67, :163 | 3 | A | `subagentRuntime()` (NEW) → resolved via bridge `subagentRuntimeOf(ctx)`; ladder policy stays (D6) |
| runtime generation ladder reads (`prompt`/`followup`/`[HOST_PROMPT_QUEUE]`/`sendMessage`/`registerContinuableSetup`) | harness-compat.js `queueMemberPrompt`, `installContinuableMemberSetup`, `guardSubagentDelivery` | 4 read sites | B | Policy over the object `subagentRuntime()` returns (D6). The retired-member guard's method patching still mutates that object — documented residual R2 |
| `ctx.get('agents')?.get(id)` | harness-compat.js:193 | 1 | A | `agents.get` on the facade (the service-lookup spelling of the agents seam disappears) |
| `ctx.commands.register(def)` | command.js:206, :233 | 2 | A | `registerCommand(def)` (exists; shape-compatible: `{name,description,input:{hint},handler}`) |
| `ctx.systemPrompt.section(sec)` | capabilities.js:104 | 1 | A | `registerPromptSection(sec)` (NEW). Runtime shape witnessed by `_deps/dsh-agent/lib/index.js` `assembleContextFor` @ :384 → text providers receive `{agent, scope, signal?}` (the `.d.ts` `AssembleContext` lags; the plugin's `({agent})` destructure is correct) |
| `ctx.llm.listModels(provider)` | members.js:102 | 1 | A | `llmListModels(provider)` (NEW) |
| `ctx.llm.resolveCallConfig(cfg, signal)` | members.js:216 | 1 | A | `llmResolveCallConfig(cfg, signal)` (NEW) |
| `ctx.on(event, handler)` | 7 root-context sites: scheduler.js:889, index.js:536, capabilities.js:110, command.js:254, session-start.js:533, :719, harness-compat.js:85 — plus the 1 agent-scoped site harness-compat.js:101, itemized in the row below | 8 | A | facade `on` → `onEvent` (exists); facade always returns a disposer (`onEvent` may return undefined). The Count cell is the WHOLE event-subscription seam (7 root + 1 agent-scoped) so §0's "ctx.on × 10 → 8" and §2.1's per-file roll-up agree; §2.1's harness-compat row carries that same agent-scoped 1 inside its agent-scope group, so no access is double-counted in the 65 total (§2.1) |
| `agent.ctx.on(event, handler)` | harness-compat.js:101 | 1 | A | `agentScope(agent).on` (NEW) |
| `agent.ctx.tools.restrict(filter)` | capabilities.js:93 | 1 | A | `agentScope(agent).tools.restrict` (NEW) |
| `agent.ctx.effect(fn, label)` | capabilities.js:96, harness-compat.js:117 | 2 | A | `agentScope(agent).effect` (NEW; thin forwarder, identical expression) |
| `agent.ctx` handed to `setup(childCtx, child)` | harness-compat.js:93 | 1 | A | `agentScope(agent).context` (NEW; identity-preserving) |
| `invocation.agent.followup(msg)` | command.js:222, :241 | 2 | A | facade `startAgentTurn(invocation.agent, msg)` (NEW; D9) |
| `captain.followup(msg)` | tools.js:617 | 1 | A | facade `startAgentTurn` (NEW; D9 — the try/catch needs the throw) |
| `captain.cancel(cause, opts)` | tools.js:372, :379, :615, :666 | 4 | A | `cancelAgentTurn(agent, cause, options)` (NEW, throwing forwarder) |
| `captain.steer(msg)` (F2; SYMBOL-anchored — line numbers drifted as t5's regions landed) | `lib/members.js` `steerCaptainReport` (:240) and `lib/index.js` `apply`'s approval-notice route, `action === 'approve'` (:401) — re-measured 2026-09-19T14:45Z | 2 | A | `steerAgentTurn(agent, message)` (§3 row 13; thin throwing verbatim forwarder) |
| `captain.inject(msg)` (F2; SYMBOL-anchored) | `lib/tools.js` `discardStagedTeam` (:681 — re-measured 2026-09-19T14:45Z; it was :674 before t5's regions landed, so the LINE was stale and the SYMBOL was not) | 1 | A | `injectAgentMessage(agent, message)` (§3 row 14; thin throwing verbatim forwarder) |
| `agent.whenIdle()` (F2; SYMBOL-anchored) | `lib/members.js` (:398), `lib/tools.js` `Promise.race([live.whenIdle(), aborted])` (:295) — re-measured 2026-09-19T14:45Z | 2 | B | **Class B, recorded:** a quiescence await on the live handle, not a capability that changes the session — it is not routed, and AC15's closure scanner asserts this classification so the Class-B set cannot grow silently |
| `ctx.effect` / `ctx.inject` / `ctx.logger` / `ctx.get(<mpd+dsh service>)` (`mpdConfig`, `WATCHDOG_HOLD_SERVICE`, `PRESERVING_HOLD_SERVICE`, `webServer`/`httpServer`, `workspaceRegistry`/`workspace`, `connection`) | index.js, scheduler.js, tools.js, members.js | 11 `get` + 11 `effect` + 1 `inject` + 83 `logger` | B | Cordis core, not harness seams (the adapter passes `get`/`effect`/`inject`/`logger` through, bound to the owner ctx) |
| Agent property reads (`id`, `status`, `session`, `ctx`) | many | — | B | Data on the raw Agent the adapter hands out (D8) |
| `lib/client.js` (browser bundle) | — | — | B | Out of scope (D7) |

## 3. Adapter additions (exact; owner lane t2 — **FOURTEEN methods**, twelve frozen originals + `steerAgentTurn`/`injectAgentMessage` from F2)

Signature style matches the existing `DshAdapter`; every method is a THIN forwarder with the stated degrade, and `capabilities()` gains one flag per seam. Rows 11–14 are the
`agentTurn*` family (D9 discipline: THROWING verbatim forwarders, never swallowed); their four shipped flag names are `agentTurnStart`, `agentTurnCancel`, `agentTurnSteer`,
`agentTurnInject`.

| # | Method (exact) | Harness shape it assumes (explicit resolution root + symbol + verified line) | Capability flag | Degrade on a missing seam |
|---|---|---|---|---|
| 1 | `registerHostTool(definition: unknown): () => void` | `_deps/dsh-tools/lib/index.js` `register(definition)` @ :2762 — requires `output.{schema,render}`, returns the effect disposer; the definition SHAPE the plugin hands over is compiled by `_deps/dsh-tools/lib/index.js` `defineTool(options)` @ :836 | `toolsRegisterHost` | THROW `mpd-dsh-adapter: harness service "tools" is unavailable` (parity with the injected `ctx.tools`) |
| 2 | `subagentRuntime(): unknown` | `_deps/dsh-subagent/lib/index.js` `SubagentRuntime` (identity-preserving; the class that owns `startContinuable`/`interrupt`/`getProvider`/`list`) | `subagents` (existing) | `undefined` |
| 3 | `subagentProvider(name: string): unknown` | `_deps/dsh-subagent/lib/index.js` `getProvider(name)` @ :2587 | `subagentsProvider` | `undefined` (the plugin's own check throws the same message) |
| 4 | `subagentProviders(): string[]` | `_deps/dsh-subagent/lib/index.js` `list()` @ :2594 | `subagentsProvider` | `[]` |
| 5 | `startContinuableAgent(spec: unknown): Promise<unknown>` | `_deps/dsh-subagent/lib/index.js` `startContinuable(spec)` @ :771 (the service's delegating wrapper is @ :2420) | `subagentsContinuable` | THROW (a member that cannot be spawned must be loud) |
| 6 | `interruptAgent(targetSessionId: string, authority: unknown): void` | `_deps/dsh-subagent/lib/index.js` `interrupt(targetSessionId, authority)` @ :896 | `subagentsInterrupt` | THROW |
| 7 | `llmListModels(provider: string): Promise<unknown>` | `_deps/dsh-llm/lib/index.js` `listModels(provider)` @ :1372 | `llmListModels` | THROW |
| 8 | `llmResolveCallConfig(config: unknown, signal?: AbortSignal): Promise<unknown>` | `_deps/dsh-llm/lib/index.js` `resolveCallConfig(config, signal)` @ :1454 | `llmResolveCallConfig` | THROW |
| 9 | `registerPromptSection(section: {name: string; order: number; text: string \| ((ctx: unknown) => string)}): () => void` | `<installed dsh>/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js` `section(section)` @ :238 — this package is NOT vendored (`_deps/` holds no `dsh-system-prompt`), so it has no `_deps` spelling and MUST be cited by its installed path | `systemPromptSection` | THROW at the call (the plugin's usage section is mandatory) |
| 10 | `agentScope(agent: unknown): DshAgentScope \| undefined` | the agent's OWN scoped cordis ctx (`agent.ctx`), whose `tools` object is the `_deps/dsh-tools/lib/index.js` `restrict(filter)` @ :2779 API (it reads `scopeOf(this.ctx)` @ :2780, which is why a scoped ctx is REQUIRED) | `agentScope` | `undefined` → the bridge falls back to the raw `agent.ctx` |
| 11 | `startAgentTurn(agent: unknown, message: unknown): void` | `_deps/dsh-agent/lib/types/runtime-types.d.ts` `followup(message: UserMessage): void` @ :115 | `agentTurnStart` | THROW (D9 parity) |
| 12 | `cancelAgentTurn(agent: unknown, cause: unknown, options?: unknown): void` | `_deps/dsh-agent/lib/types/runtime-types.d.ts` `cancel(cause: AgentCancelCause, options?: CancelOptions): void` @ :80 | `agentTurnCancel` | THROW |
| 13 | `steerAgentTurn(agent: unknown, message: unknown): void` (F2; flag name CONFIRMED as shipped by the adapter lane) | runtime: `<installed dsh>/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js` `steer(input)` @ :792 (same file as `followup` @ :789 and `cancel` @ :798; **`dsh-agent-loop` is NOT vendored**, so this citation has no `_deps` spelling — R4's rule); declaration: `<installed dsh>/…/dsh-agent/lib/types/runtime-types.d.ts` `steer(message: UserMessage)` @ :200, vendored twin `_deps/dsh-agent/lib/types/runtime-types.d.ts` @ :123 | `agentTurnSteer` | THROW — a THIN VERBATIM forwarder, never swallowed into a boolean/undefined (the D9 discipline) |
| 14 | `injectAgentMessage(agent: unknown, message: unknown): void` (F2; flag name CONFIRMED as shipped by the adapter lane) | runtime: `<installed dsh>/…/dsh-agent-loop/lib/index.js` `inject(input)` @ :795; declaration: `<installed dsh>/…/dsh-agent/lib/types/runtime-types.d.ts` `inject(message: UserMessage)` @ :209, vendored twin `_deps/dsh-agent/lib/types/runtime-types.d.ts` @ :132 | `agentTurnInject` | THROW — same discipline (verbatim, never swallowed) |

**Two resolution roots, one spelling each (frozen).** `_deps/<pkg>/lib/...` is the plugin's VENDORED closure
(`packages/mpd-agent-teams-plugin/_deps`, pinned at 0.1.1-rc.2 for dsh-tools / dsh-subagent / dsh-llm / dsh-agent): it is what the plugin's own imports resolve
against, and a reader of this repo can open it. The INSTALLED harness (`<installed dsh>/node_modules/@deepseek-ai/<pkg>/…`, e.g. dsh-agent 0.1.5-rc.2)
PROVIDES the running services the adapter probes; `dsh-system-prompt` exists only there, so row 9 is cited by its installed path and by nothing else. **Why it is
not vendored (R4):** the plugin receives `systemPrompt` from its OWN inject list — `export const inject = ['tools','llm','subagents','systemPrompt','agents']` in
`lib/index.js` — not from `_deps/`, which is exactly why that service has no `_deps` spelling. **Obligation on the adapter lane (contract lane t2 = team task t4):
verify each shape against the INSTALLED harness during implementation and record, in that lane's evidence, the exact path it verified.** This table's `_deps/`
citations document the vendored closure the plugin's own imports resolve against; a divergence the adapter lane measures at verification time is a FINDING to
report, not a licence to silently rewrite this table. Where a
symbol's line number differs between the two copies, this table quotes the `_deps` line (the copy verified in this tree); no citation in this section is left
without its root. **Line-drift note (measured 2026-09-19):** the dsh-agent type file is one of those copies that differ — `_deps/dsh-agent/lib/types/runtime-types.d.ts`
carries `cancel` @ :80 and `followup` @ :115 (323 lines, vendored 0.1.1-rc.2), while the installed 0.1.5-rc.2 copy carries the same two declarations at :157 and :192.
Rows 11/12 quote the `_deps` numbers on purpose, because that is the root named in its own cell; a reader checking the installed copy will find the symbols at the
other pair of lines, not a missing symbol.

`DshAgentScope` (frozen shape, returned by #10): `{ context: unknown; tools: { restrict(filter: {allow?: readonly string[]; deny?: readonly string[]}): () => void }; on(event: string, handler: (...args: unknown[]) => unknown): () => void; effect(fn: () => unknown, label?: string): () => void }`.
`agentScope` returns the scope ONLY when `agent.ctx` exposes the members it promises; otherwise `undefined` (callers fall back).
Existing surface reused unchanged: `registerCommand`, `registerTool(s)`, `liveAgent(s)`, `onEvent`.

### 3.1 Why `registerHostTool` is REQUIRED (not a duplicate of `registerTool`)
`registerTool` RECONSTRUCTS the definition (`{name, description, parameters?, output:{...output, schema, render}, timeoutMs?, execute: wrapper}`) — it drops
`finalizeContent`, `presentCall`, `presentResult`, `isConcurrencySafe` and replaces `execute` (a wrapper, not the original function), so it cannot satisfy the
byte-parity AC. `tools.js` passes `defineTool(...)` output, which is ALREADY harness-shaped (`_deps/dsh-tools/lib/index.js` `defineTool`: `parameters`/`output.schema`
are compiled JSON Schemas, `execute` validates args). The bridge therefore calls `registerHostTool` verbatim and `Object.is` holds end-to-end.

## 4. Facade contract (owner lane t3; module `lib/mpd-adapter-ctx.js`)

Exports (frozen names): `createAgentTeamsCtx(targetCtx, options?)`, `agentScopeOf(ctx, agent)`, `subagentRuntimeOf(ctx)`.

`createAgentTeamsCtx(targetCtx, options = {})` returns an object with EXACTLY these properties:

| Property | Adapter present | Adapter absent (fallback) |
|---|---|---|
| `tools.register(def)` | `dsh.registerHostTool(def)` | `targetCtx.tools.register(def)` (receiver-bound) |
| `agents.get(id)` / `agents.list()` | `dsh.liveAgent(id)` / `dsh.liveAgents()` | `targetCtx.agents.get(id)` / `targetCtx.agents.list()` |
| `subagents.getProvider(n)` / `list()` / `startContinuable(spec)` / `interrupt(id,auth)` | #3/#4/#5/#6 | `targetCtx.subagents.<same>` (receiver-bound) |
| `subagents.runtime()` | `dsh.subagentRuntime()` | `targetCtx.subagents` |
| `commands.register(def)` | `dsh.registerCommand(def)` | `targetCtx.commands.register(def)` (receiver-bound) |
| `systemPrompt.section(sec)` | `dsh.registerPromptSection(sec)` | `targetCtx.systemPrompt.section(sec)` |
| `llm.listModels(p)` / `llm.resolveCallConfig(c,s)` | #7 / #8 | `targetCtx.llm.<same>` |
| `agentScope(agent)` | scope built from `dsh.agentScope(agent)` when present | `agent?.ctx` (identity), else `undefined` |
| `startAgentTurn(agent, msg)` | `dsh.startAgentTurn(agent, msg)` | `agent.followup(msg)` (identical expression ⇒ identical throws) |
| `cancelAgentTurn(agent, cause, opts)` | `dsh.cancelAgentTurn(agent, cause, opts)` | `agent.cancel(cause, opts)` |
| `on(event, handler)` | `dsh.onEvent(event, handler) ?? (() => {})` | `targetCtx.on(event, handler)` (always a function) |
| `effect` / `get(name, strict?)` / `logger` / `inject(deps, cb)` | pass-through, bound to `targetCtx`, EXCEPT `inject` (below) | same |

Resolution (D2/T-50, mirrored from `createLazyDshAdapter`): probe `resolveCtx.get('mpdDsh', true)` per access → on success cache the mounted adapter and
never re-probe; on a miss re-probe on EVERY access (no miss is ever cached); a miss serves the fallback column. `resolveCtx` defaults to `targetCtx` and the
composition root passes the RAW plugin ctx so a scoped/proxy ctx can never fail the probe.
Witness lines (exact strings, emitted ONCE per mode per plugin instance, greppable therefore falsifiable):
`[agent-teams] adapter: mpdDsh mounted — harness seams routed through mpd-dsh-adapter` ·
`[agent-teams] adapter: mpdDsh pending (provider not ACTIVE) — serving the raw cordis ctx for now and re-probing on every access` ·
`[agent-teams] adapter: mpdDsh ABSENT — serving the raw cordis ctx (warn once); mpd-dsh-adapter must sit ABOVE the agent-teams row`.
`inject(deps, cb)` wrapping (frozen): `targetCtx.inject(deps, (scoped) => cb(createAgentTeamsCtx(scoped, { resolveCtx })))` — this is how the
`ctx.inject(['commands'], …)` callback receives an already-wrapped scoped ctx with NO edit at the call site.
**`agentScopeOf(ctx, agent)` — CORRECTED in revision 6 (F1, high; the pre-revision-6 formula is recorded below as the DEFECT it was).** It ALWAYS returns ONE shape
`{ context, tools, on, effect }`:
- **MOUNTED arm**: the adapter's `agentScope(agent)` result, used as returned whenever it is USABLE (it is the adapter's own §3 row 10 shape).
- **FALLBACK arm** (adapter absent, adapter pending, or `agentScope(agent)` yielding an unusable result): the shape is **BUILT from the raw `agent.ctx`**, each property
  resolved INDEPENDENTLY — `context` = `agent.ctx` **keeping its identity**, `tools` = `agent.ctx.tools` when it exposes `restrict`, `on` = `agent.ctx.on` when callable,
  `effect` = `agent.ctx.effect` when callable. There is **NO all-or-nothing probe**: one missing member must never discard the others.
- **THE DEFECT this removes (F1, from the architecture note t3):** the old one-liner ended in `: agent?.ctx`, i.e. that arm returned a RAW cordis ctx in place of the
  shape, so `scope.context` was `undefined`; `lib/harness-compat.js` `installContinuableMemberSetup` then threw and parked the member on its failure listener —
  **silently disabling member model selection and rejecting the member's first request**. NO arm may return a raw cordis ctx in place of the shape.
- **Test-green consequence kept:** with a plain-object test ctx the built shape is assembled from the SAME `agent.ctx` members, so every existing plain-object-ctx test
  stays green with zero edits.

**Lane labels in this section are the CONTRACT's own names; §8's lane-label → team-task-id map is AUTHORITATIVE** (team t4=adapter, t5=bridge, t6=guard, t7=docs,
t8=verify, t9=review, t10=integration) — F3.
Parity rules: (a) the absent-adapter column executes today's EXACT expressions (same receiver, same throws); (b) a fallback may only be MORE tolerant than the
harness where the adapter's own never-crash contract already is (`liveAgent`/`liveAgents`/`onEvent` swallow-and-degrade; recorded as intentional); (c) adapter-mediated
registrations are owned by the ADAPTER row's fiber — recorded residual R1 (both rows share the boot lifetime; there is no plugin-module hot reload, T-21);
**(d) the ONE NAMED F1 SCOPE TOLERANCE (BR-1, ruled 2026-09-19 — the declared instance of (b), named so a reviewer never has to treat it as an undeclared divergence):**
when the uniform scope shape cannot be built from the raw agent ctx, `lib/mpd-adapter-ctx.js` `scopeShapeFrom` SUBSTITUTES a per-member no-op — a `tools` object whose
`restrict` returns `DISPOSE_NOTHING`, plus a no-op `on`/`effect` — and reports the substituted member names through its existing warn-once sink
(`reportSubstitution` → `adapterSubstitutionWitness`, level `warn`) EXACTLY ONCE per plugin instance, instead of the pre-F1 loud throw. The substituted member that
MATTERS is **`tools.restrict`**, because a member that cannot be tool-restricted is a **MEMBER PRIVILEGE LOSS** (the bridge's own BR-1 note names it as the
security-relevant one); **the guarantee is therefore the LOUDNESS, not the throw.** The throw is deliberately NOT kept, for two measured reasons: (i) the plugin's
standing doctrine is that a missing seam degrades with ONE warning rather than aborting `apply()`/`setup` (the same doctrine as the three mode witnesses), and (ii) the
pre-F1 loud throw left the member UNRESTRICTED ANYWAY — `lib/capabilities.js` `attach()` assigns `revoke = scope.tools.restrict({…})` INSIDE its `try`, so a throw runs
`state.dispose()` and re-throws while `revoke` is still `undefined`, i.e. no restriction was installed on either path. The tolerance is thus about loudness, NOT about
semantics. **This path is UNREACHABLE on the installed harness:** a real per-agent ctx exposes `tools`/`on`/`effect`, and the mounted arm accepts only an
all-four-callable scope (`isUsableScope` requires `context` + `tools.restrict` + `on` + `effect`; a member read that THROWS degrades through `readScopeMember`), so this
is a DEFENSIVE-path decision exercised only by its own test arm (a throwing proxy), never an observed divergence.

## 5. Adopted-file edit map (owner lane t3)

**Region ids are MEASURED, never projected (t15 correction; the captain's ruling on the landed set).** The ids below were read on **2026-09-19T14:47:20Z** from the
`//#region mpd-delta …` markers in `packages/mpd-agent-teams-plugin/lib/*.js` AND cross-checked against `MPD_DELTAS` in `packages/mpd-agent-teams-plugin/lib/mpd-deltas.js`
(the implementation landed MORE GRANULAR ids than this section originally projected, and added import-carrier regions — the projection is SUPERSEDED; the bridge lane was
NOT asked to rename anything, because region ids are internal and the landed set is strictly more precise). **Three rules, frozen:** (1) a region id is STABLE once landed;
(2) the REGISTRY (`lib/mpd-deltas.js`, derived by `--write-registry`) is their AUTHORITY — this section cites ids, it does not define them; (3) the set is READ, never
COPIED: a reader or a later revision re-measures it from the two authorities AT READ TIME and records the snapshot WITH its UTC read moment, because the set may still
GROW while the bridge lane lands the `steer`/`inject` call sites (F2 allows up to three more regions there). **Every region is a BRACKETED, TOP-LEVEL, NON-SPLITTING
edit**: it is delimited by its `//#region`/`//#endregion` pair, sits outside every other region, and never splits a declaration — AC7 asserts exactly that, and this
section's per-file rows are unchanged in substance from the original map apart from the ids themselves.
MEASURED SNAPSHOT — **re-measured 2026-09-19T15:04Z (the moment the bridge lane's F1/F2 work became terminal); the earlier read was 2026-09-19T14:47:20Z, re-read
14:49:59Z, and it is SUPERSEDED, not deleted**: the **six bridged files carry 27 markers holding 26 DISTINCT ids** (`adapter-subagent-runtime-import` is carried in BOTH
`harness-compat.js` and `tools.js`, which is why markers exceed distinct ids by one); including the bridge module's own `adapter-ctx-bridge` the set is **28 markers / 27
distinct ids**, inside a registry of **151 entries across 13 files** — the ten originally registered files plus `capabilities.js`, `harness-compat.js` and the new
`mpd-adapter-ctx.js` — with its **five keys** (`file`/`id`/`beforeContext`/`afterContext`/`block`) and **ZERO** `create` keys. **The F2 landing added exactly the regions
the growth caveat anticipated — FIVE: three routed sites (`adapter-steer-approval-notice` in `index.js`; `adapter-steer-captain-report` +
`adapter-steer-captain-report-caller` in `members.js`; `adapter-inject-staged-discard` + `adapter-steer-send-message-caller` in `tools.js`) — and it threaded the plugin
ctx into ONE adopted signature (deviation D7: `export function steerCaptainReport(ctx, captain, from, content)` in `members.js` — measured 2026-09-19T15:04Z — whose two
callers are `members.js` and `tools.js`), so per-file marker counts moved from 2/2/8/2/2/6 to 3/2/8/4/2/8.**

| File | MEASURED region ids (`mpd-delta ` prefix omitted) | What the regions carry (intent — the ids above are the authority) |
|---|---|---|
| `lib/index.js` (3) | `adapter-facade-wiring`, `adapter-facade-import`, `adapter-steer-approval-notice` | the facade construction at the top of `apply` (`const harnessCtx = ctx` + `ctx = createAgentTeamsCtx(harnessCtx, { resolveCtx: harnessCtx })`) and its IMPORT carrier — every consumer below (including calls INSIDE existing regions) receives the facade — plus the F2 approval-notice `captain.steer(...)` site |
| `lib/capabilities.js` (2) | `adapter-agent-scope`, `adapter-agent-scope-import` | `const scope = agentScopeOf(ctx, agent)` once in `attach(agent)`; `revoke = scope.tools.restrict({…})`; `releaseLifetime = scope.effect(…)` + import carrier |
| `lib/harness-compat.js` (8) | `adapter-subagent-runtime-import`, `adapter-subagent-runtime-install`, `adapter-subagent-runtime-guard`, `adapter-subagent-runtime-agent-scope`, `adapter-subagent-runtime-agent-scope-setup`, `adapter-subagent-runtime-agent-scope-request`, `adapter-subagent-runtime-agent-scope-effect`, `adapter-subagent-runtime-agents-lookup` | `const runtime = subagentRuntimeOf(ctx)` (both installers); **§4's CORRECTED `agentScopeOf`** (F1 — one shape `{context, tools, on, effect}`, `context` keeping `agent.ctx`'s identity) split over the setup / request / effect call sites; `ctx.agents?.get?.(…)` replaces `ctx.get?.('agents')?.get(…)`; import carrier |
| `lib/members.js` (4) | `adapter-delivery-runtime`, `adapter-delivery-runtime-import`, `adapter-steer-captain-report`, `adapter-steer-captain-report-caller` | `queueMemberPrompt(subagentRuntimeOf(ctx), captain, …)` (the ladder must receive the RUNTIME, not the facade's subagents object) + import carrier; the F2 `steerCaptainReport` rewrite (**deviation D7: it now takes the plugin ctx as its FIRST parameter** — `export function steerCaptainReport(ctx, captain, from, content)` — so the report steer is adapter-mediated) + its caller region |
| `lib/command.js` (2) | `adapter-command-turn-submit`, `adapter-command-turn-submit-profile` | both `invocation.agent.followup(msg)` sites → `ctx.startAgentTurn(invocation.agent, msg)` (the profile-command path is its own region) |
| `lib/tools.js` (8) | `adapter-subagent-runtime-import`, `adapter-subagent-runtime-halt-drain`, `adapter-turn-submit`, `adapter-cancel-halt`, `adapter-cancel-feedback`, `adapter-cancel-discard`, `adapter-inject-staged-discard`, `adapter-steer-send-message-caller` | `captain.followup(msg)` → `ctx.startAgentTurn(captain, msg)`; the 4 `captain.cancel(...)` sites → `ctx.cancelAgentTurn(captain, cause, {keepInbox:true})`; the halt drain + import carriers; the F2 `captain.inject(...)` site (staged-team discard) and the F2 send-message caller that threads the plugin ctx into `steerCaptainReport` (§5's D7 note) |
| `lib/mpd-adapter-ctx.js` (1) | `adapter-ctx-bridge` | the bridge module's single file-level region — §6 owns its shape (D11) |

No other adopted file changes. `lib/mpd-deltas.js` is regenerated with `--write-registry` only. **Two ids the original projection never named are now part of the measured
set** (`adapter-subagent-runtime-import`, `adapter-subagent-runtime-halt-drain` in `tools.js`), and **the F2 ruling may still add up to three more** at the
`captain.steer` / `captain.inject` sites — a later revision re-measures (§5's rule 3) and updates this table with a fresh UTC moment; the registry, not this table, decides
what exists.

## 6. Bridge-file + registry discipline (D3/D10/D11)

`lib/mpd-adapter-ctx.js` layout (exact): line 1 = a one-line comment skeleton, then ONE region
`//#region mpd-delta adapter-ctx-bridge (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)` … `//#endregion adapter-ctx-bridge`
containing the entire module, then exactly ONE trailing comment skeleton line, then a trailing newline. **LOAD-BEARING (the rule t5's lane must implement to):** the two
skeleton lines MUST be textually DIFFERENT strings, because each half of the context pair MUST occur EXACTLY ONCE in the region-stripped skeleton — an identical pair
makes both halves ambiguous and the bridge UNREGISTERABLE (`--write-registry` and the heal path must refuse it loudly, naming the file and the remedy: make the
leading/trailing skeleton lines unique). Given that, the registered `beforeContext`/`afterContext` are exactly those two lines and
`beforeContext + block + afterContext + "\n"` reproduces the file (D11).
Registry: `--write-registry` is the only writer and its FORMAT IS UNCHANGED — the same five keys (`file`/`id`/`beforeContext`/`afterContext`/`block`), NO `create`
field and NO emitter change (D10 rev3, i.e. option (b) of the t11 acceptance). **CONSEQUENCE (R1; the RUN-COUNT wording corrected after the bridge lane's own report):** the
bridge lane (contract lane t3 = team task t5) **REGENERATES the registry with `--write-registry` whenever its regions change — never by hand** — with that unchanged schema;
nothing depended on it emitting a new key, and `--check` must exit 0 after EACH run. **The number of runs is NOT a contract term:** measured on the landed lane, it ran
THREE times (after the wiring batch, after the revision-6 layout correction of `tools.js`'s `adapter-turn-submit` region, and after the F2 amendment added five regions),
each time `--write-registry`-only, the schema never changing, and the final registry is singular and stable.
**MEASURED REGISTRY STATE — re-measured 2026-09-19T15:04Z after the bridge lane's F1/F2 work became TERMINAL (the earlier read was
2026-09-19T14:42:29Z; it is SUPERSEDED, not deleted):** the registry holds **151 entries across 13 files**, carrying exactly the FIVE keys
(`file`/`id`/`beforeContext`/`afterContext`/`block`) and **ZERO** entries with a `create` key — live confirmation of option (b) — and
`node scripts/patch-agent-teams-fixes.mjs --check` exits **0** with `already applied: 151 mpd delta region(s) across 13 adopted file(s)` (measured at the same
moment). 28 of the 151 entries are `adapter-*` (the §5 measured set). **RE-CONFIRMED 2026-09-19T15:24Z, after the BR-1 absorption rewrote the bridge's bytes INSIDE its
region (mtime 15:11:35Z) and `subagentRuntime` gained its capability flag:** the counts above are UNCHANGED (151 / 13, five keys, zero `create` keys, `--check` exit 0), and
the D11 reconstruction — `beforeContext + block + afterContext + "\n"` for the `mpd-delta adapter-ctx-bridge` entry — is BYTE-IDENTICAL to the file on disk (verified by
this seat: 26,796 === 26,796 bytes, one sha256). **The durable statement here is the INVARIANT plus the counts, never a digest:** the bridge module's own sha256 and line
count move whenever a lane writes inside its region, so they live in the delta record WITH their moments (currently `01fd9125…`, 522 newlines / 523 `split("\n")`
elements) and are deliberately NOT frozen in this contract. **Growth is now bounded:** the F2 landing added exactly the five regions the caveat anticipated
(§5), the bridge lane is TERMINAL, and the only remaining writer is the guard lane (contract lane t4 = team task t6), whose contract FORBIDS it from touching this
registry at all (`--write-registry` on a missing registered file is a named FAIL; that lane never rewrites `lib/mpd-deltas.js`). The docs lane (contract lane t5 = team
task t7) **re-measures** this pair at ITS landing time and records that moment (the docs gate derives the count from the registry): this contract states a measured
state, never a projection.
**Create-on-missing is ONE rule with ONE owner: the guard lane's applier (contract lane t4 = team task t6, inScope `scripts/patch-agent-teams-fixes.mjs`).**
That lane implements exactly three guard changes (R2, as CORRECTED by the captain on the guard lane's measurement), all three proven by the AC8 test
`packages/mpd-agent-teams-plugin/self-fix-tests/mpd-owned-file-restore.test.mjs`:
1. **(a) An explicit `existsSync` disposition branch for an enumerated-but-missing registered file:** `--check` fails loudly naming the file, `--write` creates it, and
   no path reaches a bare `readFileSync` on a missing path (the reads at `scripts/patch-agent-teams-fixes.mjs` ~:409 and ~:520).
2. **(b) `--check` on a missing registered file FAILS LOUDLY naming the file** — never a raw ENOENT.
3. **(c) `--write` CREATES such a file byte-faithfully (one trailing newline)**; for every OTHER missing registered file it still fails LOUDLY by name and NEVER
   crashes with ENOENT.
Both arms therefore handle a WHOLLY MISSING FILE, not merely a missing REGION (the only heal `--write` performs today), and the reads at ~:409/~:520 are reached only
for a path that EXISTS.

**The four predicates the guard lane asserts (captain-confirmed with R2; frozen and part of AC8):**
- **Create class = `lib/mpd-*.js` EXCLUDING `lib/mpd-deltas.js`** — the derived registry is never restored from its own entries.
- **"Reconstructs it entirely"** = exactly ONE registry entry for that file AND `beforeContext + block + afterContext` spanning that file's FIRST→LAST line; anything
  else is a LOUD FAIL naming the file, never a partial create.
- **After a create the guard RE-VERIFIES the just-created bytes** and, on failure, DELETES what it created and exits non-zero naming the file (no half-restored tree),
  asserting exactly one trailing newline.
- **`--write-registry` meeting a missing registered file is a LOUD named FAIL telling the caller to run `--write` first** — a regeneration must never silently drop a
  missing file's entries.
- **RULE A — the truncation guard, promoted INTO this contract from task t6's acceptance by the round-3 review (t14) finding F9:** `writeRegistry()` **REFUSES** to
  register a create-class file unless `beforeContext + block + afterContext + "\n"` **equals the CURRENT file bytes EXACTLY** — a loud refusal naming the file and stating
  the remedy (make the leading/trailing skeleton lines unique, or drop the create guarantee by using more than one region). Multi-region `mpd-*.js` files register
  normally and carry NO create guarantee; they are never refused. RULE A's blast radius is `--write-registry` only: prove it in a scratch `mkdtemp` tree holding the real
  CLI and the real lib files (including the bridge and the registry exactly as the bridge lane left them) — `--write-registry` must exit 0 with NO refusal for the bridge
  AND the regenerated registry must be byte-identical (sha256) to the checked-in one. **Why RULE A is not predicate 2 above:** "spans the file's FIRST→LAST line" is
  necessary but NOT sufficient — a TRUNCATED file whose remaining bytes still match the region's interior would pass that test; RULE A compares the reconstruction to the
  CURRENT bytes, which is what stops a truncation from ever being registered. The task text is not the authority for this rule: §6 is, and task t6's acceptance carries
  the same wording.

**MEASURED by the guard lane (2026-09-19, scratch root; the real tree untouched):** `mpdDeltaFiles()` builds `registered` from `MPD_DELTAS` and never from disk, so an
enumerated registered-but-missing file IS already visible to `--check`; with `quality-gates.js` deleted in that scratch root, `--check`, `--write` and
`--write-registry` each exited 1 with a RAW `ENOENT ... open '<scratch>/…/quality-gates.js'`. **The defect is the DISPOSITION of an already-enumerated missing file,
not its enumeration** — and this contract must never claim such a file is invisible to the enumeration (that claim is FALSIFIED and is removed from R2(a)).

## 7. Acceptance criteria (each names an existing command; AC1–AC16)

| AC | Falsifiable statement | Verification command (existing paths) |
|---|---|---|
| **AC1** | **All FOURTEEN §3 methods** (the twelve frozen originals + `steerAgentTurn`/`injectAgentMessage`, F2) exist with the frozen name/signature, carry their capability flag (`toolsRegisterHost`, `subagentsProvider`, `subagentsContinuable`, `subagentsInterrupt`, `llmListModels`, `llmResolveCallConfig`, `systemPromptSection`, `agentScope`, `agentTurnStart`, `agentTurnCancel`, `agentTurnSteer`, `agentTurnInject` — the last two CONFIRMED as shipped), and degrade as specified; `bun run typecheck` is clean | `bun test packages/mpd-dsh-adapter-plugin` · `bun run typecheck` |
| **AC2** | `registerHostTool` passes the SAME object reference to `tools.register` (`Object.is`) and preserves the disposer; `registerTool` remains unchanged for its existing consumers | `bun test packages/mpd-dsh-adapter-plugin/test/adapter-agent-teams-surface.test.ts` (NEW file, owner t2) |
| **AC3** | With a recording fake adapter and RAW-ctx seam objects that THROW when touched, the real apply path (`registerAgentTeamsTools` + `installTeamCapabilities` + `installSessionTeamPolicy` + `registerAgentTeamsCommand` + `installInterjectionExpirySweep`) records >0 adapter calls per Class-A seam and ZERO raw-ctx hits. **INSTRUMENT SCOPE (rev-6 F7):** the raw-hit counter covers ONLY the PLUGIN ctx's seam objects; host-provided PER-AGENT ctxs (`childCtx.on(...)` in `members.js`, §2 Class B) and the bridge's own fallback-arm reads are EXEMPT by design — and the assertions must NOT be weakened to accommodate a mis-instrumented fake | `bun test packages/mpd-agent-teams-plugin/test/adapter-routing.test.mjs` (NEW, owner t3) |
| **AC4** | With NO `mpdDsh`: behaviour is today's (raw ctx), exactly ONE absent-warning per plugin instance; with `mpdDsh` present: zero fallback warnings and the mounted witness once; a non-strict-only (pending) probe is NOT reported as absent and is re-probed on the next access | `bun test packages/mpd-agent-teams-plugin/test/adapter-facade.test.mjs` (NEW, owner t3) |
| **AC5** | Every pre-existing test file under `packages/mpd-agent-teams-plugin/test` and `self-fix-tests` is UNMODIFIED and green | `bun test packages/mpd-agent-teams-plugin` · `git status --porcelain -- packages/mpd-agent-teams-plugin/test packages/mpd-agent-teams-plugin/self-fix-tests` shows no ` M ` entry |
| **AC6** | All 21 `agent_teams_*` definitions reaching `tools.register` are byte-identical with and without the adapter (canonical serialization: key sets, non-function JSON values, `String(fn)` for every function) and keep their registration ORDER | `bun test packages/mpd-agent-teams-plugin/test/adapter-tool-parity.test.mjs` (NEW, owner t3) + the boot's `[roles-probe] AGENT_TEAMS_TOOLS=7/7` line |
| **AC7** | Every adopted-file edit is inside a bracketed mpd-delta region (top-level, non-nested, not splitting a declaration); the registry is regenerated, never hand-edited | `node scripts/patch-agent-teams-fixes.mjs --check` (exit 0) · `bun test packages/mpd-agent-teams-plugin/self-fix-tests/registry-context-heal.test.mjs` |
| **AC8** | The registry RESTORES the bridge module: with `lib/mpd-adapter-ctx.js` deleted, `--check` FAILS loudly naming the file, and `--write` recreates it with an identical `sha256` (creation rule = `beforeContext + block + afterContext + "\n"`, D10/D11) | `bun test packages/mpd-agent-teams-plugin/self-fix-tests/mpd-owned-file-restore.test.mjs` (NEW, owner t4) |
| **AC9** | Docs state the CLOSED exception: AGENTS.md §6 (rewritten; §1's adoption bullet gains the seam clause), `docs/design.md` + `docs/design.zh-CN.md` (§"One seam contact surface"), `agent-references/agent-teams-deltas.md` (prose + the exact derived count sentence) and `packages/mpd-dsh-adapter-plugin/README.md` + `.zh-CN.md` (Wrapped-seams table) | `bun run verify:docs` (adjudicates the count against the registry) |
| **AC10** | A real mounting boot proves the mediated tree: adapter row provided, `ADAPTER_SEAMS` contains the new flags, the bridge mounted witness present, the fallback witness ABSENT, 21 `agent_teams_*` tools registered. **DECLARED BOUND (F7, t25):** the boot's evidence is scoped to what it MEASURED — the SEVEN new SERVICE-LEVEL flags true (`toolsRegisterHost`, `subagentsProvider`, `subagentsContinuable`, `subagentsInterrupt`, `llmListModels`, `llmResolveCallConfig`, `systemPromptSection`, all service-presence probes), while the live-registry/live-scoped family is structurally unwitnessable in a session-less boot: the FIVE agent-object flags (`turnSubmit` + `agentTurnStart`/`agentTurnCancel`/`agentTurnSteer`/`agentTurnInject`, every one computed from `liveAgents()`) plus the analogous probes `compaction`, `compactionForAgent` and `agentScope` (also `liveAgents()`-based) answer false there — exactly like the pre-existing `turnSubmit`. That boot's adapter build even PREDATED the four `agentTurn*` keys, so it could not enumerate them either way; those are witnessed by live-session evidence instead. AC10 therefore claims the service-level surface, not the live-registry one | `bun skills/dsh-qa/scripts/bundle-lifecycle.mjs` (unmodified) + greps over its `boot.log` in the verify evidence |
| **AC11** | NEGATIVE CONTROL (falsifiability): with `mpd-dsh-adapter` disabled by an overlay (`- id: mpd-dsh-adapter` + `disabled: true`), the plugin still applies, all 21 tools register, and EXACTLY ONE fallback witness line appears | `node evidence/agent-teams/adapter-wiring/verification/<stamp>/adapter-disabled-boot.mjs` (scratch case in evidence, precedent `evidence/omo-align/team-compact/raw/mount-proof-t48.mjs`) |
| **AC12** | The `mpd` preset still mounts with every harness-owned row config valid | `node skills/dsh-qa/scripts/preset-conformance.mjs` (real run) + `--self-test` |
| **AC13** | The static/aggregate gates are green — **EVIDENCE ANCHOR (t25): the CAPTAIN's FULL `bun run test:qa` run after the re-pin: EXIT 0, final line `[test:qa] all self-tests passed`, captured on disk at `evidence/agent-teams/adapter-wiring/bridge/round2-repair/item1-gates.log` (mtime 2026-09-19T16:00:58Z, which also carries `[verify-gates] member preset-conformance: exit=0 PASS`). The round-1 review correctly noted that it had re-run only the one red case and that a full re-run was still owed; this anchor is that full run, by artifact and not by mailbox** | `bun run verify:gates` · `bun test` · `bun run typecheck` · `bun run test:qa` · `node scripts/verify-dist-fresh.mjs` · `bun run verify:docs` · `bun run verify:rows` |
| **AC14** | The packed artifact is refreshed and closure-proven (freshness read from the `expected-after-pack` list, never from the exit code) | `node scripts/pack-mpd.mjs` then `node scripts/verify-pack-closure.mjs` |
| **AC15** | No bypass remains: a scanner test walks the ten server files, tracks region spans via `MPD_DELTA_MARKERS`, and asserts every Class-A seam access is either inside a region (the six bridged files) or in the bridge's fallback/catch pair — the bridge file is the ONLY module holding raw fallback expressions. **DECLARED BOUND (F4, t25):** that scanner is a BOUNDED HEURISTIC — a candidate-shape rule set, not a completeness proof — and the round-1 review measured no alias, destructuring, bracket-access, `Reflect.get` or second-module spelling of a seam in `lib/` TODAY. **The closure claim therefore rests on the reviewer's independent CENSUS (83 seam sites across 18 server files, 0 unrouted), with the scanner as the future-REGRESSION defence**: a new spelling that evades the rule set would be caught by a re-census, not by this test, and a reader must not mistake the test for a proof of completeness | `bun test packages/mpd-agent-teams-plugin/test/adapter-bypass-inventory.test.mjs` (NEW, owner t3) |
| **AC16** | Verification runs on SETTLED hashes: hash → work → 50 s settle → re-hash, start == end, every verdict quoting the hash WITH its UTC read moment | recorded in `evidence/agent-teams/adapter-wiring/verification/**/result.json` (owner t6) |

**Lane labels in §7 are the CONTRACT's own names; §8's lane-label → team-task-id map is AUTHORITATIVE** (team t4=adapter, t5=bridge, t6=guard, t7=docs, t8=verify,
t9=review, t10=integration) — F3. AC15's Class-B assertion and AC3's instrument scope are stated in their own rows above, not restated here.

## 8. inScope map (frozen; derived paths declared at plan time, one owner each)

| Lane | Task kind | inScope (exact patterns) |
|---|---|---|
| t2 adapter | implementation | `packages/mpd-dsh-adapter-plugin/src/**`, `packages/mpd-dsh-adapter-plugin/test/**`, `packages/mpd-dsh-adapter-plugin/dist/**` (derived, owner), `evidence/agent-teams/adapter-wiring/adapter/**` |
| t3 bridge | implementation | `packages/mpd-agent-teams-plugin/lib/mpd-adapter-ctx.js`, `packages/mpd-agent-teams-plugin/lib/index.js`, `…/lib/capabilities.js`, `…/lib/harness-compat.js`, `…/lib/members.js`, `…/lib/command.js`, `…/lib/tools.js`, `…/lib/mpd-deltas.js` (derived, owner), `packages/mpd-agent-teams-plugin/test/**`, `evidence/agent-teams/adapter-wiring/bridge/**` |
| t4 registry guard | implementation, depends t3 | `scripts/patch-agent-teams-fixes.mjs`, `packages/mpd-agent-teams-plugin/self-fix-tests/**`, `evidence/agent-teams/adapter-wiring/registry-restore/**` |
| t5 docs | implementation, depends t3,t4 | `AGENTS.md`, `docs/design.md`, `docs/design.zh-CN.md`, `agent-references/agent-teams-deltas.md`, `packages/mpd-dsh-adapter-plugin/README.md`, `packages/mpd-dsh-adapter-plugin/README.zh-CN.md`, `evidence/agent-teams/adapter-wiring/docs/**` |
| t6 verify | verification, depends t2,t3,t4,t5 | `evidence/agent-teams/adapter-wiring/verification/**` |
| t7 review | review, depends t6 | `evidence/agent-teams/adapter-wiring/review/**` |
| t8 integration | integration, depends t7 | `dist/mpd-package/**` (derived, owner), `evidence/agent-teams/adapter-wiring/integration/**` |

`MPD_DELTAS`/`lib/mpd-deltas.js` is NEVER edited by hand; `packages/mpd-agent-teams-plugin/README.md`/`README_ZH.md` are verbatim provenance and MUST NOT change.
**`skills/**` — ONE NAMED AUTHORIZED EXCEPTION (t25; reconciles §1 D7 and §9's re-pin rule with what actually happened).** The clause below is NOT a prohibition any more;
it is a prohibition WITH a declared exception, so plan and tree agree:
- **WHY:** the wave's QA-corpus defect **V-1** (the credentials merge emitted a duplicate top-level `refs:` for an inline mapping) reddened the REAL
  `preset-conformance` and `bun run test:qa` — i.e. exactly the gates AC12/AC13 need — so leaving `skills/**` untouched would have left those ACs unsatisfiable.
- **WHAT WAS AUTHORIZED (captain's explicit authorization, ONE writer, bounded set):** `skills/dsh-qa/scripts/lib/credentials.mjs` (the merge fix) plus
  `skills/dsh-qa/scripts/agent-teams-dispatch.mjs`, added by mid-task amendment to update TWO stale static assertions that had encoded the PRE-bridge source spellings of
  call sites the bridge rewired.
- **THE SINGLE RE-PIN:** the wave's one `VENDOR_LOCK.json` re-pin landed in the SAME change as those two files (the §9 single-writer/one-re-pin invariant is intact, not
  violated) — facts, moments and gate transitions in §12 addendum A5.
- **NOT OPENED BY THIS:** the exception covers those two files and that re-pin only; any FURTHER `skills/**` edit still needs its own authorization and its own single
  re-pin. `skills/**` is otherwise untouched by this wave.
**Lane labels used in §5 (and throughout this contract) are the CONTRACT's
own names; §8's lane-label → team-task-id map is AUTHORITATIVE** (team t4=adapter, t5=bridge, t6=guard, t7=docs, t8=verify, t9=review, t10=integration) — F3.

**Lane labels vs shared-task ids (added in revision 3; measured 2026-09-19 against the live task list).** The `t2…t8` labels in the table above are the CONTRACT's
lane names, NOT the team's shared-task ids — the two numbering systems differ, and a reader must map by SUBJECT before amending a task. Live mapping:
**t2 adapter → task t4 · t3 bridge → task t5 · t4 registry guard → task t6 · t5 docs → task t7 · t6 verify → task t8 · t7 review → task t9 · t8 integration → task t10**
(contract `t1` = task t1, the requirements seat; the repair of this document was carried by task t11). Every acceptance statement of the form "§10's t3/t4 lines"
therefore means **task t5 (bridge)** and **task t6 (registry guard)**.

## 9. Residuals (explicit, so the review judges them as decisions rather than omissions)

- **R1** Adapter-mediated registrations (`tools.register`, `commands.register`, `systemPrompt.section`, `onEvent`) are owned by the ADAPTER row's fiber, not the
  plugin's. Consequence: a plugin-only unload would not revoke them. Accepted: both rows share the boot lifetime and there is no plugin-module hot reload (T-21).
- **R2** The retired-member guard still PATCHES the object `subagentRuntime()` returns (D6 keeps delivery policy in the plugin). The adapter owns the RESOLUTION only.
- **R3** `lib/client.js` (browser bundle) keeps its own calls: out of scope by D7; its export bridge is already guarded by `scripts/patch-agent-teams-client.mjs`.
- **R4** `liveAgent`/`liveAgents`/`onEvent` swallow-and-degrade where the raw ctx would throw. Intentional (the adapter's never-crash contract); not a parity violation.
- **R5** The docs count sentence uses the word "adopted" for a file list that now includes one mpd-owned module; the gate regex is FIXED, so the sentence must keep
  its exact wording with the new numbers and the prose right after it explains the mpd-owned bridge (re-wording the sentence reddens `verify:docs`).

## 10. Contract checklist (a lane is done only when every box it owns is ticked, with evidence on disk)

- [ ] t1: this artifact exists under `evidence/**` and cites the measured inventory (DONE).
- [ ] t2: AC1, AC2; `packages/mpd-dsh-adapter-plugin/dist/index.js` rebuilt with the repo-root canonical `bun build` form.
- [ ] t3: AC3, AC4, AC5, AC6, AC7, AC15; regions land; the registry is REGENERATED with `--write-registry` after every region change (it is the only writer and its format is UNCHANGED — no `create` key, no emitter change, and nothing depended on it emitting a new key; the RUN COUNT is not a term — the landed lane ran it three times; the create-on-missing rule is NOT t3's); bridge file shape per §6.
- [ ] t4: AC8; the THREE guard changes of §6 — **(a)** an explicit `existsSync` disposition branch for an enumerated-but-missing registered file: `--check` fails loudly naming the file, `--write` creates it, and no path reaches a bare `readFileSync` on a missing path (the reads at ~:409/~:520); **(b)** `--check` on such a missing file FAILS LOUDLY naming the file, never a raw ENOENT; **(c)** `--write` CREATES such a file byte-faithfully (one trailing newline) and, for every OTHER missing registered file, still fails loudly by name and never crashes with ENOENT — **PLUS the four frozen predicates of §6**: create class = `lib/mpd-*.js` EXCLUDING `lib/mpd-deltas.js`; "reconstructs it entirely" = exactly ONE entry for that file and `beforeContext + block + afterContext` spanning its FIRST→LAST line, anything else a loud FAIL and never a partial create; a created file is RE-VERIFIED and DELETED on failure with a non-zero exit naming the file (no half-restored tree), one trailing newline asserted; `--write-registry` on a missing registered file is a loud named FAIL telling the caller to run `--write` first. All of it proven by `packages/mpd-agent-teams-plugin/self-fix-tests/mpd-owned-file-restore.test.mjs`; no hand edit of the registry and no registry rewrite by this lane.
- [ ] t5: AC9; the count sentence is transcribed from the registry AFTER t4 (measure, never guess); no new rows in the A1–D42 table (the derived range must not move).
- [ ] t6: AC10, AC11, AC12, AC13, AC16; settled hashes quoted with their measurement moment.
- [ ] t7: review against THIS contract (AC-by-AC), not against the brief.
- [ ] t8: AC14; pack refreshed; deliverable presented.


### 2.1 Per-file roll-up of Class-A (routed) accesses — the acceptance item's ten server files, explicitly including the zeros

| File | Class-A accesses (count) | Adapter destination |
|---|---|---|
| `lib/tools.js` | `tools.register` 21 · `agents.get` 2 · `captain.followup` 1 · `captain.cancel` 4 · `captain.inject` 1 (rev-6 F2) = **29** | `registerHostTool` · `liveAgent` · `startAgentTurn` · `cancelAgentTurn` · `injectAgentMessage` |
| `lib/members.js` | `agents.get` 3 · `subagents.getProvider` 1 · `subagents.list` 1 · `subagents.startContinuable` 1 · `subagents.interrupt` 1 · `subagents` rung as runtime 1 · `captain.steer` 1 (rev-6 F2) = **9** | `liveAgent` · `subagentProvider` · `subagentProviders` · `startContinuableAgent` · `interruptAgent` · `subagentRuntime` · `steerAgentTurn` |
| `lib/scheduler.js` | `agents.get` 2 · `ctx.on('agent/status')` 1 = **3** | `liveAgent` · `onEvent` |
| `lib/index.js` | `agents.get` 2 · `ctx.on('internal/service')` 1 · `captain.steer` 1 (rev-6 F2, in `haltTeamWork`) = **4** | `liveAgent` · `onEvent` · `steerAgentTurn` |
| `lib/capabilities.js` | `agents.list` 1 · `systemPrompt.section` 1 · `agent.ctx.tools.restrict` 1 · `agent.ctx.effect` 1 · `ctx.on('agent/session-start')` 1 = **5** | `liveAgents` · `registerPromptSection` · `agentScope().tools.restrict` · `agentScope().effect` · `onEvent` |
| `lib/command.js` | `commands.register` 2 · `ctx.on('agent/pre-step')` 1 · `invocation.agent.followup` 2 = **5** | `registerCommand` · `onEvent` · `startAgentTurn` |
| `lib/session-start.js` | `ctx.on('agent/pre-step')` 2 = **2** | `onEvent` (edit-free: the file receives the facade) |
| `lib/harness-compat.js` | `ctx.subagents` 2 · agent scope (`context` 1, `on('agent/request')` 1, `effect` 1) 3 · `ctx.get('agents').get` 1 · `ctx.on('agent/session-start')` 1 = **7** | `subagentRuntime` · `agentScope` · `agents.get` · `onEvent` |
| `lib/snapshot.js` | **0** | logger-only (Class B) — listed so the zero is a measured statement, not an omission |
| `lib/events.js` | `agents.get` 1 = **1** | `liveAgent` |
| **total** | **65** (was 62 before revision 6 added the five previously invisible Agent-method calls: three Class-A `steer`/`inject` sites + two Class-B `whenIdle` sites, of which only the three Class-A ones enter this total) | — |

Edit-free files (they receive the facade and need NO region): `tools.js` for every seam EXCEPT the four `followup`/`cancel` call sites, `members.js` except the runtime-pass line,
`scheduler.js`, `session-start.js`, `snapshot.js`, `events.js`, `state.js`, `profiles.js`, `quality-gates.js`, `web-routes.js`.
Edited adopted files: `index.js`, `capabilities.js`, `harness-compat.js`, `members.js`, `command.js`, `tools.js` (six, matching §5 exactly).


---

## 11. ERRATA / revision log — **revision 3 is applied IN PLACE** (§2 `ctx.on` Count cell, §3 citation roots, §6 registry paragraph, §8 t4 row, §10 t3/t4 lines, D10) (added by the same seat before completion; supersedes only the lines named)

**Reason:** acceptance item 6 of this task forbids any two write tasks sharing an inScope pattern. §8 as first written let t4 share `lib/mpd-deltas.js` with t3
(justified by the platform's dependency carve-out `if (dependencies.includes(other.id)) continue` in `packages/mpd-agent-teams-plugin/lib/quality-gates.js` `validateTaskInput`).
Measured correction below removes the sharing entirely by deriving ownership from the FILE NAME instead of a new registry field. **Revision 3 (this repair, task t11)
applies every correction to the sections themselves**, so the tables above are the single authority and no reader has to reconcile a stale row against a later errata.

- **E1 (RE-WORDED in revision 3 — the contradiction it recorded is now RESOLVED IN PLACE, not carried forward).** The old §6 sentence "it emits `create: true`
  for entries of `lib/mpd-*.js` files" and the old D10 clause that required it are DELETED; **option (b) is the frozen choice**. mpd-owned-ness is derived from the
  FILE NAME (`packages/mpd-agent-teams-plugin/lib/mpd-*.js`) at HEAL time inside the applier, so (i) no `create` key exists anywhere, (ii) `--write-registry` needs NO
  emitter change and its five-key format is intact, and (iii) no lane is a second registry writer. The create-on-missing rule therefore has exactly ONE owner:
  **lane t4** (§6 + §10, and §8 lists t4's paths without the shared pattern). E1 no longer asserts "no emitter change" while §6 requires the flag — §6, D10 and §10
  now all say the same thing: **no flag and no emitter change**.
- **E2 — the §8 t4 row, APPLIED IN PLACE in revision 3.** t4's inScope is exactly: `scripts/patch-agent-teams-fixes.mjs`,
  `packages/mpd-agent-teams-plugin/self-fix-tests/**`, `evidence/agent-teams/adapter-wiring/registry-restore/**` — and the §8 table above now carries exactly that
  list, with the "shared with t3" parenthetical DELETED, so the table is the single scope authority. No path is shared between any two write tasks; t4's dependency
  on t3 stays a real prerequisite (it consumes the bridge file and its registry entry) but is no longer a scope carve-out. Every other §8 row is unchanged.
- **E3 — expanded in revision 3 and aligned with the CORRECTED R2 (see §6 and §12, which are authoritative for the rule).** A MISSING registered file is CREATED by
  `--write` only when its basename matches `mpd-*.js` (EXCLUDING `lib/mpd-deltas.js`, the derived registry) AND its registry entries reconstruct it entirely — exactly
  ONE entry for that file and `beforeContext + block + afterContext` spanning the file's FIRST→LAST line, one trailing newline — with anything else a LOUD FAIL naming
  the file and never a partial create; a created file is re-verified and DELETED on failure with a non-zero exit naming the file; every OTHER missing registered file
  keeps failing LOUDLY naming the file (re-vendor remedy); `--check` FAILS naming a registered-but-absent file instead of raising the raw ENOENT that `readFileSync` at
  `scripts/patch-agent-teams-fixes.mjs` line 409 produces today; `--write-registry` meeting a missing registered file is itself a loud named FAIL telling the caller to
  run `--write` first; and BOTH arms handle a wholly missing FILE, not merely a missing REGION. All three arms are proven by
  `packages/mpd-agent-teams-plugin/self-fix-tests/mpd-owned-file-restore.test.mjs` (AC8's named test); AC8's byte-equality (sha256) requirement and its command are
  unchanged.
- **E4 — clarification, no change.** AC11's overlay uses the patch-layer row key `disabled: true`, whose precedent is the home patch written by
  `scripts/install-profile.mjs` (`if (r.disabled !== undefined) body.push(... "disabled: " + JSON.stringify(r.disabled))`), applied through the QA `--patch` flag the
  existing boot case already uses (`skills/dsh-qa/scripts/bundle-lifecycle.mjs` writes `probe.yml` with `- insert:`) — the control adds a `- id: mpd-dsh-adapter` row
  carrying `disabled: true`.
- **E5 — CORRECTED in revision 6 (measured falsification by the adapter lane).** AC13's `bun run verify:rows` and `node scripts/verify-dist-fresh.mjs` are expected
  GREEN **after the canonical rebuild of EVERY package that bundles the adapter source**: editing `packages/mpd-dsh-adapter-plugin/src/index.ts` invalidates the `dist/`
  of every package that imports that source (bun bundles it into each consumer's artifact). MEASURED: **17 packages** import `../../mpd-dsh-adapter-plugin/src/index`
  from `*/src` and each has a committed `dist/index.js` (independently re-counted by this seat 2026-09-19T14:36Z: mpd-bootstrap, mpd-boulder, mpd-codegraph,
  mpd-comment-checker, mpd-config, mpd-ext, mpd-hashline, mpd-memory, mpd-modelchain, mpd-qa-roles-probe, mpd-roles, mpd-team-compact, mpd-team-watchdog, mpd-tools,
  mpd-tui, mpd-ulw, mpd-workmate — and `packages/mpd-roles-plugin/dist/index.js` carries the bundled adapter symbol `createLazyDshAdapter`, the byte-causality witness),
  and `node scripts/verify-dist-fresh.mjs` reports those **17 packages STALE** until they are rebuilt; the adapter lane proved byte-causality the other way too: with
  HEAD's adapter `src`, the same rebuilds reproduce the committed dists byte-identically. **The contract therefore expects** `verify-dist-fresh` GREEN after the
  canonical 17-package rebuild (repo-root `bun build` form, AGENTS.md §6), and **t4 owns those derived paths** (the T-88 hop rule: declare a derived path on the task
  whose edits redden it). The superseded claim — "the only rebuilt dist is `packages/mpd-dsh-adapter-plugin/dist/index.js`" — was FALSE and is deleted.
  **LIVE WITNESS (this seat, 2026-09-19T14:39:40Z, read-only):** with the adapter `src` modified, `git status` lists exactly **18** modified `packages/*/dist/index.js`
  (the adapter's own + the 17 consumers) and `node scripts/verify-dist-fresh.mjs` prints `ok: 20/20 targets fresh (each rebuilt twice, byte-identical)` — the canonical
  rebuild has been performed, so the corrected expectation holds in the live tree.

Everything else in this contract (D1–D9, D11, D12, §1–§7 and §9–§10 apart from the lines revision 3 corrected) stands as frozen. **Revision 3 supersedes revision 2 in
full:** wherever revision 2 described a correction, revision 3 applied it to the section itself, so §2/§3/§6/§8/§10 above are authoritative on their own.

---

## 12. CAPTAIN RULING transcribed (2026-09-19, on t2's plan-review findings; applies R1–R5)

**Authority:** the captain's ruling on t2's findings, transcribed in effect — the mechanism is exactly the one the ruling names, not a re-invention. These `R1…R5`
labels are the RULING's and are **distinct from §9's residual ids `R1…R5`** (the residual set is UNCHANGED). Nothing else moves: **every AC command above is
unchanged**, and D1–D9, D11, D12 stay frozen.

| Ruling | Applied where | Frozen text |
|---|---|---|
| **R1 — F1: DROP the emitter** | §1 D10 (re-worded again) and §6's registry paragraph | There is **NO `create` field and NO `--write-registry` emitter change**; the registry SCHEMA is exactly the five existing keys. mpd-owned-ness is derived from the FILE NAME (`packages/mpd-agent-teams-plugin/lib/mpd-*.js`) **plus FULL reconstruction from that file's registry entries** (`beforeContext + block + afterContext + "\n"`, exactly one region) — no registry field can be relied on because there is none. Consequence stated in §6: the bridge lane (contract t3 / team t5) REGENERATES the registry with `--write-registry` after every region change (never by hand, and the RUN COUNT is not a term — the landed lane ran it three times) with the unchanged schema — **no projection of the resulting count is frozen** (F10-i: §6 carries the MEASURED state WITH its moment plus the re-measure rule, and this row freezes no number of its own) — and nothing depended on it emitting a new key. Ownership: the missing-file behaviour belongs SOLELY to the guard lane (contract t4 / team t6, inScope `scripts/patch-agent-teams-fixes.mjs`) |
| **R2 — F2: the three guard changes (CORRECTED by the captain after the guard lane's measurement — the earlier union-with-disk wording of (a) is FALSIFIED and removed)** | §6's guard list and §10's t4 checklist line | **(a)** "an explicit `existsSync` disposition branch for an enumerated-but-missing registered file: `--check` fails loudly naming the file, `--write` creates it, and no path reaches a bare `readFileSync` on a missing path (the reads at ~409 and ~520)"; **(b)** `--check` on a missing registered file FAILS LOUDLY naming the file — never a raw ENOENT; **(c)** `--write` CREATES such a file byte-faithfully (one trailing newline) and, for every other missing registered file, still fails loudly by name and never crashes with ENOENT. **PLUS four frozen predicates:** create class = `lib/mpd-*.js` EXCLUDING `lib/mpd-deltas.js` (the derived registry is never restored from its own entries); "reconstructs it entirely" = exactly ONE registry entry for that file AND `beforeContext + block + afterContext` spanning the file's FIRST→LAST line, anything else a LOUD FAIL naming the file and never a partial create; after a create the guard RE-VERIFIES the created bytes and, on failure, DELETES what it created and exits non-zero naming the file (no half-restored tree), asserting exactly one trailing newline; `--write-registry` meeting a missing registered file is a LOUD named FAIL telling the caller to run `--write` first (a regeneration must never silently drop a missing file's entries) |
| **R3 — F4: the scope row** | §8's t4 row (edited in place in revision 3; restated here because the ruling asks for one authority) | `scripts/patch-agent-teams-fixes.mjs`, `packages/mpd-agent-teams-plugin/self-fix-tests/**`, `evidence/agent-teams/adapter-wiring/registry-restore/**`. **NO path is shared between any two write tasks; the dependency t4→t3 is a real prerequisite, not a scope carve-out.** The "lib/mpd-deltas.js shared with t3" wording is deleted from the table, which agrees with §11 E2 |
| **R4 — F3: shape-citation roots** | §3's "Two resolution roots, one spelling each" note | `_deps/<pkg>/lib/...` for modules inside the adopted plugin's runtime closure; the INSTALLED HARNESS path for services the plugin receives by INJECTION rather than from `_deps`, with the explicit note that `dsh-system-prompt` is NOT in the plugin's `_deps` closure and arrives through its own `inject` list. No behaviour change: the ADAPTER LANE (contract t2 / team t4) verifies each shape against the installed harness and RECORDS the path it actually verified |
| **R5 — F5: the Count cell** | §2's `ctx.on` row (already 8 in revision 3) | Count = **8**, agreeing with §0 and §2.1's per-file roll-up |

**Measured note — SUPERSEDED by the guard lane's own measurement, which the captain confirmed and which corrected R2(a):** `mpdDeltaFiles()` builds its `registered`
half from `MPD_DELTAS` and NEVER from disk, so a registered-but-missing file IS enumerated for `--check`; in a scratch root with `quality-gates.js` deleted, `--check`,
`--write` and `--write-registry` each exited 1 with a RAW `ENOENT ... open '<scratch>/…/quality-gates.js'`. The defect is the DISPOSITION of an already-enumerated
missing file (the reads at ~:409/~:520), NOT its enumeration — and no sentence in this contract may claim such a file is invisible to the enumeration. The bridge lane's
own obligation is unchanged: land the regions, then `--write-registry` once.

**Addendum A1 (t13 repair round 3, 2026-09-19T14:34Z):** §1 **D11** and §6's bridge-file paragraph now state the skeleton-line rule as **LOAD-BEARING**: the two skeleton
lines MUST be textually DIFFERENT strings, because each half of the context pair MUST occur EXACTLY ONCE in the region-stripped skeleton — an identical pair makes both
halves ambiguous and the bridge UNREGISTERABLE. This is the clarification t5's lane (the author of `lib/mpd-adapter-ctx.js`) implements to; t5's own contract already
says "exactly ONE different trailing comment skeleton line", which matches. No AC command changed.

---

## 13. Revision log + hash chain (every hash quoted WITH its UTC read moment)

**LABEL POLICY (the captain's ruling relayed with this batch, 2026-09-19):** the `rev N` numbers in this document are this seat's HISTORICAL labels and are
**COSMETIC**. A batch is identified by its CONTENT — **F1** `agentScopeOf` shape · **F2** `steer`/`inject` routing + `whenIdle` Class B · **F7** AC3 instrument scope ·
**F3** lane-label pointers · **E5** dist invalidation · **F9** RULE A · **F10** measured registry pair. Where a lane must cite a batch, cite the FINDING ID, never a
revision number.

| Revision | What changed | sha256 of this document | lines | read at (UTC) |
|---|---|---|---|---|
| rev 2 (t1 + its errata) | first frozen contract | `24e4c63a894315fbc122d17f024a13ca1b193f106b1c1a9ce1228dc615b16e69` | 272 | 2026-09-19T14:22:47Z |
| rev 3 (t11) | the five in-place amendments | `528110151b6ce4f6091ee8d97cd2a89fbd0ce09d6f70375de8b0ff2d1be3bef9` | 307 | 14:25:59Z (re-read 14:26:20Z identical; review t12 re-read identical 14:27:42Z → 14:28:19Z) |
| rev 4 (captain ruling R1–R5) | §12 + D10/§6/§3/§10 aligned | `5edfc12ab1279d9935811360be976e65a39ba9f23d66a05ab64109f41842ed53` | 338 | 14:29:10Z |
| rev 5 (R2(a) correction) | §6 (a) rewritten; four create predicates; §10/§11-E3/§12 aligned | `ae4a76c3ea75b7e378b268a0dbc13ac5291f96f8b5798f3769b9f9caf7975a27` | 354 | 14:31:42Z (re-read 14:33:40Z identical) |
| t13 addendum A1 | D11/§6 skeleton-line rule LOAD-BEARING | `1f5b559805a90bc696aa21bf1b59c15c68713aaca33ac7961e0c4a228c53770d` | 364 | 14:34:41Z (re-read 14:34:53Z identical) |
| **the F1/F2/F7/F3/E5 batch (task t15; "rev 6" is only this seat's alias)** | F1 (§4 `agentScopeOf`, corrected + defect recorded), F2 (D8/§2/§3 `steer`/`inject` routed, `whenIdle` Class B), F7 (AC3 instrument scope), F3 (§4/§5/§7 pointers), E5 corrected, this §13 | `0c5f977c0066ac4ea667ffacf3fd5f0c7611929b7f099de475253c3df98de7d5` (415→418-line state before the F9/F10 edits) | 418 | read 2026-09-19T14:40:26Z, re-read 14:40:40Z identical |
| **the F9/F10 batch (task t15, revision 5 of its contract; landed after the F1/F2/F7/F3/E5 batch)** | F9 RULE A promoted into §6 (truncation guard), F10-i §6 registry state corrected to the then-current read (146/13, HISTORICAL — superseded by t19), F10-ii D11 label aligned to addendum A1, plus §12 addendum A2 and this label policy | **= this document; the external anchor for its hash is the delta record** | see the delta record | recorded in `evidence/agent-teams/adapter-wiring/revision-3-delta.md` |
| **the additive §3/AC1 delta (same revision, from the adapter lane's completed work)** | §3 rows 13/14 cited against the INSTALLED harness (`dsh-agent-loop` `steer`@:792 / `inject`@:795, not vendored; `dsh-agent` declarations :200/:209; vendored twins :123/:132), AC1 counted at FOURTEEN with the four shipped `agentTurn*` flags, §2's steer/inject/`whenIdle` rows re-anchored by SYMBOL with witnesses re-measured 2026-09-19T14:45Z, §12 addendum A3 | **= this document; the external anchor for its hash is the delta record** | see the delta record | recorded in `evidence/agent-teams/adapter-wiring/revision-3-delta.md` |
| **the §5 measured-ids correction (same revision)** | §5's projected id list replaced by the MEASURED set (23 registered `adapter-*` regions: 22 on-disk markers over the six bridged files + `adapter-ctx-bridge`), with the three stability/authority/re-measure rules and the growth caveat; §12 addendum A4 | **= this document; the external anchor for its hash is the delta record** | see the delta record | recorded in `evidence/agent-teams/adapter-wiring/revision-3-delta.md` |

**Self-reference rule (why rev 6 has no inline hash):** a document cannot carry the hash of itself — adding the value changes it. The chain is therefore anchored
EXTERNALLY: every revision whose bytes are already frozen carries its hash inline (rev 2…A1 above), and the CURRENT revision's hash lives in
`evidence/agent-teams/adapter-wiring/revision-3-delta.md`, which is written after the last edit of this file. The acceptance's chain
(24e4c63a → 528110151b → 5edfc12a → ae4a76c3 → new) is complete in that record; the t13 addendum A1 link is inserted here in its true position because the
acceptance's chain predates it. Every read named in the table was settled: re-read after a pause with no writer active on this document (only this seat has ever
written it), and t12's independent sandwich is named where it exists. **Lane labels are the CONTRACT's; §8's map is authoritative — F3.**

**Addendum A2 (F9 + F10, landed after the F1/F2/F7/F3/E5 batch, on the t15 contract's revision 5):**
- **F9** — RULE A now lives in **§6** (the truncation guard: `--write-registry` refuses to register a create-class file unless the reconstruction equals the CURRENT file
  bytes exactly), with the explicit note that §6 is the authority and task t6's acceptance carries the same wording. A reviewer judging "against the frozen contract" no
  longer has to read a task text to find it.
- **F10-i** — §6's registry projection is replaced by the MEASURED pair (146 entries / 13 files at 2026-09-19T14:42:29Z, five keys, zero `create` keys — that read is HISTORICAL, superseded by the t19 re-measure recorded in §6: 151 / 13 at 2026-09-19T15:04Z), with the docs
  lane instructed to re-measure at ITS landing time.
- **F10-ii** — the D11 source label and §12's addendum name are aligned to ONE label: **addendum A1**.
- The label policy above (content over numbering) is part of this addendum. No AC command changed.

**Addendum A3 (additive delta from the adapter lane's completed work, same revision):** §3 rows 13/14 now carry the INSTALLED-harness citations as well as the vendored
twins (`dsh-agent-loop/lib/index.js` `steer` @ :792 and `inject` @ :795 — that package is NOT vendored, so no `_deps` spelling exists; `dsh-agent/lib/types/runtime-types.d.ts`
declarations @ :200/:209 installed vs @ :123/:132 vendored), the shipped capability flags (`agentTurnSteer`, `agentTurnInject`) are recorded as CONFIRMED, **AC1 counts the
adapter surface at FOURTEEN methods**, and §2's three Class-A rows plus the `whenIdle` Class-B row are re-anchored by SYMBOL with witnesses re-measured at 2026-09-19T14:45Z
(the `inject` LINE had drifted :674 → :681 as t5's regions landed; the SYMBOL did not). No AC command changed.

**Addendum A4 (§5 ids: projection SUPERSEDED by measurement, same revision):** §5's "region ids are frozen names" list is replaced by the ids MEASURED on
**2026-09-19T14:47:20Z** (markers in the six bridged files, cross-checked against `MPD_DELTAS`) — 23 registered `adapter-*` regions in a registry of 146 entries / 13 files. **That snapshot is HISTORICAL: the t19 re-measure (2026-09-19T15:04Z, §5/§6) reads 28 markers / 27 distinct ids and 151 entries / 13 files after the bridge lane's F1/F2 landing.**
The implementation landed MORE GRANULAR ids than projected and added import-carrier regions (`adapter-facade-import`, `adapter-agent-scope-import`,
`adapter-subagent-runtime-import`, `adapter-delivery-runtime-import`, `adapter-command-turn-submit-profile`, four `adapter-subagent-runtime-agent-scope*` siblings, and in
`tools.js` `adapter-cancel-{halt,feedback,discard}` plus two ids the projection never named: `adapter-subagent-runtime-import`, `adapter-subagent-runtime-halt-drain`). No
rename was requested — region ids are internal and the landed set is strictly more precise. §5 now states the three rules (ids are STABLE once landed; the REGISTRY is their
authority; a later revision RE-MEASURES with a fresh UTC moment), and records the growth caveat (F2 may still add up to three regions at the `steer`/`inject` call sites).
No AC command changed.

**Addendum A5 (t25 — the authorized `skills/**` exception, the single re-pin, and its gate transitions; every value MEASURED by this seat on 2026-09-19T16:01–16:02Z unless noted):**

- **The exception's cause is a gate blocker, not a preference:** the wave's QA-corpus defect **V-1** (the credentials merge emitting a REMOVAL of the inline `refs: {...}`
  mapping instead of an edit, i.e. a duplicate top-level `refs:`), which reddened the REAL `preset-conformance` (the boot died in a YAML parse error) and
  `bun run test:qa` — the gates AC12/AC13 depend on.
- **The authorized change set (ONE writer, two files):** `skills/dsh-qa/scripts/lib/credentials.mjs` (`mergeRefsEntry` now matches every top-level `refs:` shape; single-line
  inline mappings are edited INSIDE the braces so pre-existing entries survive verbatim; non-editable forms are refused LOUDLY instead of emitting a second top-level
  `refs:`) plus `skills/dsh-qa/scripts/agent-teams-dispatch.mjs`, added by mid-task amendment to update TWO stale static assertions that encoded the PRE-bridge source
  spellings of call sites the bridge rewired.
- **The single re-pin (the §9 invariant, intact):** `VENDOR_LOCK.json` assets `skills` — `fileCount` 326 — `treeSha`
  **`e944e320b3ffa45af9aa98f14a33e570903e35914a00c275f85aef98286f2058` → `82f38bd828bc1bf22c25db9e0ee02a2b0b98d168915c1a71e9375e3778cc8f4f`**, one field/one line changed; the
  re-pinned `VENDOR_LOCK.json` measures sha256 **`fc6f8aa34771faba879a4c448ce837dac506ffb461bd8c0586adbe406e3672fb`** (the reviewer's value, re-measured here) and lands in the
  SAME commit as the two skills files (`git status`: ` M VENDOR_LOCK.json`, ` M skills/dsh-qa/scripts/lib/credentials.mjs`, ` M skills/dsh-qa/scripts/agent-teams-dispatch.mjs`).
- **Gate transitions:** `node scripts/verify-vendor.mjs` exit **1 → PASS exit 0** (re-measured by this seat 2026-09-19T16:01:55Z); `bun run verify:gates` **1/5 failed → PASS 5/5**.
- **AC13's anchor:** the captain's FULL `bun run test:qa` after the re-pin → **exit 0**, final line **`[test:qa] all self-tests passed`**, captured at
  `evidence/agent-teams/adapter-wiring/bridge/round2-repair/item1-gates.log` (mtime 2026-09-19T16:00:58Z; the same log carries `[verify-gates] member preset-conformance: exit=0 PASS`).
- **Scope bound:** the exception covers those two files and that one re-pin. Any further `skills/**` edit needs its own authorization and its own single re-pin; `skills/**` is
  otherwise untouched by this wave.
