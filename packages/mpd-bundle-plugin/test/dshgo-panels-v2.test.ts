// THE TWO NATIVE PANELS' DESIGN CONTRACT, MEASURED (§7.2) — plus the strip and the menu handlers.
//
// WHY A SECOND TEST FILE: `dshgo-panel.test.ts` covers the reader, the tap semantics and the push path
// of the workbench panel. THIS file covers what §7 adds: every tab has one `tinted` hero, metrics sit in
// a grid, statuses carry words, a tab is never blank, at most one action is primary — and the v1
// fallback keeps every metric's label AND value. It also covers the team panel and the three surfaces
// D5 adds, because a design that is never linted is a design that drifts.
import { describe, expect, test } from "bun:test"
import {
  adaptView,
  countViewNodes,
  lintDesign,
  measureView,
  BUDGETS,
  fitsBudget,
  type DshGoCaps,
  type DshGoView,
} from "../../mpd-dsh-adapter-plugin/src/dshgo-view"
import { buildMpdView } from "../src/dshgo-views.ts"
import { buildTeamView, type TeamPanelSnapshot } from "../src/dshgo-views.ts"
import type { PanelSnapshot } from "../src/dshgo-panel.ts"
import { createSurfaceActions, replyTextOf, stripLine } from "../src/dshgo-surfaces.ts"
import { memorySlugOf, readMemoryStore } from "../src/dshgo-panel.ts"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** An app that speaks view v2 (1.0.9 is the contract's floor). */
const V2_CAPS: DshGoCaps = { app: "1.0.9", locale: "en", components: undefined }

/** An app below the v2 floor, which the kit reads as "fall back to v1". */
const V1_CAPS: DshGoCaps = { app: "1.0.8", locale: "en" }

/** A workbench snapshot with every section populated, so no tab is trivially empty. */
function snapshotWithEverything(): PanelSnapshot {
  return {
    team: { id: "team-1", name: "Drive surface", status: "approved", phase: "active", members: 2, tasks: 3 },
    plan: { ready: true, members: 2, tasks: 3 },
    question: { id: "q1", question: "Pick one of the two release lanes so the wave can continue", options: [{ label: "main" }, { label: "dev" }, { label: "edge" }, { label: "hotfix" }, { label: "draft" }] },
    readyTasks: [{ id: "T1", title: "Ship the panel", subtitle: "work · Lead" }],
    counts: { ready: 1, active: 1, done: 1, total: 3, completion: 33, members: 2 },
    alert: "A plan is staged and waits for approval",
    workmates: [{ name: "deep-worker-1", base: "Deep Worker", uses: 4, note: "carries the D1 lane" }],
    memory: { entries: [{ kind: "fact", description: "the kit writes accent app", age: "2h" }], reflections: 3, steps: 4 },
  }
}

/** A team snapshot with a board, a roster, a selection and a watchdog record. */
function teamSnapshot(): TeamPanelSnapshot {
  return {
    team: { id: "team-1", name: "Drive surface", status: "approved", phase: "active" },
    tasks: [
      { id: "T1", subject: "Adapt the view kit", owner: "Deep Worker", status: "in_progress", kind: "work", blockedBy: 0, description: "Build the v2 kit and its fallback.", dependencies: "", verdict: "" },
      { id: "T2", subject: "Migrate the panels", owner: "Senior Engineer", status: "pending", kind: "work", blockedBy: 1, description: "Two panels, four tabs each.", dependencies: "T1", verdict: "PASS" },
    ],
    counts: { total: 2, done: 0, active: 1, blocked: 1, completion: 0 },
    members: [
      { name: "Deep Worker", mode: "running", handoff: "" },
      { name: "Senior Engineer", mode: "idle", handoff: "handoff ready" },
    ],
    selected: { id: "T1", subject: "Adapt the view kit", owner: "Deep Worker", status: "in_progress", kind: "work", blockedBy: 0, description: "Build the v2 kit and its fallback.", dependencies: "", verdict: "" },
    watchdog: { predicate: "channel", held: true, reason: "silence", taskId: "T2", incidents: [{ at: "2026-11-02T20:00:00Z", kind: "silence", detail: "T2 was silent past the bound" }] },
  }
}

/** Every component node of a tree, depth first. */
function nodesOf(view: unknown): Record<string, unknown>[] {
  /** The nodes collected so far. */
  const found: Record<string, unknown>[] = []
  /** Walk one value. */
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { for (const entry of value) walk(entry); return }
    if (typeof value !== "object" || value === null) return
    /** The value read as a record. */
    const record = value as Record<string, unknown>
    if (typeof record.type === "string") found.push(record)
    for (const entry of Object.values(record)) walk(entry)
  }
  walk(view)
  return found
}

/** The tabs of a tree, in order. */
function tabSections(view: DshGoView): Array<{ label: string; children: unknown[] }> {
  /** The first `tabs` node. */
  const tabs = nodesOf(view).find((node) => node.type === "tabs")
  return Array.isArray(tabs?.items) ? (tabs.items as Array<{ label: string; children: unknown[] }>) : []
}

/** Every `actions` item in a tree. */
function buttonsOf(view: unknown): Array<{ label?: unknown; action?: unknown; style?: unknown }> {
  return nodesOf(view).filter((node) => node.type === "actions").flatMap((node) => (Array.isArray(node.items) ? node.items as Array<{ label?: unknown; action?: unknown; style?: unknown }> : []))
}

describe("the workbench panel's v2 design", () => {
  test("lintDesign is clean in v2 mode and the tree fits the panel budget", () => {
    /** The v2 tree the live panel publishes to a 1.0.9 app. */
    const view = buildMpdView(snapshotWithEverything(), V2_CAPS)
    expect(lintDesign(view, { version: 2 })).toEqual([])
    expect(fitsBudget(view, "panel")).toBe(true)
    /** The measurement reported to the contract's evidence. */
    const measured = measureView(view)
    expect(measured.nodes).toBeLessThanOrEqual(BUDGETS.panel.nodes)
    expect(measured.depth).toBeLessThanOrEqual(BUDGETS.panel.depth)
    expect(measured.bytes).toBeLessThanOrEqual(BUDGETS.panel.bytes)
  })

  test("THREE tabs, each with exactly ONE tinted hero and its own title", () => {
    /** The v2 tree. */
    const view = buildMpdView(snapshotWithEverything(), V2_CAPS)
    /** The panel's tabs. */
    const sections = tabSections(view)
    expect(sections).toHaveLength(3)
    for (const section of sections) {
      /** Every node inside this tab. */
      const nodes = nodesOf(section.children)
      /** The tinted cards in this tab. */
      const heroes = nodes.filter((node) => typeof node.style === "object" && node.style !== null && (node.style as Record<string, unknown>).card === "tinted")
      expect(heroes).toHaveLength(1)
    }
  })

  test("every metric sits inside a grid, and one primary action at most", () => {
    /** The v2 tree. */
    const view = buildMpdView(snapshotWithEverything(), V2_CAPS)
    for (const node of nodesOf(view)) {
      if (node.type !== "metric") continue
      /** Whether some grid carries this metric. */
      const insideGrid = nodesOf(view).some((candidate) => candidate.type === "grid" && nodesOf(candidate.children).includes(node))
      expect(insideGrid).toBe(true)
    }
    expect(buttonsOf(view).filter((button) => button.style === "primary").length).toBeLessThanOrEqual(1)
  })

  test("the Chinese app gets Chinese copy and the English app English copy", () => {
    /** The tabs a `zh` app sees. */
    const zh = tabSections(buildMpdView(snapshotWithEverything(), { ...V2_CAPS, locale: "zh-CN" })).map((section) => section.label)
    /** The tabs an `en` app sees. */
    const en = tabSections(buildMpdView(snapshotWithEverything(), V2_CAPS)).map((section) => section.label)
    expect(zh).toEqual(["总览", "问题", "资料库"])
    expect(en).toEqual(["Overview", "Ask", "Library"])
  })

  test("every tab label fits ONE line at a 390 px viewport (repair T12)", () => {
    /** Both panels, both languages. */
    const strips = [
      tabSections(buildMpdView(snapshotWithEverything(), V2_CAPS)),
      tabSections(buildMpdView(snapshotWithEverything(), { ...V2_CAPS, locale: "zh-CN" })),
      tabSections(buildTeamView(teamSnapshot(), V2_CAPS)),
      tabSections(buildTeamView(teamSnapshot(), { ...V2_CAPS, locale: "zh-CN" })),
    ]
    for (const sections of strips) {
      // Measured on the app's own render: a nine-character label broke mid-word and pushed the fourth
      // tab onto a second row, so the budget is eight characters per label AND about 24 per strip.
      expect(sections).toHaveLength(3)
      for (const section of sections) expect(String(section.label).length).toBeLessThanOrEqual(8)
      expect(sections.reduce((total, section) => total + String(section.label).length, 0)).toBeLessThanOrEqual(24)
    }
  })

  test("the hero does NOT hold the metric grid, so the grid gets the panel's full width (repair T18)", () => {
    // Measured in the app: a grid keeps two columns only while (width - 8) / 2 >= 136 * textScale. A
    // padded hero shrinks that width below the threshold and the grid stacks, so the tiles must sit
    // outside the card. This arm fails if a grid is nested inside a `tinted` node again.
    /** Every tab of both panels, in v2. */
    const tabsTotal = [...tabSections(buildMpdView(snapshotWithEverything(), V2_CAPS)), ...tabSections(buildTeamView(teamSnapshot(), V2_CAPS))]
    expect(tabsTotal.length).toBeGreaterThan(0)
    for (const tab of tabsTotal) {
      for (const node of nodesOf(tab.children)) {
        if (node.type !== "grid") continue
        /** The tinted card this grid sits under, if any. */
        const insideHero = nodesOf(tab.children).some((candidate) => typeof candidate.style === "object" && candidate.style !== null && (candidate.style as Record<string, unknown>).card === "tinted" && nodesOf(candidate.children).includes(node))
        expect(insideHero).toBe(false)
      }
    }
    /** Both trees, built ONCE, so the walks below share object identity. */
    const trees = [buildMpdView(snapshotWithEverything(), V2_CAPS), buildTeamView(teamSnapshot(), V2_CAPS)]
    /** Every metric of both trees, with the tree it belongs to. */
    const metrics = trees.map((tree) => ({ tree, metrics: nodesOf(tree).filter((node) => node.type === "metric") }))
    expect(metrics.reduce((total, one) => total + one.metrics.length, 0)).toBeGreaterThan(0)
    for (const { tree, metrics: tiles } of metrics) {
      /** Every grid of that same tree. */
      const grids = nodesOf(tree).filter((node) => node.type === "grid")
      for (const tile of tiles) expect(grids.some((gridNode) => nodesOf(gridNode.children).includes(tile))).toBe(true)
    }
  })

  test("the empty state is designed copy, never a blank tab", () => {
    /** A workbench with nothing parked and no team. */
    const bare: PanelSnapshot = { team: null, plan: null, question: null, readyTasks: [], counts: { ready: 0, active: 0, done: 0, total: 0, completion: 0, members: 0 }, alert: null, workmates: [], memory: null }
    /** The v2 tree of that empty workbench. */
    const view = buildMpdView(bare, V2_CAPS)
    expect(lintDesign(view, { version: 2 })).toEqual([])
    /** Every empty state in the tree. */
    const empties = nodesOf(view).filter((node) => node.type === "emptyState")
    expect(empties.length).toBeGreaterThanOrEqual(2)
    for (const node of empties) {
      expect(String(node.title).length).toBeGreaterThan(0)
      expect(String(node.message).length).toBeGreaterThan(0)
    }
  })

  test("the v1 fallback stays legal, keeps every metric's label AND value, and fits the budget", () => {
    /** The fallback an older app renders. */
    const view = buildMpdView(snapshotWithEverything(), V1_CAPS)
    expect(view.v).toBe(1)
    expect(lintDesign(view, { version: 1 })).toEqual([])
    expect(fitsBudget(view, "panel")).toBe(true)
    /** The fallback flattened into words, so a metric that survived can be found. */
    const flat = JSON.stringify(view)
    // The workbench hero carries TWO tiles after the phone-width repair; the completion bar and the
    // caption keep the other numbers readable, so those are what the fallback must still show.
    for (const [label, value] of [["Ready", "counts.ready"], ["Active", "counts.active"], ["Completion", "counts.completion"]] as const) {
      expect(flat).toContain(label)
      expect(flat).toContain(value)
    }
  })
})

describe("the team panel's v2 design", () => {
  test("lintDesign is clean in both versions and the tree fits the panel budget", () => {
    /** The v2 tree. */
    const v2 = buildTeamView(teamSnapshot(), V2_CAPS)
    expect(lintDesign(v2, { version: 2 })).toEqual([])
    expect(fitsBudget(v2, "panel")).toBe(true)
    /** The v1 fallback. */
    const v1 = buildTeamView(teamSnapshot(), V1_CAPS)
    expect(v1.v).toBe(1)
    expect(lintDesign(v1, { version: 1 })).toEqual([])
    expect(fitsBudget(v1, "panel")).toBe(true)
  })

  test("THREE tabs, one hero each, and a tappable board row carrying `select` + its task id", () => {
    /** The v2 tree. */
    const view = buildTeamView(teamSnapshot(), V2_CAPS)
    expect(tabSections(view)).toHaveLength(3)
    /** Every list row that carries an action. */
    const rows = nodesOf(view).filter((node) => node.type === "list").flatMap((node) => (Array.isArray(node.items) ? node.items as Array<Record<string, unknown>> : []))
    /** The board rows: the ones whose action selects a task. */
    const tappable = rows.filter((row) => (row.action as { id?: string } | undefined)?.id === "select")
    expect(tappable.length).toBeGreaterThan(0)
    expect((tappable[0]?.action as { args?: { task?: string } }).args?.task).toBe("T1")
  })

  test("board rows are DENSE: a short trailing word and an owner-only subtitle (repair T12)", () => {
    /** The v2 tree. */
    const view = buildTeamView(teamSnapshot(), V2_CAPS)
    /** Every board row: the list rows whose action selects a task. */
    const rows = nodesOf(view)
      .filter((node) => node.type === "list")
      .flatMap((node) => (Array.isArray(node.items) ? node.items as Array<Record<string, unknown>> : []))
      .filter((row) => (row.action as { id?: string } | undefined)?.id === "select")
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      // The trailing column competes with the subject for the same pixels at phone width.
      expect(String(row.trailing).length).toBeLessThanOrEqual(8)
      // owner, plus the blocker count when there is one — never the kind, which the Detail tab carries.
      expect(String(row.subtitle).split(" · ").length).toBeLessThanOrEqual(2)
    }
    // The machine status words are spelled short for the row.
    expect(rows.map((row) => row.trailing)).toContain("active")
  })

  test("member rows are ONE line each: initials+name as the title, the state WORD as trailing (repair T19)", () => {
    /** The v2 tree. */
    const view = buildTeamView(teamSnapshot(), V2_CAPS)
    /** Every roster row: a list item whose title carries the initials separator. */
    const rows = nodesOf(view)
      .filter((node) => node.type === "list")
      .flatMap((node) => (Array.isArray(node.items) ? node.items as Array<Record<string, unknown>> : []))
      .filter((row) => String(row.title).includes(" · ") && row.action === undefined)
    expect(rows.length).toBeGreaterThan(0)
    // ONE line: the item carries a title and a trailing word and NO subtitle (a subtitle is a second
    // line), and it is a list item — never a `row` of badge + stack + badge, which the app lays out one
    // child per line at phone width (minimum widths: badge/text 160, nested layout 200).
    for (const row of rows) {
      expect(row.subtitle).toBeUndefined()
      expect(String(row.trailing).length).toBeGreaterThan(0)
    }
    expect(rows.map((row) => row.title)).toContain("DW · Deep Worker")
    expect(rows.map((row) => row.trailing)).toContain("handoff ready")
    // No member is drawn as a horizontal `row` any more.
    expect(nodesOf(view).filter((node) => node.type === "row")).toHaveLength(0)
  })

  test("an empty team renders the designed empty state instead of an empty board", () => {
    /** A team snapshot with no team at all. */
    const bare: TeamPanelSnapshot = { team: null, tasks: [], counts: { total: 0, done: 0, active: 0, blocked: 0, completion: 0 }, members: [], selected: null, watchdog: { predicate: "unknown", held: false, reason: "", taskId: "", incidents: [] } }
    /** The v2 tree of that empty team. */
    const view = buildTeamView(bare, V2_CAPS)
    expect(lintDesign(view, { version: 2 })).toEqual([])
    expect(nodesOf(view).some((node) => node.type === "emptyState")).toBe(true)
  })
})

describe("adaptView is the fallback the panels rely on", () => {
  test("the fallback carries no v2 component, no style and no accent", () => {
    /** The v2 tree. */
    const v2 = buildMpdView(snapshotWithEverything(), V2_CAPS)
    /** Its downgrade. */
    const v1 = adaptView(v2, V1_CAPS)
    expect(JSON.stringify(v1)).not.toContain('"style"')
    expect(JSON.stringify(v1)).not.toContain('"accent"')
    for (const node of nodesOf(v1)) expect(["tabs", "grid", "badge", "avatar", "timeline", "emptyState", "form", "textField"]).not.toContain(node.type)
  })
})

describe("the strip", () => {
  test("one short line per language, inside the app's 24-character ceiling", () => {
    /** The English line. */
    const en = stripLine(3, 1, false, false, false)
    /** The Chinese line. */
    const zh = stripLine(3, 1, false, false, true)
    expect(en.text).toBe("3 ready · 1 active")
    expect(zh.text).toBe("3 就绪 · 1 进行")
    expect(en.text.length).toBeLessThanOrEqual(24)
    expect(zh.text.length).toBeLessThanOrEqual(24)
    expect(en.tone).toBe("info")
  })

  test("a parked question marks the line and a waiting plan warns", () => {
    expect(stripLine(0, 0, true, false, false).text.startsWith("❓")).toBe(true)
    expect(stripLine(0, 0, false, true, false).tone).toBe("warn")
  })
})

describe("the menu handlers", () => {
  test("the reply text is read from the event's own spellings", () => {
    expect(replyTextOf({ text: "hello" })).toBe("hello")
    expect(replyTextOf({ value: { text: "hi" } })).toBe("hi")
    expect(replyTextOf({ message: { text: "yo" } })).toBe("yo")
    expect(replyTextOf({})).toBe("")
  })

  test("copy answers the app's copy effect and never throws on an empty reply", async () => {
    /** The action map over an unreachable bridge: every handler must answer, not throw. */
    const actions = createSurfaceActions({ dsh: { dshGoPresent: () => true, dshGoPanel: () => false, dshGoRefresh: () => {}, onServiceBound: () => () => {} }, ctx: {} })
    expect(await actions["mpd-copy-reply"]?.({ sessionId: "s1" }, { text: "the reply" })).toEqual({ copy: "the reply" })
    expect(await actions["mpd-copy-reply"]?.({ sessionId: "s1" }, {})).toEqual({ toast: "Nothing to copy" })
  })

  test("save-memory writes ONE entry through the memory tool, description first line", async () => {
    /** Every tool call the fake runtime saw. */
    const calls: Array<{ name: string; arguments?: unknown }> = []
    /** The action map over a fake tool runtime. */
    const actions = createSurfaceActions({
      dsh: { dshGoPresent: () => true, dshGoPanel: () => false, dshGoRefresh: () => {}, onServiceBound: () => () => {}, executeTool: async (input: { name: string; arguments?: unknown }) => { calls.push(input); return { ok: true } } },
      ctx: {},
    })
    /** The reply the action was invoked on. */
    const reply = "first line here\nsecond line"
    expect(await actions["mpd-save-memory"]?.({ sessionId: "s1" }, { text: reply })).toEqual({ toast: "Saved to memory" })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.name).toBe("mpd_memory_write")
    expect((calls[0]?.arguments as { description?: string }).description).toBe("first line here")
    expect((calls[0]?.arguments as { content?: string }).content).toBe(reply)
  })

  test("dispatch answers a toast when the service is absent, never a throw", async () => {
    /** The action map with no services mounted. */
    const actions = createSurfaceActions({ dsh: { dshGoPresent: () => true, dshGoPanel: () => false, dshGoRefresh: () => {}, onServiceBound: () => () => {} }, ctx: {} })
    expect(await actions["mpd-dispatch"]?.({ sessionId: "s1" }, {})).toEqual({ toast: "Unavailable here" })
    expect(await actions["mpd-dispatch"]?.({}, {})).toEqual({ toast: "Open a conversation first" })
  })
})

describe("countViewNodes agrees with the kit's own measure", () => {
  test("a built tree counts what measureView reports", () => {
    /** The v2 tree. */
    const view = buildMpdView(snapshotWithEverything(), V2_CAPS)
    expect(countViewNodes(view)).toBe(measureView(view).nodes)
  })
})

describe("the memory reader honours the row's addressing (repair T8/M2+N1+N2)", () => {
  /** One entry file's body: JSON frontmatter plus a markdown body. */
  const entry = (description: string, kind: string): string => `---\n${JSON.stringify({ description, kind })}\n---\nbody\n`

  test("memory.dir moves the store, and another agent's entries never leak in", () => {
    /** A throwaway workspace. */
    const root = mkdtempSync(join(tmpdir(), "mpd-memory-scope-"))
    try {
      /** The slug the workspace derives (its own directory name). */
      const slug = memorySlugOf(root)
      /** A second agent's slug, which the reader must NOT walk. */
      const other = "agent-someone-else"
      for (const [dir, owner] of [["custom-state", slug], [".mpd", slug], ["custom-state", other]] as const) {
        /** That agent's memory directory. */
        const memoryDir = join(root, dir, "memory", "agents", owner, "repo", "memory")
        mkdirSync(memoryDir, { recursive: true })
        writeFileSync(join(memoryDir, "a.md"), entry(owner === slug ? "mine" : "theirs", "note"))
      }
      // The DEFAULT state dir is `.mdp`'s sibling `.mpd`: only the file written there is visible.
      expect(readMemoryStore(root, Date.now())?.entries.map((one) => one.description)).toEqual(["mine"])
      // With the row's `memory.dir`, the OTHER directory is read instead and `.mpd` is ignored.
      expect(readMemoryStore(root, Date.now(), { dir: "custom-state" })?.entries.map((one) => one.description)).toEqual(["mine"])
      // An explicit agent slug selects that agent, and the sibling directory stays out of reach.
      expect(readMemoryStore(root, Date.now(), { dir: "custom-state", agentSlug: other })?.entries.map((one) => one.description)).toEqual(["theirs"])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("the legacy reflection keys are read, never written", () => {
    /** A throwaway workspace. */
    const root = mkdtempSync(join(tmpdir(), "mpd-memory-legacy-"))
    try {
      /** The workspace's derived slug. */
      const slug = memorySlugOf(root)
      /** The agent's state root. */
      const agentRoot = join(root, ".mpd", "memory", "agents", slug)
      mkdirSync(join(agentRoot, "repo", "memory"), { recursive: true })
      mkdirSync(join(agentRoot, "runtime"), { recursive: true })
      writeFileSync(join(agentRoot, "repo", "memory", "a.md"), entry("legacy", "fact"))
      writeFileSync(join(agentRoot, "runtime", "reflection.json"), JSON.stringify({ reflected_completed_steps: 4, steps_since_last_successful_reflection: 2 }))
      /** The snapshot the panel would render. */
      const memory = readMemoryStore(root, Date.now())
      expect(memory?.reflections).toBe(4)
      expect(memory?.steps).toBe(2)
      // The CURRENT names win when both exist.
      writeFileSync(join(agentRoot, "runtime", "reflection.json"), JSON.stringify({ reflectionsCompleted: 7, stepsSinceReflection: 1 }))
      expect(readMemoryStore(root, Date.now())?.reflections).toBe(7)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("the team panel offers only the controls it can address (repair T8/H1+M3)", () => {
  test("the detail and watchdog tabs carry no settle/hold control, and the action map has no mutation", () => {
    /** The v2 tree built from the populated team snapshot. */
    const view = buildTeamView(teamSnapshot(), V2_CAPS)
    /** Every action id the tree names. */
    const ids = buttonsOf(view).map((button) => (typeof button.action === "string" ? button.action : (button.action as { id?: string }).id))
    expect(ids).not.toContain("complete")
    expect(ids).not.toContain("fail")
    expect(ids).not.toContain("hold")
    expect(ids).not.toContain("resume")
    expect(lintDesign(view, { version: 2 })).toEqual([])
  })
})
