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

/**
 * Build one `subagent/descriptor` event, the child's OWN identity record.
 *
 * The harness appends this in the factory's `setup` callback, which it AWAITS before publishing the
 * agent — which is why an `agent/created` listener can read it. `label: undefined` models the
 * ONE-SHOT arm, where the shipped descriptor may omit the label.
 * @param label - the delegation label to record, or `undefined` for an unlabelled child.
 * @returns the log event.
 */
function descriptor(label: string | undefined): unknown {
  return { type: "subagent/descriptor", data: label === undefined ? { mode: "one-shot" } : { mode: "continuable", label } }
}

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
function harness(options: { withOnEvent?: boolean; sectionsThrow?: boolean; noOwnLog?: boolean; noProjection?: boolean } = {}): Harness {
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
  const ctx = { get: (name: string): unknown => (name === "sessionProjections" && options.noProjection !== true ? sessionProjections : undefined) }
  /** A REAL adapter, so the label read and the section registration are the shipped ones. */
  const dsh = createDshAdapter(ctx as never)
  /** Build one fake child with its own scoped registry. */
  const child = (id: string, label?: string): { session: { id: string }; ctx: { systemPrompt: { section: (section: DshPromptSection) => () => void } } } => {
    /** The child's own session object, which is its identity carrier. */
    const session = { id, ownEvents: (): unknown[] => (options.noOwnLog === true ? [] : [descriptor(label)]) } as { id: string; ownEvents: () => unknown[] }
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
    resolve: (label) => {
      // A member with NO persona text at all, so the "empty persona registers nothing" arm is real.
      if (label === "Blank Member") return { persona: "   ", readonly: false }
      if (label === "Junior Engineer") return { persona: "small-change executor", readonly: false }
      if (label === "Explorer") return { persona: "read-only searcher", readonly: true }
      return null
    },
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

  test("an unreadable identity on EVERY channel is a miss, never a spawn failure", () => {
    // Both channels disabled: no own log (the primary read) and a throwing projection (the
    // fallback). An identity that cannot be established must leave the child alone, not fail it.
    /** A harness with an event bus and no readable identity channel. */
    const h = harness({ noOwnLog: true })
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

describe("the label is read from the CHILD'S OWN LOG — the live 0.2.1 failure mode", () => {
  test("an own-log descriptor resolves the label with NO projection service at all", () => {
    /** A harness with no projection plane — the composition the live boot effectively had. */
    const h = harness({ noProjection: true })
    /** A roster child carrying its descriptor in its own log. */
    const child = h.child("child-1", "Junior Engineer")
    h.seam.handle({ agent: child })
    // MEASURED DEFECT THIS PINS: the projection read returned nothing for a child that HAD a
    // descriptor, so the seam no-opped and BOTH the persona section and the read-only deny
    // silently vanished. The own-log read needs no service and is what makes this pass.
    expect(h.sections.length).toBe(1)
    expect(h.sections[0].section.text).toBe("small-change executor")
  })

  test("a read-only child is DENIED on the narrow seam with no projection service", () => {
    /** A harness with no projection plane. */
    const h = harness({ noProjection: true })
    /** The read-only member's child. */
    const explorer = h.child("child-ro", "Explorer")
    h.seam.handle({ agent: explorer })
    // The deny rides the SAME listener as the persona, so a failed identity read silently
    // disarms the read-only discipline too — the blocker this repair exists for.
    expect(h.restricted).toEqual([explorer])
  })

  test("an UNLABELLED first descriptor is a MISS, not a reason to keep scanning", () => {
    /** A harness whose projection WOULD answer — proving the own-log verdict wins. */
    const h = harness()
    // The subagent package states the FIRST descriptor is authoritative, so an unlabelled one must
    // not fall through to a later channel that could name a DIFFERENT member.
    const unlabelled = h.child("child-nobody")
    expect(() => h.seam.handle({ agent: unlabelled })).not.toThrow()
    expect(h.sections).toEqual([])
    expect(h.restricted).toEqual([])
  })

  test("a session that exposes NO log still resolves through the projection plane", () => {
    /** A harness whose children expose no own log, keeping the fallback path covered. */
    const h = harness({ noOwnLog: true })
    /** A roster child whose identity only the projection knows. */
    const child = h.child("child-1", "Junior Engineer")
    h.seam.handle({ agent: child })
    expect(h.sections.length).toBe(1)
    expect(h.sections[0].section.name).toBe("deployment:persona-prefix")
  })
})

describe("restrictAgentTools needs only tools.restrict — the member the harness itself uses", () => {
  test("a ctx WITHOUT on/effect is still restrictable, where agentScope reports no scope", () => {
    /** Every filter the scoped tools service received. */
    const applied: unknown[] = []
    /** A child whose ctx carries ONLY `tools.restrict` — no `on`, no `effect`. */
    const child = { ctx: { tools: { restrict: (filter: unknown) => { applied.push(filter); return () => { /* host owns it */ } } } } }
    /** A real adapter, so the seam under test is the shipped one. */
    const dsh = createDshAdapter({ get: () => undefined } as never)
    // MEASURED DEFECT THIS PINS: the read-only deny used to route through `agentScope`, which is an
    // all-or-nothing probe over `on` + `effect` + `tools.restrict`. A child missing either of the
    // first two reported NO scope, so the deny silently never applied and a READ-ONLY member kept
    // `write`/`edit`/`bash` in its first header. The harness's own `applyChildOverrides` reaches
    // for exactly this one member, and so does this seam.
    expect(dsh.agentScope(child)).toBeUndefined()
    expect(() => dsh.restrictAgentTools(child, { deny: ["write", "edit", "bash"] })).not.toThrow()
    expect(applied).toEqual([{ deny: ["write", "edit", "bash"] }])
  })

  test("a ctx with NO tools.restrict THROWS, because a dropped deny is a read-only member that writes", () => {
    /** A real adapter. */
    const dsh = createDshAdapter({ get: () => undefined } as never)
    expect(() => dsh.restrictAgentTools({ ctx: { tools: {} } }, { deny: ["write"] }))
      .toThrow(/exposes no tools\.restrict\(\)/)
  })
})

describe("ORDERING: a failing persona can never disarm the read-only discipline", () => {
  test("a THROWING section still leaves the read-only child RESTRICTED", () => {
    // THE DEFECT THIS LOCKS (CWE-284 class): while persona registration and the restriction shared
    // one try/catch, a throwing section skipped the restriction entirely — and the likeliest throw
    // is a SECOND `deployment:persona-prefix` registration on the same child scope, because the
    // roster seam and the workmate seam can both resolve one child. A read-only member then spawned
    // WRITABLE with only a warning on the log.
    /** A harness whose section registration throws, exactly as a duplicate slot does. */
    const h = harness({ sectionsThrow: true })
    /** A read-only member's child. */
    const explorer = h.child("child-ro", "Explorer")
    h.seam.handle({ agent: explorer })
    // The discipline survived the persona failure…
    expect(h.restricted).toEqual([explorer])
    // …and the failure is still reported rather than swallowed.
    expect(h.warned.some((line) => line.includes("did not receive its persona section"))).toBe(true)
  })

  test("an EMPTY or whitespace persona registers NOTHING, so it cannot collide on the slot", () => {
    /** A harness whose section registration throws — a collision here would be caused by us. */
    const h = harness({ sectionsThrow: true })
    /** A child whose resolved member contributes no persona text at all. */
    const child = h.child("child-blank", "Blank Member")
    h.seam.handle({ agent: child })
    // No registration was attempted, so the throwing registry was never touched.
    expect(h.sections).toEqual([])
    expect(h.warned).toEqual([])
  })
})

describe("RETAINED TOLERANT DENY: one dead entry must never deny nothing (CWE-284)", () => {
  /**
   * A fake child whose scoped `tools.restrict` behaves like the harness's own.
   *
   * WHY THIS FAKE EXISTS AND WHY THE OLD ARMS COULD NOT CATCH THE DEFECT: a live profile with every
   * toolchain installed resolves all eight names, so the whole list is accepted and the blind spot is
   * invisible. The harness validates the WHOLE list — `names unknown global tool(s) "…"; known global
   * tools: …` — so a profile without `cclsp` rejects all eight over the two `mcp__lsp__*` names and
   * the read-only member stays writable. Only a scope that does NOT know some names can show that.
   * @param known - the tool names this scope resolves; anything else is rejected as unknown.
   * @param failSecond - make the SECOND attempt fail with a non-unknown error.
   * @returns the agent, the per-call name lists, and whether any disposer was released.
   */
  function fakeScope(known: readonly string[], options: { failSecond?: boolean; rejectEverything?: boolean } = {}): {
    agent: unknown
    calls: string[][]
    released: boolean
  } {
    /** Every argument list `restrict` received, in order. */
    const calls: string[][] = []
    /** Whether a returned disposer was ever invoked — which would LIFT the restriction. */
    let released = false
    /** The fake child, carrying only the member the narrow seam needs. */
    const agent = {
      ctx: {
        tools: {
          /** Apply one deny list exactly as the harness validates it. */
          restrict: (filter: { deny?: readonly string[] }): (() => void) => {
            /** The names this call asked for. */
            const names = [...(filter.deny ?? [])]
            calls.push(names)
            if (options.failSecond === true && calls.length > 1) throw new Error("host is gone")
            /** The names this scope cannot resolve. */
            const unknown = options.rejectEverything === true ? names : names.filter((name) => !known.includes(name))
            if (unknown.length > 0) {
              // The harness's OWN message shape, which is what makes pruning possible at all.
              throw new Error(`tools.restrict() names unknown global tool${unknown.length > 1 ? "s" : ""} ${unknown.map((n) => `"${n}"`).join(", ")}; known global tools: ${[...known].sort().join(", ") || "(none)"}`)
            }
            return () => { released = true }
          },
        },
      },
    }
    return {
      agent,
      calls,
      /** Whether any returned disposer was invoked — which would LIFT the restriction. */
      get released(): boolean { return released },
    }
  }

  /** The canonical read-only deny the seams apply. */
  const DENY = ["write", "edit", "mpd_hashline_edit", "bash", "mcp__ast_grep__rewrite", "mcp__ast_grep__scan", "mcp__lsp__rename_symbol", "mcp__lsp__rename_symbol_strict"]
  /** Every name above EXCEPT the two cclsp LSP tools — the profile without `cclsp`. */
  const WITHOUT_LSP = DENY.filter((name) => !name.startsWith("mcp__lsp__"))
  /** A real adapter over an empty ctx: the seam under test is the shipped one. */
  const dsh = createDshAdapter({ get: () => undefined } as never)

  test("a scope that knows all eight applies all eight, in ONE call, and KEEPS the restriction", () => {
    /** A fully-tooled scope. */
    const scope = fakeScope(DENY)
    /** The applier's answer. */
    const outcome = dsh.restrictAgentToolsRetained(scope.agent, DENY)
    expect(outcome.applied).toEqual(DENY)
    expect(outcome.pruned).toEqual([])
    expect(scope.calls).toEqual([DENY])
    // RETAINED: the disposer is never called, so the deny outlives the call.
    expect(scope.released).toBe(false)
  })

  test("a scope WITHOUT cclsp prunes exactly the two LSP names, retries ONCE, and still denies write/edit/bash", () => {
    // THE DEFECT THIS LOCKS: without this retry the host rejects the WHOLE list over two dead
    // entries, the seam logs a failure nobody reads, and the "read-only" child keeps every write tool.
    /** The cclsp-less scope. */
    const scope = fakeScope(WITHOUT_LSP)
    /** The applier's answer. */
    const outcome = dsh.restrictAgentToolsRetained(scope.agent, DENY)
    // Exactly the two dead names were pruned…
    expect(outcome.pruned).toEqual(["mcp__lsp__rename_symbol", "mcp__lsp__rename_symbol_strict"])
    // …six survived, including everything that can write…
    expect(outcome.applied).toEqual(WITHOUT_LSP)
    expect(outcome.applied).toEqual(expect.arrayContaining(["write", "edit", "bash", "mpd_hashline_edit"]))
    // …and the retry happened EXACTLY once: rejected at eight, accepted at six.
    expect(scope.calls).toEqual([DENY, WITHOUT_LSP])
    expect(scope.released).toBe(false)
  })

  test("a NON-unknown rejection THROWS instead of passing quietly", () => {
    /** A scope that rejects a name no verdict can explain. */
    const scope = fakeScope(DENY, { rejectEverything: false })
    /** A scope whose restrict throws something unrelated. */
    const broken = { ctx: { tools: { restrict: (): (() => void) => { throw new Error("the host exploded") } } } }
    expect(() => dsh.restrictAgentToolsRetained(broken, DENY)).toThrow(/the host exploded/)
    // A healthy scope still succeeds, so the assertion above is about the failure, not the fake.
    expect(() => dsh.restrictAgentToolsRetained(scope.agent, DENY)).not.toThrow()
  })

  test("a REJECTED RETRY throws — pruning gets exactly one chance", () => {
    // The first attempt is PRUNABLE (the scope lacks cclsp) and the retry then fails for an unrelated
    // reason, so the applier must stop instead of looping or silently accepting nothing.
    /** A cclsp-less scope whose retry fails. */
    const scope = fakeScope(WITHOUT_LSP, { failSecond: true })
    expect(() => dsh.restrictAgentToolsRetained(scope.agent, DENY)).toThrow(/host is gone/)
    // Exactly two attempts: the prunable one and the fatal one — never a third.
    expect(scope.calls).toHaveLength(2)
    expect(scope.released).toBe(false)
  })

  test("PRUNING EVERYTHING is a failure, never a silent success", () => {
    /** A scope that knows none of the names. */
    const scope = fakeScope([], { rejectEverything: true })
    expect(() => dsh.restrictAgentToolsRetained(scope.agent, DENY)).toThrow(/every name in the read-only deny was rejected as unknown/)
    // A deny that would have denied nothing was never left standing.
    expect(scope.released).toBe(false)
  })
})

describe("THROUGH THE SEAM: a cclsp-less child is still restricted", () => {
  test("the seam's read-only branch prunes the dead names and the child ends up DENIED", () => {
    // The applier arms above test the mechanism; this one proves the SEAM routes a read-only child
    // through it. A seam-level double that merely records `restrictReadonly` cannot catch the
    // dead-entry defect, because it never validates a name.
    /** Every argument list the child's scoped restrict received. */
    const calls: string[][] = []
    /** The names a cclsp-less profile resolves. */
    const known = ["write", "edit", "mpd_hashline_edit", "bash", "mcp__ast_grep__rewrite", "mcp__ast_grep__scan"]
    /** A read-only child whose scope knows everything EXCEPT the two LSP names. */
    const child = {
      session: { id: "child-ro", ownEvents: (): unknown[] => [{ type: "subagent/descriptor", data: { mode: "continuable", label: "Explorer" } }] },
      ctx: {
        systemPrompt: { section: (): (() => void) => () => { /* scope owns it */ } },
        tools: {
          /** Validate exactly as the harness does: the WHOLE list fails on any unknown name. */
          restrict: (filter: { deny?: readonly string[] }): (() => void) => {
            /** The names this call asked for. */
            const names = [...(filter.deny ?? [])]
            calls.push(names)
            /** The unresolved names in this call. */
            const unknown = names.filter((name) => !known.includes(name))
            if (unknown.length > 0) throw new Error(`tools.restrict() names unknown global tool${unknown.length > 1 ? "s" : ""} ${unknown.map((n) => `"${n}"`).join(", ")}; known global tools: ${[...known].sort().join(", ")}`)
            return () => { /* retained by the scope */ }
          },
        },
      },
    }
    /** A REAL adapter, so the retained tolerant applier is the shipped one. */
    const dsh = createDshAdapter({ get: () => undefined } as never)
    /** The canonical deny the roles seam applies. */
    const DENY = ["write", "edit", "mpd_hashline_edit", "bash", "mcp__ast_grep__rewrite", "mcp__ast_grep__scan", "mcp__lsp__rename_symbol", "mcp__lsp__rename_symbol_strict"]
    /** The seam, with the read-only branch wired to the REAL applier. */
    const seam = installChildPersonaSeam(dsh, {
      resolve: () => ({ persona: "read-only searcher", readonly: true }),
      restrictReadonly: (agent) => { dsh.restrictAgentToolsRetained(agent, DENY) },
      warn: () => { /* no warnings expected on this path */ },
      onEvent: () => () => { /* bus owns teardown */ },
    })
    seam.handle({ agent: child })
    // Two attempts: the rejected eight, then the accepted six.
    expect(calls).toHaveLength(2)
    expect(calls[1]).toEqual(known)
    // The names that can write are in the list the child actually accepted.
    expect(calls[1]).toEqual(expect.arrayContaining(["write", "edit", "bash", "mpd_hashline_edit"]))
  })
})
