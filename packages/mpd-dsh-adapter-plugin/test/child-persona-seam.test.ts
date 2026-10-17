// THE CHILD-PERSONA SEAM (harness 0.2.1-rc.2): persona + read-only discipline for spawned children.
//
// WHAT THIS FILE PROVES. 0.2.1-rc.2 removed `persona` and `toolFilter` from the subagent start
// request, so a composition must restore both on the CHILD's own scoped context. The arms below
// pin the four things that can silently go wrong:
//   * the SECTION is exactly the host's slot — `deployment:persona-prefix`, order 0, and
//     `interpolate: false` (interpolation defaults ON and an unknown `{{…}}` reference THROWS on
//     every assembly, which would break the child's very first step);
//   * a child whose label names NOTHING still spawns: the seam must be a no-op, never a throw;
//   * the read-only deny lands on a read-only child and NOT on a normal one;
//   * the identity comes from the child's OWN label, so two children cannot cross personas.
import { describe, expect, test } from "bun:test"

import { createDshAdapter, installChildPersonaSeam, type DshPromptSection } from "../src/index"

/** One prompt section a fake child's scoped registry received. */
interface RecordedSection {
  /** The child agent that received it. */
  agent: unknown
  /** The section object, verbatim. */
  section: DshPromptSection
}

/** The doubles one arm drives. */
interface Harness {
  /** The installed seam, including the handler a test can drive directly. */
  seam: ReturnType<typeof installChildPersonaSeam>
  /** Every section any child's registry received. */
  sections: RecordedSection[]
  /** Every agent the read-only applier was handed. */
  restricted: unknown[]
  /** Every warning line the seam reported. */
  warned: string[]
  /** The live `agent/created` listeners, when the harness models an event bus. */
  listeners: Array<(...args: unknown[]) => unknown>
  /** Build one fake child: its own session, its own scoped section registry. */
  child: (id: string, label?: string) => { session: { id: string }; ctx: { systemPrompt: { section: (section: DshPromptSection) => () => void } } }
  /** Make the next `stateOf` read throw, to model a broken projection plane. */
  breakProjections: () => void
}

/**
 * Build the harness: a REAL adapter over a fake session-projection registry, plus recording doubles.
 * @param options - whether an event bus exists and whether section registration should throw.
 * @returns the harness an arm drives.
 */
function harness(options: { withOnEvent?: boolean; sectionsThrow?: boolean } = {}): Harness {
  /** Every section recorded, in order. */
  const sections: RecordedSection[] = []
  /** Every agent handed to the read-only applier. */
  const restricted: unknown[] = []
  /** Every warning line. */
  const warned: string[] = []
  /** The `agent/created` listeners this harness holds. */
  const listeners: Array<(...args: unknown[]) => unknown> = []
  /** Durable identity per child session, the shape `sessionProjections.stateOf` returns. */
  const identity = new Map<unknown, unknown>()
  /** Whether the next projection read should throw. */
  let projectionsThrow = false
  /** The projection registry double: FLAT `{mode, label?, seq}` or null, exactly as shipped. */
  const sessionProjections = {
    stateOf: (session: unknown, _key: string): unknown => {
      if (projectionsThrow) throw new Error("projection plane unavailable")
      return identity.get(session) ?? null
    },
  }
  /** The ctx the adapter reads services from. */
  const ctx = { get: (name: string): unknown => (name === "sessionProjections" ? sessionProjections : undefined) }
  /** A REAL adapter, so the label read and the section registration are the shipped ones. */
  const dsh = createDshAdapter(ctx as never)
  /** Build one fake child with its own scoped registry. */
  const child = (id: string, label?: string): { session: { id: string }; ctx: { systemPrompt: { section: (section: DshPromptSection) => () => void } } } => {
    /** The child's own session object, which is its identity carrier. */
    const session = { id }
    // A continuable child always carries a label; a one-shot child may OMIT it entirely — that is
    // the shipped union, and the "nobody" arm below depends on the omission being tolerated.
    identity.set(session, label === undefined ? { mode: "one-shot", seq: 1 } : { mode: "continuable", label, seq: 1 })
    /** One fake child agent: `ctx` is the scoped context carrier (`scopeContextOf` reads it). */
    const agent = {
      session,
      ctx: {
        systemPrompt: {
          /** Record the section and hand back a disposer, like the real registry. */
          section: (section: DshPromptSection): (() => void) => {
            if (options.sectionsThrow === true) throw new Error("duplicate section name")
            sections.push({ agent, section })
            return () => { /* scope owns teardown */ }
          },
        },
      },
    }
    return agent
  }
  /** The seam under test, over the real adapter and recording collaborators. */
  const seam = installChildPersonaSeam(dsh, {
    resolve: (label) => (label === "Junior Engineer"
      ? { persona: "small-change executor", readonly: false }
      : label === "Explorer"
        ? { persona: "read-only searcher", readonly: true }
        : null),
    restrictReadonly: (agent) => { restricted.push(agent) },
    warn: (line) => { warned.push(line) },
    onEvent: options.withOnEvent === false
      ? undefined
      : (event, handler) => {
        if (event !== "agent/created") throw new Error("unexpected event " + event)
        listeners.push(handler)
        return () => { /* bus owns teardown */ }
      },
  })
  return { seam, sections, restricted, warned, listeners, child, breakProjections: () => { projectionsThrow = true } }
}

describe("the persona section is the HOST's slot, with interpolation OFF", () => {
  test("a roster child receives deployment:persona-prefix at order 0, interpolate false", () => {
    /** A harness with an event bus. */
    const h = harness()
    /** The child the seam is driven for. */
    const child = h.child("child-1", "Junior Engineer")
    h.seam.handle({ agent: child })
    expect(h.sections.length).toBe(1)
    expect(h.sections[0].agent).toBe(child)
    // The EXACT section: the host's exported slot name and its allocated order, so this REPLACES
    // the deployment persona rather than appending a second one beside it.
    expect(h.sections[0].section).toEqual({
      name: "deployment:persona-prefix",
      order: 0,
      text: "small-change executor",
      // Load-bearing: an unknown `{{…}}` reference throws on EVERY assembly when interpolation is
      // left on, which would break the child's very first step.
      interpolate: false,
    })
    // A normal child is NOT restricted.
    expect(h.restricted).toEqual([])
    expect(h.warned).toEqual([])
  })

  test("the agent may arrive BARE as well as wrapped in {agent}", () => {
    /** A harness with an event bus. */
    const h = harness()
    /** The child the seam is driven for. */
    const child = h.child("child-1", "Junior Engineer")
    // `agent/created` carries `{agent}`; a build that hands the agent itself must not disable the
    // seam, so both shapes are accepted.
    h.seam.handle(child)
    expect(h.sections.length).toBe(1)
  })
})

describe("the read-only discipline lands on the child that needs it", () => {
  test("a read-only member is restricted, and a normal member is not", () => {
    /** A harness with an event bus. */
    const h = harness()
    /** A read-only member's child. */
    const readonlyChild = h.child("child-ro", "Explorer")
    /** A normal member's child. */
    const normalChild = h.child("child-rw", "Junior Engineer")
    h.seam.handle({ agent: readonlyChild })
    h.seam.handle({ agent: normalChild })
    // Exactly the read-only child got the deny, applied to the CHILD's scope.
    expect(h.restricted).toEqual([readonlyChild])
    expect(h.restricted.includes(normalChild)).toBe(false)
    // Both still received their persona section.
    expect(h.sections.map((entry) => entry.agent)).toEqual([readonlyChild, normalChild])
  })
})

describe("the seam is a FILTER: every foreign child is a clean no-op", () => {
  test("a label that names nothing registers NOTHING and does not throw", () => {
    /** A harness with an event bus. */
    const h = harness()
    /** A child whose label names no roster member. */
    const stranger = h.child("child-x", "workmate-alpha")
    expect(() => h.seam.handle({ agent: stranger })).not.toThrow()
    expect(h.sections).toEqual([])
    expect(h.restricted).toEqual([])
    // A foreign child is not a degradation, so it must not be reported as one.
    expect(h.warned).toEqual([])
  })

  test("a ONE-SHOT child with NO label still spawns untouched", () => {
    /** A harness with an event bus. */
    const h = harness()
    // The shipped identity union makes `label` optional on the one-shot arm, so `undefined` is a
    // legitimate answer and must not be mistaken for a roster member.
    const unlabelled = h.child("child-nobody")
    expect(() => h.seam.handle({ agent: unlabelled })).not.toThrow()
    expect(h.sections).toEqual([])
    expect(h.warned).toEqual([])
  })

  test("an agent with no session at all is a no-op", () => {
    /** A harness with an event bus. */
    const h = harness()
    expect(() => h.seam.handle({ agent: { ctx: {} } })).not.toThrow()
    expect(h.sections).toEqual([])
  })

  test("a THROWING projection plane is a miss, never a spawn failure", () => {
    /** A harness with an event bus. */
    const h = harness()
    h.breakProjections()
    /** A child whose identity cannot be read. */
    const child = h.child("child-1", "Junior Engineer")
    expect(() => h.seam.handle({ agent: child })).not.toThrow()
    expect(h.sections).toEqual([])
  })
})

describe("a failure is REPORTED, because a throw here fails the whole spawn", () => {
  test("a refusing scope warns once and lets the spawn continue", () => {
    /** A harness whose section registration throws, as a duplicate name does. */
    const h = harness({ sectionsThrow: true })
    /** A roster child whose scope refuses the section. */
    const child = h.child("child-1", "Junior Engineer")
    // `agents.register` rejects when a serial `agent/created` listener fails, so this must NOT
    // escape: the child keeps running with the deployment prompt instead of failing to exist.
    expect(() => h.seam.handle({ agent: child })).not.toThrow()
    expect(h.warned.length).toBe(1)
    expect(h.warned[0]).toContain("duplicate section name")
  })
})

describe("identity comes from the child, so concurrent spawns cannot cross personas", () => {
  test("two children with different labels are resolved independently", () => {
    /** A harness with an event bus. */
    const h = harness()
    /** Two children alive at the same time, each with its own label. */
    const junior = h.child("child-a", "Junior Engineer")
    /** The second child, whose label names the read-only member. */
    const explorer = h.child("child-b", "Explorer")
    h.seam.handle({ agent: junior })
    h.seam.handle({ agent: explorer })
    /** The persona text each child received, keyed by the agent itself. */
    const textByAgent = new Map(h.sections.map((entry) => [entry.agent, entry.section.text]))
    expect(textByAgent.get(junior)).toBe("small-change executor")
    expect(textByAgent.get(explorer)).toBe("read-only searcher")
    // The read-only deny went to the Explorer alone — no leakage across the two.
    expect(h.restricted).toEqual([explorer])
  })
})

describe("the subscription is optional and honest about it", () => {
  test("with an event bus the seam subscribes to agent/created", () => {
    /** A harness with an event bus. */
    const h = harness()
    expect(h.seam.installed).toBe(true)
    expect(h.listeners.length).toBe(1)
    /** A child raised through the BUS rather than the handler. */
    const child = h.child("child-1", "Junior Engineer")
    h.listeners[0]({ agent: child })
    expect(h.sections.length).toBe(1)
  })

  test("without an event bus it reports installed=false and still exposes the handler", () => {
    /** A harness with no event bus (a composition, or a mounted-adapter double). */
    const h = harness({ withOnEvent: false })
    expect(h.seam.installed).toBe(false)
    // The handler stays usable, so a caller can replay the seam for an agent created earlier.
    /** A roster child replayed directly. */
    const child = h.child("child-1", "Junior Engineer")
    h.seam.handle({ agent: child })
    expect(h.sections.length).toBe(1)
  })
})
