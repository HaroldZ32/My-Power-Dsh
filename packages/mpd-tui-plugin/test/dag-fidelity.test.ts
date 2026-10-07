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
  DAG_CHARS,
  DAG_CHARS_ONE_CELL,
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
 * Resolve a marker `graph.ts` declares at one `const <name> = …` anchor, whichever form it uses.
 *
 * R2 keeps the source anchor this instrument reads, but it may point at the DECLARED table rather than
 * at a literal. Both forms are therefore resolved, and a form that is neither reddens the caller's
 * `toBeDefined` rather than silently answering `undefined` twice.
 * @param source - the drawing's source text.
 * @param name - the constant's name, e.g. `ARROW_DOWN`.
 * @returns the marker's value, or undefined when the anchor is gone.
 */
function markerAt(source: string, name: string): string | undefined {
  /** The declaration prefix, which is what makes the anchor findable without a regex. */
  const prefix = "const " + name + " = "
  /** Where the anchor's declaration begins; `-1` means the drawing renamed the constant. */
  const at = source.indexOf(prefix)
  if (at < 0) return undefined
  /** The right-hand side, up to the end of its own line. */
  const right = source.slice(at + prefix.length).split("\n")[0].trim()
  // A `DAG_CHARS.<member>` reference is resolved through the table this file already imports, so the
  // marker is read from ONE declared source rather than from a literal the ruling may have replaced.
  if (right.startsWith("DAG_CHARS.")) {
    /** The table itself, as a plain record for the dynamic lookup. */
    const table: Record<string, string> = DAG_CHARS
    /** The member name, with any trailing punctuation stripped. */
    const member = right.slice("DAG_CHARS.".length).replace(/[^A-Za-z0-9_$]/g, "")
    return table[member]
  }
  /** A string literal is returned without its quotes; any other form is refused rather than guessed. */
  return right.startsWith('"') && right.endsWith('"') ? right.slice(1, -1) : undefined
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
    // RE-POINTED BY R6/R2 (the frozen riders that replaced this wave's literals with DECLARED DATA):
    // `graph.ts` no longer has to spell `▼` itself — it may read `DAG_CHARS.arrowDown`, which is what
    // R2 keeps the `const ARROW_DOWN = …` anchor FOR. The resolver below accepts BOTH forms, so the
    // arm still measures the MARKER THE DRAWING USES rather than a form the ruling happened to pick.
    /** The downward entry marker `graph.ts` declares, as a value; undefined means the anchor vanished. */
    const drawingArrowDown = markerAt(graph, "ARROW_DOWN")
    /** The rail's rightward connector marker `graph.ts` declares. */
    const drawingArrowRight = markerAt(graph, "ARROW_RIGHT")
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
    // AND THE DECLARED TABLE IS THE SOURCE OF BOTH: the chrome markers and the drawing's glyphs are one
    // table, so a future edit cannot round one and leave the other sharp.
    expect(`down=${DAG_CHROME.arrowDown}`).toBe(`down=${DAG_CHARS.arrowDown}`)
    expect(`right=${DAG_CHROME.arrowRight}`).toBe(`right=${DAG_CHARS.arrowRight}`)
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
        // RE-POINTED BY R6/T7: the corners are ROUNDED now, so the literals `┌`/`┐` this arm used to
        // read are the OLD form. The expectation comes from the frozen `DAG_CHARS` table instead, and
        // the sharp literals are refused right below so the re-point cannot silently accept either.
        expect(border.trim().startsWith(DAG_CHARS.cornerDownRight)).toBe(true)
        expect(border.trimEnd().endsWith(DAG_CHARS.cornerDownLeft)).toBe(true)
        expect(`sharp@${hit.taskId}:${border.includes("┌") || border.includes("┐")}`).toBe(`sharp@${hit.taskId}:false`)
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

// ── W5/W6 · the WEB curve: arrival, and the `radius = 0` control ────────────────────────────────
//
// RE-POINTED TO THE FREEZE (design-freeze.md (a) A1/A4, captain-rulings.md R1), because the first
// revision of these arms was written against the lane's work-in-progress shapes and would have judged a
// different interface than the one the wave froze:
//   * `curve.tip` is the ARRIVAL POINT `{x, y}` — NOT a rectangle. The rectangle survives only as the
//     head's bounding box on `edge.marker`, and the DOM-readable arrival is a ZERO-WIDTH `data-mpd-tip`;
//   * the radius knob is the constant `EDGE_RADIUS`, and the control is reachable at the LAYOUT:
//     `layout(tasks, radius?)`;
//   * `radius = 0` emits a pure `M`/`L` orthogonal polyline whose `points` ARE the waypoints.
//
// WHY THE CONTAINMENT PROOF IS NOT IN THIS SECTION. W3's six steps (boxes from the DOM, samples from the
// layout, the `data-mpd-curve` bridge, a SEGMENT-vs-interior test, a curve-domain control and a
// non-vacuity floor) need a RENDERED tree, so they live beside the render driver in
// `dag-label-parity.test.ts`. What stays here is the PURE geometry, which is where the radius control
// and the arrival arithmetic belong.

/** One point in the canvas's own pixels. */
interface CurvePoint {
  /** The horizontal position, in the canvas's own pixels. */
  x: number
  /** The vertical position, in the canvas's own pixels. */
  y: number
}

/** One rectangle in the canvas's own pixels. */
interface CurveRect {
  /** The left x. */
  left: number
  /** The top y. */
  top: number
  /** The width. */
  width: number
  /** The height. */
  height: number
}

/** The painted form of one route, as the freeze freezes it. */
interface WebCurve {
  /** The `<path>` `d`. */
  d: string
  /** The flattened polyline of exactly that path. */
  points: CurvePoint[]
  /** The arrival point: the border the edge arrives at. */
  tip: CurvePoint
  /** The corner radius the path was built with. */
  radius: number
}

/** The WEB layout, typed to the fields this section reads. */
interface WebCurveGeometry {
  /** How many rank columns the grid draws. */
  rankCount: number
  /** The grid's own width in pixels. */
  width: number
  /** The grid's own height in pixels, which the canvas bound below is stated over. */
  height: number
  /** The inset every box keeps inside its column. */
  inset: number
  /** One entry per node, in column-major order. */
  nodes: Array<{ task: { id: string }; rank: number; row: number }>
  /** One entry per drawn dependency, in board order. */
  edges: Array<{ parent: string; child: string; witness: string; segments: Array<{ key: string; rect: CurveRect }>; curve: WebCurve; marker: CurveRect; pointsLeft: boolean }>
}

/** The WEB factory's module shape for this section. */
interface WebCurveModule {
  /** The pure geometry, with the freeze's control parameter. */
  layout: (tasks: ReadonlyArray<Record<string, unknown>>, radius?: number) => WebCurveGeometry
}

/** The WEB view's own geometry table, read out of its source at run time. */
const WEB_GEO = numericTableAfter(readSource(WEB_VIEW), "const GEO = {")

/** The freeze's declared corner radius, read out of the same source so a rename reddens loudly. */
const WEB_EDGE_RADIUS = Number(readSource(WEB_VIEW).match(/const EDGE_RADIUS = (\d+(?:\.\d+)?)/)?.[1])

/**
 * Parse a flat `{ key: number }` table declared at one anchor, out of a source text.
 *
 * A missing anchor THROWS rather than returning an empty table: a WEB refactor that renames `GEO` must
 * redden these arms loudly instead of turning every box below into a zero-sized rectangle, which is the
 * one failure mode that would make a containment arm pass by measuring nothing.
 * @param source - the file text to search.
 * @param anchor - the declaration line the literal follows, verbatim including `= {`.
 * @returns the numeric pairs, in source order.
 */
function numericTableAfter(source: string, anchor: string): Record<string, number> {
  /** Where the anchor's declaration begins; `-1` means the view renamed the table. */
  const at = source.indexOf(anchor)
  if (at < 0) throw new Error(`the WEB view no longer declares the anchor ${JSON.stringify(anchor)}`)
  /** Index of the literal's opening brace, which the anchor's own `= {` guarantees. */
  const open = source.indexOf("{", at)
  if (open < 0) throw new Error(`the anchor ${JSON.stringify(anchor)} has no object literal`)
  // Walk to the matching brace so a nested literal cannot truncate the slice.
  let depth = 0
  /** Index of the brace that closes the literal; `-1` until the walk finds it. */
  let close = -1
  for (let i = open; i < source.length; i += 1) {
    /** The character under inspection. */
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
  /** The parsed pairs; a key with no parsable number reddens the caller's expectations rather than vanishing. */
  const pairs: Record<string, number> = {}
  for (const match of source.slice(open + 1, close).matchAll(/([A-Za-z_$][\w$]*)\s*:\s*(-?\d+(?:\.\d+)?)/g)) pairs[match[1]] = Number(match[2])
  return pairs
}

/**
 * Build the WEB module with the freeze's control parameter reachable.
 *
 * The module is rebuilt per call rather than cached: a lane edit is picked up by the NEXT run, and a
 * cached module would let one arm's failure reason leak into another's.
 * @returns the module this section reads.
 */
function loadWebCurve(): WebCurveModule {
  /** The factory source with every type annotation erased, exactly as the build strips it. */
  const stripped = ts.transpileModule(readSource(WEB_VIEW), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
  /** The evaluated factory expression, which the bundle build wraps the same way. */
  const factory = new Function("return (" + stripped.trim().replace(/;$/, "") + ")")() as (deps: unknown) => {
    createTeamView: (deps: unknown) => WebCurveModule
  }
  return factory({}).createTeamView({ react: createHookRuntime().react, statePath: "/p", planPath: "/p", taskPath: "/t", pollMs: 60_000 })
}

/** The y of a box's top, from its row and the view's own GEO table — the render's own expression. */
function webBoxTop(row: number): number {
  return WEB_GEO.pad + row * (WEB_GEO.nodeHeight + WEB_GEO.nodeGap)
}

/** The y of a box's vertical middle, which is where an edge attaches. */
function webBoxMiddle(row: number): number {
  return webBoxTop(row) + WEB_GEO.nodeHeight / 2
}

/** The x of a box's left border, for a column inset. */
function webBorderLeft(rank: number, inset: number): number {
  return rank * WEB_GEO.column + inset
}

/** The x of a box's right border, for a column inset. */
function webBorderRight(rank: number, inset: number): number {
  return rank * WEB_GEO.column + WEB_GEO.column - inset
}

/** A three-task ring: the malformed board that is the ONLY source of a back or same-rank edge. */
const RING_BOARD: ReadonlyArray<GraphTask> = [task("A", 0, ["C"]), task("B", 0, ["A"]), task("C", 0, ["B"])]

/** The two boards these arms judge: a chain (forward edges) and a ring (back or same-rank edges). */
const CURVE_BOARDS: ReadonlyArray<ReadonlyArray<GraphTask>> = [RESOLVABLE_BOARD, RING_BOARD]

/** The depth a board's rows are served with, which the geometry does not trust but the payload needs. */
const CURVE_DEPTH: Readonly<Record<string, number>> = { ...GRAPH_DEPTHS, A: 0, B: 1, C: 2 }

/**
 * One board as the WEB payload serves it.
 * @param board - the board's tasks.
 * @returns the payload rows.
 */
function curveRows(board: ReadonlyArray<GraphTask>): Array<Record<string, unknown>> {
  return board.map(row => webRow(row, CURVE_DEPTH[row.id] ?? 0))
}

describe("W5 · every arrival tip touches the border its edge arrives at", () => {
  test("the tip is a POINT on the arrival border, by arithmetic, for forward AND back/same-rank edges", () => {
    /** How many edges the arithmetic below actually proved something about. */
    let checked = 0
    /** Which of the two directions the boards covered, so neither half can be missing. */
    const directions = new Set<string>()
    for (const board of CURVE_BOARDS) {
      /** The geometry of this board, at the freeze's declared radius. */
      const geometry = loadWebCurve().layout(curveRows(board))
      /** Every box, by task id, from the layout's own rank/row and the view's own GEO table. */
      const boxes = new Map(geometry.nodes.map(node => [node.task.id, { rank: node.rank, row: node.row }]))
      for (const edge of geometry.edges) {
        /** The dependent's placement. */
        const child = boxes.get(edge.child)
        /** The blocker's placement, which decides whether the edge runs forward, level or back. */
        const parent = boxes.get(edge.parent)
        if (child === undefined || parent === undefined) throw new Error(`the layout drew ${edge.witness} over a task it placed no box for`)
        /** The border the edge must arrive at: the child's LEFT when it comes from the left. */
        const border = edge.pointsLeft ? webBorderRight(child.rank, geometry.inset) : webBorderLeft(child.rank, geometry.inset)
        // The equality, through a template literal so the failure names the edge and both numbers.
        expect(`${edge.witness} tipX=${edge.curve.tip.x} border=${border}`).toBe(`${edge.witness} tipX=${border} border=${border}`)
        // AND ON THE DEPENDENT'S OWN MIDDLE: an arrival at the right x but the wrong y would touch the
        // border and still read as an edge into empty space.
        expect(`${edge.witness} tipY=${edge.curve.tip.y}`).toBe(`${edge.witness} tipY=${webBoxMiddle(child.row)}`)
        // The last sample IS the tip: the curve is a polyline into the arrival point, not into a
        // rectangle that happens to contain it.
        /** The polyline's final sample. */
        const last = edge.curve.points[edge.curve.points.length - 1]
        expect(`${edge.witness} last=${last.x},${last.y}`).toBe(`${edge.witness} last=${edge.curve.tip.x},${edge.curve.tip.y}`)
        directions.add(edge.pointsLeft ? "left" : "right")
        checked += 1
      }
    }
    expect(checked).toBeGreaterThan(0)
    // Both classes must exist across the two boards, or one half of W5's sentence went unproven. The
    // ring board is what makes the leftward case reachable at all.
    expect([...directions].sort()).toEqual(["left", "right"])
  })

  test("POSITIVE CONTROL: a tip displaced by one pixel fails the same equality, in either direction", () => {
    /** The geometry of the chain board. */
    const geometry = loadWebCurve().layout(curveRows(RESOLVABLE_BOARD))
    /** The first edge, whose tip the control displaces. */
    const edge = geometry.edges[0]
    /** The dependent's placement. */
    const child = geometry.nodes.find(node => node.task.id === edge.child)
    if (child === undefined) throw new Error("the control found no box for the edge it displaces")
    /** The border the real tip touches. */
    const border = edge.pointsLeft ? webBorderRight(child.rank, geometry.inset) : webBorderLeft(child.rank, geometry.inset)
    expect(edge.curve.tip.x).toBe(border)
    // The control's whole point: W5 is an EQUALITY, so a one-pixel miss is a failure rather than a
    // rounding detail. Both directions of the miss are refused, because a head that overshot into the
    // box is as wrong as one that stopped short of it.
    expect(edge.curve.tip.x + 1).not.toBe(border)
    expect(edge.curve.tip.x - 1).not.toBe(border)
    // AND THE BOX ARITHMETIC THE ARM RESTS ON IS THE VIEW'S OWN, not a copy: the geometry publishes the
    // width as rankCount columns, and the borders must sit inside it.
    expect(geometry.width).toBe(geometry.rankCount * WEB_GEO.column)
    expect(webBorderLeft(child.rank, geometry.inset)).toBeLessThan(geometry.width)
    expect(webBorderRight(child.rank, geometry.inset)).toBeGreaterThan(0)
  })
})

describe("W6 · `radius = 0` reproduces the straight orthogonal path", () => {
  test("at radius 0 every edge publishes points that ARE the orthogonal waypoints", () => {
    /** The geometry of the chain board with every fillet collapsed. */
    const geometry = loadWebCurve().layout(curveRows(RESOLVABLE_BOARD), 0)
    expect(geometry.edges.length).toBeGreaterThan(0)
    /** How many edges the arms below checked. */
    let checked = 0
    for (const edge of geometry.edges) {
      /** The published curve's own three fields, destructured so the arms below read like the freeze. */
      const { points, d, radius } = edge.curve
      expect(`${edge.witness} r=${radius}`).toBe(`${edge.witness} r=0`)
      // A pure `M`/`L` polyline: no `Q` fillet and no `C` sweep may survive a zero radius.
      expect(`${edge.witness} curveCmds=${/^[ML0-9.,\s-]*$/.test(d) ? "none" : "present"}`).toBe(`${edge.witness} curveCmds=none`)
      expect(points.length).toBeGreaterThan(1)
      for (let index = 1; index < points.length; index += 1) {
        /** The sample the leg starts from. */
        const from = points[index - 1]
        /** The sample the leg ends at. */
        const to = points[index]
        // ORTHOGONAL: every leg is axis-aligned, which is the shape the user asked to keep at radius 0.
        expect(`${edge.witness} leg ${index} axis=${from.x === to.x || from.y === to.y}`).toBe(`${edge.witness} leg ${index} axis=true`)
      }
      // AND `d` AND `points` ARE TWO VIEWS OF ONE PATH (the freeze's A4: the polyline IS the path the
      // `d` describes). One `L` per sample, each landing on that sample — so a `d` that skipped a
      // sample, or a sample list padded past the path, reddens here rather than in a browser.
      /** The `L` commands of the straight path, as coordinate pairs. */
      const legs = [...d.matchAll(/L\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)].map(match => ({ x: Number(match[1]), y: Number(match[2]) }))
      expect(`${edge.witness} legs=${legs.length} samples=${points.length - 1}`).toBe(`${edge.witness} legs=${points.length - 1} samples=${points.length - 1}`)
      for (const [index, leg] of legs.entries()) {
        /** The sample this `L` must land on, one further along than the `M`. */
        const sample = points[index + 1]
        expect(`${edge.witness} L${index + 1}=${leg.x},${leg.y}`).toBe(`${edge.witness} L${index + 1}=${sample.x},${sample.y}`)
      }
      // The straight path still STARTS on the blocker and ENDS on the arrival point, so collapsing the
      // radius did not move the dependency it describes.
      /** The blocker's placement. */
      const parent = geometry.nodes.find(node => node.task.id === edge.parent)
      if (parent === undefined) throw new Error(`the layout drew ${edge.witness} from a task it placed no box for`)
      /** Where the straight path begins: the blocker's own border at its middle. */
      const startX = edge.pointsLeft ? webBorderLeft(parent.rank, geometry.inset) : webBorderRight(parent.rank, geometry.inset)
      expect(`${edge.witness} start=${points[0].x},${points[0].y}`).toBe(`${edge.witness} start=${startX},${webBoxMiddle(parent.row)}`)
      /** The polyline's final sample. */
      const last = points[points.length - 1]
      expect(`${edge.witness} end=${last.x},${last.y}`).toBe(`${edge.witness} end=${edge.curve.tip.x},${edge.curve.tip.y}`)
      checked += 1
    }
    expect(checked).toBe(geometry.edges.length)
  })

  test("a positive radius bends the SAME edges — the knob is the only difference", () => {
    /** The geometry at the freeze's declared radius. */
    const filleted = loadWebCurve().layout(curveRows(RESOLVABLE_BOARD))
    /** The geometry with every fillet collapsed. */
    const straight = loadWebCurve().layout(curveRows(RESOLVABLE_BOARD), 0)
    expect(Number.isFinite(WEB_EDGE_RADIUS)).toBe(true)
    expect(WEB_EDGE_RADIUS).toBeGreaterThan(0)
    // Every edge echoes the declared radius, which is what makes the control observable in the LAYOUT
    // output rather than only in the DOM (R1's stated reason for the per-edge field).
    for (const edge of filleted.edges) expect(`${edge.witness} r=${edge.curve.radius}`).toBe(`${edge.witness} r=${WEB_EDGE_RADIUS}`)
    /** How many edges actually changed shape between the two radii. */
    let bent = 0
    for (const [index, edge] of filleted.edges.entries()) {
      if (edge.curve.d !== straight.edges[index].curve.d) bent += 1
    }
    // Non-vacuity: a "control" whose two arms drew the same picture would prove nothing, so at least
    // one edge must differ, and in practice every drawn edge on this board carries a fillet.
    expect(bent).toBeGreaterThan(0)
    // THE CURVE IS REALLY A CURVE where the freeze says it is: the fillets are quadratics and the final
    // approach is a cubic, so at least one of the two command letters must appear.
    expect(filleted.edges.some(edge => /[QqCc]/.test(edge.curve.d))).toBe(true)
  })

  test("the published polyline is CONTINUOUS and never degenerate at the declared radius", () => {
    // These two are the invariants that survive the density bound's retirement (the captain's ruling):
    // a segment test needs the polyline to be unbroken and to contain no zero-length step, because a
    // gap or a repeated sample is a stretch of curve the containment test never inspects.
    /** The longest chord found, REPORTED below rather than bounded by the flattening step. */
    let widest = 0
    /** How many samples the invariants covered. */
    let samples = 0
    /** The longest diagonal any judged board's canvas has, which no chord may exceed. */
    let canvas = 0
    for (const board of CURVE_BOARDS) {
      /** The geometry of this board. */
      const geometry = loadWebCurve().layout(curveRows(board))
      canvas = Math.max(canvas, Math.hypot(geometry.width, geometry.height))
      for (const edge of geometry.edges) {
        for (let index = 1; index < edge.curve.points.length; index += 1) {
          /** The sample the chord starts from. */
          const from = edge.curve.points[index - 1]
          /** The sample the chord ends at. */
          const to = edge.curve.points[index]
          /** The chord's length in pixels. */
          const chord = Math.hypot(to.x - from.x, to.y - from.y)
          // CONTINUITY, and the captain's ordered invariant: a zero-length chord is a repeated sample, the
          // one way the published points can fail to describe the drawn path end to end.
          expect(`${edge.witness} chord ${index} degenerate=${chord === 0}`).toBe(`${edge.witness} chord ${index} degenerate=false`)
          widest = Math.max(widest, chord)
          samples += 1
        }
      }
    }
    expect(samples).toBeGreaterThan(0)
    // THE ONLY UPPER BOUND LEFT, AND AN EARLIER REVISION OF THIS ARM IS WHY IT IS THIS ONE. That revision
    // asserted `chord < nodeHeight` — "a chord longer than a box could skip one" — and it FAILED on
    // 304.5 px, correctly: the emitter samples the ARCS and emits every straight run as ONE `L`, so a
    // rank-skipping leg is a single long chord by design. Chord length was never a soundness bound: a
    // straight chord IS the drawn line and cannot skip anything, and the containment proof rests on the
    // SEGMENT test (in `dag-label-parity.test.ts`) rather than on spacing. What remains assertable here
    // is that no chord leaves the canvas, which is a real geometry-bug detector.
    expect(canvas).toBeGreaterThan(0)
    expect(widest).toBeGreaterThan(0)
    expect(widest).toBeLessThanOrEqual(canvas)
    console.log(`W6 measurement · widest published chord = ${widest.toFixed(4)} px of a ${canvas.toFixed(1)} px canvas · ${samples} chords, none degenerate (EDGE_RADIUS ${WEB_EDGE_RADIUS}, nodeHeight ${WEB_GEO.nodeHeight})`)
  })
})

// ── T3/T7 · the TUI's cell-aware window and the termaid glyph obligations ───────────────────────
//
// WHY THESE TWO ARE PROBED AT RUN TIME. `sliceCells`/`sliceSpans`/`layoutGraphNatural` are this wave's
// frozen names (captain-rulings.md R2), but a static `import` of a name that has not landed yet fails
// the WHOLE FILE, which would hide the thirty arms above. They are therefore read off the module at run
// time and asserted per arm, so an absent export reddens ITS clause and nothing else.

/** The sanitizer surface this section reads. */
interface SanitizerSurface {
  /** The frozen cell-aware cutter (T3). */
  sliceCells?: (text: string, offset: number, cols: number) => string
  /** The measure the cutter is stated in. */
  cellWidth?: (text: string) => number
}

/** The graph surface this section reads, beyond the names imported at the top of this file. */
interface GraphSurface {
  /** The same cut as `sliceCells`, preserving each span's tone (T3). */
  sliceSpans?: (spans: ReadonlyArray<{ text: string; tone: string }>, offset: number, cols: number) => Array<{ text: string; tone: string }>
  /** The natural-width boxes layout, which reports the box form it drew (T1/T7). */
  layoutGraphNatural?: (tasks: readonly GraphTask[], focus?: string, budget?: { rows?: number }) => GraphView
}

/**
 * The TUI drawing module, probed at run time.
 * @returns the module, typed to the surface this section reads.
 */
async function loadGraphSurface(): Promise<GraphSurface> {
  return (await import("../src/graph")) as unknown as GraphSurface
}

/**
 * The sanitizer module, probed at run time.
 * @returns the module, typed to the surface this section reads.
 */
async function loadSanitizer(): Promise<SanitizerSurface> {
  return (await import("../src/sanitize")) as unknown as SanitizerSurface
}

/** The banned ranges clause C1 names, as inclusive code-point bounds — the TUI's own copy. */
const BANNED_RANGES: readonly (readonly [number, number])[] = [
  [0x2e80, 0x2fff],
  [0x3000, 0x303f],
  [0x3040, 0x9fff],
  [0xac00, 0xd7af],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xffef],
]

/** Whether one code point falls in a range clause C1 bans. */
function isBanned(codePoint: number): boolean {
  return BANNED_RANGES.some(([low, high]) => codePoint >= low && codePoint <= high)
}

/**
 * The character the drawing wrote at one CELL of one row.
 *
 * By CELL and not by code point: a wide glyph occupies one array slot and two cells, so an index-based
 * lookup drifts right by one cell per wide character — the exact shear this wave exists to end.
 * @param view - the drawing.
 * @param row - the row index.
 * @param cell - the cell column.
 * @returns the character covering that cell, or undefined when the row does not reach it.
 */
function charAtCell(view: GraphView, row: number, cell: number): string | undefined {
  /** The cells consumed so far on this row. */
  let col = 0
  for (const span of view.lines[row] ?? []) {
    for (const character of span.text) {
      /** The cells this character occupies. */
      const width = cellWidth(character)
      if (col === cell) return character
      col += width
    }
  }
  return undefined
}

/**
 * Every cell at which the drawing wrote one marker character, as `row` + CELL column.
 * @param view - the drawing.
 * @param glyph - the marker to find, a single character.
 * @returns the marker's positions, in drawing order.
 */
function markerCells(view: GraphView, glyph: string): Array<{ row: number; col: number }> {
  /** The positions found. */
  const found: Array<{ row: number; col: number }> = []
  view.lines.forEach((spans, row) => {
    /** The cells consumed so far on this row. */
    let col = 0
    for (const span of spans) {
      /** Where the marker sits inside this span's text. */
      let at = span.text.indexOf(glyph)
      while (at >= 0) {
        found.push({ row, col: col + cellWidth(span.text.slice(0, at)) })
        at = span.text.indexOf(glyph, at + glyph.length)
      }
      col += cellWidth(span.text)
    }
  })
  return found
}

describe("T3 · the horizontal slice is exact, cell-aware, and never splits a wide glyph", () => {
  test("the frozen postcondition holds for EVERY offset and width, over the REAL drawn rows", async () => {
    /** The sanitizer module under test. */
    const surface = await loadSanitizer()
    /** The cutter, which R2 freezes in the module that already owns `cellWidth`. */
    const slice = surface.sliceCells
    if (typeof slice !== "function") throw new Error("sanitize.ts no longer exports sliceCells (T3/R2)")
    /** The drawing whose own rows are the subject, so the arm is not judging a synthetic string only. */
    const view = layoutGraph(RESOLVABLE_BOARD, 60)
    /** How many (row, offset, width) triples the postcondition was checked on. */
    let checked = 0
    for (const row of view.lines) {
      /** The row's text, which is what a page hands the cutter. */
      const text = row.map(span => span.text).join("")
      /** The widths a page may ask for, including zero and one past the row's own cells. */
      for (const cols of [0, 1, 3, 17, 60, 61]) {
        for (let offset = 0; offset <= cellWidth(text) + 2; offset += 1) {
          /** The slice the frozen postcondition is stated over. */
          const cut = slice(text, offset, cols)
          expect(`o=${offset} c=${cols} cells=${cellWidth(cut)}`).toBe(`o=${offset} c=${cols} cells=${cols}`)
          checked += 1
        }
      }
    }
    // A postcondition over nothing proves nothing, so the sweep's own size is asserted.
    expect(checked).toBeGreaterThan(100)
  })

  test("a WIDE glyph straddling an edge is never half-emitted: a space on the left, a drop on the right", async () => {
    /** The sanitizer module under test. */
    const surface = await loadSanitizer()
    /** The cutter under test, proved callable before it is used. */
    const slice = surface.sliceCells
    if (typeof slice !== "function") throw new Error("sanitize.ts no longer exports sliceCells (T3/R2)")
    /** Three wide glyphs: six cells, no ASCII at all. */
    const wide = "宽宽宽"
    // LEFT EDGE: an offset of one lands INSIDE the first glyph, whose second half cannot be drawn. The
    // frozen semantics emit ONE SPACE there, so the window keeps its cell count and shows a gap.
    expect(slice(wide, 1, 3)).toBe(" 宽")
    // RIGHT EDGE: a width of three cuts the second glyph in half. It is DROPPED and the row is padded.
    expect(Array.from(slice(wide, 0, 3)).join("")).toBe("宽 ")
    // BOTH HALVES ARE WHOLE GLYPHS: no output character is a fragment, which is what a code-point slice
    // would produce. Every character is either a space or a character of the input.
    for (const cols of [1, 2, 3, 4, 5, 6]) {
      for (let offset = 0; offset <= 7; offset += 1) {
        for (const character of slice(wide, offset, cols)) {
          expect(`${JSON.stringify(character)} whole=${character === " " || wide.includes(character)}`).toBe(`${JSON.stringify(character)} whole=true`)
        }
      }
    }
  })

  test("POSITIVE CONTROL: the naive code-point slice FAILS the same postcondition on the same input", async () => {
    /** The sanitizer module under test. */
    const surface = await loadSanitizer()
    /** The cutter under test, proved callable before it is used. */
    const slice = surface.sliceCells
    if (typeof slice !== "function") throw new Error("sanitize.ts no longer exports sliceCells (T3/R2)")
    /** The naive cutter this arm exists to be able to reject. */
    const naive = (text: string, offset: number, cols: number): string => Array.from(text).slice(offset, offset + cols).join("")
    /** A row two wide glyphs long, which is enough to make the two disagree. */
    const wide = "宽宽"
    expect(naive(wide, 1, 3)).toBe("宽")
    expect(cellWidth(naive(wide, 1, 3))).toBe(2)
    // The same input, the same window: the frozen cutter answers THREE cells and the naive one does not,
    // so the postcondition above can tell them apart — the check is falsifiable.
    expect(cellWidth(slice(wide, 1, 3))).toBe(3)
  })

  test("`sliceSpans` is the SAME cut, preserving each span's tone", async () => {
    /** The sanitizer module under test. */
    const surface = await loadSanitizer()
    /** The graph module under test. */
    const graph = await loadGraphSurface()
    /** The cutter under test, proved callable before it is used. */
    const slice = surface.sliceCells
    /** The span cutter, which is the other half of the "one cut, two views" claim. */
    const spans = graph.sliceSpans
    if (typeof slice !== "function") throw new Error("sanitize.ts no longer exports sliceCells (T3/R2)")
    if (typeof spans !== "function") throw new Error("graph.ts no longer exports sliceSpans (T3/R2)")
    /** The drawing whose own spans are the subject. */
    const view = layoutGraph(RESOLVABLE_BOARD, 60)
    /** How many (row, offset) pairs the two cutters agreed on. */
    let agreed = 0
    for (const row of view.lines) {
      /** The row's text, for the string cutter. */
      const text = row.map(span => span.text).join("")
      for (const cols of [0, 2, 8, 20]) {
        for (let offset = 0; offset <= cellWidth(text); offset += 3) {
          /** The span-preserving cut. */
          const cut = spans(row, offset, cols)
          // ONE CUT, TWO VIEWS: the two frozen functions must agree character for character, or a page
          // that slices spans and a page that slices strings would show different windows at the same
          // offset — the "second scroller" defect in its smallest form.
          expect(`c=${cols} o=${offset}: ${cut.map(span => span.text).join("")}`).toBe(`c=${cols} o=${offset}: ${slice(text, offset, cols)}`)
          // And the cut is exactly the viewport, every time.
          expect(`c=${cols} o=${offset} cells=${cellWidth(cut.map(span => span.text).join(""))}`).toBe(`c=${cols} o=${offset} cells=${cols}`)
          // Every kept span keeps a tone the source actually used, so the cut cannot invent a colour.
          for (const span of cut) expect(row.some(source => source.tone === span.tone) || span.tone === "blank").toBe(true)
          agreed += 1
        }
      }
    }
    expect(agreed).toBeGreaterThan(0)
  })
})

describe("T7 · the termaid glyph obligations, read out of the source rather than restated", () => {
  test("every declared glyph is exactly ONE CELL, and none of them is in a C1-banned range", () => {
    // The obligation is the freeze's (e) rules 3 and 4, and it is recomputed here rather than read off
    // the module's own `DAG_CHARS_ONE_CELL`, because a boolean the module computes about itself would
    // make this arm a tautology.
    /** The glyphs, as values, with their own member names for the failure message. */
    const entries = Object.entries(DAG_CHARS) as Array<[string, string]>
    expect(entries.length).toBeGreaterThan(10)
    for (const [name, glyph] of entries) {
      expect(`${name}:${[...glyph].length > 0}`).toBe(`${name}:true`)
      for (const character of glyph) {
        expect(`${name}:${JSON.stringify(character)}=${cellWidth(character)}`).toBe(`${name}:${JSON.stringify(character)}=1`)
        // A glyph inside a banned range would put a CJK character into every drawing that uses it.
        expect(`${name}:${JSON.stringify(character)} banned=${isBanned(character.codePointAt(0) ?? 0)}`).toBe(`${name}:${JSON.stringify(character)} banned=false`)
      }
    }
    // The module's own claim about the same fact must agree with the recomputation above.
    expect(DAG_CHARS_ONE_CELL).toBe(true)
  })

  test("the four NODE corners are the rounded set (T7's first sentence)", () => {
    // Spelled as the four code points the clause names, so a table that reverted to the sharp corners
    // reddens here even though every OTHER glyph stayed one cell.
    expect(DAG_CHARS.cornerDownRight).toBe("╭")
    expect(DAG_CHARS.cornerDownLeft).toBe("╮")
    expect(DAG_CHARS.cornerUpRight).toBe("╰")
    expect(DAG_CHARS.cornerUpLeft).toBe("╯")
    // The sharp set is refused explicitly: `graph.ts` had it before this wave, and a half-migrated
    // drawing that rounded the corners in the table but kept a literal would pass everything else.
    for (const sharp of ["┌", "┐", "└", "┘"]) expect(Object.values(DAG_CHARS)).not.toContain(sharp)
  })

  test("`graph.ts` declares no sharp NODE corner: the boxed drawing reads the table (R2/T7)", () => {
    /** The drawing's own source, read at run time so a lane edit re-judges this arm. */
    const graph = readSource(TUI_GRAPH)
    // THE THREE CORNERS THE BOXED DRAWING USED TO SPELL. A table rounded in `dag-theme.ts` while one of
    // these survives in `graph.ts` would draw a HALF-ROUNDED box, and every other arm in this file would
    // still call it green — which is why the literals themselves are refused here.
    for (const sharp of ["┌", "┐", "┘"]) {
      expect(`literal ${sharp} in graph.ts: ${graph.includes(sharp)}`).toBe(`literal ${sharp} in graph.ts: false`)
    }
    // `└` IS DELIBERATELY NOT IN THAT SET, and the reason is DECLARED rather than tolerated: the freeze
    // keeps the RAIL/LIST elbows sharp (they are T9's narrow fallbacks), and both are declared in the
    // table so the pair cannot be half-rounded. Every `└` in the drawing must be that elbow or the
    // comment that names it.
    expect(DAG_CHARS.railElbowLast).toBe("└─")
    /** The lines of `graph.ts` that carry a `└`, which may only be the rail elbow or its comment. */
    const withSharpBottomLeft = graph.split("\n").filter(line => line.includes("└"))
    expect(withSharpBottomLeft.length).toBeGreaterThan(0)
    for (const line of withSharpBottomLeft) {
      /** The trimmed line, so an indented elbow is recognised the same way. */
      const trimmed = line.trim()
      /** Whether this line is the declared elbow, or prose about it. */
      const isElbowOrProse = trimmed.includes("└─") || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")
      expect(`rail elbow only [${trimmed.slice(0, 40)}]: ${isElbowOrProse}`).toBe(`rail elbow only [${trimmed.slice(0, 40)}]: true`)
    }
    // AND THE TABLE IS THE DRAWING'S SOURCE: `graph.ts` READS the declared glyphs rather than keeping
    // private copies of them — the duplication R2 removed, whose failure mode is two tables drifting.
    expect(graph.includes("DAG_CHARS.")).toBe(true)
  })

  test("every dependency is entered by exactly ONE `▼`, whose tip touches the dependent's TOP border", () => {
    /** The drawing under judgement. */
    const view = layoutGraph(RESOLVABLE_BOARD, 200)
    /** Every arrowhead the drawing wrote, by cell. */
    const arrows = markerCells(view, DAG_CHARS.arrowDown)
    expect(arrows.length).toBeGreaterThan(0)
    /** How many dependents the arm resolved an arrow for. */
    let entered = 0
    for (const hit of view.hits) {
      /** The board's own row for this task. */
      const row = RESOLVABLE_BOARD.find(task => task.id === hit.taskId)
      if (row === undefined || row.dependencies.length === 0) continue
      /** The arrows whose own cell resolves into THIS task's entry: one row above its top border, and
       * inside its own columns. */
      const mine = arrows.filter(arrow => arrow.row === hit.row - 1 && arrow.col >= hit.col && arrow.col <= hit.colEnd)
      // ONCE PER CHILD, even under fan-in (the freeze's table note): five blockers pointing at one task
      // must still draw ONE head, or the border reads as five entry points.
      expect(`${hit.taskId} arrows=${mine.length}`).toBe(`${hit.taskId} arrows=1`)
      /** The arrow's own cell. */
      const arrow = mine[0]
      // THE TIP TOUCHES THE TOP BORDER ROW: the arrow sits at `childTop − 1` in BOTH box forms, so the
      // cell directly below it is the dependent's own top border.
      expect(`${hit.taskId} below=${charAtCell(view, arrow.row + 1, arrow.col)}`).toBe(`${hit.taskId} below=${DAG_CHARS.teeUp}`)
      // A `▼` written anywhere but the centre would meet the border off its own mid-line. A box with an
      // EVEN cell count has TWO middle cells, and the freeze fixes the column only as "the dependent's
      // CENTRE", so either is accepted: pinning the rounding convention would redden a correct drawing
      // (measured: the lane picks cell 17 of a 34-cell box, where this arm's first revision demanded 16).
      /** The left of the two middle cells. */
      const midLeft = Math.floor((hit.col + hit.colEnd) / 2)
      expect(`${hit.taskId} centre=${arrow.col === midLeft || arrow.col === midLeft + 1}`).toBe(`${hit.taskId} centre=true`)
      entered += 1
    }
    // Non-vacuity: the drawing has dependents, so the loop above must have resolved at least one.
    expect(entered).toBeGreaterThan(0)
  })

  test("AC2: EVERY drawing reports the COMPACT three-row form, and no vertical budget buys padding rows", async () => {
    /** The graph module under test. */
    const graph = await loadGraphSurface()
    /** The natural-width entry point, which is where the budget used to choose the form. */
    const natural = graph.layoutGraphNatural
    if (typeof natural !== "function") throw new Error("graph.ts no longer exports layoutGraphNatural (T1/R2)")
    /** The ranks the board needs, which is what the OLD roomy-form rule was stated in. */
    const ranks = new Set(layoutGraph(RESOLVABLE_BOARD, 200).hits.map(hit => hit.row)).size
    // THE BUDGET THAT USED TO BUY THE ROOMY FORM (`rows >= ranks * 8 + 2`), the one that never could, a
    // generous one and NO budget at all. All four draw the SAME form now, so a layout that still
    // answered five for a generous budget — or that kept a second form for the no-budget caller —
    // reddens here rather than at a render.
    for (const budget of [{ rows: ranks * 8 + 40 }, { rows: 5 }, { rows: 10_000 }, undefined]) {
      /** The drawing for this budget. */
      const view = natural(RESOLVABLE_BOARD, undefined, budget)
      expect(`budget=${JSON.stringify(budget)} boxRows=${view.boxRows}`).toBe(`budget=${JSON.stringify(budget)} boxRows=3`)
      expect(`budget=${JSON.stringify(budget)} mode=${view.mode}`).toBe(`budget=${JSON.stringify(budget)} mode=boxes`)
      /** Every task box's own rows, read through its hit rectangle. */
      for (const hit of view.hits) {
        // THREE ROWS PER BOX, top border / content / bottom border: the rectangle spans exactly two
        // rows beyond its top, which is the form's own arithmetic rather than a reported flag.
        expect(`boxRows=${view.boxRows} ${hit.taskId} rows=${hit.rowEnd - hit.row}`).toBe(`boxRows=${view.boxRows} ${hit.taskId} rows=2`)
        // AND THE CORNERS ARE STILL ROUNDED (clause AC2's first sentence, which this wave does NOT
        // revert): the top-left cell of every box is the table's rounded corner, in every budget.
        expect(`boxRows=${view.boxRows} ${hit.taskId}=${charAtCell(view, hit.row, hit.col)}`).toBe(`boxRows=${view.boxRows} ${hit.taskId}=${DAG_CHARS.cornerDownRight}`)
      }
      // THE RANK STRIDE IS SIX — three box rows plus the three connector rows that carry a rank's edges
      // to the next one — so consecutive rank tops differ by exactly six. A layout that kept the roomy
      // form's eight-row stride while reporting three would pass the flag check and fail this one.
      /** The distinct rank tops, ascending. */
      const tops = [...new Set(view.hits.map(hit => hit.row))].sort((left, right) => left - right)
      expect(tops.length).toBeGreaterThan(1)
      for (let at = 1; at < tops.length; at++) expect(`stride=${tops[at] - tops[at - 1]}`).toBe("stride=6")
    }
  })
})
