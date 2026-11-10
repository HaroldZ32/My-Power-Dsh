// CELLWORK PROTOCOL TOOLS — the seven registrations and the two listeners behind B8/B9.
//
// The tools: `cellwork_dispatch`, `cellwork_supervise`, `cellwork_context`, `cellwork_handoff`,
// `cellwork_subteam`, `cellwork_send`, `cellwork_inbox`. The listeners: the host-plane `agent/pre-step`
// checkpoint detector and the `agent/turn-stopping` compaction barrier. The decision logic they share
// lives in `protocol-core.ts` (pure, unit-testable); this file binds it to the adapter and to disk.
import { appendJournal, freeCellId, handoffPath, newCellState, readCell, resolveCellTeam, writeCell, type CellMemberRecord, type CellState } from "./state"
import { callerContext, type CallerContext, type TeamActionsServiceView, type TeamsServiceView } from "./caller"
import type { CellworkConfig } from "./config"
import { fenceReasonOf, nameKey, resolveMemberName, sendThroughExecutor } from "./dispatch"
import { validateHandoffText, writeHandoff } from "./handoff"
import { growExecutionSeats, lastSeatGrowthRefusalOf, seatProjectionOf, type SeatGrowthResult } from "./elastic"
import { acknowledgeCellMail, appendCellMail, deliverCellMail, findWorkspaceMailById, foldCellMail, nextCellMailId, pageCellMail, readCellMail, truncateCellMailBody, unreadFor, wakeFailures, type CellMailMessage } from "./mail"
import { mailMaxUndeliveredOf, sendMany } from "../../mpd-team-core-plugin/src/mailbox-store"
import type { SendInput, SendManyResult } from "../../mpd-team-core-plugin/src/mailbox-store"
import { fanOutTargets } from "../../mpd-mail-protocol/src/index"
import type { MailAddress, MailAnswer, MailKind, MailOption, MailQuestion } from "../../mpd-mail-protocol/src/index"
import {
  applyCheckpoint,
  checkpointDirective,
  checkpointUnrecoverableEntry,
  compactionJournalEntry,
  handoffWrittenDirective,
  memberAfterBarrier,
  nextStepOf,
  planCheckpoint,
  promoteAfterHandoff,
  subteamDirective,
  type CheckpointPlan,
} from "./protocol-core"
import { readFileSync } from "node:fs"
import type { DshAdapter, DshContextPressure, DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index"
import type { ProtocolCtx, ProtocolDeps } from "./protocol-core"

/**
 * The workspace config reader one send binds: `mpdConfig.get(<dotted key>)`, tolerant of absence.
 *
 * Total on purpose: a composition without the config row means "the row config is the only layer", never
 * a failed send. The VALUE semantics live in the shared store's `mailMaxUndeliveredOf` (imported below),
 * so this module owns only the seam read — one rule for the bound, not two.
 *
 * @param ctx - the host context the row reads services from.
 * @returns a reader of one dotted `mpd.jsonc` key.
 */
function workspaceConfigReader(ctx: ProtocolCtx): (dottedKey: string) => unknown {
  return (dottedKey: string): unknown => {
    /** The config service, probed with a false default so an absent row is not an error. */
    const service = ctx.get?.("mpdConfig", false) as { get?: (dottedKey: string) => unknown } | undefined
    if (service === undefined || service === null || typeof service.get !== "function") return undefined
    try {
      return service.get(dottedKey)
    } catch {
      return undefined
    }
  }
}

/** One protocol tool's answer: a structured success (any documented fields) or the refusal sentence. */
type ProtocolResult = Record<string, unknown> | ProtocolFailure

/** The refusals every protocol tool answers with — never a throw, so the model can act on the sentence. */
interface ProtocolFailure {
  /** Always false. */
  ok: false
  /** ONE sentence naming what was refused and what to do instead. */
  error: string
  /** The record path, when the refusal is about a state this build could not read. */
  path?: string
}

/**
 * Read one tool's arguments as a record.
 *
 * @param args - the harness-validated arguments (the schema is not enforced inside the handler).
 * @returns the arguments, or an empty record.
 */
function readArgs(args: unknown): Record<string, unknown> {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return {}
  return args as Record<string, unknown>
}

/**
 * Read one string field from untrusted arguments.
 *
 * @param args - the argument record.
 * @param key - the field name.
 * @returns the string, or "" when absent or not a string.
 */
function argString(args: Record<string, unknown>, key: string): string {
  return typeof args[key] === "string" ? args[key] as string : ""
}

/**
 * The STABLE id one cell seat is addressed by in the shared mailbox.
 *
 * WHY NOT THE SESSION ID (T9/F2). A seat's session id changes on a bounded compaction reseed, so every
 * row addressed to the previous id became unacknowledgeable and its questions unanswerable — the store's
 * ownership rules compare ids and silently refused. The key derives from the CELL and the seat NAME
 * only, so a reseeded seat still acknowledges and answers its own mail. The row keeps the seat/roster
 * spelling on `fromMemberId` for the team plane, and the session id stays the RUNTIME handle (wake-ups),
 * never the durable address.
 * @param cell - the cell the seat belongs to.
 * @param name - the seat's board name (`captain` for the captain).
 * @returns the stable address id, normalized so two spellings of one name address one seat.
 */
function seatKey(cell: CellState, name: string): string {
  return "seat:" + cell.cellId + "/" + nameKey(name)
}

/**
 * One addressable seat of a cell.
 * @param cell - the cell the seat belongs to.
 * @param name - the seat's board name (`captain` for the captain).
 * @returns the address the store mints a fan-out row for.
 */
function seatAddress(cell: CellState, name: string): MailAddress {
  return { id: seatKey(cell, name), name }
}

/**
 * Parse a `cellwork_send` `options` argument into the protocol's option shape.
 *
 * The protocol validator owns the RULES (non-empty, unique labels); this parse owns only the SHAPE a
 * typed payload needs, so a malformed array is refused before anything is written.
 * @param value - the raw argument.
 * @returns the options, or the refusal sentence.
 */
function parseMailOptions(value: unknown): MailOption[] | ProtocolFailure {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, error: "cellwork_send: `kind:\"question\"` requires a non-empty `options` array of {label, description?}" }
  }
  /** The options accepted so far, in offer order. */
  const options: MailOption[] = []
  for (const entry of value) {
    /** The option read as a record, since the harness validated only the array. */
    const option = typeof entry === "object" && entry !== null ? entry as Record<string, unknown> : null
    /** The option's label, which the echo will quote verbatim. */
    const label = option !== null && typeof option.label === "string" ? option.label : ""
    if (label.trim() === "") return { ok: false, error: "cellwork_send: every option needs a non-empty `label`" }
    options.push({ label, ...(typeof option?.description === "string" && option.description !== "" ? { description: option.description } : {}) })
  }
  return options
}

/**
 * Parse a `cellwork_send` `selected` argument into the label list the answer echoes.
 * @param value - the raw argument.
 * @returns the labels (possibly empty), or the refusal sentence when the shape is wrong.
 */
function parseMailSelected(value: unknown): string[] | ProtocolFailure {
  if (value === undefined) return []
  if (!Array.isArray(value)) return { ok: false, error: "cellwork_send: `selected` must be an array of offered label strings" }
  /** The strings accepted so far. */
  const selected: string[] = []
  for (const entry of value) {
    if (typeof entry !== "string") return { ok: false, error: "cellwork_send: every `selected` entry must be an offered label string" }
    selected.push(entry)
  }
  return selected
}

/**
 * The TEAM PLANE's occupancy reading for one seat, or `undefined` when that plane cannot answer.
 *
 * The answer is PARSED here because the service belongs to another row: every field is checked, and an
 * unrecognised provenance reads as "the plane cannot answer" rather than being forwarded as if it were
 * an observation. A null window stays null — this boundary never invents one.
 * @param teams - the `mpdTeams` view, or undefined in a composition without that row.
 * @param workspace - the caller's workspace root.
 * @param teamId - the cell's live team id (`""` means no team was approved yet).
 * @param memberName - the seat, by board name.
 * @returns the pressure reading, or undefined.
 */
function planePressureOf(teams: TeamsServiceView | undefined, workspace: string, teamId: string, memberName: string): DshContextPressure | undefined {
  if (teamId === "" || memberName === "") return undefined
  /** The plane's own reading, read structurally. */
  const reading = teams?.memberContext?.(workspace, teamId, memberName)
  if (typeof reading !== "object" || reading === null) return undefined
  /** That reading as a record. */
  const row = reading as Record<string, unknown>
  // ONLY AN OBSERVED WINDOW IS AN ANSWER (T49). `mpdTeams.memberContext` is TOTAL, so it answers for a
  // name that is not on the roster too — with `unavailable` (or `no-window`) and null numbers. Accepting
  // that as a reading LET THE PLANE SILENCE THE CAPTAIN: the captain is never a team member, so after
  // activation `cellwork_context` reported null tokens and `willCheckpoint:false` while the adapter held
  // the real meter. A reading without an observed window is therefore treated as NO ANSWER and the caller
  // falls back to the adapter (the same degradation this row uses for every other plane read).
  if (row.provenance !== "observed") return undefined
  if (typeof row.usedTokens !== "number" || typeof row.windowTokens !== "number") return undefined
  /** The observed ratio, when the plane stated one. */
  const ratio = typeof row.ratio === "number" ? row.ratio : row.windowTokens === 0 ? null : row.usedTokens / row.windowTokens
  return { usedTokens: row.usedTokens, windowTokens: row.windowTokens, ratio, provenance: "observed" }
}

/**
 * The TEAM PLANE's depth reading for one cell's team, or `undefined` when that plane cannot answer.
 *
 * A reading that CARRIES A REASON is not an answer: `mpdTeams.depthBudget` is total, so an unknown team
 * still answers depth 0 — using that to decide a refusal would bound the child on a team nobody could
 * read. The reason therefore disqualifies the reading, and the caller falls back to the cell record.
 * @param teams - the `mpdTeams` view, or undefined in a composition without that row.
 * @param workspace - the caller's workspace root.
 * @param teamId - the parent cell's live team id.
 * @returns the depth and its bound, or undefined.
 */
function planeDepthOf(teams: TeamsServiceView | undefined, workspace: string, teamId: string): { depth: number; depthMax: number } | undefined {
  if (teamId === "") return undefined
  /** The plane's own reading, read structurally. */
  const budget = teams?.depthBudget?.(workspace, teamId)
  if (typeof budget !== "object" || budget === null) return undefined
  /** That reading as a record. */
  const row = budget as Record<string, unknown>
  if (typeof row.reason === "string" && row.reason !== "") return undefined
  if (typeof row.depth !== "number" || typeof row.depthMax !== "number") return undefined
  return { depth: row.depth, depthMax: row.depthMax }
}

/**
 * One harness content block holding text.
 *
 * @param value - the text.
 * @returns the content blocks array.
 */
function render(value: string): Array<{ type: "text"; text: string }> {
  return [{ type: "text", text: value }]
}

/**
 * Render one inbox row as text, with the question's offered labels or the answer's selected labels
 * spelled out explicitly — so a reader never has to count options or positions (contract §6).
 * @param message - one inbox row, as the tool returned it.
 * @returns the row's text block.
 */
function mailBlock(message: Record<string, unknown>): string {
  /** The row's header line: who sent what. */
  const lines: string[] = ["[" + String(message.from ?? "") + "] " + String(message.subject ?? "")]
  /** The envelope kind, defaulted for a legacy row. */
  const kind = typeof message.kind === "string" ? message.kind : "message"
  /** The question payload, when this row carries one. */
  const question = typeof message.question === "object" && message.question !== null ? message.question as Record<string, unknown> : undefined
  /** The answer payload, when this row carries one. */
  const answer = typeof message.answer === "object" && message.answer !== null ? message.answer as Record<string, unknown> : undefined
  if (kind === "question" && question !== undefined) {
    /** The offered options, read defensively off a loose row. */
    const options = Array.isArray(question.options) ? question.options as Array<Record<string, unknown>> : []
    lines.push("QUESTION " + String(question.questionId ?? "") + (question.multiSelect === true ? " (multi-select)" : ""))
    lines.push(String(question.question ?? ""))
    for (const option of options) lines.push("  - " + String(option.label ?? ""))
  }
  if (kind === "answer" && answer !== undefined) {
    /** The echoed labels, in selection order. */
    const selected = Array.isArray(answer.selected) ? answer.selected.map((entry: unknown) => String(entry)) : []
    lines.push("ANSWER to " + String(answer.answerTo ?? ""))
    lines.push("  selected: " + (selected.length === 0 ? "(custom only)" : selected.join(" | ")))
    if (typeof answer.custom === "string" && answer.custom !== "") lines.push("  custom: " + answer.custom)
  }
  lines.push(String(message.body ?? ""))
  return lines.join("\n")
}

/**
 * The sentence a refusing cell read answers with.
 *
 * @param failure - the failed read.
 * @returns the refusal naming the path and the reason.
 */
function refusalText(failure: { path: string; reason: string; detail: string }): string {
  return "the cell record at " + failure.path + " cannot be read (" + failure.reason + ": " + failure.detail + ") — nothing was changed"
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

/**
 * Read one member row out of a call's cell record.
 *
 * @param caller - the caller context.
 * @returns the member row, or undefined when the caller is not a member.
 */
function memberOf(caller: CallerContext): CellMemberRecord | undefined {
  return caller.cell === null || caller.member === "" ? undefined : caller.cell.members[caller.member]
}

/**
 * One board row as `cellwork_supervise` reports it, with NO own key holding `undefined`.
 *
 * The live record's rows are `Record<string, unknown>`: any field may be ABSENT (a task with no owner is
 * legal), and the harness REFUSES a tool result carrying an `undefined` own key — so this projection is a
 * conditional spread. Absence stays absence, never an undefined value.
 *
 * @param task - the raw board row.
 * @returns the lossless projection.
 */
function superviseTaskRow(task: Record<string, unknown>): Record<string, unknown> {
  return {
    ...(typeof task.id === "string" ? { id: task.id } : {}),
    ...(typeof task.subject === "string" ? { subject: task.subject } : {}),
    ...(typeof task.status === "string" ? { status: task.status } : {}),
    ...(typeof task.owner === "string" ? { owner: task.owner } : {}),
    ...(typeof task.kind === "string" ? { kind: task.kind } : {}),
  }
}

/**
 * Install the seven protocol tools and the two protocol listeners.
 *
 * @param deps - the adapter, the host context, the knobs and the log sink.
 * @returns one disposer per registration.
 */
export function installCellworkProtocol(deps: ProtocolDeps): Array<() => void> {
  /** The adapter, named once so the bodies read cleanly. */
  const dsh = deps.dsh
  /** The resolved knobs. */
  const config = deps.config
  /** Every registration's disposer. */
  const disposers: Array<() => void> = []
  /** The compaction barriers currently running, keyed `cellId/member`, so one turn cannot start two. */
  const inFlight = new Set<string>()
  /** The team service, probed per call. */
  const teams = (): TeamsServiceView | undefined => {
    /** The service object, or undefined. */
    const service = deps.ctx.get?.("mpdTeams", false)
    return typeof service === "object" && service !== null ? service as TeamsServiceView : undefined
  }
  /** The team-plane WRITE surface, probed per call (wave W2-D: the plane is the authority). */
  const actions = (): TeamActionsServiceView | undefined => {
    /** The service object, or undefined. */
    const service = deps.ctx.get?.("mpdTeamActions", false)
    return typeof service === "object" && service !== null ? service as TeamActionsServiceView : undefined
  }
  /** The caller's context for one dispatch. */
  const callerFor = (exec: DshToolExec): CallerContext => callerContext(dsh, exec, { teams })
  /**
   * Read one live team record.
   *
   * @param workspace - the caller's workspace root.
   * @param teamId - the team id.
   * @returns the record, or undefined.
   */
  const recordOf = (workspace: string, teamId: string): Record<string, unknown> | undefined => {
    if (teamId === "" || workspace === "") return undefined
    /** The service's own read. */
    const record = teams()?.get?.(workspace, teamId)
    return typeof record === "object" && record !== null ? record as Record<string, unknown> : undefined
  }
  /**
   * The board the dispatch pass addresses (§7.1/§7.1a): the ONE resolver, never `cell.teamId` directly.
   *
   * @param workspace - the caller's workspace root.
   * @param cell - the cell record being read.
   * @returns the resolution, with both ids and the evidence on it.
   */
  const boardOf = (workspace: string, cell: CellState): ReturnType<typeof resolveCellTeam> =>
    resolveCellTeam({ workspace, cell, teams: teams(), recordFor: (teamId) => recordOf(workspace, teamId) })
  /**
   * The roster role names, or [] when the roster service cannot answer.
   *
   * Read structurally, per call: a composition without the roles row degrades seat growth to its
   * recorded-role fallback rather than failing the dispatch pass.
   *
   * @returns every canonical roster role name.
   */
  const rosterRoles = (): string[] => {
    try {
      /** The roster rows. */
      const rows = (deps.ctx.get?.("mpdRoles", false) as { list?: () => unknown } | undefined)?.list?.()
      return Array.isArray(rows) ? rows.map((row) => String((row as { name?: unknown }).name ?? "")).filter((name) => name !== "") : []
    } catch {
      return []
    }
  }
  /**
   * The roster persona text for one role, or null when the roster cannot answer.
   *
   * @param role - a roster role name.
   * @returns the persona text, or null.
   */
  const rosterPersona = (role: string): string | null => {
    try {
      /** The role row. */
      const row = (deps.ctx.get?.("mpdRoles", false) as { get?: (key: string) => { persona?: unknown } | null } | undefined)?.get?.(role)
      return row !== null && row !== undefined && typeof row.persona === "string" && row.persona.trim() !== "" ? row.persona : null
    } catch {
      return null
    }
  }
  /**
   * The task ids a raw `reassign` argument names, read defensively so growth never doubles a hand-over.
   *
   * @param value - the raw tool argument.
   * @returns the named task ids; a malformed argument yields an empty list (the plane owns its refusal).
   */
  const reassignedTaskIds = (value: unknown): string[] => {
    if (!Array.isArray(value)) return []
    /** The named ids. */
    const ids: string[] = []
    for (const entry of value) {
      if (typeof entry !== "object" || entry === null) continue
      /** The entry as a record. */
      const row = entry as Record<string, unknown>
      if (typeof row.task_id === "string" && row.task_id !== "") ids.push(row.task_id)
      else if (typeof row.taskId === "string" && row.taskId !== "") ids.push(row.taskId)
    }
    return ids
  }
  /**
   * The PLANE's reading of one seat, or an empty reading when the record does not name it.
   *
   * The team record is the authority for a closed seat (wave W2-E): `mode:"checkpoint"` and the fence
   * flag are ITS facts, and the cell row's own `mode` is a mirror. A reader that asked the cell row alone
   * could report a seat open one turn after the plane closed it, which is the divergence this ends.
   *
   * THE DISPLAY DERIVATION IS NOT A GIVE-UP FACT (repair round 2 finding A, corrected in round 3). The
   * production give-up fence is written ONLY on the CELL row (`protocol-core.ts#memberAfterBarrier` writes
   * `mode:"checkpoint"`, `handoffReady:true`, `fenced:true`, `fencedReason`), while
   * `team-actions.ts#writeMemberHandoff` sets this TEAM row to `mode:"checkpoint"` and NOTHING else. So a
   * TEAM checkpoint is BOTH the pending-barrier window AND the TEAM half of every real give-up: it can
   * never be read as the give-up by itself. The row's EXPLICIT `fenced` flag is returned separately as
   * `fenced` for the caller that needs the plane-only case; `cellwork_dispatch {unfence}` decides its CELL
   * half from the CELL row's own marker and treats a bare `checkpoint` as barrier-owned.
   * @param cell - the cell whose team is asked.
   * @param workspace - the caller's workspace root.
   * @param name - the member's display name (its record id is accepted too).
   * @returns `{mode}` for a live seat, `{mode:"checkpoint", checkpoint:true, fenced, fenceReason}` for a
   * closed one (the display derivation plus the row's own explicit give-up flag), and `{}` when the
   * record does not name it.
   */
  const recordSeat = (cell: CellState, workspace: string, name: string): { mode?: string; checkpoint?: boolean; fenced?: boolean; fenceReason?: string } => {
    /** The live team record for this cell. */
    const record = recordOf(workspace, cell.teamId)
    if (record === undefined) return {}
    /** The roster rows this build can read. */
    const rows = Array.isArray(record.members) ? record.members.filter((row) => typeof row === "object" && row !== null) as Array<Record<string, unknown>> : []
    /** The row this name names. */
    const row = rows.find((candidate) => candidate.name === name || candidate.id === name)
    if (row === undefined) return {}
    /** The plane's mode for the seat, when it states one. */
    const mode = typeof row.mode === "string" && row.mode !== "" ? row.mode : undefined
    /** Whether the plane's row carries its EXPLICIT give-up marker (never the `checkpoint` derivation). */
    const fenced = row.fenced === true
    /** Whether the plane reports the seat CLOSED, by either of its two spellings. */
    const closed = row.mode === "checkpoint" || fenced
    if (!closed) return mode === undefined ? {} : { mode }
    /** Why the plane closed it, in the plane's own vocabulary. */
    const reason = fenced
      ? "the plane fenced this seat" + (typeof row.fencedReason === "string" && row.fencedReason !== "" ? " (" + row.fencedReason + ")" : "")
      : "the plane recorded a checkpoint for this seat (mode `checkpoint`), so it is fenced until the barrier reopens it"
    return { mode: "checkpoint", checkpoint: true, fenced, fenceReason: reason }
  }

  /**
   * Persist one transition: journal first, then the record.
   *
   * @param workspace - the caller's workspace root.
   * @param next - the record after the transition.
   * @param entry - the journal fields.
   * @param now - the instant to stamp.
   * @returns the record as persisted.
   */
  const transition = (workspace: string, next: CellState, entry: Record<string, unknown>, now: Date): CellState => {
    /** The journal line count after the append. */
    const lines = appendJournal(workspace, next.cellId, entry, now)
    /** The record carrying the updated cursor. */
    const stamped: CellState = { ...next, journalCursor: lines > 0 ? lines : next.journalCursor }
    writeCell(workspace, stamped)
    return { ...stamped, updatedAt: now.toISOString() }
  }
  /** The captain-only refusal sentence, shared by the captain tools. */
  const captainOnly = (caller: CallerContext, tool: string): ProtocolFailure | undefined =>
    caller.sessionId === "" || caller.cell === null || caller.sessionId !== caller.cell.captainSessionId
      ? { ok: false, error: tool + " is CAPTAIN-ONLY: the captain of this cell is session " + String(caller.cell?.captainSessionId ?? "none") + ", which is not this caller" }
      : undefined

  /** One `unfence` name, resolved to the cell record's own spelling. */
  interface UnfenceTarget {
    /** The `cell.members` table key to rewrite. */
    key: string
    /** The member's recorded display name, which is what the answer's `member` field quotes. */
    name: string
    /**
     * Whether this entry asked for the FORCED lever (R4.4).
     *
     * A bare string entry is `false` — byte-identical to the pre-R4 behaviour — and a forced entry may
     * clear a BARRIER-OWNED checkpoint (never a live seat, and only once a written bound is reached).
     */
    force: boolean
  }

  /** What one `unfence` list did: the record after the write, and one outcome per name. */
  interface UnfenceResult {
    /** The cell record after the cleared rows were persisted (the SAME record when none was fenced). */
    cell: CellState
    /** One outcome per named member, in the order the call named them. */
    outcomes: Array<Record<string, unknown>>
  }

  /**
   * What a liveness probe can say about one seat's recorded session: live, not live, or "cannot tell".
   *
   * THREE STATES ON PURPOSE (R4.2). `liveAgentExact` answers `undefined` both for a dead session and for
   * a composition whose agents registry is absent (`mpd-dsh-adapter-plugin/src/index.ts#liveAgentExact`),
   * so treating that `undefined` as "dead" would report EVERY seat as suspect on an older composition.
   * `unknown` is the honest answer there: NOTHING is fenced automatically on it and it never supplies the
   * `dead-session` licence, while the forced lever's written bounds (`retry-budget`, `stale`) still apply —
   * a forced clear is allowed on `unknown` (R7.11 corrects the older sentence that denied it).
   */
  type SeatLiveness = "live" | "dead" | "unknown"

  /**
   * The WRITTEN licence a forced clear stands on (R4.4, extended by R5.2).
   *
   *   `retry-budget` the barrier already spent `compactionRetries` consecutive runs on the seat;
   *   `stale`        the checkpoint window outlived `checkpointPendingMaxMs`;
   *   `dead-session` the DEAD-RESEED licence: the recorded session is proven dead, so neither clock
   *                  bound can ever be reached by a seat no live agent can drive a turn in.
   */
  type SeatForceBound = "retry-budget" | "stale" | "dead-session"

  /**
   * The liveness of one recorded session, through the adapter's identity seam.
   *
   * THE CAPABILITY FLAG NEVER LICENSES `dead` (R7.3). `capabilities().agents` only says a registry
   * SERVICE is present; it says nothing about whether a lookup can succeed, and the adapter's own
   * `liveAgentExact` also answers `undefined` when `agents.get` is missing or throws. `dead` is therefore
   * proved by an ANCHOR: the registry must first resolve an identity that is known to be alive — the
   * captain's own session (the caller the cell record names) — and only then does an absent target count.
   * An unresolvable anchor leaves the answer `unknown`, which licenses nothing.
   *
   * @param sessionId - the session the seat records; "" names no session at all, so it is `unknown` before
   *   any lookup: the anchor would resolve and the absent id would otherwise be read as a proven dead child.
   * @param anchorSessionId - the captain's session id, the identity the registry must resolve before an
   *   absent target may be called dead; "" furnishes no anchor.
   * @returns `live` when the registry answers an Agent for the recorded session, `dead` when the anchor
   *   resolved and a NON-EMPTY target did not, and `unknown` when the recorded session id is empty, the
   *   identity seam or the registry capability is absent, or the anchor itself cannot be resolved.
   */
  const livenessOf = (sessionId: string, anchorSessionId: string): SeatLiveness => {
    // AN EMPTY RECORDED SESSION IS UNPROVABLE, NOT DEAD (R9.1): "" names no session, so neither the anchor
    // nor the registry's silence may turn it into a proven-dead child. This precedes every other check, so
    // no later branch can reach `dead` for it; every non-empty case keeps its existing path.
    if (sessionId === "") return "unknown"
    if (typeof dsh.liveAgentExact !== "function") return "unknown"
    try {
      if (dsh.liveAgentExact(sessionId) !== undefined) return "live"
      // THE PRESENCE PROBE IS STILL CONSULTED, but only to REFUSE: a composition that reports no agents
      // registry cannot prove anything, whatever a partial seam answered above.
      /** The adapter's capability snapshot, when this composition offers one. */
      const capabilities = typeof dsh.capabilities === "function" ? dsh.capabilities() : undefined
      if (capabilities?.agents !== true) return "unknown"
      // THE ANCHOR IS THE PROOF THE LOOKUP IS TRUSTWORTHY: only a registry that resolves a session known
      // to be alive can be believed when it answers nothing for the target.
      if (anchorSessionId === "" || dsh.liveAgentExact(anchorSessionId) === undefined) return "unknown"
      return "dead"
    } catch {
      return "unknown"
    }
  }

  /**
   * The instant one seat entered the checkpoint window, or undefined when nothing recorded it.
   *
   * The member row is the primary source (R4.3 writes it at the ONE ownerless close); a row written by an
   * older build falls back to the LAST `cell.checkpoints` entry for the SAME session, which is the
   * documented fallback and never a substitute for a missing fact.
   *
   * @param cell - the cell that holds both records.
   * @param member - the member row being measured.
   * @returns the ISO instant, or undefined when neither source names one.
   */
  const checkpointSinceOf = (cell: CellState, member: CellMemberRecord): string | undefined => {
    if (member.checkpointSince !== undefined) return member.checkpointSince
    for (let index = cell.checkpoints.length - 1; index >= 0; index -= 1) {
      /** The checkpoint entry at this position. */
      const entry = cell.checkpoints[index]
      if (entry.sessionId !== "" && entry.sessionId === member.sessionId) return entry.at
    }
    return undefined
  }

  /**
   * How long one seat has been in the checkpoint window, in milliseconds.
   *
   * @param since - the ISO instant the window opened, when one is recorded.
   * @param now - the instant the answer is measured at.
   * @returns the age, or undefined when no usable instant exists (an unparsable stamp is not a licence).
   */
  const pendingMsOf = (since: string | undefined, now: Date): number | undefined => {
    if (since === undefined || since === "") return undefined
    /** The parsed instant; an unparsable value is refused rather than read as zero. */
    const opened = Date.parse(since)
    return Number.isFinite(opened) ? Math.max(0, now.getTime() - opened) : undefined
  }

  /**
   * Which written bound authorises a FORCED clear of one barrier-owned seat, if any (R4.4).
   *
   * FAIL-CLOSED: a bare `force` is never a licence on its own, and a missing timestamp with zero recorded
   * failures reaches no bound at all.
   *
   * @param member - the member row the bound is measured on.
   * @param pendingMs - the measured window age, when one exists.
   * @returns `retry-budget` when the barrier already spent its consecutive-run budget, `stale` when the
   *   window outlived `checkpointPendingMaxMs`, and undefined when neither bound is reached.
   */
  const forceBoundOf = (member: CellMemberRecord, pendingMs: number | undefined): "retry-budget" | "stale" | undefined => {
    if ((member.barrierFailures ?? 0) >= config.compactionRetries) return "retry-budget"
    if (pendingMs !== undefined && pendingMs >= config.checkpointPendingMaxMs) return "stale"
    return undefined
  }

  /**
   * The ONE reading of "is this seat held, and would the FORCED lever clear it" (R5.2).
   *
   * ONE IMPLEMENTATION, TWO SURFACES: `cellwork_dispatch {unfence}` decides its forced branch from this
   * object and `cellwork_supervise` projects the SAME object, so the lever the sweep advertises and the
   * lever the verb accepts cannot disagree again. The divergence this ends was the incident's exact
   * shape: a reseeded seat (`mode:"subcaptain"`, `handoffReady:false`, TEAM row reopened to `member`) is
   * NOT barrier-owned, so the verb fell through to `not-fenced` while the sweep advertised
   * `forceEligible:true` from a SECOND predicate that never asked whether the seat was closed at all.
   *
   * TWO CLOSURE SHAPES, both held:
   *
   *   `barrierOwned` — a checkpoint SPELLING (CELL `mode:"checkpoint"` / `handoffReady:true`, or the
   *                    plane's `mode:"checkpoint"`). The barrier owes it a reopen, and the forced lever
   *                    stands on a WRITTEN bound: the retry budget or the staleness clock. Fail-closed:
   *                    a fresh window and a missing timestamp reach neither.
   *   `deadReseed`   — the DEAD-RESEED shape (R5.1/R4.2): the barrier replaced the session with a child
   *                    the registry PROVES dead (`liveness === "dead"`: the registry is present, its
   *                    CAPTAIN anchor resolves, and it answers nothing for the recorded session) while the
   *                    row is still `subcaptain` and not handoff-ready. No live agent is left to drive
   *                    another turn, so nothing will ever reopen it and the clock bound can never be
   *                    reached: the PROVEN-DEAD session is the licence (`bound:"dead-session"`). Its
   *                    window's STAMP is still required for that licence — a missing timestamp is never
   *                    one (the answer is `force-not-eligible`), and an ABSENT registry — or a present one
   *                    that cannot resolve the CAPTAIN anchor — answers `unknown` and proves nothing.
   */
  interface ForceReading {
    /** Whether a checkpoint SPELLING on either record is what holds the seat. */
    barrierOwned: boolean
    /** The R4.2 OBSERVABILITY flag: a stamped window whose recorded session the registry proves dead. */
    suspect: boolean
    /** Whether the seat is the DEAD-RESEED closure shape (`suspect` without any checkpoint spelling). */
    deadReseed: boolean
    /** Whether the seat is held at all (`barrierOwned || deadReseed`) — what an UNFORCED clear refuses. */
    closed: boolean
    /** The measured age of the window, when a stamp exists. */
    pendingMs?: number
    /** What the identity seam says about the session the row records. */
    liveness: SeatLiveness
    /** The written licence a FORCED clear stands on, when one is reached. */
    bound?: SeatForceBound
    /** Whether `unfence:[{member, force:true}]` would clear this seat RIGHT NOW. */
    forceEligible: boolean
    /** Why the forced lever refuses a HELD seat, in the answer's own two spellings. */
    refusal?: "live-session" | "force-not-eligible"
  }

  /**
   * Evaluate the ONE forced-lever predicate for one seat.
   *
   * @param cell - the cell whose records are read (the CELL row and its checkpoints history).
   * @param workspace - the caller's workspace root, where the TEAM record lives.
   * @param member - the CELL row; `undefined` means the CELL record does not name the seat (a plane-only
   *   checkpoint is still readable, but nothing about it can be measured or forced).
   * @param now - the instant the window's age is measured against.
   * @returns the reading both surfaces consume; total, never throws.
   */
  const forceReadingOf = (cell: CellState, workspace: string, member: CellMemberRecord | undefined, now: Date): ForceReading => {
    /** The plane's reading of the same seat: its `mode:"checkpoint"` is a closed spelling too. */
    const seat = recordSeat(cell, workspace, member?.name ?? "")
    /** The barrier's WINDOW, whichever record still carries it. */
    const barrierOwned = member?.mode === "checkpoint" || member?.handoffReady === true || seat.checkpoint === true
    /** The instant the window opened, when either source recorded one. */
    const since = member === undefined ? undefined : checkpointSinceOf(cell, member)
    /** The window's age, when it can be measured; a missing or unparsable stamp measures nothing. */
    const pendingMs = pendingMsOf(since, now)
    /** What the identity seam says about the session the row points at, anchored on the captain's own id. */
    const liveness = member === undefined ? "unknown" as const : livenessOf(member.sessionId, cell.captainSessionId)
    // TWO DIFFERENT FACTS, ONE CLOCK (R5.2). `suspect` is the OBSERVABILITY flag R4.2 introduced: a seat
    // whose recorded session the registry proves dead, whatever else the row says. `deadReseed` is the
    // CLOSURE shape: the same proven-dead session on a row that LEFT the barrier's window (a reseed), so
    // no agent is left to drive the turn a barrier would fire on. Only the second one is a forced-lever
    // licence — a checkpointed seat keeps the clock/retry bounds, and a healthy `subcaptain` is neither.
    /** Whether the recorded session is proven dead while a window stamp exists (R4.2's flag). */
    const suspect = since !== undefined && liveness === "dead"
    /** Whether this is the DEAD-RESEED closure shape rather than the barrier's own window. */
    const deadReseed = !barrierOwned && liveness === "dead" && member !== undefined && member.mode === "subcaptain" && member.handoffReady !== true
    /** Whether the seat is held at all. */
    const closed = barrierOwned || deadReseed
    /** The measured fields every answer shares. */
    const measured = { barrierOwned, suspect, deadReseed, closed, liveness, ...(pendingMs === undefined ? {} : { pendingMs }) }
    // AN OPEN SEAT IS `not-fenced`, NEVER A FORCE VERDICT: the forced lever is about a HELD seat, and a
    // `force-not-eligible` answer here would claim a window the record does not have.
    if (!closed) return { ...measured, forceEligible: false }
    // A LIVE SESSION VETOES EVERY FORCED CLEAR: the seat is not dead, whatever its age or failed runs say.
    if (liveness === "live") return { ...measured, forceEligible: false, refusal: "live-session" }
    /** The written licence, if any: the dead-reseed shape stands on its proven-dead session. */
    // THE LICENCE IS STILL WRITTEN: the dead-reseed shape stands on its PROVEN-DEAD session, but only
    // once the record carries the window's stamp — a missing timestamp falls back to the retry budget,
    // and with neither the answer is `force-not-eligible` rather than a silent clear.
    const bound = deadReseed
      ? (since === undefined ? (member === undefined ? undefined : forceBoundOf(member, pendingMs)) : "dead-session" as const)
      : (member === undefined ? undefined : forceBoundOf(member, pendingMs))
    if (bound === undefined) return { ...measured, forceEligible: false, refusal: "force-not-eligible" }
    return { ...measured, bound, forceEligible: true }
  }

  /**
   * The EXACT verb that retries a plane half the seam REFUSED (R5.4).
   *
   * `reopenPlaneSeat` reports `refused` and the TEAM row stays closed; the cellwork verbs cannot re-drive
   * it a second way (an unforced `unfence` answers `checkpoint-pending` for a pending window, and the
   * forced path refuses a live child), so the operator is handed the plane's OWN Lead-only verb instead
   * of a dead end. It is the same write `setMemberFence` performs, and it clears BOTH closed spellings.
   *
   * @param name - the member's recorded display name, quoted back exactly as the record spells it.
   * @returns the retry verb, ready to paste.
   */
  const planeRetryOf = (name: string): string => 'agent_teams_control {action:"unfence", member:' + JSON.stringify(name) + '}'

  /**
   * Ask the plane seam to reopen one seat, reporting which of the three outcomes happened.
   *
   * ONE IMPLEMENTATION (R4.1): the captain's `unfence` and the post-handoff barrier both call THIS, so
   * neither can claim a reopen the plane did not perform. The plane's write surface is probed per call and
   * `unfence` is the optional half.
   *
   * @param sessionId - the authority the plane validates; the captain's own id on both paths.
   * @param name - the member's recorded display name.
   * @returns `unfenced` when the seam accepted it, `absent` when this composition exposes no seam, and
   * `refused` with the plane's own sentence when the seam said no or threw.
   */
  const reopenPlaneSeat = async (sessionId: string, name: string): Promise<{ plane: string; planeReason?: string }> => {
    /** The plane's write surface, probed per call; `unfence` is the optional half. */
    const plane = actions()
    if (typeof plane?.unfence !== "function") return { plane: "absent", planeReason: "this composition exposes no mpdTeamActions.unfence seam, so the TEAM seat was NOT reopened" }
    try {
      /** The plane's answer — its own sentence when it refuses. */
      const reply = await plane.unfence({ sessionId, member: name }) as Record<string, unknown>
      if (reply?.ok === false) return { plane: "refused", planeReason: String(reply.error ?? "the team plane refused the unfence") }
      return { plane: "unfenced" }
    } catch (error) {
      // A THROWING SEAM IS A REFUSED HALF, not a lost cell-row repair: the member is reopened below
      // either way, and the sentence says which half failed so the captain can retry the plane verb.
      return { plane: "refused", planeReason: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * Clear one or more members' compaction fences — the CELL row first, then the TEAM row through the
   * plane's `unfence` seam when this composition exposes it.
   *
   * WHY BOTH RECORDS. The cell row's `handoffReady` is what `cellwork_handoff` refuses on (the "STILL
   * WAITING for the compaction barrier" deadlock: a fenced row keeps the flag, while the only other
   * clearer is another SUCCESSFUL barrier that a fenced member cannot start), and the TEAM row's
   * `mode`/`fenced` is what a dispatch pass and the guard read. Clearing one alone leaves the member
   * either unable to write its handoff or unmessageable, so the SAME call does both.
   *
   * NEVER `fenced: false`. The normalizer preserves only `fenced: true`, so a false key would vanish on
   * the next read while this record claimed a state it never wrote — the keys are DELETED instead.
   *
   * THE DECISION TABLE IS PER RECORD (repair round 3), because the barrier writes the give-up in exactly
   * one place:
   *   1. CELL row `fenced:true` — the GIVE-UP, whatever the TEAM row says — clears that row AND asks the
   *      plane seam to reopen the TEAM seat (the plane's `mode:"checkpoint"` is a CLOSED spelling too, and
   *      `mpdTeamActions.unfence` clears it). The plane's half is reported as `unfenced`, `absent` or
   *      `refused`; an absent seam never claims the member was reopened.
   *   2. CELL row NOT fenced + TEAM row `fenced:true` (the plane's own fence) → clear through the seam and
   *      leave the CELL row untouched.
   *   3. CELL row NOT fenced + TEAM row `mode:"checkpoint"` with no `fenced` → barrier-owned
   *      (`checkpoint-pending`): NEITHER record is written and the seam is NOT called.
   *   4. Neither marker → `not-fenced`.
   *
   * WHY THE CELL MARKER DECIDES THE GIVE-UP (the production shape). `memberAfterBarrier` writes the fence
   * ONLY on the CELL row, and `writeMemberHandoff` sets the TEAM row to `mode:"checkpoint"` and nothing
   * else; the only writer of a TEAM `fenced:true` is the plane's own `fence` action, which nothing in this
   * bundle calls. A real give-up therefore looks exactly like case 1 — and gating it on the TEAM flag
   * (repair round 2) answered `checkpoint-pending` for every real give-up, restoring the deadlock this
   * lever exists to remove.
   *
   * A FENCE THAT EXISTS ONLY ON THE TEAM RECORD IS CLEARED THERE (CodeRabbit round 1, finding 2).
   * `cellwork_supervise` already reports such a seat as fenced because the plane is the authority for a
   * closed seat, so answering `not-fenced` and leaving the plane's fence in place was the divergence this
   * ends: the plane seam is called, the CELL row carries no marker to rewrite and is left untouched, and
   * the outcome names which half was actually cleared (`cellRow: "untouched"`).
   *
   * THE WRITE IS MERGED INTO A FRESH READ TAKEN AFTER EVERY AWAITED PLANE CALL (CodeRabbit round 1,
   * finding 3). This call's snapshot predates those awaits, so writing `{...snapshot, members}` would
   * revert a change another writer made meanwhile — including an adopted member, which would silently
   * disappear from the record again. Only the rows THIS call cleared are written over the fresh record;
   * an unreadable record falls back to the pre-await snapshot, exactly as `adoptSeat` does.
   *
   * The plane seam is OPTIONAL BY DECLARATION (`TeamActionsServiceView.unfence?`), and an absent or
   * refusing plane does not undo the cell-row repair: the outcome names it (`plane: "absent"` /
   * `"refused"`) rather than pretending both halves landed.
   *
   * @param caller - the caller's context; its workspace and session id authorize both writes.
   * @param cell - the record the caller resolved.
   * @param targets - the requested members, already resolved (no unknown name reaches here).
   * @param now - the instant the journal rows are stamped with.
   * @returns the record after the write, and one outcome per target.
   */
  const unfenceSeats = async (caller: CallerContext, cell: CellState, targets: readonly UnfenceTarget[], now: Date): Promise<UnfenceResult> => {
    /** The rows whose CELL fence this call cleared, keyed by the record's own key; merged after every await. */
    const clearedRows = new Map<string, CellMemberRecord>()
    /** One outcome per distinct member (duplicates collapse to one), in the call's order. */
    const outcomes: Array<Record<string, unknown>> = []
    /** The members whose CELL row was actually reopened, with the plane's half and (when forced) its bound. */
    const cleared: Array<{ name: string; plane: string; forced?: { reason: SeatForceBound; pendingMs: number | undefined; barrierFailures: number; sessionId: string; liveness: SeatLiveness } }> = []
    for (const target of targets) {
      /** The row as the PRE-AWAIT snapshot holds it; only its fence MARKER is read, never merged back whole. */
      const row = cell.members[target.key]
      /** Whether the CELL row itself carries the barrier's give-up marker — THE give-up fact (round 3). */
      const cellFenced = row !== undefined && row.fenced === true
      /** The plane's reading of the same seat, which is the authority for a fence the cell row never mirrored. */
      const seat = recordSeat(cell, caller.workspace, target.name)
      /** Whether the TEAM row carries the plane's EXPLICIT fence, the only thing the plane-only half clears. */
      const teamFenced = seat.fenced === true
      // 1. THE CELL MARKER IS THE GIVE-UP, WHATEVER THE TEAM ROW SAYS (repair round 3). The barrier writes
      // `fenced:true` ONLY on the CELL row, so requiring the TEAM flag here would leave every real give-up
      // deadlocked. Clearing the CELL row AND asking the plane to reopen the seat is the whole repair; the
      // plane's half is reported exactly as it ended, never assumed.
      if (cellFenced) {
        /** How the plane's half ended. */
        const half = await reopenPlaneSeat(caller.sessionId, target.name)
        /** The reopened CELL row: the fence keys are REMOVED and the barrier's checkpoint window is reset. */
        const reopened: CellMemberRecord = { ...row, mode: "member", handoffReady: false }
        delete reopened.fenced
        delete reopened.fencedReason
        clearedRows.set(target.key, reopened)
        outcomes.push({ member: target.name, unfenced: true, plane: half.plane, ...(half.planeReason === undefined ? {} : { planeReason: half.planeReason }), ...(half.plane === "refused" ? { retry: planeRetryOf(target.name) } : {}) })
        cleared.push({ name: target.name, plane: half.plane })
        continue
      }
      // 2. A FENCE THAT EXISTS ONLY ON THE TEAM RECORD IS CLEARED THERE (CodeRabbit round 1, finding 2):
      // the CELL row carries no marker this call may rewrite, so it is LEFT UNTOUCHED and the answer
      // reports the plane's half as the only half that could be acted on.
      if (teamFenced) {
        /** How the plane's half ended. */
        const half = await reopenPlaneSeat(caller.sessionId, target.name)
        outcomes.push({ member: target.name, unfenced: half.plane === "unfenced", cellRow: "untouched", plane: half.plane, ...(half.planeReason === undefined ? {} : { planeReason: half.planeReason }), ...(half.plane === "refused" ? { retry: planeRetryOf(target.name) } : {}) })
        continue
      }
      // 3. THE HELD SEAT (R4.4, widened by R5.2). A `checkpoint` spelling on either record with no fence
      // marker is the state EVERY handoff leaves behind — so a CELL-only checkpoint answers
      // `checkpoint-pending` too, never the false `not-fenced`. The DEAD-RESEED shape (a reseeded seat whose
      // fresh child is proven dead) is HELD as well: it is not barrier-owned, and it is exactly why the
      // forced lever used to be unreachable. ONE predicate decides both, the same one the sweep projects.
      /** The ONE forced-lever reading for this seat (R5.2). */
      const reading = forceReadingOf(cell, caller.workspace, row, now)
      if (reading.closed && !target.force) {
        // UNFORCED: NOTHING is written anywhere and the seam is NOT called. The barrier owns this state.
        outcomes.push({ member: target.name, unfenced: false, reason: "checkpoint-pending", barrierOwned: reading.barrierOwned, ...(reading.deadReseed ? { suspect: true } : {}), detail: reading.deadReseed
          ? "the record shows a DEAD-RESEED seat for this member (" + String(seat.fenceReason ?? "a reseeded row whose recorded session is not a live agent") + "): no barrier will run for it again, nothing was cleared, and the FORCED lever `unfence:[{member, force:true}]` reopens it under `bound:\"dead-session\"`"
          : "the record shows a held seat for this member (" + String(seat.fenceReason ?? "no `fenced` marker: a checkpoint window") + "), so the compaction barrier owns that state and nothing was cleared; the FORCED lever `unfence:[{member, force:true}]` exists for a seat the barrier can no longer run for" })
        continue
      }
      if (reading.closed && target.force) {
        // FORCED, AND FAIL-CLOSED: a bare `force` proves nothing. A LIVE seat is refused outright (it is
        // not dead), and the clear is allowed only when a WRITTEN licence authorises it.
        if (reading.refusal === "live-session") {
          outcomes.push({ member: target.name, unfenced: false, reason: "live-session", alive: true, sessionId: row?.sessionId ?? "", detail: "the recorded session is a LIVE agent, so this seat is not dead and the forced lever refuses to reopen it" })
          continue
        }
        // NO CELL ROW MEANS NO RECORDED BOUND: fail closed rather than clear a seat whose clock and
        // failure count this record never wrote.
        if (row === undefined || reading.bound === undefined) {
          outcomes.push({ member: target.name, unfenced: false, reason: "force-not-eligible", alive: false, sessionId: row?.sessionId ?? "", ...(reading.pendingMs === undefined ? {} : { pendingMs: reading.pendingMs }), detail: "a forced clear needs a written licence: `barrierFailures` at the retry budget (" + String(config.compactionRetries) + "), a `checkpointSince` older than " + String(config.checkpointPendingMaxMs) + " ms, or a reseeded seat whose recorded session the registry PROVES dead. Nothing was written" })
          continue
        }
        /** The bound the clear stands on; `dead-session` is the dead-reseed shape's own licence. */
        const bound = reading.bound
        // THE WRITE (R4.4): reopen the CELL row for REASSIGNMENT — `mode:"member"`, not handoff-ready, and
        // every window key DELETED (absent-not-zero). `handoffs`, `joinedAt` and `adopted` are kept.
        /** The reopened CELL row; the four keys are REMOVED, never written as false/zero. */
        const reopened: CellMemberRecord = { ...row, mode: "member", handoffReady: false }
        delete reopened.fenced
        delete reopened.fencedReason
        delete reopened.barrierFailures
        delete reopened.checkpointSince
        clearedRows.set(target.key, reopened)
        // BEST-EFFORT PLANE HALF: the same seam, the same reporting; a refusal never undoes the CELL write.
        /** How the plane's half ended. */
        const half = await reopenPlaneSeat(caller.sessionId, target.name)
        // `alive` answers "is the recorded session a LIVE agent" (false here, or the clear would have been
        // refused); `liveness` names WHY — `dead` when the registry proved it, `unknown` when this
        // composition cannot tell. The second field is what keeps "unproven" from reading as "dead".
        outcomes.push({ member: target.name, unfenced: true, forced: true, alive: false, liveness: reading.liveness, sessionId: row.sessionId, bound, ...(reading.pendingMs === undefined ? {} : { pendingMs: reading.pendingMs }), plane: half.plane, ...(half.planeReason === undefined ? {} : { planeReason: half.planeReason }), ...(half.plane === "refused" ? { retry: planeRetryOf(target.name) } : {}) })
        cleared.push({ name: target.name, plane: half.plane, forced: { reason: bound, pendingMs: reading.pendingMs, barrierFailures: row.barrierFailures ?? 0, sessionId: row.sessionId, liveness: reading.liveness } })
        continue
      }
      // 4. NOT HELD IN EITHER RECORD IS A FACT, NOT A SUCCESS: the answer says so and nothing is written.
      outcomes.push({ member: target.name, unfenced: false, reason: "not-fenced" })
    }
    // NOTHING CLEARED ON THE CELL SIDE: the record is untouched, so a `not-fenced` answer — or a team-only
    // unfence — never rewrites the file.
    if (cleared.length === 0) return { cell, outcomes }
    // THE MERGE STARTS FROM THE RECORD ON DISK NOW, after every awaited plane call above (finding 3).
    /** The record as it stands once every plane call settled. */
    const fresh = readCell(caller.workspace, cell.cellId)
    /** The merge base: the FRESH record, or this call's pre-await snapshot when the read failed. */
    const base = fresh.ok ? fresh.state : cell
    /** The members table the merge writes: only THIS call's cleared rows are replaced. */
    const members: Record<string, CellMemberRecord> = { ...base.members }
    for (const [key, reopened] of clearedRows) members[key] = reopened
    /** The journal line count after the LAST append, so the record's cursor stays exact. */
    let cursor = base.journalCursor
    for (const row of cleared) {
      // TWO DISTINCT ROWS (R4.4): an UNFORCED clear keeps `member-unfenced`'s meaning; a FORCED one names
      // the bound it used, the measured age and the failure count, so the record says WHY a seat the
      // barrier owned was reopened. `liveness` carries the third fact the contract's vocabulary names
      // (`no-live-session`): every forced clear requires it, so it is recorded beside the bound instead of
      // standing in for it — a bound is the licence and liveness alone never is.
      // A REFUSED PLANE HALF NAMES ITS OWN RETRY (R5.4): the row says which verb re-drives the seam, so a
      // refusal is never a dead end recorded only as `plane:"refused"`.
      /** The retry verb a refused plane half is repaired with, when it was refused. */
      const retry = row.plane === "refused" ? { retry: planeRetryOf(row.name) } : {}
      cursor = appendJournal(caller.workspace, cell.cellId, row.forced === undefined
        ? { event: "member-unfenced", member: row.name, plane: row.plane, ...retry }
        : {
          event: "member-unfenced-forced",
          member: row.name,
          by: "captain",
          reason: row.forced.reason,
          ...(row.forced.pendingMs === undefined ? {} : { pendingMs: row.forced.pendingMs }),
          barrierFailures: row.forced.barrierFailures,
          sessionId: row.forced.sessionId,
          liveness: row.forced.liveness,
          plane: row.plane,
          ...retry,
        }, now)
    }
    /** The record with the reopened rows and the journal cursor this call established. */
    const next: CellState = { ...base, members, journalCursor: cursor > 0 ? cursor : base.journalCursor }
    return { cell: writeCell(caller.workspace, next), outcomes }
  }

  // ── cellwork_dispatch ────────────────────────────────────────────────────
  disposers.push(dsh.registerTool({
    name: "cellwork_dispatch",
    description: "CAPTAIN only: one owner-only dispatch pass over the live board. A ready task is paired ONLY with its declared owner; a busy, absent, FENCED or failed owner is REPORTED and the task left pending — never substituted (a fenced member is never messaged). `reassign` hands named rows to another member FIRST: each row is claimed for that member through the board, journaled as `task-reassigned`, then delivered — the repair for a fenced owner. `unfence` clears named members' compaction GIVE-UP fences BEFORE the pass — the repair for the other deadlock: a fenced row keeps `handoffReady:true`, so `cellwork_handoff` refuses it as STILL WAITING while only another SUCCESSFUL barrier could clear it, which a fenced member cannot start. THE CELL ROW'S OWN `fenced:true` IS THE GIVE-UP FACT (the compaction barrier writes the fence on the CELL row and nowhere else): that row loses `fenced`/`fencedReason`, returns to `mode: member` with `handoffReady:false` (its `handoffs` count is unchanged), AND the TEAM seat is reopened through the plane's `unfence` seam when this composition exposes one — the plane's `mode:\"checkpoint\"` counts as a closed seat and that seam clears it too. The answer reports the plane's half honestly as `unfenced`, `absent` or `refused` and never claims the member was reopened when no seam exists. A TEAM row at `mode:\"checkpoint\"` with NO `fenced` flag is a PENDING compaction, not a give-up — UNLESS the CELL row carries the marker above, in which case the CELL marker decides; on its own that pending checkpoint answers `{member, unfenced:false, reason:\"checkpoint-pending\"}` and NEITHER record is written, because the barrier owns it. A barrier-owned checkpoint is NOT a dead end: the forced lever `unfence:[{member, force:true}]` reopens it only at a written bound (`barrierFailures` at `compactionRetries`, a `checkpointSince` older than `checkpointPendingMaxMs`, or the DEAD-RESEED shape — a reseeded `subcaptain` row whose recorded session the registry PROVES dead, `bound:\"dead-session\"`), and a plane half that ends `refused` carries `retry`, the exact `agent_teams_control {action:\"unfence\", member}` verb that re-drives it; the `unfence` parameter below spells out every bound. An explicit `fenced:true` recorded ONLY on the TEAM record is cleared through that seam while the CELL row is left untouched, and the outcome says which half was cleared. A member that is not fenced in either record answers `{member, unfenced:false, reason: not-fenced}` (never a silent success), and an unknown name refuses the whole call with the recorded members named. `unfence` and `reassign` may travel in ONE call and neither interferes with the other. Delivery goes through the team executor and is journaled.",
    parameters: {
      type: "object",
      properties: {
        reassign: {
          type: "array",
          description: "Rows to hand to another member BEFORE the pass: each is claimed for that member on the board, journaled, then delivered to it. Use it to repair the rows a fenced owner still holds.",
          items: {
            type: "object",
            properties: {
              task_id: { type: "string", description: "The board row to hand over (`T17`)." },
              owner: { type: "string", description: "The member that should own and receive the row." },
            },
            required: ["task_id", "owner"],
            additionalProperties: false,
          },
        },
        unfence: {
          type: "array",
          description: "Member names whose compaction GIVE-UP fence this call CLEARS before the pass (captain-only, like the verb). The CELL row's own `fenced:true` is the give-up fact: that row loses `fenced`/`fencedReason`, returns to `mode: member` with `handoffReady:false`, and keeps its `handoffs` count, while the TEAM seat is reopened through the plane's `unfence` seam when this composition exposes one (the plane's `mode:\"checkpoint\"` is a closed spelling and that seam clears it too). A give-up fence recorded ONLY on the TEAM record (an explicit `fenced:true`) is cleared there while the CELL row is left untouched. A TEAM row at `mode:\"checkpoint\"` with no `fenced` marker is barrier-owned and, on its own, answers `reason:\"checkpoint-pending\"` and writes nothing — the CELL marker above outranks it. A member that is not fenced in either record is reported as not-fenced, never as a silent success; a name that matches no single member (unknown, or ambiguous once normalized) refuses the whole call. `{member, force:true}` is the LAST RESORT for a seat the barrier can no longer run for: it reopens a BARRIER-OWNED checkpoint (the CELL row's own `mode`/`handoffReady` or the TEAM row's `mode:\"checkpoint\"`) ONLY when the recorded session is not a live agent AND a written bound is reached — `barrierFailures` at `compactionRetries`, or a `checkpointSince` older than `checkpointPendingMaxMs` (15 minutes). A bare `force` is never a licence: a live seat, a fresh window, zero failures and a missing timestamp all write NOTHING. THE DEAD-RESEED SEAT IS COVERED BY THE SAME PREDICATE (R5.2): a reseeded row (`mode:\"subcaptain\"`, `handoffReady:false`, a `checkpointSince`) whose recorded session the registry PROVES dead is answer `checkpoint-pending` unforced and force-clearable with `bound:\"dead-session\"` — the clock bound is never reached by a seat no live agent can drive. A plane half that answers `refused` names the exact retry verb (`agent_teams_control {action:\"unfence\", member}`) in the answer AND in the journal row, so a refusal is never a dead end. The journal row is `member-unfenced-forced` (`by:\"captain\"`, the bound as `reason`, `pendingMs`, `barrierFailures`, `sessionId`, `liveness`, `plane`), the answer adds `alive`/`sessionId`, and the seat is reopened for REASSIGNMENT, NOT for work — its context was never compacted. May travel with `reassign`.",
          items: {
            oneOf: [
              { type: "string" },
              {
                type: "object",
                properties: {
                  member: { type: "string", description: "The member whose barrier-owned checkpoint this call reopens." },
                  force: { type: "boolean", description: "Ask for the BOUNDED FORCED lever: a barrier-owned `checkpoint` reopen is allowed ONLY when the recorded session is not live AND a written bound is reached (the barrier's retry budget, or a window older than `checkpointPendingMaxMs`). A bare force on a live seat, a fresh window or a seat with no recorded bound writes NOTHING." },
                },
                required: ["member"],
                additionalProperties: false,
              },
            ],
          },
        },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          pairs: { type: "array", items: { type: "object" } },
          skipped: { type: "array", items: { type: "object" } },
          reassigned: { type: "array", items: { type: "object" }, description: "One entry per readable `reassign` pair: whether the board claim landed and whether the message was delivered." },
          reassignInvalid: { type: "array", items: { type: "string" }, description: "One sentence per `reassign` entry this call refused to read." },
          unfenced: { type: "array", items: { type: "object" }, description: "One entry per distinct `unfence` member (duplicates collapse to one): `{member, unfenced:true, plane, planeReason?}` for a cleared CELL give-up fence (the CELL row's `fenced:true`, whatever the TEAM row says), `{member, unfenced:false, reason:\"not-fenced\"}` when neither record reports a marker, `{member, unfenced:false, reason:\"checkpoint-pending\", detail}` only when the CELL row carries no `fenced:true` AND the TEAM row is at `mode:\"checkpoint\"` with no `fenced` flag (the compaction barrier owns it, nothing was written), and `{member, unfenced, cellRow:\"untouched\", plane, planeReason?}` when an explicit TEAM-only fence was cleared while the CELL row was left untouched. `plane` is `unfenced` (the TEAM seat was reopened through the seam), `absent` (this composition exposes no `unfence` seam, so no reopen is claimed) or `refused` (with the plane's own sentence in `planeReason`). A FORCED clear answers `{member, unfenced:true, forced:true, alive:false, liveness:\"dead\"|\"unknown\", sessionId, bound:\"retry-budget\"|\"stale\", pendingMs?, plane, planeReason?}`, and a forced request that is refused writes nothing and answers `reason:\"live-session\"` or `reason:\"force-not-eligible\"` with a `detail` sentence. The dead-reseed seat (a reseeded `subcaptain` row whose recorded session the registry PROVES dead) is held by the SAME predicate and its forced clear names `bound:\"dead-session\"`. Any outcome whose plane half ended `refused` ALSO carries `retry`: the exact Lead-only verb (`agent_teams_control {action:\"unfence\", member}`) that re-drives the seam, echoed in the render and in the journal row." },
          refused: { type: "string" },
          seats: {
            type: "object",
            description: "The seat projection after this pass (§4.2): `execution` seats (planning excluded), `planning` seats, the two caps (`cap` = cellwork.seats.max, `capPerRole`), and how many seats this pass grew or reused.",
            properties: {
              execution: { type: "number" },
              planning: { type: "number" },
              cap: { type: "number" },
              capPerRole: { type: "number" },
              grown: { type: "number" },
              reused: { type: "number" },
            },
          },
          grownSeats: { type: "array", items: { type: "object" }, description: "One entry per seat this pass raised or adopted: `{name, role, taskId, rosterRole, reason}`. `rosterRole` is the `role` the live member record actually carries after the append (§7.1b); empty means the append arm dropped it." },
          seatWarnings: { type: "array", items: { type: "string" }, description: "Non-fatal seat observations, e.g. a freshly grown seat whose member record carries no `role` (§7.1b)." },
        },
        required: ["ok"],
      },
      render: (_args: unknown, value: unknown): unknown => {
        /** The result as a record. */
        const result = typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
        /** The unfence outcomes, reported first because they run first. */
        const unfenced = Array.isArray(result.unfenced) ? result.unfenced as Array<Record<string, unknown>> : []
        /**
         * The plane RETRY a refused half hands over (R5.4), or "" when the outcome names none.
         *
         * @param row - one unfence outcome.
         * @returns the sentence naming the exact retrying verb, ready to append.
         */
        const retryOf = (row: Record<string, unknown>): string => typeof row.retry === "string" && row.retry !== "" ? " · the plane half still needs: " + row.retry : ""
        /** One line per `unfence` name: the CELL row's fact and, when it was asked, the plane's half. */
        const lines = unfenced.map((row) => row.forced === true
          // THE FORCED LEVER SAYS WHAT IT DID AND WHAT IT DID NOT DO (R4.4): the seat is open for
          // reassignment, NOT for work — its context was never compacted, so a message would resume a
          // context the handoff already described.
          ? "unfence " + String(row.member) + " (FORCED, " + String(row.reason ?? row.bound ?? "bound reached") + "): reopened for reassignment, not for work — the barrier never reopened this seat (" + (row.plane === "unfenced" ? "the TEAM row was reopened through the plane" : row.plane === "absent" ? "this composition exposes no mpdTeamActions.unfence seam, so the TEAM row may still be closed" : "the TEAM row was NOT cleared: " + String(row.planeReason ?? "the team plane refused the unfence")) + ")"
          : row.reason === "live-session" || row.reason === "force-not-eligible"
            ? "unfence " + String(row.member) + ": NOT cleared (" + String(row.reason) + ") — " + String(row.detail ?? "")
            : row.cellRow === "untouched"
          ? "unfence " + String(row.member) + ": the CELL row carried no fence marker, so it was left untouched — " + (row.plane === "unfenced"
            ? "the TEAM row was unfenced through the plane"
            : row.plane === "absent"
              ? "the TEAM record reports the seat fenced, but this composition exposes no mpdTeamActions.unfence seam, so the TEAM row is STILL fenced"
              : "the TEAM row was NOT cleared: " + String(row.planeReason ?? "the team plane refused the unfence"))
          : "unfence " + String(row.member) + ": " + (row.unfenced !== true
            ? row.reason === "checkpoint-pending"
              ? (row.suspect === true
                ? "DEAD-RESEED — no barrier will run for this seat again and no live agent is left, so nothing was cleared; the FORCED lever cellwork_dispatch {unfence:[{member:" + JSON.stringify(String(row.member)) + ", force:true}]} reopens it for reassignment"
                : "checkpoint pending — the compaction barrier owns this seat, so nothing was cleared in either record")
              : "not fenced — nothing was written"
            : row.plane === "absent"
              ? "cell row cleared — this composition exposes no mpdTeamActions.unfence seam, so the TEAM seat was NOT reopened (it stays closed until the barrier or the plane reopens it)"
              : row.plane === "refused"
                ? "cell row cleared, but the TEAM seat was NOT reopened: " + String(row.planeReason ?? "the team plane refused the unfence")
                : "cell row cleared and the TEAM seat reopened through the plane"))
        /** The same lines, each carrying the plane retry it names (R5.4) — no silent dead end. */
        const clears = lines.map((line, index) => line + retryOf(unfenced[index]))
        if (result.ok === false) return render(["cellwork_dispatch refused: " + String(result.error ?? "unknown refusal"), ...clears].join("\n"))
        /** The delivered pairs. */
        const pairs = Array.isArray(result.pairs) ? result.pairs as Array<Record<string, unknown>> : []
        /** The reported skips. */
        const skipped = Array.isArray(result.skipped) ? result.skipped as Array<Record<string, unknown>> : []
        /** The reassignment outcomes, reported before the pass because they run before it. */
        const reassigned = Array.isArray(result.reassigned) ? result.reassigned as Array<Record<string, unknown>> : []
        /** The refused `reassign` entries. */
        const invalid = Array.isArray(result.reassignInvalid) ? result.reassignInvalid.map((entry) => String(entry)) : []
        /** One line per hand-over, claiming and delivery reported as the SEPARATE facts they are. */
        const handovers = reassigned.map((row) => "reassign " + String(row.taskId) + " -> " + String(row.owner) + ": " + (row.delivered === true ? "claimed on the board and delivered" : row.claimed === true ? "CLAIMED, delivery failed: " + String(row.reason ?? "unknown") : "not claimed: " + String(row.reason ?? "unknown")))
        if (typeof result.refused === "string") return render([...clears, ...handovers, ...invalid, "cellwork_dispatch refused: " + result.refused].join("\n"))
        // THE SEATS THIS PASS GREW (§4.2): named with the role the member record actually carries, so a
        // §7.1b role loss is visible in the answer instead of surfacing later as a mis-routed seat.
        /** Every seat this pass raised or adopted. */
        const grown = Array.isArray(result.grownSeats) ? result.grownSeats as Array<Record<string, unknown>> : []
        /** The seat line, empty when nothing grew. */
        const seatLines = grown.length === 0 ? [] : ["grew " + String(grown.length) + " seat(s): " + grown.map((row) => String(row.name) + " (" + String(row.role) + ")" + (String(row.rosterRole ?? "") === "" ? " [the member record carries NO role — §7.1b]" : "") + " for " + String(row.taskId)).join(", ")]
        /** Non-fatal seat warnings (the §7.1b role loss, a handle-less seat). */
        const seatWarnings = Array.isArray(result.seatWarnings) ? result.seatWarnings.map((row) => String(row)) : []
        return render([...clears, ...handovers, ...invalid, ...seatLines, ...seatWarnings, ...(pairs.length === 0
          ? ["nothing else dispatched" + (skipped.length === 0 ? "" : " (" + skipped.map((row) => String(row.subject) + ": " + String(row.reason)).join("; ") + ")")]
          : [...pairs.map((row) => String(row.subject) + " -> " + String(row.memberName)), ...(skipped.length === 0 ? [] : ["reported: " + skipped.length])])].join("\n"))
      },
    },
    execute: async (args: unknown, exec: DshToolExec): Promise<ProtocolResult> => {
      /** The caller's context. */
      const caller = callerFor(exec)
      if (caller.refusal !== null) return { ok: false, error: refusalText(caller.refusal), path: caller.refusal.path }
      /** The captain-only refusal, when this caller is not the captain. */
      const refused = captainOnly(caller, "cellwork_dispatch")
      if (refused !== undefined) return refused
      /** The active cell. */
      const cell = caller.cell as CellState
      if (cell.phase === "stopped") return { ok: false, error: "cellwork_dispatch: cell " + cell.cellId + " is stopped and archived" }
      // THE UNFENCE ARGUMENT IS RESOLVED BEFORE ANYTHING IS WRITTEN (contract B2): an unknown name refuses
      // the WHOLE call in the teaching style the other cellwork verbs use, so a typo never clears some
      // fences and silently skips the rest.
      /** The raw `unfence` argument, read defensively because a direct call bypasses the harness schema. */
      const rawUnfence = readArgs(args)["unfence"]
      if (rawUnfence !== undefined && !Array.isArray(rawUnfence)) return { ok: false, error: "cellwork_dispatch: `unfence` must be an array of member names, or of `{member, force}` objects for the bounded forced lever" }
      /** One requested clear: the spelling the caller used and whether it asked for the FORCED lever. */
      const unfenceRequests: Array<{ name: string; force: boolean }> = []
      for (const entry of (rawUnfence ?? [])) {
        // A BARE STRING IS TODAY'S BEHAVIOUR, BYTE-IDENTICALLY (R4.4): `force` defaults to false and every
        // pre-R4 arm must answer exactly as it did. The object form is the ONLY way to ask for the lever.
        if (typeof entry === "string") { unfenceRequests.push({ name: entry.trim(), force: false }); continue }
        if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
          return { ok: false, error: "cellwork_dispatch: every `unfence` entry must be a member name, or an object `{member, force}`" }
        }
        /** The object entry, as an argument record. */
        const shaped = entry as Record<string, unknown>
        if (typeof shaped.member !== "string" || shaped.member.trim() === "") {
          return { ok: false, error: "cellwork_dispatch: a `{member, force}` entry must name a non-empty `member`" }
        }
        if (shaped.force !== undefined && typeof shaped.force !== "boolean") {
          return { ok: false, error: "cellwork_dispatch: `force` must be a boolean when it is present" }
        }
        unfenceRequests.push({ name: shaped.member.trim(), force: shaped.force === true })
      }
      if (unfenceRequests.some((request) => request.name === "")) return { ok: false, error: "cellwork_dispatch: every `unfence` entry must be a non-empty member name" }
      /** The recorded member each spelling resolves to, in the same order (the record is keyed by name). */
      const unfenceTargets: UnfenceTarget[] = []
      /** The record keys already resolved, so ONE member named twice yields ONE outcome, seam call and journal row. */
      const seenTargets = new Set<string>()
      for (const request of unfenceRequests) {
        /** The spelling this request used, already trimmed. */
        const name = request.name
        // ONE RESOLUTION RULE, SHARED WITH `cellwork_send` (repair round 2, finding B): exact table key,
        // then exact display name, then the normalized key ONLY when it is non-empty and unique. An
        // ambiguous normalized key is an UNKNOWN name here, never a guess — `unfence:["运维1"]` must not
        // clear 后端1 because both normalize to `1`.
        /** The member this spelling unambiguously names, or undefined. */
        const resolved = resolveMemberName(cell.members, name)
        if (resolved === undefined) {
          /** The recorded member names, which is what the refusal teaches (the `cellwork_send` style). */
          const recorded = Object.keys(cell.members)
          return { ok: false, error: "cellwork_dispatch: " + JSON.stringify(name) + " is not a member of cell " + cell.cellId + " (members: " + (recorded.length === 0 ? "none recorded" : recorded.join(", ")) + ")" }
        }
        if (seenTargets.has(resolved.key)) continue
        seenTargets.add(resolved.key)
        unfenceTargets.push({ key: resolved.key, name: resolved.member.name, force: request.force })
      }
      // THE TEAM PLANE OWNS THE PAIRING (wave W2-D). This tool asks for ONE owner-only pass and MAPS the
      // report back into the shape it has always answered; the private engine that used to live in
      // `dispatch.ts` is DELETED, so the bundle has exactly one pairing rule. `reassign` goes down RAW:
      // the plane's validator is the one rule, and its refusal sentence comes back on the envelope.
      /** The team-plane write surface, probed per call. */
      const plane = actions()
      if (plane?.dispatch === undefined) return { ok: false, error: "cellwork_dispatch: this composition exposes no mpdTeamActions service, so the team plane cannot be asked to pair rows" }
      /** The instant this call is stamped with (the unfence journal and the pass share it). */
      const now = new Date()
      // THE UNFENCE RUNS BEFORE THE PASS, so `reassign` may hand a row to a member this SAME call just
      // reopened: the plane reads the TEAM row, and a fence cleared after the pass would have skipped it.
      /** The record after the unfence, and one outcome per named member (nothing is written for none). */
      const applied: UnfenceResult = unfenceTargets.length === 0 ? { cell, outcomes: [] } : await unfenceSeats(caller, cell, unfenceTargets, now)
      /** The unfence outcomes; absent from the answer when the call named no member. */
      const unfenced = applied.outcomes
      /** The record the pass below reports against — the reopened one when this call cleared a fence. */
      const current = applied.cell
      /** The raw `reassign` argument, forwarded untouched. */
      const rawReassign = readArgs(args)["reassign"]
      // RUNTIME SEAT GROWTH, BEFORE THE PASS PAIRS (§4.1). The board is resolved through the ONE resolver
      // (§7.1), so a legacy record whose `teamId` names the dead planning team grows seats on the REAL
      // execution board; the grown seats' hand-overs ride the SAME plane call below, so the claim is real.
      /** The board this pass addresses. */
      const board = boardOf(caller.workspace, current)
      /** The growth pass's answer; empty when the board is unreadable or nothing is BUSY. */
      const growth: SeatGrowthResult = await growExecutionSeats({
        dsh,
        workspace: caller.workspace,
        cell: current,
        config,
        captainAgent: exec.agent,
        record: board.record,
        refreshRecord: () => recordOf(caller.workspace, board.teamId),
        rosterRoles: rosterRoles(),
        personaFor: rosterPersona,
        excludeTaskIds: reassignedTaskIds(rawReassign),
        now,
      })
      // THE GROWN SEATS ARE PERSISTED ON THE CELL RECORD before the pass, so the guard and every later
      // reader see the same roster the board carries. The journal rows are already written by growth.
      if (Object.keys(growth.members).length > 0) writeCell(caller.workspace, { ...current, members: { ...current.members, ...growth.members } })
      /** The hand-over argument: the caller's own pairs first, then the growth claims they did not name. */
      const reassignArg = growth.reassign.length === 0
        ? rawReassign
        : rawReassign === undefined || !Array.isArray(rawReassign) ? growth.reassign : [...rawReassign, ...growth.reassign]
      /** The plane's answer. */
      const reply = (await plane.dispatch({
        sessionId: caller.sessionId,
        mode: "owner-only",
        ...(reassignArg === undefined ? {} : { reassign: reassignArg }),
      })) as Record<string, unknown>
      // A REFUSAL IS THE PLANE'S OWN SENTENCE (a malformed `reassign`, an unknown mode, no team), which is
      // what the tool's failure envelope reports — the same shape every other cellwork refusal uses. A
      // refusal AFTER an unfence still reports what the unfence changed, so the side effect is never silent.
      if (reply?.ok === false) return { ok: false, error: String(reply.error ?? "the team plane refused the pass"), ...(unfenced.length === 0 ? {} : { unfenced }) }
      /** The delivered pairings, as this tool reports them. */
      const pairs = Array.isArray(reply.pairs) ? reply.pairs as Array<Record<string, unknown>> : []
      /** The hand-overs the plane performed, reported beside the pass. */
      const reassigned = Array.isArray(reply.reassigned) ? reply.reassigned as Array<Record<string, unknown>> : []
      // THE PLANE'S `cancelled` WORD, SPELLED THE WAY THIS TOOL ALWAYS SPELLED IT: the plane reports the
      // row terminal (one lowercase word, its own vocabulary); cellwork's report has always carried the
      // CANCELLED sentence a captain reads, so the reason is rewritten here — the FACT is the plane's, the
      // WORDS are this tool's contract.
      // THE PLANE REPORTS EVERY ROW IT CONSIDERED; THIS TOOL HAS ALWAYS REPORTED THE ROWS IT DECIDED ABOUT.
      // A finished row is not a decision a captain has to act on, so the informational entries stay out of
      // the report (they were never in it) while every actionable one — blocked, fenced, busy, failed,
      // provisioning, ownerless, cancelled — is kept. This is the tool's documented shape, not a filter of
      // the plane's facts: the board still holds them.
      /** The plane's skips, in this tool's vocabulary. */
      const skipped = Array.isArray(reply.skipped)
        ? (reply.skipped as Array<Record<string, unknown>>)
          .map((row) => row.reason === "cancelled" ? { ...row, reason: "CANCELLED — the row is terminal on the board, so no pass may pair it" } : row)
          .filter((row) => row.reason !== "already completed" && !String(row.reason).startsWith("not ready (status "))
        : []
      // THE PLANE'S SKIP IS THE FACT; GROWTH'S REFUSAL IS THE REASON (§4.1). A row growth could not seat
      // keeps the pass's BUSY skip but carries the cap / non-roster / append sentence instead, so the
      // operator reads WHY the pass left it pending and which knob or declaration repairs it.
      /** Growth's refusal sentence per board id. */
      const growthReason = new Map(growth.refused.map((row) => [row.taskId, row.reason]))
      /** The skips with the growth sentence applied where growth decided the row's fate. */
      const skippedWithSeats = skipped.map((row) => {
        /** The growth sentence for this row, when it has one. */
        const reason = growthReason.get(String(row.taskId))
        return reason === undefined ? row : { ...row, reason }
      })
      // CANCELLED ROWS ARE NAMED HERE TOO. The plane now CLOSES a cancelled row (and reports `cancelled`);
      // this cell also keeps its own `cancelledTasks` map for rows a PREVIOUS build abandoned before the
      // plane knew them, and those must be reported rather than silently absent from the skip list.
      /** The board ids this cell's own record abandoned. */
      const abandoned = new Set(Object.values(current.cancelledTasks ?? {}).filter((id) => id !== ""))
      for (const taskId of abandoned) {
        // ONE guard, and it is LIVE: the plane reports every row it considered, so an abandoned row the
        // PLANE closed is already in `skipped` (as CANCELLED) and must not be listed twice. The old
        // `pairs` guard was DEAD and is gone — the plane never pairs a cancelled row — and a row the plane
        // does not carry at all is added here, because the cell's own map is the only place it is remembered.
        if (skippedWithSeats.some((row) => String(row.taskId) === taskId)) continue
        skippedWithSeats.push({ taskId, subject: "", reason: "CANCELLED — this cell's record abandoned the row, so no pass may pair it" })
      }
      if (reassigned.length > 0) {
        appendJournal(caller.workspace, cell.cellId, { event: "dispatch-reassign", claimed: reassigned.filter((row) => row.claimed === true).length, delivered: reassigned.filter((row) => row.delivered === true).length, rejected: reassigned.filter((row) => row.claimed !== true).length }, now)
      }
      appendJournal(caller.workspace, cell.cellId, { event: "dispatch-pass", pairs: pairs.length, skipped: skippedWithSeats.length, grown: growth.grown.length, ...(board.teamId === "" ? {} : { teamId: board.teamId }) }, now)
      /** The seat projection the answer carries (§4.2), counted after this pass's growth. */
      const seatProjection = seatProjectionOf({ members: { ...current.members, ...growth.members } }, config)
      return {
        ok: true,
        pairs,
        skipped: skippedWithSeats,
        ...(unfenced.length === 0 ? {} : { unfenced }),
        ...(reassigned.length === 0 ? {} : { reassigned }),
        // THE SEAT REPORT (§4.2): the caps, what grew or was reused, and any §7.1b role warning.
        seats: {
          execution: seatProjection.execution,
          planning: seatProjection.planning,
          cap: growth.caps.total,
          capPerRole: growth.caps.perRole,
          grown: growth.grown.length,
          reused: growth.reused.length,
        },
        ...(growth.grown.length === 0 ? {} : { grownSeats: growth.grown }),
        ...(growth.warnings.length === 0 ? {} : { seatWarnings: growth.warnings }),
      }
    },
  }))

  // ── cellwork_supervise ───────────────────────────────────────────────────
  disposers.push(dsh.registerTool({
    name: "cellwork_supervise",
    description: "CAPTAIN only: one READ-ONLY sweep of the cell — every member's mode / handoff state / live context ratio, the pending board tasks, the stale-split flags, the CLOSED seats together with the open rows they own, and the unread mail (including rows whose wake-up never went out). CLOSED SEATS COME IN THREE KINDS and the sweep names which, because only TWO of them are the captain's to repair: a GIVE-UP fence (an explicit `fenced:true` on EITHER record) gets the two levers — `reassign` its open rows with `cellwork_dispatch {reassign:[...]}`, and clear the fence with `cellwork_dispatch {unfence:[...]}`; a BARRIER-OWNED seat (the TEAM/CELL row at `mode:\"checkpoint\"` with NO `fenced` marker, the window every handoff opens) is reported with `barrierOwned`, `forceEligible` and `pendingMs` — the compaction barrier OWES that seat its reopen, but nothing supervises the barrier, so a seat it can no longer run for needs the BOUNDED forced lever (`cellwork_dispatch {unfence:[{member, force:true}]}`, allowed only when the recorded session is not live and the window's written bound is reached). A DEAD-RESEED seat (a reseeded `subcaptain` row whose recorded session the registry PROVES dead and which no barrier will run for) is reported as a closed seat with `barrierOwned:false`, `suspect:true` and the same `forceEligible` answer the verb uses — ONE predicate, so the lever the sweep advertises is the lever `unfence:[{member, force:true}]` accepts. A closed seat whose TEAM half is a `checkpoint` no barrier is pending for carries `retry`, the exact Lead-only verb that reopens it. A member is reported `suspect:true` only when a window stamp exists, the registry is PRESENT, its CAPTAIN anchor resolves, and the recorded session does not — a present registry that cannot resolve that anchor answers `unknown`, which licenses nothing. Call it on every wake-up; it mutates nothing.",
    parameters: { type: "object", properties: {
      limit: { type: "integer", description: "Rows to render (default 20, clamped 1..100)." },
      offset: { type: "integer", description: "First row of the page (default 0)." },
    }, additionalProperties: false },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          cellId: { type: "string" },
          phase: { type: "string" },
          teamId: { type: "string", description: "The RESOLVED execution board this sweep read (§7.1), not necessarily the id the cell record carries." },
          recordedTeamId: { type: "string", description: "The team id the CELL RECORD names; differs from `teamId` exactly when the record is stale." },
          planningTeamId: { type: "string", description: "The staging team the record preserved, or \"\" when it carries none." },
          boardResolution: { type: "string", description: "Which evidence named the board: `plane` | `activated-tasks` | `state.teamId` | `planningTeamId` | `none`." },
          disagreement: { type: "boolean", description: "True when the cell record's teamId and the winning resolution name DIFFERENT teams; the note names both." },
          boardResolutionNote: { type: "string", description: "The disagreement sentence naming BOTH ids and the resolution that won; absent when they agree (§7.1)." },
          seats: {
            type: "object",
            description: "The seat projection (§4.2): execution seats (planning excluded), planning seats, the two caps, the grown count, and the last cap refusal growth journaled.",
            properties: {
              execution: { type: "number" },
              planning: { type: "number" },
              cap: { type: "number" },
              capPerRole: { type: "number" },
              grown: { type: "number" },
              refusal: { type: "string" },
            },
          },
          members: { type: "array", items: { type: "object" } },
          tasks: { type: "array", items: { type: "object" } },
          staleSplit: { type: "boolean" },
          splitRevision: { oneOf: [{ type: "number" }, { type: "null" }] },
          requirementsRevision: { type: "number" },
          handoffReady: { type: "array", items: { type: "string" } },
          fenced: { type: "array", items: { type: "object" }, description: "Every CLOSED member with the reason and the OPEN board rows it still owns. Each row carries `giveUp:true` for a real GIVE-UP fence (an explicit `fenced:true` on either record) — the rows a `reassign` pass repairs and `cellwork_dispatch {unfence:[name]}` clears — or `giveUp:false` for a HELD seat with no fence marker — the compaction barrier's `mode:\"checkpoint\"` window, or the DEAD-RESEED shape flagged `deadReseed:true`. Every closed-seat row ALSO carries `barrierOwned` (a checkpoint spelling, not a fence marker, is what holds it), `forceEligible` (the FORCED `unfence:[{member, force:true}]` lever would be allowed RIGHT NOW — computed by the SAME predicate the verb decides with, so the two cannot disagree), `pendingMs` (how long the window has been open, when a timestamp exists), `suspect:true` for the DEAD-RESEED shape (a reseeded seat whose recorded session the registry proves dead), and `retry` when the TEAM half is a `checkpoint` no barrier is pending for — the exact Lead-only verb that reopens it (R5.4). A barrier-owned seat is not automatically safe: nothing supervises the barrier, so the render names the force lever and its bound instead of promising that no action is needed." },
          unreadMail: { type: "number" },
          wakeFailures: { type: "array", items: { type: "object" } },
        },
        required: ["ok"],
      },
      render: (_args: unknown, value: unknown): unknown => {
        /** The result as a record. */
        const result = typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
        if (result.ok === false) return render("cellwork_supervise refused: " + String(result.error ?? "unknown refusal"))
        /** The member rows. */
        const members = Array.isArray(result.members) ? result.members as Array<Record<string, unknown>> : []
        /** The task rows. */
        const tasks = Array.isArray(result.tasks) ? result.tasks as Array<Record<string, unknown>> : []
        /** The fenced members, with the rows a reassignment would move. */
        const fenced = Array.isArray(result.fenced) ? result.fenced as Array<Record<string, unknown>> : []
        /** The seat projection, when the answer carries one. */
        const seats = typeof result.seats === "object" && result.seats !== null ? result.seats as Record<string, unknown> : undefined
        // THE BOARD LINE NAMES THE RESOLVED TEAM AND, WHEN THEY DISAGREE, BOTH IDS (§7.1): an operator
        // supervising a legacy cell must be able to see that the record's id is stale and which board the
        // counts below actually came from.
        /** The board line: resolved team, the record's id when it differs, and the seat projection. */
        const boardLine = "board: " + (String(result.teamId ?? "") === "" ? "none resolved" : String(result.teamId) + " (" + String(result.boardResolution ?? "?") + ")")
          + (typeof result.recordedTeamId === "string" && result.recordedTeamId !== "" && result.recordedTeamId !== result.teamId ? " · the cell record names " + result.recordedTeamId : "")
          + (seats === undefined ? "" : " · seats " + String(seats.execution) + " execution / " + String(seats.planning) + " planning, caps " + String(seats.cap) + "/" + String(seats.capPerRole) + ", grown " + String(seats.grown))
          + (seats !== undefined && typeof seats.refusal === "string" ? "\n  last growth refusal: " + seats.refusal : "")
          + (typeof result.boardResolutionNote === "string" ? "\n  " + result.boardResolutionNote : "")
        return render([
          "cell " + String(result.cellId ?? "") + " · phase " + String(result.phase ?? "") + " · split " + String(result.splitRevision ?? "none") + (result.staleSplit === true ? " (STALE)" : "") + " · requirements rev " + String(result.requirementsRevision ?? 0),
          boardLine,
          "members: " + members.map((row) => String(row.name) + "[" + String(row.mode) + (row.handoffReady === true ? ",handoff-ready" : "") + (row.suspect === true ? ",SUSPECT" : "") + (typeof row.ratio === "number" ? "," + Math.round((row.ratio as number) * 100) + "%" : "") + (row.suspect === true ? ": the recorded session is not a live agent, so the reseed did not produce a working child" : "") + "]").join(" "),
          "tasks: " + (tasks.length === 0 ? "none" : tasks.map((row) => String(row.id) + " " + String(row.status) + (row.owner === undefined ? "" : "(" + String(row.owner) + ")")).join(" ")),
          "fenced: " + (fenced.length === 0
            ? "none"
            : fenced.map((row) => {
              /** The member's name, quoted back exactly as the record spells it. */
              const name = String(row.name)
              /** The record's own sentence for why the seat is closed. */
              const reason = String(row.reason)
              /** The open board rows this seat still owns, if any. */
              const owned = Array.isArray(row.tasks) ? (row.tasks as unknown[]).map((id) => String(id)) : []
              // A BARRIER-OWNED SEAT IS NOT AUTOMATICALLY SAFE (R4.5): nothing supervises the barrier —
              // no timer, no queue, no retry owner — so the old "nothing for you to do" was a promise the
              // code cannot keep. The render names the barrier's duty AND the bounded lever's state: the
              // unforced verb still answers `checkpoint-pending` (the barrier owns the window), while the
              // FORCED lever is allowed only once a written bound is reached.
              if (row.giveUp !== true) {
                // TWO HELD SHAPES, NAMED APART (R5.2): a checkpoint window the barrier still owes, and the
                // dead-reseed seat it can never run for. The second one is NOT barrier-owned, and calling
                // it that hid the incident behind a sentence about a barrier that would never come back.
                /** Whether this is the DEAD-RESEED shape rather than the barrier's own window. */
                const deadReseed = row.deadReseed === true
                /** Why the forced lever would be refused right now, when it would be. */
                const blocked = row.liveness === "live"
                  ? "the recorded session is still a LIVE agent"
                  : row.pendingMs === undefined
                    ? "no checkpoint timestamp is recorded, and a missing timestamp is never a licence"
                    : "the written bound is not reached yet (`barrierFailures` below the retry budget and the window younger than the pending bound)"
                /** The plane retry a refused/never-attempted TEAM reopen is repaired with (R5.4). */
                const retry = typeof row.retry === "string" ? " · the TEAM seat is still `checkpoint` while no barrier is pending for it, so the plane half needs " + row.retry : ""
                return name + " (" + reason + ", " + (deadReseed ? "DEAD-RESEED" : "BARRIER-OWNED") + ") " + (owned.length > 0 ? "owns " + owned.join(", ") + " — " : "")
                  + (row.forceEligible === true
                    ? deadReseed
                      ? "the reseed's child is not a live agent, so nothing will reopen this seat by itself; the bounded lever is allowed now: cellwork_dispatch {unfence:[{member:" + JSON.stringify(name) + ", force:true}]} — it reopens the seat for REASSIGNMENT, not for work (its context was never compacted)"
                      : "the barrier has NOT reopened this seat and no supervisor can; the bounded lever is allowed now: cellwork_dispatch {unfence:[{member:" + JSON.stringify(name) + ", force:true}]} — it reopens the seat for REASSIGNMENT, not for work (its context was never compacted)"
                    : "the barrier reopens this seat when it completes; nothing supervises it, so if it never does, the bounded lever becomes available once the retry budget or the pending bound is reached — " + blocked) + retry
              }
              return name + " (" + reason + ") owns " + (owned.length > 0 ? owned.join(", ") + " — reassign those with cellwork_dispatch {reassign:[{task_id, owner}]}, and" : "no open row —") + " clear the fence with cellwork_dispatch {unfence:[" + JSON.stringify(name) + "]}"
            }).join("; ")),
          "unread mail: " + String(result.unreadMail ?? 0) + (Array.isArray(result.wakeFailures) && result.wakeFailures.length > 0 ? " · " + String((result.wakeFailures as unknown[]).length) + " without a wake-up" : ""),
        ].join("\n"))
      },
    },
    execute: async (_args: unknown, exec: DshToolExec): Promise<ProtocolResult> => {
      /** The caller's context. */
      const caller = callerFor(exec)
      if (caller.refusal !== null) return { ok: false, error: refusalText(caller.refusal), path: caller.refusal.path }
      /** The captain-only refusal, when this caller is not the captain. */
      const refused = captainOnly(caller, "cellwork_supervise")
      if (refused !== undefined) return refused
      /** The active cell. */
      const cell = caller.cell as CellState
      /** The instant this sweep measures every window age against (one clock for the whole answer). */
      const now = new Date()
      /** The live record. */
      // THE BOARD IS RESOLVED, NOT TRUSTED FROM THE RECORD (§7.1/§7.1a): a legacy cell whose `teamId`
      // names the ended planning team must be swept on its REAL execution board, and a disagreement is
      // reported below with BOTH ids instead of silently preferring one.
      /** The resolved board and its evidence. */
      const board = boardOf(caller.workspace, cell)
      /** The cell as the plane readers must see it: the resolved team id, so their reads land on the board. */
      const boardCell: CellState = board.teamId === "" || board.teamId === cell.teamId ? cell : { ...cell, teamId: board.teamId }
      /** The live record. */
      const record = board.record
      /** The board rows this build can read. */
      const tasks = record !== undefined && Array.isArray(record.tasks) ? (record.tasks as Array<Record<string, unknown>>) : []
      /** Every member's live reading. */
      const members = Object.values(cell.members).map((member) => {
        // THE PLANE FIRST, the adapter only as the documented degradation (see `planePressureOf`): the
        // sweep reports the provenance the seat's own row would report, so two surfaces cannot disagree.
        /** The plane's reading for this seat, when it answered. */
        const plane = planePressureOf(teams(), caller.workspace, boardCell.teamId, member.name)
        /** The live pressure reading, which is total on the adapter. */
        /** The seat as the PLANE reads it, when the record names this member. */
        const seat = recordSeat(boardCell, caller.workspace, member.name)
        // THE RECORD IS THE AUTHORITY FOR `mode` AND `fenced` (wave W2-E): the cell row is the mirror, so a
        // plane-side fence is reported even before the mirror catches up. The planner's own reading wins
        // when it answered, and the adapter's meter is the fallback (a total read, never a guess).
        /** The live pressure reading: the planner's, or the adapter's meter. */
        const pressure = plane ?? dsh.contextPressure(member.sessionId === "" ? member.name : member.sessionId)
        // THE WINDOW'S CLOCK AND THE SEAT'S LIVENESS (R4.2): a reseed records `subcaptain` + a dead child,
        // which looked exactly like a healthy promotion. The age is measured from the recorded instant (or
        // the last checkpoint for the SAME session), and a live registry that answers NOTHING is the ONLY
        // evidence of a dead seat — an absent registry is `unknown` and never suspect.
        // THE FORCED LEVER'S ONE PREDICATE (R5.2): the SAME reading `cellwork_dispatch {unfence}` decides
        // with, projected READ-ONLY, so the sweep can never advertise a lever the verb refuses.
        /** The one forced-lever reading for this seat. */
        const reading = forceReadingOf(boardCell, caller.workspace, member, now)
        return {
          name: member.name,
          mode: seat.mode ?? member.mode,
          role: member.role,
          handoffReady: seat.checkpoint ?? member.handoffReady,
          handoffs: member.handoffs,
          ratio: pressure.ratio,
          usedTokens: pressure.usedTokens,
          windowTokens: pressure.windowTokens,
          provenance: pressure.provenance,
          liveness: reading.liveness,
          ...(reading.pendingMs === undefined ? {} : { pendingMs: reading.pendingMs }),
          ...(reading.suspect ? { suspect: true } : {}),
          ...(reading.pendingMs === undefined && !reading.closed ? {} : { forceEligible: reading.forceEligible }),
        }
      })
      /** The folded mail. */
      const messages = foldCellMail(readCellMail(caller.workspace, cell.cellId))
      // THE CLOSED SEATS AND THEIR OPEN ROWS (C7): a closed seat cannot claim, so the captain reads the
      // rows to reassign HERE, from the read-only sweep, instead of reconstructing them from the journal.
      /** Every closed seat, with the reason, its open board rows, and whether it is a real give-up fence. */
      const fenced = Object.values(cell.members).flatMap((member) => {
        /** The seat as the PLANE reads it, when the record names this member. */
        const seat = recordSeat(boardCell, caller.workspace, member.name)
        // WHY THE PLANE WINS: an explicit fence written by `mpdTeamActions.fence` is a fact; the cell row's
        // own `mode` can lag it by a turn. When the record says the seat is closed, that reason is reported.
        // GIVE-UP vs BARRIER-OWNED (repair round 3): only an EXPLICIT `fenced:true` on either record is a
        // give-up the captain may clear. A `mode:"checkpoint"` window on its own is the compaction
        // barrier's, and the render offers no lever for it.
        /** Whether this is a real give-up fence rather than the barrier's pending checkpoint window. */
        const giveUp = member.fenced === true || seat.fenced === true
        // THE REASON FOLLOWS THE SAME SPLIT (repair round 4). The barrier records the CAUSE on the CELL row
        // (`fencedReason`), while the TEAM row carries only the checkpoint half of that same event — so a
        // give-up speaks with the CELL row's own sentence, and a fence that exists only on the TEAM row
        // speaks in the plane's vocabulary. `recordSeat`'s DERIVED "…until the barrier reopens it" sentence
        // describes the barrier-owned window alone; printing it beside an `unfence` lever hid the cause and
        // contradicted `giveUp:true` on the same line.
        /** Why this member is closed, or undefined when it can work. */
        const reason = member.fenced === true ? fenceReasonOf(member) : seat.fenceReason ?? fenceReasonOf(member)
        // THE SEAT THE SWEEP MUST NOT HIDE (R5.2): the ONE predicate decides whether this seat is held at
        // all. It answers TRUE for the DEAD-RESEED shape (`subcaptain`, not handoff-ready, a session the
        // registry proves dead), which `barrierOwned` alone never covered — so the seat the incident left
        // behind is REPORTED here with the same lever the verb accepts, instead of disappearing.
        /** The one forced-lever reading for this seat, shared with `cellwork_dispatch {unfence}`. */
        const reading = forceReadingOf(boardCell, caller.workspace, member, now)
        // THREE WAYS A SEAT IS CLOSED: the explicit give-up marker (either record), the barrier's window,
        // and the dead-reseed shape. The give-up needs no reading — its marker IS the fact.
        if ((!reading.closed && !giveUp) || reason === undefined) return []
        // THE THREE FIELDS THE CAPTAIN ACTS ON (R4.5). `giveUp` stays untouched, so `reassign`/`unfence`
        // keep their meaning; these say what KIND of closed seat this is and whether the bounded force
        // lever applies RIGHT NOW. Nothing here promises the barrier will come back — nothing supervises it.
        // A PLANE-ONLY CHECKPOINT WITH NO PENDING BARRIER NAMES ITS RETRY (R5.4): the TEAM seat is
        // `checkpoint` while the CELL row already left the window, so no barrier will reopen it and the
        // cellwork verbs cannot re-drive the seam. The exact Lead-only verb that does is handed over here.
        /**
         * Whether the plane holds a bare checkpoint the barrier is no longer pending for.
         *
         * NOT an explicit plane fence: that one is cleared by `cellwork_dispatch {unfence:[name]}` itself
         * (the team-only case), so naming the plane verb there would send the captain past the nearer
         * lever. This is the shape a REFUSED barrier reopen leaves behind.
         */
        const planeOnly = seat.checkpoint === true && seat.fenced !== true && member.mode !== "checkpoint" && member.handoffReady !== true
        /** The open rows credited to this member — the ones a `reassign` pass could move. */
        const owned = tasks.filter((task) => {
          /** The row's status: a terminal row is finished work, never a row to hand over. */
          const status = String(task.status ?? "")
          return status !== "completed" && status !== "failed" && nameKey(String(task.owner ?? "")) === nameKey(member.name)
        }).map((task) => String(task.id ?? ""))
        return [{ name: member.name, mode: seat.mode ?? member.mode, reason, tasks: owned, giveUp, barrierOwned: reading.barrierOwned, forceEligible: reading.forceEligible, liveness: reading.liveness, ...(reading.suspect ? { suspect: true } : {}), ...(reading.deadReseed ? { deadReseed: true } : {}), ...(reading.pendingMs === undefined ? {} : { pendingMs: reading.pendingMs }), ...(planeOnly ? { retry: planeRetryOf(member.name) } : {}) }]
      })
      /** The seat projection this sweep reports (§4.2). */
      const seatProjection = seatProjectionOf(cell, config)
      // A CAP REFUSAL IS REPEATED VERBATIM (§4.2): the sweep reads growth's own journal sentence instead
      // of re-deriving the cap decision, so the number the operator sees is the number that stopped it.
      /** The last growth refusal the cell journaled, when there was one. */
      const growthRefusal = lastSeatGrowthRefusalOf(caller.workspace, cell.cellId)
      return {
        ok: true,
        cellId: cell.cellId,
        phase: cell.phase,
        // THE RESOLVED BOARD AND ITS EVIDENCE (§7.1): `teamId` is the board the counts came from, and a
        // disagreement with the record is reported with BOTH ids — never silently preferred.
        teamId: board.teamId,
        recordedTeamId: board.recordedTeamId,
        planningTeamId: board.planningTeamId,
        boardResolution: board.resolution,
        // The resolver's OWN disagreement flag (§7.1), so the sweep is branchable without parsing the note.
        disagreement: board.disagreement,
        ...(board.note === undefined ? {} : { boardResolutionNote: board.note }),
        members,
        tasks: tasks.map((task) => superviseTaskRow(task)),
        staleSplit: cell.splitStale,
        splitRevision: cell.splitRevision,
        requirementsRevision: cell.requirementsRevision,
        handoffReady: Object.values(cell.members).filter((member) => member.handoffReady).map((member) => member.name),
        fenced,
        seats: {
          execution: seatProjection.execution,
          planning: seatProjection.planning,
          cap: seatProjection.cap,
          capPerRole: seatProjection.capPerRole,
          grown: seatProjection.grown,
          ...(growthRefusal === undefined ? {} : { refusal: growthRefusal }),
        },
        unreadMail: messages.filter((message) => !message.read).length,
        wakeFailures: wakeFailures(messages).map((message) => ({ id: message.id, to: message.to, subject: message.subject, reason: message.wakeReason ?? "no wake-up was attempted" })),
      }
    },
  }))

  // ── cellwork_context ─────────────────────────────────────────────────────
  disposers.push(dsh.registerTool({
    name: "cellwork_context",
    description: "Any cell seat: the caller's OWN live context occupancy — used tokens, the observed window and its provenance, the ratio, the checkpoint threshold in force, and whether a checkpoint would fire at this step. Never transitions the cell: its ONE write is ADOPTING a live team seat the record never learned, so a member added mid-run becomes a seat. Never guesses a window (provenance `no-window`/`unavailable` answers null).",
    parameters: { type: "object", properties: {
      limit: { type: "integer", description: "Rows to render (default 20, clamped 1..100)." },
      offset: { type: "integer", description: "First row of the page (default 0)." },
    }, additionalProperties: false },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          member: { type: "string" },
          mode: { type: "string" },
          usedTokens: { oneOf: [{ type: "number" }, { type: "null" }] },
          windowTokens: { oneOf: [{ type: "number" }, { type: "null" }] },
          ratio: { oneOf: [{ type: "number" }, { type: "null" }] },
          provenance: { type: "string" },
          checkpointRatio: { type: "number" },
          willCheckpoint: { type: "boolean" },
          reason: { type: "string" },
          teamId: { type: "string", description: "The RESOLVED execution board the plane meter was read through (§7.1a)." },
          planeRead: { type: "string", description: "`read` when the team plane answered, `unavailable` when the adapter fallback supplied the reading." },
          planeNote: { type: "string", description: "The sentence naming the board the plane could not answer for; absent when it answered." },
        },
        required: ["ok"],
      },
      render: (_args: unknown, value: unknown): unknown => {
        /** The result as a record. */
        const result = typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
        if (result.ok === false) return render("cellwork_context refused: " + String(result.error ?? "unknown refusal"))
        return render(String(result.member ?? "?") + " [" + String(result.mode ?? "?") + "] used " + String(result.usedTokens ?? "?") + " / " + String(result.windowTokens ?? "no window") + " (" + String(result.provenance) + ")" + (typeof result.ratio === "number" ? " = " + Math.round((result.ratio as number) * 100) + "%" : "") + " · checkpoint at " + String(Math.round(Number(result.checkpointRatio ?? 0) * 100)) + "% · would fire: " + String(result.willCheckpoint === true) + (String(result.reason ?? "") === "" ? "" : " (" + String(result.reason) + ")") + (typeof result.planeNote === "string" ? "\n  " + result.planeNote : ""))
      },
    },
    execute: async (_args: unknown, exec: DshToolExec): Promise<ProtocolResult> => {
      /** The caller's context. */
      const caller = callerFor(exec)
      if (caller.refusal !== null) return { ok: false, error: refusalText(caller.refusal), path: caller.refusal.path }
      if (caller.cell === null || caller.member === "") return { ok: false, error: "cellwork_context: this session belongs to no active cell" }
      // THE TEAM PLANE IS THE AUTHORITY when it can answer: `mpdTeams.memberContext` is the SAME meter
      // read through the row that owns the seat, so its provenance is what the caller is told. Only a
      // composition where that service (or its member) is absent reads the adapter directly — the same
      // degradation every seam in this bundle documents.
      // THE READ RUNS ON THE RESOLVED BOARD (§7.1a site 5): `cell.teamId` may name the dead planning team,
      // and reading the meter through it silently degraded every execution seat to the adapter fallback.
      /** The resolved execution board. */
      const board = boardOf(caller.workspace, caller.cell)
      /** The plane's reading, when it answered. */
      const plane = planePressureOf(teams(), caller.workspace, board.teamId, caller.member)
      /** The live reading for the caller's own session. */
      const pressure = plane ?? dsh.contextPressure(exec.agent)
      /** The checkpoint decision this reading would produce. */
      const plan: CheckpointPlan = planCheckpoint(caller.cell, caller.member, pressure, config, null)
      return {
        ok: true,
        member: caller.member,
        mode: caller.seat?.mode ?? "member",
        // THE RESOLVED BOARD AND THE PLANE'S HALF ARE NAMED, NEVER SILENT (§7.1a): when the plane could not
        // answer on a board that DID resolve, the adapter fallback is labelled instead of passing as the
        // authoritative reading.
        teamId: board.teamId,
        planeRead: plane === undefined ? "unavailable" : "read",
        ...(plane === undefined && board.teamId !== "" ? { planeNote: "the team plane's member meter could not answer for " + JSON.stringify(board.teamId) + ", so this reading came from the adapter" } : {}),
        usedTokens: pressure.usedTokens,
        windowTokens: pressure.windowTokens,
        ratio: pressure.ratio,
        provenance: pressure.provenance,
        checkpointRatio: config.checkpointRatio,
        willCheckpoint: plan.inject,
        reason: plan.reason,
      }
    },
  }))

  // ── cellwork_handoff ─────────────────────────────────────────────────────
  disposers.push(dsh.registerTool({
    name: "cellwork_handoff",
    description: "A MEMBER's checkpoint duty: validate a handoff document (task, state, decisions, artifacts, verified facts, open questions, next step), write `handoff/<member>-<n>.md`, mark the member handoff-ready and journal it. A member known only to the LIVE team record is ADOPTED first — mirrored into the cell record by this call — and then gets the same channel. The result tells the agent to END ITS TURN; the plugin then compacts and promotes (or reseeds) it.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "The complete handoff document (markdown headings or `Key:` lines)." },
      },
      required: ["content"],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          path: { type: "string" },
          member: { type: "string" },
          ordinal: { type: "number" },
          missing: { type: "array", items: { type: "string" } },
          sections: { type: "array", items: { type: "object" } },
          directive: { type: "string" },
        },
        required: ["ok"],
      },
      render: (_args: unknown, value: unknown): unknown => {
        /** The result as a record. */
        const result = typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
        if (result.ok === false) return render("cellwork_handoff refused: " + String(result.error ?? "unknown refusal") + (Array.isArray(result.missing) && result.missing.length > 0 ? "\nmissing sections: " + result.missing.join(", ") : ""))
        return render(String(result.directive ?? ""))
      },
    },
    execute: async (args: unknown, exec: DshToolExec): Promise<ProtocolResult> => {
      /** The caller's context. */
      const caller = callerFor(exec)
      if (caller.refusal !== null) return { ok: false, error: refusalText(caller.refusal), path: caller.refusal.path }
      if (caller.cell === null || caller.member === "") return { ok: false, error: "cellwork_handoff: this session belongs to no active cell" }
      /** The member row. */
      const member = caller.cell.members[caller.member]
      if (member === undefined) return { ok: false, error: "cellwork_handoff: " + JSON.stringify(caller.member) + " is not a recorded cell member" }
      // AN ADOPTION THAT COULD NOT BE PERSISTED IS NOT A SEAT (CodeRabbit round 1, finding 1). The caller
      // resolved against an in-memory mirror, so recording the checkpoint on the plane now would leave a
      // team checkpoint with no adopted cell row. The plane is NOT touched until the record has the row.
      if (caller.adoptionFailure !== undefined) {
        /** Which half of the adoption failed; the headline must name THAT, not a write that never happened. */
        const failure = caller.adoptionFailure
        return { ok: false, error: "cellwork_handoff: this seat (" + JSON.stringify(caller.member) + ") was NOT adopted — " + (failure.kind === "read" ? "the cell record could not be read" : "the cell record could not be written") + ": " + failure.detail + ". The TEAM checkpoint was NOT recorded; retry once the cell record is " + (failure.kind === "read" ? "readable" : "writable") }
      }
      if (caller.sessionId === caller.cell.captainSessionId) return { ok: false, error: "cellwork_handoff: the captain is never checkpointed (declared bound) — it dispatches, it does not hand off" }
      // ONE HANDOFF PER CHECKPOINT (C7): a second document while the first still waits for the barrier is
      // the 3-handoffs-in-7-minutes livelock D5 recorded, and the barrier reads only the LATEST ordinal —
      // so the refusal is what saves the continuity, not the write.
      if (member.handoffReady) {
        return { ok: false, error: "cellwork_handoff: the handoff " + JSON.stringify(caller.member) + " already wrote (handoff/" + String(member.handoffs) + ") is STILL WAITING for the compaction barrier — END YOUR TURN now instead of writing a second document; the barrier compacts and promotes you from the FIRST one" }
      }
      /** The document the member wrote. */
      const content = argString(readArgs(args), "content")
      if (content.trim() === "") return { ok: false, error: "cellwork_handoff: `content` is required — the handoff document IS the continuity, so there is nothing to validate without it" }
      /** The section validation. */
      const validation = validateHandoffText(content)
      if (!validation.ok) return { ok: false, error: "cellwork_handoff: the document is INCOMPLETE — these sections are missing or empty: " + validation.missing.join(", "), ...{ missing: validation.missing, sections: validation.sections } }
      /** The ordinal of this handoff (one past the last one written). */
      const ordinal = member.handoffs + 1
      // THE PLANE IS THE AUTHORITY FOR THE SEAT (wave W2-D step 4): the checkpoint is recorded THROUGH
      // `mpdTeamActions.handoff`, which writes the team record's `mode:"checkpoint"` — the ONE spelling a
      // dispatch pass reads (`team-store.ts#memberIsCheckpoint`). Cellwork still writes its own
      // seven-section document (the cell's continuity file), but its `handoffReady` flag is a MIRROR
      // written ONLY after the plane accepted the record.
      /** The team-plane write surface, probed per call. */
      const plane = actions()
      if (plane?.handoff === undefined) return { ok: false, error: "cellwork_handoff: this composition exposes no mpdTeamActions service, so the checkpoint cannot be recorded and the seat would stay open" }
      /** The plane's answer — the authority for the seat state. */
      const recorded = (await plane.handoff({ sessionId: caller.sessionId, content })) as Record<string, unknown>
      if (recorded?.ok === false) return { ok: false, error: String(recorded.error ?? "the team plane refused the handoff, so nothing was written") }
      /** The absolute path written by THIS row (the cell's own copy of the document). */
      const path = writeHandoff(caller.workspace, caller.cell.cellId, caller.member, ordinal, content)
      /** The instant of the write. */
      const now = new Date()
      /** The MIRROR: the cell record follows the plane, never the other way round. */
      const next: CellState = { ...caller.cell, members: { ...caller.cell.members, [caller.member]: { ...member, handoffReady: true, handoffs: ordinal } } }
      transition(caller.workspace, next, { event: "handoff", member: caller.member, ordinal, path, nextStep: nextStepOf(content) }, now)
      return { ok: true, path, member: caller.member, ordinal, sections: validation.sections, directive: handoffWrittenDirective(path) }
    },
  }))

  // ── cellwork_subteam ─────────────────────────────────────────────────────
  disposers.push(dsh.registerTool({
    name: "cellwork_subteam",
    description: "A promoted SUBCAPTAIN's tool: register a sub-cell (parentCellId, depth+1) and receive the sub-captain directive. REFUSES `depth + 1 > cellwork.depth.max` with the exact bound. The sub-team itself is staged by the promoted agent with `agent_teams_plan`.",
    parameters: {
      type: "object",
      properties: {
        objective: { type: "string", description: "The sub-cell's objective, in the user's terms." },
      },
      required: ["objective"],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          cellId: { type: "string" },
          parentCellId: { type: "string" },
          // The parent cell's TEAM id, recorded on the sub-cell: the box this sub-team will nest inside.
          parentTeamId: { type: "string" },
          depth: { type: "number" },
          directive: { type: "string" },
        },
        required: ["ok"],
      },
      render: (_args: unknown, value: unknown): unknown => {
        /** The result as a record. */
        const result = typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
        if (result.ok === false) return render("cellwork_subteam refused: " + String(result.error ?? "unknown refusal"))
        return render(String(result.directive ?? ""))
      },
    },
    execute: async (args: unknown, exec: DshToolExec): Promise<ProtocolResult> => {
      /** The caller's context. */
      const caller = callerFor(exec)
      if (caller.refusal !== null) return { ok: false, error: refusalText(caller.refusal), path: caller.refusal.path }
      if (caller.cell === null || caller.member === "") return { ok: false, error: "cellwork_subteam: this session belongs to no active cell" }
      // TWO SEATS MAY NEST, and they are the same person seen from two frames: a promoted member (a
      // `subcaptain` seat in the PARENT cell) and the CAPTAIN of a cell that is itself a sub-cell —
      // which is where R1's tree resolution puts that member once its own cell exists. The TOP cell's
      // captain is excluded, because promotion is what earns a sub-cell.
      /** Whether this caller may register a sub-cell. */
      const mayNest = caller.seat?.mode === "subcaptain" || (caller.seat?.mode === "captain" && caller.cell.parentCellId !== null)
      if (!mayNest) return { ok: false, error: "cellwork_subteam is SUBCAPTAIN ONLY: this session is " + JSON.stringify(caller.member) + " in mode " + JSON.stringify(caller.seat?.mode ?? "none") + " — a sub-cell is registered by a member the plugin promoted after its handoff+compaction (or by the captain of a sub-cell, to nest deeper)" }
      /** The parent cell. */
      const parent = caller.cell
      if (parent.phase === "stopped") return { ok: false, error: "cellwork_subteam: cell " + parent.cellId + " is stopped and archived" }
      // THE DEPTH DECISION IS THE TEAM PLANE'S when it can answer (contract 4.4/D4): the bound is the
      // SAME `cellwork.depthMax` the plane reads, so a cell and its team cannot disagree about how deep
      // the project may nest. The cell record is the documented fallback when that service is absent —
      // it is the mirror of the same fact, not a second policy.
      /** The plane's depth reading for this cell's team, when it answered. */
      const planeDepth = planeDepthOf(teams(), caller.workspace, parent.teamId)
      /** The depth this cell sits at, by the authority that answered. */
      const parentDepth = planeDepth?.depth ?? parent.depth
      /** The depth the child would take. */
      const childDepth = parentDepth + 1
      /** The bound this refusal enforces: the plane's when it answered, the row config otherwise. */
      const depthMax = planeDepth?.depthMax ?? config.depthMax
      if (childDepth > depthMax) {
        return { ok: false, error: "cellwork_subteam: REFUSED — a sub-cell at depth " + String(childDepth) + " exceeds cellwork.depth.max = " + String(depthMax) + " (this cell is depth " + String(parentDepth) + "). Do the work inside this cell instead." }
      }
      /** The objective in the user's terms. */
      const objective = argString(readArgs(args), "objective").trim()
      if (objective === "") return { ok: false, error: "cellwork_subteam: `objective` is required — a sub-cell needs its own objective" }
      /** The instant the sub-cell is minted. */
      const now = new Date()
      // THE ID MUST NOT COLLIDE WITH AN EXISTING CELL (`cellIdAt` is millisecond-precision and a sub-cell
      // registered inside the parent's own minting millisecond would OVERWRITE that record). Measured while
      // proving D5: the collision silently replaced the parent cell's record with the sub-cell's. The
      // command path already mints through `freeCellId` for exactly this reason; this path now does too.
      /** The new sub-cell's id, free of every cell directory this workspace already has. */
      const subcellId = freeCellId(caller.workspace, now)
      // THE CELL PLANE'S HALF OF THE NESTING (cellwork wave 4, contract D5): the parent CELL already
      // knows which TEAM it drives, so the sub-cell records that team here. The sub-team's own
      // `parentTeamId` is passed nowhere — the team plane derives it at approval from the parent team's
      // roster, which records this promoted member's session — but the cell record can now be read
      // against it, and the directive tells the subcaptain where its box will land.
      /** The parent cell's live team id, or `""` when that cell never approved a team. */
      const parentTeamId = parent.teamId
      /** The sub-cell record: its captain is the promoted member calling this tool. */
      const subcell: CellState = { ...newCellState({ cellId: subcellId, objective, captainSessionId: caller.sessionId, now, depth: childDepth, parentCellId: parent.cellId }), parentTeamId }
      writeCell(caller.workspace, subcell)
      /** The parent record after registering the link. */
      const next: CellState = { ...parent, subcellIds: [...parent.subcellIds, subcellId] }
      transition(caller.workspace, next, { event: "subcell", subcellId, depth: childDepth, parentCellId: parent.cellId, parentTeamId, objective }, now)
      appendJournal(caller.workspace, subcellId, { event: "subcell-created", parentCellId: parent.cellId, depth: childDepth, captainSessionId: caller.sessionId, parentTeamId }, now)
      return { ok: true, cellId: subcellId, parentCellId: parent.cellId, parentTeamId, depth: childDepth, directive: subteamDirective(subcellId, childDepth, parent.cellId, parentTeamId) }
    },
  }))

  // ── cellwork_send ────────────────────────────────────────────────────────
  disposers.push(dsh.registerTool({
    name: "cellwork_send",
    description: "Any cell seat: send one durable cell message to `captain`, a member of this cell by name, or `<cellId>/<captain|member>` for a cell in this cell's tree (a sub-cell it registered, or its parent). Optional STRUCTURED mail: `kind` (`message`|`question`|`answer`); a question carries `options` (+`multiSelect`) and its `questionId` defaults to its own message id; an answer carries `replyTo` (the question's message id), `selected` (the offered labels copied VERBATIM) and/or `custom` — an unknown label is refused WITH the valid label list, and the answer's `questionId` defaults to the answered question's. `broadcast:true` mints ONE ROW PER SEAT of the target cell (the sender excluded). MAILBOX FULL: a recipient with `mail.maxUndelivered` undelivered messages is refused (the key is read per call from the workspace config; its DEFAULT is 8, and `agent_teams_mail` shares the SAME bound, so the official tool is not a fallback). Two recoveries: acknowledge that inbox (`cellwork_inbox` for a cell seat, or `agent_teams_mail {action:\"read\"}` for a team member), or reassign the rows behind it (`cellwork_dispatch {reassign:[{task_id, owner}]}`). The row(s) are written to the workspace mailbox FIRST (atomic fan-out through the shared store), then a wake-up is attempted per row when the sender is this cell's captain and the recipient holds a handle; the attempt's outcome is appended as a `wake` record, so a failed wake-up leaves the row in place and is surfaced on `cellwork_supervise`. The journal carries the `cell:<cellId>` stamp.",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "`captain`, a cell member's board name, or `<cellId>/<captain|member>` for a cross-cell recipient in this cell's tree. With `broadcast:true`, its cell part selects the target cell (`*` means this cell)." },
        subject: { type: "string", description: "One-line subject (also a question's header)." },
        body: { type: "string", description: "The message text, delivered verbatim (also a question's text)." },
        kind: { type: "string", description: "`message`, `question` or `answer`; omitted means it is INFERRED from `options` (question) or `selected`/`custom` (answer), else `message`." },
        options: { type: "array", description: "A question's offered options, labels unique within the question.", items: { type: "object", properties: { label: { type: "string" }, description: { type: "string" } }, required: ["label"], additionalProperties: false } },
        multiSelect: { type: "boolean", description: "A question may take several labels instead of exactly one." },
        replyTo: { type: "string", description: "The message id this row replies to; an answer's question message id (its `answerTo`)." },
        broadcast: { type: "boolean", description: "Fan out one row per seat of the target cell, sender excluded." },
        selected: { type: "array", description: "An answer's offered labels, copied VERBATIM from the question.", items: { type: "string" } },
        custom: { type: "string", description: "An answer's free text; alone it replaces the one label of a single-select answer." },
        questionId: { type: "string", description: "A question's stable key (defaults to its message id) or the answered question's key (defaults to the referenced question's)." },
      },
      required: ["to", "subject", "body"],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          id: { type: "string" },
          ids: { type: "array", items: { type: "string" }, description: "One id per row; a broadcast has several." },
          to: { type: "string" },
          broadcast: { type: "boolean" },
          rows: { type: "array", items: { type: "object" }, description: "One `{id, to, wakeSent, wakeReason?}` per fan-out row." },
          crossCell: { type: "string", description: "The cell id the row was written into, when the send crossed cells." },
          fromCell: { type: "string", description: "The sender's own cell id, mirrored onto a cross-cell row." },
          wakeSent: { type: "boolean" },
          wakeReason: { type: "string" },
        },
        required: ["ok"],
      },
      render: (_args: unknown, value: unknown): unknown => {
        /** The result as a record. */
        const result = typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
        if (result.ok === false) return render("cellwork_send refused: " + String(result.error ?? "unknown refusal"))
        if (result.broadcast === true) {
          /** The per-row outcomes the answer carries. */
          const rows = Array.isArray(result.rows) ? result.rows as Array<Record<string, unknown>> : []
          return render("mail fan-out: " + String(rows.length) + " row(s) -> " + rows.map((row) => String(row.to ?? "")).join(", ") + " (" + String(result.ids instanceof Array ? result.ids.join(", ") : "") + ")")
        }
        // THE ANSWER NAMES WHICH HALF FAILED (repair N1): "no wake-up" plus a reason that says the
        // transport refused it reads differently from a reason that says the RECORD of it was lost.
        return render("mail " + String(result.id ?? "") + " -> " + String(result.to ?? "") + (result.wakeSent === true ? " (wake-up sent)" : " (durable; " + String(result.wakeReason ?? "no wake-up was attempted") + ")"))
      },
    },
    execute: async (args: unknown, exec: DshToolExec): Promise<ProtocolResult> => {
      /** The argument record. */
      const argv = readArgs(args)
      /** The caller's context. */
      const caller = callerFor(exec)
      if (caller.refusal !== null) return { ok: false, error: refusalText(caller.refusal), path: caller.refusal.path }
      // NARROWED ONCE, for the closures below: a closure cannot rely on the property narrowing above.
      /** The caller's own cell. */
      const cell = caller.cell
      if (cell === null || caller.member === "") return { ok: false, error: "cellwork_send: this session belongs to no active cell" }
      /** The requested recipient (or the target cell, with `broadcast`). */
      const requested = argString(argv, "to").trim()
      if (requested === "") return { ok: false, error: "cellwork_send: `to` is required (`captain`, a member name, or `<cellId>/<captain|member>` for a cell in this cell's tree)" }
      /** The subject (also a question's header). */
      const subject = argString(argv, "subject").trim()
      /** The body (also a question's text). */
      const body = argString(argv, "body")
      if (subject === "" || body.trim() === "") return { ok: false, error: "cellwork_send: `subject` and `body` are both required" }
      // W4-A6b: the SAME store-time bound the team mailbox applies, spelled locally (wave T43) so this
      // row's one frozen import stays `sendMany` — the wake text is cut identically rather than shipping a
      // 200 KB body to a model.
      /** The body as stored and delivered: bounded at 4000 chars, with its pre-cut length when cut. */
      const storedBody = truncateCellMailBody(body)
      /** Whether this call fans out one row per seat of the target cell. */
      const broadcast = argv.broadcast === true
      /** The explicit kind, `""` when the payload must be inferred. */
      const kindArg = argString(argv, "kind").trim()
      /** The message this row replies to; an answer's `replyTo` is its question message id. */
      const replyTo = argString(argv, "replyTo").trim()
      /** The explicit correlation key, `""` when it must be defaulted. */
      const questionIdArg = argString(argv, "questionId").trim()
      /** Whether a question may take several labels instead of exactly one. */
      const multiSelect = argv.multiSelect === true
      /** The raw `options` argument, when the caller passed one. */
      const rawOptions: unknown = argv.options
      /** The raw `selected` argument, when the caller passed one. */
      const rawSelected: unknown = argv.selected
      /** The answer's free-form text. */
      const custom = argString(argv, "custom")
      /**
       * The CROSS-CELL spelling `<cellId>/<name>`.
       *
       * A sub-cell and its parent address each other by the same rule (§4.9's "cross-cell"), and the
       * recipient may only be a cell IN THIS CELL'S TREE — a sub-cell it registered, or its own parent.
       * Cell ids and member names alike contain no `/`, so the last slash is the separator. With
       * `broadcast`, the part before the slash only selects the target cell (`*` = this cell).
       */
      const slash = requested.lastIndexOf("/")
      /** The cell the rows belong to: the caller's own, or the tree member named before the slash. */
      const targetCellId = slash < 0 ? cell.cellId : requested.slice(0, slash).trim()
      /** The name the recipient answers to (ignored by a broadcast). */
      const requestedName = slash < 0 ? requested : requested.slice(slash + 1).trim()
      if (!broadcast && requestedName === "") return { ok: false, error: "cellwork_send: " + JSON.stringify(requested) + " names no recipient — use `<cellId>/<captain|member>`" }
      /** Whether this send crosses into another cell of the tree. */
      const crossCell = targetCellId !== cell.cellId
      /** The target cell's record, when this send crosses cells. */
      let target: CellState = cell
      if (crossCell) {
        if (targetCellId !== cell.parentCellId && !cell.subcellIds.includes(targetCellId)) {
          return { ok: false, error: "cellwork_send: " + JSON.stringify(targetCellId) + " is not in this cell's tree — a cross-cell recipient must be a SUB-CELL of " + cell.cellId + " (" + (cell.subcellIds.join(", ") || "none") + ") or its parent cell (" + (cell.parentCellId ?? "none") + ")" }
        }
        /** The target cell's record, or the refusal this send answers with. */
        const read = readCell(caller.workspace, targetCellId)
        if (!read.ok) return { ok: false, error: "cellwork_send: the cross-cell recipient's record at " + read.path + " cannot be read (" + read.reason + ": " + read.detail + ") — nothing was sent", path: read.path }
        target = read.state
      }
      /** The instant every row and wake record is stamped with. */
      const now = new Date()
      /** Whether the payload carries a question's options. */
      const hasOptions = rawOptions !== undefined
      /** Whether the payload carries an answer's labels or free text. */
      const hasAnswerPayload = rawSelected !== undefined || custom.trim() !== ""
      /** The envelope kind: explicit, else INFERRED from the payload, else `message` (contract §6). */
      let kind: MailKind
      if (kindArg === "") kind = hasOptions ? "question" : hasAnswerPayload ? "answer" : "message"
      else if (kindArg === "message" || kindArg === "question" || kindArg === "answer") kind = kindArg
      else return { ok: false, error: "cellwork_send: `kind` must be `message`, `question` or `answer`" }
      if (kind !== "question" && (hasOptions || multiSelect)) {
        return { ok: false, error: "cellwork_send: `options`/`multiSelect` belong to a `question` row; this payload is a `" + kind + "`" }
      }
      if (kind !== "answer" && (hasAnswerPayload || (kind === "message" && questionIdArg !== ""))) {
        return { ok: false, error: "cellwork_send: `selected`/`custom`/`questionId` belong to an `answer` row; this payload is a `" + kind + "`" }
      }
      /** The question payload, built only for a `question` row. */
      let question: MailQuestion | undefined
      /** The answer payload, built only for an `answer` row. */
      let answer: MailAnswer | undefined
      /** The correlation key every fan-out row shares (I6); a question defaults it to its own first id. */
      let questionId = questionIdArg
      if (kind === "question") {
        /** The parsed options, or the refusal they answer with. */
        const parsedOptions = parseMailOptions(rawOptions)
        if (!Array.isArray(parsedOptions)) return parsedOptions
        questionId = questionIdArg !== "" ? questionIdArg : nextCellMailId(caller.workspace, now)
        question = { questionId, header: subject, question: body, options: parsedOptions, ...(multiSelect ? { multiSelect: true } : {}) }
      }
      if (kind === "answer") {
        if (replyTo === "") return { ok: false, error: "cellwork_send: `kind:\"answer\"` requires `replyTo` = the message id of the QUESTION row being answered" }
        /**
         * The question being answered, resolved ACROSS the workspace mailbox by row id (T9/F1 layer 1).
         *
         * A cross-cell row is stamped with the RECIPIENT cell's `cellId`, so a cross-cell question lives
         * in the recipient's view while the answer is composed from a different cell — resolving it from
         * the target cell's view alone missed it and produced the misleading missing-questionId refusal.
         * The target cell's folded view stays as the SECOND source, for a pre-unification legacy row.
         */
        const asked = findWorkspaceMailById(caller.workspace, replyTo)
          ?? foldCellMail(readCellMail(caller.workspace, targetCellId)).find((message) => message.id === replyTo)
        // THE REAL PROBLEM, NAMED (T9/F1): an absent row and a non-question row are different defects,
        // and neither is "the answer must carry a questionId" — that sentence sent the caller looking for
        // a key it never had to invent.
        if (asked === undefined) {
          return { ok: false, error: "cellwork_send: `replyTo` " + JSON.stringify(replyTo) + " names no message in this workspace's mailbox — pass the QUESTION row's message id (every `cellwork_inbox` row shows its id)" }
        }
        if (asked.kind === "answer") {
          return { ok: false, error: "cellwork_send: `replyTo` " + JSON.stringify(replyTo) + " names an ANSWER row, not a question — an answer answers a question, not another answer" }
        }
        if (asked.question === undefined) {
          return { ok: false, error: "cellwork_send: `replyTo` " + JSON.stringify(replyTo) + " names a " + JSON.stringify(String(asked.kind ?? "message")) + " row with no question payload (no questionId, no options) — only a question can be answered" }
        }
        questionId = questionIdArg !== "" ? questionIdArg : asked.question.questionId
        /** The parsed selected labels, or the refusal they answer with. */
        const parsedSelected = parseMailSelected(rawSelected)
        if (!Array.isArray(parsedSelected)) return parsedSelected
        answer = { questionId, answerTo: replyTo, selected: parsedSelected, ...(custom.trim() === "" ? {} : { custom }) }
      }
      /** The recipients, one durable row each. */
      let outbound: MailAddress[]
      if (broadcast) {
        /** Every seat of the target cell, captain first. */
        const seats: MailAddress[] = [
          seatAddress(target, "captain"),
          ...Object.values(target.members).map((member) => seatAddress(target, member.name)),
        ]
        /** The seats this sender may reach: never itself (a same-cell broadcast), never a duplicate id. */
        const candidates = seats.filter((seat) => crossCell || nameKey(seat.name) !== nameKey(caller.member))
        outbound = fanOutTargets(seatKey(cell, caller.member), candidates)
        if (outbound.length === 0) return { ok: false, error: "cellwork_send: a broadcast has no other seat to address in cell " + targetCellId }
      } else {
        /** Whether the recipient is the target cell's captain. */
        const toCaptain = nameKey(requestedName) === "captain"
        // ONE RESOLUTION RULE, THE SAME ONE `unfence` USES (repair round 2, finding B): exact table key,
        // exact display name, then the normalized key only when it is non-empty and unique. An ambiguous
        // or absent spelling refuses the recipient instead of delivering to the first collision.
        /** The member this spelling unambiguously names, or undefined. */
        const recipient = toCaptain ? undefined : resolveMemberName(target.members, requestedName)
        if (!toCaptain && recipient === undefined) {
          return { ok: false, error: "cellwork_send: " + JSON.stringify(requestedName) + " is neither `captain` nor an unambiguous member of cell " + targetCellId + " (members: " + Object.keys(target.members).join(", ") + ")" }
        }
        /** The canonical recipient name. */
        const to = toCaptain ? "captain" : String(recipient?.member.name ?? requestedName)
        // SELF IS AN EXACT NAME, NOT A NORMALIZED ONE: `nameKey` maps 后端1 and 前端1 to the same `1`, so
        // the old comparison refused a CJK member's message to a DIFFERENT colleague as self. The resolved
        // row is canonical, so its table key and display name are this seat's two exact spellings.
        /** Whether this send addresses the caller's own seat. */
        const self = toCaptain ? caller.member === "captain" : recipient !== undefined && (recipient.key === caller.member || recipient.member.name === caller.member)
        if (!crossCell && self) return { ok: false, error: "cellwork_send: a seat cannot message itself" }
        outbound = [toCaptain ? seatAddress(target, "captain") : seatAddress(target, String(recipient?.member.name ?? to))]
      }
      /** The roster the store validates the recipients against. */
      const memberIds = Object.values(target.members).map((member) => seatKey(target, member.name))
      /** The team lead the store addresses as `captain`. */
      const leadIds = [seatKey(target, "captain")]
      // ONE BOUND, ONE RULE (C3): the value is resolved by the shared store's own exported resolver, read
      // per call so an `mpd.jsonc` edit applies to the NEXT send. `0` disables the bound, exactly as the
      // store documents, because this call site does not re-interpret the number it was handed.
      /** The shared backlog bound this send enforces. */
      const undeliveredBound = mailMaxUndeliveredOf(workspaceConfigReader(deps.ctx))
      /** The one send the store validates and fans out atomically; message ids are minted inside it. */
      const input: SendInput = {
        // THE SENDER'S STABLE SEAT KEY, not its session id (T9/F2): the store's ownership rules compare
        // ids, and the row's recipient identity is the same stable key — so a reseeded seat can still
        // answer the question it was asked under its previous session.
        fromId: seatKey(cell, caller.member),
        fromName: caller.member,
        toId: outbound[0].id,
        toName: outbound[0].name,
        subject,
        body: storedBody.body,
        memberIds,
        leadIds,
        teamId: target.teamId,
        cellId: targetCellId,
        fromMemberId: caller.member,
        // THE BOUND IS THE SAME ONE `agent_teams_mail` ENFORCES (C3): both tools feed this one store.
        maxUndelivered: undeliveredBound,
        ...(crossCell ? { fromCell: cell.cellId } : {}),
        ...(kind === "message" ? {} : { kind }),
        ...(replyTo === "" ? {} : { replyTo }),
        ...(question === undefined ? {} : { question }),
        ...(answer === undefined ? {} : { answer }),
      }
      /** The store's atomic fan-out outcome, or the refusal that wrote nothing. */
      let sent: SendManyResult
      try {
        sent = sendMany(caller.workspace, input, outbound, now)
      } catch (error) {
        return { ok: false, error: "cellwork_send: the message row(s) could not be written — no message was sent and no wake-up was attempted (mail is durable first): " + errorText(error) }
      }
      if (!sent.ok) return { ok: false, error: "cellwork_send refused: " + sent.detail }
      /** One delivered row's outcome, in fan-out order. */
      const delivered: Array<{ id: string; to: string; wakeSent: boolean; wakeReason?: string }> = []
      for (let index = 0; index < sent.messages.length; index += 1) {
        /** The durable row this iteration reports on. */
        const message = sent.messages[index]
        /** The address it was minted for, so the wake can resolve the member row. */
        const address = outbound[index]
        /** The member row behind that address, when it is not the captain. */
        const recipientMember = Object.values(target.members).find((member) => seatKey(target, member.name) === address.id)
        /**
         * The wake-up attempt: the durable row ALREADY landed through the store, so this only wakes a
         * live handle. Every refusal keeps the four durable-only sentences the cell plane documents.
         */
        const attemptWake = async (): Promise<{ sent: boolean; reason?: string }> => {
          if (crossCell) return { sent: false, reason: "cross-cell mail is DURABLE ONLY — this cell holds no Lead authority over " + targetCellId + ", so its captain wakes the row (it shows on that cell's `cellwork_supervise`)" }
          if (nameKey(address.name) === "captain") return { sent: false, reason: "the Lead has no executor handle in this composition; the captain reads it on `cellwork_inbox`" }
          if (caller.sessionId !== cell.captainSessionId) return { sent: false, reason: "only the captain holds the Lead authority the executor needs; a member-to-member message is durable and read on `cellwork_inbox`" }
          if (String(recipientMember?.executorRef ?? "") === "") return { sent: false, reason: "the recipient has no executor handle (never raised)" }
          /** The delivery binding, when the executor exists. */
          const wake = sendThroughExecutor(dsh.teamExecutor(), exec.agent)
          if (wake === undefined) return { sent: false, reason: "this composition exposes no team executor" }
          await wake(String(recipientMember?.executorRef ?? ""), "[mpd-cellwork] mail from " + caller.member + ": " + subject + "\n\n" + storedBody.body + "\n\n(full row: cell " + cell.cellId + ")")
          return { sent: true }
        }
        /** The durable-first delivery of THIS row; `appendSend` is true because the store already wrote it. */
        const delivery = await deliverCellMail({
          appendSend: () => true,
          attemptWake,
          appendWake: (outcome) => appendCellMail(caller.workspace, targetCellId, { t: "wake", id: message.id, sent: outcome.sent, ...(outcome.reason === undefined ? {} : { reason: outcome.reason }), at: now.toISOString() }),
        })
        delivered.push({ id: message.id, to: message.toName, wakeSent: delivery.wakeSent, ...(delivery.wakeReason === undefined ? {} : { wakeReason: delivery.wakeReason }) })
        appendJournal(caller.workspace, cell.cellId, { event: "mail", cell: "cell:" + cell.cellId, id: message.id, from: caller.member, to: message.toName, ...(crossCell ? { toCell: targetCellId } : {}), subject, wakeSent: delivery.wakeSent }, now)
      }
      if (!broadcast) {
        /** The one row this send minted. */
        const only = delivered[0]
        return { ok: true, id: only.id, to: only.to, wakeSent: only.wakeSent, ...(crossCell ? { crossCell: targetCellId, fromCell: cell.cellId } : {}), ...(only.wakeReason === undefined ? {} : { wakeReason: only.wakeReason }), ...(storedBody.truncated ? { truncated: true, originalLength: storedBody.originalLength } : {}) }
      }
      /** The fan-out answer: one id per row, the same shape a single send keeps for its first row. */
      return {
        ok: true,
        broadcast: true,
        to: "*",
        id: delivered[0].id,
        ids: delivered.map((row) => row.id),
        rows: delivered,
        ...(crossCell ? { crossCell: targetCellId, fromCell: cell.cellId } : {}),
      }
    },
  }))

  // ── cellwork_inbox ───────────────────────────────────────────────────────
  disposers.push(dsh.registerTool({
    name: "cellwork_inbox",
    description: "Any cell seat: read and ACKNOWLEDGE the unread cell mail addressed to this seat (its member name, or `captain`), PAGED (`limit` default 20, `offset` default 0) with `more`/`nextOffset`; only the rows ON THE PAGE are acknowledged, so rows past the cap stay unread until fetched. A `question` row renders its offered labels explicitly and an `answer` row renders its selected labels, so nothing has to be counted; reply with `cellwork_send {kind:\"answer\", replyTo:<question id>, selected:[...]}`. The rows are durable; reading them acknowledges each row ONCE (the shared store's `read` record, or the legacy log's for a pre-unification row).",
    parameters: { type: "object", properties: {
      limit: { type: "integer", description: "Rows to render (default 20, clamped 1..100)." },
      offset: { type: "integer", description: "First row of the page (default 0)." },
    }, additionalProperties: false },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          seat: { type: "string" },
          messages: { type: "array", items: { type: "object" } },
          acknowledged: { type: "number" },
          refused: { type: "array", items: { type: "object" } },
          offset: { type: "integer" },
          more: { type: "integer" },
          unreadTotal: { type: "integer" },
          nextOffset: { oneOf: [{ type: "integer" }, { type: "null" }] },
        },
        required: ["ok"],
      },
      render: (_args: unknown, value: unknown): unknown => {
        /** The result as a record. */
        const result = typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
        if (result.ok === false) return render("cellwork_inbox refused: " + String(result.error ?? "unknown refusal"))
        /** The delivered rows. */
        const messages = Array.isArray(result.messages) ? result.messages as Array<Record<string, unknown>> : []
        /** The acknowledgements the store refused, which used to be invisible (T9/N1). */
        const refused = Array.isArray(result.refused) ? result.refused as Array<Record<string, unknown>> : []
        /**
         * The sentence that keeps `acknowledged: 0` from being silent: WHICH row stayed unread and WHY.
         *
         * A seat whose acknowledgement the ownership rule refused saw the same rows come back forever with
         * no diagnosis; the reason is the diagnosis (the row is addressed to a different identity).
         */
        const refusalNote = refused.length === 0 ? "" : "\n\nacknowledgement refused for " + String(refused.length) + " row(s), which stay unread: " + refused.map((entry) => String(entry.id ?? "?") + " (" + String(entry.reason ?? "no reason given") + ")").join("; ")
        if (messages.length === 0) return render("no unread cell mail for " + String(result.seat ?? "?") + " — if a question is blocked here, ask the captain to check `cellwork_supervise`" + refusalNote)
        return render(messages.map((message: Record<string, unknown>) => mailBlock(message)).join("\n\n---\n\n") + (typeof result.more === "number" && result.more > 0 ? "\n\n(showing " + String(messages.length) + " of " + String(result.unreadTotal ?? "?") + "; more: " + String(result.more) + " — next page offset=" + String(result.nextOffset) + ", which also leaves them UNREAD until fetched)" : "") + refusalNote)
      },
    },
    execute: async (args: unknown, exec: DshToolExec): Promise<ProtocolResult> => {
      /** The caller's context. */
      const caller = callerFor(exec)
      if (caller.refusal !== null) return { ok: false, error: refusalText(caller.refusal), path: caller.refusal.path }
      if (caller.cell === null || caller.member === "") return { ok: false, error: "cellwork_inbox: this session belongs to no active cell" }
      /** The seat's own name (`captain` for the captain). */
      const seat = caller.member === "captain" ? "captain" : caller.member
      /** The folded mail of this cell's view. */
      const messages: CellMailMessage[] = foldCellMail(readCellMail(caller.workspace, caller.cell.cellId))
      /** Every row this seat has not acknowledged, BEFORE paging (the ack below covers only the page). */
      const unread = unreadFor(messages, [seat])
      // W4-A6b: cap what is RENDERED, never what is STORED. The page is drawn from the durable rows and
      // the rows behind it stay unread, so a 200-row inbox can never be acknowledged (or rendered) by one
      // call — the caller walks `nextOffset` to reach them.
      /** The page this call renders AND acknowledges; the store's helper clamps the bounds. */
      const paged = pageCellMail(unread, Number(argString(readArgs(args), "limit") || "20"), Number(argString(readArgs(args), "offset") || "0"))
      /** The rows this call renders AND acknowledges. */
      const page = paged.page
      /** The instant of the acknowledgement. */
      const now = new Date()
      /** The ack-once outcome: the store moves its rows, the legacy append moves the migrated ones. */
      // THE ACK IDENTITY IS THE STABLE SEAT KEY, never the session id (T9/F2): a reseeded seat must
      // acknowledge the rows addressed to its seat before the reseed, or the store silently refuses and
      // the inbox re-delivers them forever.
      const ack = acknowledgeCellMail(caller.workspace, caller.cell.cellId, page.map((message) => message.id), { byId: seatKey(caller.cell, seat), byName: seat }, now)
      if (ack.moved.length > 0) appendJournal(caller.workspace, caller.cell.cellId, { event: "mail-read", cell: "cell:" + caller.cell.cellId, seat, ids: ack.moved }, now)
      return {
        ok: true,
        seat,
        messages: page.map((message) => ({
          id: message.id,
          from: message.from,
          subject: message.subject,
          body: message.body,
          at: message.at,
          kind: message.kind,
          threadId: message.threadId,
          ...(message.replyTo === undefined ? {} : { replyTo: message.replyTo }),
          ...(message.question === undefined ? {} : { question: message.question }),
          ...(message.answer === undefined ? {} : { answer: message.answer }),
          ...(message.truncated === true ? { truncated: true, originalLength: message.originalLength } : {}),
        })),
        acknowledged: ack.moved.length,
        // A REFUSED ACK IS REPORTED, not counted as zero silently (T9/N1): each entry names the row and
        // the store's own sentence for why it stayed unread.
        refused: ack.refused,
        // The paging receipt: the rows behind this page are NOT acknowledged and stay unread.
        offset: paged.offset,
        more: paged.more,
        unreadTotal: unread.length,
        nextOffset: paged.nextOffset,
      }
    },
  }))

  // ── the checkpoint listener (agent/pre-step) ─────────────────────────────
  /** The pre-step listener: detect, inject ONE message, flip the seat. Contained on every path. */
  const onPreStep = (payload: { agent?: unknown; turn?: number; messages?: readonly unknown[] }, decision: { kind?: string; messages?: readonly unknown[] } | undefined): { kind: "enter"; messages: readonly unknown[] } | undefined => {
    try {
      /** The step's agent, when the dispatcher fused it in. */
      const agent = payload?.agent
      if (agent === undefined || agent === null) return undefined
      /** The caller's context. */
      const caller = callerContext(dsh, { agent } as DshToolExec, { teams })
      if (caller.cell === null || caller.member === "" || caller.member === "captain") return undefined
      /** The live reading for this agent. */
      const pressure = dsh.contextPressure(agent)
      /** The decision, computed before anything is written. */
      const plan = planCheckpoint(caller.cell, caller.member, pressure, config, typeof payload.turn === "number" ? payload.turn : null)
      if (!plan.inject) return undefined
      /** The instant of the injection. */
      const now = new Date()
      /** The record with the checkpoint LOGGED (the pure function writes no seat state). */
      const logged = applyCheckpoint(caller.cell, plan, String(caller.cell.members[caller.member]?.sessionId ?? caller.sessionId), now)
      // THE SEAT IS MIRRORED HERE, by the caller that owns the transition — never by the pure function
      // (wave W2-E). This is the cell's own injection-window marker: the PLANE's `mode:"checkpoint"` is
      // written by `mpdTeamActions.handoff` when the member delivers the document, and the guard prefers
      // the record's answer whenever the plane states one (`caller.ts::seatIn`).
      /** The member row this injection closes. */
      const injected = logged.members[caller.member]
      /** The record after the mirror. */
      // THE WINDOW'S CLOCK IS STAMPED HERE, at the ONE ownerless close (R4.3): this is the instant the
      // seat entered the checkpoint window, and it is what the captain's bounded force lever measures.
      // Re-stamping an ALREADY checkpointed row would reset a stuck seat's bound on every step, so an
      // existing instant is preserved.
      const next: CellState = injected === undefined ? logged : {
        ...logged,
        members: {
          ...logged.members,
          [caller.member]: {
            ...injected,
            mode: "checkpoint",
            ...(injected.checkpointSince === undefined ? { checkpointSince: now.toISOString() } : {}),
          },
        },
      }
      transition(caller.workspace, next, { event: "checkpoint", member: caller.member, usedTokens: plan.usedTokens, windowTokens: plan.windowTokens, turn: plan.turn, reason: plan.reason }, now)
      /** The ONE message this step receives. */
      const message = dsh.userMessage({ text: checkpointDirective(caller.member, plan), source: { kind: "mpd-cellwork", reason: "checkpoint" } })
      return { kind: "enter", messages: [...(decision?.messages ?? payload?.messages ?? []), message] }
    } catch (error) {
      deps.warn("[mpd-cellwork] the checkpoint listener failed: " + (error instanceof Error ? error.message : String(error)))
      return undefined
    }
  }
  /** The host-plane pre-step registration (a composition with no event bus is a stated absence). */
  const preStepDispose = dsh.onAgentPreStep(onPreStep)
  if (typeof preStepDispose === "function") disposers.push(preStepDispose)

  // ── the compaction barrier (agent/turn-stopping) ─────────────────────────
  /**
   * The durable parent session a stopping agent's header carries, when it carries one.
   *
   * Read structurally because an Agent is opaque to a plugin: the harness records the parent link at
   * `session.header.parentSession`. Anything else answers "", which is what sends the reseed to the
   * captain fallback instead of inventing a parent.
   *
   * @param agent - the stopping agent handle.
   * @returns the parent session id, or "".
   */
  const parentSessionOf = (agent: unknown): string => {
    /** The handle, read as a record so every access below is checked. */
    const handle = typeof agent === "object" && agent !== null ? agent as { session?: unknown } : undefined
    /** Its session, when it carries one. */
    const session = typeof handle?.session === "object" && handle.session !== null ? handle.session as { header?: unknown } : undefined
    /** That session's header, when it carries one. */
    const header = typeof session?.header === "object" && session.header !== null ? session.header as { parentSession?: unknown } : undefined
    return typeof header?.parentSession === "string" ? header.parentSession : ""
  }
  /**
   * Run the post-handoff barrier for one agent, when that member is handoff-ready.
   *
   * @param agent - the stopping agent handle.
   */
  const runBarrier = async (agent: unknown): Promise<void> => {
    /** The caller's context. */
    const caller = callerContext(dsh, { agent } as DshToolExec, { teams })
    if (caller.cell === null || caller.member === "") return
    /** The member row as the event found it. */
    const member = caller.cell.members[caller.member]
    if (member === undefined || !member.handoffReady) return
    /** The in-flight key, so one turn cannot start two barriers. */
    const key = caller.cell.cellId + "/" + caller.member
    if (inFlight.has(key)) return
    inFlight.add(key)
    try {
      /** The latest handoff document's text. */
      let handoffText = ""
      try {
        handoffText = readFileSync(handoffPath(caller.workspace, caller.cell.cellId, caller.member, member.handoffs), "utf8")
      } catch {
        handoffText = "(the handoff document could not be read back; the journal names its path)"
      }
      /** The member's durable parent session, which the reseed may only use while it is LIVE (C2). */
      const parentSessionId = parentSessionOf(agent)
      // THE ORIGINAL SESSION IS RETIRED ON THE RESEED PATH, BY ITS LIVE ANCESTOR (R4.7, corrected by R5.1):
      // `promoteAfterHandoff` targets the MEMBER's own session (never the new child) and authorises with the
      // live session the fresh child is raised under. The outcome is a RECORD, not a hope: `retired:true`
      // requires the host to have accepted it, and a dead target is `nothing-to-retire`. Neither answer
      // blocks the reseed, so the journal row says which one happened rather than leaving it to inference.
      /** The barrier's outcome. */
      const result = await promoteAfterHandoff({
        dsh,
        agent,
        memberName: caller.member,
        sessionId: member.sessionId,
        parentSessionId,
        cell: caller.cell,
        config,
        handoffText,
        nextStep: nextStepOf(handoffText),
        injectDirective: (text): void => {
          try {
            dsh.injectAgentMessage(agent, dsh.userMessage({ text, source: { kind: "mpd-cellwork", reason: "promotion" } }))
          } catch (error) {
            deps.warn("[mpd-cellwork] the promotion directive could not be injected: " + (error instanceof Error ? error.message : String(error)))
          }
        },
        sleep: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
      })
      /** The instant the outcome is stamped with. */
      const now = new Date()
      // RE-READ before writing: a concurrent claim/complete may have moved the record during the await.
      const fresh = readCell(caller.workspace, caller.cell.cellId)
      if (!fresh.ok) {
        deps.warn("[mpd-cellwork] the compaction barrier could not re-read " + fresh.path + ": " + fresh.detail)
        return
      }
      // THE BARRIER OWES THE SEAT ITS REOPEN (R4.1, the one-way door). A run that REOPENED the CELL seat
      // leaves a member that is supposed to WORK again — and `cellwork_handoff` wrote TEAM
      // `mode:"checkpoint"` when the handoff landed, which the guard fences and dispatch refuses to pair.
      // The barrier therefore reopens that plane seat AS THE CAPTAIN, through the SAME implementation the
      // captain's `unfence` uses, and reports which half really happened. Without this call every
      // successful promotion left a dead seat while the team record still said `running`.
      // A RUN THAT FENCED THE CELL SEAT OWES THE PLANE NOTHING (R7.2). Since R4.3 `memberAfterBarrier` also
      // gives up on a `reseeded` run that reaches the retry bound, writing `mode:"checkpoint"` +
      // `handoffReady:true` + `fenced:true`; reopening the TEAM seat on that same run would leave the two
      // records DISAGREEING (CELL fenced, TEAM member) — the divergence this repair exists to end. The gate
      // is therefore the ROW the barrier is about to persist, never the raw outcome.
      /** The row this barrier leaves behind, computed BEFORE the plane call so the reopen is gated on it. */
      const barrierRow: CellMemberRecord = memberAfterBarrier(fresh.state.members[caller.member] ?? member, result, config.compactionRetries)
      /** Whether the barrier actually REOPENED the CELL seat: a give-up fence leaves nothing to reopen. */
      const cellReopened = barrierRow.fenced !== true
      /** How the plane's half ended; a fenced run reports the skip instead of claiming a reopen. */
      const plane = cellReopened
        ? await reopenPlaneSeat(caller.cell.captainSessionId, caller.member)
        : { plane: "skipped-fenced" as const, planeReason: "this barrier FENCED the CELL seat on the same run (the retry bound gave up), so the TEAM seat stays closed with it" }
      // THE WRITE IS MERGED INTO A READ TAKEN AFTER THE AWAITED PLANE CALL (R5.3). The snapshot above
      // predates `reopenPlaneSeat`, and writing it back reverted every change a concurrent writer made
      // inside that await — another member's `fenced:true`, an adoption, a promotion. This is the SAME
      // discipline `unfenceSeats` already follows (repair round 1, finding 3): re-read, then replace ONLY
      // this member's row, and fall back to the pre-await snapshot only when the fresh read fails.
      /** The record as it stands once the plane call settled. */
      const settled = readCell(caller.workspace, caller.cell.cellId)
      if (!settled.ok) deps.warn("[mpd-cellwork] the compaction barrier could not re-read " + settled.path + " after the plane call: " + settled.detail + " — merging into the pre-await snapshot")
      /** The merge base: the POST-plane read, or the pre-plane one when that read failed. */
      const base = settled.ok ? settled.state : fresh.state
      /** The member row after the barrier (this outcome decides the fence markers and may mint a handle). */
      const updated: CellMemberRecord = memberAfterBarrier(base.members[caller.member] ?? member, result, config.compactionRetries)
      /** The record after the barrier: ONLY this member's row is replaced on the fresh base. */
      const next: CellState = { ...base, members: { ...base.members, [caller.member]: updated } }
      // THE REOPENED SEAT IS A FACT WITH ITS OWN ROW: this is the row that says the barrier performed the
      // duty above, and the plane's half is reported exactly as it ended (`unfenced`/`absent`/`refused`).
      // A REFUSED HALF NAMES ITS RETRY (R5.4): the TEAM seat stays closed and the row carries the exact
      // verb that re-drives the seam, so the operator is not left with a dead end.
      if (cellReopened) {
        appendJournal(caller.workspace, caller.cell.cellId, {
          event: "member-unfenced",
          member: caller.member,
          by: "barrier",
          plane: plane.plane,
          ...(plane.planeReason === undefined ? {} : { planeReason: plane.planeReason }),
          ...(plane.plane === "refused" ? { retry: planeRetryOf(caller.member) } : {}),
        }, now)
      } else if (result.outcome !== "refused") {
        // THE SAME-RUN FENCE IS OBSERVABLE, NOT SILENT (R7.2): the barrier did NOT touch the plane, and
        // the row says so with the honest value rather than leaving the reader to infer it from absence.
        // A `refused` run writes `checkpoint-unrecoverable` below instead, as it always has.
        appendJournal(caller.workspace, caller.cell.cellId, {
          event: "plane-reopen-skipped",
          member: caller.member,
          by: "barrier",
          plane: plane.plane,
          ...(plane.planeReason === undefined ? {} : { planeReason: plane.planeReason }),
        }, now)
      }
      // THE GIVEN-UP BARRIER GETS ITS OWN JOURNAL ROW (C7): the compaction row below reports the attempt,
      // this one reports that the member is now OUT OF SERVICE and which verb repairs its rows.
      if (result.outcome === "refused") appendJournal(caller.workspace, caller.cell.cellId, checkpointUnrecoverableEntry(caller.member, result), now)
      // THE RESEED RETIRES A SESSION, SO BOTH SESSIONS ARE NAMED (R4.7): a fresh handle is not proof the
      // ORIGINAL child stopped, and the seat record now points at the new one — the row is what makes the
      // hand-over (and the plane's half) observable instead of inferred from two other rows.
      if (result.outcome === "reseeded") {
        appendJournal(caller.workspace, caller.cell.cellId, {
          event: "member-reseeded",
          member: caller.member,
          previousSessionId: member.sessionId,
          newSessionId: result.newHandle ?? "",
          retired: result.retired === true,
          // WHAT THE HOST DID WITH THE RETIREMENT (R5.1), never just the boolean: `accepted` is the only
          // value behind `retired:true`, `nothing-to-retire` names a session the registry does not hold,
          // and a refusal carries the host's own sentence.
          ...(result.retirement === undefined ? {} : { retirement: result.retirement }),
          ...(result.retirementReason === undefined ? {} : { retirementReason: result.retirementReason }),
          plane: plane.plane,
        }, now)
      }
      // THE SEEDED CHILD'S LINEAGE IS A FACT, NOT AN INFERENCE (C2): one row names the live session the
      // fresh child was raised under and which rule found it, so a captain fallback is never silent.
      if (result.outcome === "reseeded" && result.parentSource !== undefined) {
        appendJournal(caller.workspace, caller.cell.cellId, {
          event: "reseed-parent",
          member: caller.member,
          parentSource: result.parentSource,
          parentSessionId: result.parentSessionId ?? "",
          originalParentSessionId: parentSessionId,
          newHandle: result.newHandle ?? "",
        }, now)
      }
      transition(caller.workspace, next, compactionJournalEntry(caller.member, result), now)
    } finally {
      inFlight.delete(key)
    }
  }
  /**
   * The turn-stopping listener: it HANDS THE BARRIER TO THE HOST (C1) and never rejects the host chain.
   *
   * The host's serial dispatch AWAITS a returned promise (a returned value bails the chain, a returned
   * promise is awaited), so returning the barrier is what keeps the member's Agent alive until the engine
   * has been driven. The old `void runBarrier(...)` spelling detached it, and the member was detached from
   * `ctx.agents` by the time the engine lookup ran. Every throw is contained here: the returned promise
   * resolves, it never rejects into the harness.
   */
  const stopDispose = dsh.onEvent("agent/turn-stopping", (payload: unknown): unknown => {
    try {
      /** The stopping agent, when the event payload carries it. */
      const agent = typeof payload === "object" && payload !== null ? (payload as { agent?: unknown }).agent : undefined
      if (agent === undefined || agent === null) return undefined
      // The catch is attached HERE, so a barrier failure is a log line and never a rejection of the
      // promise the host is awaiting.
      return runBarrier(agent).catch((error: unknown) => {
        deps.warn("[mpd-cellwork] the compaction barrier failed: " + (error instanceof Error ? error.message : String(error)))
      })
    } catch (error) {
      deps.warn("[mpd-cellwork] the turn-stopping listener failed: " + (error instanceof Error ? error.message : String(error)))
      return undefined
    }
  })
  if (typeof stopDispose === "function") disposers.push(stopDispose)
  return disposers
}
