// THE DEPENDENCY GUARD: the write-time and approval-time half of R1–R3 and R11
// (`.mpd/plans/task-dependency-guard.md`).
//
// WHY THIS FILE EXISTS. `blocked_by` was OPTIONAL, its aliases were read inconsistently, a non-array
// value was dropped in silence, and `create_task`/`approve` refused neither a self-edge nor a cycle —
// only `depend` did. The measured consequences are in `evidence/repro-missing-blocked-by/`: a task
// whose blocker was still pending could be CLAIMED (while dispatch refused the same pairing), and a
// requirement/work/review triple with no declared edges was approved and paired flat in one pass.
//
// The module is PURE — plain data in, a verdict out — so the three refusals can be pinned without a
// filesystem, and so `create_task`, `approve` and `claim` reason over the SAME graph. Approval maps a
// staged plan onto board ids `T1…Tn` in plan order (see the approve arm's `planAlias`), which is why a
// plan's own 1-based POSITION and the id it will mint are the same string here.
import type { StagedPlan } from "./plan-store.ts"

/**
 * One task as the guard sees it: the id it carries (or will carry), its subject, and what it declares
 * as blockers, exactly as written — unresolved references included, so the caller keeps and reports them.
 */
export interface GuardedTask {
  /** The board id the task has, or the id approval will mint for it (`T<n>` in plan order). */
  id: string
  /** The subject, which is the second reference form a blocker may use. */
  subject: string
  /** The declared blockers, exactly as written. */
  blockedBy: readonly string[]
}

/** The board id approval mints for the staged task at a 0-based plan position. */
export function planTaskId(index: number): string {
  return "T" + String(index + 1)
}

/**
 * A write scope with R2's normalisation: a trailing `/**` and any trailing slashes name the subtree
 * whose path is the scope itself, so `packages/x/**`, `packages/x/` and `packages/x` are one scope.
 *
 * A non-empty declaration that normalises to nothing (`/`, `/**`) names the workspace ROOT, so it takes
 * the universal meaning `.` already carries. An EMPTY declaration still names no path at all: callers
 * rely on that when they mean "no scope", and inventing a whole-workspace collision would refuse a
 * legitimate plan.
 * @param scope - one declared scope, as written.
 * @returns the normalised scope.
 */
export function normalizeScope(scope: string): string {
  /** The scope with a trailing `/**` and then every trailing slash removed. */
  const normalized = scope.replace(/\/\*\*$/u, "").replace(/\/+$/u, "")
  return normalized === "" && scope !== "" ? "." : normalized
}

/**
 * Whether one normalised scope covers every path: `**` and `.` both do (R2).
 * @param normalized - a scope already passed through {@link normalizeScope}.
 * @returns true when the scope covers the whole workspace.
 */
export function scopeCoversEverything(normalized: string): boolean {
  return normalized === "**" || normalized === "."
}

/**
 * Whether two declared write scopes overlap, in the frozen definition (R2).
 *
 * Overlap = strip a trailing `/**` and any trailing slashes, then equal, or one is a path prefix of the
 * other at a SEGMENT boundary (so `packages/x` covers `packages/x/y` but never `packages/xy`); `**` and
 * `.` cover everything. An empty entry names no path and therefore overlaps nothing — a caller that
 * wrote `""` declared no scope, and inventing a whole-workspace collision for it would refuse a
 * legitimate plan.
 * @param first - one declared scope.
 * @param second - the other declared scope.
 * @returns true when the two scopes could touch the same files.
 */
export function scopesOverlap(first: string, second: string): boolean {
  /** The first scope, normalised. */
  const a = normalizeScope(first)
  /** The second scope, normalised. */
  const b = normalizeScope(second)
  if (a === "" || b === "") return false
  if (scopeCoversEverything(a) || scopeCoversEverything(b)) return true
  if (a === b) return true
  return a.startsWith(b + "/") || b.startsWith(a + "/")
}

/**
 * Resolve one plan reference to the board id approval will mint for it, or undefined when this plan
 * can resolve nothing.
 *
 * The three forms are the ones approval itself resolves (`planAlias`): the plan's 1-based position
 * (`"2"`), the id that position mints (`"T2"`), and a staged task's SUBJECT — first occurrence wins,
 * exactly as approval's own map does. A reference this plan cannot resolve draws no edge (approval
 * keeps the text and reports it as `unresolved`), so it is ignored here rather than guessed at.
 * @param plan - the plan the reference was written against.
 * @param reference - one declared blocker, as written.
 * @returns the minted id, or undefined when nothing in this plan answers the text.
 */
export function planReferenceTarget(plan: StagedPlan, reference: string): string | undefined {
  /** The number a position-or-id reference names, when it names one. */
  const numbered = /^T(\d+)$/u.exec(reference) ?? /^(\d+)$/u.exec(reference)
  if (numbered !== null) {
    /** The 1-based position the reference names. */
    const position = Number(numbered[1])
    return position >= 1 && position <= plan.tasks.length ? planTaskId(position - 1) : undefined
  }
  /** The index of the first staged task carrying that subject, which is what approval maps. */
  const index = plan.tasks.findIndex((task) => task.subject === reference)
  return index < 0 ? undefined : planTaskId(index)
}

/**
 * The plan's dependency edges as approval will build them: task id → the ids of its blockers.
 *
 * Only references this plan actually resolves become edges. A forward reference (a task naming a
 * position staged later) DOES resolve here, because the plan as it now stands carries that task — which
 * is precisely the case that can close a cycle.
 * @param plan - the plan to read.
 * @returns one entry per staged task, in plan order.
 */
export function planDependencyEdges(plan: StagedPlan): Map<string, string[]> {
  return new Map(plan.tasks.map((task, index) => [
    planTaskId(index),
    (task.blockedBy ?? []).map((reference) => planReferenceTarget(plan, reference)).filter((id): id is string => id !== undefined),
  ]))
}

/**
 * A live board's dependency edges: task id → the blocker ids that name a task on that board.
 *
 * A dangling reference draws no edge on the record either (`blockingDependencies` treats it as an
 * unknown, still-blocking id), so it must not be invented as a graph edge here.
 * @param tasks - the board, including the task just appended.
 * @returns one entry per task, in board order.
 */
export function boardDependencyEdges(tasks: readonly GuardedTask[]): Map<string, string[]> {
  /** The ids this board answers. */
  const ids = new Set(tasks.map((task) => task.id))
  return new Map(tasks.map((task) => [task.id, task.blockedBy.filter((reference) => ids.has(reference))]))
}

/**
 * The first dependency cycle in an edge map, as the walk found it, or undefined when the graph is a DAG.
 *
 * A cycle is refused because every task on it waits for itself: `readyTasks` never releases it, so it
 * can never be claimed or dispatched, and neither `claim` nor `depend` can remove an edge afterwards.
 * The returned path repeats its first id at the end (`["T1","T2","T1"]`), so a refusal can print it.
 * @param edges - the resolved edges, task id → blocker ids.
 * @returns the cycle path, or undefined when there is none.
 */
export function dependencyCycle(edges: ReadonlyMap<string, readonly string[]>): string[] | undefined {
  /** Ids whose whole subtree was already proven acyclic, so the walk is linear. */
  const done = new Set<string>()
  /** The current DFS path, in visit order. */
  const path: string[] = []
  /** Membership of `path`, so a back edge is recognised in constant time. */
  const onPath = new Set<string>()
  /**
   * Walk one id's blockers, recording the first back edge found.
   * @param id - the id to visit.
   * @returns the cycle path, or undefined when this subtree is acyclic.
   */
  const visit = (id: string): string[] | undefined => {
    if (onPath.has(id)) {
      /** The cycle path, from the first occurrence of the revisited id. */
      const at = path.indexOf(id)
      return [...path.slice(at), id]
    }
    if (done.has(id)) return undefined
    path.push(id)
    onPath.add(id)
    for (const blocker of edges.get(id) ?? []) {
      /** The cycle this blocker leads into, when it leads into one. */
      const cycle = visit(blocker)
      if (cycle !== undefined) return cycle
    }
    path.pop()
    onPath.delete(id)
    done.add(id)
    return undefined
  }
  for (const id of edges.keys()) {
    /** The cycle this root reaches, when it reaches one. */
    const cycle = visit(id)
    if (cycle !== undefined) return cycle
  }
  return undefined
}

/**
 * Whether one task depends, directly or transitively, on another.
 * @param edges - the resolved edges, task id → blocker ids.
 * @param from - the task whose blocker chain is walked.
 * @param to - the task the chain must reach.
 * @returns true when `from`'s chain reaches `to`.
 */
export function dependencyPath(edges: ReadonlyMap<string, readonly string[]>, from: string, to: string): boolean {
  /** The ids still to expand. */
  const queue: string[] = [from]
  /** The ids already expanded, so a malformed cycle cannot hang the walk. */
  const seen = new Set<string>()
  while (queue.length > 0) {
    /** The next id to expand. */
    const id = queue.pop() as string
    if (id === to) return true
    if (seen.has(id)) continue
    seen.add(id)
    for (const blocker of edges.get(id) ?? []) queue.push(blocker)
  }
  return false
}

/** Which whole-graph defect approval must refuse in a staged plan's dependency graph (R11). */
export type PlanGraphDefect =
  /** A staged task states NO dependency answer at all: `blockedBy` is absent (the bulk-`edit` hole). */
  | { kind: "unanswered"; id: string; subject: string }
  /** A task's own id appears among its resolved blockers, so it waits for itself. */
  | { kind: "self-edge"; id: string }
  /** The first cycle the walk found, as a path that repeats its first id (`["T1","T2","T1"]`). */
  | { kind: "cycle"; path: string[] }

/**
 * The FIRST whole-graph defect a staged plan carries (R11), or undefined when it is complete and acyclic.
 *
 * `create_task` reads the dependency answer at write time, but `edit` BULK-REPLACES the task list and
 * accepts a task carrying no `blockedBy` at all — so a graph the write-time rule would never have built
 * can reach approval. Approval is the one place every staging path meets, so it re-validates the WHOLE
 * plan here, in this order: a task with no answer first (its graph cannot even be read), then a
 * self-edge, then a cycle. A legitimately staged plan always satisfies all three, which is why this
 * refuses nothing R5 allows: `blockedBy: []` is a complete answer and an acyclic graph is the norm.
 * @param plan - the plan about to be approved, exactly as it now stands.
 * @returns the first defect in plan order, or undefined when every task answers and the graph is a DAG.
 */
export function planGraphDefect(plan: StagedPlan): PlanGraphDefect | undefined {
  /** The position of the first staged task carrying no `blockedBy` array, which is no answer at all. */
  const unanswered = plan.tasks.findIndex((task) => !Array.isArray(task.blockedBy))
  if (unanswered >= 0) {
    /** That task, so the refusal can name it by subject as well as by id. */
    const task = plan.tasks[unanswered]
    return { kind: "unanswered", id: planTaskId(unanswered), subject: task.subject }
  }
  /** The plan's resolved edges, which is the graph approval would write onto the board. */
  const edges = planDependencyEdges(plan)
  for (const [id, blockers] of edges) {
    /** Whether this task's own id came back as one of its blockers, however the reference was spelled. */
    if (blockers.includes(id)) return { kind: "self-edge", id }
  }
  /** The first cycle the graph carries, if any. */
  const cycle = dependencyCycle(edges)
  return cycle === undefined ? undefined : { kind: "cycle", path: cycle }
}

/** One unordered pair of staged tasks whose declared write scopes collide (R2's refusal subject). */
export interface ScopeClash {
  /** The first task, in plan order: the id approval will mint, its subject and the colliding scope. */
  first: { id: string; subject: string; scope: string }
  /** The later task of the pair, with the scope that collides with {@link first}. */
  second: { id: string; subject: string; scope: string }
}

/**
 * Every pair of staged tasks whose write scopes overlap while NEITHER depends on the other.
 *
 * This is R2's decision, computed once: a pair is a clash only when at least one scope of each task
 * overlaps (an empty list never overlaps) and no dependency path exists in either direction — an edge
 * in either direction orders the two tasks, so only an unordered pair can write the same files at once.
 * @param plan - the plan about to be approved.
 * @returns the clashes, in plan order; empty means the plan's scopes are ordered or disjoint.
 */
export function scopeClashes(plan: StagedPlan): ScopeClash[] {
  /** The plan's edges, which decide whether a pair is ordered. */
  const edges = planDependencyEdges(plan)
  /** The clashes found, in plan order. */
  const clashes: ScopeClash[] = []
  for (let first = 0; first < plan.tasks.length; first += 1) {
    for (let second = first + 1; second < plan.tasks.length; second += 1) {
      /** The earlier task's declared scopes. */
      const firstScopes = plan.tasks[first].writeScopes ?? []
      /** The later task's declared scopes. */
      const secondScopes = plan.tasks[second].writeScopes ?? []
      if (firstScopes.length === 0 || secondScopes.length === 0) continue
      /** The ids approval will mint for the pair. */
      const firstId = planTaskId(first)
      /** The later id. */
      const secondId = planTaskId(second)
      if (dependencyPath(edges, firstId, secondId) || dependencyPath(edges, secondId, firstId)) continue
      for (const scope of firstScopes) {
        /** The later scope this one collides with, when one does. */
        const collidesWith = secondScopes.find((candidate) => scopesOverlap(scope, candidate))
        if (collidesWith === undefined) continue
        clashes.push({
          first: { id: firstId, subject: plan.tasks[first].subject, scope },
          second: { id: secondId, subject: plan.tasks[second].subject, scope: collidesWith },
        })
        break
      }
    }
  }
  return clashes
}
