// Measure the registered team-tool surface's context cost, per tool: the budget arm in
// `packages/mpd-team-core-plugin/test/tool-surface.test.ts` is what this number is compared against.
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply } from "../../../../packages/mpd-team-core-plugin/src/index.ts"

/** Every registration `apply` produces. */
const tools: Array<{ name: string; description: string; parameters: unknown }> = []
/** A disposer-returning no-op, standing in for every unused seam. */
const noop = () => () => {}
const dsh = new Proxy({} as Record<string | symbol, unknown>, {
  get: (_t, p) => {
    if (p === "registerTool") return (d: any) => { tools.push(d); return () => {} }
    if (p === "registerCommand") return () => () => {}
    if (p === "workspaceRoot") return () => mkdtempSync(join(tmpdir(), "m-"))
    if (p === "capabilities") return () => ({})
    return noop
  },
})
apply({ get: (n: string) => (n === "mpdDsh" ? dsh : undefined), on: noop, effect: (fn: () => unknown) => { try { return fn() ?? (() => {}) } catch { return () => {} } }, provide: noop, inject: noop } as never)
let total = 0
for (const tool of tools) {
  const cost = JSON.stringify({ n: tool.name, d: tool.description, p: tool.parameters }).length
  total += cost
  console.log(tool.name.padEnd(24), cost)
}
console.log("tools total:", total, "| + 96 for one command =", total + 96, "| budget 5000")
