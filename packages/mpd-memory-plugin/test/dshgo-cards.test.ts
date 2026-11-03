// Unit arms for the dsh-Go TOOL CARDS the memory row publishes (wave contract §4 D6).
//
// Each arm asserts the SHIPPED wiring, not a copy: the `presentationMeta` const tested here is the very
// object the tool definition carries, and the mount arm below proves the definition really carries it.
// The measured bytes / nodes / depth are printed so the card's budget headroom is evidence on disk
// rather than a claim, and every tree is run through `lintDesign` in the v1 (static-fallback) mode
// because a tool card is drawn by older apps too.
import { afterEach, describe, expect, test } from "bun:test"
import { BUDGETS, lintDesign, measureView, toolCard, VIEW_KEY, type DshGoView } from "../../mpd-dsh-adapter-plugin/src/dshgo-view"
import type { DshToolDef } from "../../mpd-dsh-adapter-plugin/src/index.ts"
import { buildMemoryReadCard, buildMemoryStatusCard, buildMemoryWriteCard, MEMORY_READ_CARD, MEMORY_STATUS_CARD, MEMORY_WRITE_CARD } from "../src/dshgo-cards.ts"
import { enterSandboxHome, mount, sandbox, type MountedPlugin } from "./support.ts"

/** One card's `presentationMeta`, as the tool definition carries it. */
type CardMeta = (args: unknown, value: unknown) => Record<string, unknown>

/** The mounted row of an arm, restored when the arm ends. */
let mounted: MountedPlugin | undefined

/** The cleanup an arm registered for its sandboxed HOME. */
let restoreHome: (() => void) | undefined

afterEach(() => {
  mounted?.dispose()
  mounted?.restore()
  mounted = undefined
  restoreHome?.()
  restoreHome = undefined
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

describe("memory tool cards", () => {
  test("mpd_memory_write card is a v1 view inside the tool-card budget", () => {
    /** The card the write tool publishes. */
    const view = expectCard("memory-write", MEMORY_WRITE_CARD, {
      file: "/tmp/ws/.mpd/memory/hello-world-abc.md",
      committedTo: ["git"],
      reflectionDue: true,
      vcs: "git",
      errors: [],
      scope: "workspace",
    })
    expect(JSON.stringify(view)).toContain("Reflection")
  })

  test("a failed commit is visible as a warning callout, not a silent success", () => {
    /** The card of a write whose backend failed to commit. */
    const view = expectCard("memory-write-error", MEMORY_WRITE_CARD, {
      file: "/tmp/ws/.mpd/memory/x.md",
      committedTo: [],
      reflectionDue: false,
      vcs: "git",
      errors: ["git: nothing to commit"],
      scope: "workspace",
    })
    expect(JSON.stringify(view)).toContain("commit failed")
  })

  test("mpd_memory_read card is a v1 view inside the tool-card budget", () => {
    /** The card the read tool publishes. */
    const view = expectCard("memory-read", MEMORY_READ_CARD, {
      entries: [{ kind: "fact", description: "the build pins bun 1.4.0", content: "…" }],
      count: 1,
      offset: 0,
      returned: 1,
      next_offset: null,
      scope: "workspace",
    })
    expect(JSON.stringify(view)).toContain("the build pins bun 1.4.0")
  })

  test("mpd_memory_status card is a v1 view inside the tool-card budget", () => {
    /** The card the status tool publishes. */
    const view = expectCard("memory-status", MEMORY_STATUS_CARD, {
      vcs: "git",
      root: "/tmp/ws/.mpd",
      entries: 12,
      journalLines: 40,
      reflection: { reflectionsCompleted: 3, stepsSinceReflection: 2, triggered: false },
      scope: "workspace",
    })
    expect(JSON.stringify(view)).toContain("Memory status")
  })

  test("an empty page renders a designed card rather than throwing", () => {
    /** The card of a read that matched nothing. */
    const view = expectCard("memory-read-empty", MEMORY_READ_CARD, { entries: [], count: 0, offset: 0, returned: 0, next_offset: null })
    expect(JSON.stringify(view)).toContain("No memory entries matched.")
  })

  test("a throwing builder degrades to {} so the app falls back to its generic row", () => {
    /** The meta of a builder that cannot complete; `toolCard` must catch, never throw. */
    const failing = toolCard(() => { throw new Error("boom") })
    expect(failing({}, {})).toEqual({})
  })

  test("the registered definitions carry exactly these card functions", () => {
    /** The throwaway workspace the row resolves through `DSH_WORKSPACE_ROOT`. */
    const workspace = sandbox("mpd-memory-cards-")
    restoreHome = enterSandboxHome(sandbox("mpd-memory-cards-home-"))
    mounted = mount(workspace, { vcs: "git" })
    /** The three definitions under test, by the names the model calls. */
    const byName = (name: string): DshToolDef | undefined => mounted!.tools.find((tool) => tool.name === name)
    expect(byName("mpd_memory_write")?.output?.presentationMeta).toBe(MEMORY_WRITE_CARD)
    expect(byName("mpd_memory_read")?.output?.presentationMeta).toBe(MEMORY_READ_CARD)
    expect(byName("mpd_memory_status")?.output?.presentationMeta).toBe(MEMORY_STATUS_CARD)
  })

  test("the pure builders stay usable without the toolCard wrapper", () => {
    /** The raw trees, which the budget arms above already linted. */
    expect(buildMemoryWriteCard({}, {}).type).toBe("stack")
    expect(buildMemoryReadCard({}, {}).type).toBe("stack")
    expect(buildMemoryStatusCard({}, {}).type).toBe("stack")
  })
})
