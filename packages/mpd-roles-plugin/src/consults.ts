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
// called by a BOUNDED plane (cellwork) whose seats are team members — the sessions the roster floor can
// refuse — and whose child is a LEAF. The CHILD's agent depth is therefore left to this row's OWN
// `spawnMaxDepthOf(exec.agent)` rule (caller depth + 1); a caller MAY still pass `maxDepth`, but the
// cell plane no longer does: its `cellwork.depthMax` counts nested CELLS, a different scale, and
// forwarding it as the child's ABSOLUTE agent depth disabled every consult at the legal value 1.
// Persona, route, fallback, cap, deadman and the read-only child scope are IDENTICAL, because the raise
// lands on the same internal path.
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
  /**
   * Optional ABSOLUTE agent-nesting cap; absent means the row's own `spawnMaxDepthOf` rule applies
   * (caller depth + 1, a leaf). A caller SHOULD omit it: a plane's own nesting cap (e.g.
   * `cellwork.depthMax`, which counts CELLS) is a different scale from agent delegation depth.
   */
  maxDepth?: number
  /**
   * Optional SETTLEMENT OBSERVER, fired once when the consult leaves `running`.
   *
   * ADDITIVE AND INERT WHEN ABSENT (contract §5.2): no callback means today's behaviour, so every
   * existing caller is unaffected. A caller that keeps a durable record of its consults passes one so
   * the record reaches its terminal state WITHOUT a seat having to call `wait`/`collect` — a picture
   * that only moves when somebody looks would report a finished consult as still running.
   */
  onSettled?: (outcome: ConsultOutcome) => void
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
  /**
   * Canonicalise one role spelling through the SAME resolver `mpd_role_spawn` uses.
   *
   * A consumer that validates its own role strings MUST call this instead of re-implementing the
   * normalisation: the roster's rule strips every non-alphanumeric character (`DeepWorker` answers to
   * `Deep Worker`) and also admits an extension role's namespaced id, so a second local pass disagrees
   * with the tools exactly where it matters most.
   *
   * @param role - the role exactly as the caller typed it.
   * @param exec - the caller's execution context, which resolves extension-contributed roles against
   *   THAT call's workspace. Omitting it does not restrict the answer to the base roster: the extension
   *   plane then resolves from the adapter's own fallback root (`DSH_WORKSPACE_ROOT`, then
   *   `process.cwd()`), so a project-plane extension living there still contributes roles.
   * @returns the canonical roster name, or undefined when the spelling names no role on that surface.
   */
  canonicalRole: (role: string, exec?: unknown) => string | undefined
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
    canonicalRole: (role: string, exec?: unknown): string | undefined => {
      /** The resolver's answer: the canonical name, or null for a spelling that names nothing. */
      const canonical = deps.canonicalRole(String(role ?? ""), exec)
      return canonical === null ? undefined : canonical
    },
    start: async (spec: MpConsultStartSpec): Promise<MpConsultStarted> => {
      /** The canonical roster name this consult runs under, or null for an unknown spelling. */
      const role = deps.canonicalRole(spec.role, spec.exec)
      if (role === null) throw new Error("mpdConsults: unknown role " + JSON.stringify(spec.role) + " — pass a roster NAME (see mpd_roles_list)")
      /** The task text; an empty one must never start an empty prompt. */
      const task = String(spec.task ?? "").trim()
      if (task === "") throw new Error("mpdConsults: task required")
      // THE EXEMPTION IS PROCESS-WIDE. No call through this service applies `consultDepthRefusal`, so any
      // consumer mounted alongside this row inherits it. ONE consumer exists today: cellwork, whose plane
      // is bounded by `cellwork.depthMax` (the nested-CELL cap) and whose child is a leaf. A SECOND
      // consumer must justify the bypass before it relies on it. The child's agent depth is this row's own
      // `spawnMaxDepthOf(exec.agent)` (caller depth + 1) unless the caller passed an ABSOLUTE `maxDepth`.
      // THE SAME `raiseConsultAsync` PATH the tool uses (persona, route, fallback, read-only child scope).
      /** The RUNNING record the shared supervisor publishes at once. */
      const view = deps.supervisor.start({
        role,
        task,
        ...(spec.context === undefined ? {} : { context: String(spec.context) }),
        exec: spec.exec,
        raise: () => deps.raise({ ...spec, role, task }),
        // FORWARDED VERBATIM: the supervisor owns the ONE settlement path, so it is the only place the
        // observer can be fired exactly once. Absent stays absent (no empty call, no wrapper).
        ...(spec.onSettled === undefined ? {} : { onSettled: spec.onSettled }),
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
