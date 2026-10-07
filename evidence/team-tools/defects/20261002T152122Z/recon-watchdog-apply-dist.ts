// DEFECT 2, dist replay: the SAME check as the apply repro, but against the BUILT module the live
// session actually loaded (`dist/index.js`), so a src/dist drift cannot hide the offender.
import * as plugin from "../../../../packages/mpd-team-watchdog-plugin/dist/index.js"
import { pluginCtx, sandbox, testConfig } from "../../../../packages/mpd-team-watchdog-plugin/test/support.ts"

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

const box = sandbox()
try {
  const ctx = pluginCtx(box.workspace)
  plugin.apply(ctx, { stateDir: box.stateDir, ...testConfig() } as never)
  const tool = ctx.__stub.tools.get("session-watchdog-status")
  if (tool === undefined) throw new Error("status tool not registered")
  const value = await (tool.execute as (args: unknown, exec: unknown) => Promise<unknown>)({ team_id: "team-dist-replay" }, { agent: { session: { header: { cwd: box.workspace } } } })
  const paths = nonLosslessPaths(value)
  console.log("dist non-lossless paths:", paths.length === 0 ? "(none)" : paths.join(", "))
  console.log("dist keys:", Object.keys(value as Record<string, unknown>).join(","))
  console.log("dist teams[0] keys:", Object.keys((value as { teams: Array<Record<string, unknown>> }).teams[0]).join(","))
  ctx.__dispose()
} finally {
  box.cleanup()
}
