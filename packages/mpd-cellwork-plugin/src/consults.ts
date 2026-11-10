// CELLWORK CONSULTS — the cell's own view of the `mpdConsults` service: background delegation and the
// settle/inspect verbs for the consults ONE cell started.
//
// WHY A SERVICE AND NOT AN IMPORT. The only async consult supervisor lives in `mpd-roles-plugin`; a
// relative import from this package would add an edge to the frozen cross-package coupling inventory, so
// the two rows talk through the cordis service `mpdConsults` (provided by the roles row over its ONE
// supervisor). The view below is declared STRUCTURALLY and every reply is typed `unknown`, then parsed at
// this boundary — the same discipline `caller.ts` uses for `mpdTeams`/`mpdTeamActions`.
//
// WHAT THIS MODULE OWNS. Two things the service must NOT own: (1) the AUTHORISATION, repeated here in the
// tool predicate because the guard is a second, independent arm (a captain session is refused even when
// the guard is bypassed); (2) the OWNERSHIP map, so `cellwork_consult` answers only for ids THIS cell
// started through `cellwork_delegate` — the service's own `list` is process-wide.
//
// DECLARED BOUNDS (README + docs): the book is IN MEMORY and per process, exactly like the supervisor's
// records, so a restart loses both together. A seat may still call `mpd_role_spawn_async` /
// `mpd_role_consult` directly; a consult it collects that way simply leaves this cell's list.
import type { DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index"
import { appendJournal } from "./state"
import { captainRefusal, checkpointRefusal, verifierDelegationRefusal, type CellworkSeat } from "./guard"

/** The most tasks ONE `cellwork_delegate` call may start (contract §3.2). */
export const DELEGATE_MAX_TASKS = 16

/** The default `wait` bound, milliseconds (the same default `mpd_role_consult` uses). */
export const CONSULT_WAIT_DEFAULT_MS = 30000

/** The largest `wait` bound a caller may ask for, milliseconds (the supervisor's own clamp). */
export const CONSULT_WAIT_MAX_MS = 60000

/** ASCII characters of one task kept in the journal row, so a cell's history stays bounded. */
const JOURNAL_TASK_CHARS = 400

/** The four verbs `cellwork_consult` answers. */
export const CONSULT_ACTIONS: readonly string[] = ["list", "wait", "collect", "cancel"]

/**
 * The slice of the `mpdConsults` service this package reads.
 *
 * Every method is OPTIONAL because the service may be an older row's object, and every reply is `unknown`
 * because this module parses it: the authoritative declarations are `packages/mpd-roles-plugin/src/consults.ts`.
 */
export interface ConsultServiceView {
  /**
   * Canonicalise one role spelling through the roles row's OWN resolver — the same one `mpd_role_spawn`
   * uses. Validating through this method is what keeps `cellwork_delegate` and the roster tools from
   * disagreeing (`DeepWorker` is the measured case: the roster accepts it, a local pass refused it).
   */
  canonicalRole?: (role: string, exec?: unknown) => unknown
  /** Start one background consult; the answer carries the stable id. */
  start?: (spec: { role: string; task: string; context?: string; exec: unknown; maxDepth?: number }) => Promise<unknown>
  /** Every consult the roles row knows, process-wide. */
  list?: () => unknown
  /** Block for settlement up to a bound, answering the running view when the bound wins. */
  wait?: (consultId: string, timeoutMs?: number) => Promise<unknown>
  /** Await settlement with no timeout (the blocking batch recon's await). */
  settle?: (consultId: string) => Promise<unknown>
  /** The settled report, released from the registry. */
  collect?: (consultId: string) => unknown
  /** Interrupt one consult's child. */
  cancel?: (consultId: string) => unknown
}

/** One consult as this package reports it: the fields a cell consumer reads, JSON-safe. */
export interface ConsultRow {
  /** The consult identity. */
  consultId: string
  /** The canonical roster role name. */
  role: string
  /** `running` | `complete` | `interrupted` | `failed`. */
  state: string
  /** When the consult started, epoch milliseconds. */
  startedAt: number
  /** How long it ran (or has been running), milliseconds. */
  elapsedMs: number
  /** The handoff document path, when the deadman interrupted the child with one. */
  handoff?: string
  /** The settled report, when `collect` released one. */
  report?: ConsultReportRow
  /** The failure text of a consult whose child could not be raised. */
  error?: string
}

/** The settled report a collect answers, projected to the fields a cell consumer reads. */
export interface ConsultReportRow {
  /** The roster role name. */
  role: string
  /** `complete` when the child reported, `interrupted` when it was interrupted. */
  status: string
  /** The child's summary, or its final text when it structured none. */
  summary: string
  /** The child's recommendation, empty when absent. */
  recommendation: string
  /** The child's details, empty when absent. */
  details: string
  /** The evidence entries the child cited. */
  evidence: string[]
  /** Why the child stopped, or null when the host declared none. */
  stopReason: string | null
  /** The consult identity, repeated inside the report. */
  consultId: string
  /** The elapsed time at settlement, milliseconds. */
  elapsedMs: number
  /** The handoff document, present only on an interruption. */
  handoff?: string
  /** The last observed activity, present only on an interruption. */
  lastActivity?: string
}

/** One consult THIS cell started through `cellwork_delegate`, as this package remembers it. */
export interface OwnedConsult {
  /** The consult identity the service minted. */
  consultId: string
  /** The canonical roster name the consult runs under. */
  role: string
  /** When the start answered, epoch milliseconds. */
  startedAt: number
  /** The task text as the caller wrote it (bounded only when it is journaled). */
  question: string
}

/**
 * The process-local ownership map: cell id → consult id → the row this package minted.
 *
 * NOT a second store (contract §3.4): it holds no report, no state and no cap — only which ids belong to
 * which cell — and it dies with the process, exactly as the supervisor's records do.
 */
export type ConsultBook = Map<string, Map<string, OwnedConsult>>

/**
 * Create an empty ownership map.
 *
 * @returns the book `installCellworkFlow` keeps for the life of the row.
 */
export function createConsultBook(): ConsultBook {
  return new Map<string, Map<string, OwnedConsult>>()
}

/** The refusal shape every consult verb answers with — never a throw, so the model can act on it. */
export interface ConsultRefusal {
  /** Always false. */
  ok: false
  /** ONE teaching sentence naming what was refused and what to do instead. */
  error: string
}

/**
 * Why this seat may not delegate, or undefined when it may (defence in depth behind the guard).
 *
 * The allowed classes are the planner, a promoted subcaptain and an ordinary recorded member of the cell
 * — the ONE sentence below names all three, and the captain's answer is the guard's OWN paragraph so the
 * two arms can never teach two different repairs.
 *
 * @param toolName - the tool being refused (`cellwork_delegate` or `cellwork_consult`).
 * @param seat - the caller's enforced seat, or undefined when the session holds none.
 * @returns the refusal paragraph, or undefined to allow.
 */
export function consultSeatRefusal(toolName: string, seat: CellworkSeat | undefined): string | undefined {
  if (seat === undefined) {
    return "cellwork: `" + toolName + "` is refused — this session is not a recorded member of the running"
      + " cell. The two consult verbs belong to the cell PLANNER (seat `cell-planner`), a promoted"
      + " SUBCAPTAIN, and an ordinary recorded MEMBER of the cell; the captain dispatches instead, and a"
      + " session the cell record never learned has no channel here. Read `cellwork_status` to see whether"
      + " this session holds a seat."
  }
  if (seat.mode === "captain") return captainRefusal(toolName)
  if (seat.mode === "verifier") return verifierDelegationRefusal(toolName)
  if (seat.mode === "checkpoint") return checkpointRefusal(toolName)
  return undefined
}

/**
 * Read one consult view (or outcome) as a JSON-safe row.
 *
 * @param value - whatever the service answered.
 * @returns the row, or undefined when the answer is not a consult object.
 */
export function consultRowOf(value: unknown): ConsultRow | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  /** The answer as a record. */
  const record = value as Record<string, unknown>
  /** The consult identity; without one there is nothing to report. */
  const consultId = typeof record.consultId === "string" ? record.consultId : ""
  if (consultId === "") return undefined
  /** The lifecycle state, defaulting to `running` for an answer that carries only a report status. */
  const state = typeof record.state === "string" ? record.state : typeof record.status === "string" ? record.status : "running"
  /** The report inside an outcome, when one was released. */
  const report = reportRowOf(record.report)
  return {
    consultId,
    role: typeof record.role === "string" ? record.role : "",
    state,
    startedAt: wholeNumber(record.startedAt),
    elapsedMs: wholeNumber(record.elapsedMs),
    ...(typeof record.handoff === "string" && record.handoff !== "" ? { handoff: record.handoff } : {}),
    ...(report === undefined ? {} : { report }),
    ...(typeof record.error === "string" && record.error !== "" ? { error: record.error } : {}),
  }
}

/**
 * Read one settled report as a JSON-safe row.
 *
 * @param value - the report the service answered.
 * @returns the row, or undefined when the value is not a report.
 */
export function reportRowOf(value: unknown): ConsultReportRow | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  /** The report as a record. */
  const record = value as Record<string, unknown>
  return {
    role: typeof record.role === "string" ? record.role : "",
    status: typeof record.status === "string" ? record.status : "complete",
    summary: typeof record.summary === "string" ? record.summary : "",
    recommendation: typeof record.recommendation === "string" ? record.recommendation : "",
    details: typeof record.details === "string" ? record.details : "",
    evidence: Array.isArray(record.evidence) ? record.evidence.map((entry) => String(entry)) : [],
    stopReason: typeof record.stopReason === "string" ? record.stopReason : null,
    consultId: typeof record.consultId === "string" ? record.consultId : "",
    elapsedMs: wholeNumber(record.elapsedMs),
    ...(typeof record.handoff === "string" && record.handoff !== "" ? { handoff: record.handoff } : {}),
    ...(typeof record.lastActivity === "string" && record.lastActivity !== "" ? { lastActivity: record.lastActivity } : {}),
  }
}

/**
 * Coerce one untrusted number to a non-negative whole number.
 *
 * @param value - the raw value.
 * @returns the whole number, or 0 when the value is not a finite number.
 */
function wholeNumber(value: unknown): number {
  /** The parsed number. */
  const parsed = typeof value === "number" ? value : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0
}

/** Everything the consult verbs need from the row. */
export interface ConsultDeps {
  /** The `mpdConsults` service, resolved lazily per call; undefined when the roles row is not mounted. */
  service: () => ConsultServiceView | undefined
  /** The roster role names, so a refusal can teach the addressable set. */
  rosterNames: () => string[]
  /** The calling cell's id — the ownership key. */
  cellId: string
  /** The caller's workspace root (journal path). */
  workspace: string
  /** The calling dispatch, forwarded to the service as `exec`. */
  exec: DshToolExec
  /** The instant to journal with. */
  now: Date
  /** The process-local ownership map. */
  book: ConsultBook
}

/** The answer of a successful `cellwork_delegate`. */
export interface DelegateStarted {
  /** True on success. */
  ok: true
  /** How many consults were started. */
  started: number
  /** The rows the caller collects by. */
  consults: Array<{ consultId: string; role: string; startedAt: number }>
}

/**
 * The sentence a call answers with when the `mpdConsults` service is absent.
 *
 * It NAMES the missing row and the one repair, because this package will never fall back to an
 * unsupervised spawn: the shared cap, the deadman and the read-only child scope live in that row.
 *
 * @param toolName - the tool that needed the service.
 * @returns the refusal sentence.
 */
export function missingConsultsServiceRefusal(toolName: string): string {
  return "cellwork: `" + toolName + "` is refused — the `mpdConsults` service is ABSENT from this"
    + " composition, so no supervised consult can be started or settled. It is provided by the"
    + " `mpd-roles` row over that row's ONE consult supervisor (the shared `MPD_DSH_CONSULT_MAX` cap and"
    + " the silence deadman live there); mount that row — there is no unsupervised fallback. The BLOCKING"
    + " `cellwork_recon` route needs it too, and `mpd_role_spawn` stays available for a one-shot consult."
}

/**
 * The sentence a call answers with when the roster cannot canonicalise a role.
 *
 * @returns the refusal sentence.
 */
function missingRosterRefusal(): string {
  return "cellwork: the roster service (`mpdRoles`) is absent or empty in this composition, so a role"
    + " spelling cannot be canonicalised — mount the `mpd-roles` row and resubmit."
}

/**
 * Read one raw `tasks` argument as the delegate's task list.
 *
 * ALL-OR-NOTHING: the FIRST bad entry refuses the whole call, and the caller starts nothing.
 *
 * @param raw - the raw `tasks` argument.
 * @returns the parsed tasks, or the refusal sentence.
 */
export function readDelegateTasks(raw: unknown): { tasks: Array<{ role: string; task: string; context?: string }> } | ConsultRefusal {
  if (!Array.isArray(raw)) return { ok: false, error: "cellwork_delegate: `tasks` must be an array of 1.." + String(DELEGATE_MAX_TASKS) + " `{role, task}` objects — nothing was started" }
  if (raw.length === 0) return { ok: false, error: "cellwork_delegate: `tasks` is empty — name at least one `{role, task}` to start; nothing was started" }
  if (raw.length > DELEGATE_MAX_TASKS) return { ok: false, error: "cellwork_delegate: `tasks` carries " + String(raw.length) + " entries, more than the " + String(DELEGATE_MAX_TASKS) + " this call starts — split it into batches; nothing was started" }
  /** The parsed rows, in the caller's order. */
  const tasks: Array<{ role: string; task: string; context?: string }> = []
  for (let index = 0; index < raw.length; index += 1) {
    /** One raw entry. */
    const entry = raw[index]
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return { ok: false, error: "cellwork_delegate: tasks[" + String(index) + "] is not an object — every entry is `{role, task, context?}`; nothing was started" }
    /** The entry as a record. */
    const record = entry as Record<string, unknown>
    /** The role spelling. */
    const role = typeof record.role === "string" ? record.role.trim() : ""
    if (role === "") return { ok: false, error: "cellwork_delegate: tasks[" + String(index) + "].role is empty — name a roster role (see `mpd_roles_list`); nothing was started" }
    /** The assignment text. */
    const task = typeof record.task === "string" ? record.task.trim() : ""
    if (task === "") return { ok: false, error: "cellwork_delegate: tasks[" + String(index) + "].task is empty — one consult answers one concrete assignment; nothing was started" }
    if (record.context !== undefined && typeof record.context !== "string") return { ok: false, error: "cellwork_delegate: tasks[" + String(index) + "].context must be a string when present; nothing was started" }
    tasks.push({ role, task, ...(typeof record.context === "string" && record.context !== "" ? { context: record.context } : {}) })
  }
  return { tasks }
}

/**
 * Start every task of one `cellwork_delegate` call in ONE pass and answer the ids immediately.
 *
 * Roles are canonicalised FIRST — through the `mpdConsults` service's OWN `canonicalRole`, the resolver
 * `mpd_role_spawn` uses — so an unknown spelling refuses the whole call before a single child is raised.
 * The starts themselves never await a child, over-cap work QUEUES on the shared supervisor, and no
 * `maxDepth` is forwarded (the roster places the child at caller depth + 1 as a leaf).
 *
 * @param deps - the service, the roster, the cell and the knobs.
 * @param rawTasks - the raw `tasks` argument.
 * @returns the ids, or the refusal naming what blocked the call.
 */
export async function startDelegation(deps: ConsultDeps, rawTasks: unknown): Promise<DelegateStarted | ConsultRefusal> {
  /** The parsed task list, or the refusal that replaced it. */
  const parsed = readDelegateTasks(rawTasks)
  if ("ok" in parsed) return parsed
  /** The service, or the honest absence refusal (never an unsupervised spawn). */
  const service = deps.service()
  // THE ROLE RESOLVER IS THE SERVICE'S. Without `canonicalRole` there is no second resolver to validate
  // against, so the call is refused rather than falling back to a local normalisation that could disagree
  // with `mpd_role_spawn` (the defect this repair removes).
  if (service?.start === undefined || typeof service.canonicalRole !== "function") return { ok: false, error: missingConsultsServiceRefusal("cellwork_delegate") }
  if (deps.rosterNames().length === 0) return { ok: false, error: missingRosterRefusal() }
  /** The canonical name of every task's role, in the caller's order. */
  const roles: string[] = []
  for (let index = 0; index < parsed.tasks.length; index += 1) {
    /** The service's answer: the canonical roster name, or a value that names nothing. */
    const answer = ((): unknown => {
      try {
        return service.canonicalRole?.(parsed.tasks[index].role, deps.exec)
      } catch {
        // A resolver failure is an unknown spelling, never a partial start.
        return undefined
      }
    })()
    /** The canonical name, or undefined for a spelling the roster does not answer to. */
    const canonical = typeof answer === "string" && answer !== "" ? answer : undefined
    if (canonical === undefined) return { ok: false, error: "cellwork_delegate: tasks[" + String(index) + "].role " + JSON.stringify(parsed.tasks[index].role) + " names no roster role — use a roster NAME as `mpd_roles_list` spells it (any case, space, hyphen or underscore spelling); nothing was started" }
    roles.push(canonical)
  }
  /** The started rows, in the caller's order. */
  const consults: Array<{ consultId: string; role: string; startedAt: number }> = []
  for (let index = 0; index < parsed.tasks.length; index += 1) {
    /** That task. */
    const task = parsed.tasks[index]
    try {
      // THE CALLER'S OWN EXECUTION travels as `exec`, so the child is raised under this session's
      // authority and the handoff directory resolves in the caller's workspace. NO `maxDepth` is
      // forwarded: `cellwork.depthMax` counts nested CELLS and is a different scale from agent delegation
      // depth, so the roles row's own `spawnMaxDepthOf(exec.agent)` rule (caller depth + 1, a LEAF) places
      // the child. Forwarding the cell cap as the child's ABSOLUTE agent depth disabled every consult at
      // the legal value `depthMax: 1`.
      /** The service's answer: the id at once, before any child settles. */
      const answer = await service.start({
        role: roles[index],
        task: task.task,
        ...(task.context === undefined ? {} : { context: task.context }),
        exec: deps.exec,
      })
      /** The row projected from the answer. */
      const row = consultRowOf(answer)
      if (row === undefined) return { ok: false, error: "cellwork_delegate: the `mpdConsults` service answered tasks[" + String(index) + "] without a consultId — " + String(consults.length) + " of " + String(parsed.tasks.length) + " consults were already started (" + consults.map((entry) => entry.consultId).join(", ") + "); collect them with `cellwork_consult`" }
      consults.push({ consultId: row.consultId, role: row.role === "" ? roles[index] : row.role, startedAt: row.startedAt })
      rememberConsult(deps.book, deps.cellId, { consultId: row.consultId, role: row.role === "" ? roles[index] : row.role, startedAt: row.startedAt, question: task.task })
      appendJournal(deps.workspace, deps.cellId, {
        event: "delegate-start",
        role: row.role === "" ? roles[index] : row.role,
        consultId: row.consultId,
        question: task.task.slice(0, JOURNAL_TASK_CHARS),
      }, deps.now)
    } catch (error) {
      /** The failure's message. */
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: "cellwork_delegate: starting tasks[" + String(index) + "] (" + roles[index] + ") failed: " + message + " — " + String(consults.length) + " of " + String(parsed.tasks.length) + " consults were already started" + (consults.length === 0 ? "" : " (" + consults.map((entry) => entry.consultId).join(", ") + "); collect them with `cellwork_consult`") }
    }
  }
  return { ok: true, started: consults.length, consults }
}

/**
 * Remember one consult under its cell.
 *
 * @param book - the process-local ownership map.
 * @param cellId - the cell that started it.
 * @param owned - the row to remember.
 */
export function rememberConsult(book: ConsultBook, cellId: string, owned: OwnedConsult): void {
  /** That cell's own map, created on first use. */
  const own = book.get(cellId) ?? new Map<string, OwnedConsult>()
  own.set(owned.consultId, owned)
  book.set(cellId, own)
}

/**
 * Drop one consult from a cell's map.
 *
 * @param book - the process-local ownership map.
 * @param cellId - the cell that started it.
 * @param consultId - the consult to forget.
 * @returns whether the id was there.
 */
export function forgetConsult(book: ConsultBook, cellId: string, consultId: string): boolean {
  return book.get(cellId)?.delete(consultId) === true
}

/**
 * Whether THIS cell started one consult.
 *
 * @param book - the process-local ownership map.
 * @param cellId - the cell asking.
 * @param consultId - the consult asked about.
 * @returns the remembered row, or undefined when this cell did not start it.
 */
export function ownedConsult(book: ConsultBook, cellId: string, consultId: string): OwnedConsult | undefined {
  return book.get(cellId)?.get(consultId)
}

/**
 * The teaching sentence a consult verb answers when the id is not this cell's.
 *
 * It never says "not found" alone: it names the ownership rule, the two OTHER channels an id may belong
 * to, and the restart bound, so a caller can act instead of guessing.
 *
 * @param toolName - the tool that was called.
 * @param consultId - the id the caller named.
 * @param cellId - the calling cell.
 * @returns the refusal sentence.
 */
export function foreignConsultRefusal(toolName: string, consultId: string, cellId: string): string {
  return "cellwork: `" + toolName + "` refused " + JSON.stringify(consultId) + " — this cell did not start"
    + " that consult, so it is not this cell's to settle. `cellwork_consult` answers only ids that"
    + " `cellwork_delegate` returned IN CELL " + cellId + " and that the consult supervisor still knows:"
    + " an id from `mpd_role_spawn_async` belongs to `mpd_role_consult`, a consult another cell started"
    + " belongs to that cell, and a process restart drops every in-memory handle — re-delegate the task"
    + " with `cellwork_delegate` when you need it again."
}

/**
 * Project one consult row onto a SUCCESSFUL tool answer.
 *
 * The consult's own failure text is renamed `errorDetail`: on a tool answer `error` means "the CALL was
 * refused", and one field must not carry both meanings.
 *
 * @param action - the verb that produced the row.
 * @param row - the consult row.
 * @returns the answer object.
 */
function successOf(action: string, row: ConsultRow): Record<string, unknown> {
  /** The row without its `error` key, so the rename cannot keep both spellings. */
  const { error, ...rest } = row
  return { ok: true, action, ...rest, ...(error === undefined ? {} : { errorDetail: error }) }
}

/**
 * Run one `cellwork_consult` action against the consults THIS cell started.
 *
 * @param deps - the service, the cell and the knobs.
 * @param args - the raw arguments (`action`, optional `consultId`, optional `timeoutMs`).
 * @returns the rows, or the refusal naming what blocked the call.
 */
export async function runConsultAction(deps: ConsultDeps, args: { action: string; consultId: string; timeoutMs: unknown }): Promise<Record<string, unknown>> {
  /** The requested verb. */
  const action = args.action.trim()
  if (!CONSULT_ACTIONS.includes(action)) return { ok: false, error: "cellwork_consult: action must be `list`, `wait`, `collect` or `cancel` (got " + JSON.stringify(args.action) + ")" }
  /** The service, or the honest absence refusal. */
  const service = deps.service()
  if (service === undefined) return { ok: false, error: missingConsultsServiceRefusal("cellwork_consult") }
  if (action === "list") {
    if (typeof service.list !== "function") return { ok: false, error: missingConsultsServiceRefusal("cellwork_consult") }
    /** The supervisor's answer, awaited once. */
    const answer = await Promise.resolve(service.list())
    /** The supervisor's process-wide rows, or [] when the answer is not an array. */
    const live: ConsultRow[] = (Array.isArray(answer) ? answer : [])
      .map((entry) => consultRowOf(entry))
      .filter((entry): entry is ConsultRow => entry !== undefined)
    /** This cell's own ids, in start order. */
    const own = deps.book.get(deps.cellId) ?? new Map<string, OwnedConsult>()
    /** The rows this call reports. */
    const consults: Array<Record<string, unknown>> = []
    for (const owned of [...own.values()]) {
      /** The supervisor's row for that id. */
      const row = live.find((entry) => entry.consultId === owned.consultId)
      if (row === undefined) {
        // The supervisor no longer knows it: a direct `mpd_role_consult {action:"collect"}` released it,
        // which the README documents. Prune the book so `list` never counts a handle nobody can settle.
        forgetConsult(deps.book, deps.cellId, owned.consultId)
        continue
      }
      consults.push({ consultId: row.consultId, role: row.role === "" ? owned.role : row.role, state: row.state, startedAt: row.startedAt, elapsedMs: row.elapsedMs, question: owned.question })
    }
    return { ok: true, action, consults }
  }
  /** The id this verb settles. */
  const consultId = args.consultId.trim()
  if (consultId === "") return { ok: false, error: "cellwork_consult: `consultId` is required for action \"" + action + "\" — use the id `cellwork_delegate` returned, or action \"list\" to see this cell's ids" }
  if (ownedConsult(deps.book, deps.cellId, consultId) === undefined) return { ok: false, error: foreignConsultRefusal("cellwork_consult", consultId, deps.cellId) }
  try {
    if (action === "wait") {
      if (typeof service.wait !== "function") return { ok: false, error: missingConsultsServiceRefusal("cellwork_consult") }
      // THE CLAMP IS MONOTONE: OMITTED -> the 30 s default; PROVIDED -> 1..60 000, so a declared `0` and a
      // negative both become 1 (the old `|| default` turned `0` into 30 000 while a negative became 1).
      /** The awaited bound, milliseconds. */
      const bound = args.timeoutMs === undefined
        ? CONSULT_WAIT_DEFAULT_MS
        : Math.min(CONSULT_WAIT_MAX_MS, Math.max(1, Math.trunc(Number(args.timeoutMs)) || 1))
      /** The view after the wait (a timed-out wait answers `running`). */
      const row = consultRowOf(await service.wait(consultId, bound))
      if (row === undefined) return { ok: false, error: "cellwork_consult: the `mpdConsults` service answered `wait` without a consult view for " + JSON.stringify(consultId) }
      return successOf(action, row)
    }
    if (action === "collect") {
      if (typeof service.collect !== "function") return { ok: false, error: missingConsultsServiceRefusal("cellwork_consult") }
      /** The outcome: the settled report, released, or the running view unchanged. */
      const row = consultRowOf(await Promise.resolve(service.collect(consultId)))
      if (row === undefined) {
        // The supervisor released it between the ownership check and this call.
        forgetConsult(deps.book, deps.cellId, consultId)
        return { ok: false, error: foreignConsultRefusal("cellwork_consult", consultId, deps.cellId) }
      }
      // A record is RELEASED by a settled collect; a running one answers its view and keeps the handle.
      if (row.state !== "running") forgetConsult(deps.book, deps.cellId, consultId)
      return successOf(action, row)
    }
    if (typeof service.cancel !== "function") return { ok: false, error: missingConsultsServiceRefusal("cellwork_consult") }
    /** The cancellation outcome. */
    const row = consultRowOf(await Promise.resolve(service.cancel(consultId)))
    if (row === undefined) return { ok: false, error: "cellwork_consult: the `mpdConsults` service answered `cancel` without a consult view for " + JSON.stringify(consultId) }
    appendJournal(deps.workspace, deps.cellId, { event: "consult-cancelled", role: row.role, consultId }, deps.now)
    // The record is KEPT: an interrupted consult still answers `collect` (which is what releases it), so
    // dropping the handle here would strand a record in the supervisor for the process lifetime.
    return successOf(action, row)
  } catch (error) {
    /** The failure's message. */
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: "cellwork_consult: `" + action + "` on " + JSON.stringify(consultId) + " failed: " + message }
  }
}
