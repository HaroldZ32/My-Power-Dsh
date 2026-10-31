// CELLWORK DISPATCH — pair READY tasks with their DECLARED owner, and nothing else (contract B7).
//
// WHY NOT `agent_teams_dispatch`: that tool's decision is OWNER-FIRST but falls back to roster order when
// the declared owner is busy, absent or unnamed (AGENTS.md §5 rule 5, measured 2026-10-07 sending review
// work to a writer). Cellwork must NOT inherit that fallback — a review task landing on its own writer
// destroys the only independence the wave has. This module therefore reimplements the small pairing
// DECISION inside the cell (the captain ratified this; no team-core import), pairs at most one task per
// member per pass, and reports every task it leaves alone.
//
// DELIVERY IS THE EXECUTOR'S: `dsh.teamExecutor().send(captainAgent, member.executorRef, text)` — the
// native backend cold-resumes a member that is not currently live. The member then CLAIMS the task
// itself (`agent_teams_task {action:"claim"}`); the PASS itself does not write the board, so the record
// never claims work nobody has started. The ONE board write in this module is the explicit
// `cellwork_dispatch {reassign}` repair below, which claims a row FOR a member on the captain's own
// instruction (a fenced owner never claims anything).
//
// A FENCED MEMBER IS NEVER MESSAGED (contract C7). Fenced means its cell record says `mode: checkpoint`,
// or `handoffReady`, or the compaction barrier gave up and marked it `fenced`. Waking such a member burns
// the retry budget on a claim its own guard refuses — the defect this rule removes (D4/D5: four
// deliveries of one ticket, then three handoffs in seven minutes) — so the pass reports it by name
// together with the repair (`reassign`) and leaves the row pending.
import { appendJournal, contractPath, type CellState } from "./state"
import type { DshTeamExecutor } from "../../mpd-dsh-adapter-plugin/src/index"
import { cellDir } from "./state"

/** The team-task fields this pass reads (structural: the mpdTeams service is read, never imported). */
export interface DispatchTaskView {
  /** Board id (`T1`, …). */
  id?: string
  /** The task title. */
  subject?: string
  /** The owner's acceptance text. */
  description?: string
  /** `pending` is the only status this pass dispatches. */
  status?: string
  /** Blocker references, as stored (ids when they resolved). */
  blockedBy?: readonly string[]
  /** The DECLARED owner name. */
  owner?: string
  /** The task kind (`review` matters only for the message). */
  kind?: string
  /** The paths the task may write. */
  writeScopes?: readonly string[]
}

/** The team-member fields this pass reads. */
export interface DispatchMemberView {
  /** Board name. */
  name?: string
  /** Roster role label. */
  role?: string
  /** `provisioning` | `running` | `inactive` | `failed`. */
  status?: string
  /** The executor's handle — the only address `executor.send` accepts. */
  executorRef?: string
  /** The cell record's member mode, when the caller passes the CELL row rather than the team one. */
  mode?: string
  /** Whether the member's handoff is written and waiting for the compaction barrier. */
  handoffReady?: boolean
  /** The compaction barrier's explicit fence marker (see {@link fenceReasonOf}). */
  fenced?: boolean
  /** Why the barrier fenced the member, quoted in the skip reason. */
  fencedReason?: string
}

/**
 * The fields that FENCE a member: the cell record's own mode/handoff state plus the barrier's markers.
 *
 * Both the CELL row (`CellMemberRecord`, where `mode`/`handoffReady` live) and a team-roster row
 * satisfy it, so the fence is decided once, by {@link fenceReasonOf}, wherever it is asked.
 */
export interface FenceableView {
  /** The member's board name, when the row carries one (the normalised match reads it). */
  name?: string
  /** `member` | `verifier` | `checkpoint` | `subcaptain`, as the cell record stores it. */
  mode?: string
  /** Whether a handoff is written and waiting for the compaction barrier. */
  handoffReady?: boolean
  /** The barrier's explicit marker: compaction gave up, so the owner must be reassigned. */
  fenced?: boolean
  /** Why the barrier fenced the member. */
  fencedReason?: string
}

/** The team record slice this pass reads. */
export interface DispatchRecordView {
  /** The team id (journaled on each delivery). */
  teamId?: string
  /** The roster. */
  members?: readonly DispatchMemberView[]
  /** The board. */
  tasks?: readonly DispatchTaskView[]
}

/** What {@link dispatchOwnerOnly} needs: the cell, the live record and a bound delivery. */
export interface DispatchDeps {
  /** The workspace root the caller resolved through the adapter. */
  workspace: string
  /** The cell being dispatched (its id stamps the message and the journal). */
  cell: CellState
  /** The live team record, or undefined when the team service cannot read it. */
  record: DispatchRecordView | undefined
  /** Deliver one message to one member handle; the caller binds the captain agent and the executor. */
  send: (handle: string, content: string) => Promise<void>
  /** The instant to journal with. */
  now: Date
  /**
   * A member's CURRENT handle, when the caller knows a fresher one than the record carries.
   *
   * The reseed path (a member raised afresh from its handoff) writes the new handle onto the CELL record;
   * the team record's `executorRef` still names the settled child, so delivery must prefer this.
   */
  handleFor?: (memberName: string) => string | undefined
  /**
   * Board ids the CELL has cancelled.
   *
   * A later split revision drops work without deleting its row (the team plane offers no cancel verb),
   * so the row is still `pending` on the board; pairing it would wake a member for work the accepted
   * graph no longer contains. The ids come from `CellState.cancelledTasks`.
   */
  excludedTaskIds?: readonly string[]
}

/** One recorded delivery. */
export interface DispatchPair {
  /** The board task id. */
  taskId: string
  /** The task title. */
  subject: string
  /** The declared owner's board name. */
  memberName: string
  /** The executor handle the message went to. */
  handle: string
}

/** One task this pass deliberately did NOT dispatch, with the reason. */
export interface DispatchSkip {
  /** The board task id. */
  taskId: string
  /** The task title. */
  subject: string
  /** Why it was left alone (ready tasks name the owner problem; unready tasks name the blockers). */
  reason: string
}

/** The pass's answer: what went out and what did not. */
export interface DispatchReport {
  /** The deliveries the executor accepted. */
  pairs: DispatchPair[]
  /** Every task left out, with its reason. */
  skipped: DispatchSkip[]
  /** Why the pass could not run at all (`no team record`, `no executor`); absent on a real pass. */
  refused?: string
}

/**
 * The name key two spellings must agree on: lowercase, non-alphanumerics collapsed to `-`, trimmed.
 *
 * Deliberately the same rule team-core's own dispatch uses, reimplemented here because cellwork must not
 * import another package's src (the frozen coupling inventory may only shrink).
 *
 * @param name - a member or owner spelling.
 * @returns the comparison key.
 */
export function nameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
}

/**
 * Whether one task's blockers are satisfied (OPT-1: a FAILED blocker releases its dependents).
 *
 * @param task - the task being checked.
 * @param byId - the board indexed by id.
 * @returns true when every blocker resolved and reached a terminal state that releases work.
 */
export function blockersSatisfied(task: DispatchTaskView, byId: ReadonlyMap<string, DispatchTaskView>): boolean {
  for (const reference of task.blockedBy ?? []) {
    /** The blocker's row, when the board holds it. */
    const blocker = byId.get(reference)
    if (blocker === undefined) return false
    if (blocker.status !== "completed" && blocker.status !== "failed") return false
  }
  return true
}

/**
 * Whether one member already owns live work (claimed or in progress).
 *
 * A member that owns an open row is BUSY: the owner-only rule reports it instead of substituting another
 * member, and pairing it twice in one pass would send two tasks to one context.
 *
 * @param tasks - the board.
 * @param memberName - the member's board name.
 * @returns true when an open task credits that owner.
 */
export function memberIsBusy(tasks: readonly DispatchTaskView[], memberName: string): boolean {
  /** The member's comparison key. */
  const key = nameKey(memberName)
  return tasks.some((task) => (task.status === "claimed" || task.status === "in_progress") && nameKey(String(task.owner ?? "")) === key)
}

/**
 * Resolve one declared owner name against the roster.
 *
 * An exact match wins; the normalised key is the fallback, so `Senior Engineer` and `senior-engineer`
 * address one member.
 *
 * @param members - the roster.
 * @param owner - the declared owner spelling.
 * @returns the member row, or undefined when the roster does not name it.
 */
export function resolveOwner(members: readonly DispatchMemberView[], owner: string): DispatchMemberView | undefined {
  /** The trimmed spelling. */
  const trimmed = owner.trim()
  if (trimmed === "") return undefined
  /** The exact match, which is the board's own spelling and therefore preferred. */
  const exact = members.find((member) => String(member.name ?? "") === trimmed)
  if (exact !== undefined) return exact
  /** The key the owner spelling collapses to. */
  const key = nameKey(trimmed)
  return members.find((member) => nameKey(String(member.name ?? "")) === key)
}

/**
 * Why one member cannot be woken, or undefined when it can (contract C7).
 *
 * THREE signals fence a member, and the record's own `mode`/`handoffReady` are the durable ones: the
 * barrier may be refused after its retries, so a `checkpoint` seat with a written handoff IS the fence
 * even before the explicit `fenced` marker is written. The marker names the cause when the barrier gave
 * up, which is what makes the report actionable.
 *
 * @param member - the member row, from the CELL record where it exists and the team record otherwise.
 * @returns the one-sentence reason, or undefined when the member may be messaged.
 */
export function fenceReasonOf(member: FenceableView | undefined): string | undefined {
  if (member === undefined) return undefined
  if (member.fenced === true) {
    return "the compaction barrier gave up and fenced it" + (typeof member.fencedReason === "string" && member.fencedReason !== "" ? " (" + member.fencedReason + ")" : "")
  }
  if (member.mode === "checkpoint") return "its mode is `checkpoint` — the seat is fenced to the handoff tools until the barrier compacts it"
  if (member.handoffReady === true) return "a handoff is already written and waiting for the compaction barrier"
  return undefined
}

/**
 * The CELL record's own row for one member, which is where the fence is recorded.
 *
 * Exact name first, then the dispatch name key, because a cell row and a board row may spell the same
 * member differently (`Senior Engineer` / `senior-engineer`).
 *
 * @param cell - the cell whose member table is searched (`members` is optional so a partial test double works).
 * @param memberName - the member's board name.
 * @returns the member row, or undefined when this cell record never learned the member.
 */
export function cellMemberOf(cell: { members?: Readonly<Record<string, FenceableView>> }, memberName: string): FenceableView | undefined {
  /** The member table, defaulted so a record this build cannot read answers "unknown member". */
  const members = cell.members ?? {}
  /** The exact spelling, which is the cell record's own key and therefore preferred. */
  const exact = members[memberName]
  if (exact !== undefined) return exact
  /** The key the requested spelling collapses to. */
  const key = nameKey(memberName)
  for (const [name, row] of Object.entries(members)) {
    if (nameKey(name) === key || nameKey(String(row.name ?? "")) === key) return row
  }
  return undefined
}

/**
 * A USABLE executor handle, or null when the value is absent or blank (repair R-A2, CR #4).
 *
 * `??` is not enough here: a cell record writes `executorRef: ""` for a member whose handle it never
 * learned, and `"" ?? liveRosterHandle` answers `""` — so a blank cell value SHADOWED a perfectly good
 * roster handle and the dispatch skipped the member as "never raised". Empty and whitespace-only both
 * mean absent; anything else is handed back trimmed.
 *
 * @param value - the candidate handle, read as untrusted (a record from any build).
 * @returns the trimmed handle, or null when there is none.
 */
export function handleOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null
  /** The handle without the surrounding blanks, which are never part of an id. */
  const trimmed = value.trim()
  return trimmed === "" ? null : trimmed
}

/**
 * The SPLIT KEY a board task id was materialised from, when the cell record still knows it.
 *
 * The contract file is named by the SPLIT KEY (`contracts/<key>.md`, the path activation writes and
 * `mpd_verify_open` freezes), while the board mints its OWN id (`T3`, …). A dispatched member must be
 * told the file that EXISTS, so the board id is inverted through `CellState.activatedTasks` — the map
 * every activation records — instead of being used as a file name (Amendment 6 R1).
 *
 * @param cell - the cell whose mapping is read.
 * @param boardId - the board task id the dispatch is pairing.
 * @returns the split key, or undefined for a record written before the mapping existed.
 */
function splitKeyOfBoardId(cell: Pick<CellState, "activatedTasks">, boardId: string): string | undefined {
  /** The mapping as this build writes it, defaulted for a record from an older build. */
  const mapping = cell.activatedTasks ?? {}
  for (const [key, id] of Object.entries(mapping)) {
    if (id === boardId) return key
  }
  return undefined
}

/**
 * Build the dispatch message one member receives.
 *
 * @param deps - the cell and workspace the message is built for.
 * @param task - the board task being handed over.
 * @param boardId - the task's board id (the id the member claims).
 * @returns the message text.
 */
export function dispatchMessageFor(deps: Pick<DispatchDeps, "workspace" | "cell">, task: DispatchTaskView, boardId: string): string {
  /** The split key this board row was materialised from, when the cell record still maps it. */
  const splitKey = splitKeyOfBoardId(deps.cell, boardId)
  /** The relative contract path the verifier's loop froze, or null when the key cannot be resolved. */
  const contract = splitKey === undefined ? null : contractRelativePath(deps.cell.cellId, splitKey)
  /** The write scopes, or an explicit "no code" line. */
  const scopes = (task.writeScopes ?? []).length === 0 ? "(this task declares no write scope — it produces no code)" : (task.writeScopes ?? []).join(", ")
  return [
    "[mpd-cellwork] cell " + deps.cell.cellId + " — your task " + boardId + ": " + String(task.subject ?? ""),
    "",
    String(task.description ?? ""),
    "",
    "CLAIM IT FIRST: agent_teams_task {action:\"claim\", task_id:\"" + boardId + "\"}.",
    "WRITE ONLY INSIDE: " + scopes,
    ...((task.writeScopes ?? []).length === 0
      ? []
      : contract === null
        ? ["FROZEN CONTRACT: this cell record carries no split-key mapping for task " + boardId + ", so the contract path cannot be named here — call `cellwork_status` and use the contract your verification loop froze."]
        : ["FROZEN CONTRACT (your verifier reads this; yours is the same deliverable): " + contract]),
    "WHEN DONE: agent_teams_task {action:\"complete\", task_id:\"" + boardId + "\", note:\"<one line>\"}.",
    "IF BLOCKED OR THE USER MUST DECIDE: mail the captain — the captain relays every user question.",
    "IF THE PLUGIN TELLS YOU TO CHECKPOINT: call cellwork_handoff, then end your turn.",
  ].join("\n")
}

/**
 * The workspace-relative frozen-contract path for one board task id.
 *
 * @param cellId - the cell the contract belongs to.
 * @param boardId - the board task id.
 * @returns `.mpd/cellwork/<cellId>/contracts/<boardId>.md` (the path `mpd_verify_open` records).
 */
export function contractRelativePath(cellId: string, boardId: string): string {
  return [".mpd", "cellwork", cellId, "contracts", boardId + ".md"].join("/")
}

/**
 * Run ONE owner-only dispatch pass over the live board.
 *
 * @param deps - the cell, the record and the delivery binding.
 * @returns the pairs delivered and every task left out with its reason.
 */
export async function dispatchOwnerOnly(deps: DispatchDeps): Promise<DispatchReport> {
  /** The report being built. */
  const report: DispatchReport = { pairs: [], skipped: [] }
  if (deps.record === undefined) {
    report.refused = "the live team record could not be read, so no task can be paired"
    return report
  }
  /** The board, defaulted to empty for a record this build cannot read. */
  const tasks = Array.isArray(deps.record.tasks) ? deps.record.tasks : []
  /** The roster, defaulted the same way. */
  const members = Array.isArray(deps.record.members) ? deps.record.members : []
  /** The board indexed by id, for blocker resolution. */
  const byId = new Map(tasks.map((task) => [String(task.id ?? ""), task]))
  /** Members already paired in THIS pass (at most one task each). */
  const paired = new Set<string>()
  /** The cancelled ids as a lookup, so the check below is one hash probe per task. */
  const excluded = new Set((deps.excludedTaskIds ?? []).filter((id) => id !== ""))
  for (const task of tasks) {
    /** The task's board id, or "" for a malformed row. */
    const taskId = String(task.id ?? "")
    if (taskId === "") continue
    /** The task's title, for the report. */
    const subject = String(task.subject ?? "")
    if (excluded.has(taskId)) {
      report.skipped.push({ taskId, subject, reason: "CANCELLED by a later split revision — the row is kept on the board and never dispatched" })
      continue
    }
    if (task.status !== "pending") {
      report.skipped.push({ taskId, subject, reason: "not pending (status " + String(task.status ?? "unknown") + ")" })
      continue
    }
    if (!blockersSatisfied(task, byId)) {
      report.skipped.push({ taskId, subject, reason: "not ready (blocked by " + ((task.blockedBy ?? []).join(", ") || "a reference that names no task") + ")" })
      continue
    }
    /** The declared owner spelling. */
    const owner = String(task.owner ?? "").trim()
    if (owner === "") {
      report.skipped.push({ taskId, subject, reason: "no declared owner — cellwork pairs ONLY the declared owner" })
      continue
    }
    /** The roster row the owner names. */
    const member = resolveOwner(members, owner)
    if (member === undefined) {
      report.skipped.push({ taskId, subject, reason: "declared owner " + JSON.stringify(owner) + " is not on the roster — no substitution is made" })
      continue
    }
    /** The owner's board name. */
    const memberName = String(member.name ?? owner)
    // THE FENCE COMES FIRST (C7): a fenced member's own guard refuses the claim the message would ask
    // for, so delivering it is the livelock defect D4/D5 recorded — reported here, never messaged.
    /** Why this owner cannot be woken, read from the CELL row first (where `mode`/`handoffReady` live). */
    const fence = fenceReasonOf(cellMemberOf(deps.cell, memberName)) ?? fenceReasonOf(member)
    if (fence !== undefined) {
      report.skipped.push({ taskId, subject, reason: "declared owner " + JSON.stringify(memberName) + " is FENCED (" + fence + ") — a fenced member is never messaged; reassign the row: cellwork_dispatch {reassign:[{task_id:" + JSON.stringify(taskId) + ", owner:\"<another member>\"}]}" })
      continue
    }
    if (member.status === "failed") {
      report.skipped.push({ taskId, subject, reason: "declared owner " + JSON.stringify(memberName) + " FAILED to start" })
      continue
    }
    if (member.status === "provisioning") {
      report.skipped.push({ taskId, subject, reason: "declared owner " + JSON.stringify(memberName) + " is still being raised" })
      continue
    }
    if (paired.has(nameKey(memberName))) {
      report.skipped.push({ taskId, subject, reason: "declared owner " + JSON.stringify(memberName) + " was already paired in this pass (one task per member)" })
      continue
    }
    if (memberIsBusy(tasks, memberName)) {
      report.skipped.push({ taskId, subject, reason: "declared owner " + JSON.stringify(memberName) + " is BUSY on another task — reported, never substituted" })
      continue
    }
    /** The executor handle the message must address (the fresher NON-BLANK one wins — repair R-A2). */
    const handle = handleOrNull(deps.handleFor?.(memberName)) ?? handleOrNull(member.executorRef)
    if (handle === null) {
      report.skipped.push({ taskId, subject, reason: "declared owner " + JSON.stringify(memberName) + " has no executor handle (never raised)" })
      continue
    }
    try {
      await deps.send(handle, dispatchMessageFor(deps, task, taskId))
    } catch (error) {
      report.skipped.push({ taskId, subject, reason: "the message to " + JSON.stringify(memberName) + " failed: " + errorText(error) })
      continue
    }
    paired.add(nameKey(memberName))
    report.pairs.push({ taskId, subject, memberName, handle })
    appendJournal(deps.workspace, deps.cell.cellId, { event: "dispatch", taskId, member: memberName, teamId: String(deps.record.teamId ?? "") }, deps.now)
  }
  return report
}

/**
 * One `cellwork_dispatch {reassign}` pair, already validated (see {@link reassignPairs}).
 */
export interface ReassignPair {
  /** The board row being handed over. */
  taskId: string
  /** The member the row is claimed FOR and delivered to. */
  owner: string
}

/**
 * What one reassignment did — reported for every path, never thrown (contract C6).
 */
export interface ReassignOutcome {
  /** The board row this outcome is about. */
  taskId: string
  /** The member name the row was handed to (the roster's own spelling once resolved). */
  owner: string
  /** Whether the board row is claimed for that member. */
  claimed: boolean
  /** Whether the dispatch message reached that member's handle. */
  delivered: boolean
  /** Why the reassignment stopped short, when it did. */
  reason?: string
}

/**
 * What {@link applyReassignments} needs: the cell, the board and the two side effects it may perform.
 */
export interface ReassignDeps {
  /** The workspace root the caller resolved through the adapter. */
  workspace: string
  /** The cell being dispatched (its id stamps the message and the journal row). */
  cell: CellState
  /** The live team record, or undefined when the team service cannot be read. */
  record: DispatchRecordView | undefined
  /** The pairs to apply, in the caller's order. */
  pairs: readonly ReassignPair[]
  /** Claim one row for one member through the board; resolves `ok:false` instead of throwing. */
  claim: (taskId: string, owner: string) => Promise<{ ok: boolean; error?: string }>
  /** Deliver one message to one member handle. */
  send: (handle: string, content: string) => Promise<void>
  /** The instant to journal with. */
  now: Date
  /** A member's CURRENT handle, when the caller knows a fresher one than the record carries. */
  handleFor?: (memberName: string) => string | undefined
}

/**
 * Read the `reassign` argument of `cellwork_dispatch` without trusting its shape.
 *
 * The harness validates the tool schema, but this handler is also reached by a test double and by a
 * composition running an older schema, so every entry is checked here. A blank id, a blank owner or the
 * same row named twice is REPORTED as one sentence (the readable entries still apply) rather than thrown.
 *
 * @param value - the raw argument value.
 * @returns the readable pairs, and one sentence per entry this build refused.
 */
export function reassignPairs(value: unknown): { pairs: ReassignPair[]; invalid: string[] } {
  /** The readable pairs, in the caller's order. */
  const pairs: ReassignPair[] = []
  /** One sentence per entry that could not be read. */
  const invalid: string[] = []
  if (value === undefined) return { pairs, invalid }
  if (!Array.isArray(value)) return { pairs, invalid: ["`reassign` must be an array of {task_id, owner} objects"] }
  /** The ids already asked for, so one row is never claimed twice in one call. */
  const seen = new Set<string>()
  for (const entry of value) {
    /** The entry read as a record, or undefined when it is not an object. */
    const row = typeof entry === "object" && entry !== null && !Array.isArray(entry) ? entry as Record<string, unknown> : undefined
    /** The board id this entry names, trimmed. */
    const taskId = typeof row?.task_id === "string" ? row.task_id.trim() : ""
    /** The member name this entry names, trimmed. */
    const owner = typeof row?.owner === "string" ? row.owner.trim() : ""
    if (taskId === "" || owner === "") {
      invalid.push("every `reassign` entry needs a non-empty `task_id` and `owner` (got " + JSON.stringify(entry) + ")")
      continue
    }
    if (seen.has(taskId)) {
      invalid.push("task " + JSON.stringify(taskId) + " is named twice in `reassign` — one claim per row per call")
      continue
    }
    seen.add(taskId)
    pairs.push({ taskId, owner })
  }
  return { pairs, invalid }
}

/**
 * Claim each named row for its new member, journal the hand-over, then deliver the dispatch message.
 *
 * THE ORDER IS THE CONTRACT (C6): the board write lands BEFORE the message, so a member never receives
 * work it cannot see on the board, and the journal row is written between them so the hand-over survives
 * a crash of either half. Every failure is an entry in the answer — nothing here throws.
 *
 * The target is checked BEFORE the claim: a member this cell never raised has no handle, and claiming a
 * row for someone who cannot be woken would hide the row from the next pass.
 *
 * @param deps - the cell, the board, the claim seam and the delivery.
 * @returns one outcome per pair, in the caller's order.
 */
export async function applyReassignments(deps: ReassignDeps): Promise<ReassignOutcome[]> {
  /** One outcome per pair, in the caller's order. */
  const outcomes: ReassignOutcome[] = []
  /** The live board, defaulted to empty for a record this build cannot read. */
  const tasks = Array.isArray(deps.record?.tasks) ? deps.record.tasks : []
  /** The live roster, defaulted the same way. */
  const members = Array.isArray(deps.record?.members) ? deps.record.members : []
  for (const pair of deps.pairs) {
    /** The board row the pair names. */
    const task = tasks.find((row) => String(row.id ?? "") === pair.taskId)
    if (task === undefined) {
      outcomes.push({ taskId: pair.taskId, owner: pair.owner, claimed: false, delivered: false, reason: "no board row is named " + JSON.stringify(pair.taskId) + " — nothing was reassigned" })
      continue
    }
    /** The row's status, which a terminal row must not be reopened from. */
    const status = String(task.status ?? "")
    if (status === "completed" || status === "failed") {
      outcomes.push({ taskId: pair.taskId, owner: pair.owner, claimed: false, delivered: false, reason: "row " + pair.taskId + " is already " + status + " — a terminal row is never reopened" })
      continue
    }
    /** The roster row the requested owner names. */
    const member = resolveOwner(members, pair.owner)
    if (member === undefined) {
      outcomes.push({ taskId: pair.taskId, owner: pair.owner, claimed: false, delivered: false, reason: "the roster does not name " + JSON.stringify(pair.owner) + " — no substitution is made" })
      continue
    }
    /** The owner's board name, as the roster spells it. */
    const memberName = String(member.name ?? pair.owner)
    /** Why this target cannot be woken, when that is the case (a fenced member is never messaged). */
    const fence = fenceReasonOf(cellMemberOf(deps.cell, memberName)) ?? fenceReasonOf(member)
    if (fence !== undefined) {
      outcomes.push({ taskId: pair.taskId, owner: memberName, claimed: false, delivered: false, reason: "the target member " + JSON.stringify(memberName) + " is FENCED (" + fence + ") — pick an unfenced member" })
      continue
    }
    // THE TARGET'S OWN STATUS IS CHECKED BEFORE THE CLAIM (repair R-A1, CR #2): a FAILED member can still
    // carry a recorded handle, so claiming a row for it would move the row to `in_progress` where no later
    // pass picks it up — the exact hazard the fence check above exists to prevent. The rule is the same
    // one `dispatchOwnerOnly` applies to an owner, so both paths refuse the same members.
    if (member.status === "failed") {
      outcomes.push({ taskId: pair.taskId, owner: memberName, claimed: false, delivered: false, reason: "the target member " + JSON.stringify(memberName) + " FAILED to start — a row claimed for it would never be picked up; pick a member that is running" })
      continue
    }
    if (member.status === "provisioning") {
      outcomes.push({ taskId: pair.taskId, owner: memberName, claimed: false, delivered: false, reason: "the target member " + JSON.stringify(memberName) + " is still being raised — retry the reassignment once it is running" })
      continue
    }
    /** The executor handle the message would go to (the fresher NON-BLANK one wins — repair R-A2). */
    const handle = handleOrNull(deps.handleFor?.(memberName)) ?? handleOrNull(member.executorRef)
    if (handle === null) {
      outcomes.push({ taskId: pair.taskId, owner: memberName, claimed: false, delivered: false, reason: "the target member " + JSON.stringify(memberName) + " has no executor handle (never raised) — claiming the row for it would hide the row from the next pass" })
      continue
    }
    /** The member the row is being taken from, for the journal row. */
    const previous = String(task.owner ?? "").trim()
    /** The board's answer to the claim; a throw from the seam is reported, never propagated. */
    let claimed: { ok: boolean; error?: string }
    try {
      claimed = await deps.claim(pair.taskId, memberName)
    } catch (error) {
      claimed = { ok: false, error: errorText(error) }
    }
    if (!claimed.ok) {
      outcomes.push({ taskId: pair.taskId, owner: memberName, claimed: false, delivered: false, reason: "the board refused the claim: " + (claimed.error ?? "unknown refusal") })
      continue
    }
    appendJournal(deps.workspace, deps.cell.cellId, { event: "task-reassigned", taskId: pair.taskId, from: previous, to: memberName, member: memberName }, deps.now)
    try {
      await deps.send(handle, dispatchMessageFor(deps, task, pair.taskId))
    } catch (error) {
      outcomes.push({ taskId: pair.taskId, owner: memberName, claimed: true, delivered: false, reason: "the row IS claimed for " + JSON.stringify(memberName) + " but the message failed: " + errorText(error) })
      continue
    }
    outcomes.push({ taskId: pair.taskId, owner: memberName, claimed: true, delivered: true })
  }
  return outcomes
}

/**
 * Build the bound delivery for one activation pass.
 *
 * @param executor - the adapter's team executor (the ONE seam that reaches a member).
 * @param captainAgent - the live Lead agent the delivery is authorized by.
 * @returns the delivery function, or undefined when the composition has no executor seam.
 */
export function sendThroughExecutor(executor: Pick<DshTeamExecutor, "send"> | undefined, captainAgent: unknown): ((handle: string, content: string) => Promise<void>) | undefined {
  if (executor === undefined || typeof executor.send !== "function") return undefined
  return async (handle: string, content: string): Promise<void> => {
    await executor.send(captainAgent, handle, content)
  }
}

/**
 * The absolute contract path of one task in one cell (`<cell>/contracts/<taskKey>.md`).
 *
 * @param workspace - the workspace root the caller resolved through the adapter.
 * @param cellId - the cell.
 * @param taskKey - the split task key (also the board id once activated).
 * @returns the absolute path.
 */
export function absoluteContractPath(workspace: string, cellId: string, taskKey: string): string {
  return contractPath(workspace, cellId, taskKey)
}

/**
 * The absolute cell directory of one cell, re-exported for the activation writer.
 *
 * @param workspace - the workspace root the caller resolved through the adapter.
 * @param cellId - the cell.
 * @returns the absolute directory.
 */
export function cellDirOf(workspace: string, cellId: string): string {
  return cellDir(workspace, cellId)
}

/**
 * A message from an unknown thrown value, without assuming it is an Error.
 *
 * @param error - the thrown value.
 * @returns its message text.
 */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
