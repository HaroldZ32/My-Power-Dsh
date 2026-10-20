// LANE E — differential proof that the rank derivation MOVED rather than drifted.
//
// THE ORACLE IS THE BASELINE BYTES: `diff/old-rank.ts` was extracted with `git show` from commit
// dc796a27 (`packages/mpd-tui-plugin/src/graph.ts`), so it is the code that shipped before this wave.
// This harness feeds the SAME seeded random boards to the old and the new implementation and compares
// every output field the drawing reads. A rewrite that "looks the same" fails here; a faithful move
// passes on every case, including cycles, dangling references and the served-depth fallback.
import { rankPlan as newRankPlan, cycleIds as newCycleIds, servedRank as newServedRank, ID_ORDER as NEW_ID_ORDER } from "../../../../../packages/mpd-graph-core/src/index.ts"
import { rankPlan as oldRankPlan, cycleIds as oldCycleIds, servedRank as oldServedRank, ID_ORDER as OLD_ID_ORDER } from "./old-rank.ts"

/** A task shape both implementations accept. */
interface BothTask {
  /** The task id. */
  id: string
  /** The task title (unused by the derivation, required by the old type). */
  subject: string
  /** The rendered state (unused by the derivation, required by the old type). */
  visual: string
  /** Blocker references, resolved or not. */
  dependencies: string[]
  /** The served depth used only by the fallback. */
  depth: number
}

/** A deterministic PRNG (mulberry32), so the case list is reproducible from the seed alone. */
function mulberry32(seed: number): () => number {
  /** The advancing state. */
  let state = seed
  return function next(): number {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/** The id pool a random board draws from. */
const POOL = ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"]
/** References that are deliberately NOT on the board, to exercise the unresolved report. */
const DANGLING = ["T9", "T10", "X1"]

/**
 * One random board.
 * @param rand - the PRNG.
 * @returns tasks in a random order.
 */
function randomBoard(rand: () => number): BothTask[] {
  /** How many tasks this board carries. */
  const size = 1 + Math.floor(rand() * POOL.length)
  /** The board, in generated order (never sorted — the walk sees this order). */
  const tasks: BothTask[] = []
  for (let index = 0; index < size; index += 1) {
    /** How many blocker references this task carries. */
    const refCount = Math.floor(rand() * 4)
    /** The references, sometimes naming an id outside the board. */
    const dependencies: string[] = []
    for (let ref = 0; ref < refCount; ref += 1) {
      /** The roll that decides between a present id and a dangling one. */
      const roll = rand()
      dependencies.push(roll < 0.25 ? DANGLING[Math.floor(rand() * DANGLING.length)] : POOL[Math.floor(rand() * POOL.length)])
    }
    tasks.push({ id: POOL[index], subject: `task ${POOL[index]}`, visual: "open", dependencies, depth: Math.floor(rand() * 7) })
  }
  return tasks
}

/** The comparable form of a rank plan: buckets as ids, rankOf as sorted pairs, plus the two flags. */
function comparable(plan: ReturnType<typeof newRankPlan<BothTask>>): unknown {
  return {
    ranks: plan.ranks.map((rank) => rank.map((task) => task.id)),
    rankOf: [...plan.rankOf.entries()].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
    derived: plan.derived,
    unresolved: [...plan.unresolved].sort(),
  }
}

/** Mismatches found, with the board that produced them. */
const mismatches: Array<{ case: number; field: string; old: unknown; next: unknown; board: BothTask[] }> = []
/** The seed every case is derived from; recorded so the run is reproducible. */
const SEED = 20261019
/** The PRNG instance. */
const rand = mulberry32(SEED)
/** How many random boards the comparison walks. */
const CASES = 300
for (let index = 0; index < CASES; index += 1) {
  /** The board for this case. */
  const board = randomBoard(rand)
  /** What the shipped-before derivation says. */
  const before = comparable(oldRankPlan(board))
  /** What the new core says. */
  const after = comparable(newRankPlan(board))
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    mismatches.push({ case: index, field: "rankPlan", old: before, next: after, board })
  }
  /** Cycle ids, which the model carries as a first-class field. */
  const oldCycles = oldCycleIds(board)
  /** The new cycle report. */
  const newCycles = newCycleIds(board)
  if (JSON.stringify(oldCycles) !== JSON.stringify(newCycles)) {
    mismatches.push({ case: index, field: "cycleIds", old: oldCycles, next: newCycles, board })
  }
}

/** Served-depth samples, including the negative / non-finite cases the fallback promises to treat as roots. */
const DEPTHS = [-3, -1, 0, 0.5, 1, 2.9, 7, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]
for (const depth of DEPTHS) {
  /** The old reading. */
  const before = oldServedRank({ id: "T1", subject: "s", visual: "open", dependencies: [], depth })
  /** The new reading. */
  const after = newServedRank({ id: "T1", dependencies: [], depth })
  if (before !== after) mismatches.push({ case: -1, field: `servedRank(${String(depth)})`, old: before, next: after, board: [] })
}

/** The id collator's order on a sample that distinguishes numeric from character ordering. */
const ID_SAMPLE = ["T10", "T2", "T1", "T9", "F1", "T3"]
/** The old order. */
const oldOrder = [...ID_SAMPLE].sort((left, right) => OLD_ID_ORDER.compare(left, right))
/** The new order. */
const newOrder = [...ID_SAMPLE].sort((left, right) => NEW_ID_ORDER.compare(left, right))
if (JSON.stringify(oldOrder) !== JSON.stringify(newOrder)) mismatches.push({ case: -2, field: "ID_ORDER", old: oldOrder, next: newOrder, board: [] })

/** The run's result. */
const result = {
  run: "lane-e-rank-differential",
  at: new Date().toISOString(),
  oracle: "git show dc796a27:packages/mpd-tui-plugin/src/graph.ts (lines 570-740 + GraphTask at line 73)",
  seed: SEED,
  randomBoards: CASES,
  depthSamples: DEPTHS,
  idOrderSample: { ids: ID_SAMPLE, old: oldOrder, new: newOrder },
  mismatches,
  verdict: mismatches.length === 0 ? "IDENTICAL on every case" : `${mismatches.length} MISMATCH(ES)`,
}
console.log(JSON.stringify(result, null, 1).slice(0, 4000))
if (mismatches.length > 0) process.exitCode = 1
