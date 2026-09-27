// The routing decision, driven without a harness, a ctx or a model. The arms are the ones that
// decide whether a teammate lands on the model the user configured — including the two ways that
// could go silently wrong: matching a member the label never named, and half-configuring a slot.
import { describe, expect, test } from "bun:test"
import { applyRoute, labelOf, memberFromLabel, routeForMember } from "../src/route"
import { TEAM_MODEL_SLOT_GROUPS } from "../../mpd-config-plugin/src/settings-schema"

const NAMES = Object.values(TEAM_MODEL_SLOT_GROUPS).flatMap((group) => [...group.members])
const SLOTS = {
  slot1: { provider: "deepseek-official", model: "deepseek-v4-pro", reasoningEffort: "max" },
  slot2: { provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "high" },
  slot3: { provider: "gateway", model: "fast", reasoningEffort: "off" },
  slot4: { provider: "deepseek-official", model: "deepseek-v4-flash-vision-exp", reasoningEffort: "high" },
}

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
    const extended = [...NAMES, "Reviewer"]
    expect(memberFromLabel("Plan Reviewer — read it", extended)).toBe("Plan Reviewer")
  })
})

describe("resolving the slot route", () => {
  test("every roster member maps to a slot, and a complete slot resolves to its own route", () => {
    const members = Object.values(TEAM_MODEL_SLOT_GROUPS).flatMap((group) => [...group.members])
    expect(members).toHaveLength(11)
    for (const [slot, group] of Object.entries(TEAM_MODEL_SLOT_GROUPS)) {
      for (const member of group.members) {
        expect(routeForMember(member, slot, SLOTS)).toEqual(SLOTS[slot as keyof typeof SLOTS])
      }
    }
  })

  test("a member with NO slot inherits — the route is undefined, not a default", () => {
    expect(routeForMember("Nobody", undefined, SLOTS)).toBeUndefined()
  })

  test("an INCOMPLETE slot fails LOUDLY naming the member and the slot, never substituting", () => {
    expect(() => routeForMember("Architect", "slot1", { slot1: { provider: "p" } })).toThrow(/Architect is routed by slot1.*incomplete/)
    expect(() => routeForMember("Architect", "slot1", { slot1: { provider: "", model: "m" } })).toThrow(/provider=unset/)
    expect(() => routeForMember("Vision Analyst", "slot4", {})).toThrow(/no slot4 is configured/)
  })

  test("an effort the slot does not state is OMITTED, so the harness keeps its own resolution", () => {
    const route = routeForMember("Deep Worker", "slot3", { slot3: { provider: "p", model: "m" } })
    expect(route).toEqual({ provider: "p", model: "m" })
    expect("reasoningEffort" in (route ?? {})).toBe(false)
  })
})

describe("applying a route to a request", () => {
  const request = {
    agentOptions: { provider: "lead-provider", model: "lead-model", reasoningEffort: "low", maxDepth: 3 },
    descriptor: { label: "Architect — module boundaries" },
    unrelated: "kept",
  }

  test("the route replaces the three route fields and NOTHING else", () => {
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
    const routed = applyRoute(request, { provider: "p", model: "m" })
    expect(routed.agentOptions).toEqual({ provider: "p", model: "m", maxDepth: 3 })
  })

  test("a request with no agentOptions at all is still routable", () => {
    const routed = applyRoute({ descriptor: { label: "Architect" } }, { provider: "p", model: "m", reasoningEffort: "high" })
    expect(routed.agentOptions).toEqual({ provider: "p", model: "m", reasoningEffort: "high" })
  })

  test("the label is read from the descriptor first, then the request's own field", () => {
    expect(labelOf({ descriptor: { label: "from descriptor" }, label: "from request" })).toBe("from descriptor")
    expect(labelOf({ label: "from request" })).toBe("from request")
    expect(labelOf({})).toBeUndefined()
  })
})
