#!/usr/bin/env bun
// THE ONE-COLUMN DEFECT (R17/R20/R21) — the reviewer's OWN reproduction, from source.
//
// WHO WROTE THIS. The reviewer (`fidelity-verifier`). The captain reported three faults; this script
// reproduces each against the REAL modules rather than restating the narrative:
//   1. `mpd-team-core-plugin/src/team-store.ts` `resolveBlocker` returns an unresolvable reference
//      UNCHANGED, so a staged plan's `["2"]` survives approval as the literal string `"2"`;
//   2. the same module's `taskDepths` filters `task.blockedBy` with `byId.has(candidate)`, so every
//      unresolvable reference is dropped and every task measures as a root (`depth 0`);
//   3. `mpd-bundle-plugin/src/team-view.ts` TRUSTS that served `depth` (`Number.isFinite(task.depth)
//      && task.depth >= 0 ? task.depth : 0`) and draws an edge only when `parent.depth < child.depth`
//      — so a board whose depths are all 0 renders ONE column with NO edges and NO warning.
//
// The WEB view is a FACTORY BODY with no exports (the build splices it into `client.js`), so it is
// loaded the way the repo's own `team-view.test.ts` loads it: strip the types with the same
// `typescript5` tool class the build uses, then evaluate it. Its `layout(tasks)` is PURE, which is
// what makes R20 assertable without a browser.
//
// Usage:
//   bun evidence/tui/dag-port/verification/one-column-repro.ts [--record <path>] [--json <out>]
// Output: a JSON report on stdout (and at `--json`), one section per fault.
import { readFileSync, writeFileSync } from "node:fs"
import ts from "typescript5"

import { createHookRuntime } from "../../../../packages/mpd-bundle-plugin/test/client-harness.ts"
import { cycleIds, summariseTeam, taskDepths, taskVisual } from "../../../../packages/mpd-team-core-plugin/src/team-store.ts"

/** The live board this wave owns, whose blockers the captain repaired in place. */
const LIVE_RECORD = ".mpd/team/teams/team-20261006135108.json"

/**
 * The PRE-REPAIR board, transcribed from the live record as it stood BEFORE the captain's repair
 * (read by this reviewer at 2026-10-06T13:5xZ, quoted verbatim in the report).
 *
 * It is frozen here on purpose: the live file is mutable, so a reproduction that read only the live
 * file could not be re-run after the repair and would prove nothing about the defect it claims.
 */
const PRE_REPAIR = [
  { id: "T1", subject: "REQUIREMENT: freeze the acceptance contract", kind: "work", status: "pending", blockedBy: [] },
  { id: "T2", subject: "WORK: the adaptive vertical DAG layout engine", kind: "work", status: "pending", blockedBy: [] },
  { id: "T3", subject: "WORK: the independent dag + workmate sidebar pages", kind: "work", status: "pending", blockedBy: [] },
  { id: "T4", subject: "WORK: redesign the whole mpd-tui surface layer", kind: "work", status: "pending", blockedBy: [] },
  { id: "T5", subject: "WORK: ROOT-CAUSE why the existing team sidebar panel was invisible", kind: "work", status: "pending", blockedBy: [] },
  { id: "T6", subject: "WORK: wire the dag + workmate panels through the adapter", kind: "work", status: "pending", blockedBy: ["2"] },
  { id: "T7", subject: "REVIEW: independent verification of R1..R16", kind: "work", status: "pending", blockedBy: ["2", "3", "4", "6"] },
  { id: "T8", subject: "REVIEW: visual fidelity of the rendered TUI", kind: "work", status: "pending", blockedBy: ["7"] },
  { id: "T9", subject: "WORK: bilingual docs for the new panels", kind: "work", status: "pending", blockedBy: ["2", "3", "4", "5", "6"] },
  { id: "T10", subject: "INTEGRATION: rebuild dist, gate sweep, Docker, PR", kind: "work", status: "pending", blockedBy: ["7", "8", "9"] },
]

/** One task row of the shape the WEB view's payload serves. */
interface WebTaskRow {
  id: string
  subject: string
  kind: string
  status: string
  visual: string
  blockedBy: string[]
  failedBy: string[]
  depth: number
}

/** The WEB view module's `layout` contract, as this script reads it. */
interface WebLayout {
  rankCount: number
  width: number
  height: number
  columns: Array<Array<{ id: string }>>
  nodes: Array<{ task: { id: string }; rank: number }>
}

/**
 * Load the WEB view factory and build the module against the offline hook runtime.
 * @returns the module's `layout`, typed to what this script reads.
 */
function loadWebLayout(): (tasks: WebTaskRow[]) => WebLayout {
  /** The factory source with every type annotation erased. */
  const stripped = ts.transpileModule(readFileSync("packages/mpd-bundle-plugin/src/team-view.ts", "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
  /** The evaluated factory expression, which the build wraps the same way. */
  const factory = new Function("return (" + stripped.trim().replace(/;$/, "") + ")")() as (deps: unknown) => {
    createTeamView: (deps: unknown) => { layout: (tasks: WebTaskRow[]) => WebLayout }
  }
  /** The offline React double the view's hooks run on. */
  const hooks = createHookRuntime()
  return factory({}).createTeamView({ react: hooks.react, statePath: "/p", planPath: "/p", taskPath: "/t", pollMs: 60_000 }).layout
}

/**
 * Project a stored board onto the rows the WEB payload serves.
 *
 * THE SERVED DEPTH IS AN INPUT, NOT A DERIVATION — and that is the whole point of this script's
 * second revision. The first revision computed the depth with the real `taskDepths`, which meant the
 * "derivation" arm actually handed the view a CORRECT payload and reported `rankCount 5` for a view
 * that still trusts `depth` verbatim. The captain falsified it: `grep -c 'deriveRanks|rankPlan|rankOf|
 * ranksDerived' team-view.ts` = 0 and the trust expression is still there. A fixture that cannot fail
 * is not a test, so the depth now comes from the caller.
 * @param board - the stored board rows.
 * @param mode - `served` uses the depths the data plane computes; `all-zero` sends 0 for every task,
 *   which is the state a DERIVING view must recover from and a trusting view cannot.
 * @returns the served rows.
 */
function servedRows(
  board: ReadonlyArray<{ id: string; subject: string; kind: string; status: string; blockedBy: string[] }>,
  mode: "served" | "all-zero",
): WebTaskRow[] {
  /** The depths the data plane actually computes for this board (used only in `served` mode). */
  const depths = taskDepths(board as never)
  return board.map(task => ({
    id: task.id,
    subject: task.subject,
    kind: task.kind,
    status: task.status,
    visual: taskVisual(task as never, board as never),
    blockedBy: [...task.blockedBy],
    failedBy: [],
    depth: mode === "all-zero" ? 0 : depths.get(task.id) ?? 0,
  }))
}

/** The report this script prints and writes. */
function report(): Record<string, unknown> {
  const recordPath = process.argv.includes("--record") ? process.argv[process.argv.indexOf("--record") + 1] : LIVE_RECORD
  /** The live record, read fresh: it is the artefact the captain repaired in place. */
  const live = JSON.parse(readFileSync(recordPath, "utf8")) as { tasks: Array<{ id: string; kind: string; status: string; subject: string; blockedBy: string[] }> }
  const layoutWeb = loadWebLayout()

  /**
   * What the data plane computes for each board, and what the WEB view does with what it is SERVED.
   * @param label - the fixture's name, echoed into the report.
   * @param board - the stored board rows.
   * @param depthMode - which depths the WEB payload carries; see {@link servedRows}.
   * @returns one section of the report.
   */
  const measure = (
    label: string,
    board: ReadonlyArray<{ id: string; kind: string; status: string; subject: string; blockedBy: string[] }>,
    depthMode: "served" | "all-zero",
  ): Record<string, unknown> => {
    /** The rank per task id the data plane serves. */
    const depths = taskDepths(board as never)
    /** The ranks with at least one task, i.e. the number of columns a depth-trusting layout draws. */
    const ranks = [...new Set([...depths.values()])].sort((a, b) => a - b)
    /** The rows the WEB payload serves for this board. */
    const rows = servedRows(board, depthMode)
    /** What the WEB view's own pure layout does with those rows. */
    const geometry = layoutWeb(rows)
    /** References naming no task on the board: the R21 condition, counted rather than assumed. */
    const unresolved = board.flatMap(task =>
      task.blockedBy.filter(reference => !board.some(other => other.id === reference))
        .map(reference => `${task.id} -> ${reference}`))
    return {
      label,
      servedDepthMode: depthMode,
      tasks: board.length,
      // What the DATA PLANE would compute, for contrast only: the view never sees this in `all-zero`.
      dataPlaneDepths: Object.fromEntries(depths),
      distinctRanks: ranks,
      links: (summariseTeam({ tasks: board } as never)).links,
      cycles: cycleIds(board as never),
      unresolvedReferences: unresolved,
      // What the WEB PAYLOAD actually carried, so a green/red verdict can never be misattributed.
      payloadDepths: [...new Set(rows.map(row => row.depth))].sort((a, b) => a - b),
      webLayout: {
        rankCount: geometry.rankCount,
        width: geometry.width,
        height: geometry.height,
        columns: geometry.columns.map(column => column.map(node => node.id)),
        nodeRanks: geometry.nodes.map(node => `${node.task.id}:${node.rank}`),
      },
    }
  }

  /** The pre-repair board with its references RESOLVED and its served depths still lying (all 0). */
  const RESOLVABLE_FLAT = PRE_REPAIR.map(row => ({
    ...row,
    blockedBy: row.blockedBy.map(reference => "T" + reference),
  }))

  return {
    generatedAt: new Date().toISOString(),
    recordPath,
    preRepair: measure("pre-repair (frozen transcription)", PRE_REPAIR, "all-zero"),
    resolvableFlatZero: measure("references RESOLVE and every served depth is STILL 0 (the R20 arm)", RESOLVABLE_FLAT, "all-zero"),
    resolvableFlatServed: measure("references resolve and the payload carries the honest depths (the control)", RESOLVABLE_FLAT, "served"),
    live: measure("live record (as it stands now)", live.tasks, "served"),
  }
}

/** The report, printed and optionally written. */
const result = report()
const json = JSON.stringify(result, null, 2)
const outAt = process.argv.indexOf("--json")
if (outAt >= 0 && process.argv[outAt + 1] !== undefined) writeFileSync(process.argv[outAt + 1], json + "\n")
console.log(json)
