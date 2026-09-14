import { test, expect } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DEFAULT_TEAM_NAME, STARTUP_NOTICE_MARKER, availableTeamId, consumeExplicitFlag, evaluateComplexityGate, instructNotice, policyEnabled, policyQualifies, provisionedNotice, routeDecision, spliceNotice } from "../lib/session-start.js"
import { createMessage } from "../_deps/dsh-llm/lib/index.js"

function makeAgent({ parentSession, agentPreset }) {
  return { id: "session-test-captain", session: { header: { cwd: "/tmp", ...(parentSession === undefined ? {} : { parentSession }), ...(agentPreset === undefined ? {} : { agentPreset }) } } }
}

function edgeStateRoot(name) {
  const dir = mkdtempSync(join(tmpdir(), name))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function writeTeam(stateRoot, teamId) {
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
  const policy = { mode: "off", autoRoute: true, presets: ["mpd"] }
  expect(policyQualifies(policy, makeAgent({ agentPreset: "mpd" }))).toBe(true)
  expect(policyQualifies(policy, makeAgent({ parentSession: "session-parent", agentPreset: "mpd" }))).toBe(false)
})

test("policyQualifies: allow-list scoping and preset-less coverage", () => {
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
  const s = edgeStateRoot("mpd-session-test-")
  try {
    // Free base name.
    expect(await availableTeamId(s.dir, DEFAULT_TEAM_NAME, "session-A")).toBe("mpd-default")
    // Taken base → deterministic suffixed id, stable across calls.
    writeTeam(s.dir, "mpd-default")
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

  const instructed = instructNotice({ profile: "mpd" })
  expect(instructed.content[0].text).toContain(STARTUP_NOTICE_MARKER)
  expect(instructed.content[0].text).toContain("agent_teams_create")
  expect(instructed.content[0].text).toContain('profile="mpd"')
})

test("complexity gate: both directions on the frozen prompt sets", () => {
  const simple = [
    "Reply with exactly: hello-ok",
    "What does the git-master skill do? Answer in one sentence.",
    "Rename the variable `foo` to `bar` in src/util.ts and run its test.",
  ]
  const complex = [
    "Align the bundle with upstream: audit the orchestration surface, then implement the routing change.",
    "team: fix the flaky test",
    "1. Read the patch file\n2. Audit the gates\n3. Implement the change\n4. Verify the boot",
  ]
  for (const prompt of simple) {
    const consumed = consumeExplicitFlag(prompt)
    const verdict = evaluateComplexityGate(consumed.text, { explicitFlag: consumed.flagged })
    expect(verdict.trigger).toBe(false)
  }
  for (const prompt of complex) {
    const consumed = consumeExplicitFlag(prompt)
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
  const body = consumeExplicitFlag("please !team handle it")
  expect(body.flagged).toBe(true)
  expect(body.text).not.toContain("!team")
  expect(consumeExplicitFlag("no flag here")).toEqual({ flagged: false, text: "no flag here" })
})

test("routeDecision: off+autoRoute gates, auto/instruct keep the legacy paths", async () => {
  const simple = "Reply with exactly: hello-ok"
  const complex = "1. Read the patch file\n2. Audit the gates\n3. Implement the change\n4. Verify the boot"
  // Gate default: off + autoRoute -> only the complex text routes.
  expect((await routeDecision({ mode: "off", autoRoute: true }, simple, "/nonexistent-ws")).action).toBe("none")
  const routed = await routeDecision({ mode: "off", autoRoute: true }, complex, "/nonexistent-ws")
  expect(routed.action).toBe("provision")
  // t24/F1: C is ONE signal that already enforces its own 2-of-3 sub-signal majority,
  // so a complex prompt may legitimately route on the single "C" signal.
  expect(routed.signals.length).toBeGreaterThanOrEqual(1)
  expect(routed.signals).toContain("C")
  // The explicit flag alone routes.
  expect((await routeDecision({ mode: "off", autoRoute: true }, "team: do it", "/nonexistent-ws")).signals).toContain("A")
  // autoRoute disabled -> nothing routes even for complex text.
  expect((await routeDecision({ mode: "off", autoRoute: false }, complex, "/nonexistent-ws")).action).toBe("none")
  // Legacy opt-ins are preserved.
  expect((await routeDecision({ mode: "auto" }, simple, "/nonexistent-ws")).action).toBe("provision")
  expect((await routeDecision({ mode: "instruct" }, simple, "/nonexistent-ws")).action).toBe("instruct")
})

test("spliceNotice inserts after the last claimed message and preserves the decision", () => {
  const claimed = [createMessage({ role: "user", content: [{ type: "text", text: "hello" }], source: { kind: "user" } })]
  const context = createMessage({ role: "user", content: [{ type: "text", text: "context" }], source: { kind: "plugin", plugin: "x" } })
  const decision = { kind: "enter", messages: [...claimed, context] }
  const notice = instructNotice({ profile: "mpd" })
  const merged = spliceNotice(decision, claimed, notice)
  expect(merged.kind).toBe("enter")
  expect(merged.messages.map((m) => m.id)).toEqual([claimed[0].id, notice.id, context.id])
  expect(merged.messages[1].content[0].text).toContain(STARTUP_NOTICE_MARKER)
})