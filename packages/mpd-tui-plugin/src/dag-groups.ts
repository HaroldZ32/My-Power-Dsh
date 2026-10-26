// THE GROUP TREE: what a nested DAG has that a flat board does not, computed without drawing a cell.
//
// WHY THIS IS A SEPARATE MODULE. The drawing (`graph.ts`) is one long function whose every step is a
// write into a character grid; the FRAMES are geometry, and geometry is the part that can be proven
// without a canvas. So the tree, the per-frame ranks, the per-frame edges and the box sizes live here
// as pure functions over plain data, and `graph.ts` only paints what this module returns. A test can
// then assert "the inner frame fits inside the outer one" without reading a single glyph.
//
// THE MODEL THIS CONSUMES (`cellwork` wave 4, `mpd-graph-core`): a node names the INNERMOST group it
// draws inside, a group names its parent, its label and the ids DIRECTLY inside it, and every edge has
// already been LIFTED to the deepest frame its two ends share. That last fact is the one this module
// leans on hardest: an edge's two ends are therefore both children of ONE frame, which is what makes
// each frame drawable as its own little board.
//
// THE ONE CONCEPT, STATED ONCE: a GROUP IS A BOX whose interior is that group's own DAG. The box is
// drawn by the frame that CONTAINS the group (so a top-level group is a box in the root frame), and
// its interior is filled by the group's own frame. Nesting is the same rule applied again, which is
// why nothing here has a special case for depth: `buildFrameTree` recurses and the geometry recurses
// with it.
import { rankPlan } from "../../mpd-graph-core/src/rank.ts"

/**
 * ONE GROUP AS THIS MODULE READS IT — a STRUCTURAL declaration, not the core's type.
 *
 * WHY NOT IMPORT THE CORE'S TYPE: the cross-package coupling inventory is COUNTED and FROZEN, and a
 * type-only import is still an edge a reader has to audit. `mpd-tui-plugin` already reaches the core for
 * the ONE rank derivation (`rankPlan`) and for `RankPlan`; a third type edge would say this package
 * depends on the core's SHAPES as well as on its arithmetic. A structural mirror is the repo's own
 * convention for exactly this case — every field below is one the wire model carries, so a real group
 * record assigns to it without conversion and nothing here invents a field.
 */
export interface GroupedGroup {
  /** The frame's id, which is also the id of its pseudo-node inside the parent frame. */
  id: string
  /** The frame's display title, drawn on the box's border. */
  label: string
  /** The enclosing group's id, or `null` when the box sits directly inside the root frame. */
  parentId: string | null
  /** The ids drawn DIRECTLY inside this frame: its own tasks plus its immediate child groups. */
  memberIds: readonly string[]
  /** Nesting depth: `0` for a box inside the root frame, one more for every enclosing group. */
  depth: number
  /** The task that spawned this subcell, when the producer recorded one. */
  originTaskId?: string
}

/** A group's frame id, or `null` for the root frame — the frame drawn with no box around it. */
export type FrameId = string | null

/** The least a task must say for the tree to place it: its id, its group and its blockers. */
export interface GroupedTask {
  /** The task id the drawing labels and the caller focuses by. */
  id: string
  /** The INNERMOST group this task draws inside; absent for a root task. */
  group?: string
  /** The SERVED column inside its own frame, when a model published one. */
  depth: number
  /** The boxes this task is blocked by, in board order — the drawing's only edge source. */
  dependencies?: readonly string[]
}

/** One entity drawn inside a frame: a task, or a group's box. */
export interface FrameChild {
  /** Which kind of box this is. */
  kind: "task" | "group"
  /** The task id, or the group id. */
  id: string
  /** The group's own record, for a group child; absent for a task. */
  group?: GroupedGroup
  /** The child frame this box's interior is, for a group child; absent for a task. */
  frame?: FrameNode
}

/** One frame of the tree: the root, or a group's interior. */
export interface FrameNode {
  /** The group id whose interior this frame is; `null` for the root frame. */
  id: FrameId
  /** The box title drawn on the frame's top border; `null` for the root frame. */
  label: string | null
  /** The enclosing frame; `null` for the root frame. */
  parent: FrameNode | null
  /** Nesting depth: `0` for the root frame, one more for every enclosing group. */
  depth: number
  /** The boxes drawn directly inside this frame, in placement order. */
  children: FrameChild[]
  /** The frame of every group child, by the group id. */
  childFrames: Map<string, FrameNode>
}

/** The whole tree, plus what could not be placed. */
export interface FrameTree {
  /** The frame with no box around it. */
  root: FrameNode
  /** Every frame, the root included, by its group id (`null` for the root). */
  frames: Map<FrameId, FrameNode>
  /** The task → frame assignment, for a caller that needs to re-read it. */
  frameOfTask: Map<string, FrameId>
  /**
   * The group ids the tree could NOT place: an unknown parent, a parent cycle, or a member id that
   * collides with a task. They are drawn COLLAPSED — never half-drawn — which is the same rule the
   * panel applies when the width cannot hold a frame.
   */
  collapsed: string[]
}

/**
 * Whether two ids are the same frame id, written once so the `null` root compares without a branch.
 * @param left - one frame id.
 * @param right - the other frame id.
 * @returns whether they name the same frame.
 */
export function sameFrame(left: FrameId, right: FrameId): boolean {
  return left === right
}

/**
 * Build the frame tree from the board and the group records.
 *
 * TOTAL AND DEFENSIVE: a task naming a group the input does not carry falls back to the ROOT frame
 * (and the group is not reported, because the task is what named it), while a GROUP that cannot be
 * reached — an unknown parent, or a parent chain that returns to it — is COLLAPSED and reported. A
 * tree that refused to build would take the whole picture down for one bad id; a collapsed group is
 * still named in the drawing.
 *
 * @param tasks - the rows to place, each naming its innermost group.
 * @param groups - the group records, flat and in any order.
 * @returns the tree, the frames and the collapsed ids.
 */
export function buildFrameTree(tasks: readonly GroupedTask[], groups: readonly GroupedGroup[]): FrameTree {
  /** Every group record the input carries, by id. */
  const byId = new Map<string, GroupedGroup>()
  for (const group of groups) if (!byId.has(group.id)) byId.set(group.id, group)
  /** The task ids, so a group whose id collides with a task is refused rather than shadowed. */
  const taskIds = new Set(tasks.map((task) => task.id))
  /** The ids this tree could not place. */
  const collapsed: string[] = []
  /** The frame built for each group id, once its own parent is known to be reachable. */
  const frameByGroup = new Map<string, FrameNode>()
  /** The tasks that landed in the root frame, used before any group frame exists. */
  const root: FrameNode = { id: null, label: null, parent: null, depth: 0, children: [], childFrames: new Map() }
  /** Every frame, the root included. */
  const frames = new Map<FrameId, FrameNode>([[null, root]])
  /** The frame each task draws inside, after the parent lookups. */
  const frameOfTask = new Map<string, FrameId>()

  /**
   * The group ids that can be placed: a parent that is the root (`null`) or a knwown group, with no
   * cycle in the parent chain. A group whose chain returns to it can never be built, and one whose
   * parent is unknown has nothing to hang from.
   * @param id - the group id to test.
   * @returns whether the group's whole parent chain reaches the root frame.
   */
  const reachable = (id: string): boolean => {
    /** The ids walked so far, which is how a cycle is detected without a second structure. */
    const seen = new Set<string>()
    /** The id being walked. */
    let cursor: string | null = id
    while (cursor !== null) {
      if (seen.has(cursor)) return false
      seen.add(cursor)
      /** The group the cursor names, when the input carries it. */
      const group: GroupedGroup | undefined = byId.get(cursor)
      if (group === undefined) return false
      cursor = group.parentId
    }
    return true
  }

  /** The group ids in a deterministic build order: shallow-first, then by id. */
  const order: string[] = [...byId.values()]
    .map((group) => group.id)
    .sort((left, right) => (byId.get(left) as GroupedGroup).depth - (byId.get(right) as GroupedGroup).depth || (left < right ? -1 : left > right ? 1 : 0))

  for (const id of order) {
    // A group colliding with a task id is a caller wiring error the MODEL already refuses; a projection
    // joining two producers can still hand one to the drawing, so it is collapsed here instead of
    // silently replacing a task box.
    if (taskIds.has(id) || !reachable(id)) {
      collapsed.push(id)
      continue
    }
    /** The group record being placed. */
    const group = byId.get(id) as GroupedGroup
    /** The frame that DRAWS this group's box: the parent group's frame, or the root. */
    const parentFrame: FrameNode = group.parentId === null ? root : frames.get(group.parentId) ?? root
    /** This group's own frame, which its members are placed into. */
    const frame: FrameNode = { id: group.id, label: group.label, parent: parentFrame, depth: parentFrame.depth + 1, children: [], childFrames: new Map() }
    frames.set(group.id, frame)
    frameByGroup.set(group.id, frame)
    // The BOX is drawn by the parent frame, so the parent gets the child; the interior is `frame`.
    parentFrame.children.push({ kind: "group", id: group.id, group, frame })
    parentFrame.childFrames.set(group.id, frame)
  }

  for (const task of tasks) {
    /** The frame this task draws inside: its innermost group when that frame exists, else the root. */
    const frame: FrameNode | undefined = task.group === undefined ? root : frames.get(task.group)
    /** The frame the task is placed in: the one its group named, or the root when that group collapsed. */
    const home = frame ?? root
    home.children.push({ kind: "task", id: task.id })
    frameOfTask.set(task.id, home.id)
  }
  return { root, frames, frameOfTask, collapsed }
}

/** One edge as a single frame draws it, both of its ends already anchored to boxes of that frame. */
export interface FrameEdge {
  /** The id of the frame that draws this line. */
  frame: FrameId
  /** The blocker's box id: a task id, or the id of the group box it was lifted to. */
  from: string
  /** The blocked box's id, anchored the same way. */
  to: string
  /**
   * Whether the blocker's real endpoint is DEEPER than the box this frame draws.
   *
   * TRUE means the line reaches only an enclosing group's box, i.e. it has to CROSS that box's border
   * to arrive anywhere, which the drawing paints as a crossing rather than as an arrival. FALSE is the
   * ordinary case: the line terminates on the box it names.
   */
  fromDeeper: boolean
  /** Whether the blocked end is deeper than the box this frame draws; see {@link FrameEdge.fromDeeper}. */
  toDeeper: boolean
}

/** The edges of one frame, keyed by the frame id. */
export type FrameEdges = Map<FrameId, FrameEdge[]>

/**
 * Anchor one endpoint to the box the DRAWN frame can see.
 *
 * The walk climbs FRAMES, and one climb is one box: leaving frame `F` upward means the box the parent
 * draws is `F`'s own group box, so the id becomes `F.id`. The walk therefore ends either at the
 * endpoint itself (it is a box of the drawn frame, the ordinary case) or at an enclosing group's box
 * — and in that second case the caller learns the line has to CROSS that box's border to arrive
 * anywhere, which is what `deeper` reports.
 * @param endpoint - the task or group id the edge names.
 * @param endpointFrame - the frame the endpoint's BOX is drawn in.
 * @param drawnFrame - the frame that draws this line.
 * @returns the box id this frame draws, and whether it had to climb to reach it.
 */
function anchorOf(endpoint: string, endpointFrame: FrameNode, drawnFrame: FrameNode): { id: string; deeper: boolean } {
  /** The frame whose box the walk is currently naming. */
  let frame: FrameNode = endpointFrame
  /** The box id, replaced by the enclosing group's id on every climb. */
  let id = endpoint
  /** Whether any frame was climbed, which is the anchor's own depth report. */
  let deeper = false
  while (!sameFrame(frame.id, drawnFrame.id)) {
    // The chain always reaches the root, so this arm is unreachable for a tree this module built; it is
    // kept so a caller that hands over a detached frame loses the climb, not the line.
    if (frame.parent === null) return { id, deeper: true }
    id = frame.id as string
    frame = frame.parent
    deeper = true
  }
  return { id, deeper }
}

/**
 * Distribute the board's edges into the ONE frame that draws each of them.
 *
 * The LIFT is the model's own rule (an edge belongs to the deepest frame its two ends share); this
 * function re-applies it because a projection can join a model to a board that moved after the model
 * was built. Two edges that collapse onto the same pair of boxes are MERGED — a fan-in from three
 * outer tasks draws ONE port on the box, exactly as the model reports one edge.
 *
 * @param tasks - the rows, each naming its innermost group.
 * @param tree - the tree the endpoints are resolved through.
 * @param groups - the group records, so a dependency naming a group id resolves to its box.
 * @returns the edges bucketed by drawing frame, in board order.
 */
export function frameEdges(tasks: readonly GroupedTask[], tree: FrameTree, groups: readonly GroupedGroup[]): FrameEdges {
  /** The frame a box id is drawn in, or undefined when the id names nothing this tree placed. */
  const frameOf = (id: string): FrameNode | undefined => {
    /** The frame a task's own box draws in. */
    const home = tree.frameOfTask.get(id)
    if (home !== undefined) return tree.frames.get(home)
    /** The frame a group's BOX draws in, which is its parent's frame — never its own interior. */
    const boxIn = tree.frames.get(id)
    return boxIn === undefined ? undefined : boxIn.parent ?? undefined
  }
  /** The merged edges, keyed by drawing frame and anchored pair, so a fan-in collapses onto one port. */
  const merged = new Map<string, FrameEdge>()
  // A group id is a legal endpoint (a box is a node of its parent frame); `groups` is accepted so a
  // caller can pass the records the tree was built from and read this signature as the whole input.
  void groups
  for (const task of tasks) {
    /** The frame this task's box draws in. */
    const toFrame = frameOf(task.id)
    if (toFrame === undefined) continue
    for (const from of task.dependencies ?? []) {
      // A self-reference draws nothing, and an id nobody carries is the report's business, not the pen's.
      if (from === task.id) continue
      /** The frame the blocker's box draws in, when this tree placed it. */
      const fromFrame = frameOf(from)
      if (fromFrame === undefined) continue
      /** The frame that draws this line: the lowest frame both boxes are visible from. */
      const drawn = drawnFrameOf(fromFrame, toFrame)
      /** The blocker, anchored to a box of `drawn`. */
      const anchorFrom = anchorOf(from, fromFrame, drawn)
      /** The blocked end, anchored the same way. */
      const anchorTo = anchorOf(task.id, toFrame, drawn)
      /** The merged entry's key, in the drawn frame's own id space. */
      const key = `${drawn.id ?? "\u0000root"}\u0000${anchorFrom.id}\u0000${anchorTo.id}`
      /** The entry already drawn for this box pair, when a previous endpoint collapsed onto it. */
      const held = merged.get(key)
      if (held !== undefined) {
        // A second outer endpoint reaching the SAME box port is the same dependency the reader sees, so
        // the flags are merged rather than a duplicate line being drawn on top of the first.
        held.fromDeeper = held.fromDeeper || anchorFrom.deeper
        held.toDeeper = held.toDeeper || anchorTo.deeper
        continue
      }
      merged.set(key, { frame: drawn.id, from: anchorFrom.id, to: anchorTo.id, fromDeeper: anchorFrom.deeper, toDeeper: anchorTo.deeper })
    }
  }
  /** The edges by frame, in insertion order, which is board order. */
  const byFrame: FrameEdges = new Map()
  for (const edge of merged.values()) {
    /** This frame's list, created on first sight. */
    const list = byFrame.get(edge.frame) ?? []
    list.push(edge)
    byFrame.set(edge.frame, list)
  }
  return byFrame
}

/**
 * The frame that draws an edge between two entities: the deeper one when one frame contains the other,
 * else the lowest frame both of them live in.
 * @param left - one endpoint's frame.
 * @param right - the other endpoint's frame.
 * @returns the frame whose grid the line is routed in.
 */
function drawnFrameOf(left: FrameNode, right: FrameNode): FrameNode {
  /** The chain from one frame up to the root, so containment is a lookup rather than a walk per step. */
  const chain = new Set<FrameId>()
  for (let cursor: FrameNode | null = left; cursor !== null; cursor = cursor.parent) chain.add(cursor.id)
  for (let cursor: FrameNode | null = right; cursor !== null; cursor = cursor.parent) if (chain.has(cursor.id)) return cursor
  return left
}

/** Which boxes of a frame sit in which SERVED column, and in what row order. */
export interface FrameRanks {
  /** The columns in draw order, each holding its boxes in row order. */
  columns: FrameChild[][]
  /** The column index each box id draws in. */
  rankOf: Map<string, number>
}

/**
 * Rank ONE frame's children, top to bottom.
 *
 * THE SERVED COLUMN WINS when the caller published a model: that column is the graph core's own answer
 * for this frame ("depth is the column INSIDE its frame"), and re-deriving it here would be a second
 * implementation of a shared derivation. With no served column the frame derives its own, through the
 * SAME core function the flat drawing uses, so a grouped picture cannot rank differently from a flat
 * one over the same frame.
 *
 * @param frame - the frame whose children are ranked.
 * @param edges - the edges this frame draws (used only when a column must be derived).
 * @param servedColumns - the served column per box id, when a model published one.
 * @returns the columns and the column index per box id.
 */
export function rankFrame(frame: FrameNode, edges: readonly FrameEdge[], servedColumns: ReadonlyMap<string, number> | undefined): FrameRanks {
  /** The box ids of this frame, in placement order. */
  const ids = frame.children.map((child) => child.id)
  /** Whether every child carries a served column, which is the condition for using it wholesale. */
  const served = servedColumns !== undefined && ids.every((id) => servedColumns.has(id))
  /** The column index per box id. */
  const rankOf = new Map<string, number>()
  if (served) {
    for (const id of ids) rankOf.set(id, Math.max(0, Math.floor(servedColumns.get(id) as number)))
  } else {
    // The core's own derivation over this frame's boxes: a box is blocked by the boxes this frame's
    // edges name as its blockers.
    /** The blockers of each box id, in this frame's own id space. */
    const blockers = new Map<string, string[]>()
    /** The box ids, so an edge naming a box that is not here is ignored. */
    const known = new Set(ids)
    for (const edge of edges) {
      if (!known.has(edge.from) || !known.has(edge.to)) continue
      /** This box's blocker list. */
      const list = blockers.get(edge.to) ?? []
      list.push(edge.from)
      blockers.set(edge.to, list)
    }
    /** The derivation's plan over the frame's boxes. */
    const plan = rankPlan(ids.map((id) => ({ id, depth: 0, dependencies: blockers.get(id) ?? [] })))
    for (const id of ids) rankOf.set(id, plan.rankOf.get(id) ?? 0)
  }
  /** How many columns the frame has. */
  const count = ids.reduce((max, id) => Math.max(max, (rankOf.get(id) ?? 0) + 1), 0)
  /** The columns, each filled in child order (which is the caller's board order). */
  const columns: FrameChild[][] = Array.from({ length: count }, () => [])
  for (const child of frame.children) (columns[rankOf.get(child.id) ?? 0] as FrameChild[]).push(child)
  return { columns, rankOf }
}

/** One frame's measured interior, in cells. */
export interface FrameSize {
  /** Width in cells, borders included for a group frame, the grid's own width for the root. */
  width: number
  /** Height in rows, borders included for a group frame. */
  height: number
  /** The interior's own width and height: the part the members are placed in. */
  innerWidth: number
  /** The interior's own height. */
  innerHeight: number
}

/** What one frame's measurement needs to know about its children. */
export interface ChildSize {
  /** The child's box width in cells. */
  width: number
  /** The child's box height in rows. */
  height: number
}

/** The gap between two boxes standing side by side in one column. */
export const GROUP_COLUMN_GAP = 3

/**
 * The rows a frame spends between two columns: the bus a horizontal run jogs on, the arrow row, and
 * the row the `▼`'s tip touches. The flat drawing's own stride is the same shape (`RANK_STRIDE`), and a
 * grouped drawing reuses it so a nested box cannot look tighter than a flat one.
 */
export const GROUP_BAND_ROWS = 4

/** The frame border's own thickness, in cells: a group's box is its interior plus one on each side. */
export const GROUP_BORDER = 1

/**
 * The columns a drawing actually spends rows on: every column with at least one box.
 *
 * A SERVED column can be EMPTY (a rank a plan skipped), and an empty bucket that kept its slot would
 * put a band of blank rows into the middle of a picture — the flat drawing's own lesson (clause A2),
 * applied one level down. The index a box keeps is the column it was SERVED, so the columns are read
 * in order and the holes are closed for the LAYOUT only.
 * @param columns - the frame's columns, index = the column a box was served.
 * @returns the non-empty columns, in serve order.
 */
export function drawnColumns(columns: readonly FrameChild[][]): FrameChild[][] {
  return columns.filter((column) => column.length > 0)
}

/**
 * The DRAWN column each box sits in, with the served holes already closed.
 *
 * THE ARRAYS A DRAWER INDEXES ARE THE DRAWN ONES. `drawFrame` lays out `drawnColumns(...)`, so the column
 * bottoms, the box rectangles per drawn column and the adjacency `to === from + 1` are all positions in
 * THAT array — a served rank stops being a valid index the moment an empty served column is closed.
 * Taking every index from here is what keeps the three agreeing (CodeRabbit 4377306778: the lane budget
 * and the frame-edge drawer read served ranks and could index past the drawn arrays).
 * @param columns - a frame's columns, index = the column a box was served.
 * @returns the drawn column of every box id, and how many drawn columns there are.
 */
export function drawnRankOf(columns: readonly FrameChild[][]): { rankOf: Map<string, number>; count: number } {
  /** The non-empty columns, which is the array every drawn index refers to. */
  const used = drawnColumns(columns)
  /** The drawn column of each box id. */
  const rankOf = new Map<string, number>()
  used.forEach((column, index) => { for (const child of column) rankOf.set(child.id, index) })
  return { rankOf, count: used.length }
}

/**
 * Measure one frame from its children's sizes.
 *
 * THE LANE BUDGET IS PART OF THE WIDTH, and that is the decision this function exists to make: a
 * long edge (one that skips a column) is routed down a column of its own, and a frame that did not
 * reserve those columns would push its own border out to hold them — which is a frame that changes
 * size depending on where an edge happened to run. Reserving `longEdges` extra interior columns,
 * counted before anything is drawn, makes the size a function of the INPUT alone.
 * @param columns - the frame's columns, each holding its boxes.
 * @param sizes - the measured size of every child box, by id.
 * @param longEdges - how many edges of this frame skip a column.
 * @param bordered - whether this frame draws a box around its interior (a group), or is the root.
 * @returns the frame's size, borders included when it is a group.
 */
export function measureFrame(columns: readonly FrameChild[][], sizes: ReadonlyMap<string, ChildSize>, longEdges: number, bordered: boolean): FrameSize {
  /** The columns that carry boxes; an empty served column spends no rows. */
  const used = drawnColumns(columns)
  /** The widest column's own width in cells. */
  const widest = used.reduce((max, column) => {
    /** This column's width: its boxes and the gaps between them. */
    let width = 0
    column.forEach((child, index) => { width += (sizes.get(child.id)?.width ?? 0) + (index === 0 ? 0 : GROUP_COLUMN_GAP) })
    return Math.max(max, width)
  }, 0)
  /** The columns' heights, summed with one band between each neighbouring pair. */
  const height = used.reduce((sum, column, index) => {
    /** The tallest box of this column, which is the column's own height. */
    const tallest = column.reduce((tall, child) => Math.max(tall, sizes.get(child.id)?.height ?? 0), 0)
    return sum + tallest + (index === 0 ? 0 : GROUP_BAND_ROWS)
  }, 0)
  /** The interior width, with the lane columns a long edge needs reserved inside the frame. */
  const innerWidth = widest + Math.max(0, longEdges)
  /** The border's own cost on each axis, zero for the root frame. */
  const pad = bordered ? GROUP_BORDER : 0
  return { width: innerWidth + pad * 2, height: height + pad * 2, innerWidth, innerHeight: height }
}
