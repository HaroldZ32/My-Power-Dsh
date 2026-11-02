// Unit arms for the dsh-Go TOOL CARDS the workmate row publishes (wave contract §4 D6).
//
// Each arm asserts the SHIPPED wiring, not a copy: the `presentationMeta` const tested here is the very
// object the tool definition carries, and the mount arm below proves the definition really carries it.
// The measured bytes / nodes / depth are printed so the card's budget headroom is evidence on disk
// rather than a claim, and every tree is run through `lintDesign` in the v1 (static-fallback) mode
// because a tool card is drawn by older apps too.
import { describe, expect, test } from "bun:test"
import { BUDGETS, lintDesign, measureView, toolCard, VIEW_KEY, type DshGoView } from "../../mpd-dsh-adapter-plugin/src/dshgo-view"
import { apply } from "../src/index.ts"
import { buildWorkmateListCard, buildWorkmateMatchCard, WORKMATE_LIST_CARD, WORKMATE_MATCH_CARD } from "../src/dshgo-cards.ts"

/** One card's `presentationMeta`, as the tool definition carries it. */
type CardMeta = (args: unknown, value: unknown) => Record<string, unknown>

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

/** A library value shaped the way `mpd_workmate_list` answers it. */
const LIST_VALUE = {
  count: 2,
  workmates: [
    { name: "alpha", baseName: "Deep Worker", readonly: false, uses: 3, note: "implements verilog" },
    { name: "beta", baseName: "Reviewer", readonly: true, uses: 1, note: "reviews diffs" },
  ],
}

/** A match value shaped the way `mpd_workmate_match` answers it. */
const MATCH_VALUE = {
  matched: true,
  threshold: 0.35,
  matches: [{ name: "alpha", score: 0.72, baseName: "Deep Worker", uses: 3, note: "implements verilog" }],
  suggestion: 'Delegate to "alpha" (score 0.72).',
}

describe("workmate tool cards", () => {
  test("mpd_workmate_list card is a v1 view inside the tool-card budget", () => {
    /** The card the list tool publishes. */
    const view = expectCard("workmate-list", WORKMATE_LIST_CARD, LIST_VALUE)
    expect(JSON.stringify(view)).toContain("alpha")
    expect(JSON.stringify(view)).toContain("Workmates")
  })

  test("mpd_workmate_match card is a v1 view inside the tool-card budget", () => {
    /** The card the match tool publishes. */
    const view = expectCard("workmate-match", WORKMATE_MATCH_CARD, MATCH_VALUE)
    expect(JSON.stringify(view)).toContain("Matched")
  })

  test("an empty library still renders a designed card rather than throwing", () => {
    /** The card for a workspace whose library is empty. */
    const view = expectCard("workmate-list-empty", WORKMATE_LIST_CARD, { workmates: [], count: 0 })
    expect(JSON.stringify(view)).toContain("No workmates in the library.")
  })

  test("a throwing builder degrades to {} so the app falls back to its generic row", () => {
    /** The meta of a builder that cannot complete; `toolCard` must catch, never throw. */
    const failing = toolCard(() => { throw new Error("boom") })
    expect(failing({}, {})).toEqual({})
  })

  test("the registered definitions carry exactly these card functions", () => {
    /** Every tool definition the row registered through its private adapter. */
    const tools: Array<{ name: string; output?: { presentationMeta?: unknown } }> = []
    /** The minimal cordis context the row injects against; the roster service answers no bases. */
    const ctx = {
      get: (key: string) => (key === "mpdRoles" ? { list: () => [], get: () => null } : undefined),
      tools: { register: (definition: { name: string; output?: { presentationMeta?: unknown } }) => { tools.push(definition) } },
      subagents: { start: async () => ({ result: {} }) },
      provide: () => { /* service published, nothing to assert here */ },
    }
    apply(ctx as never)
    expect(tools.find((tool) => tool.name === "mpd_workmate_list")?.output?.presentationMeta).toBe(WORKMATE_LIST_CARD)
    expect(tools.find((tool) => tool.name === "mpd_workmate_match")?.output?.presentationMeta).toBe(WORKMATE_MATCH_CARD)
  })

  test("the pure builders stay usable without the toolCard wrapper", () => {
    /** The raw tree, which the budget arms above already linted. */
    const raw = buildWorkmateListCard({}, LIST_VALUE)
    expect(raw.type).toBe("stack")
    expect(buildWorkmateMatchCard({}, {})).toBeTruthy()
  })
})
