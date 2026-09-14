// t48 — mpd-team-compact-plugin.
//
// Every assertion here is a falsifiable acceptance criterion from the task contract. The
// HINGE criteria (per-member engine resolution, the captain exclusion, null semantics, the
// lifecycle error class) are asserted through the plugin's REAL pass function, and the
// engine every call lands on is recorded by the stub adapter so "which engine did we drive"
// is measured rather than assumed.
import { expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  apply,
  auditDir,
  classifyCompactionError,
  compactTeamPass,
  compactableMembers,
  isStagedMember,
  listTeamIds,
  readAudits,
  readTeamRecord,
  teamIsFinished,
  terminalTaskStatuses,
  writeAudit,
} from "../src/index.js"

const CAPTAIN = "session-captain"
const MEMBER = "session-member"
const OTHER = "session-other"

/** A workspace with one team, plus recorded engine lookups. */
function fixture(options = {}) {
  const workspace = mkdtempSync(join(tmpdir(), "mpd-t48-"))
  const teamId = "t48-team"
  mkdirSync(join(workspace, ".mpd", "team", teamId), { recursive: true })
  const now = Date.now()
  const members = options.members ?? [
    { id: MEMBER, name: "Senior Engineer", role: "engineer", status: "idle", joinedAt: now },
    { id: OTHER, name: "Junior Engineer", role: "engineer", status: "idle", joinedAt: now },
  ]
  const tasks = options.tasks ?? [{ id: "t1", status: "completed" }]
  writeFileSync(join(workspace, ".mpd", "team", teamId, "team.json"), JSON.stringify({
    id: teamId, name: "t48", captainSessionId: CAPTAIN, createdAt: now, updatedAt: now, taskSeq: 1, phase: "running",
    members, tasks: tasks.map((task) => ({ assignee: "Senior Engineer", dependencies: [], attempt: 1, ...task })),
  }, null, 2))

  const engineCalls = []
  const engineLookups = []
  const hostEngine = { name: "compaction", compactNow: async (...args) => { engineCalls.push({ id: "__host__", kind: "host", args }); return null } }
  const live = new Map([[MEMBER, {}], [OTHER, {}]])
  const dsh = {
    capabilities: () => ({ compaction: true, compactionForAgent: true, agents: true, events: true }),
    workspaceRoot: () => workspace,
    workspaceRootsAll: () => [workspace],
    liveAgents: () => [...live.entries()].map(([id]) => ({ id, status: options.statuses?.[id] ?? "idle" })),
    liveAgent: (id) => (live.has(id) ? { id, status: options.statuses?.[id] ?? "idle", ctx: { get: (k) => (k === "compaction" ? memberEngine(id) : undefined) } } : undefined),
    // THE HINGE: this is the ONLY engine accessor the plugin may use. It is scoped to
    // the member's own context, and every call is recorded with the id it served.
    compactionEngineForAgent: (id) => {
      engineLookups.push(id)
      // FAITHFUL to the production adapter: an id with no LIVE Agent resolves to nothing.
      // There is deliberately no host-plane fallback here, because the whole hinge rule is
      // that the host instance serves a different realm and must never be substituted.
      if (!live.has(id)) return undefined
      return options.engine === undefined ? memberEngine(id) : options.engine(id)
    },
    onEvent: () => undefined,
    registerTool: () => () => {},
    registerTools: () => () => {},
    guardTool: () => () => {},
    onPostToolExecute: () => () => {},
    hasTool: () => false,
    toolRuntime: () => ({ get: () => undefined, execute: async () => undefined }),
    executeTool: async () => ({ ok: true }),
    spawnAgent: async () => ({ ok: true }),
    registerSkillProvider: () => () => {},
    listSkills: async () => [],
    loadSkill: async () => undefined,
    resolvePreset: async () => ({ id: "mpd" }),
    text: (content) => [{ type: "text", text: String(content) }],
  }
  // Memoized per id, exactly like the adapter's `compactionEngineForAgent`: repeated
  // lookups must return the SAME engine, or a "which engine did we drive" assertion would
  // be testing a fresh object every time and could never detect drift.
  const memberEngines = new Map()
  function memberEngine(id) {
    if (!memberEngines.has(id)) {
      memberEngines.set(id, {
        name: "compaction",
        compactNow: async (...args) => { engineCalls.push({ id, kind: "member", args }); return { shadowedTokenCount: 7, summarySeq: 3 } },
      })
    }
    return memberEngines.get(id)
  }
  return { workspace, teamId, dsh, engineCalls, engineLookups, hostEngine, live, cleanup: () => rmSync(workspace, { recursive: true, force: true }) }
}

const TERMINAL = ["completed", "failed", "cancelled"]

test("t48 F6 HINGE: every drive goes to the MEMBER's own scoped engine, never a host-plane one", async () => {
  const { workspace, teamId, dsh, engineCalls, engineLookups, hostEngine, cleanup } = fixture()
  try {
    const team = readTeamRecord(workspace, teamId)
    const audit = await compactTeamPass(dsh, team, { terminal: TERMINAL })
    expect(audit.outcome).toBe("compacted")
    // the sole accessor used is the per-agent one, and it was asked for the MEMBERS
    expect(engineLookups).toEqual([MEMBER, OTHER])
    expect(new Set(engineCalls.map((call) => call.id))).toEqual(new Set([MEMBER, OTHER]))
    // the host-plane engine took part in NOTHING: it is not the engine this plugin drives
    expect(engineCalls.some((call) => call.kind === "host")).toBe(false)
    expect(engineCalls.some((call) => call.id === "__host__")).toBe(false)
    // the driven engine `name` is the same as the host's, which is exactly why the
    // identity (not the name) is what the design hinges on
    expect(hostEngine.name).toBe("compaction")
    expect(audit.engineResolution).toBe("agent-scoped")
  } finally { cleanup() }
})

test("t48 F6 IDENTITY: the member engine and the host-plane engine are DIFFERENT objects", () => {
  const { dsh, hostEngine, cleanup } = fixture()
  try {
    const memberEngine = dsh.compactionEngineForAgent(MEMBER)
    // the hinge: same service NAME, different INSTANCE — which is exactly why the name can
    // never be the thing the design keys on
    expect(memberEngine.name).toBe(hostEngine.name)
    expect(memberEngine).not.toBe(hostEngine)
    // the accessor is memoized per agent, so repeated lookups cannot drift to another object
    expect(dsh.compactionEngineForAgent(MEMBER)).toBe(memberEngine)
    // and it answers NOTHING for an id with no live Agent — there is no host fallback to
    // silently inherit, which is the failure this whole criterion exists to prevent
    expect(dsh.compactionEngineForAgent("session-does-not-exist")).toBeUndefined()
  } finally { cleanup() }
})

test("t48 CAPTAIN EXCLUSION: the captain session is never driven", async () => {
  const { workspace, teamId, dsh, engineCalls, cleanup } = fixture({
    members: [
      { id: CAPTAIN, name: "captain", role: "captain", status: "idle" },
      { id: MEMBER, name: "Senior Engineer", role: "engineer", status: "idle" },
    ],
  })
  try {
    const team = readTeamRecord(workspace, teamId)
    expect(compactableMembers(team).map((m) => m.name)).toEqual(["Senior Engineer"])
    const audit = await compactTeamPass(dsh, team, { terminal: TERMINAL })
    expect(audit.members.map((m) => m.member)).toEqual(["Senior Engineer"])
    expect(engineCalls.some((call) => call.id === CAPTAIN)).toBe(false)
    // explicitly: no compaction event can exist for the captain session
    expect(audit.members.some((m) => m.sessionId === CAPTAIN)).toBe(false)
  } finally { cleanup() }
})

test("t48 NEGATIVE CONTROL: a team with ONE non-terminal task is REFUSED, nothing is driven", async () => {
  const { workspace, teamId, dsh, engineCalls, engineLookups, cleanup } = fixture({
    tasks: [{ id: "t1", status: "completed" }, { id: "t2", status: "in_progress" }],
  })
  try {
    const team = readTeamRecord(workspace, teamId)
    expect(teamIsFinished(team, TERMINAL)).toBe(false)
    const audit = await compactTeamPass(dsh, team, { terminal: TERMINAL })
    expect(audit.outcome).toBe("refused")
    expect(audit.refusedReason).toContain("t2=in_progress")
    expect(audit.members).toEqual([])
    // the destructive path was never even reached
    expect(engineCalls).toEqual([])
    expect(engineLookups).toEqual([])
  } finally { cleanup() }
})

test("t48 NEGATIVE CONTROL: an empty task list is NOT 'finished'", async () => {
  const { workspace, teamId, dsh, cleanup } = fixture({ tasks: [] })
  try {
    const team = readTeamRecord(workspace, teamId)
    expect(teamIsFinished(team, TERMINAL)).toBe(false)
    expect((await compactTeamPass(dsh, team, { terminal: TERMINAL })).outcome).toBe("refused")
  } finally { cleanup() }
})

test("t48 BARRIER: a busy member defers the whole pass (wait semantics + timeout outcome)", async () => {
  const { workspace, teamId, dsh, engineCalls, cleanup } = fixture({ statuses: { [OTHER]: "working" } })
  try {
    const team = readTeamRecord(workspace, teamId)
    const audit = await compactTeamPass(dsh, team, {
      terminal: TERMINAL, idleWaitMs: 5, idlePollMs: 1,
      sleep: async () => { /* no real time in a unit test */ },
    })
    expect(audit.outcome).toBe("timeout")
    expect(audit.refusedReason).toContain("Junior Engineer")
    // NOTHING was compacted: the user chose "wait until every member is idle, then
    // compact them together" — compacting the idle one now would break that bar's
    // intent of a single consistent point in time.
    expect(engineCalls).toEqual([])
    const busy = audit.members.find((m) => m.member === "Junior Engineer")
    expect(busy.reason).toContain("still busy")
  } finally { cleanup() }
})

test("t48 BARRIER: an idle member is compacted once every member is idle", async () => {
  const { workspace, teamId, dsh, engineCalls, cleanup } = fixture({ statuses: { [OTHER]: "idle" } })
  try {
    const team = readTeamRecord(workspace, teamId)
    const audit = await compactTeamPass(dsh, team, { terminal: TERMINAL, idleWaitMs: 0 })
    expect(audit.outcome).toBe("compacted")
    expect(engineCalls.map((c) => c.id).sort()).toEqual([MEMBER, OTHER].sort())
  } finally { cleanup() }
})

test("t48 NULL IS NOT AN ERROR: a null result is recorded as no-safe-range", async () => {
  const { workspace, teamId, dsh, cleanup } = fixture({ engine: () => ({ compactNow: async () => null }) })
  try {
    const team = readTeamRecord(workspace, teamId)
    const audit = await compactTeamPass(dsh, team, { terminal: TERMINAL })
    expect(audit.outcome).toBe("compacted")
    expect(audit.members.every((m) => m.outcome === "no-safe-range")).toBe(true)
    expect(audit.members.some((m) => m.error !== undefined)).toBe(false)
  } finally { cleanup() }
})

test("t48 F5: an engine failure code and the lifecycle error class are classified DIFFERENTLY", () => {
  // an engine code
  const engineError = Object.assign(new Error("summary compaction failed"), { code: "summary" })
  const engine = classifyCompactionError(engineError)
  expect(engine.outcome).toBe("failed")
  expect(engine.failureCode).toBe("summary")
  // the measured concurrency outcome is NOT `busy` — it is a Cordis lifecycle failure
  const lifecycle = classifyCompactionError(new Error('cannot get required service "tokenMeter" in inactive context'))
  expect(lifecycle.outcome).toBe("lifecycle-error")
  expect(lifecycle.failureCode).toBeUndefined()
  // and a genuine busy code still lands as an engine failure, never as lifecycle
  const busy = classifyCompactionError(Object.assign(new Error("agent is active"), { code: "busy" }))
  expect(busy.failureCode).toBe("busy")
  expect(busy.outcome).toBe("failed")
})

test("t48 F5: a lifecycle error mid-pass is recorded against the member and does not abort the pass", async () => {
  const { workspace, teamId, dsh, cleanup } = fixture({
    engine: (id) => ({
      compactNow: async () => {
        if (id === MEMBER) throw new Error('cannot get required service "tokenMeter" in inactive context')
        return { shadowedTokenCount: 1, summarySeq: 2 }
      },
    }),
  })
  try {
    const team = readTeamRecord(workspace, teamId)
    const audit = await compactTeamPass(dsh, team, { terminal: TERMINAL })
    const first = audit.members.find((m) => m.sessionId === MEMBER)
    const second = audit.members.find((m) => m.sessionId === OTHER)
    expect(first.outcome).toBe("lifecycle-error")
    expect(first.failureCode).toBeUndefined()
    expect(first.error).toContain("inactive context")
    expect(second.outcome).toBe("compacted") // the pass continued
  } finally { cleanup() }
})

test("t48 STAGED: a member with no session id is skipped EXPLICITLY, never silently", async () => {
  const { workspace, teamId, dsh, engineCalls, cleanup } = fixture({
    members: [
      { id: "", name: "Senior Engineer", role: "engineer", status: "idle" },
      { id: MEMBER, name: "Junior Engineer", role: "engineer", status: "idle" },
    ],
  })
  try {
    const team = readTeamRecord(workspace, teamId)
    expect(isStagedMember(team.members[0])).toBe(true)
    const audit = await compactTeamPass(dsh, team, { terminal: TERMINAL })
    const staged = audit.members.find((m) => m.member === "Senior Engineer")
    expect(staged.outcome).toBe("skipped-staged")
    expect(staged.reason).toContain("not spawned")
    // it never asked for an engine on an empty id
    expect(engineCalls.some((c) => c.id === "")).toBe(false)
  } finally { cleanup() }
})

test("t48 NOT-LIVE: a dormant team is recorded, not ignored", async () => {
  const { workspace, teamId, dsh, live, cleanup } = fixture()
  try {
    live.clear() // the captain is gone, so no member Agent is in this process
    const team = readTeamRecord(workspace, teamId)
    const audit = await compactTeamPass(dsh, team, { terminal: TERMINAL })
    expect(audit.outcome).toBe("not-live")
    expect(audit.members.every((m) => m.outcome === "skipped-not-live")).toBe(true)
  } finally { cleanup() }
})

test("t48 AUDIT: written under .mpd/team-compact and NEVER under .mpd/team", () => {
  const { workspace, teamId, cleanup } = fixture()
  try {
    const teamDirBefore = readdirSync(join(workspace, ".mpd", "team", teamId)).sort()
    const audit = {
      schema: "mpd/team-compact@1", teamId, teamName: "t48", at: 1_700_000_000_000,
      outcome: "compacted", engineResolution: "agent-scoped",
      members: [{ member: "Senior Engineer", sessionId: MEMBER, outcome: "compacted", shadowedTokenCount: 9, summarySeq: 4 }],
    }
    const file = writeAudit(workspace, audit)
    expect(file.startsWith(join(workspace, ".mpd", "team-compact", teamId))).toBe(true)
    expect(existsSync(file)).toBe(true)
    // the agent-teams state namespace is byte-untouched
    expect(readdirSync(join(workspace, ".mpd", "team", teamId)).sort()).toEqual(teamDirBefore)
    const stored = readAudits(workspace, teamId)
    expect(stored.length).toBe(1)
    expect(stored[0].members[0].shadowedTokenCount).toBe(9)
    expect(stored[0].members[0].summarySeq).toBe(4)
  } finally { cleanup() }
})

test("t48 AUDIT: a second pass is a second FILE — an earlier destructive pass is never hidden", () => {
  const { workspace, teamId, cleanup } = fixture()
  try {
    const base = { schema: "mpd/team-compact@1", teamId, teamName: "t48", outcome: "refused", engineResolution: "agent-scoped", members: [] }
    writeAudit(workspace, { ...base, at: 1_700_000_000_000, refusedReason: "first" })
    writeAudit(workspace, { ...base, at: 1_700_000_001_000, refusedReason: "second" })
    const stored = readAudits(workspace, teamId)
    expect(stored.length).toBe(2)
    expect(stored.map((a) => a.refusedReason)).toEqual(["first", "second"])
    expect(readdirSync(auditDir(workspace, teamId)).length).toBe(2)
  } finally { cleanup() }
})

test("t48 TERMINAL SET: taken from the owning plugin, not re-declared", async () => {
  const statuses = await terminalTaskStatuses()
  expect([...statuses].sort()).toEqual(["cancelled", "completed", "failed"])
  // and the source of truth really is the dependency's module
  const owning = await import("../../mpd-agent-teams-plugin/lib/types.js")
  expect([...statuses]).toEqual([...owning.TERMINAL_TASK_STATUSES])
})

test("t48: listTeamIds ignores the archive directory and dotfiles", () => {
  const { workspace, cleanup } = fixture()
  try {
    mkdirSync(join(workspace, ".mpd", "team", "archive"), { recursive: true })
    mkdirSync(join(workspace, ".mpd", "team", ".hidden"), { recursive: true })
    expect(listTeamIds(workspace)).toEqual(["t48-team"])
  } finally { cleanup() }
})

test("t48: a malformed team record reads as undefined, never a throw", () => {
  const { workspace, teamId, cleanup } = fixture()
  try {
    writeFileSync(join(workspace, ".mpd", "team", teamId, "team.json"), "{ not json")
    expect(readTeamRecord(workspace, teamId)).toBeUndefined()
    expect(readTeamRecord(workspace, "missing-team")).toBeUndefined()
    // and a record with no members array is rejected rather than half-read
    writeFileSync(join(workspace, ".mpd", "team", teamId, "team.json"), JSON.stringify({ id: teamId, name: "x", tasks: [] }))
    expect(readTeamRecord(workspace, teamId)).toBeUndefined()
  } finally { cleanup() }
})

test("t48 NO SILENT NOTIFICATION: the pass writes an audit and returns; it never messages a member", async () => {
  const { workspace, teamId, dsh, cleanup } = fixture()
  try {
    const team = readTeamRecord(workspace, teamId)
    const audit = await compactTeamPass(dsh, team, { terminal: TERMINAL })
    // the audit carries what was compacted; nothing in it is addressed to a member
    expect(JSON.stringify(audit)).not.toContain("notification")
    expect(Object.keys(audit).sort()).toEqual(["at", "engineResolution", "members", "outcome", "schema", "teamId", "teamName"])
  } finally { cleanup() }
})

test("t48 plugin: apply() registers both tools and subscribes to the status edge", () => {
  const registered = []
  let subscribed
  const listeners = []
  const dsh = {
    registerTool: (definition) => { registered.push(definition.name); return () => {} },
    onEvent: (event) => { subscribed = event; return () => {} },
    workspaceRoot: () => "/tmp/none",
  }
  const ctx = { get: (key) => (key === "mpdDsh" ? dsh : undefined), logger: { warn: () => {}, info: () => {} }, on: (e) => { listeners.push(e) } }
  apply(ctx)
  expect(registered.sort()).toEqual(["mpd_team_compact_run", "mpd_team_compact_status"])
  expect(subscribed).toBe("agent/status")
  expect(listeners).toEqual([])
})

// REGRESSION (defect measured 2026-09-14): both tools shipped a BARE property map as
// `parameters` (`{ team_id: {…} }`). The adapter forwards `parameters` verbatim — it only
// defaults a schema when the field is ABSENT — and the harness's raw register() path does
// not validate parameters, so the registered schema carried no object root and the provider
// rejected EVERY model request of a session mounting the row:
//   Invalid schema for function 'mpd_team_compact_run': schema must be a JSON Schema of
//   'type: "object"', got 'type: null'
// A source-level test is the right gate for the DECLARATION; its mount-level twin is the QA
// roles probe's TOOL_PARAM_SCHEMAS line, which reads the LIVE registry in a real boot.
test("t48 plugin: every registered tool declares an OBJECT-ROOTED parameters schema", () => {
  const registered = []
  const dsh = {
    registerTool: (definition) => { registered.push(definition); return () => {} },
    onEvent: () => () => {},
    workspaceRoot: () => "/tmp/none",
  }
  const ctx = { get: (key) => (key === "mpdDsh" ? dsh : undefined), logger: { warn: () => {}, info: () => {} }, on: () => () => {} }
  apply(ctx)
  expect(registered.length).toBe(2)
  for (const definition of registered) {
    const parameters = definition.parameters
    // The provider rule: an object root is mandatory. A bare property map has no `type`,
    // which is exactly how it reached the wire as `type: null`.
    expect({ tool: definition.name, type: parameters?.type }).toEqual({ tool: definition.name, type: "object" })
    expect(typeof parameters.properties).toBe("object")
    expect(Object.keys(parameters.properties)).toEqual(["team_id"])
    expect(parameters.properties.team_id.type).toBe("string")
    expect(parameters.additionalProperties).toBe(false)
    // team_id is optional on BOTH tools: the pass defaults to every finished team.
    expect(parameters.required ?? []).toEqual([])
  }
})
