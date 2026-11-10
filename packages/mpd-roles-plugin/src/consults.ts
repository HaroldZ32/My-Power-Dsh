// THE `mpdConsults` SERVICE — the ONE consult supervisor, exposed as a cordis service.
//
// WHY A SERVICE AND NOT A TOOL. A cell seat (planner, subcaptain, ordinary member) must start several
// background consults in one call and collect them later. Reaching this package's supervisor from the
// cellwork row through a RELATIVE IMPORT would add an edge to the frozen cross-package coupling
// inventory, so the seam is a service: this row PROVIDES it over the SAME `consultSupervisor` instance
// its own tools use (ONE registry, ONE `MPD_DSH_CONSULT_MAX` cap, ONE silence deadman), and a consumer
// resolves it lazily with `ctx.get("mpdConsults", false)`.
//
// THE ONE BEHAVIOURAL DIFFERENCE from the tools, stated where a reviewer reads it: {@link MpConsultsApi.start}
// does NOT apply `consultDepthRefusal`. That floor belongs to the TOOL handlers (`mpd_role_spawn`,
// `mpd_role_spawn_async`), because those forward a depth cap the caller cannot see. This service is
// called by a bounded plane that owns its own nesting cap (`cellwork.depthMax`, which it passes as
// `maxDepth`) and whose seats are ordinary team members at depth 2 or deeper — the exact sessions the
// roster floor refuses. Persona, route, fallback, cap, deadman and the read-only child scope are
// IDENTICAL, because the raise lands on the same internal path.
//
// The service is NOT a tool: nothing registers a name, and no tool output lists it.
import type { DshAsyncAgent } from "../../mpd-dsh-adapter-plugin/src/index"
import type { ConsultOutcome, ConsultSupervisor, ConsultView } from "./spawn-async.ts"

/** What one background consult start carries. */
export interface MpConsultStartSpec {
  /** The roster role exactly as the caller typed it; canonicalised by the roles row before it is recorded. */
  role: string
  /** The assignment / question the child receives. */
  task: string
  /** Optional extra prompt block (the cell id and why the consult exists). */
  context?: string
  /** The CALLER's tool execution context — the same object the roles tools are handed. */
  exec: unknown
  /** Optional ABSOLUTE nesting cap; absent means the row's own `spawnMaxDepthOf` rule applies. */
  maxDepth?: number
}

/** The answer a start returns: the stable id, minted before any child settles. */
export interface MpConsultStarted {
  /** The consult identity, stable for the process lifetime. */
  consultId: string
  /** The CANONICAL roster name the consult runs under. */
  role: string
  /** Always running: the raise itself runs behind the shared cap. */
  state: "running"
  /** When the consult was recorded, epoch milliseconds. */
  startedAt: number
}

/** The service surface a consumer reads; it is never registered as a tool. */
export interface MpConsultsApi {
  /** Start ONE background consult and answer its id immediately (over-cap work queues on the shared cap). */
  start: (spec: MpConsultStartSpec) => Promise<MpConsultStarted>
  /** Every consult this process knows, in creation order. */
  list: () => ConsultView[]
  /** Block up to `timeoutMs` for settlement; a timed-out wait answers the RUNNING view, never a throw. */
  wait: (consultId: string, timeoutMs?: number) => Promise<ConsultView>
  /** Await settlement with NO timeout and release nothing (the blocking batch recon's await). */
  settle: (consultId: string) => Promise<ConsultView>
  /** The settled report, released from the registry; undefined when this process does not know the id. */
  collect: (consultId: string) => ConsultOutcome | undefined
  /** Interrupt one consult's child and settle it interrupted (a caller-initiated stop). */
  cancel: (consultId: string) => ConsultView
}

/** What {@link createMpConsults} needs from the row. */
export interface MpConsultsDeps {
  /** The row's ONE supervisor — never a second registry and never a second cap. */
  supervisor: ConsultSupervisor
  /** Raise one child on the shared activation seam; resolves once the child STARTED. */
  raise: (spec: MpConsultStartSpec) => Promise<DshAsyncAgent>
  /**
   * Canonicalise one role spelling against the live roster surface.
   *
   * @param role - the role exactly as the caller typed it.
   * @param exec - the caller's execution, which resolves extension-contributed roles.
   * @returns the canonical roster name, or null when the spelling names no role.
   */
  canonicalRole: (role: string, exec: unknown) => string | null
}

/**
 * Build the `mpdConsults` service over an existing supervisor.
 *
 * Every method answers from the SUPERVISOR's own state; nothing is cached here, so a `collect` through
 * this service and one through `mpd_role_consult` see the same record.
 *
 * @param deps - the supervisor, the raise seam and the role canonicaliser.
 * @returns the service object `ctx.provide("mpdConsults", …)` publishes.
 */
export function createMpConsults(deps: MpConsultsDeps): MpConsultsApi {
  /**
   * The supervisor's own view of one consult.
   *
   * @param consultId - the consult to read.
   * @returns the view, or undefined once the record was released.
   */
  const viewOf = (consultId: string): ConsultView | undefined =>
    deps.supervisor.list().find((entry) => entry.consultId === consultId)

  /**
   * The view after one await, or a thrown error naming the id.
   *
   * @param consultId - the consult that was awaited.
   * @returns its current view.
   */
  const settledView = (consultId: string): ConsultView => {
    /** The record's own view; a released or unknown id leaves nothing to report. */
    const view = viewOf(consultId)
    if (view === undefined) throw new Error("mpdConsults: unknown consultId " + JSON.stringify(consultId) + " — it was collected, cancelled and collected, or never started")
    return view
  }

  return {
    start: async (spec: MpConsultStartSpec): Promise<MpConsultStarted> => {
      /** The canonical roster name this consult runs under, or null for an unknown spelling. */
      const role = deps.canonicalRole(spec.role, spec.exec)
      if (role === null) throw new Error("mpdConsults: unknown role " + JSON.stringify(spec.role) + " — pass a roster NAME (see mpd_roles_list)")
      /** The task text; an empty one must never start an empty prompt. */
      const task = String(spec.task ?? "").trim()
      if (task === "") throw new Error("mpdConsults: task required")
      // THE SAME `raiseConsultAsync` PATH the tool uses (persona, route, fallback, read-only child scope),
      // with the caller's absolute cap when it declared one. `consultDepthRefusal` is deliberately NOT
      // applied here — see this module's header.
      /** The RUNNING record the shared supervisor publishes at once. */
      const view = deps.supervisor.start({
        role,
        task,
        ...(spec.context === undefined ? {} : { context: String(spec.context) }),
        exec: spec.exec,
        raise: () => deps.raise({ ...spec, role, task }),
      })
      return { consultId: view.consultId, role, state: "running", startedAt: view.startedAt }
    },
    list: (): ConsultView[] => deps.supervisor.list(),
    wait: async (consultId: string, timeoutMs?: number): Promise<ConsultView> => {
      // The supervisor clamps to 1..60 000 ms and answers the RUNNING view when the bound wins, which is
      // exactly the contract's `wait`; the await's own answer is discarded because the VIEW is the shape.
      await deps.supervisor.wait(consultId, timeoutMs ?? 30000)
      return settledView(consultId)
    },
    settle: async (consultId: string): Promise<ConsultView> => {
      try {
        // A consult whose child could not be raised REJECTS its settlement; the record carries `failed`
        // and its failure text, and the view is the honest answer. Nothing is released here.
        await deps.supervisor.settle(consultId)
      } catch {
        // The failure is recorded on the record; `settledView` below reads it.
      }
      return settledView(consultId)
    },
    collect: (consultId: string): ConsultOutcome | undefined => {
      try {
        return deps.supervisor.collect(consultId)
      } catch {
        // An id this process does not know is `undefined`, never a throw across the service seam.
        return undefined
      }
    },
    cancel: (consultId: string): ConsultView => deps.supervisor.cancel(consultId),
  }
}
