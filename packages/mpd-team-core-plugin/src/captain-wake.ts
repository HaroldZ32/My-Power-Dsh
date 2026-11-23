import { resolve } from "node:path"
import { canSubmitUserTurn, isRecord, userMessage, type DshAdapter, type DshLiveAgent, type DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index"
import type { ChangeFeed } from "./change-feed.ts"
import { awaitCaptainEvent, type CaptainEventWaitResult, type WakeEvaluation } from "./captain-event-wait.ts"
import { readMailbox, type MailMessage } from "./mailbox-store.ts"
import { readTeam, recordNamesLead, type TeamRecord, type TaskStatus } from "./team-store.ts"
import { createWake, decideWake, finishWake, readWakeDecision, readWakeHistory, readWakeMatch, readWakeReceipt, rememberWakeMatch, type WakeCondition, type WakeMatch, type WakeRegistration, type WakeScope } from "./captain-wake-store.ts"

/** A task status that releases a captain's terminal join. */
type TerminalStatus = "completed" | "failed" | "cancelled"

/** A durable registration as reported to its owner. */
type WakeView = Omit<WakeRegistration, "immediate" | "sequence" | "sessionId"> & {
  /** `submitted` is adapter acceptance; only the host can observe a following turn. */
  readonly state: "waiting" | "ready" | "satisfied" | "cancelled" | "submitted" | "failed" | "delivery-unknown"
  /** IDs/statuses that satisfied the predicate, with no task or mail prose. */
  readonly match?: WakeMatch
  /** A failure, ambiguity or open condition worth showing the caller. */
  readonly reason?: string
}

/** Scope comes from the live session header, never the host's fallback cwd or a tool argument. */
export function captainWakeScope(agent: unknown): WakeScope | undefined {
  if (!isRecord(agent) || !isRecord(agent.session) || !isRecord(agent.session.header)) return undefined
  /** The host's original session ID and explicit workspace. */
  const { id, header } = agent.session
  if (typeof id !== "string" || id === "" || !isRecord(header) || typeof header.cwd !== "string" || header.cwd === "") return undefined
  return { sessionId: id, workspace: resolve(header.cwd) }
}

/** Terminal work includes unsuccessful results so a captain can arrange recovery. */
function terminal(status: TaskStatus): status is TerminalStatus {
  return status === "completed" || status === "failed" || status === "cancelled"
}

/** Mail waits see only team-stamped rows for the canonical captain mailbox address. */
function mailFor(scope: WakeScope, team: TeamRecord, fromMember: string | undefined): MailMessage[] {
  return readMailbox(scope.workspace).messages.filter((mail) => mail.teamId === team.teamId && mail.toId === team.leadSessionId
    && mail.fromId !== team.leadSessionId && mail.fromId !== scope.sessionId
    && (fromMember === undefined || mail.fromMemberId === fromMember))
}

/** Compare committed timestamps when observing a match on a closed board. */
function beforeClose(at: string, endedAt: string | undefined, inclusive: boolean): boolean {
  if (endedAt === undefined) return true
  /** An absent or invalid comparable timestamp cannot prove a pre-close match. */
  const delta = Date.parse(at) - Date.parse(endedAt)
  return inclusive ? delta <= 0 : delta < 0
}

/** Read the selected task statuses or durable mail tail; neither depends on a transient event payload. */
function evaluate(scope: WakeScope, team: TeamRecord, condition: WakeCondition): WakeEvaluation {
  if (condition.kind === "mail") {
    /** Durable matching rows after the arm's snapshot, regardless of later acknowledgement. */
    const messages = mailFor(scope, team, condition.fromMember)
    /** The saved cursor is scoped to this predicate's own mailbox stream. */
    const at = condition.after === null ? -1 : messages.map((mail) => mail.id).lastIndexOf(condition.after)
    if (condition.after !== null && at < 0) return { reason: "the mailbox cursor is missing; arm a new wake after reviewing the inbox" }
    // The mailbox is a separate file. Read the close stamp after the mailbox snapshot so a
    // send-after-close cannot slip through a board read taken just before the other writer's close.
    /** The team's latest durable close boundary. */
    const endedAt = readTeam(scope.workspace, team.teamId)?.endedAt ?? team.endedAt
    /** Return the first eligible ID only. An unobserved same-millisecond tie cannot prove mail preceded close. */
    const message = messages.slice(at + 1).find((mail) => beforeClose(mail.sentAt, endedAt, false))
    if (message !== undefined) return { match: { messageId: message.id } }
    if (endedAt !== undefined) return { ended: true, reason: `team ${team.teamId} ended before the condition matched` }
  } else {
    /** Exact board rows, including the states of unsuccessful prerequisites. */
    const tasks: Record<string, TerminalStatus> = {}
    for (const id of condition.ids) {
      /** A vanished requested row cannot establish a terminal predicate. */
      const row = team.tasks.find((task) => task.id === id)
      if (row === undefined) return { reason: `task ${id} is missing from team ${team.teamId}` }
      if (terminal(row.status) && beforeClose(row.finishedAt ?? row.updatedAt, team.endedAt, true)) tasks[id] = row.status
    }
    /** `any` becomes ready on one terminal row; `all` requires every selected row. */
    const count = Object.keys(tasks).length
    if (condition.mode === "any" ? count > 0 : count === condition.ids.length) return { match: { tasks } }
  }
  return team.endedAt === undefined ? {} : { ended: true, reason: `team ${team.teamId} ended before the condition matched` }
}

/** Read readiness on the captured team, even when the captain later binds a different team. */
function evaluateRecord(scope: WakeScope, record: WakeRegistration): WakeEvaluation {
  /** Reload the exact board from disk to observe the committed revision. */
  const team = readTeam(scope.workspace, record.teamId)
  if (team === undefined || !recordNamesLead(team, [scope.sessionId])) return { reason: "the original team or its captain binding is unavailable" }
  /** A match observed before a close remains eligible while the captain waits to go idle. */
  const match = readWakeMatch(scope, record)
  return match === undefined ? evaluate(scope, team, record.condition) : { match }
}

/** Project both the board's current readiness and the durable delivery outcome. */
function view(scope: WakeScope, record: WakeRegistration): WakeView {
  /** Internal indexing/binding data stays in the store. */
  const { immediate, sequence: _sequence, sessionId: _sessionId, ...fields } = record
  if (immediate !== undefined) return { ...fields, state: "satisfied", match: immediate }
  /** The exclusive decision distinguishes cancellation from a potentially submitted turn. */
  const decision = readWakeDecision(scope, record)
  if (decision === "unknown") return { ...fields, state: "delivery-unknown", reason: "the decision was interrupted; no retry was attempted" }
  if (decision?.kind === "cancelled") return { ...fields, state: "cancelled" }
  if (decision?.kind === "failed") return { ...fields, state: "failed", reason: decision.reason }
  if (decision?.kind === "submit") {
    /** The host may have accepted a turn before a crash that interrupted the receipt write. */
    const receipt = readWakeReceipt(scope, record)
    if (receipt === undefined) return { ...fields, state: "delivery-unknown", match: decision.match, reason: "the host receipt is missing; no retry was attempted" }
    if (!receipt.accepted) return { ...fields, state: "failed", match: decision.match, reason: "the host refused the captain follow-up" }
    return { ...fields, state: "submitted", match: decision.match }
  }
  /** Waiting and ready can be reconstructed from durable state after a restart. */
  const status = evaluateRecord(scope, record)
  if (status.reason !== undefined) return { ...fields, state: "failed", reason: status.reason }
  return status.match === undefined ? { ...fields, state: "waiting" } : { ...fields, state: "ready", match: status.match }
}

/** Arguments an arm must parse before creating any persistent records. */
function parseCondition(raw: Record<string, unknown>, scope: WakeScope, team: TeamRecord): { condition: WakeCondition; immediate?: WakeMatch } {
  if (raw.event === "mail") {
    if (raw.task_ids !== undefined || raw.mode !== undefined) throw new Error("a mail wake takes from_member, without task_ids or mode")
    /** Optional sender selector is a durable roster ID; validate it against the same board. */
    const fromMember = raw.from_member
    if (fromMember !== undefined && (typeof fromMember !== "string" || !team.members.some((member) => member.id === fromMember))) {
      throw new Error("from_member must name a member ID on this team")
    }
    /** Snapshot before writing the registration, after installing its subscription. */
    const messages = mailFor(scope, team, fromMember)
    /** Recheck a close committed after the tool captured its active team. */
    const endedAt = readTeam(scope.workspace, team.teamId)?.endedAt ?? team.endedAt
    /** An already unread eligible message needs no later turn. */
    const unread = messages.find((mail) => mail.readAt === undefined && beforeClose(mail.sentAt, endedAt, false))
    return {
      condition: { kind: "mail", ...(fromMember === undefined ? {} : { fromMember }), after: messages.at(-1)?.id ?? null },
      ...(unread === undefined ? {} : { immediate: { messageId: unread.id } }),
    }
  }
  if ((raw.event !== undefined && raw.event !== "tasks") || raw.from_member !== undefined) throw new Error("wake event must be tasks or mail")
  if (raw.mode !== undefined && raw.mode !== "all" && raw.mode !== "any") throw new Error("task wake mode must be all or any")
  /** Bound one registration's board read and injected notice to task IDs only. */
  const ids: unknown = raw.task_ids
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 64 || !ids.every((id): id is string => typeof id === "string" && /^T[1-9]\d*$/u.test(id))) {
    throw new Error("task_ids must be an array of 1 to 64 board task IDs")
  }
  /** Canonicalize duplicates and order for idempotent re-arms. */
  const condition: WakeCondition = { kind: "tasks", ids: [...new Set(ids)].sort(), mode: raw.mode === "any" ? "any" : "all" }
  /** Evaluate the initial board before the write so an already-true arm returns immediately. */
  const outcome = evaluate(scope, team, condition)
  if (outcome.reason !== undefined) throw new Error(outcome.reason)
  return { condition, ...(outcome.match === undefined ? {} : { immediate: outcome.match }) }
}

/** Equality ignores a mail arm's new snapshot, since the previous wait owns its original cursor. */
function sameCondition(first: WakeCondition, second: WakeCondition): boolean {
  if (first.kind === "mail" && second.kind === "mail") return first.fromMember === second.fromMember
  return first.kind === "tasks" && second.kind === "tasks" && first.mode === second.mode && first.ids.join(",") === second.ids.join(",")
}

/** Create a fixed host follow-up. Row subjects, mail bodies and caller-written text stay out of it. */
function notice(record: WakeRegistration, match: WakeMatch): ReturnType<typeof userMessage> {
  return userMessage({
    text: `Team wake ${record.id} matched on ${JSON.stringify(record.teamId)}. ${match.messageId === undefined ? `Terminal board task statuses: ${JSON.stringify(match.tasks)}. Read the team board.` : `Mailbox message ID ${JSON.stringify(match.messageId)}. Read the team inbox.`} Continue the task you armed this wake for.`,
    source: { kind: "mpd-team-wake", wakeId: record.id },
  })
}

/** Render the control tool's response without hiding the ID or the required yield. */
export function renderCaptainWake(value: WakeReply): string {
  /** Team IDs disambiguate otherwise identical task ordinals across boards. */
  const line = (row: WakeView): string => `wake ${row.id} · team ${row.teamId} · ${row.state}${row.reason === undefined ? "" : ` · ${row.reason}`}`
  if ("wait" in value) {
    /** The result belongs to this call and carries only IDs and terminal states. */
    const result = value.wait
    return `wait · team ${result.teamId} · ${result.state}${result.match === undefined ? "" : ` · ${JSON.stringify(result.match)}`}${result.reason === undefined ? "" : ` · ${result.reason}`}`
  }
  if ("registration" in value) return `${line(value.registration)}${value.next === undefined ? "" : `\n${value.next}`}`
  return value.registrations.length === 0 ? "No captain wake registrations." : value.registrations.map(line).join("\n")
}

/** Control replies keep inspection and mutation shape explicit. */
export type WakeReply = { readonly registration: WakeView; readonly next?: string } | { readonly registrations: readonly WakeView[] } | { readonly wait: CaptainEventWaitResult }

/** Ready or waiting registrations are the ones a captain may still cancel. */
function pending(current: WakeView): boolean {
  return current.state === "waiting" || current.state === "ready"
}

/** Check that a registry entry still represents the exact bound original session. */
function sameScope(agent: unknown, scope: WakeScope): boolean {
  /** Fresh host facts, independent of the caller who armed the registration. */
  const current = captainWakeScope(agent)
  return current?.sessionId === scope.sessionId && current.workspace === scope.workspace
}

/** Services needed by the event-driven captain-wake controller. */
export interface CaptainWakeDeps {
  /** Existing host adapter, including the exact registry and next-turn seam. */
  readonly dsh: Pick<DshAdapter, "liveAgents" | "liveAgentExact" | "onEvent" | "submitUserTurn">
  /** Commits from the team board and mailbox. */
  readonly feed: Pick<ChangeFeed, "subscribe">
  /** Audit timestamp for new registrations. */
  readonly now: () => Date
  /** Failures while evaluating a pending registration appear in the row log. */
  readonly warn: (message: string) => void
}

/** Mount one process-local evaluator over durable one-shot captain registrations. */
export function installCaptainWake(deps: CaptainWakeDeps): CaptainWakeController {
  return new CaptainWakeController(deps)
}

/** The watcher keeps no private workflow truth: every decision is made over persisted records. */
export class CaptainWakeController {
  /** Watches scoped workspaces with a currently live pending registration. */
  private readonly subscriptions = new Map<string, () => void>()
  /** At most one ongoing tool wait per exact workspace/session, separate from durable registrations. */
  private readonly waits = new Map<string, AbortController>()
  /** Host event listeners that can resume evaluation on an idle edge or reopen. */
  private readonly listeners: Array<() => void> = []
  /** An outstanding coalesced callback, scheduled outside the host event handler. */
  private scheduled: ReturnType<typeof setImmediate> | undefined
  /** A disposed row cannot enqueue work or create any new subscriptions. */
  private disposed = false
  /** Runtime seams supplied by this row's composition. */
  private readonly deps: CaptainWakeDeps

  /** Install listeners before resuming pending work from already open sessions. */
  constructor(deps: CaptainWakeDeps) {
    this.deps = deps
    for (const event of ["agent/status", "agent/created"]) {
      /** An older adapter may have no event bus. */
      const off = deps.dsh.onEvent?.(event, () => { this.queue() })
      if (typeof off === "function") this.listeners.push(off)
    }
    if (this.listeners.length > 0) this.queue()
  }

  /** Keep the ready check separate from the status event's dispatch chain. */
  private queue(): void {
    if (this.disposed || this.scheduled !== undefined) return
    this.scheduled = setImmediate(() => {
      this.scheduled = undefined
      this.scan()
    })
  }

  /** Subscribe before the registration reads disk. Duplicate mounts reuse a single workspace watch. */
  private observe(workspace: string): void {
    if (!this.subscriptions.has(workspace)) this.subscriptions.set(workspace, this.deps.feed.subscribe(workspace, () => { this.queue() }))
  }

  /** Evaluating a persistent registration always starts from its exact live session. */
  private scan(): void {
    try {
      /** One snapshot is enough to reject duplicate live Agents for the same bound session. */
      const agents = this.deps.dsh.liveAgents?.() ?? []
      /** Keep filesystem watches only while a live original session still has a pending arm. */
      const required = new Set<string>()
      for (const agent of agents) {
        /** Reopen on the same session requires its original workspace and an exact host registry hit. */
        const scope = captainWakeScope(agent)
        if (scope === undefined || this.deps.dsh.liveAgentExact?.(agent.id) !== agent || agents.filter((other) => sameScope(other, scope)).length !== 1) continue
        try {
          /** A session admits one pending arm, always its last registration. */
          const [record] = readWakeHistory(scope, 1)
          if (record === undefined || record.immediate !== undefined || readWakeDecision(scope, record) !== undefined) continue
          this.observe(scope.workspace)
          this.deliver(scope, record, agent)
          if (readWakeDecision(scope, record) === undefined) required.add(scope.workspace)
        } catch (error) {
          this.deps.warn(`captain wake for ${scope.sessionId}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      for (const [workspace, off] of this.subscriptions) {
        if (required.has(workspace)) continue
        off()
        this.subscriptions.delete(workspace)
      }
    } catch (error) {
      this.deps.warn(`captain wake scan: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** Win the durable decision before trying the host, and never retry a missing receipt. */
  private deliver(scope: WakeScope, record: WakeRegistration, agent: DshLiveAgent): void {
    /** The predicate always reads a fresh board or mailbox. */
    const outcome = evaluateRecord(scope, record)
    if (outcome.reason !== undefined) {
      decideWake(scope, record, { kind: "failed", reason: outcome.reason })
      return
    }
    if (outcome.match === undefined) return
    /** Commit readiness before waiting out the current captain turn. */
    const match = readWakeMatch(scope, record) ?? rememberWakeMatch(scope, record, outcome.match)
    if (this.deps.dsh.liveAgentExact(agent.id) !== agent || !sameScope(agent, scope)) return
    if (!canSubmitUserTurn(agent) || (agent.status !== "idle" && agent.status !== "running") || typeof this.deps.dsh.submitUserTurn !== "function") {
      decideWake(scope, record, { kind: "failed", reason: "the original captain no longer exposes host idle status and next-turn submission" })
      return
    }
    if (agent.status !== "idle" || !decideWake(scope, record, { kind: "submit", match })) return
    /** Submission acceptance proves only the host's next-turn enqueue. */
    const accepted = this.deps.dsh.submitUserTurn(agent, notice(record, match))
    finishWake(scope, record, accepted)
    this.queue()
  }

  /** Drive the scoped public control action as the exact original captain. */
  execute(exec: DshToolExec, scope: WakeScope, raw: unknown, team: TeamRecord | undefined): WakeReply | Promise<WakeReply> {
    if (!isRecord(raw)) throw new Error("wake needs an object with action arm, wait, status or cancel")
    /** Identity must come from the running execution rather than the supplied tool arguments. */
    const agent = exec.agent
    /** Look up status on the registry's exact instance. */
    const live = isRecord(agent) && typeof agent.id === "string" ? this.deps.dsh.liveAgentExact?.(agent.id) : undefined
    if (live === undefined || !Object.is(live, agent) || !sameScope(live, scope)) {
      throw new Error("captain wake requires the exact live session; this host could not verify it")
    }
    if (raw.action === "arm" || raw.action === "wait") {
      if (team === undefined || !recordNamesLead(team, [scope.sessionId]) || team.endedAt !== undefined) throw new Error(`wake ${raw.action} requires your active team and its recorded captain session`)
      /** Keep active watches and tool waits disjoint for this exact resident session. */
      const key = JSON.stringify([scope.workspace, scope.sessionId])
      if (this.waits.has(key)) throw new Error("this captain already has a pending in-turn wait")
      return raw.action === "wait" ? this.wait(key, scope, live, exec, raw, team) : this.arm(scope, live, raw, team)
    }
    if (raw.action !== "status" && raw.action !== "cancel") throw new Error("wake action must be arm, wait, status or cancel")
    if (raw.action === "status" && raw.id === undefined) return { registrations: readWakeHistory(scope, 20).map((record) => view(scope, record)) }
    if (typeof raw.id !== "string" || raw.id === "") throw new Error("wake cancel needs its registration id")
    /** Look up the opaque ID only inside the calling session's workspace and registration history. */
    const record = readWakeHistory(scope, Infinity).find((entry) => entry.id === raw.id)
    if (record === undefined) throw new Error("wake id was not found in your session")
    if (raw.action === "cancel" && record.immediate === undefined) {
      decideWake(scope, record, { kind: "cancelled" })
      this.queue()
    }
    return { registration: view(scope, record) }
  }

  /** Bind the tool promise to the same team and predicate as a durable watch, without registering one. */
  private async wait(key: string, scope: WakeScope, agent: DshLiveAgent, exec: DshToolExec, raw: Record<string, unknown>, team: TeamRecord): Promise<WakeReply> {
    /** Only the latest registration may still create a follow-up. */
    const [previous] = readWakeHistory(scope, 1)
    if (previous !== undefined && pending(view(scope, previous))) {
      throw new Error(`cancel wake ${previous.id} before starting an in-turn wait`)
    }
    /** Shutdown aborts only the pending tool promise, leaving durable watches and goals alone. */
    const controller = new AbortController()
    this.waits.set(key, controller)
    if (this.disposed) controller.abort()
    try {
      return { wait: await awaitCaptainEvent({
        agent, scope, teamId: team.teamId, exec, dispose: controller.signal, dsh: this.deps.dsh, feed: this.deps.feed,
        isCurrent: () => this.deps.dsh.liveAgentExact(agent.id) === agent && sameScope(agent, scope),
        prepare: () => parseCondition(raw, scope, team),
        evaluate: (condition) => {
          /** Re-read the captured team after subscribing and after each matching event. */
          const latest = readTeam(scope.workspace, team.teamId)
          if (latest === undefined || !recordNamesLead(latest, [scope.sessionId])) return { reason: "the original team or its captain binding is unavailable" }
          return evaluate(scope, latest, condition)
        },
        warn: this.deps.warn,
      }) }
    } finally {
      this.waits.delete(key)
    }
  }

  /** Stage one condition and return immediately so the captain can end the turn. */
  private arm(scope: WakeScope, agent: DshLiveAgent, raw: Record<string, unknown>, team: TeamRecord): WakeReply {
    // Schedule cleanup before opening a watch: malformed and unsupported arms may throw while parsing.
    this.queue()
    this.observe(scope.workspace)
    /** Parse the declared predicate against the bound board after subscribing. */
    const input = parseCondition(raw, scope, team)
    if (input.immediate === undefined && (this.listeners.length < 2 || !canSubmitUserTurn(agent)
      || (agent.status !== "idle" && agent.status !== "running") || typeof this.deps.dsh.submitUserTurn !== "function")) {
      throw new Error("captain wake unsupported: the original captain needs observable idle status and next-turn submission")
    }
    /** The newest registration arbitrates a single pending wake for this session. */
    const [previous] = readWakeHistory(scope, 1)
    if (previous !== undefined && previous.immediate === undefined && readWakeDecision(scope, previous) === undefined) {
      /** A team that closed without matching releases its registration before a new arm. */
      const current = view(scope, previous)
      if (pending(current)) {
        if (previous.teamId !== team.teamId || !sameCondition(previous.condition, input.condition)) throw new Error(`cancel wake ${previous.id} before arming a different condition`)
        return { registration: current, next: "End your current turn. This pending wake will submit a follow-up once the condition is met." }
      }
      decideWake(scope, previous, { kind: "failed", reason: current.reason ?? "the prior condition became unavailable" })
    }
    /** Exclusive creation prevents two processes from creating the same successor slot. */
    const record = createWake(scope, (previous?.sequence ?? 0) + 1, { teamId: team.teamId, ...input, armedAt: this.deps.now().toISOString() })
    if (record === undefined) throw new Error("another captain wake was armed concurrently; inspect it with wake status")
    /** A match during arming is visible as ready, and delivery still waits for the idle edge. */
    const registration = view(scope, record)
    return {
      registration,
      next: registration.state === "satisfied" ? "The condition already holds. Continue in this turn." : "End your current turn. The host will be asked to start one follow-up when the condition holds.",
    }
  }

  /** Release observation only, keeping durable registrations available on reopen. */
  dispose(): void {
    this.disposed = true
    for (const waiter of this.waits.values()) waiter.abort()
    if (this.scheduled !== undefined) clearImmediate(this.scheduled)
    for (const off of this.listeners) off()
    for (const off of this.subscriptions.values()) off()
    this.subscriptions.clear()
  }
}
