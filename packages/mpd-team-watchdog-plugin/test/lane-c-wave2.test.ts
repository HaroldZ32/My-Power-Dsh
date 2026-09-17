// Lane C (wave 2, `friction-p2-wave`) — the five uncovered halves, as DURABLE arms.
//
// Frozen acceptance (t3 / r-C, contract revision 2) — the two user rulings, verbatim, apply to
// every arm below:
//   (1) T-19 — "`agent_teams_halt` becomes the SOLE external mechanism; the watchdog's PRESERVING
//       hold is demoted to its internal implementation. Surface, tools and docs expose one
//       mechanism."
//   (2) T-18 — "the knobs must be TRULY live in-process (knobs are DATA, so T-21's module-cache
//       limit does not apply), plus a `--live` assertion as a regression pin."
//
// The arms:
//   T-48  the KICK third of the pause clause, with the FOUR frozen readings in one process (held:
//         named decline + zero deliveries; held: claim/update SUCCEED; released: the SAME kick
//         delivers) and TWO negative controls (the pre-redesign claim/update guard re-injected;
//         the hold read site neutered) that each redden their own half.
//   T-16  the FIRST-CLAIM path with a hold latched while the task has ZERO attempts: the claim is
//         ANSWERED and proceeds, the hold record is unchanged, and a zero-attempt task is never
//         holdable (the contrast direction stays green).
//   T-18  a `.mpd/mpd.jsonc` knob edit takes effect in the SAME running engine, no restart, while
//         the settings front door still wins when IT is the layer that moved. A seeded revert
//         (the pre-wave-2 divergence-only resolution) leaves the old value — the RED leg.
//   T-19  one pause state, one external mechanism, the hold named only as its implementation —
//         including the tool DESCRIPTIONS, so the demotion cannot be undone by a text edit.
//   T-05 / T-79 (delivery half)  a dependency-blocked member and a TERMINAL task are never
//         delivered; a claimable one is. The delivery-boundary re-check refuses the TOCTOU wake
//         with a NAMED decline, and a copy WITHOUT the region delivers it (the RED leg).
//
// Everything runs in-process against a sandbox workspace, the REAL adopted scheduler and the real
// registered tools; nothing here touches the repo's team state or the real home.
import { describe, expect, test } from "bun:test"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { HOLD_TOOL, RESUME_TOOL, STATUS_TOOL, applyHold, applyResume, registerWatchdogActions } from "../src/actions"
import { WatchdogEngine } from "../src/engine"
import { HoldRegistry } from "../src/holds"
import { apply } from "../src/index"
import { candidateFor, WATCHDOG_DEFAULTS, WatchdogMachine } from "../src/machine"
import { readHold } from "../src/sidecars"
import { pluginCtx, sandbox, stubAdapter, testConfig, writeTeam, type Sandbox, type StubAdapter } from "./support"

const HERE = fileURLToPath(new URL(".", import.meta.url))
const REPO = resolve(HERE, "../../..")
const ADOPTED_LIB = join(REPO, "packages", "mpd-agent-teams-plugin", "lib")
const ADOPTED_DEPS = join(REPO, "packages", "mpd-agent-teams-plugin", "_deps")
const WATCHDOG_SRC = join(REPO, "packages", "mpd-team-watchdog-plugin", "src")
const STATE_DIR = join(".mpd", "team")
const TEAM_ID = "probe-team"
const CAPTAIN_ID = "session-captain-lane-c"
const MEMBER_ID = "session-member-lane-c"

// ── shared fixture plumbing ────────────────────────────────────────────────────────────────

/** One scratch module tree (`<root>/lib` + a `_deps` symlink) a control can be spliced into. */
function scratchTree(): { libDir: string; root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "lane-c-lib-"))
  mkdirSync(join(root, "lib"), { recursive: true })
  cpSync(ADOPTED_LIB, join(root, "lib"), { recursive: true })
  symlinkSync(ADOPTED_DEPS, join(root, "_deps"), "dir")
  return { libDir: join(root, "lib"), root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

/** One scratch copy of the watchdog's own `src/` (for a seeded revert of a src-side rule). */
function scratchWatchdogSrc(): { srcDir: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "lane-c-src-"))
  const dir = join(root, "packages", "mpd-team-watchdog-plugin", "src")
  mkdirSync(dir, { recursive: true })
  cpSync(WATCHDOG_SRC, dir, { recursive: true })
  return { srcDir: dir, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

/** Replace one literal exactly once, failing loudly rather than silently splicing nothing. */
function spliceOnce(text: string, from: string, to: string, label: string): string {
  const count = text.split(from).length - 1
  if (count !== 1) throw new Error(`${label}: expected exactly 1 anchor, found ${count}`)
  return text.replace(from, to)
}

interface Fixture {
  box: Sandbox
  ctx: Record<string, any>
  tools: Map<string, { execute: (args: any, exec: any) => unknown }>
  deliveries: Array<{ childSessionId: string; text: string }>
  warnings: string[]
  registry: HoldRegistry
  captain: Record<string, unknown>
  member: Record<string, unknown>
  scheduler: { kickTeam: (w: string, t: string, c?: unknown) => Promise<unknown>; kickMember: (w: string, t: string, m: string, c?: unknown) => Promise<unknown> }
  teamFile: string
  cleanup: () => void
}

/**
 * Mount the REAL adopted tools + a REAL hold service over one sandbox workspace.
 *
 * `libDir` lets a control drive a scratch copy of the adopted lib; the default is the shipped one.
 * Each mount imports its modules with a unique query string, so two mounts in one process never
 * share (or accidentally poison) each other's module state.
 */
async function fixture(
  tasks: Array<Record<string, unknown>>,
  options: { libDir?: string; label?: string; members?: Array<{ id: string; name: string; status?: string }> } = {},
): Promise<Fixture> {
  const box = sandbox()
  const members = options.members ?? [{ id: MEMBER_ID, name: "Architect", status: "idle" }]
  const teamFile = writeTeam(box, {
    id: TEAM_ID,
    captainSessionId: CAPTAIN_ID,
    createdAt: Date.now() - 60_000,
    approvedAt: Date.now() - 60_000,
    members,
    tasks: tasks as never,
  })
  // `isTeamState` (state.js) validates every record the adopted tools read: a member needs a
  // `joinedAt` and the team needs a `taskSeq`, so the fixture is completed to that shape.
  const record = JSON.parse(readFileSync(teamFile, "utf8"))
  record.taskSeq = record.tasks.length
  record.members = record.members.map((member: Record<string, unknown>) => ({ joinedAt: Date.now() - 60_000, ...member }))
  writeFileSync(teamFile, JSON.stringify(record, null, 2) + "\n")
  const deliveries: Array<{ childSessionId: string; text: string }> = []
  const warnings: string[] = []
  const tools = new Map<string, { execute: (args: any, exec: any) => unknown }>()
  const live = new Map<string, unknown>()
  const captain = { id: CAPTAIN_ID, status: "idle", session: { id: CAPTAIN_ID, header: { cwd: box.workspace } } }
  live.set(CAPTAIN_ID, captain)
  const memberAgents = members.map((member) => {
    const value = { id: member.id, status: member.status ?? "idle", session: { id: member.id, header: { cwd: box.workspace } } }
    live.set(member.id, value)
    return value
  })
  const registry = new HoldRegistry(box.stateDir, box.workspace)
  const ctx: Record<string, any> = {
    logger: { warn: (text: string) => warnings.push(String(text)), info: (text: string) => warnings.push(String(text)), error: () => {}, debug: () => {} },
    agents: { get: (id: string) => live.get(id), list: () => [...live.values()], register: () => () => undefined },
    subagents: {
      prompt: async (request: { childSessionId: string; content: Array<{ text: string }> }) => {
        deliveries.push({ childSessionId: request.childSessionId, text: request.content.map((block) => block.text).join("") })
        return { messageId: "message-" + deliveries.length }
      },
      sendMessage: () => undefined,
    },
    get: (name: string) => (name === "mpdWatchdog" ? { isHeld: (teamId: string, workspace?: string) => registry.isHeld(teamId, workspace) } : undefined),
    on: () => () => undefined,
    effect: () => () => undefined,
    tools: { register: (definition: any) => { tools.set(definition.name, definition); return () => tools.delete(definition.name) } },
  }
  const stamp = `${options.label ?? "green"}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const libDir = options.libDir ?? ADOPTED_LIB
  const schedulerModule = await import(pathToFileURL(join(libDir, "scheduler.js")).href + "?v=" + stamp)
  const toolsModule = await import(pathToFileURL(join(libDir, "tools.js")).href + "?v=" + stamp)
  toolsModule.registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
  const scheduler = schedulerModule.installTeamScheduler(ctx, { stateDir: STATE_DIR })
  return {
    box, ctx, tools, deliveries, warnings, registry, captain, member: memberAgents[0] as Record<string, unknown>,
    scheduler, teamFile,
    cleanup: () => box.cleanup(),
  }
}

const readTeamFile = (fix: Fixture): any => JSON.parse(readFileSync(fix.teamFile, "utf8"))
const holdFile = (fix: Fixture): string => join(fix.box.workspace, STATE_DIR, "watchdog", "hold", TEAM_ID + ".json")
const call = async (fix: Fixture, name: string, args: unknown, agent: unknown) => {
  const definition = fix.tools.get(name)
  if (definition === undefined) throw new Error("tool not registered: " + name)
  return await definition.execute(args, { agent })
}
const declineLines = (fix: Fixture, needle: string): string[] => fix.warnings.filter((line) => line.includes(needle))
const probeTask = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  id, subject: "probe " + id, description: "lane C probe", status, assignee: "Architect",
  dependencies: [], attempt: status === "pending" ? 0 : 1, createdAt: Date.now() - 60_000, updatedAt: Date.now() - 60_000,
  ...(status === "pending" ? {} : { attemptId: "att-" + id }), ...extra,
})

// ── T-48 — the KICK third, with the frozen four readings and two controls ───────────────────

describe("T-48 — the KICK reading (frozen D-2): no delivery while held, claim/update succeed, a NAMED decline, delivery after release", () => {
  test("held: the kick is ANSWERED with a NAMED decline, zero deliveries, team bytes untouched; claim+update still SUCCEED", async () => {
    const fix = await fixture(
      [probeTask("t1", "pending"), { ...probeTask("t2", "in_progress", { attemptId: "att-t2" }), assignee: "Lead" }],
      { members: [{ id: MEMBER_ID, name: "Architect", status: "idle" }, { id: "session-lead-lane-c", name: "Lead", status: "idle" }] },
    )
    const lead = fix.ctx.agents.get("session-lead-lane-c")
    try {
      const held = applyHold(fix.box.workspace, STATE_DIR, { team_id: TEAM_ID, cause: "silence", ttl_ms: 0 }, fix.registry)
      expect(held.applied).toBe(true)
      const beforeRefusal = readFileSync(fix.teamFile, "utf8")

      // (i) THE OPEN LEG (t23): a kick is ANSWERED with a NAMED decline that REACHES THE CALLER.
      // The shipped carrier is the decline seam every other refusal in this file uses
      // (`noteDispatchDecline` -> ctx.logger.warn, deduped per team/member/reason); the kick's
      // RETURN value is measured too, so the reading states which carrier actually carries the
      // name instead of assuming one. The other three legs of D-2 are the fault lane's F6/F7
      // (`skills/dsh-qa/scripts/team-watchdog-fault.mjs`, fixture case `pause-preserves`); this
      // arm re-measures them in-process only as the same-run contrast for this leg.
      const kickReturn = await fix.scheduler.kickMember(fix.box.workspace, TEAM_ID, "Architect", fix.captain)
      expect(kickReturn).toBeUndefined() // measured: the name is NOT carried by the return value
      expect(fix.deliveries).toHaveLength(0)
      const declines = declineLines(fix, "the team is held by the team watchdog (hold ")
      expect(declines).toHaveLength(1)
      expect(declines[0]).toContain("hold " + String(held.hold?.id))
      expect(declines[0]).toContain("since " + new Date(Number(held.hold?.since)).toISOString())
      expect(declines[0]).toContain(": silence)")
      expect(declines[0]).toMatch(/hold [0-9a-f-]{8,} since \d{4}-\d{2}-\d{2}T/)
      // …and the naming is CAUSAL, not incidental: the control below (hold read neutered) produces
      // NO decline line and delivers instead, so the line cannot appear without the refusal.

      // (iv) a refused dispatch writes nothing at all.
      expect(readFileSync(fix.teamFile, "utf8")).toBe(beforeRefusal)

      // (ii) the REAL tools still succeed while held (no tool-boundary guard — wave 1's pin).
      await call(fix, "agent_teams_claim_task", { task_id: "t1" }, fix.member)
      const claimed = readTeamFile(fix).tasks.find((entry: any) => entry.id === "t1")
      expect(["claimed", "in_progress"]).toContain(String(claimed.status))
      expect(String(claimed.attemptId ?? "")).not.toBe("")
      await call(fix, "agent_teams_update_task", {
        task_id: "t2", status: "completed", output: "lane C probe complete", attempt_id: "att-t2",
        acceptanceResults: [{ criterion: "probe", status: "passed" }], commandsRun: [{ command: "bun test", status: "passed" }],
      }, lead)
      expect(readTeamFile(fix).tasks.find((entry: any) => entry.id === "t2")?.status).toBe("completed")
      // The hold is not self-cleared by a claim/update: the durable record is unchanged.
      expect(readHold(fix.box.workspace, STATE_DIR, TEAM_ID)?.id).toBe(held.hold?.id)

      // (iii) after the release, the SAME kick delivers exactly once.
      const resumed = applyResume(fix.box.workspace, STATE_DIR, { team_id: TEAM_ID }, fix.registry)
      expect(resumed).toMatchObject({ resumed: true })
      await fix.scheduler.kickMember(fix.box.workspace, TEAM_ID, "Architect", fix.captain)
      const delivered = fix.deliveries.filter((delivery) => delivery.childSessionId.includes(MEMBER_ID))
      expect(delivered).toHaveLength(1)
      expect(delivered[0].text).toContain("Task:")
    } finally {
      fix.cleanup()
    }
  })

  test("CONTROL (kick): neutering the hold read site delivers while held — the KICK arm REDDENS", async () => {
    const scratch = scratchTree()
    const schedulerPath = join(scratch.libDir, "scheduler.js")
    // The pre-redesign shape: the hold is never seen, so no decline site can fire.
    writeFileSync(schedulerPath, spliceOnce(
      readFileSync(schedulerPath, "utf8"),
      "if (view === undefined || view === null || view.held !== true)",
      "if (true)",
      "neuter the hold read",
    ))
    const control = await fixture([probeTask("t1", "pending")], { libDir: scratch.libDir, label: "kick-control" })
    const shipped = await fixture([probeTask("t1", "pending")])
    try {
      await applyHold(control.box.workspace, STATE_DIR, { team_id: TEAM_ID, cause: "silence", ttl_ms: 0 }, control.registry)
      await control.scheduler.kickMember(control.box.workspace, TEAM_ID, "Architect", control.captain)
      expect(control.deliveries).toHaveLength(1) // RED: delivered while held

      // The contrast direction, same state on the shipped tree: still refused.
      await applyHold(shipped.box.workspace, STATE_DIR, { team_id: TEAM_ID, cause: "silence", ttl_ms: 0 }, shipped.registry)
      await shipped.scheduler.kickMember(shipped.box.workspace, TEAM_ID, "Architect", shipped.captain)
      expect(shipped.deliveries).toHaveLength(0)
    } finally {
      control.cleanup()
      shipped.cleanup()
      scratch.cleanup()
    }
  })

  test("CONTROL (claim/update): re-injecting the pre-redesign tool guard REFUSES the same calls", async () => {
    const scratch = scratchTree()
    const toolsPath = join(scratch.libDir, "tools.js")
    const source = readFileSync(toolsPath, "utf8")
    const anchor = "async execute(args, exec) {"
    const registration = source.indexOf("name: 'agent_teams_update_task'")
    const at = source.indexOf(anchor, registration)
    expect(registration).toBeGreaterThan(-1)
    expect(at).toBeGreaterThan(registration)
    const guard = "\n            { const __w = (typeof ctx.get === 'function' ? ctx.get('mpdWatchdog', false) : undefined); if (__w && typeof __w.isHeld === 'function') { const __v = __w.isHeld('" + TEAM_ID + "', args && args.__workspace); if (__v && __v.held === true) throw new Error('team held by the team watchdog (hold ' + __v.holdId + ')'); } }"
    writeFileSync(toolsPath, source.slice(0, at + anchor.length) + guard + source.slice(at + anchor.length))
    const control = await fixture([probeTask("t2", "in_progress", { attemptId: "att-t2" })], { libDir: scratch.libDir, label: "tool-control" })
    const shipped = await fixture([probeTask("t2", "in_progress", { attemptId: "att-t2" })])
    try {
      await applyHold(control.box.workspace, STATE_DIR, { team_id: TEAM_ID, cause: "silence", ttl_ms: 0 }, control.registry)
      let refused = false
      try {
        await call(control, "agent_teams_update_task", { task_id: "t2", status: "in_progress", attempt_id: "att-t2" }, control.member)
      } catch (error) {
        refused = String((error as Error)?.message ?? error).includes("held by the team watchdog")
      }
      expect(refused).toBe(true) // RED on the reverted guard

      // The shipped tree, same state and same call: it SUCCEEDS while held.
      await applyHold(shipped.box.workspace, STATE_DIR, { team_id: TEAM_ID, cause: "silence", ttl_ms: 0 }, shipped.registry)
      await call(shipped, "agent_teams_update_task", { task_id: "t2", status: "in_progress", attempt_id: "att-t2" }, shipped.member)
      expect(readTeamFile(shipped).tasks.find((entry: any) => entry.id === "t2")).toBeDefined()
    } finally {
      control.cleanup()
      shipped.cleanup()
      scratch.cleanup()
    }
  })
})

// ── T-16 — the first-claim path with a hold latched and ZERO attempts ───────────────────────

describe("T-16 — a hold latched while the task has ZERO attempts: the first claim is ANSWERED, the hold record is unchanged, the contrast stays green", () => {
  test("the first claim PROCEEDS while held (no hold guard), the hold is untouched, and the kick is still answered with the named reason", async () => {
    const fix = await fixture([probeTask("t1", "pending")])
    try {
      const held = applyHold(fix.box.workspace, STATE_DIR, { team_id: TEAM_ID, task_id: "t1", cause: "silence", ttl_ms: 0 }, fix.registry)
      const holdBefore = readFileSync(holdFile(fix), "utf8")

      // The delivery half of the same state: a NAMED decline, never a silent no-op.
      await fix.scheduler.kickMember(fix.box.workspace, TEAM_ID, "Architect", fix.captain)
      expect(fix.deliveries).toHaveLength(0)
      expect(declineLines(fix, "the team is held by the team watchdog (hold ")).toHaveLength(1)

      // The first claim: WHICH branch fired, and why — the shipped semantics answer it and proceed.
      const claim = await call(fix, "agent_teams_claim_task", { task_id: "t1" }, fix.member)
      expect(claim).toBeDefined()
      const after = readTeamFile(fix).tasks.find((entry: any) => entry.id === "t1")
      expect(["claimed", "in_progress"]).toContain(String(after.status))
      expect(String(after.attemptId ?? "")).not.toBe("")

      // The hold record is unchanged by the claim: self-clearing follows the generation rule only.
      expect(readFileSync(holdFile(fix), "utf8")).toBe(holdBefore)
      expect(readHold(fix.box.workspace, STATE_DIR, TEAM_ID)?.id).toBe(held.hold?.id)

      // After the release the same dispatch path proceeds.
      const resumed = applyResume(fix.box.workspace, STATE_DIR, { team_id: TEAM_ID }, fix.registry)
      expect(resumed).toMatchObject({ resumed: true })
      expect(readHold(fix.box.workspace, STATE_DIR, TEAM_ID)).toBeUndefined()
    } finally {
      fix.cleanup()
    }
  })

  test("CONTRAST (row f): a zero-attempt task is never holdable — no candidate and no escalate decision", () => {
    const now = Date.now()
    const team = { id: TEAM_ID, createdAt: now, tasks: [{ id: "t1", status: "pending", assignee: "Architect" }] }
    // No attemptId and no stamp: the r7 dispatch precondition excludes it entirely.
    const candidates = candidateFor(team as never, () => [], () => "architect")
    expect(candidates).toHaveLength(0)
    const decisions = new WatchdogMachine().observe(candidates, now + WATCHDOG_DEFAULTS.warnSilenceMs * 3, { ...WATCHDOG_DEFAULTS, actionOnEscalate: "pause" })
    expect(decisions.filter((decision) => decision.type === "escalate")).toHaveLength(0)
    expect(decisions.filter((decision) => decision.type === "never-started")).toHaveLength(0)
  })
})

// ── T-05 / T-79 delivery half — the scheduler's own readiness predicate at the wake ─────────

const at = Date.now() - 60_000
const rosterTasks = () => ([
  { id: "t1", subject: "root", status: "in_progress", assignee: "Lead", attempt: 1, attemptId: "att-t1", dependencies: [], createdAt: at, updatedAt: at },
  { id: "t2", subject: "blocked work", status: "pending", assignee: "Blocked", attempt: 0, dependencies: ["t1"], createdAt: at, updatedAt: at },
  { id: "t3", subject: "claimable work", status: "pending", assignee: "Claimable", attempt: 0, dependencies: [], createdAt: at, updatedAt: at },
  { id: "t4", subject: "finished work", status: "completed", assignee: "Terminal", attempt: 1, attemptId: "35503430-5a3b-4306-b6f2-d38d416cb438", verdict: "pass", dependencies: [], createdAt: at, updatedAt: at },
])
const roster = [
  { id: "session-lead", name: "Lead", status: "idle" },
  { id: "session-blocked", name: "Blocked", status: "idle" },
  { id: "session-claimable", name: "Claimable", status: "idle" },
  { id: "session-terminal", name: "Terminal", status: "idle" },
]

describe("T-05 / T-79 (delivery half) — a blocked or terminal task is never delivered, a claimable one is", () => {
  test("blocked: ZERO deliveries; claimable: exactly ONE delivery; terminal: ZERO and the finished bytes untouched", async () => {
    const fix = await fixture(rosterTasks(), { members: roster })
    try {
      await fix.scheduler.kickMember(fix.box.workspace, TEAM_ID, "Blocked", fix.captain)
      expect(fix.deliveries.filter((delivery) => delivery.childSessionId.includes("session-blocked"))).toHaveLength(0)

      await fix.scheduler.kickMember(fix.box.workspace, TEAM_ID, "Claimable", fix.captain)
      const claimableDeliveries = fix.deliveries.filter((delivery) => delivery.childSessionId.includes("session-claimable"))
      expect(claimableDeliveries).toHaveLength(1)
      expect(claimableDeliveries[0].text).toContain("Task: t3")

      const terminalBefore = JSON.stringify(readTeamFile(fix).tasks.find((entry: any) => entry.id === "t4"))
      await fix.scheduler.kickMember(fix.box.workspace, TEAM_ID, "Terminal", fix.captain)
      expect(fix.deliveries.filter((delivery) => delivery.childSessionId.includes("session-terminal"))).toHaveLength(0)
      const terminalTask = readTeamFile(fix).tasks.find((entry: any) => entry.id === "t4")
      expect(terminalTask.status).toBe("completed")
      expect(terminalTask.attemptId).toBe("35503430-5a3b-4306-b6f2-d38d416cb438")
      expect(JSON.stringify(terminalTask)).toBe(terminalBefore)
    } finally {
      fix.cleanup()
    }
  })

  test("CONTROL (predicate): with the dependency test removed the blocked member IS delivered — the arm REDDENS", async () => {
    const scratch = scratchTree()
    const schedulerPath = join(scratch.libDir, "scheduler.js")
    writeFileSync(schedulerPath, spliceOnce(
      readFileSync(schedulerPath, "utf8"),
      "return task.status === 'pending'\n        && task.reassigning !== true\n        && unsatisfiedDependencies([...tasks], task.dependencies).length === 0;",
      "return task.status === 'pending'\n        && task.reassigning !== true;",
      "drop the dependency test from the readiness predicate",
    ))
    const fix = await fixture(rosterTasks(), { members: roster, libDir: scratch.libDir, label: "predicate-control" })
    try {
      await fix.scheduler.kickMember(fix.box.workspace, TEAM_ID, "Blocked", fix.captain)
      expect(fix.deliveries.filter((delivery) => delivery.childSessionId.includes("session-blocked"))).toHaveLength(1)
    } finally {
      fix.cleanup()
      scratch.cleanup()
    }
  })

  test("T-79 THE RACE: the delivery-boundary re-check refuses a task that became terminal before the wake; without the region the member IS woken", async () => {
    const anchorHook = async (libDir: string, label: string, stripRegion: boolean) => {
      const schedulerPath = join(libDir, "scheduler.js")
      let source = readFileSync(schedulerPath, "utf8")
      if (stripRegion) {
        const marker = "//#endregion mpd-delta terminal-dispatch-recheck"
        const start = source.indexOf("//#region mpd-delta terminal-dispatch-recheck")
        const end = source.indexOf(marker)
        expect(start).toBeGreaterThan(-1)
        expect(end).toBeGreaterThan(start)
        source = source.slice(0, start) + source.slice(end + marker.length)
      }
      const hook = "async function __laneCForceTerminal(stateRoot, teamId, taskId) { const { readFileSync: __r, writeFileSync: __w } = await import('node:fs'); const p = stateRoot + '/' + teamId + '/team.json'; const rec = JSON.parse(__r(p, 'utf8')); const t = (rec.tasks ?? []).find((x) => x.id === taskId); if (t) { t.status = 'completed'; t.verdict = 'pass'; t.updatedAt = Date.now(); __w(p, JSON.stringify(rec, null, 2) + '\\n'); } }\n"
      const injection = "await __laneCForceTerminal(stateRoot, team.id, ticket.taskId);\n                "
      const anchor = stripRegion
        ? "const accepted = await deliverToMember(ctx, captain, ticket.memberId,"
        : "const stale = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {"
      writeFileSync(schedulerPath, hook + spliceOnce(source, anchor, injection + anchor, `${label}: insert the interleaving hook`))
      return await fixture([probeTask("t1", "in_progress", { attemptId: "att-t1" })], { libDir, label })
    }

    // GREEN: the shipped region, with the member's completion written inside its own window.
    const scratch = scratchTree()
    const shipped = await anchorHook(scratch.libDir, "race-green", false)
    try {
      await shipped.scheduler.kickMember(shipped.box.workspace, TEAM_ID, "Architect", shipped.captain)
      expect(shipped.deliveries).toHaveLength(0)
      expect(shipped.warnings.some((line) => line.includes("became completed before its assignment could be delivered"))).toBe(true)
      expect(declineLines(shipped, "the member was NOT woken for it")).toHaveLength(1)
      expect(readTeamFile(shipped).tasks.find((entry: any) => entry.id === "t1").status).toBe("completed")
    } finally {
      shipped.cleanup()
    }

    // RED: the SAME interleaving hook on a copy WITHOUT the region — the member is woken for it.
    const stripped = scratchTree()
    const red = await anchorHook(stripped.libDir, "race-red", true)
    try {
      await red.scheduler.kickMember(red.box.workspace, TEAM_ID, "Architect", red.captain)
      const terminalDeliveries = red.deliveries.filter((delivery) => delivery.text.includes("Task: t1"))
      expect(terminalDeliveries).toHaveLength(1)
    } finally {
      red.cleanup()
      stripped.cleanup()
      scratch.cleanup()
    }
  })
})

// ── T-18 — the knobs are live in-process, and the file layer only wins when IT moved ────────

const writeConfig = (box: Sandbox, body: string) => {
  mkdirSync(join(box.workspace, ".mpd"), { recursive: true })
  writeFileSync(join(box.workspace, ".mpd", "mpd.jsonc"), body)
}

describe("T-18 — a .mpd/mpd.jsonc knob edit is applied in the SAME running engine, no restart", () => {
  test("OBSERVED (`--live`): the same instance reports the file's value on the next tick, and the settings front door still wins when IT moved", async () => {
    const box = sandbox()
    try {
      const stub: StubAdapter = stubAdapter({ workspace: box.workspace })
      const engine = new WatchdogEngine(stub.adapter, { on: () => () => {}, logger: { warn: () => {}, info: () => {} } } as never, testConfig({ stateDir: box.stateDir }))
      const disposers = engine.install()
      try {
        await engine.tickOnce(1_000) // the mount observation: the namespace is authoritative
        expect(engine.getKnobs().warnSilenceMs).toBe(90_000)
        expect(engine.knobDivergence().fileApplied).toBe(false)

        writeConfig(box, '// live tuning\n{\n  "watchdog": {\n    "warnSilenceMs": 900000,\n    "holdTtlMs": 60000,\n  }\n}\n')
        await engine.tickOnce(2_000) // NO restart, same instance, no re-import
        expect(engine.getKnobs().warnSilenceMs).toBe(900_000)
        expect(engine.getKnobs().holdTtlMs).toBe(60_000)
        const view = engine.knobDivergence()
        expect(view.fileApplied).toBe(true)
        expect(view.liveLayer).toBe("file")
        expect(view.restartRequired).toBe(false)

        // The settings front door still wins when the NAMESPACE is the layer that moved.
        stub.setSettings({ watchdog: { warnSilenceMs: 700_000 } })
        stub.emitSettings()
        expect(engine.getKnobs().warnSilenceMs).toBe(700_000)
        await engine.tickOnce(2_500) // the STATUS reading is recomputed on the tick
        expect(engine.knobDivergence().fileApplied).toBe(false)

        // …and a NEW file edit takes it back, still in-process.
        writeConfig(box, '{"watchdog":{"warnSilenceMs":800000}}\n')
        await engine.tickOnce(3_000)
        expect(engine.getKnobs().warnSilenceMs).toBe(800_000)
        expect(engine.knobDivergence().fileApplied).toBe(true)
      } finally {
        for (const off of disposers) off()
        engine.stop()
      }
    } finally {
      box.cleanup()
    }
  })

  test("RED (seeded revert): the pre-wave-2 divergence-only resolution leaves the OLD value — the `--live` claim is falsifiable", async () => {
    const scratch = scratchWatchdogSrc()
    const enginePath = join(scratch.srcDir, "engine.ts")
    writeFileSync(enginePath, spliceOnce(
      readFileSync(enginePath, "utf8"),
      'const base = this.liveLayer === "file" && fileDigest !== null ? overlayWatchdogSection(namespaceValue, file.section) : namespaceValue',
      "const base = namespaceValue",
      "seeded revert of the live file layer",
    ))
    const box = sandbox()
    try {
      const stub: StubAdapter = stubAdapter({ workspace: box.workspace })
      const { WatchdogEngine: Reverted } = await import(pathToFileURL(enginePath).href + "?v=" + Date.now())
      const engine = new Reverted(stub.adapter, { on: () => () => {}, logger: { warn: () => {}, info: () => {} } }, testConfig({ stateDir: box.stateDir }))
      const disposers = engine.install()
      try {
        await engine.tickOnce(1_000)
        writeConfig(box, '{"watchdog":{"warnSilenceMs":900000}}\n')
        await engine.tickOnce(2_000)
        expect(engine.getKnobs().warnSilenceMs).toBe(90_000) // the old value: liveness lost
        await engine.tickOnce(2_500)
        const view = engine.knobDivergence()
        expect(view.restartRequired).toBe(true)
        expect(view.divergent).toContain("warnSilenceMs")
      } finally {
        for (const off of disposers) off()
        engine.stop()
      }
    } finally {
      box.cleanup()
      scratch.cleanup()
    }
  })
})

// ── T-19 — the demotion cannot be undone by a text edit ─────────────────────────────────────

describe("T-19 — the surface names ONE mechanism, and the three tools stay registered", () => {
  test("the registered descriptions name the hold as the INTERNAL implementation, never as a second mechanism", () => {
    const box = sandbox()
    try {
      writeTeam(box, { id: TEAM_ID, members: [{ id: "a1", name: "Architect" }], tasks: [{ id: "t1", status: "pending", assignee: "Architect" }] })
      const stub = stubAdapter({ workspace: box.workspace })
      registerWatchdogActions(stub.adapter, box.stateDir)
      const names = [...stub.tools.keys()].sort()
      expect(names).toEqual([HOLD_TOOL, RESUME_TOOL, STATUS_TOOL].sort())
      const text = names.map((name) => String((stub.tools.get(name) as { description?: string })?.description ?? "")).join("\n")
      for (const old of ["NOT agent_teams_halt", "which PAUSE mechanism is active per team", "or `held`"]) {
        expect(text).not.toContain(old)
      }
      expect(text).toContain("agent_teams_halt")
      expect(text).toContain("INTERNAL implementation")
    } finally {
      box.cleanup()
    }
  })

  test("apply() keeps exactly the three tools registered and publishes the hold service", () => {
    const box = sandbox()
    try {
      writeTeam(box, { id: TEAM_ID, members: [{ id: "a1", name: "Architect" }], tasks: [{ id: "t1", status: "pending", assignee: "Architect" }] })
      const ctx = pluginCtx(box.workspace)
      const report = apply(ctx, { stateDir: box.stateDir, teamCacheMs: 0, tickIntervalMs: 3_600_000, warnSilenceMs: 7_200_000 })
      try {
        expect([...ctx.__stub.tools.keys()].sort()).toEqual([HOLD_TOOL, RESUME_TOOL, STATUS_TOOL].sort())
        const service = ctx.services.get("mpdWatchdog") as { isHeld: (team: string, workspace?: string) => { held: boolean } }
        expect(service?.isHeld(TEAM_ID)).toMatchObject({ held: false })
        expect(report.applied).toBe(true)
      } finally {
        report.engine?.stop()
        ctx.__dispose()
      }
    } finally {
      box.cleanup()
    }
  })
})
