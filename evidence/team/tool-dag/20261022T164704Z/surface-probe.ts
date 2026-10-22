import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply } from "../../../../packages/mpd-team-core-plugin/src/index.ts"

const out: { tools: any[]; commands: any[] } = { tools: [], commands: [] }
const noop = () => () => {}
const dsh = new Proxy({} as Record<string | symbol, unknown>, {
  get: (_t, prop) => {
    if (prop === "registerTool") return (d: any) => { out.tools.push(d); return () => {} }
    if (prop === "registerCommand") return (d: any) => { out.commands.push(d); return () => {} }
    if (prop === "workspaceRoot") return () => mkdtempSync(join(tmpdir(), "mpd-surface-"))
    if (prop === "capabilities") return () => ({})
    return noop
  },
})
const ctx = { get: (n: string) => (n === "mpdDsh" ? dsh : undefined), on: noop, effect: (fn: () => unknown) => { try { return fn() ?? (() => {}) } catch { return () => {} } }, provide: noop, inject: noop }
apply(ctx as never)
const cost = (t: any) => JSON.stringify({ n: t.name, d: t.description, p: t.parameters }).length
let total = out.commands.length * 96
for (const t of out.tools) { const c = cost(t); total += c; console.log(t.name, c, "desc", t.description.length) }
console.log("TOTAL", total)
