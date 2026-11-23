import { realpathSync, statSync } from "node:fs"
import { resolve } from "node:path"
import { counter, Inputs, instant, key } from "./input.ts"

/** An absent numerator, denominator or distribution is not a numeric measurement. */
const unmeasured = "UNMEASURED"
/** Historical observations are deliberately separate from the inputs of the current scan. */
const historical = {
  VEdit: { checkpointRows: 21, turnRange: [2, 12], turnTwoRowsNear524To525k: 3, observedRatioRange: [0.500, 0.506] },
  MailCollect: { checkpointRows: 4, turnRange: [4, 7] },
} as const

/** Compute descriptive statistics without replacing a missing distribution with zeros. */
function distribution(values: readonly number[]): { count: number; min: number; median: number; max: number } | typeof unmeasured {
  /** Sorted copy keeps the original observation order available for replay. */
  const sorted = [...values].sort((a, b) => a - b)
  /** The bounds and two central indexes also cover a single observation. */
  const last = sorted.length - 1
  /** The four array lookups may be missing only when the sample is empty. */
  const min = sorted[0]
  /** Use bracket access to keep the linear scan separate from the median computation. */
  const max = sorted[last]
  /** When the length is even, these are adjacent; otherwise they are the same. */
  const lower = sorted[Math.floor(last / 2)]
  /** Upper center value of the sorted sample. */
  const upper = sorted[Math.ceil(last / 2)]
  if (min === undefined || max === undefined || lower === undefined || upper === undefined) return unmeasured
  return { count: sorted.length, min, median: (lower + upper) / 2, max }
}

/** One checkpoint with a measurable numerator and turn, and possibly an unavailable window. */
type Observation = {
  readonly cellId: string
  readonly source: string
  readonly line: number
  readonly at: string
  readonly turn: number
  readonly usedTokens: number
  readonly windowTokens: number | typeof unmeasured
  readonly tokensPerTurn: number
  readonly observedRatio: number | typeof unmeasured
}

/** Retain the measured arithmetic and the file/line that supplied each operand. */
function report(root: string): object {
  /** A live scan describes an interval, with per-source hashes in the report. */
  const startedAt = new Date().toISOString()
  /** Reuse the collector's safe, bounded-to-workspace input reader. */
  const input = new Inputs(root)
  /** Known measurements are independent of skipped rows in the same file. */
  const rows: Observation[] = []
  /** One explanation per unusable numerator or turn. */
  const skipped: { readonly source: string; readonly line: number; readonly reason: string }[] = []
  /** Count unusable rows that were not explicitly excluded by the zero-turn rule. */
  let incompleteTokenRows = 0
  /** An absent collection is normal for a workspace with no Cellwork data. */
  const collection = ".mpd/cellwork"
  for (const cell of input.directory(collection)) {
    if (!cell.name.startsWith("cell-")) continue
    /** The checkpoint journal is the event source; state snapshots may double count it. */
    const path = `${collection}/${cell.name}/journal.jsonl`
    for (const { row, line } of input.lines(path)) {
      if (key(row.event) === undefined) {
        input.malformed(path, "missing event name", line)
        continue
      }
      if (row.event !== "checkpoint") continue
      /** Zero and missing turns are separate diagnostics. */
      const turn = counter(row.turn)
      /** A recorded zero token numerator is valid. */
      const used = counter(row.usedTokens)
      if (turn === undefined || turn === 0 || used === undefined) {
        if (turn !== 0) incompleteTokenRows++
        skipped.push({ source: path, line, reason: turn === 0 ? "zero turn" : turn === undefined ? "missing or invalid turn" : "missing or invalid usedTokens" })
        continue
      }
      /** A missing or zero context window prevents ratio calculation only. */
      const window = counter(row.windowTokens)
      /** Normalize timestamps only when the journal recorded a valid clock. */
      const at = instant(row.at)
      rows.push({ cellId: cell.name, source: path, line, at: at === undefined ? unmeasured : new Date(at).toISOString(),
        turn, usedTokens: used, windowTokens: window ?? unmeasured, tokensPerTurn: used / turn,
        observedRatio: window !== undefined && window > 0 ? used / window : unmeasured })
    }
  }
  /** Only rows with both token operands contribute to the observed-ratio distribution. */
  const ratios = rows.flatMap((row) => typeof row.observedRatio === "number" ? [row.observedRatio] : [])
  /** The absence of a discovered journal is a gap; the absence of the collection is ordinary. */
  const gaps = input.sources.filter(({ path, state }) => state !== "read" && !(path === collection && state === "absent"))
  /** Count a recognized checkpoint even if its operands cannot be used. */
  const observedCheckpoints = rows.length + skipped.length
  /** The observed rows are a lower bound whenever a source could hide more checkpoints. */
  const complete = gaps.length === 0
  /** Missing operands affect their distributions independently of journal coverage. */
  const missingRatioRows = incompleteTokenRows + rows.length - ratios.length
  /** The turn and average distributions use the same set of rows. */
  const tokenCoverage = { sampleRows: rows.length, missingOperands: incompleteTokenRows, complete: complete && incompleteTokenRows === 0 }
  return {
    schemaVersion: 1, workspace: root, capture: { startedAt, finishedAt: new Date().toISOString(), atomic: false },
    checkpointRows: complete ? observedCheckpoints : unmeasured, measuredRows: rows.length, rows, skipped,
    distribution: { tokensPerTurn: distribution(rows.map((row) => row.tokensPerTurn)),
      observedRatio: distribution(ratios), turn: distribution(rows.map((row) => row.turn)) },
    coverage: {
      checkpoints: { observed: observedCheckpoints, complete, gaps },
      distributions: { tokensPerTurn: tokenCoverage, turn: tokenCoverage,
        observedRatio: { sampleRows: ratios.length, missingOperands: missingRatioRows, complete: complete && missingRatioRows === 0 } },
    },
    hostComposition: { name: "unknown", compactionThresholdRatio: "unknown", reason: "no host composition binding in retained checkpoint journals" },
    historicalReference: { date: "2026-11-13", workspaces: historical },
    referenceThresholds: { cellworkDefault: 0.5, harnessDefault: 0.8, shippedTuiCompactRow: 0.2,
      provenance: "historical plan references only; workspace attribution requires a host capture linked to these checkpoints" },
    sources: input.sources,
  }
}

/** Emit one report for the requested workspace; skipped checkpoints still exit successfully. */
function main(args: readonly string[]): void {
  try {
    if (args.length !== 1 || !args[0]) throw new Error("expected one workspace")
    /** Resolve the supplied workspace, never any configured host path. */
    const root = realpathSync(resolve(args[0]))
    if (!statSync(root).isDirectory()) throw new Error("expected a workspace directory")
    process.stdout.write(JSON.stringify(report(root), null, 2) + "\n")
  } catch (error) {
    if (!(error instanceof Error)) throw error
    process.stdout.write(JSON.stringify({ usage: "node scripts/baseline/growth.ts <workspace>" }) + "\n")
    process.exitCode = 2
  }
}

main(process.argv.slice(2))
