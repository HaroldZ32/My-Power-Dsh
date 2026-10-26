// THE ZOMBIE-MEMBER DEFECT (contract `.mpd/plans/agent-slot-hygiene.md`, frozen 2026-10-26T14:40Z).
//
// WHAT BROKE, MEASURED. `agent_teams_plan {action:"add_member"}` on a LIVE team appended the member and
// then raised it. A failed raise left the row at `status: "failed"` — a teammate the roster rendered and
// the capacity accounting counted — and the activation slot it started was never handed back. Five such
// attempts in the cellwork wave (`web-engineer`, `web-renderer`, `dag-web`, `web-builder`, `web-build`)
// ended with the harness refusing a FRESH name with `subagent limit reached (active child limit: 8)`.
//
// THE RULE THESE ARMS PIN. A failed raise leaves NOTHING: the row is dropped from the roster, the
// executor hands the activation back, and the next raise of a different member succeeds. A `failed` row
// a legacy record still carries is not a live member on any surface — the plan's `status` answer, the
// `/state` payload, the workspace listing or the graph model.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply, TEAMS_SERVICE, type MpdTeamsService } from "../src/index"
import { buildTeamState, buildWorkspaceTeams } from "../src/team-web"
import { GraphModels } from "../src/graph-model"
import { addTeamMember, createTeam, readTeam, writeTeam, type TeamRecord } from "../src/team-store"

/** The frozen instant every fixture here is stamped with. */
const NOW = new Date("2026-10-26T14:40:00.000Z")

/** The sandboxes this file created, removed after every arm. */
const sandboxes: string[] = []
afterEach(() => { for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true }) })

/** One registered tool, typed for the two fields these arms drive. */
interface CapturedTool {
  /** The registered name. */
  name: string
  /** The runner, called with the harness's own exec shape. */
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** The sandbox one arm drives. */
interface Harness {
  /** The temp workspace every call resolves to. */
  workspace: string
  /** The lead session that stages, approves and appends. */
  lead: string
  /** Every rise the executor double was asked for, by member name. */
  raised: string[]
  /**
   * Drive one registered tool AS a given session.
   * @param name - the tool name.
   * @param args - its arguments.
   * @param sessionId - the calling session.
   * @returns the tool's own answer.
   */
  call: (name: string, args: unknown, sessionId: string) => Promise<unknown>
  /** The `mpdTeams` service the row published. */
  service: () => MpdTeamsService
}

/**
 * Build the harness with a spawn double that can FAIL once for a named member.
 *
 * The double mints `child-<name>` as the handle, which is also the member session's own id, and it
 * throws on the FIRST raise of a name listed in `failOnce` — the exact shape of the measured defect
 * (one failed attempt, then a healthy pool).
 * @param failOnce - member names whose first raise throws.
 * @returns the sandbox.
 */
function harness(failOnce: string[] = []): Harness {
  /** A fresh workspace, so no arm sees another arm's records. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-slot-hygiene-"))
  sandboxes.push(workspace)
  /** The lead session id. */
  const lead = "sess-lead"
  /** The tools the plugin registered. */
  const tools = new Map<string, CapturedTool>()
  /** The service captured from `ctx.provide`. */
  let service: MpdTeamsService | undefined
  /** Every raise request's member name, in order. */
  const raised: string[] = []
  /** The names whose one failure has already fired. */
  const fired = new Set<string>()
  /** The stub backend. */
  const executor = {
    kind: "native",
    reason: "the arm's own executor",
    /** The backends this stub claims to provide. */
    providers: (): string[] => ["spawn"],
    /**
     * Raise one member, or throw once for a name the arm asked to break.
     * @param _caller - the staging agent, never inspected.
     * @param request - the raise request, read for the member's name.
     * @returns the handle the record keeps as `executorRef`.
     */
    spawn: async (_caller: unknown, request: { name?: string }): Promise<{ handle: string; executor: string }> => {
      /** The member name this raise is for. */
      const name = String(request?.name ?? "")
      raised.push(name)
      if (failOnce.includes(name) && !fired.has(name)) {
        fired.add(name)
        throw new Error("subagent limit reached (active child limit: 8)")
      }
      return { handle: "child-" + name.replace(/\s+/g, "-"), executor: "native" }
    },
    /** Deliver nothing; these arms never dispatch. */
    send: async (): Promise<void> => {},
    /** Interrupt nobody. */
    interrupt: async (): Promise<void> => {},
    /** The backend tracks no live identity. */
    membership: (): undefined => undefined,
    /** The backend tracks no members; the record is the roster. */
    members: (): [] => [],
  }
  /** The stub adapter: the seams this row uses, and nothing else. */
  const dsh = {
    registerTool: (definition: CapturedTool): (() => void) => { tools.set(definition.name, definition); return () => {} },
    registerCommand: (): (() => void) => () => {},
    workspaceRoot: (): string => workspace,
    text: (value: unknown): unknown => value,
    teamExecutor: (): typeof executor => executor,
    teamMembership: (): undefined => undefined,
    teamListMembers: (): [] => [],
    teamListTasks: (): [] => [],
    capabilities: (): Record<string, never> => ({}),
  }
  /** The minimal cordis context `apply` needs. */
  const ctx = {
    get: (id: string) => (id === "mpdDsh" ? dsh : undefined),
    on: (): void => {},
    effect: (fn: () => unknown) => { try { return fn() ?? (() => {}) } catch { return () => {} } },
    provide: (id: string, value: unknown): void => { if (id === TEAMS_SERVICE) service = value as MpdTeamsService },
    inject: (): void => {},
  }
  apply(ctx as never)
  return {
    workspace,
    lead,
    raised,
    call: async (name: string, args: unknown, sessionId: string): Promise<unknown> => {
      /** The registered tool. */
      const tool = tools.get(name)
      if (tool === undefined) throw new Error(`no tool ${name} (have ${[...tools.keys()].join(", ")})`)
      return tool.execute(args, { agent: { session: { id: sessionId, header: { cwd: workspace } } }, signal: undefined })
    },
    service: (): MpdTeamsService => {
      if (service === undefined) throw new Error("the row published no mpdTeams service")
      return service
    },
  }
}

/**
 * Stage and approve a one-member team AS the lead, and return the record it minted.
 * @param h - the sandbox.
 * @param member - the single member the approval raises.
 * @returns the record the approval created.
 */
async function approveTeam(h: Harness, member: string): Promise<TeamRecord> {
  await h.call("agent_teams_plan", { action: "create", name: "hygiene", description: "one member" }, h.lead)
  await h.call("agent_teams_plan", { action: "add_member", member: { name: member, prompt: `You are ${member}.` } }, h.lead)
  await h.call("agent_teams_plan", { action: "create_task", task: { subject: "the row", description: "one row", blocked_by: [] } }, h.lead)
  /** The approval's answer. */
  const answer = await h.call("agent_teams_plan", { action: "approve" }, h.lead) as { team?: TeamRecord }
  if (answer.team === undefined) throw new Error("the approval answered no team")
  return answer.team
}

describe("a failed raise leaves no zombie and no held slot", () => {
  test("R3: the failed row is DROPPED and the next raise of a DIFFERENT member succeeds", async () => {
    /** The sandbox: the FIRST raise of `web-engineer` fails, every later one succeeds. */
    const h = harness(["web-engineer"])
    /** The live team, approved with one healthy member. */
    const team = await approveTeam(h, "lead-member")
    // The first live append FAILS at the raise: a fresh name, a broken pool behind it.
    /** The failed append's answer. */
    const failed = await h.call("agent_teams_plan", { action: "add_member", member: { name: "web-engineer", prompt: "You build the web." } }, h.lead) as { team?: TeamRecord; stoppedAt?: string; appended?: string }
    expect(failed.stoppedAt).toContain("active child limit")
    // NO ZOMBIE: the roster carries the member that is really there and nothing else.
    /** The record as the failed call left it. */
    const afterFailure = readTeam(h.workspace, team.teamId) as TeamRecord
    expect(afterFailure.members.map((member) => member.name)).toEqual(["lead-member"])
    expect(afterFailure.members.some((member) => member.status === "failed")).toBe(false)
    // The answer SAYS what happened instead of promising an apperid row.
    expect(String(failed.appended)).toContain("REMOVED")
    // THE SLOT IS FREE: a DIFFERENT member appends and raises normally.
    /** The healthy append's answer. */
    const healthy = await h.call("agent_teams_plan", { action: "add_member", member: { name: "web-splitter", prompt: "You split the work." } }, h.lead) as { team?: TeamRecord; spawned?: string }
    expect(healthy.spawned).toBe("child-web-splitter")
    /** The record after the healthy append. */
    const after = readTeam(h.workspace, team.teamId) as TeamRecord
    expect(after.members.map((member) => [member.name, member.status])).toEqual([["lead-member", "running"], ["web-splitter", "running"]])
    expect(after.members.find((member) => member.name === "web-splitter")?.executorRef).toBe("child-web-splitter")
    // The double really did see the failed attempt and the recovery, in that order.
    expect(h.raised).toEqual(["lead-member", "web-engineer", "web-splitter"])
  })

  test("R3: the happy path is unchanged — a live append raises, records its handle and stays running", async () => {
    /** The sandbox with no injected failure. */
    const h = harness()
    /** The live team. */
    const team = await approveTeam(h, "lead-member")
    /** A healthy append. */
    const appended = await h.call("agent_teams_plan", { action: "add_member", member: { name: "builder", prompt: "You build." } }, h.lead) as { team?: TeamRecord; spawned?: string; member?: { status?: string } }
    expect(appended.spawned).toBe("child-builder")
    expect(appended.member?.status).toBe("running")
    /** The record the append wrote. */
    const record = readTeam(h.workspace, team.teamId) as TeamRecord
    expect(record.members.map((member) => member.name)).toEqual(["lead-member", "builder"])
    expect(record.members.find((member) => member.name === "builder")?.status).toBe("running")
  })
})

describe("a legacy `failed` row is not a live member on any surface", () => {
  /**
   * Write a record carrying a hand-added `failed` row — the shape a build before this contract left behind.
   * @param h - the sandbox.
   * @returns the record as written, with its ghost row.
   */
  function withGhost(h: Harness): TeamRecord {
    /** A live team, created through the store and given one real member the store accepts. */
    const created = createTeam(h.workspace, { teamId: "team-ghost", name: "ghost team", description: "one ghost", leadSessionId: h.lead }, NOW)
    /** The record with the one REAL member the team was approved with. */
    const record = addTeamMember(created, { name: "lead-member", description: "the real one" }, NOW)
    /** The same record plus the zombie a failed raise used to leave. */
    const ghosted: TeamRecord = {
      ...record,
      members: [...record.members, { id: "M9", name: "web-engineer", description: "never raised", status: "failed", spawnedAt: NOW.toISOString() }],
    }
    writeTeam(h.workspace, ghosted)
    return ghosted
  }

  test("the plan `status` answer names only the members the team has", async () => {
    /** The sandbox. */
    const h = harness()
    withGhost(h)
    /** The status answer. */
    const status = await h.call("agent_teams_plan", { action: "status" }, h.lead) as { members?: Array<{ name?: string }> }
    /** The roster names the answer carries. */
    const names = (status.members ?? []).map((member) => String(member.name))
    expect(names).toContain("lead-member")
    expect(names).not.toContain("web-engineer")
  })

  test("the `/state` payload and the workspace listing do not count or list it", () => {
    /** The sandbox. */
    const h = harness()
    /** The ghosted record. */
    const ghosted = withGhost(h)
    /** The `/state` payload for it. */
    const payload = buildTeamState(ghosted, h.workspace, h.lead, { kind: "native", reason: "the arm's own executor" })
    expect(payload.members.map((member) => member.name)).toEqual(["lead-member"])
    // AND THE LISTING'S COUNT: the number a workspace panel prints must not add a member nobody raised.
    /** The workspace listing for the same record. */
    const listing = buildWorkspaceTeams([ghosted], ghosted.teamId)
    expect(listing.records[0]?.members).toBe(1)
  })

  test("the graph model renders TASKS only, so a failed member can never be one of its nodes", () => {
    /** The sandbox. */
    const h = harness()
    /** The ghosted record. */
    const ghosted = withGhost(h)
    /** A cache wired to a fixed revision, which is all this arm needs. */
    const models = new GraphModels({ revision: (): number => 0, notify: (): void => {} })
    /** The served model. */
    const model = models.get(h.workspace, ghosted)
    expect(model).toBeDefined()
    expect(model?.nodes.map((node) => node.id)).not.toContain("web-engineer")
    expect(model?.nodes.map((node) => node.id)).not.toContain("M9")
    models.dispose()
  })
})
