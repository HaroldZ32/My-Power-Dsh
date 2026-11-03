// THE TOOL CARDS for the three team tools, pinned where the app will draw them.
//
// Each arm runs the SAME pure builder the tool registration wraps, through `toolCard()` — so a tree
// that would be DROPPED by the real seam is dropped here too, and the arm fails instead of passing on
// a view the app never sees. Three things are asserted together: the card is legal v1 (`lintDesign`
// version 1, the static-fallback contract), it fits the toolCard budget, and it carries no binding
// and no action (a card has neither a data model nor an action channel). The measured
// bytes / nodes / depth are PRINTED per card, because that number is what the lane's report quotes.
import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply } from "../src/index"
import { VIEW_KEY, fitsBudget, lintDesign, measureView, toolCard, type DshGoView } from "../../mpd-dsh-adapter-plugin/src/dshgo-view"
import { agentTeamsDispatchCard, agentTeamsPlanCard, agentTeamsTaskCard } from "../src/tool-cards"

/** A card builder as `toolCard()` takes it: the tool's arguments and its value, in, one tree out. */
type Builder = (args: unknown, value: unknown) => DshGoView | null

/** What a registration capture collected: the name and the whole definition, output included. */
interface Captured {
  /** Registered tool definitions, in registration order. */
  tools: Array<{ name: string; output?: { presentationMeta?: unknown } }>
}

/** Apply the plugin with a proxy adapter that records every `registerTool` definition. */
function capture(): Captured {
  /** The capture the stub writes into. */
  const out: Captured = { tools: [] }
  /** A disposer-returning no-op, standing in for every seam these arms never exercise. */
  const noop = (): (() => void) => () => {}
  /** The adapter double: only `registerTool` is real, everything else answers a no-op. */
  const dsh = new Proxy({} as Record<string | symbol, unknown>, {
    get: (_target, prop) => {
      if (prop === "registerTool") return (definition: Captured["tools"][number]) => { out.tools.push(definition); return () => {} }
      if (prop === "workspaceRoot") return () => mkdtempSync(join(tmpdir(), "mpd-cards-"))
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
  apply(ctx as never)
  return out
}

/** Run one builder through the REAL seam, assert the card contract and print its measurement. */
function checkCard(label: string, builder: Builder, args: unknown, value: unknown): DshGoView {
  /** What the seam hands the app for this call. */
  const meta = toolCard(builder)(args, value)
  /** The view tree, when the seam accepted one. */
  const view = meta[VIEW_KEY] as DshGoView | undefined
  expect(view).toBeDefined()
  if (view === undefined) throw new Error(`${label}: the seam dropped the card`)
  // Version 1 is the mode a CHAT-LOG card must satisfy: no style, no accent, no v2-only component.
  expect(lintDesign(view, { version: 1 })).toEqual([])
  expect(fitsBudget(view, "toolCard")).toBe(true)
  /** The tree as JSON, for the two bans the lint does not express. */
  const encoded = JSON.stringify(view)
  expect(encoded).not.toContain('"$"')
  expect(encoded).not.toContain('"actions"')
  /** The three numbers the budget is made of. */
  const measured = measureView(view)
  console.log(`[card] ${label}: bytes=${measured.bytes} nodes=${measured.nodes} depth=${measured.depth}`)
  return view
}

describe("the team tool cards", () => {
  test("agent_teams_plan draws the staged plan, the roster and the board", () => {
    /** The status-branch answer: a staged plan, a live roster and a two-row board. */
    const answer = {
      plan: {
        planId: "plan-2026-11-02T16-00-00Z",
        name: "native parity",
        description: "Bring the dsh-Go native surface up to the web surface's richness.",
        approval: "required",
        members: [{ name: "Deep Worker", description: "d", prompt: "p" }],
        tasks: [{ subject: "D1", description: "", blockedBy: [], owner: "Deep Worker" }],
      },
      hold: null,
      team: { teamId: "team-1", name: "native parity", description: "", members: [], tasks: [] },
      members: [{ name: "Deep Worker", status: "running", role: "Deep Worker" }],
      tasks: [{ id: "T1", subject: "D1: the plane", status: "in_progress", owner: "Deep Worker" }],
      summary: { total: 1, completed: 0, running: 1, ready: 0 },
      contracts: [],
    }
    checkCard("plan.status", agentTeamsPlanCard, { action: "status" }, answer)
  })

  test("agent_teams_plan survives the archive and approval branches", () => {
    checkCard("plan.approve", agentTeamsPlanCard, { action: "approve" }, {
      plan: { planId: "plan-2", approval: "automatic" },
      created: { members: [], tasks: [] },
      appended: "staged T3 on team-1",
      stoppedAt: "T2 blocked by T1",
    })
    checkCard("plan.delete", agentTeamsPlanCard, { action: "delete" }, { archivedTo: ".mpd/team/archive/plan-2" })
  })

  test("agent_teams_task draws the row, the contract and the occupancy branch", () => {
    checkCard("task.complete", agentTeamsTaskCard, { action: "complete" }, {
      taskId: "T3",
      status: "completed",
      closedBy: "Junior Engineer",
      attempt: 1,
      revision: 2,
      note: "landed",
      dependents: [{ id: "T4", subject: "D6b: the other ten cards" }],
    })
    checkCard("task.context", agentTeamsTaskCard, { action: "context" }, {
      member: "Junior Engineer",
      mode: "member",
      usedTokens: 1234,
      windowTokens: 200000,
      ratio: 0.0062,
      provenance: "observed",
      fenced: false,
      contextCheckpoint: {},
    })
    checkCard("task.handoff", agentTeamsTaskCard, { action: "handoff" }, {
      path: "handoff/junior-engineer-1.md",
      ordinal: 1,
      mode: "member",
      directive: "end your turn",
    })
  })

  test("agent_teams_dispatch draws the pairs, the skips and the refusals", () => {
    checkCard("dispatch.run", agentTeamsDispatchCard, { action: "run" }, {
      pairs: [{ taskId: "T1", subject: "D1: the plane", memberId: "M1", memberName: "Deep Worker" }],
      skipped: [{ taskId: "T2", subject: "D2: the panels", reason: "not ready (blocked by T1)" }],
      reassigned: [{ taskId: "T3", owner: "Junior Engineer", delivered: false, reason: "fenced" }],
      reaped: [],
      forgotten: [],
    })
    checkCard("dispatch.refused", agentTeamsDispatchCard, { action: "run" }, { refused: "no team record in this workspace" })
    checkCard("dispatch.release", agentTeamsDispatchCard, { action: "release" }, { released: true, taskId: "T1", status: "pending", revision: 3 })
  })

  test("a worst-case answer still fits 8 KiB / 40 nodes / depth 6", () => {
    /** A field the model could really return at the schema's full width. */
    const huge = "x".repeat(4000)
    checkCard("plan.worst-case", agentTeamsPlanCard, { action: "status" }, {
      plan: { planId: "plan", approval: "required", description: huge, members: Array.from({ length: 60 }, (_, i) => ({ name: `M${i}`, status: "running", role: "Reviewer" })), tasks: [] },
      tasks: Array.from({ length: 60 }, (_, i) => ({ id: `T${i}`, subject: huge, status: "pending", owner: "M1" })),
    })
    checkCard("task.worst-case", agentTeamsTaskCard, { action: "complete" }, { taskId: "T1", status: "completed", note: huge, dependents: Array.from({ length: 40 }, (_, i) => ({ id: `T${i}`, subject: huge })) })
    checkCard("dispatch.worst-case", agentTeamsDispatchCard, { action: "run" }, {
      pairs: Array.from({ length: 40 }, (_, i) => ({ subject: huge, memberName: "M" + i, note: huge })),
      skipped: Array.from({ length: 40 }, (_, i) => ({ subject: huge, reason: huge })),
    })
  })

  test("every registered team tool carries a presentationMeta FUNCTION", () => {
    /** The registrations one `apply` produced. */
    const captured = capture()
    /** The three tools this lane owns, by name. */
    const names = ["agent_teams_plan", "agent_teams_task", "agent_teams_dispatch"]
    for (const name of names) {
      /** The registration carrying this tool's name. */
      const tool = captured.tools.find((entry) => entry.name === name)
      expect(tool).toBeDefined()
      expect(typeof tool?.output?.presentationMeta).toBe("function")
    }
  })

  test("the registered meta answers with a dsh-go/view for a real answer", () => {
    /** The registrations one `apply` produced. */
    const captured = capture()
    /** The plan tool's own registered meta, called exactly as the harness calls it. */
    const meta = captured.tools.find((entry) => entry.name === "agent_teams_plan")?.output?.presentationMeta
    if (typeof meta !== "function") throw new Error("agent_teams_plan carries no presentationMeta")
    /** What the seam returns for a minimal staged plan. */
    const projected = (meta as (args: unknown, value: unknown) => Record<string, unknown>)({ action: "status" }, { plan: { planId: "p", members: [], tasks: [] } })
    expect(projected[VIEW_KEY]).toBeDefined()
  })
})
