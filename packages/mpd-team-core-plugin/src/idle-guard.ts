// THE IDLE-MEMBER GUARD (contract `.mpd/plans/team-idle-member-guard.md`, §3.1-3.3 + Amendment 1).
//
// THE DEFECT THIS CLOSES. A team plan that approves N members and one task used to spawn all N, and the
// taskless ones ran full model turns — reading source, writing docs, drafting contracts — for work the
// board never authorised. A prose rule cannot stop that; this module makes the board the only authority
// that can start a member's work:
//
//   1. PRE-STEP DETECTION (`agent/pre-step`, registered IN EACH AGENT'S OWN SCOPE — see the measurement
//      below): a session that is a live team's member with NO open task (owner or executor handle,
//      status pending/claimed/in_progress) is MARKED in a process-level set and receives exactly ONE
//      directive telling it to end its turn.
//   2. TOOL-BOUNDARY DENIAL (`tools.guard`, process-wide): every tool call from a marked session is
//      denied with one line. The mark is re-evaluated on BOTH sides at every pre-step (Amendment A2):
//      an open task CLEARS it, so a dispatch delivered through `TeamExecutor.send` — a path team-core
//      never observes as a tool call — still lets the member claim its work on the next step.
//   3. SPAWN PREAMBLE (prose, the second layer): {@link withIdlePreamble} prepends the same rule to the
//      prompt handed to the executor at spawn.
//   4. CONTROL-SEAT EXEMPTION: an explicit registration (never a name prefix) lets a cell's dispatcher
//      or a promoted subcaptain keep its control tools while it owns no board task.
//
// WHY THE PER-AGENT REGISTRATION IS LOAD-BEARING. `agent/pre-step` is dispatched through the agent's own
// scope carrier; a listener registered on a ROW's context reaches it only when that context is the
// dispatch scope or an ancestor of it. MEASURED 2026-09-27: the session-start gate was installed on a
// row's ctx and was SILENT on six live boots. `packages/mpd-roles-plugin/src/session-gate.ts` solved the
// same problem with `registerAgentPreStep(agent, …)` for every `liveAgents()` entry, re-armed on
// `agent/created` and released on `agent/disposed`; this module uses that proven route.
import { userMessage, type DshAgentPreStep, type DshLiveAgent, type DshPreStepDecision, type DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index"
import { listTeams, recordNamesLead, type TeamMemberRecord, type TeamRecord } from "./team-store"
import { isLiveTeamPhase } from "./team-lifecycle"

/** The one-line directive a taskless member receives at its step boundary. */
export const IDLE_DIRECTIVE_TEXT = "You have no board task. Do not read, run, write, message or claim. End your turn now."

/** The one-line denial EVERY tool call of a marked session receives (the guarantee, not the prose). */
export const IDLE_DENIAL_TEXT = "[mpd-team] no board task is assigned to you; end your turn and wait for a dispatch"

/** The fixed preamble prepended to every member's spawn prompt (the cheaper, prose-only layer). */
export const IDLE_PREAMBLE_TEXT = "You are a team member. You have NO board task yet unless this spawn carries one. Do not read, run, write, message or claim. Reply with one line and end your turn; the board will dispatch your task."

/**
 * The board statuses that mean a member still owns work.
 *
 * `claimed` and `in_progress` are the row's own claim; `pending` is a task ASSIGNED to the member but not
 * yet claimed — the deliberate asymmetry recorded in the contract (§6.4): the dispatch turn must be able
 * to call `agent_teams_task claim`, so an assigned task keeps the tools open.
 */
export const OPEN_TASK_STATUSES: readonly string[] = ["pending", "claimed", "in_progress"]

/** The adapter seams this module needs; a structural subset so a unit test needs no full adapter. */
export interface IdleGuardSeams {
  /** Every LIVE Agent in the process (`[]` when the registry is absent). */
  liveAgents(): readonly DshLiveAgent[]
  /** Register the pre-step listener inside ONE agent's own scope; throws when that scope exposes no `on`. */
  registerAgentPreStep(agent: unknown, listener: (payload: DshAgentPreStep, decision: DshPreStepDecision) => DshPreStepDecision | undefined): () => void
  /** The harness event seam (`ctx.on`); returns the disposer, or undefined when the bus is absent. */
  onEvent(event: string, handler: (...args: unknown[]) => unknown): (() => void) | undefined
  /** Install the process-wide tool guard; returns its disposer. */
  guardTool(guard: (exec: DshToolExec) => string | undefined): () => void
  /** Authoritative workspace root for one agent (the adapter's session-first resolution). */
  workspaceRoot(exec?: DshToolExec): string
  /** The row's log sink; optional so a test can stay silent. */
  rowLog?(line: string): void
}

/** What {@link installIdleGuard} returns: the state a caller may read and the disposers it must run. */
export interface IdleGuard {
  /** The sessions currently marked idle (process-level; a restart re-detects on the next pre-step). */
  readonly marked: ReadonlySet<string>
  /** Whether one session is marked idle right now. */
  isMarked(sessionId: string): boolean
  /** Clear one session's mark (the explicit-clear optimisation; the pre-step also re-evaluates). */
  clear(sessionId: string): void
  /** Exempt one session from the guard (a cell dispatcher / promoted subcaptain); returns the release. */
  registerControlSeat(sessionId: string): () => void
  /**
   * Open the DISPATCH WINDOW for one member: while it is open, the guard neither marks nor denies that
   * session, so a cold-resumed child's first `agent/pre-step` cannot be turned away before the dispatch
   * pass has recorded the assignment (CodeRabbit #81 D2). Momentary and counted: the caller releases it
   * in a `finally`, and the same session may open two windows without the first release closing the
   * second.
   * @param sessionId - the member session being dispatched.
   * @returns the release for this window.
   */
  beginDispatch(sessionId: string): () => void
  /** Every registration this installer made, for the row's own disposal list. */
  readonly disposers: ReadonlyArray<() => void>
}

/**
 * The message text of a thrown value, for a warning line.
 * @param error - the thrown value.
 * @returns its message, or the value coerced to a string.
 */
function wireReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The session id one agent carries, from its session first and the agent row second.
 *
 * The same reading `sessionIdOf` uses inside the row and `settleMember` matches against `executorRef`.
 * @param agent - a live Agent, an exec, or anything carrying `session.id` / `id`.
 * @returns the session id, or the empty string when the value names none.
 */
export function sessionIdOfAgent(agent: unknown): string {
  /** The candidate as a loose record, because a payload is untrusted input. */
  const candidate = agent as { session?: { id?: unknown }; id?: unknown } | undefined
  /** The session id, when the value is one. */
  const sessionId = candidate?.session?.id
  if (typeof sessionId === "string" && sessionId !== "") return sessionId
  /** The agent's own id, which the harness keeps equal to the session id. */
  const id = candidate?.id
  return typeof id === "string" ? id : ""
}

/**
 * The member row a session id names, by the ONE handle the record keeps for it (`executorRef`).
 * @param record - the team record to search.
 * @param sessionId - the session asking.
 * @returns the member row, or undefined when this team does not hold that session.
 */
export function memberForSession(record: TeamRecord, sessionId: string): TeamMemberRecord | undefined {
  if (sessionId === "") return undefined
  return record.members.find((member) => member.executorRef === sessionId)
}

/**
 * Whether one member still owns work on the board.
 *
 * BOTH owner spellings the board may carry are accepted (the member's display name for a planned owner,
 * its executor handle for a session claim), exactly as `settleMember` reads them.
 * @param record - the team record holding the board.
 * @param sessionId - the member's session id.
 * @returns true when the member owns at least one open task; false when it owns none or is not in this record.
 */
export function memberHasOpenTask(record: TeamRecord, sessionId: string): boolean {
  /** The member row, when this record holds it. */
  const member = memberForSession(record, sessionId)
  if (member === undefined) return false
  return record.tasks.some((task) => OPEN_TASK_STATUSES.includes(task.status)
    && (task.owner === member.name || (member.executorRef !== undefined && task.owner === member.executorRef)))
}

/**
 * The live team one session belongs to, or undefined when no live team names it.
 *
 * A terminal record never counts: a stopped/archived team must never mark its sessions (contract §3.1).
 * @param teams - the records to search, newest first.
 * @param sessionId - the session asking.
 * @returns the first live record holding the session as a member.
 */
export function findMemberTeam(teams: readonly TeamRecord[], sessionId: string): TeamRecord | undefined {
  if (sessionId === "") return undefined
  return teams.find((team) => isLiveTeamPhase(team.phase) && memberForSession(team, sessionId) !== undefined)
}

/**
 * Prepend the fixed idle preamble to one member's spawn prompt (the prose layer of §3.3).
 * @param prompt - the prompt the caller asked the member to receive.
 * @returns the preamble, a blank line, then that prompt.
 */
export function withIdlePreamble(prompt: string): string {
  return IDLE_PREAMBLE_TEXT + "\n\n" + prompt
}

/**
 * Install the idle-member guard: the process-wide marks, the per-agent pre-step detection and the tool
 * boundary denial.
 *
 * TOTAL BY CONTRACT: a scope that refuses its pre-step listener, a missing event bus and a tools registry
 * without `guard()` each degrade to a REPORTED absence — the boot and every other row stay untouched.
 * @param dsh - the adapter seams this module needs.
 * @returns the guard's state, its registrations and the reason it degraded (when it did).
 */
export function installIdleGuard(dsh: IdleGuardSeams): IdleGuard {
  /** Sessions currently marked idle. Process-local: a restart re-detects on the next pre-step. */
  const marked = new Set<string>()
  /** Sessions explicitly exempted as control seats (a cell dispatcher / promoted subcaptain). */
  const controlSeats = new Set<string>()
  /**
   * Open dispatch windows per session, by COUNT so overlapping windows are independent (CodeRabbit #81
   * D2). The dispatch pass opens one BEFORE it awaits the send: the native executor cold-resumes the
   * child, whose first pre-step would otherwise find no open task yet and mark it idle — denying the
   * very claim that makes the task open.
   */
  const dispatching = new Map<string, number>()
  /** The turn number each session's directive was last injected for, so one turn gets one directive. */
  const injectedTurns = new Map<string, number>()
  /** Every registration this installation made, run together by the row's disposal path. */
  const disposers: Array<() => void> = []
  /** The one warning sink: the row's log, or silence in a unit test. */
  const warn = (line: string): void => {
    try {
      dsh.rowLog?.(line)
    } catch { /* a log sink that throws must not break the guard */ }
  }
  /** The reason one agent's listener could not be registered, reported once per agent. */
  const register = (agent: unknown): void => {
    if (agent === undefined || agent === null) return
    if (agentDisposers.has(agent)) return
    try {
      /** The scope's own disposer, or a no-op when it returned none. */
      const dispose = dsh.registerAgentPreStep(agent, listener)
      agentDisposers.set(agent, typeof dispose === "function" ? dispose : (): void => { /* absent */ })
    } catch (error) {
      warn(`[mpd-team-core] the idle-member guard could not register a pre-step listener for agent "${sessionIdOfAgent(agent)}" (${wireReason(error)})`)
    }
  }
  /** The disposer of each registering agent, so a disposed agent's listener is released. */
  const agentDisposers = new Map<unknown, () => void>()

  /**
   * One agent's pre-step: mark a taskless member, clear a member whose task came back, inject one
   * directive per idle turn.
   * @param payload - the harness's pre-step payload (it fuses the live agent).
   * @param decision - the downstream decision the adapter already resolved.
   * @returns a replaced decision with the directive, or undefined to pass the downstream one through.
   */
  const listener = (payload: DshAgentPreStep, decision: DshPreStepDecision): DshPreStepDecision | undefined => {
    try {
      /** The agent the step belongs to: the payload's fused agent, or the one this listener was registered for. */
      const agent = payload?.agent ?? payload
      /** The asking session. */
      const sessionId = sessionIdOfAgent(agent)
      if (sessionId === "") return undefined
      // THE DISPATCH WINDOW (CodeRabbit #81 D2): the pass waking this member opens a window BEFORE it
      // awaits the send, so the cold-resumed child's first step is never marked — the assignment it is
      // being woken for may not be on the board yet, and denying that step would lose the claim the
      // dispatch exists to hand over. The window is momentary (released in the pass's `finally`).
      if (dispatching.has(sessionId)) {
        clear(sessionId)
        return undefined
      }
      // A control seat keeps its tools: the exemption is an explicit registration, never a name prefix.
      if (controlSeats.has(sessionId)) {
        clear(sessionId)
        return undefined
      }
      /** The workspace this session's records live in (session header first, per the adapter). */
      const workspace = dsh.workspaceRoot({ agent } as DshToolExec)
      /** The live team naming this session, or undefined for a session in no team. */
      const team = workspace === "" ? undefined : findMemberTeam(listTeams(workspace), sessionId)
      if (team === undefined) {
        // A session in no live team is untouched, and a mark left over from a stopped team is dropped.
        clear(sessionId)
        return undefined
      }
      // The Lead is not a member with tasks; the record's own spelling (including history) decides.
      if (recordNamesLead(team, [sessionId])) {
        clear(sessionId)
        return undefined
      }
      if (memberHasOpenTask(team, sessionId)) {
        // Amendment A2: an open task CLEARS the mark, including one delivered by a path team-core never
        // observed (the cellwork dispatch sends through `TeamExecutor.send`, not a board tool).
        clear(sessionId)
        return undefined
      }
      // The one-directive rule: one per TURN when the harness reports the turn ordinal, else one per
      // marking. A repeated step inside the same turn never appends a second directive.
      const turn = typeof payload?.turn === "number" ? payload.turn : null
      if (turn === null && marked.has(sessionId)) return undefined
      if (turn !== null && injectedTurns.get(sessionId) === turn && marked.has(sessionId)) return undefined
      marked.add(sessionId)
      if (turn !== null) injectedTurns.set(sessionId, turn)
      /** The step's existing messages, so the directive ADDS to them instead of replacing them. */
      const carried = decision?.messages ?? payload?.messages ?? []
      // PRESERVE THE DOWNSTREAM DECISION (CodeRabbit #81 D3): a step the harness already REJECTED must
      // stay a rejection — converting it to `enter` would run a step the loop had refused. The directive
      // is injected only on a step that would otherwise run; the mark and its bookkeeping still stand.
      const kind = typeof decision?.kind === "string" ? decision.kind : "enter"
      if (kind !== "enter") return decision
      return {
        ...decision,
        kind: "enter",
        messages: [...carried, userMessage({ text: IDLE_DIRECTIVE_TEXT, source: { kind: "mpd-team", reason: "idle-member-guard" } })],
      }
    } catch (error) {
      warn(`[mpd-team-core] the idle-member guard's pre-step listener failed: ${wireReason(error)}`)
      return undefined
    }
  }

  /**
   * Drop one session's mark and its directive bookkeeping.
   * @param sessionId - the session to clear.
   */
  const clear = (sessionId: string): void => {
    marked.delete(sessionId)
    injectedTurns.delete(sessionId)
  }

  /**
   * Open one counted dispatch window for a member session (CodeRabbit #81 D2).
   *
   * A release is idempotent, so a caller that runs it twice cannot close another window's count. An
   * empty session id opens nothing and returns a no-op release.
   * @param sessionId - the member session about to be woken.
   * @returns the release for this window.
   */
  const beginDispatch = (sessionId: string): (() => void) => {
    if (sessionId === "") return (): void => { /* nothing to release */ }
    dispatching.set(sessionId, (dispatching.get(sessionId) ?? 0) + 1)
    /** Whether THIS release already ran, so a double release cannot steal a concurrent window. */
    let released = false
    return (): void => {
      if (released) return
      released = true
      /** The windows still open for that session after this release. */
      const remaining = (dispatching.get(sessionId) ?? 0) - 1
      if (remaining > 0) dispatching.set(sessionId, remaining)
      else dispatching.delete(sessionId)
    }
  }

  // THE TOOL BOUNDARY — the guarantee. Installed ONCE and process-wide; every marked session's every
  // tool call is refused with one line, including `agent_teams_task claim` (a taskless member has nothing
  // to claim; an assigned task clears the mark at the next pre-step, before any tool runs).
  try {
    /** The tools registry disposer, pushed so a row reload cannot leave a dead guard installed. */
    const offGuard = dsh.guardTool((exec: DshToolExec) => {
      /** The calling session, resolved the same way the rest of the row resolves it. */
      const sessionId = sessionIdOfAgent(exec?.agent)
      // A member inside a dispatch window is being given work; denying it would drop the claim (D2).
      return sessionId !== "" && !dispatching.has(sessionId) && marked.has(sessionId) ? IDLE_DENIAL_TEXT : undefined
    })
    if (typeof offGuard === "function") disposers.push(offGuard)
  } catch (error) {
    warn(`[mpd-team-core] the idle-member guard could not install its tool guard (${wireReason(error)})`)
  }

  // THE PRE-STEP — registered per agent (A1: a row-ctx listener is not a reliable subscriber). The live
  // registry covers already-running members; the two lifecycle events cover teammates raised later and
  // release a disposed agent's listener.
  // The registry is read through a guard of its own: a stub composition without the seam must degrade
  // (the lifecycle subscriptions below still arm a member raised later), never take the row's apply down.
  try {
    for (const agent of dsh.liveAgents() ?? []) register(agent)
  } catch (error) {
    warn(`[mpd-team-core] the idle-member guard could not read the live registry (${wireReason(error)})`)
  }
  try {
    /** The `agent/created` disposer, when the bus exists. */
    const offCreated = dsh.onEvent("agent/created", (payload: unknown): undefined => {
      register((payload as { agent?: unknown } | undefined)?.agent ?? payload)
      return undefined
    })
    if (typeof offCreated === "function") disposers.push(offCreated)
  } catch (error) {
    warn(`[mpd-team-core] the idle-member guard could not subscribe to agent/created (${wireReason(error)})`)
  }
  try {
    /** The `agent/disposed` disposer, when the bus exists. */
    const offDisposed = dsh.onEvent("agent/disposed", (payload: unknown): undefined => {
      /** The agent leaving the registry. */
      const agent = (payload as { agent?: unknown } | undefined)?.agent ?? payload
      /** Its listener's disposer, when it was registered here. */
      const dispose = agentDisposers.get(agent)
      if (dispose !== undefined) {
        agentDisposers.delete(agent)
        clear(sessionIdOfAgent(agent))
        try {
          dispose()
        } catch { /* a failed teardown must not break agent disposal */ }
      }
      return undefined
    })
    if (typeof offDisposed === "function") disposers.push(offDisposed)
  } catch (error) {
    warn(`[mpd-team-core] the idle-member guard could not subscribe to agent/disposed (${wireReason(error)})`)
  }
  // The per-agent listeners are released with the row as well as with their own agent.
  disposers.push((): void => {
    for (const dispose of agentDisposers.values()) {
      try {
        dispose()
      } catch { /* already gone */ }
    }
    agentDisposers.clear()
  })

  return {
    marked,
    isMarked: (sessionId: string): boolean => marked.has(sessionId),
    clear,
    registerControlSeat: (sessionId: string): (() => void) => {
      if (sessionId !== "") controlSeats.add(sessionId)
      return (): void => { controlSeats.delete(sessionId) }
    },
    beginDispatch,
    disposers,
  }
}
