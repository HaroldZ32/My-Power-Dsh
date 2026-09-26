# Harness-shape verification for the adapter's agent-teams surface (t4, answer to the plan review's F3)

Seat: Deep Worker · task t4 (contract lane t2) · attempt `a0d5fe92-c983-41dd-a93f-25dee8b0d17c` · measured 2026-09-19.

Every harness shape `packages/mpd-dsh-adapter-plugin/src/index.ts` binds to for the contract §3 seam
methods — **and for the two the captain's later ruling added (§3 rows 13–14 below, extending D8)** —
was re-verified against the **INSTALLED harness**, not against the contract's §3 citation
(captain relay of plan review F3). Where the contract's citation root did not resolve, the SIGNATURE
was kept — it is the frozen authority — and the correct path is recorded below.

`HS = /root/.nvm/versions/node/v24.16.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`

## 0. Root discipline (the F3 point, measured)

| Root | What lives there | Evidence |
|---|---|---|
| `HS/<pkg>/lib/{index.js,types/*.d.ts}` | the **injected harness services** the plugin receives from the host composition (`tools`, `subagents`, `llm`, `systemPrompt`, `agents`) | every binding in the table below resolves here |
| `packages/mpd-agent-teams-plugin/_deps/<pkg>/...` | the adopted plugin's **runtime closure** (import-time modules it bundles): measured present = `cordis, cosmokit, dsh-agent, dsh-llm, dsh-scope, dsh-session, dsh-subagent, dsh-timeout, dsh-tools, schemastery, standard-schema, zod` | `ls packages/mpd-agent-teams-plugin/_deps/` |
| `systemPrompt` | **NOT in the closure at all** — it is an INJECTED service (`packages/mpd-agent-teams-plugin/lib/index.js:45` `export const inject = ['tools','llm','subagents','systemPrompt','agents']`) | `_deps/` listing has no `dsh-system-prompt`; the contract's `_deps/...` form would not have resolved |
| the Agent's turn METHODS | declared on the Agent interface in `dsh-agent`'s types, **implemented in `dsh-agent-loop`**: `grep -c "followup(\|cancel(cause" HS/dsh-agent/lib/index.js` = **0** | see rows 11–12 |

Two packages exist twice on purpose (`dsh-tools`, `dsh-subagent`): the installed harness copy is what
the **adapter** reaches through `ctx`; the `_deps/` copy is what the **adopted plugin** imports at
module load. Line numbers differ (e.g. `register(definition)` = `HS/dsh-tools/lib/index.js:2773` vs
`_deps/dsh-tools/lib/index.js:2762`), which is exactly why a single-path citation is not enough.

## 1. The twelve bindings

| # | adapter method (frozen name) | binds to | installed-harness declaration (`HS/<pkg>/…`) | installed-harness runtime | `_deps` copy | verified by |
|---|---|---|---|---|---|---|
| 1 | `registerHostTool(definition)` | `tools.register` | `dsh-tools/lib/types/index.d.ts:601 register(definition: ToolDefinition): () => void` | `dsh-tools/lib/index.js:2773 register(definition) {` | `_deps/dsh-tools/lib/index.js:2762` | grep on both roots |
| 2 | `subagentRuntime()` | the `subagents` service OBJECT (identity, no member call) | — | resolved by `ctx.get("subagents")` | `_deps/dsh-subagent/**` | identity asserted in test |
| 3 | `subagentProvider(name)` | `subagents.getProvider` | `dsh-subagent/lib/types/index.d.ts:278 getProvider(name: string): SubagentProvider \| undefined` | `dsh-subagent/lib/index.js:3123 getProvider(name) {` | `_deps/dsh-subagent/lib/index.js:2587` | grep + receiver-capturing test |
| 4 | `subagentProviders()` | `subagents.list` | `dsh-subagent/lib/types/index.d.ts:283 list(): string[]` | `dsh-subagent/lib/index.js:3130 list() {` | `_deps/dsh-subagent/lib/index.js:2594` | grep + test |
| 5 | `startContinuableAgent(spec)` | `subagents.startContinuable` | `dsh-subagent/lib/types/index.d.ts:117 startContinuable(spec: ContinuableStartSpec): Promise<ContinuableStart>` (also `types/continuation.d.ts:46`) | `dsh-subagent/lib/index.js:2881 async startContinuable(spec)` (inner `:1643`) | not needed | grep + test |
| 6 | `interruptAgent(targetSessionId, authority)` | `subagents.interrupt` | `dsh-subagent/lib/types/index.d.ts:161 interrupt(targetSessionId: SessionId, authority: SubagentInterruptAuthority): void` | `dsh-subagent/lib/index.js:2931 interrupt(targetSessionId, authority)` (inner `:1825`, `:853`) | not needed | grep + test |
| 7 | `llmListModels(provider)` | `llm.listModels` | `dsh-llm/lib/types/index.d.ts:344 listModels(provider: string): Promise<LlmModelInfo[]>` | `dsh-llm/lib/index.js:2018 async listModels(provider)` | `_deps/dsh-llm/**` | grep + test |
| 8 | `llmResolveCallConfig(config, signal?)` | `llm.resolveCallConfig` | `dsh-llm/lib/types/index.d.ts:368 resolveCallConfig(config: LlmCallConfig, signal?: AbortSignal): Promise<LlmCallConfig>` | `dsh-llm/lib/index.js:2103 async resolveCallConfig(config, signal)` | `_deps/dsh-llm/**` | grep + test |
| 9 | `registerPromptSection(section)` | `systemPrompt.section` | `dsh-system-prompt/lib/types/index.d.ts:233 section(section: PromptSection): () => void`; `PromptSection` at `:47` (`{name, order, text, complete?}`) | `dsh-system-prompt/lib/index.js:238 section(section) {` | **ABSENT (injected service, F3)** | grep on the INSTALLED path only |
| 10 | `agentScope(agent)` | `agent.ctx` members: `tools.restrict`, `on`, `effect` | `dsh-tools/lib/types/index.d.ts:609 restrict(filter: ToolRestriction): () => void`; cordis `on`/`effect` | `dsh-tools/lib/index.js:2790 restrict(filter) {`; `_deps/cordis/lib/index.js:371 on(name, listener, options)` and `:1168 effect(execute, label = "anonymous")` (cordis 4.0.1) | `_deps/dsh-tools/lib/index.js:2779`, `_deps/dsh-tools/lib/types/index.d.ts:611` | grep on all roots + identity test |
| 11 | `startAgentTurn(agent, message)` | `agent.followup` | `dsh-agent/lib/types/runtime-types.d.ts:192 followup(message: UserMessage): void` | **`dsh-agent-loop/lib/index.js:789 followup(input) { this.send(input, "next-turn", true); }`** — absent from `dsh-agent/lib/index.js` | `_deps/dsh-agent/**` (types) | grep both roots + test |
| 12 | `cancelAgentTurn(agent, cause, options?)` | `agent.cancel` | `dsh-agent/lib/types/runtime-types.d.ts:157 cancel(cause: AgentCancelCause, options?: CancelOptions): void` | **`dsh-agent-loop/lib/index.js:798 cancel(cause, options = {}) {`** | `_deps/dsh-agent/**` (types) | grep + test |
| 13 | `steerAgentTurn(agent, message)` *(captain ruling, extends §3 row 11's D8 rule)* | `agent.steer` | `dsh-agent/lib/types/runtime-types.d.ts:200 steer(message: UserMessage): void` | `dsh-agent-loop/lib/index.js:792 steer(input) {` — `send(input, "next-step", true)` | `_deps/dsh-agent/**` (types) | grep + receiver-capturing test |
| 14 | `injectAgentMessage(agent, message)` *(captain ruling)* | `agent.inject` (the AGENT's, not cordis `ctx.inject`) | `dsh-agent/lib/types/runtime-types.d.ts:209 inject(message: UserMessage): void` | `dsh-agent-loop/lib/index.js:795 inject(input) {` | `_deps/dsh-agent/**` (types) | grep + receiver-capturing test |

Adopted call sites the two ruling rows serve, located by SYMBOL (line numbers drift while the bridge
lane edits its regions — that is exactly why they are cited by symbol, AGENTS.md T-55):
`captain.steer(createUserMessage({…}))` in `packages/mpd-agent-teams-plugin/lib/index.js` (approval
notice) and in `lib/members.js` (`steerCaptainReport`); `captain.inject(createUserMessage({…}))` in
`lib/tools.js` (staged-team discard). `whenIdle` (`lib/members.js`, `lib/tools.js`) stays a DIRECT
Class-B call by ruling: it is a promise-shaped scheduling await with no defined degradation, so the
adapter deliberately has NO `whenIdle` method.

The `inject` name collision is real and recorded: `lib/index.js` also calls the cordis
`ctx.inject(['commands'], cb)` dependency-injection seam, which shares the name and nothing else.
`injectAgentMessage` touches ONLY `agent.inject(message)` (one argument, never a `(deps, callback)`
pair), and the adapter surface itself exposes no cordis `inject` — both asserted by test.

The `cancel` runtime default `options = {}` was read, not assumed: it is why the forwarder passes the
second argument even when the caller omitted it (the callee then applies its own default, so the
semantics of an omitted option are preserved rather than replaced by an explicit `undefined`).

## 2. Absent-service behaviour: degrade ONLY on call, never at apply/construct time

The §3 table's degrade column is what the methods do **when called**; nothing in the surface throws
while the adapter is built, while it is mounted, or while capabilities are probed. Measured facts:

| Situation | Behaviour | Why it matters |
|---|---|---|
| Any service missing / a `ctx.get` that throws / a bare `{get: () => undefined}` | `createDshAdapter(ctx)` returns an adapter; `capabilities()` returns all ten new flags `false` and never throws | the row's `apply` cannot be taken down by a composition that lacks an optional service |
| `subagentRuntime()` / `subagentProvider()` / `subagentProviders()` / `agentScope()` | `undefined` / `undefined` / `[]` / `undefined` (no throw) | these are the §3 rows whose table entry is a value, not a throw |
| `registerHostTool` / `startContinuableAgent` / `interruptAgent` / `llmListModels` / `llmResolveCallConfig` / `registerPromptSection` / `startAgentTurn` / `cancelAgentTurn` | THROW **only when called**, synchronously, with the frozen message — parity with the raw expression in the facade's fallback column, so a caller's `try`/`catch` keeps its meaning | the caller decides through the capability flags (row 9's throw is deliberate: the plugin's usage section is mandatory, and the bridge gates it on `capabilities().systemPromptSection`) |
| A harness method that exists but rejects/throws | forwarded untouched (the harness's own error stays visible) | thin forwarder, no invented error |

Evidence: `packages/mpd-dsh-adapter-plugin/test/adapter-agent-teams-surface.test.ts` — the describes
`the frozen degrade table on an absent harness` (per-method degrade) and
`apply-time safety: nothing on this surface throws at construct or probe time` (three compositions:
`{get: () => undefined}`, `{}` and a `ctx.get` that THROWS — each must build an adapter, probe
capabilities without throwing, report all ten new flags `false`, and serve the value degrades).
Measured 2026-09-19: `bun test packages/mpd-dsh-adapter-plugin` → **94 pass / 0 fail / 425 expect()**
(63 pre-existing + 31 new), `bun run typecheck` clean, adapter dist FRESH (`sha c22f2e87c762…`).

## 3. What this changes

No behaviour change and no signature change: the twelve frozen signatures were already implemented as
written. This note is the citation record F3 asked for — and it confirms F3's warning was real for
exactly two rows (`systemPrompt` root, Agent turn-method root), both of which the implementation
already bound correctly (the adapter reaches the INJECTED service via `ctx.get`, and the Agent object
through the live registry, so it never depended on the wrong root).
