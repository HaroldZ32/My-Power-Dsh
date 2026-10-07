// SCRATCH PROBE (Reviewer, wave `dag-edges-scroll`) — NOT a deliverable, NOT part of the instrument.
//
// Its only job is to prove the WEB render path the instrument depends on WORKS before the lanes land:
// the factory body evaluates, the offline hook runtime renders it against canned routes, and the
// `data-mpd-*` marks can be read off the returned element tree. A harness that cannot render today
// cannot judge a lane tomorrow, so this is checked first.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript5"

import { createHookRuntime } from "../../../../../packages/mpd-bundle-plugin/test/client-harness.ts"

/** The WEB view's own source text — the artefact the render is built from. */
const SOURCE = readFileSync(join(import.meta.dir, "..", "..", "..", "..", "..", "packages", "mpd-bundle-plugin", "src", "team-view.ts"), "utf8")

/** The CJK / full-width ranges the frozen C1 clause bans inside the drawing. */
const CJK = /[\u2E80-\u2FFF\u3000-\u303F\u3040-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]/u

/** The fixture board: two ranks, one drawn edge, every subject pure Chinese. */
const TASKS = [
  { id: "T1", subject: "冻结验收契约", kind: "requirement", status: "completed", visual: "completed", owner: "m1", attempt: 1, blockedBy: [], failedBy: [], depth: 0 },
  { id: "T2", subject: "建立头部与进度条", kind: "work", status: "running", visual: "running", owner: "m1", attempt: 2, blockedBy: ["T1"], failedBy: [], depth: 1 },
]

/** Walk an element tree and return every element carrying one string prop. */
function collect(node: unknown, prop: string): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = []
  if (Array.isArray(node)) {
    for (const child of node) found.push(...collect(child, prop))
    return found
  }
  if (node === null || typeof node !== "object") return found
  const element = node as { props?: Record<string, unknown> }
  if (typeof element.props?.[prop] === "string") found.push(element.props)
  found.push(...collect(element.props?.children, prop))
  return found
}

/** Flatten a subtree to its concatenated text, the way a rendered panel reads. */
function flat(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(flat).join("")
  const element = node as { props?: { children?: unknown } }
  return flat(element.props?.children)
}

/** Count the characters of `value` that fall in the banned ranges. */
function cjkCount(value: string): number {
  let count = 0
  for (const character of value) if (CJK.test(character)) count += 1
  return count
}

/** Strip the factory's types and evaluate it as the arrow expression it is. */
function loadFactory(): (deps: unknown) => { createTeamView: (deps: unknown) => { TeamView: unknown; layout: (tasks: unknown[]) => unknown } } {
  const stripped = ts.transpileModule(SOURCE, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  const value = new Function("return (" + stripped.trim().replace(/;$/, "") + ")")() as unknown
  if (typeof value !== "function") throw new Error("the factory body no longer evaluates to a function")
  return value as ReturnType<typeof loadFactory>
}

/** Render the view against canned routes and report what the harness can see. */
async function main(): Promise<void> {
  const hooks = createHookRuntime()
  const routes: Record<string, unknown> = {
    "/plugins/mpd-team/state": { ok: true, workspace: "/w", team: { id: "t", name: "Wave", phase: "active" }, counts: { total: 2, completed: 1, running: 1, ready: 0, blocked: 0, failed: 0, releasedByFailure: 0 }, members: [], tasks: TASKS, cycles: [], executor: { kind: "native", reason: "x" }, problems: [] },
    "/plugins/mpd-team/plan": { ok: true, workspace: "/w", plan: null },
    "/plugins/mpd-team/task": { ok: true, workspace: "/w", contracts: [], hold: null },
  }
  const saved = globalThis.fetch
  globalThis.fetch = (async (url: unknown) => {
    const path = String(url).split("?")[0]
    const body = routes[path]
    return body === undefined ? { ok: false, status: 404, json: async () => null } : { ok: true, status: 200, json: async () => body }
  }) as unknown as typeof fetch
  let tree: unknown
  try {
    const view = loadFactory()({}).createTeamView({ react: hooks.react, statePath: "/plugins/mpd-team/state", planPath: "/plugins/mpd-team/plan", taskPath: "/plugins/mpd-team/task", pollMs: 60_000 })
    tree = await hooks.render(view.TeamView as never, { sessionId: "s1" } as never)
  } finally {
    globalThis.fetch = saved
  }
  const graph = collect(tree, "data-mpd-graph")
  const boxes = collect(tree, "data-mpd-box")
  console.log("GRAPH MARKS:", graph.length, "BOX MARKS:", boxes.length)
  console.log("WHOLE-TREE CJK:", cjkCount(flat(tree)), "| DRAWING CJK:", cjkCount(flat(graph.length > 0 ? (graph[0] as { children?: unknown }).children : [])))
  console.log("WHOLE-TREE TEXT:", JSON.stringify(flat(tree)).slice(0, 600))
}

console.log("PROBE: module evaluated")
await main()
console.log("PROBE: main returned")
// The view may keep a poll interval alive past the render; the harness owns no teardown, so the
// probe exits explicitly rather than hanging the lane.
process.exit(0)
