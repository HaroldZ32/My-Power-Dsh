// REVIEWER'S INDEPENDENT MEASUREMENT of the five-tool surface cost, so the W1-A "6,371" claim is
// reproducible rather than trusted. Mirrors the test's own cost formula; writes nothing to the repo.
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply } from "../../../packages/mpd-team-core-plugin/src/index"

interface CapturedTool { name: string; description: string; parameters: unknown }

/** What the stub adapter collected. */
const tools: CapturedTool[] = []
/** Registered command names (only the count enters the cost). */
const commands: string[] = []
/** A disposer-returning no-op for every seam this measurement never exercises. */
const noop = (): (() => void) => () => {}
/** The proxy adapter, identical in spirit to tool-surface.test.ts's own stub. */
const dsh = new Proxy({} as Record<string | symbol, unknown>, {
  get: (_target, prop) => {
    if (prop === "registerTool") return (definition: CapturedTool) => { tools.push(definition); return () => {} }
    if (prop === "registerCommand") return (definition: { name: string }) => { commands.push(definition.name); return () => {} }
    if (prop === "workspaceRoot") return () => mkdtempSync(join(tmpdir(), "mpd-w1a-measure-"))
    if (prop === "capabilities") return () => ({})
    return noop
  },
})
/** The minimal cordis context `apply` needs. */
const ctx = {
  get: (name: string) => (name === "mpdDsh" ? dsh : undefined),
  on: noop,
  effect: (fn: () => unknown) => { try { return fn() ?? (() => {}) } catch { return () => {} } },
  provide: noop,
  inject: noop,
}
apply(ctx as never)

/** The test's own per-tool cost formula. */
const costOf = (tool: CapturedTool): number => JSON.stringify({ n: tool.name, d: tool.description, p: tool.parameters }).length

/** Per-tool costs, printed in registration order. */
let total = 0
for (const tool of tools) {
  const cost = costOf(tool)
  total += cost
  console.log(String(cost).padStart(5) + "  " + tool.name)
}
const commandCost = commands.length * 96
console.log(String(commandCost).padStart(5) + "  commands x" + commands.length + " (96 each)")
console.log(String(total + commandCost).padStart(5) + "  TOTAL   bound 6400")
