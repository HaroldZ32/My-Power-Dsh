// SCRATCH PROBE (Reviewer) — compares the layout's node placement with the DOM box marks. Not a deliverable.
import { readFileSync } from "node:fs"
import ts from "typescript5"
/** The WEB view's own source. */
const SRC = readFileSync("packages/mpd-bundle-plugin/src/team-view.ts", "utf8")
/** The stripped factory. */
const stripped = ts.transpileModule(SRC, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
/** The WEB module. */
const view = new Function("return (" + stripped.trim().replace(/;$/, "") + ")")()({}).createTeamView({ react: null, statePath: "/p" })
/** The dependency table of the rank-skipping board. */
const DEPS: Record<string, string[]> = { T1: [], T2: [], T3: [], T4: [], T5: [], T6: ["T2"], T7: ["T2", "T3", "T4", "T6"], T8: ["T7"], T9: ["T2", "T3", "T4", "T5", "T6"], T10: ["T7", "T8", "T9"] }
/** The payload rows. */
const board = Object.keys(DEPS).map((id, i) => ({ id, subject: "纯中文的任务主题" + id, kind: "work", status: "pending", visual: "open", blockedBy: DEPS[id], failedBy: [], depth: i }))
/** The layout. */
const g = view.layout(board)
console.log("rankCount", g.rankCount, "width", g.width, "inset", g.inset)
console.log("nodes:", JSON.stringify(g.nodes.map((n: any) => [n.task.id, n.rank, n.row, n.top])))
console.log("edge T6<-T2 pts:", JSON.stringify(g.edges.find((e: any) => e.witness === "T6<-T2")?.curve.points.slice(0, 6)))
process.exit(0)
