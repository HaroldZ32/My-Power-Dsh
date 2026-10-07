// DEFECT 2, live-data replay: copy the REAL workspace's `.mpd/team` tree into a temp workspace and call
// the real `session-watchdog-status` against it, then walk the value for anything a lossless JSON
// snapshot rejects. Read-only with respect to the repo; the copy is what gets mutated.
import { cpSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as plugin from "../../../../packages/mpd-team-watchdog-plugin/src/index.ts"
import { pluginCtx, testConfig } from "../../../../packages/mpd-team-watchdog-plugin/test/support.ts"

/** Walk a value and collect every path a lossless JSON snapshot would reject. */
function nonLosslessPaths(value: unknown, path = "value", out: string[] = [], seen = new Set<unknown>()): string[] {
  if (value === null) return out
  const type = typeof value
  if (type === "undefined" || type === "function" || type === "symbol" || type === "bigint") {
    out.push(`${path}: ${type}`)
    return out
  }
  if (type === "number") {
    if (!Number.isFinite(value as number)) out.push(`${path}: non-finite number`)
    else if (Object.is(value, -0)) out.push(`${path}: negative zero`)
    return out
  }
  if (type === "string" || type === "boolean") return out
  if (seen.has(value)) return out
  seen.add(value)
  if (value instanceof Map) out.push(`${path}: Map(${(value as Map<unknown, unknown>).size})`)
  else if (value instanceof Set) out.push(`${path}: Set(${(value as Set<unknown>).size})`)
  else if (value instanceof Date) out.push(`${path}: Date`)
  else if (Array.isArray(value)) for (const [index, entry] of value.entries()) nonLosslessPaths(entry, `${path}[${index}]`, out, seen)
  else {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) out.push(`${path}: non-plain object ${String((value as { constructor?: { name?: string } }).constructor?.name)}`)
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) nonLosslessPaths(entry, `${path}.${key}`, out, seen)
  }
  return out
}

/** The workspace whose team state is replayed. */
const SOURCE = "/home/haroldzhao/MyProj/DshProj/My-Power-Dsh"
/** A temp workspace holding a COPY of the live team state. */
const workspace = mkdtempSync(join(tmpdir(), "watchdog-live-"))
try {
  cpSync(join(SOURCE, ".mpd", "team"), join(workspace, ".mpd", "team"), { recursive: true })
  const ctx = pluginCtx(workspace)
  plugin.apply(ctx, { stateDir: join(".mpd", "team"), ...testConfig() } as never)
  const tool = ctx.__stub.tools.get("session-watchdog-status")
  if (tool === undefined) throw new Error("status tool not registered")
  for (const teamId of ["team-20261002150828", "team-20261002152009", ""]) {
    const value = await (tool.execute as (args: unknown, exec: unknown) => Promise<unknown>)({ team_id: teamId }, { agent: { session: { header: { cwd: workspace } } } })
    const paths = nonLosslessPaths(value)
    console.log(`team_id="${teamId}" -> non-lossless:`, paths.length === 0 ? "(none)" : paths.join(", "))
    const first = (value as { teams: Array<Record<string, unknown>> }).teams[0]
    console.log("   teams[0]:", JSON.stringify({ held: first.held, phase: first.phase, keys: first.heartbeatKeys, tailCount: Object.keys(first.heartbeatTails as object).length, incidents: (first.incidents as unknown[]).length, isHeld: first.isHeld }))
    console.log("   round-trip stable:", JSON.stringify(JSON.parse(JSON.stringify(value))) === JSON.stringify(value))
  }
  ctx.__dispose()
} finally {
  rmSync(workspace, { recursive: true, force: true })
}
