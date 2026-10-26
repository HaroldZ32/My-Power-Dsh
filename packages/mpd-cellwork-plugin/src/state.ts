// Cell-work STATE — the workspace-scoped cell RECORD, its append-only journal and its on-disk layout.
//
// WHERE A CELL LIVES (contract B3). `<ws>/.mpd/cellwork/<cellId>/` holds `state.json`, the
// append-only `journal.jsonl`, `requirements.md`, `split/<rev>.json`, `contracts/<taskKey>.md` and
// `handoff/<member>-<n>.md`. Nothing is written outside that directory except the team board and the
// verify plane, so "archiving" a cell is leaving its directory in place and marking the record
// stopped — never a deletion.
//
// THE ROOT IS PASSED IN, PER CALL. Callers hand this module the value `dsh.workspaceRoot(exec)`
// returned; nothing here reads `process.cwd()` and no root is cached in a module constant, so one host
// serving several workspaces cannot write a cell into the wrong tree.
//
// A CORRUPT STATE IS A REFUSAL, NOT A RESET. {@link readCell} separates `missing` (no cell with that
// id), `corrupt` (unparsable JSON or a wrong-shaped record), `version` (a schema version this build
// does not read) and `unreadable` (an I/O failure). Every failure names the absolute path, and nothing
// here deletes or rewrites a record it could not read.
//
// WRITES ARE ATOMIC (tmp file + rename in the SAME directory, so the rename cannot cross a
// filesystem), and the journal is opened in append mode only — a torn journal line is therefore
// possible in principle and never trusted as state: `state.json` is the truth, the journal is history.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

/** The schema version this build reads and writes; a record carrying any other value is REFUSED. */
export const CELLWORK_STATE_VERSION = 1

/** Path segments from the workspace root to the cell root, joined by {@link cellworkRoot}. */
export const CELLWORK_ROOT_SEGMENTS: readonly string[] = [".mpd", "cellwork"]

/** The record file name inside one cell directory. */
export const CELL_STATE_FILE = "state.json"
/** The append-only history file name inside one cell directory. */
export const CELL_JOURNAL_FILE = "journal.jsonl"
/** The validated requirements document handed to the splitter. */
export const CELL_REQUIREMENTS_FILE = "requirements.md"
/** Subdirectory holding one measured split per revision (`<rev>.json`). */
export const CELL_SPLIT_DIR = "split"
/** Subdirectory holding one frozen acceptance contract per code task. */
export const CELL_CONTRACTS_DIR = "contracts"
/** Subdirectory holding one handoff document per checkpoint. */
export const CELL_HANDOFF_DIR = "handoff"

/** The four phases of a cell; `stopped` is terminal and is what "archived" means on disk. */
export type CellPhase = "requirements" | "split" | "executing" | "stopped"

/** Every phase, so an untrusted record can be validated against the complete set. */
export const CELL_PHASES: readonly CellPhase[] = ["requirements", "split", "executing", "stopped"]

/** What the guard enforces for ONE member session; the captain is not a member and is proven by id. */
export type CellMemberMode = "member" | "verifier" | "checkpoint" | "subcaptain"

/** Every member mode, for the same validation reason as {@link CELL_PHASES}. */
export const CELL_MEMBER_MODES: readonly CellMemberMode[] = ["member", "verifier", "checkpoint", "subcaptain"]

/** One member of the cell, as the cell — not the team record — knows it. */
export interface CellMemberRecord {
  /** The name the captain addresses and the team board uses (`cell-planner`, …). */
  name: string
  /** The roster role label the member was staged with, kept for display and routing. */
  role: string
  /**
   * The member's SESSION id, when it is known.
   *
   * Empty until something tells us: the approval answer carries the executor's own handle, and the
   * live team record's `executorRef` is the value the guard matches a session against. A cell that
   * never learned the id still has a working guard — it resolves the member through that record.
   */
  sessionId: string
  /** The executor handle the approval answer reported, verbatim; `""` when nothing was returned. */
  executorRef: string
  /** What the guard enforces for this member right now. */
  mode: CellMemberMode
  /** Whether the member wrote its handoff and is waiting for compaction + promotion. */
  handoffReady: boolean
  /** How many handoffs this member has written (the ordinal of the NEXT one is this + 1). */
  handoffs: number
  /** ISO instant the member was added to the cell. */
  joinedAt: string
}

/** One injected checkpoint, recorded so a second injection for the same turn is suppressed. */
export interface CellCheckpointRecord {
  /** The member session the checkpoint was injected into. */
  sessionId: string
  /** ISO instant of the injection. */
  at: string
  /** The observed tokens that crossed the threshold, or null when the meter reported none. */
  usedTokens: number | null
  /** The window those tokens were measured against, or null when the meter reported none. */
  contextWindow: number | null
  /** The step ordinal the injection happened on, so re-entry can be told apart from a new turn. */
  turn: number
}

/** The cell record: everything another invocation needs to continue this cell after a restart. */
export interface CellState {
  /** {@link CELLWORK_STATE_VERSION} at write time. */
  version: number
  /** `cell-<UTC instant>`, and the directory name inside the cell root. */
  cellId: string
  /** The lifecycle phase; `stopped` is terminal. */
  phase: CellPhase
  /** Whether the cell was archived by `cellwork_stop` (a stopped cell is archived; kept separately so
   *  a future "stopped but re-openable" state does not have to reinterpret the phase). */
  archived: boolean
  /** The user's `/cellwork` argument, verbatim after trimming. */
  objective: string
  /** ISO instant the cell record was created. */
  createdAt: string
  /** ISO instant of the last accepted mutation. */
  updatedAt: string
  /** The session that ran `/cellwork` — the ONLY session the captain guard applies to. */
  captainSessionId: string
  /** Nesting level: 0 for the top cell, `parent + 1` for a sub-cell. */
  depth: number
  /** The cell that staged this one as its sub-team, or null for a top cell. */
  parentCellId: string | null
  /** The live team record this cell drives, or `""` until `cellwork_start` approved one. */
  teamId: string
  /** Sub-cells this cell registered, in registration order. */
  subcellIds: string[]
  /** The accepted requirements revision; 0 before the first `finalize`. */
  requirementsRevision: number
  /** The accepted split revision, or null while no split has been accepted. */
  splitRevision: number | null
  /** The split revision MATERIALISED on the live team (null before the first activation). */
  activatedRevision: number | null
  /**
   * The board id every split key of {@link CellState.activatedRevision} was materialised as.
   *
   * The re-split path reads this map to REUSE a live board row for work that survives a new revision
   * instead of appending a duplicate, and to know which rows a later revision dropped. It is replaced
   * on every activation (a key's board id never changes once minted).
   */
  activatedTasks: Record<string, string>
  /**
   * Split keys an activation CANCELLED, mapped to the board id their row still carries.
   *
   * Work a later revision DROPS is marked cancelled on the cell record and never deleted: the board
   * row stays (this build has no cancel verb on the team plane), so the cell plane is where the
   * cancellation is recorded and `cellwork_dispatch` skips these ids.
   */
  cancelledTasks: Record<string, string>
  /** Set by a requirements update: the accepted split no longer matches the document. */
  splitStale: boolean
  /** ISO instant `cellwork_start` staged the planner team, or `""` before that. */
  startedAt: string
  /** Why the cell stopped; `""` while it is running. A forced stop records that here too. */
  stopReason: string
  /** Members by name; the guard resolves a non-captain session through this map first. */
  members: Record<string, CellMemberRecord>
  /** Injected checkpoints, oldest first. */
  checkpoints: CellCheckpointRecord[]
  /** How many journal entries were written when the record was last saved (history cursor). */
  journalCursor: number
}

/** Why one cell could not be read; the caller reports the path and never resets the record. */
export interface CellReadFailure {
  /** Discriminator: every successful read carries `ok: true` instead. */
  ok: false
  /** `missing` is "no such cell"; the other three are refusals that must be surfaced verbatim. */
  reason: "missing" | "corrupt" | "version" | "unreadable"
  /** Absolute path of the record file that was read. */
  path: string
  /** One line naming what was wrong, for the tool result and the journal. */
  detail: string
}

/** A successful read: the validated record plus the path it came from. */
export interface CellReadSuccess {
  /** Always true here; the failure shape carries `ok: false` plus the reason and the path instead. */
  ok: true
  /** The validated record. */
  state: CellState
  /** Absolute path of the record file. */
  path: string
}

/** The result of reading one cell: a record, or the refusal that must be reported instead. */
export type CellRead = CellReadSuccess | CellReadFailure

/** A cell found by {@link readActiveCell}: the record and the directory it was read from. */
export interface ActiveCell {
  /** The validated record. */
  state: CellState
  /** Absolute path of the cell directory. */
  dir: string
}

/** The result of scanning for the workspace's active cell: at most one cell, or a refusal. */
export type ActiveCellRead =
  | { ok: true; cell: ActiveCell | null }
  | CellReadFailure

/** What {@link newCellState} needs to mint a record. */
export interface NewCellInput {
  /** The generated cell id. */
  cellId: string
  /** The user's objective, already trimmed and known non-empty. */
  objective: string
  /** The session that ran `/cellwork`. */
  captainSessionId: string
  /** The instant of creation, which also stamps `createdAt`/`updatedAt`. */
  now: Date
  /** Nesting level; omitted means a top cell. */
  depth?: number
  /** The parent cell, when this one is a sub-cell. */
  parentCellId?: string | null
}

/** The workspace's cell root: `<ws>/.mpd/cellwork`. */
export function cellworkRoot(workspace: string): string {
  return join(workspace, ...CELLWORK_ROOT_SEGMENTS)
}

/** The directory of one cell: `<ws>/.mpd/cellwork/<cellId>`. */
export function cellDir(workspace: string, cellId: string): string {
  return join(cellworkRoot(workspace), cellId)
}

/** The record path of one cell. */
export function statePath(workspace: string, cellId: string): string {
  return join(cellDir(workspace, cellId), CELL_STATE_FILE)
}

/** The journal path of one cell. */
export function journalPath(workspace: string, cellId: string): string {
  return join(cellDir(workspace, cellId), CELL_JOURNAL_FILE)
}

/** The requirements document path of one cell. */
export function requirementsPath(workspace: string, cellId: string): string {
  return join(cellDir(workspace, cellId), CELL_REQUIREMENTS_FILE)
}

/** One measured split's path: `split/<revision>.json`. */
export function splitPath(workspace: string, cellId: string, revision: number): string {
  return join(cellDir(workspace, cellId), CELL_SPLIT_DIR, String(revision) + ".json")
}

/**
 * The BESIDE path a REFUSED verdict takes when `split/<revision>.json` already holds an ACCEPTED one:
 * `split/<revision>.refused.json`.
 *
 * Amendment 6 R2: a refused same-revision resubmission must never destroy the accepted verdict on disk.
 * The refusal still lands (the splitter needs its per-task breakdown), but at its own path, so the
 * canonical per-revision file stays the record of what was ACCEPTED and `latestSplit` never mistakes a
 * refusal for an acceptance.
 *
 * @param workspace - the workspace root the caller resolved through the adapter.
 * @param cellId - the cell that owns the split.
 * @param revision - the requirements revision the refused graph targeted.
 * @returns the absolute path of the refusal document.
 */
export function refusedSplitPath(workspace: string, cellId: string, revision: number): string {
  return join(cellDir(workspace, cellId), CELL_SPLIT_DIR, String(revision) + ".refused.json")
}

/** One task's frozen acceptance contract: `contracts/<taskKey>.md`. */
export function contractPath(workspace: string, cellId: string, taskKey: string): string {
  return join(cellDir(workspace, cellId), CELL_CONTRACTS_DIR, taskKey + ".md")
}

/** One handoff document: `handoff/<member>-<n>.md`. */
export function handoffPath(workspace: string, cellId: string, member: string, ordinal: number): string {
  return join(cellDir(workspace, cellId), CELL_HANDOFF_DIR, member + "-" + String(ordinal) + ".md")
}

/** A cell id for one instant: `cell-<YYYYMMDDTHHMMSSmmmZ>`. */
export function cellIdAt(now: Date): string {
  return "cell-" + now.toISOString().replace(/[-:.]/g, "")
}

/**
 * A cell id that no directory in this workspace already uses.
 *
 * THE MILLISECOND IS NOT ENOUGH. A stop followed immediately by a new start can land inside the same
 * millisecond, and reusing the id would OVERWRITE the archived cell's record — the one thing "archived,
 * not deleted" must never do. So the candidate instant is advanced one millisecond at a time until the
 * directory is free; after a thousand tries (unreachable in practice) a random suffix is appended so the
 * function still answers an id instead of throwing inside a command handler.
 *
 * @param workspace - the workspace root the caller resolved through the adapter.
 * @param now - the instant the cell is being created at.
 * @returns an unused cell id whose prefix is still the UTC instant.
 */
export function freeCellId(workspace: string, now: Date): string {
  /** The candidate instant, advanced only when its id is taken. */
  let instant = now.getTime()
  for (let attempt = 0; attempt < 1000; attempt++) {
    /** The id the current instant encodes. */
    const candidate = cellIdAt(new Date(instant))
    if (!existsSync(cellDir(workspace, candidate))) return candidate
    instant += 1
  }
  return cellIdAt(new Date(now.getTime())) + "-" + Math.random().toString(36).slice(2, 8)
}

/** A fresh record for a cell that has not started anything yet. */
export function newCellState(input: NewCellInput): CellState {
  /** The creation instant as the one ISO string every timestamp field starts from. */
  const stamp = input.now.toISOString()
  return {
    version: CELLWORK_STATE_VERSION,
    cellId: input.cellId,
    phase: "requirements",
    archived: false,
    objective: input.objective,
    createdAt: stamp,
    updatedAt: stamp,
    captainSessionId: input.captainSessionId,
    depth: input.depth ?? 0,
    parentCellId: input.parentCellId ?? null,
    teamId: "",
    subcellIds: [],
    requirementsRevision: 0,
    splitRevision: null,
    activatedRevision: null,
    activatedTasks: {},
    cancelledTasks: {},
    splitStale: false,
    startedAt: "",
    stopReason: "",
    members: {},
    checkpoints: [],
    journalCursor: 0,
  }
}

/**
 * The cell ids under one workspace's cell root, sorted ascending.
 *
 * A cell id starts with its UTC instant, so ascending order is creation order and "-1 means absent"
 * for {@link readActiveCell}: the OLDEST still-active cell is the one the mode reports.
 *
 * @param workspace - the workspace root the caller resolved through the adapter.
 * @returns the directory names that look like cells; `[]` when the root does not exist yet.
 */
export function listCellIds(workspace: string): string[] {
  /** The cell root, which may not exist at all before the first `/cellwork`. */
  const root = cellworkRoot(workspace)
  if (!existsSync(root)) return []
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("cell-"))
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

/** Read one cell record, validating its shape and schema version. */
export function readCell(workspace: string, cellId: string): CellRead {
  /** The absolute record path every failure below names. */
  const path = statePath(workspace, cellId)
  if (!existsSync(path)) return { ok: false, reason: "missing", path, detail: "no state file at this path" }
  /** The file's text, or the I/O failure that replaces the record. */
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch (error) {
    return { ok: false, reason: "unreadable", path, detail: errorText(error) }
  }
  /** The parsed JSON, or undefined when the file is not JSON at all. */
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { ok: false, reason: "corrupt", path, detail: "not valid JSON: " + errorText(error) }
  }
  /** The record's schema version as declared, before any validation. */
  const declaredVersion = isRecord(parsed) ? parsed.version : undefined
  if (typeof declaredVersion === "number" && declaredVersion !== CELLWORK_STATE_VERSION) {
    return {
      ok: false,
      reason: "version",
      path,
      detail: "state version " + String(declaredVersion) + " is not the version this build reads (" + String(CELLWORK_STATE_VERSION) + ")",
    }
  }
  /** The validated record, or null when a required field is missing or the wrong TYPE. */
  const state = normalizeCellState(parsed)
  if (state === null) return { ok: false, reason: "corrupt", path, detail: "the record does not have the shape of a cell state" }
  return { ok: true, state, path }
}

/**
 * Write one cell record atomically, creating the cell directory and every subdirectory it owns.
 *
 * @param workspace - the workspace root the caller resolved through the adapter.
 * @param state - the record to persist; `updatedAt` and `version` are stamped here.
 * @returns the record as written, so a caller can report the instant the file actually carries.
 */
export function writeCell(workspace: string, state: CellState): CellState {
  /** The cell directory this record lives in. */
  const dir = cellDir(workspace, state.cellId)
  for (const sub of ["", CELL_SPLIT_DIR, CELL_CONTRACTS_DIR, CELL_HANDOFF_DIR]) {
    mkdirSync(sub === "" ? dir : join(dir, sub), { recursive: true })
  }
  /** The record with the write instant applied, so no caller has to remember to stamp it. */
  const stamped: CellState = { ...state, version: CELLWORK_STATE_VERSION, updatedAt: new Date().toISOString() }
  atomicWriteText(statePath(workspace, state.cellId), JSON.stringify(stamped, null, 2) + "\n")
  return stamped
}

/**
 * Append one journal entry to the cell's history, and answer the new line count.
 *
 * The entry is stamped with its own `at` instant. The journal is NOT the state: a torn last line
 * costs one history row, never the record, which is why nothing reads it back to make decisions.
 *
 * @param workspace - the workspace root the caller resolved through the adapter.
 * @param cellId - the cell whose journal is appended.
 * @param entry - the caller's fields; `at` is added here and wins over any caller value.
 * @param now - the instant to stamp, injected so tests are deterministic.
 * @returns the number of journal lines after the append, or 0 when the append failed.
 */
export function appendJournal(workspace: string, cellId: string, entry: Record<string, unknown>, now: Date): number {
  /** The journal path, whose directory the record write has normally created already. */
  const path = journalPath(workspace, cellId)
  try {
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, JSON.stringify({ at: now.toISOString(), ...entry }) + "\n", "utf8")
    return readFileSync(path, "utf8").split("\n").filter((line) => line.trim() !== "").length
  } catch {
    return 0
  }
}

/**
 * Read the OLDEST cell that is not stopped — the cell this workspace is currently running.
 *
 * A cell DIRECTORY whose record cannot be read is a REFUSAL rather than "no active cell": the mode
 * may well be running, and reporting it absent would silently reset the guard and let a second cell
 * start on top of a record nobody can read.
 *
 * @param workspace - the workspace root the caller resolved through the adapter.
 * @returns the active cell (or `null`), or the refusal naming the unreadable record's path.
 */
export function readActiveCell(workspace: string): ActiveCellRead {
  for (const cellId of listCellIds(workspace)) {
    /** That cell's record, or the refusal this scan stops on. */
    const read = readCell(workspace, cellId)
    if (!read.ok) {
      // `missing` is a directory with no record — an interrupted creation. It is still a refusal:
      // the honest answer is "this cell cannot be read", not "the workspace has no cell".
      return read
    }
    if (read.state.phase !== "stopped") return { ok: true, cell: { state: read.state, dir: cellDir(workspace, cellId) } }
  }
  return { ok: true, cell: null }
}

/**
 * Append one journal entry and persist the record with its updated history cursor.
 *
 * The append happens FIRST and the record second: a torn journal costs one history line, while a record
 * written before its journal would claim a transition with no history behind it. Every phase change in
 * this package goes through here, so no caller has to remember the cursor.
 *
 * @param workspace - the workspace root the caller resolved through the adapter.
 * @param next - the record after the transition.
 * @param entry - the journal fields (an `event` plus whatever the transition wants recorded).
 * @param now - the instant to stamp.
 * @returns the record as persisted.
 */
export function recordTransition(workspace: string, next: CellState, entry: Record<string, unknown>, now: Date): CellState {
  /** The journal line count after the append, or 0 when the append failed. */
  const lines = appendJournal(workspace, next.cellId, entry, now)
  /** The record carrying the cursor this append established. */
  const stamped: CellState = { ...next, journalCursor: lines > 0 ? lines : next.journalCursor }
  return writeCell(workspace, stamped)
}

/**
 * Write one cell to a temporary file in the SAME directory, then rename it over the target.
 *
 * The rename is the commit point: a reader either sees the previous record or the new one, never a
 * half-written file. A failed rename removes the temporary file so a refused write leaves no debris.
 *
 * @param file - the absolute target path.
 * @param text - the complete file body.
 */
export function atomicWriteText(file: string, text: string): void {
  /** The sibling temporary path; unique per process and call so two writers cannot collide. */
  const tmp = join(dirname(file), "." + file.split("/").pop() + ".tmp-" + String(process.pid) + "-" + String(tempCounter++))
  mkdirSync(dirname(file), { recursive: true })
  try {
    writeFileSync(tmp, text, "utf8")
    renameSync(tmp, file)
  } catch (error) {
    try {
      unlinkSync(tmp)
    } catch {
      // Nothing to clean: the temporary file was never created, which is why the write failed.
    }
    throw error
  }
}

/** Distinguishes concurrent temporary files inside this process. */
let tempCounter = 0

/** Whether a parsed JSON value is a plain object, which is the only shape a record can have. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** A message from an unknown thrown value, without assuming it is an Error. */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** One non-empty string field, or undefined when the value is not a non-empty string. */
function textField(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined
}

/** One member record, defaulted field by field so a partially written member cannot crash the guard. */
function normalizeMember(name: string, raw: unknown): CellMemberRecord | null {
  if (!isRecord(raw)) return null
  /** The mode, defaulted to the least-privileged mode the guard treats as "ordinary member". */
  const mode = CELL_MEMBER_MODES.find((candidate) => candidate === raw.mode) ?? "member"
  return {
    name: textField(raw.name) ?? name,
    role: typeof raw.role === "string" ? raw.role : "",
    sessionId: typeof raw.sessionId === "string" ? raw.sessionId : "",
    executorRef: typeof raw.executorRef === "string" ? raw.executorRef : "",
    mode,
    handoffReady: raw.handoffReady === true,
    handoffs: typeof raw.handoffs === "number" ? raw.handoffs : 0,
    joinedAt: typeof raw.joinedAt === "string" ? raw.joinedAt : "",
  }
}

/** One string-valued map, keeping only the entries whose value is a string (a board id). */
function stringMap(value: unknown): Record<string, string> {
  /** The validated map. */
  const kept: Record<string, string> = {}
  if (!isRecord(value)) return kept
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") kept[key] = entry
  }
  return kept
}

/**
 * Validate one parsed value as a cell record, filling every COLLECTION with its empty default.
 *
 * Identity fields are strict (`version`, `cellId`, `phase`, `captainSessionId`): a record that does
 * not name its own cell or its captain cannot be trusted to decide who is guarded, so it is refused.
 * Optional collections are defaulted instead of refused, because losing `checkpoints` must not cost
 * the whole cell.
 *
 * @param raw - the parsed JSON value.
 * @returns the record, or null when an identity field is missing or of the wrong type.
 */
function normalizeCellState(raw: unknown): CellState | null {
  if (!isRecord(raw)) return null
  /** The cell's own id, which is also its directory name. */
  const cellId = textField(raw.cellId)
  /** The phase, matched against the complete set rather than trusted as a string. */
  const phase = CELL_PHASES.find((candidate) => candidate === raw.phase)
  /** The captain session id, which is the key the guard's captain arm matches on. */
  const captainSessionId = textField(raw.captainSessionId)
  if (cellId === undefined || phase === undefined || captainSessionId === undefined) return null
  if (typeof raw.version !== "number") return null
  /** The members map, kept only for entries that normalize. */
  const members: Record<string, CellMemberRecord> = {}
  if (isRecord(raw.members)) {
    for (const [name, value] of Object.entries(raw.members)) {
      /** That member, or null when the entry is not an object at all. */
      const member = normalizeMember(name, value)
      if (member !== null) members[name] = member
    }
  }
  /** The checkpoint history, kept only for entries that name a session and an instant. */
  const checkpoints: CellCheckpointRecord[] = Array.isArray(raw.checkpoints)
    ? raw.checkpoints.filter(isRecord).map((entry) => ({
      sessionId: typeof entry.sessionId === "string" ? entry.sessionId : "",
      at: typeof entry.at === "string" ? entry.at : "",
      usedTokens: typeof entry.usedTokens === "number" ? entry.usedTokens : null,
      contextWindow: typeof entry.contextWindow === "number" ? entry.contextWindow : null,
      turn: typeof entry.turn === "number" ? entry.turn : 0,
    }))
    : []
  return {
    version: CELLWORK_STATE_VERSION,
    cellId,
    phase,
    archived: raw.archived === true,
    objective: typeof raw.objective === "string" ? raw.objective : "",
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "",
    captainSessionId,
    depth: typeof raw.depth === "number" ? raw.depth : 0,
    parentCellId: typeof raw.parentCellId === "string" ? raw.parentCellId : null,
    teamId: typeof raw.teamId === "string" ? raw.teamId : "",
    subcellIds: Array.isArray(raw.subcellIds) ? raw.subcellIds.map(String) : [],
    requirementsRevision: typeof raw.requirementsRevision === "number" ? raw.requirementsRevision : 0,
    splitRevision: typeof raw.splitRevision === "number" ? raw.splitRevision : null,
    activatedRevision: typeof raw.activatedRevision === "number" ? raw.activatedRevision : null,
    activatedTasks: stringMap(raw.activatedTasks),
    cancelledTasks: stringMap(raw.cancelledTasks),
    splitStale: raw.splitStale === true,
    startedAt: typeof raw.startedAt === "string" ? raw.startedAt : "",
    stopReason: typeof raw.stopReason === "string" ? raw.stopReason : "",
    members,
    checkpoints,
    journalCursor: typeof raw.journalCursor === "number" ? raw.journalCursor : 0,
  }
}
