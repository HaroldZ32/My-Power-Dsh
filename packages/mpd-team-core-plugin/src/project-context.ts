import type { DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"
import type { ProjectIdentityService, ProjectSeat } from "./project-admission"
import { readContextNotes } from "./project-context-memory"
import { readContextFragment, readContextStructure } from "./project-context-sources"
import { buildProjectContext, currentTasks } from "./project-context-view"
import { blockingDependencies, readTeam, type TeamRecord, type TeamTaskRecord } from "./team-store"

/** Only already supported harness seams are required for the read-only projection. */
type ContextAdapter = Pick<DshAdapter, "workspaceRoot" | "liveAgentExact" | "registerPromptContext" | "goalState" | "contextPressure">

/** Durable state and diagnostics behind the per-request projection. */
interface ContextDeps {
  /** The same exact session/checkout authentication used by the project memory tools. */
  readonly identity: Pick<ProjectIdentityService, "resolveSeat">
  /** Read the optional memory service only when an actual request needs it. */
  readonly memory: () => unknown
  /** Report an unavailable host hook rather than claiming successful delivery. */
  readonly warn: (line: string) => void
}

/** Read the actual session handle carried by a live agent registration. */
function sessionIdOf(agent: unknown): string {
  /** The host-owned session, distinct from an app label, role or user-supplied string. */
  const session = typeof agent === "object" && agent !== null && "session" in agent ? agent.session : undefined
  return typeof session === "object" && session !== null && "id" in session && typeof session.id === "string" ? session.id : ""
}

/** The host event can wrap the actual agent handle. */
function eventAgent(payload: unknown): unknown {
  return typeof payload === "object" && payload !== null && "agent" in payload ? payload.agent : payload
}

/** Member task selection must match the exact executor handle on the same current board. */
function ownedTasks(team: TeamRecord, sessionId: string, seat: Extract<ProjectSeat, { kind: "member" }>): TeamTaskRecord[] {
  /** A handoff fence or a stale handle has no writable context to project. */
  const member = team.members.find((row) => row.executorRef === sessionId && row.name === seat.memberName)
  if (member === undefined || member.status === "failed" || member.fenced || member.mode === "checkpoint") return []
  return currentTasks(team.tasks.filter((task) => task.owner === member.name || task.owner === member.id || task.owner === sessionId))
}

/** Only running or claimed work with satisfied dependencies may carry file and private-memory data. */
function runnableTask(team: TeamRecord | undefined, tasks: readonly TeamTaskRecord[]): TeamTaskRecord | undefined {
  if (team === undefined) return undefined
  return tasks.find((task) => task.status !== "pending" && blockingDependencies(team.tasks, task.blockedBy).blocking.length === 0)
}

/** An unavailable sibling service never erases otherwise useful board and goal facts. */
function memoryOf(deps: ContextDeps): unknown {
  try { return deps.memory() } catch (error) {
    if (error instanceof Error) return undefined
    throw error
  }
}

/** Rebuild the section at request assembly without mutating the board, memory or transcript. */
function requestContext(dsh: ContextAdapter, deps: ContextDeps, agent: unknown): string {
  /** A missing session never falls back to a caller-provided workspace identity. */
  const sessionId = sessionIdOf(agent)
  if (sessionId === "") return ""
  /** All data-plane readers use the original executing agent, irrespective of its role name. */
  const exec = { agent }
  /** The actual current binding authorizes both checkout and member at this request. */
  const seat = deps.identity.resolveSeat({ checkoutRoot: dsh.workspaceRoot(exec), sessionId })
  if (seat.kind !== "member") return ""
  /** A late-ended or disappeared board never becomes the context of a different run. */
  const team = seat.teamId === "" ? undefined : readTeam(seat.projectRoot, seat.teamId)
  if (team?.endedAt !== undefined || team?.phase === "ended" || (seat.teamId !== "" && team === undefined)) return ""
  /** The original captain owns the durable project goal; use the team objective when unobservable. */
  const lead = seat.seat === "captain" ? agent : team === undefined ? undefined : dsh.liveAgentExact(team.leadSessionId)
  /** Observing the host's known goal does not create or update it. */
  const goal = lead === undefined || lead === null ? undefined : dsh.goalState(lead)
  /** The authoritative rows selected for this role. */
  const tasks = team === undefined ? [] : seat.seat === "captain" ? currentTasks(team.tasks) : ownedTasks(team, sessionId, seat)
  if (seat.seat === "member" && tasks.length === 0) return ""
  /** Observed pressure is optional. Never invent a window when the host has none. */
  const pressure = dsh.contextPressure(agent)
  /** At very high measured pressure leave the existing request entirely alone. */
  if (pressure.ratio !== null && pressure.ratio >= 0.96) return ""
  /** Near the window, omit every ancillary source read and send only minimal board facts. */
  const pressured = pressure.ratio !== null && pressure.ratio >= 0.88
  /** The first owned runnable row supplies the only file/memory source for this member. */
  const selected = seat.seat === "member" ? runnableTask(team, tasks) : undefined
  /** Captains can see the team's project-shared references, never a member's raw private note. */
  const refs = seat.seat === "captain" ? tasks : selected === undefined ? [] : [selected]
  return buildProjectContext({
    role: seat.seat, team, tasks, goal, pressured,
    notes: pressured || refs.length === 0 ? [] : readContextNotes(memoryOf(deps), exec, refs, seat.seat === "member"),
    structure: pressured ? undefined : readContextStructure(seat.checkoutRoot),
    fragment: pressured || selected === undefined ? undefined : readContextFragment(seat.checkoutRoot, selected.writeScopes),
  })
}

/** Register one native runtime-context projection and leave older hosts on their ordinary path. */
export function installProjectContext(dsh: ContextAdapter, deps: ContextDeps): () => void {
  /** A provider error cannot break an ordinary MPD or project turn. */
  const warned = new WeakSet<object>()
  /** Resolve from the request's actual agent, since a host hook may service every preset. */
  function text(request: unknown): string {
    /** The actual executing agent delivered by the prompt service. */
    const agent = eventAgent(request)
    if (typeof agent !== "object" || agent === null) return ""
    try { return requestContext(dsh, deps, agent) } catch (error) {
      if (!(error instanceof Error)) throw error
      if (!warned.has(agent)) deps.warn("project context unavailable for one request: " + error.message.slice(0, 160))
      warned.add(agent)
      return ""
    }
  }
  try {
    /** The native registry publishes literal snapshots with host-owned supersession semantics. */
    const dispose = dsh.registerPromptContext?.({ name: "mpd:project-context", order: 65, interpolate: false, text })
    if (dispose !== undefined) return dispose
    deps.warn("project context unavailable: host has no native request context registry")
  } catch (error) {
    if (!(error instanceof Error)) throw error
    deps.warn("project context registration refused: " + error.message.slice(0, 160))
  }
  return (): void => { /* no registry subscription exists on this host */ }
}
