// mpd-dsh-adapter: THE single place where this bundle touches DeepSeek Harness
// seams. Every mpd plugin calls through this adapter instead of the raw ctx
// services, so a harness release that renames or reshapes a seam is absorbed
// HERE — one file, one rebuild — instead of across every plugin.
//
// Wrapped seams (each feature-detected, never assumed):
//   tools.register / tools.guard / tools.get / tools.execute / tools/pre-execute / tools/post-execute
//   subagents.start (spawn)                       -> spawnAgent
//   subagents.getProvider / list / registerProvider / startContinuable / interrupt
//   agentTeams.* (the official team service)       -> teamService / teamMembership /
//                                                     teamListMembers / teamListTasks / teamCreateTask /
//                                                     teamGetTask / teamUpdateTask / teamSendMessage /
//                                                     teamSpawnTeammate / teamInterrupt /
//                                                     teamWaitForChange / teamLiveTeams
//   skills.registerProvider / skills.list / skills.get
//   agentPresets.resolve
//   agents.list (session cwds)                    -> workspaceRoot / workspaceRootsAll
//   commands.register (slash commands)            -> registerCommand
//   llm.listProviders / listModels / resolveModelInfo -> llmCatalog
//   user-role message construction (injection)    -> userMessage
//
// Consumers use `createDshAdapter(ctx)` directly (works standalone, e.g. in
// unit tests) or `ctx.get("mpdDsh")` for the mounted instance provided by the
// `mpd-dsh-adapter` row. The adapter never mutates harness state on import and
// never throws at construction: a missing seam surfaces as an actionable error
// at call time, or as a `capabilities()` flag a caller can degrade on.
import { randomUUID } from "node:crypto"
import { resolve } from "node:path"

export const name = "mpd-dsh-adapter"
// No hard service dependency: every seam is resolved lazily through ctx.get()
// so the row mounts in any composition order and in partial installs.
export const inject: string[] = []

/** Object-rooted JSON Schema used whenever a caller omits one. */
const OBJECT_SCHEMA: Record<string, unknown> = { type: "object", properties: {} }
const DEFAULT_TOOL_TIMEOUT_MS = 120_000
/** The four Agent Teams seams a USABLE shared task board needs (see `capabilities().teamTasks`). */
const TEAM_TASK_METHODS = ["createTask", "getTask", "listTasks", "updateTask"] as const

export type DshTextBlock = { type: "text"; text: string }

export interface DshToolExec {
  name?: string
  arguments?: Record<string, unknown>
  agent?: unknown
  signal?: AbortSignal
  [key: string]: unknown
}

export interface DshToolOutput {
  schema?: Record<string, unknown>
  render?: (args: unknown, value: unknown) => unknown
  presentationMeta?: unknown
}

export interface DshToolDef {
  name: string
  description: string
  parameters?: Record<string, unknown>
  output?: DshToolOutput
  timeoutMs?: number
  execute: (args: any, exec: any) => unknown
}

/**
 * Optional input hint advertised to capable clients.
 *
 * MEASURED against the installed harness (`dsh-commands/lib/index.js`
 * `normalizeDefinition`): `hint` must be a non-empty string and `attachments`, when
 * present, must be a boolean; a definition that fails either check throws at
 * `register()` time.
 */
export interface DshCommandInput {
  hint: string
  attachments?: boolean
}

/** The invocation the harness hands one registered command handler. */
export interface DshCommandInvocation {
  /** Exact text following the command name, including separator whitespace. */
  rawInput: string
  /** The Agent whose surface received the command — the injection target. */
  agent?: unknown
  signal?: AbortSignal
  attachments?: readonly unknown[]
  /**
   * Submit one user-role message into the INVOKING agent's own next turn, through
   * {@link DshAdapter.submitUserTurn}. Bound by `registerCommand`, so a handler
   * never has to touch the host's `invocation.agent` shape itself (AGENTS.md §6).
   *
   * A handler that only RETURNS `{kind:'success', text}` does not run the
   * objective — the host runs a command "without sending the command to the
   * model" — so a command that must start work submits through here (or through
   * a pre-step `{kind:'enter', messages:[…]}` decision, which needs no seam:
   * `onEvent` forwards to `ctx.on`).
   *
   * @returns true when the submission reached the agent's turn seam.
   */
  submit?: (message: DshUserMessage) => boolean
  [key: string]: unknown
}

/**
 * One command registration.
 *
 * `name` is the LOWERCASE name WITHOUT the leading slash: the host parses
 * `/^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])/u` and validates the registered name
 * against its own `COMMAND_NAME` pattern, so `/ulw` registers as `"ulw"`. A
 * duplicate name THROWS inside the host registry, which is why a caller
 * registers `/ulw` and `/ultrawork` as two separate definitions.
 */
export interface DshCommandDef {
  name: string
  description: string
  input?: DshCommandInput
  handler: (invocation: DshCommandInvocation) => unknown
}

// Producer tag of an injected message. The harness's format-v4 gate accepts a
// PRODUCER-OWNED kind and REFUSES the retired shared `plugin` member (measured on
// 0.1.7-rc.2: `dsh: format v4 message requires a producer-owned source kind`, which
// takes the whole boot down), so a producer names itself — `{kind:'user'}`,
// `{kind:'mpd-roles',reason:'session-start-advisory'}`, `{kind:'mpd-ulw',…}`.
export interface DshUserMessageSource {
  kind: string
  [key: string]: unknown
}

/** A user-role message the harness accepts for session injection. */
export interface DshUserMessage {
  /** Fresh identity, the branded `MessageId` string the host stores. */
  id: string
  role: "user"
  content: DshTextBlock[]
  source: DshUserMessageSource
}

export interface DshUserMessageInput {
  /** Model-facing text; becomes the single `text` content block. */
  text: string
  /** Producer tag; defaults to `{kind:'user'}` (a plain user gesture). */
  source?: DshUserMessageSource
}

/** Waterfall decision handed to a post-execute listener (the downstream result). */
export interface DshPostDecision {
  kind: "accept" | "block"
  content?: unknown
  value?: unknown
  feedback?: unknown
  additionalContexts?: unknown[]
  [key: string]: unknown
}

/**
 * The `tools/pre-execute` decision the harness's own gate consumes.
 *
 * Measured in the installed harness (`dsh-tools/lib/index.js:3116`,
 * `types/index.d.ts:38`): the pre-execute waterfall resolves to this object and the
 * registry then reads `gate.kind` (`allow` dispatches, `ask` goes through approval,
 * `deny` is turned into an error result). A listener that returns without delegating
 * REPLACES it — the same veto shape `agent/pre-step` has.
 */
export interface DshPreDecision {
  kind: "allow" | "ask" | "deny"
  reason?: unknown
  [key: string]: unknown
}

export interface DshPostResult {
  content?: unknown
  isError?: boolean
  error?: { message?: string } | unknown
  value?: unknown
  [key: string]: unknown
}

export interface DshSpawnSpec {
  label: string
  prompt: string | DshTextBlock[]
  /** Flat route (preferred by this bundle) or the harness-shaped agentOptions. */
  provider?: string
  model?: string
  agentOptions?: { provider?: string; model?: string }
  persona?: string
  toolFilter?: unknown
  maxDepth?: number
  outputSchema?: Record<string, unknown>
  parent?: unknown
  signal?: AbortSignal
  /** Harness spawn mode; this bundle always uses the one-shot "spawn" mode. */
  mode?: string
}

export interface DshSpawnResult {
  output: string
  structured: any
  stopReason: string | null
}

// ── the official Agent Teams plane ──────────────────────────────────────────
// The shapes below are the INSTALLED harness's own public team types
// (`@deepseek-ai/dsh-experimental-agent-team/lib/types/{roster,types}.d.ts`),
// re-declared HERE rather than imported: the package is not resolvable by bare
// specifier from this repository, and AGENTS.md §6 makes this file the ONE place
// a harness rename or reshape is absorbed, so the mpd-facing contract must not
// depend on the host's module layout. Field names mirror the host exactly, so a
// consumer never has to guess and a projection below never invents a key.

/** One Agent's Team identity, as `tryMembership(agent)` resolves it (`TeamMembership`). */
export interface DshTeamMembership {
  /** The implicit team's identity (the Lead Session id, branded `TeamId` on the host). */
  teamId: string
  role: "lead" | "teammate"
  /** The model-facing member name. */
  name: string
}

/** One runtime-enriched roster row (`TeamMemberView`). */
export interface DshTeamMemberView {
  id: string
  name: string
  role: "lead" | "teammate"
  status: "running" | "inactive" | "provisioning" | "failed"
  description?: string
  provider?: string
  context?: "fresh" | "fork"
  model?: string
  /** Always an array (`[]` when the host declares none), so a consumer can iterate. */
  diagnostics: string[]
}

/** Durable task lifecycle (`TeamTaskStatus`). */
export type DshTeamTaskStatus = "pending" | "in_progress" | "completed" | "deleted"

/** One runtime-enriched shared-task row (`TeamTaskView`). */
export interface DshTeamTaskView {
  id: string
  revision: number
  subject: string
  description: string
  status: DshTeamTaskStatus
  blockedBy: string[]
  writeScopes: string[]
  ownerName?: string
  ready: boolean
  writeScopeWarnings: string[]
}

/** Input for one new shared task (`CreateTeamTaskRequest`). */
export interface DshTeamCreateTaskRequest {
  subject: string
  description?: string
  blockedBy?: readonly string[]
  writeScopes?: readonly string[]
}

/** The eight supported task transitions (`TeamTaskAction`). */
export type DshTeamTaskAction =
  | "claim" | "release" | "edit" | "set_dependencies" | "complete" | "reopen" | "reassign" | "delete"

/** One compare-and-set task mutation (`UpdateTeamTaskRequest`). */
export interface DshTeamUpdateTaskRequest {
  taskId: string
  expectedRevision: number
  action: DshTeamTaskAction
  subject?: string
  description?: string
  blockedBy?: readonly string[]
  writeScopes?: readonly string[]
  owner?: string
}

/** Input for one durable peer message (`SendTeamMessageRequest`). */
export interface DshTeamSendMessageRequest {
  target: string
  content: unknown
  signal?: AbortSignal
}

/** Result after a peer message enters the durable mailbox (`SendTeamMessageResult`). */
export interface DshTeamSendMessageResult {
  messageId: string
  status: "accepted" | "queued"
}

/** Input for one durable teammate (`SpawnTeammateRequest`). */
export interface DshTeamSpawnTeammateRequest {
  name: string
  description: string
  prompt: unknown
  context?: "fresh" | "fork"
  provider?: string
  signal?: AbortSignal
}

/** Result after one teammate reaches a durable active or failed edge. */
export interface DshTeamSpawnTeammateResult {
  member: DshTeamMemberView
}

/** The target status sampled before a teammate interrupt. */
export interface DshTeamInterruptResult {
  previousStatus: "running" | "inactive"
}

/** Result of waiting for Team activity (`TeamWaitResult`). */
export interface DshTeamWaitResult {
  timedOut: boolean
}

/**
 * One LIVE Team, folded from the agent registry (see {@link DshAdapter.teamLiveTeams}).
 *
 * There is no durable `.mpd/team` record any more (the harness keeps team state in the
 * Lead Session log and publishes it as the `agentTeam` Session projection), so a live
 * Lead Agent is the only handle from which a roster and a board can be read.
 */
export interface DshTeamView {
  /** The implicit team identity (the Lead Session id on the host). */
  teamId: string
  leadName: string
  leadSessionId: string
  members: DshTeamMemberView[]
  tasks: DshTeamTaskView[]
}

/**
 * The `agent/pre-step` payload, as much of it as an mpd listener depends on.
 *
 * MEASURED against the installed harness (`dsh-agent-loop/lib/index.js`
 * `preStep()`): the waterfall is dispatched with `{messages: claimed, turn, step,
 * agent?, signal}` and its default decision is `{kind:'enter', messages}` — the
 * SAME payload `dsh-agent-instructions` and `dsh-compaction-basic` read. `messages`
 * are the step's claimed inbox items, which is where the user-role turn lives.
 */
export interface DshAgentPreStep {
  agent?: unknown
  messages?: readonly unknown[]
  turn?: number
  step?: number
  signal?: AbortSignal
  [key: string]: unknown
}

/**
 * The `agent/pre-step` decision the harness consumes: `{kind:'enter', messages}`
 * carrying the messages the step will run with, or `{kind:'reject'}` to refuse it.
 *
 * A listener may replace `messages` (that is how a user-role advisory notice is
 * injected) — see {@link DshAdapter.onAgentPreStep}.
 */
export interface DshPreStepDecision {
  kind?: string
  messages?: readonly unknown[]
  [key: string]: unknown
}

export interface DshToolCallResult {
  ok: boolean
  isError: boolean
  value?: unknown
  error?: unknown
  raw?: unknown
}

export interface DshSkillSummary {
  name: string
  description?: string
  source?: string
  provider?: string
  resourceBase?: { kind: string; path?: string; url?: string; description?: string }
  [key: string]: unknown
}

export interface DshPresetInfo {
  id: string
  path?: string
  trust?: string
  broken?: string
}

/**
 * One system-prompt section, as {@link DshAdapter.registerPromptSection} forwards it.
 *
 * MEASURED against the installed harness (`dsh-system-prompt/lib/types/index.d.ts`
 * `PromptSection`): `name` is unique (a duplicate registration THROWS inside the
 * registry, and that error is deliberately NOT swallowed here), sections are
 * concatenated in ascending `order`, and `text` is either static or a provider
 * re-evaluated at every assembly. The host's optional `complete` flag is not modelled
 * because no mpd caller sets it; the open index signature keeps such extra keys
 * forwardable VERBATIM instead of being silently dropped by a spread.
 */
export interface DshPromptSection {
  name: string
  order: number
  text: string | ((ctx: unknown) => string)
  [key: string]: unknown
}

/**
 * One agent's OWN scope: the RAW agent context plus the three members a plugin needs
 * from it, each a thin forwarder bound to that same context object.
 *
 * `context` IS `agent.ctx` (identity, never a projection). That is load-bearing:
 * the adopted agent-teams plugin hands it to a member's setup callback, and
 * `dsh-tools`' `restrict` resolves against a REAL scoped cordis context — a rebuilt
 * look-alike would be rejected there.
 *
 * Measured harness shapes: `dsh-tools/lib/types/index.d.ts`
 * `restrict(filter): () => void` (the filter is `{allow?, deny?}` of names);
 * cordis `ctx.on(event, listener): () => void` and `ctx.effect(fn, label?): () => void`.
 */
export interface DshAgentScope {
  context: unknown
  tools: { restrict(filter: { allow?: readonly string[]; deny?: readonly string[] }): () => void }
  on(event: string, handler: (...args: unknown[]) => unknown): () => void
  effect(fn: () => unknown, label?: string): () => void
}

export interface DshCapabilities {
  tools: boolean
  toolsRegister: boolean
  toolsGuard: boolean
  toolsGet: boolean
  toolsExecute: boolean
  toolsPreExecute: boolean
  toolsPostExecute: boolean
  subagents: boolean
  subagentsSpawn: boolean
  skills: boolean
  skillsProvider: boolean
  agentPresets: boolean
  /** `ctx.get("commands")`: the human-command registry. */
  commands: boolean
  /** The registry's `register()` — the seam {@link DshAdapter.registerCommand} needs. */
  commandsRegister: boolean
  /**
   * The turn-submission seam: at least one LIVE agent exposes `agent.followup`,
   * i.e. {@link DshAdapter.submitUserTurn} can start a turn for it.
   *
   * This is a LIVE-REGISTRY probe (the same shape as {@link DshCapabilities.compactionForAgent}),
   * so a composition with no live session reports false even though the surface
   * exists. `submitUserTurn`'s own boolean return is therefore the authoritative
   * per-call signal; this flag is the apply-time snapshot.
   */
  turnSubmit: boolean
  /** The live-session registry (`agents.list`) — the only way to reach a member's Agent. */
  agents: boolean
  /** `ctx.get("compaction")`: the HOST-plane engine. Never used to drive a member. */
  compaction: boolean
  /** A memoized per-agent engine lookup through the agent's OWN scoped context. */
  compactionForAgent: boolean
  /** The harness event seam (`ctx.on`) — used to observe status edges. */
  events: boolean
  /**
   * The model-catalog seam: `ctx.get("llm")` exposes ALL THREE methods
   * {@link DshAdapter.llmCatalog} reads (`listProviders`, `listModels`,
   * `resolveModelInfo`). Callers degrade to their declared option lists when false.
   */
  llmCatalog: boolean
  /**
   * The VERBATIM host-tool registration seam (`tools.register`) used by
   * {@link DshAdapter.registerHostTool}. Same probe as {@link DshCapabilities.toolsRegister},
   * reported separately because the two methods carry DIFFERENT contracts: `registerTool`
   * normalizes a definition, `registerHostTool` forwards an already harness-shaped one.
   */
  toolsRegisterHost: boolean
  /**
   * `ctx.subagents.getProvider` AND `.list` (both must be callable, because
   * {@link DshAdapter.subagentProvider} and {@link DshAdapter.subagentProviders} address
   * the same catalogue; a half-present service reports false so a caller degrades to its
   * own message instead of a `TypeError`).
   */
  subagentsProvider: boolean
  /** `ctx.subagents.startContinuable` — the durable continuable-child seam. */
  subagentsContinuable: boolean
  /** `ctx.subagents.interrupt` — the parked-child interrupt seam. */
  subagentsInterrupt: boolean
  /** `ctx.llm.listModels` — the per-provider model list (the catalog seam needs its own trio). */
  llmListModels: boolean
  /** `ctx.llm.resolveCallConfig` — resolves one call's provider/model/effort config. */
  llmResolveCallConfig: boolean
  /** `ctx.systemPrompt.section` — the system-prompt contribution seam. */
  systemPromptSection: boolean
  /**
   * A live agent's own context exposes every member {@link DshAgentScope} promises
   * (`on`, `effect`, `tools.restrict`), i.e. {@link DshAdapter.agentScope} can build a
   * scope for it.
   *
   * Like {@link DshCapabilities.turnSubmit} this is a LIVE-REGISTRY probe, so a
   * composition with no live session reports false even though the surface exists;
   * `agentScope`'s own `undefined` return is the authoritative per-call signal.
   */
  agentScope: boolean
  /**
   * A live agent exposes `followup` — the THROWING turn seam
   * {@link DshAdapter.startAgentTurn} forwards to. Same live probe as
   * {@link DshCapabilities.turnSubmit}; the two flags are distinct because the METHODS
   * have deliberately different contracts (throwing vs boolean).
   */
  agentTurnStart: boolean
  /** A live agent exposes `cancel` — the seam {@link DshAdapter.cancelAgentTurn} forwards to. */
  agentTurnCancel: boolean
  /**
   * A live agent exposes `steer` — the seam {@link DshAdapter.steerAgentTurn} forwards to
   * (nearest-step steering, distinct from `followup`'s own new turn).
   */
  agentTurnSteer: boolean
  /**
   * A live agent exposes `inject` — the inbox seam {@link DshAdapter.injectAgentMessage}
   * forwards to.
   */
  agentTurnInject: boolean
  /**
   * A live agent's OWN scope exposes `systemPrompt.section`, i.e.
   * {@link DshAdapter.agentPromptSection} can register a section for THAT agent
   * (and not for every session of the process).
   *
   * A LIVE-REGISTRY probe like {@link DshCapabilities.agentScope}: a composition with
   * no live session reports false although the surface exists, and the per-call
   * return/throw stays authoritative.
   */
  agentPromptSection: boolean
  /**
   * The `agent/pre-step` waterfall is reachable (`ctx.on`), i.e.
   * {@link DshAdapter.onAgentPreStep} can observe and amend a step's decision.
   * Same probe as {@link DshCapabilities.events}; reported apart because the two
   * methods carry different contracts (a raw forwarded listener vs. one whose
   * decision replaces the downstream one).
   */
  agentPreStep: boolean
  /**
   * A LIVE agent's own scope exposes `on`, i.e. {@link DshAdapter.registerAgentPreStep} can
   * register an `agent/pre-step` listener THAT DELIVERY REACHES.
   *
   * This is the flag a caller must branch on for the waterfall: a scope-filtered dispatch
   * reaches a listener only when the listener's scope is the dispatch scope or an ancestor of
   * it, so the agent-scoped registration is the reliable one (see
   * {@link DshAdapter.registerAgentPreStep}). A LIVE-REGISTRY probe like
   * {@link DshCapabilities.agentScope}: no live session reports false although the surface
   * exists, and the per-call throw stays authoritative.
   */
  agentPreStepScope: boolean
  /**
   * The official Agent Teams service (`ctx.get("agentTeams")`) exposes the IDENTITY +
   * ROSTER read surface (`tryMembership` and `listMembers`), i.e.
   * {@link DshAdapter.teamMembership} and {@link DshAdapter.teamListMembers} can run.
   *
   * This is the service-level flag of the team plane: `teamSpawnTeammate`,
   * `teamInterrupt` and `teamWaitForChange` are gated by it too, while the two finer
   * families report their own flags below.
   */
  team: boolean
  /**
   * The shared task board is usable: `createTask`, `getTask`, `listTasks` and
   * `updateTask` are ALL callable, so {@link DshAdapter.teamCreateTask} /
   * `teamGetTask` / `teamUpdateTask` / `teamListTasks` can run.
   */
  teamTasks: boolean
  /**
   * The peer-mailbox surface is usable: `sendMessage` AND `waitForChange` are callable,
   * so {@link DshAdapter.teamSendMessage} and {@link DshAdapter.teamWaitForChange} can run.
   */
  teamMessages: boolean
  /**
   * `ctx.subagents.registerProvider` — the seam
   * {@link DshAdapter.registerSubagentProvider} needs (the existing
   * {@link DshCapabilities.subagentsProvider} flag covers the READ half, `getProvider`
   * + `list`; the two are reported apart because the methods carry different contracts).
   */
  subagentsProviderRegister: boolean
}

/**
 * A live session's Agent, as much of it as this bundle depends on.
 *
 * Measured by the compact-hinge experiment (t45, evidence/omo-align/compact-hinge):
 * `ctx.agents.list()` returns live Agents, `id` is the shared session/agent id, and a
 * member's own compaction engine is reachable ONLY as `agent.ctx.get("compaction")` —
 * the host-plane instance is a DIFFERENT object serving a different realm.
 */
export interface DshLiveAgent {
  id: string
  status?: string
  session?: unknown
  ctx?: unknown
  runMaintenance?: unknown
}

/**
 * One selectable reasoning effort of one model (see {@link DshLlmCatalog}).
 */
export interface DshLlmCatalogEffort {
  /** Opaque value accepted as `reasoningEffort` (host `LlmReasoningEffortInfo.id`). */
  id: string
  /** Human-readable effort name for selectors. */
  name: string
  description?: string
}

/** One model of one provider, with its reasoning metadata FLATTENED onto it. */
export interface DshLlmCatalogModel {
  id: string
  name: string
  description?: string
  /** Always an array: `[]` when the model declares no reasoning block. */
  efforts: DshLlmCatalogEffort[]
  /** The adapter-configured default effort, absent when the host declares none. */
  defaultEffort?: string
}

/** One provider route and every model it currently advertises. */
export interface DshLlmCatalogProvider {
  id: string
  name: string
  models: DshLlmCatalogModel[]
}

/**
 * The host's live model catalog, projected for a SERVER-side picker (see
 * {@link DshAdapter.llmCatalog}).
 *
 * The host builds its own browser catalog in
 * `@deepseek-ai/dsh-api-session-controller` (`buildModelCatalog(ctx)`); this seam is that
 * same read performed HERE, so a plugin never touches `ctx.llm` (AGENTS.md §6).
 * Two shape differences are deliberate:
 *   1. the host nests `reasoning: {efforts, defaultEffort}`; this projection FLATTENS it
 *      onto the model (`efforts`/`defaultEffort`), because a settings knob addresses the
 *      effort as one leaf of the model;
 *   2. `efforts` is ALWAYS present (`[]` for a model with no reasoning block) so a
 *      consumer can iterate without a guard.
 * Absent providers/models are simply not listed; `degraded` says whether anything was
 * dropped or unreadable.
 */
export interface DshLlmCatalog {
  providers: DshLlmCatalogProvider[]
  /** True when any part of the catalog could not be read (missing seam, rejecting provider/model). */
  degraded: boolean
}

/**
 * The harness settings-service subset the mpd settings bridge needs (t34 design
 * §5 invariant 2: no mpd plugin may touch a harness service directly).
 *
 * The NAMESPACE IS REGISTERED BY `mpd-tui-plugin` (captain ruling, 2026-09-15);
 * this seam therefore only READS and SUBSCRIBES — it never registers, so a second
 * registration (which the provider rejects loudly) is impossible by construction.
 */
/** The outcome of {@link DshAdapter.settingsMutate}: never a throw, always a result. */
export type DshSettingsMutateResult = { ok: true } | { ok: false; error: string; conflict?: boolean }

export interface DshSettingsReader {
  /** Resolved value of the namespace (`undefined` while it is not served). */
  get(): unknown
  /** The namespace descriptor when available: value/revision/user/base/applies. */
  describe(): { value?: unknown; revision?: number; user?: unknown; base?: unknown; applies?: string } | undefined
}

export interface DshAdapter {
  capabilities(): DshCapabilities
  /**
   * Authoritative workspace root for one call. Precedence, highest first:
   *   1. the CALLING SESSION's workspace  (exec.agent.session.header.cwd)
   *   2. `DSH_WORKSPACE_ROOT`             (process override: operator/QA only)
   *   3. `process.cwd()`                  (last resort: boot, unit tests)
   * The session fact outranks the process-wide env because one host serves
   * many sessions with different workspaces.
   */
  workspaceRoot(exec?: DshToolExec): string
  /**
   * Workspace roots of every LIVE session, deduplicated, in registration order.
   * `[]` when the harness exposes no agent registry — callers then fall back to
   * the exec-less `workspaceRoot()`. For agentless surfaces (web routes) only.
   */
  workspaceRootsAll(): string[]
  /** Every live Agent in this process (`[]` when the registry is absent). */
  liveAgents(): DshLiveAgent[]
  /** One live Agent by id, or undefined. */
  liveAgent(agentId: string): DshLiveAgent | undefined
  /**
   * The compaction engine THAT SERVES ONE AGENT, resolved through the agent's own
   * scoped context. This is the ONLY correct engine to drive a member session: the
   * host-plane `ctx.get("compaction")` is a different instance covering a different
   * realm (measured `sameObject: false`), so using it would compact the wrong thing.
   * Memoized per agent id, and dropped when the agent is gone so a recycled id cannot
   * inherit a stale engine.
   */
  compactionEngineForAgent(agentId: string): unknown
  /** Subscribe to a harness event; returns a disposer, or undefined when unavailable. */
  onEvent(event: string, handler: (...args: unknown[]) => unknown): (() => void) | undefined
  /**
   * The host's live model catalog, read ONLY through `ctx.llm`
   * (`listProviders` / `listModels` / `resolveModelInfo`) and projected as
   * {@link DshLlmCatalog} for a server-side picker.
   *
   * NEVER throws and never rejects. A missing `llm` service, or one lacking any one
   * of the three methods, resolves to `{ providers: [], degraded: true }` and logs ONE
   * warn-once line naming the missing seam. A provider whose `listModels` rejects, or a
   * model whose `resolveModelInfo` rejects, is SKIPPED — it no longer takes the whole
   * catalog down — and the returned catalog carries `degraded: true`.
   */
  llmCatalog(): Promise<DshLlmCatalog>
  /**
   * List one provider's models through the harness llm service — the read the
   * adopted agent-teams plugin needs when it validates a member's route.
   *
   * A THIN forwarder: `listModels(provider)` on the service, receiver-bound, and the
   * service's own promise handed back untouched (its rejections stay rejections).
   * Degrade: a composition without the service, or without `listModels`, THROWS
   * synchronously — parity with the raw `ctx.llm.listModels(provider)` expression the
   * caller would otherwise run, so a caller's `try/catch` keeps working. Reported by
   * `capabilities().llmListModels`.
   */
  llmListModels(provider: string): Promise<unknown>
  /**
   * Resolve one call's provider/model/effort configuration through the harness llm
   * service (`resolveCallConfig(config, signal?)`), receiver-bound, promise forwarded.
   *
   * Degrade: THROWS synchronously when the service or the method is absent (parity
   * with the raw expression). Reported by `capabilities().llmResolveCallConfig`.
   */
  llmResolveCallConfig(config: unknown, signal?: AbortSignal): Promise<unknown>
  /** Reader for one settings namespace, or undefined when the service is absent. */
  settingsReader(namespace: string): DshSettingsReader | undefined
  /**
   * Subscribe to `settings/document-updated(ns, revision)` — the RAW-section change
   * event (fires even when the resolved value did not change), which is the
   * write-back trigger.
   *
   * `revision` and `source` describe the SAME change. The host emits
   * `bumpRevision` (=> `settings/document-updated`) BEFORE `commit`
   * (=> `settings/updated(ns,next,prev,source)`) inside one synchronous
   * `write()`/`publish()` call — MEASURED in
   * `@deepseek-ai/dsh-settings/lib/index.js:466-467` and `:497-498` — so the
   * source cannot be read at document-updated time. This seam therefore
   * COALESCES the two events per tick and calls the listener on the next
   * microtask, after both have fired, with the source of the same change.
   *
   * `source === undefined` means the raw section changed while the resolved value
   * did not (`commit` returns early), so no `settings/updated` fired; callers must
   * gate such a change on their own value diff rather than treating it as a
   * front-door edit.
   */
  onSettingsDocumentUpdated(
    namespace: string,
    listener: (revision: number | undefined, source: string | undefined) => void,
  ): () => void
  /**
   * REGISTER a settings namespace and receive its owner scope (design §10.1 places this call in
   * `mpd-config-plugin`, because only it can supply the file-derived `base`). Duplicate
   * registration fails loud on this host (`dsh-settings` `register()` line 283), which is why the
   * TUI package's fallback must probe first.
   *
   * NOTE, MEASURED: the host exposes NO disposal handle for a live registration — `register()`
   * returns only `{get, watch, update, replace}` and removes the namespace from an internal
   * `ctx.effect`. The design's §1.3 fallback therefore governs: the base is fixed for the process
   * lifetime and the resolved value is the authority (the host's own `installSection` does the
   * same, `dsh-settings/lib/index.js:327-350`).
   */
  settingsRegister(
    namespace: string,
    schema: unknown,
    options?: { base?: unknown; applies?: string },
  ): { ok: true } | { ok: false; error: string }
  /**
   * Run `callback` once the settings provider is MOUNTED. MEASURED: a loader applies rows
   * concurrently, so `service("settings")` can be undefined while a row that mounts before the
   * provider is applying — `mpd-config`'s registration attempt then fails with "settings service is
   * unavailable" and the TUI fallback ends up owning the namespace without a file-derived base.
   * The callback parks on `ctx.inject(["settings"], …)` inside the adapter (invariant 2: the
   * adapter is the only place allowed to reach the harness directly).
   */
  whenSettingsAvailable(callback: () => void): void
  /**
   * Write ops into a namespace this plugin does NOT register
   * (`settings.mutate(ns, ops, expectedRevision)`; the revision fence raises the
   * host's `SettingsConflictError` on a concurrent change). Used by the bridge's
   * §1.2 clearing rule: a fresh FILE edit unsets the overlapping settings override.
   * Returns the mode name on success, or `{ error }` — never throws into an event
   * listener.
   */
  settingsMutate(
    namespace: string,
    ops: readonly { op: "set" | "unset"; path: readonly string[]; value?: unknown }[],
    expectedRevision?: number,
  ): Promise<DshSettingsMutateResult>
  /**
   * Register an ALREADY harness-shaped tool definition, VERBATIM.
   *
   * WHY THIS EXISTS BESIDE {@link DshAdapter.registerTool} (not a duplicate):
   * `registerTool` RECONSTRUCTS what it is given — it injects `parameters` and
   * `output.schema` defaults, supplies a `render` fallback and replaces `execute`
   * with an `(args ?? {}, exec ?? {})` wrapper. A definition that is already
   * harness-shaped (the adopted agent-teams plugin registers `defineTool(...)`
   * output, whose schemas are compiled and whose `execute` validates its own args)
   * loses `finalizeContent`, `presentCall`, `presentResult` and `isConcurrencySafe`
   * through that rebuild, and its `execute` identity would change.
   *
   * This method therefore passes the SAME object reference to `tools.register` and
   * applies NO normalization of its own: `Object.is` holds end to end, and the
   * registry's disposer is passed back. A non-callable return (a stub registry) is
   * degraded to a no-op disposer rather than leaked.
   *
   * Degrade: THROWS when the tools service is unavailable — parity with the injected
   * `ctx.tools` a plugin would otherwise reach. Reported by
   * `capabilities().toolsRegisterHost`.
   *
   * @param definition - the harness-shaped definition; forwarded untouched.
   * @returns the registry's effect disposer (a no-op only when it returned none).
   */
  registerHostTool(definition: unknown): () => void
  registerTool(definition: DshToolDef): () => void
  registerTools(definitions: DshToolDef[]): () => void
  /**
   * Register ONE slash command through the harness command registry — the ONLY
   * sanctioned path (AGENTS.md §6: no plugin touches `ctx.commands` /
   * `ctx.get("commands")` directly).
   *
   * Feature-detected exactly like every other seam: a composition without the
   * `commands` row (or one whose registry exposes no `register()`) returns a
   * NO-OP disposer and NEVER throws, so a plugin's `apply` cannot be taken down
   * while it degrades on `capabilities().commandsRegister`.
   *
   * MEASURED in the installed harness (`dsh-commands/lib/index.js`): `register()`
   * RETURNS the exact `() => void` effect disposer that unregisters the
   * definition, and that disposer is passed through verbatim when it is a
   * function — a stub registry may return anything (the codegraph test double
   * returns `Array.push`'s number), which must degrade to a no-op rather than
   * leak a non-callable as a "disposer". Host-side validation errors (a
   * duplicate name, a malformed definition) are NOT swallowed: they are real
   * programming errors and stay loud, unlike a missing optional seam.
   *
   * @param definition - `{name, description, input?, handler}`; the name carries
   *   NO leading slash (`/ulw` registers as `"ulw"`).
   * @returns the registry's disposer, or a no-op when the seam is absent.
   */
  registerCommand(definition: DshCommandDef): () => void
  /**
   * Contribute ONE section to the host's system prompt
   * (`systemPrompt.section(section)`), the section object forwarded VERBATIM.
   *
   * MEASURED against the installed harness
   * (`dsh-system-prompt/lib/types/index.d.ts` `SystemPrompt.section`) and its runtime
   * (`dsh-agent/lib/index.js` `assembleContextFor`): the section's `text` provider is
   * re-evaluated at every assembly with `{agent, scope, signal?}`, and `section()`
   * returns the exact cordis effect disposer (a non-callable stub answer degrades to a
   * no-op). A DUPLICATE name throws inside the registry and that error is deliberately
   * NOT swallowed.
   *
   * Degrade: THROWS at the call — the adopted plugin's usage section is mandatory, so a
   * composition without this seam must fail loudly at apply time instead of silently
   * dropping the section. Reported by `capabilities().systemPromptSection`.
   */
  registerPromptSection(section: DshPromptSection): () => void
  guardTool(guard: (exec: DshToolExec) => string | undefined): () => void
  /**
   * Observe a tool call BEFORE dispatch — the `tools/pre-execute` waterfall.
   *
   * **OBSERVE-ONLY, by construction.** The adapter owns `next()` exactly like
   * {@link DshAdapter.onPostToolExecute} does: it awaits the downstream decision, hands it
   * to the listener (whose return value is IGNORED) and returns the downstream
   * decision object itself, so this hook can neither alter nor veto a call. The listener
   * observes a **frozen shallow copy** of the execution — it cannot mutate what will be
   * dispatched — and a listener that throws is contained. A harness build with no event bus
   * makes this a no-op (`() => {}`), never a boot failure; `capabilities().toolsPreExecute`
   * reports it.
   *
   * The listener runs AFTER `next()` resolves but still BEFORE the tool body dispatches
   * (the harness awaits the whole waterfall before it executes, `dsh-tools/lib/index.js:3116`),
   * so it sees the decision that will actually be used.
   *
   * @param listener - `(exec, decision)`; the decision is the harness's own
   *   `{kind:'allow'|'ask'|'deny'}` gate value (see {@link DshPreDecision}).
   * @returns a disposer (a no-op when the seam does not exist).
   */
  onPreToolExecute(listener: (exec: DshToolExec, decision: DshPreDecision | undefined) => void): () => void
  onPostToolExecute(
    listener: (exec: DshToolExec, result: DshPostResult, downstream: DshPostDecision) => DshPostDecision | undefined | Promise<DshPostDecision | undefined>,
  ): () => void
  /**
   * Observe and AMEND one agent step BEFORE it runs — the `agent/pre-step` waterfall.
   *
   * The adapter owns `next()` exactly like {@link DshAdapter.onPostToolExecute} does:
   * it awaits the downstream decision, hands the listener `(payload, downstream)` and
   * returns the listener's decision when it returns one, else the downstream decision
   * UNCHANGED. That is what makes an advisory injection possible — a listener replaces
   * `messages` (the harness runs the step with the decision's message list) — while a
   * listener that returns nothing is bit-identical to a composition without this hook.
   *
   * A listener that THROWS is contained: the downstream decision is returned, so a
   * broken observer can never break a step (a missing optional seam must never take a
   * boot down). A harness build with no event bus makes this a no-op (`() => {}`),
   * never a boot failure; `capabilities().agentPreStep` reports it.
   *
   * @param listener - `(payload, decision)`; the payload carries the claimed `messages`,
   *   `turn`, `step` and `signal` (see {@link DshAgentPreStep}). It USUALLY carries `agent`
   *   too (the loop's dispatcher fuses it), but a caller must not depend on that: bind the
   *   agent with {@link DshAdapter.registerAgentPreStep} instead.
   * @returns a disposer (a no-op when the seam does not exist).
   *
   * NOTE: this host-plane registration is NOT guaranteed to be delivered — `agent/pre-step`
   * is dispatched through the agent's SCOPE CARRIER, and a scope-filtered dispatch reaches a
   * listener only when the listener's scope is the dispatch scope or an ancestor of it. Use
   * {@link DshAdapter.registerAgentPreStep} for anything that must actually run.
   */
  onAgentPreStep(
    listener: (payload: DshAgentPreStep, decision: DshPreStepDecision) => DshPreStepDecision | undefined | Promise<DshPreStepDecision | undefined>,
  ): () => void
  /**
   * Register a pre-step listener in ONE agent's OWN scope — the registration site that
   * DELIVERY actually reaches, and the agent-scoped sibling of
   * {@link DshAdapter.onAgentPreStep}.
   *
   * MEASURED WHY THIS EXISTS (2026-09-27): the session-start gate was installed through a
   * row's ctx, printed its install line, and injected NOTHING on six live headless boots —
   * while the SAME row's `agent/created` listener (an unfiltered emit) ran on every one. The
   * harness dispatches `agent/pre-step` through the agent's scope carrier
   * (`dsh-agent` `agentEvents(…).waterfall` -> `ctx.waterfall(carrier, …)`), and `dsh-scope`'s
   * `scopeTarget` filter admits a listener only when its scope IS the dispatch scope or an
   * ancestor of it. Registering on `agent.ctx` makes the listener's scope the agent itself, so
   * the filter admits it by construction — which is exactly how the harness's own pre-step
   * subscribers (`dsh-agent`, `dsh-subagent-in-process-driver`) register.
   *
   * The listener contract is IDENTICAL to {@link DshAdapter.onAgentPreStep} (the adapter owns
   * `next()`, a returned decision replaces the downstream one, `undefined` passes through, a
   * throw is contained); only the registration site differs, and binding the agent at
   * registration also removes any dependence on the payload carrying `agent`.
   *
   * Degrade: THROWS at the call when the agent (or its scoped context) exposes no `on` — a
   * silently unregistered listener is precisely the defect this seam exists to prevent.
   * Reported by `capabilities().agentPreStepScope` (a live-registry probe).
   *
   * @param agent - a live Agent whose `ctx` is the registration scope.
   * @param listener - `(payload, decision)`; the payload may omit `agent` (the bound agent is
   *   the caller identity).
   * @returns the scope's disposer.
   */
  /**
   * Subscribe to harness events at ONE AGENT's own scope. See the implementation for why the
   * registration site is the agent's scope and not a row's, and why the inbox triple makes a real
   * unread count possible.
   */
  subscribeAgentEvents(agent: unknown, events: readonly string[], handler: (event: string, payload: unknown) => void): () => void
  /** The harness web server, probed tolerantly; see the implementation for the two names it tries. */
  webServerOf(): unknown
  /** Run `callback` when one of `names` binds (or rebinds) as a service; returns a disposer. */
  onServiceBound(names: readonly string[], callback: (name: string) => void): () => void
  registerAgentPreStep(
    agent: unknown,
    listener: (payload: DshAgentPreStep, decision: DshPreStepDecision) => DshPreStepDecision | undefined | Promise<DshPreStepDecision | undefined>,
  ): () => void
  hasTool(name: string): boolean
  /**
   * Structural view of the tool runtime for internal tool calls.
   *
   * `execute`'s optional `agent` is forwarded verbatim as the harness execution's
   * `exec.agent` (measured contract: `dsh-tools/lib/index.js:3025-3045` reads
   * `exec.agent` and `:3190-3192` resolves the tool against it). It stays OPTIONAL
   * so every existing caller keeps its exact meaning: absent = no agent (the
   * pre-existing behaviour).
   */
  toolRuntime(): { get(name: string): unknown; execute(input: { name: string; arguments?: unknown; callId?: string; signal?: AbortSignal; agent?: unknown }): Promise<unknown> }
  /**
   * Call one registered tool in-process and normalize the result.
   *
   * The optional `agent` is the ONE way an agentless surface (a TUI scene, a web
   * route) can drive an agent-scoped tool: the adopted agent-teams write tools
   * begin with `requireCaptain(exec)` and throw without it. Pass the object the
   * live registry returned (`liveAgent(id)` / `liveAgents()[0]`) — never a
   * hand-built Agent-like object.
   */
  executeTool(input: { name: string; arguments?: unknown; callId?: string; signal?: AbortSignal; timeoutMs?: number; agent?: unknown }): Promise<DshToolCallResult>
  spawnAgent(spec: DshSpawnSpec): Promise<DshSpawnResult>
  /**
   * The subagent DELIVERY RUNTIME itself (identity-preserving), or `undefined` when
   * the service is absent.
   *
   * This is the object the adopted agent-teams plugin's Harness-generation ladder
   * reads (`prompt` / `followup` / `[HOST_PROMPT_QUEUE]` / `sendMessage` /
   * `registerContinuableSetup`). WHICH object that ladder operates on is the
   * adapter's business (contract D6); the ladder POLICY stays in the plugin, which
   * is why the adapter hands the raw runtime out rather than projecting it.
   * Reported by the existing `capabilities().subagents` flag.
   */
  subagentRuntime(): unknown
  /**
   * Look one subagent provider up by name (`subagents.getProvider(name)`),
   * receiver-bound, the provider handed back untouched.
   *
   * Degrade: `undefined` when the service or the method is absent — the caller's own
   * capability check then throws its own actionable message. Reported by
   * `capabilities().subagentsProvider`.
   */
  subagentProvider(name: string): unknown
  /**
   * The registered provider NAMES in insertion order (`subagents.list()`).
   *
   * Degrade: `[]` when the service or the method is absent, and a non-string entry in
   * a stub answer is dropped rather than leaking a value the frozen `string[]`
   * return type cannot carry. Reported by `capabilities().subagentsProvider`.
   */
  subagentProviders(): string[]
  /**
   * Establish a durable continuable child (`subagents.startContinuable(spec)`),
   * receiver-bound, the service's own promise forwarded untouched.
   *
   * Degrade: THROWS synchronously — a member that cannot be spawned must be loud, and
   * a synchronous throw keeps parity with the raw expression a caller would run.
   * Reported by `capabilities().subagentsContinuable`.
   */
  startContinuableAgent(spec: unknown): Promise<unknown>
  /**
   * Interrupt one durable child session (`subagents.interrupt(targetSessionId,
   * authority)`), receiver-bound, arguments forwarded verbatim.
   *
   * Degrade: THROWS synchronously when the service or the method is absent. Reported
   * by `capabilities().subagentsInterrupt`.
   */
  interruptAgent(targetSessionId: string, authority: unknown): void
  /**
   * The mounted Agent Teams service itself (`ctx.get("agentTeams")`), or `undefined`
   * when this composition has no team row.
   *
   * The RAW service is handed out deliberately for the same reason
   * {@link DshAdapter.subagentRuntime} is: a consumer may need a surface this adapter
   * does not model yet, and re-declaring it here would be a second seam to keep in
   * sync. Every mpd consumer is expected to prefer the typed methods below and to read
   * this one only as an escape hatch (it is also what the team plane's own probes use).
   * It is contained: a `ctx` that cannot answer is `undefined`, never a throw.
   */
  teamService(): unknown | undefined
  /**
   * One Agent's Team identity (`agentTeams.tryMembership(agent)`), projected onto
   * {@link DshTeamMembership}.
   *
   * **NEVER throws**: a missing service, a service lacking `tryMembership`, a non-Team
   * subagent, a stale identity, a host rejection or a membership whose `role` is not one
   * of the two declared values all answer `undefined`. This is the FILTER method — a
   * caller decides "is this agent on a team?" with it, so an exception would turn a
   * normal negative answer into a failure.
   */
  teamMembership(agent: unknown): DshTeamMembership | undefined
  /**
   * The runtime-enriched roster visible to one Team member
   * (`agentTeams.listMembers(agent)`), each row projected onto {@link DshTeamMemberView}.
   *
   * Degrade: THROWS when the service (or its `listMembers`) is absent — `[]` would
   * conflate "this team has no members" with "no team service is mounted", which is
   * exactly the kind of silent lie this adapter exists to prevent. A caller degrades on
   * `capabilities().team`. A non-array host answer is `[]`.
   */
  teamListMembers(agent: unknown): DshTeamMemberView[]
  /**
   * The current non-deleted board visible to one Team member
   * (`agentTeams.listTasks(agent)`), each row projected onto {@link DshTeamTaskView}.
   *
   * Degrade: THROWS when the service (or its `listTasks`) is absent, for the reason
   * {@link DshAdapter.teamListMembers} names. Reported by `capabilities().teamTasks`.
   */
  teamListTasks(agent: unknown): DshTeamTaskView[]
  /**
   * Create one unowned pending task on the caller's board
   * (`agentTeams.createTask(caller, request)`).
   *
   * `caller` is the exact live Agent used as the authority credential and `request` is
   * forwarded **by identity** (no copy, no key rewrite), so a host field this adapter
   * does not model still reaches the service. The promise is forwarded untouched —
   * the host's own rejections stay rejections — and only a FULFILLED answer is
   * projected onto {@link DshTeamTaskView}.
   *
   * Degrade: THROWS when the service or `createTask` is absent. Reported by
   * `capabilities().teamTasks`.
   */
  teamCreateTask(caller: unknown, request: DshTeamCreateTaskRequest): Promise<DshTeamTaskView>
  /**
   * One task by id, including a deleted tombstone (`agentTeams.getTask(caller, id)`).
   *
   * Degrade: THROWS when the service or `getTask` is absent, and the host's OWN throw
   * for an unknown id propagates verbatim (this adapter never invents a task view).
   * Reported by `capabilities().teamTasks`.
   */
  teamGetTask(caller: unknown, id: string): DshTeamTaskView
  /**
   * One compare-and-set task transition (`agentTeams.updateTask(caller, request)`);
   * `caller` and `request` are forwarded by identity and the promise untouched, exactly
   * like {@link DshAdapter.teamCreateTask}.
   *
   * Degrade: THROWS when the service or `updateTask` is absent. Reported by
   * `capabilities().teamTasks`.
   */
  teamUpdateTask(caller: unknown, request: DshTeamUpdateTaskRequest): Promise<DshTeamTaskView>
  /**
   * Queue one durable peer message (`agentTeams.sendMessage(caller, request)`), the
   * request forwarded by identity and the promise untouched.
   *
   * Degrade: THROWS when the service or `sendMessage` is absent. Reported by
   * `capabilities().teamMessages`.
   */
  teamSendMessage(caller: unknown, request: DshTeamSendMessageRequest): Promise<DshTeamSendMessageResult>
  /**
   * Create one named continuable teammate (`agentTeams.spawnTeammate(caller, request)`),
   * the request forwarded by identity and the promise untouched.
   *
   * NOTE (AGENTS.md §3 of the adaptation plan): this is the path on which per-member
   * model routing CANNOT be applied mechanically — the official
   * `SubagentStartRequest` carries no `agentOptions`/`persona`/`toolFilter`, so the
   * teammate inherits the Lead's route. A caller that needs a roster slot's route
   * states it in the spawn prompt.
   *
   * Degrade: THROWS when the service or `spawnTeammate` is absent (reported by the
   * service-level `capabilities().team`).
   */
  teamSpawnTeammate(caller: unknown, request: DshTeamSpawnTeammateRequest): Promise<DshTeamSpawnTeammateResult>
  /**
   * Interrupt one live teammate turn without clearing its inbox
   * (`agentTeams.interrupt(caller, targetName)`), answering the status sampled BEFORE
   * cancellation.
   *
   * Degrade: THROWS when the service or `interrupt` is absent (reported by
   * `capabilities().team`).
   */
  teamInterrupt(caller: unknown, targetName: string): DshTeamInterruptResult
  /**
   * Wait for the next Team-domain or member-status change
   * (`agentTeams.waitForChange(caller, timeoutMs, signal)`), both arguments forwarded
   * verbatim (`signal` is the caller's cancellation for the WAIT only).
   *
   * Degrade: THROWS when the service or `waitForChange` is absent. Reported by
   * `capabilities().teamMessages`.
   */
  teamWaitForChange(caller: unknown, timeoutMs: number, signal?: AbortSignal): Promise<DshTeamWaitResult>
  /**
   * Every LIVE Team in this process, folded over {@link DshAdapter.liveAgents}: for each
   * live Agent whose `tryMembership` answers `role: "lead"`, its roster and board.
   *
   * `[]` when the team service is absent, when the agent registry is absent, and when
   * NO live agent is a Lead — the three cases are indistinguishable here on purpose,
   * because each of them means "there is nothing to report" to a web route or a TUI
   * scene. Per-agent reads are CONTAINED: a service that lacks `listMembers`/
   * `listTasks`, or a call that throws, yields `[]` for that entry instead of taking
   * either the fold or the caller down (this is a readout, not a command path).
   */
  teamLiveTeams(): DshTeamView[]
  /**
   * Register one subagent provider (`ctx.subagents.registerProvider(provider)`), the
   * provider forwarded VERBATIM and the registry's disposer passed back.
   *
   * Degrade: THROWS when the subagents service (or its `registerProvider`) is absent —
   * parity with {@link DshAdapter.registerSkillProvider}, a registration that silently
   * vanished would leave a caller believing its provider is served. A non-callable
   * registry answer degrades to a no-op disposer rather than leaking. Reported by
   * `capabilities().subagentsProviderRegister`.
   */
  registerSubagentProvider(provider: unknown): () => void
  registerSkillProvider(provider: unknown): () => void
  listSkills(options?: { cwd?: string }): Promise<DshSkillSummary[]>
  loadSkill(skillName: string, options?: { cwd?: string }): Promise<unknown>
  resolvePreset(presetId: string): Promise<DshPresetInfo>
  text(content: unknown): DshTextBlock[]
  /**
   * Build ONE user-role message for SESSION INJECTION — the value
   * `agent.followup(message)` takes and the value a pre-step
   * `{kind:'enter', messages:[…]}` decision appends (in-tree precedent:
   * `packages/mpd-agent-teams-plugin/lib/command.js`, the `/agent-teams`
   * handler, which is what makes a command actually RUN its objective instead of
   * only answering).
   *
   * The shape is built LOCALLY to the installed host's contract rather than
   * imported: `@deepseek-ai/dsh-llm` is not resolvable by bare specifier from
   * this repository (MODULE_NOT_FOUND, measured), and no mpd plugin outside the
   * adopted tree runtime-imports a host package. The field set is measured
   * against the installed `dsh-llm/lib/types/message.d.ts`
   * (`Message = {id, role, content, source}`, `MessageId` is a brand-only
   * passthrough) and the vendored reference implementation
   * (`_deps/dsh-llm/lib/index.js` `createUserMessage`): a fresh `id`, the
   * `user` role, one `{type:'text', text}` block, and the producer tag
   * (`source.kind`). The message is frozen like the host's own constructors
   * freeze theirs.
   */
  userMessage(input: DshUserMessageInput): DshUserMessage
  /**
   * One agent's OWN scope, built from its RAW context, or `undefined` when the context
   * does not expose every member {@link DshAgentScope} promises (the caller then falls
   * back to the raw `agent.ctx` itself).
   *
   * `scope.context` IS `agent.ctx` — identity, never a projection — and `on` / `effect`
   * / `tools.restrict` are thin forwarders bound to that same object, so a member's
   * scoped context keeps working against the harness's own scoped cordis context.
   * The adapter performs NO call during construction: a scope is inert until used.
   *
   * This is the ONE sanctioned spelling of `agent.ctx.<seam>` (contract D5/D8): the
   * Agent's own DATA (`id`/`status`/`session`/`ctx`) stays a direct read on the handle
   * the adapter hands out, while the per-agent SEAMS go through here.
   * Reported by `capabilities().agentScope` (a live-registry probe).
   */
  agentScope(agent: unknown): DshAgentScope | undefined
  /**
   * Contribute ONE section to ONE agent's OWN system prompt
   * (`agent.ctx.systemPrompt.section(section)`), the section forwarded VERBATIM and
   * the registry's disposer passed back.
   *
   * WHY THIS EXISTS BESIDE {@link DshAdapter.registerPromptSection}: the host-plane call
   * adds the section to EVERY session's prompt, which is wrong for a contribution that
   * belongs to one preset's sessions (the roster is advertised to an mpd Lead, not to
   * every session this process serves). The official Agent Teams tool plugin registers
   * its `team:policy` section exactly this way — `const scoped = agent.ctx;
   * scoped.systemPrompt.section({name, order, text})` — which is the measured shape this
   * seam mirrors.
   *
   * Degrade: THROWS at the call when the agent (or its scoped context) exposes no
   * `systemPrompt.section` — a silently dropped section would be a WRONG prompt rather
   * than a missing feature, and the caller reports it as a warning. The host-side name
   * uniqueness rule applies per scope: a duplicate name throws INSIDE the registry and is
   * deliberately NOT swallowed. Reported by `capabilities().agentPromptSection` (a
   * live-registry probe).
   *
   * @param agent - a live Agent whose `ctx` is the target scope.
   * @param section - `{name, order, text}`; forwarded untouched.
   * @returns the registry's effect disposer (a no-op when it returned none).
   */
  agentPromptSection(agent: unknown, section: DshPromptSection): () => void
  /**
   * Start an agent's next turn: `agent.followup(message)`, receiver-bound, forwarded
   * THROWING.
   *
   * This is deliberately NOT {@link DshAdapter.submitUserTurn}: the host's `followup`
   * throws for a rejected submission, and the adopted plugin's own call site depends on
   * that throw inside its `try`/`catch` (contract D9). Swallowing it into a boolean here
   * would silently change the plugin's behaviour, so this seam preserves the throw and
   * the ORIGINAL error.
   *
   * Degrade: THROWS when the agent exposes no `followup` (a caller that wants the
   * safe boolean uses `submitUserTurn` instead). Reported by
   * `capabilities().agentTurnStart`.
   */
  startAgentTurn(agent: unknown, message: unknown): void
  /**
   * Cancel an agent's turn/parked work: `agent.cancel(cause, options?)`,
   * receiver-bound, arguments forwarded verbatim, THROWING (errors from the agent are
   * never swallowed).
   *
   * Degrade: THROWS when the agent exposes no `cancel`. Reported by
   * `capabilities().agentTurnCancel`.
   */
  cancelAgentTurn(agent: unknown, cause: unknown, options?: unknown): void
  /**
   * Steer an agent's NEAREST step: `agent.steer(message)`, receiver-bound, forwarded
   * VERBATIM and THROWING — the same D9 discipline as {@link DshAdapter.startAgentTurn}
   * (a rejected steer must stay a throw, never a swallowed boolean).
   *
   * Measured harness shape: `dsh-agent-loop/lib/index.js` `steer(input)` is
   * `send(input, "next-step", true)` — an idle driver starts a turn, a running driver
   * consumes the item at its next step boundary (distinct from `followup`, which opens
   * its OWN turn). Adopted call sites: the approval notice and the captain-report steer.
   *
   * Degrade: THROWS when the agent exposes no `steer`. Reported by
   * `capabilities().agentTurnSteer`.
   */
  steerAgentTurn(agent: unknown, message: unknown): void
  /**
   * Queue one message into an agent's inbox: `agent.inject(message)`, receiver-bound,
   * forwarded VERBATIM and THROWING (same D9 discipline).
   *
   * The spelling matters: this is the AGENT's `inject(message)`, NOT the cordis
   * `ctx.inject(deps, callback)` dependency-injection seam — the two share a name and
   * nothing else. Adopted call site: the staged-team discard path.
   *
   * Degrade: THROWS when the agent exposes no `inject`. Reported by
   * `capabilities().agentTurnInject`.
   */
  injectAgentMessage(agent: unknown, message: unknown): void
  /**
   * Submit one user-role message into an agent's OWN next turn — the turn seam a
   * command handler needs, because the host runs a command "without sending the
   * command to the model", so returning `{kind:'success', text}` starts nothing.
   *
   * MEASURED in the installed harness (`dsh-agent-loop/lib/index.js`):
   * `followup(input)` is `send(input, "next-turn", true)` — the item becomes the
   * sole ordinary message of its own turn and the driver wakes. The in-tree
   * precedent is `packages/mpd-agent-teams-plugin/lib/command.js`, the
   * `/agent-teams` handler calling `invocation.agent.followup(createUserMessage(…))`.
   *
   * The agent's shape is read HERE ONLY: a caller passes whatever it holds (the
   * command invocation's `agent`, a live-registry entry, a pre-step gesture's
   * agent) and never touches `followup` itself (AGENTS.md §6). `steer`/`inject`
   * are deliberately NOT exposed: this seam's contract is the agent's own turn.
   * The conventional pair is `submitUserTurn(agent, userMessage({…}))`.
   *
   * Never throws: a non-object, or an object without a callable `followup`, is a
   * reported `false` — the safe no-op a caller degrades on.
   *
   * @returns true when the submission reached the agent's turn seam.
   */
  submitUserTurn(agent: unknown, message: DshUserMessage): boolean
}

/** Canonical model-facing text block (the one shape every harness build accepts). */
export function textBlock(content: unknown): DshTextBlock[] {
  return [{ type: "text", text: typeof content === "string" ? content : String(content ?? "") }]
}

/**
 * Build one user-role message for session injection (see {@link DshAdapter.userMessage}).
 *
 * Local construction is deliberate: importing the host's own `createUserMessage`
 * would need `@deepseek-ai/dsh-llm`, which the installed harness does not expose to
 * this repository as a resolvable bare specifier (measured MODULE_NOT_FOUND), and
 * the seam rule here is that a harness rename is absorbed in THIS file.
 *
 * Frozen at the same levels the host's constructor freezes, so a message already
 * handed to an Agent's inbox can no longer be mutated by its producer.
 */
export function userMessage(input: DshUserMessageInput): DshUserMessage {
  const content = textBlock(input?.text)
  for (const block of content) Object.freeze(block)
  Object.freeze(content)
  const source: DshUserMessageSource = { kind: "user", ...(input?.source ?? {}) }
  Object.freeze(source)
  const message: DshUserMessage = { id: randomUUID(), role: "user", content, source }
  return Object.freeze(message)
}

/** Post-execute decision helpers (the harness uses `feedback`, older notes `reason`). */
export const decision = {
  accept: (content?: unknown): DshPostDecision => (content === undefined ? { kind: "accept" } : { kind: "accept", content }),
  block: (feedback: unknown): DshPostDecision => ({ kind: "block", feedback }),
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// ── workspace root: the ONE resolution every mpd plugin (and only it) uses ────
// The harness never defines DSH_WORKSPACE_ROOT; a session's header cwd is the
// authoritative workspace (dsh-tool-bash resolves its workdir the same way:
// explicit workdir -> session header.cwd -> executor default). Precedence,
// highest first: session -> DSH_WORKSPACE_ROOT (operator/QA override) ->
// process.cwd() (boot, unit tests). Never cached: one host serves many sessions
// with different workspaces.
/** One agent's session workspace, or undefined when absent/not a usable string. */
function sessionCwdOf(agent: any): string | undefined {
  try {
    const cwd = agent?.session?.header?.cwd
    return typeof cwd === "string" && cwd.length > 0 ? cwd : undefined
  } catch {
    return undefined
  }
}

/** The authoritative workspace root for a call (see precedence above). */
export function workspaceRootOf(exec?: DshToolExec): string {
  const session = sessionCwdOf(exec?.agent)
  if (session !== undefined) return resolve(session)
  const override = process.env.DSH_WORKSPACE_ROOT
  if (typeof override === "string" && override.length > 0) return resolve(override)
  return process.cwd()
}

/**
 * Workspace roots of every live session, deduplicated, registration order.
 * `[]` when the agent registry is absent — the caller then falls back to the
 * exec-less {@link workspaceRootOf}.
 */
export function workspaceRootsOf(agents: any): string[] {
  if (agents === undefined || agents === null || typeof agents.list !== "function") return []
  try {
    const list = agents.list()
    if (!Array.isArray(list)) return []
    const roots = new Set<string>()
    for (const agent of list) {
      const cwd = sessionCwdOf(agent)
      if (cwd !== undefined) roots.add(resolve(cwd))
    }
    return [...roots]
  } catch {
    return []
  }
}

function noop(): void { /* seam absent: nothing was registered */ }

/**
 * Build one {@link DshAgentScope} from the RAW `agent.ctx`, or `undefined` when that
 * context does not expose every member the scope promises.
 *
 * ALL-OR-NOTHING is deliberate: a scope whose `tools.restrict` (or `on`, or `effect`)
 * would throw on use is worse than the caller's own raw-context fallback, because it
 * turns a feature-detectable absence into a runtime `TypeError` at an arbitrary later
 * moment. The probe is contained (a throwing getter or a proxy context is a miss,
 * never a crash — the adapter's never-crash-at-construction contract).
 *
 * The returned `context` is the SAME object (`agent.ctx`), and each member is a
 * forwarder that binds the raw receiver, so the host's own scoped cordis semantics
 * (effect ownership, `restrict` resolution) are preserved.
 */
function scopeOfAgentContext(agent: unknown): DshAgentScope | undefined {
  let context: unknown
  try {
    context = (agent as { ctx?: unknown } | undefined)?.ctx
  } catch {
    return undefined
  }
  if (context === undefined || context === null) return undefined
  const kind = typeof context
  if (kind !== "object" && kind !== "function") return undefined
  let on: unknown
  let effect: unknown
  let restrict: unknown
  try {
    const scoped = context as { on?: unknown; effect?: unknown; tools?: { restrict?: unknown } }
    on = scoped.on
    effect = scoped.effect
    restrict = scoped.tools?.restrict
  } catch {
    return undefined
  }
  if (typeof on !== "function" || typeof effect !== "function" || typeof restrict !== "function") return undefined
  const tools = (context as { tools: object }).tools
  return {
    context,
    tools: { restrict: (filter) => (restrict as (filter: unknown) => () => void).call(tools, filter) },
    on: (event, handler) => (on as (event: string, handler: (...args: unknown[]) => unknown) => () => void).call(context, event, handler),
    effect: (fn, label) => (effect as (fn: () => unknown, label?: string) => () => void).call(context, fn, label),
  }
}

// ── the team plane's projections ────────────────────────────────────────────
// The host's `TeamMemberView` / `TeamTaskView` rows are runtime-enriched values rebuilt
// on every read, so projecting them onto the mpd-facing types costs nothing and buys the
// guarantee the adapter exists for: a harness that renames or drops an OPTIONAL field is
// absorbed here, and a declared `diagnostics: string[]` is never `undefined` at a
// consumer. The REQUIRED host fields are normalized rather than defaulted away — an
// unreadable `id` stays the empty string, never an invented one.

/** `'fresh' | 'fork'` when the host declares one, else `undefined`. */
function teamContextOf(raw: unknown): "fresh" | "fork" | undefined {
  return raw === "fresh" || raw === "fork" ? raw : undefined
}

/** One of the four roster statuses; anything else degrades to `inactive` (the host always declares one). */
function teamStatusOf(raw: unknown): DshTeamMemberView["status"] {
  return raw === "running" || raw === "provisioning" || raw === "failed" ? raw : "inactive"
}

/** One of the four task statuses; anything else degrades to `pending` (the safe non-terminal value). */
function teamTaskStatusOf(raw: unknown): DshTeamTaskStatus {
  return raw === "in_progress" || raw === "completed" || raw === "deleted" ? raw : "pending"
}

/** The string members of an unknown array, dropping non-strings instead of leaking them. */
function teamStrings(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === "string") : []
}

/** One roster row projected onto {@link DshTeamMemberView} (see the section header). */
function teamMemberView(raw: unknown): DshTeamMemberView {
  const row = (raw ?? {}) as Record<string, unknown>
  const context = teamContextOf(row.context)
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    role: row.role === "lead" ? "lead" : "teammate",
    status: teamStatusOf(row.status),
    ...(typeof row.description === "string" ? { description: row.description } : {}),
    ...(typeof row.provider === "string" ? { provider: row.provider } : {}),
    ...(context === undefined ? {} : { context }),
    ...(typeof row.model === "string" ? { model: row.model } : {}),
    diagnostics: teamStrings(row.diagnostics),
  }
}

/** One task row projected onto {@link DshTeamTaskView} (see the section header). */
function teamTaskView(raw: unknown): DshTeamTaskView {
  const row = (raw ?? {}) as Record<string, unknown>
  return {
    id: String(row.id ?? ""),
    revision: typeof row.revision === "number" ? row.revision : 0,
    subject: String(row.subject ?? ""),
    description: String(row.description ?? ""),
    status: teamTaskStatusOf(row.status),
    blockedBy: teamStrings(row.blockedBy),
    writeScopes: teamStrings(row.writeScopes),
    ...(typeof row.ownerName === "string" ? { ownerName: row.ownerName } : {}),
    ready: row.ready === true,
    writeScopeWarnings: teamStrings(row.writeScopeWarnings),
  }
}

/**
 * One CONTAINED roster/board read for {@link DshAdapter.teamLiveTeams}: a service without
 * the method, a throwing call or a non-array answer all degrade to `[]`, because a fold
 * over live teams must never be taken down by one member's failing read.
 */
function teamRows<T>(teams: any, method: string, agent: unknown, project: (raw: unknown) => T): T[] {
  const reader = teams?.[method]
  if (typeof reader !== "function") return []
  try {
    const rows = reader.call(teams, agent)
    return Array.isArray(rows) ? rows.map(project) : []
  } catch {
    return []
  }
}

/**
 * One agent's OWN scoped context (`agent.ctx`), or `undefined` when it is missing or its
 * read throws. The contained probe behind {@link agentSystemPromptOf} and
 * `registerAgentPreStep`: an agent-scoped cordis ctx is a proxy that THROWS on a service it
 * was not injected with, so an unguarded property read would turn a feature-detectable
 * absence into a crash.
 */
function scopeContextOf(agent: unknown): any {
  try {
    return (agent as { ctx?: unknown } | undefined)?.ctx
  } catch {
    return undefined
  }
}

/**
 * The ONE `agent/pre-step` wrapper both registration sites share.
 *
 * `agent/pre-step` is a WATERFALL whose returned decision the loop runs with
 * (`dsh-agent-loop` `preStep()`: the default is `{kind:'enter', messages}`). The adapter owns
 * `next()` — the same discipline as `onPostToolExecute` — and returns the listener's decision
 * when it produces one, else the downstream object VERBATIM, so a listener that returns
 * nothing (or throws) is bit-identical to a composition without the hook.
 */
function preStepWrapper(
  listener: (payload: DshAgentPreStep, decision: DshPreStepDecision) => DshPreStepDecision | undefined | Promise<DshPreStepDecision | undefined>,
): (payload: DshAgentPreStep, next: () => Promise<DshPreStepDecision>) => Promise<DshPreStepDecision> {
  return async (payload: DshAgentPreStep, next: () => Promise<DshPreStepDecision>) => {
    const fallback: DshPreStepDecision = { kind: "enter", messages: payload?.messages ?? [] }
    const downstream: DshPreStepDecision = typeof next === "function" ? (await next()) ?? fallback : fallback
    try {
      const decided = await listener(payload ?? {}, downstream)
      return decided ?? downstream
    } catch {
      // A broken observer must never break a step: the harness's own decision stands.
      return downstream
    }
  }
}

/**
 * One agent's OWN scoped `systemPrompt` service, or `undefined` when that scope does
 * not expose it.
 *
 * Returning the SERVICE (not a boolean) keeps `capabilities()` and `agentPromptSection` on
 * one probe, so the flag can never disagree with the method.
 */
function agentSystemPromptOf(agent: unknown): any {
  const context = scopeContextOf(agent)
  if (context === undefined || context === null) return undefined
  try {
    const systemPrompt = (context as { systemPrompt?: unknown }).systemPrompt
    return typeof (systemPrompt as { section?: unknown } | undefined)?.section === "function" ? systemPrompt : undefined
  } catch {
    return undefined
  }
}

export function createDshAdapter(ctx: any, config: { defaultTimeoutMs?: number } = {}): DshAdapter {
  const defaultTimeoutMs = config.defaultTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS
  // Cordis exposes a service through ctx.get(name) and as a ctx property; unit
  // test doubles often provide only one of the two, so try both. Reading an
  // uninjected service as a property THROWS in Cordis ("cannot get property
  // without inject"), which is why this row stays inject-free and every probe
  // is contained here.
  /**
   * THE SCOPED `settings` SERVICE the deferred inject proved, or `undefined`.
   *
   * MEASURED (docker/ui, 2026-09-27): the TUI's MPD settings section rendered
   * `[命名空间未注册]` with every one of its 25 knobs reading `（未设置）`, and BOTH surfaces logged
   * `[mpd-config] settings bridge: could not register the "mpd" namespace (settings service is
   * unavailable)`. The inject had fired — so a `settings` service EXISTS — but `service("settings")`
   * reads the adapter's ROOT ctx, and Cordis resolves a service through the FIBER that provides it,
   * so a service living below the root is invisible there. The inject hands us the scoped ctx that
   * CAN see it; remembering it is what makes the two halves agree.
   */
  let scopedSettings: any
  /** The settings service, preferring the one an inject proved over a root read. */
  const settingsService = (): any => scopedSettings ?? service("settings")
  const service = (serviceName: string): any => {
    if (typeof ctx?.get === "function") {
      try {
        const viaGet = ctx.get(serviceName)
        if (viaGet !== undefined && viaGet !== null) return viaGet
      } catch { /* fall through to the property form */ }
    }
    try { return ctx?.[serviceName] } catch { return undefined }
  }

  function requireService(serviceName: string, needed: string): any {
    const found = service(serviceName)
    if (found === undefined || found === null) {
      throw new Error(`mpd-dsh-adapter: harness service "${serviceName}" is unavailable — ${needed}`)
    }
    return found
  }

  // The workspace plane forwards to the ONE module-level resolution below; the
  // instance form exists so plugins with a ctx still go through the adapter surface.
  const workspaceRoot = (exec?: DshToolExec): string => workspaceRootOf(exec)
  const workspaceRootsAll = (): string[] => workspaceRootsOf(service("agents"))

  // ── live-session plane ────────────────────────────────────────────────────
  // `agents.list()` is the ONLY handle on a member's Agent: the durable team record
  // carries member NAMES and session IDs, not Agents, and a continuable member's Agent
  // lives in this process only while its session does.
  function liveAgents(): DshLiveAgent[] {
    const agents = service("agents")
    if (agents === undefined || typeof agents.list !== "function") return []
    try {
      const list = agents.list()
      return Array.isArray(list) ? list.filter((entry: any) => entry !== undefined && entry !== null) : []
    } catch { return [] }
  }

  function liveAgent(agentId: string): DshLiveAgent | undefined {
    const id = String(agentId ?? "")
    if (id === "") return undefined
    const agents = service("agents")
    if (agents !== undefined && typeof agents.get === "function") {
      try {
        const found = agents.get(id)
        if (found !== undefined && found !== null) return found as DshLiveAgent
      } catch { /* fall through to the list scan */ }
    }
    // A registry without get() (or one that does not know the id) still answers from
    // the live list, which is what the hinge experiment measured.
    return liveAgents().find((candidate) => candidate.id === id)
  }

  /**
   * Per-agent compaction engines, memoized by agent id.
   *
   * The engine MUST come from `agent.ctx.get("compaction")`. The compact-hinge
   * experiment measured the host-plane `ctx.get("compaction")` and the member-scoped
   * lookup returning objects that are NOT the same (`sameObject: false`) while both
   * report `name: "compaction"` — each realm has its own BasicCompactionEngine, so
   * driving a member with the host instance would compact a different realm's history.
   * Dispatching through this one memoized helper makes that mistake impossible to make
   * per-call-site.
   *
   * The cache is keyed by agent id AND dropped when the agent leaves the live registry,
   * so a recycled id can never inherit a previous incarnation's engine.
   */
  const engineCache = new Map<string, unknown>()
  function compactionEngineForAgent(agentId: string): unknown {
    const id = String(agentId ?? "")
    if (id === "") return undefined
    const cached = engineCache.get(id)
    if (cached !== undefined) return cached
    const agent = liveAgent(id)
    const scoped = agent?.ctx
    if (scoped === undefined || scoped === null) return undefined
    let engine: unknown
    try {
      engine = typeof (scoped as any).get === "function" ? (scoped as any).get("compaction") : undefined
    } catch {
      return undefined
    }
    if (engine === undefined || engine === null) return undefined
    engineCache.set(id, engine)
    return engine
  }

  function onEvent(event: string, handler: (...args: unknown[]) => unknown): (() => void) | undefined {
    if (typeof ctx?.on !== "function") return undefined
    try {
      const disposer = ctx.on(event, handler)
      return typeof disposer === "function" ? disposer : () => { /* event bus owns teardown */ }
    } catch {
      return undefined
    }
  }

  // ── llm plane: the model catalog, read ONLY here (AGENTS.md §6) ───────────
  // The projection mirrors the host's own buildModelCatalog
  // (dsh-api-session-controller/lib/types/catalog.js) so a picker fed from here sees
  // the same providers/models the host's own surfaces do.
  const LLM_CATALOG_METHODS = ["listProviders", "listModels", "resolveModelInfo"] as const
  let llmCatalogWarned = false
  /** ONE warn-once line per adapter instance, naming the seam that degraded the catalog. */
  function warnLlmCatalogOnce(detail: string): void {
    if (llmCatalogWarned) return
    llmCatalogWarned = true
    // A replaced/hostile console must never take a read down (the never-throw contract).
    try { console.warn("mpd-dsh-adapter: llmCatalog degraded — " + detail) } catch { /* seam absent: nothing to report */ }
  }

  /** `name` with the id as fallback, so a caller never renders `undefined`. */
  function catalogLabel(value: unknown, id: string): string {
    return typeof value === "string" && value.length > 0 ? value : id
  }

  async function llmCatalog(): Promise<DshLlmCatalog> {
    const llm = service("llm")
    if (llm === undefined || llm === null) {
      warnLlmCatalogOnce("the harness llm service is unavailable")
      return { providers: [], degraded: true }
    }
    const missing = LLM_CATALOG_METHODS.filter((method) => typeof llm?.[method] !== "function")
    if (missing.length > 0) {
      warnLlmCatalogOnce("the harness llm service lacks " + missing.join(", "))
      return { providers: [], degraded: true }
    }
    let providers: unknown
    try {
      // `await` keeps this correct for the host's SYNC listProviders() as well as a
      // remote variant that answers a promise (dsh-llm/lib/typert.remote-client).
      providers = await llm.listProviders()
    } catch (error) {
      warnLlmCatalogOnce("listProviders() failed: " + message(error))
      return { providers: [], degraded: true }
    }
    if (!Array.isArray(providers)) {
      warnLlmCatalogOnce("listProviders() did not return an array")
      return { providers: [], degraded: true }
    }
    // `degraded` is sticky: ONE skipped provider or model marks the whole read degraded.
    let degraded = false
    const catalog: DshLlmCatalogProvider[] = []
    for (const rawProvider of providers as any[]) {
      const providerId = typeof rawProvider?.id === "string" ? rawProvider.id : undefined
      if (providerId === undefined) { degraded = true; continue }
      try {
        const models = await llm.listModels(providerId)
        if (!Array.isArray(models)) throw new Error("listModels(" + providerId + ") did not return an array")
        const entries: DshLlmCatalogModel[] = []
        for (const rawModel of models as any[]) {
          const modelId = typeof rawModel?.id === "string" ? rawModel.id : undefined
          if (modelId === undefined) { degraded = true; continue }
          let resolved: any
          try {
            resolved = await llm.resolveModelInfo(providerId, modelId)
          } catch {
            // One unresolvable model is skipped, never fatal for the catalog.
            degraded = true
            continue
          }
          const reasoning = resolved?.reasoning
          const efforts: DshLlmCatalogEffort[] = []
          const rawEfforts = Array.isArray(reasoning?.efforts) ? reasoning.efforts : []
          for (const rawEffort of rawEfforts as any[]) {
            const effortId = typeof rawEffort?.id === "string" ? rawEffort.id : undefined
            if (effortId === undefined) continue
            efforts.push({
              id: effortId,
              name: catalogLabel(rawEffort?.name, effortId),
              ...(typeof rawEffort?.description === "string" ? { description: rawEffort.description } : {}),
            })
          }
          const defaultEffort = typeof reasoning?.defaultEffort === "string" ? reasoning.defaultEffort : undefined
          entries.push({
            id: modelId,
            name: catalogLabel(rawModel?.name, modelId),
            ...(typeof rawModel?.description === "string" ? { description: rawModel.description } : {}),
            // A model with NO reasoning block still appears: empty efforts, no defaultEffort.
            efforts,
            ...(defaultEffort === undefined ? {} : { defaultEffort }),
          })
        }
        catalog.push({ id: providerId, name: catalogLabel(rawProvider?.name, providerId), models: entries })
      } catch {
        degraded = true
        continue
      }
    }
    return { providers: catalog, degraded }
  }

  function timeoutSignal(timeoutMs: number): AbortSignal | undefined {
    try {
      if (typeof AbortSignal !== "undefined" && typeof (AbortSignal as any).timeout === "function") return (AbortSignal as any).timeout(timeoutMs)
    } catch { /* fall through to no signal */ }
    return undefined
  }

  const adapter: DshAdapter = {
    capabilities(): DshCapabilities {
      const tools = service("tools")
      const subagents = service("subagents")
      const skills = service("skills")
      const presets = service("agentPresets")
      const commands = service("commands")
      const agents = service("agents")
      const compaction = service("compaction")
      const llmService = service("llm")
      const systemPrompt = service("systemPrompt")
      const agentTeams = service("agentTeams")
      const sample = liveAgents()[0]
      const sampleScoped = sample?.ctx
      let scopedCompaction = false
      try {
        scopedCompaction = sampleScoped !== undefined && typeof (sampleScoped as any).get === "function"
          && (sampleScoped as any).get("compaction") !== undefined
      } catch { scopedCompaction = false }
      return {
        tools: tools !== undefined,
        toolsRegister: typeof tools?.register === "function",
        toolsGuard: typeof tools?.guard === "function",
        toolsGet: typeof tools?.get === "function",
        toolsExecute: typeof tools?.execute === "function",
        toolsPreExecute: typeof ctx?.on === "function",
        toolsPostExecute: typeof ctx?.on === "function",
        subagents: subagents !== undefined,
        subagentsSpawn: typeof subagents?.start === "function",
        skills: skills !== undefined,
        skillsProvider: typeof skills?.registerProvider === "function",
        agentPresets: typeof presets?.resolve === "function",
        commands: commands !== undefined,
        commandsRegister: typeof commands?.register === "function",
        // LIVE-REGISTRY probe (like compactionForAgent): the turn seam lives on the
        // Agent, so this reports whether one is reachable and usable right now.
        turnSubmit: liveAgents().some((candidate) => typeof (candidate as { followup?: unknown } | undefined)?.followup === "function"),
        agents: agents !== undefined && typeof agents?.list === "function",
        compaction: typeof compaction?.compactNow === "function",
        compactionForAgent: scopedCompaction,
        events: typeof ctx?.on === "function",
        // The catalog seam needs the WHOLE trio: a service exposing only part of it
        // cannot satisfy llmCatalog's projection, so it reports false.
        llmCatalog: LLM_CATALOG_METHODS.every((method) => typeof (service("llm") as any)?.[method] === "function"),
        // ── the agent-teams surface (each flag faces ONE adapter method) ──────
        // `registerTool` and `registerHostTool` share the `tools.register` seam but
        // carry different contracts, so each reports its own flag.
        toolsRegisterHost: typeof tools?.register === "function",
        // The provider catalogue needs BOTH halves (getProvider + list): a caller that
        // reads this flag must never hit a half-present service.
        subagentsProvider: typeof subagents?.getProvider === "function" && typeof subagents?.list === "function",
        subagentsContinuable: typeof subagents?.startContinuable === "function",
        subagentsInterrupt: typeof subagents?.interrupt === "function",
        llmListModels: typeof llmService?.listModels === "function",
        llmResolveCallConfig: typeof llmService?.resolveCallConfig === "function",
        systemPromptSection: typeof systemPrompt?.section === "function",
        // The three agent-object seams are LIVE-REGISTRY probes (like turnSubmit): a
        // composition with no live session reports false although the surface exists —
        // the per-call return value (undefined / the throw) stays authoritative.
        agentScope: liveAgents().some((candidate) => scopeOfAgentContext(candidate) !== undefined),
        agentTurnStart: liveAgents().some((candidate) => typeof (candidate as { followup?: unknown } | undefined)?.followup === "function"),
        agentTurnCancel: liveAgents().some((candidate) => typeof (candidate as { cancel?: unknown } | undefined)?.cancel === "function"),
        agentTurnSteer: liveAgents().some((candidate) => typeof (candidate as { steer?: unknown } | undefined)?.steer === "function"),
        agentTurnInject: liveAgents().some((candidate) => typeof (candidate as { inject?: unknown } | undefined)?.inject === "function"),
        // A live agent's own scope carries the prompt registry (the official team tool
        // plugin registers its `team:policy` section there). LIVE probe, like agentScope.
        agentPromptSection: liveAgents().some((candidate) => agentSystemPromptOf(candidate) !== undefined),
        // The pre-step waterfall rides the same event bus as every other hook; the SCOPE flag
        // is the one a caller must branch on for delivery (see registerAgentPreStep).
        agentPreStep: typeof ctx?.on === "function",
        agentPreStepScope: liveAgents().some((candidate) => typeof scopeContextOf(candidate)?.on === "function"),
        // ── the official Agent Teams plane (D6: reachable ONLY through here) ─────
        // Each flag faces a method FAMILY, because the families degrade differently:
        // `team` is the service-level identity + roster read (`teamMembership`,
        // `teamListMembers`, and the gate for `teamSpawnTeammate`/`teamInterrupt`),
        // `teamTasks` the shared board (all FOUR task methods, so a half-present
        // service reads false), `teamMessages` the peer mailbox plus the wait seam.
        team: typeof agentTeams?.tryMembership === "function" && typeof agentTeams?.listMembers === "function",
        teamTasks: TEAM_TASK_METHODS.every((method) => typeof (agentTeams as any)?.[method] === "function"),
        teamMessages: typeof agentTeams?.sendMessage === "function" && typeof agentTeams?.waitForChange === "function",
        subagentsProviderRegister: typeof subagents?.registerProvider === "function",
      }
    },

    // ── workspace plane ─────────────────────────────────────────────────────
    workspaceRoot,
    workspaceRootsAll,

    // ── live-session plane ──────────────────────────────────────────────────
    liveAgents,
    liveAgent,
    compactionEngineForAgent,
    onEvent,
    llmCatalog,

    // ── llm plane: the two thin reads the agent-teams bridge forwards ───────
    // Both are THIN and both THROW synchronously on a missing seam: the raw
    // `ctx.llm.listModels(provider)` / `ctx.llm.resolveCallConfig(config, signal)`
    // expression a caller would otherwise run throws the same way, so a caller's
    // try/catch keeps its exact meaning.
    llmListModels(provider: string): Promise<unknown> {
      const llm = requireService("llm", "cannot list the models of provider \"" + provider + "\"")
      if (typeof llm.listModels !== "function") throw new Error("mpd-dsh-adapter: the harness llm service exposes no listModels()")
      return llm.listModels.call(llm, provider)
    },

    llmResolveCallConfig(config: unknown, signal?: AbortSignal): Promise<unknown> {
      const llm = requireService("llm", "cannot resolve a call config")
      if (typeof llm.resolveCallConfig !== "function") throw new Error("mpd-dsh-adapter: the harness llm service exposes no resolveCallConfig()")
      return llm.resolveCallConfig.call(llm, config, signal)
    },

    // ── tool plane ──────────────────────────────────────────────────────────
    registerHostTool(definition: unknown): () => void {
      const tools = requireService("tools", "cannot register host tool \"" + String((definition as { name?: unknown } | undefined)?.name) + "\"")
      if (typeof tools.register !== "function") throw new Error("mpd-dsh-adapter: the harness tools service exposes no register()")
      // VERBATIM by contract: the SAME reference reaches the registry — no rebuild, no
      // spread, no default `parameters`/`output.schema`, no `render` fallback, no
      // `execute` wrapper. The adopted agent-teams plugin registers `defineTool(...)`
      // output, so `finalizeContent`/`presentCall`/`presentResult`/`isConcurrencySafe`
      // and the exact `execute` function must survive untouched (Object.is end to end).
      const registered = tools.register(definition)
      // Only a callable may be handed back as a disposer (a stub registry can return
      // anything); an absent registry answer degrades to a no-op, never to a leak.
      return typeof registered === "function" ? registered : noop
    },

    registerTool(definition: DshToolDef): () => void {
      const tools = requireService("tools", "cannot register tool \"" + String(definition?.name) + "\"")
      if (typeof tools.register !== "function") throw new Error("mpd-dsh-adapter: the harness tools service exposes no register()")
      const output = definition.output ?? {}
      const render = typeof output.render === "function" ? output.render : (_args: unknown, value: unknown) => textBlock(value)
      const schema = output.schema ?? OBJECT_SCHEMA
      return tools.register({
        name: definition.name,
        description: definition.description,
        parameters: definition.parameters ?? OBJECT_SCHEMA,
        output: { ...output, schema, render },
        ...(definition.timeoutMs === undefined ? {} : { timeoutMs: definition.timeoutMs }),
        // Normalized call shape: a harness build that hands execute() no exec
        // object still gives every mpd tool a stable (args, exec) contract.
        execute: async (args: unknown, exec: unknown) => definition.execute(args ?? {}, exec ?? {}),
      })
    },

    registerTools(definitions: DshToolDef[]): () => void {
      const disposers = definitions.map((definition) => adapter.registerTool(definition))
      return () => { for (const dispose of disposers) dispose() }
    },

    // ── command plane ───────────────────────────────────────────────────────
    registerCommand(definition: DshCommandDef): () => void {
      const commands = service("commands")
      // Missing optional seam: a no-op disposer, never a throw (the caller degrades on
      // capabilities().commandsRegister instead of being taken down at apply time).
      if (commands === undefined || commands === null || typeof commands.register !== "function") return noop
      const registered = commands.register({
        name: definition?.name,
        description: definition?.description,
        ...(definition?.input === undefined ? {} : { input: definition.input }),
        handler: (invocation: DshCommandInvocation) => {
          const host = invocation ?? { rawInput: "" }
          // The plugin receives a COPY carrying the submission surface bound to the
          // INVOKING agent: the host's own invocation object is never mutated, and the
          // plugin never reads `agent.followup` itself (AGENTS.md §6).
          return definition.handler({
            ...host,
            submit: (message: DshUserMessage) => adapter.submitUserTurn(host.agent, message),
          })
        },
      })
      // The host's register() returns the exact effect disposer; a stub registry can
      // return anything, and only a callable may be handed back as a disposer.
      return typeof registered === "function" ? registered : noop
    },

    registerPromptSection(section: DshPromptSection): () => void {
      // THROW, not a no-op: the adopted agent-teams plugin's usage section is
      // MANDATORY, so a composition without the seam must be loud (contract §3 #9)
      // instead of silently dropping the section.
      const systemPrompt = requireService("systemPrompt", "cannot register prompt section \"" + String(section?.name) + "\"")
      if (typeof systemPrompt.section !== "function") throw new Error("mpd-dsh-adapter: the harness systemPrompt service exposes no section()")
      // VERBATIM section, receiver-bound. A duplicate name throws INSIDE the registry
      // and is deliberately not swallowed; only a non-callable answer degrades.
      const registered = systemPrompt.section(section)
      return typeof registered === "function" ? registered : noop
    },

    guardTool(guard: (exec: DshToolExec) => string | undefined): () => void {
      const tools = requireService("tools", "cannot install a tool guard")
      if (typeof tools.guard !== "function") throw new Error("mpd-dsh-adapter: the harness tools service exposes no guard()")
      return tools.guard((exec: DshToolExec) => guard(exec ?? {}))
    },

    onPreToolExecute(
      listener: (exec: DshToolExec, decision: DshPreDecision | undefined) => void,
    ): () => void {
      if (typeof ctx?.on !== "function") return noop
      // `tools/pre-execute` is a WATERFALL with the same veto shape as `agent/pre-step`:
      // cordis runs the listeners outermost-first with `next` appended, so a listener
      // that returns without delegating REPLACES the gate decision. This wrapper owns
      // `next()` and RETURNS THE DOWNSTREAM OBJECT VERBATIM, so the listener's own
      // return value is discarded by construction and the gate is bit-identical to a
      // composition without this hook. A listener that throws changes nothing either.
      return ctx.on("tools/pre-execute", async (exec: DshToolExec, next: () => Promise<DshPreDecision>) => {
        const downstream = typeof next === "function" ? await next() : undefined
        try {
          // The listener observes a FROZEN SHALLOW COPY, never the live execution object: it
          // cannot mutate what the harness will dispatch (`dsh-tools` re-fuses `exec.signal`
          // around this waterfall, so freezing the original would break the harness itself),
          // and an attempted write throws inside the listener — which is contained below.
          listener(Object.freeze({ ...(exec ?? {}) }), downstream)
        } catch {
          // observe-only: a broken observer must never affect the call it observes
        }
        return downstream
      })
    },

    onPostToolExecute(
      listener: (exec: DshToolExec, result: DshPostResult, downstream: DshPostDecision) => DshPostDecision | undefined | Promise<DshPostDecision | undefined>,
    ): () => void {
      if (typeof ctx?.on !== "function") return noop
      return ctx.on("tools/post-execute", async (exec: DshToolExec, result: DshPostResult, next: () => Promise<DshPostDecision>) => {
        // The harness waterfall requires the listener to run `next()`; this
        // adapter owns that call so a listener only decides what to change.
        const downstream: DshPostDecision = typeof next === "function" ? (await next()) ?? { kind: "accept" } : { kind: "accept" }
        const decided = await listener(exec ?? {}, result ?? {}, downstream)
        return decided ?? downstream
      })
    },

    onAgentPreStep(
      listener: (payload: DshAgentPreStep, decision: DshPreStepDecision) => DshPreStepDecision | undefined | Promise<DshPreStepDecision | undefined>,
    ): () => void {
      if (typeof ctx?.on !== "function") return noop
      return ctx.on("agent/pre-step", preStepWrapper(listener))
    },

    registerAgentPreStep(
      agent: unknown,
      listener: (payload: DshAgentPreStep, decision: DshPreStepDecision) => DshPreStepDecision | undefined | Promise<DshPreStepDecision | undefined>,
    ): () => void {
      // The AGENT-SCOPED registration site. `agent/pre-step` is dispatched through the agent's
      // own scope carrier (`dsh-agent` `agentEvents(...).waterfall` -> `ctx.waterfall(carrier, …)`),
      // and such a dispatch reaches a listener only when the listener's scope IS the dispatch
      // scope or an ancestor of it (`dsh-scope` `scopeTarget`'s filter). A listener registered
      // on a ROW's ctx is therefore not a reliable subscriber — MEASURED 2026-09-27: the
      // session-start gate was installed and silent on six live boots while the SAME row's
      // unfiltered `agent/created` listener ran on every one of them. The harness's own
      // pre-step subscribers (`dsh-agent`, `dsh-subagent-in-process-driver`) register on the
      // agent's scoped ctx for exactly this reason.
      const context = scopeContextOf(agent)
      if (typeof context?.on !== "function") {
        throw new Error("mpd-dsh-adapter: the agent's own scope exposes no on() — cannot register its agent/pre-step listener")
      }
      return context.on("agent/pre-step", preStepWrapper(listener))
    },

    /**
     * The harness WEB SERVER, probed tolerantly, or `undefined` when this composition has none.
     *
     * `webServer` is the current service name and `httpServer` the older one; both are tried, and a
     * probing failure means "not bound yet", never a reason to take a row down. Callers register their
     * routes on the returned object and should re-register through
     * {@link DshAdapter.onServiceBound}, because the service can be provided AFTER the row applies.
     */
    webServerOf(): unknown {
      try {
        if (typeof ctx?.get !== "function") return undefined
        return ctx.get("webServer", false) ?? ctx.get("httpServer", false)
      } catch {
        return undefined
      }
    },

    /**
     * Run `callback` when the harness binds (or REBINDS) one of `names` as a service.
     *
     * `internal/service` is cordis's own binding event, so this re-enters on every later bind and a
     * route registered here can never be silently lost to a provider that started after the row.
     *
     * @param names - service names to watch, e.g. `["webServer", "httpServer"]`.
     * @param callback - invoked with the name that bound.
     * @returns a disposer removing the subscription.
     */
    onServiceBound(names: readonly string[], callback: (name: string) => void): () => void {
      if (typeof ctx?.on !== "function") return () => {}
      const off = ctx.on("internal/service", (name: unknown) => {
        try {
          if (typeof name === "string" && names.includes(name)) callback(name)
        } catch {
          /* a throwing listener must not break the runtime's own binding dispatch */
        }
      })
      return typeof off === "function" ? off : () => {}
    },

    /**
     * Subscribe to HARNESS events at ONE AGENT's own scope, for the events that are dispatched
     * through the agent's scope carrier.
     *
     * `agent/inbox/inserted`, `agent/inbox/claimed` and `agent/inbox/discarded` carry
     * `(args) => args[0]["agent"]` as their subject in `dsh-scope`'s `scopedSubjectResolvers`, i.e.
     * they are delivered exactly like `agent/pre-step` — through the agent's carrier, where a
     * listener on a ROW's ctx is filtered out. So the registration site is the agent's own scope
     * context, and this seam is the generic form of {@link DshAdapter.registerAgentPreStep}.
     *
     * The harness's inbox IS the observable mailbox: a message enters it with `inserted`, leaves it
     * when the loop `claimed` it (or when it is `discarded`), so `inserted − claimed − discarded` is
     * the harness's own "waiting, not yet taken" — a real count, not an approximation.
     *
     * @param agent - the live agent whose scope owns the events.
     * @param events - event names to observe, e.g. `["agent/inbox/inserted", "agent/inbox/claimed"]`.
     * @param handler - called with the event name and its payload.
     * @returns a disposer removing every subscription.
     */
    subscribeAgentEvents(agent: unknown, events: readonly string[], handler: (event: string, payload: unknown) => void): () => void {
      const context = scopeContextOf(agent)
      if (typeof context?.on !== "function") {
        throw new Error("mpd-dsh-adapter: the agent's own scope exposes no on() — cannot subscribe to its events")
      }
      const offs: Array<() => void> = []
      for (const event of events) {
        const off = context.on(event, (payload: unknown) => {
          try {
            handler(event, payload)
          } catch {
            /* a throwing observer must not break the agent's own dispatch */
          }
        })
        if (typeof off === "function") offs.push(off)
      }
      return () => {
        for (const off of offs) {
          try {
            off()
          } catch {
            /* already gone */
          }
        }
      }
    },

    hasTool(toolName: string): boolean {
      const tools = service("tools")
      if (typeof tools?.get !== "function") return false
      try { return tools.get(toolName) !== undefined } catch { return false }
    },

    /** Structural view of the tool runtime for internal tool calls. */
    toolRuntime() {
      const tools = service("tools")
      return {
        get: (toolName: string) => (typeof tools?.get === "function" ? tools.get(toolName) : undefined),
        execute: (input: { name: string; arguments?: unknown; callId?: string; signal?: AbortSignal; agent?: unknown }) =>
          adapter.executeTool({ ...input, timeoutMs: defaultTimeoutMs }).then((result) => result.raw),
      }
    },

    async executeTool(input): Promise<DshToolCallResult> {
      const tools = service("tools")
      if (tools === undefined || typeof tools.execute !== "function") {
        return { ok: false, isError: true, error: "the harness tool runtime has no execute()" }
      }
      const callId = input.callId ?? "mpd-" + Math.random().toString(36).slice(2, 10)
      const signal = input.signal ?? timeoutSignal(input.timeoutMs ?? defaultTimeoutMs)
      try {
        const raw = await tools.execute({
          name: input.name,
          arguments: input.arguments ?? {},
          callId,
          ...(signal === undefined ? {} : { signal }),
          // The calling agent rides the execution only when the caller supplied one:
          // absent stays absent, so no existing call site changes meaning.
          ...(input.agent === undefined ? {} : { agent: input.agent }),
        })
        const isError = (raw as DshPostResult | undefined)?.isError === true
        if (isError) {
          const error = (raw as DshPostResult)?.error
          return { ok: false, isError: true, error: (error as { message?: string })?.message ?? error ?? "tool error", raw }
        }
        return { ok: true, isError: false, value: (raw as DshPostResult)?.value, raw }
      } catch (error) {
        return { ok: false, isError: true, error: message(error) }
      }
    },

    // ── agent plane ─────────────────────────────────────────────────────────
    async spawnAgent(spec: DshSpawnSpec): Promise<DshSpawnResult> {
      const subagents = requireService("subagents", "cannot spawn subagent \"" + String(spec?.label) + "\"")
      if (typeof subagents.start !== "function") throw new Error("mpd-dsh-adapter: the harness subagent service exposes no start()")
      const route = {
        ...(spec.provider === undefined ? {} : { provider: spec.provider }),
        ...(spec.model === undefined ? {} : { model: spec.model }),
        ...(spec.agentOptions ?? {}),
      }
      const run = await subagents.start(spec.mode ?? "spawn", {
        label: spec.label,
        prompt: typeof spec.prompt === "string" ? textBlock(spec.prompt) : spec.prompt,
        ...(spec.parent === undefined ? {} : { parent: spec.parent }),
        ...(spec.signal === undefined ? {} : { signal: spec.signal }),
        ...(Object.keys(route).length === 0 ? {} : { agentOptions: route }),
        ...(spec.persona === undefined ? {} : { persona: spec.persona }),
        ...(spec.outputSchema === undefined ? {} : { outputSchema: spec.outputSchema }),
        ...(spec.toolFilter === undefined ? {} : { toolFilter: spec.toolFilter }),
        ...(spec.maxDepth === undefined ? {} : { maxDepth: spec.maxDepth }),
      })
      // `run.result` is a promise in some harness builds and a plain object in
      // others; awaiting both keeps the normalized shape stable.
      const result = (await (run?.result ?? {})) as { output?: unknown; structured?: unknown; stopReason?: unknown }
      return {
        output: typeof result.output === "string" ? result.output : "",
        structured: result.structured,
        stopReason: (result.stopReason as string | null | undefined) ?? null,
      }
    },

    // ── subagent plane: the delivery runtime and its provider catalogue ──────
    // (the adopted agent-teams plugin's seam set; contract §3 rows 2–6)
    subagentRuntime(): unknown {
      // IDENTITY-preserving: the plugin's Harness-generation ladder reads
      // `prompt`/`followup`/`[HOST_PROMPT_QUEUE]`/`sendMessage` off THIS object and the
      // ladder's own policy stays in the plugin (contract D6). `service()` is contained,
      // so a missing service is `undefined`, never a throw.
      return service("subagents")
    },

    subagentProvider(name: string): unknown {
      const subagents = service("subagents")
      const getProvider = (subagents as { getProvider?: unknown } | undefined)?.getProvider
      // Degrade: `undefined` — the plugin's own capability check throws its own
      // actionable message, so this seam must not invent one.
      if (typeof getProvider !== "function") return undefined
      return (getProvider as (name: string) => unknown).call(subagents, name)
    },

    subagentProviders(): string[] {
      const subagents = service("subagents")
      const list = (subagents as { list?: unknown } | undefined)?.list
      if (typeof list !== "function") return []
      const names: unknown = (list as () => unknown).call(subagents)
      // The host answers provider NAMES in insertion order (`list(): string[]`); a stub
      // that answers something else degrades to the declared type rather than leaking
      // values the frozen `string[]` contract cannot carry.
      return Array.isArray(names) ? names.filter((entry): entry is string => typeof entry === "string") : []
    },

    startContinuableAgent(spec: unknown): Promise<unknown> {
      // Synchronous THROW on a missing seam (parity with the raw expression a caller
      // would run); the service's own promise is forwarded UNTOUCHED, so its rejections
      // stay rejections for the caller.
      const subagents = requireService("subagents", "cannot start a continuable agent")
      if (typeof subagents.startContinuable !== "function") throw new Error("mpd-dsh-adapter: the harness subagents service exposes no startContinuable()")
      return subagents.startContinuable.call(subagents, spec)
    },

    registerSubagentProvider(provider: unknown): () => void {
      // THROW, not a no-op (parity with `registerSkillProvider`): a registration that
      // silently vanished would leave its caller believing the provider is served, and
      // `capabilities().subagentsProviderRegister` is the pre-flight check.
      const subagents = requireService("subagents", "cannot register a subagent provider")
      if (typeof subagents.registerProvider !== "function") throw new Error("mpd-dsh-adapter: the harness subagents service exposes no registerProvider()")
      // VERBATIM provider, receiver-bound; only a non-callable answer degrades to a
      // disposer that does nothing (a stub registry can return anything).
      const registered = subagents.registerProvider(provider)
      return typeof registered === "function" ? registered : noop
    },

    interruptAgent(targetSessionId: string, authority: unknown): void {
      const subagents = requireService("subagents", "cannot interrupt subagent session \"" + String(targetSessionId) + "\"")
      if (typeof subagents.interrupt !== "function") throw new Error("mpd-dsh-adapter: the harness subagents service exposes no interrupt()")
      subagents.interrupt.call(subagents, targetSessionId, authority)
    },

    // ── the official Agent Teams plane (D6: the ONLY route to the team service) ──
    // The `caller` Agent and every request object are forwarded BY IDENTITY, receiver
    // bound: the host validates its own request shape (and rejects it loudly), so a copy
    // or a key rewrite here could only lose a field this adapter does not model — the
    // same discipline `registerHostTool` follows. Replies are PROJECTED (see the
    // module-level projections), so a consumer's declared types are truthful.
    teamService(): unknown | undefined {
      // The contained probe (never a throw): `undefined` is the whole degrade contract,
      // and `capabilities().team` is the pre-flight check a consumer reads.
      const teams = service("agentTeams")
      return teams === undefined || teams === null ? undefined : teams
    },

    teamMembership(agent: unknown): DshTeamMembership | undefined {
      const teams = service("agentTeams")
      const tryMembership = teams?.tryMembership
      // NEVER throws (the frozen contract of this method): a missing seam is a miss.
      if (typeof tryMembership !== "function") return undefined
      let membership: any
      try {
        membership = tryMembership.call(teams, agent)
      } catch {
        // A stale identity, a non-Team subagent or a host that rejects the handle is a
        // normal negative answer here — this method is used as a FILTER, so an exception
        // would turn "not on a team" into a failure.
        return undefined
      }
      if (membership === undefined || membership === null) return undefined
      const role = membership.role
      // Anything that is not one of the two declared roles is a MISS: the frozen return
      // type has no third value to report, and inventing `teammate` would lie.
      if (role !== "lead" && role !== "teammate") return undefined
      // `root` (the Lead Agent the host carries on the membership) is deliberately NOT
      // projected: a consumer resolves the Lead through `liveAgent`/`liveAgents`, which
      // is the registry of record — never a handle captured in a stale row.
      return { teamId: String(membership.id ?? ""), role, name: String(membership.name ?? "") }
    },

    teamListMembers(agent: unknown): DshTeamMemberView[] {
      const teams = requireService("agentTeams", "cannot list the team roster of an agent")
      if (typeof teams.listMembers !== "function") throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no listMembers()")
      const rows = teams.listMembers.call(teams, agent)
      return Array.isArray(rows) ? rows.map(teamMemberView) : []
    },

    teamListTasks(agent: unknown): DshTeamTaskView[] {
      const teams = requireService("agentTeams", "cannot list the shared task board of an agent")
      if (typeof teams.listTasks !== "function") throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no listTasks()")
      const rows = teams.listTasks.call(teams, agent)
      return Array.isArray(rows) ? rows.map(teamTaskView) : []
    },

    async teamCreateTask(caller: unknown, request: DshTeamCreateTaskRequest): Promise<DshTeamTaskView> {
      const teams = requireService("agentTeams", "cannot create team task \"" + String(request?.subject) + "\"")
      if (typeof teams.createTask !== "function") throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no createTask()")
      return teamTaskView(await teams.createTask.call(teams, caller, request))
    },

    teamGetTask(caller: unknown, id: string): DshTeamTaskView {
      const teams = requireService("agentTeams", "cannot read team task \"" + String(id) + "\"")
      if (typeof teams.getTask !== "function") throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no getTask()")
      // A host throw (an unknown id, a revoked authority) propagates VERBATIM: this
      // adapter never invents a task view and never masks a real rejection.
      return teamTaskView(teams.getTask.call(teams, caller, id))
    },

    async teamUpdateTask(caller: unknown, request: DshTeamUpdateTaskRequest): Promise<DshTeamTaskView> {
      const teams = requireService("agentTeams", "cannot update team task \"" + String(request?.taskId) + "\"")
      if (typeof teams.updateTask !== "function") throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no updateTask()")
      return teamTaskView(await teams.updateTask.call(teams, caller, request))
    },

    async teamSendMessage(caller: unknown, request: DshTeamSendMessageRequest): Promise<DshTeamSendMessageResult> {
      const teams = requireService("agentTeams", "cannot send a team message to \"" + String(request?.target) + "\"")
      if (typeof teams.sendMessage !== "function") throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no sendMessage()")
      const result: any = await teams.sendMessage.call(teams, caller, request)
      return {
        messageId: String(result?.messageId ?? ""),
        // The host declares exactly these two; anything else is read as the conservative
        // `accepted` (the message WAS queued durably — `queued` only says immediate
        // delivery did not happen).
        status: result?.status === "queued" ? "queued" : "accepted",
      }
    },

    async teamSpawnTeammate(caller: unknown, request: DshTeamSpawnTeammateRequest): Promise<DshTeamSpawnTeammateResult> {
      const teams = requireService("agentTeams", "cannot spawn team member \"" + String(request?.name) + "\"")
      if (typeof teams.spawnTeammate !== "function") throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no spawnTeammate()")
      const result: any = await teams.spawnTeammate.call(teams, caller, request)
      return { member: teamMemberView(result?.member) }
    },

    teamInterrupt(caller: unknown, targetName: string): DshTeamInterruptResult {
      const teams = requireService("agentTeams", "cannot interrupt team member \"" + String(targetName) + "\"")
      if (typeof teams.interrupt !== "function") throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no interrupt()")
      const result: any = teams.interrupt.call(teams, caller, targetName)
      // The host answers the status sampled BEFORE cancellation; `inactive` is the
      // conservative reading of anything it does not declare.
      return { previousStatus: result?.previousStatus === "running" ? "running" : "inactive" }
    },

    async teamWaitForChange(caller: unknown, timeoutMs: number, signal?: AbortSignal): Promise<DshTeamWaitResult> {
      const teams = requireService("agentTeams", "cannot wait for team activity")
      if (typeof teams.waitForChange !== "function") throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no waitForChange()")
      // Both arguments verbatim (the host validates its own 10s..1h bound and rejects
      // outside it); the promise is forwarded untouched.
      const result: any = await teams.waitForChange.call(teams, caller, timeoutMs, signal)
      return { timedOut: result?.timedOut === true }
    },

    teamLiveTeams(): DshTeamView[] {
      const teams = service("agentTeams")
      // [] when the team service or the agent registry is absent: a readout has nothing
      // to report, and a route must not be taken down by a missing optional seam.
      if (teams === undefined || teams === null || typeof teams.tryMembership !== "function") return []
      if (typeof service("agents")?.list !== "function") return []
      const views: DshTeamView[] = []
      for (const agent of liveAgents()) {
        let membership: any
        try {
          membership = teams.tryMembership.call(teams, agent)
        } catch {
          // One unreadable identity never hides the other teams.
          continue
        }
        if (membership?.role !== "lead") continue
        views.push({
          teamId: String(membership.id ?? ""),
          leadName: String(membership.name ?? ""),
          leadSessionId: String((agent as { id?: unknown })?.id ?? ""),
          members: teamRows(teams, "listMembers", agent, teamMemberView),
          tasks: teamRows(teams, "listTasks", agent, teamTaskView),
        })
      }
      return views
    },

    // ── skill plane ─────────────────────────────────────────────────────────
    registerSkillProvider(provider: unknown): () => void {
      const skills = requireService("skills", "cannot register a skill provider")
      if (typeof skills.registerProvider !== "function") throw new Error("mpd-dsh-adapter: the harness skills service exposes no registerProvider()")
      return skills.registerProvider(provider)
    },

    async listSkills(options: { cwd?: string } = {}): Promise<DshSkillSummary[]> {
      const skills = requireService("skills", "cannot list skills")
      if (typeof skills.list !== "function") throw new Error("mpd-dsh-adapter: the harness skills service exposes no list()")
      return (await skills.list(options)) ?? []
    },

    async loadSkill(skillName: string, options: { cwd?: string } = {}): Promise<unknown> {
      const skills = requireService("skills", "cannot load skill \"" + skillName + "\"")
      if (typeof skills.get !== "function") throw new Error("mpd-dsh-adapter: the harness skills service exposes no get()")
      return skills.get(skillName, options)
    },

    // ── preset plane ────────────────────────────────────────────────────────
    async resolvePreset(presetId: string): Promise<DshPresetInfo> {
      const presets = requireService("agentPresets", "cannot resolve preset \"" + presetId + "\"")
      if (typeof presets.resolve !== "function") throw new Error("mpd-dsh-adapter: the harness agentPresets service exposes no resolve()")
      const preset = await presets.resolve(presetId)
      return {
        id: String(preset?.id ?? presetId),
        ...(preset?.path === undefined ? {} : { path: String(preset.path) }),
        ...(preset?.trust === undefined ? {} : { trust: String(preset.trust) }),
        ...(preset?.broken === undefined ? {} : { broken: String(preset.broken) }),
      }
    },

    // ── settings plane (t34 §5 invariant 2: the ONE harness contact surface) ──
    settingsReader(namespace: string): DshSettingsReader | undefined {
      const settings = settingsService()
      if (settings === undefined || settings === null) return undefined
      return {
        get(): unknown {
          try {
            return typeof settings.get === "function" ? settings.get(namespace) : undefined
          } catch {
            return undefined
          }
        },
        describe() {
          try {
            if (typeof settings.describe !== "function") return undefined
            const list = settings.describe() as Array<Record<string, unknown>>
            if (!Array.isArray(list)) return undefined
            const found = list.find((entry) => entry?.ns === namespace)
            if (found === undefined) return undefined
            return {
              value: found.value,
              revision: typeof found.revision === "number" ? found.revision : undefined,
              user: found.user,
              base: found.base,
              applies: typeof found.applies === "string" ? found.applies : undefined,
            }
          } catch {
            return undefined
          }
        },
      }
    },

    onSettingsDocumentUpdated(
      namespace: string,
      listener: (revision: number | undefined, source: string | undefined) => void,
    ): () => void {
      // Both events fire synchronously inside ONE host write, document-updated FIRST,
      // so the change's source is only known after the tick: coalesce, then defer.
      let pendingRevision: number | undefined
      let pendingSource: string | undefined
      let hasPending = false
      let scheduled = false
      const flush = (): void => {
        scheduled = false
        if (!hasPending) return
        const revision = pendingRevision
        const source = pendingSource
        pendingRevision = undefined
        pendingSource = undefined
        hasPending = false
        try {
          listener(revision, source)
        } catch {
          // A bridge failure must never break the settings commit that emitted it.
        }
      }
      const offUpdated = adapter.onEvent("settings/updated", (ns: unknown, _next: unknown, _prev: unknown, from: unknown) => {
        if (String(ns) !== namespace) return undefined
        pendingSource = from === undefined ? undefined : String(from)
        return undefined
      })
      const offDocument = adapter.onEvent("settings/document-updated", (ns: unknown, revision: unknown) => {
        if (String(ns) !== namespace) return undefined
        pendingRevision = typeof revision === "number" ? revision : undefined
        hasPending = true
        if (!scheduled) {
          scheduled = true
          // Promise.resolve().then() = a microtask: it runs after the host's
          // synchronous write()/publish() returned, i.e. after settings/updated.
          void Promise.resolve().then(flush)
        }
        return undefined
      })
      return () => {
        try {
          offUpdated?.()
        } catch {
          // best effort
        }
        try {
          offDocument?.()
        } catch {
          // best effort
        }
      }
    },

    whenSettingsAvailable(callback: () => void): void {
      if (typeof ctx?.inject !== "function") {
        // No deferred-inject seam: try once immediately rather than never. SAY SO: this path and
        // the deferred one fail with the SAME sentence downstream ("settings service is
        // unavailable"), and a reader cannot tell a race from a missing seam without this line.
        console.warn("[mpd-dsh-adapter] no ctx.inject seam: the settings registration runs immediately (the settings provider may not be mounted yet)")
        try {
          callback()
        } catch {
          /* the caller reports its own failure */
        }
        return
      }
      try {
        ctx.inject(["settings"], (scoped: any) => {
          try {
            // The property read THROWS on a Cordis ctx that did not declare the service, so it is
            // probed in its own guard: a throw here must not cost the callback its run.
            try {
              if (scopedSettings === undefined || scopedSettings === null) scopedSettings = scoped?.settings
            } catch {
              /* fall through to the ctx.get form */
            }
            if (scopedSettings === undefined || scopedSettings === null) {
              try {
                scopedSettings = typeof scoped?.get === "function" ? scoped.get("settings") : undefined
              } catch {
                /* the scoped ctx answers neither form */
              }
            }
            if (scopedSettings === undefined || scopedSettings === null) {
              console.warn("[mpd-dsh-adapter] the settings inject fired but the SCOPED ctx yielded no settings service (property and get both empty) — the registration will fail as unavailable; this is the TUI-profile shape measured 2026-09-27")
            }
            callback()
          } catch {
            /* the caller reports its own failure */
          }
        })
      } catch {
        /* an unusable inject seam leaves the caller's own degradation path */
      }
    },

    settingsRegister(
      namespace: string,
      schema: unknown,
      options?: { base?: unknown; applies?: string },
    ): { ok: true } | { ok: false; error: string } {
      const settings = settingsService()
      // NAME THE SHAPE. These were ONE sentence — "settings service is unavailable" — for a service
      // that is ABSENT and for one that is PRESENT but cannot register, and that ambiguity cost a
      // full investigation (docker/ui, 2026-09-27: the TUI profile's settings section rendered
      // `[命名空间未注册]` with all 25 knobs unset, and the log could not say which of the two it
      // was). Measured in the dsh-tui profile: the deferred inject fires IMMEDIATELY, so a
      // `settings` service IS present, and the failure is the second shape.
      if (settings === undefined || settings === null) {
        return { ok: false, error: "settings service is unavailable" }
      }
      if (typeof settings.register !== "function") {
        // THE MODEL ITSELF IS GONE, not racing. Harness 0.1.7-rc.2 replaced the namespace-registry
        // settings model with the CORDIS PATCH EDITOR: a plugin declares the fields it exposes in
        // its OWN row's schemastery `Config` with `.volatile()`, and the settings UI edits them per
        // profile ENTRY. `@deepseek-ai/dsh-settings@0.1.7-rc.2` exposes `describe()` and hangs the
        // rest off `configEditor` — measured on the installed package: NO `register(namespace, …)`.
        // Say that, with the replacement named, so the next reader does not re-run this hunt.
        return {
          ok: false,
          error: "the settings service is present but exposes no register() — harness 0.1.7-rc.2 replaced the namespace-registry model with the Cordis patch editor, where a plugin declares its editable fields in its own row Config with .volatile() (keys: " + Object.keys(settings).slice(0, 8).join(",") + ")",
        }
      }
      try {
        settings.register(namespace, schema, { ...(options?.base === undefined ? {} : { base: options.base }), ...(options?.applies === undefined ? {} : { applies: options.applies }) })
        return { ok: true }
      } catch (error) {
        return { ok: false, error: String((error as Error)?.message ?? error) }
      }
    },

    async settingsMutate(
      namespace: string,
      ops: readonly { op: "set" | "unset"; path: readonly string[]; value?: unknown }[],
      expectedRevision?: number,
    ): Promise<DshSettingsMutateResult> {
      const settings = settingsService()
      if (settings === undefined || settings === null || typeof settings.mutate !== "function") {
        return { ok: false, error: "settings service is unavailable" }
      }
      try {
        await settings.mutate(namespace, ops.map((op) => (op.op === "unset" ? { op: "unset", path: [...op.path] } : { op: "set", path: [...op.path], value: op.value })), expectedRevision)
        return { ok: true }
      } catch (error) {
        const name = String((error as { name?: unknown })?.name ?? "")
        const conflict = name === "SettingsConflictError" || /conflict/i.test(String((error as Error)?.message ?? ""))
        return { ok: false, error: String((error as Error)?.message ?? error), ...(conflict ? { conflict: true } : {}) }
      }
    },

    text: textBlock,
    userMessage,

    // ── agent plane: the per-agent scope and the throwing turn engine ────────
    // (contract D5/D8/D9: the agent's own SEAMS are routed; its DATA stays a direct
    // read on the handle this adapter hands out)
    agentScope(agent: unknown): DshAgentScope | undefined {
      // The ONE spelling of `agent.ctx.<seam>`: the all-or-nothing probe below keeps a
      // partial context from producing a scope that throws later.
      return scopeOfAgentContext(agent)
    },

    agentPromptSection(agent: unknown, section: DshPromptSection): () => void {
      // THROW, not a no-op: a section that silently vanished leaves the Lead with a
      // prompt that promises nothing — the same reasoning as `registerPromptSection`.
      const systemPrompt = agentSystemPromptOf(agent)
      if (systemPrompt === undefined) {
        throw new Error("mpd-dsh-adapter: the agent's own scope exposes no systemPrompt.section() — cannot register prompt section \"" + String(section?.name) + "\" for it")
      }
      // VERBATIM section, receiver-bound. A duplicate name throws INSIDE the registry
      // (per scope) and is deliberately not swallowed; only a non-callable answer degrades.
      const registered = systemPrompt.section(section)
      return typeof registered === "function" ? registered : noop
    },

    startAgentTurn(agent: unknown, message: unknown): void {
      const followup = (agent as { followup?: unknown } | undefined)?.followup
      // THROWING on purpose (contract D9): the adopted plugin's own call site relies on
      // this throw inside its try/catch. `submitUserTurn` below stays the swallowing
      // boolean seam for callers that want one.
      if (typeof followup !== "function") throw new Error("mpd-dsh-adapter: the agent exposes no followup() — cannot start its next turn")
      ;(followup as (input: unknown) => unknown).call(agent, message)
    },

    cancelAgentTurn(agent: unknown, cause: unknown, options?: unknown): void {
      const cancel = (agent as { cancel?: unknown } | undefined)?.cancel
      if (typeof cancel !== "function") throw new Error("mpd-dsh-adapter: the agent exposes no cancel() — cannot cancel its turn")
      // Receiver-bound, both arguments verbatim; the agent's own error propagates.
      ;(cancel as (cause: unknown, options?: unknown) => unknown).call(agent, cause, options)
    },

    steerAgentTurn(agent: unknown, message: unknown): void {
      const steer = (agent as { steer?: unknown } | undefined)?.steer
      // Same THROWING discipline as startAgentTurn (contract D9): the adopted call sites
      // run inside their own try/catch and rely on the throw, so this seam must never
      // swallow a rejected steer into a boolean.
      if (typeof steer !== "function") throw new Error("mpd-dsh-adapter: the agent exposes no steer() — cannot steer its turn")
      ;(steer as (input: unknown) => unknown).call(agent, message)
    },

    injectAgentMessage(agent: unknown, message: unknown): void {
      // NOTE the two `inject` spellings: this is the AGENT's inject(message), not the
      // cordis ctx.inject(deps, callback) seam (which the facade passes through).
      const inject = (agent as { inject?: unknown } | undefined)?.inject
      if (typeof inject !== "function") throw new Error("mpd-dsh-adapter: the agent exposes no inject() — cannot queue a message for it")
      ;(inject as (input: unknown) => unknown).call(agent, message)
    },

    // ── turn plane ──────────────────────────────────────────────────────────
    submitUserTurn(agent: unknown, message: DshUserMessage): boolean {
      const followup = (agent as { followup?: unknown } | undefined)?.followup
      if (typeof followup !== "function") return false
      try {
        // Bound to the agent: the host's method reads `this`.
        ;(followup as (input: DshUserMessage) => unknown).call(agent, message)
        return true
      } catch {
        // A rejected submission must never escape into the caller (a command handler
        // or a pre-step listener) — the boolean is the whole contract.
        return false
      }
    },
  }

  return adapter
}

/** Service name other rows resolve with `ctx.get("mpdDsh")`. */
export const SERVICE_NAME = "mpdDsh"

/** The row is using the REAL mounted adapter (an ACTIVE strict read). */
export const ADAPTER_IDENTITY_MOUNTED = "mounted:mpdDsh"
/**
 * The service IS registered in this composition but its providing fiber is not ACTIVE yet, so a
 * strict read returns `undefined`. This is the transient miss T-50 is about: it must never be
 * reported as a missing row, and it must not be cached as a fallback for the session.
 */
export const ADAPTER_IDENTITY_PENDING = "pending:provider-not-active"
/** The service is not provided in this composition at all — the ONLY case where a row-order fix is provable. */
export const ADAPTER_IDENTITY_FALLBACK = "fallback:createDshAdapter"

export type AdapterIdentity = typeof ADAPTER_IDENTITY_MOUNTED | typeof ADAPTER_IDENTITY_PENDING | typeof ADAPTER_IDENTITY_FALLBACK

export interface LazyAdapterOptions {
  /** Row label used in the one-line warning (e.g. "mpd-ext"). */
  label: string
  /** Warning sink; defaults to console.log, because a headless boot has no logger sink. */
  warn?: (line: string) => void
}

/**
 * One contained service probe. `strict: true` asks cordis for an ACTIVE provider only
 * (`get(name, strict = true)` drops a provider whose fiber state is not ACTIVE); `strict: false`
 * sees the registration regardless of fiber state, which is what makes the two miss modes
 * distinguishable. A probe NEVER throws out of here: a ctx that cannot answer (a scoped cordis
 * proxy, an inject-filtered ctx, a test double) is reported as a miss, never as a crash.
 */
function probeMpdDsh(ctx: unknown, strict: boolean): { value?: unknown; missing: boolean } {
  const get = (ctx as { get?: unknown } | undefined)?.get
  if (typeof get !== "function") return { missing: true }
  try {
    const value = (get as (name: string, strict?: boolean) => unknown).call(ctx, SERVICE_NAME, strict)
    return value === undefined || value === null ? { missing: true } : { value, missing: false }
  } catch {
    return { missing: true }
  }
}

/**
 * How THIS call reaches the shared adapter. Read it at surface/read time, never as an apply-time
 * snapshot: with a lazy resolution the answer legitimately changes during the boot.
 */
export function dshAdapterIdentity(ctx: unknown): AdapterIdentity {
  if (!probeMpdDsh(ctx, true).missing) return ADAPTER_IDENTITY_MOUNTED
  if (!probeMpdDsh(ctx, false).missing) return ADAPTER_IDENTITY_PENDING
  return ADAPTER_IDENTITY_FALLBACK
}

/**
 * The T-50 fix: resolve `mpdDsh` LAZILY on every use instead of once at apply.
 *
 * WHY: the loader applies sibling rows CONCURRENTLY and cordis returns `undefined` — never a throw —
 * for a provider whose fiber is not ACTIVE, so `ctx.get("mpdDsh")` can miss TRANSIENTLY even on a
 * correctly ordered tree. The previous `ctx.get("mpdDsh") ?? createDshAdapter(ctx)` resolved once at
 * apply, so such a miss handed that row a PRIVATE adapter for the whole session and said "row
 * missing / fix the ROW ORDER", which was the wrong diagnosis for a provider that was merely still
 * starting.
 *
 * HOW: the returned object is ONE stable facade whose property access resolves through
 * {@link probeMpdDsh} until a STRICT read succeeds; only that success is cached. A miss serves the
 * call through a temporary adapter and the NEXT access re-probes, so the mounted adapter is picked up
 * automatically the moment its fiber activates — no row-order change is required for a transient miss.
 * (This is the "lazy on first use" option of the register's fix; the alternative bounded retry is
 * unnecessary because every access already retries, including the tool handlers a row registered
 * during apply.)
 *
 * HONEST BOUND (T-50): six consecutive clean boots on the correctly ordered tree never observed the
 * window opening (evidence/wave2 t24, 6/6 `adapterIdentity=mounted:mpdDsh`, zero fallback lines). The
 * change is therefore justified by the CODE PATH — the loader's concurrent sibling apply and cordis's
 * non-ACTIVE `undefined` — not by an observed failure; the unit tests drive the miss shape directly.
 */
export function createLazyDshAdapter(ctx: unknown, options: LazyAdapterOptions): DshAdapter {
  const warning = (line: string): void => {
    try {
      ;(options.warn ?? ((text: string) => console.log("[" + options.label + "] " + text)))(line)
    } catch { /* logging must never take a row down */ }
  }
  let mounted: DshAdapter | undefined
  let temporary: DshAdapter | undefined
  let warnedPending = false
  let warnedMissing = false

  const resolve = (): DshAdapter => {
    if (mounted !== undefined) return mounted
    const active = probeMpdDsh(ctx, true)
    if (active.value !== undefined) {
      mounted = active.value as DshAdapter
      return mounted
    }
    temporary ??= createDshAdapter(ctx)
    // Distinguish the two miss modes: a non-strict hit proves the service IS registered (the
    // provider is starting), while a strict+non-strict miss proves it is absent from this
    // composition — only the latter earns the row-order hint.
    if (!probeMpdDsh(ctx, false).missing) {
      if (!warnedPending) {
        warnedPending = true
        warning("ADAPTER NOT YET ACTIVE: " + SERVICE_NAME + " is registered in this composition but its provider fiber"
          + " is not ACTIVE yet (the loader applies sibling rows concurrently; cordis answers undefined for a non-ACTIVE"
          + " provider). This call is served by a TEMPORARY adapter and every later call re-probes, so the mounted"
          + " adapter is picked up as soon as it activates — this transient miss needs NO row-order change (T-50).")
      }
      return temporary
    }
    if (!warnedMissing) {
      warnedMissing = true
      warning("ADAPTER FALLBACK (adapterIdentity=" + ADAPTER_IDENTITY_FALLBACK + "): " + SERVICE_NAME + " is not provided"
        + " in this composition, so this row built its OWN adapter beside the tree's: it bypasses the mounted adapter"
        + " (the one-contact-surface rule, AGENTS.md §6), it does NOT inherit the adapter row's config (defaultTimeoutMs)"
        + " and it keeps its own per-instance caches (the per-agent compaction-engine memo). This boot keeps working,"
        + " which is exactly why the branch is loud — fix the ROW ORDER (this row must sit BELOW mpd-dsh-adapter); the"
        + " canonical note lives in packages/mpd-ext-plugin/src/index.ts (resolveAdapter).")
    }
    return temporary
  }

  return new Proxy({} as DshAdapter, {
    get(_target, property) {
      const impl = resolve() as unknown as Record<PropertyKey, unknown>
      const value = impl[property as keyof typeof impl]
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(impl) : value
    },
    has(_target, property) {
      return property in (resolve() as unknown as Record<PropertyKey, unknown>)
    },
  })
}

export function apply(ctx: any, config: { defaultTimeoutMs?: number; quiet?: boolean } = {}): void {
  const adapter = createDshAdapter(ctx, { ...(config.defaultTimeoutMs === undefined ? {} : { defaultTimeoutMs: config.defaultTimeoutMs }) })
  ctx.provide(SERVICE_NAME, adapter)
  // The loader applies sibling rows concurrently, so a capability snapshot taken
  // here would under-report. The row logs a stable line and callers read
  // capabilities() at use time (the QA probe prints them from a real boot).
  if (config.quiet !== true) {
    console.log("[mpd-dsh-adapter] " + SERVICE_NAME + " provided (harness seams resolved lazily, inject-free)")
  }
}
