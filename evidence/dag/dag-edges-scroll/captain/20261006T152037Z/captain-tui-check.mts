// CAPTAIN'S INDEPENDENT CHECK of the TUI cap fix and the C3 fix (scratch, gitignored).
//
// WHY. Two claims decide whether the user's feature is visible at all:
//   (1) the panel now renders BOXES for the capture fixture's ~48-53-cell labels, where the REAL PTY
//       capture showed a RAIL at 140 and 220 columns;
//   (2) the pinned detail body now carries the ORIGINAL subject and description, where it previously
//       carried neither.
// This file re-implements the checks rather than calling the lane's instruments, and it drives the same
// INPUT the lane used (the fixture's subjects) so a disagreement can only be about the code.
//
// A first run of this check used 62-70-cell subjects and got `rail` at every width — correctly, because
// those exceed the new 64-cell cap and MUST trip the safety net. Both inputs are run below.
import { dagPanelLayout, pinnedDetailLines, type DagPanelTask } from "../../../../../packages/mpd-tui-plugin/src/panel-dag.ts"
import { layoutBoxesNatural, sliceSpans } from "../../../../../packages/mpd-tui-plugin/src/graph.ts"

/** Build a board in the page's own vocabulary, with the acceptance text the record carries. */
function boardOf(subjects: readonly string[]): DagPanelTask[] {
  return subjects.map((subject, index) => ({
    id: `T${index + 1}`,
    subject,
    description: `验收说明 ${index + 1}：必须保持原样`,
    kind: "work",
    visual: index === 0 ? "completed" : "open",
    dependencies: index === 0 ? [] : [`T${index}`],
    failedDependencies: [],
    depth: index,
  })) as DagPanelTask[]
}

/** The capture fixture's real subjects: the ~48-53-cell ASCII labels the cap must hold. */
const CAPTURE_FIXTURE = [
  "natural width and bidirectional panning for the DAG",
  "termaid rounded node boxes with rounded corners",
  "the graph-safe label rule on every drawing surface",
  "the horizontal window is the drawing's own",
  "prove the tip touches the border by arithmetic",
]
/** A pathological board: a label far beyond any sane cap, which the safety net must still catch. */
const PATHOLOGICAL = ["x".repeat(200), "short one"]

/** Whether a string carries a CJK / full-width codepoint. */
const hasCjk = (text: string): boolean =>
  /[\u2E80-\u2FFF\u3000-\u303F\u3040-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]/u.test(text)

console.log("== 1. THE PANEL MODE AT THE CAPTURE'S OWN WIDTHS (the capture read: view rail) ==")
for (const cols of [44, 80, 140, 220]) {
  /** What the panel would draw for the fixture board. */
  const out = dagPanelLayout(boardOf(CAPTURE_FIXTURE), cols, undefined, 40)
  console.log(`  fixture     cols=${String(cols).padStart(3)} -> mode=${out.mode.padEnd(5)} width=${String(out.view.width).padStart(3)}`)
}
for (const cols of [44, 220]) {
  /** What the panel would draw for the pathological board. */
  const out = dagPanelLayout(boardOf(PATHOLOGICAL), cols, undefined, 40)
  console.log(`  pathological cols=${String(cols).padStart(3)} -> mode=${out.mode.padEnd(5)} width=${String(out.view.width).padStart(3)}  (the safety net must fire)`)
}

console.log("\n== 2. DOES EVERY COMPOSED LABEL APPEAR WHOLE IN THE BOXES? ==")
{
  /** The natural drawing for the fixture board. */
  const view = layoutBoxesNatural(boardOf(CAPTURE_FIXTURE), undefined, { rows: 40 })
  if (view === undefined) console.log("  layoutBoxesNatural REFUSED")
  else {
    /** The drawing's whole text, so a label can be searched for without knowing the box geometry. */
    const text = view.lines.map((row) => row.map((span) => span.text).join("")).join("\n")
    for (const [index, subject] of CAPTURE_FIXTURE.entries()) {
      /** The ASCII run the composer keeps from this subject. */
      const want = (subject.match(/[\x20-\x7E]+/g) ?? []).join(" ").replace(/\s+/g, " ").trim()
      console.log(`  T${index + 1} whole=${text.includes(want) ? "YES" : "NO "}  label=${JSON.stringify(want)}`)
    }
    console.log(`  drawing width=${view.width} · boxRows=${String(view.boxRows ?? "-")}`)
  }
}

console.log("\n== 3. THE SLICER AT THE CAPTURE'S WIDTH ==")
{
  /** The natural drawing. */
  const view = layoutBoxesNatural(boardOf(CAPTURE_FIXTURE), undefined, { rows: 40 })
  if (view !== undefined) {
    /** How many windows came out exactly 44 cells, and how many did not. */
    let exact = 0
    let over = 0
    for (let offset = 0; offset <= Math.max(0, view.width - 44); offset += 7) {
      for (const row of view.lines) {
        /** The windowed row's own cell count. */
        const cells = sliceSpans(row, offset, 44).reduce((n, span) => n + [...span.text].length, 0)
        if (cells === 44) exact += 1
        else over += 1
      }
    }
    console.log(`  exactly 44 cells: ${exact};  not exactly: ${over}`)
  }
}

console.log("\n== 4. THE PINNED DETAIL BODY (clause C3) AND THE DRAWING (C1) ==")
{
  /** The fixture board with its Chinese subjects, which is what C3 is about. */
  const chinese = boardOf(["冻结验收契约与验收标准", "建立头部与进度条的双向滚轴"])
  /** The pinned body the panel would render for T1. */
  const lines = pinnedDetailLines(chinese[0], chinese, 60)
  console.log("  " + lines.slice(0, 4).join(" | "))
  console.log(`  subject kept verbatim:      ${lines.some((line) => line.includes("冻结验收契约与验收标准"))}`)
  console.log(`  description kept verbatim:  ${lines.some((line) => line.includes("验收说明 1：必须保持原样"))}`)
  /** The drawing's whole text. */
  const view = layoutBoxesNatural(chinese, undefined, { rows: 40 })
  /** Everything the drawing wrote. */
  const drawn = view === undefined ? "" : view.lines.map((row) => row.map((s) => s.text).join("")).join("\n")
  console.log(`  CJK inside the DRAWING:     ${hasCjk(drawn)}   <- must be false`)
  console.log(`  CJK inside the DETAIL:      ${lines.some(hasCjk)}   <- must be true`)
}
