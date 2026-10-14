/**
 * MEASUREMENT 2 — the running mark's CELL WIDTH at EVERY phase, over several full cycles.
 *
 * This drives the shipped `runningGlyph` from `packages/mpd-tui-plugin/src/panel-core.ts` and reports
 * the frame and its CELL WIDTH per phase. It judges the four §2 conditions of the frozen contract
 * `.mpd/plans/tui-legend-and-animation-fix.md`, and it cross-checks the width with primitives that do
 * NOT come from the package (`String.length` in UTF-16 units, a code-point count, and an
 * `Intl.Segmenter` grapheme count) so the "one cell" claim does not rest only on the package's own
 * `cellWidth`.
 *
 * It also reports, separately and explicitly, (a) that the frames DIFFER across the cycle, (b) that no
 * frame collides with a glyph another state owns, and (c) that the frame at the contract's
 * `staticPhase` is the contract's own `running` glyph.
 */
import { join, resolve } from "node:path"

/** The repository root, resolved from this script's own location (evidence/.../harness). */
const ROOT = resolve(import.meta.dir, "../../../../..")
/** The package under measurement. */
const SRC = join(ROOT, "packages/mpd-tui-plugin/src")

/** The shipped running-glyph function. */
const core = (await import(join(SRC, "panel-core.ts"))) as Record<string, any>
/** The frozen contract tables (`DAG_TONE_GLYPH`, `DAG_STATE_TONES`, `DAG_ANIM`). */
const theme = (await import(join(SRC, "dag-theme.ts"))) as Record<string, any>
/** The package's own cell-width primitive. */
const san = (await import(join(SRC, "sanitize.ts"))) as Record<string, any>
/** The second consumer of the same orbit (the subagent panel's row marker). */
const scene = (await import(join(SRC, "subagent-scene.ts"))) as Record<string, any>

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

/** Counts grapheme clusters without the package's own width code. */
const SEGMENTER = new Intl.Segmenter("en", { granularity: "grapheme" })
/**
 * Count the grapheme clusters of a string, independently of `cellWidth`.
 * @param value - the string to measure.
 * @returns the number of grapheme clusters.
 */
function graphemes(value: string): number {
  return [...SEGMENTER.segment(value)].length
}

/** The six state names the contract orders the key by. */
const STATES: string[] = [...theme.DAG_STATE_TONES]
/** The glyph table the contract froze. */
const GLYPH: Record<string, string> = theme.DAG_TONE_GLYPH
/** The animation contract block. */
const ANIM: Record<string, any> = theme.DAG_ANIM

console.log("=".repeat(100))
console.log("MEASUREMENT 2 — the running mark's cell width at every phase")
console.log("=".repeat(100))
console.log(`DAG_TONE_GLYPH.running        = ${JSON.stringify(GLYPH.running)}`)
console.log(`DAG_ANIM.runningFrames        = ${JSON.stringify(ANIM.runningFrames)}`)
console.log(`DAG_ANIM.frames               = ${ANIM.frames}`)
console.log(`DAG_ANIM.staticPhase          = ${ANIM.staticPhase}`)
console.log(`DAG_ANIM.intervalMs           = ${ANIM.intervalMs}`)
console.log("")

// ── §2.1 — the per-phase table, over FOUR full cycles (more than the two cycles required) ───────────
/** The frame count of the cycle, as the contract derives it. */
const CYCLE: number = ANIM.frames
/** The phases measured; four full cycles, well past the two the verdict requires. */
const PHASES: number[] = Array.from({ length: CYCLE * 4 }, (_, index) => index)

console.log("-".repeat(100))
console.log(`§2.1 THE PER-PHASE TABLE — phases 0..${PHASES.length - 1} (${PHASES.length / CYCLE} full cycles of ${CYCLE})`)
console.log("-".repeat(100))
console.log("phase | phase%CYCLE | frame | cellWidth | utf16 | codepoints | graphemes | codePoints")
console.log("------|------------|-------|-----------|-------|------------|-----------|-----------")
/** Every frame drawn, keyed by its phase within the cycle. */
const bySlot = new Map<number, string>()
for (const phase of PHASES) {
  /** The glyph the shipped function returns for this phase. */
  const frame: string = core.runningGlyph(phase)
  /** The phase's slot within the cycle, as the function computes it. */
  const slot = ((Math.floor(phase) % CYCLE) + CYCLE) % CYCLE
  /** The frame's code points, for the log. */
  const points = [...frame].map((char) => `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`).join(" ")
  console.log(
    `${String(phase).padStart(5)} | ${String(slot).padStart(10)} | ${frame.padEnd(5)} | ${String(san.cellWidth(frame)).padStart(9)} | ${String(frame.length).padStart(5)} | ${String([...frame].length).padStart(10)} | ${String(graphemes(frame)).padStart(9)} | ${points}`,
  )
  bySlot.set(slot, frame)
}
console.log("")

check(
  `§2.1 EVERY frame of ${PHASES.length} phases is EXACTLY ONE CELL`,
  PHASES.every((phase) => san.cellWidth(core.runningGlyph(phase)) === 1),
  `widths observed = ${JSON.stringify([...new Set(PHASES.map((phase) => san.cellWidth(core.runningGlyph(phase))))])}`,
)
check(
  "§2.1 independent cross-check: every frame is ONE code point and ONE grapheme",
  PHASES.every((phase) => [...core.runningGlyph(phase)].length === 1 && graphemes(core.runningGlyph(phase)) === 1),
  `codepoint/grapheme counts = ${JSON.stringify([...new Set(PHASES.map((phase) => [...core.runningGlyph(phase)].length))])} / ${JSON.stringify([...new Set(PHASES.map((phase) => graphemes(core.runningGlyph(phase))))])}`,
)
check(
  "§2.1 the functions reported no multi-cell frame anywhere (no width ever exceeded 1)",
  PHASES.every((phase) => san.cellWidth(core.runningGlyph(phase)) <= 1 && core.runningGlyph(phase).length >= 1),
  `max cellWidth = ${Math.max(...PHASES.map((phase) => san.cellWidth(core.runningGlyph(phase))))}`,
)

// ── §2.2 — the frames DIFFER across the cycle (the animation is KEPT) ───────────────────────────────
console.log("-".repeat(100))
console.log("§2.2 THE ANIMATION IS KEPT — the frames must DIFFER across the cycle")
console.log("-".repeat(100))
/** The distinct frames the cycle draws, in slot order. */
const distinct = [...new Set(PHASES.map((phase) => core.runningGlyph(phase)))]
console.log(`distinct frames across the cycle = ${JSON.stringify(distinct)} (count ${distinct.length})`)
check(
  "§2.2 the cycle draws MORE THAN ONE distinct frame (not a static mark)",
  distinct.length > 1,
  `distinct frames = ${JSON.stringify(distinct)}`,
)
check(
  "§2.2 the cycle draws exactly as many distinct frames as the contract declares",
  distinct.length === CYCLE,
  `distinct=${distinct.length} DAG_ANIM.frames=${CYCLE}`,
)
/** The slot → frame mapping, printed so a reader can see the orbit is periodic. */
console.log(`slot → frame: ${JSON.stringify([...bySlot.entries()].sort((a, b) => a[0] - b[0]))}`)
check(
  "§2.2 the orbit is PERIODIC: phase and phase+CYCLE draw the same frame",
  PHASES.every((phase) => core.runningGlyph(phase) === core.runningGlyph(phase + CYCLE)),
  `phase0=${core.runningGlyph(0)} phase+${CYCLE}=${core.runningGlyph(CYCLE)}`,
)

// ── §2.3 — no frame collides with another state's glyph ────────────────────────────────────────────
console.log("-".repeat(100))
console.log("§2.3 NO COLLISION — no frame may be a mark another state owns")
console.log("-".repeat(100))
/** The marks owned by states OTHER than `running`, read out of the frozen table. */
const ownedByOthers = [...new Set(STATES.filter((state) => state !== "running").map((state) => GLYPH[state]))]
/** The marks a frame may never be: another state's mark, or something that reads as "no state". */
const forbidden = [...ownedByOthers, " ", ".", "·", "", "\t"]
console.log(`marks owned by OTHER states = ${JSON.stringify(ownedByOthers)}`)
console.log(`forbidden frames            = ${JSON.stringify(forbidden)}`)
for (const frame of distinct) {
  console.log(`  frame ${JSON.stringify(frame)}: collides-with-another-state=${forbidden.includes(frame)}`)
}
check(
  "§2.3 no frame is a mark another state owns, nor a bare space/dot",
  distinct.every((frame) => !forbidden.includes(frame)),
  `distinct frames = ${JSON.stringify(distinct)} vs forbidden = ${JSON.stringify(forbidden)}`,
)

// ── §2.4 — the frame at staticPhase is the contract's own running glyph ────────────────────────────
console.log("-".repeat(100))
console.log("§2.4 THE TIMER-LESS HOST — the frame at `staticPhase` is the contract's own `running` glyph")
console.log("-".repeat(100))
/** The frame a host with no animation timer draws. */
const staticFrame = core.runningGlyph(ANIM.staticPhase)
console.log(`runningGlyph(DAG_ANIM.staticPhase=${ANIM.staticPhase}) = ${JSON.stringify(staticFrame)}`)
console.log(`DAG_TONE_GLYPH.running${" ".repeat(26)}= ${JSON.stringify(GLYPH.running)}`)
check(
  "§2.4 the static frame IS the contract's own running glyph (so the legend names it)",
  staticFrame === GLYPH.running,
  `static frame=${JSON.stringify(staticFrame)} GLYPH.running=${JSON.stringify(GLYPH.running)}`,
)
check(
  "§2.4 the static frame is one cell too",
  san.cellWidth(staticFrame) === 1,
  `cellWidth=${san.cellWidth(staticFrame)}`,
)

// ── §2.5 — the degradation paths still draw a valid one-cell frame ─────────────────────────────────
console.log("-".repeat(100))
console.log("§2.5 DEGRADATION — non-finite and out-of-range phases still draw a legal one-cell frame")
console.log("-".repeat(100))
/** The phases the contract's fallback clause must survive. */
const ODD: Array<[string, number]> = [["NaN", Number.NaN], ["Infinity", Number.POSITIVE_INFINITY], ["-Infinity", Number.NEGATIVE_INFINITY], ["-1", -1], ["-3", -3], ["3.7", 3.7], ["1e9", 1e9]]
for (const [label, phase] of ODD) {
  /** The frame the shipped function returns for this pathological phase. */
  const frame = core.runningGlyph(phase)
  console.log(`  runningGlyph(${label}) = ${JSON.stringify(frame)} cellWidth=${san.cellWidth(frame)}`)
}
check(
  "§2.5 every out-of-range/non-finite phase draws a legal, ONE-CELL frame",
  ODD.every(([, phase]) => san.cellWidth(core.runningGlyph(phase)) === 1 && !forbidden.includes(core.runningGlyph(phase))),
  `frames = ${JSON.stringify(ODD.map(([, phase]) => core.runningGlyph(phase)))}`,
)
check(
  "§2.5 the non-finite phases degrade to the contract's running glyph rather than throwing",
  [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY].every((phase) => core.runningGlyph(phase) === GLYPH.running),
  `NaN→${JSON.stringify(core.runningGlyph(Number.NaN))} +Inf→${JSON.stringify(core.runningGlyph(Number.POSITIVE_INFINITY))} -Inf→${JSON.stringify(core.runningGlyph(Number.NEGATIVE_INFINITY))}`,
)

// ── one orbit, two surfaces ────────────────────────────────────────────────────────────────────────
console.log("-".repeat(100))
console.log("ONE TABLE, TWO SURFACES — the subagent panel must breathe through the SAME marks")
console.log("-".repeat(100))
console.log(`subagent-scene RUNNING_FRAMES = ${JSON.stringify(scene.RUNNING_FRAMES)}`)
check(
  "the subagent panel's frames ARE the DAG's table (one fact, not two copies)",
  scene.RUNNING_FRAMES === ANIM.runningFrames,
  `identical reference = ${scene.RUNNING_FRAMES === ANIM.runningFrames}`,
)
check(
  "the subagent panel's frames are all ONE CELL too",
  (scene.RUNNING_FRAMES as string[]).every((frame) => san.cellWidth(frame) === 1),
  `widths = ${JSON.stringify((scene.RUNNING_FRAMES as string[]).map((frame) => san.cellWidth(frame)))}`,
)

console.log("")
console.log("=".repeat(100))
console.log(`MEASUREMENT 2 VERDICT: ${failures.length === 0 ? "PASS — every judged condition held" : `${failures.length} check(s) FAILED`}`)
console.log("=".repeat(100))
if (failures.length > 0) {
  console.log("FAILED CHECKS:")
  for (const failure of failures) console.log(`  - ${failure}`)
}
process.exit(failures.length === 0 ? 0 : 1)
