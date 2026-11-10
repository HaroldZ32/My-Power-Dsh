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
  /**
   * The INNERMOST group whose interior draws this node, absent for a node of the root frame.
   *
   * A node that is itself a GROUP FRAME (a subcell's box) carries its PARENT group's id here, because
   * the frame it represents is the box's interior while the box is drawn inside its parent.
   */
  group?: string
}

/**
 * One BACKGROUND CONSULT a cell started, drawn as a node beside the tasks.
 *
 * WHY IT IS NOT A TASK (contract §2, hard rule 1). A consult is not work the board tracks: it has no
 * blocker, takes no rank, is never dispatched and is never counted in a board tally. Putting one in
 * {@link GraphModel.nodes} would make the TUI synthesise it as a ghost TASK and the web's ghost
 * whitelist drop it silently — the two surfaces would disagree about the same model. So consults live
 * in the SIBLING array {@link GraphModel.consults}, and this shape exists only there.
 *
 * IT IS STILL A {@link GraphNode}, deliberately: both renderers already draw that shape, so a consult
 * card reuses the card, the tone table and the row builder instead of a second drawing vocabulary.
 * `kind: "consult"` is the discriminant — the task vocabulary never uses that word.
 *
 * NO EDGE, NO RANK (contract §2, hard rule 2). A consult carries `dependencies: []` and `depth: 0`, and
 * it takes no part in any frame's rank derivation; a renderer places it in its frame's first column.
 */
export interface GraphConsultNode extends GraphNode {
  /**
   * The node family. A task's {@link GraphTask.kind} names its requirement-chain role
   * (`requirement` | `work` | `review` | `repair` | `integration`); a consult is none of those.
   */
  kind: "consult"
  /** The supervisor's own id for the consult, which is what a settle-upsert is keyed by. */
  consultId: string
  /** The cell that started the consult: the frame the node belongs to, even when the cell is gone. */
  cellId: string
  /** When the consult started, epoch milliseconds — the detail body prints it (contract §6). */
  startedAt: number
  /** How long it ran, milliseconds; absent while it is still running. */
  elapsedMs?: number
}

/**
 * One DEPENDENCY edge of the merged graph.
 *
 * `from` is the blocker and `to` the blocked task, so the arrow the drawing paints reads the same
 * way as the board's `blockedBy`. The direction is never inferred from the order of the two arrays.
 *
 * AN EDGE SPANNING TWO FRAMES names GROUP IDS on the side it crosses, never the inner task: the
 * attachment rule in {@link GraphGroup} re-anchors it, so a renderer draws a port on the box instead
 * of a line escaping it.
 */
export interface GraphEdge {
  /** The id that must close first. */
  from: string
  /** The id that is blocked by {@link GraphEdge.from}. */
  to: string
  /**
   * Where the edge came from: the board, only the plan, both agreeing, or `"derived"` for the spawn
   * edge this model itself derives from a group's {@link GraphGroupInput.originTaskId}.
   */
  source: "board" | "plan" | "both" | "derived"
}

/**
 * One GROUP of the merged model: a subcell's FRAME, whose interior is that subcell's own DAG.
 *
 * THE ONE GROUP CONCEPT (`cellwork` wave 4). A subcell renders as a box; the box interior is the
 * subcell's own dependency graph; a dependency from outside attaches to the box, not to a task inside
 * it; nesting repeats recursively. This record is the box, and {@link GraphGroupInput} is how the
 * caller declares it.
 *
 * THE ATTACHMENT RULE (binding, implemented in `model.ts`). An edge with one endpoint inside group G
 * and the other outside is re-anchored to G's frame, where G is the INNERMOST group containing the
 * inside endpoint; an edge fully inside one group keeps its two tasks as written; an edge between two
 * groups becomes group→group; and a group's spawn edge from {@link originTaskId} is DERIVED by the
 * model, never authored by the caller.
 *
 * RANKING. The outer model ranks its GROUP PSEUDO-NODES — one per child group, drawn as a node whose
 * `visual` is `"group"` — so external columns stay correct, and each group's interior is ranked by its
 * own recursive merge. Every node's {@link GraphNode.depth} is therefore its column INSIDE its own
 * frame, and {@link GraphModel.ranks} buckets the ROOT frame only.
 *
 * Plain JSON, like everything else on the wire: no `Map`, no `Set`, no instance.
 */
export interface GraphGroup {
  /** The frame's id, which is also the id of its pseudo-node inside the parent frame. */
  id: string
  /** The frame's display title, drawn on the box border. */
  label: string
  /** The enclosing group's id, or `null` when the box sits directly inside the root frame. */
  parentId: string | null
  /**
   * The ids drawn DIRECTLY inside this frame, in id-collator order: the frame's own task nodes plus
   * the ids of its immediate child groups (each of which is a box in its own right).
   */
  memberIds: string[]
  /** Nesting depth: `0` for a box inside the root frame, one more for every enclosing group. */
  depth: number
  /** The task that spawned this subcell, when the caller declared one; see `model.ts`. */
  originTaskId?: string
}

/**
 * One consult a caller declares to `buildModel`: the facts a node is derived from, nothing pre-drawn.
 *
 * THE MODEL OWNS THE DERIVATION, as it does for tasks: the caller states the record's own lifecycle
 * word and its minted ordinal, and {@link GraphConsultNode} is computed from them (the id, the visual
 * tone, the group attribution and the ordering). Declaring the shape STRUCTURALLY at every call site is
 * the existing convention — `team-core` does the same for {@link GraphGroupInput} — so a projection that
 * drifts from this record reddens the full-program typecheck instead of drifting silently.
 */
export interface GraphConsultInput {
  /** The minted per-team ordinal: it names the node (`C<n>`) and orders a frame's rows. */
  consultNumber: number
  /** The supervisor's own id for the consult, carried onto the node verbatim. */
  consultId: string
  /** The canonical roster role name, drawn as the card's assignee. */
  role: string
  /** The assignment excerpt (the record bounds it at 200 characters), drawn as the card's subject. */
  task: string
  /** The recorded lifecycle word: `running` | `complete` | `interrupted` | `failed` | `cancelled`. */
  state: string
  /** When the consult started, epoch milliseconds. */
  startedAt: number
  /** The cell that started it, carried onto the node. */
  cellId: string
  /** How long it ran, milliseconds; absent while it is still running. */
  elapsedMs?: number
}

/**
 * One group a caller declares to `buildModel`: a subcell's id, label and its OWN interior input.
 *
 * The interior is a full merge input — its own board and plan, so a subcell's tasks are ranked among
 * themselves — plus its own child groups, which is what makes nesting recursion instead of a second
 * concept. Ids must be unique across the WHOLE tree: the id is the join key the two planes already
 * use, and a duplicate is refused rather than silently resolved.
 */
export interface GraphGroupInput {
  /** The frame's id; it becomes the pseudo-node id inside the parent frame and the box's own id. */
  id: string
  /** The frame's display title. */
  label: string
  /**
   * The id of the task that spawned this subcell, when the caller knows it.
   *
   * The model DERIVES the spawn edge `originTaskId → <this group's id>` from it — the caller never
   * authors that edge. An origin naming no node anywhere is reported in `report.unresolved`; one
   * naming a node INSIDE this group derives nothing, because the group cannot be blocked by its own
   * interior.
   */
  originTaskId?: string
  /** The subcell's own board rows; omitted or empty means a frame with no tasks of its own. */
  board?: readonly BoardTask[]
  /** The subcell's own parsed plan; omitted means the subcell has no plan file. */
  plan?: PlanDocument
  /** The subcells nested INSIDE this one, recursively; each becomes a further box. */
  groups?: readonly GraphGroupInput[]
  /**
   * The BACKGROUND CONSULTS this subcell started, drawn inside its box.
   *
   * NESTING IS FREE: the caller builds each live child's frame from that child's OWN record, so the
   * consult rows arrive with the rest of the child's input and the model attributes them to this frame
   * (`group` = this group's id, the id qualified `"<groupId>::C<n>"`). The liveness filter that drops a
   * finished child drops its consults with it — one rule, not two.
   */
  consults?: readonly GraphConsultInput[]
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
  /**
   * Every group the input declared, flat and ordered by (`depth`, then `id`), parents before children.
   *
   * ABSENT when the caller supplied no group at all — that is what keeps an ungrouped model
   * byte-identical to the flat model this package produced before groups existed. Its presence is the
   * signal that a frame of the model is a box rather than a task.
   *
   * {@link ranks} still buckets the ROOT frame only (its own tasks plus the top-level group
   * pseudo-nodes); an interior's columns are carried by each member's {@link GraphNode.depth}.
   */
  groups?: GraphGroup[]
  /**
   * The BACKGROUND CONSULTS of every frame, drawn beside the tasks and NEVER mixed into them.
   *
   * ABSENT when the input declared none — the same backward guarantee {@link groups} carries: a model
   * with no consult is byte-identical to the one this package produced before consults existed, and
   * both renderers are the identity on an absent field.
   *
   * ORDER: frame pre-order (the root frame first, then each box in id order), and `consultNumber`
   * ascending inside one frame. The ordinal is minted PER TEAM, so a single global sort would interleave
   * two frames' `C1`s arbitrarily; ordering by frame first keeps the sequence the user actually saw.
   */
  consults?: GraphConsultNode[]
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
  /**
   * The subcells this model contains, recursively; omitted or empty means a FLAT model.
   *
   * Supplying at least one group is what turns the model into a nested one: each group's interior is
   * merged and ranked on its own, its tasks are flattened into {@link GraphModel.nodes} carrying
   * {@link GraphNode.group}, and cross-frame edges are re-anchored by the attachment rule. A model
   * built without groups is byte-identical to the flat model this package has always produced.
   */
  groups?: readonly GraphGroupInput[]
  /**
   * The BACKGROUND CONSULTS the ROOT frame's own team started; omitted or empty means none.
   *
   * A consult never enters {@link GraphModel.nodes}, never contributes an edge and never takes part in
   * the rank derivation, so supplying this field cannot change a single byte of `nodes`, `edges`,
   * `ranks` or `report`. That invariance is a gate (`scripts/verify-graph-model.ts`), not a promise.
   */
  consults?: readonly GraphConsultInput[]
}
