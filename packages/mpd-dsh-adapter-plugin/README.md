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
| `ctx.llm.listProviders` / `listModels` / `resolveModelInfo` | `llmCatalog()` | the host's live model catalog projected as `{ providers: [{ id, name, models: [{ id, name, description?, efforts: [{ id, name, description? }], defaultEffort? }] }], degraded }` — the reasoning block FLATTENED onto the model, `efforts` always an array; read-only and never throwing |
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
| capability probing | `capabilities()` | one boolean per seam, so a caller can degrade instead of crashing |

The fourteen rows from `registerHostTool` down to `injectAgentMessage` exist for ONE consumer:
the adopted `agent-teams` plugin, whose bridge module
`packages/mpd-agent-teams-plugin/lib/mpd-adapter-ctx.js` (mpd-owned, name rule `lib/mpd-*.js`)
builds the facade once at the top of `apply` and routes six bridged adopted files through them.
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

`teamLiveTeams()` is the readout a Web route or a TUI scene uses instead of a `.mpd/team` record
(there is none any more: team state lives in the Lead Session log and is published as the
`agentTeam` Session projection). It folds the live agent registry, keeps one entry per Lead, and
degrades to `[]` — never to a throw.

**Model routing on the teammate path (plan §3):** `teamSpawnTeammate` is the harness's own
`spawnTeammate`, whose `SubagentStartRequest` carries no `agentOptions`, `persona` or
`toolFilter`; a teammate therefore inherits the Lead's route, and the `teamModels.slot*` contract
is carried as explicit guidance inside the spawn prompt. Per-member routing still applies
mechanically on the one-shot consult paths (`mpd_role_spawn` / `mpd_workmate_spawn`), which pass
`agentOptions` themselves.

### The D6 gate (`test/no-direct-team-access.test.mjs`)

A static gate scans `packages/mpd-*/src/**/*.ts`, except this package, for the literal
identifiers `agentTeams` and `startContinuable`, fails naming file + line, strips comments first
(an explanatory "never touch `ctx.agentTeams`" is not a violation) and reports hits in files
OUTSIDE the `*.ts` band in a loud `NOT COVERED` section instead of silently skipping them:

```bash
node packages/mpd-dsh-adapter-plugin/test/no-direct-team-access.test.mjs            # scan
node packages/mpd-dsh-adapter-plugin/test/no-direct-team-access.test.mjs --self-test # negative control
```

It is also a `bun test` case, so `bun test packages/mpd-dsh-adapter-plugin` runs it too.

## The model-catalog seam (`llmCatalog`)

`packages/mpd-tui-plugin` reads this seam AT REGISTRATION for the twelve `teamModels` slot
knobs, because the host renders `select` by cycling a deep-frozen option list (there is no
pick-list dialog). The read is TOTAL:

- a missing `ctx.llm`, or one lacking ANY of the three methods, resolves to
  `{ providers: [], degraded: true }` and logs **ONE** warn-once line naming the missing
  seam — never a throw, never a rejected promise;
- a provider whose `listModels` rejects, or a model whose `resolveModelInfo` rejects, is
  **skipped** (the catalog survives, `degraded: true`);
- a model whose resolved info carries no reasoning block still appears, with
  `efforts: []` and no `defaultEffort`;
- `capabilities().llmCatalog` reports the seam (true only when all three methods exist),
  which is the flag a caller branches on.

The seam is built from those three calls and nothing else — no new runtime dependency.

## Why it exists

Harness updates are normal; rewriting every call site for each of them is not. This
package is the only file in the repository allowed to touch a harness service directly.
The rule is binding (AGENTS.md §6): **a plugin row must not call `ctx.tools`,
`ctx.subagents`, `ctx.skills` or `ctx.agentPresets` itself.**

**Adopted-plugin routing (the former boundary, closed 2026-09-19):** the adopted
`agent-teams` plugin (`packages/mpd-agent-teams-plugin`) is upstream MIT main code
re-vendored on upgrades, and it reaches the harness seams through THIS adapter — via its
mpd-owned bridge `lib/mpd-adapter-ctx.js`, which resolves the mounted `mpdDsh` lazily and
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
import { createDshAdapter } from '@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js'

export function apply(ctx) {
  const dsh = (typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined) ?? createDshAdapter(ctx)
  dsh.registerTool({ name: "mpd_x", description: "…", execute: async (args, exec) => ({ ok: true }) })
  dsh.guardTool((exec) => (exec.name === "write" ? "denied" : undefined))
  // observe-only: the gate decision is returned unchanged, whatever this listener does
  dsh.onPreToolExecute((exec, decision) => { if (decision?.kind === "allow") started(exec.name, exec.callId) })
  dsh.onPostToolExecute((exec, result, downstream) => (exec.name === "bash" ? { ...downstream, content: trimmed } : undefined))
  const run = await dsh.spawnAgent({ label: "role-oracle-1", prompt: "…", provider: "deepseek-official", model: "deepseek-v4-pro" })
  const call = await dsh.executeTool({ name: "mpd_config_get", arguments: {} })
}
```

`ctx.get("mpdDsh")` returns the mounted instance (provided by the `mpd-dsh-adapter`
row, which the bundle patch inserts before every other mpd row); `createDshAdapter(ctx)`
builds an equivalent one, so a plugin works standalone in unit tests and partial
installs.

## Config

| Key | Type | Default |
|---|---|---|
| `defaultTimeoutMs` | number | `120000` (internal `executeTool` timeout when the caller passes none) |
| `quiet` | boolean | `false` (suppresses the one-line boot log) |
