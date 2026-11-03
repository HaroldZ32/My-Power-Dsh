// Unit arms for the dsh-Go TOOL CARD the watchdog status tool publishes (wave contract §4 D6).
//
// Each arm asserts the SHIPPED wiring, not a copy: the `presentationMeta` const tested here is the very
// object the tool definition carries, and the mount arm below proves the definition really carries it.
// The measured bytes / nodes / depth are printed so the card's budget headroom is evidence on disk
// rather than a claim, and every tree is run through `lintDesign` in the v1 (static-fallback) mode
// because a tool card is drawn by older apps too.
import { afterEach, describe, expect, test } from "bun:test"
import { BUDGETS, lintDesign, measureView, toolCard, VIEW_KEY, type DshGoView } from "../../mpd-dsh-adapter-plugin/src/dshgo-view"
import { apply } from "../src/index.ts"
import { buildWatchdogStatusCard, WATCHDOG_STATUS_CARD } from "../src/dshgo-cards.ts"
import { pluginCtx, sandbox } from "./support.ts"

/** One card's `presentationMeta`, as the tool definition carries it. */
type CardMeta = (args: unknown, value: unknown) => Record<string, unknown>

/** The cleanup of the mounted row, run when the arm ends. */
let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
})

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

/** A status value shaped the way `session-watchdog-status` answers it. */
const STATUS_VALUE = {
  workspace: "/tmp/ws",
  predicate: { source: "channel", reason: "the session/event fold sees 3 sessions" },
  knobs: { readings: [], divergent: [], restartRequired: false, file: null, fileFound: false, fileApplied: false, liveLayer: "namespace" },
  paths: { heartbeat: "/tmp/ws/.mpd/watchdog/heartbeat", hold: "/tmp/ws/.mpd/watchdog/hold", incidents: "/tmp/ws/.mpd/watchdog/incidents.jsonl", watermark: "/tmp/ws/.mpd/watchdog/watermark.json" },
  teams: [{ teamId: "team-1", held: true, pause: { paused: true, mechanism: "watchdog-hold", implementation: "watchdog-hold" }, halt: { halted: false, haltedAt: null } }],
}

describe("watchdog tool cards", () => {
  test("session-watchdog-status card is a v1 view inside the tool-card budget", () => {
    /** The card of a workspace with one held team. */
    const view = expectCard("watchdog-status", WATCHDOG_STATUS_CARD, STATUS_VALUE)
    expect(JSON.stringify(view)).toContain("team-1")
    expect(JSON.stringify(view)).toContain("channel")
  })

  test("no teams renders a designed card rather than throwing", () => {
    /** The card of a workspace with no known team. */
    const view = expectCard("watchdog-status-empty", WATCHDOG_STATUS_CARD, { ...STATUS_VALUE, teams: [] })
    expect(JSON.stringify(view)).toContain("Watchdog status")
  })

  test("a pending config edit is visible as a warning callout", () => {
    /** The card of a store whose file layer waits for the next boot. */
    const view = expectCard("watchdog-status-restart", WATCHDOG_STATUS_CARD, {
      ...STATUS_VALUE,
      knobs: { ...STATUS_VALUE.knobs, restartRequired: true, file: "/tmp/ws/.mpd/mpd.jsonc", fileFound: true },
    })
    expect(JSON.stringify(view)).toContain("next dsh boot")
  })

  test("a throwing builder degrades to {} so the app falls back to its generic row", () => {
    /** The meta of a builder that cannot complete; `toolCard` must catch, never throw. */
    const failing = toolCard(() => { throw new Error("boom") })
    expect(failing({}, {})).toEqual({})
  })

  test("the registered definition carries exactly this card function", () => {
    /** The throwaway workspace the row resolves through its stub adapter. */
    const workspace = sandbox().workspace
    /** The plugin context plus the stub adapter the row registers its tools through. */
    const ctx = pluginCtx(workspace) as unknown as { __stub?: { tools: Map<string, { output?: { presentationMeta?: unknown } }> }; __dispose?: () => void }
    dispose = () => { ctx.__dispose?.() }
    apply(ctx as never)
    expect(ctx.__stub?.tools.get("session-watchdog-status")?.output?.presentationMeta).toBe(WATCHDOG_STATUS_CARD)
  })

  test("the pure builder stays usable without the toolCard wrapper", () => {
    /** The raw tree, which the budget arms above already linted. */
    expect(buildWatchdogStatusCard({}, STATUS_VALUE).type).toBe("stack")
  })
})
