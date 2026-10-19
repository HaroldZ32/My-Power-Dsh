/** What the board's own references resolve to, and therefore how the ranks were decided. */
interface RankPlan {
  /** The ranks, index = rank, value = that rank's tasks in board order. */
  ranks: GraphTask[][]
  /** The rank each task sits in, which the rail's forest and the chain's walk both read. */
  rankOf: ReadonlyMap<string, number>
  /** Whether the ranks were derived from the dependency graph; `false` means the served depth drew. */
  derived: boolean
  /** The blocker references no task on the board carries, sorted and de-duplicated. */
  unresolved: string[]
}

/**
 * The rank of every task, DERIVED: the longest chain of blockers that RESOLVE beneath it.
 *
 * This is the algorithm the drawing should have used all along (§header, R17). It walks iteratively —
 * an explicit stack, never a recursion — so a malformed board cannot exhaust the call stack, and it
 * breaks a cycle by counting the blocker that closes it as contributing NOTHING, which keeps every
 * rank finite while `cycleIds` still reports the cycle itself.
 * @param tasks - the board, in board order (the walk's determinism rests on it).
 * @param byId - task lookup by id.
 * @returns the derived rank of every task; a task whose blockers do not resolve is a root.
 */
function deriveRanks(tasks: readonly GraphTask[], byId: ReadonlyMap<string, GraphTask>): Map<string, number> {
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
function servedRank(task: GraphTask): number {
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
const ID_ORDER = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })

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
function bucketRanks(tasks: readonly GraphTask[], rankOf: (task: GraphTask) => number): GraphTask[][] {
  /** The deepest rank on the board, so an empty rank still exists and the spacing stays honest. */
  const deepest = tasks.reduce((max, task) => Math.max(max, rankOf(task)), 0)
  /** One bucket per rank, in draw order. */
  const ranks: GraphTask[][] = Array.from({ length: deepest + 1 }, () => [])
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
 * @param tasks - the board.
 * @returns the rank plan; ranks are empty for an empty board.
 */
function rankPlan(tasks: readonly GraphTask[]): RankPlan {
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
export function cycleIds(tasks: readonly GraphTask[]): string[] {
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
