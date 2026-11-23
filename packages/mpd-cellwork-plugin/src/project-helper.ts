import { helperTarget, type DshAdapter, type DshHelperFiles } from "../../mpd-dsh-adapter-plugin/src/index"
import type { CallerContext } from "./caller"
import type { ProtocolCtx } from "./protocol-core"
import { recordOf, writerBinding, writerTask } from "./worker-pressure-authority"

/** The authenticated assignment passed to the existing consult supervisor and receiver. */
interface HelperAssignment {
  /** Stable project/task/attempt identity, independently checked on collection. */
  readonly owner: string
  /** Board owning the consult row even while Cellwork has an older cached board id. */
  readonly teamId: string
  /** Validate one whole batch member before the supervisor starts anything. */
  readonly helperFiles: (input: unknown) => DshHelperFiles
}

/** Resolve exact literal filenames, rejecting escapes before a helper can be scheduled. */
function scopedPaths(checkout: string, value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 12) throw new Error("helper scope needs up to 12 literal paths per mode")
  return [...new Set(value.map((path: unknown) => {
    /** Match the exact source target in this worker's checkout. */
    const target = typeof path === "string" && path.length <= 180 ? helperTarget(checkout, path) : undefined
    if (target === undefined) throw new Error("helper path is outside the assigned checkout")
    return target
  }))]
}

/** Legacy Cellwork keeps its consult verbs; fixed project workers use their current assignment. */
export function helperAssignment(deps: { ctx: ProtocolCtx; dsh: DshAdapter; inspect: (agent: unknown) => { caller: CallerContext; board: unknown } }, agent: unknown, caller: CallerContext): HelperAssignment | undefined {
  if (caller.seat?.mode !== "member" || typeof agent !== "object" || agent === null) return undefined
  /** A host composition without a project registry retains legacy Cellwork operation. */
  const service = recordOf(deps.ctx.get?.("mpdProjectIdentity", false))
  if (typeof service?.resolveSeat !== "function") return undefined
  /** Match the actual writer checkout, rather than the canonical data-plane root. */
  const checkoutRoot = deps.dsh.workspaceRoot({ agent })
  /** An unbound legacy cell is not granted another project's authority. */
  const identity = recordOf(service.resolveSeat({ checkoutRoot, sessionId: caller.sessionId }))
  if (identity?.kind === "unbound") return undefined
  /** Only an exact project owner may start or collect in-scope helper work. */
  const binding = writerBinding(deps, agent)
  /** Match a single ready attempt before reading any authored scope. */
  const active = binding === undefined ? undefined : writerTask(binding)
  if (active === undefined || binding === undefined || typeof identity?.checkoutRoot !== "string") throw new Error("a scoped helper requires this original worker's current writable assignment")
  /** Native team worktrees can be restored by the worker runtime separately from its saved session cwd. */
  const worktrees = recordOf(deps.ctx.get?.("mpdWorktree", false))
  /** This is the actual original assignment's registered checkout, when the worktree provider has it. */
  const assigned = typeof worktrees?.cwdForMember === "function" ? worktrees.cwdForMember({ agent }, { teamId: active.teamId, member: caller.member }) : undefined
  /** Confirm the worktree still belongs to the same authenticated project seat before using it. */
  const assignedIdentity = typeof assigned === "string" && identity.checkoutRoot === identity.projectRoot ? recordOf(service.resolveSeat({ checkoutRoot: assigned, sessionId: caller.sessionId })) : undefined
  /** Preserve a caller in an explicitly approved development copy. */
  const checkout = assignedIdentity !== undefined && assignedIdentity.projectId === identity.projectId && assignedIdentity.memberId === identity.memberId && typeof assignedIdentity.checkoutRoot === "string" ? assignedIdentity.checkoutRoot : identity.checkoutRoot
  /** Writable files must narrow an existing task's frozen write scope. */
  const scopes = binding.tasks.find((task) => task.id === active.taskId)?.writeScopes
  return {
    owner: active.attemptKey,
    teamId: active.teamId,
    helperFiles: (raw) => {
      /** Removing the input altogether gives the helper no file tools. */
      const scope = raw === undefined ? {} : recordOf(raw)
      if (scope === undefined || Object.keys(scope).some((key) => key !== "read" && key !== "write")) throw new Error("helper scope is {read?: paths, write?: paths}")
      /** Both file lists are independently fenced to the actual checkout. */
      const read = scopedPaths(checkout, scope.read)
      /** An optional write list can contain only this assignment's authorized parts. */
      const write = scopedPaths(checkout, scope.write)
      if (write.some((target) => !Array.isArray(scopes) || !scopes.some((value: unknown) => {
        if (typeof value !== "string") return false
        /** The board's recursive suffix is the only wildcard used for helper delegation. */
        const parent = helperTarget(checkout, value.replace(/\/\*\*$/, ""))
        return parent !== undefined && (target === parent || (value.endsWith("/**") || value.endsWith("/")) && target.startsWith(`${parent}/`))
      }))) throw new Error("helper write path exceeds this assignment's scope")
      return { checkout, read, write, current: () => {
        /** Reassigning or closing the parent attempt removes its helper's original authority. */
        const fresh = writerBinding(deps, agent)
        return fresh !== undefined && writerTask(fresh)?.attemptKey === active.attemptKey
      } }
    },
  }
}
