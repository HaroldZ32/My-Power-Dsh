// Lane F acceptance: the two BINDING roster contracts restored on the OFFICIAL Agent Teams
// plugin (AGENTS.md §13 read-only discipline, §1 session-start complexity gate) and the
// roster's agent-scoped teammate-template section.
//
// The fixtures below are a RECORDING adapter double: every seam the three installers use is
// captured, and the team-mutation seams THROW, so "a fired soft signal stages nothing" is
// proven by the test failing loudly if the gate ever reached for one.
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { createDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"
import { READONLY_DENY, stagedPlanProbe } from "../src/index.ts"
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
  ALREADY_STAGED_PLAN_PHRASE,
  consumeExplicitFlag,
  consumeFlagFromMessage,
  DRIFTED_ADVISORY_SENTENCE,
  evaluateComplexityGate,
  GATE_CONFIG_KEY,
  GATE_MODE_ADVISORY,
  GATE_MODE_OFF,
  gatePlanShell,
  INERT_PLAN_PHRASE,
  latestUserMessage,
  mechanicalNoticeText,
  readBoulderGate,
  readLeadingTeam,
  resolveGateMode,
  sessionQualifies,
  STAGED_PLAN_PHRASE,
  STAGING_TOOL_NAME,
  STARTUP_NOTICE_MARKER,
} from "../src/complexity-gate.ts"
import { installSessionGate } from "../src/session-gate.ts"
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
function planeHarness(options: {
  membership?: unknown
  agents?: unknown[]
  /** The tool names this composition registers; empty means the staging tool is ABSENT. */
  tools?: string[]
  /** The answer one `executeTool` call returns; defaults to a successful `create` payload. */
  toolResult?: unknown
} = {}): {
  dsh: unknown
  calls: Array<{ seam: string; args: unknown[] }>
  guards: Array<(exec: unknown) => string | undefined>
  sections: Array<{ agent: unknown; section: { name: string; order: number; text: unknown } }>
  released: string[]
  steps: Array<{ agent: unknown; listener: (payload: unknown, decision: unknown) => unknown }>
  listeners: Map<string, Array<(...args: unknown[]) => unknown>>
  agents: unknown[]
  /** Every `executeTool` call the gate made, in order — the mechanical route's proof. */
  toolCalls: Array<{ name: string; arguments: unknown; agent: unknown; timeoutMs?: number }>
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
  /** Every internal tool call the gate issued, which is how "staged" is proven. */
  const toolCalls: Array<{ name: string; arguments: unknown; agent: unknown; timeoutMs?: number }> = []
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
    // ── the two INTERNAL-TOOL seams the MECHANICAL gate stages through ──
    // `tools` is EMPTY unless an arm asks for the staging tool, so every other arm exercises the
    // ladder's advisory step (a composition without mpd-team-core) by default. The probe RECORDS
    // its second argument, because the ladder must ask the CALLING AGENT'S view — the view its call
    // executes against — and never the host-plane global read.
    hasTool: (name: string, agent?: unknown) => { record("hasTool", name, agent); return (options.tools ?? []).includes(name) },
    executeTool: (input: { name: string; arguments?: unknown; agent?: unknown; timeoutMs?: number }) => {
      record("executeTool", input.name, input.arguments)
      toolCalls.push({ name: input.name, arguments: input.arguments, agent: input.agent, ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }) })
      return options.toolResult ?? { ok: true, isError: false, value: { plan: { planId: "plan-staged-1", name: "shell" } } }
    },
    // ── the seams the gate must NEVER reach DIRECTLY (staging goes through the tool) ──
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
    toolCalls,
    emit: (event: string, payload: unknown) => { for (const handler of listeners.get(event) ?? []) handler(payload) },
  }
}

/** The roster reduced to the three fields the guard and section consume. */
const memberFixtures = ROLES.map((role) => ({ name: role.name, description: role.description, readonly: role.readonly }))
/** Names of the read-only roster members, one per protected discipline. */
const readonlyNames = ROLES.filter((role) => role.readonly).map((role) => role.name)

describe("read-only discipline: the guard denies exactly the roster's read-only members", () => {
  test("the guard's deny list IS the one-shot path's list (one constant, eight names)", () => {
    expect(READONLY_DENY).toHaveLength(8)
    expect(new Set(READONLY_DENY).size).toBe(8)
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
    // `!team` is stripped WITH its trailing whitespace, and only at a TOKEN BOUNDARY.
    expect(consumeExplicitFlag("please !team take this on")).toEqual({ flagged: true, text: "please take this on" })
    expect(consumeExplicitFlag("a team: inside the sentence")).toEqual({ flagged: false, text: "a team: inside the sentence" })
    expect(evaluateComplexityGate("tiny task", { explicitFlag: true })).toEqual({ trigger: true, signals: ["A"] })
  })

  test("P8: a QUOTED !team is neither an activation nor stripped (only the earliest boundary one is)", () => {
    // The retired global replace deleted this occurrence and flagged the goal; both were wrong.
    expect(consumeExplicitFlag('the manual says "!team" activates a team')).toEqual({ flagged: false, text: 'the manual says "!team" activates a team' })
    expect(consumeExplicitFlag("use `!team` in a code span")).toEqual({ flagged: false, text: "use `!team` in a code span" })
    // ONE real marker plus a quoted one: the real one is consumed, the quoted one survives.
    expect(consumeExplicitFlag('!team please leave "!team" alone')).toEqual({ flagged: true, text: 'please leave "!team" alone' })
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

  test("signal D reads an ACTIVE boulder work, never a plan FILE", () => {
    expect(evaluateComplexityGate("small task", { activeBoulder: true })).toEqual({ trigger: true, signals: ["D"] })
    expect(evaluateComplexityGate("small task", { activeBoulder: false })).toEqual({ trigger: false, signals: [] })
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

  test("the MECHANICAL text names the RETURNED plan id, the shell bound and the inertness rule", () => {
    /** The mechanical notice for a freshly staged shell. */
    const text = mechanicalNoticeText({ planId: "plan-abc", signals: ["A"], explicit: true, alreadyStaged: false })
    expect(text.startsWith(STARTUP_NOTICE_MARKER)).toBe(true)
    expect(text).toContain(STAGED_PLAN_PHRASE)
    expect(text).toContain("plan-abc")
    expect(text).toContain("complexity signals A")
    expect(text).toContain(INERT_PLAN_PHRASE)
    expect(text).toContain("agent_teams_plan")
    expect(text).toContain("SHELL")
    // An id the call did NOT report is never invented.
    expect(mechanicalNoticeText({ planId: "", signals: ["C"], explicit: false, alreadyStaged: false })).toContain("plan id not reported")
    // The idempotence branch says the gate did NOT stage again.
    const skipped = mechanicalNoticeText({ planId: "plan-xyz", signals: ["B"], explicit: false, alreadyStaged: true })
    expect(skipped).toContain(ALREADY_STAGED_PLAN_PHRASE)
    expect(skipped).not.toContain(STAGED_PLAN_PHRASE + " — plan-xyz")
    expect(skipped).toContain("plan-xyz")
  })

  test("resolveGateMode: the vocabulary, the tolerated booleans, and the fail-safe default", () => {
    expect(resolveGateMode("mechanical")).toBe("mechanical")
    expect(resolveGateMode("advisory")).toBe("advisory")
    expect(resolveGateMode("off")).toBe("off")
    expect(resolveGateMode(true)).toBe("mechanical")
    expect(resolveGateMode(false)).toBe("off")
    // ABSENT and every UNKNOWN value fail safe to mechanical, so a typo cannot disable the gate.
    expect(resolveGateMode(undefined)).toBe("mechanical")
    expect(resolveGateMode("bogus")).toBe("mechanical")
    expect(resolveGateMode(0)).toBe("mechanical")
  })

  test("gatePlanShell fills ONLY what the gate can know, and says so in the description", () => {
    /** The shell for a goal whose first line is long and whose body carries the marker-free goal. */
    const shell = gatePlanShell({ signals: ["B", "D"], goal: "Align   the   bundle\nwith upstream and audit the rest", planPath: ".mpd/plans/x.md" })
    expect(shell.approval).toBe("required")
    expect(shell.name).toBe("Align the bundle")
    expect(shell.name.length).toBeLessThanOrEqual(60)
    expect(shell.description).toContain("complexity signals B/D")
    expect(shell.description).toContain("0 members and 0 tasks")
    expect(shell.description).toContain(".mpd/plans/x.md")
    expect(shell.description).toContain("agent_teams_plan")
    // A one-line goal longer than the cap is CLIPPED, and an empty goal falls back to a fixed name.
    expect(gatePlanShell({ signals: [], goal: "x".repeat(200) }).name.length).toBe(60)
    expect(gatePlanShell({ signals: [], goal: "   " }).name.length).toBeGreaterThan(0)
    // The excerpt is bounded, so one enormous goal cannot bloat every later prompt with it.
    expect(gatePlanShell({ signals: [], goal: "y".repeat(5000) }).description.length).toBeLessThan(1200)
  })
})

describe("readBoulderGate: signal D's only input, repaired to an ACTIVE work", () => {
  /** A reader seam that answers one fixed ledger text, or throws. */
  const readerOf = (text: string | Error): (path: string) => Promise<string> => async () => {
    if (text instanceof Error) throw text
    return text
  }
  /** A ledger whose single work carries the given status, keyed by the active id. */
  const ledger = (status: string | undefined): string => JSON.stringify({
    active_work_id: "w-1",
    works: { "w-1": { ...(status === undefined ? {} : { status }), active_plan: ".mpd/plans/p.md" } },
  })

  test("an ACTIVE work reads active and carries its plan path", async () => {
    /** The verdict for a ledger whose only work is active. */
    const read = await readBoulderGate("/ws", { readFile: readerOf(ledger("active")) })
    expect(read).toEqual({ active: true, status: "active", planPath: ".mpd/plans/p.md" })
  })

  test("a COMPLETED work is silent — this workspace's own ledger must read inactive", async () => {
    // The measured false positive: `.mpd/plans/mpd-seam-convergence.md` survives its completed work.
    expect((await readBoulderGate("/ws", { readFile: readerOf(ledger("completed")) })).active).toBe(false)
    // The RATIFIED conservative reading: a work with NO status is NOT active, unlike the vendor.
    expect((await readBoulderGate("/ws", { readFile: readerOf(ledger(undefined)) })).active).toBe(false)
    // A missing file, malformed JSON, a non-object and a permission error all read inactive.
    expect((await readBoulderGate("/ws", { readFile: readerOf(new Error("ENOENT")) })).active).toBe(false)
    expect((await readBoulderGate("/ws", { readFile: readerOf("{ not json") })).active).toBe(false)
    expect((await readBoulderGate("/ws", { readFile: readerOf("null") })).active).toBe(false)
    expect((await readBoulderGate("/ws", { readFile: readerOf("[]") })).active).toBe(false)
    expect((await readBoulderGate("/ws", { readFile: readerOf(new Error("EACCES")) })).active).toBe(false)
  })

  test("the fallback shape mirrors the vendor, and boulder.dir overrides the workspace", async () => {
    // No active_work_id: the TOP-LEVEL state is the work, which is how a legacy ledger reads.
    const topLevel = JSON.stringify({ status: "active", active_plan: ".mpd/plans/top.md" })
    expect(await readBoulderGate("/ws", { readFile: readerOf(topLevel) })).toEqual({ active: true, status: "active", planPath: ".mpd/plans/top.md" })
    // An id pointing at NOTHING falls back to the top-level state too.
    const dangling = JSON.stringify({ active_work_id: "gone", status: "active" })
    expect((await readBoulderGate("/ws", { readFile: readerOf(dangling) })).active).toBe(true)
    // The state root is `join(root, ".mpd", "boulder.json")` and `boulder.dir` replaces the workspace.
    /** The path the reader was asked for. */
    const seen: string[] = []
    await readBoulderGate("/ws", { boulderDir: "/elsewhere", readFile: async (path) => { seen.push(path); return topLevel } })
    expect(seen[0]).toBe("/elsewhere/.mpd/boulder.json")
    await readBoulderGate("/ws", { readFile: async (path) => { seen.push(path); return topLevel } })
    expect(seen[1]).toBe("/ws/.mpd/boulder.json")
  })

  test("this WORKSPACE's real ledger reads inactive (the measured D repair)", async () => {
    /** The repo root, derived from this test file's own location. */
    const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
    // The repository's own `.mpd/boulder.json`: one COMPLETED work whose plan file still exists.
    /** The real ledger text, read through the injected reader below. */
    const real = readFileSync(join(repoRoot, ".mpd", "boulder.json"), "utf8")
    /** The verdict for that ledger, which must NOT fire signal D any more. */
    const read = await readBoulderGate("", { readFile: async () => real })
    expect(read.active).toBe(false)
    // And the same ledger read through the default `node:fs/promises` reader, from the real root.
    expect((await readBoulderGate(repoRoot)).active).toBe(false)
  })
})

describe("session-start gate: scope, one-shot settlement and the advisory injection", () => {
  test("the MECHANICAL route stages a SHELL through the tool and injects the notice naming its id", async () => {
    /** A double whose composition REGISTERS the staging tool (mpd-team-core is mounted). */
    const harness = planeHarness({ tools: [STAGING_TOOL_NAME] })
    /** Registration-signature lines, asserted to carry the mode. */
    const lines: string[] = []
    /** Warnings the fire reported; this arm is the POSITIVE control and must produce none. */
    const warnings: string[] = []
    /** The gate install, whose resolved mode is asserted. */
    const gate = installSessionGate(harness.dsh as never, {
      warn: (line) => warnings.push(line),
      log: (line) => lines.push(line),
      // The probe POSITIVELY answers "nothing staged" — the only answer that stages in silence.
      stagedPlan: () => null,
    })
    // The DEFAULT mode is mechanical: absent config reads mechanical (the fail-safe).
    expect(gate.mode).toBe("mechanical")
    /** The claimed user turn the gate must judge. */
    const claimed = userMessage("Check the tests, build the package, verify the output.")
    /** The step decision the listener returned for that turn. */
    const decided: any = await harness.steps[0].listener({ messages: [claimed], turn: 1, step: 1, signal: new AbortController().signal }, { kind: "enter", messages: [claimed] })

    // EXACTLY ONE staging call, to the ONE tool, with the live agent and the shell's three fields.
    expect(harness.toolCalls).toHaveLength(1)
    expect(harness.toolCalls[0].name).toBe(STAGING_TOOL_NAME)
    expect(harness.toolCalls[0].agent).toBe(harness.agents[0])
    expect(harness.toolCalls[0].timeoutMs).toBe(5000)
    // THE PROBE ASKS THE CALLING AGENT'S VIEW (2026-10-07): the one-arg host-plane read answers
    // `false` the moment `agent_teams_plan` moves plane, and the ladder would then degrade to
    // advisory with no error anywhere. The agent is the LIVE bound handle, never undefined.
    /** The `hasTool` probes the gate made, each with the view it asked about. */
    const probes = harness.calls.filter((call) => call.seam === "hasTool")
    expect(probes).toHaveLength(1)
    expect(probes[0].args).toEqual([STAGING_TOOL_NAME, harness.agents[0]])
    /** The staging call's arguments, asserted field by field below. */
    const args = harness.toolCalls[0].arguments as { action: string; name: string; description: string; approval: string }
    expect(args.action).toBe("create")
    expect(args.approval).toBe("required")
    expect(args.name).toBe("Check the tests, build the package, verify the output.")
    expect(args.description).toContain("complexity signals C")
    // NOTHING is decomposed: the description states the shell bound outright.
    expect(args.description).toContain("0 members and 0 tasks")
    // The gate reached NO mutation seam directly: the tool IS the single writer of the plan store.
    expect(harness.calls.filter((call) => call.seam.startsWith("team"))).toEqual([])

    expect(decided.kind).toBe("enter")
    expect(decided.messages).toHaveLength(2)
    /** The injected notice, asserted to be the SECOND message. */
    const notice = decided.messages[1]
    expect(notice.role).toBe("user")
    expect(notice.content[0].text.startsWith(STARTUP_NOTICE_MARKER)).toBe(true)
    // The id comes from the CALL, and the notice never claims a team was created.
    expect(notice.content[0].text).toContain(STAGED_PLAN_PHRASE)
    expect(notice.content[0].text).toContain("plan-staged-1")
    expect(notice.content[0].text).toContain(INERT_PLAN_PHRASE)
    expect(notice.content[0].text).not.toContain("NO team was staged")
    // The REPORT line carries the mode and the staged flag (the boot signature a lane asserts).
    expect(lines.join("\n")).toContain("signals=C mode=mechanical staged=1 plan=plan-staged-1")
    // THE POSITIVE CONTROL for the probe's loudness: an ANSWERED "none staged" stages in silence.
    expect(warnings).toEqual([])
    // The claimed user turn is still there (and unchanged: a SOFT signal has no marker).
    expect(decided.messages[0].content[0].text).toBe("Check the tests, build the package, verify the output.")
    // THE RE-ENTRY GUARD: a second step injects nothing and stages nothing more.
    expect(await harness.steps[0].listener({ messages: [claimed], turn: 1, step: 1, signal: new AbortController().signal }, { kind: "enter", messages: [claimed] })).toBeUndefined()
    expect(harness.toolCalls).toHaveLength(1)
  })

  test("the ladder degrades to the ADVISORY notice: tool absent, and a failing call", async () => {
    // (a) NO staging tool in this composition: nothing is called, the advisory notice lands.
    /** A double whose composition does NOT register the staging tool. */
    const withoutTool = planeHarness({ tools: [] })
    installSessionGate(withoutTool.dsh as never, { warn: () => {} })
    /** The turn that triggers the predicate. */
    const claimed = userMessage("Check the tests, build the package, verify the output.")
    /** The decision for the tool-absent arm. */
    const absent: any = await withoutTool.steps[0].listener({ messages: [claimed], turn: 1, step: 1 }, { kind: "enter", messages: [claimed] })
    expect(withoutTool.toolCalls).toEqual([])
    expect(absent.messages[1].content[0].text).toContain("NO team was staged")
    // The ADVISORY rung still asked the AGENT'S view, so the only way this reads false is that the
    // tool is genuinely unreachable THERE — a host-plane read would have answered for a composition
    // the session cannot actually call into.
    expect(withoutTool.calls.find((call) => call.seam === "hasTool")?.args).toEqual([STAGING_TOOL_NAME, withoutTool.agents[0]])

    // (d) THE CALL FAILS: one warning carrying the error, and the ADVISORY notice — never a claim.
    /** A double whose tool call answers an error result. */
    const failing = planeHarness({ tools: [STAGING_TOOL_NAME], toolResult: { ok: false, isError: true, error: "the store is read-only" } })
    /** Warnings the degraded call reported. */
    const warnings: string[] = []
    installSessionGate(failing.dsh as never, { warn: (line) => warnings.push(line) })
    /** The decision for the failing-call arm. */
    const failed: any = await failing.steps[0].listener({ messages: [claimed], turn: 1, step: 1 }, { kind: "enter", messages: [claimed] })
    expect(failing.toolCalls).toHaveLength(1)
    expect(failed.messages[1].content[0].text).toContain("NO team was staged")
    expect(warnings.join(" ")).toContain("staging degraded to the advisory notice")
    expect(warnings.join(" ")).toContain("the store is read-only")
  })

  test("IDEMPOTENCE: a plan the probe REPORTS is never re-staged (a second stage would ARCHIVE it)", async () => {
    /** A double whose composition registers the tool and whose session already has a plan. */
    const harness = planeHarness({ tools: [STAGING_TOOL_NAME] })
    /** Workspaces/sessions the gate's idempotence probe was asked about. */
    const probes: Array<{ workspace: string; sessionId: string }> = []
    installSessionGate(harness.dsh as never, {
      warn: () => {},
      stagedPlan: (workspace, sessionId) => {
        probes.push({ workspace, sessionId })
        return { planId: "plan-already-there" }
      },
    })
    /** The turn that triggers the predicate. */
    const claimed = userMessage("Check the tests, build the package, verify the output.")
    /** The decision for the already-staged arm. */
    const decided: any = await harness.steps[0].listener({ messages: [claimed], turn: 1, step: 1 }, { kind: "enter", messages: [claimed] })
    // NO second staging call: the captain's in-progress plan survives.
    expect(harness.toolCalls).toEqual([])
    expect(probes).toEqual([{ workspace: WORKSPACE, sessionId: "lead-1" }])
    // The notice names the plan that IS staged and says the gate did not stage again.
    expect(decided.messages[1].content[0].text).toContain(ALREADY_STAGED_PLAN_PHRASE)
    expect(decided.messages[1].content[0].text).toContain("plan-already-there")
  })

  test("ID-KEY AGREEMENT: the probe asks the SAME session key the staging tool writes under", async () => {
    // The staging store keys its slot by `sessionId + ".json"` under `<ws>/.mpd/team/staging/`, and
    // the WRITER's chain is `agent.session.id ?? agent.sessionId ?? agent.id`, then the literal
    // "workspace". A probe asking any other key reads a file the write never touches — it answers
    // "nothing staged" for a DIFFERENT slot while the write lands in this one, and the idempotence
    // guard is blind exactly where it matters. All three divergences are pinned below.
    /** The session keys the probes were asked about, in arm order. */
    const asked: string[] = []
    /** Read AND record one probe answer (the positive "nothing staged"). */
    const record = (_workspace: string, sessionId: string): unknown => { asked.push(sessionId); return null }
    /** The turn that triggers the predicate. */
    const claimed = userMessage("Check the tests, build the package, verify the output.")

    // (1) A real session: the SESSION id wins over the agent id.
    /** A handle carrying both a session id and an agent id. */
    const withSession = { id: "agent-7", session: { id: "sess-7", header: { cwd: WORKSPACE, agentPreset: "mpd" } } }
    /** A double over that handle. */
    const one = planeHarness({ agents: [withSession] })
    installSessionGate(one.dsh as never, { warn: () => {}, stagedPlan: record })
    await one.steps[0].listener({ messages: [claimed], turn: 1, step: 1 }, { kind: "enter", messages: [claimed] })
    expect(asked[0]).toBe("sess-7")

    // (2) A handle with NO id at all: the tool files it under `workspace.json`, so the probe must
    //     ask "workspace" — the empty string asked about `.json`, a slot the write never touches.
    /** A qualifying session whose handle carries no id in any spelling. */
    const anonymous = { session: { header: { cwd: WORKSPACE, agentPreset: "mpd" } } }
    /** A double over that anonymous handle. */
    const two = planeHarness({ agents: [anonymous] })
    installSessionGate(two.dsh as never, { warn: () => {}, stagedPlan: record })
    await two.steps[0].listener({ messages: [claimed], turn: 1, step: 1 }, { kind: "enter", messages: [claimed] })
    expect(asked[1]).toBe("workspace")

    // (3) A NON-STRING session id: `??` stops at the first NON-NULLISH candidate, and the tool then
    //     falls to "workspace" rather than walking on to the agent id — the second divergence.
    /** A handle whose session id is a number, with a usable agent id behind it. */
    const numericSession = { id: "agent-9", session: { id: 42, header: { cwd: WORKSPACE, agentPreset: "mpd" } } }
    /** A double over that handle. */
    const three = planeHarness({ agents: [numericSession] })
    installSessionGate(three.dsh as never, { warn: () => {}, stagedPlan: record })
    await three.steps[0].listener({ messages: [claimed], turn: 1, step: 1 }, { kind: "enter", messages: [claimed] })
    expect(asked[2]).toBe("workspace")
    // …and the FLAT spelling is honoured when the session object carries none.
    /** A handle whose session id sits on the flat `sessionId` field. */
    const flat = { id: "agent-10", sessionId: "flat-10", session: { header: { cwd: WORKSPACE, agentPreset: "mpd" } } }
    /** A double over that handle. */
    const four = planeHarness({ agents: [flat] })
    installSessionGate(four.dsh as never, { warn: () => {}, stagedPlan: record })
    await four.steps[0].listener({ messages: [claimed], turn: 1, step: 1 }, { kind: "enter", messages: [claimed] })
    expect(asked[3]).toBe("flat-10")
    // The workspace side of the pair is the same one the tool resolves, always.
    expect(asked).toHaveLength(4)
  })

  test("an UNANSWERABLE probe still stages — and says LOUDLY that a plan may have been ARCHIVED", async () => {
    // The bound, made loud: staging IS the mission, so a probe that cannot answer does not block it.
    // What it must never do is stay SILENT — that is the path where a captain's un-approved plan for
    // this session is moved into `.mpd/team/archive/` without a word.
    /** The turn that triggers the predicate. */
    const claimed = userMessage("Check the tests, build the package, verify the output.")

    // (i) NO probe seam at all (mpdTeams absent from the composition).
    /** A double whose composition registers the tool but supplies no probe. */
    const missing = planeHarness({ tools: [STAGING_TOOL_NAME] })
    /** Warnings the fire reported. */
    const missingWarnings: string[] = []
    installSessionGate(missing.dsh as never, { warn: (line) => missingWarnings.push(line) })
    /** The decision for the missing-probe arm. */
    const stagedAnyway: any = await missing.steps[0].listener({ messages: [claimed], turn: 1, step: 1 }, { kind: "enter", messages: [claimed] })
    expect(missing.toolCalls).toHaveLength(1)
    // The notice is the MECHANICAL one: the plan really was staged, so it is not misreported.
    expect(stagedAnyway.messages[1].content[0].text).toContain(STAGED_PLAN_PHRASE)
    expect(missingWarnings).toHaveLength(1)
    expect(missingWarnings[0]).toContain("staged-plan probe could not answer")
    expect(missingWarnings[0]).toContain("mpdTeams is not mounted")
    // The CONSEQUENCE is named, not implied.
    expect(missingWarnings[0]).toContain("may have been ARCHIVED")

    // (ii) A probe that THROWS (the service is mounted but its read failed).
    /** A double whose probe throws. */
    const throwing = planeHarness({ tools: [STAGING_TOOL_NAME] })
    /** Warnings the throwing arm reported. */
    const throwingWarnings: string[] = []
    installSessionGate(throwing.dsh as never, {
      warn: (line) => throwingWarnings.push(line),
      stagedPlan: () => { throw new Error("mpdTeams read failed") },
    })
    await throwing.steps[0].listener({ messages: [claimed], turn: 1, step: 1 }, { kind: "enter", messages: [claimed] })
    expect(throwing.toolCalls).toHaveLength(1)
    expect(throwingWarnings).toHaveLength(1)
    expect(throwingWarnings[0]).toContain("staged-plan probe could not answer")
    expect(throwingWarnings[0]).toContain("mpdTeams read failed")
    expect(throwingWarnings[0]).toContain("may have been ARCHIVED")
  })

  test("stagedPlanProbe: an UNREADABLE service THROWS instead of answering 'nothing staged'", () => {
    // The F4 boundary at the seam that FEEDS the gate: `null` is the positive "none" answer, a plan
    // is the "staged" answer, and every unreadable shape must THROW so the gate can be loud about
    // the archive risk. Folding these into `undefined` is what made the silent path possible.
    /** A ctx whose `mpdTeams` service is absent (its row has not applied). */
    const absentService = stagedPlanProbe({ get: () => undefined } as never)
    expect(() => absentService("/ws", "s-1")).toThrow("mpdTeams")
    /** A ctx whose service exists but exposes no usable `planFor` (a partial publication). */
    const partialService = stagedPlanProbe({ get: () => ({}) } as never)
    expect(() => partialService("/ws", "s-1")).toThrow("cannot answer")
    /** A ctx whose lookup itself throws, which must surface rather than read as "none". */
    const hostileLookup = stagedPlanProbe({ get: () => { throw new Error("service exploded") } } as never)
    expect(() => hostileLookup("/ws", "s-1")).toThrow("service exploded")

    // The POSITIVE answers stay exactly as the gate's ladder expects them.
    /** Workspaces/sessions the mounted service was asked about. */
    const asked: Array<{ workspace: string; sessionId: string }> = []
    /** A mounted service that answers "nothing staged". */
    const mounted = stagedPlanProbe({
      get: (name: string) => (name === "mpdTeams"
        ? { planFor: (workspace: string, sessionId: string) => { asked.push({ workspace, sessionId }); return { plan: null } } }
        : undefined),
    } as never)
    expect(mounted("/ws", "s-1")).toBeNull()
    expect(asked).toEqual([{ workspace: "/ws", sessionId: "s-1" }])
    /** A mounted service with one plan staged. */
    const staged = stagedPlanProbe({ get: () => ({ planFor: () => ({ plan: { planId: "plan-x" } }) }) } as never)
    expect(staged("/ws", "s-1")).toEqual({ planId: "plan-x" })
  })

  test("team.gate=advisory stages nothing; team.gate=off does nothing at all", async () => {
    /** The turn that triggers the predicate. */
    const claimed = userMessage("Check the tests, build the package, verify the output.")

    // ADVISORY: the tool IS registered, and the mode alone suppresses the staging call.
    /** A double whose composition registers the staging tool. */
    const advisory = planeHarness({ tools: [STAGING_TOOL_NAME] })
    /** The installed gate, whose resolved mode is the ROW-config value. */
    const advisoryGate = installSessionGate(advisory.dsh as never, { warn: () => {}, configValue: (key) => (key === GATE_CONFIG_KEY ? GATE_MODE_ADVISORY : undefined) })
    expect(advisoryGate.mode).toBe(GATE_MODE_ADVISORY)
    /** The advisory-mode decision. */
    const advised: any = await advisory.steps[0].listener({ messages: [claimed], turn: 1, step: 1 }, { kind: "enter", messages: [claimed] })
    expect(advisory.toolCalls).toEqual([])
    expect(advised.messages[1].content[0].text).toContain("NO team was staged")

    // OFF: the listener returns immediately — no notice, no read, no call.
    /** A double whose composition registers the staging tool. */
    const off = planeHarness({ tools: [STAGING_TOOL_NAME] })
    /** The installed gate, whose resolved mode is off. */
    const offGate = installSessionGate(off.dsh as never, { warn: () => {}, configValue: (key) => (key === GATE_CONFIG_KEY ? GATE_MODE_OFF : undefined) })
    expect(offGate.mode).toBe(GATE_MODE_OFF)
    expect(await off.steps[0].listener({ messages: [claimed], turn: 1, step: 1 }, { kind: "enter", messages: [claimed] })).toBeUndefined()
    expect(off.toolCalls).toEqual([])
    // The BOOLEAN spelling is tolerated too (`false` -> off), and anything unknown fails safe.
    expect(installSessionGate(
      planeHarness().dsh as never,
      { warn: () => {}, configValue: (key) => (key === GATE_CONFIG_KEY ? false : undefined) },
    ).mode).toBe(GATE_MODE_OFF)
  })

  test("signal D: an ACTIVE boulder work fires the gate through the injected reader, honours boulder.dir", async () => {
    /** Paths the boulder reader was asked for, proving the state-root resolution. */
    const seen: string[] = []
    /** A double over a workspace whose ledger says one work is ACTIVE. */
    const active = planeHarness()
    installSessionGate(active.dsh as never, {
      warn: () => {},
      readFile: async (path) => { seen.push(path); return JSON.stringify({ active_work_id: "w", works: { w: { status: "active", active_plan: ".mpd/plans/lane.md" } } }) },
    })
    /** The claim the gate must judge, a prompt with no signal of its own. */
    const claimed = userMessage("fix the typo")
    /** The decision for the active-work case, carrying the D notice. */
    const decided: any = await active.steps[0].listener({ messages: [claimed], turn: 1, step: 1 }, { kind: "enter", messages: [claimed] })
    expect(seen[0]).toBe(WORKSPACE + "/.mpd/boulder.json")
    expect(decided.messages[1].content[0].text).toContain("complexity signals D")

    // The `boulder.dir` override replaces the workspace as the STATE ROOT (resolved per call).
    /** A double over an override state root. */
    const overridden = planeHarness()
    installSessionGate(overridden.dsh as never, {
      warn: () => {},
      configValue: (key) => (key === "boulder.dir" ? "/elsewhere" : undefined),
      readFile: async (path) => { seen.push(path); return JSON.stringify({ active_work_id: "w", works: { w: { status: "active" } } }) },
    })
    await overridden.steps[0].listener({ messages: [claimed], turn: 1, step: 1 }, { kind: "enter", messages: [claimed] })
    expect(seen[1]).toBe("/elsewhere/.mpd/boulder.json")

    // A COMPLETED work (this workspace's real shape) leaves the gate silent — the repair's control.
    /** A double whose ledger's only work is completed. */
    const completed = planeHarness()
    installSessionGate(completed.dsh as never, {
      warn: () => {},
      readFile: async () => JSON.stringify({ active_work_id: "w", works: { w: { status: "completed", active_plan: ".mpd/plans/mpd-seam-convergence.md" } } }),
    })
    expect(await completed.steps[0].listener({ messages: [claimed], turn: 1, step: 1 }, { kind: "enter", messages: [claimed] })).toBeUndefined()
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
    installSessionGate(harness.dsh as never, { warn: () => {} })
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

  test("P4: only a FIRING turn registers the agent — an empty or non-firing turn stays unjudged-and-rejudged", async () => {
    /** A double for the settlement arm. */
    const harness = planeHarness()
    /** The gate install, whose acted set must stay empty until a turn really fires. */
    const gate = installSessionGate(harness.dsh as never, { warn: () => {} })
    expect(await harness.steps[0].listener({ messages: [], turn: 1, step: 1, signal: new AbortController().signal }, { kind: "enter", messages: [] })).toBeUndefined()
    expect(gate.acted.size).toBe(0)
    expect(await harness.steps[0].listener({ messages: [], turn: 1, step: 1, signal: new AbortController().signal }, { kind: "reject" })).toBeUndefined()
    // A SIMPLE first turn does not fire and therefore does NOT spend the evaluation…
    /** A turn whose predicate is false. */
    const simple = userMessage("fix the typo")
    expect(await harness.steps[0].listener({ messages: [simple], turn: 1, step: 1 }, { kind: "enter", messages: [simple] })).toBeUndefined()
    expect(gate.acted.size).toBe(0)
    // …so the COMPLEX turn that follows it is still judged, and fires.
    /** The claim that finally fires the gate, after three no-op steps. */
    const claimed = userMessage("Check the tests, build the package, verify the output.")
    /** The decision proving the no-op steps did not spend the evaluation. */
    const decided: any = await harness.steps[0].listener({ messages: [claimed], turn: 1, step: 1, signal: new AbortController().signal }, { kind: "enter", messages: [claimed] })
    expect(decided.messages).toHaveLength(2)
    expect(gate.acted.size).toBe(1)
    // WHICH IS THE POINT OF THE REPAIR: a settled-on-first-turn gate went silent on every session
    // whose opening turn was a lookup, which is the common case.
  })

  test("a contained failure leaves the step untouched (a broken gate never breaks a turn)", async () => {
    /** A double for the contained-failure arm. */
    const harness = planeHarness()
    /** Warnings the gate reported instead of throwing. */
    const warnings: string[] = []
    installSessionGate(harness.dsh as never, { warn: (line) => warnings.push(line) })
    // A throwing workspace resolver is the failure this arm forces:
    const broken = harness.dsh as any
    broken.workspaceRoot = () => { throw new Error("no workspace") }
    /** The claim the broken gate still has to judge. */
    const claimed = userMessage("Check the tests, build the package, verify the output.")
    expect(await harness.steps[0].listener({ messages: [claimed], turn: 1, step: 1, signal: new AbortController().signal }, { kind: "enter", messages: [claimed] })).toBeUndefined()
    expect(warnings.join(" ")).toContain("session-start gate failed")
  })

  test("an explicit team: flag is CONSUMED from the goal text and counts as signal A", async () => {
    /** A double whose composition registers the staging tool, so the flag's route is mechanical. */
    const harness = planeHarness({ tools: [STAGING_TOOL_NAME] })
    installSessionGate(harness.dsh as never, { warn: () => {} })
    /** The user turn carrying the team: marker. */
    const claimed = userMessage("team: redesign the loader")
    /** The decision with the marker consumed and the notice appended. */
    const decided: any = await harness.steps[0].listener({ messages: [claimed], turn: 1, step: 1 }, { kind: "enter", messages: [claimed] })
    expect(decided.messages).toHaveLength(2)
    // CONSUMED: the marker never reaches the model as part of the goal.
    expect(decided.messages[0].content[0].text).toBe("redesign the loader")
    // Signal A fired on its own (a two-word goal carries no soft signal), and the shell's
    // description records it — and the shell's NAME comes from the consumed goal, not the marker.
    const args = harness.toolCalls[0].arguments as { name: string; description: string }
    expect(args.name).toBe("redesign the loader")
    expect(args.description).toContain("complexity signals A")
    expect(decided.messages[1].content[0].text).toContain("CONSUMED")
    expect(decided.messages[1].content[0].text).toContain(STAGED_PLAN_PHRASE)
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
    installSessionGate(adapter as never, { warn: () => {} })

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
    installSessionGate(harness.dsh as never, { warn: () => {} })
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
    installSessionGate(simpleHarness.dsh as never, { warn: () => {} })
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
    // C8 REPAIR (2026-10-07): a producer-owned turn is NO goal — not even when it is the only
    // user-role message in the list. The old fallback answered the runtime-context snapshot here,
    // which is the "judged a message no human wrote" half of the defect; with a `team-message`
    // instead of a snapshot the SAME fallback staged a spurious shell. `undefined` leaves the
    // session UNREGISTERED, so its first real turn is still the one that gets evaluated.
    expect(latestUserMessage([injected])).toBeUndefined()
    // Untagged messages keep the old "last user-role message with text" behaviour.
    const untagged = { id: "u", role: "user", content: [{ type: "text", text: "legacy" }] }
    expect(latestUserMessage([untagged])?.text).toBe("legacy")
    // …and the tagged goal beside an untagged one still wins, in either order.
    expect(latestUserMessage([untagged, injected])?.text).toBe("legacy")
    expect(latestUserMessage([injected, goal])?.text).toBe("do the thing")
  })
})

/**
 * THE PROMPT/IMPLEMENTATION DRIFT GUARD (P5, 2026-10-07).
 *
 * The shipped preset's SESSION STARTUP RULE is the only prompt-side statement of this gate, and it
 * drifted from the implementation: it still said a triggered soft signal "only ADVISES" and that an
 * explicit request was merely "routed to team mode", while the gate now STAGES a plan shell by
 * default. A prompt that describes a contract the code does not implement is worse than no prompt:
 * the model obeys the text, not the code.
 *
 * The four strings below are the coupling. They belong to the preset lane's edit, and this test is
 * where the drift reddens — the mode NAME a reader can set, the notice MARKER every notice carries,
 * the STAGING TOOL the gate calls, and the ABSENCE of the two sentences the mechanical gate makes
 * false. It reads the shipped file, so a change to either side alone is caught.
 */
describe("the mpd preset states the MECHANICAL gate contract (prompt/implementation drift guard)", () => {
  test("the preset names team.gate, the marker and the staging tool, and drops the drifted sentences", () => {
    /** The repo root, derived from this test file's own location. */
    const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
    /** The shipped preset patch, read verbatim. */
    const preset = readFileSync(join(repoRoot, "presets", "mpd.patch.yml"), "utf8")
    // The mode name the reader must be able to set (and the default it documents).
    expect(preset).toContain(GATE_CONFIG_KEY)
    // The frozen notice marker, so the prompt and the notice agree on the string a boot looks for.
    expect(preset).toContain(STARTUP_NOTICE_MARKER)
    // The tool the mechanical gate actually calls — the prompt must not send the captain elsewhere.
    expect(preset).toContain(STAGING_TOOL_NAME)
    // The drifted sentences: an explicit request is no longer merely "routed" to team mode, and a
    // triggered soft signal does not "only ADVISES".
    expect(preset).not.toContain(DRIFTED_ADVISORY_SENTENCE)
    expect(preset).not.toContain("the gate only ADVISES")
    expect(preset).not.toContain("it stages NOTHING")
  })
})

// ── C7/C8 + signal E (wave `de-vendor-and-verify-law`, Lane C) ──
// The three repairs the wave's measured defects produced, each with a FALSIFIABLE twin: the
// positive arm and the arm that must stay silent move ONE field, so a blanket "always fires" or
// "never fires" implementation cannot pass both.
describe("signal E: a CJK-scale instruction fires where the English-centric signals cannot", () => {
  /** The user's VERBATIM instruction from `.mpd/plans/de-vendor-and-verify-law.md`, byte-for-byte. */
  const VERBATIM = "脱去该项目对于Oh-my-openagent与dsh-agent-teams项目的源码的所有依赖及检查，文档里只写参考鸣谢与License；"
    + "验证当前工作量门，现在貌似用户只要不提，不论如何都不会建队；不论如何工作量，帮我找一个办法尽量避免面向用户的主代理去直接写/验证代码，"
    + "做这些事情由子代理去干，并且该插件的PRESET硬要求无论什么模式下，A写出来的一部分代码必须由B验证，两agent必须独立，"
    + "且要求不直接看代码只看文档，若有问题打回去改"

  test("the user's verbatim Chinese instruction triggers, and E is the signal that carries it", () => {
    /** The shipped predicate's verdict on the measured defect case. */
    const verdict = evaluateComplexityGate(VERBATIM)
    expect(verdict.trigger).toBe(true)
    expect(verdict.signals).toContain("E")
  })

  test("BOTH conjuncts are load-bearing: scale without verbs and verbs without scale stay silent", () => {
    // Scale alone: 70 Han characters of pure question, zero lexicon verbs.
    const scaleOnly = "请解释一下这个项目里面 preset 和 profile 究竟有什么区别，"
      + "它们分别在什么时候生效，为什么会这样设计，以及这样安排对我们平时的工作到底有什么好处，最后用三句话总结一下"
    expect(evaluateComplexityGate(scaleOnly).trigger).toBe(false)
    // Verbs alone: the lexicon present, far below the scale bound.
    expect(evaluateComplexityGate("验证一下").trigger).toBe(false)
    expect(evaluateComplexityGate("修复并验证").trigger).toBe(false)
  })

  test("the frozen Chinese NEGATIVE controls stay silent (the language fix is not a blanket 'fires on CJK')", () => {
    expect(evaluateComplexityGate("这个函数是干什么的？").trigger).toBe(false)
    expect(evaluateComplexityGate("读一下 AGENTS.md 的第一节，然后告诉我它说了什么").trigger).toBe(false)
    expect(evaluateComplexityGate("帮我看下 src/index.ts 第 42 行").trigger).toBe(false)
  })

  test("the full-width clause separators enumerate a one-line Chinese plan", () => {
    // Three action clauses joined by `，` — impossible before the separator set carried `，，。；：`.
    expect(evaluateComplexityGate("移除旧的检查，迁移配置，验证结果").signals).toContain("C")
    // The ASCII set alone never split those clauses: the same three verbs WITHOUT the separators
    // are one clause, which is below C3's bound.
    expect(evaluateComplexityGate("移除旧的检查迁移配置验证结果").signals).not.toContain("C")
  })
})

describe("C8: an inbound agent message is never judged as the human turn", () => {
  /** One user-role message with a text block and an optional producer-owned source kind. */
  const message = (text: string, kind?: string): unknown => ({
    role: "user",
    content: [{ type: "text", text }],
    ...(kind === undefined ? {} : { source: { kind } }),
  })
  /** A teammate report that WOULD fire signal C if it were judged as a human turn. */
  const REPORT = "1. Audit the gates\n2. Implement the change\n3. Verify the boot"

  test("a `team-message` and a relayed `agent-message` are excluded; the SAME text as a human turn is not", () => {
    // The falsifiability twin first: judged as the caller's own turn, this text fires signal C.
    expect(evaluateComplexityGate(REPORT).signals).toEqual(["C"])
    // Tagged as a teammate report (the official team plugin's own source shape), it is not the goal.
    expect(latestUserMessage([message(REPORT, "team-message")])).toBeUndefined()
    expect(latestUserMessage([message(REPORT, "agent-message")])).toBeUndefined()
    expect(latestUserMessage([message(REPORT, "runtime-context")])).toBeUndefined()
    expect(latestUserMessage([message(REPORT, "subagent-settled")])).toBeUndefined()
    // …and the human turn beside it still wins, whatever order the two arrive in.
    expect(latestUserMessage([message("fix the typo", "user"), message(REPORT, "team-message")])?.text).toBe("fix the typo")
    expect(latestUserMessage([message(REPORT, "team-message"), message("fix the typo", "user")])?.text).toBe("fix the typo")
  })

  test("an UNTAGGED message stays eligible (the host that tags nothing keeps its gate)", () => {
    expect(latestUserMessage([message("untagged turn")])?.text).toBe("untagged turn")
    // A message with no text at all is still skipped, tagged or not.
    expect(latestUserMessage([{ role: "user", content: [] }])).toBeUndefined()
    expect(latestUserMessage([])).toBeUndefined()
  })
})

describe("C7: a session already LEADING a team is never sent to stage one", () => {
  /** One team record as `mpd-team-core` writes it, with only the fields this reader judges. */
  const record = (leadSessionId: string, members: number): string => JSON.stringify({
    version: 1,
    teamId: "team-20261007102205",
    leadSessionId,
    members: Array.from({ length: members }, (_, index) => ({ id: "M" + String(index + 1) })),
    tasks: [],
  })
  /** A lister seam answering one fixed directory listing, and a reader keyed by file name. */
  const seams = (files: Record<string, string>): { readDir: (path: string) => Promise<readonly string[]>; readFile: (path: string) => Promise<string>; listed: string[] } => {
    /** Every directory the reader was asked to list. */
    const listed: string[] = []
    return {
      listed,
      readDir: async (path: string): Promise<readonly string[]> => { listed.push(path); return Object.keys(files) },
      readFile: async (path: string): Promise<string> => {
        /** The record file name this read asked for. */
        const name = path.slice(path.lastIndexOf("/") + 1)
        if (!(name in files)) throw new Error("ENOENT " + path)
        return files[name]
      },
    }
  }

  test("this session's OWN record with members reads leading; another session's does not", async () => {
    /** The injected seams, listing one record led by `me`. */
    const mine = seams({ "team-a.json": record("me", 3) })
    expect(await readLeadingTeam("/ws", "me", mine)).toEqual({ leading: true, teamId: "team-20261007102205", members: 3 })
    // The record directory resolves under the WORKSPACE, exactly like the boulder ledger's root.
    expect(mine.listed[0]).toBe("/ws/.mpd/team/teams")
    // The falsifiability twin: the SAME record, one `leadSessionId` field moved.
    expect(await readLeadingTeam("/ws", "someone-else", seams({ "team-a.json": record("me", 3) }))).toEqual({ leading: false, members: 0 })
  })

  test("a 0-member record is a STAGED SHELL, not a team, so the gate may still stage", async () => {
    expect(await readLeadingTeam("/ws", "me", seams({ "team-a.json": record("me", 0) }))).toEqual({ leading: false, members: 0 })
  })

  test("every failure path reads NOT leading, and never throws", async () => {
    // A missing directory, an unreadable record beside a good one, malformed JSON and an empty id.
    expect(await readLeadingTeam("/ws", "me", { readDir: async () => { throw new Error("ENOENT") } })).toEqual({ leading: false, members: 0 })
    expect(await readLeadingTeam("/ws", "me", { readDir: async () => ["a.json", "README.md"], readFile: async () => "{ not json" })).toEqual({ leading: false, members: 0 })
    expect(await readLeadingTeam("/ws", "me", seams({ "a.json": "null", "b.json": "[]" }))).toEqual({ leading: false, members: 0 })
    expect(await readLeadingTeam("/ws", "", seams({ "team-a.json": record("", 3) }))).toEqual({ leading: false, members: 0 })
    // A NON-JSON entry is skipped while a readable record beside it still answers.
    expect(await readLeadingTeam("/ws", "me", seams({ "notes.txt": "ignored", "team-a.json": record("me", 1) }))).toEqual({ leading: true, teamId: "team-20261007102205", members: 1 })
  })

  test("WIRING: a session already leading a team stages NOTHING and injects NO notice", async () => {
    /** A strong prompt that fires signal C on its own — the "even on a strong human prompt" arm. */
    const strong = "1. Audit the gates\n2. Implement the change\n3. Verify the boot"
    /** One team record naming `leadSessionId` with the given member count. */
    const recordJson = (leadSessionId: string, members: number): string => JSON.stringify({
      teamId: "team-1",
      leadSessionId,
      members: Array.from({ length: members }, (_, index) => ({ id: "M" + String(index + 1) })),
    })
    /** Drive ONE step of a fresh harness whose team-record seams answer the given record. */
    const stepWith = async (teamRecord: string | null): Promise<{ out: any; toolCalls: number }> => {
      /** The recording adapter double, with the staging tool genuinely registered. */
      const harness = planeHarness({ tools: [STAGING_TOOL_NAME] })
      installSessionGate(harness.dsh as never, {
        warn: () => {},
        readDir: async (): Promise<readonly string[]> => (teamRecord === null ? [] : ["team-1.json"]),
        readFile: async (): Promise<string> => teamRecord ?? "{}",
      })
      /** The goal message the step claims. */
      const goal = userMessage(strong)
      /** The step listener's return value: the rewritten decision, or undefined when it abstained. */
      const out: any = await harness.steps[0].listener(
        { messages: [goal], turn: 1, step: 1, signal: new AbortController().signal },
        { kind: "enter", messages: [goal] },
      )
      return { out, toolCalls: harness.toolCalls.length }
    }
    // The guard: THIS session (id "lead-1") already leads a team that names 3 members.
    expect(await stepWith(recordJson("lead-1", 3))).toEqual({ out: undefined, toolCalls: 0 })
    // FALSIFIABILITY, two arms: the SAME record under another session's id, and a 0-member SHELL —
    // both must proceed and stage, so the guard cannot pass by never staging at all.
    expect(await stepWith(recordJson("someone-else", 3))).toEqual({ out: expect.anything(), toolCalls: 1 })
    expect((await stepWith(recordJson("lead-1", 0))).toolCalls).toBe(1)
    // …and with NO team at all the gate stages too (the every-session baseline).
    expect((await stepWith(null)).toolCalls).toBe(1)
  })

  test("the DEFAULT reader walks a real `.mpd/team/teams` directory (the live boot's path)", async () => {
    // A REAL directory, never a fixture: the same `node:fs/promises` readers a boot uses, so a
    // renamed record field or a moved directory reddens here rather than in a live arm.
    const probe = mkdtempSync(join(tmpdir(), "mpd-leading-team-"))
    try {
      mkdirSync(join(probe, ".mpd", "team", "teams"), { recursive: true })
      writeFileSync(join(probe, ".mpd", "team", "teams", "team-x.json"), record("sess-live", 2))
      expect(await readLeadingTeam(probe, "sess-live")).toEqual({ leading: true, teamId: "team-20261007102205", members: 2 })
      // The one-field twin: the SAME directory, a session id the record does not name.
      expect(await readLeadingTeam(probe, "another-session")).toEqual({ leading: false, members: 0 })
      // A workspace with NO team directory at all: the every-session case, silent.
      expect(await readLeadingTeam("/nonexistent-workspace-mpd", "sess-live")).toEqual({ leading: false, members: 0 })
    } finally {
      rmSync(probe, { recursive: true, force: true })
    }
  })
})
