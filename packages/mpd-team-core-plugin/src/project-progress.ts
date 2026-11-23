import { helperTarget as progressPath, type DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"
import type { ProjectIdentityService } from "./project-admission"
import { locateProject, ProjectAdmissionError, withProjectLock } from "./project-store"
import { appendTeamJournal } from "./team-journal"
import { blockingDependencies, readTeam, writeTeam, type ProjectTaskProgress, type TeamRecord, type TeamTaskRecord } from "./team-store"

/** The board data and native event seams used for original-owner progress. */
interface ProgressDeps {
  /** Reads are limited to actual caller identities and request capacity. */
  readonly dsh: Pick<DshAdapter, "workspaceRoot" | "onEvent" | "contextPressure" | "userMessage" | "steerAgentTurn">
  /** The canonical binding authenticates the project's fixed member. */
  readonly identity: Pick<ProjectIdentityService, "resolveSeat">
  /** The product's diagnostic sink. */
  readonly warn: (message: string) => void
}

/** The exact bound board and owned active rows on this native Agent. */
interface Owner {
  /** Authorized canonical board workspace. */
  readonly workspace: string
  /** Actual checkout for resolving file targets. */
  readonly checkout: string
  /** Native session, not a display alias or inferred parent. */
  readonly session: string
  /** The live board bound to the exact member. */
  readonly board: TeamRecord
  /** The member's current active work, including rows that are now dependency-blocked. */
  readonly tasks: readonly TeamTaskRecord[]
}

/** One worker declaration still eligible for its original activation. */
interface ActiveProgress {
  /** The only agent object authorized to use this locally armed declaration. */
  readonly agent: object
  /** The row selected by the worker. */
  readonly taskId: string
  /** Exactly one declaration remains current on this revision. */
  readonly progress: ProjectTaskProgress
  /** Every matching tool invocation still awaiting its actual result. */
  readonly calls: Set<string>
  /** A matching invocation prevents an automatic retry, including on a tool failure. */
  attempted: boolean
  /** A matching successful result consumes the pending next operation. */
  fulfilled: boolean
  /** A clean stop can request this specific operation once on the original agent. */
  continued: boolean
}

/** Read a structurally typed host event, without treating model text as an event. */
function objectOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/** Use only the authenticated live session, current project roster, and owned active board rows. */
function ownerOf(deps: ProgressDeps, agent: unknown): Owner | undefined {
  /** The host session id supplies exact executor authority. */
  const session = objectOf(objectOf(agent)?.session)?.id
  if (typeof session !== "string" || session === "") return undefined
  /** Project authority is resolved from actual cwd and exact identity per operation. */
  const identity = deps.identity.resolveSeat({ checkoutRoot: deps.dsh.workspaceRoot({ agent }), sessionId: session })
  if (identity.kind !== "member" || identity.seat !== "member") return undefined
  /** A closed board or a replaced, fenced, or verifier seat cannot continue. */
  const board = readTeam(identity.projectRoot, identity.teamId)
  if (board === undefined || board.approvedAt === undefined || board.phase === "ended" || board.endedAt !== undefined) return undefined
  /** Match both durable member and current activation evidence. */
  const row = board.members.find((member) => member.projectMemberId === identity.memberId && member.executorRef === session)
  if (row === undefined || row.status === "failed" || row.fenced || row.mode === "checkpoint" || row.role?.toLowerCase() === "reviewer") return undefined
  /** Read authoritative assignment state before validating dependencies. */
  const tasks = board.tasks.filter((task) => task.owner === session && (task.status === "claimed" || task.status === "in_progress") && typeof task.attempt === "number" && task.attempt > 0 && (task.kind === "work" || task.kind === "repair" || task.kind === "integration"))
  return { workspace: identity.projectRoot, checkout: identity.checkoutRoot, session, board, tasks }
}

/** Parse an owner's explicit wait or one concrete operation with its authorized target. */
function declarationOf(owner: Owner, task: TeamTaskRecord, raw: unknown): ProjectTaskProgress {
  /** Only a small structured declaration is retained, never the last model message. */
  const content = typeof raw === "string" ? raw.trim() : ""
  /** One command and a single target or wait reason. */
  const match = /^(read|write|edit|collect|wait)\s+([^\r\n]+)$/.exec(content)
  if (content.length > 320 || match === null) throw new ProjectAdmissionError("progress needs read/write/edit <path>, collect <consult-id>, or wait <reason> (up to 320 characters)")
  /** A current active attempt owns its next revision. */
  const stamp = { by: owner.session, attempt: task.attempt ?? 0, revision: task.revision + 1 }
  /** The recognized narrow operation. */
  const operation = match[1]
  if (operation === "wait") return { ...stamp, state: "waiting", reason: match[2] }
  if (blockingDependencies(owner.board.tasks, task.blockedBy).blocking.length !== 0) throw new ProjectAdmissionError("this task is waiting for dependencies")
  if (operation === "collect") {
    if (!/^[a-zA-Z0-9_-]{1,120}$/.test(match[2])) throw new ProjectAdmissionError("progress needs one exact consult id")
    return { ...stamp, state: "ready", operation, target: match[2] }
  }
  /** Limit file operations to explicit targets in the actual worktree. */
  const target = progressPath(owner.checkout, match[2])
  if (target === undefined || (operation !== "read" && !task.writeScopes.some((scope) => {
    /** Directory scopes may declare their contained files with the documented recursive suffix. */
    const base = progressPath(owner.checkout, scope.replace(/\/\*\*$/, ""))
    return base !== undefined && (target === base || (scope.endsWith("/**") || scope.endsWith("/")) && target.startsWith(`${base}/`))
  }))) throw new ProjectAdmissionError("progress target is outside this task's authorized checkout or write scope")
  if (operation !== "read" && operation !== "write" && operation !== "edit") throw new ProjectAdmissionError("unknown progress operation")
  return { ...stamp, state: "ready", operation, target }
}

/** A real successful result must match both the declared tool and its actual target. */
function matchesOperation(progress: Extract<ProjectTaskProgress, { state: "ready" }>, owner: Owner, data: Record<string, unknown>): boolean {
  /** Session records carry the original argument JSON or the structured argument object. */
  let args: Record<string, unknown> | undefined
  try { args = objectOf(typeof data.arguments === "string" ? JSON.parse(data.arguments) : data.arguments) } catch (error) {
    if (error instanceof SyntaxError) return false
    throw error
  }
  if (progress.operation === "collect") return data.name === "cellwork_consult" && args?.action === "collect" && args.consultId === progress.target
  return data.name === progress.operation && typeof args?.file_path === "string" && progressPath(owner.checkout, args.file_path) === progress.target
}

/** Record worker-owned steps and permit only an explicitly armed same-activation continuation. */
export function installProjectProgress(deps: ProgressDeps): { write: (agent: unknown, taskId: unknown, revision: unknown, content: unknown) => ProjectTaskProgress; dispose: () => void } {
  /** Process-local arms cannot carry a restart or rebind into a new activation. */
  const armed = new Map<string, ActiveProgress>()
  /** Suppress a repeat of one unchanged operation on the original activation and task attempt. */
  const spent = new WeakMap<object, Set<string>>()
  /** Clear only the exact operation that succeeded, preserving subsequent owner declarations. */
  const fulfil = (active: ActiveProgress): void => {
    active.fulfilled = true
    /** The original session's board may have advanced during the tool call. */
    const actor = ownerOf(deps, active.agent)
    if (actor === undefined) return
    withProjectLock(locateProject(actor.workspace), () => {
      /** Recheck the authentic task revision before writing a completion for the operation. */
      const owner = ownerOf(deps, active.agent)
      /** Any concurrent progress replaces this reservation. */
      const task = owner?.tasks.find((candidate) => candidate.id === active.taskId && candidate.revision === active.progress.revision)
      if (owner === undefined || task === undefined) return
      /** Remove a completed next operation from the board and increment its revision. */
      const updated = { ...task, revision: task.revision + 1, updatedAt: new Date().toISOString() }
      delete updated.projectProgress
      writeTeam(owner.workspace, { ...owner.board, tasks: owner.board.tasks.map((candidate) => candidate.id === task.id ? updated : candidate) })
    })
  }
  /** The durable journal preserves the distinction between early exit and explicit wait. */
  const log = (owner: Owner, task: TeamTaskRecord, event: "worker-ended-open" | "worker-action-continued", reason: string): void => {
    appendTeamJournal(owner.workspace, { event, teamId: owner.board.teamId, taskId: task.id, member: owner.session, reason, at: new Date().toISOString() })
  }
  /** An exact paired host result invalidates this reservation when the operation already ran. */
  const offSession = deps.dsh.onEvent?.("session/event", (session: unknown, raw: unknown) => {
    /** Only already-armed sessions are inspected. */
    const id = objectOf(session)?.id
    /** The locally armed operation is bound to the original Agent object. */
    const active = typeof id === "string" ? armed.get(id) : undefined
    if (active?.progress.state !== "ready") return
    /** The host writes actual tool call and result events independently. */
    const event = objectOf(raw)
    /** Both events use the payload under data. */
    const data = objectOf(event?.data)
    if (data === undefined) return
    if (event?.type === "tool/call" && typeof data.callId === "string") {
      /** File comparison always uses the original agent's actual checkout. */
      const owner = ownerOf(deps, active.agent)
      if (owner !== undefined && matchesOperation(active.progress, owner, data)) {
        active.calls.add(data.callId)
        active.attempted = true
      }
    } else if (event?.type === "tool/result") {
      /** A failed tool result does not count as advancing its operation. */
      const result = objectOf(data.message)
      if (typeof result?.toolCallId === "string" && active.calls.delete(result.toolCallId) && result.isError === false) {
        try { fulfil(active) } catch (error) { deps.warn(`project progress receipt failed: ${error instanceof Error ? error.message : String(error)}`) }
      }
    }
  })
  /** One stopping boundary may consume one explicit original-owner reservation. */
  const offStop = deps.dsh.onEvent?.("agent/turn-stopping", (raw: unknown) => {
    try {
      /** A cancelled provider/turn must retain its ordinary terminal result. */
      const payload = objectOf(raw)
      /** The native instance is the identity of this continuation, not merely its saved session. */
      const agent = objectOf(payload?.agent)
      if (agent === undefined || (payload?.signal instanceof AbortSignal && payload.signal.aborted)) return
      /** Never infer eligibility from the assistant's final prose. */
      const owner = ownerOf(deps, agent)
      if (owner === undefined) return
      /** Keep the declaration visible to matched tool results after its single continuation. */
      const active = armed.get(owner.session)
      /** A clean stop is attributable only for the selected, independently runnable task. */
      const task = owner.tasks.find((candidate) => active === undefined || candidate.id === active.taskId)
      if (task === undefined || blockingDependencies(owner.board.tasks, task.blockedBy).blocking.length > 0) {
        armed.delete(owner.session)
        return
      }
      /** A declared wait remains a wait even when its activation naturally releases. */
      const current = task.projectProgress
      if (current?.state === "waiting" && current.revision === task.revision) {
        armed.delete(owner.session)
        return
      }
      if (active?.agent !== agent || active.progress.state !== "ready" || active.attempted || active.continued || current?.revision !== task.revision || task.revision !== active.progress.revision) {
        armed.delete(owner.session)
        log(owner, task, "worker-ended-open", active?.fulfilled === true ? "declared operation ran; the task remains open" : active?.attempted === true ? "declared operation was already attempted; the task remains open" : "no current owner-authored next operation; the task remains open")
        return
      }
      /** Do not add a continuation to an unproven or already crowded native request. */
      const pressure = deps.dsh.contextPressure(agent)
      if (pressure.provenance !== "observed" || pressure.windowTokens === null || pressure.usedTokens === null || pressure.windowTokens - pressure.usedTokens <= 73728) {
        armed.delete(owner.session)
        log(owner, task, "worker-ended-open", "the observed request has insufficient remaining headroom for the declared continuation")
        return
      }
      /** The same operation cannot trigger a no-progress loop within this task attempt. */
      const key = JSON.stringify([owner.board.teamId, task.id, task.attempt, active.progress.operation, active.progress.target])
      /** Repeated stop callbacks see this spent entry and cannot enqueue a duplicate. */
      const used = spent.get(agent) ?? new Set<string>()
      if (used.has(key)) {
        armed.delete(owner.session)
        log(owner, task, "worker-ended-open", "the same declared operation already used its continuation")
        return
      }
      used.add(key)
      spent.set(agent, used)
      active.continued = true
      deps.dsh.steerAgentTurn(agent, deps.dsh.userMessage({ text: `Your declared next operation for ${task.id}: ${active.progress.operation} ${active.progress.target}`, source: { kind: "mpd-project-worker", reason: "owner-declared-next-step" } }))
      log(owner, task, "worker-action-continued", `${active.progress.operation} ${active.progress.target} at revision ${task.revision}`)
    } catch (error) {
      deps.warn(`project worker continuation unavailable: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
  /** Drop process-local declarations when the original instance is retired. */
  const offDispose = deps.dsh.onEvent?.("agent/disposed", (raw: unknown) => {
    /** Match the original instance rather than deleting replacement state. */
    const agent = objectOf(raw)?.agent
    for (const [id, active] of armed) if (active.agent === agent) armed.delete(id)
  })
  return {
    write: (agent, taskId, revision, content) => {
      if (typeof agent !== "object" || agent === null || typeof taskId !== "string" || typeof revision !== "number" || !Number.isSafeInteger(revision)) throw new ProjectAdmissionError("progress needs task_id and an exact expected_revision")
      /** Bind the lock to actual authenticated project state. */
      const actor = ownerOf(deps, agent)
      if (actor === undefined) throw new ProjectAdmissionError("progress requires an assigned project worker")
      /** Re-read and publish under the same project lock. */
      const progress = withProjectLock(locateProject(actor.workspace), () => {
        /** A replacement, fence, revision change or new owner invalidates the old plan. */
        const owner = ownerOf(deps, agent)
        /** The named task must belong exclusively to this current attempt. */
        const task = owner?.tasks.find((candidate) => candidate.id === taskId)
        if (owner === undefined || task === undefined || task.revision !== revision) throw new ProjectAdmissionError("progress refused: the task owner or revision changed")
        /** The actual ready operation or explicit wait the worker declared. */
        const next = declarationOf(owner, task, content)
        writeTeam(owner.workspace, { ...owner.board, tasks: owner.board.tasks.map((row) => row.id === task.id ? { ...row, revision: next.revision, updatedAt: new Date().toISOString(), projectProgress: next } : row) })
        return next
      })
      armed.set(actor.session, { agent, taskId, progress, calls: new Set<string>(), attempted: false, fulfilled: false, continued: false })
      return progress
    },
    dispose: () => { offSession?.(); offStop?.(); offDispose?.(); armed.clear() },
  }
}
