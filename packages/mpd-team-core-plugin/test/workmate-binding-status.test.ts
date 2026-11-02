// W3-C2: the workmate BINDING MODE is persisted, and the approve tool DECLARES and RENDERS the bindings.
//
// WHY THIS FILE EXISTS. The workmate wave (W3-C) could bind seats but not persist HOW, because the
// record's `mode` is the SEAT mode (`member` | `checkpoint`) and the store, the tool surface and the
// render were outside that lane. This file proves the two halves that closed the gap:
//   * `workmateMode` / `workmateReason` are real RECORD fields that round-trip through
//     `updateTeamMember` and reach `agent_teams_plan {action:"status"}`;
//   * the approve tool's output schema DECLARES `bindings`, and an approval answer carrying them
//     validates against that declaration (the harness snapshots a tool body's value with its
//     lossless-JSON rule BEFORE it validates the declared schema, so an undeclared field is a defect).
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { apply } from "../src/index"
import { addMember, addTask, stagePlan, writePlan } from "../src/plan-store"
import { addTeamMember, bindActiveTeam, createTeam, updateTeamMember, writeTeam } from "../src/team-store"

/** The instant every store write in this file is stamped with. */
const NOW = new Date("2026-11-02T04:00:00.000Z")
/** The session every arm acts as. */
const LEAD = "lead-workmate-mode"

/** The sandboxes this file created, removed after every arm. */
const sandboxes: string[] = []
afterEach(() => { for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true }) })

/** One registered tool, as far as these arms read it. */
interface RegisteredTool {
  /** The flat tool name. */
  name: string
  /** The declared OUTPUT contract: the schema the harness validates and the render the model reads. */
  output?: { schema?: { properties?: Record<string, unknown> }; render?: (args: unknown, value: unknown) => unknown }
  /**
   * Run the tool.
   * @param args - the action arguments.
   * @param exec - the tool exec the harness would pass.
   * @returns whatever the branch answered.
   */
  execute: (args: unknown, exec: unknown) => Promise<Record<string, unknown>>
}

/**
 * Build the harness: the real plugin applied against a stub composition holding ONE team record.
 * @param workspace - the sandbox the store writes into.
 * @param teamId - the record's id, which this arm binds to the session.
 * @returns the registered tools and a caller that drives one.
 */
function harness(workspace: string, teamId: string): { tools: Map<string, RegisteredTool>; call: (name: string, args: unknown) => Promise<Record<string, unknown>> } {
  /** The tools the plugin registered. */
  const tools = new Map<string, RegisteredTool>()
  /** The stub executor: it raises any member and mints a handle from the name. */
  const executor = {
    kind: "native",
    reason: "the arm's own executor",
    providers: (): string[] => ["spawn"],
    spawn: async (_caller: unknown, request: { name?: string }): Promise<{ handle: string; executor: string }> => ({ handle: "child-" + String(request?.name ?? ""), executor: "native" }),
    send: async (): Promise<void> => {},
    interrupt: async (): Promise<void> => {},
    membership: (): undefined => undefined,
    members: (): [] => []
  }
  /** The stub adapter: only the seams this row uses. */
  const dsh = {
    registerTool: (definition: RegisteredTool): (() => void) => { tools.set(definition.name, definition); return () => {} },
    registerCommand: (): (() => void) => () => {},
    workspaceRoot: (): string => workspace,
    text: (value: unknown): unknown => value,
    teamExecutor: (): typeof executor => executor,
    teamMembership: (): undefined => undefined,
    teamListMembers: (): [] => [],
    teamListTasks: (): [] => [],
    capabilities: (): Record<string, never> => ({}),
    hasTool: (): boolean => false,
    executeTool: async (): Promise<{ ok: boolean; isError: boolean; value?: unknown }> => ({ ok: false, isError: true, error: "not mounted in this arm" }) as { ok: boolean; isError: boolean; value?: unknown },
    rowLog: (): void => {}
  }
  /** The minimal cordis context `apply` needs. */
  const ctx = {
    get: (id: string): unknown => (id === "mpdDsh" ? dsh : undefined),
    on: (): void => {},
    effect: (fn: () => unknown) => { try { return fn() ?? (() => {}) } catch { return () => {} } },
    provide: (): void => {},
    inject: (): void => {}
  }
  apply(ctx as never)
  // The session resolves the record this arm bound, so every branch sees a live team.
  bindActiveTeam(workspace, LEAD, teamId)
  return {
    tools,
    call: async (name: string, args: unknown): Promise<Record<string, unknown>> => {
      /** The registered tool, or a loud failure naming what WAS registered. */
      const tool = tools.get(name)
      if (tool === undefined) throw new Error(`no tool ${name} (have ${[...tools.keys()].join(", ")})`)
      return tool.execute(args, { agent: { session: { id: LEAD, header: {} } } })
    }
  }
}

/**
 * Write one team record whose single member carries a workmate binding.
 * @param workspace - the sandbox the record is written into.
 * @param mode - the binding mode the seat records.
 * @param reason - the reason, for a `none` binding.
 * @returns the record's id.
 */
function recordWithBinding(workspace: string, mode: "reuse" | "init" | "none", reason?: string): string {
  /** The record as it grows; every store helper returns a new value. */
  let record = createTeam(workspace, { name: "bound team", description: "one bound seat", leadSessionId: LEAD, planId: "plan-mode-1" }, NOW)
  record = addTeamMember(record, { name: "impl", description: "implements", role: "Senior Engineer" }, NOW)
  record = updateTeamMember(record, "impl", {
    workmateMode: mode,
    ...(mode === "none" ? {} : { workmate: "impl-1" }),
    ...(reason === undefined ? {} : { workmateReason: reason })
  })
  writeTeam(workspace, record)
  return record.teamId
}

describe("agent_teams_plan {action:\"status\"} — the binding mode reaches the answer", () => {
  test("a REUSE seat reports workmateMode and the instance it bound", async () => {
    /** This arm's sandbox. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-wm-mode-"))
    sandboxes.push(workspace)
    /** The harness over a record whose seat was REUSED. */
    const h = harness(workspace, recordWithBinding(workspace, "reuse"))
    /** The status answer. */
    const answer = await h.call("agent_teams_plan", { action: "status" })
    /** The roster the answer carries. */
    const members = answer.members as Array<Record<string, unknown>>
    expect(members).toHaveLength(1)
    // W3-C2: HOW the seat was bound travels with the record, not only WHETHER it has a workmate.
    expect(members[0]).toMatchObject({ name: "impl", workmate: "impl-1", workmateMode: "reuse" })
  })

  test("a NONE seat reports the mode AND the reason it was left plain", async () => {
    /** This arm's sandbox. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-wm-mode-"))
    sandboxes.push(workspace)
    /** The harness over a record whose seat hit the cap. */
    const h = harness(workspace, recordWithBinding(workspace, "none", "cap"))
    /** The status answer. */
    const answer = await h.call("agent_teams_plan", { action: "status" })
    /** The roster the answer carries. */
    const members = answer.members as Array<Record<string, unknown>>
    expect(members[0]).toMatchObject({ name: "impl", workmateMode: "none", workmateReason: "cap" })
    expect(members[0]?.workmate).toBeUndefined()
  })
})

describe("agent_teams_plan approve — the bindings are DECLARED and RENDERED", () => {
  test("the tool's output schema declares `bindings` as an array of objects", async () => {
    /** This arm's sandbox. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-wm-mode-"))
    sandboxes.push(workspace)
    /** The harness; no record is needed to READ the declaration. */
    const h = harness(workspace, recordWithBinding(workspace, "reuse"))
    /** The approve tool's declared output contract. */
    const declared = h.tools.get("agent_teams_plan")?.output?.schema?.properties?.bindings
    expect(declared).toEqual({ type: "array", items: { type: "object" } })
  })

  test("an approval answer carries `bindings` and the render prints one line per seat", async () => {
    /** This arm's sandbox. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-wm-mode-"))
    sandboxes.push(workspace)
    /** The harness; the approve branch needs a staged plan, not a record. */
    const h = harness(workspace, recordWithBinding(workspace, "reuse"))
    /** The staged plan this arm approves. */
    let plan = stagePlan(workspace, LEAD, { name: "the bound wave", description: "bind one seat", approval: "required" }, NOW)
    plan = addMember(plan, { name: "impl", description: "implements", prompt: "You implement.", role: "Senior Engineer" })
    plan = addTask(plan, { subject: "the work", description: "do it", blockedBy: [], owner: "impl" })
    writePlan(workspace, plan)
    /** The approval answer. */
    const answer = await h.call("agent_teams_plan", { action: "approve" })
    // THE DECLARED FIELD IS REALLY WRITTEN: this stub's tool seam refuses every call, which is the
    // shape of a composition without the workmate row, so the pass answers `no-library` for the seat —
    // and that decision still reaches the answer, which is the point.
    const bindings = answer.bindings as Array<Record<string, unknown>>
    expect(Array.isArray(bindings)).toBe(true)
    expect(bindings).toHaveLength(1)
    expect(bindings[0]).toMatchObject({ member: "impl", mode: "none", reason: "no-library" })
    // THE RENDER: one line per seat, naming the decision — the captain reads it in the approve answer.
    /** The approve tool's render function, which lives on its declared OUTPUT contract. */
    const render = h.tools.get("agent_teams_plan")?.output?.render
    expect(typeof render).toBe("function")
    /** The rendered answer text. */
    const text = JSON.stringify(render?.({}, { plan: answer.plan, created: answer.created, bindings: answer.bindings }))
    expect(text).toContain("impl — none (no-library)")
  })
})
