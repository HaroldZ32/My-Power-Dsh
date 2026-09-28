// THE TOOL SURFACE ITSELF is the contract this file pins: how many tools exist, what they cost the
// model's context, and that every action the older hand-written surface exposed is still reachable.
//
// MEASURED before the consolidation (2026-09-27): 14 tools + 1 command costing 7,643 characters
// (~1,900 tokens) on EVERY turn — before a word of the actual task. After: 5 tools + 1 command,
// 4,717 characters (~1,180 tokens). The budget below is what keeps that from silently growing back.
import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply } from "../src/index"

/** What the stub adapter collected, so an arm can assert on the registrations themselves. */
interface Captured {
  /** Registered tool definitions, in registration order. */
  tools: Array<{ name: string; description: string; parameters: unknown }>
  /** Registered command definitions, in registration order. */
  commands: Array<{ name: string }>
}

/** Apply the plugin with a stub adapter that captures what it registers. */
function capture(): Captured {
  /** The capture the stub writes into. */
  const out: Captured = { tools: [], commands: [] }
  /** A disposer-returning no-op, standing in for every seam this test never exercises. */
  const noop = (): (() => void) => () => {}
  /** A proxy adapter: any unhandled property answers `noop`, so a new seam cannot crash capture. The
   * empty target is cast to a record because the trap must be free to answer `unknown` for any key. */
  const dsh = new Proxy({} as Record<string | symbol, unknown>, {
    get: (_target, prop) => {
      if (prop === "registerTool") return (definition: Captured["tools"][number]) => { out.tools.push(definition); return () => {} }
      if (prop === "registerCommand") return (definition: Captured["commands"][number]) => { out.commands.push(definition); return () => {} }
      if (prop === "workspaceRoot") return () => mkdtempSync(join(tmpdir(), "mpd-surface-"))
      if (prop === "capabilities") return () => ({})
      return noop
    },
  })
  /** The minimal cordis context `apply` needs: the adapter lookup plus a no-op effect seam. */
  const ctx = {
    get: (name: string) => (name === "mpdDsh" ? dsh : undefined),
    on: noop,
    effect: (fn: () => unknown) => { try { return fn() ?? (() => {}) } catch { return () => {} } },
    provide: noop,
    inject: noop,
  }
  // The stub is a hand-built subset of the real context, so it is asserted to `never` rather than
  // made to satisfy whatever Context type the seam declares — the assertion is the stub's contract.
  apply(ctx as never)
  return out
}

/** What one registration costs the context: the model reads name, description and parameter schema. */
const costOf = (tool: Captured["tools"][number]): number => JSON.stringify({ n: tool.name, d: tool.description, p: tool.parameters }).length

describe("the consolidated surface", () => {
  /** The registrations one `apply` produced, shared by every arm in this block. */
  const captured = capture()

  test("FIVE tools and one command — not fourteen", () => {
    expect(captured.tools.map((tool) => tool.name).sort()).toEqual([
      "agent_teams_control",
      "agent_teams_dispatch",
      "agent_teams_mail",
      "agent_teams_plan",
      "agent_teams_task",
    ])
    expect(captured.commands.map((command) => command.name)).toEqual(["agent-teams"])
  })

  test("every tool is ACTION-based, so a caller picks an action instead of a tool", () => {
    for (const tool of captured.tools) {
      /** This tool's parameter schema, which must be object-rooted with an action enum. The
       * declaration is `unknown` by the seam's contract, so the shape is asserted here. */
      const properties = (tool.parameters as { properties?: Record<string, { enum?: string[] }> }).properties ?? {}
      expect(Array.isArray(properties.action?.enum)).toBe(true)
      expect((properties.action?.enum ?? []).length).toBeGreaterThan(1)
    }
  })

  test("the context budget holds: the whole surface stays under 5,000 characters", () => {
    /** The context cost of the whole registered surface, in characters. */
    const total = captured.tools.reduce((sum, tool) => sum + costOf(tool), 0) + captured.commands.length * 96
    // 7,643 before the consolidation. A new tool or a longer description has to justify itself against
    // this number, because every turn pays it.
    expect(total).toBeLessThan(5000)
    expect(captured.tools.length + captured.commands.length).toBeLessThanOrEqual(6)
  })

  test("EVERY action of the retired hand-written surface is still reachable", () => {
    /** Read one tool's action names, so the arm can compare them with the retired surface. */
    const actions = (name: string): string[] => {
      /** The registered tool this arm is asking about. */
      const tool = captured.tools.find((candidate) => candidate.name === name)
      // `parameters` is `unknown` by the seam's contract, so the action enum is reached by a cast.
      return ((tool?.parameters as { properties?: { action?: { enum?: string[] } } })?.properties?.action?.enum ?? [])
    }
    // plan absorbed create/add_member/create_task/edit_plan/approve/delete/status
    expect(actions("agent_teams_plan").sort()).toEqual(["add_member", "approve", "create", "create_task", "delete", "edit", "status"])
    // task absorbed claim_task/task_contract/dispatch_release
    expect(actions("agent_teams_task").sort()).toEqual(["claim", "contract", "release"])
    // dispatch absorbed dispatch/dispatch_release
    expect(actions("agent_teams_dispatch").sort()).toEqual(["release", "run"])
    // mail absorbed mailbox (and the older observation-only counter)
    expect(actions("agent_teams_mail").sort()).toEqual(["read", "send", "summary", "unread"])
    // control absorbed halt/resume
    expect(actions("agent_teams_control").sort()).toEqual(["halt", "resume"])
  })

  test("the retired TOOL NAMES are gone — a re-added one would redden here", () => {
    /** The registered tool names, which is what the retired-name arm scans. */
    const names = captured.tools.map((tool) => tool.name)
    for (const retired of ["agent_teams_create", "agent_teams_add_member", "agent_teams_create_task", "agent_teams_edit_plan", "agent_teams_approve", "agent_teams_delete", "agent_teams_claim_task", "agent_teams_task_contract", "agent_teams_halt", "agent_teams_resume", "agent_teams_dispatch_release", "agent_teams_mailbox", "agent_teams_status"]) {
      expect(names).not.toContain(retired)
    }
  })

  test("no description is a paragraph: each stays under 700 characters", () => {
    for (const tool of captured.tools) expect(tool.description.length).toBeLessThan(700)
  })
})
