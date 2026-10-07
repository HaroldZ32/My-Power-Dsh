// DEFINITIVE check against the INSTALLED harness the live session runs (dsh 0.2.0-rc.2):
//   1. which field of each failing tool value the harness's own `snapshotJsonValue` rejects;
//   2. whether the PLANNED schemas compile under the harness's own schema compiler.
// The harness imports are absolute paths into the installed CLI: this is a throwaway verification
// script, not production code, and it is the only way to validate against the real authority.
import { cpSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const HARNESS = "/home/haroldzhao/.nvm/versions/node/v24.21.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js"
const VALUES = "/home/haroldzhao/.nvm/versions/node/v24.21.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-util-values/lib/index.js"
const { parameterSchemaSpecToJsonSchema, valueSchemaSpecToJsonSchema, validateJsonSchemaValue, assertSupportedJsonSchema } = await import(HARNESS)
const { isJsonValue, snapshotJsonValue } = await import(VALUES)

import * as watchdog from "../../../../packages/mpd-team-watchdog-plugin/src/index.ts"
import * as core from "../../../../packages/mpd-team-core-plugin/src/index.ts"
import { pluginCtx as watchdogCtx, testConfig } from "../../../../packages/mpd-team-watchdog-plugin/test/support.ts"

/** The first path `snapshotJsonValue` refuses, found by bisecting the value tree. */
function firstRejected(value: unknown, path = "value"): string {
  if (snapshotJsonValue(value) !== undefined) return ""
  if (value === null || typeof value !== "object") return `${path} (self)`
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      const hit = firstRejected(entry, `${path}[${index}]`)
      if (hit !== "") return hit
    }
    return `${path} (array shell)`
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const hit = firstRejected(entry, `${path}.${key}`)
    if (hit !== "") return hit
  }
  return `${path} (object shell)`
}

/** A minimal Proxy adapter that captures tools and answers `workspaceRoot`. */
function coreCapture(workspace: string): { tools: Map<string, any> } {
  const tools = new Map<string, any>()
  const noop = (): (() => void) => () => {}
  const dsh = new Proxy({} as Record<string | symbol, unknown>, {
    get: (_target, prop) => {
      if (prop === "registerTool") return (definition: any) => { tools.set(definition.name, definition); return () => {} }
      if (prop === "workspaceRoot") return () => workspace
      if (prop === "teamListMembers" || prop === "teamListTasks") return () => []
      if (prop === "workspaceRootsAll") return () => [workspace]
      if (prop === "capabilities") return () => ({})
      return noop
    },
  })
  const ctx = { get: (n: string) => (n === "mpdDsh" ? dsh : undefined), on: noop, effect: (fn: () => unknown) => { try { return fn() ?? (() => {}) } catch { return () => {} } }, provide: noop, inject: noop }
  return { tools: (core.apply(ctx as never), tools) }
}

// ── 1. the watchdog status value ────────────────────────────────────────────────
const wbox = mkdtempSync(join(tmpdir(), "defect-check-watchdog-"))
const cbox = mkdtempSync(join(tmpdir(), "defect-check-core-"))
try {
  // Replay the real workspace's watchdog state into the temp sandbox.
  cpSync("/home/haroldzhao/MyProj/DshProj/My-Power-Dsh/.mpd/team", join(wbox, ".mpd", "team"), { recursive: true })
  const wctx = watchdogCtx(wbox)
  watchdog.apply(wctx, { stateDir: join(".mpd", "team"), ...testConfig() } as never)
  const statusTool = wctx.__stub.tools.get("session-watchdog-status")
  const statusValue = await (statusTool!.execute as any)({ team_id: "team-20261002150828" }, { agent: { session: { header: { cwd: wbox } } } })
  console.log("watchdog status lossless:", isJsonValue(statusValue), "| first rejected:", firstRejected(statusValue) || "(none)")
  console.log("watchdog status schema compiles:", (() => { try { valueSchemaSpecToJsonSchema(statusTool!.output.schema); return true } catch (error) { return String(error) } })())

  // ── 2. the core plan status value ─────────────────────────────────────────────
  const { tools } = coreCapture(cbox)
  const planTool = tools.get("agent_teams_plan")
  // A real team record on disk, as the live session had.
  const planValue = await (planTool.execute as any)({ action: "status" }, { agent: { session: { header: { cwd: cbox } } } })
  console.log("core plan status lossless:", isJsonValue(planValue), "| first rejected:", firstRejected(planValue) || "(none)")
  console.log("core plan status schema compiles:", (() => { try { valueSchemaSpecToJsonSchema(planTool.output.schema); return true } catch (error) { return String(error) } })())

  // With a team record present (the live failing case).
  mkdirSync(join(cbox, ".mpd", "team", "teams"), { recursive: true })
  writeFileSync(join(cbox, ".mpd", "team", "teams", "team-x.json"), JSON.stringify({
    version: 1, teamId: "team-x", name: "x", description: "", leadSessionId: "", phase: "active",
    createdAt: "2026-10-02T15:00:00.000Z", members: [{ id: "M1", name: "A", description: "", status: "running", spawnedAt: "2026-10-02T15:00:00.000Z" }],
    tasks: [{ id: "T1", subject: "s", description: "", kind: "work", status: "pending", blockedBy: [], writeScopes: [], createdAt: "2026-10-02T15:00:00.000Z", updatedAt: "2026-10-02T15:00:00.000Z", revision: 1, owner: "A" }],
    nextMemberNumber: 2, nextTaskNumber: 2, revision: 1,
  }))
  // Bind the record to the session through the index the store reads.
  writeFileSync(join(cbox, ".mpd", "team", "active.json"), JSON.stringify({ version: 1, bySession: {}, byWorkspace: {} }))
  const planValue2 = await (planTool.execute as any)({ action: "status" }, { agent: { session: { header: { cwd: cbox } } } })
  console.log("core plan status WITH record lossless:", isJsonValue(planValue2), "| first rejected:", firstRejected(planValue2) || "(none)")

  // ── 3. do the PLANNED schemas compile under the harness compiler? ─────────────
  const plannedPlanOutput = {
    type: "object",
    properties: {
      plan: { oneOf: [{ type: "object" }, { type: "null" }] },
      hold: { oneOf: [{ type: "object" }, { type: "null" }] },
      team: { oneOf: [{ type: "object" }, { type: "null" }] },
      summary: { oneOf: [{ type: "object" }, { type: "null" }] },
      members: { type: "array", items: { type: "object" } },
      tasks: { type: "array", items: { type: "object" } },
      contracts: { type: "array", items: { type: "object" } },
      created: { type: "object" },
      stoppedAt: { type: "string" },
      archivedTo: { type: "string" },
    },
  }
  try {
    const compiled = valueSchemaSpecToJsonSchema(plannedPlanOutput)
    assertSupportedJsonSchema(compiled)
    console.log("PLANNED plan output schema compiles: true")
    console.log("  plan violations on null:", JSON.stringify(validateJsonSchemaValue(compiled, { plan: null, hold: null }, "value")))
    console.log("  plan violations on object:", JSON.stringify(validateJsonSchemaValue(compiled, { plan: { a: 1 }, hold: { b: 2 } }, "value")))
    console.log("  plan violations on the measured old shape:", JSON.stringify(validateJsonSchemaValue(compiled, { plan: null, hold: null, team: null, members: [], tasks: [], summary: null, contracts: [] }, "value")))
  } catch (error) {
    console.log("PLANNED plan output schema REJECTED:", String(error))
  }

  const plannedParameters = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["create", "add_member", "create_task", "edit", "approve", "delete", "status"], description: "What to do." },
      owner: { type: "string", description: "create_task: the owning teammate's display name (alias of task.owner)." },
      blocked_by: { type: "array", items: { type: "string" }, description: "create_task: task ids/subjects that must close first (alias of task.blocked_by)." },
      task: {
        type: "object",
        description: "create_task: {subject, description, blocked_by?, write_scopes?, owner?}.",
        properties: {
          subject: { type: "string", description: "The task title." },
          description: { type: "string", description: "The acceptance text." },
          blocked_by: { type: "array", items: { type: "string" }, description: "Task ids or subjects that must close first." },
          write_scopes: { type: "array", items: { type: "string" }, description: "Paths the task is expected to touch." },
          owner: { type: "string", description: "The owning teammate's display name." },
        },
      },
      member: {
        type: "object",
        description: "add_member: {name, prompt, description?, role?}.",
        properties: {
          name: { type: "string", description: "The teammate name." },
          description: { type: "string", description: "One-line role summary." },
          prompt: { type: "string", description: "The instantiation prompt." },
          role: { type: "string", description: "Roster role label." },
        },
      },
    },
    required: ["action"],
    additionalProperties: true,
  }
  try {
    const compiled = parameterSchemaSpecToJsonSchema(plannedParameters)
    console.log("PLANNED plan parameters compile: true")
    console.log("  violations for a top-level owner + nested task:", JSON.stringify(validateJsonSchemaValue(compiled, { action: "create_task", owner: "Reviewer", blocked_by: ["T1"], task: { subject: "s", description: "d", owner: "X", write_scopes: ["a/**"] } }, "value")))
  } catch (error) {
    console.log("PLANNED plan parameters REJECTED:", String(error))
  }
  wctx.__dispose()
} finally {
  rmSync(wbox, { recursive: true, force: true })
  rmSync(cbox, { recursive: true, force: true })
}
