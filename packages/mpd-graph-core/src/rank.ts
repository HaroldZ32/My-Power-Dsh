// THE RANK DERIVATION, MOVED VERBATIM out of `packages/mpd-tui-plugin/src/graph.ts` (wave
// `living-graph`, lane A). Nothing in the algorithm or its comments was rewritten: the iterative,
// cycle-safe walk that keeps every rank finite, the "derived vs served depth" fallback and the
// unresolved-reference report are load-bearing and already tested, and a reader who needs the full
// defect narrative behind them (R17's measured flat board, R18's silent reference filter, OPT-1's
// failed-dependency rule) finds it in that file's header, cited here because this is now the only
// place the code lives.
//
// WHY IT MOVED. It was PRIVATE in the TUI module while the web plane derived the same thing again
// inside a factory body. Two implementations of one derivation meant a fix could not reach the other
// plane and a test could pin only its own copy; this module is the single source both planes import.

import type { GraphTask, RankPlan, RankTask } from "./types.ts"

/**
 * The rank of every task, DERIVED: the longest chain of blockers that RESOLVE beneath it.
 *
 * This is the algorithm the drawing should have used all along (R17). It walks iteratively — an
 * explicit stack, never a recursion — so a malformed board cannot exhaust the call stack, and it
 * breaks a cycle by counting the blocker that closes it as contributing NOTHING, which keeps every
 * rank finite while `cycleIds` still reports the cycle itself.
 * @param tasks - the board, in board order (the walk's determinism rests on it).
 * @param byId - task lookup by id.
 * @returns the derived rank of every task; a task whose blockers do not resolve is a root.
 */
export function deriveRanks<T extends RankTask>(tasks: readonly T[], byId: ReadonlyMap<string, RankTask>): Map<string, number> {
  /** The settled rank of every task. */
  const settled = new Map<string, number>()
  /** The tasks on the current walk, whose ranks are not settled yet. */
  const walking = new Set<string>()
  for (const root of tasks) {
    if (settled.has(root.id)) continue
    /** The walk's frames: the id, and how many of its blockers have been expanded. */
    const stack: Array<{ id: string; next: number }> = [{ id: root.id, next: 0 }]
    walking.add(root.id)
    while (stack.length > 0) {
      /** The frame being worked. */
      const frame = stack[stack.length - 1]
      /** This task's blocker references that RESOLVE to a task on the board. */
      const deps = (byId.get(frame.id)?.dependencies ?? []).filter((id) => byId.has(id))
      if (frame.next < deps.length) {
        /** The next blocker to expand. */
        const dependency = deps[frame.next]
        frame.next += 1
        // A blocker already on the walk closes a cycle: it contributes nothing, so the walk neither
        // recurses nor settles it twice — and every rank stays finite.
        if (settled.has(dependency) || walking.has(dependency)) continue
        walking.add(dependency)
        stack.push({ id: dependency, next: 0 })
        continue
      }
      /** The longest chain under this task, one longer than its deepest blocker. */
      let deepest = 0
      for (const dependency of deps) deepest = Math.max(deepest, (settled.get(dependency) ?? 0) + 1)
      settled.set(frame.id, deepest)
      walking.delete(frame.id)
      stack.pop()
    }
  }
  return settled
}

/** The rank a served `depth` claims; a negative or non-finite depth is a root. */
export function servedRank(task: RankTask): number {
  return Number.isFinite(task.depth) && task.depth > 0 ? Math.floor(task.depth) : 0
}

/**
 * The order two task ids draw in: NUMERIC, so `T2` precedes `T10` instead of following it (R19).
 *
 * The reference model orders a column by `localeCompare(a, b, { numeric: true })`, and a board that
 * draws the order the route happened to serve reads as scrambled: `T10, T2, T1, T3` is what a reader
 * sees today. A numeric collator is what makes `T9` sort before `T10`, which character-wise it does
 * not.
 */
export const ID_ORDER = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })

/**
 * Bucket a board into ranks, one array per rank.
 *
 * WITHIN A RANK the tasks are ordered by the numeric id (R19), which is the order the drawing stacks
 * them left to right; the board's own order is not a fact about the dependency graph, so it is not a
 * fact about the picture either.
 * @param tasks - the board.
 * @param rankOf - the rank each task claims.
 * @returns the ranks, index = rank; every rank from 0 to the deepest exists, even when empty.
 */
export function bucketRanks<T extends RankTask>(tasks: readonly T[], rankOf: (task: T) => number): T[][] {
  /** The deepest rank on the board, so an empty rank still exists and the spacing stays honest. */
  const deepest = tasks.reduce((max, task) => Math.max(max, rankOf(task)), 0)
  /** One bucket per rank, in draw order. */
  const ranks: T[][] = Array.from({ length: deepest + 1 }, () => [])
  for (const task of tasks) ranks[Math.min(Math.max(0, rankOf(task)), deepest)].push(task)
  for (const rank of ranks) rank.sort((left, right) => ID_ORDER.compare(left.id, right.id))
  return ranks
}

/**
 * What the board's references resolve to: its ranks, where they came from, and what did not resolve.
 *
 * THE DERIVATION WINS; THE SERVED `depth` IS A FALLBACK (R17). It is used in the one case where the
 * graph carries no information at all — not a single blocker reference resolves — while the served
 * depths still vary, which means the record knows about structure its references cannot express. The
 * result is reported in `ranksDerived` so that fallback is never silent.
 *
 * A CALLER MAY ALSO HAND IN THE RANKS A HOST ALREADY COMPUTED, as `served`: the buckets and the rank
 * map are then that map's, `derived` is `false`, and the same unresolved scan runs. This is the
 * TUI's path — the host computed the shared model once, so the layout applies those columns instead
 * of reconstructing a `RankPlan` of its own.
 * @param tasks - the board, in board order.
 * @param served - ranks computed elsewhere, keyed by id; omitted means "derive them here".
 * @returns the rank plan; ranks are empty for an empty board with no served map.
 */
export function rankPlan<T extends RankTask>(tasks: readonly T[], served?: ReadonlyMap<string, number>): RankPlan<T> {
  /** Task lookup by id. */
  const byId = new Map(tasks.map((task) => [task.id, task]))
  /** The blocker references no task on the board carries. */
  const missing = new Set<string>()
  /** How many blocker references DO resolve to a task on the board. */
  let resolved = 0
  for (const task of tasks) {
    for (const id of task.dependencies) {
      if (byId.has(id)) resolved += 1
      else missing.add(id)
    }
  }
  /** The unresolved references, in a stable order. */
  const unresolved = [...missing].sort()
  if (served !== undefined) {
    return { ranks: bucketRanks(tasks, (task) => served.get(task.id) ?? 0), rankOf: served, derived: false, unresolved }
  }
  if (tasks.length === 0) return { ranks: [], rankOf: new Map(), derived: true, unresolved }
  /** Whether the served depths claim any structure at all. */
  const servedVaries = new Set(tasks.map((task) => servedRank(task))).size > 1
  if (resolved === 0 && servedVaries) {
    /** The ranks the served `depth` claims, the only signal left on a graph that resolves nothing. */
    const ranks = bucketRanks(tasks, servedRank)
    /** The rank each task sits in, read back off those buckets. */
    const rankOf = new Map<string, number>()
    ranks.forEach((rank, index) => { for (const task of rank) rankOf.set(task.id, index) })
    return { ranks, rankOf, derived: false, unresolved }
  }
  /** The rank every task derives from its own blocker graph. */
  const derived = deriveRanks(tasks, byId)
  return { ranks: bucketRanks(tasks, (task) => derived.get(task.id) ?? 0), rankOf: derived, derived: true, unresolved }
}

/** Ids taking part in a dependency cycle, so a malformed board is REPORTED rather than drawn flat. */
export function cycleIds(tasks: readonly RankTask[]): string[] {
  /** Task lookup by id. */
  const byId = new Map(tasks.map((task) => [task.id, task]))
  /** Ids whose whole subtree was walked. */
  const done = new Set<string>()
  /** The current walk, in visit order. */
  const stack: string[] = []
  /** Membership index of `stack`. */
  const onStack = new Set<string>()
  /** Ids proven to sit on a cycle. */
  const cyclic = new Set<string>()
  /**
   * Walk one id's dependencies.
   * @param id - the id to visit.
   */
  const visit = (id: string): void => {
    if (done.has(id)) return
    if (onStack.has(id)) {
      for (const entry of stack.slice(stack.indexOf(id))) cyclic.add(entry)
      return
    }
    /** This id's task, undefined when the board does not carry it. */
    const task = byId.get(id)
    if (task === undefined) return
    onStack.add(id)
    stack.push(id)
    for (const dependency of task.dependencies) if (byId.has(dependency)) visit(dependency)
    stack.pop()
    onStack.delete(id)
    done.add(id)
  }
  for (const task of tasks) visit(task.id)
  return [...cyclic].sort()
}
