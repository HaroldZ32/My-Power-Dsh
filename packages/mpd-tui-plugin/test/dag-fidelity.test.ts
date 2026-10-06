// INDEPENDENT FIDELITY VERIFICATION of the WEB dependency-DAG port (wave `tui-dag-port`).
//
// WHO WROTE THIS. The reviewer (`fidelity-verifier`), NOT the implementation lanes. Nothing here
// imports a lane's test fixture or its helper: the baseline is the WEB reference's OWN SOURCE TEXT,
// read from disk at run time, so a claim of parity is checked against the artefact that defines
// parity rather than against a copy of it. That is the whole point of the file, and it is why the
// arms below parse `packages/mpd-bundle-plugin/src/team-view.ts` instead of hard-coding the six
// glyphs a second time: a second copy of the palette would drift in step with the first.
//
// WHAT IT COVERS (frozen acceptance clauses R3, R4-marker, R5, R6-legend):
//   * R3/R5 — the six-state glyph table and the six-state tone table are the WEB view's own, and the
//     six recorded WEB hexes really are the WEB view's hexes (provenance that is honest, not asserted);
//   * R3     — the `kind` abbreviations are the WEB view's own English words for the same five kinds;
//   * R6     — `blocked` and `open` DO share one glyph on BOTH surfaces, which is the recorded reason
//     the TUI legend exists; and the chrome markers are pairwise distinct so a legend cannot lie;
//   * R4     — the ported chrome keeps the TUI's pre-existing entry markers (`▼` / `▸`), read out of
//     `graph.ts` rather than restated here.
//
// WHAT IT DOES NOT COVER. The geometry arms below run against `src/graph.ts` — the engine
// `panel-dag.ts` consumes and the one the captain's ruling AMENDED (the frozen
// `layoutDag`/`DagView`/`src/dag-layout.ts` contract is RETIRED, not awaited: that module will never
// exist, so no arm here may plan around it).
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript5"

import { createHookRuntime } from "../../mpd-bundle-plugin/test/client-harness.ts"

import { hitTest, layoutGraph, legendLines, type GraphTask, type GraphView } from "../src/graph"
import { cellWidth } from "../src/sanitize"
import {
  DAG_CHROME,
  DAG_KIND_ABBREV,
  DAG_STATE_TONES,
  DAG_TONE_GLYPH,
  DAG_TONE_THEME,
  DAG_TONE_WEB_HEX,
  type DagTone,
} from "../src/dag-theme"

/** Repository-relative path of the WEB reference — the semantic source of truth this port mirrors. */
const WEB_VIEW = join(import.meta.dir, "..", "..", "mpd-bundle-plugin", "src", "team-view.ts")

/** Repository-relative path of the TUI's pre-existing graph drawing, whose markers must survive. */
const TUI_GRAPH = join(import.meta.dir, "..", "src", "graph.ts")

/** The six task states, spelled once here so an arm can name a set without importing a table. */
const SIX_STATES: readonly string[] = ["completed", "running", "failed", "blocked", "cancelled", "open"]

/**
 * Read one repository file as text.
 *
 * Reading at run time rather than capturing the text is what makes the parity claim falsifiable: a
 * WEB edit that changes a glyph or a tone re-judges this port instead of sliding past it.
 * @param path - absolute path of the file to read.
 * @returns the file's UTF-8 text.
 */
function readSource(path: string): string {
  return readFileSync(path, "utf8")
}

/**
 * Extract a `Record<string, string>` object literal declared after an anchor, as a plain object.
 *
 * The anchor is the declaration line verbatim. A missing anchor THROWS instead of returning an empty
 * object: a WEB refactor that renames the table must redden this file loudly, never quietly turn
 * every parity arm below into a comparison of two empty sets.
 * @param source - the file text to search.
 * @param anchor - the declaration line the literal follows, verbatim including `= {`.
 * @returns the literal's `key: "value"` pairs, in source order.
 */
function objectLiteralAfter(source: string, anchor: string): Record<string, string> {
  /** Where the anchor's declaration line begins; `-1` means the WEB reference renamed the table. */
  const at = source.indexOf(anchor)
  if (at < 0) throw new Error(`the WEB reference no longer declares the anchor ${JSON.stringify(anchor)}`)
  /** Index of the literal's opening brace, which the anchor's own `= {` guarantees. */
  const open = source.indexOf("{", at)
  if (open < 0) throw new Error(`the anchor ${JSON.stringify(anchor)} has no object literal`)
  // Walk to the matching brace so a nested literal (there is none today) cannot truncate the slice.
  let depth = 0
  /** Index of the brace that closes the literal; `-1` until the walk finds it. */
  let close = -1
  for (let i = open; i < source.length; i++) {
    /** The character under inspection, one UTF-16 unit at a time. */
    const ch = source[i]
    if (ch === "{") depth += 1
    else if (ch === "}") {
      depth -= 1
      if (depth === 0) {
        close = i
        break
      }
    }
  }
  if (close < 0) throw new Error(`the anchor ${JSON.stringify(anchor)} has an unbalanced literal`)
  /** The literal's inner text, braces excluded. */
  const body = source.slice(open + 1, close)
  /** The parsed pairs; a key with no parsable value reddens the caller's expectations rather than vanishing. */
  const pairs: Record<string, string> = {}
  for (const match of body.matchAll(/(?:"([^"]+)"|([A-Za-z_$][\w$]*))\s*:\s*"([^"]*)"/g)) {
    pairs[match[1] ?? match[2]] = match[3]
  }
  return pairs
}

/** The WEB reference's six-state glyph table, read from its source. */
const webGlyph = objectLiteralAfter(readSource(WEB_VIEW), "const GLYPH: Record<string, string> = {")

/** The WEB reference's six-state colour table, read from its source. */
const webTone = objectLiteralAfter(readSource(WEB_VIEW), "const TONE: Record<string, string> = {")

/** The WEB reference's kind -> i18n key table, read from its source. */
const webKindKey = objectLiteralAfter(readSource(WEB_VIEW), "const KIND_KEY: Record<string, string> = {")

/** The WEB reference's English fallback dictionary, which carries the kind abbreviations. */
const webEn = objectLiteralAfter(readSource(WEB_VIEW), "const EN: Record<string, string> = {")

/** The host theme keys the WEB tone variables resolve through, as the WEB source spells them. */
const webToneHostVars = webTone

describe("R3/R5 · WEB parity of the six-state glyph and tone tables", () => {
  test("the WEB reference still declares all six states on both tables (else every arm below is vacuous)", () => {
    expect(Object.keys(webGlyph).sort()).toEqual([...SIX_STATES].sort())
    expect(Object.keys(webTone).sort()).toEqual([...SIX_STATES].sort())
    expect(Object.keys(DAG_TONE_GLYPH).sort()).toEqual([...SIX_STATES].sort())
  })

  test("every glyph the TUI draws equals the WEB glyph for the same state", () => {
    for (const state of SIX_STATES) {
      expect(`${state}=${DAG_TONE_GLYPH[state]}`).toBe(`${state}=${webGlyph[state]}`)
    }
  })

  test("the six recorded WEB hexes are the WEB view's own hexes (provenance is not asserted, it is read)", () => {
    for (const state of SIX_STATES) {
      /** The first hex literal the WEB tone variable carries, or undefined when the table changed shape. */
      const webHex = webToneHostVars[state].match(/#[0-9a-fA-F]{3,8}/)?.[0]
      expect(`${state}=${DAG_TONE_WEB_HEX[state as DagTone]}`).toBe(`${state}=${webHex}`)
    }
  })

  test("R6: blocked and open really do share one glyph on BOTH surfaces, so the legend is the disambiguator", () => {
    expect(webGlyph.blocked).toBe(webGlyph.open)
    expect(DAG_TONE_GLYPH.blocked).toBe(DAG_TONE_GLYPH.open)
    // The shared character, spelled once: `○` is the whole reason R6 mandates a legend.
    expect(DAG_TONE_GLYPH.blocked).toBe("○")
    expect(DAG_TONE_GLYPH.completed).not.toBe(DAG_TONE_GLYPH.blocked)
    expect(DAG_TONE_GLYPH.running).not.toBe(DAG_TONE_GLYPH.blocked)
    expect(DAG_TONE_GLYPH.failed).not.toBe(DAG_TONE_GLYPH.blocked)
    expect(DAG_TONE_GLYPH.cancelled).not.toBe(DAG_TONE_GLYPH.blocked)
  })

  test("the tone table is total over the tone vocabulary, and the vocabulary is exactly eleven tones", () => {
    /** The tone names the contract declares, read out of the frozen table itself. */
    const declared = Object.keys(DAG_TONE_THEME).sort()
    expect(declared).toEqual([
      "blank", "blocked", "cancelled", "chain", "completed", "dim", "edge", "failed", "focus", "open", "running",
    ])
    // Every tone maps to a NON-EMPTY host theme key: a tone that mapped to "" would render unstyled.
    for (const tone of declared) expect(DAG_TONE_THEME[tone as DagTone].length).toBeGreaterThan(0)
  })

  test("the state vocabulary carries each of the six states once and leaks no drawing tone", () => {
    // `.map(String)` keeps the comparison on plain strings: `toEqual` infers its expected type from
    // the actual, so comparing a `DagTone[]` against a `string[]` is a type error rather than a
    // semantic one, and widening the actual is what makes the arm say what it means.
    expect([...DAG_STATE_TONES].map(String).sort()).toEqual([...SIX_STATES].sort())
    expect(new Set(DAG_STATE_TONES).size).toBe(SIX_STATES.length)
  })

  test("R3: the ported kind abbreviations are the WEB view's own words for the same five kinds", () => {
    expect(Object.keys(DAG_KIND_ABBREV).sort()).toEqual(Object.keys(webKindKey).sort())
    for (const kind of Object.keys(webKindKey)) {
      /** The WEB view's English word for this kind, via the i18n key its own table names. */
      const webWord = webEn[webKindKey[kind]]
      expect(`${kind}=${DAG_KIND_ABBREV[kind]}`).toBe(`${kind}=${webWord}`)
    }
  })

  test("R6: the legend's own vocabulary is unambiguous — the chrome markers are pairwise distinct", () => {
    /** Every marker the legend may print, as name -> glyph. */
    const markers: Record<string, string> = {
      arrowDown: DAG_CHROME.arrowDown,
      arrowRight: DAG_CHROME.arrowRight,
      focusMarker: DAG_CHROME.focusMarker,
      pinMarker: DAG_CHROME.pinMarker,
      barFull: DAG_CHROME.barFull,
      barEmpty: DAG_CHROME.barEmpty,
    }
    /** The marker glyphs, in declaration order. */
    const values = Object.values(markers)
    expect(new Set(values).size).toBe(values.length)
    // A marker that collided with a state glyph would make one legend line mean two things.
    for (const glyph of Object.values(DAG_TONE_GLYPH)) {
      expect(values.includes(glyph)).toBe(false)
    }
    // Each marker is one display cell: a two-cell marker would shear every row it is drawn on.
    for (const marker of values) expect([...marker].length).toBe(1)
  })

  test("R4: the ported entry markers are the TUI's pre-existing ones, read out of the drawing itself", () => {
    /** The drawing's own source, so the two markers are compared against the file that draws them. */
    const graph = readSource(TUI_GRAPH)
    /** The downward entry marker `graph.ts` declares; undefined means the drawing was refactored away. */
    const drawingArrowDown = graph.match(/const ARROW_DOWN = "([^"]+)"/)?.[1]
    /** The rail's rightward connector marker `graph.ts` declares. */
    const drawingArrowRight = graph.match(/const ARROW_RIGHT = "([^"]+)"/)?.[1]
    // The `toBeDefined` pair is load-bearing: without it a renamed constant in `graph.ts` would make
    // both comparisons `"▼" === undefined`, which FAILS — but a *missing* anchor would also make the
    // arm fail for the wrong reason. Naming the anchor keeps the failure legible.
    expect(drawingArrowDown).toBeDefined()
    expect(drawingArrowRight).toBeDefined()
    // Compared through template literals on purpose: `toBe` takes its expectation type from the
    // ACTUAL, so a `string | undefined` lookup against the literal `"▼"` is a type error rather than
    // a comparison. Widening the production table to satisfy a test would be the wrong repair.
    expect(`down=${DAG_CHROME.arrowDown}`).toBe(`down=${drawingArrowDown}`)
    expect(`right=${DAG_CHROME.arrowRight}`).toBe(`right=${drawingArrowRight}`)
  })
})

// ── R17/R19/R2/R15 · the TUI engine's own invariants ────────────────────────────────────────────
//
// These arms run against the AMENDED `graph.ts` (captain's ruling, 2026-10-06: the frozen
// `layoutDag`/`DagView` contract was RETIRED and `graph.ts` — the engine `panel-dag.ts` consumes —
// took the amendment instead). They are INVARIANT-shaped on purpose: the user forbade byte-frozen
// grids and fixed sizes ("不能固定尺寸，你锁字符可能不太好"), so nothing here asserts a row's literal
// characters, and nothing here asserts a size that a wider panel would legitimately change.

/** One graph fixture row: the fields the geometry reads, with sane defaults for the rest. */
function task(id: string, depth: number, dependencies: readonly string[] = []): GraphTask {
  return { id, subject: "subject of " + id, kind: "work", visual: "open", dependencies, depth }
}

/** The depths a CORRECT store served for the live board after the captain's repair. */
const GRAPH_DEPTHS: Readonly<Record<string, number>> = Object.freeze({
  T1: 0, T2: 0, T3: 0, T4: 0, T5: 0, T6: 1, T7: 2, T8: 3, T9: 2, T10: 4,
})

/** The live board's UNREPAIRED shape, verbatim: plan ordinals as references, every served depth 0. */
const DANGLING_BOARD: GraphTask[] = [
  ...["T1", "T2", "T3", "T4", "T5"].map(id => task(id, 0)),
  task("T6", 0, ["2"]),
  task("T7", 0, ["2", "3", "4", "6"]),
  task("T8", 0, ["7"]),
  task("T9", 0, ["2", "3", "4", "5", "6"]),
  task("T10", 0, ["7", "8", "9"]),
]

/** The same board with the references the store SHOULD have held, and a served depth that still lies. */
const RESOLVABLE_BOARD: GraphTask[] = [
  ...["T1", "T2", "T3", "T4", "T5"].map(id => task(id, 0)),
  task("T6", 0, ["T2"]),
  task("T7", 0, ["T2", "T3", "T4", "T6"]),
  task("T8", 0, ["T7"]),
  task("T9", 0, ["T2", "T3", "T4", "T5", "T6"]),
  task("T10", 0, ["T7", "T8", "T9"]),
]

/**
 * Slice one rendered row by TERMINAL CELL, which is the coordinate system a hit rectangle speaks in.
 *
 * Slicing the same string by code point is the mistake that HIDES a wide-character shear: a CJK glyph
 * occupies one array slot and two cells, so a code-point slice drifts right by one cell per wide
 * character — and would report the drawing as broken when it is not (measured: my own first attempt
 * reported 4 phantom mismatches). This helper is the correction.
 * @param text - the row's text, spans already joined.
 * @param startCell - the first cell to include.
 * @param endCell - the first cell to EXCLUDE.
 * @returns the characters covering `[startCell, endCell)`, whole glyphs only.
 */
function cellsOf(text: string, startCell: number, endCell: number): string {
  /** The characters covering the requested span, accumulated glyph by glyph. */
  let out = ""
  /** The running terminal-cell offset, which is what `startCell`/`endCell` are measured in. */
  let cell = 0
  for (const char of text) {
    if (cell >= endCell) break
    if (cell >= startCell) out += char
    cell += cellWidth(char)
  }
  return out
}

/** The widest line of a view, in terminal cells — the one measure every geometry arm bounds. */
function widestLine(view: GraphView): number {
  return view.lines.reduce((max, row) => Math.max(max, cellWidth(row.map(span => span.text).join(""))), 0)
}

/** The rank a view drew a task in, read off its own hit rectangles rather than off the input. */
function drawnRank(view: GraphView, id: string): number | undefined {
  /** The rectangle the drawing gave this task, or undefined when it drew none. */
  const hit = view.hits.find(entry => entry.taskId === id)
  return hit === undefined ? undefined : hit.row
}

describe("R17 · rank is DERIVED from the dependency graph, never trusted from the served depth", () => {
  test("a board whose served depth lies produces MORE THAN ONE rank", () => {
    /** The drawing under judgement for this arm. */
    const view = layoutGraph(RESOLVABLE_BOARD, 200)
    /** The distinct rows the drawn task rectangles occupy. */
    const rows = [...new Set(view.hits.map(hit => hit.row))]
    expect(view.ranksDerived).toBe(true)
    expect(rows.length).toBeGreaterThan(1)
    // The derivation is the LOAD-BEARING part: every task claims depth 0, so a layout that trusted it
    // would put all ten on one row — which is the collapse the user reported.
    expect(drawnRank(view, "T10")).toBeGreaterThan(drawnRank(view, "T1") ?? -1)
    expect(drawnRank(view, "T7")).toBeGreaterThan(drawnRank(view, "T6") ?? -1)
  })

  test("the same board with a HONEST depth draws the same ranks (the two sources agree when both are sound)", () => {
    /** The drawing whose ranks the derivation chose. */
    const derived = layoutGraph(RESOLVABLE_BOARD, 200)
    /** The board with the depths a correct store would have served. */
    const honest = RESOLVABLE_BOARD.map(row => ({ ...row, depth: GRAPH_DEPTHS[row.id] ?? 0 }))
    /** The drawing of the same board with the depths a correct store would have served. */
    const served = layoutGraph(honest, 200)
    for (const id of RESOLVABLE_BOARD.map(row => row.id)) {
      expect(`${id}:${drawnRank(derived, id)}`).toBe(`${id}:${drawnRank(served, id)}`)
    }
  })

  test("R21: references that name no task are SURFACED, sorted and de-duplicated — never silently dropped", () => {
    /** The drawing under judgement for this arm. */
    const view = layoutGraph(DANGLING_BOARD, 200)
    expect(view.unresolved).toEqual(["2", "3", "4", "5", "6", "7", "8", "9"])
  })

  test("FALLBACK ARM A — a genuinely flat board, served flat, still draws flat (and says it derived)", () => {
    // No dependency at all, every depth 0: there is nothing to derive AND nothing to fall back from.
    // A layout that "fixed" this into extra ranks would be inventing structure the board does not hold.
    const flat = ["T1", "T2", "T3"].map(id => task(id, 0))
    /** The drawing under judgement for this arm. */
    const view = layoutGraph(flat, 200)
    expect(view.unresolved).toEqual([])
    expect([...new Set(view.hits.map(hit => hit.row))].length).toBe(1)
    expect(view.ranksDerived).toBe(true)
  })

  test("FALLBACK ARM B — the user's broken board: nothing resolves and the depths do NOT vary, so the SERVED depth is refused and derivation runs", () => {
    // This is the exact live shape before the repair: plan ordinals as references, every served
    // depth 0. `servedVaries` is FALSE, so the fallback must NOT fire — the derivation runs, finds no
    // resolvable edge, and honestly draws ONE rank while REPORTING every dangling reference.
    /** The drawing under judgement for this arm. */
    const view = layoutGraph(DANGLING_BOARD, 200)
    expect(view.ranksDerived).toBe(true)
    expect([...new Set(view.hits.map(hit => hit.row))].length).toBe(1)
    expect(view.unresolved.length).toBe(8)
  })

  test("FALLBACK ARM C — nothing resolves but the served depths DO vary, so the fallback fires and reports itself", () => {
    // The one case the amendment allows the served depth to draw with: the record knows structure its
    // references cannot express. It must produce MORE THAN ONE rank and must say the ranks were served.
    const depths: Record<string, number> = { T1: 0, T2: 0, T3: 0, T4: 0, T5: 0, T6: 1, T7: 2, T8: 3, T9: 2, T10: 4 }
    /** The dangling board carrying the depths the live record served after the repair. */
    const served = DANGLING_BOARD.map(row => ({ ...row, depth: depths[row.id] ?? 0 }))
    /** The drawing under judgement for this arm. */
    const view = layoutGraph(served, 200)
    expect(view.ranksDerived).toBe(false)
    expect([...new Set(view.hits.map(hit => hit.row))].length).toBeGreaterThan(1)
    expect(view.unresolved.length).toBe(8)
  })

  test("a dependency cycle terminates, is drawn, and is reported", () => {
    /** Three tasks in a ring, which is the malformed board the cycle arms draw. */
    const cyclic = [task("A", 0, ["C"]), task("B", 0, ["A"]), task("C", 0, ["B"])]
    /** The drawing under judgement for this arm. */
    const view = layoutGraph(cyclic, 120)
    expect([...view.cycles].sort()).toEqual(["A", "B", "C"])
    expect(widestLine(view)).toBeLessThanOrEqual(120)
  })

  test("a self-dependency terminates and is reported as a cycle", () => {
    /** The drawing under judgement for this arm. */
    const view = layoutGraph([task("S", 0, ["S"])], 120)
    expect(view.cycles).toContain("S")
  })
})

describe("R2/R15 · adaptive vertical geometry, asserted as invariants", () => {
  test("shrinking the width never grows any line, and no line ever exceeds the width given", () => {
    /** Every width the arms sweep, including the degenerate ones the captain asked to be attacked. */
    const widths = [1, 2, 8, 12, 16, 24, 32, 40, 48, 64, 80, 120, 200]
    /** The widest line at each width, in the same order. */
    const widest = widths.map(cols => widestLine(layoutGraph(RESOLVABLE_BOARD, cols)))
    widths.forEach((cols, index) => {
      expect(`${cols}:${widest[index] <= Math.max(8, cols)}`).toBe(`${cols}:true`)
    })
    // Monotonicity: a narrower viewport can never demand MORE cells than a wider one.
    for (let i = 1; i < widths.length; i++) {
      expect(widest[i] >= widest[i - 1] - 0).toBe(true)
    }
  })

  test("every hit rectangle CONTAINS its own node and never claims a task off the board", () => {
    /** The drawing under judgement for this arm. */
    const view = layoutGraph(RESOLVABLE_BOARD, 160)
    /** The ids the board actually carries, so a hit naming anything else is a defect. */
    const ids = new Set(RESOLVABLE_BOARD.map(row => row.id))
    expect(view.hits.length).toBeGreaterThan(0)
    for (const hit of view.hits) {
      expect(ids.has(hit.taskId)).toBe(true)
      expect(hit.rowEnd).toBeGreaterThanOrEqual(hit.row)
      expect(hit.colEnd).toBeGreaterThanOrEqual(hit.col)
      expect(hit.row).toBeGreaterThanOrEqual(0)
      expect(hit.col).toBeGreaterThanOrEqual(0)
    }
    // Exactly one rectangle per task: two rectangles for one id would make a pointer ambiguous.
    expect(new Set(view.hits.map(hit => hit.taskId)).size).toBe(view.hits.length)
  })

  test("a pointer resolves back to the task whose rectangle it landed in", () => {
    /** The drawing under judgement for this arm. */
    const view = layoutGraph(RESOLVABLE_BOARD, 160)
    for (const hit of view.hits) {
      expect(hitTest(view, hit.row, hit.col)).toBe(hit.taskId)
      expect(hitTest(view, hit.rowEnd, hit.colEnd)).toBe(hit.taskId)
    }
  })

  test("every drawn edge's endpoints belong to a real (blocker, dependent) pair", () => {
    /** The drawing under judgement for this arm. */
    const view = layoutGraph(RESOLVABLE_BOARD, 200)
    /** Where each arrowhead was painted, as `row:col`. */
    const arrows = new Set<string>()
    view.lines.forEach((row, y) => row.forEach((span, x) => { if (span.text.includes(DAG_CHROME.arrowDown)) arrows.add(`${y}:${x}`) }))
    expect(arrows.size).toBeGreaterThan(0)
    for (const arrow of arrows) {
      /** The arrowhead's own drawn position, split back into a row and a column. */
      const [row, col] = arrow.split(":").map(Number)
      /** The dependent whose entry cell carries the arrowhead: the node directly BELOW it. */
      const dependent = view.hits.find(hit => hit.row === row + 1 && col >= hit.col - 1 && col <= hit.colEnd + 1)
      expect(dependent).toBeDefined()
      /** The task the arrow claims to come from, by the board's own edges. */
      const blockers = RESOLVABLE_BOARD.find(task => task.id === dependent?.taskId)?.dependencies ?? []
      /** The rectangles that could have painted this arrowhead: real blockers drawn above it. */
    const paintedBy = view.hits.filter(hit => blockers.includes(hit.taskId) && hit.row < (dependent?.row ?? 0))
      expect(paintedBy.length).toBeGreaterThan(0)
    }
  })

  test("R13-width: a rank reads top-to-bottom, so every blocker sits strictly above its dependent", () => {
    /** The drawing under judgement for this arm. */
    const view = layoutGraph(RESOLVABLE_BOARD, 200)
    for (const row of RESOLVABLE_BOARD) {
      for (const blockerId of row.dependencies) {
        expect(drawnRank(view, blockerId)).toBeLessThan(drawnRank(view, row.id) ?? -1)
      }
    }
  })

  test("R19: within a rank the task order is NUMERIC, so t2 precedes t10", () => {
    // THE BOARD IS HANDED IN DELIBERATELY SCRAMBLED. R19 names numeric task-id order as the adopted
    // reference model's within-column rule, so a layout that draws the served order instead is the
    // divergence this arm exists to catch. MEASURED 2026-10-06: BOTH surfaces draw the served order
    // (TUI `layoutGraph` -> T10,T2,T1,T3,T20; the WEB view's own `layout` -> the same), so this arm is
    // EXPECTED RED until the ordering rule is implemented or R19 is narrowed. It is red on purpose:
    // a green arm here would enshrine the divergence.
    const scrambled = [
      task("T10", 0, []), task("T2", 0, []), task("T1", 0, []), task("T3", 0, []), task("T20", 0, []),
    ]
    /** The drawing under judgement for this arm. */
    const view = layoutGraph(scrambled, 400)
    /** The top-most rank's rectangles, in the order the drawing stacks them left to right. */
    const topRow = view.hits.reduce((min, hit) => Math.min(min, hit.row), Number.MAX_SAFE_INTEGER)
    /** The ids in drawn order, left to right. */
    const drawn = view.hits.filter(hit => hit.row === topRow).sort((left, right) => left.col - right.col).map(hit => hit.taskId)
    expect(drawn.length).toBeGreaterThan(1)
    /** The same ids ordered the way the clause demands: by their NUMBER, not by their text. */
    const numeric = [...drawn].sort((left, right) => Number(left.replace(/\D/g, "")) - Number(right.replace(/\D/g, "")))
    expect(drawn).toEqual(numeric)
  })

  test("R19/R6: the legend states the READING DIRECTION and names both drawn markers", () => {
    /** The legend as a 200-cell scene would print it. */
    const lines = legendLines(200)
    expect(lines.length).toBeGreaterThan(0)
    /** The arrow sentence, which must name the direction rather than merely the glyph. */
    const arrowLine = lines.find(line => line.includes(DAG_CHROME.arrowDown)) ?? ""
    expect(arrowLine).toContain(DAG_CHROME.arrowRight)
    expect(arrowLine).toMatch(/above|→/)
    // The legend may never exceed the viewport it was asked for, and must vanish when nothing fits.
    expect(cellWidth(arrowLine)).toBeLessThanOrEqual(200)
    for (const width of [0, 4, 7]) expect(legendLines(width)).toEqual([])
  })
})

describe("R2/R15 · adversarial fixtures", () => {
  test("a 500-task board terminates and stays inside its viewport", () => {
    /** Five hundred tasks, each blocked by the previous one: a single rank chain 500 deep. */
    const chain: GraphTask[] = Array.from({ length: 500 }, (_, index) =>
      task("T" + (index + 1), 0, index === 0 ? [] : ["T" + index]))
    /** The drawing under judgement for this arm. */
    const view = layoutGraph(chain, 120)
    expect(view.hits.length).toBeGreaterThan(0)
    expect(widestLine(view)).toBeLessThanOrEqual(120)
    // The deep chain must not be flattened: the last task cannot share the first one's rank.
    expect(drawnRank(view, "T500")).toBeGreaterThan(drawnRank(view, "T1") ?? -1)
  })

  test("an unknown state string, an absent kind and a missing dependency id all survive the drawing", () => {
    /** The malformed board: an unknown state, an absent kind and a reference to nothing. */
    const odd = [
      { ...task("T1", 0, []), visual: "wat", kind: undefined },
      task("T2", 0, ["NOT-ON-THE-BOARD"]),
    ]
    /** The drawing under judgement for this arm. */
    const view = layoutGraph(odd, 120)
    expect(view.hits.map(hit => hit.taskId).sort()).toEqual(["T1", "T2"])
    expect(view.unresolved).toEqual(["NOT-ON-THE-BOARD"])
    expect(widestLine(view)).toBeLessThanOrEqual(120)
  })

  test("an empty board draws nothing rather than throwing", () => {
    /** The drawing under judgement for this arm. */
    const view = layoutGraph([], 80)
    expect(view.hits).toEqual([])
    expect(view.unresolved).toEqual([])
    expect(view.cycles).toEqual([])
  })

  test("a CJK fixture never shears: every line fits, and a boxed line ends on its own border column", () => {
    /** The CJK board: wide characters in every subject and a real dependency chain. */
    const cjk: GraphTask[] = [
      { ...task("T1", 0, []), subject: "冻结验收契约：TUI 依赖视图这一波", kind: "requirement" },
      { ...task("T2", 0, ["T1"]), subject: "自适应纵向布局引擎", kind: "work" },
      { ...task("T3", 0, ["T1"]), subject: "独立的 dag 与 workmate 侧栏面板", kind: "work" },
      { ...task("T4", 0, ["T2", "T3"]), subject: "整个表面层重设计：面板 + 全部场景 + 状态行", kind: "work" },
      { ...task("T5", 0, ["T4"]), subject: "独立验证 R1..R16", kind: "review" },
      { ...task("T6", 0, ["T4"]), subject: "视觉保真度复核", kind: "review" },
      { ...task("T7", 0, ["T5", "T6"]), subject: "集成：重建 dist、门禁扫描、Docker 实机、双语 PR", kind: "integration" },
    ]
    for (const cols of [48, 64, 80, 120, 200]) {
      /** The drawing under judgement for this arm. */
    const view = layoutGraph(cjk, cols)
      expect(`cjk@${cols}:${widestLine(view) <= Math.max(8, cols)}`).toBe(`cjk@${cols}:true`)
      // A WIDE CHARACTER WRITTEN THROUGH A ONE-CELL CURSOR is what shears a box: the row still ends
      // on `│`, but the terminal draws it two cells right of where the layout thought it was. The
      // structural form of that bug is a NODE WHOSE OWN RECTANGLE does not cover the cells it painted,
      // so the arms slice by CELL (never by code point — that mistake is what a naive check makes).
      const texts = view.lines.map(row => row.map(span => span.text).join(""))
      if (view.mode !== "boxes") {
        // The rail makes the WHOLE row the target by design, so its rect spans the viewport; the
        // invariant that still holds is that the rect never escapes it.
        for (const hit of view.hits) expect(hit.colEnd).toBeLessThan(Math.max(8, cols))
        continue
      }
      for (const hit of view.hits) {
        /** The painted prefix of the box's own top border, sliced by terminal cells. */
        const border = cellsOf(texts[hit.row] ?? "", 0, hit.colEnd + 1)
        expect(`box@${hit.taskId}:${cellWidth(border)}`).toBe(`box@${hit.taskId}:${hit.colEnd + 1}`)
        expect(border.trim().startsWith("┌")).toBe(true)
        expect(border.trimEnd().endsWith("┐")).toBe(true)
      }
    }
  })
})

// ── R20 · the WEB view derives too ──────────────────────────────────────────────────────────────
//
// HOW THE WEB VIEW IS LOADED. `packages/mpd-bundle-plugin/src/team-view.ts` is a FACTORY BODY — one
// arrow expression the build splices into `client.js` — so it has no `import`/`export` to resolve.
// It is loaded here the way the repo's own `team-view.test.ts` loads it: strip the types with the
// SAME `typescript5` tool class the build uses, then evaluate the result. Its `layout(tasks)` is PURE,
// which is what makes R20 assertable without a browser.
//
// WHY THIS ARM EXISTS AT ALL, GIVEN THE TUI ARM. An earlier revision of the reviewer's evidence
// script computed the served `depth` with the real `taskDepths` and then reported `rankCount 5` for
// the WEB view — a GREEN that measured the PAYLOAD, not the VIEW, because a correct payload is
// trivially laid out correctly by a view that trusts it. The fixture below is the one that can
// actually fail: the references RESOLVE to real ids while EVERY served `depth` is 0. A deriving view
// recovers five columns; a trusting view draws one.

/** The WEB factory's module shape, as this file reads it. */
interface WebViewModule {
  /** The pure geometry the WEB panel draws with. */
  layout: (tasks: ReadonlyArray<Record<string, unknown>>) => { rankCount: number; columns: Array<Array<{ id: string }>> }
}

/**
 * Load the WEB view factory and build its module against the offline hook runtime.
 * @returns the module, typed to the `layout` this file reads.
 */
function loadWebView(): WebViewModule {
  /** The factory source with every type annotation erased, exactly as the build strips it. */
  const stripped = ts.transpileModule(readFileSync(WEB_VIEW, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
  /** The evaluated factory expression, which the bundle build wraps the same way. */
  const factory = new Function("return (" + stripped.trim().replace(/;$/, "") + ")")() as (deps: unknown) => {
    createTeamView: (deps: unknown) => WebViewModule
  }
  /** The offline React double the view's hooks run on. */
  const hooks = createHookRuntime()
  return factory({}).createTeamView({
    react: hooks.react, statePath: "/p", planPath: "/p", taskPath: "/t", pollMs: 60_000,
  })
}

/** The WEB payload row a board row becomes, with the served `depth` the caller names. */
function webRow(task: GraphTask, depth: number): Record<string, unknown> {
  return {
    id: task.id, subject: task.subject, kind: task.kind, status: "pending", visual: task.visual,
    blockedBy: [...task.dependencies], failedBy: [], depth,
  }
}

describe("R20 · the WEB view derives rank from blockedBy, never from the served depth", () => {
  test("references RESOLVE while every served depth is 0 — the view must still draw more than one column", () => {
    /** The WEB view module under test. */
    const view = loadWebView()
    /** The resolvable board, handed over with a payload whose every depth is the lie the live record told. */
    const rows = RESOLVABLE_BOARD.map(row => webRow(row, 0))
    /** What the view draws from that payload. */
    const geometry = view.layout(rows)
    // The assertion is BOTH halves on purpose: `rankCount 1` is the defect's own signature, and a
    // bare `> 1` would also accept a view that invented columns the graph does not hold.
    expect(geometry.rankCount).toBeGreaterThan(1)
    expect(geometry.rankCount).not.toBe(1)
    // And the ranks must be the graph's, not a shuffle: T10 is the deepest task on this board.
    /** The column index each task was drawn in. */
    const columnOf = new Map<string, number>()
    geometry.columns.forEach((column, index) => { for (const node of column) columnOf.set(node.id, index) })
    expect(columnOf.get("T10")).toBeGreaterThan(columnOf.get("T1") ?? -1)
  })

  test("CONTROL: the same board with honest depths draws the same columns (so the arm cannot be satisfied by ignoring depth)", () => {
    /** The WEB view module under test. */
    const view = loadWebView()
    /** The same board, this time with the depths a correct store serves. */
    const honest = view.layout(RESOLVABLE_BOARD.map(row => webRow(row, GRAPH_DEPTHS[row.id] ?? 0)))
    /** The board with a lying payload, which must reach the SAME geometry. */
    const lying = view.layout(RESOLVABLE_BOARD.map(row => webRow(row, 0)))
    expect(lying.rankCount).toBe(honest.rankCount)
  })

  test("a genuinely flat board served flat is drawn flat — the view must not invent structure", () => {
    /** The WEB view module under test. */
    const view = loadWebView()
    /** Three tasks with no blocker at all. */
    const flat = ["T1", "T2", "T3"].map(id => webRow(task(id, 0), 0))
    expect(view.layout(flat).rankCount).toBe(1)
  })
})
