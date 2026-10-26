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
//
// GROUPS (`cellwork` wave 4). A subcell is a FRAME: its interior is merged and ranked as its OWN
// model, its tasks are flattened in carrying `group`, and every edge that crosses a frame's border is
// anchored to that frame's pseudo-node — so the outer picture never draws a line into a box. The rule
// itself is stated once, on `GraphGroup` in `types.ts`; this module implements it by collecting the
// frames, lifting each declared pair to the deepest frame its two endpoints share, and ranking every
// frame over its own nodes plus its child groups' boxes. A model built with NO group is byte-identical
// to the flat model this package has always produced, which is the backward-compatibility test.
import { ID_ORDER, cycleIds, rankPlan } from "./rank.ts"
import type { BoardTask, BuildModelInput, GraphEdge, GraphGroup, GraphGroupInput, GraphModel, GraphNode, GraphReport, PlanDocument, PlanTask, RankPlan } from "./types.ts"

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
  /** Whether the model DERIVED this pair from a group's origin task instead of reading it. */
  derived: boolean
}

/**
 * One FRAME of the model: the root, or one group's interior.
 *
 * A frame owns its own board and plan, which is exactly what lets a subcell be ranked among its own
 * tasks instead of against every other team's ids. Frames form the tree the attachment rule walks: a
 * group frame's parent is the frame that DRAWS its box.
 */
interface Frame {
  /** The group id whose interior this frame is; `null` for the root frame. */
  id: string | null
  /** The frame's display title; `null` for the root frame, which draws no box of its own. */
  label: string | null
  /** The enclosing frame; `null` for the root frame. */
  parent: Frame | null
  /** The group nesting depth: `-1` for the root frame, `0` for a box inside it, one more per level. */
  depth: number
  /** The task that spawned this frame's subcell, when the caller declared one. */
  originTaskId?: string
  /** The frame's OWN board rows. */
  board: readonly BoardTask[]
  /** The frame's OWN parsed plan, when the subcell has one. */
  plan?: PlanDocument
  /** The frames nested inside this one, ordered by the id collator. */
  children: Frame[]
}

/** A frame that draws a BOX: a group, which therefore has an id and a title. */
interface GroupFrame extends Frame {
  /** The group id, which is also the id of its pseudo-node in the parent frame. */
  id: string
  /** The box title, drawn on the frame's border. */
  label: string
}

/** One frame's own merge, before the frames are joined into a model. */
interface FrameMerge {
  /** The frame these rows came from. */
  frame: Frame
  /** The frame's own nodes: its tasks and ghosts, with their declared blockers and `depth` unresolved. */
  nodes: GraphNode[]
  /** The pairs this frame declared, before any of them is anchored to a frame border. */
  declared: DeclaredEdge[]
  /** Ids the frame's board carries and its plan does not. */
  boardOnly: string[]
  /** Ids the frame's plan declares and its board does not: that frame's ghosts. */
  planOnly: string[]
}

/** The visual states a renderer already knows; anything else is mapped from the durable status. */
const BOARD_VISUALS: ReadonlySet<string> = new Set(["completed", "running", "failed", "blocked", "open", "cancelled"])

/** The visual state a group's pseudo-node draws in: the frame is a box, not a task. */
const GROUP_VISUAL = "group"

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
 * The distinct ids of a list, in the drawing's collator order.
 * @param ids - the ids, in whatever order the frames produced them.
 * @returns the ids, sorted and de-duplicated.
 */
function sortedIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort((left, right) => ID_ORDER.compare(left, right))
}

/**
 * The join key for an edge pair, so the two inputs meet on the same edge.
 * @param from - the blocker id.
 * @param to - the blocked id.
 * @returns a key no id can collide with, because an id never contains NUL.
 */
function pairKey(from: string, to: string): string {
  return `${from}\u0000${to}`
}

/**
 * The order two nodes draw in: the id collator.
 * @param left - one node.
 * @param right - the other node.
 * @returns the collator's ordering of their ids.
 */
function byNodeId(left: GraphNode, right: GraphNode): number {
  return ID_ORDER.compare(left.id, right.id)
}

/**
 * The order two child frames are collected in: the id collator, so input order never reaches the tree.
 * @param left - one frame.
 * @param right - the other frame.
 * @returns the collator's ordering of their ids.
 */
function byFrameId(left: Frame, right: Frame): number {
  return ID_ORDER.compare(left.id ?? "", right.id ?? "")
}

/**
 * The order the `groups` output carries: shallow boxes first, then by id, so a reader sees parents
 * before children.
 * @param left - one group frame.
 * @param right - the other group frame.
 * @returns the depth comparison, refined by the id collator.
 */
function byFrameDepthThenId(left: GroupFrame, right: GroupFrame): number {
  return left.depth - right.depth || ID_ORDER.compare(left.id, right.id)
}

/**
 * Whether a frame draws a box, narrowing it to the shape a {@link GraphGroup} record needs.
 * @param frame - any frame of the tree.
 * @returns whether it is a group frame.
 */
function isGroupFrame(frame: Frame): frame is GroupFrame {
  return frame.id !== null && frame.label !== null
}

/**
 * How a frame is NAMED in a refusal, so the message says where the duplicate ids live.
 * @param frame - the frame to name.
 * @returns a human name: the root frame, or the group's id.
 */
function frameName(frame: Frame): string {
  return frame.id === null ? "the root frame" : `group "${frame.id}"`
}

/**
 * Refuse an id the grouping input puts in two frames; never returns.
 *
 * A duplicate is a caller wiring error, not board data: the id is the join key both planes draw by,
 * and silently keeping one of the two would render a tree nobody declared.
 * @param id - the id declared twice.
 * @param first - the frame that claimed it first.
 * @param second - the frame that claims it again.
 * @returns never.
 */
function refuseDuplicate(id: string, first: Frame, second: Frame): never {
  throw new Error(`mpd-graph-core: the grouping input carries id "${id}" in ${frameName(first)} and ${frameName(second)}; ids must be unique across the whole tree`)
}

/**
 * Record which frame holds an id, refusing a grouping input that reuses one id twice.
 * @param frameOf - the id→frame index, mutated in place.
 * @param id - the id being claimed.
 * @param frame - the frame that holds it.
 */
function claimId(frameOf: Map<string, Frame>, id: string, frame: Frame): void {
  /** The frame that already claimed this id, when there is one. */
  const held = frameOf.get(id)
  if (held !== undefined) refuseDuplicate(id, held, frame)
  frameOf.set(id, frame)
}

/**
 * Collect one declared group into a frame, recursively.
 * @param group - the group the caller declared.
 * @param parent - the frame that contains it.
 * @returns the frame, with its own children collected and ordered by the id collator.
 */
function collectFrame(group: GraphGroupInput, parent: Frame): Frame {
  /** The frame under construction; its children are collected below, once it exists. */
  const frame: Frame = {
    id: group.id,
    label: group.label,
    parent,
    depth: parent.depth + 1,
    board: group.board ?? [],
    children: [],
    ...(group.originTaskId === undefined ? {} : { originTaskId: group.originTaskId }),
    ...(group.plan === undefined ? {} : { plan: group.plan }),
  }
  frame.children = (group.groups ?? []).map((child) => collectFrame(child, frame)).sort(byFrameId)
  return frame
}

/**
 * Every frame of the tree, in draw order: the root first, then each group inside its parent's id
 * order. The order is derived from the tree, never from the caller's array order.
 * @param root - the root frame.
 * @returns the frames, pre-order.
 */
function flattenFrames(root: Frame): Frame[] {
  /** The frames, accumulated in pre-order. */
  const frames: Frame[] = []
  /**
   * Walk one frame and everything under it.
   * @param frame - the frame to visit.
   */
  const walk = (frame: Frame): void => {
    frames.push(frame)
    for (const child of frame.children) walk(child)
  }
  walk(root)
  return frames
}

/**
 * Merge ONE frame's own board and plan, by the same rule the flat model has always applied.
 * @param frame - the frame to merge.
 * @returns its nodes, its declared pairs and its two disagreement lists.
 */
function mergeFrame(frame: Frame): FrameMerge {
  /** The frame's board rows by id; a repeated id keeps the LAST row, as a board rewrite would. */
  const boardById = new Map<string, BoardTask>()
  for (const task of frame.board) boardById.set(task.id, task)
  /** The frame's plan tasks by id; the parser already de-duplicated them. */
  const planById = new Map<string, PlanTask>()
  for (const task of frame.plan?.tasks ?? []) planById.set(task.id, task)
  /** Every id the frame names, ordered by the drawing's collator. */
  const ids = [...new Set([...boardById.keys(), ...planById.keys()])].sort((left, right) => ID_ORDER.compare(left, right))
  /** The frame's nodes, before the rank derivation resolves `depth`. */
  const nodes: GraphNode[] = []
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
    nodes.push({
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
      ...(frame.id === null ? {} : { group: frame.id }),
    })
  }
  /** One entry per pair the frame declared, so the two inputs meet on the same edge. */
  const declared = new Map<string, DeclaredEdge>()
  for (const task of boardById.values()) {
    for (const from of task.blockedBy ?? []) {
      /** The pair's merged entry, created on first sight. */
      const entry = declared.get(pairKey(from, task.id)) ?? { from, to: task.id, board: false, plan: false, derived: false }
      entry.board = true
      declared.set(pairKey(from, task.id), entry)
    }
  }
  for (const task of planById.values()) {
    for (const from of task.blockedBy) {
      /** The pair's merged entry, created on first sight. */
      const entry = declared.get(pairKey(from, task.id)) ?? { from, to: task.id, board: false, plan: false, derived: false }
      entry.plan = true
      declared.set(pairKey(from, task.id), entry)
    }
  }
  return {
    frame,
    nodes,
    declared: [...declared.values()],
    boardOnly: ids.filter((id) => boardById.has(id) && !planById.has(id)),
    planOnly: ids.filter((id) => planById.has(id) && !boardById.has(id)),
  }
}

/**
 * The deepest frame two frames share, which is the frame that DRAWS an edge between them.
 * @param left - one endpoint's frame.
 * @param right - the other endpoint's frame.
 * @returns the lowest common ancestor frame; the root frame when they share nothing deeper.
 */
function lowestCommonFrame(left: Frame, right: Frame): Frame {
  /** The right frame's ancestor chain, so the left walk can stop at the first shared frame. */
  const ancestors = new Set<Frame>()
  for (let frame: Frame | null = right; frame !== null; frame = frame.parent) ancestors.add(frame)
  for (let frame: Frame | null = left; frame !== null; frame = frame.parent) if (ancestors.has(frame)) return frame
  // Unreachable: both chains end at the root frame, which they share. Stated rather than thrown
  // because a model build never fails on a shape it did not read from disk.
  return left
}

/**
 * The id that represents one endpoint inside the frame that draws the edge.
 * @param frame - the frame that holds the endpoint's id.
 * @param home - the shared frame the edge is drawn in.
 * @param id - the endpoint's own id.
 * @returns `id` itself when the frame IS the shared one, else the id of the group frame one level under it.
 */
function anchorAt(frame: Frame, home: Frame, id: string): string {
  if (frame === home) return id
  /** The walk from the endpoint's frame up to the child of `home` that contains it. */
  let current: Frame = frame
  while (current.parent !== home) {
    if (current.parent === null) return id
    current = current.parent
  }
  return current.id ?? id
}

/**
 * The `source` a merged pair draws with: who declared it, or `"derived"` when nobody did.
 * @param entry - the merged pair.
 * @returns the edge's source.
 */
function edgeSource(entry: DeclaredEdge): GraphEdge["source"] {
  if (entry.board && entry.plan) return "both"
  if (entry.plan) return "plan"
  if (entry.board) return "board"
  return "derived"
}

/**
 * Merge one declared pair into the frame that will DRAW it, applying the attachment rule.
 *
 * The pair is LIFTED to the deepest frame both of its endpoints share, and each endpoint is re-anchored
 * to that frame's own id — the endpoint's id when it is drawn there, else the id of the group frame one
 * level under. Two declarations that lift onto the same pair meet in one entry, exactly as the flat
 * merge merges one pair declared twice.
 * @param edgeMaps - each frame's merged pairs, mutated in place.
 * @param frameOf - which frame holds each id.
 * @param entry - the pair as one frame declared (or derived) it.
 */
function placeEdge(edgeMaps: Map<Frame, Map<string, DeclaredEdge>>, frameOf: ReadonlyMap<string, Frame>, entry: DeclaredEdge): void {
  /** The frame holding the blocker, when the tree knows it at all. */
  const fromFrame = frameOf.get(entry.from)
  /** The frame holding the blocked id, when the tree knows it at all. */
  const toFrame = frameOf.get(entry.to)
  // An endpoint naming nothing is DROPPED and reported through `report.unresolved`, which is how the
  // flat merge treats a reference that resolves to no node.
  if (fromFrame === undefined || toFrame === undefined) return
  /** The frame that draws this line. */
  const home = lowestCommonFrame(fromFrame, toFrame)
  /** The blocker, re-anchored to `home`'s own id space. */
  const from = anchorAt(fromFrame, home, entry.from)
  /** The blocked id, re-anchored to `home`'s own id space. */
  const to = anchorAt(toFrame, home, entry.to)
  // A DERIVED spawn edge that collapses onto one id (an origin declared INSIDE the subcell it spawned)
  // states no dependency at all, so it draws nothing. A DECLARED self-reference is kept: the flat model
  // has always drawn one, and it is the caller's own text.
  if (entry.derived && from === to) return
  /** The drawing frame's pair index. */
  const held = edgeMaps.get(home)
  if (held === undefined) return
  /** The pair's merged entry, created on first sight. */
  const merged = held.get(pairKey(from, to)) ?? { from, to, board: false, plan: false, derived: false }
  merged.board = merged.board || entry.board
  merged.plan = merged.plan || entry.plan
  merged.derived = merged.derived || entry.derived
  held.set(pairKey(from, to), merged)
}

/**
 * Build the ONE model both planes draw from the live board and the declared plan.
 *
 * NEVER THROWS on a malformed BOARD OR PLAN: an unresolved reference is reported in
 * `report.unresolved`, a plan line that could not be read is already in `report.planProblems`, and an
 * id only one side carries becomes a node (or, for the plan-only case, a ghost) rather than a dropped
 * row. A GROUPING input that reuses one id in two frames IS refused, and so is a group id that
 * collides with a task id, because the id is the key both planes draw by.
 *
 * THE RESULT IS PLAIN JSON AND ROUND-TRIPS: every node carries an absent optional field as an ABSENT
 * KEY rather than an `undefined` value, so `JSON.parse(JSON.stringify(model))` deep-equals `model`.
 * A build with no `groups` is byte-identical to the flat model this package has always produced.
 * @param input - the board rows, the parsed plan and the subcells, any of which may be missing.
 * @returns the merged model, ranked, with its report.
 */
export function buildModel(input: BuildModelInput): GraphModel {
  /** The root frame: the caller's own board and plan, with the declared subcells nested inside it. */
  const root: Frame = {
    id: null,
    label: null,
    parent: null,
    depth: -1,
    board: input.board ?? [],
    children: [],
    ...(input.plan === undefined ? {} : { plan: input.plan }),
  }
  /** The declared subcells, each collected with its own nested frames. */
  root.children = (input.groups ?? []).map((group) => collectFrame(group, root)).sort(byFrameId)
  /** Every frame of the tree, root first. */
  const frames = flattenFrames(root)
  /** Each frame's own merge, in frame order. */
  const merges = frames.map((frame) => mergeFrame(frame))
  /** Which frame holds each id: every task, and every group's pseudo-node. */
  const frameOf = new Map<string, Frame>()
  for (const merge of merges) for (const node of merge.nodes) claimId(frameOf, node.id, merge.frame)
  /** The nodes drawn INSIDE each frame: the frame's own tasks, plus one box per child group. */
  const level = new Map<Frame, GraphNode[]>()
  for (const merge of merges) level.set(merge.frame, [...merge.nodes].sort(byNodeId))
  /** Every group pseudo-node, in frame order, so the border rule and the `groups` output can reach it. */
  const pseudos: GraphNode[] = []
  for (const frame of frames) {
    if (!isGroupFrame(frame) || frame.parent === null) continue
    /** The frame that draws this box. */
    const parent = frame.parent
    /** The box itself, drawn as a node of the parent frame. */
    const pseudo: GraphNode = {
      id: frame.id,
      subject: frame.label,
      visual: GROUP_VISUAL,
      dependencies: [],
      depth: 0,
      planned: false,
      ...(parent.id === null ? {} : { group: parent.id }),
    }
    claimId(frameOf, frame.id, parent)
    pseudos.push(pseudo)
    level.get(parent)?.push(pseudo)
  }
  /** The pairs that will be drawn in each frame, merged per pair. */
  const edgeMaps = new Map<Frame, Map<string, DeclaredEdge>>()
  for (const frame of frames) edgeMaps.set(frame, new Map())
  for (const merge of merges) for (const entry of merge.declared) placeEdge(edgeMaps, frameOf, entry)
  // THE SPAWN EDGE IS DERIVED, NEVER AUTHORED: a subcell blocked by the task that spawned it. An origin
  // naming no node is reported as unresolved below; one naming a node inside the subcell collapses onto
  // the box itself and is dropped by `placeEdge`.
  for (const frame of frames) {
    if (!isGroupFrame(frame) || frame.originTaskId === undefined) continue
    if (!frameOf.has(frame.originTaskId)) continue
    placeEdge(edgeMaps, frameOf, { from: frame.originTaskId, to: frame.id, board: false, plan: false, derived: true })
  }
  /** The blockers each node is DRAWN with, per frame: the ONE source of the structure below. */
  const drawnDeps = new Map<Frame, Map<string, string[]>>()
  for (const frame of frames) {
    /** This frame's per-node blockers, in pair order. */
    const blockers = new Map<string, string[]>()
    /** This frame's merged pairs. */
    const held = edgeMaps.get(frame)
    if (held !== undefined) {
      for (const entry of held.values()) {
        /** The blockers already listed under the blocked id. */
        const list = blockers.get(entry.to)
        if (list === undefined) blockers.set(entry.to, [entry.from])
        else list.push(entry.from)
      }
    }
    drawnDeps.set(frame, blockers)
  }
  for (const pseudo of pseudos) {
    // THE BOX'S `dependencies` ARE ITS DRAWN ONES: an authored reference into ANY frame is re-anchored
    // onto this border, so the box lists the ids its lines actually start from.
    /** The frame that draws this box. */
    const parent = frameOf.get(pseudo.id)
    if (parent === undefined) continue
    pseudo.dependencies = uniqueSorted(drawnDeps.get(parent)?.get(pseudo.id) ?? [])
  }
  /** Each frame's own rank plan, kept per frame so an interior can be laid out on its own. */
  const layouts = new Map<Frame, RankPlan<GraphNode>>()
  /** The root frame's layout, which is the one that buckets the model's `ranks`. */
  let rootLayout: RankPlan<GraphNode> | undefined
  /** Each frame's nodes as the RANKING and the cycle scan see them: blockers = the DRAWN ones. */
  const drawingNodes = new Map<Frame, GraphNode[]>()
  for (const frame of frames) {
    /** The nodes drawn inside this frame: its own tasks and its child boxes. */
    const nodes = level.get(frame) ?? []
    // RANKING AND CYCLES FOLLOW THE EDGES, NEVER THE AUTHORED TEXT. A reference that crosses a frame
    // border is drawn as a line to (or from) a BOX here, so the column must follow that line: a task
    // blocked by a task INSIDE a subcell ranks behind the box, and two frames that block each other
    // across their borders are a real cycle even though neither ref resolves inside its own frame.
    /** This frame's nodes carrying the drawn blockers, which is what the derivation reads. */
    const drawn = nodes.map((node) => ({ ...node, dependencies: uniqueSorted(drawnDeps.get(frame)?.get(node.id) ?? []) }))
    drawingNodes.set(frame, drawn)
    /** This frame's ranks, derived from its own DRAWN edges only — a frame is a graph of its own. */
    const layout = rankPlan(drawn)
    layouts.set(frame, layout)
    if (frame === root) rootLayout = layout
    for (const node of nodes) node.depth = layout.rankOf.get(node.id) ?? node.depth
  }
  /** Every drawn edge of every frame, ordered by (`from`, then `to`) as the flat model orders them. */
  const edges: GraphEdge[] = []
  for (const frame of frames) {
    /** This frame's merged pairs. */
    const held = edgeMaps.get(frame)
    if (held === undefined) continue
    for (const entry of held.values()) edges.push({ from: entry.from, to: entry.to, source: edgeSource(entry) })
  }
  edges.sort((left, right) => ID_ORDER.compare(left.from, right.from) || ID_ORDER.compare(left.to, right.to))
  /** Every node of every frame, in the id order the flat model draws its nodes in. */
  const nodes = [...merges.flatMap((merge) => merge.nodes), ...pseudos].sort(byNodeId)
  /** The ROOT frame's rank buckets as ids: its own tasks plus the top-level group boxes. */
  const ranks: string[][] = (rootLayout?.ranks ?? []).map((rank) => rank.map((task) => task.id))
  /** Cyclic ids of every frame, joined: a cycle is reported inside the frame that draws it. */
  const cyclic = new Set<string>()
  for (const frame of frames) for (const id of cycleIds(drawingNodes.get(frame) ?? [])) cyclic.add(id)
  /** Every reference the input declared: each node's blockers and each subcell's origin task. */
  const refs = new Set<string>()
  for (const merge of merges) for (const node of merge.nodes) for (const ref of node.dependencies) refs.add(ref)
  for (const frame of frames) if (frame.originTaskId !== undefined) refs.add(frame.originTaskId)
  /** The references that name no task and no group anywhere in the tree. */
  const unresolved = [...refs].filter((ref) => !frameOf.has(ref)).sort()
  /** The report: every disagreement the merge had to decide, plus the derivation's own honesty. */
  const report: GraphReport = {
    boardOnly: sortedIds(merges.flatMap((merge) => merge.boardOnly)),
    planOnly: sortedIds(merges.flatMap((merge) => merge.planOnly)),
    edgePlanOnly: edges.filter((edge) => edge.source === "plan"),
    edgeBoardOnly: edges.filter((edge) => edge.source === "board"),
    planProblems: frames.flatMap((frame) => [...(frame.plan?.problems ?? [])]),
    unresolved,
    ranksDerived: rootLayout?.derived ?? true,
  }
  /** The declared groups, flat and shallow-first, so a renderer can recurse without a second field. */
  const groups = groupRecords(frames, level)
  return { nodes, edges, ranks, cycles: [...cyclic].sort(), report, ...(groups.length === 0 ? {} : { groups }) }
}

/**
 * The `groups` field of a model: every group frame as a plain record, shallow boxes first.
 * @param frames - every frame of the tree, in flatten order.
 * @param level - the nodes drawn inside each frame.
 * @returns the group records; empty when the tree has no group.
 */
function groupRecords(frames: readonly Frame[], level: ReadonlyMap<Frame, GraphNode[]>): GraphGroup[] {
  /** The group records under construction. */
  const groups: GraphGroup[] = []
  for (const frame of frames.filter(isGroupFrame).sort(byFrameDepthThenId)) {
    groups.push({
      id: frame.id,
      label: frame.label,
      parentId: frame.parent === null ? null : frame.parent.id,
      memberIds: sortedIds((level.get(frame) ?? []).map((node) => node.id)),
      depth: frame.depth,
      ...(frame.originTaskId === undefined ? {} : { originTaskId: frame.originTaskId }),
    })
  }
  return groups
}
