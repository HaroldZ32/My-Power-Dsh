// The routing decision, driven without a harness, a ctx or a model: which member a teammate label
// names, and how a resolved route is applied. The slot RESOLUTION itself lives in the config row now
// (contract `.mpd/plans/slot-single-source.md` §6: the slot is the only source), so the arms that
// pinned the deleted precedence chain are gone; `slot-route.test.ts` covers the provider end to end.
import { describe, expect, test } from "bun:test"
import { applyRoute, labelOf, memberFromLabel } from "../src/route"
import type { RoutableRequest } from "../src/route"
import { TEAM_MODEL_SLOT_GROUPS } from "../../mpd-config-plugin/src/settings-schema"

// Every roster name the label matcher may return, flattened out of the four slot groups: this is the
// vocabulary a teammate description has to name to be routed at all.
const NAMES: readonly string[] = Object.values(TEAM_MODEL_SLOT_GROUPS).flatMap((group) => [...group.members])

describe("reading the member out of the descriptor label", () => {
  test("a description that NAMES a member routes it, before any separator", () => {
    expect(memberFromLabel("Senior Engineer — implements the parser", NAMES)).toBe("Senior Engineer")
    expect(memberFromLabel("Architect: module boundaries", NAMES)).toBe("Architect")
    expect(memberFromLabel("Plan Reviewer | read the plan", NAMES)).toBe("Plan Reviewer")
    expect(memberFromLabel("Vision Analyst - read the screenshots", NAMES)).toBe("Vision Analyst")
  })

  test("a name with no separator still matches", () => {
    expect(memberFromLabel("Architect", NAMES)).toBe("Architect")
    expect(memberFromLabel("  architect  ", NAMES)).toBe("Architect")
  })

  test("a description that names NO member routes nothing — a wrong guess moves a teammate onto a model nobody chose", () => {
    expect(memberFromLabel("check the vendored corpus", NAMES)).toBeUndefined()
    expect(memberFromLabel("rewrite the docs", NAMES)).toBeUndefined()
    expect(memberFromLabel(undefined, NAMES)).toBeUndefined()
    expect(memberFromLabel("", NAMES)).toBeUndefined()
    expect(memberFromLabel("the Senior Engineer report", NAMES)).toBeUndefined()
  })

  test("the LONGEST name wins, so a prefix cannot steal the match", () => {
    // The roster vocabulary plus the shorter "Reviewer", so a prefix match would be observable here.
    const extended = [...NAMES, "Reviewer"]
    expect(memberFromLabel("Plan Reviewer — read it", extended)).toBe("Plan Reviewer")
  })
})

describe("applying a route to a request", () => {
  // The request double: the Lead's own route, the descriptor the router reads the member from, and
  // one unrelated field the merge has to carry through. `agentOptions` is typed as the open record
  // the package declares rather than as this literal's own shape, so the arms below assert the MERGE.
  const request: RoutableRequest & { agentOptions: Record<string, unknown> } = {
    agentOptions: { provider: "lead-provider", model: "lead-model", reasoningEffort: "low", maxDepth: 3 },
    descriptor: { label: "Architect — module boundaries" },
    unrelated: "kept",
  }

  test("the route replaces the three route fields and NOTHING else", () => {
    // The routed copy: the three route fields come from the slot, every other field stays the Lead's.
    const routed = applyRoute(request, { provider: "deepseek-official", model: "deepseek-v4-pro", reasoningEffort: "max" })
    expect(routed.agentOptions).toEqual({ provider: "deepseek-official", model: "deepseek-v4-pro", reasoningEffort: "max", maxDepth: 3 })
    expect(routed.unrelated).toBe("kept")
    expect(routed.descriptor).toEqual(request.descriptor)
    expect(request.agentOptions.provider).toBe("lead-provider")
  })

  test("no route means the request is returned BY IDENTITY — inheritance is visibly inheritance", () => {
    expect(applyRoute(request, undefined)).toBe(request)
  })

  test("a route with no effort CLEARS an inherited one instead of leaving it behind", () => {
    // An effort-less route over a Lead route that HAS one: the inherited effort must be gone.
    const routed = applyRoute(request, { provider: "p", model: "m" })
    expect(routed.agentOptions).toEqual({ provider: "p", model: "m", maxDepth: 3 })
  })

  test("a request with no agentOptions at all is still routable", () => {
    // The explicit type argument pins the literal to the package's own request contract, which is what
    // makes `agentOptions` a property of the result the assertion below can read; the inference would
    // otherwise be the literal's own shape, which has none.
    const routed = applyRoute<RoutableRequest>({ descriptor: { label: "Architect" } }, { provider: "p", model: "m", reasoningEffort: "high" })
    expect(routed.agentOptions).toEqual({ provider: "p", model: "m", reasoningEffort: "high" })
  })

  test("the label is read from the descriptor first, then the request's own field", () => {
    expect(labelOf({ descriptor: { label: "from descriptor" }, label: "from request" })).toBe("from descriptor")
    expect(labelOf({ label: "from request" })).toBe("from request")
    expect(labelOf({})).toBeUndefined()
  })
})
