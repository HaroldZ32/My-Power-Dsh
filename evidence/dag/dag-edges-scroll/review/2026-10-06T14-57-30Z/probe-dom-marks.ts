// SCRATCH PROBE (Reviewer) — measures the rendered WEB marks' coordinate space. Not a deliverable.
import { readFileSync } from "node:fs"
import { createHookRuntime } from "../../../../../packages/mpd-bundle-plugin/test/client-harness.ts"
import ts from "typescript5"

/** The WEB view's own source. */
const SRC = readFileSync("packages/mpd-bundle-plugin/src/team-view.ts", "utf8")
/** The stripped factory. */
const stripped = ts.transpileModule(SRC, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
/** The offline React double. */
const hooks = createHookRuntime()
/** The pure-Chinese chain board. */
const subs = ["冻结验收契约", "建立头部与进度条", "绘制依赖图的连线", "修复被截断的成员路由"]
/** The payload rows. */
const board = subs.map((subject, i) => ({ id: "T" + (i + 1), subject, kind: "work", status: "pending", visual: "open", blockedBy: i === 0 ? [] : ["T" + i], failedBy: [], depth: i }))
/** The canned routes. */
const routes: Record<string, unknown> = { "/plugins/mpd-team/state": { ok: true, workspace: "/w", team: { id: "t", name: "W", phase: "active" }, counts: { total: 4 }, members: [], tasks: board, cycles: [], executor: { kind: "native" }, problems: [] }, "/plugins/mpd-team/plan": { ok: true, plan: null }, "/plugins/mpd-team/task": { ok: true, contracts: [] } }
/** The saved fetch. */
const saved = globalThis.fetch
globalThis.fetch = (async (u: unknown) => { const b = routes[String(u).split("?")[0]]; return b ? { ok: true, status: 200, json: async () => b } : { ok: false, status: 404, json: async () => null } }) as unknown as typeof fetch
/** The view module. */
const v = new Function("return (" + stripped.trim().replace(/;$/, "") + ")")()({}).createTeamView({ react: hooks.react, statePath: "/plugins/mpd-team/state", planPath: "/plugins/mpd-team/plan", taskPath: "/plugins/mpd-team/task", pollMs: 60_000 })
/** The rendered tree. */
const tree = await hooks.render(v.TeamView as never, { sessionId: "s1" } as never)
globalThis.fetch = saved
/** Collect every element carrying one prop. */
function walk(node: unknown, prop: string, out: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
  if (Array.isArray(node)) { for (const c of node) walk(c, prop, out); return out }
  if (node === null || typeof node !== "object") return out
  const el = node as { props?: Record<string, unknown> }
  if (typeof el.props?.[prop] === "string") out.push(el.props)
  walk(el.props?.children, prop, out)
  return out
}
console.log("boxes:", JSON.stringify(walk(tree, "data-mpd-box").map(p => p["data-mpd-box"])))
console.log("nodes:", JSON.stringify(walk(tree, "data-mpd-node").map(p => p["data-mpd-node"])))
console.log("svg:", JSON.stringify(walk(tree, "data-edges").map(p => [p.width, p.height, p.viewBox])))
console.log("tips:", JSON.stringify(walk(tree, "data-mpd-tip").map(p => p["data-mpd-tip"])))
console.log("curves:", JSON.stringify(walk(tree, "data-mpd-curve").map(p => p["data-mpd-curve"])))
process.exit(0)
