// Lane C of `.mpd/plans/agent-worktrees.md`: every team-core member spawn site gives a WRITE-capable
// member its own worktree through the `mpdWorktree` service, while a read-only seat, an absent/disabled
// row and a degraded create all keep today's shared-checkout spawn with exactly ONE log line.
//
// The CodeRabbit round-1 rules live here too: only a cwd-capable executor allocates a worktree at all,
// a FAILED spawn releases only the checkout it created (a reused one survives), and a roster that
// mounts after the lookup was built is re-read rather than frozen as empty.
//
// The subject is the REQUEST the executor receives (what actually reaches the harness), and the store
// files are read back where a reply could lie about what landed.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { approveTeam, type TeamActionCaller, type TeamActionDeps } from "../src/team-actions"
import { addMember, addTask, stagePlan, writePlan } from "../src/plan-store"
import { activeTeamId, readTeam, type TeamRecord } from "../src/team-store"
import type { DshTeamExecutor, DshTeamSpawnRequest } from "../../mpd-dsh-adapter-plugin/src/index.ts"
import type { StagedPlan } from "../src/plan-store"

/** The instant every store write in this file is stamped with. */
const NOW = new Date("2026-11-12T02:00:00.000Z")

/** The session every arm acts as. */
const LEAD = "lead-session-worktree"

/** The live agent a tool call would carry; its contents are opaque to the actions. */
const AGENT = { session: { id: LEAD, header: {} } }

/** The sandboxes this file created, removed after every arm. */
const sandboxes: string[] = []
afterEach(() => { for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true }) })

/** The roster the read-only skip is classified against — the SAME `mpdRoles.list()` shape the guard reads. */
const ROLES = { list: () => [{ name: "Senior Engineer", readonly: false }, { name: "Explorer", readonly: true }] }

/** The one line of the worktree service's own degrade, so an arm can prove the second line is absent. */
const SERVICE_LINE = "[mpd-worktree] member worktree unavailable for team/member"

/** What one arm's seams observed. */
interface Observed {
  /** The sandbox workspace this arm's stores write into. */
  workspace: string
  /** Every spawn request the executor received, in call order. */
  requests: DshTeamSpawnRequest[]
  /** Every `{teamId, member}` the worktree service was asked about. */
  worktreeCalls: Array<{ teamId: string; member: string }>
  /** Every worktree this row released after a failed spawn, in call order. */
  releases: Array<{ teamId: string; member: string }>
  /** Every diagnostic line the row action wrote. */
  lines: string[]
}

/** What the fake `mpdWorktree` service should answer. */
type WorktreeAnswer = "path" | "degraded" | "throws"

/** The optional capabilities one arm turns on, so the default fixture stays today's native shape. */
interface FixtureOptions {
  /** The executor capability the arm's backend reports. */
  executorKind?: "native" | "official"
  /** A member whose spawn rejects, as a harness refusal would. */
  spawnFailure?: string
  /** Whether the fake service reports an ACTIVE worktree before the create (a REUSE). */
  reused?: boolean
  /** Withhold `mpdRoles` on the FIRST probe only, proving the lookup re-reads a late mount. */
  lateRoles?: boolean
}

/**
 * Build the deps bundle: real stores, a recording executor, and the optional worktree/roster services.
 * @param worktree - the fake service's answer, or `undefined` for a composition that mounts no row.
 * @param options - the executor capability, a failing member, a reused checkout or a late roster.
 * @returns the deps and everything they observed.
 */
function fixture(worktree?: WorktreeAnswer, options: FixtureOptions = {}): { deps: TeamActionDeps; observed: Observed } {
  /** The sandbox workspace this arm's stores write into. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-worktree-wiring-"))
  sandboxes.push(workspace)
  /** What the seams observed. */
  const observed: Observed = { workspace, requests: [], worktreeCalls: [], releases: [], lines: [] }
  /** The executor double: it records the FULL request and answers a predictable handle. */
  const executor: DshTeamExecutor = {
    kind: options.executorKind ?? "native",
    reason: "the arm's own executor",
    providers: (): string[] => ["spawn"],
    spawn: async (_caller: unknown, request: DshTeamSpawnRequest): Promise<{ handle: string; executor: "native" }> => {
      observed.requests.push(request)
      if (request.name === options.spawnFailure) throw new Error("the harness refused the raise")
      return { handle: "child-" + request.name.replace(/\s+/g, "-"), executor: "native" }
    },
    send: async (): Promise<void> => {},
    interrupt: async (): Promise<void> => {},
    membership: (): undefined => undefined,
    members: (): [] => [],
  }
  /** The path the fake service would record, exactly as Lane A derives it. */
  const pathFor = (ref: { teamId: string; member: string }): string => join(observed.workspace, ".mpd", "worktrees", "team", ref.member)
  /** The fake worktree service, absent when the arm mounts no row. */
  const service = worktree === undefined ? undefined : {
    /** Report an EXISTING checkout only for the reuse arm; every other arm starts from nothing. */
    cwdForMember: (_exec: unknown, ref: { teamId: string; member: string }): string | undefined => options.reused === true ? pathFor(ref) : undefined,
    /** Record the pair and answer the arm's configured outcome. */
    createForMember: (_exec: unknown, ref: { teamId: string; member: string }): { path: string; branch: string } | undefined => {
      observed.worktreeCalls.push({ teamId: ref.teamId, member: ref.member })
      if (worktree === "throws") throw new Error("no git checkout here")
      if (worktree === "degraded") {
        // A degraded create reports itself (Lane A); the caller must NOT add a second line.
        observed.lines.push(SERVICE_LINE)
        return undefined
      }
      return { path: pathFor(ref), branch: "agent/team/" + ref.member }
    },
  }
  /** The service lookup the row would perform with `ctx.get(id, false)`. */
  const services: Record<string, unknown> = { mpdRoles: ROLES, ...(service === undefined ? {} : { mpdWorktree: service }) }
  /** How many times the arm asked for the roster, so a late mount can be proven. */
  let rolesProbes = 0
  return {
    observed,
    deps: {
      now: () => NOW,
      executor: () => executor,
      bundleApprovalEffects: async (): Promise<void> => {},
      deriveParentTeam: (): undefined => undefined,
      // The SAME resolution the row's `resolveTeam` performs, reduced to the one arm these actions read.
      resolveTeam: (space: string, sessionId: string) => {
        /** The team this session is bound to, when the index has one. */
        const teamId = activeTeamId(space, sessionId)
        if (teamId === undefined) return { refusal: "no team record in this workspace — approve a plan first" }
        /** The record itself, re-read from disk. */
        const record = readTeam(space, teamId)
        return record === undefined ? { refusal: "no team record in this workspace — approve a plan first" } : { record }
      },
      readWatchdogHold: () => ({ state: "free" }),
      service: (id: string): unknown => {
        // THE LATE MOUNT: the first probe misses, every later one answers the real roster.
        if (id === "mpdRoles" && options.lateRoles === true) {
          rolesProbes += 1
          return rolesProbes === 1 ? undefined : ROLES
        }
        return services[id]
      },
      log: (line: string): void => { observed.lines.push(line) },
      releaseWorktree: async (_agent: unknown, ref: { teamId: string; member: string }): Promise<void> => { observed.releases.push({ teamId: ref.teamId, member: ref.member }) },
      beginDispatch: (): (() => void) => (): void => {},
      assertPlanGraph: (): void => {},
      assertScopesOrdered: (): void => {},
    },
  }
}

/**
 * Stage a plan with one WRITE member and one READ-ONLY member.
 * @param workspace - the sandbox the plan is staged in.
 * @returns the staged plan the approval will build.
 */
function stageTwoMembers(workspace: string): StagedPlan {
  /** The plan as it grows; each helper returns a new value. */
  let plan = stagePlan(workspace, LEAD, { name: "the worktree wave", description: "one writer, one reviewer", approval: "required" }, NOW)
  plan = addMember(plan, { name: "Senior Engineer", description: "implements", prompt: "You implement.", role: "Senior Engineer" })
  plan = addMember(plan, { name: "Explorer", description: "reads the tree", prompt: "You explore.", role: "Explorer" })
  plan = addTask(plan, { subject: "core", description: "own the record", blockedBy: [], owner: "Senior Engineer" })
  writePlan(workspace, plan)
  return plan
}

/**
 * The worktree-related lines only.
 *
 * An approval also writes its own workmate-binding notice through the same sink, so a raw line count
 * would charge this lane for a line it never wrote. The filter names the two prefixes this lane owns.
 * @param observed - the arm's observations.
 * @returns the lines the worktree wiring wrote.
 */
function worktreeLines(observed: Observed): string[] {
  return observed.lines.filter((line) => line.includes("mpd-worktree") || line.includes("mpdWorktree"))
}

/** The caller a tool call would build, with the live agent the arms act as. */
function liveCaller(workspace: string): TeamActionCaller {
  return { workspace, sessionId: LEAD, lineage: [], agent: AGENT }
}

describe("approveTeam — one worktree per write-capable member", () => {
  test("the WRITER's spawn carries its worktree cwd; the READ-ONLY seat carries none", async () => {
    /** This arm's seams, with the worktree row mounted. */
    const { deps, observed } = fixture("path")
    stageTwoMembers(observed.workspace)
    /** The approval, which raises both members. */
    const result = await approveTeam(deps, liveCaller(observed.workspace))
    if (!result.ok) throw new Error(result.error)
    /** The approved record, which names the team id the service was addressed with. */
    const record = readTeam(observed.workspace, result.team?.teamId as string) as TeamRecord
    /** The writer's request. */
    const writer = observed.requests.find((request) => request.name === "Senior Engineer")
    /** The read-only seat's request. */
    const explorer = observed.requests.find((request) => request.name === "Explorer")
    // The writer works in ITS OWN checkout, derived key/path exactly as Lane A builds it.
    expect(writer?.cwd).toBe(join(observed.workspace, ".mpd", "worktrees", "team", "Senior Engineer"))
    // The read-only specialist writes nothing, so it is never given a worktree — and the service is
    // not even asked about it.
    expect(explorer === undefined ? "missing" : "cwd" in explorer).toBe(false)
    expect(observed.worktreeCalls).toEqual([{ teamId: record.teamId, member: "Senior Engineer" }])
    // No degrade line: the service answered a path.
    expect(worktreeLines(observed)).toEqual([])
  })

  test("an ABSENT service spawns unchanged and writes exactly ONE line for the whole roster", async () => {
    /** This arm's seams, with no worktree row mounted at all. */
    const { deps, observed } = fixture(undefined)
    stageTwoMembers(observed.workspace)
    /** The approval, which must still raise both members. */
    const result = await approveTeam(deps, liveCaller(observed.workspace))
    if (!result.ok) throw new Error(result.error)
    // Today's shared-checkout spawn: no `cwd` key on EITHER request, never `cwd: undefined`.
    for (const request of observed.requests) expect("cwd" in request).toBe(false)
    // ONE line for the whole approval, not one per member.
    expect(worktreeLines(observed).length).toBe(1)
    expect(worktreeLines(observed)[0]).toContain("mpdWorktree service is absent")
    expect(observed.worktreeCalls).toEqual([])
  })

  test("a DEGRADED create leaves the request unchanged and adds NO second line", async () => {
    /** This arm's seams, with a service that degrades by itself. */
    const { deps, observed } = fixture("degraded")
    stageTwoMembers(observed.workspace)
    /** The approval. */
    const result = await approveTeam(deps, liveCaller(observed.workspace))
    if (!result.ok) throw new Error(result.error)
    // The writer was ASKED (the service was mounted) but answered nothing usable.
    expect(observed.worktreeCalls).toEqual([{ teamId: expect.any(String), member: "Senior Engineer" }])
    expect(observed.requests.every((request) => !("cwd" in request))).toBe(true)
    // Exactly the service's own line — the contract's "one line total", not two.
    expect(worktreeLines(observed)).toEqual([SERVICE_LINE])
  })

  test("a service that THROWS still spawns, with one line naming the pair", async () => {
    /** This arm's seams, with a service whose own guard failed. */
    const { deps, observed } = fixture("throws")
    stageTwoMembers(observed.workspace)
    /** The approval, which must survive another row's throw. */
    const result = await approveTeam(deps, liveCaller(observed.workspace))
    if (!result.ok) throw new Error(result.error)
    expect(observed.requests.every((request) => !("cwd" in request))).toBe(true)
    expect(worktreeLines(observed).length).toBe(1)
    expect(worktreeLines(observed)[0]).toContain("refused for")
    expect(worktreeLines(observed)[0]).toContain("Senior Engineer")
  })

  test("a FAILED spawn releases the worktree it CREATED, once, and drops the member row", async () => {
    /** This arm's seams, with the writer's raise refused by the executor. */
    const { deps, observed } = fixture("path", { spawnFailure: "Senior Engineer" })
    stageTwoMembers(observed.workspace)
    /** The approval, which stops on the writer but still persists the record. */
    const result = await approveTeam(deps, liveCaller(observed.workspace))
    if (!result.ok) throw new Error(result.error)
    /** The persisted record, read back from disk rather than trusted from the reply. */
    const record = readTeam(observed.workspace, result.team?.teamId as string) as TeamRecord
    // The lookup CREATED this checkout (no active record existed), so the failed attempt releases it.
    expect(observed.releases).toEqual([{ teamId: record.teamId, member: "Senior Engineer" }])
    // The member-row cleanup is unchanged: a raise that never happened holds no roster slot.
    expect(record.members.some((member) => member.name === "Senior Engineer")).toBe(false)
    // The loop stopped at the failure; the second member was never raised.
    expect(observed.requests.some((request) => request.name === "Explorer")).toBe(false)
  })

  test("a FAILED spawn NEVER releases a REUSED worktree", async () => {
    /** This arm's seams, with the writer's checkout already recorded by an earlier attempt. */
    const { deps, observed } = fixture("path", { spawnFailure: "Senior Engineer", reused: true })
    stageTwoMembers(observed.workspace)
    /** The approval, which stops on the writer. */
    const result = await approveTeam(deps, liveCaller(observed.workspace))
    if (!result.ok) throw new Error(result.error)
    // The worktree predates this attempt, so its branch and commits must survive the failed raise.
    expect(observed.releases).toEqual([])
    expect(observed.worktreeCalls).toEqual([{ teamId: expect.any(String), member: "Senior Engineer" }])
  })

  test("the OFFICIAL executor allocates NO worktree and says so once", async () => {
    /** This arm's seams, with the fallback backend that cannot forward `cwd`. */
    const { deps, observed } = fixture("path", { executorKind: "official" })
    stageTwoMembers(observed.workspace)
    /** The approval, which must raise both members in the shared checkout. */
    const result = await approveTeam(deps, liveCaller(observed.workspace))
    if (!result.ok) throw new Error(result.error)
    // No branch, no index entry, no active-entry slot: the service was never even asked.
    expect(observed.worktreeCalls).toEqual([])
    expect(observed.requests.every((request) => !("cwd" in request))).toBe(true)
    // D7's one-line bound: the reason is stated once for the whole roster, not per member.
    expect(observed.lines.filter((line) => line.includes("official executor cannot set cwd")).length).toBe(1)
  })

  test("a roster that mounts LATE still protects a read-only member", async () => {
    /** This arm's seams, whose first roster probe misses and whose second answers. */
    const { deps, observed } = fixture("path", { lateRoles: true })
    stageTwoMembers(observed.workspace)
    /** The approval that raises the writer first and the read-only seat second. */
    const result = await approveTeam(deps, liveCaller(observed.workspace))
    if (!result.ok) throw new Error(result.error)
    // The first read could not classify; the lookup re-read before the second member, so Explorer is
    // skipped — never a checkout it could only waste. The writer still got its own.
    expect(observed.worktreeCalls).toEqual([{ teamId: expect.any(String), member: "Senior Engineer" }])
    /** The read-only seat's request. */
    const explorer = observed.requests.find((request) => request.name === "Explorer")
    expect(explorer === undefined ? "missing" : "cwd" in explorer).toBe(false)
    expect(observed.requests.find((request) => request.name === "Senior Engineer")?.cwd).toBeDefined()
  })
})
