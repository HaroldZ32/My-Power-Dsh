// CELLWORK ELASTICITY — runtime SEAT GROWTH (wave W1 §4.1) and the seat projection the operator
// surfaces report (§4.2).
//
// WHY SEATS GROW AT RUNTIME. `cellwork_activate` raises ONE member per distinct declared `member` name,
// and a split that repeats one name per role therefore materialises a board a single seat can only drain
// one row at a time. The dispatch pass pairs a row with its DECLARED owner or nobody (owner-only, D4), so
// a BUSY owner used to be a hard throughput ceiling. This module removes the ceiling WITHOUT weakening
// that rule: a ready row whose declared owner is busy is handed to a seat of the SAME base role —
// an idle `<base>-<n>` when one exists, otherwise a newly raised one — and the hand-over goes through the
// plane's own `reassign` repair, so the board records a real claim for a real seat.
//
// THE TRIGGER IS "BUSY", NEVER "MERE RUNNING". A member that owns no `claimed`/`in_progress` row is IDLE
// for the plane (`team-store.ts#idleMembers`), so growth checks the board's in-flight owners, not the
// roster's status word; a freshly raised seat is free to take the first row the normal pass pairs.
//
// NEVER GROWS FOR: a planning seat (`cell-planner`, `cell-splitter`, `cell-analyst-*`), a verifier-only
// seat, a seat the compaction barrier holds (`checkpoint`/`fenced`), a blocked task, a row already
// claimed, or a row the captain's own session owns. Each of those is a leave-it-alone arm, not a refusal.
//
// CAPS ARE NAMED, NOT SILENT. `cellwork.seats.maxPerRole` (default 8) bounds the seats sharing one base
// role and `cellwork.seats.max` (default 32) bounds the cell's execution seats; a capped row keeps the
// existing BUSY skip but its reason must name the cap AND its value, and the same sentence is journaled
// (`seat-growth-refused`) so `cellwork_supervise` can repeat it without re-deriving the decision.
import { readFileSync } from "node:fs"
import type { DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"
import type { CellworkConfig } from "./config"
import { fenceReasonOf, nameKey } from "./dispatch"
import { roleKey } from "./split"
import { appendJournal, journalPath, type CellMemberRecord, type CellState } from "./state"

/** A member row of the live team record, in the fields growth reads; every other field is ignored. */
interface GrowthMemberRow {
  /** Board name. */
  name?: string
  /** Roster role label (the field §7.1b measured going missing on the mid-run append arm). */
  role?: string
  /** `provisioning` | `running` | `inactive` | `failed`. */
  status?: string
  /** The executor's handle; the reassign path refuses a target without one. */
  executorRef?: string
  /** The plane's seat mode; `checkpoint` is a closed seat. */
  mode?: string
  /** The plane's explicit give-up fence. */
  fenced?: boolean
  /** Why the plane fenced the seat. */
  fencedReason?: string
}

/** A task row of the live team record, in the fields growth reads. */
interface GrowthTaskRow {
  /** Board id (`T1`, …). */
  id?: string
  /** One-line title, quoted in a refusal. */
  subject?: string
  /** `pending` is the only status a growth candidate may carry. */
  status?: string
  /** Declared blocker ids. */
  blockedBy?: readonly string[]
  /** The DECLARED owner name. */
  owner?: string
}

/** What {@link growExecutionSeats} writes to and reads from. */
export interface SeatGrowthDeps {
  /** The adapter's in-process tool runner; `agent_teams_plan {action:"add_member"}` is the ONE write. */
  dsh: Pick<DshAdapter, "executeTool">
  /** The caller's workspace root. */
  workspace: string
  /** The cell being grown: its identity, objective, member table and activated board ids. */
  cell: Pick<CellState, "cellId" | "objective" | "captainSessionId" | "members" | "activatedTasks">
  /** The resolved knobs; only the two seat caps are read here. */
  config: Pick<CellworkConfig, "seatsMax" | "seatsMaxPerRole">
  /** The captain's live agent handle — the Lead every team write is authorized by. */
  captainAgent: unknown
  /** The live EXECUTION board record, resolved by {@link resolveCellTeam}; undefined means no board. */
  record: Record<string, unknown> | undefined
  /**
   * Re-read the live board after a write.
   *
   * Needed for the two read-back duties: adopting a roster row a crashed pass created, and recording
   * the `role` the mid-run append arm actually persisted (§7.1b). Absent degrades to the answer's own
   * `spawned` handle and an empty observed role — never to a guess.
   */
  refreshRecord?: () => Record<string, unknown> | undefined
  /** The canonical roster role names, or [] when the roster service cannot answer. */
  rosterRoles: readonly string[]
  /** The roster persona text for one role, or null when the roster cannot answer. */
  personaFor: (role: string) => string | null
  /**
   * Board ids the caller already handles this pass (`cellwork_dispatch {reassign}`), which growth must
   * not also claim: the captain's own hand-over wins.
   */
  excludeTaskIds?: readonly string[]
  /** The instant every journal row of this pass is stamped with. */
  now: Date
}

/** One seat this pass raised (or adopted from the roster after a crash). */
export interface GrownSeat {
  /** The new seat's board name (`<base>-<n>`). */
  name: string
  /** The roster role the seat was requested with. */
  role: string
  /** The ready board id the seat was claimed for. */
  taskId: string
  /** The `role` the live roster row actually carries after the append (§7.1b); "" when it carries none. */
  rosterRole: string
  /** Why the seat was grown. */
  reason: "owner-busy"
}

/** One idle seat this pass REUSED instead of raising another. */
export interface ReusedSeat {
  /** The existing seat's board name. */
  name: string
  /** The ready board id it was claimed for. */
  taskId: string
}

/** One ready row this pass deliberately left pending, with the sentence a reader acts on. */
export interface SeatGrowthRefusal {
  /** The board id left pending. */
  taskId: string
  /** Its title, quoted back in the dispatch report. */
  subject: string
  /** Why no seat was grown (the same sentence the journal carries). */
  reason: string
}

/** What one growth pass produced. */
export interface SeatGrowthResult {
  /** The member rows to record on the cell state, keyed by board name. */
  members: Record<string, CellMemberRecord>
  /** The hand-overs to pass to the plane's dispatch `reassign`, in claim order. */
  reassign: Array<{ task_id: string; owner: string }>
  /** Every seat raised or adopted by this pass. */
  grown: GrownSeat[]
  /** Every idle seat reused by this pass. */
  reused: ReusedSeat[]
  /** Every ready row left pending because growth could not proceed. */
  refused: SeatGrowthRefusal[]
  /** Non-fatal observations (a grown seat whose roster row lost its `role`, §7.1b). */
  warnings: string[]
  /** The caps in force, echoed so a report never re-reads the config. */
  caps: { perRole: number; total: number }
}

/** The two seat caps, clamped to the documented minimum (1 disables growth). */
export interface SeatCaps {
  /** Execution seats sharing one base role. */
  perRole: number
  /** Total execution seats in one cell, planning seats excluded. */
  total: number
}

/**
 * The seat caps in force for ONE cell.
 *
 * @param config - the resolved knobs.
 * @returns both caps, clamped to `>= 1` so a malformed value can never open unbounded growth.
 */
export function seatCapsOf(config: Pick<CellworkConfig, "seatsMax" | "seatsMaxPerRole">): SeatCaps {
  /** The accepted per-role cap. */
  const perRole = Number.isFinite(config.seatsMaxPerRole) && config.seatsMaxPerRole >= 1 ? Math.floor(config.seatsMaxPerRole) : 1
  /** The accepted total cap. */
  const total = Number.isFinite(config.seatsMax) && config.seatsMax >= 1 ? Math.floor(config.seatsMax) : 1
  return { perRole, total }
}

/** The seat projection the operator surfaces report (§4.2). */
export interface CellSeatProjection {
  /** Execution seats: every member that is not a planning seat. */
  execution: number
  /** Planning seats: `cell-planner`, `cell-splitter` and every `cell-analyst-*`. */
  planning: number
  /** `cellwork.seats.max`, the total execution-seat cap. */
  cap: number
  /** `cellwork.seats.maxPerRole`, the per-base-role cap. */
  capPerRole: number
  /** How many rows carry the growth marker (`grown:true`). */
  grown: number
}

/**
 * Whether one board name is a PLANNING seat, which seat growth never touches.
 *
 * @param name - a board member name.
 * @returns true for `cell-planner`, `cell-splitter` and `cell-analyst-<n>`.
 */
export function isPlanningSeatName(name: string): boolean {
  /** The comparison key, so a case/space spelling cannot slip past the arm. */
  const key = roleKey(name)
  return key === "cell-planner" || key === "cell-splitter" || key.startsWith("cell-analyst")
}

/**
 * The BASE role name of a seat: the name with a trailing `-<n>` (n >= 2) removed.
 *
 * `Deep Worker` and `Deep Worker-2` both answer `Deep Worker`; a trailing `-1` is NOT a growth suffix
 * (growth numbers from 2), so `Deep Worker-1` keeps its own name and is refused as a non-roster base.
 *
 * @param name - a board member name.
 * @returns the base name, trimmed.
 */
export function baseSeatName(name: string): string {
  /** The trimmed name. */
  const trimmed = name.trim()
  /** The trailing numeric suffix, when it is a growth suffix. */
  const match = /^(.*\S)-([0-9]+)$/.exec(trimmed)
  if (match === null) return trimmed
  /** The numeric suffix as a number. */
  const ordinal = Number(match[2])
  return Number.isFinite(ordinal) && ordinal >= 2 ? match[1] : trimmed
}

/**
 * The ordinal of one seat within its base role: 1 for the base seat, n for `<base>-<n>`.
 *
 * Used ONLY to pick the smallest idle seat on reuse; a name growth did not mint still answers its own
 * trailing number, which is the seat order a reader expects.
 *
 * @param name - a board member name.
 * @returns the seat ordinal, `>= 1`.
 */
export function seatOrdinal(name: string): number {
  /** The trimmed name. */
  const trimmed = name.trim()
  /** The base role name. */
  const base = baseSeatName(trimmed)
  if (base === trimmed) return 1
  /** The suffix the base split off. */
  const suffix = trimmed.slice(base.length + 1)
  /** Its numeric value. */
  const ordinal = Number(suffix)
  return Number.isFinite(ordinal) && ordinal >= 1 ? ordinal : 1
}

/**
 * The canonical roster role whose spelling (case/space/hyphen-insensitive) equals one base name.
 *
 * WHEN THE ROSTER LIST CANNOT ANSWER (an older composition), the recorded role spellings are the
 * fallback, admitted only when the roster's own persona lookup confirms the role exists — so a
 * synthesized base can never become a seat.
 *
 * @param base - the base seat name.
 * @param rosterRoles - the canonical roster role names, [] when the roster could not answer.
 * @param recordedRoles - role spellings already recorded on the cell/team rows.
 * @param personaFor - the roster persona reader; null means "this role is not on the roster".
 * @returns the canonical role name, or undefined when the base is not a roster role.
 */
export function rosterRoleFor(base: string, rosterRoles: readonly string[], recordedRoles: readonly string[], personaFor: (role: string) => string | null): string | undefined {
  /** The base's comparison key. */
  const key = roleKey(base)
  if (key === "") return undefined
  /** The canonical list's match, which is the preferred answer. */
  const canonical = rosterRoles.find((role) => roleKey(role) === key)
  if (canonical !== undefined) return canonical
  // A ROSTER THAT ANSWERED AND DOES NOT NAME THE BASE IS A REFUSAL: nothing else may invent a role.
  if (rosterRoles.length > 0) return undefined
  /** A recorded spelling of the same role, confirmed by the roster's persona lookup. */
  const recorded = recordedRoles.find((role) => roleKey(role) === key)
  if (recorded === undefined) return undefined
  return personaFor(recorded) === null ? undefined : recorded
}

/**
 * The seat counts one cell record reports (§4.2): execution vs planning, the caps and the grown count.
 *
 * @param cell - the cell record whose member table is counted.
 * @param config - the resolved knobs.
 * @returns the projection.
 */
export function seatProjectionOf(cell: Pick<CellState, "members">, config: Pick<CellworkConfig, "seatsMax" | "seatsMaxPerRole">): CellSeatProjection {
  /** Every recorded member row. */
  const rows = Object.values(cell.members)
  /** The planning rows. */
  const planning = rows.filter((member) => isPlanningSeatName(member.name)).length
  /** The caps in force. */
  const caps = seatCapsOf(config)
  return {
    execution: rows.length - planning,
    planning,
    cap: caps.total,
    capPerRole: caps.perRole,
    grown: rows.filter((member) => member.grown === true).length,
  }
}

/**
 * The reason sentence a cap-refused growth carries — the SAME sentence the journal and the skip use.
 *
 * @param owner - the declared owner name that was busy.
 * @param cap - the cap that stopped the growth (`perRole` | `total`).
 * @param value - the cap's accepted value.
 * @returns the sentence.
 */
export function seatCapReason(owner: string, cap: "perRole" | "total", value: number): string {
  /** The dotted key the sentence names, so the operator knows which knob to raise. */
  const key = cap === "perRole" ? "cellwork.seats.maxPerRole" : "cellwork.seats.max"
  return "declared owner " + JSON.stringify(owner) + " is BUSY and the seat cap (" + key + "=" + String(value) + ") is reached"
}

/**
 * The LAST `seat-growth-refused` reason a cell journaled, for the sweep to repeat verbatim (§4.2).
 *
 * @param workspace - the workspace root.
 * @param cellId - the cell whose journal is read.
 * @returns the reason sentence, or undefined when no growth was refused.
 */
export function lastSeatGrowthRefusalOf(workspace: string, cellId: string): string | undefined {
  /** The journal text; an unreadable journal answers "nothing recorded" rather than failing the sweep. */
  let text: string
  try {
    text = readFileSync(journalPath(workspace, cellId), "utf8")
  } catch {
    return undefined
  }
  /** The journal lines, oldest first. */
  const lines = text.split("\n")
  for (let index = lines.length - 1; index >= 0; index--) {
    /** One raw line. */
    const line = lines[index]
    if (line === undefined || line.trim() === "") continue
    try {
      /** The parsed row, read as an untrusted value. */
      const row: unknown = JSON.parse(line)
      if (typeof row === "object" && row !== null && (row as { event?: unknown }).event === "seat-growth-refused" && typeof (row as { reason?: unknown }).reason === "string") return (row as { reason: string }).reason
    } catch {
      // A torn line is history we cannot read, never a reason to fail the sweep.
    }
  }
  return undefined
}

/**
 * The prompt a seat grown mid-run is raised with.
 *
 * Kept deliberately short: the per-task acceptance text and the frozen contract arrive in the normal
 * dispatch message, so this only says who the seat is and what protocol binds it.
 *
 * @param cell - the cell the seat joins.
 * @param name - the seat's board name.
 * @param role - its roster role.
 * @param persona - the roster persona text, when the roster answered.
 * @returns the prompt text.
 */
function grownSeatPrompt(cell: Pick<CellState, "cellId" | "objective">, name: string, role: string, persona: string | null): string {
  return [
    ...(persona === null ? [] : [persona, ""]),
    "[mpd-cellwork] You are " + name + " (" + role + ") on cell " + cell.cellId + ".",
    "You are an EXECUTION SEAT raised at runtime because your role's earlier seat was busy.",
    "",
    "OBJECTIVE (the user's own words):",
    cell.objective,
    "",
    "PROTOCOL:",
    "1. WAIT for the dispatch message naming your task; the message names the paths you may write.",
    "2. CLAIM the row: agent_teams_task {action:\"claim\", task_id}.",
    "3. Read the frozen contract named in the message BEFORE you start; it is what your verifier judges.",
    "4. On completion: agent_teams_task {action:\"complete\", task_id, note:\"<one line>\"}.",
    "5. If you need a user decision, mail the captain; the captain relays the question. Do not guess.",
    "6. If the plugin tells you to CHECKPOINT, call cellwork_handoff and end your turn.",
  ].join("\n")
}

/**
 * Read one row's board name, or "" when it carries none.
 *
 * @param row - a member row.
 * @returns the trimmed name.
 */
function rowName(row: GrowthMemberRow): string {
  return typeof row.name === "string" ? row.name.trim() : ""
}

/**
 * The ids of every in-flight row on one board, by owner spelling AND by handle.
 *
 * The plane marks a member busy when an `in_progress`/`claimed` row names it by NAME or by its
 * `executorRef`, so growth must read the same two spellings or it would raise a seat for a member the
 * plane already considers busy (and vice versa).
 *
 * @param tasks - the board rows.
 * @returns the busy spellings, comparison-keyed.
 */
function busyOwnerKeys(tasks: readonly GrowthTaskRow[]): Set<string> {
  /** Every live owner spelling. */
  const busy = new Set<string>()
  for (const task of tasks) {
    if (task.status !== "claimed" && task.status !== "in_progress") continue
    if (typeof task.owner === "string" && task.owner.trim() !== "") busy.add(nameKey(task.owner))
  }
  return busy
}

/**
 * Whether one block list is satisfied by a board: every blocker `completed`/`cancelled`, and a FAILED
 * blocker does not hold its dependents (the store's OPT-1 rule the plane's `readyTasks` uses).
 *
 * @param tasks - the whole board.
 * @param blockedBy - the row's declared blockers.
 * @returns true when the row may be dispatched now.
 */
function blockersSatisfied(tasks: readonly GrowthTaskRow[], blockedBy: readonly string[] | undefined): boolean {
  if (!Array.isArray(blockedBy) || blockedBy.length === 0) return true
  for (const id of blockedBy) {
    /** The blocker's status; an unknown id still blocks, exactly as the store's rule says. */
    const status = tasks.find((task) => task.id === id)?.status
    if (status === "completed" || status === "cancelled") continue
    return false
  }
  return true
}

/**
 * Read one board row as the growth table, keeping only the entries that carry an id.
 *
 * @param value - the record's `tasks` value, read as untrusted.
 * @returns the rows.
 */
function growthTaskRows(value: unknown): GrowthTaskRow[] {
  if (!Array.isArray(value)) return []
  return value.filter((row): row is GrowthTaskRow => typeof row === "object" && row !== null).filter((row) => typeof row.id === "string" && row.id !== "")
}

/**
 * Read one roster row as the growth table, keeping only the entries that carry a name.
 *
 * @param value - the record's `members` value, read as untrusted.
 * @returns the rows.
 */
function growthMemberRows(value: unknown): GrowthMemberRow[] {
  if (!Array.isArray(value)) return []
  return value.filter((row): row is GrowthMemberRow => typeof row === "object" && row !== null).filter((row) => rowName(row) !== "")
}

/**
 * Read one `agent_teams_plan {action:"add_member"}` answer.
 *
 * @param result - the adapter's answer, read as untrusted.
 * @returns the handle the raise minted ("" when the answer carried none) and the failure sentence.
 */
function readAddMemberAnswer(result: unknown): { handle: string; error?: string } {
  if (typeof result !== "object" || result === null) return { handle: "", error: "the add_member call returned no answer" }
  /** The answer as a record. */
  const value = result as Record<string, unknown>
  if (value.ok === false) return { handle: "", error: typeof value.error === "string" ? value.error : "the add_member call failed" }
  /** The tool's structured payload, when the adapter wraps it. */
  const payload = typeof value.value === "object" && value.value !== null ? value.value as Record<string, unknown> : value
  return { handle: typeof payload.spawned === "string" ? payload.spawned : "" }
}

/**
 * Grow the execution seats a ready frontier needs, BEFORE the dispatch pass pairs rows (§4.1).
 *
 * Ordering is the contract: every seat this function raises exists on the live roster before the caller
 * asks the plane for its pass, and the hand-over of each grown/reused seat travels in the SAME
 * `plane.dispatch({reassign})` call, so the row is claimed for a seat that can actually receive it.
 *
 * The function NEVER throws: an unreadable board, an absent roster or a refused append answers an empty
 * or diagnostic result, because a dispatch pass must still run for the rows growth did not touch.
 *
 * @param deps - the board, the cell, the roster, the caps and the ONE tool seam.
 * @returns the new member rows, the hand-overs, and every decision that did not grow a seat.
 */
export async function growExecutionSeats(deps: SeatGrowthDeps): Promise<SeatGrowthResult> {
  /** The caps in force. */
  const caps = seatCapsOf(deps.config)
  /** The result being built; also the empty answer of a pass with nothing to grow. */
  const result: SeatGrowthResult = { members: {}, reassign: [], grown: [], reused: [], refused: [], warnings: [], caps: { perRole: caps.perRole, total: caps.total } }
  if (deps.record === undefined) return result
  /** The board rows. */
  const tasks = growthTaskRows(deps.record.tasks)
  /** The live roster rows. */
  const roster = growthMemberRows(deps.record.members)
  /** The in-flight owner spellings. */
  const busy = busyOwnerKeys(tasks)
  /** Every name already on the roster or in the cell record, comparison-keyed, so a name is never duplicated. */
  const usedNames = new Set<string>([...roster.map((row) => roleKey(rowName(row))), ...Object.keys(deps.cell.members).map((name) => roleKey(name))])
  /** The seats this pass has already allocated to a row (one task per seat). */
  const allocated = new Set<string>()
  /** Task ids the caller already hands over itself. */
  const excluded = new Set(deps.excludeTaskIds ?? [])
  /** Every execution seat currently on the roster, by base-role key. */
  const seatsOfBase = (baseKey: string): GrowthMemberRow[] => roster.filter((row) => !isPlanningSeatName(rowName(row)) && roleKey(baseSeatName(rowName(row))) === baseKey)
  /** The roles recorded on the cell and team rows, the fallback for the roster-list read. */
  const recordedRoles = [...new Set([
    ...Object.values(deps.cell.members).map((member) => member.role),
    ...roster.map((row) => (typeof row.role === "string" ? row.role : "")),
  ].filter((role) => role.trim() !== ""))]

  /**
   * The cell record's row for one seat, when the cell already knows it.
   * @param name - the seat's board name.
   * @returns the row, or undefined.
   */
  const cellRowOf = (name: string): CellMemberRecord | undefined => deps.cell.members[name]

  /**
   * Journal one refusal row and mirror it into the pass result.
   * @param taskId - the board id left pending.
   * @param subject - its title.
   * @param reason - the sentence the journal and the skip repeat.
   */
  const refuse = (taskId: string, subject: string, reason: string): void => {
    result.refused.push({ taskId, subject, reason })
    appendSeatJournal(deps, { event: "seat-growth-refused", task: taskId, reason })
  }

  /**
   * Whether the compaction barrier holds one seat on either record.
   * @param row - the live roster row.
   * @returns true when the seat must not receive growth work.
   */
  const seatClosed = (row: GrowthMemberRow): boolean => {
    /** The cell record's row for the same seat, when it exists. */
    const cellRow = cellRowOf(rowName(row))
    if (cellRow !== undefined && fenceReasonOf(cellRow) !== undefined) return true
    return fenceReasonOf({ name: rowName(row), ...(typeof row.mode === "string" ? { mode: row.mode } : {}), ...(row.fenced === true ? { fenced: true } : {}), ...(typeof row.fencedReason === "string" ? { fencedReason: row.fencedReason } : {}) }) !== undefined
  }

  /**
   * Whether one seat is FREE for a hand-over right now, by the plane's own pool rule.
   * @param row - the live roster row.
   * @returns true when the row carries no in-flight claim, is not closed, and was not allocated.
   */
  const seatIdle = (row: GrowthMemberRow): boolean => {
    /** The name. */
    const name = rowName(row)
    if (allocated.has(roleKey(name))) return false
    if (row.status === "failed" || row.status === "provisioning") return false
    if (busy.has(nameKey(name))) return false
    if (typeof row.executorRef === "string" && row.executorRef !== "" && busy.has(nameKey(row.executorRef))) return false
    return !seatClosed(row)
  }

  // THE READY FRONTIER: pending rows whose blockers are satisfied, in board order.
  for (const task of tasks) {
    /** The board id, known non-empty by `growthTaskRows`. */
    const taskId = task.id as string
    if (task.status !== "pending") continue
    if (!blockersSatisfied(tasks, task.blockedBy)) continue
    /** The declared owner name. */
    const owner = typeof task.owner === "string" ? task.owner.trim() : ""
    if (owner === "" || isPlanningSeatName(owner)) continue
    if (excluded.has(taskId)) continue
    // A ROW THE CAPTAIN'S OWN SESSION OWNS IS NEVER GROWN FOR: the captain dispatches, it does not work
    // a lane, and a hand-over to a seat would take a decision the captain already made.
    if (nameKey(owner) === nameKey(deps.cell.captainSessionId) || nameKey(owner) === "captain") continue
    /** The live roster row the owner names. */
    const ownerRow = roster.find((row) => nameKey(rowName(row)) === nameKey(owner))
    if (ownerRow === undefined) continue
    if (ownerRow.status === "failed" || ownerRow.status === "provisioning") continue
    // THE TRIGGER: the owner must HOLD another claim. A merely `running` seat that owns nothing is idle
    // for the plane, so the normal pass pairs the row and growth would only raise a redundant seat.
    /** Whether the owner holds an in-flight row, by name or handle. */
    const ownerBusy = busy.has(nameKey(owner)) || (typeof ownerRow.executorRef === "string" && ownerRow.executorRef !== "" && busy.has(nameKey(ownerRow.executorRef)))
    if (!ownerBusy) continue
    if (seatClosed(ownerRow)) continue
    /** The cell record's own row for the owner, when the cell knows it. */
    const ownerCellRow = cellRowOf(ownerRow.name === undefined ? owner : ownerRow.name)
    // A VERIFIER-ONLY SEAT NEVER GROWS (contract §4.1): its discipline is the verdict lane, and a second
    // seat of it would be a second verdict on work it cannot fix.
    if (ownerCellRow?.mode === "verifier") continue
    /** The base role name the owner's seat belongs to. */
    const base = baseSeatName(owner)
    if (isPlanningSeatName(base)) continue
    /** The canonical roster role for that base, or undefined when the base is not a roster role. */
    const role = rosterRoleFor(base, deps.rosterRoles, recordedRoles, deps.personaFor)
    if (role === undefined) {
      refuse(taskId, task.subject ?? "", "owner base " + JSON.stringify(base) + " is not a roster role")
      continue
    }
    /** The base's comparison key. */
    const baseKey = roleKey(base)
    // 2. REUSE THE SMALLEST IDLE SEAT OF THE SAME ROLE.
    /** The idle seats of this base role, smallest ordinal first. */
    const idleSeats = seatsOfBase(baseKey).filter((row) => seatIdle(row)).sort((left, right) => seatOrdinal(rowName(left)) - seatOrdinal(rowName(right)))
    /** The first reusable seat, when one exists. */
    const reuse = idleSeats[0]
    if (reuse !== undefined) {
      /** The seat's canonical board spelling. */
      const name = rowName(reuse)
      allocated.add(roleKey(name))
      result.reassign.push({ task_id: taskId, owner: name })
      result.reused.push({ name, taskId })
      continue
    }
    // 3. THE CAPS, named in the sentence every surface repeats. Seats grown LATER in this same pass
    // count against both caps, or four ready rows could each pass a one-seat check and overshoot.
    /** The seats already sharing this base role, including the ones this pass grew. */
    const perRoleCount = seatsOfBase(baseKey).length + result.grown.filter((seat) => roleKey(baseSeatName(seat.name)) === baseKey).length
    if (perRoleCount >= caps.perRole) {
      refuse(taskId, task.subject ?? "", seatCapReason(owner, "perRole", caps.perRole))
      continue
    }
    /** The execution seats on the roster, planning excluded, including this pass's grown seats. */
    const executionCount = roster.filter((row) => !isPlanningSeatName(rowName(row))).length + result.grown.length
    if (executionCount >= caps.total) {
      refuse(taskId, task.subject ?? "", seatCapReason(owner, "total", caps.total))
      continue
    }
    // 4. CREATE `<base>-<n>` — the smallest n >= 2 whose name nothing carries.
    /** The new seat's name. */
    let name = ""
    for (let ordinal = 2; ordinal <= 64; ordinal++) {
      /** The candidate spelling. */
      const candidate = base + "-" + String(ordinal)
      if (usedNames.has(roleKey(candidate))) continue
      name = candidate
      break
    }
    if (name === "") {
      refuse(taskId, task.subject ?? "", "no free seat name is left for base " + JSON.stringify(base) + " (names <base>-2 … <base>-64 are all taken)")
      continue
    }
    usedNames.add(roleKey(name))
    /** The append's answer. */
    let added: { handle: string; error?: string }
    try {
      added = readAddMemberAnswer(await deps.dsh.executeTool({
        name: "agent_teams_plan",
        arguments: {
          action: "add_member",
          member: { name, role, description: name, prompt: grownSeatPrompt(deps.cell, name, role, deps.personaFor(role)) },
        },
        agent: deps.captainAgent,
      }))
    } catch (error) {
      added = { handle: "", error: error instanceof Error ? error.message : String(error) }
    }
    // A DUPLICATE IS A RECONCILIATION, NOT A FAILURE (the same rule activation applies): a seat raised
    // by a crashed pass is adopted from the roster instead of failing the whole growth.
    if (added.error !== undefined && added.error.includes("is already on the roster")) {
      /** The freshly read board, when the caller exposes the seam. */
      const refreshed = refreshOf(deps)
      /** The live row that already holds the name. */
      const live = growthMemberRows(refreshed?.members).find((row) => roleKey(rowName(row)) === roleKey(name))
      if (live === undefined) {
        refuse(taskId, task.subject ?? "", "could not adopt " + JSON.stringify(name) + ": the roster reports it already present but the row is not readable")
        continue
      }
      recordGrownSeat(deps, result, live, name, role, taskId, allocated)
      continue
    }
    if (added.error !== undefined) {
      refuse(taskId, task.subject ?? "", "cellwork seat growth could not raise " + JSON.stringify(name) + ": " + added.error)
      continue
    }
    // §7.1b: READ THE MEMBER RECORD BACK. The mid-run append arm was measured dropping `role`, so the
    // seat is recorded with the role we REQUESTED but the answer REPORTS what the roster actually holds.
    /** The freshly read board, when the caller exposes the seam. */
    const refreshed = refreshOf(deps)
    /** The live row the append wrote, when readable. */
    const live = growthMemberRows(refreshed?.members).find((row) => roleKey(rowName(row)) === roleKey(name))
    /** The role the roster actually carries. */
    const rosterRole = live !== undefined && typeof live.role === "string" ? live.role : ""
    /** The handle the row (or the answer) carries. */
    const handle = live !== undefined && typeof live.executorRef === "string" && live.executorRef !== "" ? live.executorRef : added.handle
    recordGrownSeat(deps, result, { name, role: rosterRole, ...(live?.status === undefined ? {} : { status: live.status }), executorRef: handle }, name, role, taskId, allocated, rosterRole)
  }
  return result
}

/**
 * Re-read the live board through the caller's optional seam.
 *
 * @param deps - the growth pass.
 * @returns the refreshed record, or undefined when the seam is absent or throws.
 */
function refreshOf(deps: SeatGrowthDeps): Record<string, unknown> | undefined {
  try {
    return deps.refreshRecord?.()
  } catch {
    return undefined
  }
}

/**
 * Append one seat journal row through the SAME O(1) append path every other row uses.
 *
 * @param deps - the growth pass (workspace, cell id and instant).
 * @param entry - the row's fields; `at` is stamped by the append.
 */
function appendSeatJournal(deps: SeatGrowthDeps, entry: Record<string, unknown>): void {
  try {
    appendJournal(deps.workspace, deps.cell.cellId, entry, deps.now)
  } catch {
    // History is best-effort; the returned result carries the decision even when the row cannot land.
  }
}

/**
 * Record one seat this pass RAISED (or adopted): the member row, the journal row, the §7.1b warning and
 * the hand-over the caller passes into the plane's dispatch.
 *
 * @param deps - the growth pass.
 * @param result - the result being built.
 * @param live - the live roster row (or the name/handle the append answered with).
 * @param name - the seat's canonical board name.
 * @param role - the role the seat was requested with.
 * @param taskId - the ready board id the seat is claimed for.
 * @param allocated - the seats this pass already took, so one seat never takes two rows.
 * @param observedRole - the role the roster row actually carries; the requested one when the caller did not read it back.
 */
function recordGrownSeat(deps: SeatGrowthDeps, result: SeatGrowthResult, live: GrowthMemberRow, name: string, role: string, taskId: string, allocated: Set<string>, observedRole?: string): void {
  /** The seat's board name, spelled the way the roster spells it. */
  const liveName = rowName(live) !== "" ? rowName(live) : name
  /** The handle the seat carries. */
  const handle = typeof live.executorRef === "string" ? live.executorRef : ""
  /** The role the roster actually holds, when the caller read it back. */
  const rosterRole = observedRole ?? (typeof live.role === "string" ? live.role : "")
  result.members[liveName] = {
    name: liveName,
    role,
    sessionId: handle,
    executorRef: handle,
    mode: "member",
    handoffReady: false,
    handoffs: 0,
    joinedAt: deps.now.toISOString(),
    grown: true,
  }
  allocated.add(roleKey(liveName))
  // §7.1b: REPORT WHAT LANDED. A mid-run member with no `role` mis-routes, so the gap is named in the
  // answer and in the journal row instead of being assumed away.
  if (rosterRole === "") result.warnings.push("the mid-run `add_member` arm recorded no `role` for " + JSON.stringify(liveName) + " (§7.1b) — routing falls back until the plan store persists it")
  appendSeatJournal(deps, { event: "seat-grown", task: taskId, name: liveName, role, rosterRole, reason: "owner-busy" })
  result.grown.push({ name: liveName, role, taskId, rosterRole, reason: "owner-busy" })
  // A HANDLE-LESS SEAT CANNOT BE HANDED A ROW: the plane's reassign refuses a target it cannot deliver
  // to, so the row stays pending and the seat waits for the next pass instead of faking a claim.
  if (handle === "") {
    result.refused.push({ taskId, subject: "", reason: "seat " + JSON.stringify(liveName) + " was raised but carries no executor handle yet, so the row stays pending for the next pass" })
    return
  }
  result.reassign.push({ task_id: taskId, owner: liveName })
}
