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

/**
 * Why one seat is CLOSED, in the sentence a captain reads — or undefined when it can work.
 *
 * Two spellings mean the same thing to a reader: the barrier's explicit fence (with its classification) and
 * a seat in the checkpoint window (a hand-off written and the barrier not yet compacted). The `undefined`
 * answer is the ONLY "this seat may be messaged" answer, so a caller never has to interpret an empty string.
 * @param member - the cell or roster row, or undefined when the member is unknown.
 * @returns the reason sentence, or undefined for a live seat.
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
 * A message from an unknown thrown value, without assuming it is an Error.
 *
 * @param error - the thrown value.
 * @returns its message text.
 */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
