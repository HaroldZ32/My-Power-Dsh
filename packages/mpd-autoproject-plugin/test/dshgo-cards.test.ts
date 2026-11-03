// Unit arms for the dsh-Go TOOL CARD the boulder status tool publishes (wave contract §4 D6).
//
// Each arm asserts the SHIPPED wiring, not a copy: the `presentationMeta` const tested here is the very
// object the tool definition carries, and the mount arm below proves the definition really carries it.
// The measured bytes / nodes / depth are printed so the card's budget headroom is evidence on disk
// rather than a claim, and every tree is run through `lintDesign` in the v1 (static-fallback) mode
// because a tool card is drawn by older apps too.
import { describe, expect, test } from "bun:test"
import { BUDGETS, lintDesign, measureView, toolCard, VIEW_KEY, type DshGoView } from "../../mpd-dsh-adapter-plugin/src/dshgo-view"
import { applyBoulder } from "../src/boulder/index.ts"
import { BOULDER_STATUS_CARD, buildBoulderStatusCard } from "../src/boulder/dshgo-cards.ts"

/** One card's `presentationMeta`, as the tool definition carries it. */
type CardMeta = (args: unknown, value: unknown) => Record<string, unknown>

/** One tool definition as the stub registry keeps it. */
type RegisteredTool = {
  /** The tool name the model calls. */
  name: string
  /** The output contract the row declared, which is where a card lives. */
  output?: { presentationMeta?: unknown }
}

/**
 * Assert one card is a function-produced `dsh-go/view` inside the tool-card budget and lint-clean.
 *
 * @param name - the card's label, for the report and a failure message.
 * @param meta - the `presentationMeta` function under test.
 * @param value - a representative tool value.
 * @returns the built view, so an arm can assert its content too.
 */
function expectCard(name: string, meta: CardMeta, value: unknown): DshGoView {
  expect(typeof meta).toBe("function")
  /** What the app receives for this tool result. */
  const out = meta({}, value)
  expect(out[VIEW_KEY]).toBeDefined()
  /** The view tree the app draws. */
  const view = out[VIEW_KEY] as DshGoView
  /** The app's own three measurements. */
  const measured = measureView(view)
  console.log(name + " bytes=" + measured.bytes + " nodes=" + measured.nodes + " depth=" + measured.depth)
  expect(measured.bytes).toBeLessThanOrEqual(BUDGETS.toolCard.bytes)
  expect(measured.nodes).toBeLessThanOrEqual(BUDGETS.toolCard.nodes)
  expect(measured.depth).toBeLessThanOrEqual(BUDGETS.toolCard.depth)
  expect(lintDesign(view, { version: 1 })).toEqual([])
  return view
}

/** A ledger value shaped the way `mpd_boulder_status` answers it. */
const STATUS_VALUE = {
  stateFile: "/tmp/ws/.mpd/boulder.json",
  activeWorks: [{ work_id: "w1", plan_name: "dshgo-native-parity", plan_path: ".mpd/plans/dshgo-native-parity.md", status: "active", started_at: "2026-11-03T00:00:00.000Z", updated_at: "2026-11-03T00:10:00.000Z", session_ids: ["dsh:1"] }],
  resumeOptions: [{ work_id: "w1", plan_name: "dshgo-native-parity", status: "active", progress: { total: 10, completed: 3, isComplete: false }, is_current_mirror: true }],
  state: { active_work_id: "w1", status: "active" },
}

describe("boulder tool cards", () => {
  test("mpd_boulder_status card is a v1 view inside the tool-card budget", () => {
    /** The card of a workspace with one active work. */
    const view = expectCard("boulder-status", BOULDER_STATUS_CARD, STATUS_VALUE)
    expect(JSON.stringify(view)).toContain("dshgo-native-parity")
    expect(JSON.stringify(view)).toContain("3/10")
  })

  test("a workspace with no ledger renders a designed card rather than throwing", () => {
    /** The card of a workspace that never started a work. */
    const view = expectCard("boulder-status-empty", BOULDER_STATUS_CARD, { stateFile: "/tmp/ws/.mpd/boulder.json", activeWorks: [], resumeOptions: [] })
    expect(JSON.stringify(view)).toContain("No active boulder work")
  })

  test("an unreadable plan is reported instead of a zero progress bar", () => {
    /** The card of a status call that named a plan it could not read. */
    const view = expectCard("boulder-status-plan-error", BOULDER_STATUS_CARD, { ...STATUS_VALUE, planProgress: { error: "plan file is missing" } })
    expect(JSON.stringify(view)).toContain("plan unreadable")
  })

  test("a throwing builder degrades to {} so the app falls back to its generic row", () => {
    /** The meta of a builder that cannot complete; `toolCard` must catch, never throw. */
    const failing = toolCard(() => { throw new Error("boom") })
    expect(failing({}, {})).toEqual({})
  })

  test("the registered definition carries exactly this card function", () => {
    /** Every definition the boulder row registered in the stub composition. */
    const tools: RegisteredTool[] = []
    applyBoulder({ tools: { register: (definition: RegisteredTool) => { tools.push(definition) } } } as never, {})
    expect(tools.find((tool) => tool.name === "mpd_boulder_status")?.output?.presentationMeta).toBe(BOULDER_STATUS_CARD)
  })

  test("the pure builder stays usable without the toolCard wrapper", () => {
    /** The raw tree, which the budget arms above already linted. */
    expect(buildBoulderStatusCard({}, STATUS_VALUE).type).toBe("stack")
  })
})
