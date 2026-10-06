// THE REAL RECORDS THROUGH THE REPAIRED WEB VIEW — the end-to-end check R20 exists for.
//
// Two records, both on disk:
//   * `team-record-BEFORE-backup.json` — the board as the user's screenshot was taken from: ids `T1..T12`
//     with `blockedBy` holding PLAN ORDINALS, so not one reference resolves;
//   * `.mpd/team/teams/team-20261006135108.json` — the SAME board after the repair script rewrote the
//     references to real ids.
//
// The view is loaded exactly as the production build loads it (type-strip the factory, evaluate the one
// arrow expression), so what is measured here is what the browser gets once `client.js` is rebuilt.
//
// Run: bun evidence/tui/dag-port/web-dag/<ts>/real-records.mts
import { readFileSync } from "node:fs"
import ts from "typescript5"

/** The view module the factory returns, as this script reads it. */
interface ViewModule {
  /** The pure geometry of one board. */
  layout: (tasks: Array<Record<string, unknown>>) => Graph
}

/** The geometry fields this check reads. */
interface Graph {
  /** One column per rank. */
  columns: Array<Array<{ id: string }>>
  /** Every routed edge. */
  edges: Array<{ parent: string; child: string }>
  /** How many columns the grid draws. */
  rankCount: number
  /** Whether the ranks were derived from the graph. */
  ranksDerived: boolean
  /** The blocker references that resolve to nothing. */
  unresolved: string[]
}

/** Read one team record's tasks, with the `depth` a store that only knows `blockedBy` would serve. */
function boardOf(path: string): Array<Record<string, unknown>> {
  /** The parsed record. */
  const record = JSON.parse(readFileSync(path, "utf8")) as { tasks: Array<Record<string, unknown>> }
  return record.tasks
}

/** The source, type-stripped and evaluated as the build does it. */
const source = readFileSync("packages/mpd-bundle-plugin/src/team-view.ts", "utf8")
const stripped = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const factory = new Function("return (" + stripped.trim().replace(/;$/, "") + ")")() as (deps: unknown) => { createTeamView: (deps: unknown) => ViewModule }
const view = factory({}).createTeamView({ react: null, statePath: "/x" })

for (const [label, path] of [
  ["BEFORE (ordinals, as the user saw it)", "evidence/tui/dag-port/team-feature-test/team-record-BEFORE-backup.json"],
  ["AFTER  (repaired references, live) ", ".mpd/team/teams/team-20261006135108.json"],
] as const) {
  /** That record's board. */
  const board = boardOf(path)
  /** What the view draws for it. */
  const graph = view.layout(board)
  console.log(label + " tasks=" + board.length + " ranks=" + graph.rankCount + " ranksDerived=" + graph.ranksDerived
    + " edges=" + graph.edges.length + " unresolved=" + JSON.stringify(graph.unresolved))
  console.log("   columns: " + JSON.stringify(graph.columns.map((column) => column.map((task) => task.id))))
}

// ── THE LIE, ON THE LIVE BOARD: the same repaired references with every served `depth` zeroed ──────
// This is the case the port exists for, and the one the earlier GREEN measurement missed: the served
// depths all say 0 while the graph resolves perfectly. Before the port the view drew ONE column here
// (it trusted the 0s); a view that derives draws the five the references describe.
/** The live record's board with the served depth replaced by the store's measured lie. */
const zeroed = boardOf(".mpd/team/teams/team-20261006135108.json").map((task) => ({ ...task, depth: 0 }))
/** What the view draws for the lying board. */
const lying = view.layout(zeroed)
console.log("LIE    (live references, every depth 0) tasks=" + zeroed.length + " ranks=" + lying.rankCount
  + " ranksDerived=" + lying.ranksDerived + " edges=" + lying.edges.length + " unresolved=" + JSON.stringify(lying.unresolved))
console.log("   columns: " + JSON.stringify(lying.columns.map((column) => column.map((task) => task.id))))
