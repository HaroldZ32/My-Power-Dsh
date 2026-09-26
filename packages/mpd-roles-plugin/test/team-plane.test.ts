// Lane F acceptance: the two BINDING roster contracts restored on the OFFICIAL Agent Teams
// plugin (AGENTS.md §13 read-only discipline, §1 session-start complexity gate) and the
// roster's agent-scoped teammate-template section.
//
// The fixtures below are a RECORDING adapter double: every seam the three installers use is
// captured, and the team-mutation seams THROW, so "a fired soft signal stages nothing" is
// proven by the test failing loudly if the gate ever reached for one.
import { describe, expect, test } from "bun:test"

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
  sessionQualifies,
  STARTUP_NOTICE_MARKER,
} from "../src/session-gate.ts"
import { installRosterSection, ROSTER_SECTION_NAME, rosterSectionText } from "../src/roster-section.ts"

const WORKSPACE = "/tmp/mpd-team-plane-ws"

/** A qualifying mpd top-level session. */
function mpdAgent(id = "lead-1", header: Record<string, unknown> = {}) {
  return { id, session: { header: { cwd: WORKSPACE, agentPreset: "mpd", ...header } } }
}

function userMessage(text: string) {
  return { id: "user-1", role: "user", content: [{ type: "text", text }], source: { kind: "user" } }
}

/** The recording adapter double (see the file header). */
function planeHarness(options: { membership?: unknown; agents?: unknown[]; planFiles?: string[] } = {}) {
  const calls: Array<{ seam: string; args: unknown[] }> = []
  const record = (seam: string, ...args: unknown[]): void => { calls.push({ seam, args }) }
  const guards: Array<(exec: unknown) => string | undefined> = []
  const sections: Array<{ agent: unknown; section: { name: string; order: number; text: unknown } }> = []
  const released: string[] = []
  const steps: Array<(payload: any, decision: any) => unknown> = []
  const listeners = new Map<string, Array<(...args: unknown[]) => unknown>>()
  const agents = options.agents ?? [mpdAgent()]
  let messageSeq = 0

  const dsh = {
    capabilities: () => ({ toolsGuard: true, team: true, agentPromptSection: true, agentPreStep: true }),
    guardTool: (guard: (exec: unknown) => string | undefined) => { guards.push(guard); return () => { /* unregistered */ } },
    teamMembership: (agent: unknown) => {
      record("teamMembership", agent)
      if (options.membership !== undefined) return options.membership
      return agent === agents[0] ? { teamId: "team-1", role: "lead", name: "Lead" } : undefined
    },
    onAgentPreStep: (listener: (payload: any, decision: any) => unknown) => { steps.push(listener); return () => { /* unregistered */ } },
    userMessage: (input: { text: string; source?: unknown }) => {
      messageSeq += 1
      record("userMessage", input.text)
      return { id: "notice-" + messageSeq, role: "user", content: [{ type: "text", text: input.text }], source: input.source }
    },
    liveAgents: () => agents,
    onEvent: (event: string, handler: (...args: unknown[]) => unknown) => {
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

const memberFixtures = ROLES.map((role) => ({ name: role.name, description: role.description, readonly: role.readonly }))
const readonlyNames = ROLES.filter((role) => role.readonly).map((role) => role.name)

describe("read-only discipline: the guard denies exactly the roster's read-only members", () => {
  test("the guard's deny list IS the one-shot path's list (one constant, seven names)", () => {
    expect(READONLY_DENY).toHaveLength(7)
    expect(new Set(READONLY_DENY).size).toBe(7)
    const harness = planeHarness({ membership: { teamId: "team-1", role: "teammate", name: "Explorer" } })
    const install = installReadonlyGuard(harness.dsh as never, { deny: READONLY_DENY, members: memberFixtures, warn: () => {} })
    expect(install.installed).toBe(true)
    expect(harness.guards).toHaveLength(1)
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
    const readonlyMember = { id: "member-1" }
    const workerMember = { id: "member-2" }
    const lead = { id: "lead-1" }
    const stranger = { id: "stranger" }
    const membershipOf = (agent: unknown) => {
      if (agent === readonlyMember) return { role: "teammate", name: "Explorer" }
      if (agent === workerMember) return { role: "teammate", name: "Deep Worker" }
      if (agent === lead) return { role: "lead", name: "Lead" }
      return undefined
    }
    const options = { deny: new Set(READONLY_DENY), readonlyKeys: readonlyMemberKeys(memberFixtures), membershipOf }

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
    const warnings: string[] = []
    const dsh = { capabilities: () => ({ toolsGuard: false }), guardTool: () => { throw new Error("never called") }, teamMembership: () => undefined }
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
    const harness = planeHarness()
    const gate = installSessionGate(harness.dsh as never, { warn: () => {}, readdir: async () => [] })
    expect(gate.installed).toBe(true)
    const claimed = userMessage("Check the tests, build the package, verify the output.")
    const decided: any = await harness.steps[0]({ agent: mpdAgent(), messages: [claimed] }, { kind: "enter", messages: [claimed] })

    expect(decided.kind).toBe("enter")
    expect(decided.messages).toHaveLength(2)
    const notice = decided.messages[1]
    expect(notice.role).toBe("user")
    expect(notice.content[0].text.startsWith(STARTUP_NOTICE_MARKER)).toBe(true)
    expect(notice.content[0].text).toContain("NO team was staged")
    // The claimed user turn is still there (and unchanged: a SOFT signal has no marker).
    expect(decided.messages[0].content[0].text).toBe("Check the tests, build the package, verify the output.")
    // Nothing was staged: the mutation seams were never reached…
    expect(harness.calls.filter((call) => call.seam.startsWith("team"))).toEqual([])
    // …and the session is settled, so a second step injects nothing.
    expect(await harness.steps[0]({ agent: mpdAgent(), messages: [claimed] }, { kind: "enter", messages: [claimed] })).toBeUndefined()
  })

  test("an explicit team: flag is ADVISED (never provisioned) and CONSUMED from the goal text", async () => {
    const harness = planeHarness()
    installSessionGate(harness.dsh as never, { warn: () => {}, readdir: async () => [] })
    const claimed = userMessage("team: redesign the loader")
    const decided: any = await harness.steps[0]({ agent: mpdAgent(), messages: [claimed] }, { kind: "enter", messages: [claimed] })
    expect(decided.messages).toHaveLength(2)
    expect(decided.messages[0].content[0].text).toBe("redesign the loader")
    expect(decided.messages[1].content[0].text).toContain("CONSUMED")
    expect(harness.calls.filter((call) => call.seam.startsWith("team"))).toEqual([])
  })

  test("signal D needs a real .mpd/plans artifact, and the probe is workspace-scoped", async () => {
    const withPlan = planeHarness()
    const seen: string[] = []
    installSessionGate(withPlan.dsh as never, { warn: () => {}, readdir: async (path) => { seen.push(path); return ["lane.md"] } })
    const claimed = userMessage("fix the typo")
    const decided: any = await withPlan.steps[0]({ agent: mpdAgent(), messages: [claimed] }, { kind: "enter", messages: [claimed] })
    expect(seen[0]).toBe(WORKSPACE + "/.mpd/plans")
    expect(decided.messages[1].content[0].text).toContain("complexity signals D")

    const withoutPlan = planeHarness()
    installSessionGate(withoutPlan.dsh as never, { warn: () => {}, readdir: async () => { throw new Error("ENOENT") } })
    expect(await withoutPlan.steps[0]({ agent: mpdAgent(), messages: [claimed] }, { kind: "enter", messages: [claimed] })).toBeUndefined()
  })

  test("scope: child sessions and other presets never get the gate; mpd and preset-less sessions do", async () => {
    expect(sessionQualifies(mpdAgent())).toBe(true)
    expect(sessionQualifies({ id: "x", session: { header: { cwd: WORKSPACE } } })).toBe(true)
    expect(sessionQualifies(mpdAgent("lead-1", { parentSession: "lead-0" }))).toBe(false)
    expect(sessionQualifies({ id: "x", session: { header: { cwd: WORKSPACE, agentPreset: "standard" } } })).toBe(false)
    expect(sessionQualifies({ id: "x" })).toBe(false)

    const harness = planeHarness()
    installSessionGate(harness.dsh as never, { warn: () => {}, readdir: async () => [] })
    const claimed = userMessage("Check the tests, build the package, verify the output.")
    const child = mpdAgent("child-1", { parentSession: "lead-1" })
    expect(await harness.steps[0]({ agent: child, messages: [claimed] }, { kind: "enter", messages: [claimed] })).toBeUndefined()
    const other = { id: "other-1", session: { header: { cwd: WORKSPACE, agentPreset: "standard" } } }
    expect(await harness.steps[0]({ agent: other, messages: [claimed] }, { kind: "enter", messages: [claimed] })).toBeUndefined()
  })

  test("a step with no user text does NOT spend the settlement, and a reject decision is left alone", async () => {
    const harness = planeHarness()
    const gate = installSessionGate(harness.dsh as never, { warn: () => {}, readdir: async () => [] })
    expect(await harness.steps[0]({ agent: mpdAgent(), messages: [] }, { kind: "enter", messages: [] })).toBeUndefined()
    expect(gate.settled.size).toBe(0)
    expect(await harness.steps[0]({ agent: mpdAgent(), messages: [] }, { kind: "reject" })).toBeUndefined()
    const claimed = userMessage("Check the tests, build the package, verify the output.")
    const decided: any = await harness.steps[0]({ agent: mpdAgent(), messages: [claimed] }, { kind: "enter", messages: [claimed] })
    expect(decided.messages).toHaveLength(2)
  })

  test("a contained failure leaves the step untouched (a broken gate never breaks a turn)", async () => {
    const harness = planeHarness()
    const warnings: string[] = []
    installSessionGate(harness.dsh as never, { warn: (line) => warnings.push(line), readdir: async () => { throw new Error("boom") } })
    // The plan probe is contained, so the gate still runs; force a real failure instead:
    const broken = harness.dsh as any
    broken.workspaceRoot = () => { throw new Error("no workspace") }
    const claimed = userMessage("Check the tests, build the package, verify the output.")
    expect(await harness.steps[0]({ agent: mpdAgent(), messages: [claimed] }, { kind: "enter", messages: [claimed] })).toBeUndefined()
    expect(warnings.join(" ")).toContain("session-start gate failed")
  })

  test("consumeFlagFromMessage rewrites only text blocks and leaves a clean message identical", () => {
    const message = { id: "u", role: "user", content: [{ type: "text", text: "team: do it" }, { type: "image", data: "x" }] }
    const rewritten: any = consumeFlagFromMessage(message, "team: do it")
    expect(rewritten.content[0].text).toBe("do it")
    expect(rewritten.content[1]).toBe(message.content[1])
    const clean = userMessage("no marker here")
    expect(consumeFlagFromMessage(clean, "no marker here")).toBe(clean)
  })
})

describe("roster section: agent-scoped teammate templates for the mpd Lead", () => {
  test("the text names every member, its read-only flag, and how to instantiate one", () => {
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
    const lead = mpdAgent()
    const child = mpdAgent("child-1", { parentSession: "lead-1" })
    const other = { id: "other-1", session: { header: { cwd: WORKSPACE, agentPreset: "standard" } } }
    const harness = planeHarness({ agents: [lead, child, other] })
    const lines: string[] = []
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
    const harness = planeHarness({ agents: [] })
    installRosterSection(harness.dsh as never, { members: memberFixtures, warn: () => {} })
    expect(harness.sections).toHaveLength(0)

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
    const warnings: string[] = []
    const harness = planeHarness()
    ;(harness.dsh as any).agentPromptSection = () => { throw new Error("no agent-scoped systemPrompt") }
    const install = installRosterSection(harness.dsh as never, { members: memberFixtures, warn: (line) => warnings.push(line) })
    expect(install.registered).toBe(0)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("roster section not registered")
  })
})
