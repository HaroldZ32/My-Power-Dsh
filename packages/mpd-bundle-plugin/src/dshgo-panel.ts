// THE LIVE HOST HALF OF THE DSH GO NATIVE PANEL (`.mpd/plans/mpd-drive-surface.md` §4.4, task E).
//
// WHY THIS FILE EXISTS. The bundle's `dshGo` manifest declares a panel id `mpd` with a STATIC view
// (`./dsh-go/views/mpd.json`): a host that carries no DSH Go bridge renders that file and nothing
// more. This module is the LIVE half — it publishes `panel('mpd', …)` through the adapter so the app
// renders the team, the staged plan and the pending question of the conversation it is attached to,
// with tap actions that call the same two services the HTTP routes call (`mpdTeamActions`,
// `mpdQuestions`). Both halves use the SAME panel id, so the static view is the fallback the app
// already has rather than a second, competing contribution.
//
// TWO MECHANISMS, AND WHY BOTH ARE NEEDED. `data(scope, emit)` pushes a COMPLETE data model; the
// bridge diffs it, throttles to 4 Hz and caps it at 32 KiB, so a value that changes (task counts, the
// question's text) updates WITHOUT re-fetching the view. `view` is a function of the current snapshot
// instead, and `dshGoRefresh('mpd')` re-fetches it — which is the only way the OPTION BUTTONS can
// follow the pending question, because a view tree's node LIST is fixed once it is built. The panel
// therefore bounds the two differently on purpose: values are bound (`{"$": "data.…"}`) so they stay
// live, structure is rebuilt on the one event that changes it (the pending-question SET).
//
// THE BUDGETS ARE THE APP'S, NOT OURS (protocol v1). The panel budget is 32768 serialized bytes, 120
// nodes, depth 8, 32 children per node, 4 buttons per `actions` node, 2000 characters per `text` and
// an 80-character root title; `text`, `keyValue`, `list`, `callout` and `actions` are the only
// components this view uses, all from the v1 catalog. Every value the view binds exists in the
// emitted snapshot because both are built from ONE `PanelSnapshot`, and the test suite resolves every
// `$` path against the snapshot it just captured rather than trusting that claim.
//
// WHAT THIS FILE NEVER DOES. It never emits a filesystem path, a token or a credential: the snapshot
// carries ids, names, counts, the question's own text and task TITLES, and nothing else — the
// workspace root is an input to the read, never an output. It never throws at the bridge: a handler
// that cannot act answers a `toast` effect instead (the protocol's own failure shape), a service that
// throws is caught, and an action that runs long answers a toast while the work continues in the
// background. And it registers NOTHING on a host without the bridge: one log token, one service-bound
// subscription, and silence.
import { rowLogLine } from "../../mpd-dsh-adapter-plugin/src/index"

/** The panel id the bundle's `dshGo` manifest declares; the live registration MUST use the same id. */
export const DSHGO_PANEL_ID = "mpd"

/** The poll period in milliseconds — 2000 ms is the contract's ceiling of 0.5 Hz, not a tuning knob. */
export const DSHGO_POLL_MS = 2000

/** The bridge's own serialized-snapshot ceiling; a snapshot is built to stay far below it. */
export const DSHGO_MAX_SNAPSHOT_BYTES = 32768

/** How many ready task rows the panel lists; the list is a summary, never the board. */
export const DSHGO_MAX_READY_ROWS = 10

/** How many option buttons one question may render: the schema's `actionsMax` per `actions` node. */
export const DSHGO_MAX_OPTIONS = 4

/** How long one tap waits for its service before answering a toast and letting the work continue. */
export const DSHGO_ACTION_TIMEOUT_MS = 4000

/** The toast a tap answers when the panel has no conversation to act on. */
const TOAST_NO_SESSION = "Open a conversation first"

/** The toast a tap answers when the service it needs is not mounted in this composition. */
const TOAST_UNAVAILABLE = "Unavailable here"

/** The toast a tap answers when its service reported a refusal. */
const TOAST_REFUSED = "The action was refused"

/** The toast a tap answers when its service outlived {@link DSHGO_ACTION_TIMEOUT_MS}. */
const TOAST_STILL_RUNNING = "Still working — check the team panel"

/** The toast a successful approval answers. */
const TOAST_APPROVED = "Approved"

/** The toast a successful dispatch pass answers. */
const TOAST_DISPATCHED = "Dispatched"

/** The toast a settled question answers. */
const TOAST_ANSWERED = "Answered"

/** The footer sentence naming what this panel can and cannot drive. */
const LIMITS_TEXT = "Local engine only: these actions drive this host's MPD team and need a live conversation."

/** The sentence shown when a question offers more options than the panel can render as buttons. */
const TRUNCATED_TEXT = "Only the first four options are shown; answer the rest from another client."

/** The longest title this module copies out of a task subject, in characters. */
const MAX_TITLE_CHARS = 120

/** The longest caption this module copies out of a task's own fields, in characters. */
const MAX_CAPTION_CHARS = 80

/** The longest question text this module copies into the snapshot, in characters. */
const MAX_QUESTION_CHARS = 400

/** The longest option label this module copies into the snapshot, in characters. */
const MAX_LABEL_CHARS = 80

/** The bridge's toast ceiling, in characters; the app truncates past it, so this module does too. */
const MAX_TOAST_CHARS = 40

/** One panel's scope: where the app says the tap or the subscription came from. */
export interface PanelScope {
  /** The live session the panel is attached to; absent means the panel is not driving anything. */
  sessionId?: string
}

/** One ready task row, already in the `list` component's own `{title, subtitle}` shape. */
export interface PanelReadyRow {
  /** The task's subject, clipped to {@link MAX_TITLE_CHARS}. */
  title: string
  /** The task's kind and owner, clipped to {@link MAX_CAPTION_CHARS}; never its acceptance text. */
  subtitle: string
}

/** The team half of the snapshot: what one conversation's team is, or null when it has none. */
export interface PanelTeamSnapshot {
  /** The mpd team id. */
  id: string
  /** The team name the user reads. */
  name: string
  /** The APPROVAL state — `staged` before approval, `approved` while live, `ended` once closed. */
  status: string
  /** The record's own activity phase: `staged` | `active` | `idle` | `ended`. */
  phase: string
  /** How many members the roster holds, excluding rows a failed raise left behind. */
  members: number
  /** How many tasks the board holds. */
  tasks: number
}

/** The staged-plan half of the snapshot, or null when this conversation staged nothing. */
export interface PanelPlanSnapshot {
  /** Whether the plan still awaits approval — the only state in which `approve` does anything. */
  ready: boolean
  /** How many members the plan would raise. */
  members: number
  /** How many tasks the plan would post. */
  tasks: number
}

/** The pending-question half of the snapshot, or null when nothing is waiting for an answer. */
export interface PanelQuestionSnapshot {
  /** The RELAY's parked id, which `mpdQuestions.answer` takes; the item id is resolved at tap time. */
  id: string
  /** The question's own text, clipped to {@link MAX_QUESTION_CHARS}. */
  question: string
  /** The answer choices in the order the asker gave them; labels only, never indices. */
  options: Array<{ label: string }>
}

/** Everything the panel renders and pushes, in one narrowed shape: no paths, no secrets. */
export interface PanelSnapshot {
  /** The team this conversation owns, or null. */
  team: PanelTeamSnapshot | null
  /** The plan staged for this conversation, or null. */
  plan: PanelPlanSnapshot | null
  /** The oldest unanswered question for this conversation, or null. */
  question: PanelQuestionSnapshot | null
  /** The board's ready tasks, at most {@link DSHGO_MAX_READY_ROWS} rows. */
  readyTasks: PanelReadyRow[]
}

/** The structural face of the `mpdTeams` service this module reads — never imported from its package. */
export interface PanelTeamsFace {
  /** The team bound to one Lead session, or undefined when that session has none. */
  active?: (workspace: string, sessionId?: string) => unknown
  /** The staged plan of one session, in the `/plan` route's own projection. */
  planFor?: (workspace: string, sessionId: string) => unknown
}

/** The structural face of the `mpdTeamActions` service: the two exec-free team actions. */
export interface PanelTeamActionsFace {
  /** Approve the conversation's staged plan. */
  approve?: (input: { sessionId: string }) => unknown
  /** Run one dispatch pass over the conversation's team. */
  dispatch?: (input: { sessionId: string }) => unknown
}

/** The structural face of the `mpdQuestions` service: the relay's parking lot. */
export interface PanelQuestionsFace {
  /** Every parked question a client may answer, newest last; a session filter narrows it. */
  list?: (input: { sessionId?: string }) => unknown
  /** Settle one parked question by id and by option LABEL; false when it could not. */
  answer?: (input: { id: string; answers: Array<{ id: string; selected: string[] }> }) => unknown
}

/** The one service-registry member this module reads: a tolerant, per-call probe. */
export interface PanelServices {
  /** Resolve a service by id; the second argument is `false` so a miss is an undefined, not a throw. */
  get?: (name: string, required?: boolean) => unknown
}

/** The panel definition as the adapter forwards it; opaque to the adapter, owned by the bridge. */
export interface PanelSpec {
  /** The view tree, or a function of the scope that rebuilds it. */
  view: unknown
  /** The data push function: it emits a COMPLETE model and returns its own cancel function. */
  data?: unknown
  /** Tap handlers keyed by action id; a handler answers an effect and never rejects. */
  actions?: Record<string, unknown>
}

/** The DSH Go bridge surface this module drives, declared structurally so a test can stand in. */
export interface PanelBridge {
  /** Whether the `dshGo` service is bound in this composition. */
  dshGoPresent: () => boolean
  /** Publish one panel; false when the bridge is absent or refused the call. */
  dshGoPanel: (id: string, spec: PanelSpec) => boolean
  /** Ask the app to re-fetch one panel's view. */
  dshGoRefresh: (id: string) => void
  /** Run a callback when one of these services binds, so a late bridge is still picked up. */
  onServiceBound: (names: readonly string[], callback: (name: string) => void) => () => void
  /**
   * The adapter's session-to-workspace lookup, when this bridge object also carries it.
   *
   * OPTIONAL because the panel only needs it to scope a read, and a bare host (a unit test, an older
   * adapter) can answer through {@link PanelOptions.workspace} instead. When both are absent the
   * panel shows its empty state rather than guessing a root and reading another project's team.
   */
  workspaceRootForSession?: (sessionId: string) => string | undefined
}

/** What one registration needs: the bridge, the service registry and its injectable sinks. */
export interface PanelOptions {
  /** The adapter's DSH Go seam (the four members above). */
  dsh: PanelBridge
  /** The row context, read only through `get(name, false)`. */
  ctx: PanelServices
  /**
   * Resolve a session's workspace root, used only when the bridge cannot answer it.
   *
   * Production passes nothing: the adapter's own `workspaceRootForSession` is the authority. A bare
   * test host has no session registry, so this seam lets one be supplied without widening the
   * bridge interface the task fixes.
   */
  workspace?: (sessionId: string) => string | undefined
  /** The diagnostic sink; the default is this row's own log file, never a terminal (AGENTS.md §6 R5). */
  log?: (line: string) => void
  /** The poll period, defaulting to {@link DSHGO_POLL_MS}; a test lowers it to avoid waiting. */
  pollMs?: number
}

/** What a registration reports: whether the panel is published now, and the release for our work. */
export interface PanelRegistration {
  /** Whether the apply-time attempt published the panel; a later bind can still publish it. */
  registered: boolean
  /** Release every interval and the late-bind subscription THIS module owns. */
  dispose: () => void
}

/** One effect a tap answers with; the protocol's shorthand for "say this, change nothing else". */
export interface PanelEffect {
  /** The toast text the app shows; always at most {@link MAX_TOAST_CHARS} characters. */
  toast: string
}

/** What one snapshot read is scoped to. */
export interface PanelSnapshotRead {
  /** The service registry the three faces resolve through. */
  services: PanelServices
  /** The absolute workspace root; undefined reads nothing at all. */
  workspace: string | undefined
  /** The live session the panel is driving; empty reads nothing at all. */
  sessionId: string
}

/** The snapshot a panel renders before its first data tick: every section absent, no rows. */
function emptySnapshot(): PanelSnapshot {
  return { team: null, plan: null, question: null, readyTasks: [] }
}

/** A one-segment view binding, spelled once so the shape cannot drift between nodes. */
function bind(path: string): { $: string } {
  return { $: path }
}

/** Narrow an unknown to a plain record, so every field read below is checked. */
function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
}

/** Read one string field, answering `""` for a missing or non-string value. */
function stringOf(value: unknown): string {
  return typeof value === "string" ? value : ""
}

/** Read one array field, answering `[]` for a missing or non-array value. */
function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** Clip one string to a character budget and drop any control character a toast must not carry. */
function clip(value: string, max: number): string {
  /** The single line the cap applies to: a newline would break the toast or the row it sits in. */
  const flat = value.replace(/\s+/g, " ").trim()
  return flat.length <= max ? flat : flat.slice(0, max)
}

/** Clip a message to the bridge's toast ceiling. */
function clipToast(value: string): string {
  /** The clipped message, falling back to the generic refusal when nothing readable is left. */
  const text = clip(value, MAX_TOAST_CHARS)
  return text === "" ? TOAST_UNAVAILABLE : text
}

/** Run one service read, answering `fallback` for both a throw and an absent member. */
function probe<T>(read: () => T, fallback: T): T {
  try {
    return read()
  } catch {
    return fallback
  }
}

/** Resolve one service face by id, tolerantly: an absent or throwing getter is simply no service. */
function faceOf<T>(services: PanelServices, name: string): T | undefined {
  return probe(() => {
    /** What the registry answered for that id. */
    const service = typeof services.get === "function" ? services.get(name, false) : undefined
    return recordOf(service) === undefined ? undefined : (service as T)
  }, undefined)
}

/** The session id one unknown scope carries, or `""` when it names none. */
export function sessionIdOfScope(scope: unknown): string {
  /** The scope read as a record, so the single field access below is checked. */
  const record = recordOf(scope)
  return record === undefined ? "" : stringOf(record.sessionId)
}

/** The map key one scope's panel state is held under: the session id, or `""` for a session-less panel. */
function scopeKeyOf(scope: unknown): string {
  return sessionIdOfScope(scope)
}

/** The status word of a team record: its APPROVAL state, which `phase` deliberately does not express. */
function teamStatusOf(record: Record<string, unknown>): string {
  if (stringOf(record.endedAt) !== "") return "ended"
  return stringOf(record.approvedAt) !== "" ? "approved" : "staged"
}

/** The board statuses that no longer block a dependent task (completed and cancelled release it). */
const RELEASING_STATUSES = new Set(["completed", "cancelled", "failed"])

/**
 * The board's ready tasks, by the OPT-1 reading the team store's own `readyTasks` implements.
 *
 * A task is ready when it is `pending` and every `blockedBy` entry names a task that is completed,
 * cancelled or failed — a blocker naming nothing blocks nothing, and a FAILED blocker deliberately
 * releases its dependents. This is a READ-side projection for a summary list; the authoritative
 * derivation stays in `mpd-team-core-plugin`, which this module must not import.
 * @param tasks - the record's task rows, already narrowed to records.
 * @returns up to {@link DSHGO_MAX_READY_ROWS} rows in board order.
 */
function readyRowsOf(tasks: readonly Record<string, unknown>[]): PanelReadyRow[] {
  /** The status of every task on the board, which is what a blocker is resolved against. */
  const statusById = new Map<string, string>()
  for (const task of tasks) statusById.set(stringOf(task.id), stringOf(task.status))
  /** The rows this projection answers with; filled in board order. */
  const rows: PanelReadyRow[] = []
  for (const task of tasks) {
    if (stringOf(task.status) !== "pending") continue
    /** Whether some blocker is still unfinished, which keeps this task out of the list. */
    const blocked = arrayOf(task.blockedBy).some((entry) => {
      /** The blocker's own status, or undefined when the entry names no task on this board. */
      const status = statusById.get(stringOf(entry))
      return status !== undefined && !RELEASING_STATUSES.has(status)
    })
    if (blocked) continue
    /** The row's caption: the task's kind and owner, both optional. */
    const caption = [stringOf(task.kind), stringOf(task.owner)].filter((part) => part !== "").join(" · ")
    rows.push({ title: clip(stringOf(task.subject), MAX_TITLE_CHARS), subtitle: clip(caption === "" ? "ready" : caption, MAX_CAPTION_CHARS) })
    if (rows.length >= DSHGO_MAX_READY_ROWS) break
  }
  return rows
}

/** Project one team record onto the snapshot's team half, or null when there is no readable record. */
function teamSnapshotOf(value: unknown): PanelTeamSnapshot | null {
  /** The record read as a plain object; anything else is "no team". */
  const record = recordOf(value)
  if (record === undefined) return null
  /** Every member row the record holds, read only for its status. */
  const members = arrayOf(record.members).map((member) => recordOf(member)).filter((member): member is Record<string, unknown> => member !== undefined)
  return {
    id: stringOf(record.teamId),
    name: clip(stringOf(record.name), MAX_TITLE_CHARS),
    status: teamStatusOf(record),
    phase: stringOf(record.phase) === "" ? "staged" : stringOf(record.phase),
    // A `failed` member is a raise that never happened (the store's own rule), so it is not counted.
    members: members.filter((member) => stringOf(member.status) !== "failed").length,
    tasks: arrayOf(record.tasks).length,
  }
}

/** Project the `/plan` route's payload onto the snapshot's plan half, or null when nothing is staged. */
function planSnapshotOf(value: unknown): PanelPlanSnapshot | null {
  /** The payload read as a plain object. */
  const payload = recordOf(value)
  /** The staged plan itself, or undefined when the route answered "nothing staged". */
  const plan = payload === undefined ? undefined : recordOf(payload.plan)
  if (plan === undefined) return null
  return {
    // `ready` means "approving would do something": staged, not committed, not discarded.
    ready: plan.approved !== true && plan.discarded !== true,
    members: arrayOf(plan.members).length,
    tasks: arrayOf(plan.tasks).length,
  }
}

/** Project the relay's parking lot onto the snapshot's question half, oldest question first. */
function questionSnapshotOf(value: unknown): PanelQuestionSnapshot | null {
  /** The parked entries the relay answered with. */
  const parked = arrayOf(value).map((entry) => recordOf(entry)).filter((entry): entry is Record<string, unknown> => entry !== undefined)
  /** The OLDEST parked question: the relay orders newest last, and a queue is answered front first. */
  const entry = parked[0]
  if (entry === undefined) return null
  /** The first question item of that parking entry, which is the one the panel shows and answers. */
  const item = arrayOf(entry.questions).map((question) => recordOf(question)).find((question): question is Record<string, unknown> => question !== undefined)
  if (item === undefined) return null
  /** The option labels the asker offered, in its own order, without their descriptions. */
  const options = arrayOf(item.options)
    .map((option) => recordOf(option))
    .filter((option): option is Record<string, unknown> => option !== undefined)
    .map((option) => ({ label: clip(stringOf(option.label), MAX_LABEL_CHARS) }))
    .filter((option) => option.label !== "")
  return { id: stringOf(entry.id), question: clip(stringOf(item.question), MAX_QUESTION_CHARS), options }
}

/**
 * Read the whole snapshot for one scope, tolerantly, from the three services the row publishes.
 *
 * NOTHING HERE THROWS and nothing here reads the disk: `mpdTeams` owns the record root, the relay
 * owns the parking lot, and a service that is absent, slow-ish or broken answers the empty state.
 * A conversation-less panel (no `sessionId`) reads nothing at all, so it cannot display another
 * conversation's team or answer another conversation's question.
 * @param read - the service registry plus the workspace and session this panel is scoped to.
 * @returns the narrowed snapshot; every section is null/empty when it could not be read.
 */
export function readPanelSnapshot(read: PanelSnapshotRead): PanelSnapshot {
  /** The session this panel drives, or `""` when the app gave none. */
  const sessionId = read.sessionId
  /** The workspace root this read is scoped to; an absent one reads nothing at all. */
  const workspace = read.workspace
  if (sessionId === "" || workspace === undefined || workspace === "") return emptySnapshot()
  /** The team service, resolved per tick so a row that binds later is honoured. */
  const teams = faceOf<PanelTeamsFace>(read.services, "mpdTeams")
  /** The relay service, resolved per tick for the same reason. */
  const questions = faceOf<PanelQuestionsFace>(read.services, "mpdQuestions")
  /** The team record bound to this conversation, read through the service's total projection. */
  const record = teams?.active === undefined ? undefined : probe(() => teams.active?.(workspace, sessionId), undefined)
  return {
    team: teamSnapshotOf(record),
    plan: teams?.planFor === undefined ? null : planSnapshotOf(probe(() => teams.planFor?.(workspace, sessionId), undefined)),
    question: questions?.list === undefined ? null : questionSnapshotOf(probe(() => questions.list?.({ sessionId }), undefined)),
    readyTasks: readyRowsOf(
      arrayOf(recordOf(record)?.tasks).map((task) => recordOf(task)).filter((task): task is Record<string, unknown> => task !== undefined),
    ),
  }
}

/**
 * Build the v1 view tree for one snapshot.
 *
 * STRUCTURE comes from the snapshot (the callout, the option buttons and the truncation note exist
 * only when a question does), while every VALUE that can change between refreshes is a `$` binding so
 * the data push updates it without a re-fetch. Every binding path below is a path of
 * {@link PanelSnapshot}; the test suite resolves each one against a captured snapshot.
 * @param snapshot - the snapshot the view is built from.
 * @returns the view tree the bridge renders; plain JSON, v1 components only.
 */
export function buildPanelView(snapshot: PanelSnapshot): Record<string, unknown> {
  /** The tree's children, in reading order. */
  const children: unknown[] = [
    {
      type: "keyValue",
      items: [
        { label: "Team", value: bind("data.team.name") },
        { label: "Status", value: bind("data.team.status") },
        { label: "Phase", value: bind("data.team.phase") },
        { label: "Members", value: bind("data.team.members") },
        { label: "Tasks", value: bind("data.team.tasks") },
        { label: "Plan members", value: bind("data.plan.members") },
        { label: "Plan tasks", value: bind("data.plan.tasks") },
      ],
    },
    { type: "list", items: bind("data.readyTasks") },
  ]
  if (snapshot.question !== null) {
    children.push({ type: "callout", tone: "info", text: bind("data.question.question") })
    /** The option buttons this question can render, capped at the per-node button budget. */
    const buttons = snapshot.question.options.slice(0, DSHGO_MAX_OPTIONS).map((_option, index) => ({
      label: bind("data.question.options." + index + ".label"),
      action: "answer:" + index,
    }))
    if (buttons.length > 0) children.push({ type: "actions", items: buttons })
    if (snapshot.question.options.length > DSHGO_MAX_OPTIONS) children.push({ type: "text", tone: "muted", text: TRUNCATED_TEXT })
  }
  // The two team actions are UNCONDITIONAL: a tap on a stale view still answers a toast, and keeping
  // them out of the refresh-triggered structure means the panel never loses its main controls.
  children.push({
    type: "actions",
    items: [
      { label: "Approve plan", action: "approve", style: "primary" },
      { label: "Dispatch", action: "dispatch" },
    ],
  })
  children.push({ type: "text", tone: "muted", text: LIMITS_TEXT })
  return { v: 1, type: "stack", title: "MPD", children }
}

/** The refusal shape a team action answers with, read structurally (the service's own `ok` flag). */
function isRefusal(value: unknown): boolean {
  /** The outcome read as a plain object, or undefined when the service answered a non-object. */
  const record = recordOf(value)
  return record !== undefined && record.ok === false
}

/** The one-line message a refusal or a thrown error carries, clipped for a toast. */
function messageOf(value: unknown): string {
  if (value instanceof Error) return value.message
  /** The value read as a plain object, so a `{ error }` field can be read from it. */
  const record = recordOf(value)
  if (record !== undefined) {
    /** The refusal sentence the action/services answer with. */
    const text = stringOf(record.error)
    if (text !== "") return text
  }
  return typeof value === "string" ? value : ""
}

/** The marker a timed-out action answers with, so a timeout is never confused with a refusal. */
const TIMED_OUT = Symbol("mpd-panel-timeout")

/**
 * Await one service call for at most {@link DSHGO_ACTION_TIMEOUT_MS}.
 *
 * The call is wrapped so a rejection after the deadline can never become an unhandled rejection: the
 * abandoned promise settles into a value this function already stopped waiting for, which is what a
 * tap handler must guarantee on a host that would otherwise see a rejected invoke.
 * @param run - the service call, started immediately.
 * @param timeoutMs - how long the tap waits before answering a toast.
 * @returns the call's outcome, or {@link TIMED_OUT}.
 */
async function settleWithin(run: () => unknown, timeoutMs: number): Promise<{ ok: true; value: unknown } | { ok: false; error: unknown } | typeof TIMED_OUT> {
  /** The call's outcome, never a rejection: the two arms below cover both settlements. */
  const guarded = Promise.resolve()
    .then(run)
    .then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }))
  /** The deadline's own resolution, cleared by the `finally` below on the fast path. */
  let timer: ReturnType<typeof setTimeout> | undefined
  /** The deadline promise; it never rejects and carries only the marker. */
  const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs)
  })
  try {
    return await Promise.race([guarded, deadline])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** The action id one panel tap reports, read from a string action or from an `args`-shaped value. */
function actionIdOf(event: unknown): string {
  /** The event read as a plain object; a malformed event is simply no action. */
  const record = recordOf(event)
  if (record === undefined) return ""
  /** The action id as the protocol spells it on a panel tap. */
  const action = stringOf(record.action)
  if (action !== "") return action
  /** The args a bound action node carried, where an id may sit instead. */
  const value = recordOf(record.value)
  return value === undefined ? "" : stringOf(value.action)
}

/** The option index an `answer:<n>` action id names, or undefined when the id names no option. */
function optionIndexOf(action: string): number | undefined {
  /** The id's suffix, matched against the one spelling this panel registers. */
  const match = /^answer:(\d+)$/.exec(action)
  if (match === null) return undefined
  /** The parsed index; a non-finite parse is no index. */
  const index = Number.parseInt(match[1] ?? "", 10)
  return Number.isFinite(index) && index >= 0 && index < DSHGO_MAX_OPTIONS ? index : undefined
}

/** The parked entry (and its first item) an answer tap resolves against, read fresh at tap time. */
function parkedAnswerOf(parked: unknown): { questionId: string; itemId: string; labels: string[] } | undefined {
  /** The parked entries the relay answered with. */
  const entries = arrayOf(parked).map((entry) => recordOf(entry)).filter((entry): entry is Record<string, unknown> => entry !== undefined)
  /** The oldest parked question, the same one the snapshot shows. */
  const entry = entries[0]
  if (entry === undefined) return undefined
  /** That entry's first question item, whose id the answer batch must carry. */
  const item = arrayOf(entry.questions).map((question) => recordOf(question)).find((question): question is Record<string, unknown> => question !== undefined)
  if (item === undefined) return undefined
  return {
    questionId: stringOf(entry.id),
    itemId: stringOf(item.id),
    labels: arrayOf(item.options)
      .map((option) => recordOf(option))
      .filter((option): option is Record<string, unknown> => option !== undefined)
      .map((option) => stringOf(option.label))
      .filter((label) => label !== ""),
  }
}

/**
 * Build the tap handlers the panel publishes.
 *
 * EVERY handler answers an effect and never rejects: a missing conversation, a missing service, a
 * refusal and a throw all become a toast (the protocol's own failure shape), and a call that outlives
 * the deadline answers a toast while it keeps running. The answer handler resolves its id and label
 * from the LIVE parking lot rather than from the rendered snapshot, so a view the app held across a
 * question change can never answer the wrong question.
 * @param options - the bridge, the service registry and the failure sink.
 * @returns the action map, keyed by the ids the view's buttons name.
 */
export function createPanelActions(options: PanelOptions): Record<string, (scope: unknown, event: unknown) => Promise<PanelEffect>> {
  /** The team-actions service, resolved per tap so a row that binds later is honoured. */
  const teamActions = (): PanelTeamActionsFace | undefined => faceOf<PanelTeamActionsFace>(options.ctx, "mpdTeamActions")
  /** The relay, resolved per tap for the same reason. */
  const questions = (): PanelQuestionsFace | undefined => faceOf<PanelQuestionsFace>(options.ctx, "mpdQuestions")
  /** The approve handler: approve the conversation's staged plan. */
  const approve = async (scope: unknown): Promise<PanelEffect> => {
    /** The conversation this tap belongs to. */
    const sessionId = sessionIdOfScope(scope)
    if (sessionId === "") return { toast: TOAST_NO_SESSION }
    /** The service this tap needs, or undefined when the composition has none. */
    const face = teamActions()
    if (face?.approve === undefined) return { toast: TOAST_UNAVAILABLE }
    /** The service call's outcome, or the timeout marker. */
    const outcome = await settleWithin(() => face.approve?.({ sessionId }), DSHGO_ACTION_TIMEOUT_MS)
    if (outcome === TIMED_OUT) return { toast: TOAST_STILL_RUNNING }
    if (outcome.ok === false) return { toast: clipToast(messageOf(outcome.error)) }
    if (isRefusal(outcome.value)) return { toast: clipToast(messageOf(outcome.value) || TOAST_REFUSED) }
    return { toast: TOAST_APPROVED }
  }
  /** The dispatch handler: run one dispatch pass over the conversation's team. */
  const dispatch = async (scope: unknown): Promise<PanelEffect> => {
    /** The conversation this tap belongs to. */
    const sessionId = sessionIdOfScope(scope)
    if (sessionId === "") return { toast: TOAST_NO_SESSION }
    /** The service this tap needs, or undefined when the composition has none. */
    const face = teamActions()
    if (face?.dispatch === undefined) return { toast: TOAST_UNAVAILABLE }
    /** The service call's outcome, or the timeout marker. */
    const outcome = await settleWithin(() => face.dispatch?.({ sessionId }), DSHGO_ACTION_TIMEOUT_MS)
    if (outcome === TIMED_OUT) return { toast: TOAST_STILL_RUNNING }
    if (outcome.ok === false) return { toast: clipToast(messageOf(outcome.error)) }
    if (isRefusal(outcome.value)) return { toast: clipToast(messageOf(outcome.value) || TOAST_REFUSED) }
    return { toast: TOAST_DISPATCHED }
  }
  /** The handler one option button runs: answer the live parked question with that option's label. */
  const answerWith = async (scope: unknown, event: unknown): Promise<PanelEffect> => {
    /** The conversation this tap belongs to. */
    const sessionId = sessionIdOfScope(scope)
    if (sessionId === "") return { toast: TOAST_NO_SESSION }
    /** The option index the action id names. */
    const index = optionIndexOf(actionIdOf(event))
    if (index === undefined) return { toast: TOAST_UNAVAILABLE }
    /** The relay this tap needs, or undefined when the composition has none. */
    const face = questions()
    if (face?.list === undefined || face.answer === undefined) return { toast: TOAST_UNAVAILABLE }
    /** The live parking lot, read now so a stale rendered view cannot answer a stale question. */
    const parked = parkedAnswerOf(probe(() => face.list?.({ sessionId }), undefined))
    /** The label this index really offers right now, which is also the value the relay validates. */
    const label = parked?.labels[index]
    if (parked === undefined || label === undefined) return { toast: TOAST_UNAVAILABLE }
    /** The settle call's outcome, or the timeout marker. */
    const outcome = await settleWithin(() => face.answer?.({ id: parked.questionId, answers: [{ id: parked.itemId, selected: [label] }] }), DSHGO_ACTION_TIMEOUT_MS)
    if (outcome === TIMED_OUT) return { toast: TOAST_STILL_RUNNING }
    if (outcome.ok === false) return { toast: clipToast(messageOf(outcome.error)) }
    if (outcome.value === true) return { toast: TOAST_ANSWERED }
    // The relay answers a boolean; a service that grows a `{ok:false, error}` refusal gets its own
    // sentence rather than the generic one, so the two shapes can never drift into different toasts.
    if (isRefusal(outcome.value)) return { toast: clipToast(messageOf(outcome.value) || TOAST_REFUSED) }
    return { toast: TOAST_UNAVAILABLE }
  }
  /** The action map this panel publishes: the two team actions plus one id per option button. */
  const actions: Record<string, (scope: unknown, event: unknown) => Promise<PanelEffect>> = { approve, dispatch }
  for (let index = 0; index < DSHGO_MAX_OPTIONS; index += 1) actions["answer:" + index] = answerWith
  return actions
}

/**
 * Publish `panel('mpd', …)` through the adapter, once, and only on a host that carries the bridge.
 *
 * A host without `dshGo` stays SILENT: the attempt logs one token (`dshGo=absent`), subscribes to the
 * runtime's own binding event and gives up until it fires, so a profile that never runs the DSH Go
 * local engine never pays for a poll. A host that has it gets one log token (`dshGo=panel`) and one
 * panel whose data push starts when the app subscribes.
 *
 * @param options - the bridge, the service registry and the injectable sinks.
 * @returns whether the apply-time attempt published the panel, plus the release for this module's work.
 */
export function registerDshGoPanel(options: PanelOptions): PanelRegistration {
  /** The diagnostic sink: the row's file log unless a caller (a test) injects one. */
  const log = options.log ?? ((line: string): void => { rowLogLine("mpd-bundle", line) })
  /** The poll period this registration uses. */
  const pollMs = options.pollMs ?? DSHGO_POLL_MS
  /** Whether the panel is published; a second attempt after a success is a no-op. */
  let registered = false
  /** The last state this module announced, so one decision logs one token. */
  let announced: "" | "absent" | "panel" = ""
  /** The late-bind subscription's disposer, once one was installed. */
  let offBound: (() => void) | undefined
  /** The latest snapshot per scope, which the view function renders when the app refreshes. */
  const latest = new Map<string, PanelSnapshot>()
  /** The serialized snapshot last emitted per scope, so an unchanged tick emits nothing. */
  const emitted = new Map<string, string>()
  /** The pending-question id set last seen per scope, so only a SET change refreshes the view. */
  const questionKeys = new Map<string, string>()
  /** Every interval this registration owns, so the release can clear all of them. */
  const timers = new Set<ReturnType<typeof setInterval>>()
  /** Announce one state exactly once, so a repeated attempt cannot spam the log. */
  const announce = (state: "absent" | "panel"): void => {
    if (announced === state) return
    announced = state
    log("[mpd] dshGo=" + state)
  }
  /** Resolve the workspace one scope reads, from the bridge when it can and the injected seam otherwise. */
  const workspaceOf = (sessionId: string): string | undefined => {
    /** What the bridge's own session-to-root lookup answered, when the seam is present. */
    const fromBridge = probe(() => (typeof options.dsh.workspaceRootForSession === "function" ? options.dsh.workspaceRootForSession(sessionId) : undefined), undefined)
    if (typeof fromBridge === "string" && fromBridge !== "") return fromBridge
    return probe(() => options.workspace?.(sessionId), undefined)
  }
  /** Read the snapshot for one scope through the three services. */
  const snapshotOf = (scope: unknown): PanelSnapshot =>
    readPanelSnapshot({ services: options.ctx, workspace: workspaceOf(sessionIdOfScope(scope)), sessionId: sessionIdOfScope(scope) })
  /** The scopes whose first emit already happened, so a steady tick emits nothing. */
  const published = new Set<string>()
  /** Whether the over-budget token was already written, so one condition logs one line. */
  let overBudget = false
  /** Read one scope's snapshot and store it as the model the view function renders. */
  const readScope = (scope: unknown): PanelSnapshot => {
    /** The snapshot this read produced. */
    const snapshot = snapshotOf(scope)
    latest.set(scopeKeyOf(scope), snapshot)
    return snapshot
  }
  /**
   * Ask the app to re-fetch the view when — and only when — the pending-question ID SET changed.
   *
   * A question's TEXT or an option's label changing under the same parked id is a data change: the
   * emit carries it and the bound nodes re-render, so no re-fetch is spent on it. The subscription's
   * own seed is not a change either: the app has just fetched the view before subscribing.
   */
  const announceQuestionSet = (key: string, snapshot: PanelSnapshot, seed: boolean): void => {
    /** The pending-question id set of this snapshot; empty when nothing is parked. */
    const questionKey = snapshot.question === null ? "" : snapshot.question.id
    if (questionKeys.get(key) === questionKey) return
    /** Whether this is a real change rather than the subscription's first reading. */
    const changed = !seed && questionKeys.has(key)
    questionKeys.set(key, questionKey)
    if (changed) probe(() => options.dsh.dshGoRefresh(DSHGO_PANEL_ID), undefined)
  }
  /** Push one snapshot when it differs from the last one emitted for its scope, then track the question set. */
  const publishInto = (key: string, snapshot: PanelSnapshot, send: ((value: PanelSnapshot) => void) | undefined, seed: boolean): void => {
    /** The snapshot's serialized form, which is what "unchanged" and the byte budget are measured on. */
    const serialized = JSON.stringify(snapshot)
    if (seed || !published.has(key) || emitted.get(key) !== serialized) {
      emitted.set(key, serialized)
      published.add(key)
      // The bridge caps a panel at 32 KiB and the app truncates past it; this row's own guard says so
      // ONCE instead of every tick, because the snapshot is bounded by construction (10 short rows).
      if (new TextEncoder().encode(serialized).length > DSHGO_MAX_SNAPSHOT_BYTES && !overBudget) {
        overBudget = true
        log("[mpd] dshGo=snapshot-over-budget")
      }
      probe(() => send?.(snapshot), undefined)
    }
    announceQuestionSet(key, snapshot, seed)
  }
  /** The `data` function: seed, poll, emit on change, refresh on a question-set change, cancel cleanly. */
  const data = (scope: unknown, emit: unknown): (() => void) => {
    /** The app's emit callback, when the bridge handed one. */
    const send = typeof emit === "function" ? (emit as (value: PanelSnapshot) => void) : undefined
    /** The scope's state key. */
    const key = scopeKeyOf(scope)
    // The seed runs BEFORE the interval exists, so the app has a complete model on its first frame
    // and the cancel below owns exactly one interval per subscription.
    publishInto(key, readScope(scope), send, true)
    /** The interval this subscription owns; the cancel below must leave none behind. */
    const timer = setInterval(() => { publishInto(key, readScope(scope), send, false) }, pollMs)
    timers.add(timer)
    return (): void => {
      clearInterval(timer)
      timers.delete(timer)
      latest.delete(key)
      emitted.delete(key)
      questionKeys.delete(key)
      published.delete(key)
    }
  }
  /** The panel definition the bridge receives: a view of the current snapshot, data, and taps. */
  const spec: PanelSpec = {
    view: (scope: unknown): Record<string, unknown> => buildPanelView(latest.get(scopeKeyOf(scope)) ?? emptySnapshot()),
    data,
    actions: createPanelActions(options),
  }
  /** Try to publish the panel; stay silent and wait for a bind when this host has no bridge. */
  const attempt = (): void => {
    if (registered) return
    /** Whether the bridge is bound right now; a throwing probe reads as "not yet". */
    const present = probe(() => options.dsh.dshGoPresent() === true, false)
    if (!present) {
      if (offBound === undefined) {
        offBound = probe(() => {
          /** The subscription's disposer, or a no-op when the runtime answered none. */
          const off = options.dsh.onServiceBound(["dshGo"], () => { attempt() })
          return typeof off === "function" ? off : (): void => {}
        }, (): void => {})
      }
      announce("absent")
      return
    }
    /** Whether the bridge accepted the panel definition. */
    const accepted = probe(() => options.dsh.dshGoPanel(DSHGO_PANEL_ID, spec) === true, false)
    if (!accepted) {
      // The adapter already logged WHY the bridge refused; this row's token only says the state.
      announce("absent")
      return
    }
    registered = true
    announce("panel")
  }
  attempt()
  return {
    registered,
    dispose: (): void => {
      for (const timer of timers) clearInterval(timer)
      timers.clear()
      published.clear()
      latest.clear()
      emitted.clear()
      questionKeys.clear()
      probe(() => offBound?.(), undefined)
      offBound = undefined
    },
  }
}
