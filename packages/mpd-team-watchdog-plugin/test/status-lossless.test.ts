// THE STATUS VIEW'S TOOL BOUNDARY: the value `session-watchdog-status` answers must be lossless JSON.
//
// WHY IT EXISTS (measured 2026-10-02, defect 2): the tool call failed with
// `tool "session-watchdog-status" returned invalid output: value is not lossless JSON`, so the whole
// diagnostics surface answered nothing. The harness snapshots a tool body's value with its lossless
// rule BEFORE it validates the declared output schema, and that rule is stricter than
// `JSON.stringify` not throwing: `Map`, `Set`, a foreign prototype, a symbol or non-enumerable own
// key, `undefined`, a function, a bigint, `NaN`/`Infinity` and negative zero are each refused.
//
// Two halves are pinned here: the PROJECTION ITSELF is total over every value a reader could hand it,
// and the REAL status tool's value survives a JSON round trip unchanged.
import { describe, expect, test } from "bun:test"
import { losslessJson } from "../src/lossless"
import { STATUS_TOOL } from "../src/actions"
import * as plugin from "../src/index"
import { appendHeartbeat } from "../src/store"
import { sandbox, pluginCtx, testConfig, writeTeam, type TeamFixture } from "./support"

/** Every path at which a value is NOT lossless JSON, in walk order — the harness's own rule set. */
function losslessViolations(value: unknown, path: string = "value", seen: ReadonlySet<object> = new Set<object>()): string[] {
  if (value === null) return []
  switch (typeof value) {
    case "boolean":
    case "string":
      return []
    case "number":
      if (!Number.isFinite(value)) return [`${path}: non-finite number`]
      return Object.is(value, -0) ? [`${path}: negative zero`] : []
    case "object":
      break
    default:
      return [`${path}: ${typeof value} has no JSON spelling`]
  }
  // A non-null object: an array first (its own intrinsic prototype is accepted), then a record.
  const node = value as object
  if (seen.has(node)) return [`${path}: cycle`]
  /** The ancestor set for this node's children, so a cycle is reported instead of recursing. */
  const next = new Set(seen)
  next.add(node)
  if (Array.isArray(node)) {
    /** Violations for the array shell plus every index. */
    const out: string[] = []
    if (Reflect.ownKeys(node).length !== node.length + 1) out.push(`${path}: own key beyond the indices`)
    for (let index = 0; index < node.length; index += 1) out.push(...losslessViolations(node[index], `${path}[${index}]`, next))
    return out
  }
  /** The object's own prototype, which a JSON write would not carry. */
  const prototype = Object.getPrototypeOf(node)
  if (prototype !== null && prototype !== Object.prototype) return [`${path}: foreign prototype`]
  /** Own keys; a symbol key or a non-enumerable own key is exactly what a JSON write discards. */
  const keys = Reflect.ownKeys(node)
  if (keys.some((key) => typeof key !== "string" || !Object.prototype.propertyIsEnumerable.call(node, key))) return [`${path}: symbol or non-enumerable own key`]
  /** Violations for every own string key. */
  const out: string[] = []
  for (const key of keys) out.push(...losslessViolations((node as Record<string, unknown>)[key as string], `${path}.${String(key)}`, next))
  return out
}

/** A live-team fixture in the shape the engine's official readout carries. */
const live: TeamFixture = { id: "team-20261002150828", phase: "active", members: [{ id: "M1", name: "Explorer", status: "running" }], tasks: [] }

describe("the lossless projection is total", () => {
  test("every value a reader can hand it comes back as lossless JSON", () => {
    /** A class instance, which is a foreign prototype the harness refuses. */
    class Exotic {
      /** One own field, so the instance carries data as well as a prototype. */
      readonly field = 1
    }
    /** A cyclic record: the projection breaks the cycle instead of throwing. */
    const cyclic: Record<string, unknown> = { name: "cycle" }
    cyclic.self = cyclic
    /** One non-enumerable own key, which a JSON write silently drops. */
    const hidden: Record<string, unknown> = { visible: 1 }
    Object.defineProperty(hidden, "invisible", { value: 2, enumerable: false })
    /** One symbol key, which a JSON write silently drops too. */
    const symbolised: Record<string, unknown> = { visible: 1, [Symbol("s")]: 2 }
    /** A getter that throws, so a broken reader cannot take the call down. */
    const throwing: Record<string, unknown> = {}
    Object.defineProperty(throwing, "boom", { get: () => { throw new Error("reader broke") }, enumerable: true })
    /** The adversarial value every branch of the projection is exercised against. */
    const value = {
      undefinedField: undefined,
      functionField: () => 1,
      symbolField: Symbol("x"),
      bigintField: 12n,
      nan: Number.NaN,
      infinity: Number.POSITIVE_INFINITY,
      negativeZero: -0,
      map: new Map<string, unknown>([["a", new Map([["b", 1]])]]),
      set: new Set([1, "two", null]),
      date: new Date("2026-10-02T15:21:22.000Z"),
      invalidDate: new Date(Number.NaN),
      instance: new Exotic(),
      cyclic,
      hidden,
      symbolised,
      throwing,
      nested: [{ ok: true }, undefined, [1, [2]]],
    }
    /** The projected value, which is what a tool result would carry. */
    const projected = losslessJson(value)
    expect(losslessViolations(projected)).toEqual([])
    // The JSON round trip is the second, independent witness: the projection must be a fixed point.
    expect(JSON.parse(JSON.stringify(projected))).toEqual(projected as never)
    // The containers keep their data in a readable shape.
    expect(projected).toMatchObject({
      bigintField: "12",
      nan: null,
      infinity: null,
      negativeZero: 0,
      map: { a: { b: 1 } },
      set: [1, "two", null],
      date: "2026-10-02T15:21:22.000Z",
      invalidDate: null,
      cyclic: { name: "cycle", self: null },
      hidden: { visible: 1 },
      symbolised: { visible: 1 },
      throwing: { boom: null },
      nested: [{ ok: true }, null, [1, [2]]],
    })
    // A property with no JSON spelling is DROPPED, exactly as `JSON.stringify` drops it.
    expect(Object.hasOwn(projected as object, "undefinedField")).toBe(false)
    expect(Object.hasOwn(projected as object, "functionField")).toBe(false)
    expect(Object.hasOwn(projected as object, "symbolField")).toBe(false)
  })
})

describe("the status tool's own value", () => {
  test("round-trips through JSON unchanged, with a live team, heartbeats and a hold in the store", async () => {
    /** An isolated workspace for this case. */
    const box = sandbox()
    try {
      /** The plugin context the real `apply` consumes. */
      const ctx = pluginCtx(box.workspace)
      plugin.apply(ctx, { ...testConfig(), stateDir: box.stateDir } as never)
      // Real store content: one live team, one heartbeat tail and one durable hold.
      writeTeam(box, live)
      appendHeartbeat(box.workspace, box.stateDir, "session-b6963085", {
        kind: "turn-start",
        at: 1_790_953_569_000,
        member: "captain",
        memberKey: "session-b6963085",
        teamId: live.id,
        taskId: null,
        attemptId: null,
        turnId: "t1",
        workspace: box.workspace,
      })
      /** The status tool, as the harness calls it. */
      const tool = ctx.__stub.tools.get(STATUS_TOOL)
      if (tool === undefined) throw new Error(`${STATUS_TOOL} was not registered`)
      /** The value the tool answers for one team. */
      const value = await (tool.execute as (args: unknown, exec: unknown) => Promise<unknown>)({ team_id: live.id }, { agent: { session: { header: { cwd: box.workspace } } } })
      expect(losslessViolations(value)).toEqual([])
      // THE MEASURED FAILURE, asserted as its own arm: the harness's snapshot is the strict one.
      expect(JSON.parse(JSON.stringify(value))).toEqual(value as never)
      /** The value read as the documented payload shape. */
      const shaped = value as { workspace: string; teams: Array<{ teamId: string; heartbeatTails: Record<string, unknown>; isHeld: unknown }> }
      expect(shaped.workspace).toBe(box.workspace)
      expect(shaped.teams[0].teamId).toBe(live.id)
      // The HUMAN-READABLE fields survive the projection: the heartbeat tail and the gate's own view.
      expect(Object.keys(shaped.teams[0].heartbeatTails)).toEqual(["session-b6963085"])
      expect(shaped.teams[0].isHeld).toEqual({ held: false, holdId: null, at: null, reason: null, taskId: null, attemptId: null, workspace: box.workspace, source: "none" })
      ctx.__dispose()
    } finally {
      box.cleanup()
    }
  })
})
