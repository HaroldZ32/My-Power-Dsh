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
import { errorMessage } from "./shared"
// R5: the ONE log sink every row routes its diagnostics through. The adapter is the sanctioned
// contact surface (AGENTS.md §6) AND the owner of workspace-root resolution, so a row asks the
// adapter instead of importing the sink itself — which keeps the coupling inventory at ONE entry.
import { openLogSink } from "../../mpd-mcp-shared/log-sink"
import type { LogSink } from "../../mpd-mcp-shared/log-sink"

// The pure, harness-free helpers every row uses are re-exported from the ONE module
// consumers already import, so a row needs a single specifier for both the seam
// surface and the shared utilities. See ./shared.ts for why they live there.
export { bundleRootOf, errorMessage, isRecord } from "./shared"

/** The plugin row name cordis mounts this module under. */
export const name = "mpd-dsh-adapter"
// No hard service dependency: every seam is resolved lazily through ctx.get()
// so the row mounts in any composition order and in partial installs.
export const inject: string[] = []

// ── the harness seam-name vocabulary ────────────────────────────────────────────────
// A row's cordis `inject` array spells harness SERVICE IDS as string literals. Those
// literals are the coupling: the harness owns the ids, so a rename there used to be an
// edit in EVERY row that listed one. They are declared HERE — the one file AGENTS.md §6
// makes the contact surface — and rows build their array with `dshSeamInject`.
//
// An id is a cordis DEPENDENCY, not a seam OBJECT: naming one only orders the row against
// the service. Every seam is still READ through `resolveDshAdapter(ctx)`; a row that names
// no id is simply inject-free. The values are the harness's own strings and must never be
// "improved" here — they are compared against ids the harness declares, so a typo is a
// silently absent dependency rather than a compile error.

/** The `tools` service: the tool registry, guards and the read/execute helpers. */
export const DSH_SEAM_TOOLS = "tools"
/** The `subagents` service: the continuable-subagent registry and the spawn seam. */
export const DSH_SEAM_SUBAGENTS = "subagents"
/** The `skills` service: the skill registry a provider registers into. */
export const DSH_SEAM_SKILLS = "skills"
/** The `agents` service: the live-agent registry (session cwds, the watchdog's stream fold). */
export const DSH_SEAM_AGENTS = "agents"
/** The `commands` service: the slash-command registry. */
export const DSH_SEAM_COMMANDS = "commands"
/** The `sessions` service: the session store behind the web host. */
export const DSH_SEAM_SESSIONS = "sessions"
/** The `webServer` service: the HTTP host a web-plane row mounts its routes onto. */
export const DSH_SEAM_WEB_SERVER = "webServer"
/** The `webRuntime` service: the browser-runtime/asset plane of the web host. */
export const DSH_SEAM_WEB_RUNTIME = "webRuntime"
/** The `agentPresets` service: the named preset roster a session resolves its preset from. */
export const DSH_SEAM_AGENT_PRESETS = "agentPresets"

/** Every harness seam id above, in declaration order — one set a gate or a probe can iterate. */
export const DSH_SEAM_NAMES: readonly string[] = [
  DSH_SEAM_TOOLS,
  DSH_SEAM_SUBAGENTS,
  DSH_SEAM_SKILLS,
  DSH_SEAM_AGENTS,
  DSH_SEAM_COMMANDS,
  DSH_SEAM_SESSIONS,
  DSH_SEAM_WEB_SERVER,
  DSH_SEAM_WEB_RUNTIME,
  DSH_SEAM_AGENT_PRESETS,
]

/**
 * One harness seam id: the union of the constants above.
 *
 * The type is what makes a row's `inject` array checkable — `dshSeamInject("tool")` is a
 * compile error rather than a dependency that silently never activates.
 */
export type DshSeamName =
  | typeof DSH_SEAM_TOOLS
  | typeof DSH_SEAM_SUBAGENTS
  | typeof DSH_SEAM_SKILLS
  | typeof DSH_SEAM_AGENTS
  | typeof DSH_SEAM_COMMANDS
  | typeof DSH_SEAM_SESSIONS
  | typeof DSH_SEAM_WEB_SERVER
  | typeof DSH_SEAM_WEB_RUNTIME
  | typeof DSH_SEAM_AGENT_PRESETS

/**
 * Build a row's `inject` array from the seam-name constants.
 *
 * A fresh array every call, so two rows can never end up sharing one mutable dependency
 * list. The returned array holds exactly the ids passed in, unchanged — the bundle's
 * contract with the loader is byte-identical to the literals this replaced.
 *
 * @param names the harness seam ids this row declares a dependency on, in order.
 * @returns a new `string[]` carrying those ids verbatim.
 */
export function dshSeamInject(...names: readonly DshSeamName[]): string[] {
  return [...names]
}

/** Object-rooted JSON Schema used whenever a caller omits one. */
const OBJECT_SCHEMA: Record<string, unknown> = { type: "object", properties: {} }
/** Fallback timeout in milliseconds for `executeTool` when neither the caller nor the row config sets one. */
const DEFAULT_TOOL_TIMEOUT_MS = 120_000
/** The four Agent Teams seams a USABLE shared task board needs (see `capabilities().teamTasks`). */
const TEAM_TASK_METHODS = ["createTask", "getTask", "listTasks", "updateTask"] as const

/** One model-facing text block; the only content shape every harness build accepts. */
export type DshTextBlock = { type: "text"; text: string }

/** The execution object a tool body receives: call identity, arguments, calling agent, cancellation. */
export interface DshToolExec {
  /** The registered name of the tool being dispatched. */
  name?: string
  /** The argument object the harness validated for this call. */
  arguments?: Record<string, unknown>
  /** The live Agent the call runs on behalf of; opaque here, forwarded verbatim. */
  agent?: unknown
  /** Cancellation for the call, as the harness re-fuses it around the waterfalls. */
  signal?: AbortSignal
  [key: string]: unknown
}

/** The output contract of a tool definition: result schema, renderer and presentation hints. */
export interface DshToolOutput {
  /** Canonical value contract of the tool result; defaults to an object-rooted schema. */
  schema?: Record<string, unknown>
  /** Renders `(args, value)` into harness content blocks; defaults to a single text block. */
  render?: (args: unknown, value: unknown) => unknown
  /** Opaque presentation hints, forwarded to capable clients. */
  presentationMeta?: unknown
}

/** One tool definition as an mpd plugin registers it, normalized by `registerTool`. */
export interface DshToolDef {
  /** The tool name the model calls; must be unique inside the registry. */
  name: string
  /** Model-facing description of what the tool does. */
  description: string
  /** Object-rooted JSON Schema for the arguments; defaults to `{type:'object', properties:{}}`. */
  parameters?: Record<string, unknown>
  /** Optional output contract; see {@link DshToolOutput}. */
  output?: DshToolOutput
  /** Per-call timeout in milliseconds; the adapter's configured default applies when omitted. */
  timeoutMs?: number
  /** The tool body; the adapter always invokes it with an arguments object and an exec object. */
  execute: (args: any, exec: any) => unknown
}

/**
 * Optional input hint advertised to capable clients.
 *
 * MEASURED against the installed harness (`dsh-commands/lib/index.ts`
 * `normalizeDefinition`): `hint` must be a non-empty string and `attachments`, when
 * present, must be a boolean; a definition that fails either check throws at
 * `register()` time.
 */
export interface DshCommandInput {
  /** Optional input hint advertised to clients that accept attachments. */
  hint: string
  /** Whether the command accepts attachments; when present the host requires a boolean. */
  attachments?: boolean
}

/** The invocation the harness hands one registered command handler. */
export interface DshCommandInvocation {
  /** Exact text following the command name, including separator whitespace. */
  rawInput: string
  /** The Agent whose surface received the command — the injection target. */
  agent?: unknown
  /** Cancellation for the invocation's own lifetime. */
  signal?: AbortSignal
  /** Files the user attached to the command, when the surface carries any. */
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
  /** The lowercase command name WITHOUT the leading slash: `/ulw` registers as `ulw`. */
  name: string
  /** Model-facing description shown by the command surface. */
  description: string
  /** Optional input hint; see {@link DshCommandInput}. */
  input?: DshCommandInput
  /** The handler the host calls with one invocation. */
  handler: (invocation: DshCommandInvocation) => unknown
}

// Producer tag of an injected message. The harness's format-v4 gate accepts a
// PRODUCER-OWNED kind and REFUSES the retired shared `plugin` member (measured on
// 0.1.7-rc.2: `dsh: format v4 message requires a producer-owned source kind`, which
// takes the whole boot down), so a producer names itself — `{kind:'user'}`,
// `{kind:'mpd-roles',reason:'session-start-advisory'}`, `{kind:'mpd-ulw',…}`.
export interface DshUserMessageSource {
  /** Producer-owned tag naming the injector; the format-v4 gate refuses the retired shared `plugin` member. */
  kind: string
  [key: string]: unknown
}

/** A user-role message the harness accepts for session injection. */
export interface DshUserMessage {
  /** Fresh identity, the branded `MessageId` string the host stores. */
  id: string
  /** The fixed user role the harness's format-v4 message gate requires. */
  role: "user"
  /** The message body: exactly one text block for an injected advisory. */
  content: DshTextBlock[]
  /** Producer tag for this message; see {@link DshUserMessageSource}. */
  source: DshUserMessageSource
}

/** Input for {@link DshAdapter.userMessage}: the text plus an optional producer tag. */
export interface DshUserMessageInput {
  /** Model-facing text; becomes the single `text` content block. */
  text: string
  /** Producer tag; defaults to `{kind:'user'}` (a plain user gesture). */
  source?: DshUserMessageSource
}

/** Waterfall decision handed to a post-execute listener (the downstream result). */
export interface DshPostDecision {
  /** Which side of the waterfall produced the decision: a replacement or a veto. */
  kind: "accept" | "block"
  /** Replacement content when the listener accepts with one. */
  content?: unknown
  /** Replacement value for the tool result when the listener supplies one. */
  value?: unknown
  /** The harness's block-reason key; `decision.block(reason)` builds it. */
  feedback?: unknown
  /** Extra context entries appended to the downstream result. */
  additionalContexts?: unknown[]
  [key: string]: unknown
}

/**
 * The `tools/pre-execute` decision the harness's own gate consumes.
 *
 * Measured in the installed harness (`dsh-tools/lib/index.ts:3116`,
 * `types/index.d.ts:38`): the pre-execute waterfall resolves to this object and the
 * registry then reads `gate.kind` (`allow` dispatches, `ask` goes through approval,
 * `deny` is turned into an error result). A listener that returns without delegating
 * REPLACES it — the same veto shape `agent/pre-step` has.
 */
export interface DshPreDecision {
  /** The gate outcome the registry acts on: allow dispatches, ask goes through approval, deny errors. */
  kind: "allow" | "ask" | "deny"
  /** Human-readable reason attached to an ask or deny decision. */
  reason?: unknown
  [key: string]: unknown
}

/** The raw result object a tool returned, as the post-execute waterfall sees it. */
export interface DshPostResult {
  /** Replacement content blocks when a listener rewrote the result. */
  content?: unknown
  /** Whether the harness marked the result an error. */
  isError?: boolean
  /** The error the tool reported; its `message` is read when present. */
  error?: { message?: string } | unknown
  /** The tool's structured value, when the result carries one. */
  value?: unknown
  [key: string]: unknown
}

/** One subagent spawn request as the adapter forwards it. */
export interface DshSpawnSpec {
  /** Display label for the child session. */
  label: string
  /** The child's task; a plain string becomes one text block. */
  prompt: string | DshTextBlock[]
  /** Flat route (preferred by this bundle) or the harness-shaped agentOptions. */
  provider?: string
  /** Model id for the child, merged after the flat provider/model keys. */
  model?: string
  /** Harness-shaped route object; its keys are merged after the flat ones. */
  agentOptions?: { provider?: string; model?: string }
  /** Persona text the host injects into the child's system prompt. */
  persona?: string
  /** Tool filter forwarded verbatim; the host validates every name in it. */
  toolFilter?: unknown
  /** Maximum nesting depth the child may spawn down to. */
  maxDepth?: number
  /** JSON Schema the child's answer must satisfy. */
  outputSchema?: Record<string, unknown>
  /** The parent Agent authorizing the spawn. */
  parent?: unknown
  /** Cancellation for the spawn and for the child's run. */
  signal?: AbortSignal
  /** Harness spawn mode; this bundle always uses the one-shot "spawn" mode. */
  mode?: string
}

/** The normalized answer of one completed spawn. */
export interface DshSpawnResult {
  /** The child's final text, the empty string when it produced none. */
  output: string
  /** The child's structured answer, when an outputSchema was requested. */
  structured: any
  /** Why the child stopped, or null when the host declared none. */
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
  /** Whether this Agent is the team's Lead or one of its members. */
  role: "lead" | "teammate"
  /** The model-facing member name. */
  name: string
}

/** One runtime-enriched roster row (`TeamMemberView`). */
export interface DshTeamMemberView {
  /** The member's session id, unique inside its team. */
  id: string
  /** The model-facing member name used to address it. */
  name: string
  /** The member's team role, mirroring the host's own union. */
  role: "lead" | "teammate"
  /** The member's lifecycle state; anything undeclared reads as inactive. */
  status: "running" | "inactive" | "provisioning" | "failed"
  /** Free-text description the spawn request carried. */
  description?: string
  /** Provider route the member was spawned on, when the host reports one. */
  provider?: string
  /** Whether the member started from a fresh context or forked its parent's. */
  context?: "fresh" | "fork"
  /** Model id the member runs on, when the host reports one. */
  model?: string
  /** Always an array (`[]` when the host declares none), so a consumer can iterate. */
  diagnostics: string[]
}

/** Durable task lifecycle (`TeamTaskStatus`). */
export type DshTeamTaskStatus = "pending" | "in_progress" | "completed" | "deleted"

/** One runtime-enriched shared-task row (`TeamTaskView`). */
export interface DshTeamTaskView {
  /** The task's identity, stable across revisions. */
  id: string
  /** Compare-and-set revision the caller must echo back to mutate the task. */
  revision: number
  /** One-line subject shown on the board. */
  subject: string
  /** Full task description; the empty string when the host declared none. */
  description: string
  /** The task's lifecycle status, normalized onto the four declared values. */
  status: DshTeamTaskStatus
  /** Ids of tasks that must complete before this one may be claimed; always an array. */
  blockedBy: string[]
  /** Paths this task may write, used by the board's conflict warnings; always an array. */
  writeScopes: string[]
  /** Name of the member that currently owns the task, while it is claimed. */
  ownerName?: string
  /** Whether every blocker is complete and the task may be claimed. */
  ready: boolean
  /** Overlap warnings the board computed for this task's write scopes; always an array. */
  writeScopeWarnings: string[]
}

/** Input for one new shared task (`CreateTeamTaskRequest`). */
export interface DshTeamCreateTaskRequest {
  /** One-line subject for the new task. */
  subject: string
  /** Optional full description of the work. */
  description?: string
  /** Ids of tasks that must complete first; the board copies them onto the row. */
  blockedBy?: readonly string[]
  /** Paths the new task may write; no scope means no claim restriction. */
  writeScopes?: readonly string[]
}

/** The eight supported task transitions (`TeamTaskAction`). */
export type DshTeamTaskAction =
  | "claim" | "release" | "edit" | "set_dependencies" | "complete" | "reopen" | "reassign" | "delete"

/** One compare-and-set task mutation (`UpdateTeamTaskRequest`). */
export interface DshTeamUpdateTaskRequest {
  /** Id of the task to mutate. */
  taskId: string
  /** The revision the caller last read; a mismatch makes the host refuse the write. */
  expectedRevision: number
  /** The transition to apply; see {@link DshTeamTaskAction}. */
  action: DshTeamTaskAction
  /** Replacement subject, used by the edit action. */
  subject?: string
  /** Replacement description, used by the edit action. */
  description?: string
  /** Replacement dependency set, used by set_dependencies. */
  blockedBy?: readonly string[]
  /** Replacement write scopes, used by the edit action. */
  writeScopes?: readonly string[]
  /** Replacement owner name, used by reassign. */
  owner?: string
}

/** Input for one durable peer message (`SendTeamMessageRequest`). */
export interface DshTeamSendMessageRequest {
  /** Name of the member the message is addressed to. */
  target: string
  /** The message body, forwarded verbatim to the durable mailbox. */
  content: unknown
  /** Cancellation for the send itself. */
  signal?: AbortSignal
}

/** Result after a peer message enters the durable mailbox (`SendTeamMessageResult`). */
export interface DshTeamSendMessageResult {
  /** Identity of the queued mailbox entry. */
  messageId: string
  /** Whether delivery happened immediately or the entry waits in the mailbox. */
  status: "accepted" | "queued"
}

/** Input for one durable teammate (`SpawnTeammateRequest`). */
export interface DshTeamSpawnTeammateRequest {
  /** The member name, unique inside its team. */
  name: string
  /** Description the host shows on the roster. */
  description: string
  /** The teammate's task prompt, forwarded verbatim. */
  prompt: unknown
  /** Whether the teammate starts fresh or forks the Lead's context. */
  context?: "fresh" | "fork"
  /** Provider route override, when the host accepts one. */
  provider?: string
  /** Cancellation for the spawn and for the teammate's run. */
  signal?: AbortSignal
}

/** Result after one teammate reaches a durable active or failed edge. */
export interface DshTeamSpawnTeammateResult {
  /** The roster row the host produced for the new teammate. */
  member: DshTeamMemberView
}

// ── THE TEAM EXECUTOR: mpd's team system behind ONE seam ─────────────────────
//
// WHY THIS EXISTS (the 2026-09-30 team-plane split, W2). Until now the ONLY way to
// raise a teammate was the official service, so the bundle's team plane could not exist
// in a composition where that service is absent or unmountable — measured in the
// `dsh-tui` case, where `TeamService`'s ROOT-bound projection registration is refused
// and the row never activates at all.
//
// A team's life is three operations, and BOTH backends can perform them:
//   spawn a member · deliver a message to it · interrupt it.
// Everything else a team has (the roster, the board, the dependency DAG, attempts,
// verdicts) belongs to `mpd-team-core`'s own record, which is why this seam is
// deliberately NARROW: the more it carries, the more the two backends must agree on,
// and the more the official plane creeps back into being the system of record.
//
// The two implementations, and what each one buys:
//   `native`   — `ctx.subagents.startContinuable` + `sendMessage` + `interrupt`, with the
//                provider and the per-member `agentOptions` chosen BY THE CALLER. That is
//                the whole point: a teammate's model route stops depending on the
//                official tool row's `freshProvider` config, the read-only deny list and
//                the persona travel as ordinary spawn arguments, and nothing here needs
//                the official plugin to be mounted. DEFAULT.
//   `official` — the `dsh.team*` calls the bundle already made. Kept because it is a real
//                implementation with behaviour the native path does not reproduce
//                (adjacency-checked delivery between peers, a host-owned roster), and
//                because a composition that already runs it must not regress.
//
// Selection is a CAPABILITY decision, made once and REPORTED (`reason`), never guessed at
// a call site. An explicit override exists for a diagnosis, not for normal operation.

/** Which backend raises and drives a team's members. */
export type DshTeamExecutorKind = "native" | "official"

/** Everything a backend needs to raise ONE member, in a vocabulary both backends can serve. */
export interface DshTeamSpawnRequest {
  /** The mpd team this member belongs to; carried into the native registry for membership. */
  teamId: string
  /** The mpd member id (`M1`), which is what a caller addresses the member by. */
  memberId: string
  /** The member's display name; unique inside its team and what the roster shows. */
  name: string
  /** One-line description shown on the roster; also the identity the roster route reads. */
  description: string
  /** The instantiation prompt the member receives. */
  prompt: string
  /**
   * The subagent provider to raise the member through (`spawn`, `fork`, `mpd-roster`, …).
   * NATIVE only — the official backend resolves its provider from row config and has no
   * per-call override, which is exactly the limitation this seam removes. Absent means
   * the composition's own default (`spawn`).
   */
  provider?: string
  /**
   * Harness-shaped `AgentOptions` (provider / model / reasoningEffort) for this member.
   * NATIVE only, for the same reason as {@link provider}: it is how a roster slot route
   * reaches a teammate WITHOUT the official tool row's `freshProvider` indirection.
   */
  agentOptions?: unknown
  /** Cancellation for the spawn and for the member's first turn. */
  signal?: AbortSignal
}

/** What one backend reports after raising a member. */
export interface DshTeamSpawnResult {
  /** The backend's OWN handle for the member (a durable child session id). Never an mpd id. */
  handle: string
  /** Which backend produced it, so a caller can record it and a reader can see it. */
  executor: DshTeamExecutorKind
}

/** One member a backend currently knows about, for a surface that lists them. */
export interface DshTeamExecutorMember {
  /** The backend's own handle. */
  handle: string
  /** The mpd team id this member was raised for. */
  teamId: string
  /** The mpd member id this handle was raised for. */
  memberId: string
  /** The member's display name. */
  name: string
}

/**
 * The ONE seam a team's execution goes through.
 *
 * Every method is total: an absent backend is a REFUSAL with a sentence, never a crash and
 * never a silent success. A caller records what this seam answers; it never infers it.
 */
export interface DshTeamExecutor {
  /** Which backend this is. A caller records it; a reader sees it. */
  readonly kind: DshTeamExecutorKind
  /** Why this backend is the active one — shown on a boot line and carried into a refusal. */
  readonly reason: string
  /** The subagent provider names this backend can raise a member through; `[]` for official. */
  providers(): string[]
  /**
   * Raise one member.
   * @param caller - the exact live Lead agent the member is raised under.
   * @param request - who the member is, what it is told, and (native) how it is routed.
   * @returns the backend's handle for the member.
   * @throws when the member cannot be raised — a member that does not exist must be loud.
   */
  spawn(caller: unknown, request: DshTeamSpawnRequest): Promise<DshTeamSpawnResult>
  /**
   * Deliver one message to a member.
   * @param caller - the exact live sender authorizing the delivery.
   * @param handle - the backend handle {@link spawn} returned.
   * @param content - the message text.
   * @param signal - cancellation, owning the operation only until acceptance.
   * @throws when the message was not admitted.
   */
  send(caller: unknown, handle: string, content: string, signal?: AbortSignal): Promise<void>
  /**
   * Interrupt a member's current turn. Fire-and-return, like both underlying seams.
   * @param caller - the exact live caller authorizing the interrupt.
   * @param handle - the backend handle {@link spawn} returned.
   * @throws when the interrupt is refused.
   */
  interrupt(caller: unknown, handle: string): Promise<void>
  /**
   * The team identity of one live agent, in the SAME shape the official roster answers, so
   * a consumer (the read-only discipline's tool guard) needs no knowledge of the backend.
   * @param agent - the agent to identify.
   * @returns the membership, or undefined when this agent is not a member of any team.
   */
  membership(agent: unknown): DshTeamMembership | undefined
  /** The members this backend currently knows about; `[]` when it tracks none. */
  members(): DshTeamExecutorMember[]
}

/** The target status sampled before a teammate interrupt. */
export interface DshTeamInterruptResult {
  /** The member's status sampled immediately BEFORE cancellation. */
  previousStatus: "running" | "inactive"
}

/** Result of waiting for Team activity (`TeamWaitResult`). */
export interface DshTeamWaitResult {
  /** Whether the wait expired instead of observing a change. */
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
  /** Model-facing name of the Lead that owns this team. */
  leadName: string
  /** The Lead's session id, which is also the team identity. */
  leadSessionId: string
  /** The team's current roster, one projected row per member. */
  members: DshTeamMemberView[]
  /** The team's current board, tombstones excluded. */
  tasks: DshTeamTaskView[]
}

/**
 * The `agent/pre-step` payload, as much of it as an mpd listener depends on.
 *
 * MEASURED against the installed harness (`dsh-agent-loop/lib/index.ts`
 * `preStep()`): the waterfall is dispatched with `{messages: claimed, turn, step,
 * agent?, signal}` and its default decision is `{kind:'enter', messages}` — the
 * SAME payload `dsh-agent-instructions` and `dsh-compaction-basic` read. `messages`
 * are the step's claimed inbox items, which is where the user-role turn lives.
 */
export interface DshAgentPreStep {
  /** The Agent the step belongs to, when the loop's dispatcher fuses it into the payload. */
  agent?: unknown
  /** The step's claimed inbox messages, which is where the user-role turn lives. */
  messages?: readonly unknown[]
  /** Ordinal of the turn this step belongs to. */
  turn?: number
  /** Ordinal of the step inside its turn. */
  step?: number
  /** Cancellation for the step. */
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
  /** The decision kind the loop switches on: enter runs the step, reject refuses it. */
  kind?: string
  /** The messages the step will run with; a listener may replace this list. */
  messages?: readonly unknown[]
  [key: string]: unknown
}

/** The normalized outcome of one in-process tool call. */
export interface DshToolCallResult {
  /** Whether the call completed without the harness marking an error. */
  ok: boolean
  /** Whether the harness returned an error result for the call. */
  isError: boolean
  /** The tool's structured value, on success. */
  value?: unknown
  /** The failure's message, when the call did not succeed. */
  error?: unknown
  /** The harness's own result object, for a caller that needs an unprojected field. */
  raw?: unknown
}

/** One skill row as the skills registry reports it. */
export interface DshSkillSummary {
  /** The skill's registered name, used to load it. */
  name: string
  /** Model-facing description of what the skill covers. */
  description?: string
  /** Which registry served the skill: bundled, user, or a provider name. */
  source?: string
  /** Name of the provider that owns the skill, when it is not the built-in loader. */
  provider?: string
  /** Location of the skill's resources, when they are not in-process text. */
  resourceBase?: { kind: string; path?: string; url?: string; description?: string }
  [key: string]: unknown
}

/** One agent preset row as the preset registry reports it. */
export interface DshPresetInfo {
  /** The preset's id, unique inside the registry. */
  id: string
  /** Filesystem path of the preset, when the host resolved one. */
  path?: string
  /** The trust level the host assigned to the preset. */
  trust?: string
  /** Why the preset is unusable, when the host marked it broken. */
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
  /** Unique section name; a duplicate THROWS inside the registry. */
  name: string
  /** Sort position: sections are concatenated in ascending order. */
  order: number
  /** Static text, or a provider re-evaluated at every assembly with `{agent, scope, signal?}`. */
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
  /** The RAW `agent.ctx` — identity, never a projection. */
  context: unknown
  /** Per-agent tool restriction, resolved against that same real scoped context. */
  tools: { restrict(filter: { allow?: readonly string[]; deny?: readonly string[] }): () => void }
  /** The scope's own event subscription (`ctx.on`), returning its disposer. */
  on(event: string, handler: (...args: unknown[]) => unknown): () => void
  /** Run `fn` as an effect owned by that scope and return its disposer. */
  effect(fn: () => unknown, label?: string): () => void
}

/** One boolean per seam, so a caller can degrade instead of crashing. */
export interface DshCapabilities {
  /** `ctx.get("tools")` answered at probe time. */
  tools: boolean
  /** The registry's `register()` — the seam `registerTool`/`registerTools` need. */
  toolsRegister: boolean
  /** The registry's `guard()` — the seam `guardTool` needs. */
  toolsGuard: boolean
  /** The registry's `get()` — what `hasTool` reads. */
  toolsGet: boolean
  /** The registry's `execute()` — what `executeTool` drives. */
  toolsExecute: boolean
  /** The `tools/pre-execute` waterfall is reachable through the event bus. */
  toolsPreExecute: boolean
  /** The `tools/post-execute` waterfall is reachable through the event bus. */
  toolsPostExecute: boolean
  /** `ctx.get("subagents")` answered at probe time. */
  subagents: boolean
  /** The service's `start()` — the seam `spawnAgent` needs. */
  subagentsSpawn: boolean
  /** `ctx.get("skills")` answered at probe time. */
  skills: boolean
  /** The skills registry's `registerProvider()` — what `registerSkillProvider` needs. */
  skillsProvider: boolean
  /** The preset registry's `resolve()` — what `resolvePreset` needs. */
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
  /**
   * The NATIVE team executor is the active backend for `teamExecutor()`.
   *
   * The pre-flight check for a caller that must know whether a team member will be raised
   * through mpd's own path (true) or through the mounted official service (false). It is
   * deliberately not the only thing a caller reads: `teamExecutor().reason` carries the
   * sentence, including the case where NEITHER backend can serve and every call will refuse.
   */
  teamExecutorNative: boolean
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
  /**
   * `ctx.get("goals")` answered with the goal service's own `get()` — the DURABLE read
   * {@link DshAdapter.goalState} performs. It is deliberately separate from
   * {@link DshCapabilities.goalTools}: the service is host-plane and always there in a
   * web/base boot, while the tools a WRITE must go through are preset-plane rows a
   * composition can omit, and a caller must be able to tell the two halves apart.
   */
  goals: boolean
  /**
   * The three harness goal tools (`get_goal` / `create_goal` / `update_goal`) all
   * resolve, at the host plane or inside a live agent's own scope — i.e.
   * {@link DshAdapter.goalControl} can actually run. A preset that mounts only
   * `tool-goal` reports true; one whose rows are disabled reports false and the caller
   * degrades to the durable read.
   */
  goalTools: boolean
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
  /** The shared session/agent id, which is how the registry keys a live Agent. */
  id: string
  /** The host's own status string, uninterpreted by this adapter. */
  status?: string
  /** The session this Agent serves, opaque here. */
  session?: unknown
  /** The Agent's OWN scoped context; the only route to its per-agent services. */
  ctx?: unknown
  /** The host's maintenance hook, when this build exposes one. */
  runMaintenance?: unknown
}

/**
 * One persisted session goal, projected for a plugin caller.
 *
 * The durable half mirrors the harness `goalValue` shape (`id`, `revision`,
 * `objective`, `phase`, `roundsStarted`, `maxGoalRounds`, optional `blockedReason`);
 * `activation` is PROCESS-LOCAL and present only when the read came through the
 * harness tool set, which is the only surface that observes it.
 */
export interface DshGoalSnapshot {
  /** Stable goal identity — the compare-and-set id a mutation has to name. */
  id: string
  /** Positive revision; every durable mutation increments it. */
  revision: number
  /** The human-requested completion objective. */
  objective: string
  /** Durable lifecycle phase. */
  phase: "active" | "paused" | "blocked" | "complete"
  /** Highest admitted goal round; absent when the read could not see the counter. */
  roundsStarted?: number
  /** Total admitted automatic-continuation round cap. */
  maxGoalRounds: number
  /** Present exactly while `phase` is `blocked`. */
  blockedReason?: { code: string; message: string }
  /** Whether THIS process may auto-continue the goal; `undefined` when unobserved. */
  activation?: "armed" | "disarmed"
}

/** One goal operation {@link DshAdapter.goalControl} can drive for one agent. */
export interface DshGoalControlInput {
  /**
   * The live calling agent. `get_goal`/`create_goal`/`update_goal` authenticate it as
   * the registry's exact instance inside an active driver, so a hand-built Agent-like
   * object is refused by the harness — same rule as
   * {@link DshAdapter.executeTool}'s `agent`.
   */
  agent?: unknown
  /** The operation; `read` is `get_goal` and every other action mutates through the tools. */
  action: "read" | "create" | "edit" | "pause" | "resume" | "complete" | "blocked"
  /** Completion objective: required by `create`, optional replacement for `edit`. */
  objective?: string
  /** Round cap for `create` / replacement cap for `edit`; the service default applies when omitted. */
  maxGoalRounds?: number
  /** Exact goal id from a prior read; read on demand when a ref-taking action omits it. */
  goalId?: string
  /** Exact revision from a prior read; read on demand when a ref-taking action omits it. */
  revision?: number
  /** Required by `blocked`: the concrete condition that persisted across goal rounds. */
  blockedReason?: string
  /** Traceability id for the underlying tool call; one is minted when omitted. */
  callId?: string
  /** Cancellation forwarded to the tool call. */
  signal?: AbortSignal
  /** Per-call timeout in milliseconds; the adapter's configured default applies when omitted. */
  timeoutMs?: number
}

/** What one {@link DshAdapter.goalControl} call produced. */
export interface DshGoalControlResult {
  /** Whether the operation was admitted; a POLICY refusal is `ok:false`, never a throw. */
  ok: boolean
  /** Whether the harness marked the underlying tool result an error. */
  isError: boolean
  /** The goal after the operation; `null` when the session has none. */
  goal?: DshGoalSnapshot | null
  /** The activation the tool observed after the call, when it reported one. */
  activation?: "armed" | "disarmed"
  /** The harness's own refusal/failure text when the call did not succeed. */
  error?: unknown
  /** Which registry answered: the agent's own scope, the host plane, or the service. */
  via?: "agent-scope" | "host-plane" | "service"
  /** The harness's raw tool result, forwarded for diagnostics. */
  raw?: unknown
}

/**
 * One selectable reasoning effort of one model (see {@link DshLlmCatalog}).
 */
export interface DshLlmCatalogEffort {
  /** Opaque value accepted as `reasoningEffort` (host `LlmReasoningEffortInfo.id`). */
  id: string
  /** Human-readable effort name for selectors. */
  name: string
  /** Human-readable effort description for selectors, when the host declares one. */
  description?: string
}

/** One model of one provider, with its reasoning metadata FLATTENED onto it. */
export interface DshLlmCatalogModel {
  /** Opaque model id the host routes on. */
  id: string
  /** Model name shown in pickers; falls back to the id. */
  name: string
  /** Model description shown in pickers, when the host declares one. */
  description?: string
  /** Always an array: `[]` when the model declares no reasoning block. */
  efforts: DshLlmCatalogEffort[]
  /** The adapter-configured default effort, absent when the host declares none. */
  defaultEffort?: string
}

/** One provider route and every model it currently advertises. */
export interface DshLlmCatalogProvider {
  /** Provider id, the route's first key. */
  id: string
  /** Provider name shown in pickers; falls back to the id. */
  name: string
  /** Every model this provider currently advertises. */
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
  /** The providers readable at call time; empty when the seam is unusable. */
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

/** One namespace's read surface: the resolved value and its descriptor. */
export interface DshSettingsReader {
  /** Resolved value of the namespace (`undefined` while it is not served). */
  get(): unknown
  /** The namespace descriptor when available: value/revision/user/base/applies. */
  describe(): { value?: unknown; revision?: number; user?: unknown; base?: unknown; applies?: string } | undefined
}

/** The seam surface every mpd plugin consumes instead of the raw cordis ctx. */
export interface DshAdapter {
  /** The machine-readable degradation contract: one boolean per seam. */
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
  /**
   * Append one diagnostic line to a ROW's own log file (`<root>/.mpd/logs/<name>.log`).
   *
   * R5: rows never print. In a TUI session the host's stdout/stderr IS the Ink alternate screen, so a
   * row's boot line, warning or trace goes to a file. Total by contract: an unresolvable or unwritable
   * root drops the line into the sink's bounded ring and NEVER writes to a terminal.
   *
   * @param name the log's base name — the row's own `[mpd-…]` prefix without brackets.
   * @param line the diagnostic text; one newline is appended.
   */
  rowLog(name: string, line: string): void
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
   * Read ONE agent's current persisted goal through the host-plane goal service.
   *
   * NEVER throws, and the two empty answers mean different things on purpose: `null` is
   * "this session has no current goal", `undefined` is "this composition could not tell"
   * (no `goals` service, or the service refused the agent because it is not the live
   * registry instance). Reported by `capabilities().goals`.
   */
  goalState(agent: unknown): DshGoalSnapshot | null | undefined
  /**
   * Drive ONE goal operation for one agent through the HARNESS GOAL TOOLS.
   *
   * WHY THE TOOLS AND NOT THE SERVICE: the goal domain's authorisation lives in
   * `@deepseek-ai/dsh-tool-goal` — `create`/`edit`/`pause`/`resume` require a direct
   * human turn on a top-level agent, `blocked` requires the configured consecutive-round
   * threshold, and every call requires the exact live calling agent inside its active
   * driver. Writing `ctx.goals` directly would make this bundle a policy-free authority
   * over goal state, so the seam deliberately cannot reach the mutating service methods:
   * it forwards to the tools and hands their refusal back verbatim.
   *
   * NEVER throws and never rejects: a policy refusal is `{ok:false, error}`, and a
   * composition without the tools reports `capabilities().goalTools === false`.
   */
  goalControl(input: DshGoalControlInput): Promise<DshGoalControlResult>
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
   * `@deepseek-ai/dsh-settings/lib/index.ts:466-467` and `:497-498` — so the
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
   * same, `dsh-settings/lib/index.ts:327-350`).
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
  /** Register one NORMALIZED tool definition; `registerHostTool` is the verbatim sibling. */
  registerTool(definition: DshToolDef): () => void
  /** Register several definitions at once; the returned disposer removes all of them. */
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
   * MEASURED in the installed harness (`dsh-commands/lib/index.ts`): `register()`
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
   * (`dsh-agent/lib/index.ts` `assembleContextFor`): the section's `text` provider is
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
  /** Install a guard that denies a call by returning a string, or allows it with undefined. */
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
   * (the harness awaits the whole waterfall before it executes, `dsh-tools/lib/index.ts:3116`),
   * so it sees the decision that will actually be used.
   *
   * @param listener - `(exec, decision)`; the decision is the harness's own
   *   `{kind:'allow'|'ask'|'deny'}` gate value (see {@link DshPreDecision}).
   * @returns a disposer (a no-op when the seam does not exist).
   */
  onPreToolExecute(listener: (exec: DshToolExec, decision: DshPreDecision | undefined) => void): () => void
  /** Decide the post-execute waterfall: return a decision to replace the downstream one, undefined to pass it through. */
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
  /** The harness web server, probed tolerantly; see the implementation for the two names it tries. */
  webServerOf(): unknown
  /** Run `callback` when one of `names` binds (or rebinds) as a service; returns a disposer. */
  onServiceBound(names: readonly string[], callback: (name: string) => void): () => void
  /** Register the pre-step listener inside ONE agent's own scope — the site delivery reliably reaches. */
  registerAgentPreStep(
    agent: unknown,
    listener: (payload: DshAgentPreStep, decision: DshPreStepDecision) => DshPreStepDecision | undefined | Promise<DshPreStepDecision | undefined>,
  ): () => void
  /** Whether a tool of this name is registered right now. */
  hasTool(name: string): boolean
  /**
   * Structural view of the tool runtime for internal tool calls.
   *
   * `execute`'s optional `agent` is forwarded verbatim as the harness execution's
   * `exec.agent` (measured contract: `dsh-tools/lib/index.ts:3025-3045` reads
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
  /** Spawn one one-shot subagent and normalize its answer onto {@link DshSpawnResult}. */
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
  /**
   * The ACTIVE team executor — the seam mpd's own team system raises members through.
   *
   * NEVER throws and never returns undefined: a composition always gets a backend, and when
   * neither can serve, the answer is an executor whose every call REFUSES with the reason.
   * The choice is made from `capabilities()` once per call (cheap, and it keeps a late-ACTIVE
   * service from being frozen out) and the `reason` says which way it went:
   *
   *   `native`   when `subagentsContinuable` is true — the default, and the one that needs
   *              nothing from the official plugin;
   *   `official` when the native seams are absent but `ctx.agentTeams` is mounted;
   *   a REFUSING `native` executor when neither is available, naming both misses, so a
   *              caller gets a sentence rather than a TypeError.
   *
   * `MPD_DSH_TEAM_EXECUTOR=native|official` overrides the choice. It exists for a
   * DIAGNOSIS — "is this defect in the executor or in the record?" — and never for normal
   * operation: the whole point of the split is that mpd owns the team, and an override that
   * quietly handed execution back would hide exactly the regression this seam prevents.
   */
  teamExecutor(): DshTeamExecutor
  /**
   * The mounted Agent Teams service itself (`ctx.get("agentTeams")`), or `undefined` when this
   * composition has no team row.
   *
   * The RAW service is handed out deliberately for the same reason
   * {@link DshAdapter.subagentRuntime} is: a consumer may need a surface this adapter does not
   * model yet, and re-declaring it here would be a second seam to keep in sync. Every mpd consumer
   * is expected to prefer the typed methods — and, for a TEAM, `teamExecutor()` — and to read this
   * one only as an escape hatch. It is contained: a `ctx` that cannot answer is `undefined`, never
   * a throw.
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
  /** Register one skill provider VERBATIM; THROWS when the skills service is absent. */
  registerSkillProvider(provider: unknown): () => void
  /** List the skills visible from `options.cwd`; THROWS when the registry exposes no list(). */
  listSkills(options?: { cwd?: string }): Promise<DshSkillSummary[]>
  /** Load one skill by name, resolved against `options.cwd` when one is given. */
  loadSkill(skillName: string, options?: { cwd?: string }): Promise<unknown>
  /** Resolve one preset id onto the normalized {@link DshPresetInfo} shape. */
  resolvePreset(presetId: string): Promise<DshPresetInfo>
  /** Wrap any value into the single-text-block content array a harness message takes. */
  text(content: unknown): DshTextBlock[]
  /**
   * Build ONE user-role message for SESSION INJECTION — the value
   * `agent.followup(message)` takes and the value a pre-step
   * `{kind:'enter', messages:[…]}` decision appends (in-tree precedent:
   * `packages/mpd-agent-teams-plugin/lib/command.ts`, the `/agent-teams`
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
   * (`_deps/dsh-llm/lib/index.ts` `createUserMessage`): a fresh `id`, the
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
   * Measured harness shape: `dsh-agent-loop/lib/index.ts` `steer(input)` is
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
   * MEASURED in the installed harness (`dsh-agent-loop/lib/index.ts`):
   * `followup(input)` is `send(input, "next-turn", true)` — the item becomes the
   * sole ordinary message of its own turn and the driver wakes. The in-tree
   * precedent is `packages/mpd-agent-teams-plugin/lib/command.ts`, the
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
  /** The message body, already normalized to one text block. */
  const content = textBlock(input?.text)
  for (const block of content) Object.freeze(block)
  Object.freeze(content)
  /** The producer tag, defaulted to `{kind:'user'}` before it is frozen. */
  const source: DshUserMessageSource = { kind: "user", ...(input?.source ?? {}) }
  Object.freeze(source)
  /** The assembled, frozen user-role message handed to an agent's turn seam. */
  const message: DshUserMessage = { id: randomUUID(), role: "user", content, source }
  return Object.freeze(message)
}

/** Post-execute decision helpers (the harness uses `feedback`, older notes `reason`). */
export const decision = {
  accept: (content?: unknown): DshPostDecision => (content === undefined ? { kind: "accept" } : { kind: "accept", content }),
  block: (feedback: unknown): DshPostDecision => ({ kind: "block", feedback }),
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
    /** The session header's cwd, when it is a usable non-empty string. */
    const cwd = agent?.session?.header?.cwd
    return typeof cwd === "string" && cwd.length > 0 ? cwd : undefined
  } catch {
    return undefined
  }
}

/** The authoritative workspace root for a call (see precedence above). */
export function workspaceRootOf(exec?: DshToolExec): string {
  /** The calling session's own workspace, which outranks every process-wide source. */
  const session = sessionCwdOf(exec?.agent)
  if (session !== undefined) return resolve(session)
  /** The operator/QA process override, read per call and never cached. */
  const override = process.env.DSH_WORKSPACE_ROOT
  if (typeof override === "string" && override.length > 0) return resolve(override)
  return process.cwd()
}

/**
 * One sink per ROW NAME, each remembering the root it was opened against (module scope).
 *
 * Keyed by name, not by root, so a host running many rows opens one file (and one fd) per row instead
 * of reopening on every call. The stored root is re-checked on every use — AGENTS.md §6 forbids caching
 * a workspace ROOT, so a different session's root replaces the entry. Declared bound: one fd per
 * distinct row name this process has logged for.
 */
const rowLogSinks = new Map<string, { root: string; sink: LogSink }>()

/**
 * Append one diagnostic line to a ROW's own log file (`<root>/.mpd/logs/<name>.log`).
 *
 * R5: an MPD row must never print. In a TUI session the host's stdout/stderr IS the Ink alternate
 * screen, so a row's boot line, warning or trace goes to a file instead. The module-level form is the
 * ONE implementation — {@link DshAdapter.rowLog} delegates to it — because a row that has no adapter
 * instance in scope (a module-level helper, a callback object) still needs the same destination.
 *
 * Totality is the contract: an unresolvable root, an unwritable directory or a failed append all DROP
 * the line (into the sink's bounded in-memory ring) and never write to a terminal.
 *
 * @param name the log's base name — the row's own `[mpd-…]` prefix, without brackets.
 * @param line the diagnostic text; the sink appends exactly one newline.
 */
export function rowLogLine(name: string, line: string): void {
  try {
    /** The workspace root for this call; an exec-less row resolves DSH_WORKSPACE_ROOT → cwd. */
    const root = workspaceRootOf(undefined)
    /** The cached entry for this row name, reused while its root is unchanged. */
    let entry = rowLogSinks.get(name)
    if (entry === undefined || entry.root !== root) {
      entry = { root, sink: openLogSink(name, { roots: [root] }) }
      rowLogSinks.set(name, entry)
    }
    entry.sink.write(line)
  } catch {
    // Never throw and never print: a diagnostic must not take a boot down.
  }
}

/**
 * Workspace roots of every live session, deduplicated, registration order.
 * `[]` when the agent registry is absent — the caller then falls back to the
 * exec-less {@link workspaceRootOf}.
 */
export function workspaceRootsOf(agents: any): string[] {
  if (agents === undefined || agents === null || typeof agents.list !== "function") return []
  try {
    /** The registry's live Agent list, validated as an array before it is folded. */
    const list = agents.list()
    if (!Array.isArray(list)) return []
    /** Deduplicated workspace roots, kept in the registry's registration order. */
    const roots = new Set<string>()
    for (const agent of list) {
      /** One live agent's session workspace, added only when it resolves. */
      const cwd = sessionCwdOf(agent)
      if (cwd !== undefined) roots.add(resolve(cwd))
    }
    return [...roots]
  } catch {
    return []
  }
}

/** The shared no-op disposer for a registration that did not happen. */
function noop(): void { /* seam absent: nothing was registered */ }

/**
 * The three harness goal tools this adapter drives, in the order the goal seam reads them.
 *
 * Exported because they are part of the seam contract: `capabilities().goalTools` reports whether
 * THEY resolve, and a caller that pre-flights a composition should not re-spell the list.
 */
export const GOAL_TOOL_NAMES: readonly string[] = ["get_goal", "create_goal", "update_goal"]

/**
 * Normalize one harness goal object into {@link DshGoalSnapshot}.
 *
 * Accepts BOTH shapes the harness exposes: a `GoalView` from `ctx.goals.get(agent)`
 * (which carries `roundsStarted` and the process-local `activation`) and the cropped
 * `goal` member of a tool value (same durable fields, activation spelled beside it).
 * @param view - the service view, or the tool value's `goal` member.
 * @returns the snapshot, or undefined when the object carries no usable goal identity.
 */
function goalSnapshotOf(view: unknown): DshGoalSnapshot | undefined {
  if (view === null || view === undefined || typeof view !== "object") return undefined
  /** The goal object viewed as the loose record it is at the harness boundary. */
  const raw = view as Record<string, unknown>
  if (typeof raw.id !== "string" || raw.id === "") return undefined
  /** The normalized snapshot, filled field by field so no unvalidated value crosses. */
  const snapshot: DshGoalSnapshot = {
    id: raw.id,
    revision: typeof raw.revision === "number" ? raw.revision : 0,
    objective: typeof raw.objective === "string" ? raw.objective : "",
    phase: raw.phase === "paused" || raw.phase === "blocked" || raw.phase === "complete" ? raw.phase : "active",
    maxGoalRounds: typeof raw.maxGoalRounds === "number" ? raw.maxGoalRounds : 0,
  }
  if (typeof raw.roundsStarted === "number") snapshot.roundsStarted = raw.roundsStarted
  if (raw.activation === "armed" || raw.activation === "disarmed") snapshot.activation = raw.activation
  /** The blocking policy record, present exactly while the phase is `blocked`. */
  const reason = raw.blockedReason
  if (reason !== null && typeof reason === "object") {
    /** The stable policy code, accepted only as a non-empty string. */
    const code = (reason as { code?: unknown }).code
    /** The human-readable explanation, accepted only as a non-empty string. */
    const message = (reason as { message?: unknown }).message
    if (typeof code === "string" && code !== "" && typeof message === "string" && message !== "") {
      snapshot.blockedReason = { code, message }
    }
  }
  return snapshot
}

/**
 * Read one goal TOOL VALUE (`{ goal: {...} | null, activation }`) into a snapshot pair.
 * @param value - the tool result value, or anything else that arrived.
 * @returns the goal (null when the session has none) and the observed activation.
 */
function goalValueOf(value: unknown): { goal: DshGoalSnapshot | null; activation?: "armed" | "disarmed" } {
  if (value === null || value === undefined || typeof value !== "object") return { goal: null }
  /** The tool value viewed as the record it is at the harness boundary. */
  const raw = value as Record<string, unknown>
  /** The activation the tool reported beside the goal, or undefined when it said nothing. */
  const activation = raw.activation === "armed" || raw.activation === "disarmed" ? raw.activation : undefined
  /** The normalized goal; absent members mean the session has no current goal. */
  const goal = goalSnapshotOf(raw.goal)
  if (goal === undefined) return activation === undefined ? { goal: null } : { goal: null, activation }
  // The tool spells activation BESIDE the goal; move it onto the snapshot so callers read one object.
  if (activation !== undefined) goal.activation = activation
  return activation === undefined ? { goal } : { goal, activation }
}

/**
 * The agent-scope context probe shared by this adapter: `agent.ctx`, all-or-nothing.
 *
 * A cordis scope is only usable when EVERY member the adapter forwards exists, because a
 * partially-shaped context turns a feature-detectable absence into a `TypeError` at an
 * arbitrary later moment. The probe is contained (a throwing getter or a proxy context is a
 * miss, never a crash — the adapter's never-crash-at-construction contract).
 *
 * The returned `context` is the SAME object (`agent.ctx`), and each member is a
 * forwarder that binds the raw receiver, so the host's own scoped cordis semantics
 * (effect ownership, `restrict` resolution) are preserved.
 */
function scopeOfAgentContext(agent: unknown): DshAgentScope | undefined {
  /** The raw `agent.ctx`, read behind a guard so a throwing proxy is a miss. */
  let context: unknown
  try {
    context = (agent as { ctx?: unknown } | undefined)?.ctx
  } catch {
    return undefined
  }
  if (context === undefined || context === null) return undefined
  /** The context's `typeof`, used to reject primitives before any member is probed. */
  const kind = typeof context
  if (kind !== "object" && kind !== "function") return undefined
  /** The context's `on`, captured before it is called as a forwarder. */
  let on: unknown
  /** The context's `effect`, captured before it is called as a forwarder. */
  let effect: unknown
  /** The context's `tools.restrict`, captured before it is bound to `tools`. */
  let restrict: unknown
  try {
    /** The context viewed as the three members this scope promises, probed in one guard. */
    const scoped = context as { on?: unknown; effect?: unknown; tools?: { restrict?: unknown } }
    on = scoped.on
    effect = scoped.effect
    restrict = scoped.tools?.restrict
  } catch {
    return undefined
  }
  if (typeof on !== "function" || typeof effect !== "function" || typeof restrict !== "function") return undefined
  /** The raw `tools` object, kept as the receiver `restrict` is called on. */
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
  /** The host's member row viewed as a plain record, so every read is guarded. */
  const row = (raw ?? {}) as Record<string, unknown>
  /** The validated spawn context, or undefined when the host declared none. */
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
  /** The host's task row viewed as a plain record, so every read is guarded. */
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
  /** The service's read method, absent on a host that does not model this family. */
  const reader = teams?.[method]
  if (typeof reader !== "function") return []
  try {
    /** The raw host answer, accepted only when it is an array. */
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
    /** The decision used when the waterfall's own `next()` yields nothing. */
    const fallback: DshPreStepDecision = { kind: "enter", messages: payload?.messages ?? [] }
    /** The harness's own decision, which a silent listener leaves untouched. */
    const downstream: DshPreStepDecision = typeof next === "function" ? (await next()) ?? fallback : fallback
    try {
      /** The listener's decision; undefined keeps the downstream one. */
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
  /** The agent's scoped context, the carrier of its own systemPrompt service. */
  const context = scopeContextOf(agent)
  if (context === undefined || context === null) return undefined
  try {
    /** The scoped service, accepted only when it exposes a callable `section()`. */
    const systemPrompt = (context as { systemPrompt?: unknown }).systemPrompt
    return typeof (systemPrompt as { section?: unknown } | undefined)?.section === "function" ? systemPrompt : undefined
  } catch {
    return undefined
  }
}

/** Build one adapter over a cordis ctx; every seam is probed lazily, so construction never throws. */
export function createDshAdapter(ctx: any, config: { defaultTimeoutMs?: number } = {}): DshAdapter {
  /** The row's configured `executeTool` timeout, or the module default. */
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
  /** Resolve a harness service: `ctx.get(name)` first, then the ctx property form. */
  const service = (serviceName: string): any => {
    if (typeof ctx?.get === "function") {
      try {
        /** The `ctx.get` answer, preferred because an uninjected property read THROWS in cordis. */
        const viaGet = ctx.get(serviceName)
        if (viaGet !== undefined && viaGet !== null) return viaGet
      } catch { /* fall through to the property form */ }
    }
    try { return ctx?.[serviceName] } catch { return undefined }
  }

  /** The service, or a THROW naming the exact action that could not happen. */
  function requireService(serviceName: string, needed: string): any {
    /** The resolved service, rejected when it is nullish. */
    const found = service(serviceName)
    if (found === undefined || found === null) {
      throw new Error(`mpd-dsh-adapter: harness service "${serviceName}" is unavailable — ${needed}`)
    }
    return found
  }

  // The workspace plane forwards to the ONE module-level resolution below; the
  // instance form exists so plugins with a ctx still go through the adapter surface.
  const workspaceRoot = (exec?: DshToolExec): string => workspaceRootOf(exec)
  /** The union of live session workspaces, read through the registry at call time. */
  const workspaceRootsAll = (): string[] => workspaceRootsOf(service("agents"))

  /** The instance form of the module-level row logger: one implementation, two surfaces. */
  const rowLog = (name: string, line: string): void => rowLogLine(name, line)

  // ── live-session plane ────────────────────────────────────────────────────
  // `agents.list()` is the ONLY handle on a member's Agent: the durable team record
  // carries member NAMES and session IDs, not Agents, and a continuable member's Agent
  // lives in this process only while its session does.
  function liveAgents(): DshLiveAgent[] {
    /** The live-session registry, or undefined when this composition has none. */
    const agents = service("agents")
    if (agents === undefined || typeof agents.list !== "function") return []
    try {
      /** The registry's live Agent array, accepted only when it is an array. */
      const list = agents.list()
      return Array.isArray(list) ? list.filter((entry: any) => entry !== undefined && entry !== null) : []
    } catch { return [] }
  }

  /** One live Agent by id, from `agents.get` when present and the list scan otherwise. */
  function liveAgent(agentId: string): DshLiveAgent | undefined {
    /** The requested id, normalized so a non-string can never match a row. */
    const id = String(agentId ?? "")
    if (id === "") return undefined
    /** The live-session registry used for this lookup. */
    const agents = service("agents")
    if (agents !== undefined && typeof agents.get === "function") {
      try {
        /** The registry's own answer, preferred over the list scan. */
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
  /** The member-scoped engine lookup described above: memoized, and re-read from the live registry. */
  function compactionEngineForAgent(agentId: string): unknown {
    /** The requested agent id, normalized into a cache key. */
    const id = String(agentId ?? "")
    if (id === "") return undefined
    /** The memoized engine, returned only while its agent is still live. */
    const cached = engineCache.get(id)
    if (cached !== undefined) return cached
    /** The live Agent whose own scope owns the engine. */
    const agent = liveAgent(id)
    /** The Agent's own scoped context, the only realm whose engine is correct. */
    const scoped = agent?.ctx
    if (scoped === undefined || scoped === null) return undefined
    /** The engine resolved from the agent's own scope, before it is memoized. */
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

  /** Subscribe to a harness event; undefined when no event bus is reachable. */
  function onEvent(event: string, handler: (...args: unknown[]) => unknown): (() => void) | undefined {
    if (typeof ctx?.on !== "function") return undefined
    try {
      /** The bus's own disposer, degraded to a no-op when it returned none. */
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
  /** Set on the first degraded catalog read, so the warn-once line is emitted at most once. */
  let llmCatalogWarned = false
  /** ONE warn-once line per adapter instance, naming the seam that degraded the catalog. */
  function warnLlmCatalogOnce(detail: string): void {
    if (llmCatalogWarned) return
    llmCatalogWarned = true
    // A replaced/hostile console must never take a read down (the never-throw contract).
    try { rowLogLine("mpd-dsh-adapter", "mpd-dsh-adapter: llmCatalog degraded — " + detail) } catch { /* seam absent: nothing to report */ }
  }

  /** `name` with the id as fallback, so a caller never renders `undefined`. */
  function catalogLabel(value: unknown, id: string): string {
    return typeof value === "string" && value.length > 0 ? value : id
  }

  /** Read the host's model catalog through `ctx.llm`; never throws and never rejects. */
  async function llmCatalog(): Promise<DshLlmCatalog> {
    /** The harness llm service, or undefined when this composition has none. */
    const llm = service("llm")
    if (llm === undefined || llm === null) {
      warnLlmCatalogOnce("the harness llm service is unavailable")
      return { providers: [], degraded: true }
    }
    /** The names of the three catalog methods the service does not expose. */
    const missing = LLM_CATALOG_METHODS.filter((method) => typeof llm?.[method] !== "function")
    if (missing.length > 0) {
      warnLlmCatalogOnce("the harness llm service lacks " + missing.join(", "))
      return { providers: [], degraded: true }
    }
    /** The host's raw provider list, validated as an array before projection. */
    let providers: unknown
    try {
      // `await` keeps this correct for the host's SYNC listProviders() as well as a
      // remote variant that answers a promise (dsh-llm/lib/typert.remote-client).
      providers = await llm.listProviders()
    } catch (error) {
      warnLlmCatalogOnce("listProviders() failed: " + errorMessage(error))
      return { providers: [], degraded: true }
    }
    if (!Array.isArray(providers)) {
      warnLlmCatalogOnce("listProviders() did not return an array")
      return { providers: [], degraded: true }
    }
    // `degraded` is sticky: ONE skipped provider or model marks the whole read degraded.
    let degraded = false
    /** The projected providers, filled as each host row is accepted. */
    const catalog: DshLlmCatalogProvider[] = []
    for (const rawProvider of providers as any[]) {
      /** The provider's id, the only required host field. */
      const providerId = typeof rawProvider?.id === "string" ? rawProvider.id : undefined
      if (providerId === undefined) { degraded = true; continue }
      try {
        /** The provider's raw model list, validated as an array. */
        const models = await llm.listModels(providerId)
        if (!Array.isArray(models)) throw new Error("listModels(" + providerId + ") did not return an array")
        /** The projected models of this provider. */
        const entries: DshLlmCatalogModel[] = []
        for (const rawModel of models as any[]) {
          /** The model's id, the only required host field. */
          const modelId = typeof rawModel?.id === "string" ? rawModel.id : undefined
          if (modelId === undefined) { degraded = true; continue }
          /** The host's resolved model info, the carrier of the reasoning block. */
          let resolved: any
          try {
            resolved = await llm.resolveModelInfo(providerId, modelId)
          } catch {
            // One unresolvable model is skipped, never fatal for the catalog.
            degraded = true
            continue
          }
          /** The host's optional reasoning block, flattened onto the model below. */
          const reasoning = resolved?.reasoning
          /** The projected efforts, always present even when the model declares none. */
          const efforts: DshLlmCatalogEffort[] = []
          /** The host's effort array, or empty when it declared none. */
          const rawEfforts = Array.isArray(reasoning?.efforts) ? reasoning.efforts : []
          for (const rawEffort of rawEfforts as any[]) {
            /** The effort's opaque id, the only required host field. */
            const effortId = typeof rawEffort?.id === "string" ? rawEffort.id : undefined
            if (effortId === undefined) continue
            efforts.push({
              id: effortId,
              name: catalogLabel(rawEffort?.name, effortId),
              ...(typeof rawEffort?.description === "string" ? { description: rawEffort.description } : {}),
            })
          }
          /** The host's configured default effort, when it declared one. */
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

  /** An `AbortSignal.timeout` for one call, or undefined where the runtime lacks it. */
  function timeoutSignal(timeoutMs: number): AbortSignal | undefined {
    try {
      if (typeof AbortSignal !== "undefined" && typeof (AbortSignal as any).timeout === "function") return (AbortSignal as any).timeout(timeoutMs)
    } catch { /* fall through to no signal */ }
    return undefined
  }

  /** The assembled seam surface, provided as the row's `mpdDsh` service. */
  // ── the two team backends ─────────────────────────────────────────────────
  //
  // Both registries below are created ONCE per adapter instance, not per call: the
  // `teamExecutor()` factory is re-entered on every call (so a late-ACTIVE service is picked
  // up), and a handle recorded by one call must still be resolvable by the next.
  /** Native members, by the durable child session id `startContinuable` returned. */
  const nativeMembers = new Map<string, { teamId: string; memberId: string; name: string; description: string }>()
  /** Official members, by handle, so an interrupt can name the member the way that backend wants. */
  const officialMembers = new Map<string, { teamId: string; memberId: string; name: string }>()

  /** A signal that is never aborted, for a call that supplied none. */
  const neverAborted = (): AbortSignal => new AbortController().signal

  /** The session id of one live agent, or the empty string when it carries none. */
  const sessionIdOfAgent = (agent: unknown): string => {
    /** The agent's session, read defensively: a stub or a stale handle may carry none. */
    const session = (agent as { session?: { id?: unknown } } | undefined)?.session
    return typeof session?.id === "string" ? session.id : ""
  }

  /**
   * Build the NATIVE executor: `ctx.subagents`, with the provider and the member's route
   * chosen BY THE CALLER.
   *
   * This is the whole point of the split. The official tool row forwards only
   * `{ prompt, parent }` to `startContinuable`, so a per-member route had to be smuggled in
   * through row config (`freshProvider`) and a member's identity had to be encoded in its
   * DESCRIPTION. Here the provider and `agentOptions` are ordinary arguments, which is what
   * lets the roster's model slots, its persona and its read-only deny list apply to a
   * teammate directly — and what makes the path independent of the official plugin.
   * @param reason - why this backend is the active one, shown on a boot line and in a refusal.
   * @param ready - whether `subagentsContinuable` answered true; false makes every call refuse.
   * @returns the executor.
   */
  function nativeTeamExecutor(reason: string, ready: boolean): DshTeamExecutor {
    /** The subagents service, resolved per call so a late-ACTIVE service is not frozen out. */
    const subagentsOf = (): any => service("subagents")
    return {
      kind: "native",
      reason,
      providers: () => {
        /** The provider names the harness itself reports, which is what a caller may name. */
        try {
          /** The service's own list, or undefined when it exposes none. */
          const list = subagentsOf()?.providers
          if (typeof list !== "function") return []
          /** Its answer, filtered to strings so the declared `string[]` cannot leak a stub value. */
          const names = list.call(subagentsOf())
          return Array.isArray(names) ? names.filter((entry: unknown): entry is string => typeof entry === "string") : []
        } catch { return [] }
      },
      /** Raise one member through `ctx.subagents.startContinuable`, with the caller's route. */
      async spawn(caller: unknown, request: DshTeamSpawnRequest): Promise<DshTeamSpawnResult> {
        if (!ready) throw new Error(`mpd-dsh-adapter: no team executor is available — ${reason}`)
        /** The subagents service, or a throw naming the action that could not happen. */
        const subagents = requireService("subagents", `cannot raise team member "${request.name}"`)
        if (typeof subagents.startContinuable !== "function") {
          throw new Error("mpd-dsh-adapter: the harness subagents service exposes no startContinuable() — cannot raise a team member")
        }
        /** The continuable-start spec: the member's prompt, its parent, and its ROUTE. */
        const spec: Record<string, unknown> = {
          provider: typeof request.provider === "string" && request.provider !== "" ? request.provider : "spawn",
          label: `${request.name} · ${request.teamId}`,
          request: {
            prompt: textBlock(request.prompt),
            parent: caller,
            ...(request.agentOptions === undefined ? {} : { agentOptions: request.agentOptions }),
          },
          signal: request.signal ?? neverAborted(),
        }
        /** The manager's answer, whose `childId` is the durable handle a caller records. */
        const started: any = await subagents.startContinuable.call(subagents, spec)
        /** The durable child id, or the empty string when the manager reported none. */
        const handle = String(started?.childId ?? started?.id ?? "")
        // A start that resolved WITHOUT an id is a backend contradiction, and recording it would
        // put a member on the roster that no later call could reach. It is refused here.
        if (handle === "") throw new Error(`mpd-dsh-adapter: the native backend raised "${request.name}" but reported no child id`)
        nativeMembers.set(handle, { teamId: request.teamId, memberId: request.memberId, name: request.name, description: request.description })
        return { handle, executor: "native" }
      },
      /** Deliver one message to a member; the manager cold-resumes a child that is not live. */
      async send(caller: unknown, handle: string, content: string, signal?: AbortSignal): Promise<void> {
        // The SAME availability guard as `spawn`: an executor that cannot raise a member must not
        // half-work by delivering into a team it could never have built. Refusing here is what
        // makes "the reason" a property of the BACKEND rather than of one method.
        if (!ready) throw new Error(`mpd-dsh-adapter: no team executor is available — ${reason}`)
        /** The subagents service, or a throw naming the action that could not happen. */
        const subagents = requireService("subagents", `cannot deliver a message to team member "${handle}"`)
        if (typeof subagents.sendMessage !== "function") {
          throw new Error("mpd-dsh-adapter: the harness subagents service exposes no sendMessage() — cannot deliver to a team member")
        }
        // `sendMessage` cold-resumes an absent direct child, which is why the native path does
        // NOT need the child to be live the way a raw `agent.inject` would.
        await subagents.sendMessage.call(subagents, caller, handle, textBlock(content), { signal: signal ?? neverAborted() })
      },
      /** Interrupt a member's current turn under the exact live caller's ancestry. */
      async interrupt(caller: unknown, handle: string): Promise<void> {
        // Same availability guard as `spawn` and `send`, for the same reason.
        if (!ready) throw new Error(`mpd-dsh-adapter: no team executor is available — ${reason}`)
        /** The subagents service, or a throw naming the action that could not happen. */
        const subagents = requireService("subagents", `cannot interrupt team member "${handle}"`)
        if (typeof subagents.interrupt !== "function") {
          throw new Error("mpd-dsh-adapter: the harness subagents service exposes no interrupt() — cannot interrupt a team member")
        }
        // The `ancestor` authority is the exact live caller whose lineage must contain the child,
        // which is the form this seam can honestly present: the record carries no human address.
        subagents.interrupt.call(subagents, handle, { kind: "ancestor", agent: caller })
      },
      /** Identify a member this adapter raised, by the handle its own session id carries. */
      membership(agent: unknown): DshTeamMembership | undefined {
        /** The agent's own session id, which is what a handle IS on this backend. */
        const id = sessionIdOfAgent(agent)
        if (id === "") return undefined
        /** The member this handle was raised for, if this adapter raised it. */
        const entry = nativeMembers.get(id)
        // No entry is a normal negative: this is used as a FILTER, so an unknown agent is a miss.
        return entry === undefined ? undefined : { teamId: entry.teamId, role: "teammate", name: entry.name }
      },
      members: () => [...nativeMembers.entries()].map(([handle, entry]) => ({ handle, teamId: entry.teamId, memberId: entry.memberId, name: entry.name })),
    }
  }

  /**
   * Build the OFFICIAL executor: the `dsh.team*` calls the bundle already made.
   *
   * Kept as a real implementation rather than a shim, because it does two things the native path
   * does not: the host owns the roster (so a member raised outside this adapter is still
   * visible), and delivery is adjacency-checked between peers. A composition that already runs
   * it must not regress to something worse.
   * @returns the executor.
   */
  function officialTeamExecutor(): DshTeamExecutor {
    return {
      kind: "official",
      reason: "official: the native seams are unavailable, so the mounted Agent Teams service executes the team",
      providers: () => [],
      /** Raise one member through the official service, in that service's own vocabulary. */
      async spawn(caller: unknown, request: DshTeamSpawnRequest): Promise<DshTeamSpawnResult> {
        /** The Agent Teams service, or a throw naming the action that could not happen. */
        const teams = requireService("agentTeams", `cannot raise team member "${request.name}"`)
        if (typeof teams.spawnTeammate !== "function") {
          throw new Error("mpd-dsh-adapter: the Agent Teams service exposes no spawnTeammate() — cannot raise a team member")
        }
        /** The host's spawn answer, whose id is read from whichever field this version fills. */
        const spawned: any = await teams.spawnTeammate.call(teams, caller, {
          name: request.name,
          description: request.description === "" ? request.name : request.description,
          prompt: request.prompt,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        })
        /** The handle, read the same way the tool row reads it. */
        const handle = String(spawned?.id ?? spawned?.sessionId ?? spawned?.member?.id ?? "")
        if (handle === "") throw new Error(`mpd-dsh-adapter: the official backend raised "${request.name}" but reported no id`)
        officialMembers.set(handle, { teamId: request.teamId, memberId: request.memberId, name: request.name })
        return { handle, executor: "official" }
      },
      /** Deliver one message through the official service, which adjacency-checks the pair. */
      async send(caller: unknown, handle: string, content: string, signal?: AbortSignal): Promise<void> {
        /** The Agent Teams service, or a throw naming the action that could not happen. */
        const teams = requireService("agentTeams", `cannot deliver a message to team member "${handle}"`)
        if (typeof teams.sendMessage !== "function") {
          throw new Error("mpd-dsh-adapter: the Agent Teams service exposes no sendMessage() — cannot deliver to a team member")
        }
        await teams.sendMessage.call(teams, caller, { target: handle, content: textBlock(content), ...(signal === undefined ? {} : { signal }) })
      },
      /** Interrupt one member; this backend addresses it by NAME, which is why the handle is kept. */
      async interrupt(caller: unknown, handle: string): Promise<void> {
        /** The Agent Teams service, or a throw naming the action that could not happen. */
        const teams = requireService("agentTeams", `cannot interrupt team member "${handle}"`)
        if (typeof teams.interrupt !== "function") {
          throw new Error("mpd-dsh-adapter: the Agent Teams service exposes no interrupt() — cannot interrupt a team member")
        }
        // This backend addresses a member by NAME, which is why the handle was recorded with one.
        /** The recorded member name, or the handle itself when this adapter did not raise it. */
        const target = officialMembers.get(handle)?.name ?? handle
        teams.interrupt.call(teams, caller, target)
      },
      /** Ask the HOST for the identity, so a member raised by another row is still identified. */
      membership: (agent: unknown): DshTeamMembership | undefined => {
        // The host owns this answer, so it is asked rather than reconstructed: a member raised by
        // ANOTHER row (the official tool plugin's own `spawn_teammate`) is still identified.
        /** The Agent Teams service, or undefined when it is not mounted. */
        const teams = service("agentTeams")
        /** The identity read, probed before it is called with the service as receiver. */
        const tryMembership = teams?.tryMembership
        if (typeof tryMembership !== "function") return undefined
        try {
          /** The host's raw answer. */
          const membership: any = tryMembership.call(teams, agent)
          if (membership === undefined || membership === null) return undefined
          /** The host's role, accepted only when it is one of the two declared values. */
          const role = membership.role
          if (role !== "lead" && role !== "teammate") return undefined
          return { teamId: String(membership.id ?? ""), role, name: String(membership.name ?? "") }
        } catch {
          // A stale identity or a non-Team subagent is a normal negative: this is a FILTER.
          return undefined
        }
      },
      members: () => [...officialMembers.entries()].map(([handle, entry]) => ({ handle, teamId: entry.teamId, memberId: entry.memberId, name: entry.name })),
    }
  }

  // ── goal plane helpers ────────────────────────────────────────────────────
  //
  // The goal DOMAIN (its state machine, its authorisation) is the harness's. These
  // helpers only find the right registry and normalize what comes back.

  /**
   * The tool registry inside ONE agent's own scope, when that scope exposes one.
   *
   * The agent's scope is the view that resolves PRESET-plane rows (the goal trio lives
   * there in an mpd session); the host-plane registry is a different view and may not
   * carry them at all. All-or-nothing, contained: a throwing getter is a miss.
   * @param agent - the live Agent, or anything that arrived.
   * @returns the registry, or undefined when this agent exposes none.
   */
  function scopedToolRegistry(agent: unknown): any {
    /** The agent's own scope, or undefined when it does not expose every member. */
    const scope = scopeOfAgentContext(agent)
    if (scope === undefined) return undefined
    try {
      /** That scope context's own `tools`, probed for the one method execution needs. */
      const tools = (scope.context as { tools?: unknown } | undefined)?.tools
      return typeof (tools as { execute?: unknown } | undefined)?.execute === "function" ? tools : undefined
    } catch {
      return undefined
    }
  }

  /**
   * Whether one tool name resolves at the HOST plane or inside any live agent's scope.
   * @param name - the registered tool name to look for.
   * @returns true when some reachable registry answers with a definition.
   */
  function toolReachable(name: string): boolean {
    try {
      /** The host-plane registry's own view of this name. */
      const hostView = service("tools") as { get?: (toolName: string) => unknown } | undefined
      if (typeof hostView?.get === "function" && hostView.get(name) !== undefined) return true
    } catch { /* fall through to the per-agent scopes */ }
    return liveAgents().some((candidate) => {
      /** That agent's own scoped registry, when it exposes one. */
      const scoped = scopedToolRegistry(candidate)
      if (scoped === undefined) return false
      try {
        return scoped.get(name) !== undefined
      } catch {
        return false
      }
    })
  }

  /**
   * Project one raw harness tool result onto {@link DshToolCallResult}.
   * @param raw - whatever the registry's `execute()` resolved with.
   * @returns the normalized result; an error result carries the harness's own message.
   */
  function projectToolResult(raw: unknown): DshToolCallResult {
    /** The harness result viewed as the loose record it is at that boundary. */
    const record = raw as DshPostResult | undefined
    if (record?.isError === true) {
      /** The error the tool reported, read for its message. */
      const error = record.error
      return { ok: false, isError: true, error: (error as { message?: unknown } | undefined)?.message ?? error ?? "tool error", raw }
    }
    return { ok: true, isError: false, value: record?.value, raw }
  }

  /**
   * Execute ONE tool for ONE agent, preferring that agent's own scoped registry.
   *
   * The order matters and is the whole reason this helper exists: an agent-scoped row's
   * tools (the goal trio) resolve in `agent.ctx.tools`, and a host-plane registry would
   * answer "unknown tool" for them even though the model can call them.
   * @param input - the tool name, arguments, the calling agent and the call's call id/signal/timeout.
   * @returns the projected result plus which registry answered.
   */
  async function executeToolForAgent(input: {
    name: string
    arguments?: unknown
    agent?: unknown
    callId?: string
    signal?: AbortSignal
    timeoutMs?: number
  }): Promise<{ result: DshToolCallResult; via: "agent-scope" | "host-plane" }> {
    /** A traceability id for this call, minted when the caller supplied none. */
    const callId = input.callId ?? "mpd-" + Math.random().toString(36).slice(2, 10)
    /** The cancellation this call runs under, defaulted to a per-call timeout. */
    const signal = input.signal ?? timeoutSignal(input.timeoutMs ?? defaultTimeoutMs)
    /** The agent's own scoped registry, when it exposes one. */
    const scoped = input.agent === undefined ? undefined : scopedToolRegistry(input.agent)
    if (scoped !== undefined) {
      try {
        /** The harness's own result, from the agent-scoped registry. */
        const raw = await scoped.execute({
          name: input.name,
          arguments: input.arguments ?? {},
          callId,
          ...(signal === undefined ? {} : { signal }),
          ...(input.agent === undefined ? {} : { agent: input.agent }),
        })
        return { result: projectToolResult(raw), via: "agent-scope" }
      } catch (error) {
        // A scoped registry that throws is NOT retried at the host plane: the throw is this
        // call's outcome, and a silent second attempt could run the same mutation twice.
        return { result: { ok: false, isError: true, error: errorMessage(error) }, via: "agent-scope" }
      }
    }
    /** The host-plane path: the same normalization `executeTool` exposes. */
    const result = await adapter.executeTool({
      name: input.name,
      arguments: input.arguments ?? {},
      callId,
      ...(signal === undefined ? {} : { signal }),
      ...(input.agent === undefined ? {} : { agent: input.agent }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    })
    return { result, via: "host-plane" }
  }

  /** The frozen adapter surface, assembled once from the primitives above. */
  const adapter: DshAdapter = {
    /** Probe every seam once and report one boolean per contract; see {@link DshCapabilities}. */
    capabilities(): DshCapabilities {
      /** The tools registry snapshot. */
      const tools = service("tools")
      /** The subagent service snapshot. */
      const subagents = service("subagents")
      /** The skills registry snapshot. */
      const skills = service("skills")
      /** The agent-preset registry snapshot. */
      const presets = service("agentPresets")
      /** The command registry snapshot. */
      const commands = service("commands")
      /** The live-session registry snapshot. */
      const agents = service("agents")
      /** The host-plane compaction engine snapshot, never used to drive a member. */
      const compaction = service("compaction")
      /** The llm service snapshot, read for the catalog and for the two thin reads. */
      const llmService = service("llm")
      /** The host-plane system-prompt registry snapshot. */
      const systemPrompt = service("systemPrompt")
      /** The official Agent Teams service snapshot. */
      const agentTeams = service("agentTeams")
      /** The host-plane goal service snapshot, read for the durable goal read. */
      const goalService = service("goals")
      /** One live Agent, the sample every live-registry flag is probed against. */
      const sample = liveAgents()[0]
      /** That Agent's own scoped context, probed for the per-agent flags. */
      const sampleScoped = sample?.ctx
      /** Whether the sampled Agent's own scope exposes a compaction engine. */
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
        // The same predicate `teamExecutor()` uses, so a caller that pre-flights cannot disagree
        // with the backend it is about to get.
        teamExecutorNative: typeof subagents?.startContinuable === "function",
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
        // ── the goal plane (one flag per HALF, because a composition can carry the
        // durable service without the preset-plane tools, and the read and the write
        // then degrade differently) ──────────────────────────────────────────────
        goals: typeof goalService?.get === "function",
        goalTools: GOAL_TOOL_NAMES.every((goalToolName) => toolReachable(goalToolName)),
      }
    },

    // ── workspace plane ─────────────────────────────────────────────────────
    workspaceRoot,
    workspaceRootsAll,
    rowLog,

    // ── live-session plane ──────────────────────────────────────────────────
    liveAgents,
    liveAgent,
    compactionEngineForAgent,
    onEvent,
    llmCatalog,

    // ── goal plane (AGENTS.md §6: the ONE place `ctx.goals` and the goal tools are named) ──
    goalState(agent: unknown): DshGoalSnapshot | null | undefined {
      // The service READ is deliberate and safe: reading a goal mutates nothing, and the
      // service's own guard (a non-live agent makes `get` throw) is preserved as "cannot
      // tell" rather than being papered over with a fabricated empty answer.
      /** The host-plane goal service, absent in a composition without `@deepseek-ai/dsh-goal`. */
      const goals = service("goals")
      if (goals === undefined || typeof goals.get !== "function") return undefined
      try {
        /** The service's own view for this agent, or undefined when no goal is current. */
        const view = goals.get(agent)
        return goalSnapshotOf(view) ?? null
      } catch {
        return undefined
      }
    },

    /** Drive one goal operation through the harness goal tools; a refusal is returned, never thrown. */
    async goalControl(input: DshGoalControlInput): Promise<DshGoalControlResult> {
      if (input === null || typeof input !== "object" || typeof input.action !== "string") {
        return { ok: false, isError: true, error: "goalControl requires an action" }
      }
      if (input.agent === undefined) return { ok: false, isError: true, error: "goal tools require a calling agent" }
      // A mutation names an EXACT revision, so a ref the caller did not supply is read
      // first — through the tool, which reports the same numbers the model would see.
      /** The ref this call will mutate, resolved below for every non-create action. */
      let goalId = input.goalId
      /** The revision half of that ref. */
      let revision = input.revision
      /** Set for the non-create actions, which all go through `update_goal`. */
      const needsRef = input.action !== "create" && input.action !== "read"
      if (needsRef && (goalId === undefined || revision === undefined)) {
        /** The current goal, read on demand so a caller may pass only the action. */
        const current = await executeToolForAgent({ name: "get_goal", agent: input.agent, callId: input.callId, signal: input.signal, timeoutMs: input.timeoutMs })
        if (!current.result.ok) return { ok: false, isError: true, error: current.result.error, via: current.via, raw: current.result.raw }
        /** The tool's own view of the current goal, or null when the session has none. */
        const read = goalValueOf(current.result.value)
        if (read.goal === null) return { ok: false, isError: true, error: "no current goal", via: current.via, raw: current.result.raw }
        goalId = goalId ?? read.goal.id
        revision = revision ?? read.goal.revision
      }
      // Argument names are the HARNESS tool contract (`max_goal_rounds`, `goal_id`,
      // `blocked_reason`); keeping them verbatim is what lets a refusal read the same as
      // it would for the model.
      /** The tool to call for this action. */
      const toolName = input.action === "read" ? "get_goal" : input.action === "create" ? "create_goal" : "update_goal"
      /** The tool arguments for this action. */
      const toolArguments: Record<string, unknown> = input.action === "read"
        ? {}
        : input.action === "create"
          ? { objective: input.objective, ...(input.maxGoalRounds === undefined ? {} : { max_goal_rounds: input.maxGoalRounds }) }
          : {
              goal_id: goalId,
              revision,
              action: input.action,
              ...(input.objective === undefined ? {} : { objective: input.objective }),
              ...(input.maxGoalRounds === undefined ? {} : { max_goal_rounds: input.maxGoalRounds }),
              ...(input.blockedReason === undefined ? {} : { blocked_reason: input.blockedReason }),
            }
      if (input.action === "create" && (typeof input.objective !== "string" || input.objective.trim() === "")) {
        return { ok: false, isError: true, error: "goalControl create requires a non-empty objective" }
      }
      if (needsRef && (goalId === undefined || revision === undefined)) {
        return { ok: false, isError: true, error: "goalControl " + input.action + " requires an exact goal id and revision" }
      }
      /** The harness's answer for this call and the registry that produced it. */
      const call = await executeToolForAgent({
        name: toolName,
        arguments: toolArguments,
        agent: input.agent,
        callId: input.callId,
        signal: input.signal,
        timeoutMs: input.timeoutMs,
      })
      if (!call.result.ok) return { ok: false, isError: call.result.isError, error: call.result.error, via: call.via, raw: call.result.raw }
      /** The goal the tool reported after the call (`null` when the session has none). */
      const value = goalValueOf(call.result.value)
      return {
        ok: true,
        isError: false,
        goal: value.goal,
        ...(value.activation === undefined ? {} : { activation: value.activation }),
        via: call.via,
        raw: call.result.raw,
      }
    },

    // ── llm plane: the two thin reads the agent-teams bridge forwards ───────
    // Both are THIN and both THROW synchronously on a missing seam: the raw
    // `ctx.llm.listModels(provider)` / `ctx.llm.resolveCallConfig(config, signal)`
    // expression a caller would otherwise run throws the same way, so a caller's
    // try/catch keeps its exact meaning.
    llmListModels(provider: string): Promise<unknown> {
      /** The llm service, or a THROW naming the provider whose models were requested. */
      const llm = requireService("llm", "cannot list the models of provider \"" + provider + "\"")
      if (typeof llm.listModels !== "function") throw new Error("mpd-dsh-adapter: the harness llm service exposes no listModels()")
      return llm.listModels.call(llm, provider)
    },

    /** Forward one call-config resolution to the harness llm service; THROWS when the seam is absent. */
    llmResolveCallConfig(config: unknown, signal?: AbortSignal): Promise<unknown> {
      /** The llm service, or a THROW explaining that no call config could be resolved. */
      const llm = requireService("llm", "cannot resolve a call config")
      if (typeof llm.resolveCallConfig !== "function") throw new Error("mpd-dsh-adapter: the harness llm service exposes no resolveCallConfig()")
      return llm.resolveCallConfig.call(llm, config, signal)
    },

    // ── tool plane ──────────────────────────────────────────────────────────
    registerHostTool(definition: unknown): () => void {
      /** The tools registry, or a THROW naming the definition that could not be registered. */
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

    /** Register one NORMALIZED tool definition, filling in the schema and render defaults. */
    registerTool(definition: DshToolDef): () => void {
      /** The tools registry, or a THROW naming the tool that could not be registered. */
      const tools = requireService("tools", "cannot register tool \"" + String(definition?.name) + "\"")
      if (typeof tools.register !== "function") throw new Error("mpd-dsh-adapter: the harness tools service exposes no register()")
      /** The definition's declared output contract, or an empty object to fill in below. */
      const output = definition.output ?? {}
      /** The caller's renderer, or the text-block fallback the adapter supplies. */
      const render = typeof output.render === "function" ? output.render : (_args: unknown, value: unknown) => textBlock(value)
      /** The caller's result schema, or the shared object-rooted default. */
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

    /** Register several normalized definitions; the disposer removes every one of them. */
    registerTools(definitions: DshToolDef[]): () => void {
      /** One registry disposer per definition, invoked together below. */
      const disposers = definitions.map((definition) => adapter.registerTool(definition))
      return () => { for (const dispose of disposers) dispose() }
    },

    // ── command plane ───────────────────────────────────────────────────────
    registerCommand(definition: DshCommandDef): () => void {
      /** The command registry, or undefined when this composition has none. */
      const commands = service("commands")
      // Missing optional seam: a no-op disposer, never a throw (the caller degrades on
      // capabilities().commandsRegister instead of being taken down at apply time).
      if (commands === undefined || commands === null || typeof commands.register !== "function") return noop
      /** The registry's own disposer, or a value degraded to a no-op below. */
      const registered = commands.register({
        name: definition?.name,
        description: definition?.description,
        ...(definition?.input === undefined ? {} : { input: definition.input }),
        handler: (invocation: DshCommandInvocation) => {
          /** The invocation, defaulted so a handler always receives a rawInput. */
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

    /** Contribute one section to the HOST-plane prompt; THROWS when the seam is absent. */
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

    /** Install a tool guard whose exec argument is always an object. */
    guardTool(guard: (exec: DshToolExec) => string | undefined): () => void {
      /** The tools registry, or a THROW explaining that no guard could be installed. */
      const tools = requireService("tools", "cannot install a tool guard")
      if (typeof tools.guard !== "function") throw new Error("mpd-dsh-adapter: the harness tools service exposes no guard()")
      return tools.guard((exec: DshToolExec) => guard(exec ?? {}))
    },

    /** Observe the pre-execute gate without the ability to alter or veto it. */
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
        /** The downstream gate decision, returned verbatim so the hook stays observe-only. */
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

    /** Decide the post-execute waterfall, owning the `next()` call a listener would otherwise make. */
    onPostToolExecute(
      listener: (exec: DshToolExec, result: DshPostResult, downstream: DshPostDecision) => DshPostDecision | undefined | Promise<DshPostDecision | undefined>,
    ): () => void {
      if (typeof ctx?.on !== "function") return noop
      return ctx.on("tools/post-execute", async (exec: DshToolExec, result: DshPostResult, next: () => Promise<DshPostDecision>) => {
        // The harness waterfall requires the listener to run `next()`; this
        // adapter owns that call so a listener only decides what to change.
        const downstream: DshPostDecision = typeof next === "function" ? (await next()) ?? { kind: "accept" } : { kind: "accept" }
        /** The listener's decision, or the downstream one when it returned nothing. */
        const decided = await listener(exec ?? {}, result ?? {}, downstream)
        return decided ?? downstream
      })
    },

    /** Observe and amend the `agent/pre-step` waterfall at the host-plane registration site. */
    onAgentPreStep(
      listener: (payload: DshAgentPreStep, decision: DshPreStepDecision) => DshPreStepDecision | undefined | Promise<DshPreStepDecision | undefined>,
    ): () => void {
      if (typeof ctx?.on !== "function") return noop
      return ctx.on("agent/pre-step", preStepWrapper(listener))
    },

    /** Register the pre-step listener inside ONE agent's own scope; THROWS when that scope exposes no `on`. */
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
      /** The binding subscription's disposer, degraded to a no-op when the bus returned none. */
      const off = ctx.on("internal/service", (name: unknown) => {
        try {
          if (typeof name === "string" && names.includes(name)) callback(name)
        } catch {
          /* a throwing listener must not break the runtime's own binding dispatch */
        }
      })
      return typeof off === "function" ? off : () => {}
    },

    /** Whether a tool of this name is registered; false when the registry cannot answer. */
    hasTool(toolName: string): boolean {
      /** The tools registry, or undefined when this composition has none. */
      const tools = service("tools")
      if (typeof tools?.get !== "function") return false
      try { return tools.get(toolName) !== undefined } catch { return false }
    },

    /** Structural view of the tool runtime for internal tool calls. */
    /** Structural view of the tool runtime; the interface member's declared return type is reused. */
    toolRuntime(): ReturnType<DshAdapter["toolRuntime"]> {
      /** The tools registry, or undefined when this composition has none. */
      const tools = service("tools")
      return {
        get: (toolName: string) => (typeof tools?.get === "function" ? tools.get(toolName) : undefined),
        execute: (input: { name: string; arguments?: unknown; callId?: string; signal?: AbortSignal; agent?: unknown }) =>
          adapter.executeTool({ ...input, timeoutMs: defaultTimeoutMs }).then((result) => result.raw),
      }
    },

    /** Call one registered tool in-process and normalize its result; a missing runtime is an error result, not a throw. */
    async executeTool(input: Parameters<DshAdapter["executeTool"]>[0]): Promise<DshToolCallResult> {
      /** The tools registry, or undefined when this composition has none. */
      const tools = service("tools")
      if (tools === undefined || typeof tools.execute !== "function") {
        return { ok: false, isError: true, error: "the harness tool runtime has no execute()" }
      }
      /** The caller's call id, or a fresh one so every call stays traceable. */
      const callId = input.callId ?? "mpd-" + Math.random().toString(36).slice(2, 10)
      /** The caller's signal, or a per-call timeout so no tool can hang a turn. */
      const signal = input.signal ?? timeoutSignal(input.timeoutMs ?? defaultTimeoutMs)
      try {
        /** The harness's own result object, projected just below. */
        const raw = await tools.execute({
          name: input.name,
          arguments: input.arguments ?? {},
          callId,
          ...(signal === undefined ? {} : { signal }),
          // The calling agent rides the execution only when the caller supplied one:
          // absent stays absent, so no existing call site changes meaning.
          ...(input.agent === undefined ? {} : { agent: input.agent }),
        })
        /** The normalized outcome: the shared projection keeps one error contract for both paths. */
        return projectToolResult(raw)
      } catch (error) {
        return { ok: false, isError: true, error: errorMessage(error) }
      }
    },

    // ── agent plane ─────────────────────────────────────────────────────────
    async spawnAgent(spec: DshSpawnSpec): Promise<DshSpawnResult> {
      /** The subagent service, or a THROW naming the child that could not be spawned. */
      const subagents = requireService("subagents", "cannot spawn subagent \"" + String(spec?.label) + "\"")
      if (typeof subagents.start !== "function") throw new Error("mpd-dsh-adapter: the harness subagent service exposes no start()")
      /** The flat route merged with `agentOptions`, whose keys win on a collision. */
      const route = {
        ...(spec.provider === undefined ? {} : { provider: spec.provider }),
        ...(spec.model === undefined ? {} : { model: spec.model }),
        ...(spec.agentOptions ?? {}),
      }
      /** The host's run handle, whose `result` is awaited below. */
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

    /** Look one subagent provider up by name; undefined when the service cannot answer. */
    subagentProvider(name: string): unknown {
      /** The subagent service, or undefined when it is absent. */
      const subagents = service("subagents")
      /** The catalogue read, probed before it is called with the service as receiver. */
      const getProvider = (subagents as { getProvider?: unknown } | undefined)?.getProvider
      // Degrade: `undefined` — the plugin's own capability check throws its own
      // actionable message, so this seam must not invent one.
      if (typeof getProvider !== "function") return undefined
      return (getProvider as (name: string) => unknown).call(subagents, name)
    },

    /** The registered provider names in insertion order; empty when the service cannot answer. */
    subagentProviders(): string[] {
      /** The subagent service, or undefined when it is absent. */
      const subagents = service("subagents")
      /** The catalogue read, probed before it is called with the service as receiver. */
      const list = (subagents as { list?: unknown } | undefined)?.list
      if (typeof list !== "function") return []
      /** The host's answer, accepted only when it is an array of strings. */
      const names: unknown = (list as () => unknown).call(subagents)
      // The host answers provider NAMES in insertion order (`list(): string[]`); a stub
      // that answers something else degrades to the declared type rather than leaking
      // values the frozen `string[]` contract cannot carry.
      return Array.isArray(names) ? names.filter((entry): entry is string => typeof entry === "string") : []
    },

    /** Start a durable continuable child; THROWS synchronously when the seam is absent. */
    startContinuableAgent(spec: unknown): Promise<unknown> {
      // Synchronous THROW on a missing seam (parity with the raw expression a caller
      // would run); the service's own promise is forwarded UNTOUCHED, so its rejections
      // stay rejections for the caller.
      const subagents = requireService("subagents", "cannot start a continuable agent")
      if (typeof subagents.startContinuable !== "function") throw new Error("mpd-dsh-adapter: the harness subagents service exposes no startContinuable()")
      return subagents.startContinuable.call(subagents, spec)
    },

    /** Register one subagent provider VERBATIM; THROWS when the seam is absent. */
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

    /** Interrupt one durable child session; THROWS when the seam is absent. */
    interruptAgent(targetSessionId: string, authority: unknown): void {
      /** The subagent service, or a THROW naming the session that could not be interrupted. */
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
    /**
     * The active team executor. A FACTORY, not a field: the choice is re-made per call so a
     * service that becomes ACTIVE later is picked up rather than frozen out, and so the
     * native registry below is the only state this seam keeps.
     */
    teamExecutor(): DshTeamExecutor {
      /** The operator's explicit override, when one was set. */
      const override = ((): string | undefined => {
        try {
          /** The env value, trimmed; the harness also exposes it through the row config. */
          const raw = typeof process !== "undefined" && process.env ? process.env.MPD_DSH_TEAM_EXECUTOR : undefined
          return typeof raw === "string" && raw.trim() !== "" ? raw.trim().toLowerCase() : undefined
        } catch {
          return undefined
        }
      })()
      // Read with the SAME expression `capabilities()` uses, rather than through it: the
      // capabilities object is built inside the adapter literal below, and this factory must
      // stay callable from every method without depending on construction order.
      /** Whether the native path can raise a durable child at all. */
      const nativeReady = typeof service("subagents")?.startContinuable === "function"
      /** Whether the official service is mounted. */
      const officialReady = service("agentTeams") !== undefined
      /** The chosen backend, honouring a valid override and falling through when it cannot serve. */
      const chosen: DshTeamExecutorKind = override === "official" && officialReady ? "official"
        : override === "native" && nativeReady ? "native"
          : nativeReady ? "native"
            : officialReady ? "official"
              : "native"
      if (chosen === "official") return officialTeamExecutor()
      return nativeTeamExecutor(
        nativeReady
          ? (override === undefined ? "native: the default backend — it needs nothing from the official plugin" : "native: chosen by MPD_DSH_TEAM_EXECUTOR=native")
          : "native UNAVAILABLE: the harness subagents service exposes no startContinuable(), and no team service is mounted either — every team call will refuse",
        nativeReady,
      )
    },

    /** Hand out the raw Agent Teams service; the contained probe never throws. */
    teamService(): unknown | undefined {
      // The contained probe (never a throw): `undefined` is the whole degrade contract,
      // and `capabilities().team` is the pre-flight check a consumer reads.
      const teams = service("agentTeams")
      return teams === undefined || teams === null ? undefined : teams
    },

    /** One Agent's team identity, or undefined; this method NEVER throws. */
    teamMembership(agent: unknown): DshTeamMembership | undefined {
      /** The team service, or undefined when this composition has no team row. */
      const teams = service("agentTeams")
      /** The identity read, probed before it is called with the service as receiver. */
      const tryMembership = teams?.tryMembership
      // NEVER throws (the frozen contract of this method): a missing seam is a miss.
      if (typeof tryMembership !== "function") return undefined
      /** The host's raw membership answer, validated field by field below. */
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
      /** The host's role, accepted only when it is one of the two declared values. */
      const role = membership.role
      // Anything that is not one of the two declared roles is a MISS: the frozen return
      // type has no third value to report, and inventing `teammate` would lie.
      if (role !== "lead" && role !== "teammate") return undefined
      // `root` (the Lead Agent the host carries on the membership) is deliberately NOT
      // projected: a consumer resolves the Lead through `liveAgent`/`liveAgents`, which
      // is the registry of record — never a handle captured in a stale row.
      return { teamId: String(membership.id ?? ""), role, name: String(membership.name ?? "") }
    },

    /** The roster visible to one member; THROWS when the service or `listMembers` is absent. */
    teamListMembers(agent: unknown): DshTeamMemberView[] {
      /** The team service, or a THROW naming the roster that could not be listed. */
      const teams = requireService("agentTeams", "cannot list the team roster of an agent")
      if (typeof teams.listMembers !== "function") throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no listMembers()")
      /** The host's raw roster, accepted only when it is an array. */
      const rows = teams.listMembers.call(teams, agent)
      return Array.isArray(rows) ? rows.map(teamMemberView) : []
    },

    /** The board visible to one member; THROWS when the service or `listTasks` is absent. */
    teamListTasks(agent: unknown): DshTeamTaskView[] {
      /** The team service, or a THROW naming the board that could not be listed. */
      const teams = requireService("agentTeams", "cannot list the shared task board of an agent")
      if (typeof teams.listTasks !== "function") throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no listTasks()")
      /** The host's raw board, accepted only when it is an array. */
      const rows = teams.listTasks.call(teams, agent)
      return Array.isArray(rows) ? rows.map(teamTaskView) : []
    },

    /** Create one pending task, forwarding the caller and the request by identity. */
    async teamCreateTask(caller: unknown, request: DshTeamCreateTaskRequest): Promise<DshTeamTaskView> {
      /** The team service, or a THROW naming the task that could not be created. */
      const teams = requireService("agentTeams", "cannot create team task \"" + String(request?.subject) + "\"")
      if (typeof teams.createTask !== "function") throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no createTask()")
      return teamTaskView(await teams.createTask.call(teams, caller, request))
    },

    /** Read one task by id, tombstone included; the host's own throw propagates verbatim. */
    teamGetTask(caller: unknown, id: string): DshTeamTaskView {
      /** The team service, or a THROW naming the task that could not be read. */
      const teams = requireService("agentTeams", "cannot read team task \"" + String(id) + "\"")
      if (typeof teams.getTask !== "function") throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no getTask()")
      // A host throw (an unknown id, a revoked authority) propagates VERBATIM: this
      // adapter never invents a task view and never masks a real rejection.
      return teamTaskView(teams.getTask.call(teams, caller, id))
    },

    /** Apply one compare-and-set transition, forwarding the caller and the request by identity. */
    async teamUpdateTask(caller: unknown, request: DshTeamUpdateTaskRequest): Promise<DshTeamTaskView> {
      /** The team service, or a THROW naming the task that could not be updated. */
      const teams = requireService("agentTeams", "cannot update team task \"" + String(request?.taskId) + "\"")
      if (typeof teams.updateTask !== "function") throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no updateTask()")
      return teamTaskView(await teams.updateTask.call(teams, caller, request))
    },

    /** Queue one durable peer message; THROWS when the mailbox seam is absent. */
    async teamSendMessage(caller: unknown, request: DshTeamSendMessageRequest): Promise<DshTeamSendMessageResult> {
      /** The team service, or a THROW naming the message target. */
      const teams = requireService("agentTeams", "cannot send a team message to \"" + String(request?.target) + "\"")
      if (typeof teams.sendMessage !== "function") throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no sendMessage()")
      /** The host's raw send answer, projected onto the two declared fields. */
      const result: any = await teams.sendMessage.call(teams, caller, request)
      return {
        messageId: String(result?.messageId ?? ""),
        // The host declares exactly these two; anything else is read as the conservative
        // `accepted` (the message WAS queued durably — `queued` only says immediate
        // delivery did not happen).
        status: result?.status === "queued" ? "queued" : "accepted",
      }
    },

    /** Spawn one named continuable teammate, forwarding the request by identity. */
    async teamSpawnTeammate(caller: unknown, request: DshTeamSpawnTeammateRequest): Promise<DshTeamSpawnTeammateResult> {
      /** The team service, or a THROW naming the member that could not be spawned. */
      const teams = requireService("agentTeams", "cannot spawn team member \"" + String(request?.name) + "\"")
      if (typeof teams.spawnTeammate !== "function") throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no spawnTeammate()")
      /** The host's raw spawn answer, whose member row is projected below. */
      const result: any = await teams.spawnTeammate.call(teams, caller, request)
      return { member: teamMemberView(result?.member) }
    },

    /** Interrupt one live teammate turn, answering the status sampled before cancellation. */
    teamInterrupt(caller: unknown, targetName: string): DshTeamInterruptResult {
      /** The team service, or a THROW naming the member that could not be interrupted. */
      const teams = requireService("agentTeams", "cannot interrupt team member \"" + String(targetName) + "\"")
      if (typeof teams.interrupt !== "function") throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no interrupt()")
      /** The host's raw interrupt answer, carrying the pre-cancellation status. */
      const result: any = teams.interrupt.call(teams, caller, targetName)
      // The host answers the status sampled BEFORE cancellation; `inactive` is the
      // conservative reading of anything it does not declare.
      return { previousStatus: result?.previousStatus === "running" ? "running" : "inactive" }
    },

    /** Wait for the next team-domain or member-status change; both arguments are forwarded verbatim. */
    async teamWaitForChange(caller: unknown, timeoutMs: number, signal?: AbortSignal): Promise<DshTeamWaitResult> {
      /** The team service, or a THROW explaining that no wait could be started. */
      const teams = requireService("agentTeams", "cannot wait for team activity")
      if (typeof teams.waitForChange !== "function") throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no waitForChange()")
      // Both arguments verbatim (the host validates its own 10s..1h bound and rejects
      // outside it); the promise is forwarded untouched.
      const result: any = await teams.waitForChange.call(teams, caller, timeoutMs, signal)
      return { timedOut: result?.timedOut === true }
    },

    /** Fold the live registry into one entry per Lead team; never throws, empty when nothing is reportable. */
    teamLiveTeams(): DshTeamView[] {
      /** The team service, or undefined when this composition has no team row. */
      const teams = service("agentTeams")
      // [] when the team service or the agent registry is absent: a readout has nothing
      // to report, and a route must not be taken down by a missing optional seam.
      if (teams === undefined || teams === null || typeof teams.tryMembership !== "function") return []
      if (typeof service("agents")?.list !== "function") return []
      /** One entry per live Lead, in registry order. */
      const views: DshTeamView[] = []
      for (const agent of liveAgents()) {
        /** The Agent's raw membership answer, filtered to Lead rows below. */
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
      /** Register one skill provider VERBATIM; THROWS when the skills service is absent. */
      const skills = requireService("skills", "cannot register a skill provider")
      if (typeof skills.registerProvider !== "function") throw new Error("mpd-dsh-adapter: the harness skills service exposes no registerProvider()")
      return skills.registerProvider(provider)
    },

    /** List the skills visible from `options.cwd`; THROWS when the registry exposes no list(). */
    async listSkills(options: { cwd?: string } = {}): Promise<DshSkillSummary[]> {
      /** The skills registry, or a THROW explaining that skills could not be listed. */
      const skills = requireService("skills", "cannot list skills")
      if (typeof skills.list !== "function") throw new Error("mpd-dsh-adapter: the harness skills service exposes no list()")
      return (await skills.list(options)) ?? []
    },

    /** Load one skill by name; THROWS when the registry exposes no get(). */
    async loadSkill(skillName: string, options: { cwd?: string } = {}): Promise<unknown> {
      /** The skills registry, or a THROW naming the skill that could not be loaded. */
      const skills = requireService("skills", "cannot load skill \"" + skillName + "\"")
      if (typeof skills.get !== "function") throw new Error("mpd-dsh-adapter: the harness skills service exposes no get()")
      return skills.get(skillName, options)
    },

    // ── preset plane ────────────────────────────────────────────────────────
    async resolvePreset(presetId: string): Promise<DshPresetInfo> {
      /** The preset registry, or a THROW naming the preset that could not be resolved. */
      const presets = requireService("agentPresets", "cannot resolve preset \"" + presetId + "\"")
      if (typeof presets.resolve !== "function") throw new Error("mpd-dsh-adapter: the harness agentPresets service exposes no resolve()")
      /** The host's resolved preset, projected onto the declared fields below. */
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
      /** The settings service, preferring the instance a deferred inject proved over a root read. */
      const settings = settingsService()
      if (settings === undefined || settings === null) return undefined
      return {
        /** The namespace's resolved value, or undefined while it is not served. */
        get(): unknown {
          try {
            return typeof settings.get === "function" ? settings.get(namespace) : undefined
          } catch {
            return undefined
          }
        },
        /** The namespace descriptor, or undefined when the service cannot report one. */
        describe(): ReturnType<DshSettingsReader["describe"]> {
          try {
            if (typeof settings.describe !== "function") return undefined
            /** The service's raw descriptor list, validated as an array before it is searched. */
            const list = settings.describe() as Array<Record<string, unknown>>
            if (!Array.isArray(list)) return undefined
            /** This namespace's descriptor row, or undefined when the service does not know it. */
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

    /** Subscribe to one namespace's raw-document changes, coalescing the two host events per write. */
    onSettingsDocumentUpdated(
      namespace: string,
      listener: (revision: number | undefined, source: string | undefined) => void,
    ): () => void {
      // Both events fire synchronously inside ONE host write, document-updated FIRST,
      // so the change's source is only known after the tick: coalesce, then defer.
      let pendingRevision: number | undefined
      /** The source carried by `settings/updated`, known only after the document event fired. */
      let pendingSource: string | undefined
      /** Whether a change is waiting for the microtask flush. */
      let hasPending = false
      /** Whether the flush is already queued for this tick. */
      let scheduled = false
      /** Deliver the coalesced change once, then clear the pending state. */
      const flush = (): void => {
        scheduled = false
        if (!hasPending) return
        /** The revision captured for the listener, or undefined when the host declared none. */
        const revision = pendingRevision
        /** The change's source, undefined when the resolved value did not change. */
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
      /** The `settings/updated` subscription, which carries the change's source. */
      const offUpdated = adapter.onEvent("settings/updated", (ns: unknown, _next: unknown, _prev: unknown, from: unknown) => {
        if (String(ns) !== namespace) return undefined
        pendingSource = from === undefined ? undefined : String(from)
        return undefined
      })
      /** The `settings/document-updated` subscription, the flush trigger. */
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

    /** Run the callback once a settings provider is mounted, through the adapter's deferred inject. */
    whenSettingsAvailable(callback: () => void): void {
      if (typeof ctx?.inject !== "function") {
        // No deferred-inject seam: try once immediately rather than never. SAY SO: this path and
        // the deferred one fail with the SAME sentence downstream ("settings service is
        // unavailable"), and a reader cannot tell a race from a missing seam without this line.
        rowLogLine("mpd-dsh-adapter", "[mpd-dsh-adapter] no ctx.inject seam: the settings registration runs immediately (the settings provider may not be mounted yet)")
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
              rowLogLine("mpd-dsh-adapter", "[mpd-dsh-adapter] the settings inject fired but the SCOPED ctx yielded no settings service (property and get both empty) — the registration will fail as unavailable; this is the TUI-profile shape measured 2026-09-27")
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

    /** Register a namespace and report the outcome as a value, never as a throw. */
    settingsRegister(
      namespace: string,
      schema: unknown,
      options?: { base?: unknown; applies?: string },
    ): { ok: true } | { ok: false; error: string } {
      /** The settings service, which the caller may find absent or unable to register. */
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

    /** Apply write ops to a namespace this plugin does not register; conflicts are reported, never thrown. */
    async settingsMutate(
      namespace: string,
      ops: readonly { op: "set" | "unset"; path: readonly string[]; value?: unknown }[],
      expectedRevision?: number,
    ): Promise<DshSettingsMutateResult> {
      /** The settings service, or undefined when it cannot mutate. */
      const settings = settingsService()
      if (settings === undefined || settings === null || typeof settings.mutate !== "function") {
        return { ok: false, error: "settings service is unavailable" }
      }
      try {
        await settings.mutate(namespace, ops.map((op) => (op.op === "unset" ? { op: "unset", path: [...op.path] } : { op: "set", path: [...op.path], value: op.value })), expectedRevision)
        return { ok: true }
      } catch (error) {
        /** The error's name, read to recognize the host's revision conflict. */
        const name = String((error as { name?: unknown })?.name ?? "")
        /** Whether the failure was a revision conflict rather than a transport error. */
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

    /** Contribute one section to ONE agent's own prompt scope; THROWS when that scope exposes no section(). */
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

    /** Start an agent's next turn through `followup`, THROWING so a rejected submission stays loud. */
    startAgentTurn(agent: unknown, message: unknown): void {
      /** The agent's own turn seam, probed before it is called with the agent as receiver. */
      const followup = (agent as { followup?: unknown } | undefined)?.followup
      // THROWING on purpose (contract D9): the adopted plugin's own call site relies on
      // this throw inside its try/catch. `submitUserTurn` below stays the swallowing
      // boolean seam for callers that want one.
      if (typeof followup !== "function") throw new Error("mpd-dsh-adapter: the agent exposes no followup() — cannot start its next turn")
      ;(followup as (input: unknown) => unknown).call(agent, message)
    },

    /** Cancel an agent's turn or parked work, forwarding both arguments verbatim. */
    cancelAgentTurn(agent: unknown, cause: unknown, options?: unknown): void {
      /** The agent's own cancel seam, probed before it is called with the agent as receiver. */
      const cancel = (agent as { cancel?: unknown } | undefined)?.cancel
      if (typeof cancel !== "function") throw new Error("mpd-dsh-adapter: the agent exposes no cancel() — cannot cancel its turn")
      // Receiver-bound, both arguments verbatim; the agent's own error propagates.
      ;(cancel as (cause: unknown, options?: unknown) => unknown).call(agent, cause, options)
    },

    /** Steer an agent's nearest step, distinct from `followup`'s own new turn. */
    steerAgentTurn(agent: unknown, message: unknown): void {
      /** The agent's own steer seam, probed before it is called with the agent as receiver. */
      const steer = (agent as { steer?: unknown } | undefined)?.steer
      // Same THROWING discipline as startAgentTurn (contract D9): the adopted call sites
      // run inside their own try/catch and rely on the throw, so this seam must never
      // swallow a rejected steer into a boolean.
      if (typeof steer !== "function") throw new Error("mpd-dsh-adapter: the agent exposes no steer() — cannot steer its turn")
      ;(steer as (input: unknown) => unknown).call(agent, message)
    },

    /** Queue one message into an agent's inbox — the AGENT's `inject`, not cordis dependency injection. */
    injectAgentMessage(agent: unknown, message: unknown): void {
      // NOTE the two `inject` spellings: this is the AGENT's inject(message), not the
      // cordis ctx.inject(deps, callback) seam (which the facade passes through).
      const inject = (agent as { inject?: unknown } | undefined)?.inject
      if (typeof inject !== "function") throw new Error("mpd-dsh-adapter: the agent exposes no inject() — cannot queue a message for it")
      ;(inject as (input: unknown) => unknown).call(agent, message)
    },

    // ── turn plane ──────────────────────────────────────────────────────────
    submitUserTurn(agent: unknown, message: DshUserMessage): boolean {
      /** The agent's own turn seam; absent means the submission is reported as not delivered. */
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

/**
 * The mounted adapter when this composition provides one, else a row-private fallback.
 *
 * THE ONE RESOLUTION EVERY ROW USES. It replaces the expression each row used to carry
 * inline (`(typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined) ??
 * createDshAdapter(ctx)`, copy-pasted into sixteen rows) so the row-order contract and
 * the standalone-unit-test fallback are stated once.
 *
 * This is the EAGER read: the answer is sampled when the row's `apply` runs. A row that
 * needs the T-50 behaviour — re-probe on every use, so a transient "provider not ACTIVE
 * yet" miss is not locked in for the session — calls {@link createLazyDshAdapter}
 * instead.
 */
export function resolveDshAdapter(ctx: any): DshAdapter {
  /** The ctx's own `get`, captured so it is called with the ctx as its receiver. */
  const get = typeof ctx?.get === "function" ? ctx.get : undefined
  /** The mounted adapter when one is provided and ACTIVE, else undefined. */
  const mounted = get === undefined ? undefined : get.call(ctx, SERVICE_NAME)
  return (mounted as DshAdapter | undefined) ?? createDshAdapter(ctx)
}

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

/** Which of the three adapter resolutions a call is using; see the three constants above. */
export type AdapterIdentity = typeof ADAPTER_IDENTITY_MOUNTED | typeof ADAPTER_IDENTITY_PENDING | typeof ADAPTER_IDENTITY_FALLBACK

/** Options for {@link createLazyDshAdapter}: the row label and an optional warning sink. */
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
  /** The ctx's own `get`, probed before it is called with the ctx as receiver. */
  const get = (ctx as { get?: unknown } | undefined)?.get
  if (typeof get !== "function") return { missing: true }
  try {
    /** The service the strict or non-strict read returned. */
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
  /** Emit one diagnostic line, contained so a hostile sink cannot take the row down. */
  const warning = (line: string): void => {
    try {
      ;(options.warn ?? ((text: string) => rowLogLine("mpd-dsh-adapter", "[" + options.label + "] " + text)))(line)
    } catch { /* logging must never take a row down */ }
  }
  /** The adapter cached after the first STRICT hit; a miss is never cached. */
  let mounted: DshAdapter | undefined
  /** The fallback adapter serving calls until a strict read succeeds. */
  let temporary: DshAdapter | undefined
  /** Set after the one pending-provider warning, so it is emitted at most once. */
  let warnedPending = false
  /** Set after the one fallback warning, so it is emitted at most once. */
  let warnedMissing = false

  /** The adapter for this access: the mounted one when ACTIVE, else the temporary fallback. */
  const resolve = (): DshAdapter => {
    if (mounted !== undefined) return mounted
    /** The strict probe, which only an ACTIVE provider answers. */
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
    /** Resolve one member through the current adapter, binding methods so their receiver stays correct. */
    get(_target: DshAdapter, property: string | symbol): unknown {
      /** The resolved adapter viewed as a plain record for the member read. */
      const impl = resolve() as unknown as Record<PropertyKey, unknown>
      /** The member at that key, bound below when it is a method. */
      const value = impl[property as keyof typeof impl]
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(impl) : value
    },
    /** Report a member as present only when the current adapter actually carries it. */
    has(_target: DshAdapter, property: string | symbol): boolean {
      return property in (resolve() as unknown as Record<PropertyKey, unknown>)
    },
  })
}

/** Provide the adapter as the `mpdDsh` service and log the one boot line unless quiet. */
export function apply(ctx: any, config: { defaultTimeoutMs?: number; quiet?: boolean } = {}): void {
  /** The adapter instance every later `ctx.get("mpdDsh")` resolves. */
  const adapter = createDshAdapter(ctx, { ...(config.defaultTimeoutMs === undefined ? {} : { defaultTimeoutMs: config.defaultTimeoutMs }) })
  ctx.provide(SERVICE_NAME, adapter)
  // The loader applies sibling rows concurrently, so a capability snapshot taken
  // here would under-report. The row logs a stable line and callers read
  // capabilities() at use time (the QA probe prints them from a real boot).
  if (config.quiet !== true) {
    rowLogLine("mpd-dsh-adapter", "[mpd-dsh-adapter] " + SERVICE_NAME + " provided (harness seams resolved lazily, inject-free)")
  }
}
