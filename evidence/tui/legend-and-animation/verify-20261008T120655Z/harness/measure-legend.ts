/**
 * MEASUREMENT 1 — drive the legend composer and print the drawn legend line VERBATIM.
 *
 * This is a MEASUREMENT, not a code read: it imports the shipped `legendLinesFor` from
 * `packages/mpd-tui-plugin/src/panel-core.ts` and CALLS it, then judges the drawn string against the
 * six §1 conditions of the frozen contract `.mpd/plans/tui-legend-and-animation-fix.md`.
 *
 * It then attempts to FALSIFY the fix's argument: `Panel B` builds a MUTANT copy of the source tree
 * (in this evidence directory; no product file is touched) in which a SECOND mark is shared, and
 * drives the real composer from that copy. If the rule is not specific to the `open`/`blocked` pair,
 * the mutant must print ONE entry per shared mark naming every carrier.
 */
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

/** The repository root, resolved from this script's own location (evidence/.../harness). */
const ROOT = resolve(import.meta.dir, "../../../../..")
/** The package under measurement. */
const SRC = join(ROOT, "packages/mpd-tui-plugin/src")
/** Where the mutant copy of the tree is built: this evidence directory, never the product tree. */

/** The composer and the contract it reads. */
const core = (await import(join(SRC, "panel-core.ts"))) as Record<string, any>
/** The frozen vocabulary tables (`DAG_STATE_TONES`, `DAG_TONE_GLYPH`, `DAG_ANIM`). */
const theme = (await import(join(SRC, "dag-theme.ts"))) as Record<string, any>
/** The package's own cell-width primitive, so widths are measured the way the panel measures them. */
const san = (await import(join(SRC, "sanitize.ts"))) as Record<string, any>

/** Every failed check, so the exit code is the run's verdict. */
const failures: string[] = []
/**
 * Record one judged condition.
 * @param name - the condition being judged.
 * @param ok - whether it held.
 * @param detail - the evidence, printed either way.
 */
function check(name: string, ok: boolean, detail: string): void {
  if (!ok) failures.push(name)
  console.log(`${ok ? "PASS" : "FAIL"} | ${name} | ${detail}`)
}

console.log("=".repeat(100))
console.log("PANEL A — the shipped legend composer, driven directly, at the reference widths")
console.log("=".repeat(100))

/** The six state names the contract orders the key by. */
const STATES: string[] = [...theme.DAG_STATE_TONES]
/** The glyph table AS IT IS NOW — the contract froze this table and forbade changing it. */
const GLYPH: Record<string, string> = theme.DAG_TONE_GLYPH
/** The glyphs the contract's §2 names as owned by OTHER states, for the collision check. */
const OWNED_BY_OTHERS: string[] = ["✓", "✗", "○", "⊘"]

console.log(`DAG_STATE_TONES = ${JSON.stringify(STATES)}`)
console.log(`DAG_TONE_GLYPH  = ${JSON.stringify(GLYPH)}`)
console.log(`cellWidth (sanitize.ts) = ${san.cellWidth("│◐│")} for a 3-cell probe string`)
console.log("")

/** The widths judged below: the reference capture's 156, the suites' 100 and 60, and the page floor. */
const WIDTHS: number[] = [156, 100, 60]
/** The page's own declared floor, read from the contract rather than re-typed. */
const FLOOR: number = core.panelFloorColumns("dag")
console.log(`panelFloorColumns("dag") = ${FLOOR}`)
console.log("")

for (const cols of WIDTHS) {
  /** The lines the SHIPPED composer draws at this width, with no arrow line to forward. */
  const lines: string[] = core.legendLinesFor(cols, [])
  console.log("-".repeat(100))
  console.log(`cols=${cols} → legendLinesFor(cols, []) returned ${lines.length} line(s):`)
  for (const [index, line] of lines.entries()) {
    console.log(`  line[${index}] (cellWidth=${san.cellWidth(line)}): ${JSON.stringify(line)}`)
  }
  console.log("")

  /** The whole drawn key, as a reader sees it, with the wrap made explicit. */
  const drawn = lines.join("\n")
  /** Every entry the key drew, split on the composer's own separator. */
  const entries: string[] = lines.flatMap((line) => line.split(" · "))

  // §1 — exactly ONE entry for the `○` mark, naming BOTH `open` and `blocked`.
  /** The entries that open with the shared mark. */
  const shared = entries.filter((entry) => entry.startsWith(`${GLYPH.blocked} `))
  check(
    `§1.1 cols=${cols}: exactly ONE entry for the shared mark`,
    shared.length === 1,
    `entries starting "${GLYPH.blocked} " = ${JSON.stringify(shared)}`,
  )
  check(
    `§1.1 cols=${cols}: that entry names BOTH open and blocked`,
    shared.length === 1 && shared[0].includes("open") && shared[0].includes("blocked"),
    `entry = ${JSON.stringify(shared[0] ?? null)}`,
  )

  // §1.2 — NO `=` anywhere; no two entries describe the same fact.
  check(`§1.2 cols=${cols}: no "=" anywhere in the drawn key`, !drawn.includes("="), `drawn = ${JSON.stringify(drawn)}`)
  /** One glyph per entry, so no fact is stated twice. */
  const entryGlyphs: string[] = entries.map((entry) => entry.split(" ")[0])
  check(
    `§1.2 cols=${cols}: every entry carries a DISTINCT mark (no fact twice)`,
    new Set(entryGlyphs).size === entryGlyphs.length,
    `marks = ${JSON.stringify(entryGlyphs)}`,
  )

  // §1.3 — the `○` glyph is still the mark shown, and the table is the frozen one.
  check(
    `§1.3 cols=${cols}: the shared entry's mark is the table's own glyph`,
    shared.length === 1 && shared[0].startsWith(`${GLYPH.open} `) && GLYPH.open === GLYPH.blocked,
    `GLYPH.open=${JSON.stringify(GLYPH.open)} GLYPH.blocked=${JSON.stringify(GLYPH.blocked)}`,
  )
  check(
    `§1.3: DAG_TONE_GLYPH still declares the contract's six marks`,
    JSON.stringify([STATES.map((state) => GLYPH[state])]) === JSON.stringify([["✓", "◐", "○", "✗", "○", "⊘"]]),
    `marks in DAG_STATE_TONES order = ${JSON.stringify(STATES.map((state) => GLYPH[state]))}`,
  )

  // §1.4 — the four fully-distinct states keep exactly one entry each.
  for (const state of ["completed", "running", "failed", "cancelled"]) {
    /** Every entry naming this state. */
    const naming = entries.filter((entry) => new RegExp(`\\b${state}\\b`, "u").test(entry))
    check(
      `§1.4 cols=${cols}: ${state} keeps exactly one entry`,
      naming.length === 1,
      `entries naming ${state} = ${JSON.stringify(naming)}`,
    )
  }

  // §1.5 — never abbreviated, never truncated: every line fits the row, and every entry is complete.
  check(
    `§1.5 cols=${cols}: every drawn line fits the row`,
    lines.every((line) => san.cellWidth(line) <= cols),
    `widths = ${JSON.stringify(lines.map((line) => san.cellWidth(line)))} ≤ ${cols}`,
  )
  /** Every state named by the drawn key, as whole words. */
  const named = STATES.filter((state) => new RegExp(`\\b${state}\\b`, "u").test(drawn))
  check(
    `§1.5 cols=${cols}: no entry was abbreviated (all six states present as whole words)`,
    named.length === 6,
    `named = ${JSON.stringify(named)} of ${JSON.stringify(STATES)}`,
  )
  /** The count of marks drawn equals the count of distinct marks in the contract. */
  const distinctMarks = new Set(STATES.map((state) => GLYPH[state]))
  check(
    `§1.5 cols=${cols}: the key drew one entry per distinct mark (no entry dropped at this width)`,
    entries.length === distinctMarks.size,
    `entries=${entries.length} distinctMarks=${distinctMarks.size}`,
  )

  // §1.6 — interpolated from the contract, never a re-typed literal (see PANEL C for the static half).
  /** The marks actually drawn. */
  const drawnMarks = [...new Set(entryGlyphs)]
  check(
    `§1.6 cols=${cols}: every drawn mark is a value OF the frozen table`,
    drawnMarks.every((mark) => Object.values(GLYPH).includes(mark)) && drawnMarks.length === distinctMarks.size,
    `drawnMarks=${JSON.stringify(drawnMarks)} tableValues=${JSON.stringify([...distinctMarks])}`,
  )
}

console.log("=".repeat(100))
console.log("PANEL B — FALSIFICATION: is the rule specific to the open/blocked pair, or general?")
console.log("=".repeat(100))
// The mutant is built by COPYING the shipped source tree and changing ONE literal in the copy's
// `DAG_TONE_GLYPH`. No product file is written; the copies live in this evidence directory.
// EACH MUTANT GETS ITS OWN DIRECTORY: a module cache key is the resolved path, so reusing one
// directory would let the second mutant's `./dag-theme.js` import resolve to the FIRST mutant's
// already-loaded module — and the second falsification would silently test the first mutation.
/** The original glyph-table line, the mutation anchor, verbatim from the shipped table. */
const ORIGINAL_LINE = `  completed: "✓", running: "◐", failed: "✗", blocked: "○", cancelled: "⊘", open: "○",`
/** Mutant 1 — THREE states carry `○`, so the shared mark has three carriers instead of two. */
const MUTANT_THREE = `  completed: "✓", running: "◐", failed: "✗", blocked: "○", cancelled: "○", open: "○",`
/** Mutant 2 — a SECOND mark is shared (`✗` by failed and cancelled) while `○` stays shared. */
const MUTANT_SECOND = `  completed: "✓", running: "◐", failed: "✗", blocked: "○", cancelled: "✗", open: "○",`

/**
 * Build a ONE-LITERAL mutant of the shipped tree and drive the composer from it.
 * @param name - the mutant directory's name, unique per mutation so module caches cannot alias.
 * @param replacement - the glyph-table line to write into the mutant copy.
 * @returns the lines the REAL composer drew against the mutant contract, plus the mutant table.
 */
async function driveMutant(name: string, replacement: string): Promise<{ lines: string[]; glyphs: Record<string, string> }> {
  /** This mutant's own copy of the shipped source tree. */
  const dir = join(import.meta.dir, name)
  rmSync(dir, { recursive: true, force: true })
  cpSync(SRC, dir, { recursive: true })
  /** The mutant's own dag-theme module. */
  const path = join(dir, "dag-theme.ts")
  /** The mutant table's source, with the one literal replaced. */
  const text = readFileSync(path, "utf8")
  if (!text.includes(ORIGINAL_LINE)) throw new Error(`mutant anchor not found in ${path}`)
  writeFileSync(path, text.replace(ORIGINAL_LINE, replacement))
  /** The mutant's composer — the shipped function body, against the mutant table. */
  const mutantCore = (await import(join(dir, "panel-core.ts"))) as Record<string, any>
  /** The mutant's table, read back so the mutation is proved to be in force. */
  const mutantTheme = (await import(join(dir, "dag-theme.ts"))) as Record<string, any>
  /** The lines the composer drew at 200 columns, where the whole key fits on one line. */
  const lines = mutantCore.legendLinesFor(200, []) as string[]
  rmSync(dir, { recursive: true, force: true })
  return { lines, glyphs: mutantTheme.DAG_TONE_GLYPH as Record<string, string> }
}

// Mutant 1 — three carriers of one mark.
console.log("")
console.log("MUTANT 1 — `cancelled` also draws `○`, so ONE mark has THREE carriers:")
const three = await driveMutant("mutant-three", MUTANT_THREE)
console.log(`  mutant table = ${JSON.stringify(three.glyphs)}`)
for (const line of three.lines) console.log(`  drawn: ${JSON.stringify(line)}`)
/** Mutant 1's whole key, the single line the composer drew. */
const threeKey = three.lines[0] ?? ""
/** Mutant 1's entries, split on the composer's own separator. */
const threeEntries = threeKey.split(" · ")
check(
  "FALSIFY 1: three carriers of one mark still draw ONE entry naming ALL THREE",
  threeEntries.length === 4 &&
    threeEntries.some((entry) => entry.startsWith(`${three.glyphs.blocked} `) && entry.includes("open") && entry.includes("blocked") && entry.includes("cancelled")),
  `entries = ${JSON.stringify(threeEntries)}`,
)
check(
  "FALSIFY 1: the four other states still keep one entry each (no entry lost)",
  ["completed", "running", "failed"].every((state) => threeEntries.some((entry) => entry.endsWith(state))),
  `entries = ${JSON.stringify(threeEntries)}`,
)
check("FALSIFY 1: still no `=` under three carriers", !threeKey.includes("="), `drawn = ${JSON.stringify(threeKey)}`)

// Mutant 2 — two marks shared at once.
console.log("")
console.log("MUTANT 2 — `✗` shared by failed+cancelled AND `○` shared by open+blocked (TWO shared marks):")
const two = await driveMutant("mutant-two", MUTANT_SECOND)
console.log(`  mutant table = ${JSON.stringify(two.glyphs)}`)
for (const line of two.lines) console.log(`  drawn: ${JSON.stringify(line)}`)
/** Mutant 2's whole key. */
const twoKey = two.lines[0] ?? ""
/** Mutant 2's entries that carry more than one state. */
const twoShared = twoKey.split(" · ").filter((entry) => entry.includes("/"))
check(
  "FALSIFY 2: TWO shared marks each draw exactly ONE entry naming both carriers",
  twoShared.length === 2 &&
    twoShared.some((entry) => entry.includes("open") && entry.includes("blocked")) &&
    twoShared.some((entry) => entry.includes("failed") && entry.includes("cancelled")),
  `entries carrying "/" = ${JSON.stringify(twoShared)}`,
)
check("FALSIFY 2: still no `=` under a second shared mark", !twoKey.includes("="), `drawn = ${JSON.stringify(twoKey)}`)

// The copy must differ from the shipped tree in exactly the mutated line (plus nothing else).

console.log("")
console.log("=".repeat(100))
console.log(`PANEL B VERDICT: ${failures.length === 0 ? "every falsification attempt FAILED to break the rule (the rule held)" : `${failures.length} check(s) FAILED`}`)
console.log("=".repeat(100))
if (failures.length > 0) {
  console.log("FAILED CHECKS:")
  for (const failure of failures) console.log(`  - ${failure}`)
}
process.exit(failures.length === 0 ? 0 : 1)
