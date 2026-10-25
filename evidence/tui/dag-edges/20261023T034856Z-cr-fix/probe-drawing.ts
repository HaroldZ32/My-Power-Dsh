// Byte-identity probe for the dag-edges CR fix: renders a fixed set of boards through the WORKING tree
// and prints one deterministic JSON blob. The BEFORE twin imports the 30309c96 scratch tree instead,
// so `diff` between the two outputs proves the long-edge lane refactor changed no drawn byte.
import { layoutBoxes, layoutBoxesNatural, type GraphTask } from "../../../../packages/mpd-tui-plugin/src/graph.ts"

/** One task with the fields a drawing cares about. */
function task(id: string, dependencies: readonly string[] = [], extra: Partial<GraphTask> = {}): GraphTask {
  return { id, subject: `subject of ${id}`, kind: "work", visual: "open", dependencies, depth: 0, ...extra }
}

/** The adjacent-edge board the wave's byte-identity arm uses. */
const ADJACENT: GraphTask[] = [task("A1"), task("A2"), task("B1", ["A1", "A2"]), task("C1", ["B1"])]

/** Three roots, a full middle rank, and a skip edge that keeps its lane inside a NODE_GAP column. */
const LONG_FULL: GraphTask[] = [
  task("A1"), task("A2"), task("A3"),
  task("B1", ["A1"]), task("B2", ["A2"]), task("B3", ["A3"]),
  task("C1", ["A1", "B1"]),
]

/** A one-column board whose long edge appends a lane on the right. */
const ONE_COLUMN: GraphTask[] = [task("A1"), task("B1", ["A1"]), task("C1", ["A1", "B1"])]

/** The measured broken record the wave's rank arms use: several skip edges over intermediate ranks. */
const DERIVED: GraphTask[] = [
  task("T1", [], { kind: "requirement" }),
  task("T2", [], { kind: "requirement" }),
  task("T3"),
  task("T4"),
  task("T5"),
  task("T6", ["T2"]),
  task("T7", ["T2", "T3", "T4", "T6"]),
  task("T8", ["T7"]),
  task("T9", ["T2", "T3", "T4", "T5", "T6"]),
  task("T10", ["T7", "T8", "T9"]),
  task("T11"),
  task("T12"),
]

/** A board whose subjects are wide glyphs, so the cell discipline is in the baseline too. */
const CJK: GraphTask[] = [task("T1", [], { subject: "冻结验收契约" }), task("T2", ["T1"], { subject: "验证" })]

/** The skip-edge fixture the fit-width guard is about: A -> C beside A -> B -> C. */
const SKIP_CHAIN: GraphTask[] = [task("A"), task("B", ["A"]), task("C", ["A", "B"])]

/** One rendered case: what the drawing claims and every line it writes. */
interface Rendered {
  readonly name: string
  readonly width: number
  readonly lines: readonly string[]
  readonly hits: readonly { readonly taskId: string; readonly row: number; readonly rowEnd: number; readonly col: number; readonly colEnd: number }[]
}

/** Flatten a view to the deterministic shape the diff compares. */
function render(name: string, view: ReturnType<typeof layoutBoxes>): Rendered | null {
  if (view === undefined) return null
  return {
    name,
    width: view.width,
    lines: view.lines.map((spans) => spans.map((span) => span.text).join("")),
    hits: view.hits.map((hit) => ({ taskId: hit.taskId, row: hit.row, rowEnd: hit.rowEnd, col: hit.col, colEnd: hit.colEnd })),
  }
}

/** Whether the fit-width skip-edge probes are included; `--no-skip` drops them for the F1 byte diff. */
const includeSkip = !process.argv.includes("--no-skip")

/** Every case, in a fixed order. */
const CASES: Array<Rendered | null> = [
  render("fit-adjacent-40", layoutBoxes(ADJACENT, 40)),
  render("fit-adjacent-120", layoutBoxes(ADJACENT, 120)),
  render("fit-derived-200", layoutBoxes(DERIVED, 200)),
  render("fit-derived-focus-200", layoutBoxes(DERIVED, 200, "T9")),
  render("fit-cjk-48", layoutBoxes(CJK, 48)),
  render("natural-longfull", layoutBoxesNatural(LONG_FULL)),
  render("natural-onecolumn", layoutBoxesNatural(ONE_COLUMN)),
  render("natural-derived", layoutBoxesNatural(DERIVED)),
  render("natural-derived-focus", layoutBoxesNatural(DERIVED, "T9")),
  render("natural-cjk", layoutBoxesNatural(CJK)),
  ...(includeSkip ? [16, 17, 20, 24, 28, 30, 34].map((cols) => render(`fit-skip-cols-${cols}`, layoutBoxes(SKIP_CHAIN, cols))) : []),
]

process.stdout.write(JSON.stringify(CASES, null, 1) + "\n")
