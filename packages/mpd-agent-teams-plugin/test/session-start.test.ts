import { test, expect } from "bun:test"
import { mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
// The adopted session-start policy is vendored JavaScript with no declaration file, so the gate,
// the notices and the policy installer all arrive untyped.
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import { DEFAULT_TEAM_NAME, STARTUP_NOTICE_MARKER, advisoryNotice, availableTeamId, consumeExplicitFlag, evaluateComplexityGate, instructNotice, installSessionTeamPolicy, policyEnabled, policyQualifies, provisionedNotice, routeDecision, spliceNotice } from "../lib/session-start.ts"
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import { createMessage } from "../_deps/dsh-llm/lib/index.ts"

/** One message the plugin injects or claims: durable id, role, text blocks and provenance. */
type NoticeMessage = {
  /** Durable message id; the splice arm asserts the insertion order through it. */
  readonly id: string
  /** Role the host attributes the message to; every notice is a user-role message. */
  readonly role: string
  /** Content blocks; every arm reads the first text block. */
  readonly content: { readonly text: string }[]
  /** Provenance the plugin records; `reason` names which notice was injected. */
  readonly source: { readonly reason?: string }
}

/** The pre-step decision the `agent/pre-step` waterfall forwards between plugins. */
type WaterfallDecision = {
  /** Outcome the host acts on; `enter` runs the step with the returned messages. */
  readonly kind: string
  /** Messages the step runs on. */
  readonly messages: NoticeMessage[]
}

/** The step payload the policy listener is handed for one step. */
type PreStepPayload = {
  /** The session the step belongs to, rooted at the fixture workspace. */
  readonly agent: { readonly id: string; readonly session: { readonly header: { readonly cwd: string } } }
  /** Messages claimed by this step; an injected notice is spliced in after them. */
  readonly messages: NoticeMessage[]
}

/** One `agent/pre-step` registration the fixture captured, so an arm can drive the waterfall. */
type PreStepListener = {
  /** Waterfall name the policy registered on; pinned to `agent/pre-step` by the assertion. */
  readonly name: string
  /** The listener body, called with the step payload and the inner continuation. */
  readonly handler: (payload: PreStepPayload, next: () => Promise<WaterfallDecision>) => Promise<WaterfallDecision>
}

/** One captain session header stub; both parent and preset are omitted to model a top-level session. */
function makeAgent({ parentSession, agentPreset }: { parentSession?: string; agentPreset?: string }): { id: string; session: { header: { cwd: string; parentSession?: string; agentPreset?: string } } } {
  return { id: "session-test-captain", session: { header: { cwd: "/tmp", ...(parentSession === undefined ? {} : { parentSession }), ...(agentPreset === undefined ? {} : { agentPreset }) } } }
}

/** Temp state root plus its teardown, so every arm cleans up the team records it wrote. */
function edgeStateRoot(name: string): { dir: string; cleanup: () => void } {
  /** Fresh temp directory used as the `.agent-teams` state root. */
  const dir = mkdtempSync(join(tmpdir(), name))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/** Write a minimal live team record under the state root, so the id counts as taken. */
function writeTeam(stateRoot: string, teamId: string): void {
  mkdirSync(join(stateRoot, teamId, "inbox"), { recursive: true })
  writeFileSync(join(stateRoot, teamId, "team.json"), JSON.stringify({ id: teamId, name: "taken", captainSessionId: "session-other", createdAt: Date.now(), members: [], tasks: [], taskSeq: 0 }))
}

test("policyEnabled: off disables unless the autoRoute gate is enabled", () => {
  expect(policyEnabled(undefined)).toBe(false)
  expect(policyEnabled({ mode: "off" })).toBe(false)
  // `off` DECOUPLES the mechanical gate: autoRoute keeps the policy installed.
  expect(policyEnabled({ mode: "off", autoRoute: true })).toBe(true)
  expect(policyEnabled({ mode: "auto" })).toBe(true)
  expect(policyEnabled({ mode: "instruct" })).toBe(true)
})

test("policyQualifies: child sessions never qualify", () => {
  /** Baseline policy: off plus the autoRoute gate, scoped to the `mpd` preset. */
  const policy = { mode: "off", autoRoute: true, presets: ["mpd"] }
  expect(policyQualifies(policy, makeAgent({ agentPreset: "mpd" }))).toBe(true)
  expect(policyQualifies(policy, makeAgent({ parentSession: "session-parent", agentPreset: "mpd" }))).toBe(false)
})

test("policyQualifies: allow-list scoping and preset-less coverage", () => {
  /** The same allow-list narrowed to one preset name, to pin the scoping rule. */
  const mpdOnly = { mode: "off", autoRoute: true, presets: ["mpd"] }
  expect(policyQualifies(mpdOnly, makeAgent({ agentPreset: "mpd" }))).toBe(true)
  expect(policyQualifies(mpdOnly, makeAgent({ agentPreset: "standard" }))).toBe(false)
  // Sessions without any preset (headless direct driver / legacy installs)
  // deploy the bundle itself and stay covered.
  expect(policyQualifies(mpdOnly, makeAgent({}))).toBe(true)
  // Empty allow-list = every top-level session.
  expect(policyQualifies({ mode: "off", autoRoute: true, presets: [] }, makeAgent({ agentPreset: "standard" }))).toBe(true)
})

test("availableTeamId: free base, deterministic per-captain suffix, exhaustion", async () => {
  /** Temp state root the id allocator reads and writes. */
  const s = edgeStateRoot("mpd-session-test-")
  try {
    // Free base name.
    expect(await availableTeamId(s.dir, DEFAULT_TEAM_NAME, "session-A")).toBe("mpd-default")
    // Taken base → deterministic suffixed id, stable across calls.
    writeTeam(s.dir, "mpd-default")
    /** First allocated id for the taken base; the second call must return the same one. */
    const first = await availableTeamId(s.dir, DEFAULT_TEAM_NAME, "session-A")
    expect(first).toMatch(/^mpd-default-[0-9a-f]{8}$/)
    expect(await availableTeamId(s.dir, DEFAULT_TEAM_NAME, "session-A")).toBe(first)
    // A different captain gets its own digest suffix.
    const other = await availableTeamId(s.dir, DEFAULT_TEAM_NAME, "session-B")
    expect(other).not.toBe(first)
    // Occupy both of session-A's candidates (base + its deterministic suffix)
    // to force the exhaustion path.
    writeTeam(s.dir, other)
    writeTeam(s.dir, first)
    await expect(availableTeamId(s.dir, DEFAULT_TEAM_NAME, "session-A")).rejects.toThrow(/both taken/)
  } finally {
    s.cleanup()
  }
})

test("notices carry the startup marker, mention the team, and are user-role messages", () => {
  /** Provisioning notice for a staged team, built from a two-signal trigger. */
  const notice = provisionedNotice({ name: "MPD Default", id: "mpd-default-abc123", profile: { name: "mpd" }, phase: "staged", taskSeq: 0, tasks: [] }, ["C2", "C3"])
  expect(notice.role).toBe("user")
  expect(notice.content[0].text).toContain(STARTUP_NOTICE_MARKER)
  expect(notice.content[0].text).toContain("MPD Default")
  // The gated wording states the session was ROUTED BY THE GATE — never that a
  // team is a mandatory precondition (the inverted invariant).
  expect(notice.content[0].text).toContain("routed by the complexity gate")
  expect(notice.content[0].text).toContain("NOT a precondition")
  expect(notice.content[0].text).toContain("C2/C3")
  expect(notice.source.reason).toBe("session-start-provision")

  /** Instruct-mode notice, which must name the explicit create call instead of a route. */
  const instructed = instructNotice({ profile: "mpd" })
  expect(instructed.content[0].text).toContain(STARTUP_NOTICE_MARKER)
  expect(instructed.content[0].text).toContain("agent_teams_create")
  expect(instructed.content[0].text).toContain('profile="mpd"')
})

test("advisory notice: marker, fired signals, NO team staged, on-demand staging path", () => {
  /** Advisory notice for a soft C trigger, the one path that stages nothing. */
  const notice = advisoryNotice(["C"], { profile: "mpd" })
  expect(notice.role).toBe("user")
  /** Text of the first content block, which every assertion below reads. */
  const text = notice.content[0].text
  expect(text).toContain(STARTUP_NOTICE_MARKER)
  // the fired signals are named
  expect(text).toContain("complexity signals C")
  // ... and the absence of a team is stated plainly
  expect(text).toContain("NO team was staged")
  // ... with the on-demand staging path the captain is told to use
  expect(text).toContain('agent_teams_create(approval="required", profile="mpd")')
  // ... and the other half of the clause: continue solo and say so
  expect(text).toContain("continue solo")
  expect(notice.source.reason).toBe("session-start-advisory")
  // Clause-3 consistency: the notice names the NORMAL-mode default only and says nothing
  // about automatic approval — a ULW run stages with approval="automatic", which the
  // advisory must not forbid (it must not speak about it at all).
  expect(text).not.toContain('approval="automatic"')
})

test("installSessionTeamPolicy: a triggered SOFT auto-route injects the advisory and stages NO team", async () => {
  /** Temp session workspace the policy's state root lives under. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-l3-advisory-"))
  try {
    /** Every listener the policy registered, so the arm can drive the waterfall itself. */
    const listeners: PreStepListener[] = []
    /** The plugin-context stub; only the `on` seam and the logger are touched. */
    const ctx = {
      on: (name: string, handler: PreStepListener["handler"]): number => listeners.push({ name, handler }),
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    }
    /** State root the policy would stage into, relative to the workspace. */
    const stateDir = join(".mpd", "team")
    installSessionTeamPolicy(ctx, { stateDir, sessionTeamPolicy: { mode: "off", autoRoute: true, profile: "mpd" } })
    expect(listeners.length).toBe(1)
    expect(listeners[0].name).toBe("agent/pre-step")
    /** The claimed user turn, carrying the four-step prompt the complexity gate fires on. */
    const user: NoticeMessage = createMessage({ role: "user", content: [{ type: "text", text: "1. Read the patch file\n2. Audit the gates\n3. Implement the change\n4. Verify the boot" }], source: { kind: "user" } })
    /** The step payload the listener is driven with: one live session and the claimed turn. */
    const payload = { agent: { id: "l3-advisory-captain", session: { header: { cwd: workspace } } }, messages: [user] }
    /** The decision the policy returned, whose injected notice the arm then asserts on. */
    const decision = await listeners[0].handler(payload, async () => ({ kind: "enter", messages: [...payload.messages] }))
    // the notice IS injected (after the claimed message, via spliceNotice) ...
    expect(decision.kind).toBe("enter")
    expect(decision.messages.length).toBe(2)
    expect(decision.messages[0].id).toBe(user.id)
    /** The injected notice, the second and last message of the decision. */
    const notice = decision.messages[1]
    expect(notice.role).toBe("user")
    expect(notice.content[0].text).toContain(STARTUP_NOTICE_MARKER)
    expect(notice.content[0].text).toContain("NO team was staged")
    expect(notice.content[0].text).toContain('agent_teams_create(approval="required", profile="mpd")')
    // ... and NOTHING was staged: the state root carries no team record at all
    const stateRoot = join(workspace, stateDir)
    /** Team ids the state root holds, with `archive` excluded; staging would leave one here. */
    const teamIds = (() => {
      try {
        return readdirSync(stateRoot).filter((name) => name !== "archive")
      } catch {
        return []
      }
    })()
    expect(teamIds).toEqual([])
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test("complexity gate: both directions on the frozen prompt sets", () => {
  /** Prompts that must NOT trip the gate, one per sub-signal it stays under. */
  const simple = [
    "Reply with exactly: hello-ok",
    "What does the git-master skill do? Answer in one sentence.",
    "Rename the variable `foo` to `bar` in src/util.ts and run its test.",
  ]
  /** Prompts that MUST trip the gate, covering the explicit flag and the C majority. */
  const complex = [
    "Align the bundle with upstream: audit the orchestration surface, then implement the routing change.",
    "team: fix the flaky test",
    "1. Read the patch file\n2. Audit the gates\n3. Implement the change\n4. Verify the boot",
  ]
  for (const prompt of simple) {
    /** Explicit-flag consumption for this prompt; none of the simple prompts sets one. */
    const consumed = consumeExplicitFlag(prompt)
    /** Gate verdict for the consumed text, which must stay untriggered. */
    const verdict = evaluateComplexityGate(consumed.text, { explicitFlag: consumed.flagged })
    expect(verdict.trigger).toBe(false)
  }
  for (const prompt of complex) {
    /** Explicit-flag consumption for this prompt. */
    const consumed = consumeExplicitFlag(prompt)
    /** Gate verdict for the consumed text, which must trigger. */
    const verdict = evaluateComplexityGate(consumed.text, { explicitFlag: consumed.flagged })
    expect(verdict.trigger).toBe(true)
  }
  // The corrected C aggregation: a single C sub-signal is NOT enough for C...
  const cOnly = evaluateComplexityGate("check the test", {})
  expect(cOnly.signals).not.toContain("C")
  // ...but the frozen complex prompt's 2-of-3 majority yields exactly one "C" signal.
  expect(evaluateComplexityGate("Align the bundle with upstream: audit the orchestration surface, then implement the routing change.").signals).toEqual(["C"])
  // D participates as its own soft signal and reaches the gate on its own bar.
  expect(evaluateComplexityGate("do the thing", { planArtifact: true })).toEqual({ trigger: true, signals: ["D"] })
})

test("explicit flag is consumed out of the goal text", () => {
  expect(consumeExplicitFlag("team: fix the flaky test")).toEqual({ flagged: true, text: "fix the flaky test" })
  expect(consumeExplicitFlag("  team:   do it")).toEqual({ flagged: true, text: "do it" })
  /** The consumption result for the `!team` spelling, whose marker must be stripped too. */
  const body = consumeExplicitFlag("please !team handle it")
  expect(body.flagged).toBe(true)
  expect(body.text).not.toContain("!team")
  expect(consumeExplicitFlag("no flag here")).toEqual({ flagged: false, text: "no flag here" })
})

test("routeDecision: a triggered auto-route ADVISES; explicit flag / auto / instruct keep provisioning", async () => {
  /** One untriggered prompt, used to pin that a plain reply routes nowhere. */
  const simple = "Reply with exactly: hello-ok"
  /** One four-step prompt that trips the gate on its own. */
  const complex = "1. Read the patch file\n2. Audit the gates\n3. Implement the change\n4. Verify the boot"
  // Gate default: off + autoRoute -> only the complex text routes, and it routes ADVISORY:
  // the plugin stages nothing while complexity is merely being judged (user clause 4).
  expect((await routeDecision({ mode: "off", autoRoute: true }, simple, "/nonexistent-ws")).action).toBe("none")
  /** The routing decision for the complex prompt under the default gate. */
  const routed = await routeDecision({ mode: "off", autoRoute: true }, complex, "/nonexistent-ws")
  expect(routed.action).toBe("advise")
  // t24/F1: C is ONE signal that already enforces its own 2-of-3 sub-signal majority,
  // so a complex prompt may legitimately route on the single "C" signal.
  expect(routed.signals.length).toBeGreaterThanOrEqual(1)
  expect(routed.signals).toContain("C")
  // An explicit request is NOT advisory: `team:` alone still PROVISIONS (R4).
  const flagged = await routeDecision({ mode: "off", autoRoute: true }, "team: do it", "/nonexistent-ws")
  expect(flagged.signals).toContain("A")
  expect(flagged.action).toBe("provision")
  // `!team` is the same explicit request.
  expect((await routeDecision({ mode: "off", autoRoute: true }, "please !team handle it", "/nonexistent-ws")).action).toBe("provision")
  // autoRoute disabled -> nothing routes even for complex text.
  expect((await routeDecision({ mode: "off", autoRoute: false }, complex, "/nonexistent-ws")).action).toBe("none")
  // Legacy opt-ins are preserved.
  expect((await routeDecision({ mode: "auto" }, simple, "/nonexistent-ws")).action).toBe("provision")
  expect((await routeDecision({ mode: "instruct" }, simple, "/nonexistent-ws")).action).toBe("instruct")
})

test("spliceNotice inserts after the last claimed message and preserves the decision", () => {
  /** The messages this step claimed, which the notice must land directly behind. */
  const claimed: NoticeMessage[] = [createMessage({ role: "user", content: [{ type: "text", text: "hello" }], source: { kind: "user" } })]
  /** A pre-existing plugin message that follows the claimed turn and must stay behind it. */
  const context: NoticeMessage = createMessage({ role: "user", content: [{ type: "text", text: "context" }], source: { kind: "plugin", plugin: "x" } })
  /** The input decision whose message order the splice must preserve. */
  const decision = { kind: "enter", messages: [...claimed, context] }
  /** The notice to splice in, in instruct mode. */
  const notice: NoticeMessage = instructNotice({ profile: "mpd" })
  /** The merged decision, whose message order is the unit under test. */
  const merged: WaterfallDecision = spliceNotice(decision, claimed, notice)
  expect(merged.kind).toBe("enter")
  expect(merged.messages.map((m) => m.id)).toEqual([claimed[0].id, notice.id, context.id])
  expect(merged.messages[1].content[0].text).toContain(STARTUP_NOTICE_MARKER)
})