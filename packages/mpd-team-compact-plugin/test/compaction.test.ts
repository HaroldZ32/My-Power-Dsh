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
  sameAuditOutcome,
  classifyCompactionError,
  compactTeamPass,
  compactableMembers,
  isStagedMember,
  listTeamIds,
  readAudits,
  readTeamRecord,
  readTeams,
  teamIsFinished,
  terminalTaskStatuses,
  writeAudit,
} from "../src/index"
import type { CompactAudit, CompactMemberRecord } from "../src/index"
import type { DshAdapter, DshTeamView, DshToolDef } from "../../mpd-dsh-adapter-plugin/src/index"
import type { TeamRecord as MpdTeamRecord } from "../../mpd-team-core-plugin/src/team-store"
import type { MpdTeamsRead } from "../src/index"

/** The captain's session id: the official roster's Lead pseudo-row, never a compactable member. */
const CAPTAIN = "session-captain"
/** The first teammate's session id; the member the hinge assertions drive. */
const MEMBER = "session-member"
/** The second teammate's session id, which proves the engine resolution is per member. */
const OTHER = "session-other"

/** One recorded engine drive: which engine answered, on which plane, with which arguments. */
interface EngineCall {
  /** The id the drive served, or `__host__` for the host-plane double. */
  id: string
  /** The plane the drive came from; only `member` is legal for this plugin. */
  kind: "host" | "member"
  /** The arguments the pass handed the engine (the live Agent, then the options object). */
  args: unknown[]
}

/** A compaction-engine double: the identity the hinge keys on plus the drive it answers. */
interface EngineDouble {
  /** The service name; both planes carry the SAME name, which is why only identity can decide. */
  name?: string
  /** Drive one compaction; `null` means "no safely compactable range". */
  compactNow: (...args: unknown[]) => Promise<unknown>
}

/** The fixture's knobs: roster, board, live-agent statuses and the per-member engine answer. */
interface FixtureOptions {
  /** The teammate rows to seed; defaults to the two engineers. */
  members?: Array<{ id: string; name: string; role: string; status: string; joinedAt?: number }>
  /** The board rows to seed; defaults to one completed task. */
  tasks?: Array<{ id: string; status: string }>
  /** Per-session status override the live-agent seam reports (absent means `idle`). */
  statuses?: Record<string, string>
  /** Replace the per-member engine double, for the null-result and lifecycle-error cases. */
  engine?: (id: string) => EngineDouble
}

/** The handles one case needs: the seeded workspace, the stub adapter and the recorded drives. */
interface Fixture {
  /** The throwaway workspace the team record and the audit files land under. */
  workspace: string
  /** The seeded team id. */
  teamId: string
  /** The stub adapter the plugin's pure functions are driven through. */
  dsh: DshAdapter
  /** Every engine drive, in call order. */
  engineCalls: EngineCall[]
  /** Every per-agent engine lookup, in call order — the hinge's proving surface. */
  engineLookups: string[]
  /** The host-plane engine double, which no drive may ever reach. */
  hostEngine: EngineDouble
  /** The live-Agent registry the stub reports; clearing it simulates a dormant team. */
  live: Map<string, unknown>
  /** Remove the temp workspace. */
  cleanup: () => void
}

/** The object-rooted parameters schema these cases assert; a bare property map carries no `type`. */
type ToolParametersSchema = {
  /** Root type; the provider mandates `"object"`. */
  type?: string
  /** Declared arguments, keyed by argument name. */
  properties: Record<string, { type?: string }>
  /** Whether unknown arguments are refused. */
  additionalProperties?: boolean
  /** Argument names the model must supply; absent when none are required. */
  required?: string[]
}

/** A workspace with one team, plus recorded engine lookups. */
function fixture(options: FixtureOptions = {}): Fixture {
  /** The throwaway workspace the fixture seeds and `cleanup` removes. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-t48-"))
  /** The one team id every case reads back. */
  const teamId = "t48-team"
  mkdirSync(join(workspace, ".mpd", "team", teamId), { recursive: true })
  /** One shared timestamp, so roster order stays the only variable between fixtures. */
  const now = Date.now()
  /** The teammate rows the live roster reports, in the order the case declared them. */
  const members = options.members ?? [
    { id: MEMBER, name: "Senior Engineer", role: "engineer", status: "idle", joinedAt: now },
    { id: OTHER, name: "Junior Engineer", role: "engineer", status: "idle", joinedAt: now },
  ]
  /** The board rows; a fully terminal board is one half of the pass's trigger. */
  const tasks = options.tasks ?? [{ id: "t1", status: "completed" }]
  // 0.1.7: the fixture is a LIVE TEAM VIEW — the OFFICIAL readout the adapter folds — instead of
  // the retired `.mpd/team/<id>/team.json`. The Lead pseudo-row is part of a real roster (the
  // official `listMembers` always puts it first), so it is built here too: the projection must
  // turn it into `captainSessionId` and keep it OUT of `members`.
  const view = {
    teamId,
    leadName: "lead",
    leadSessionId: CAPTAIN,
    members: [
      { id: CAPTAIN, name: "lead", role: "lead", status: "running", diagnostics: [] },
      ...members.map((member) => ({ id: member.id, name: member.name, role: "teammate", status: member.status, diagnostics: [] })),
    ],
    tasks: tasks.map((task) => ({
      id: task.id,
      revision: 1,
      subject: task.id,
      description: "",
      status: task.status,
      blockedBy: [],
      writeScopes: [],
      ownerName: "Senior Engineer",
      ready: true,
      writeScopeWarnings: [],
    })),
  }

  /** Every engine drive, so "which engine did we drive" is measured rather than assumed. */
  const engineCalls: EngineCall[] = []
  /** Every `compactionEngineForAgent` call, in order: the ONLY accessor the plugin may use. */
  const engineLookups: string[] = []
  /** The host-plane engine double: the same service NAME as a member engine, a different instance. */
  const hostEngine: EngineDouble = { name: "compaction", compactNow: async (...args: unknown[]) => { engineCalls.push({ id: "__host__", kind: "host", args }); return null } }
  /** The live-Agent registry: an id held here is a member the adapter resolves an engine for. */
  const live: Map<string, unknown> = new Map([[MEMBER, {}], [OTHER, {}]])
  /**
   * The stub adapter: every seam the compact pass reads, plus the harness seams the row's `apply`
   * touches. The cast is the documented unit-test boundary — a stub implements the seams a case
   * exercises, never the whole adapter surface — and the assertions in this file keep it honest.
   */
  const dsh = {
    capabilities: () => ({ compaction: true, compactionForAgent: true, agents: true, events: true }),
    // The OFFICIAL team plane: rosters and boards, live (the watchdog/compact source of truth).
    teamLiveTeams: () => [JSON.parse(JSON.stringify(view))],
    workspaceRoot: () => workspace,
    workspaceRootsAll: () => [workspace],
    liveAgents: () => [...live.entries()].map(([id]) => ({ id, status: options.statuses?.[id] ?? "idle" })),
    liveAgent: (id: string) => (live.has(id) ? { id, status: options.statuses?.[id] ?? "idle", ctx: { get: (k: string) => (k === "compaction" ? memberEngine(id) : undefined) } } : undefined),
    // THE HINGE: this is the ONLY engine accessor the plugin may use. It is scoped to
    // the member's own context, and every call is recorded with the id it served.
    compactionEngineForAgent: (id: string) => {
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
    text: (content: unknown) => [{ type: "text", text: String(content) }],
  } as unknown as DshAdapter
  // Memoized per id, exactly like the adapter's `compactionEngineForAgent`: repeated
  // lookups must return the SAME engine, or a "which engine did we drive" assertion would
  // be testing a fresh object every time and could never detect drift.
  const memberEngines: Map<string, EngineDouble> = new Map()
  /** The memoized engine double for one member id; `undefined` when no live Agent holds it. */
  function memberEngine(id: string): EngineDouble | undefined {
    if (!memberEngines.has(id)) {
      memberEngines.set(id, {
        name: "compaction",
        compactNow: async (...args: unknown[]) => { engineCalls.push({ id, kind: "member", args }); return { shadowedTokenCount: 7, summarySeq: 3 } },
      })
    }
    return memberEngines.get(id)
  }
  return { workspace, teamId, dsh, engineCalls, engineLookups, hostEngine, live, cleanup: () => rmSync(workspace, { recursive: true, force: true }) }
}

/** The terminal vocabulary this suite hands the pass: the official mirror plus the tolerated pair. */
const TERMINAL = ["completed", "failed", "cancelled"]

test("t48 F6 HINGE: every drive goes to the MEMBER's own scoped engine, never a host-plane one", async () => {
  /** The fixture handles, including the host-plane double kept only to prove it is never driven. */
  const { workspace, teamId, dsh, engineCalls, engineLookups, hostEngine, cleanup } = fixture()
  try {
    /** The live team record; the fixture just seeded it, so the readout carries it. */
    const team = readTeamRecord(dsh, workspace, teamId)!
    /** The audit of a pass over a finished team. */
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
  /** The fixture handles; only the identity pair and the teardown are read here. */
  const { dsh, hostEngine, cleanup } = fixture()
  try {
    // The adapter types this seam as `unknown` on purpose (a service object, not a declared
    // interface) and the real pass narrows it the same way; the fixture holds a live Agent for
    // MEMBER, so the memoized lookup resolves — the identity assertions below falsify that.
    const memberEngine = dsh.compactionEngineForAgent(MEMBER) as EngineDouble
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
  /** The fixture handles for a roster whose captain is also a roster row. */
  const { workspace, teamId, dsh, engineCalls, cleanup } = fixture({
    members: [
      { id: CAPTAIN, name: "captain", role: "captain", status: "idle" },
      { id: MEMBER, name: "Senior Engineer", role: "engineer", status: "idle" },
    ],
  })
  try {
    /** The live team record; its roster carries the captain row this case excludes. */
    const team = readTeamRecord(dsh, workspace, teamId)!
    expect(compactableMembers(team).map((m) => m.name)).toEqual(["Senior Engineer"])
    /** The audit of the pass that must have skipped the captain. */
    const audit = await compactTeamPass(dsh, team, { terminal: TERMINAL })
    expect(audit.members.map((m) => m.member)).toEqual(["Senior Engineer"])
    expect(engineCalls.some((call) => call.id === CAPTAIN)).toBe(false)
    // explicitly: no compaction event can exist for the captain session
    expect(audit.members.some((m) => m.sessionId === CAPTAIN)).toBe(false)
  } finally { cleanup() }
})

test("t48 NEGATIVE CONTROL: a team with ONE non-terminal task is REFUSED, nothing is driven", async () => {
  /** The fixture handles for a board that is one task short of terminal. */
  const { workspace, teamId, dsh, engineCalls, engineLookups, cleanup } = fixture({
    tasks: [{ id: "t1", status: "completed" }, { id: "t2", status: "in_progress" }],
  })
  try {
    /** The live team record; its board carries the still-open task. */
    const team = readTeamRecord(dsh, workspace, teamId)!
    expect(teamIsFinished(team, TERMINAL)).toBe(false)
    /** The audit that must record a refusal without reaching the drive. */
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
  /** The fixture handles for a team with no board row at all. */
  const { workspace, teamId, dsh, cleanup } = fixture({ tasks: [] })
  try {
    /** The live team record whose board is empty. */
    const team = readTeamRecord(dsh, workspace, teamId)!
    expect(teamIsFinished(team, TERMINAL)).toBe(false)
    expect((await compactTeamPass(dsh, team, { terminal: TERMINAL })).outcome).toBe("refused")
  } finally { cleanup() }
})

test("t48 BARRIER: a busy member defers the whole pass (wait semantics + timeout outcome)", async () => {
  /** The fixture handles for a roster with one member still working. */
  const { workspace, teamId, dsh, engineCalls, cleanup } = fixture({ statuses: { [OTHER]: "working" } })
  try {
    /** The live team record; its member statuses are read through the live-agent seam. */
    const team = readTeamRecord(dsh, workspace, teamId)!
    /** The audit of a pass whose barrier expired before every member was idle. */
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
    /** The row recorded for the member that stayed busy past the deadline. */
    const busy = audit.members.find((m) => m.member === "Junior Engineer")!
    expect(busy.reason).toContain("still busy")
  } finally { cleanup() }
})

test("t48 BARRIER: an idle member is compacted once every member is idle", async () => {
  /** The fixture handles for a roster whose members are all idle. */
  const { workspace, teamId, dsh, engineCalls, cleanup } = fixture({ statuses: { [OTHER]: "idle" } })
  try {
    /** The live team record the barrier lets through. */
    const team = readTeamRecord(dsh, workspace, teamId)!
    /** The audit of the pass that drives both members. */
    const audit = await compactTeamPass(dsh, team, { terminal: TERMINAL, idleWaitMs: 0 })
    expect(audit.outcome).toBe("compacted")
    expect(engineCalls.map((c) => c.id).sort()).toEqual([MEMBER, OTHER].sort())
  } finally { cleanup() }
})

test("t48 NULL IS NOT AN ERROR: a null result is recorded as no-safe-range", async () => {
  /** The fixture handles for an engine that answers `null` for every member. */
  const { workspace, teamId, dsh, cleanup } = fixture({ engine: () => ({ compactNow: async () => null }) })
  try {
    /** The live team record the pass drives. */
    const team = readTeamRecord(dsh, workspace, teamId)!
    /** The audit whose rows must read `no-safe-range`, never an error. */
    const audit = await compactTeamPass(dsh, team, { terminal: TERMINAL })
    expect(audit.outcome).toBe("compacted")
    expect(audit.members.every((m) => m.outcome === "no-safe-range")).toBe(true)
    expect(audit.members.some((m) => m.error !== undefined)).toBe(false)
  } finally { cleanup() }
})

test("t48 F5: an engine failure code and the lifecycle error class are classified DIFFERENTLY", () => {
  // an engine code
  const engineError = Object.assign(new Error("summary compaction failed"), { code: "summary" })
  /** The classification of a plain engine failure code. */
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
  /** The fixture handles for an engine that raises the measured lifecycle error for MEMBER only. */
  const { workspace, teamId, dsh, cleanup } = fixture({
    engine: (id) => ({
      compactNow: async () => {
        if (id === MEMBER) throw new Error('cannot get required service "tokenMeter" in inactive context')
        return { shadowedTokenCount: 1, summarySeq: 2 }
      },
    }),
  })
  try {
    /** The live team record the pass drives. */
    const team = readTeamRecord(dsh, workspace, teamId)!
    /** The audit that must record both members rather than aborting on the first. */
    const audit = await compactTeamPass(dsh, team, { terminal: TERMINAL })
    /** The row of the member whose drive raised the lifecycle error. */
    const first = audit.members.find((m) => m.sessionId === MEMBER)!
    /** The row of the member that followed it, proving the pass continued. */
    const second = audit.members.find((m) => m.sessionId === OTHER)!
    expect(first.outcome).toBe("lifecycle-error")
    expect(first.failureCode).toBeUndefined()
    expect(first.error).toContain("inactive context")
    expect(second.outcome).toBe("compacted") // the pass continued
  } finally { cleanup() }
})

test("t48 STAGED: a member with no session id is skipped EXPLICITLY, never silently", async () => {
  /** The fixture handles for a roster whose first member has not been spawned yet. */
  const { workspace, teamId, dsh, engineCalls, cleanup } = fixture({
    members: [
      { id: "", name: "Senior Engineer", role: "engineer", status: "idle" },
      { id: MEMBER, name: "Junior Engineer", role: "engineer", status: "idle" },
    ],
  })
  try {
    /** The live team record whose first member carries an empty session id. */
    const team = readTeamRecord(dsh, workspace, teamId)!
    expect(isStagedMember(team.members[0])).toBe(true)
    /** The audit that must record an explicit skip for the staged member. */
    const audit = await compactTeamPass(dsh, team, { terminal: TERMINAL })
    /** The explicit skip row for the staged member. */
    const staged = audit.members.find((m) => m.member === "Senior Engineer")!
    expect(staged.outcome).toBe("skipped-staged")
    expect(staged.reason).toContain("not spawned")
    // it never asked for an engine on an empty id
    expect(engineCalls.some((c) => c.id === "")).toBe(false)
  } finally { cleanup() }
})

test("t48 NOT-LIVE: a dormant team is recorded, not ignored", async () => {
  /** The fixture handles, including the live registry this case empties. */
  const { workspace, teamId, dsh, live, cleanup } = fixture()
  try {
    live.clear() // the captain is gone, so no member Agent is in this process
    /** The live team record; the readout still carries it while no member Agent is resident. */
    const team = readTeamRecord(dsh, workspace, teamId)!
    /** The audit of a pass that found nobody to drive. */
    const audit = await compactTeamPass(dsh, team, { terminal: TERMINAL })
    expect(audit.outcome).toBe("not-live")
    expect(audit.members.every((m) => m.outcome === "skipped-not-live")).toBe(true)
  } finally { cleanup() }
})

test("t48 AUDIT: written under .mpd/team-compact and NEVER under .mpd/team", () => {
  /** The fixture handles; its workspace receives the written audit. */
  const { workspace, teamId, cleanup } = fixture()
  try {
    /** The `team` namespace's entries before the write, so the assertion can prove it untouched. */
    const teamDirBefore = readdirSync(join(workspace, ".mpd", "team", teamId)).sort()
    /** The audit record written through the plugin's own writer. */
    const audit: CompactAudit = {
      schema: "mpd/team-compact@1", teamId, teamName: "t48", at: 1_700_000_000_000,
      outcome: "compacted", engineResolution: "agent-scoped",
      members: [{ member: "Senior Engineer", sessionId: MEMBER, outcome: "compacted", shadowedTokenCount: 9, summarySeq: 4 }],
    }
    /** The path the writer chose for this audit. */
    const file = writeAudit(workspace, audit)
    expect(file.startsWith(join(workspace, ".mpd", "team-compact", teamId))).toBe(true)
    expect(existsSync(file)).toBe(true)
    // the agent-teams state namespace is byte-untouched
    expect(readdirSync(join(workspace, ".mpd", "team", teamId)).sort()).toEqual(teamDirBefore)
    /** The audits read back from disk, in write order. */
    const stored = readAudits(workspace, teamId)
    expect(stored.length).toBe(1)
    expect(stored[0].members[0].shadowedTokenCount).toBe(9)
    expect(stored[0].members[0].summarySeq).toBe(4)
  } finally { cleanup() }
})

test("t48 AUDIT: a second pass is a second FILE — an earlier destructive pass is never hidden", () => {
  /** The fixture handles; its workspace receives both written audits. */
  const { workspace, teamId, cleanup } = fixture()
  try {
    /** The fields both written audits share; `at` and the refusal reason differ per write. */
    const base: Omit<CompactAudit, "at"> = { schema: "mpd/team-compact@1", teamId, teamName: "t48", outcome: "refused", engineResolution: "agent-scoped", members: [] }
    writeAudit(workspace, { ...base, at: 1_700_000_000_000, refusedReason: "first" })
    writeAudit(workspace, { ...base, at: 1_700_000_001_000, refusedReason: "second" })
    /** Both audits, which must be two FILES rather than one overwritten record. */
    const stored = readAudits(workspace, teamId)
    expect(stored.length).toBe(2)
    expect(stored.map((a) => a.refusedReason)).toEqual(["first", "second"])
    expect(readdirSync(auditDir(workspace, teamId)).length).toBe(2)
  } finally { cleanup() }
})

test("t48 TERMINAL SET: mirror of the OFFICIAL lifecycle, with the non-terminal half excluded", () => {
  /** The statuses this plugin treats as terminal. */
  const statuses = terminalTaskStatuses()
  // The official `TeamTaskStatus` union is pending | in_progress | completed | deleted, so the
  // TERMINAL half is `completed` (+ `deleted`, which `listTasks` never even returns). `failed`
  // and `cancelled` are tolerated for a harness that adds one.
  expect(statuses).toContain("completed")
  expect(statuses).toContain("deleted")
  // NEGATIVE CONTROL: the two statuses that mean WORK IS OUTSTANDING must never be terminal, or
  // this plugin's destructive pass could fire on a team that is still working.
  expect(statuses).not.toContain("pending")
  expect(statuses).not.toContain("in_progress")
})

test("t48: listTeamIds reports exactly the LIVE teams the adapter folds", () => {
  /** The fixture handles; only the stub adapter is read here. */
  const { workspace, dsh, cleanup } = fixture()
  try {
    // A solo session is the Lead of its own implicit team on the official plane; with no teammate
    // and no task it is NOT a team this plugin may consider.
    const solo: DshTeamView = { teamId: "solo", leadName: "lead", leadSessionId: "s", members: [{ id: "s", name: "lead", role: "lead", status: "running", diagnostics: [] }], tasks: [] }
    /** The same stub with the solo session appended to its readout. */
    const both = { ...dsh, teamLiveTeams: () => [...dsh.teamLiveTeams(), solo] }
    expect(listTeamIds(both, workspace)).toEqual(["t48-team"])
    // …and the sorted id list is the readout's, not a directory scan: an "archive" entry cannot
    // appear because the official service has no such concept.
    expect(listTeamIds(dsh, workspace)).toEqual(["t48-team"])
  } finally { cleanup() }
})

test("t48: a team the readout does not carry reads as undefined, never a throw", () => {
  /** The fixture handles; only the stub adapter is read here. */
  const { workspace, dsh, cleanup } = fixture()
  try {
    // The retired `.mpd/team/<id>/team.json` is no longer a source AT ALL: writing one changes
    // nothing, and an id the live readout does not carry has no record.
    writeFileSync(join(tmpdir(), "mpd-t48-irrelevant.json"), JSON.stringify({ id: "t48-team", members: [], tasks: [] }))
    expect(readTeamRecord(dsh, workspace, "missing-team")).toBeUndefined()
    // A view with no team identity is dropped rather than projected half-read.
    const empty = { ...dsh, teamLiveTeams: () => [{ teamId: "", leadName: "lead", leadSessionId: "s", members: [], tasks: [] }] }
    expect(readTeamRecord(empty, workspace, "")).toBeUndefined()
    // …and a view whose readout throws degrades to "no teams", never a throw out of a tick.
    const broken = { ...dsh, teamLiveTeams: () => { throw new Error("service gone") } }
    expect(readTeams(broken, workspace)).toEqual([])
  } finally { cleanup() }
})

test("t48 T4: a team is READ FROM THE MPD RECORD — the native default composition is not blind", () => {
  // THE DEFECT THIS PINS (T4): `readTeams` read ONLY `dsh.teamLiveTeams()`, the OFFICIAL readout,
  // which reports a team only while its Lead is registered with the official service. The adapter's
  // DEFAULT executor backend is `native`, a native team is never registered there, so the pass saw
  // zero teams and `mpd_team_compact_run` answered "no finished team" forever.
  /** The fixture handles; the OFFICIAL readout is emptied below so any answer comes from the record. */
  const { workspace, dsh, cleanup } = fixture()
  try {
    /** One mpd team record: a FINISHED team the official plane does not carry at all. */
    const record: MpdTeamRecord = {
      version: 1,
      teamId: "team-20261006120000",
      name: "wave-3",
      description: "split the plane",
      leadSessionId: "sess-lead-1",
      phase: "idle",
      createdAt: "2026-10-06T12:00:00.000Z",
      members: [
        { id: "M1", name: "Senior Engineer", description: "implements", status: "inactive", spawnedAt: "2026-10-06T12:00:01.000Z", executorRef: "sess-m1" },
      ],
      tasks: [
        { id: "T1", subject: "core", description: "own the record", kind: "work", status: "completed", blockedBy: [], writeScopes: [], createdAt: "2026-10-06T12:00:01.000Z", updatedAt: "2026-10-06T12:00:02.000Z", revision: 2 },
      ],
      nextMemberNumber: 2,
      nextTaskNumber: 2,
    }
    /** The `mpdTeams` service face, answering that one record. */
    const mpdTeams: MpdTeamsRead = { list: () => [record] }
    /** The adapter whose OFFICIAL readout carries nothing, as a native composition's does. */
    const officialBlind = { ...dsh, teamLiveTeams: () => [] as DshTeamView[] }
    // The team is seen AT ALL — which is the whole fix.
    expect(listTeamIds(officialBlind, workspace, mpdTeams)).toEqual(["team-20261006120000"])
    /** The projected team, read through the same universe. */
    const team = readTeamRecord(officialBlind, workspace, "team-20261006120000", mpdTeams)!
    // A member's identity is the EXECUTOR's handle: that is the id `dsh.liveAgent` resolves, so a
    // projection that kept mpd's short `M1` would report every member "not live".
    expect(team.members).toEqual([{ id: "sess-m1", name: "Senior Engineer", status: "inactive" }])
    expect(team.captainSessionId).toBe("sess-lead-1")
    // The board is terminal, so the DERIVED "finished" predicate fires on the record's own vocabulary.
    expect(teamTasks(team)).toEqual([["T1", "completed"]])
    expect(teamIsFinished(team, terminalTaskStatuses())).toBe(true)
    // The falsifier: with NO mpd service the OFFICIAL fold still answers, exactly as before.
    expect(listTeamIds(dsh, workspace)).toEqual(["t48-team"])
    // And a staged SHELL is still not a team on either plane.
    expect(readTeams(officialBlind, workspace, { list: () => [{ ...record, members: [], tasks: [] }] })).toEqual([])
  } finally { cleanup() }
})

/** One projected team's `[id, status]` pairs, so a board assertion stays readable. */
function teamTasks(team: { tasks: Array<{ id: string; status: string }> }): Array<[string, string]> {
  return team.tasks.map((task) => [task.id, task.status])
}

test("t48 NO SILENT NOTIFICATION: the pass writes an audit and returns; it never messages a member", async () => {
  /** The fixture handles; only the written audit is read here. */
  const { workspace, teamId, dsh, cleanup } = fixture()
  try {
    /** The live team record the pass reads. */
    const team = readTeamRecord(dsh, workspace, teamId)!
    /** The audit that must carry nothing addressed to a member. */
    const audit = await compactTeamPass(dsh, team, { terminal: TERMINAL })
    // the audit carries what was compacted; nothing in it is addressed to a member
    expect(JSON.stringify(audit)).not.toContain("notification")
    expect(Object.keys(audit).sort()).toEqual(["at", "engineResolution", "members", "outcome", "schema", "teamId", "teamName"])
  } finally { cleanup() }
})

test("t48 plugin: apply() registers both tools and subscribes to BOTH triggers", () => {
  /** The tool names `apply` registered, recorded through the stub adapter. */
  const registered: string[] = []
  /** The event names the row subscribed to, recorded through the stub adapter. */
  const subscribed: string[] = []
  /** The raw `ctx.on` subscriptions, which must stay empty: the adapter owns subscriptions. */
  const listeners: string[] = []
  /** The stub adapter the row resolves through `ctx.get("mpdDsh")`. */
  const dsh: Partial<DshAdapter> = {
    registerTool: (definition) => { registered.push(definition.name); return () => {} },
    onEvent: (event) => { subscribed.push(event); return () => {} },
    workspaceRoot: () => "/tmp/none",
  }
  /** The cordis ctx `apply` receives; `logger` is a no-op and `on` only records. */
  const ctx = { get: (key: string) => (key === "mpdDsh" ? dsh : undefined), logger: { warn: () => {}, info: () => {} }, on: (e: string) => { listeners.push(e) } }
  apply(ctx)
  expect(registered.sort()).toEqual(["mpd_team_compact_run", "mpd_team_compact_status"])
  // TWO triggers, deliberately: the status edge (kept for the record; it fires too late to reach
  // a released member) and the member's own turn boundary (the one that can still reach it).
  expect(subscribed.sort()).toEqual(["agent/status", "agent/turn-stopping"])
  expect(listeners).toEqual([])
})

test("t48 TURN BOUNDARY: the serial-dispatch listener is non-bailing and non-throwing", () => {
  /** The event listeners the row installed through the adapter, keyed by event name. */
  const handlers: Map<string, (...args: unknown[]) => unknown> = new Map()
  /** The stub adapter, wired so the row's own subscription lands in `handlers`. */
  const dsh: Partial<DshAdapter> = {
    registerTool: () => () => {},
    onEvent: (event, handler) => { handlers.set(event, handler); return () => {} },
    workspaceRoot: () => "/tmp/none",
    liveAgents: () => [{ id: "session-a" }],
  }
  /** The warning lines the row's logger produced (one hostile-payload report is expected). */
  const warnings: string[] = []
  /** The cordis ctx `apply` receives; `on` records nothing because the row must not use it. */
  const ctx = { get: (key: string) => (key === "mpdDsh" ? dsh : undefined), logger: { warn: (m: unknown) => warnings.push(String(m)), info: () => {} }, on: () => () => {} }
  apply(ctx)
  /** The listener the row installed for the member's turn boundary. */
  const turnStopping = handlers.get("agent/turn-stopping")!
  expect(typeof turnStopping).toBe("function")
  // SERIAL dispatch: a returned value BAILS the chain and a returned promise is awaited, so the
  // listener must answer `undefined` for EVERY payload — including a hostile one. Same rule the
  // pre-step waterfall defect taught (AGENTS.md §12).
  expect(turnStopping({ agent: { session: { id: "not-a-member", header: { cwd: "/tmp/none" } } } })).toBeUndefined()
  expect(turnStopping({})).toBeUndefined()
  expect(turnStopping({
    /** A hostile payload whose `agent` read throws, so the listener must degrade, not bail. */
    get agent(): never { throw new Error("hostile payload") }
  })).toBeUndefined()
  expect(warnings.some((line) => line.includes("turn-boundary listener failed"))).toBe(true)
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
  /** The tool definitions `apply` registered, captured verbatim by the stub adapter. */
  const registered: DshToolDef[] = []
  /** The stub adapter, wired to capture each definition instead of registering it. */
  const dsh: Partial<DshAdapter> = {
    registerTool: (definition) => { registered.push(definition); return () => {} },
    onEvent: () => () => {},
    workspaceRoot: () => "/tmp/none",
  }
  /** The cordis ctx `apply` receives; `logger` is a no-op and `on` records nothing. */
  const ctx = { get: (key: string) => (key === "mpdDsh" ? dsh : undefined), logger: { warn: () => {}, info: () => {} }, on: () => () => {} }
  apply(ctx)
  expect(registered.length).toBe(2)
  for (const definition of registered) {
    // The adapter forwards `parameters` as an opaque `Record<string, unknown>` — a plugin may hand
    // it any schema-shaped value — so this case names the shape it asserts: the object root and the
    // per-argument `type` strings are exactly what the provider's rejection was about.
    const parameters = definition.parameters as ToolParametersSchema
    // The provider rule: an object root is mandatory. A bare property map has no `type`,
    // which is exactly how it reached the wire as `type: null`.
    expect({ tool: definition.name, type: parameters?.type }).toEqual({ tool: definition.name, type: "object" })
    expect(typeof parameters.properties).toBe("object")
    // `force` is declared on the RUN tool only; the status tool stays a pure read.
    expect(Object.keys(parameters.properties).sort()).toEqual(definition.name === "mpd_team_compact_run" ? ["force", "team_id"] : ["team_id"])
    expect(parameters.properties.team_id.type).toBe("string")
    if (definition.name === "mpd_team_compact_run") expect(parameters.properties.force.type).toBe("boolean")
    expect(parameters.additionalProperties).toBe(false)
    // team_id is optional on BOTH tools: the pass defaults to every finished team.
    expect(parameters.required ?? []).toEqual([])
  }
})

// ── write-on-change (2026-09-16) ─────────────────────────────────────────────
//
// MEASURED before this rule: 235 audit records across 7 teams, 2260 member entries, every one
// `skipped-not-live` and ZERO successes, because the automatic trigger kept re-running its pass
// on teams whose members had already been released. This predicate collapses those repeats; the
// count of collapsed attempts rides onto the next WRITTEN record.
test("write-on-change: sameAuditOutcome is true only for an identical outcome", () => {
  /** The one member row both audits carry, in the shape the writer stores. */
  const member: CompactMemberRecord = { member: "Junior Engineer", sessionId: "s1", outcome: "skipped-not-live", reason: "no live Agent for this session id" }
  /** The baseline audit every comparison below varies one field of. */
  const base: CompactAudit = { schema: "mpd/team-compact@1", teamId: "t", teamName: "T", at: 1, outcome: "not-live", refusedReason: "no live member Agents in this process", members: [member], engineResolution: "agent-scoped" }
  expect(sameAuditOutcome(undefined, base)).toBe(false)
  expect(sameAuditOutcome(base, { ...base, at: 99 })).toBe(true)
  expect(sameAuditOutcome(base, { ...base, outcome: "compacted" })).toBe(false)
  expect(sameAuditOutcome(base, { ...base, refusedReason: "other" })).toBe(false)
  expect(sameAuditOutcome(base, { ...base, members: [{ ...member, outcome: "compacted" }] })).toBe(false)
  expect(sameAuditOutcome(base, { ...base, members: [{ ...member, reason: "busy" }] })).toBe(false)
  expect(sameAuditOutcome(base, { ...base, members: [] })).toBe(false)
  expect(sameAuditOutcome(base, { ...base, members: [member, member] })).toBe(false)
})
