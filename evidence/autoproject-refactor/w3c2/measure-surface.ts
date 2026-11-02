// W3-C2 scratch measurement: the SAME cost the tool-surface arm charges — name + description +
// parameters, JSON-stringified, plus 96 characters per contributed command.
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply } from "../../../packages/mpd-team-core-plugin/src/index"

/** Everything one `apply` registered. */
const tools: Array<{ name: string; description?: string; parameters?: unknown }> = []
let commands = 0
/** The stub adapter: only the seams `apply` touches at mount time. */
const dsh = {
  registerTool: (definition: never): (() => void) => { tools.push(definition as never); return () => {} },
  registerCommand: (): (() => void) => { commands += 1; return () => {} },
  workspaceRoot: (): string => mkdtempSync(join(tmpdir(), "mpd-surface-")),
  text: (value: unknown): unknown => value,
  teamExecutor: (): undefined => undefined,
  teamMembership: (): undefined => undefined,
  teamListMembers: (): [] => [],
  teamListTasks: (): [] => [],
  capabilities: (): Record<string, never> => ({}),
  hasTool: (): boolean => false,
  executeTool: async (): Promise<{ ok: boolean; isError: boolean }> => ({ ok: false, isError: true }),
  rowLog: (): void => {}
}
/** The minimal cordis context. */
const ctx = {
  get: (id: string): unknown => (id === "mpdDsh" ? dsh : undefined),
  on: (): void => {},
  effect: (fn: () => unknown) => { try { return fn() ?? (() => {}) } catch { return () => {} } },
  provide: (): void => {},
  inject: (): void => {}
}
apply(ctx as never)
/** The context cost the arm charges. */
const total = tools.reduce((sum, tool) => sum + JSON.stringify({ n: tool.name, d: tool.description, p: tool.parameters }).length, 0) + commands * 96
console.log("tools=" + tools.length + " commands=" + commands + " surface=" + total + " bound=6400 headroom=" + (6400 - total))
