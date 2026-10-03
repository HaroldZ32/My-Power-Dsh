// Throwaway recon for DEFECT 2: which field of `session-watchdog-status` is not lossless JSON?
// It registers the REAL status tool through the package's own stub adapter, calls it, and walks the
// returned value for anything a JSON round-trip cannot carry (undefined, function, symbol, bigint,
// Map, Set, Date, class instance, non-finite number). Prints the offending paths ONLY.
import { registerWatchdogActions, STATUS_TOOL } from "../../../../packages/mpd-team-watchdog-plugin/src/actions.ts"
import { sandbox, stubAdapter } from "../../../../packages/mpd-team-watchdog-plugin/test/support.ts"
import type { DshToolDef } from "../../../../packages/mpd-dsh-adapter-plugin/src/index.ts"

/** Walk a value and collect every path that cannot survive a JSON round-trip. */
function nonLosslessPaths(value: unknown, path = "value", out: string[] = [], seen = new Set<unknown>()): string[] {
  if (value === null) return out
  const type = typeof value
  if (type === "undefined" || type === "function" || type === "symbol" || type === "bigint") {
    out.push(`${path}: ${type}`)
    return out
  }
  if (type === "number") {
    if (!Number.isFinite(value as number)) out.push(`${path}: non-finite number`)
    return out
  }
  if (type === "string" || type === "boolean") return out
  if (seen.has(value)) return out
  seen.add(value)
  if (value instanceof Map) out.push(`${path}: Map(${(value as Map<unknown, unknown>).size})`)
  else if (value instanceof Set) out.push(`${path}: Set(${(value as Set<unknown>).size})`)
  else if (value instanceof Date) out.push(`${path}: Date`)
  else if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) nonLosslessPaths(entry, `${path}[${index}]`, out, seen)
  } else {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) out.push(`${path}: non-plain object ${String((value as { constructor?: { name?: string } }).constructor?.name)}`)
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) nonLosslessPaths(entry, `${path}.${key}`, out, seen)
  }
  return out
}

const box = sandbox()
try {
  const stub = stubAdapter({ workspace: box.workspace })
  registerWatchdogActions(stub.adapter, box.stateDir)
  const tool = stub.tools.get(STATUS_TOOL) as DshToolDef | undefined
  if (tool === undefined) throw new Error("status tool was not registered")
  const value = await (tool.execute as (args: unknown, exec: unknown) => Promise<unknown>)({ team_id: "team-recon" }, { agent: { session: { header: { cwd: box.workspace } } } })
  const paths = nonLosslessPaths(value)
  console.log("non-lossless paths:", paths.length === 0 ? "(none)" : "")
  for (const path of paths) console.log("  -", path)
  console.log("round-trip stable:", JSON.stringify(JSON.parse(JSON.stringify(value))) === JSON.stringify(value))
  console.log("keys:", Object.keys(value as Record<string, unknown>).join(","))
} finally {
  box.cleanup()
}
