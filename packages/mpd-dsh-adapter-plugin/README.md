# mpd-dsh-adapter-plugin

**English** | [中文](./README.zh-CN.md)

The bundle's **single contact surface with DeepSeek Harness**. Every mpd plugin calls
through this adapter instead of the raw `ctx` services, so a harness release that
renames or reshapes a seam is absorbed in this one package — one file, one rebuild —
instead of across every plugin.

## Wrapped seams

| Seam | Adapter call | What it normalizes |
|---|---|---|
| `ctx.tools.register` | `registerTool(def)` / `registerTools(defs)` | default object-rooted `parameters`, default `output.render` (text block), always-object `(args, exec)` call shape, disposer pass-through |
| `ctx.tools.guard` | `guardTool(fn)` | always-object `exec`, disposer |
| `ctx.on("tools/pre-execute")` | `onPreToolExecute(listener)` | **OBSERVE-ONLY**: the adapter owns `next()`, returns the downstream gate decision VERBATIM (so a listener can neither alter nor veto a call) and discards the listener's own return value; the listener gets `(exec, decision)` with the `{kind:'allow'\|'ask'\|'deny'}` the harness will use; a throwing listener is contained; no event bus → no-op |
| `ctx.on("tools/post-execute")` | `onPostToolExecute(listener)` | the adapter owns `next()`; the listener receives `(exec, result, downstream)` and returns a decision or `undefined` to pass through; no event bus → no-op |
| `ctx.tools.get` / `ctx.tools.execute` | `hasTool(name)`, `toolRuntime()`, `executeTool({name, arguments, callId?, signal?})` | feature detection, default callId + timeout signal, `{ok, isError, value, error}` result |
| `ctx.subagents.start("spawn", …)` | `spawnAgent(spec)` | string prompt → content blocks, flat `provider`/`model` or `agentOptions`, `run.result` awaited whether it is a promise or an object, normalized `{output, structured, stopReason}` |
| `ctx.skills.registerProvider` / `list` / `get` | `registerSkillProvider`, `listSkills`, `loadSkill` | disposer pass-through, default options |
| `ctx.agentPresets.resolve` | `resolvePreset(id)` | normalized `{id, path, trust, broken}` |
| `ctx.llm.listProviders` / `listModels` / `resolveModelInfo` | `llmCatalog()` | the host's live model catalog projected as `{ providers: [{ id, name, models: [{ id, name, description?, efforts: [{ id, name, description? }], defaultEffort?, contextWindow: number | null, maxOutputTokens: number | null }] }], degraded }` — the reasoning block FLATTENED onto the model, `efforts` always an array; read-only and never throwing |
| `ctx.tools.register` (VERBATIM) | `registerHostTool(def)` | forwards an ALREADY harness-shaped definition unchanged — the same object reference reaches `tools.register` (`Object.is` holds end-to-end) and the disposer is passed through. `registerTool` normalizes (and would drop `finalizeContent`/`presentCall`/`presentResult`/`isConcurrencySafe`); this one deliberately does not. THROW when the seam is absent |
| `ctx.subagents` (the runtime object) | `subagentRuntime()` | identity-preserving runtime (`startContinuable`/`interrupt`/`getProvider`/`list`); `undefined` when absent |
| `ctx.subagents.getProvider` | `subagentProvider(name)` | thin forwarder; `undefined` when absent (the caller's own check throws the same message) |
| `ctx.subagents.list` | `subagentProviders()` | `[]` when absent |
| `ctx.subagents.startContinuable` | `startContinuableAgent(spec)` | THROWING forwarder — a member that cannot be spawned must be loud |
| `ctx.subagents.interrupt` | `interruptAgent(targetSessionId, authority)` | THROWING forwarder |
| `ctx.llm.listModels` | `llmListModels(provider)` | THROWING forwarder (a per-provider list, distinct from the tolerant `llmCatalog()` projection) |
| `ctx.llm.resolveCallConfig` | `llmResolveCallConfig(config, signal?)` | THROWING forwarder, signal passed through |
| `ctx.systemPrompt.section` | `registerPromptSection(section)` | disposer pass-through; THROW at the call when the seam is absent (the caller's usage section is mandatory) |
| a live agent's own scoped ctx | `agentScope(agent)` | `{ context, tools.restrict, on, effect }` built from `agent.ctx`; `undefined` when a promised member is missing, so the caller falls back per call |
| `ctx.agents.get(id)` / `ctx.agents.list` | `liveAgent(agentId)` / `liveAgents()` | the live-session registry: one Agent by id (the registry's own `get`, then a `list` scan) or `[]`; an absent registry, a throwing read or a non-array answer degrades to "no entry"; never throws |
| `agent.ctx.get("compaction")`, via the registry | `compactionEngineForAgent(agentId)` | the compaction engine of the live Agent that id names, memoized per Agent OBJECT; `undefined` when no live Agent owns that id or its scope serves no engine |
| `agent.ctx.get("compaction")`, from a handle already held | `compactionEngineForLiveAgent(agent)` | the SAME memoized engine body, resolved straight from the caller's own Agent handle and NEVER from the live-session registry — the compaction barrier's FIRST choice, so a member already detached from `ctx.agents` before its barrier still compacts IN PLACE instead of being fenced; `undefined` when the handle carries no engine; never throws |
| `agent.followup` | `startAgentTurn(agent, message)` | THROWING verbatim forwarder (never swallowed into a boolean or `undefined`) |
| `agent.cancel` | `cancelAgentTurn(agent, cause, options?)` | THROWING verbatim forwarder |
| `agent.steer` | `steerAgentTurn(agent, message)` | THROWING verbatim forwarder — nearest-step steering, distinct from `followup`'s new turn |
| `agent.inject` | `injectAgentMessage(agent, message)` | THROWING verbatim forwarder — the inbox seam |
| `ctx.subagents.registerProvider` | `registerSubagentProvider(provider)` | VERBATIM provider, disposer pass-through (a non-callable registry answer degrades to a no-op); THROW at the call when the seam is absent |
| `ctx.agentTeams` (the official TeamService) | `teamService()` | the raw service, or `undefined` when this composition has no team row — the escape hatch beside the typed methods below |
| `ctx.agentTeams.tryMembership` | `teamMembership(agent)` | projected `{teamId, role, name}`; **never throws** — `undefined` for a non-member, a stale identity, an unknown role or a missing service |
| `ctx.agentTeams.listMembers` / `listTasks` | `teamListMembers(agent)` / `teamListTasks(agent)` | rows projected onto `DshTeamMemberView` / `DshTeamTaskView` (`diagnostics`, `blockedBy`, `writeScopes`, `writeScopeWarnings` are ALWAYS arrays); THROW when the seam is absent |
| `ctx.agentTeams.createTask` / `getTask` / `updateTask` | `teamCreateTask(caller, req)` / `teamGetTask(caller, id)` / `teamUpdateTask(caller, req)` | caller AND request forwarded **by identity**, the promise untouched, only the reply projected; THROW when the seam is absent |
| `ctx.agentTeams.sendMessage` / `waitForChange` | `teamSendMessage(caller, req)` / `teamWaitForChange(caller, timeoutMs, signal?)` | same forwarding discipline; the durable answer normalized to `{messageId, status: 'accepted'\|'queued'}` / `{timedOut}` |
| `ctx.agentTeams.spawnTeammate` / `interrupt` | `teamSpawnTeammate(caller, req)` / `teamInterrupt(caller, targetName)` | same forwarding discipline; the member row is projected / the status sampled BEFORE cancellation is answered |
| the live-team fold | `teamLiveTeams()` | one entry per live **Lead** agent (`{teamId, leadName, leadSessionId, members, tasks}`); `[]` when the service or the agent registry is absent, and a failing per-agent read yields `[]` for that entry instead of taking the fold down |
| `ctx.on("agent/pre-step")` | `onAgentPreStep(listener)` | the adapter owns `next()`; the listener receives `(payload, downstream)` and may return an AMENDED decision (that is how an advisory notice is injected) or `undefined` to pass through; a throwing listener is contained; no event bus → no-op |
| a live agent's own scoped `ctx.systemPrompt.section` | `agentPromptSection(agent, section)` | the section is forwarded VERBATIM to THAT agent's scope (receiver-bound, disposer passed back), so a contribution reaches one preset's sessions instead of every session this process serves; THROW at the call when the agent scope exposes no section |
| `ctx.sessionProjections.stateOf` / `.snapshot` | `contextPressure(target)` | ONE live session's occupied context, normalized to `{usedTokens, windowTokens, ratio, provenance}`: `usedTokens = projectedTokens ?? pressureTokens`, `windowTokens` is the model-reported `contextWindow` (NEVER defaulted), `ratio` only when both numbers are greater than 0, provenance `observed \| no-window \| unavailable`; synchronous and never throwing; accepts a live Agent, a Session object or a session id |
| `ctx.userQuestions.ask` | `askUserQuestion({ questions, signal? })` | plain `DshQuestionItem[]` in, `DshQuestionAnswer[]` out (labels, never indices); a missing service, or one whose `ask` is not callable, THROWS `ask_user_question failed: no user-questions service`; a service rejection is rethrown as `ask_user_question failed: <message>` with the harness `code` copied onto the error when present |
| `ctx.on("user-questions/request")` | `onUserQuestionRequest(handler, label?)` | a WATERFALL answerer: `handler(request, next)` where `next()` resolves the DOWNSTREAM answerer's `{ answers: [...] }` ENVELOPE by identity (never re-mapped into a bare array), or rejects when the waterfall supplied no continuation; the handler's own value goes back to cordis unchanged and its rejection propagates unchanged; no event bus → no-op disposer + ONE log line naming the label |
| `ctx.dshGo` (presence) | `dshGoPresent()` | whether the bridge service is bound right now — the per-call form of `capabilities().dshGo`, through the same probe |
| `ctx.dshGo.panel` | `dshGoPanel(id, spec)` | `view`/`data`/`actions` forwarded VERBATIM (they are the bridge's own contract); `true` only when the call returned, `false` + ONE warning line when the bridge is absent or the call throws — never a throw |
| `ctx.dshGo.refresh` | `dshGoRefresh(id)` | best-effort re-render; a silent no-op without the bridge, and never a throw, never a log (a polling caller must not see a rejected tick) |
| `ctx.dshGo.on` | `dshGoOn(id, handler)` | `service.on(id, handler)`; the handler's return value is the bridge's own effects vocabulary and is forwarded unchanged; `true` only when the call returned, `false` + ONE warning line when the bridge is absent, exposes no `on()`, or throws |
| `ctx.dshGo.strip` | `dshGoStrip(id, dataFn)` | `service.strip(id, dataFn)`; the bridge drives `dataFn(scope, emit, caps)` and owns the returned cancel handle; same degrade shape as `on` |
| the bridge's capabilities | `dshGoCaps()` | feature-detects a `caps()` method, then a `caps` / `capabilities` property (the 1.0.9 bridge documents NO `caps()` member), narrows `app` / `locale` / `components` / `surfaces` and invents no field; `null` + ONE warning line when it cannot answer |
| capability probing | `capabilities()` | one boolean per seam, so a caller can degrade instead of crashing |

The fourteen rows from `registerHostTool` down to `injectAgentMessage` exist for ONE consumer:
the adopted `agent-teams` plugin, whose bridge module was
`packages/mpd-agent-teams-plugin/lib/mpd-adapter-ctx.ts` (mpd-owned, name rule `lib/mpd-*.js`) and
built the facade once at the top of `apply`, routing six bridged adopted files through them. Both the
plugin and its bridge module were DELETED by the `de-vendor-and-verify-law` wave; the paragraph below
is kept as the record of a boundary that was closed.
Each method sits behind a `capabilities()` flag (one flag may cover two methods;
`subagentRuntime` reuses the existing `subagents` flag), so the bridge degrades per seam instead
of aborting the plugin tree: `toolsRegisterHost`, `subagents`, `subagentsProvider`,
`subagentsContinuable`, `subagentsInterrupt`, `llmListModels`, `llmResolveCallConfig`,
`systemPromptSection`, `agentScope`, `commandsRegister`, `agentTurnStart`, `agentTurnCancel`,
`agentTurnSteer` and `agentTurnInject` (the two `agentTurn{Steer,Inject}` flags are live-registry
probes: they report `true` only when a live agent exposes `steer` / `inject`).

The team-plane rows below them report their OWN four flags —
`team`, `teamTasks`, `teamMessages` and `subagentsProviderRegister` — and never rename an
existing one. The two AGENT-scoped rows (`onAgentPreStep`, `agentPromptSection`) report
`agentPreStep` (the event bus) and `agentPromptSection` (a LIVE probe: a live agent whose own
scope carries `systemPrompt.section`).

The five DRIVE-SURFACE seams report their OWN two flags — `askUser` (the `userQuestions` service
resolves at probe time) and `dshGo` (the bridge service is bound) — and never rename an existing one.
`askUser` is deliberately NOT the waterfall flag: `onUserQuestionRequest` rides the event bus
(`events`), so a composition can accept questions without being able to ask one.

### Context pressure for one live session (`contextPressure`)

`contextPressure(target)` reads the harness token meter's `sessionProjections` unit
`contextPressure` — the SAME projection the host's own status display uses — for ONE session. The
STATE read (`stateOf`) carries the observed window (`contextWindow`, recorded from the provider's
`request/context`) and the provider-reported `pressureTokens`; the CLIENT VIEW read (`snapshot`)
carries the forward-looking `projectedTokens` that the state does not. It returns

```ts
{ usedTokens: number | null, windowTokens: number | null, ratio: number | null,
  provenance: "observed" | "no-window" | "unavailable" }
```

with these rules, none of which may be relaxed:

- `usedTokens = projectedTokens ?? pressureTokens` — the projection's forward-looking figure is
  preferred, and a projected `0` is a real observation, not a miss;
- `windowTokens` is READ from what the model reported at runtime and is NEVER defaulted: no
  `1_000_000`, no `262_144`, no configuration value. `no-window` is the honest answer before the
  first `request/context` event;
- `ratio = usedTokens / windowTokens` only when BOTH are numbers greater than 0; otherwise `null`;
- `provenance` is machine-readable: `observed` (projection present with a window), `no-window`
  (projection present, window absent), `unavailable` (no registry, no session, or no state);
- the read is SYNCHRONOUS and NEVER throws — a missing `sessionProjections` service, an
  unresolvable session, an unmaterialized projection and a throwing read all answer `unavailable`.

`target` may be a live Agent (its own `session` is used), a Session object, or a session id
(resolved through the harness `sessions` store, falling back to the live-agent registry). Nothing is
cached: every call re-reads the projection, so a checkpoint decision never runs on a stale figure.

## The drive surface — questions and the DSH Go panel

Eight seams let a client that is not a model turn drive the harness: ask a structured question,
answer one through the waterfall, and publish, refresh, subscribe to or feed a DSH Go native surface. Every shape below is this
bundle's OWN plain data — no harness type crosses the adapter (AGENTS.md §6), so a consumer never
imports one:

```ts
export interface DshQuestionOption { label: string; description?: string }
export interface DshQuestionItem { id: string; question: string; header?: string; options?: DshQuestionOption[]; multiSelect?: boolean }
export interface DshQuestionAnswer { id: string; selected: string[]; custom?: string }
export interface DshQuestionAnswerEnvelope { answers: DshQuestionAnswer[] }
export interface DshUserQuestionRequest { questions: DshQuestionItem[]; sessionId?: string; signal?: AbortSignal }
export interface DshAskUserQuestionInput { questions: DshQuestionItem[]; signal?: AbortSignal }
export type DshGoPanelView = DshGoView | ((scope: DshGoScope, caps: DshGoCaps) => DshGoView | Promise<DshGoView>)
export interface DshGoPanelSpec { view: DshGoPanelView; data?: unknown; actions?: Record<string, unknown> }
```

- **`askUserQuestion(request): Promise<DshQuestionAnswer[]>`** drives the `userQuestions` service's
  `ask`, forwarding `questions` and `signal` unchanged, and projects the batch onto
  `DshQuestionAnswer[]` — only entries carrying a string `id`, only string labels in `selected`, and
  `custom` written only when it is a string (an absent `custom` is dropped). An absent service — or
  one whose `ask` is not callable — THROWS `ask_user_question failed: no user-questions service`: an
  empty answer array would read as "the human answered nothing". A service rejection is rethrown as
  `ask_user_question failed: <message>` with the harness `code` (`NO_PROVIDER`, `ASK_ABORTED`, …)
  copied onto the new error when it was a non-empty string, so a caller can tell a missing answerer
  from a malformed call without importing the harness class.
- **`onUserQuestionRequest(handler, label?): () => void`** registers a WATERFALL answerer on
  `user-questions/request`. `handler` receives `(request, next)`: its own return value goes back to
  cordis UNCHANGED, while `await next()` resolves the DOWNSTREAM answerer's reply as the harness's
  `DshQuestionAnswerEnvelope` `{ answers: [...] }`, forwarded BY IDENTITY — never projected down to a
  bare array and never rebuilt into a fresh object. That is not cosmetic: cordis `waterfall()` returns
  the OUTERMOST listener's value, this row registers at boot, and `dsh-tool-ask-user` consumes
  `result.answers.map`, so a bare array (or a rebuilt envelope) would replace the harness's own value
  and break every answered question. A downstream value that is not an envelope is forwarded as-is
  too — the harness owns that error surface, and synthesising a replacement would hide it.
  `next()` rejects with `ask_user_question failed: the user-questions waterfall supplied no next()`
  when the event carried no continuation. A rejection from `handler` propagates UNCHANGED — the
  harness must see a broken answerer, never an invented answer. Degradation: when `ctx.on` is
  missing or throws, ONE warning line names the label
  (`onUserQuestionRequest(<label|anonymous>) degraded — …`) and the returned disposer is a no-op, so
  the row still boots. The bus takes no label; it exists only for that diagnostic.
- **`dshGoPresent(): boolean`** is true when the `dshGo` service is bound, read through the SAME probe
  as `capabilities().dshGo` and re-read per call, so a bridge that binds after the row applies is
  seen.
- **`dshGoPanel(id, spec): boolean`** calls `service.panel(id, spec)` with `view`/`data`/`actions`
  forwarded VERBATIM — they are the bridge's own contract, and re-shaping them here would pin this
  adapter to one bridge version. `true` only when the call returned without throwing; an absent
  bridge (or one exposing no `panel`) and a throwing call each answer `false` with ONE warning line,
  and neither takes the publishing row down.
- **`dshGoRefresh(id): void`** calls `service.refresh(id)` when it is callable and is otherwise a
  silent no-op. It never throws and never logs: it is called from a polling path, so a missing bridge
  or a failed refresh must not become a per-tick diagnostic.
- **`dshGoOn(id, handler): boolean`** subscribes one manifest action id through `service.on`. The
  handler receives `(scope, event)` and its return value — the bridge's effects object, including the
  v1.1 deferred `{ pending, result }` shape — is forwarded unchanged. `false` + ONE warning line when
  the bridge is absent, exposes no `on()`, or throws.
- **`dshGoStrip(id, dataFn): boolean`** publishes one composer strip's `dataFn(scope, emit, caps)`; the
  returned cancel handle belongs to the bridge. Same degrade shape as `dshGoOn`.
- **`dshGoCaps(): DshGoCaps | null`** reads what the app can draw. The 1.0.9 bridge hands `caps` to
  every view/data function as an ARGUMENT and documents no `caps()` member, so the seam probes both a
  `caps()` method and a `caps`/`capabilities` property, narrows the four known fields and never
  invents one; a caller that already received `caps` as an argument must use THAT object. `null` +
  ONE warning line when the bridge cannot answer.
- **`dshGoPanel(id, spec)`** also accepts a `view` FUNCTION `(scope, caps) => view` (or a promise of
  one), because the bridge calls it per render so a panel can adapt to the app's capabilities.

**Bound.** A seam is not a mount. `dshGoPresent()` true proves a service was bound at that instant; it
does not prove a row booted, that a DSH Go engine is attached, or that any panel rendered. Likewise
`askUserQuestion` proves the call path to a service, not that a human — or any surface — is in front of
the question. No live mount or boot is proved by these seams; that takes a boot which MOUNTS the rows,
a different measurement from this one.

## The DSH Go view kit (`src/dshgo-view.ts`)

`src/dshgo-view.ts` is the bundle's PURE, harness-free view kit for the DSH Go app — panels, composer
strips and tool cards share it. It has no ctx, no I/O and no dependency on the private
`@dsh-go/plugin-kit`, and a plugin imports it as `../../mpd-dsh-adapter-plugin/src/dshgo-view`, so one
file owns the app's shape instead of every lane hand-rolling JSON.

| Export | What it does |
|---|---|
| `bind(path)` | a `data.…` binding, prefixing `data` once and never twice |
| builders | `stack`, `row`, `text`, `metric`, `chart`, `table`, `keyValue`, `list`, `progress`, `callout`, `steps`, `actions`, `tabs`, `grid`, `timeline`, `form`, `textField`, `select`, `toggle`, `emptyState`, `avatar`, `badge`, `tag`, `divider`, `spacer` — each an app-legal node that THROWS past the app's own list limit instead of truncating, and refuses a prop the app silently ignores (a `grid` style, an `emptyState` `text`, an `avatar` without `src`, an empty tab) |
| `style(tokens)` | the closed v2 style set: `card` / `padding` / `gap` (S / M / L only) / `align` / `columns` / `dividers` / text `size` / `weight` / `color: "accent"` / `maxLines`. A numeric padding or gap, a named colour and a `#RRGGBB` value are REFUSED, not forwarded |
| `panelView({ children, style? })` | the panel root: `v: 2`, `accent: "app"`, a stack holding the tabs. The accent is written here and nowhere else, so a themed panel cannot carry a named or hex accent; a second `style: "primary"` action is refused |
| `measureView` / `countViewNodes` / `viewDepth` | the app's own three units: UTF-8 JSON bytes, component nodes, component nesting with the root at 1 |
| `BUDGETS` / `fitsBudget` | toolCard 8 KiB / 40 / 6, panel 32 KiB / 120 / 8, strip 2 KiB / 8 / 3 |
| `toolCard(build)` | a tool's `presentationMeta`: never throws, returns `{ "dsh-go/view": … }`, and degrades to `{}` on a builder error, an over-budget view, a v2 root, a v2-only component, a binding or an accent |
| `adaptView(view, caps)` | the v1 fallback: `tabs` → a stack of titled sections, `grid` → a list (a metric keeps its NUMBER as the row's `trailing`), `timeline` → `steps`, `badge`/`tag`/`avatar` → `text`, `emptyState` → its copy, `divider`/`spacer` dropped, every `style`/`accent` removed, root `v: 1`; idempotent and never mutating its input |
| `lintDesign(view, { version })` | the static design gate the app checker leaves open. VERSION 2 (a panel) reports hex/named colours, numeric spacing, reserved decoration keys, a second primary action, `tabs` written as `children`, `emptyState` written as `text`, a grid carrying a container style, an avatar without `src`, a badge with no word, plus the POSITIVE rules: exactly one `tinted` hero per tab, every `metric` inside a `grid`, a data-less tab carrying `emptyState`, and long or bound text setting `maxLines`. VERSION 1 (a static fallback) asserts no v2 component survives, no `style`/`accent` survives, and every `text` carries words |

**Bound.** The app-side render is UNPROVEN in this workspace: there is no Flutter app to draw a tree.
What the kit proves is that a tree is v2-legal, inside the app's budgets and theme-token-only — by
`lintDesign` and by the pinned 1.0.9 `check.mjs`. `accent: "app"` always produces ONE dark-mode
contrast note from that checker (`#4B67B4 → #7B8FC8`): it is the contrast correction working, and it
must not be "fixed" by substituting a hex value.

## The official Agent Teams plane

The harness ships Agent Teams as three official packages
(`@deepseek-ai/dsh-experimental-agent-team`, `…-tool-agent-team`, `…-client-ui-agent-team`) whose
service is `ctx.agentTeams`. **D6 of `docs/plan-0.1.7-adaptation.md` makes this adapter the ONLY
place an mpd plugin may reach it** — a direct `ctx.agentTeams` read, or a direct
`ctx.subagents.startContinuable` call, outside `packages/mpd-dsh-adapter-plugin` is a defect.

The discipline is the same one `registerHostTool` follows:

- the **caller Agent** (the exact live Agent that authorizes the operation) and the **request
  object** are forwarded **by identity** — no copy, no key rewrite — so a host field this adapter
  does not model still reaches the service, and the host's own validation and rejections stay
  loud;
- only the **reply** is projected (`teamMemberView` / `teamTaskView`): a declared `diagnostics`,
  `blockedBy`, `writeScopes` or `writeScopeWarnings` is always an array, an unknown status degrades
  to the safe value, and no undeclared key leaks;
- every method is feature-detected and **nothing throws at construct or probe time**: a missing
  seam surfaces as the exact action that could not happen
  (`mpd-dsh-adapter: harness service "agentTeams" is unavailable — cannot create team task "…"`),
  and `teamMembership` never throws at all (it is the filter a caller asks "is this agent on a
  team?" with).

`teamLiveTeams()` is the contained FALLBACK for a composition that runs the official executor — the
read a Web route, a TUI scene or the watchdog uses there. The MPD team RECORD is authoritative on
every mpd surface: `.mpd/team/teams/<id>.json`, served as `mpdTeams`. The call folds the live agent
registry, keeps one entry per Lead, and degrades to `[]` — never to a throw.

**Model routing on the teammate path (plan §3):** `teamSpawnTeammate` is the harness's own
`spawnTeammate`, whose `SubagentStartRequest` carries no `agentOptions`, `persona` or
`toolFilter`. That is the OFFICIAL fallback path: it passes through by identity, so only
`mpd-roster-provider-plugin`'s official-path provider can route it, and the `spawn_teammate` TOOL that
armed it is now REFUSED at the tool boundary (historical/fallback only). The DEFAULT native
`TeamExecutor.spawn` resolves the member's OWN `agentRoutes` entry ITSELF, by identity precedence `role`
→ the head of `description` → the whole `name`: a matched member with a usable route runs on that route
(its `fallbacks` consumed once), while an UNMATCHED member, one whose route is unconfigured or invalid,
or a composition with no `mpdConfig` service INHERITS the staging session's route (the captain's in a
top-level spawn, the Lead's in a team-lead spawn) with ONE log line and NO throw — `approve` raises N
members in a loop, so a route never leaves a team half-built. Per-agent routing also applies on the
single-call consult paths (`mpd_role_spawn` / `mpd_workmate_spawn`), which pass `agentOptions`
themselves; those appliers REFUSE an unusable route with `AGENT_UNCONFIGURED` (this package exports the
code and the one canonical sentence, mirrored from the config row). That consult
is ONE-SHOT: on a host exposing `startActivation` the adapter disposes that exact activation once the
report settles (best-effort; a failing teardown never changes the report), so the live child is
released instead of accumulated; the retired `start` fallback returns only `run.result` and has no
activation to dispose. Honest bound on harness 0.2.1-rc.2: `dispose()` settles and releases the live
activation only, and the child catalog is append-only — the finished child may still be listed
`inactive` and is technically cold-resumable. The contract is one-shot regardless: a new question
means a new consult (or a workmate for durable continuity), never a `send_message` into the finished
child. Team members are unaffected — the team path keeps the separate durable seam
(`startContinuableAgent`).

### The team executor's depth cap (`maxDepth`)

`DshTeamSpawnRequest` accepts an optional `maxDepth` — the ABSOLUTE delegation-depth cap for the
member's own activation (the harness `startActivation` request's `maxDepth`, validated as a
non-negative safe integer). It is the ONLY route by which cellwork can raise a depth-2+ subcaptain
(capability fact F1), because the `subagent` tool's own service default never rises above 1.

- NATIVE backend: the value is forwarded as `request.maxDepth` **exactly when the caller supplied
  it**. An absent cap stays ABSENT — the key is omitted, never written as `undefined` — so the
  harness applies its own default rather than a converted or guessed value.
- OFFICIAL backend: `maxDepth` is IGNORED without throwing. The official service owns its roster and
  exposes no per-call depth channel, so a composition running that backend must not expect the cap
  to take effect.

### The D6 gate (`test/no-direct-team-access.test.ts`)

A static gate scans `packages/mpd-*/src/**/*.ts`, except this package, for the literal
identifiers `agentTeams` and `startContinuable`, fails naming file + line, strips comments first
(an explanatory "never touch `ctx.agentTeams`" is not a violation) and reports hits in files
OUTSIDE the `*.ts` band in a loud `NOT COVERED` section instead of silently skipping them:

```bash
node packages/mpd-dsh-adapter-plugin/test/no-direct-team-access.test.ts            # scan
node packages/mpd-dsh-adapter-plugin/test/no-direct-team-access.test.ts --self-test # negative control
```

It is also a `bun test` case, so `bun test packages/mpd-dsh-adapter-plugin` runs it too.

## The model-catalog seam (`llmCatalog`)

`packages/mpd-tui-plugin` reads this seam AT REGISTRATION for the thirty-three `agentRoutes` leaves
(three per roster agent — 33 of the 47-knob shared declaration), because the host renders `select` by
cycling a deep-frozen option list (there is no pick-list dialog). The read is TOTAL:

- a missing `ctx.llm`, or one lacking ANY of the three methods, resolves to
  `{ providers: [], degraded: true }` and logs **ONE** warn-once line naming the missing
  seam — never a throw, never a rejected promise;
- a provider whose `listModels` rejects, or a model whose `resolveModelInfo` rejects, is
  **skipped** (the catalog survives, `degraded: true`);
- a model whose resolved info carries no reasoning block still appears, with
  `efforts: []` and no `defaultEffort`;
- every model carries the window the HARNESS itself resolved — `contextWindow` from
  `resolveModelInfo().context.contextWindow` and `maxOutputTokens` from `.defaultMaxTokens` — as
  `number | null`. BOTH keys are ALWAYS written: `null` means "the harness resolved nothing", never
  a fallback constant, and it is the split-time budget's only honest input;
- both fields are OPTIONAL at the TYPE level, for catalog doubles that predate them: `undefined`
  means "this producer did not report the field", `null` means "the harness resolved nothing";
- `capabilities().llmCatalog` reports the seam (true only when all three methods exist),
  which is the flag a caller branches on.

The seam is built from those three calls and nothing else — no new runtime dependency.

### The effort adaptation built on it (`withSupportedEffort`)

A per-agent route may state an effort and the `agentRoutes` subtree carries NO schema default, so a
route whose model declares no reasoning efforts at all would hand the provider a keyword it cannot
accept, failing the call. The
exported `withSupportedEffort(dsh, route)` is the ONE place that decision is made — `modelDeclaresNoEffort`
is the pure predicate behind it — and it reads this seam:

- it returns the route **unchanged, by identity**, when the model declares efforts, when either the
  provider or the model is not listed, when there is no `llmCatalog` seam, when the read rejects, or
  when the route states no effort at all;
- it returns a **new copy without `reasoningEffort`** when the catalog lists the model with
  `efforts: []`, and logs the drop so an adapted call is never silent;
- it NEVER throws and never substitutes a different effort — swapping the value would be clamping,
  which the contract forbids.

Both effort-carrying callers use it: `mpd-roles-plugin` (the role-spawn path) and
`mpd-roster-provider-plugin` (an official `spawn_teammate`). The seam stays the single contact surface.

## Why it exists

Harness updates are normal; rewriting every call site for each of them is not. This
package is the only file in the repository allowed to touch a harness service directly.
The rule is binding (AGENTS.md §6): **a plugin row must not call `ctx.tools`,
`ctx.subagents`, `ctx.skills` or `ctx.agentPresets` itself.**

**Adopted-plugin routing (the former boundary, closed 2026-09-19, and now HISTORICAL — the plugin
it describes was DELETED by the `de-vendor-and-verify-law` wave):** the adopted
`agent-teams` plugin was upstream MIT main code re-vendored on upgrades, and it reached the harness
seams through THIS adapter — via its
mpd-owned bridge `lib/mpd-adapter-ctx.ts`, which resolves the mounted `mpdDsh` lazily and
falls back warn-once when the adapter is absent (one absent line per plugin instance). Its
local adaptations stay as they were (the `registerContinuableSetup` boot-safety guard, the
workmate persona injection, the `mpd-delta` regions). The closure and its residual set are
stated in AGENTS.md §6. Every self-written mpd plugin goes through this adapter — including
the TUI edition:
`packages/mpd-tui-plugin` imports `createDshAdapter` from here and reads the mounted `mpdDsh`
service for the workspace-root union, exactly like every other self-written row.

The adapter is deliberately `inject`-free: every seam is resolved lazily at call time
and probed defensively, because the loader applies sibling rows concurrently (a
snapshot taken at `apply` would under-report) and because reading an uninjected
service as a property throws in Cordis. Missing seam → actionable error at the call,
or a `capabilities()` flag the caller can branch on.

## Usage

```js
import { resolveDshAdapter } from '@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js'

export function apply(ctx) {
  // the mounted `mpdDsh` when this composition provides one, else a row-private adapter
  const dsh = resolveDshAdapter(ctx)
  dsh.registerTool({ name: "mpd_x", description: "…", execute: async (args, exec) => ({ ok: true }) })
  dsh.guardTool((exec) => (exec.name === "write" ? "denied" : undefined))
  // observe-only: the gate decision is returned unchanged, whatever this listener does
  dsh.onPreToolExecute((exec, decision) => { if (decision?.kind === "allow") started(exec.name, exec.callId) })
  dsh.onPostToolExecute((exec, result, downstream) => (exec.name === "bash" ? { ...downstream, content: trimmed } : undefined))
  const run = await dsh.spawnAgent({ label: "role-oracle-1", prompt: "…", provider: "deepseek-official", model: "deepseek-v4-pro" })
  const call = await dsh.executeTool({ name: "mpd_config_get", arguments: {} })
}
```

`resolveDshAdapter(ctx)` returns the mounted instance when the `mpd-dsh-adapter` row
(which the bundle patch inserts before every other mpd row) has provided it, and
otherwise builds an equivalent one with `createDshAdapter(ctx)` — so a plugin works
standalone in unit tests and partial installs, and every row states the rule once. That
fallback is **LOUD**: one diagnostic line per resolution names which miss it was (a provider
that is registered but not ACTIVE yet, or no adapter in this composition at all) and reports
`adapterIdentity`, because a second instance beside the mounted one bypasses the
one-contact-surface rule. A row
that must also survive a TRANSIENT miss (the service is registered but its fiber is not
ACTIVE yet) calls `createLazyDshAdapter(ctx, { label })`, which re-probes on every use.

### Shared helpers

The package also owns the bundle's pure, harness-free helpers — `src/shared.ts`,
re-exported from the same entry point — so a row needs one import for both the seam
surface and these:

| Helper | What it is |
|---|---|
| `isRecord(value)` | the plain-object guard (`typeof === "object"`, not null, not an array) |
| `errorMessage(error)` | `Error#message` for anything thrown, without throwing on a non-Error |
| `bundleRootOf(import.meta.url)` | the bundle root for a module at `<bundle>/packages/<pkg>/{src,dist}/<file>` |

They touch no harness seam, which is why they live beside — never inside — the seam
surface: `src/index.ts` stays the ONE contact surface AGENTS.md §6 requires.

## Config

| Key | Type | Default |
|---|---|---|
| `defaultTimeoutMs` | number | `120000` (internal `executeTool` timeout when the caller passes none) |
| `quiet` | boolean | `false` (suppresses the one-line boot log) |
