// CAPTAIN'S INDEPENDENT CHECK of the WEB curved-edge lane (scratch, gitignored).
//
// WHY THIS EXISTS. The lane's own suite proves containment with the lane's own instrument. A captain
// who reads that number and repeats it has verified nothing: the check and the code were written by the
// same seat. Here the JUDGE IS MINE — the segment-vs-box-interior test below imports nothing from the
// lane's tests and re-implements the predicate from the definition ("a curve may abut a border, never
// enter the interior"), then runs it over the points the LAYOUT publishes.
//
// It also checks the two things the user's requirements are actually about: no CJK inside the drawing,
// and the edge really being a curve (a `Q` fillet plus a `C` sweep) rather than an orthogonal line.
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript5"

/** Repository root, found by walking up to the bundle manifest so the script runs from anywhere. */
const ROOT = ((): string => {
  /** The directory the search starts from. */
  let dir = import.meta.dir
  for (let step = 0; step < 12; step += 1) {
    if (existsSync(join(dir, "package.json")) && readFileSync(join(dir, "package.json"), "utf8").includes('"@mpd-dsh/mpd"')) return dir
    dir = join(dir, "..")
  }
  throw new Error("repository root not found above " + import.meta.dir)
})()
/** The shipped WEB drawing source. */
const SOURCE = readFileSync(join(ROOT, "packages", "mpd-bundle-plugin", "src", "team-view.ts"), "utf8")

/** The layout constants the source declares, read by name so a moved literal cannot silently pass. */
function geoConstant(name: string): number {
  /** The declaration's own numeric literal. */
  const found = new RegExp(String.raw`\b${name}:\s*(\d+)`).exec(SOURCE)
  if (found === null) throw new Error("GEO." + name + " not found in the source")
  return Number(found[1])
}

/** One published curve point. */
interface Pt {
  x: number
  y: number
}
/** One drawn edge as the layout publishes it. */
interface Edge {
  parent: string
  child: string
  witness: string
  segments: Array<{ key: string; rect: { left: number; top: number; width: number; height: number } }>
  curve: { d: string; points: Pt[]; tip: Pt; radius: number }
}
/** One node's box, in canvas pixels. */
interface Box {
  id: string
  left: number
  top: number
  width: number
  height: number
}

/**
 * Whether a segment enters a box's INTERIOR.
 *
 * The box is shrunk by one pixel on every side first, so an edge that merely ABUTS the border it attaches
 * to is not a violation — matching the lane's stated tolerance for a different reason: I want the
 * predicate to be the definition, not a copy of their tolerance.
 * @param a - the segment's first endpoint.
 * @param b - the segment's second endpoint.
 * @param box - the box to test against.
 * @returns true when any part of the segment lies strictly inside the shrunk box.
 */
function entersInterior(a: Pt, b: Pt, box: Box): boolean {
  /** The interior rectangle: the box pulled in by one pixel on each side. */
  const left = box.left + 1
  const right = box.left + box.width - 1
  const top = box.top + 1
  const bottom = box.top + box.height - 1
  if (right <= left || bottom <= top) return false
  // Liang–Barsky clip of the segment against the interior rectangle, written out rather than imported.
  /** The parametric interval still inside the slab, starting as the whole segment. */
  let t0 = 0
  let t1 = 1
  /** The segment's own delta. */
  const dx = b.x - a.x
  const dy = b.y - a.y
  for (const [p, q] of [[-dx, a.x - left], [dx, right - a.x], [-dy, a.y - top], [dy, bottom - a.y]] as Array<[number, number]>) {
    if (p === 0) {
      if (q < 0) return false
      continue
    }
    /** The parameter at which this boundary is crossed. */
    const r = q / p
    if (p < 0) {
      if (r > t1) return false
      if (r > t0) t0 = r
    } else {
      if (r < t0) return false
      if (r < t1) t1 = r
    }
  }
  return true
}

/** Whether a string contains any CJK / full-width codepoint (the drawing must contain none). */
function hasCjk(text: string): boolean {
  return /[\u2E80-\u2FFF\u3000-\u303F\u3040-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]/u.test(text)
}

// ── load the shipped factory exactly as the build wraps it ────────────────────────────────────────
/** The source with its types stripped, evaluated as the expression the client bundle splices in. */
const stripped = ts.transpileModule(SOURCE, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
/** The factory function itself. */
const factory = new Function("return (" + stripped.trim().replace(/;$/, "") + ")")() as (deps: unknown) => {
  createTeamView: (deps: unknown) => {
    layout: (tasks: unknown[], radius?: number) => { nodes: Array<{ task: { id: string }; rank: number; row: number; top: number }>; edges: Edge[]; inset: number; rankCount: number; width: number }
    graphSafeLabel: (subject: string, ordinal: number) => string
  }
}
/** The react surface the factory demands; `layout` never touches it, so a stub is honest here. */
const reactStub = { createElement: () => null, useEffect: () => undefined, useState: (initial: unknown) => [initial, () => undefined] }
/** The view module under test. */
const view = factory({ createElement: () => null }).createTeamView({ react: reactStub, statePath: "/x", planPath: "/y", taskPath: "/z" })

// ── the board: PURE Chinese subjects, a rank-skipping edge, and a same-row pair ───────────────────
/** The board, in the order the store serves it (which is what defines the ordinal). */
const TASKS = [
  { id: "T1", subject: "冻结验收契约", kind: "requirement", status: "completed", visual: "completed", blockedBy: [], failedBy: [], depth: 0 },
  { id: "T2", subject: "建立头部与进度条", kind: "work", status: "running", visual: "running", blockedBy: ["T1"], failedBy: [], depth: 1 },
  { id: "T3", subject: "fix 登录页 styles", kind: "work", status: "open", visual: "open", blockedBy: ["T1"], failedBy: [], depth: 1 },
  { id: "T4", subject: "绘制依赖图的连线", kind: "review", status: "open", visual: "blocked", blockedBy: ["T2", "T3"], failedBy: [], depth: 2 },
  { id: "T5", subject: "完全中文标题", kind: "repair", status: "open", visual: "open", blockedBy: ["T1"], failedBy: [], depth: 3 },
]

/** The constants the box rectangles need, read from the source. */
const COLUMN = geoConstant("column")
const NODE_HEIGHT = geoConstant("nodeHeight")
const PAD = geoConstant("pad")

/** Every node's box, computed the way the render does. */
function boxesOf(graph: ReturnType<typeof view.layout>): Box[] {
  return graph.nodes.map((node) => ({
    id: node.task.id,
    left: node.rank * COLUMN + graph.inset,
    top: node.top + PAD,
    width: COLUMN - graph.inset * 2,
    height: NODE_HEIGHT,
  }))
}

/** Report one board's verdict. */
function check(label: string, radius: number): void {
  /** The geometry the layout returns at this radius. */
  const graph = view.layout(TASKS, radius)
  /** The boxes, plainly. */
  const boxes = boxesOf(graph)
  /** How many consecutive-sample pairs enter some box's interior. */
  let invasions = 0
  /** The first invasion, for the report. */
  let first: string | undefined
  for (const edge of graph.edges) {
    for (let i = 1; i < edge.curve.points.length; i++) {
      for (const box of boxes) {
        if (!entersInterior(edge.curve.points[i - 1], edge.curve.points[i], box)) continue
        invasions += 1
        first ??= `${edge.witness} enters ${box.id} at segment ${i}`
      }
    }
  }
  /** Whether any edge's `d` bends at all. */
  const curved = graph.edges.filter((edge) => /[QC]/.test(edge.curve.d)).length
  /** Every number token in every `d`, to catch NaN/undefined leaking into the paint. */
  const numbers = graph.edges.flatMap((edge) => edge.curve.d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)
  console.log(`\n== ${label} (radius ${radius}) ==`)
  console.log(`edges=${graph.edges.length} ranks=${graph.rankCount} inset=${graph.inset} samples=${graph.edges.reduce((n, e) => n + e.curve.points.length, 0)}`)
  console.log(`CURVED EDGES WITH Q/C: ${curved}/${graph.edges.length}`)
  console.log(`INVASIONS (my own segment test): ${invasions}${first === undefined ? "" : "  <- " + first}`)
  console.log(`NON-FINITE NUMBERS IN d: ${numbers.filter((n) => !Number.isFinite(n)).length}`)
  console.log("one edge:", graph.edges[0]?.curve.d)
}

// ── the user's two headline requirements, checked directly ────────────────────────────────────────
console.log("== GRAPH-SAFE LABELS ==")
for (const [index, task] of TASKS.entries()) {
  /** The label the drawing would write for this task. */
  const text = view.graphSafeLabel(task.subject, index + 1)
  console.log(`  ${task.id}  subject=${JSON.stringify(task.subject)}  label=${JSON.stringify(text)}  hasCjk=${hasCjk(text)}`)
}

check("chinese board", 6)
check("chinese board — the W6 control", 0)

// ── the control the lane was asked for: the instrument must be ABLE to fail ───────────────────────
{
  /** The same board with every edge's points shifted 40px right, which must collide with boxes. */
  const broken = view.layout(TASKS, 6)
  /** The boxes. */
  const boxes = boxesOf(broken)
  /** Invasions of the deliberately shifted polylines. */
  let caught = 0
  for (const edge of broken.edges) {
    /** The shifted samples. */
    const pts = edge.curve.points.map((p) => ({ x: p.x + 40, y: p.y }))
    for (let i = 1; i < pts.length; i++) for (const box of boxes) if (entersInterior(pts[i - 1], pts[i], box)) caught += 1
  }
  console.log(`\n== POSITIVE CONTROL (every polyline shifted +40px) ==\nINVASIONS CAUGHT: ${caught}  ${caught > 0 ? "(the check CAN fail — good)" : "(VACUOUS — the check cannot fail!)"}`)
}
