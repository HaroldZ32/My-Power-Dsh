import { join } from "node:path"
import { isLiveTeam, readArchivedPlanIndex } from "./team-lifecycle"
import { addTeamTask, readTeam, recordNamesLead, writeTeam, type TeamTaskRecord } from "./team-store"
import { objectValue, readProjectJson } from "./project-store"
import { withProjectTaskWrite } from "./task-ownership"

/** Only this accepted requirements transition can request a replacement ticket. */
export interface ResplitRequest {
  /** The canonical Cellwork reservation identifier. */
  readonly cellId: string
  /** The board Cellwork resolved for this exact reservation. */
  readonly teamId: string
  /** Expected accepted requirements revision before this write. */
  readonly previousRevision: number
  /** Next accepted requirements revision. */
  readonly revision: number
}

/** The one ticket the Cellwork revision can release. */
export interface ResplitTicket {
  /** The actual row id after the Team compare-and-set. */
  readonly id: string
  /** The current state reported to the planner and captain. */
  readonly status: string
  /** True when a replacement row was selected instead of the original ticket. */
  readonly replacement: boolean
}

/** Read one named reservation, keeping user-supplied names out of path segments. */
function cellRecord(workspace: string, id: string): Record<string, unknown> | undefined {
  if (!/^cell-[a-z0-9-]+$/i.test(id)) return undefined
  /** The durable Cellwork authority for this board. */
  const value = readProjectJson(join(workspace, ".mpd", "cellwork", id, "state.json"))
  return objectValue(value) && value.cellId === id && value.phase !== "stopped" && value.archived !== true ? value : undefined
}

/** A replacement is inert until Cellwork commits its revision and exact ticket id. */
export function resplitTicketAccepted(workspace: string, teamId: string, task: TeamTaskRecord): boolean {
  if (task.resplit === undefined) return true
  try {
    /** The receipt may still be pending after an interrupted planner update. */
    const state = cellRecord(workspace, task.resplit.cellId)
    return state !== undefined && state.teamId === teamId && state.splitTaskId === task.id
      && typeof state.requirementsRevision === "number" && state.requirementsRevision >= task.resplit.revision
  } catch (error) {
    if (error instanceof Error) return false
    throw error
  }
}

/** The host session bound to a named Cellwork role is the only identity the board may use. */
function roleSession(cell: Record<string, unknown>, role: string): string | undefined {
  /** Roles are recorded by Cellwork, independently of display aliases supplied by callers. */
  const member = objectValue(cell.members) ? cell.members[role] : undefined
  return objectValue(member) && member.mode === "member" && typeof member.sessionId === "string" && member.sessionId !== ""
    && (member.executorRef === member.sessionId || member.executorRef === "") ? member.sessionId : undefined
}

/** Terminal history remains immutable and only pending, claimed or working tickets may be reused. */
function liveTicket(task: TeamTaskRecord): boolean {
  return task.status === "pending" || task.status === "claimed" || task.status === "in_progress"
}

/** Reserve and publish one ticket while the same project lock serializes board writes. */
export function commitResplit(workspace: string, planner: string, input: ResplitRequest,
  publish: (ticket: ResplitTicket) => void, now: Date): { ok: true; ticket: ResplitTicket } | { ok: false; error: string } {
  try {
    return withProjectTaskWrite(workspace, () => {
      /** Only the exact original planner on this live cell can advance its accepted revision. */
      const cell = cellRecord(workspace, input.cellId)
      if (cell === undefined || cell.teamId !== input.teamId || roleSession(cell, "cell-planner") !== planner
        || typeof cell.captainSessionId !== "string" || !Number.isSafeInteger(input.previousRevision)
        || input.previousRevision < 1 || input.revision !== input.previousRevision + 1
        || cell.requirementsRevision !== input.previousRevision) throw new Error("the original planner, board or requirements revision changed; re-read the cell and retry")
      /** The authoritative planning/execution board is named by the same Cellwork reservation. */
      const team = readTeam(workspace, input.teamId)
      if (team === undefined || !isLiveTeam(team, readArchivedPlanIndex(workspace)) || !recordNamesLead(team, [cell.captainSessionId])
        || !["cell " + input.cellId, "cell " + input.cellId + " execution"].includes(team.name)) throw new Error("the Cellwork board is no longer the live board of its original captain")
      /** Both actual board roles must still resolve to their original recorded host sessions. */
      const splitterSession = roleSession(cell, "cell-splitter")
      /** Resolve the owner by the original native handle, never by an arbitrary user argument. */
      const splitter = team.members.find((member) => member.name === "cell-splitter" && member.executorRef === splitterSession)
      if (splitterSession === undefined || splitter === undefined || splitter.status === "failed" || splitter.fenced === true
        || !team.members.some((member) => member.name === "cell-planner" && member.executorRef === planner)) throw new Error("the original planner or splitter seat cannot be authenticated on this board")
      /** These are the only existing rows the operation is authorized to reuse. */
      const tickets = team.tasks.filter((task) => [splitter.name, splitterSession, splitter.id].includes(task.owner ?? "")
        && (task.subject === "Measured task split from the agreed requirements" || task.resplit?.cellId === input.cellId
          || /^Re-split for requirements revision [1-9][0-9]*$/.test(task.subject)))
      /** The cell's original ticket anchors this update to the recorded planning history. */
      const recorded = tickets.find((task) => task.id === cell.splitTaskId)
      if (recorded === undefined) throw new Error("the recorded split ticket does not belong to the original splitter")
      /** Prefer a single live ticket, including one reserved by an interrupted write of this same revision. */
      const live = tickets.filter(liveTicket)
      if (live.length > 1 || live.some((task) => (task.resplit?.revision ?? 0) > input.revision)) throw new Error("the original splitter has ambiguous live tickets")
      /** The chosen row is unchanged unless the old ticket is terminal and no live ticket exists. */
      let ticket = live[0]
      if (ticket === undefined) {
        /** The row's description and owner are owned by the workflow, not supplied by the caller. */
        const next = addTeamTask(team, { subject: `Re-split for requirements revision ${input.revision}`,
          description: `Re-read the accepted cell requirements and submit one measured graph for revision ${input.revision} with cellwork_split. Keep existing keys and frozen contracts unless the new requirements change them.`,
          kind: "work", owner: splitter.name, blockedBy: [] }, now)
        /** The new row may not be dispatched until publication of this exact acceptance. */
        const appended = next.tasks[next.tasks.length - 1]
        if (appended === undefined) throw new Error("the board did not allocate a replacement split ticket")
        ticket = { ...appended, resplit: { cellId: input.cellId, revision: input.revision } }
        writeTeam(workspace, { ...next, tasks: [...next.tasks.slice(0, -1), ticket] })
      }
      /** State publication is synchronous under the board lock; a failed publication leaves an inert retry record. */
      const chosen = { id: ticket.id, status: ticket.status, replacement: ticket.id !== recorded.id }
      publish(chosen)
      return { ok: true as const, ticket: chosen }
    })
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
