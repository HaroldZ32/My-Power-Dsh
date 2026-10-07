// route-dump.mjs — the A/B instrument for the reviewer's finding 4 (the redundant waypoint).
//
// It evaluates a GIVEN team-view source (argv[2]) and prints, per drawn edge, the route string the view
// publishes as `data-mpd-route` plus the flattened polyline's size and the `d`. Running it over the
// pre-fix source and the shipped one and diffing the route lines is what proves the router's cleanup
// left the ROUTING TRUTH byte-identical. Its board carries BOTH degenerate (same-row) edges and
// rank-skipping ones, because those are the two shapes the cleanup could have moved.
import { readFileSync } from "node:fs"
import ts from "typescript5"
/** The team-view source under test, as argv[2]. */
const SOURCE_PATH = process.argv[2]
/** The factory source with every type annotation erased, exactly as the build strips it. */
const stripped = ts.transpileModule(readFileSync(SOURCE_PATH, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
/** The evaluated factory expression. */
const factory = new Function("return (" + stripped.trim().replace(/;$/, "") + ")")()
/** The view module, built without rendering: this instrument is about the PURE layout. */
const view = factory({}).createTeamView({ react: null, statePath: "/p" })
/** A board with two roots (so rank 0 has two rows) and a three-deep chain over them. */
const board = [
  { id: "T1", subject: "r0a", kind: "work", status: "open", visual: "open", blockedBy: [], failedBy: [], depth: 0 },
  { id: "T2", subject: "r0b", kind: "work", status: "open", visual: "open", blockedBy: [], failedBy: [], depth: 0 },
  { id: "T3", subject: "r1", kind: "work", status: "open", visual: "open", blockedBy: ["T1"], failedBy: [], depth: 0 },
  { id: "T4", subject: "r2", kind: "work", status: "open", visual: "open", blockedBy: ["T1", "T3"], failedBy: [], depth: 0 },
  { id: "T5", subject: "r3", kind: "work", status: "open", visual: "open", blockedBy: ["T2", "T4"], failedBy: [], depth: 0 },
]
/** One rectangle in the serialization `data-mpd-route` uses. */
const rectText = (rect) => rect.left + "," + rect.top + "," + rect.width + "," + rect.height
for (const radius of [6, 0]) {
  for (const edge of view.layout(board, radius).edges) {
    /** The route text, assembled exactly as `routeText` in the view assembles it. */
    const route = edge.segments.map((segment) => rectText(segment.rect)).join(";") + "|" + (edge.pointsLeft ? "L" : "R") + rectText(edge.marker)
    console.log("r" + radius + " " + edge.witness + " | route=" + route + " | points=" + edge.curve.points.length + " | d=" + edge.curve.d)
  }
}
/** How many consecutive sample PAIRS are the same point, which is the wart this fix removes. */
let repeated = 0
for (const edge of view.layout(board).edges) {
  for (let index = 1; index < edge.curve.points.length; index += 1) {
    if (edge.curve.points[index].x === edge.curve.points[index - 1].x && edge.curve.points[index].y === edge.curve.points[index - 1].y) repeated += 1
  }
}
console.log("REPEATED_VERTICES=" + repeated)
