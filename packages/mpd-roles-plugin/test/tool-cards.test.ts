// THE TOOL CARDS for the two roster tools, pinned where the app will draw them.
//
// Each arm runs the SAME pure builder the tool registration wraps, through `toolCard()` — so a tree
// that would be DROPPED by the real seam is dropped here too, and the arm fails instead of passing on
// a view the app never sees. Three things are asserted together: the card is legal v1 (`lintDesign`
// version 1, the static-fallback contract), it fits the toolCard budget, and it carries no binding
// and no action (a card has neither a data model nor an action channel). The measured
// bytes / nodes / depth are PRINTED per card, because that number is what the lane's report quotes.
import { describe, expect, test } from "bun:test"
import { apply } from "../src/index"
import { VIEW_KEY, fitsBudget, lintDesign, measureView, toolCard, type DshGoView } from "../../mpd-dsh-adapter-plugin/src/dshgo-view.ts"
import { roleSpawnCard, rolesListCard } from "../src/tool-cards.ts"

/** A card builder as `toolCard()` takes it: the tool's arguments and its value, in, one tree out. */
type Builder = (args: unknown, value: unknown) => DshGoView | null

/** What one arm collected from a registration: the name and the definition, output included. */
interface Captured {
  /** Registered tool definitions, in registration order. */
  tools: Array<{ name: string; output?: { presentationMeta?: unknown } }>
}

/** Apply the plugin with a recording context and return the tool definitions it registered. */
function capture(): Captured {
  /** The capture the recorder writes into. */
  const out: Captured = { tools: [] }
  /** A disposer-returning no-op, standing in for every seam these arms never exercise. */
  const noop = (): (() => void) => () => {}
  /** The adapter double: `registerTool` is recorded, everything else answers a no-op. */
  const dsh = new Proxy({} as Record<string | symbol, unknown>, {
    get: (_target, prop) => {
      if (prop === "registerTool") return (definition: Captured["tools"][number]) => { out.tools.push(definition); return () => {} }
      return noop
    },
  })
  /** The minimal cordis context `apply` needs: the adapter lookup plus the effect seam. */
  const ctx = {
    get: (name: string) => (name === "mpdDsh" ? dsh : undefined),
    on: noop,
    effect: (fn: () => unknown) => { try { return fn() ?? (() => {}) } catch { return () => {} } },
    provide: (name: string, value: unknown) => { if (name === "mpdRoles") void value },
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

describe("the roster tool cards", () => {
  test("mpd_roles_list draws the roster and any refused extension", () => {
    checkCard("roles.list", rolesListCard, {}, {
      roles: [
        { name: "Architect", description: "architecture review", readonly: true, provider: "deepseek", model: "deepseek-flash", extension: undefined },
        { name: "Junior Engineer", description: "small mechanical change", readonly: false, provider: "deepseek", model: "deepseek-flash", extension: undefined },
      ],
      count: 2,
      refused: [{ extension: "mpd-ext-example", name: "Ghost", reason: "declares no provider+model chain" }],
    })
  })

  test("mpd_role_spawn draws the report and its sections", () => {
    checkCard("roles.spawn", roleSpawnCard, { role: "Architect", task: "review the plan" }, {
      role: "Architect",
      status: "complete",
      summary: "The plan is executable; two references are stale.",
      recommendation: "Land the cards after the adapter rebuild.",
      details: "Rule 1: the builder is pure, so the unit test can call it.",
      evidence: ["packages/mpd-dsh-adapter-plugin/src/dshgo-view.ts", "packages/mpd-team-core-plugin/src/index.ts"],
      stopReason: "max-steps",
    })
  })

  test("a worst-case report still fits 8 KiB / 40 nodes / depth 6", () => {
    /** A field the model could really return at the schema's full width. */
    const huge = "y".repeat(4000)
    checkCard("roles.spawn.worst-case", roleSpawnCard, {}, {
      role: "Architect",
      status: "complete",
      summary: huge,
      recommendation: huge,
      details: huge,
      evidence: Array.from({ length: 30 }, () => huge),
      stopReason: huge,
    })
    checkCard("roles.list.worst-case", rolesListCard, {}, {
      roles: Array.from({ length: 40 }, (_, i) => ({ name: `Role ${i}`, description: huge, readonly: i % 2 === 0, provider: "deepseek", model: "deepseek-flash" })),
      count: 40,
      refused: Array.from({ length: 20 }, (_, i) => ({ extension: "ext", name: `X${i}`, reason: huge })),
    })
  })

  test("both registered roster tools carry a presentationMeta FUNCTION", () => {
    /** The registrations one `apply` produced. */
    const captured = capture()
    for (const name of ["mpd_roles_list", "mpd_role_spawn"]) {
      /** The registration carrying this tool's name. */
      const tool = captured.tools.find((entry) => entry.name === name)
      expect(tool).toBeDefined()
      expect(typeof tool?.output?.presentationMeta).toBe("function")
    }
  })
})
