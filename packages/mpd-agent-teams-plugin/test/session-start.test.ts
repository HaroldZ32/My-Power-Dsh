import { test, expect } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DEFAULT_TEAM_NAME, STARTUP_NOTICE_MARKER, availableTeamId, instructNotice, policyEnabled, policyQualifies, provisionedNotice, spliceNotice } from "../lib/session-start.js"
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

test("policyEnabled: off disables, auto/instruct enable", () => {
  expect(policyEnabled(undefined)).toBe(false)
  expect(policyEnabled({ mode: "off" })).toBe(false)
  expect(policyEnabled({ mode: "auto" })).toBe(true)
  expect(policyEnabled({ mode: "instruct" })).toBe(true)
})

test("policyQualifies: child sessions never qualify", () => {
  const policy = { mode: "auto", presets: ["mpd"] }
  expect(policyQualifies(policy, makeAgent({ agentPreset: "mpd" }))).toBe(true)
  expect(policyQualifies(policy, makeAgent({ parentSession: "session-parent", agentPreset: "mpd" }))).toBe(false)
})

test("policyQualifies: allow-list scoping and preset-less coverage", () => {
  const mpdOnly = { mode: "auto", presets: ["mpd"] }
  expect(policyQualifies(mpdOnly, makeAgent({ agentPreset: "mpd" }))).toBe(true)
  expect(policyQualifies(mpdOnly, makeAgent({ agentPreset: "standard" }))).toBe(false)
  // Sessions without any preset (headless direct driver / legacy installs)
  // deploy the bundle itself and stay covered.
  expect(policyQualifies(mpdOnly, makeAgent({}))).toBe(true)
  // Empty allow-list = every top-level session.
  expect(policyQualifies({ mode: "auto", presets: [] }, makeAgent({ agentPreset: "standard" }))).toBe(true)
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
  const notice = provisionedNotice({ name: "MPD Default", id: "mpd-default-abc123", profile: { name: "mpd" }, phase: "staged", taskSeq: 0, tasks: [] })
  expect(notice.role).toBe("user")
  expect(notice.content[0].text).toContain(STARTUP_NOTICE_MARKER)
  expect(notice.content[0].text).toContain("MPD Default")
  expect(notice.content[0].text).toContain('agent_teams_create(approval="required", profile="mpd")')
  expect(notice.source.reason).toBe("session-start-provision")

  const instructed = instructNotice({ profile: "mpd" })
  expect(instructed.content[0].text).toContain(STARTUP_NOTICE_MARKER)
  expect(instructed.content[0].text).toContain("agent_teams_create")
  expect(instructed.content[0].text).toContain('profile="mpd"')
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