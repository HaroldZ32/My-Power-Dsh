// THE BEFORE/AFTER GEOMETRY OF ONE RANK-SKIPPING EDGE — the measurement behind the report.
//
// It loads the SHIPPED factory the way the test file does (type-strip, then evaluate the arrow
// expression), routes the captain's five-rank board with the CURRENT code, and reconstructs the route
// the REMOVED formula drew for `T2→T7` so the two can be compared and the old one can be checked
// against the boxes it used to cross.
//
// Run: bun evidence/tui/dag-port/web-dag/<ts>/before-after.mts
import { readFileSync } from "node:fs"
import ts from "typescript5"

/** The view module the factory returns, as this script reads it. */
interface ViewModule {
  /** The pure geometry of one board. */
  layout: (tasks: Array<Record<string, unknown>>) => Graph
}

/** One painted rectangle. */
interface Rect {
  /** The left x. */
  left: number
  /** The top y. */
  top: number
  /** The width. */
  width: number
  /** The height. */
  height: number
}

/** The geometry the layout hands back. */
interface Graph {
  /** The ranks, in draw order. */
  columns: Array<Array<{ id: string }>>
  /** Every node's box. */
  nodes: Array<{ task: { id: string }; rank: number; row: number; top: number }>
  /** Every routed edge. */
  edges: Array<{ parent: string; child: string; segments: Array<{ key: string; rect: Rect }>; marker: Rect }>
  /** The computed box inset. */
  inset: number
  /** The measured gutter. */
  gutter: number
  /** The busiest gutter's lane count. */
  maxLanes: number
  /** Lanes that could not be placed distinctly. */
  laneOverflow: number
}

/** The board from the user's screenshot: five ranks, eight rank-skipping edges. */
const BOARD: Array<Record<string, unknown>> = [
  { id: "T1", subject: "freeze the contract", visual: "completed", kind: "requirement", blockedBy: [], depth: 0 },
  { id: "T2", subject: "the layout engine", visual: "running", kind: "work", blockedBy: [], depth: 0 },
  { id: "T3", subject: "the panels", visual: "running", kind: "work", blockedBy: [], depth: 0 },
  { id: "T4", subject: "the surface redesign", visual: "open", kind: "work", blockedBy: [], depth: 0 },
  { id: "T5", subject: "the invisible panel", visual: "open", kind: "work", blockedBy: [], depth: 0 },
  { id: "T6", subject: "wire the panels", visual: "blocked", kind: "work", blockedBy: ["T3"], depth: 1 },
  { id: "T11", subject: "sidebar adapters", visual: "blocked", kind: "work", blockedBy: ["T2"], depth: 1 },
  { id: "T12", subject: "the panel seam", visual: "blocked", kind: "work", blockedBy: ["T6"], depth: 1 },
  { id: "T7", subject: "independent verification", visual: "blocked", kind: "review", blockedBy: ["T2", "T3", "T4", "T6"], depth: 2 },
  { id: "T9", subject: "bilingual docs", visual: "blocked", kind: "work", blockedBy: ["T2", "T3", "T4", "T5", "T6"], depth: 2 },
  { id: "T8", subject: "visual fidelity", visual: "blocked", kind: "review", blockedBy: ["T7"], depth: 3 },
  { id: "T10", subject: "integration", visual: "blocked", kind: "integration", blockedBy: ["T7", "T8", "T9"], depth: 4 },
]

/** The four sizes the OLD code routed against: a fixed 4px inset in a 168px column. */
const OLD = { column: 168, inset: 4, nodeHeight: 42, nodeGap: 10, pad: 4 }

/** Whether one rectangle overlaps another's INTERIOR, borders excluded. */
function enters(run: Rect, box: Rect): boolean {
  /** The box without its one-pixel border. */
  const inner = { left: box.left + 1, top: box.top + 1, width: box.width - 2, height: box.height - 2 }
  return run.left < inner.left + inner.width && inner.left < run.left + run.width
    && run.top < inner.top + inner.height && inner.top < run.top + run.height
}

/** One box of the OLD layout, in its own fixed geometry. */
function oldBox(rank: number, row: number): Rect {
  return { left: rank * OLD.column + OLD.inset, top: OLD.pad + row * (OLD.nodeHeight + OLD.nodeGap), width: OLD.column - OLD.inset * 2, height: OLD.nodeHeight }
}

// The source, type-stripped and evaluated exactly as the test file does.
const source = readFileSync("packages/mpd-bundle-plugin/src/team-view.ts", "utf8")
const stripped = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const factory = new Function("return (" + stripped.trim().replace(/;$/, "") + ")")() as (deps: unknown) => { createTeamView: (deps: unknown) => ViewModule }
const view = factory({}).createTeamView({ react: null, statePath: "/x" })
const graph = view.layout(BOARD)

console.log("AFTER  inset=" + graph.inset, "gutter=" + graph.gutter, "maxLanes=" + graph.maxLanes, "laneOverflow=" + graph.laneOverflow)
console.log("AFTER  ranks=" + graph.columns.length, "rank sizes=" + JSON.stringify(graph.columns.map((column) => column.length)))
/** The long edge the comparison follows: rank 0 → rank 2, over rank 1's column. */
const long = graph.edges.find((edge) => edge.parent === "T2" && edge.child === "T7") as Graph["edges"][number]
console.log("AFTER  T2->T7 = " + long.segments.map((segment) => segment.key + "[" + segment.rect.left + "," + segment.rect.top + " " + segment.rect.width + "x" + segment.rect.height + "]").join(" "))
/** Every AFTER run of every edge, each with the edge that painted it. */
const afterRuns: Array<{ edge: string; rect: Rect }> = []
for (const edge of graph.edges) for (const segment of edge.segments) afterRuns.push({ edge: edge.parent + "->" + edge.child, rect: segment.rect })
/** Every box as the CURRENT layout places it. */
const afterBoxes: Rect[] = graph.nodes.map((node) => ({ left: node.rank * OLD.column + graph.inset, top: node.top, width: OLD.column - graph.inset * 2, height: OLD.nodeHeight }))
/** How many (run, box) pairs the current routing puts in overlap. */
let afterCrossings = 0
for (const run of afterRuns) for (const box of afterBoxes) if (enters(run.rect, box)) afterCrossings += 1
console.log("AFTER  run/box interior overlaps over the WHOLE graph: " + afterCrossings + " (of " + afterRuns.length + " runs x " + afterBoxes.length + " boxes)")

// ── THE REMOVED ROUTE, reconstructed so the claim about it is a MEASUREMENT and not a memory ─────
// The old `edgeOf` took the space between the two END boxes as "the band the riser lives in", gave the
// edge the per-source lane `0, +3, -3, …` and CLAMPED the riser into that band.
const parentRight = 0 * OLD.column + OLD.column - OLD.inset
const childLeft = 2 * OLD.column + OLD.inset
const bandCentre = (parentRight + childLeft) / 2
const laneLeft = Math.min(parentRight, childLeft) + 1
const laneRight = Math.max(parentRight, childLeft) - 1
// T2's SECOND edge, in the old board order (T11←T2 is its first), so its lane was +3.
const riserX = Math.round(Math.max(laneLeft, Math.min(laneRight, bandCentre + 3)))
const outY = OLD.pad + 1 * (OLD.nodeHeight + OLD.nodeGap) + OLD.nodeHeight / 2
const inY = OLD.pad + 0 * (OLD.nodeHeight + OLD.nodeGap) + OLD.nodeHeight / 2
/** The three runs the removed formula painted for T2→T7. */
const oldRuns: Rect[] = [
  { left: Math.min(parentRight, riserX), top: outY, width: Math.max(Math.abs(riserX - parentRight), 1), height: 1 },
  { left: riserX, top: Math.min(outY, inY), width: 1, height: Math.max(Math.abs(inY - outY), 1) },
  { left: Math.min(riserX, childLeft), top: inY, width: Math.abs(childLeft - riserX) + 1, height: 1 },
]
console.log("BEFORE T2->T7 band=[" + laneLeft + "," + laneRight + "] centre=" + bandCentre + " lane=+3 riserX=" + riserX)
console.log("BEFORE T2->T7 = " + oldRuns.map((rect, index) => ["out", "riser", "in"][index] + "[" + rect.left + "," + rect.top + " " + rect.width + "x" + rect.height + "]").join(" "))
/** The boxes rank 1 drew, in the OLD fixed geometry. */
const rank1 = [oldBox(1, 0), oldBox(1, 1), oldBox(1, 2)]
for (const [index, run] of oldRuns.entries()) {
  /** The rank-1 boxes this one run stood inside. */
  const hit = rank1.map((box, at) => ({ at, inside: enters(run, box) })).filter((entry) => entry.inside).map((entry) => "rank1.row" + entry.at)
  console.log("BEFORE " + ["out", "riser", "in"][index] + " crosses: " + (hit.length === 0 ? "nothing" : hit.join(", ")))
}
/** How many rank-1 boxes the removed riser ran through, which is the tangle in the screenshot. */
const oldCrossings = oldRuns.filter((run) => rank1.some((box) => enters(run, box))).length
console.log("BEFORE runs crossing a rank-1 box: " + oldCrossings + " of 3")
