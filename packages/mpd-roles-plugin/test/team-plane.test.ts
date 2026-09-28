// Lane F acceptance: the two BINDING roster contracts restored on the OFFICIAL Agent Teams
// plugin (AGENTS.md §13 read-only discipline, §1 session-start complexity gate) and the
// roster's agent-scoped teammate-template section.
//
// The fixtures below are a RECORDING adapter double: every seam the three installers use is
// captured, and the team-mutation seams THROW, so "a fired soft signal stages nothing" is
// proven by the test failing loudly if the gate ever reached for one.
import { describe, expect, test } from "bun:test"

import { createDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"
import { READONLY_DENY } from "../src/index.ts"
import { ROLES } from "../src/roles.data.ts"
import {
  installReadonlyGuard,
  normalizeTeamMemberKey,
  readonlyGuardDecision,
  readonlyMemberForTeamName,
  readonlyMemberKeys,
} from "../src/team-guard.ts"
import {
  advisoryNoticeText,
  consumeExplicitFlag,
  consumeFlagFromMessage,
  evaluateComplexityGate,
  installSessionGate,
  latestUserMessage,
  sessionQualifies,
  STARTUP_NOTICE_MARKER,
} from "../src/session-gate.ts"
import { installRosterSection, ROSTER_SECTION_NAME, rosterSectionText } from "../src/roster-section.ts"

/** The sandbox workspace every fixture session reports as its cwd. */
const WORKSPACE = "/tmp/mpd-team-plane-ws"

/** A qualifying mpd top-level session. */
function mpdAgent(id: string = "lead-1", header: Record<string, unknown> = {}): {
  id: string
  session: { header: Record<string, unknown> }
} {
  return { id, session: { header: { cwd: WORKSPACE, agentPreset: "mpd", ...header } } }
}

/** A user-role message fixture: one text block, tagged as a real user turn. */
function userMessage(text: string): {
  id: string
  role: string
  content: Array<{ type: string; text: string }>
  source: { kind: string }
} {
  return { id: "user-1", role: "user", content: [{ type: "text", text }], source: { kind: "user" } }
}

/** The recording adapter double (see the file header). */
function planeHarness(options: { membership?: unknown; agents?: unknown[]; planFiles?: string[] } = {}): {
  dsh: unknown
  calls: Array<{ seam: string; args: unknown[] }>
  guards: Array<(exec: unknown) => string | undefined>
  sections: Array<{ agent: unknown; section: { name: string; order: number; text: unknown } }>
  released: string[]
  steps: Array<{ agent: unknown; listener: (payload: unknown, decision: unknown) => unknown }>
  listeners: Map<string, Array<(...args: unknown[]) => unknown>>
  agents: unknown[]
  emit: (event: string, payload: unknown) => void
} {
  /** Every adapter seam call the double recorded, in call order. */
  const calls: Array<{ seam: string; args: unknown[] }> = []
  /** Append one seam invocation, so an arm can prove a seam was never reached. */
  const record = (seam: string, ...args: unknown[]): void => { calls.push({ seam, args }) }
  /** Guards handed to guardTool, kept so an arm can invoke the installed one. */
  const guards: Array<(exec: unknown) => string | undefined> = []
  /** Agent-scoped prompt sections, paired with the agent they were registered for. */
  const sections: Array<{ agent: unknown; section: { name: string; order: number; text: unknown } }> = []
  /** Disposer labels the double recorded, asserted when an agent is disposed. */
  const released: string[] = []
  // ONE entry per AGENT-SCOPED registration: `{agent, listener}` — the gate registers per
  // agent now, so a test asserting a single host listener would prove the wrong wiring.
  const steps: Array<{ agent: unknown; listener: (payload: any, decision: any) => unknown }> = []
  /** Host-plane event listeners by event name (the agent/created and disposed seam). */
  const listeners = new Map<string, Array<(...args: unknown[]) => unknown>>()
  /** The live agents the double reports; one qualifying lead unless overridden. */
  const agents = options.agents ?? [mpdAgent()]
  /** Monotonic counter keeping each injected notice id unique within a test. */
  let messageSeq = 0

  /** The recording adapter double itself, cast at every install site. */
  const dsh = {
    capabilities: () => ({ toolsGuard: true, team: true, agentPromptSection: true, agentPreStep: true, agentPreStepScope: true }),
    guardTool: (guard: (exec: unknown) => string | undefined) => { guards.push(guard); return () => { /* unregistered */ } },
    teamMembership: (agent: unknown) => {
      record("teamMembership", agent)
      if (options.membership !== undefined) return options.membership
      return agent === agents[0] ? { teamId: "team-1", role: "lead", name: "Lead" } : undefined
    },
    // The AGENT-SCOPED registration the gate must use. The host-plane seam is deliberately
    // ABSENT from this double, so a gate that still reached for it would throw here.
    registerAgentPreStep: (agent: unknown, listener: (payload: any, decision: any) => unknown) => {
      record("registerAgentPreStep", agent)
      steps.push({ agent, listener })
      return () => { released.push("agent-pre-step:" + String((agent as { id?: unknown } | undefined)?.id ?? "?")) }
    },
    userMessage: (input: { text: string; source?: unknown }) => {
      messageSeq += 1
      record("userMessage", input.text)
      return { id: "notice-" + messageSeq, role: "user", content: [{ type: "text", text: input.text }], source: input.source }
    },
    liveAgents: () => agents,
    onEvent: (event: string, handler: (...args: unknown[]) => unknown) => {
      /** The listener bucket for one event name, created on first subscription. */
      const bucket = listeners.get(event) ?? []
      bucket.push(handler)
      listeners.set(event, bucket)
      return () => { /* unregistered */ }
    },
    agentPromptSection: (agent: unknown, section: { name: string; order: number; text: unknown }) => {
      record("agentPromptSection", agent, section.name)
      sections.push({ agent, section })
      return () => { released.push(section.name) }
    },
    workspaceRoot: () => WORKSPACE,
    // ── the seams the gate must NEVER reach (it stages nothing) ──
    teamSpawnTeammate: () => { record("teamSpawnTeammate"); throw new Error("the gate staged a teammate") },
    teamCreateTask: () => { record("teamCreateTask"); throw new Error("the gate staged a task") },
    teamUpdateTask: () => { record("teamUpdateTask"); throw new Error("the gate mutated a task") },
  }
  return {
    dsh,
    calls,
    guards,
    sections,
    released,
    steps,
    listeners,
    agents,
    emit: (event: string, payload: unknown) => { for (const handler of listeners.get(event) ?? []) handler(payload) },
  }
}

/** The roster reduced to the three fields the guard and section consume. */
const memberFixtures = ROLES.map((role) => ({ name: role.name, description: role.description, readonly: role.readonly }))
/** Names of the read-only roster members, one per protected discipline. */
const readonlyNames = ROLES.filter((role) => role.readonly).map((role) => role.name)

describe("read-only discipline: the guard denies exactly the roster's read-only members", () => {
  test("the guard's deny list IS the one-shot path's list (one constant, seven names)", () => {
    expect(READONLY_DENY).toHaveLength(7)
    expect(new Set(READONLY_DENY).size).toBe(7)
    /** The double, with a read-only Explorer teammate as the calling membership. */
    const harness = planeHarness({ membership: { teamId: "team-1", role: "teammate", name: "Explorer" } })
    /** The guard installation result, whose recorded guard is invoked below. */
    const install = installReadonlyGuard(harness.dsh as never, { deny: READONLY_DENY, members: memberFixtures, warn: () => {} })
    expect(install.installed).toBe(true)
    expect(harness.guards).toHaveLength(1)
    /** The one installed guard, called directly to prove exactly what it denies. */
    const guard = harness.guards[0]
    // EVERY name of the shared list denies for a read-only teammate…
    for (const tool of READONLY_DENY) {
      expect(guard({ name: tool, agent: { id: "member-1" } }), tool).toBeString()
    }
    // …and a tool OUTSIDE it passes, so the guard is exactly the list and nothing more.
    expect(guard({ name: "read", agent: { id: "member-1" } })).toBeUndefined()
    expect(guard({ name: "glob", agent: { id: "member-1" } })).toBeUndefined()
  })

  test("a read-only teammate is denied; a worker, the Lead and a non-team agent pass", () => {
    /** The read-only teammate the guard must deny. */
    const readonlyMember = { id: "member-1" }
    /** A write-capable teammate, which the guard must leave alone. */
    const workerMember = { id: "member-2" }
    /** The Lead own agent, never filtered by the roster discipline. */
    const lead = { id: "lead-1" }
    /** A non-team agent, i.e. somebody else's business. */
    const stranger = { id: "stranger" }
    /** Resolve a test member to its team membership, or undefined when unknown. */
    const membershipOf = (agent: unknown): { role: string; name: string } | undefined => {
      if (agent === readonlyMember) return { role: "teammate", name: "Explorer" }
      if (agent === workerMember) return { role: "teammate", name: "Deep Worker" }
      if (agent === lead) return { role: "lead", name: "Lead" }
      return undefined
    }
    /** The pure decision inputs, shared by the four pass and deny assertions. */
    const options = { deny: new Set(READONLY_DENY), readonlyKeys: readonlyMemberKeys(memberFixtures), membershipOf }

    /** The denial message for the read-only teammate edit call. */
    const denied = readonlyGuardDecision({ name: "edit", agent: readonlyMember }, options)
    expect(denied).toBeString()
    // The message NAMES the member and the roster rule, and points at what to do instead.
    expect(denied).toContain("Explorer")
    expect(denied).toContain("READ-ONLY roster member")
    expect(denied).toContain("edit")
    expect(denied).toContain("Deep Worker")

    expect(readonlyGuardDecision({ name: "edit", agent: workerMember }, options)).toBeUndefined()
    expect(readonlyGuardDecision({ name: "edit", agent: lead }, options)).toBeUndefined()
    expect(readonlyGuardDecision({ name: "edit", agent: stranger }, options)).toBeUndefined()
    expect(readonlyGuardDecision({ name: "read", agent: readonlyMember }, options)).toBeUndefined()
  })

  test("every read-only NAME spelling is protected, including a team-unique numeric suffix", () => {
    /** The read-only member index the name matcher resolves against. */
    const keys = readonlyMemberKeys(memberFixtures)
    for (const name of readonlyNames) {
      for (const spelling of [name, name.toLowerCase(), name.toUpperCase(), name.replace(/ /g, "-"), name.replace(/ /g, "_")]) {
        expect(readonlyMemberForTeamName(spelling, keys), spelling).toBe(name)
      }
      // The bypass this guard exists to close: appending a digit must not buy write access.
      expect(readonlyMemberForTeamName(name.replace(/ /g, "-") + "-2", keys), name).toBe(name)
    }
    // A worker member is never matched, and neither is an unrelated name.
    expect(readonlyMemberForTeamName("Deep Worker", keys)).toBeUndefined()
    expect(readonlyMemberForTeamName("deep-worker-2", keys)).toBeUndefined()
    expect(readonlyMemberForTeamName("Lead", keys)).toBeUndefined()
    expect(readonlyMemberForTeamName("", keys)).toBeUndefined()
    expect(normalizeTeamMemberKey("Plan  Reviewer")).toBe("plan-reviewer")
  })

  test("the guard is NON-THROWING: a hostile membership resolver is a pass-through", () => {
    /** Decision inputs whose membership resolver throws, proving the pass-through. */
    const options = {
      deny: new Set(READONLY_DENY),
      readonlyKeys: readonlyMemberKeys(memberFixtures),
      membershipOf: () => { throw new Error("service exploded") },
    }
    expect(() => readonlyGuardDecision({ name: "bash", agent: {} }, options)).not.toThrow()
    expect(readonlyGuardDecision({ name: "bash", agent: {} }, options)).toBeUndefined()
    // A malformed execution is a pass-through too.
    expect(readonlyGuardDecision(null, options)).toBeUndefined()
    expect(readonlyGuardDecision({}, options)).toBeUndefined()
  })

  test("a missing tools.guard seam degrades with a warning instead of aborting the roster", () => {
    /** Warning lines the degraded install reported. */
    const warnings: string[] = []
    /** An adapter double with NO working tools.guard seam. */
    const dsh = { capabilities: () => ({ toolsGuard: false }), guardTool: () => { throw new Error("never called") }, teamMembership: () => undefined }
    /** The install result, which must degrade rather than abort. */
    const install = installReadonlyGuard(dsh as never, { deny: READONLY_DENY, members: memberFixtures, warn: (line) => warnings.push(line) })
    expect(install.installed).toBe(false)
    expect(install.reason).toBe("no-guard-seam")
    expect(warnings.join(" ")).toContain("tools.guard")
  })
})

describe("the frozen complexity predicate (Option A: explicit flag OR >= 1 matched signal)", () => {
  test("signal A: team: prefix and !team, with the marker consumed", () => {
    expect(consumeExplicitFlag("team: migrate the parser")).toEqual({ flagged: true, text: "migrate the parser" })
    expect(consumeExplicitFlag("  team:   do it")).toEqual({ flagged: true, text: "do it" })
    // `!team` is stripped WITH its trailing whitespace (the frozen `replace(/!team\s*/giu,'')`).
    expect(consumeExplicitFlag("please !team take this on")).toEqual({ flagged: true, text: "please take this on" })
    expect(consumeExplicitFlag("a team: inside the sentence")).toEqual({ flagged: false, text: "a team: inside the sentence" })
    expect(evaluateComplexityGate("tiny task", { explicitFlag: true })).toEqual({ trigger: true, signals: ["A"] })
  })

  test("signal B: >= 4 DISTINCT deliverable verbs", () => {
    expect(evaluateComplexityGate("align, migrate, refactor and audit the module").signals).toContain("B")
    expect(evaluateComplexityGate("align align align align").signals).not.toContain("B")
    expect(evaluateComplexityGate("align and migrate only").signals).not.toContain("B")
  })

  test("signal C: ONE signal, fired by its own 2-of-3 majority (never counted as C1/C2/C3)", () => {
    // Three action clauses on one line (the documented frozen-prompt shape).
    const clauses = "Check the tests, build the package, verify the output."
    /** The gate verdict for one three-clause prompt. */
    const verdict = evaluateComplexityGate(clauses)
    expect(verdict.signals).toEqual(["C"])
    expect(verdict.trigger).toBe(true)
    // A bulleted list alone satisfies C1 but not the majority.
    expect(evaluateComplexityGate("- one\n- two\n- three").signals).toEqual([])
  })

  test("signal D: a plan artifact exists", () => {
    expect(evaluateComplexityGate("small task", { planArtifact: true })).toEqual({ trigger: true, signals: ["D"] })
  })

  test("no signal: nothing fires, and the trigger needs at least one", () => {
    expect(evaluateComplexityGate("fix the typo in the readme")).toEqual({ trigger: false, signals: [] })
    expect(evaluateComplexityGate("")).toEqual({ trigger: false, signals: [] })
  })

  test("the advisory text carries the frozen marker, names the signals and stages nothing", () => {
    /** The advisory notice for the two-signal case, and for the consumed-flag case. */
    const text = advisoryNoticeText(["B", "C"], false)
    expect(text.startsWith(STARTUP_NOTICE_MARKER)).toBe(true)
    expect(text).toContain("complexity signals B/C")
    expect(text).toContain("NO team was staged")
    expect(text).toContain("spawn_teammate")
    expect(text).toContain("team_task_create")
    expect(text).toContain("`mpd_role_persona`")
    // The retired vocabulary must not come back.
    expect(text).not.toContain("agent_teams_create")
    expect(advisoryNoticeText(["A"], true)).toContain("CONSUMED")
  })
})

describe("session-start gate: scope, one-shot settlement and the advisory injection", () => {
  test("a fired SOFT signal injects ONE advisory notice and stages NOTHING", async () => {
    /** A double whose membership is irrelevant to the gate arm. */
    const harness = planeHarness()
    /** The gate install, whose settlement set is asserted after the first step. */
    const gate = installSessionGate(harness.dsh as never, { warn: () => {}, readdir: async () => [] })
    expect(gate.installed).toBe(true)
    /** The claimed user turn the gate must judge. */
    const claimed = userMessage("Check the tests, build the package, verify the output.")
    /** The step decision the listener returned for that turn. */
    const decided: any = await harness.steps[0].listener({ messages: [claimed], turn: 1, step: 1, signal: new AbortController().signal }, { kind: "enter", messages: [claimed] })

    expect(decided.kind).toBe("enter")
    expect(decided.messages).toHaveLength(2)
    /** The injected notice, asserted to be the SECOND message. */
    const notice = decided.messages[1]
    expect(notice.role).toBe("user")
    expect(notice.content[0].text.startsWith(STARTUP_NOTICE_MARKER)).toBe(true)
    expect(notice.content[0].text).toContain("NO team was staged")
    // The claimed user turn is still there (and unchanged: a SOFT signal has no marker).
    expect(decided.messages[0].content[0].text).toBe("Check the tests, build the package, verify the output.")
    // Nothing was staged: the mutation seams were never reached…
    expect(harness.calls.filter((call) => call.seam.startsWith("team"))).toEqual([])
    // …and the session is settled, so a second step injects nothing.
    expect(await harness.steps[0].listener({ messages: [claimed], turn: 1, step: 1, signal: new AbortController().signal }, { kind: "enter", messages: [claimed] })).toBeUndefined()
  })

  test("an explicit team: flag is ADVISED (never provisioned) and CONSUMED from the goal text", async () => {
    /** A double for the explicit-flag arm. */
    const harness = planeHarness()
    installSessionGate(harness.dsh as never, { warn: () => {}, readdir: async () => [] })
    /** The user turn carrying the team: marker. */
    const claimed = userMessage("team: redesign the loader")
    /** The decision with the marker consumed and the notice appended. */
    const decided: any = await harness.steps[0].listener({ messages: [claimed], turn: 1, step: 1, signal: new AbortController().signal }, { kind: "enter", messages: [claimed] })
    expect(decided.messages).toHaveLength(2)
    expect(decided.messages[0].content[0].text).toBe("redesign the loader")
    expect(decided.messages[1].content[0].text).toContain("CONSUMED")
    expect(harness.calls.filter((call) => call.seam.startsWith("team"))).toEqual([])
  })

  test("signal D needs a real .mpd/plans artifact, and the probe is workspace-scoped", async () => {
    /** A double whose plan probe reports one artifact. */
    const withPlan = planeHarness()
    /** Paths the injected plan probe was asked for, proving workspace scoping. */
    const seen: string[] = []
    installSessionGate(withPlan.dsh as never, { warn: () => {}, readdir: async (path) => { seen.push(path); return ["lane.md"] } })
    /** The claim the gate must judge, a prompt with no signal of its own. */
    const claimed = userMessage("fix the typo")
    /** The decision for the plan-artifact case, carrying the D notice. */
    const decided: any = await withPlan.steps[0].listener({ messages: [claimed], turn: 1, step: 1, signal: new AbortController().signal }, { kind: "enter", messages: [claimed] })
    expect(seen[0]).toBe(WORKSPACE + "/.mpd/plans")
    expect(decided.messages[1].content[0].text).toContain("complexity signals D")

    /** A double whose plan probe fails, the no-artifact control. */
    const withoutPlan = planeHarness()
    installSessionGate(withoutPlan.dsh as never, { warn: () => {}, readdir: async () => { throw new Error("ENOENT") } })
    expect(await withoutPlan.steps[0].listener({ messages: [claimed], turn: 1, step: 1, signal: new AbortController().signal }, { kind: "enter", messages: [claimed] })).toBeUndefined()
  })

  test("scope: child sessions and other presets never get the gate; mpd and preset-less sessions do", async () => {
    expect(sessionQualifies(mpdAgent())).toBe(true)
    expect(sessionQualifies({ id: "x", session: { header: { cwd: WORKSPACE } } })).toBe(true)
    expect(sessionQualifies(mpdAgent("lead-1", { parentSession: "lead-0" }))).toBe(false)
    expect(sessionQualifies({ id: "x", session: { header: { cwd: WORKSPACE, agentPreset: "standard" } } })).toBe(false)
    expect(sessionQualifies({ id: "x" })).toBe(false)

    /** The qualifying top-level mpd session. */
    const lead = mpdAgent()
    /** A child session, which must never receive a listener. */
    const child = mpdAgent("child-1", { parentSession: "lead-1" })
    /** A session of another preset, which must never receive a listener. */
    const other = { id: "other-1", session: { header: { cwd: WORKSPACE, agentPreset: "standard" } } }
    /** A double over all three agents, so registration alone is the filter. */
    const harness = planeHarness({ agents: [lead, child, other] })
    installSessionGate(harness.dsh as never, { warn: () => {}, readdir: async () => [] })
    // REGISTRATION is the filter now: ONLY the qualifying agent's scope got a listener, so a
    // child or another preset's session cannot fire the gate even in principle.
    expect(harness.steps.map((step) => step.agent)).toEqual([lead])
    expect(harness.steps).toHaveLength(1)
    // A later qualifying agent is picked up through agent/created; a child is not.
    const late = mpdAgent("late-1")
    harness.emit("agent/created", { agent: late })
    harness.emit("agent/created", { agent: mpdAgent("child-2", { parentSession: "lead-1" }) })
    expect(harness.steps.map((step) => step.agent)).toEqual([lead, late])
    // Disposal releases the registration (never a leak across agent lifetimes).
    harness.emit("agent/disposed", { agent: late })
    expect(harness.released).toContain("agent-pre-step:late-1")
  })

  test("a step with no user text does NOT spend the settlement, and a reject decision is left alone", async () => {
    /** A double for the settlement arm. */
    const harness = planeHarness()
    /** The gate install, whose settlement set must stay empty. */
    const gate = installSessionGate(harness.dsh as never, { warn: () => {}, readdir: async () => [] })
    expect(await harness.steps[0].listener({ messages: [], turn: 1, step: 1, signal: new AbortController().signal }, { kind: "enter", messages: [] })).toBeUndefined()
    expect(gate.settled.size).toBe(0)
    expect(await harness.steps[0].listener({ messages: [], turn: 1, step: 1, signal: new AbortController().signal }, { kind: "reject" })).toBeUndefined()
    /** The claim that finally fires the gate, after two no-op steps. */
    const claimed = userMessage("Check the tests, build the package, verify the output.")
    /** The decision proving the no-op steps did not spend the settlement. */
    const decided: any = await harness.steps[0].listener({ messages: [claimed], turn: 1, step: 1, signal: new AbortController().signal }, { kind: "enter", messages: [claimed] })
    expect(decided.messages).toHaveLength(2)
  })

  test("a contained failure leaves the step untouched (a broken gate never breaks a turn)", async () => {
    /** A double for the contained-failure arm. */
    const harness = planeHarness()
    /** Warnings the gate reported instead of throwing. */
    const warnings: string[] = []
    installSessionGate(harness.dsh as never, { warn: (line) => warnings.push(line), readdir: async () => { throw new Error("boom") } })
    // The plan probe is contained, so the gate still runs; force a real failure instead:
    const broken = harness.dsh as any
    broken.workspaceRoot = () => { throw new Error("no workspace") }
    /** The claim the broken gate still has to judge. */
    const claimed = userMessage("Check the tests, build the package, verify the output.")
    expect(await harness.steps[0].listener({ messages: [claimed], turn: 1, step: 1, signal: new AbortController().signal }, { kind: "enter", messages: [claimed] })).toBeUndefined()
    expect(warnings.join(" ")).toContain("session-start gate failed")
  })

  test("consumeFlagFromMessage rewrites only text blocks and leaves a clean message identical", () => {
    /** A message mixing a text block with a non-text block. */
    const message = { id: "u", role: "user", content: [{ type: "text", text: "team: do it" }, { type: "image", data: "x" }] }
    /** The rewritten message, whose text block alone must change. */
    const rewritten: any = consumeFlagFromMessage(message, "team: do it")
    expect(rewritten.content[0].text).toBe("do it")
    expect(rewritten.content[1]).toBe(message.content[1])
    /** A message with no marker, which must come back identical. */
    const clean = userMessage("no marker here")
    expect(consumeFlagFromMessage(clean, "no marker here")).toBe(clean)
  })
})

describe("roster section: agent-scoped teammate templates for the mpd Lead", () => {
  test("the text names every member, its read-only flag, and how to instantiate one", () => {
    /** The rendered roster section, scanned for every member and the instantiation line. */
    const text = rosterSectionText(memberFixtures)
    for (const role of ROLES) expect(text).toContain(role.name)
    expect(text).toContain("[read-only]")
    expect(text).toContain("[writes]")
    expect(text).toContain("spawn_teammate")
    expect(text).toContain("mpd_role_persona")
    expect(text).toContain("team_task_create")
    // The measured routing bound is stated, never promised away.
    expect(text).toContain("inherits YOUR model route")
    expect(text).toContain("mpd_role_spawn")
    // Compact: one line per member plus a header and the instantiation line.
    expect(text.split("\n").length).toBeLessThanOrEqual(ROLES.length + 3)
  })

  test("registered ONCE per qualifying live agent, and only for mpd top-level sessions", () => {
    /** The qualifying top-level mpd session. */
    const lead = mpdAgent()
    /** A child session, whose scope must not receive the section. */
    const child = mpdAgent("child-1", { parentSession: "lead-1" })
    /** A session of another preset, likewise out of scope. */
    const other = { id: "other-1", session: { header: { cwd: WORKSPACE, agentPreset: "standard" } } }
    /** A double over all three agents. */
    const harness = planeHarness({ agents: [lead, child, other] })
    /** Registration-signature lines the installer logged. */
    const lines: string[] = []
    /** The install result, asserting exactly one registered scope. */
    const install = installRosterSection(harness.dsh as never, { members: memberFixtures, warn: () => {}, log: (line) => lines.push(line) })

    expect(harness.sections).toHaveLength(1)
    expect(harness.sections[0].agent).toBe(lead)
    expect(harness.sections[0].section.name).toBe(ROSTER_SECTION_NAME)
    expect(install.registered).toBe(1)
    // The REGISTRATION SIGNATURE an integration boot asserts (agent + preset + section).
    expect(lines).toHaveLength(1)
    expect(lines[0]).toBe('roster section registered for agent "lead-1" agentPreset=mpd — mpd:roster order=605')
  })

  test("a later session is covered through agent/created, and disposal releases the section", () => {
    /** A double with no live agent at install time. */
    const harness = planeHarness({ agents: [] })
    installRosterSection(harness.dsh as never, { members: memberFixtures, warn: () => {} })
    expect(harness.sections).toHaveLength(0)

    /** A session appearing AFTER the install, picked up through agent/created. */
    const late = mpdAgent("late-1")
    harness.emit("agent/created", { agent: late })
    expect(harness.sections).toHaveLength(1)
    expect(harness.sections[0].agent).toBe(late)
    // A duplicate created event must not register twice (the harness throws on a duplicate name).
    harness.emit("agent/created", { agent: late })
    expect(harness.sections).toHaveLength(1)

    harness.emit("agent/disposed", { agent: late })
    expect(harness.released).toEqual([ROSTER_SECTION_NAME])
  })

  test("a scope that refuses the section degrades with ONE warning, never a boot failure", () => {
    /** Warnings the refusing scope produced. */
    const warnings: string[] = []
    /** A double whose agent-scoped section seam throws. */
    const harness = planeHarness()
    ;(harness.dsh as any).agentPromptSection = () => { throw new Error("no agent-scoped systemPrompt") }
    /** The install result, which must degrade with one warning. */
    const install = installRosterSection(harness.dsh as never, { members: memberFixtures, warn: (line) => warnings.push(line) })
    expect(install.registered).toBe(0)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("roster section not registered")
  })
})

/**
 * THE REGRESSION TEST FOR THE MOUNTED-BUT-SILENT DEFECT (2026-09-27).
 *
 * The first version of the gate registered through the ADAPTER's row context and read the
 * calling agent off the payload. On a real boot the listener was installed, the boot log said
 * `sessionGate=advisory`, and NOTHING was ever injected: `agent/pre-step` is dispatched through
 * the agent's SCOPE CARRIER, and a scope-filtered dispatch does not reach a listener whose own
 * scope is not the dispatch scope or an ancestor of it. A unit test that handed the listener a
 * hand-made payload WITH `agent` could not see any of that.
 *
 * This test drives the REAL adapter with the REAL payload shape (`{messages, turn, step,
 * signal}` — no `agent`) and asserts the notice still lands.
 */
describe("gate registration through the REAL adapter (the mounted-but-silent regression)", () => {
  test("a payload WITHOUT `agent` still injects: the registration site is the authority", async () => {
    /** Listeners the REAL adapter subscribed on the agent own scope. */
    const captured: Array<{ event: string; listener: (payload: any, next: any) => any }> = []
    /** Events subscribed on the ROW ctx, which must never carry agent/pre-step. */
    const hostEvents: string[] = []
    /** The live agent the adapter discovers through the agents service. */
    const lead = {
      id: "lead-1",
      session: { header: { cwd: WORKSPACE, agentPreset: "mpd" } },
      // The agent's OWN scope — the only site whose delivery the scope filter admits.
      ctx: { on: (event: string, listener: any) => { captured.push({ event, listener }); return () => { /* unregistered */ } } },
    }
    /** The minimal real-adapter ctx: an agents service and a row-level event bus. */
    const ctx = {
      get: (name: string) => (name === "agents" ? { list: () => [lead] } : undefined),
      on: (event: string) => { hostEvents.push(event); return () => { /* unregistered */ } },
    }
    /** The REAL adapter built over that ctx. */
    const adapter = createDshAdapter(ctx)
    installSessionGate(adapter as never, { warn: () => {}, readdir: async () => [] })

    // Registered on the AGENT's scope, never on the row's event bus.
    expect(captured.map((entry) => entry.event)).toEqual(["agent/pre-step"])
    expect(hostEvents).not.toContain("agent/pre-step")
    expect(adapter.capabilities().agentPreStepScope).toBe(true)

    /** The claim whose single turn must produce the advisory notice. */
    const claimed = userMessage("Check the tests, build the package, verify the output.")
    // EXACTLY the harness payload: {messages, ...position, signal} — NO `agent`.
    const payload = { messages: [claimed], turn: 1, step: 1, signal: new AbortController().signal }
    /** The decision the agent-scoped listener returned. */
    const out: any = await captured[0].listener(payload, async () => ({ kind: "enter", messages: [claimed] }))

    expect(out.kind).toBe("enter")
    expect(out.messages).toHaveLength(2)
    expect(out.messages[1].content[0].text.startsWith(STARTUP_NOTICE_MARKER)).toBe(true)
    expect(out.messages[1].content[0].text).toContain("NO team was staged")
    // …and the same shape leaves a SIMPLE prompt alone: the adapter owns next(), so the step
    // still receives the DOWNSTREAM decision — one message, no notice (the falsifiability arm
    // a gate that fired on everything would redden).
    const simple = { id: "u2", role: "user", content: [{ type: "text", text: "fix the typo" }] }
    /** The decision for a simple prompt, which must carry no notice. */
    const simpleOut: any = await captured[0].listener(
      { messages: [simple], turn: 1, step: 1, signal: new AbortController().signal },
      async () => ({ kind: "enter", messages: [simple] }),
    )
    expect(simpleOut.messages).toHaveLength(1)
    expect(String(simpleOut.messages[0]?.content?.[0]?.text ?? "")).toBe("fix the typo")
  })
})

/**
 * THE SECOND ROOT CAUSE, measured on one instrumented live boot: the step's DECISION carries
 * the claimed turn PLUS the user-role notice the harness itself splices in
 * (`{role:"user", source:{kind:"runtime-context"}, text:"Current runtime context. …"}`), so a
 * backward scan of the decision judged that snapshot and the predicate was false on every
 * triggered prompt. The goal must come from the payload's RAW claimed list (and, failing
 * that, from a `source.kind === "user"` message).
 */
describe("goal selection: the injected runtime-context turn must not shadow the user turn", () => {
  test("the gate judges the GOAL even when the decision carries an injected context turn", async () => {
    /** A double for the runtime-context shadowing arm. */
    const harness = planeHarness()
    installSessionGate(harness.dsh as never, { warn: () => {}, readdir: async () => [] })
    /** The real goal the gate must judge. */
    const goal = userMessage("Check the tests, build the package, verify the output.")
    /** The runtime-context turn the harness splices in AFTER the goal. */
    const injected = {
      id: "ctx-1",
      role: "user",
      content: [{ type: "text", text: "Current runtime context. This snapshot supersedes earlier runtime facts." }],
      source: { kind: "runtime-context" },
    }
    // The measured shape: the PAYLOAD claims the goal only; the DECISION also carries the
    // harness-injected context turn, appended AFTER the goal.
    // The double captures the RAW handler (the adapter owns `next()` in production), so the
    // decision is passed directly — exactly the list the adapter would hand over.
    const out: any = await harness.steps[0].listener(
      { messages: [goal], turn: 1, step: 1, signal: new AbortController().signal },
      { kind: "enter", messages: [goal, injected] },
    )
    /** The injected notice, located by its frozen marker. */
    const notice = out.messages.find((message: any) => String(message?.content?.[0]?.text ?? "").startsWith(STARTUP_NOTICE_MARKER))
    expect(notice).toBeDefined()
    expect(notice.content[0].text).toContain("complexity signals C")
    // PLACEMENT (frozen from the retired implementation): the notice lands immediately after
    // the last CLAIMED message, i.e. before the harness-injected context turn, which is
    // preserved untouched.
    expect(out.messages[1]).toBe(notice)
    expect(out.messages[2]).toBe(injected)
    // A SIMPLE goal through the same shape stays silent (the falsifiability arm).
    const simpleHarness = planeHarness()
    installSessionGate(simpleHarness.dsh as never, { warn: () => {}, readdir: async () => [] })
    /** A simple goal through the same two-message shape. */
    const simple = userMessage("fix the typo")
    /** The raw handler answer: undefined, so the step stays untouched. */
    const simpleOut: any = await simpleHarness.steps[0].listener(
      { messages: [simple], turn: 1, step: 1 },
      { kind: "enter", messages: [simple, { id: "ctx-2", role: "user", content: [{ type: "text", text: "Current runtime context." }], source: { kind: "runtime-context" } }] },
    )
    // The RAW handler answers `undefined` when nothing fires (the adapter turns that into the
    // downstream decision untouched); no notice is anywhere in the step.
    expect(simpleOut).toBeUndefined()
  })

  test("latestUserMessage is source-aware, and still answers for a host that tags nothing", () => {
    /** A tagged user goal. */
    const goal = userMessage("do the thing")
    /** A runtime-context turn, which must never shadow that goal. */
    const injected = { id: "c", role: "user", content: [{ type: "text", text: "Current runtime context." }], source: { kind: "runtime-context" } }
    expect(latestUserMessage([goal, injected])?.text).toBe("do the thing")
    expect(latestUserMessage([injected])?.text).toBe("Current runtime context.")
    // Untagged messages keep the old "last user-role message with text" behaviour.
    const untagged = { id: "u", role: "user", content: [{ type: "text", text: "legacy" }] }
    expect(latestUserMessage([untagged])?.text).toBe("legacy")
    expect(latestUserMessage([untagged, injected])?.text).toBe("Current runtime context.")
  })
})
