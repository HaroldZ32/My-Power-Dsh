import { randomUUID } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { rowLogLine } from "../../mpd-dsh-adapter-plugin/src/index"
import { readHold, type StagedPlan } from "./plan-store"
import { declareMembers, readProjectRosterBindings, type MemberDeclaration } from "./project-roster-binding"
import { missingPath } from "./project-checkout"
import { appendTeamJournal } from "./team-journal"
import { isCleanTerminalRun, isLiveTeam, readArchivedPlanIndex } from "./team-lifecycle"
import { endTeamRecord, listTeams, readTeam, recordNamesLead, type TeamRecord } from "./team-store"
import { bindCheckout, locateProject, objectValue, ProjectAdmissionError, readProjectJson, saveProject, unbindCheckout, withProjectLock, type CopyRegistration, type ProjectLocation, type ProjectMember, type ProjectRecord } from "./project-store"

/** The pending-capable Cellwork record header shared by the two entry points. */
interface RootCell {
  /** The original activation's stable id. */
  readonly cellId: string
  /** The owning session, before and after the cell has created its planning board. */
  readonly captainSessionId: string
  /** Empty until planning approval has attached its board. */
  readonly teamId: string
}

/** Evidence that can block a second primary structured run. */
interface ProjectActivity {
  /** The checkout that still owns these state files. */
  readonly workspace: string
  /** Non-ended primary boards, ignoring nested execution groups. */
  readonly teams: readonly TeamRecord[]
  /** Non-stopped top-level cell entries. */
  readonly cells: readonly RootCell[]
}

export type { MemberDeclaration } from "./project-roster-binding"

/** The binding a consumer may use only with a session id authenticated by its adapter. */
export type ProjectSeat =
  | { readonly kind: "member"; readonly projectId: string; readonly projectRoot: string; readonly checkoutRoot: string; readonly memberId: string; readonly teamId: string; readonly memberName: string; readonly seat: "captain" | "member" }
  | { readonly kind: "unbound" }
  | { readonly kind: "denied" }

/** Mounted Team supplies its existing watchdog hold reading to project handovers. */
type HandoverAllowed = (workspace: string, team: TeamRecord) => boolean

/** The local project service other rows look up lazily. */
export interface ProjectIdentityService {
  /** Asks whether the adapter's caller controls an exact durable seat. */
  resolveSeat(input: { checkoutRoot: string; sessionId: string }): ProjectSeat
  /** The fixed roster as seen by the exact project captain, including an empty setup. */
  roster(input: { checkoutRoot: string; sessionId: string }): ProjectRosterView
  /** Registers an independent checkout after the copies service authorizes and allocates it. */
  bindCheckout(input: CopyRegistration): void
  /** Revokes the registered checkout after safe reclamation. */
  unbindCheckout(input: CopyRegistration): void
  /** Runs the synchronous Cellwork create-or-replay step under the cross-process admission lock. */
  admitCell<T>(input: { checkoutRoot: string; sessionId: string }, open: (workspace: string) => T, allowHandover?: HandoverAllowed): T
}

/** Listing is absent only on ENOENT. A broken ledger must block ambiguous admission. */
function entries(path: string): string[] {
  try {
    return readdirSync(path)
  } catch (error) {
    if (missingPath(error)) return []
    throw error
  }
}

/** Read only the fields that establish a live top-level Cellwork invocation. */
function rootCells(workspace: string): RootCell[] {
  /** Cell directories are distinct from the shared team's board directory. */
  const root = join(workspace, ".mpd", "cellwork")
  return entries(root).filter((entry) => entry.startsWith("cell-")).flatMap((cellId) => {
    /** A partial or unreadable record cannot quietly release its admission slot. */
    const value = readProjectJson(join(root, cellId, "state.json"))
    if (!objectValue(value) || typeof value.phase !== "string" || typeof value.captainSessionId !== "string") {
      throw new ProjectAdmissionError(`cannot establish Cellwork admission for ${cellId} at ${workspace}`)
    }
    if (value.phase === "stopped" || typeof value.parentCellId === "string") return []
    return [{ cellId, captainSessionId: value.captainSessionId, teamId: typeof value.teamId === "string" ? value.teamId : "" }]
  })
}

/** List tracked runs with strict legacy record discovery. */
function activity(workspace: string): ProjectActivity {
  /** Legacy archive state controls whether one of these boards still occupies admission. */
  const archive = readArchivedPlanIndex(workspace)
  /** Include staged boards already made durable by approval, even before the first spawn. */
  const teams = entries(join(workspace, ".mpd", "team", "teams")).filter((entry) => entry.endsWith(".json")).flatMap((file) => {
    /** A malformed board could be the one currently running. */
    const team = readTeam(workspace, file.slice(0, -5))
    if (team === undefined) throw new ProjectAdmissionError(`cannot establish Team admission for ${file} at ${workspace}`)
    return team.parentTeamId === undefined && isLiveTeam(team, archive) ? [team] : []
  })
  return { workspace, teams, cells: rootCells(workspace) }
}

/** A pending Cellwork invocation and its planning board are the same run. */
function runIds(snapshot: ProjectActivity): string[] {
  return [
    ...snapshot.cells.map((cell) => cell.cellId),
    ...snapshot.teams.filter((team) => !snapshot.cells.some((cell) => cell.captainSessionId === team.leadSessionId && (cell.teamId === team.teamId || cell.teamId === "" || !snapshot.teams.some((candidate) => candidate.teamId === cell.teamId)))).map((team) => team.teamId),
  ]
}

/** Discover legacy active roots without guessing among competing owners or changing existing ids. */
function activeRun(location: ProjectLocation): ProjectActivity {
  /** Preserve the first selected state root; before that, inspect all Git-registered siblings. */
  const roots = location.record === undefined ? location.roots : [location.record.projectRoot]
  /** Separate a live invocation from archives that remain readable at their original paths. */
  const active = roots.map(activity).filter((snapshot) => runIds(snapshot).length > 0)
  /** A conflict names every competing board/cell, including the boards attached to cells. */
  const ids = active.flatMap((snapshot) => [...snapshot.cells.map((cell) => cell.cellId), ...snapshot.teams.map((team) => team.teamId)])
  if (active.length > 1 || active.some((snapshot) => runIds(snapshot).length > 1 || snapshot.teams.length > 1)) {
    throw new ProjectAdmissionError(`conflicting active project runs: ${ids.join(", ")}`)
  }
  return active[0] ?? { workspace: location.record?.projectRoot ?? location.primaryRoot, teams: [], cells: [] }
}

/** Match the archived Cellwork stop that named this exact execution board. */
function stoppedCellOwnsBoard(workspace: string, team: TeamRecord): boolean {
  /** Cellwork mints planning and execution names from the same safe cell ID. */
  const cellId = /^cell (cell-[a-z0-9-]+)(?: execution)?$/i.exec(team.name)?.[1]
  if (cellId === undefined) return false
  /** Read only the named cell, never scan another archive to guess the predecessor. */
  const cellDir = join(workspace, ".mpd", "cellwork", cellId)
  /** A persisted stopped record authenticates its original captain and journal cursor. */
  const cell = readProjectJson(join(cellDir, "state.json"))
  if (!objectValue(cell) || cell.phase !== "stopped" || cell.archived !== true || typeof cell.parentCellId === "string"
    || typeof cell.captainSessionId !== "string" || !recordNamesLead(team, [cell.captainSessionId])
    || typeof cell.journalCursor !== "number" || !Number.isSafeInteger(cell.journalCursor) || cell.journalCursor < 1) return false
  try {
    /** The cursor pins the stop transition even if unrelated lines were appended afterward. */
    const line = readFileSync(join(cellDir, "journal.jsonl"), "utf8").split("\n").filter((entry) => entry.trim() !== "")[cell.journalCursor - 1]
    if (line === undefined) return false
    /** Match the actual stop target rather than a potentially stale planning pointer. */
    const stop: unknown = JSON.parse(line)
    return objectValue(stop) && stop.event === "stop" && stop.teamId === team.teamId && stop.forced === false
      && stop.reason === cell.stopReason && Array.isArray(stop.inProgress) && stop.inProgress.length === 0
  } catch (error) {
    if (missingPath(error) || error instanceof SyntaxError) return false
    throw error
  }
}

/** Retire one verified-clean stopped Cellwork board under the existing admission lock. */
function retireStoppedRun(run: ProjectActivity, allowHandover: HandoverAllowed | undefined): boolean {
  /** The sole prior board comes from the ordinary authoritative admission resolution. */
  const [team] = run.teams
  if (team === undefined || run.teams.length !== 1 || run.cells.length !== 0 || readHold(run.workspace) !== undefined) return false
  /** A normal end preserves the board, index and all qualifying captain wake receipts. */
  const now = new Date()
  /** The archive keeps the run's reason separate from the durable project roster. */
  const reason = "clean Cellwork completion released the project for its next objective"
  /** Recheck eligibility against the latest record at the normal Team end boundary. */
  const ended = endTeamRecord(run.workspace, team.teamId, reason, now, (fresh) => isCleanTerminalRun(fresh)
    && stoppedCellOwnsBoard(run.workspace, fresh) && allowHandover?.(run.workspace, fresh) !== false)
  if (ended?.changed === true) {
    try {
      appendTeamJournal(run.workspace, { event: "team-ended", teamId: team.teamId, at: now.toISOString(), reason })
    } catch (error) {
      rowLogLine("mpd-team-core", `team ${team.teamId} ended but its journal row was not written: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return ended !== undefined
}

/** Protect the caller's staged draft while a Cellwork startup selects its exact planning slot. */
export function guardCellPlanningStage(workspace: string, callerWorkspace: string, sessionId: string, name: string, plan: StagedPlan | undefined): void {
  if (plan === undefined || plan.name === name) return
  /** Only the canonical Cellwork plan spelling can use automatic shell supersession. */
  const cellId = /^cell (cell-[a-z0-9-]+)$/i.exec(name)?.[1]
  if (cellId === undefined) return
  /** Match the exact live reservation and its original caller before touching a staged plan. */
  const cell = readProjectJson(join(workspace, ".mpd", "cellwork", cellId, "state.json"))
  if (!objectValue(cell) || cell.phase === "stopped" || cell.captainSessionId !== sessionId) return
  /** The gate writes its receipt in the caller's working directory, not the shared project root. */
  const gateFile = sessionId.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) + ".json"
  /** The receipt's plan ID must name the same unchanged empty stage under this lock. */
  const gate = readProjectJson(join(callerWorkspace, ".mpd", "session-gate", gateFile))
  if (plan.sessionId === sessionId && plan.approvedAt === undefined && plan.members.length === 0 && plan.tasks.length === 0
    && plan.requirements === undefined && plan.split === undefined && plan.created === undefined
    && plan.description.startsWith("Staged mechanically by the mpd ") && objectValue(gate) && gate.planId === plan.planId
    && gate.teamIdAtFire === "" && typeof gate.lastFiredAt === "number" && gate.lastFiredAt > 0) return
  throw new ProjectAdmissionError(`a different team plan ${plan.planId} is staged in this session; keep or archive that draft before starting Cellwork`)
}

/** Seed stable identities from the one unambiguous legacy board, without modifying its archives. */
function initialRecord(workspace: string, prior?: TeamRecord): ProjectRecord {
  return {
    version: 1,
    projectId: randomUUID(),
    projectRoot: workspace,
    captainId: randomUUID(),
    members: (prior?.members ?? []).filter((member) => member.status !== "failed" && member.projectScope !== "run").map((member) => ({ memberId: member.projectMemberId ?? randomUUID(), name: member.name, ...(member.role === undefined ? {} : { role: member.role }), route: null })),
    copies: [],
  }
}

/** Stage and read structured state at its project root while preserving the caller's actual cwd. */
export function projectStateWorkspace(workspace: string, sessionId?: string): string {
  /** Both Git checkout metadata and copy authorization are read from disk. */
  const location = locateProject(workspace)
  if (location.copy !== undefined && (sessionId === undefined || resolveSeat({ checkoutRoot: workspace, sessionId }).kind !== "member")) {
    throw new ProjectAdmissionError("this project copy is bound to another member or has no active assignment")
  }
  if (location.record !== undefined) return location.record.projectRoot
  // A previously staged or active legacy tool state keeps its original address until admission.
  if (["team", "cellwork"].some((name) => existsSync(join(workspace, ".mpd", name)))) return workspace
  return location.primaryRoot
}

/** Persist the project roster and materialize the board under the same admission lock. */
export function admitTeam<T>(input: {
  workspace: string; sessionId: string; planId: string; planName: string; parentTeamId?: string; members: readonly MemberDeclaration[]
  /** A plan may seed fixed seats only before any fixed roster exists. */
  allowInitialRoster?: boolean
  /** Freeze the owner's exact stage before admitting state or starting an activation. */
  prepare?: (target: string, location: ProjectLocation) => void
  /** The mounted watchdog may veto retirement of the prior board. */
  allowHandover?: HandoverAllowed
}, create: (workspace: string, project: ProjectRecord) => T): { existing: TeamRecord } | { created: T } {
  return withProjectLock(locateProject(input.workspace), (location) => {
    /** Team and Cellwork use the same scan and lock, including before projects have an identity. */
    const run = activeRun(location)
    /** The original board is the reply when its approval was interrupted or replayed. */
    const existing = listTeams(run.workspace).find((team) => team.planId === input.planId && team.leadSessionId === input.sessionId)
    if (existing !== undefined) {
      if (location.record === undefined && existing.parentTeamId === undefined) saveProject(location, { ...initialRecord(run.workspace, existing), captainSessionId: input.sessionId })
      return { existing }
    }
    if (input.parentTeamId === undefined) {
      /** An authenticated cell captain can attach or replace that cell's planning or execution board. */
      const cell = run.cells[0]
      /** The existing Cellwork staging verbs use these two names as their stable plan linkage. */
      const attached = cell !== undefined && cell.captainSessionId === input.sessionId && (input.planName === `cell ${cell.cellId}` || input.planName === `cell ${cell.cellId} execution`)
      if (location.copy !== undefined || (cell !== undefined && !attached)
        || (run.teams.length > 0 && !retireStoppedRun(run, input.allowHandover))) {
        throw new ProjectAdmissionError(`project is busy with ${runIds(run).join(", ") || "the approved copy's owning run"}`)
      }
    }
    /** An existing legacy stage may have been opened in a linked checkout before project binding. */
    const workspace = location.record === undefined && runIds(run).length === 0 ? location.checkoutRoot : run.workspace
    /** The first admitted deliberate roster is separate from Cellwork's execution seats. */
    const previous = location.record ?? initialRecord(workspace, run.teams[0])
    /** Approval can bootstrap an empty roster; subsequent changes require explicit captain authority. */
    const roster = declareMembers(previous, input.members)
    if (roster.members.length > previous.members.length && (previous.members.length > 0 || input.allowInitialRoster !== true || input.parentTeamId !== undefined)) {
      throw new ProjectAdmissionError("approval cannot extend a fixed project roster; use agent_teams_plan action roster to declare members explicitly")
    }
    input.prepare?.(workspace, location)
    /** A child board reuses the primary captain's identity and authority. */
    const project = input.parentTeamId === undefined && roster.captainSessionId !== input.sessionId ? { ...roster, captainSessionId: input.sessionId } : roster
    if (project !== location.record) saveProject(location, project)
    return { created: create(workspace, project) }
  })
}

/** Permanently declare one live-team addition using the same project roster. */
export function declareProjectMember(workspace: string, declaration: MemberDeclaration): ProjectMember | undefined {
  /** Legacy direct boards continue to accept append calls before a project is bound. */
  const location = locateProject(workspace)
  if (location.record === undefined) return undefined
  /** Append uses the same archive corroboration as approval and retains previously pinned routes. */
  const logicalName = declaration.logicalName ?? declaration.name
  /** Resolve any historical logical declaration before entering the short admission lock. */
  const previous = readProjectRosterBindings(workspace, [{ name: logicalName, description: "", prompt: "" }]).byLogicalName.get(logicalName)
  return withProjectLock(location, (fresh) => {
    /** Never write through a stale snapshot from a concurrent declaration. */
    const record = fresh.record
    if (record === undefined) throw new ProjectAdmissionError("project identity disappeared during roster update")
    /** Only an unknown logical seat produces a distinct durable account. */
    const next = declareMembers(record, [previous === undefined ? declaration : { ...declaration, logicalName, name: previous.name, workmate: previous.workmate, previous }])
    if (next !== record) saveProject(fresh, next)
    return next.members.find((member) => (member.logicalName ?? member.name) === logicalName)
  })
}

/** Use the same admission lock for the `/cellwork` command and the programmatic entry. */
function admitCell<T>(input: { checkoutRoot: string; sessionId: string }, open: (workspace: string) => T, allowHandover?: HandoverAllowed): T {
  return withProjectLock(locateProject(input.checkoutRoot), (location) => {
    /** Honor a legacy cell replay at its existing workspace. */
    const run = activeRun(location)
    /** An existing cell gets to decide whether this is the identical request or a competitor. */
    const cell = run.cells[0]
    if (location.copy !== undefined || (cell === undefined && run.teams.length > 0 && !retireStoppedRun(run, allowHandover))) {
      throw new ProjectAdmissionError(`project is busy with ${runIds(run).join(", ") || "the approved copy's owning run"}`)
    }
    if (cell !== undefined && cell.captainSessionId !== input.sessionId) {
      throw new ProjectAdmissionError(`project is busy with ${cell.cellId}`)
    }
    /** The captain remains identifiable after this cell stops. */
    const record = location.record ?? initialRecord(run.workspace, run.teams[0])
    if (record.captainSessionId !== input.sessionId) saveProject(location, { ...record, captainSessionId: input.sessionId })
    return open(run.workspace)
  })
}

/** A caller's alias/title/ancestry grants no project seat; require the saved live session id. */
function resolveSeat(input: { checkoutRoot: string; sessionId: string }): ProjectSeat {
  try {
    /** Copy and native-worktree locations share this exact resolution path. */
    const location = locateProject(input.checkoutRoot)
    /** Plain or dormant local workspaces keep their legacy solo entry. */
    const record = location.record
    if (record === undefined) return { kind: "unbound" }
    /** A corrupt or conflicting run fails closed for both assignment and private memory. */
    const run = activeRun(location)
    /** The exact latest captain stays identifiable after its run ends. */
    const captain = run.teams[0]
    /** A completed board remains addressable for the captain's integration bookkeeping. */
    const lastCaptain = captain === undefined && run.cells.length === 0 && record.captainSessionId === input.sessionId
    if (location.copy === undefined && (lastCaptain || run.cells[0]?.captainSessionId === input.sessionId || captain?.leadSessionId === input.sessionId || captain?.leadHistory?.includes(input.sessionId))) {
      /** The current board, or the last one led by this captain when the project is dormant. */
      const teamId = captain?.teamId ?? (lastCaptain ? listTeams(record.projectRoot).find((team) => team.parentTeamId === undefined && team.leadSessionId === input.sessionId)?.teamId : undefined) ?? ""
      return { kind: "member", projectId: record.projectId, projectRoot: record.projectRoot, checkoutRoot: location.checkoutRoot, memberId: record.captainId, teamId, memberName: "captain", seat: "captain" }
    }
    if (runIds(run).length === 0) return { kind: location.copy === undefined ? "unbound" : "denied" }
    /** Nested execution boards can hold another live activation for the same durable roster. */
    const archive = readArchivedPlanIndex(record.projectRoot)
    for (const team of listTeams(record.projectRoot).filter((candidate) => isLiveTeam(candidate, archive))) {
      /** The current executor handle is authoritative; board-local M numbers are never accounts. */
      const active = team.members.find((member) => member.executorRef === input.sessionId && member.status !== "failed" && member.projectScope !== "run")
      if (active === undefined || active.projectScope === "run") continue
      /** Legacy boards have no durable-id field and use their admitted name only after exact handle match. */
      const member = record.members.find((candidate) => active.projectMemberId === undefined ? candidate.name === active.name : candidate.memberId === active.projectMemberId)
      if (member !== undefined && (location.copy === undefined || location.copy.memberId === member.memberId)) {
        return { kind: "member", projectId: record.projectId, projectRoot: record.projectRoot, checkoutRoot: location.checkoutRoot, memberId: member.memberId, teamId: team.teamId, memberName: member.name, seat: "member" }
      }
    }
    return { kind: "denied" }
  } catch (error) {
    if (error instanceof Error) return { kind: "denied" }
    throw error
  }
}

/** The fixed roster carries no active session handles, private notes, or HOME paths. */
export interface ProjectRosterView {
  /** Null until the first admitted project workflow exists. */
  readonly projectId: string | null
  /** Canonical durable declarations. */
  readonly members: readonly ProjectMember[]
}

/** The stored cell record, paired with caller identity, is proof of a planning run. */
export function projectCellRun(workspace: string, sessionId: string, planName: string): "planning" | "execution" | undefined {
  /** A name pattern alone never confers an internal execution classification. */
  const cell = rootCells(workspace).find((entry) => entry.captainSessionId === sessionId && (planName === `cell ${entry.cellId}` || planName === `cell ${entry.cellId} execution`))
  return cell === undefined ? undefined : planName === `cell ${cell.cellId}` ? "planning" : "execution"
}

/** A cold foreign caller has no scope to read or add named identities to a bound project. */
function roster(input: { checkoutRoot: string; sessionId: string }): ProjectRosterView {
  /** Read the actual canonical storage for this tool's checkout. */
  const record = locateProject(input.checkoutRoot).record
  if (record === undefined) return { projectId: null, members: [] }
  /** An original Cellwork captain can read this before its first board exists. */
  const seat = resolveSeat(input)
  if (seat.kind !== "member" || seat.seat !== "captain" || seat.projectId !== record.projectId) throw new ProjectAdmissionError("only the authenticated project captain may read the fixed project roster")
  return { projectId: record.projectId, members: record.members }
}

export { roster as fixedProjectRoster }

/** Explicit declaration is the only route that extends a fixed roster after bootstrap. */
export function addFixedProjectMember(input: { checkoutRoot: string; sessionId: string }, declaration: MemberDeclaration): ProjectRosterView {
  /** A cold caller is refused before even creating a lock file. */
  const location = locateProject(input.checkoutRoot)
  if (location.record === undefined) throw new ProjectAdmissionError("start a project Team or Cellwork run before declaring a fixed member")
  return withProjectLock(location, (fresh) => {
    /** Reauthenticate inside the serializable write boundary. */
    const view = roster(input)
    /** A normal Team admission or Cellwork open establishes the project captain first. */
    const record = fresh.record
    if (record === undefined || view.projectId !== record.projectId) throw new ProjectAdmissionError("start a project Team or Cellwork run before declaring a fixed member")
    /** Legacy adoption uses the same corroboration as a normal plan approval. */
    const prior = readProjectRosterBindings(input.checkoutRoot, [{ name: declaration.name, description: "", prompt: "" }]).byLogicalName.get(declaration.name)
    /** A retry adds no row and does not change a previously pinned route. */
    const next = declareMembers(record, [prior === undefined ? declaration : { ...declaration, name: prior.name, logicalName: prior.logicalName ?? declaration.name, workmate: prior.workmate, previous: prior }])
    if (next !== record) saveProject(fresh, next)
    return { projectId: next.projectId, members: next.members }
  })
}

/** The in-process consumers get only the structured project operations they need. */
export const projectIdentity: ProjectIdentityService = { resolveSeat, roster, bindCheckout, unbindCheckout, admitCell }
