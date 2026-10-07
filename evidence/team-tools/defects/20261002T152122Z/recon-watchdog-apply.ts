// Faithful repro for DEFECT 2: run the REAL plugin `apply` through the package's own ctx stub (so the
// real engine, registry, predicate/knob providers and stores are all wired), call the registered
// `session-watchdog-status` tool, and walk its value for anything that cannot survive a lossless JSON
// snapshot — undefined/function/symbol/bigint, Map/Set/Date/class instance, non-finite number, -0.
import * as plugin from "../../../../packages/mpd-team-watchdog-plugin/src/index.ts"
import { appendHeartbeat } from "../../../../packages/mpd-team-watchdog-plugin/src/store.ts"
import { HoldRegistry } from "../../../../packages/mpd-team-watchdog-plugin/src/holds.ts"
import { pluginCtx, sandbox, testConfig, writeTeam, type TeamFixture } from "../../../../packages/mpd-team-watchdog-plugin/test/support.ts"

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

/** A live-team fixture in the shape the engine's official readout carries. */
const fixture: TeamFixture = { id: "team-20261002150828", phase: "active", members: [{ id: "M1", name: "Explorer", status: "running" }], tasks: [] }

const box = sandbox()
try {
  // The plugin context, whose adapter the real `apply` consumes.
  const ctx = pluginCtx(box.workspace)
  // The row config the patch supplies.
  const report = plugin.apply(ctx, { stateDir: box.stateDir, ...testConfig() } as never)
  console.log("apply report:", JSON.stringify(report))
  // A live team, a couple of heartbeats and a hold — the live session's own fixtures.
  writeTeam(box, fixture)
  appendHeartbeat(box.workspace, box.stateDir, "session-b6963085", { kind: "model-step", at: 1_790_953_569_000, member: "captain", memberKey: "session-b6963085", teamId: fixture.id, taskId: null, attemptId: null, turnId: "t1", workspace: box.workspace })
  const registry = new HoldRegistry(box.stateDir, box.workspace)
  registry.hydrate([box.workspace])
  // The tool under test, as the harness would call it.
  const tool = ctx.__stub.tools.get("session-watchdog-status")
  if (tool === undefined) throw new Error("status tool not registered")
  const value = await (tool.execute as (args: unknown, exec: unknown) => Promise<unknown>)({ team_id: fixture.id }, { agent: { session: { header: { cwd: box.workspace } } } })
  const paths = nonLosslessPaths(value)
  console.log("non-lossless paths:", paths.length === 0 ? "(none)" : "")
  for (const path of paths) console.log("  -", path)
  console.log("round-trip stable:", JSON.stringify(JSON.parse(JSON.stringify(value))) === JSON.stringify(value))
  console.log("teams[0] keys:", Object.keys((value as { teams: Array<Record<string, unknown>> }).teams[0]).join(","))
  console.log("registry isHeld:", JSON.stringify(registry.isHeld(fixture.id, box.workspace)))
  ctx.__dispose()
} finally {
  box.cleanup()
}
