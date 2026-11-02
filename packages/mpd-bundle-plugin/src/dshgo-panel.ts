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
// question's text) updates WITHOUT re-fetching the view. `view` instead builds from a LIVE read and
// `dshGoRefresh('mpd')` re-fetches it — which is the only way the OPTION BUTTONS can follow the
// pending question, because a view tree's node LIST is fixed once it is built. The view reads the
// services itself rather than the cache the data push fills, because the app fetches the view BEFORE
// it subscribes: a cache-built first view would carry no callout and no option buttons until something
// else changed. The panel therefore bounds the two differently on purpose: values are bound
// (`{"$": "data.…"}`) so they stay live, structure is rebuilt on the one event that changes it (the
// pending-question SET).
//
// A TAP ACTS ON THE VIEW, NOT ON THE LIVE LOT. The `actions` map is fixed at registration, so an
// `answer:<n>` id cannot carry a question: a live-lot lookup would settle whatever question sits at
// that index NOW — a question the user never saw. Each `view` build therefore CAPTURES the identity it
// renders (the parked id, the item ids and the RAW option labels) in a {@link PanelViewBinding}, and a
// tap resolves its batch from that capture. The live parking lot is read for ONE fact only — whether
// the captured id is still parked. When it is not, the tap toasts that the question is gone and asks
// for a refresh, so a view the app held across a question change can never settle the question that
// replaced it.
//
// THE BUDGETS ARE THE APP'S, NOT OURS (protocol v1). The panel budget is 32768 serialized bytes, 120
// nodes, depth 8, 32 children per node, 4 buttons per `actions` node, 2000 characters per `text` and
// an 80-character root title; `text`, `keyValue`, `list`, `callout` and `actions` are the only
// components this view uses, all from the v1 catalog. Every value the view binds is a path of the same
// `PanelSnapshot` shape the data push emits, and the test suite resolves every `$` path against a
// snapshot read at the same moment rather than trusting that claim.
//
// WHAT THIS FILE NEVER DOES. It never emits a filesystem path, a token or a credential: the snapshot
// carries ids, names, counts, the question's own text and task TITLES, and nothing else — the
// workspace root is an input to the read, never an output. It never throws at the bridge: a handler
// that cannot act answers a `toast` effect instead (the protocol's own failure shape), a service that
// throws is caught, and an action that runs long answers a toast while the work continues in the
// background. And it registers NOTHING on a host without the bridge: one log token, one service-bound
// subscription, and silence.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { basename, join } from "node:path"
import { rowLogLine } from "../../mpd-dsh-adapter-plugin/src/index"
import { type DshGoCaps, type DshGoView } from "../../mpd-dsh-adapter-plugin/src/dshgo-view"
import { buildMpdView } from "./dshgo-views"

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

/** How many memory entries the memory tab lists (contract D3: "the last ≤ 10 entries"). */
export const DSHGO_MAX_MEMORY_ROWS = 10

/** How many workmate rows the workmates tab lists; the library is a reading surface, not a table. */
export const DSHGO_MAX_WORKMATES = 12

/** The workspace state directory the memory store hangs under, as its own row documents it. */
const MEMORY_DIR = ".mpd"

/** The one alert the overview renders: a plan that is staged and waiting for the user's decision. */
const ALERT_PLAN_WAITING = "A plan is staged and waits for approval"

/** How long one tap WAITS for its service before acknowledging with the deferred shape (§3.5). */
export const DSHGO_ACTION_WAIT_MS = 2000

/**
 * How long a deferred result may take, as the app's own ceiling states it.
 *
 * Measured in dsh-Go 1.0.9 `docs/plugins/actions.md`: "Return `pending` first … the real result arrives
 * up to 60 s later", with `pending.timeoutMs` naming that bound.
 */
export const DSHGO_DEFERRED_TIMEOUT_MS = 60000

/** The toast a tap answers when the panel has no conversation to act on. */
const TOAST_NO_SESSION = "Open a conversation first"

/** The toast a tap answers when the service it needs is not mounted in this composition. */
const TOAST_UNAVAILABLE = "Unavailable here"

/** The toast a tap answers when its service reported a refusal. */
const TOAST_REFUSED = "The action was refused"

/** The waiting-state word an approval shows while its deferred result is pending (app limit: 16 chars). */
const PENDING_APPROVE = "Approving…"

/** The waiting-state word a dispatch pass shows while its deferred result is pending. */
const PENDING_DISPATCH = "Dispatching…"

/** The waiting-state word an answer shows while its deferred result is pending. */
const PENDING_ANSWER = "Answering…"

/** The toast a successful approval answers. */
const TOAST_APPROVED = "Approved"

/** The toast a successful dispatch pass answers. */
const TOAST_DISPATCHED = "Dispatched"

/** The toast a settled question answers. */
const TOAST_ANSWERED = "Answered"

/** The toast a tap answers when the question its view rendered is no longer parked. */
const TOAST_QUESTION_GONE = "That question is gone"

/** The toast a tap answers when the view it came from rendered no question at all. */
const TOAST_NO_QUESTION = "No question on screen"

/** How many characters a custom answer may carry, matching the relay's own question bound. */
const MAX_ANSWER_CHARS = 400

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
  /** The board row id, so a structural change of the ready SET is a value this module can diff. */
  id: string
  /** The task's subject, clipped to {@link MAX_TITLE_CHARS}. */
  title: string
  /** The task's kind and owner, clipped to {@link MAX_CAPTION_CHARS}; never its acceptance text. */
  subtitle: string
}

/** One workmate of the library, narrowed to what the panel draws: no persona, no memory, no path. */
export interface PanelWorkmateRow {
  /** The instance name (its directory key). */
  name: string
  /** The roster base the instance was copied from. */
  base: string
  /** How many work sessions the instance has accumulated. */
  uses: number
  /** The first line of its note card, clipped for the list's trailing position. */
  note: string
}

/** One memory entry: its kind, its one-line description and a human age. */
export interface PanelMemoryEntry {
  /** `note`, `fact` or `reflection`. */
  kind: string
  /** The entry's own description line, clipped to {@link MAX_CAPTION_CHARS}. */
  description: string
  /** A short relative age (`3m`, `2h`, `4d`). */
  age: string
}

/** The memory half of the snapshot: the last entries plus the reflection counters. */
export interface PanelMemorySnapshot {
  /** The newest entries, at most {@link DSHGO_MAX_MEMORY_ROWS}. */
  entries: PanelMemoryEntry[]
  /** How many reflections this agent has completed. */
  reflections: number
  /** How many writes have landed since the last reflection. */
  steps: number
}

/** The derived counters the overview tiles read, computed ONCE per read so the view can bind them. */
export interface PanelCounts {
  /** Rows whose blockers are all closed. */
  ready: number
  /** Rows in flight. */
  active: number
  /** Rows in a terminal status. */
  done: number
  /** Every row on the board. */
  total: number
  /** Finished rows as a percentage of the board, 0 when the board is empty. */
  completion: number
  /** How many members the roster holds, so the tile never binds through a null team. */
  members: number
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
  /** The RELAY's parked id; the answer batch's item id comes from the view binding captured at render time. */
  id: string
  /** The question's own text, clipped to {@link MAX_QUESTION_CHARS}. */
  question: string
  /** The answer choices in the order the asker gave them; labels only, never indices. */
  options: Array<{ label: string }>
}

/**
 * The question identity one rendered view acts on, captured when that view was built.
 *
 * The captured id — never the live lot's first entry — is what a tap answers, and the labels are the
 * RAW asker's labels (the snapshot's copies are clipped for DISPLAY, and the relay validates the label
 * it stored). This is the structure that makes `answer:<n>` safe even though the action map, and
 * therefore the id, is fixed before any question exists.
 */
export interface PanelQuestionBinding {
  /** The relay's parked id this view was rendered from. */
  parkedId: string
  /** Every question item id of that parking entry, in the asker's order; the answer batch carries the first. */
  itemIds: string[]
  /** The option labels the view's buttons show, in render order, exactly as the asker gave them. */
  labels: string[]
}

/** What one built view captured for its taps: the question it rendered, or null when it rendered none. */
export interface PanelViewBinding {
  /** The question this view rendered; null means those buttons did not exist, so a tap stays defensive. */
  question: PanelQuestionBinding | null
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
  /** The derived counters the overview tiles bind. */
  counts: PanelCounts
  /** The first thing the user should look at, or null when nothing needs attention. */
  alert: string | null
  /** The workmate library, read-only. */
  workmates: PanelWorkmateRow[]
  /** The memory store's latest entries, or null when it could not be read. */
  memory: PanelMemorySnapshot | null
}

/** One live read: the snapshot the panel renders, plus the question identity that snapshot was built from. */
export interface PanelReadState {
  /** The narrowed snapshot, exactly as the data push emits it. */
  snapshot: PanelSnapshot
  /** What a view built from this read captures for its taps. */
  binding: PanelViewBinding
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
  /** Subscribe one declared action's taps: the composer actions and the message actions (contract D5). */
  dshGoOn?: (id: string, handler: (scope: unknown, event: unknown) => unknown) => boolean
  /** Publish one composer strip's live line; the bridge drives the data function on its own clock. */
  dshGoStrip?: (id: string, dataFn: (scope: unknown, emit: (value: { text: string; icon?: string; tone?: string }) => void, caps: DshGoCaps) => () => void) => boolean
  /** Read what the app can draw, for callers the bridge hands no `caps` argument. */
  dshGoCaps?: () => DshGoCaps | null
  /**
   * Call one registered tool in-process, when the composition exposes the runtime.
   *
   * The team panel's settle/hold verbs and the save-memory menu action drive the SAME tools a person
   * would call, so their refusals reach the toast verbatim instead of being re-derived here.
   */
  executeTool?: (input: { name: string; arguments?: unknown }) => Promise<unknown>
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
  /**
   * The memory row's addressing, resolved by the caller from the mounted config.
   *
   * Absent means "the documented defaults" (`.mpd`, `agent-<workspace name>`), which is what a tester or
   * a composition without the config row gets — never a guess at some other agent's store.
   */
  memory?: PanelMemoryScope
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

/** The shorthand that asks the app to re-fetch this panel's view, which is what `refresh` taps answer. */
export interface PanelRefreshEffect {
  /** `true` means "refresh the panel that raised the tap"; the app accepts no other spelling here. */
  refresh: true
}

/**
 * The app's v1.1 DEFERRED effect: acknowledge the tap at once, deliver the real effect later.
 *
 * Required because the app runs an effect only if it arrives within three seconds of the tap, while an
 * approval or a dispatch pass may take longer. `pending` is the acknowledgement (shown on the tapped
 * element) and `result` settles with the effect the panel would have returned had it been fast.
 */
export interface PanelDeferredEffect {
  /** The waiting state: a word of at most 16 characters and how long the result may take. */
  pending: { label: string; timeoutMs: number }
  /** The work that is still running; it settles with the real effect. */
  result: () => Promise<PanelEffect>
}

/** The app's clipboard effect: the text a `{ copy }` tap puts on the clipboard (≤ 8000 characters). */
export interface PanelCopyEffect {
  /** The words to copy; the app clips anything past its own 8000-character ceiling. */
  copy: string
}

/** Everything one tap may answer: a toast, a refresh request, a copy, or the deferred acknowledgement. */
export type PanelReply = PanelEffect | PanelRefreshEffect | PanelCopyEffect | PanelDeferredEffect

/** What one snapshot read is scoped to. */
export interface PanelSnapshotRead {
  /** The service registry the three faces resolve through. */
  services: PanelServices
  /** The absolute workspace root; undefined reads nothing at all. */
  workspace: string | undefined
  /** The live session the panel is driving; empty reads nothing at all. */
  sessionId: string
  /** The resolved memory addressing (`memory.dir` / `memory.agentSlug`), when the caller has it. */
  memory?: PanelMemoryScope
}

/** The snapshot a panel renders before its first data tick: every section absent, no rows. */
function emptySnapshot(): PanelSnapshot {
  return {
    team: null,
    plan: null,
    question: null,
    readyTasks: [],
    counts: { ready: 0, active: 0, done: 0, total: 0, completion: 0, members: 0 },
    alert: null,
    workmates: [],
    memory: null,
  }
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
    rows.push({
      id: stringOf(task.id),
      title: clip(stringOf(task.subject), MAX_TITLE_CHARS),
      subtitle: clip(caption === "" ? "ready" : caption, MAX_CAPTION_CHARS),
    })
    if (rows.length >= DSHGO_MAX_READY_ROWS) break
  }
  return rows
}

/**
 * The counters the overview tiles read.
 *
 * `ready` counts the SAME rule {@link readyRowsOf} lists (pending with every blocker released) but is
 * never capped: the tile reports the board, the list reports what fits.
 * @param tasks - the record's task rows, already narrowed to records.
 * @returns the five derived counters, with `completion` as a whole percentage.
 */
function countsOf(tasks: readonly Record<string, unknown>[]): PanelCounts {
  /** The status of every task on the board. */
  const statusById = new Map<string, string>()
  for (const task of tasks) statusById.set(stringOf(task.id), stringOf(task.status))
  /** Rows in flight. */
  let active = 0
  /** Rows in a terminal status. */
  let done = 0
  /** Rows whose blockers are all released. */
  let ready = 0
  for (const task of tasks) {
    /** This row's status word. */
    const status = stringOf(task.status)
    if (RELEASING_STATUSES.has(status)) {
      done += 1
      continue
    }
    if (status === "in_progress") active += 1
    if (status === "pending" && !arrayOf(task.blockedBy).some((entry) => {
      /** The blocker's own status, when it names a row on this board. */
      const blockedStatus = statusById.get(stringOf(entry))
      return blockedStatus !== undefined && !RELEASING_STATUSES.has(blockedStatus)
    })) ready += 1
  }
  return {
    ready,
    active,
    done,
    total: tasks.length,
    completion: tasks.length === 0 ? 0 : Math.round((done / tasks.length) * 100),
    members: 0,
  }
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

/**
 * Project one parking lot read onto the snapshot's question half AND the identity a tap must use.
 *
 * ONE read answers both, so the labels the view renders and the labels its buttons send can never come
 * from two different instants. The snapshot keeps the DISPLAY copy of each label (clipped to
 * {@link MAX_LABEL_CHARS}); the binding keeps the RAW label, because the relay validates the label it
 * stored rather than this module's clipped copy. Both lists are built from the same filtered pairs, so
 * an index into one names the same option in the other.
 * @param value - the relay's `list` answer.
 * @returns the snapshot half plus its binding, or null when nothing is parked.
 */
function questionReadOf(value: unknown): { snapshot: PanelQuestionSnapshot; binding: PanelQuestionBinding } | null {
  /** The parked entries the relay answered with. */
  const parked = arrayOf(value).map((entry) => recordOf(entry)).filter((entry): entry is Record<string, unknown> => entry !== undefined)
  /** The OLDEST parked question: the relay orders newest last, and a queue is answered front first. */
  const entry = parked[0]
  if (entry === undefined) return null
  /** Every question item of that parking entry, in the asker's order. */
  const items = arrayOf(entry.questions).map((question) => recordOf(question)).filter((question): question is Record<string, unknown> => question !== undefined)
  /** The first item, which is the one the panel shows and answers. */
  const item = items[0]
  if (item === undefined) return null
  /** The option labels as PAIRS, so the display copy and the raw answer copy cannot drift apart. */
  const options = arrayOf(item.options)
    .map((option) => recordOf(option))
    .filter((option): option is Record<string, unknown> => option !== undefined)
    .map((option) => ({ raw: stringOf(option.label), display: clip(stringOf(option.label), MAX_LABEL_CHARS) }))
    .filter((option) => option.raw !== "" && option.display !== "")
  return {
    snapshot: {
      id: stringOf(entry.id),
      question: clip(stringOf(item.question), MAX_QUESTION_CHARS),
      options: options.map((option) => ({ label: option.display })),
    },
    binding: {
      parkedId: stringOf(entry.id),
      itemIds: items.map((question) => stringOf(question.id)).filter((id) => id !== ""),
      labels: options.map((option) => option.raw),
    },
  }
}

/** The structural face of the `mpdWorkmate` service: the READ-ONLY listing this panel draws. */
export interface PanelWorkmateFace {
  /** Every instance in the library, newest-agnostic; the panel never mutates one. */
  list?: () => unknown
}

/**
 * Read the workmate library through its service.
 *
 * The panel is READ-ONLY here by contract: it never spawns, reflects or deletes, so `list` is the only
 * member this module touches. An absent service — or one that throws — answers "no library" rather
 * than an error, because a composition without the workmate row still renders the other tabs.
 * @param services - the row context the service is resolved from.
 * @returns up to {@link DSHGO_MAX_WORKMATES} rows, or `[]` when the library is not mounted.
 */
function workmatesOf(services: PanelServices): PanelWorkmateRow[] {
  /** The library service, or undefined when this composition has none. */
  const face = faceOf<PanelWorkmateFace>(services, "mpdWorkmate")
  if (face?.list === undefined) return []
  return arrayOf(probe(() => face.list?.(), undefined))
    .map((entry) => recordOf(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== undefined)
    .slice(0, DSHGO_MAX_WORKMATES)
    .map((entry) => ({
      name: clip(stringOf(entry.name), MAX_TITLE_CHARS),
      base: clip(stringOf(entry.baseName), MAX_CAPTION_CHARS),
      uses: typeof entry.uses === "number" && Number.isFinite(entry.uses) ? entry.uses : 0,
      note: clip(stringOf(entry.note), MAX_CAPTION_CHARS),
    }))
}

/** The frontmatter a memory entry carries between its two `---` fences, read as a record. */
function frontmatterOf(text: string): Record<string, unknown> | undefined {
  /** The fence-delimited header, matched once at the file's head. */
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (match === null) return undefined
  try {
    /** The header parsed as the JSON the store writes there. */
    const parsed: unknown = JSON.parse(match[1] ?? "")
    return recordOf(parsed)
  } catch {
    return undefined
  }
}

/**
 * A short relative age for a millisecond timestamp: `3m`, `2h`, `4d`, `never` for a missing instant.
 * @param at - the entry's modification instant in epoch milliseconds, or 0 when unknown.
 * @param now - the instant the read happens, injected so a test can pin it.
 * @returns the clipped age label.
 */
function ageOf(at: number, now: number): string {
  if (at <= 0) return "never"
  /** How long ago the instant was, in whole minutes. */
  const minutes = Math.max(0, Math.floor((now - at) / 60000))
  if (minutes < 60) return String(minutes) + "m"
  if (minutes < 60 * 24) return String(Math.floor(minutes / 60)) + "h"
  return String(Math.floor(minutes / (60 * 24))) + "d"
}

/**
 * The memory row's addressing, as the panel resolves it: where the store lives and WHICH agent's.
 *
 * Both fields mirror the memory row's own config (`memory.dir`, `memory.agentSlug`). The panel does not
 * invent them: `index.ts` reads them from the mounted `mpdConfig` service, so a workspace that points
 * `memory.dir` somewhere else sees ITS store in the tab instead of an empty state.
 */
export interface PanelMemoryScope {
  /** The workspace state directory the store hangs under (`memory.dir`), `.mpd` when unset. */
  dir?: string
  /** The agent slug this panel reads (`memory.agentSlug`); derived from the workspace name when unset. */
  agentSlug?: string
}

/**
 * The memory row's slug rule, mirrored: an explicit `memory.agentSlug`, else `agent-<workspace name>`.
 *
 * The mirror is one line of documented behaviour (the memory package's `slugOf`), not a re-implementation
 * of the store: getting it wrong shows ANOTHER agent's entries, which is exactly the defect this fixes.
 * @param workspace - the absolute workspace root the store belongs to.
 * @param scope - the resolved memory scope, when the caller supplied one.
 * @returns the slug whose store this panel reads.
 */
export function memorySlugOf(workspace: string, scope?: PanelMemoryScope): string {
  if (scope?.agentSlug !== undefined && scope.agentSlug !== "") return scope.agentSlug
  /** The workspace directory's own name, which the derived slug is built from. */
  const base = basename(workspace).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24)
  return "agent-" + base
}

/**
 * Read ONE agent's workspace memory store, WITHOUT the memory row.
 *
 * WHY THIS READS FILES: the memory row publishes no service (only tools), and this panel must not edit
 * another package's plugin to add one. The layout it reads is that package's DOCUMENTED contract —
 * `<workspace>/<memory.dir or ".mpd">/memory/agents/<slug>/repo/memory/*.md` with a JSON frontmatter, and
 * `<slug>/runtime/reflection.json` for the counters — so this reader is a projection of a published
 * shape, not a second implementation of the store.
 *
 * SCOPE, STATED SO THE TAB CAN SAY IT: the read is WORKSPACE-ONLY and THIS-AGENT-ONLY. It never walks a
 * sibling agent's directory (a workspace with `memory.agentSlug` overrides would otherwise show another
 * agent's entries) and it never reads the global store under `$HOME` (that store is shared, and a panel
 * that mixed it into "this workspace's latest" would be lying about what it shows).
 *
 * A missing directory answers `null` (the tab says "no entry yet"), never an error.
 * @param workspace - the absolute workspace root the store hangs under.
 * @param now - the instant the relative ages are computed against.
 * @param scope - the resolved `memory.dir` / `memory.agentSlug`, or undefined for the documented defaults.
 * @returns the newest entries plus the reflection counters, or null when this agent has no store.
 */
export function readMemoryStore(workspace: string, now: number, scope?: PanelMemoryScope): PanelMemorySnapshot | null {
  /** The state directory the store hangs under: the row's `memory.dir`, else `.mpd`. */
  const stateDir = scope?.dir === undefined || scope.dir === "" ? MEMORY_DIR : scope.dir
  /** The ONE agent's store root this panel reads. */
  const agentRoot = join(workspace, stateDir, "memory", "agents", memorySlugOf(workspace, scope))
  /** The agent's entry directory; absent until the memory row's first write. */
  const memoryDir = join(agentRoot, "repo", "memory")
  if (!existsSync(memoryDir)) return null
  /** Every entry of THIS agent, newest first once sorted below. */
  const found: Array<{ entry: PanelMemoryEntry; at: number }> = []
  for (const file of probe(() => readdirSync(memoryDir), [] as string[])) {
    if (!file.endsWith(".md")) continue
    /** The entry's absolute path. */
    const path = join(memoryDir, file)
    /** The entry's text, or undefined when it cannot be read. */
    const text = probe(() => readFileSync(path, "utf8"), undefined as string | undefined)
    if (text === undefined) continue
    /** The frontmatter record carrying `kind` and `description`. */
    const meta = frontmatterOf(text)
    if (meta === undefined) continue
    /** The entry's modification instant. */
    const at = probe(() => statSync(path).mtimeMs, 0)
    found.push({ entry: { kind: clip(stringOf(meta.kind), MAX_CAPTION_CHARS), description: clip(stringOf(meta.description), MAX_CAPTION_CHARS), age: ageOf(at, now) }, at })
  }
  found.sort((left, right) => right.at - left.at)
  /** This agent's reflection state, when it has one. */
  const state = probe(() => JSON.parse(readFileSync(join(agentRoot, "runtime", "reflection.json"), "utf8")) as unknown, undefined)
  /** The state read as a record, so the counters are typed reads. */
  const record = recordOf(state) ?? {}
  return {
    entries: found.slice(0, DSHGO_MAX_MEMORY_ROWS).map((one) => one.entry),
    // The LEGACY names are read and never written (the memory row's own compatibility bound: real
    // `reflection.json` files predating the current vocabulary carry them).
    reflections: typeof record.reflectionsCompleted === "number" ? record.reflectionsCompleted : typeof record.reflected_completed_steps === "number" ? record.reflected_completed_steps : 0,
    steps: typeof record.stepsSinceReflection === "number" ? record.stepsSinceReflection : typeof record.steps_since_last_successful_reflection === "number" ? record.steps_since_last_successful_reflection : 0,
  }
}


/**
 * Read one panel's whole state: the snapshot the data push emits AND the binding a view captures.
 *
 * ONE reader serves both paths. `view` calls this directly (a synchronous read) so the first view an
 * app fetches BEFORE subscribing is complete, and `data()` calls {@link readPanelSnapshot}, which is
 * this same read narrowed to the snapshot. NOTHING HERE THROWS: `mpdTeams` owns the team record, the
 * relay owns the parking lot, `mpdWorkmate` owns the library, and the ONE disk read is the memory
 * store's documented layout ({@link readMemoryStore}) — a missing store answers the tab's empty state.
 * A conversation-less panel (no `sessionId`) reads nothing at all, so it cannot display another
 * conversation's team or answer another conversation's question.

 * @param read - the service registry plus the workspace and session this panel is scoped to.
 * @param options - `light: true` skips the workmate and memory reads, for the strip's 2 s tick.
 * @returns the narrowed snapshot plus the question identity it was built from.
 */
export function readPanelState(read: PanelSnapshotRead, options: { light?: boolean } = {}): PanelReadState {
  /** The session this panel drives, or `""` when the app gave none. */
  const sessionId = read.sessionId
  /** The workspace root this read is scoped to; an absent one reads nothing at all. */
  const workspace = read.workspace
  if (sessionId === "" || workspace === undefined || workspace === "") return { snapshot: emptySnapshot(), binding: { question: null } }
  /** The team service, resolved per read so a row that binds later is honoured. */
  const teams = faceOf<PanelTeamsFace>(read.services, "mpdTeams")
  /** The relay service, resolved per read for the same reason. */
  const questions = faceOf<PanelQuestionsFace>(read.services, "mpdQuestions")
  /** The team record bound to this conversation, read through the service's total projection. */
  const record = teams?.active === undefined ? undefined : probe(() => teams.active?.(workspace, sessionId), undefined)
  /** The parked question, read ONCE so the snapshot and the binding describe the same instant. */
  const question = questions?.list === undefined ? null : questionReadOf(probe(() => questions.list?.({ sessionId }), undefined))
  /** The board rows, narrowed once and reused by the ready list and the counters. */
  const tasks = arrayOf(recordOf(record)?.tasks).map((task) => recordOf(task)).filter((task): task is Record<string, unknown> => task !== undefined)
  /** The staged plan's projection, read once and reused by the snapshot and the alert. */
  const plan = teams?.planFor === undefined ? null : planSnapshotOf(probe(() => teams.planFor?.(workspace, sessionId), undefined))
  return {
    snapshot: {
      team: teamSnapshotOf(record),
      plan,
      question: question?.snapshot ?? null,
      readyTasks: readyRowsOf(tasks),
      counts: { ...countsOf(tasks), members: teamSnapshotOf(record)?.members ?? 0 },
      alert: plan?.ready === true ? ALERT_PLAN_WAITING : null,
      workmates: options.light === true ? [] : workmatesOf(read.services),
      memory: options.light === true ? null : probe(() => readMemoryStore(workspace, Date.now(), read.memory), null),
    },
    binding: { question: question?.binding ?? null },
  }
}

/**
 * Read the snapshot half of {@link readPanelState}: the model the data push emits.
 * @param read - the service registry plus the workspace and session this panel is scoped to.
 * @returns the narrowed snapshot; every section is null/empty when it could not be read.
 */
export function readPanelSnapshot(read: PanelSnapshotRead, options: { light?: boolean } = {}): PanelSnapshot {
  return readPanelState(read, options).snapshot
}

/**
 * Build the view tree for one snapshot.
 *
 * The tree itself is `dshgo-views.ts`'s job (contract §7): four v2 tabs, one `tinted` hero each, tiled
 * metrics, designed empty states and at most one primary action. `adaptView` inside that builder turns
 * the same tree into the v1 fallback for an older app, so a caller that passes no `caps` gets a v1 tree
 * and a caller on 1.0.9 gets v2 — from ONE function, which is what keeps the two shapes in step.
 * @param snapshot - the snapshot the view is built from.
 * @param caps - what the app can draw; absent reads as an older app and yields the v1 fallback.
 * @returns the view tree the bridge renders.
 */
export function buildPanelView(snapshot: PanelSnapshot, caps?: DshGoCaps | null): DshGoView {
  return buildMpdView(snapshot, caps)
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

/** The marker a timed-out wait answers with, so a slow service is never confused with a refusal. */
const TIMED_OUT = Symbol("mpd-panel-timeout")

/** One service call's settled outcome, or the deadline marker. */
type PanelAttempt = { ok: true; value: unknown } | { ok: false; error: unknown } | typeof TIMED_OUT

/**
 * Call one service, turning both settlements into a value.
 *
 * The call is wrapped so a rejection can never become an unhandled rejection: a tap handler must never
 * leave a rejected promise behind on a host that would surface it as a failed invoke.
 * @param run - the service call, started immediately.
 * @returns the call's outcome, never a rejection.
 */
function attemptOf(run: () => unknown): Promise<{ ok: true; value: unknown } | { ok: false; error: unknown }> {
  return Promise.resolve()
    .then(run)
    .then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }))
}

/**
 * Wait for an effect, or acknowledge with the app's v1.1 DEFERRED shape when it outlives the window.
 *
 * THE 3-SECOND WINDOW IS THE APP'S, measured in `docs/plugins/actions.md`: an effect must reach the app
 * within three seconds of the tap, and a handler that needs longer returns `pending` FIRST and the real
 * effect later (up to 60 s). The old 4-second constant therefore could never be met: this waits at most
 * {@link DSHGO_ACTION_WAIT_MS} and then hands the still-running work to the deferred result.
 *
 * @param running - the effect, already started.
 * @param label - the waiting-state word, at most 16 characters as the app requires.
 * @returns the effect, or the `{ pending, result }` shape.
 */
async function orDeferred(running: Promise<PanelEffect>, label: string): Promise<PanelReply> {
  /** The deadline's own resolution, cleared on the fast path. */
  let timer: ReturnType<typeof setTimeout> | undefined
  /** The deadline promise; it never rejects and carries only the marker. */
  const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), DSHGO_ACTION_WAIT_MS)
  })
  try {
    /** Whichever settles first: the effect or the acknowledgement deadline. */
    const raced = await Promise.race([running, deadline])
    if (raced !== TIMED_OUT) return raced
    return {
      pending: { label, timeoutMs: DSHGO_DEFERRED_TIMEOUT_MS },
      result: (): Promise<PanelEffect> => running,
    }
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

/** The answer text a custom-answer form submitted, or `""` when the event carries none. */
function customAnswerOf(event: unknown): string {
  /** The event's `value`, which the protocol fills with the form's collected fields. */
  const value = recordOf(recordOf(event)?.value)
  if (value === undefined) return ""
  /** The field the panel's own `textField` binds, when the bridge kept the binding's name. */
  const named = stringOf(value.customAnswer)
  if (named !== "") return named
  /** The generic field name a single-input form may report instead. */
  const generic = stringOf(value.text)
  if (generic !== "") return generic
  for (const entry of Object.values(value)) if (typeof entry === "string" && entry !== "") return entry
  return ""
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

/**
 * Whether the live parking lot still holds one parked id.
 *
 * This is the ONLY question a tap asks the live lot. The identity it answers — the item id and the
 * label — comes from the view's capture; the lot is consulted just to prove that identity is still
 * answerable, never to substitute the question currently parked in its place.
 * @param parked - the relay's `list` answer.
 * @param parkedId - the id the rendered view captured.
 * @returns true when that exact id is still parked.
 */
function holdsParkedId(parked: unknown, parkedId: string): boolean {
  if (parkedId === "") return false
  return arrayOf(parked)
    .map((entry) => recordOf(entry))
    .some((entry) => entry !== undefined && stringOf(entry.id) === parkedId)
}

/**
 * Build the tap handlers the panel publishes.
 *
 * EVERY handler answers an effect and never rejects: a missing conversation, a missing service, a
 * refusal and a throw all become a toast (the protocol's own failure shape), and a call that outlives
 * the deadline answers a toast while it keeps running.
 *
 * THE ANSWER IDS ARE FIXED AT REGISTRATION and cannot carry a question: `answer:0`…`answer:3` are the
 * same four keys forever. The id therefore indexes the CAPTURED VIEW BINDING — the identity the view
 * was rendered from — and never a position in the live parking lot. A tap settles what the user saw or
 * nothing at all: when the captured parked id is gone it toasts and asks for a refresh, rather than
 * answering the question that replaced it.
 * @param options - the bridge, the service registry and the failure sink.
 * @param bindingOf - the view binding captured for one scope, or undefined when no view was built.
 * @returns the action map, keyed by the ids the view's buttons name.
 */
export function createPanelActions(
  options: PanelOptions,
  bindingOf: (scope: unknown) => PanelViewBinding | undefined = () => undefined,
): Record<string, (scope: unknown, event: unknown) => Promise<PanelReply>> {
  /** The team-actions service, resolved per tap so a row that binds later is honoured. */
  const teamActions = (): PanelTeamActionsFace | undefined => faceOf<PanelTeamActionsFace>(options.ctx, "mpdTeamActions")
  /** The relay, resolved per tap for the same reason. */
  const questions = (): PanelQuestionsFace | undefined => faceOf<PanelQuestionsFace>(options.ctx, "mpdQuestions")
  /**
   * Turn one settled service call into the effect a tap answers.
   * @param outcome - the call's outcome, as {@link attemptOf} narrowed it.
   * @param success - the effect a non-refusing answer produces.
   * @param accepted - what a successful answer's value must satisfy; the relay's boolean, by default.
   * @returns the effect; never a rejection and never a throw.
   */
  const effectOf = (outcome: { ok: true; value: unknown } | { ok: false; error: unknown }, success: PanelEffect, accepted: (value: unknown) => boolean = () => true): PanelEffect => {
    if (outcome.ok === false) return { toast: clipToast(messageOf(outcome.error)) }
    if (isRefusal(outcome.value)) return { toast: clipToast(messageOf(outcome.value) || TOAST_REFUSED) }
    return accepted(outcome.value) ? success : { toast: TOAST_UNAVAILABLE }
  }
  /** The approve handler: approve the conversation's staged plan. */
  const approve = async (scope: unknown): Promise<PanelReply> => {
    /** The conversation this tap belongs to. */
    const sessionId = sessionIdOfScope(scope)
    if (sessionId === "") return { toast: TOAST_NO_SESSION }
    /** The service this tap needs, or undefined when the composition has none. */
    const face = teamActions()
    if (face?.approve === undefined) return { toast: TOAST_UNAVAILABLE }
    // Starts the call, then waits only inside the app's tap window before deferring.
    const running = attemptOf(() => face.approve?.({ sessionId })).then((outcome) => effectOf(outcome, { toast: TOAST_APPROVED }))
    return orDeferred(running, PENDING_APPROVE)
  }
  /** The dispatch handler: run one dispatch pass over the conversation's team. */
  const dispatch = async (scope: unknown): Promise<PanelReply> => {
    /** The conversation this tap belongs to. */
    const sessionId = sessionIdOfScope(scope)
    if (sessionId === "") return { toast: TOAST_NO_SESSION }
    /** The service this tap needs, or undefined when the composition has none. */
    const face = teamActions()
    if (face?.dispatch === undefined) return { toast: TOAST_UNAVAILABLE }
    /** The service call's effect, once it settles at all. */
    const running = attemptOf(() => face.dispatch?.({ sessionId })).then((outcome) => effectOf(outcome, { toast: TOAST_DISPATCHED }))
    return orDeferred(running, PENDING_DISPATCH)
  }
  /**
   * The shared answer path: settle the question the VIEW was rendered from.
   * @param scope - the invocation scope, whose session selects the relay lot.
   * @param index - the option index an `answer:<n>` tap names, or undefined for a custom answer.
   * @param custom - the typed answer, used instead of an offered label when non-empty.
   * @returns the effect; a gone question asks for a refresh instead of settling its replacement.
   */
  const answerFor = async (scope: unknown, index: number | undefined, custom: string): Promise<PanelReply> => {
    /** The conversation this tap belongs to. */
    const sessionId = sessionIdOfScope(scope)
    if (sessionId === "") return { toast: TOAST_NO_SESSION }
    /** The relay this tap needs, or undefined when the composition has none. */
    const face = questions()
    if (face?.list === undefined || face.answer === undefined) return { toast: TOAST_UNAVAILABLE }
    /** The identity the view captured when it was rendered; a tap never re-derives it from the lot. */
    const captured = bindingOf(scope)?.question
    if (captured === undefined || captured === null) return { toast: TOAST_NO_QUESTION }
    /** The label the answer carries: an offered one, or the typed answer clipped to the relay's bound. */
    const label = custom === "" ? captured.labels[index ?? -1] : clip(custom, MAX_ANSWER_CHARS)
    /** The item id the answer batch must carry: the first question item of the captured parked entry. */
    const itemId = captured.itemIds[0]
    if (label === undefined || itemId === undefined || label === "") return { toast: TOAST_UNAVAILABLE }
    /** Whether the captured question is STILL parked; this is the only fact the live lot supplies. */
    const stillParked = holdsParkedId(probe(() => face.list?.({ sessionId }), undefined), captured.parkedId)
    if (!stillParked) {
      // The user's question left the queue: say so and ask for a fresh view, instead of settling the
      // question that replaced it under another id.
      probe(() => options.dsh.dshGoRefresh(DSHGO_PANEL_ID), undefined)
      return { toast: TOAST_QUESTION_GONE }
    }
    /** The settle call's effect, once it settles at all. */
    const running = attemptOf(() => face.answer?.({ id: captured.parkedId, answers: [{ id: itemId, selected: [label] }] }))
      .then((outcome) => effectOf(outcome, { toast: TOAST_ANSWERED }, (value) => value === true))
    return orDeferred(running, PENDING_ANSWER)
  }
  /** The handler one option button runs: answer the question the VIEW was rendered from. */
  const answerWith = async (scope: unknown, event: unknown): Promise<PanelReply> => answerFor(scope, optionIndexOf(actionIdOf(event)), "")
  /** The handler the custom-answer form runs: settle with the typed words instead of an offered label. */
  const answerCustom = async (scope: unknown, event: unknown): Promise<PanelReply> => answerFor(scope, undefined, customAnswerOf(event))
  /** The refresh handler: ask the app to re-fetch this panel's view, which is the protocol's own shorthand. */
  const refresh = async (): Promise<PanelReply> => ({ refresh: true })
  /** The action map this panel publishes: the three view actions plus one id per option button. */
  const actions: Record<string, (scope: unknown, event: unknown) => Promise<PanelReply>> = { approve, dispatch, refresh, "answer-custom": answerCustom }
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
  /** The question identity each scope's LAST built view captured, which is what that view's taps act on. */
  const viewBindings = new Map<string, PanelViewBinding>()
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
  /** Read one scope's snapshot and view binding, through the three services, in ONE live read. */
  const stateOf = (scope: unknown): PanelReadState =>
    readPanelState({ services: options.ctx, workspace: workspaceOf(sessionIdOfScope(scope)), sessionId: sessionIdOfScope(scope), memory: options.memory })
  /** Read the snapshot for one scope, which is the push path's model. */
  const snapshotOf = (scope: unknown): PanelSnapshot => stateOf(scope).snapshot
  /** The scopes whose first emit already happened, so a steady tick emits nothing. */
  const published = new Set<string>()
  /** Whether the over-budget token was already written, so one condition logs one line. */
  let overBudget = false
  /**
   * Build one scope's view from a LIVE read, and capture the identity that view renders.
   *
   * THE LIVE READ IS F3'S FIX. `data()` has not run when the app fetches the first view (it fetches
   * BEFORE subscribing), so a cache-built view would carry no callout and no option buttons until
   * something else changed. The push cache stays the push path's own state; `view` never reads it.
   * The capture happens BEFORE the tree is returned, so a tap and the tree describe the same read.
   */
  const viewFor = (scope: unknown, caps?: DshGoCaps): DshGoView => {
    /** The live read this view renders, through the same reader the data push uses. */
    const state = stateOf(scope)
    viewBindings.set(scopeKeyOf(scope), state.binding)
    return buildPanelView(state.snapshot, caps)
  }
  /**
   * Ask the app to re-fetch the view when — and only when — the pending-question ID SET changed.
   *
   * A question's TEXT or an option's label changing under the same parked id is a data change: the
   * emit carries it and the bound nodes re-render, so no re-fetch is spent on it. The subscription's
   * own seed is not a change either: the app has just fetched the view before subscribing.
   */
  const announceQuestionSet = (key: string, snapshot: PanelSnapshot, seed: boolean): void => {
    /** The pending-question identity this snapshot shows: its id AND the labels it offers. */
    const questionKey = snapshot.question === null ? "" : snapshot.question.id + "|" + snapshot.question.options.map((option) => option.label).join("|")
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
    publishInto(key, snapshotOf(scope), send, true)
    /** The interval this subscription owns; the cancel below must leave none behind. */
    const timer = setInterval(() => { publishInto(key, snapshotOf(scope), send, false) }, pollMs)
    timers.add(timer)
    return (): void => {
      clearInterval(timer)
      timers.delete(timer)
      emitted.delete(key)
      questionKeys.delete(key)
      published.delete(key)
    }
  }
  /** The panel definition the bridge receives: a live view, the data push, and view-bound taps. */
  const spec: PanelSpec = {
    view: viewFor,
    data,
    actions: createPanelActions(options, (scope: unknown): PanelViewBinding | undefined => viewBindings.get(scopeKeyOf(scope))),
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
      viewBindings.clear()
      emitted.clear()
      questionKeys.clear()
      probe(() => offBound?.(), undefined)
      offBound = undefined
    },
  }
}
