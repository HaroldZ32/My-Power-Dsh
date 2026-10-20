// THE MERGE MODEL: the live board plus the declared plan becomes ONE deterministic graph.
//
// THE RULE IS THE FROZEN CONTRACT'S (`.mpd/plans/living-graph.md` Amendment 1): the board is the
// authoritative LIVE state, the plan is intent, and a disagreement is RENDERED and REPORTED rather
// than resolved silently. The six cases are the report's own fields — board-only ids, plan-only
// GHOSTS (never dropped), plan-only edges, board-only edges, agreeing edges, unreadable plan lines.
//
// WHICH SIDE WINS WHERE THEY OVERLAP, stated once so no reader has to infer it: the board supplies
// the subject, the kind, the owner, the status and the visual state; the plan supplies its own title
// beside them and the lane owner only when the board has none. Blocker references are the UNION of
// both sides, which is why a disagreement shows as two report lists instead of one side being
// silently preferred.
//
// DETERMINISM is a property of the OUTPUT, not of the input order: the id union is sorted by the
// published id collator, edges are sorted by (`from`, `to`), and the rank buckets are the
// derivation's own (which sorts within a rank). Two runs over the same inputs therefore produce the
// same JSON, whatever order the caller's maps happened to be in.
import { ID_ORDER, cycleIds, rankPlan } from "./rank.ts"
import type { BoardTask, BuildModelInput, GraphEdge, GraphModel, GraphNode, GraphReport, PlanTask } from "./types.ts"

/** One edge as the two inputs declared it, before it is reduced to a `GraphEdge`. */
interface DeclaredEdge {
  /** The blocker id. */
  from: string
  /** The blocked id. */
  to: string
  /** Whether the board declared this pair. */
  board: boolean
  /** Whether the plan declared this pair. */
  plan: boolean
}

/** The visual states a renderer already knows; anything else is mapped from the durable status. */
const BOARD_VISUALS: ReadonlySet<string> = new Set(["completed", "running", "failed", "blocked", "open", "cancelled"])

/**
 * The visual state a board row draws in.
 *
 * A visual the calling plane computed WINS, because only that plane knows the OPT-1 rule (a failed
 * dependency does not block its dependents) and this module must not invent a second reading of it.
 * A row without one is mapped from its durable status, and an unknown value is `open` — the model
 * states a state a renderer can colour, never a raw string it cannot.
 * @param task - the board row.
 * @returns one of the six renderer states.
 */
function visualOf(task: BoardTask): string {
  if (task.visual !== undefined && BOARD_VISUALS.has(task.visual)) return task.visual
  return statusVisual(task.status)
}

/**
 * The minimal status-to-visual mapping for a board row that carries no computed visual.
 * @param status - the row's durable status, when it has one.
 * @returns the renderer state the status implies; `open` for anything unrecognized.
 */
function statusVisual(status: string | undefined): string {
  switch (status) {
    case "completed":
      return "completed"
    case "failed":
      return "failed"
    case "cancelled":
      return "cancelled"
    case "claimed":
    case "in_progress":
      return "running"
    case "blocked":
      return "blocked"
    default:
      return "open"
  }
}

/**
 * The distinct values of a list, ordered by the drawing's own id collator.
 * @param values - the values, in whatever order they arrived.
 * @returns the distinct values in collator order.
 */
function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => ID_ORDER.compare(left, right))
}

/**
 * Build the ONE model both planes draw from the live board and the declared plan.
 *
 * NEVER THROWS on a malformed input: an unresolved reference is reported in `report.unresolved`, a
 * plan line that could not be read is already in `report.planProblems`, and an id only one side
 * carries becomes a node (or, for the plan-only case, a ghost) rather than a dropped row.
 *
 * THE RESULT IS PLAIN JSON AND ROUND-TRIPS: every node carries an absent optional field as an ABSENT
 * KEY rather than an `undefined` value, so `JSON.parse(JSON.stringify(model))` deep-equals `model`.
 * @param input - the board rows and the parsed plan, either of which may be missing.
 * @returns the merged model, ranked, with its report.
 */
export function buildModel(input: BuildModelInput): GraphModel {
  /** The board's rows by id; a repeated id keeps the LAST row, as a board rewrite would. */
  const boardById = new Map<string, BoardTask>()
  for (const task of input.board ?? []) boardById.set(task.id, task)
  /** The plan's tasks by id; the parser already de-duplicated them. */
  const planById = new Map<string, PlanTask>()
  for (const task of input.plan?.tasks ?? []) planById.set(task.id, task)
  /** Every id either input names, ordered by the drawing's collator. */
  const ids = [...new Set([...boardById.keys(), ...planById.keys()])].sort((left, right) => ID_ORDER.compare(left, right))
  /** The nodes before the rank derivation resolves `depth`. */
  const drafts: GraphNode[] = []
  for (const id of ids) {
    /** The board row, when the board carries the id. */
    const board = boardById.get(id)
    /** The plan task, when the plan declares the id. */
    const planned = planById.get(id)
    /** The board's kind, which the plan cannot express. */
    const kind = board?.kind
    /** The owner: the board's assignment wins over the plan's lane owner. */
    const assignee = board?.owner ?? planned?.owner
    /** The plan's own title, kept beside the board's subject when both exist. */
    const title = planned?.title
    /** The board's durable status; a ghost has none. */
    const status = board?.status
    drafts.push({
      id,
      subject: board?.subject ?? planned?.title ?? id,
      visual: board === undefined ? "planned" : visualOf(board),
      dependencies: uniqueSorted([...(board?.blockedBy ?? []), ...(planned?.blockedBy ?? [])]),
      depth: board?.depth ?? 0,
      planned: board === undefined,
      ...(kind === undefined ? {} : { kind }),
      ...(assignee === undefined ? {} : { assignee }),
      ...(title === undefined ? {} : { title }),
      ...(status === undefined ? {} : { status }),
    })
  }
  /** One entry per declared pair, so the two inputs meet on the same edge. */
  const declared = new Map<string, DeclaredEdge>()
  /**
   * The join key for an edge pair.
   * @param from - the blocker id.
   * @param to - the blocked id.
   * @returns a key no id can collide with, because an id never contains NUL.
   */
  const keyOf = (from: string, to: string): string => `${from}\u0000${to}`
  for (const task of boardById.values()) {
    for (const from of task.blockedBy ?? []) {
      /** The pair's merged entry, created on first sight. */
      const entry = declared.get(keyOf(from, task.id)) ?? { from, to: task.id, board: false, plan: false }
      entry.board = true
      declared.set(keyOf(from, task.id), entry)
    }
  }
  for (const task of planById.values()) {
    for (const from of task.blockedBy) {
      /** The pair's merged entry, created on first sight. */
      const entry = declared.get(keyOf(from, task.id)) ?? { from, to: task.id, board: false, plan: false }
      entry.plan = true
      declared.set(keyOf(from, task.id), entry)
    }
  }
  /** The id set, so an edge is drawn only when BOTH of its ends is a node. */
  const nodeIds = new Set(ids)
  /** The drawable edges, sorted after the loop. */
  const edges: GraphEdge[] = []
  for (const entry of declared.values()) {
    if (!nodeIds.has(entry.from) || !nodeIds.has(entry.to)) continue
    edges.push({ from: entry.from, to: entry.to, source: entry.board && entry.plan ? "both" : entry.plan ? "plan" : "board" })
  }
  edges.sort((left, right) => ID_ORDER.compare(left.from, right.from) || ID_ORDER.compare(left.to, right.to))
  /** The rank plan over the merged nodes, ghosts included. */
  const layout = rankPlan(drafts)
  /** The nodes with their resolved column written into `depth`, which is the shape renderers take. */
  const nodes: GraphNode[] = drafts.map((node) => ({ ...node, depth: layout.rankOf.get(node.id) ?? node.depth }))
  /** The rank buckets as ids, so the model carries no Map. */
  const ranks: string[][] = layout.ranks.map((rank) => rank.map((task) => task.id))
  /** The report: every disagreement the merge had to decide, plus the derivation's own honesty. */
  const report: GraphReport = {
    boardOnly: ids.filter((id) => boardById.has(id) && !planById.has(id)),
    planOnly: ids.filter((id) => planById.has(id) && !boardById.has(id)),
    edgePlanOnly: edges.filter((edge) => edge.source === "plan"),
    edgeBoardOnly: edges.filter((edge) => edge.source === "board"),
    planProblems: [...(input.plan?.problems ?? [])],
    unresolved: [...layout.unresolved],
    ranksDerived: layout.derived,
  }
  return { nodes, edges, ranks, cycles: cycleIds(nodes), report }
}
