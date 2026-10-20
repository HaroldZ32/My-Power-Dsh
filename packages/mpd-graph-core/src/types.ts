// THE SHARED PLAN→GRAPH CORE (wave `living-graph`, lane A): the ONE model both planes draw.
//
// WHY THIS PACKAGE EXISTS. Before it, the TUI derived a board's ranks in a PRIVATE function inside
// `mpd-tui-plugin/src/graph.ts` and the web derived them AGAIN inside `team-view.ts`'s factory body:
// two implementations of one derivation, neither shared, so a fix to one could not reach the other
// and a test could pin only its own copy. The user's requirement — "web 和 tui 共用基础设施" — is this
// package: one rank derivation, one merge model, one file watcher.
//
// WHAT IT IS NOT. Not a renderer, not a cordis plugin, not a runtime dependency: no row, no patch
// entry, and nothing but plain data on the way out. Both planes INLINE it through `bun build`.
//
// THE TWO INPUTS, AND WHICH WINS. The board (`.mpd/team/teams/<id>.json`) is the authoritative LIVE
// state; the task-plan markdown is intent (ids, titles, owners) the board may not carry yet. Where
// they disagree the model RENDERS the disagreement and REPORTS it — {@link GraphReport} carries the
// six cases the frozen contract (`.mpd/plans/living-graph.md`, Amendment 1) names, and the report is
// the reason no case is resolved silently.
//
// DETERMINISM. Same board + same plan means the same model, byte for byte: every collection that
// reaches the drawing is sorted by a stated key (nodes, edges, ranks and every report list by the
// numeric id collator the rank derivation publishes; plan problems by their source line), so an
// iteration order never comes from a `Map` or `Set` insertion accident.
//
// SERIALIZABILITY. {@link GraphModel} is plain JSON — arrays, strings, numbers, booleans — because
// the host computes the model ONCE and both projections carry the SAME result (the `mpdTeams`
// service for the TUI, `/plugins/mpd-team/state` for the web). No `Map`, no `Set`, no class instance
// and no accessor ever leaves this file's exported model.

/**
 * The minimum a task must carry to be ranked: an id, its blocker references and a served depth.
 *
 * Deliberately NARROWER than {@link GraphTask}: the rank derivation reads only these three fields,
 * so a caller may rank its own row shape without inventing a subject or a visual state for a test,
 * and `{ id, dependencies, depth }` is accepted as written.
 */
export interface RankTask {
  /** The task id the ranks are keyed by. */
  id: string
  /** Ids this task is blocked by, in board order. */
  dependencies: readonly string[]
  /** The served longest-path depth, used only by the documented fallback. */
  depth: number
}

/**
 * One task as the rank derivation and the drawing need it; a structural subset of `TeamTaskRow` so a
 * fixture is cheap.
 *
 * The field vocabulary is the RENDERER'S, moved here verbatim with the algorithm that reads it. The
 * TUI's own `GraphTask` remains assignable to this shape, which is what lets lane B swap its imports
 * without touching a single drawing call.
 */
export interface GraphTask extends RankTask {
  /** The task title, truncated to whatever the geometry allows. */
  subject: string
  /** The RENDERED state the plane computed: completed|running|failed|blocked|open|cancelled. */
  visual: string
  /** `requirement` | `work` | `review` | `repair` | `integration`, abbreviated for the label. */
  kind?: string
  /** Owner display name, absent when nobody holds it. */
  assignee?: string
  /** Attempt counter, when the record carries one. */
  attempt?: number
}

/**
 * One task of the live board (`.mpd/team/teams/<id>.json`), reduced to what the merge needs.
 *
 * Structurally a subset of `TeamTaskRecord`/`TeamTaskRow`, so a caller hands its records over
 * unchanged and a fixture costs five fields. `visual` is optional on purpose: when the caller already
 * computed the plane's visual state (the TUI does, with the OPT-1 failed-dependency rule) that value
 * WINS, and only a row without one gets the minimal status mapping {@link visualOf} declares.
 */
export interface BoardTask {
  /** The board's stable, short id (`T1`, `T2`, …); the key the merge joins on. */
  id: string
  /** The task title. */
  subject: string
  /** What the task is in the requirement chain, when the record carries one. */
  kind?: string
  /** The durable status (`pending | claimed | in_progress | completed | failed | cancelled`). */
  status?: string
  /** Display name of the owning member, when one is assigned. */
  owner?: string
  /** Ids that must close before this task; the caller's own text is KEPT, unresolved or not. */
  blockedBy?: readonly string[]
  /** The served longest-path depth, used ONLY as the documented fallback of the rank derivation. */
  depth?: number
  /** Attempt counter, when the record carries one. */
  attempt?: number
  /** The visual state the calling plane already computed, when it has one. */
  visual?: string
}

/** Which plan section a task line came from: the numbered TODOs or the final-verification wave. */
export type PlanSection = "todo" | "final-wave"

/**
 * One task a task-plan markdown file declares.
 *
 * The ID is derived from the document's OWN ordinal (`1. …` becomes `T1`) or from its `F<n>` marker,
 * never parsed from prose: plan ordinals are the ids the board mints, which is exactly why a board
 * carrying `blockedBy` ordinals could be read at all (R17's measured record).
 */
export interface PlanTask {
  /** The id the line's ordinal names: `T<n>` for a TODO, `F<n>` for a final-verification item. */
  id: string
  /** The title with its checkbox, ordinal and leading lane marker removed; the rest is verbatim. */
  title: string
  /** Which section declared the task. */
  section: PlanSection
  /** The 1-based document line the task was read from, so a reader can jump to it. */
  line: number
  /** Owner display name resolved through the plan's lane table, when one applies. */
  owner?: string
  /** Blocking ids the document declared explicitly, resolved to ids and ordered by the id collator. */
  blockedBy: readonly string[]
}

/** One plan line the parser could not read, carried instead of thrown on. */
export interface PlanProblem {
  /** The 1-based document line the text came from. */
  line: number
  /** The line's text, verbatim, so a reader sees exactly what was not understood. */
  text: string
  /** Why the parser refused it, in one sentence. */
  reason: string
}

/** One owner row a plan's lane table declares. */
export interface PlanLane {
  /** The lane label normalised to its short key (`A`, `B`, `P1`, …). */
  key: string
  /** The owner display name the row's owner cell names, with a trailing qualifier removed. */
  owner: string
}

/** A parsed task-plan markdown file: its tasks, its lane owners and everything it could not read. */
export interface PlanDocument {
  /** The declared tasks, ordered by the id collator so two equal plans yield equal documents. */
  tasks: PlanTask[]
  /** The lane table's owner rows, ordered by {@link PlanLane.key}. */
  lanes: PlanLane[]
  /** Unreadable lines in document order (line, then text); empty means the whole file was understood. */
  problems: PlanProblem[]
}

/**
 * One node of the merged graph.
 *
 * IT IS a {@link GraphTask} — the rank derivation and both renderers take that shape — plus the
 * facts only the merge can know. `depth` is the RESOLVED column (derived, or the served fallback the
 * report names), so a consumer never re-buckets: a ghost and a live row sit in the same rank space.
 *
 * A GHOST carries BOTH `planned: true` and `visual: "planned"` on purpose: a consumer keys on the
 * boolean, a renderer keys on the string.
 */
export interface GraphNode extends GraphTask {
  /**
   * True EXACTLY for a GHOST: an id the plan declares and the board does not carry yet, drawn so the
   * plan's intent is visible and never dropped. A row the board alone carries has `false`, and so
   * does a row both inputs agree on.
   */
  planned: boolean
  /** The plan's title when the plan declares this id, kept beside the board's subject. */
  title?: string
  /** The board's durable status, absent for a ghost. */
  status?: string
}

/**
 * One dependency edge of the merged graph.
 *
 * `from` is the blocker and `to` the blocked task, so the arrow the drawing paints reads the same
 * way as the board's `blockedBy`. The direction is never inferred from the order of the two arrays.
 */
export interface GraphEdge {
  /** The id that must close first. */
  from: string
  /** The id that is blocked by {@link GraphEdge.from}. */
  to: string
  /** Where the edge was declared: on the board, only in the plan, or by both agreeing. */
  source: "board" | "plan" | "both"
}

/**
 * Everything the merge had to decide, stated rather than resolved silently.
 *
 * THE SIX CASES OF THE FROZEN CONTRACT, in order: an id only the board carries (`boardOnly`), an id
 * only the plan declares (`planOnly`), an edge only the plan declares (`edgePlanOnly`), an edge only
 * the board carries (`edgeBoardOnly`), an edge both declare (an ordinary edge — `source: "both"`,
 * reported in neither list because there is nothing to report), and a plan line that could not be
 * read (`planProblems`). `unresolved` and `ranksDerived` are the rank derivation's own honesty
 * fields, carried through unchanged.
 */
export interface GraphReport {
  /** Ids the board carries and the plan does not, ordered by the id collator. */
  boardOnly: string[]
  /** Ids the plan declares and the board does not: the ghosts, ordered by the id collator. */
  planOnly: string[]
  /** Edges declared only by the plan, in the model's own edge order. */
  edgePlanOnly: GraphEdge[]
  /** Edges only the board carries, in the model's own edge order. */
  edgeBoardOnly: GraphEdge[]
  /** Plan lines that could not be read, in document order (line, then text). */
  planProblems: PlanProblem[]
  /** Blocker references that resolve to no node, sorted; the rank derivation's own report. */
  unresolved: string[]
  /** Whether the ranks were derived from the graph; `false` means the served `depth` fallback won. */
  ranksDerived: boolean
}

/**
 * The ONE model both planes draw: plain JSON, no `Map`, no instance, no function.
 *
 * THE MODEL IS COMPUTED ONCE, IN THE HOST PLANE. Both projections carry this same value — the
 * `mpdTeams` service for the TUI and `/plugins/mpd-team/state` for the web — so the two planes cannot
 * disagree about a rank or an edge, and no renderer is allowed to recompute one.
 *
 * `JSON.stringify` MUST ROUND-TRIP IT UNCHANGED: every field is a string, a number, a boolean, a
 * plain object or a plain array. {@link RankPlan.rankOf} is deliberately NOT part of this shape — it
 * is a `Map`, it is the derivation's lookup, and it never leaves the process.
 */
export interface GraphModel {
  /** The merged nodes, ordered by the id collator; ghosts included, never dropped. */
  nodes: GraphNode[]
  /** The merged edges, ordered by (`from`, then `to`) under the id collator. */
  edges: GraphEdge[]
  /** The rank buckets, index = rank, value = that rank's node ids in the same id order. */
  ranks: string[][]
  /** Ids taking part in a dependency cycle, sorted; a malformed graph is REPORTED, never hidden. */
  cycles: string[]
  /** What the merge decided, case by case. */
  report: GraphReport
}

/**
 * What the board's own references resolve to, and therefore how the ranks were decided.
 *
 * DECLARED HERE (not in `rank.ts`) because it is part of the package's public surface: a renderer
 * that draws the ranks must be able to read which source won and what did not resolve. It is NOT
 * part of {@link GraphModel}: `rankOf` is a `Map`, and the model is the value that crosses the wire.
 * The generic parameter keeps the caller's own row type, so a plane that ranks its rows gets its
 * rows back rather than a widened copy.
 */
export interface RankPlan<T extends RankTask = GraphTask> {
  /** The ranks, index = rank, value = that rank's tasks in board order. */
  ranks: T[][]
  /** The rank each task sits in, which the rail's forest and the chain's walk both read. */
  rankOf: ReadonlyMap<string, number>
  /** Whether the ranks were derived from the dependency graph; `false` means the served depth drew. */
  derived: boolean
  /** The blocker references no task on the board carries, sorted and de-duplicated. */
  unresolved: string[]
}

/** What {@link buildModel} needs: the live board and the parsed plan, either of which may be absent. */
export interface BuildModelInput {
  /** The board's tasks in board order; omitted or empty means "the plan alone". */
  board?: readonly BoardTask[]
  /** The parsed plan; omitted means "no plan file", which turns every board id into a boardOnly id. */
  plan?: PlanDocument
}
