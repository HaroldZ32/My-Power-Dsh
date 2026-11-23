import type { DshAdapter, DshAgentPreStep, DshContextPressure } from "../../mpd-dsh-adapter-plugin/src/index"
import type { CallerContext } from "./caller"
import type { CellworkConfig } from "./config"
import { classifyCompactionResult, type ProtocolCtx } from "./protocol-core"
import { appendJournal } from "./state"
import { finishPressureEpoch, reservePressureEpoch, type PressureAssignment, type UsefulHistory } from "./pressure-epochs"
import { recordOf, writerBinding, writerTask, type WorkerTask } from "./worker-pressure-authority"

/** The host budget tested before another model request. */
interface PressureBudget {
  /** Which runtime action this observed budget admits. */
  readonly kind: "below" | "defer" | "hard"
  /** Observed projected token usage. */
  readonly used: number
  /** Observed model context window. */
  readonly window: number
  /** Additional tokens reserved for response and maintenance headroom. */
  readonly reserve: number
}

/** The one maintenance intent a native activation may carry at a time. */
interface MaintenanceIntent {
  /** Exact live board owner and revision when the most recent step was admitted. */
  readonly task: WorkerTask
  /** Same host turn from pre-step through turn/end. */
  readonly turn: number
  /** The most recent observed budget for sizing the idle attempt. */
  readonly budget: PressureBudget
}

/** Per-activation state owned by the natural-idle subscription. */
interface ActivationPressure {
  /** Native handle the agent registry must still resolve by object identity. */
  readonly agent: object
  /** Last open maintenance intent, replaced only by a newer observed eligible step. */
  pending?: MaintenanceIntent
  /** The host's final reason for the pending turn. */
  terminal?: string
  /** Actual native results are candidate evidence for a later independent pressure period. */
  useful?: UsefulHistory
  /** Open file calls whose actual non-error result can prove new useful history. */
  readonly sourceCalls: Set<string>
  /** Active engine call, cancelled when the row or agent is disposed. */
  running?: AbortController
  /** Native scoped event registration. */
  readonly offIdle: () => void
}

/** Dependencies scoped to Cellwork and its existing adapter. */
export interface WorkerPressureDeps {
  /** Read session pressure and run compaction through the authorized host adapter. */
  readonly dsh: DshAdapter
  /** Optional project identity service. */
  readonly ctx: ProtocolCtx
  /** Existing pressure threshold and token reserve configuration. */
  readonly config: CellworkConfig
  /** Read the live caller and execution board, with no write-side adoption. */
  readonly inspect: (agent: unknown) => { caller: CallerContext; board: unknown }
  /** The plugin's file-backed diagnostic sink. */
  readonly warn: (message: string) => void
}

/** Use the observed host window for both comparisons; a configured window grants no exception. */
export function workerPressureBudget(pressure: DshContextPressure, config: Pick<CellworkConfig, "checkpointRatio" | "outputReserveTokens" | "compactionHeadroomTokens">, maxOutput?: number): PressureBudget | undefined {
  /** Units are tokens measured by the harness's current projection. */
  const { usedTokens: used, windowTokens: window, provenance } = pressure
  if (provenance !== "observed" || used === null || window === null || !Number.isFinite(window) || !Number.isFinite(used) || used < 0 || window <= 0) return undefined
  /** Reserve the known maximum response budget, plus the configured safety margin. */
  const reserve = Math.max(config.outputReserveTokens, typeof maxOutput === "number" && Number.isFinite(maxOutput) ? maxOutput : 0) + config.compactionHeadroomTokens
  return { kind: window - used <= reserve ? "hard" : used / window >= config.checkpointRatio ? "defer" : "below", used, window, reserve }
}

/** Retain the original first-epoch reservation for one attempt. */
export function reserveWorkerMaintenance(task: PressureAssignment): boolean {
  return reservePressureEpoch(task) !== undefined
}

/** Keep the writer role through soft pressure and compact only after the original agent naturally idles. */
export function installWorkerPressure(deps: WorkerPressureDeps): { check: (agent: object, payload: DshAgentPreStep, pressure: DshContextPressure) => Promise<PressureBudget | undefined> | undefined; latest: (agent: unknown) => PressureBudget | undefined; dispose: () => void } {
  /** Active subscriptions and exactly one pressure episode per actionable worker. */
  const activations = new Map<object, ActivationPressure>()
  /** Map session events to the original agent's activation state. */
  const sessions = new Map<string, ActivationPressure>()
  /** Cache only the listed model response limit, independently from live context occupancy. */
  const maxima = new Map<string, Promise<number | undefined>>()

  /** Read the mutable board through the same authority check before and after the engine call. */
  const taskFor = (agent: object): WorkerTask | undefined => {
    /** The currently authenticated project binding. */
    const binding = writerBinding(deps, agent)
    return binding === undefined ? undefined : writerTask(binding)
  }

  /** Report maintenance state as board-attributable durable journal evidence. */
  const journal = (intent: MaintenanceIntent, event: string, details: Record<string, unknown> = {}): void => {
    /** All receipts include the action/attempt and its current safety budget. */
    const { workspace, cellId, teamId, memberId, sessionId, taskId, attempt, revision } = intent.task
    appendJournal(workspace, cellId, { event, teamId, memberId, sessionId, taskId, attempt, revision, turn: intent.turn, ...intent.budget, ...details }, new Date())
  }

  /** Run one native engine call under its actual idle reservation. */
  const compact = async (state: ActivationPressure, intent: MaintenanceIntent): Promise<void> => {
    if (state.pending !== intent || state.running !== undefined) return
    /** The same handle must still be live and idle when the event is consumed. */
    const surface = recordOf(state.agent)
    if (surface?.status !== "idle" || typeof surface.id !== "string" || deps.dsh.liveAgentExact(surface.id) !== state.agent) return
    if (state.terminal !== "completed" && !(state.terminal === "blocked" && intent.budget.kind === "hard")) return
    if (taskFor(state.agent)?.key !== intent.task.key) return
    /** Check current native occupancy before reserving work at the actual idle boundary. */
    const before = workerPressureBudget(deps.dsh.contextPressure(state.agent), deps.config, intent.budget.reserve - deps.config.compactionHeadroomTokens)
    if (before === undefined || before.kind === "below") return
    /** Reserve exactly the earlier verified pressure epoch, including across cold resume. */
    const marker = reservePressureEpoch(intent.task, { used: before.used, window: before.window, useful: state.useful })
    if (marker === undefined) return
    /** The user's cancellation and disposal must interrupt maintenance owned by this row. */
    const control = new AbortController()
    state.running = control
    /** Preserve the native session boundary corresponding to this engine input. */
    const sequence = (): unknown => recordOf(recordOf(state.agent)?.session)?.seq
    /** A refusal spends the same amount of history as a successful engine pass. */
    const startSeq = sequence()
    try {
      /** Only the engine serving this exact original native instance is eligible. */
      const engine = recordOf(deps.dsh.compactionEngineForLiveAgent(state.agent))
      if (typeof engine?.compactNow !== "function") {
        if (typeof startSeq === "number") finishPressureEpoch(marker, { seq: startSeq, used: before.used, window: before.window })
        journal(intent, "project-pressure-maintenance", { outcome: "unavailable", terminal: state.terminal })
        return
      }
      journal(intent, "project-pressure-maintenance-start", { terminal: state.terminal, beforeUsed: before.used, ...(state.useful === undefined ? {} : { usefulSeq: state.useful.seq, usefulBytes: state.useful.bytes }) })
      /** Invoke with the owning receiver and let the host enforce its own idle/compaction limits. */
      const result: unknown = await engine.compactNow(state.agent, control.signal)
      /** Observe proof of the result before claiming any effect for the original assignment. */
      const after = deps.dsh.contextPressure(state.agent)
      /** A readout is advisory; the next step rechecks the current native budget independently. */
      const currentBudget = workerPressureBudget(after, deps.config, intent.budget.reserve - deps.config.compactionHeadroomTokens)
      /** Host sequence at durable completion, after the actual engine checkpoint events. */
      const endSeq = sequence()
      if (typeof endSeq === "number" && currentBudget !== undefined) finishPressureEpoch(marker, { seq: endSeq, used: currentBudget.used, window: currentBudget.window })
      journal(intent, "project-pressure-maintenance", { outcome: classifyCompactionResult(result), terminal: state.terminal, beforeUsed: before.used, afterUsed: after.usedTokens, afterWindow: after.windowTokens, afterAdmission: currentBudget?.kind ?? "unproven", compactionId: recordOf(result)?.compactionId, assignmentCurrent: taskFor(state.agent)?.key === intent.task.key })
    } catch (error) {
      if (typeof startSeq === "number") finishPressureEpoch(marker, { seq: startSeq, used: before.used, window: before.window })
      journal(intent, "project-pressure-maintenance", { outcome: "refused", terminal: state.terminal, afterAdmission: before.kind, assignmentCurrent: taskFor(state.agent)?.key === intent.task.key, reason: error instanceof Error ? error.message : String(error) })
    } finally {
      state.running = undefined
    }
  }

  /** Capture the original turn outcome; provider errors and aborts accrue no continuation. */
  const offSession = deps.dsh.onEvent("session/event", (subject: unknown, event: unknown) => {
    /** Parse only matching terminal events on the established session. */
    const body = recordOf(event)
    /** Native session id, never inferred from an agent display name. */
    const id = recordOf(subject)?.id
    /** A legitimate turn/end precedes the natural idle event on the native driver. */
    const state = typeof id === "string" ? sessions.get(id) : undefined
    /** Host event body and terminal reason. */
    const data = recordOf(body?.data)
    if (state === undefined || data === undefined) return
    if (body?.type === "tool/call" && typeof data.callId === "string" && (data.name === "read" || data.name === "write" || data.name === "edit")) {
      if (state.pending !== undefined && taskFor(state.agent)?.attemptKey === state.pending.task.attemptKey) state.sourceCalls.add(data.callId)
    } else if (body?.type === "tool/result") {
      /** Only a paired successful file operation can prove growth after a prior maintenance. */
      const message = recordOf(data.message)
      if (typeof message?.toolCallId === "string" && state.sourceCalls.delete(message.toolCallId) && message.isError === false && typeof body.seq === "number") {
        /** Preserve only an actual sizeable result; ordinary bookkeeping cannot reopen an epoch. */
        const bytes = Buffer.byteLength(JSON.stringify(message.content ?? []))
        if (bytes >= 2048) state.useful = { seq: body.seq, bytes }
      }
    } else if (body?.type === "turn/end" && state.pending !== undefined && data.turn === state.pending.turn) {
      /** Unknown reason stays closed to maintenance. */
      const kind = recordOf(data.reason)?.kind
      state.terminal = typeof kind === "string" ? kind : undefined
    }
  })

  /** Release the exact scoped subscription on activation disposal or plugin unload. */
  const remove = (agent: object): void => {
    /** The entry may already have been torn down by the native scope. */
    const state = activations.get(agent)
    if (state === undefined) return
    state.running?.abort()
    state.offIdle()
    activations.delete(agent)
    for (const [id, active] of sessions) if (active === state) sessions.delete(id)
  }
  /** Observe host teardown without ever recreating a detached Agent. */
  const offDispose = deps.dsh.onEvent("agent/disposed", (payload: unknown) => {
    /** The event fuses its own agent when supported. */
    const agent = recordOf(payload)?.agent
    if (typeof agent === "object" && agent !== null) remove(agent)
  })

  return {
    check: (agent, payload, pressure) => {
      /** A legacy or explicitly closed seat retains its synchronous checkpoint path. */
      if (typeof payload.turn !== "number" || payload.signal?.aborted || pressure.provenance !== "observed") return undefined
      /** Authenticate exactly the current caller before resolving model metadata. */
      const binding = writerBinding(deps, agent)
      if (binding === undefined) return undefined
      /** Keep the verified turn number through the asynchronous route lookup. */
      const turn = payload.turn
      /** Model route sampled from this agent's current proposed step. */
      const route = recordOf(payload.modelSelection)
      /** Model catalog row is identified by the exact active route, not a role default. */
      const routeKey = `${route?.provider ?? ""}/${route?.model ?? ""}`
      if (!maxima.has(routeKey)) maxima.set(routeKey, Promise.resolve().then(async () => (await deps.dsh.llmCatalog()).providers.find((provider) => provider.id === route?.provider)?.models.find((model) => model.id === route?.model)?.maxOutputTokens ?? undefined).catch(() => undefined))
      return Promise.resolve(maxima.get(routeKey)).then((maximum) => {
        if (payload.signal?.aborted) return undefined
        /** Re-authenticate after the model catalog read before arming an idle intent. */
        const current = writerBinding(deps, agent)
        if (current?.memberId !== binding.memberId || current.teamId !== binding.teamId) return undefined
        /** The mounted host's current reading determines whether ordinary execution is safe. */
        const budget = workerPressureBudget(deps.dsh.contextPressure(agent), deps.config, maximum)
        if (budget === undefined) return undefined
        /** Reuse one observer per exact native activation. */
        let state = activations.get(agent)
        /** A terminal, waiting or dependency-blocked board grants no maintenance intent. */
        const task = writerTask(current)
        if (budget.kind === "below" || task === undefined) {
          if (state !== undefined) state.pending = undefined
          return budget
        }
        if (state === undefined) {
          /** Register on the agent scope because this status event belongs to that Agent. */
          const scope = deps.dsh.agentScope(agent)
          if (scope === undefined) return budget.kind === "hard" ? budget : undefined
          /** The event arrives only after the native turn driver has actually become idle. */
          const offIdle = scope.on("agent/status", (value: unknown) => {
            /** Take an immutable intent before yielding so the CAS can reject a concurrent change. */
            const active = activations.get(agent)
            /** Ignore duplicate or unrelated idle events. */
            const intent = active?.pending
            if (recordOf(value)?.status !== "idle" || active === undefined || intent === undefined) return
            // Take the native idle reservation before the host's settlement watcher can release the Agent.
            void compact(active, intent).catch((error: unknown) => deps.warn(`[mpd-cellwork] pressure maintenance: ${String(error)}`))
          })
          state = { agent, offIdle, sourceCalls: new Set<string>() }
          activations.set(agent, state)
          sessions.set(task.sessionId, state)
        }
        /** Log one initial deferral per turn; a later hard transition gets its own receipt. */
        const previous = state.pending
        /** Capture the latest safe revision and observed actual capacity for natural idle. */
        const intent = { task, turn, budget }
        state.pending = intent
        state.terminal = undefined
        if (previous?.turn !== intent.turn || previous.budget.kind !== budget.kind) {
          if (budget.kind === "hard") journal(intent, "project-pressure-hard-limit", { remaining: budget.window - budget.used, nextAction: "Resume only after observed headroom exceeds the reserved output and maintenance budget." })
          else journal(intent, "project-pressure-deferred")
        }
        return budget
      })
    },
    latest: (agent) => typeof agent === "object" && agent !== null ? activations.get(agent)?.pending?.budget : undefined,
    dispose: () => { offSession?.(); offDispose?.(); for (const agent of activations.keys()) remove(agent) },
  }
}
