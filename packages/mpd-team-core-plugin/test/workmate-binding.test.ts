// W3-C arm 1: workmate binding at approval (contract `.mpd/plans/autoproject-refactor.md` §4.6).
//
// WHAT THESE ARMS PROVE. `approveTeam` binds each staged member deterministically: an explicit name is
// bound or the WHOLE approval is refused; a strong note match REUSES the instance and gives the seat its
// name; a weak match INITIALIZES a new one; and a library at `workmates.max` leaves the seat plain with
// the reason recorded. Every arm reads the STORE FILES and the approval ANSWER, because a claim in a
// reply is not the record a later reader sees.
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { approveTeam, type TeamActionCaller, type TeamActionDeps } from "../src/team-actions"
import { addMember, addTask, stagePlan, writePlan, type StagedPlan } from "../src/plan-store"
import { addTeamMember, createTeam, updateTeamMember, type TeamRecord } from "../src/team-store"
import type { DshTeamExecutor, DshTeamSpawnRequest } from "../../mpd-dsh-adapter-plugin/src/index.ts"

/** The instant every store write in this file is stamped with. */
const NOW = new Date("2026-11-02T03:00:00.000Z")
/** The session every arm acts as. */
const LEAD = "lead-workmate-binding"
/** The live agent a tool call would carry; its contents are opaque to the action. */
const AGENT = { session: { id: LEAD, header: {} } }

/** The sandboxes this file created, removed after every arm. */
const sandboxes: string[] = []
afterEach(() => { for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true }) })

/** One fake library instance. */
interface FakeWorkmate {
  /** The roster base it was instantiated from. */
  baseName: string
  /** The note card the matcher scores. */
  note: string
  /** Whether the base is read-only. */
  readonly: boolean
  /** The persona body a reuse injects. */
  persona: string
  /** The bounded memory a reuse injects. */
  memory: string
  /** The workspaces this instance has served, as `mpd_workmate_list` now reports them. */
  workspaces?: string[]
}

/** What one arm can observe about the workmate seams. */
interface Observed {
  /** The sandbox workspace this fixture's stores write into. */
  workspace: string
  /** The names the executor was asked to raise, in call order. */
  spawns: string[]
  /** The prompts the executor was handed, in call order. */
  prompts: string[]
  /** Every `mpd_workmate_init` the binding pass made, in call order. */
  inits: Array<{ base: string; name: string }>
  /** Every `mpd_workmate_*` tool the binding pass called, in call order. */
  calls: string[]
  /** The row's diagnostic lines. */
  logs: string[]
}

/** The fixture one arm drives. */
interface Fixture {
  /** What the seams observed. */
  observed: Observed
  /** The deps bundle the action receives. */
  deps: TeamActionDeps
  /** The fake library, mutated by `mpd_workmate_init`. */
  library: Map<string, FakeWorkmate>
}

/**
 * Build the deps bundle: a real store, a recording executor, a fake tool seam and a fake library.
 * @param options - the library contents, the configured score per workmate, and the `workmates.*` knobs.
 * @returns the deps, the observations and the mutable library.
 */
function fixture(options: {
  library?: Record<string, FakeWorkmate>
  scores?: Record<string, number>
  knobs?: Record<string, unknown>
} = {}): Fixture {
  /** The sandbox workspace this arm's stores write into. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-workmate-binding-"))
  sandboxes.push(workspace)
  /** The mutable fake library. */
  const library = new Map<string, FakeWorkmate>(Object.entries(options.library ?? {}))
  /** What the seams observed. */
  const observed: Observed = { workspace, spawns: [], prompts: [], inits: [], calls: [], logs: [] }
  /** The knobs the config service answers; unset keys read as undefined (the row defaults). */
  const knobs = options.knobs ?? {}
  /** The executor double: it raises any member under a predictable handle and records the prompt. */
  const executor: DshTeamExecutor = {
    kind: "native",
    reason: "the arm's own executor",
    providers: (): string[] => ["spawn"],
    spawn: async (_caller: unknown, request: DshTeamSpawnRequest): Promise<{ handle: string; executor: "native" }> => {
      observed.spawns.push(request.name)
      observed.prompts.push(request.prompt)
      return { handle: "child-" + request.name.replace(/\s+/g, "-"), executor: "native" }
    },
    send: async (): Promise<void> => {},
    interrupt: async (): Promise<void> => {},
    membership: (): undefined => undefined,
    members: (): [] => []
  }
  /** The tool seam: the three workmate tools the binding pass may call. */
  const executeTool = async (input: { name: string; arguments?: unknown }): Promise<{ ok: boolean; isError: boolean; value?: unknown }> => {
    observed.calls.push(input.name)
    /** The call's arguments, as the tool would receive them. */
    const args = (input.arguments ?? {}) as Record<string, unknown>
    if (input.name === "mpd_workmate_list") {
      return { ok: true, isError: false, value: { workmates: [...library.entries()].map(([name, row]) => ({ name, baseName: row.baseName, readonly: row.readonly, note: row.note, workspaces: row.workspaces ?? [] })), count: library.size } }
    }
    if (input.name === "mpd_workmate_match") {
      return { ok: true, isError: false, value: { matched: false, threshold: 0.35, matches: [...library.entries()].map(([name, row]) => ({ name, baseName: row.baseName, score: options.scores?.[name] ?? 0, note: row.note })).sort((a, b) => b.score - a.score) } }
    }
    if (input.name === "mpd_workmate_init") {
      observed.inits.push({ base: String(args.base), name: String(args.name) })
      library.set(String(args.name), { baseName: String(args.base), note: "initialized by the binding pass", readonly: false, persona: "initialized persona", memory: "" })
      return { ok: true, isError: false, value: { name: String(args.name), baseName: String(args.base) } }
    }
    return { ok: false, isError: true, value: undefined }
  }
  return {
    observed,
    library,
    deps: {
      now: () => NOW,
      executor: () => executor,
      bundleApprovalEffects: async (): Promise<void> => {},
      deriveParentTeam: (): undefined => undefined,
      resolveTeam: () => ({ refusal: "no team record in this workspace — approve a plan first" }),
      readWatchdogHold: () => ({ state: "free" }),
      // THE THREE SERVICES THE BINDING PASS READS: the adapter's tool seam, the config knobs and the
      // workmate library's own read model. Anything else is absent, exactly like a partial composition.
      service: (id: string): unknown => {
        if (id === "mpdDsh") return { executeTool }
        if (id === "mpdConfig") return { get: (key?: string): unknown => (key === undefined ? knobs : knobs[key]) }
        if (id === "mpdWorkmate") return { read: (name: string) => (library.has(name) ? { name, ...library.get(name)! } : null) }
        return undefined
      },
      log: (line: string): void => { observed.logs.push(line) },
      beginDispatch: () => (): void => {},
      assertPlanGraph: (): void => {},
      assertScopesOrdered: (): void => {}
    }
  }
}

/** The caller a tool call would build, with the live agent the fixture's arms act as. */
function callerOf(workspace: string): TeamActionCaller {
  return { workspace, sessionId: LEAD, lineage: [], agent: AGENT }
}

/**
 * Stage one wave with the given members and one owned task per member.
 * @param workspace - the sandbox the plan is staged in.
 * @param members - the staged members, in order.
 * @returns the staged plan.
 */
function stageWave(workspace: string, members: Array<{ name: string; description: string; prompt: string; role?: string }>): StagedPlan {
  /** The plan as it grows; each store helper returns a new value. */
  let plan = stagePlan(workspace, LEAD, { name: "the bound wave", description: "bind seats deterministically", approval: "required" }, NOW)
  for (const member of members) plan = addMember(plan, { name: member.name, description: member.description, prompt: member.prompt, ...(member.role === undefined ? {} : { role: member.role }) })
  for (const [index, member] of members.entries()) {
    plan = addTask(plan, { subject: "task-" + (index + 1), description: "owned by " + member.name, blockedBy: [], owner: member.name })
  }
  writePlan(workspace, plan)
  return plan
}

/** The team record this approval wrote, read from its own file. */
function storedTeam(workspace: string): TeamRecord {
  /** The directory the approval writes one JSON file per team into. */
  const dir = join(workspace, ".mpd", "team", "teams")
  /** The single record file in it, named by its own team id. */
  const name = readdirSync(dir).filter((entry: string) => entry.endsWith(".json"))[0]
  return JSON.parse(readFileSync(join(dir, name), "utf8")) as TeamRecord
}

describe("updateTeamMember — the workmate binding fields (W3-C2)", () => {
  test("workmateMode/workmateReason round-trip, and a reuse patch CLEARS a stale reason", () => {
    /** A one-member record, built through the real store. */
    let record = createTeam("ws-unused", { name: "t", description: "d", leadSessionId: "lead-x", planId: "plan-x" }, NOW)
    record = addTeamMember(record, { name: "impl", description: "implements" }, NOW)
    // A `none` binding keeps its reason, which is the whole point of persisting the mode.
    record = updateTeamMember(record, "impl", { workmateMode: "none", workmateReason: "cap" })
    expect(record.members[0]).toMatchObject({ workmateMode: "none", workmateReason: "cap" })
    // A later REUSE drops the stale reason instead of leaving "cap" beside a bound seat.
    record = updateTeamMember(record, "impl", { workmateMode: "reuse", workmate: "impl-1" })
    expect(record.members[0]).toMatchObject({ workmateMode: "reuse", workmate: "impl-1" })
    expect(record.members[0]?.workmateReason).toBeUndefined()
    // A patch that names NEITHER field leaves both alone (additive, never a reset).
    record = updateTeamMember(record, "impl", { status: "running" })
    expect(record.members[0]).toMatchObject({ workmateMode: "reuse", workmate: "impl-1" })
  })
})

describe("approveTeam — deterministic workmate binding (W3-C)", () => {
  test("(a) an explicit workmate that does not exist REFUSES the whole approval", async () => {
    /** This arm's seams. */
    const { observed, deps } = fixture()
    stageWave(observed.workspace, [{ name: "impl", description: "implements", prompt: "You implement.\nworkmate: ghost-worker", role: "Senior Engineer" }])
    /** The refusal the action answers. */
    const result = await approveTeam(deps, callerOf(observed.workspace))
    expect(result.ok).toBe(false)
    expect(String((result as { error?: string }).error)).toContain('explicitly names workmate "ghost-worker", which does not exist')
    // THE WHOLE APPROVAL IS REFUSED, never downgraded: no record, no spawn, and the library untouched.
    expect(existsSync(join(observed.workspace, ".mpd", "team", "teams"))).toBe(false)
    expect(observed.spawns).toEqual([])
    expect(observed.inits).toEqual([])
  })

  test("(a2) an explicit workmate that EXISTS is bound, and the seat takes its name and its context head", async () => {
    /** This arm's seams. */
    const { observed, deps } = fixture({ library: { "oracle-1": { baseName: "Reviewer", note: "reviews hard", readonly: true, persona: "You are a hostile reviewer.", memory: "## learned\nbe exact" } } })
    stageWave(observed.workspace, [{ name: "checker", description: "reviews the diff", prompt: "Review it.\n[workmate: oracle-1]", role: "Reviewer" }])
    /** The approval's payload. */
    const result = await approveTeam(deps, callerOf(observed.workspace))
    expect(result.ok).toBe(true)
    /** The binding row it reported. */
    const binding = (result as { bindings?: Array<{ member: string; mode: string; workmate?: string }> }).bindings?.[0]
    expect(binding).toEqual({ member: "oracle-1", mode: "reuse", workmate: "oracle-1" })
    // THE SEAT RENAMED, and the executor was handed the persona + memory head in front of its prompt.
    expect(observed.spawns).toEqual(["oracle-1"])
    expect(observed.prompts[0]).toContain("You are a hostile reviewer.")
    expect(observed.prompts[0]).toContain("be exact")
    expect(observed.prompts[0]).toContain("Review it.")
    // The record is durable: the member row names the instance it bound.
    expect(storedTeam(observed.workspace).members[0]).toMatchObject({ name: "oracle-1", workmate: "oracle-1" })
    // The task's OWNER followed the rename, so the minted row still has an owner.
    expect(storedTeam(observed.workspace).tasks[0]?.owner).toBe("oracle-1")
  })

  test("(b) a STRONG match reuses and renames the member; a WEAK match initializes a new workmate", async () => {
    /** This arm's seams: one instance scores clear of the threshold, the other does not match at all. */
    const { observed, deps, library } = fixture({ library: { "reviewer-1": { baseName: "Reviewer", note: "judges correctness", readonly: false, persona: "You are the reviewer.", memory: "" } }, scores: { "reviewer-1": 0.9 } })
    stageWave(observed.workspace, [
      { name: "judge", description: "judge the record", prompt: "Judge.", role: "Reviewer" },
      { name: "builder", description: "build the thing", prompt: "Build.", role: "Senior Engineer" }
    ])
    /** The approval's payload. */
    const result = await approveTeam(deps, callerOf(observed.workspace))
    expect(result.ok).toBe(true)
    /** The reported decision table. */
    const bindings = (result as { bindings?: Array<{ member: string; mode: string; workmate?: string }> }).bindings ?? []
    // Member 1 reused the strong match; member 2 initialized `senior-engineer-1` (its role slug, first free ordinal).
    expect(bindings[0]).toEqual({ member: "reviewer-1", mode: "reuse", workmate: "reviewer-1" })
    expect(bindings[1]).toEqual({ member: "senior-engineer-1", mode: "init", workmate: "senior-engineer-1" })
    expect(observed.inits).toEqual([{ base: "Senior Engineer", name: "senior-engineer-1" }])
    // The library now holds both instances, and the record names both bindings.
    expect(library.has("senior-engineer-1")).toBe(true)
    expect(storedTeam(observed.workspace).members.map((member) => member.workmate)).toEqual(["reviewer-1", "senior-engineer-1"])
    // W3-C2: the record also says HOW each seat was bound, so `status` can report the decision.
    expect(storedTeam(observed.workspace).members.map((member) => member.workmateMode)).toEqual(["reuse", "init"])
  })

  test("(c) at workmates.max the seat falls back to mode:none with reason:cap, and the inits equal min(N,cap)", async () => {
    /** This arm's seams: an empty library, a cap of two, and three members that match nothing. */
    const { observed, deps, library } = fixture({ knobs: { "workmates.max": 2 } })
    stageWave(observed.workspace, [
      { name: "one", description: "first", prompt: "One.", role: "Senior Engineer" },
      { name: "two", description: "second", prompt: "Two.", role: "Reviewer" },
      { name: "three", description: "third", prompt: "Three.", role: "Planner" }
    ])
    /** The approval's payload. */
    const result = await approveTeam(deps, callerOf(observed.workspace))
    expect(result.ok).toBe(true)
    /** The reported decision table. */
    const bindings = (result as { bindings?: Array<{ mode: string; reason?: string }> }).bindings ?? []
    // Two initializations fill the cap; the third is a plain seat with the reason recorded.
    expect(bindings.map((binding) => binding.mode)).toEqual(["init", "init", "none"])
    expect(bindings[2]?.reason).toBe("cap")
    expect(observed.inits.length).toBe(2)
    expect(library.size).toBe(2)
    // The capped seat KEEPS its staged name, so the board still addresses it as staged.
    expect(observed.spawns).toEqual(["senior-engineer-1", "reviewer-1", "three"])
    // W3-C2: `none` is a real persisted value, and the reason travels with it.
    expect(storedTeam(observed.workspace).members.map((member) => member.workmateMode)).toEqual(["init", "init", "none"])
    expect(storedTeam(observed.workspace).members[2]?.workmateReason).toBe("cap")
  })

  test("(c2) the auto-init cap is PER WORKSPACE (R-W3C Medium 1): another project's instances are free", async () => {
    /** A library of two instances owned by a DIFFERENT project. */
    const other = fixture({
      knobs: { "workmates.max": 2 },
      library: {
        "other-1": { baseName: "Planner", note: "unrelated budgeting notes", readonly: false, persona: "p", memory: "", workspaces: ["/projects/somewhere-else"] },
        "other-2": { baseName: "Planner", note: "unrelated budgeting notes", readonly: false, persona: "p", memory: "", workspaces: ["/projects/somewhere-else"] }
      }
    })
    stageWave(other.observed.workspace, [{ name: "one", description: "first", prompt: "One.", role: "Senior Engineer" }])
    /** The approval's payload for a workspace that owns NOTHING yet. */
    const free = await approveTeam(other.deps, callerOf(other.observed.workspace))
    expect(free.ok).toBe(true)
    /** The binding rows of the fresh workspace's approval. */
    const freeBindings = (free as { bindings?: Array<{ mode: string; reason?: string }> }).bindings ?? []
    // Another project's two instances do not consume THIS workspace's budget, so auto-init runs.
    expect(freeBindings.map((binding) => binding.mode)).toEqual(["init"])
    expect(other.observed.inits.length).toBe(1)
    // THE NEGATIVE CONTROL: the identical library attributed to THIS workspace fills its budget instead.
    const own = fixture({
      knobs: { "workmates.max": 2 },
      library: {
        "own-1": { baseName: "Planner", note: "unrelated budgeting notes", readonly: false, persona: "p", memory: "" },
        "own-2": { baseName: "Planner", note: "unrelated budgeting notes", readonly: false, persona: "p", memory: "" }
      }
    })
    // Attribution is the ONLY difference between the two libraries, so mutate it after construction.
    for (const row of own.library.values()) row.workspaces = [own.observed.workspace]
    stageWave(own.observed.workspace, [{ name: "one", description: "first", prompt: "One.", role: "Senior Engineer" }])
    /** The approval's payload for the workspace that already owns the cap. */
    const capped = await approveTeam(own.deps, callerOf(own.observed.workspace))
    /** The binding rows of the capped workspace's approval. */
    const cappedBindings = (capped as { bindings?: Array<{ mode: string; reason?: string }> }).bindings ?? []
    expect(cappedBindings[0]?.mode).toBe("none")
    expect(cappedBindings[0]?.reason).toBe("cap")
    expect(own.observed.inits.length).toBe(0)
  })

  test("workmates.mode:none leaves every seat plain and touches no tool", async () => {
    /** This arm's seams: binding is switched off for the whole workspace. */
    const { observed, deps } = fixture({ knobs: { "workmates.mode": "none" }, library: { "reviewer-1": { baseName: "Reviewer", note: "x", readonly: false, persona: "p", memory: "" } }, scores: { "reviewer-1": 1 } })
    stageWave(observed.workspace, [{ name: "judge", description: "judge", prompt: "Judge.", role: "Reviewer" }])
    /** The approval's payload. */
    const result = await approveTeam(deps, callerOf(observed.workspace))
    expect(result.ok).toBe(true)
    expect((result as { bindings?: unknown }).bindings).toEqual([{ member: "judge", mode: "none", reason: "config" }])
    expect(observed.calls).toEqual([])
    expect(observed.spawns).toEqual(["judge"])
  })

  test("a composition with NO tool seam leaves every seat plain, with one log line and no throw", async () => {
    /** This arm's seams: the adapter service answers nothing at all. */
    const { observed, deps } = fixture()
    /** The seam-less deps: everything else is the fixture's, the adapter is gone. */
    const seamless: TeamActionDeps = { ...deps, service: (id: string): unknown => (id === "mpdDsh" ? undefined : deps.service(id)) }
    stageWave(observed.workspace, [{ name: "impl", description: "implements", prompt: "You implement.", role: "Senior Engineer" }])
    /** The approval's payload. */
    const result = await approveTeam(seamless, callerOf(observed.workspace))
    expect(result.ok).toBe(true)
    expect((result as { bindings?: unknown }).bindings).toEqual([{ member: "impl", mode: "none", reason: "no-seam" }])
    // TWO degrade lines, one per independent seam: the workmate binding (this wave) and the worktree
    // lookup (Lane C of `.mpd/plans/agent-worktrees.md`), whose absent service is reported ONCE for
    // the whole approval. Neither is a throw and neither changes the spawn.
    expect(observed.logs.filter((line) => line.includes("workmate binding")).length).toBe(1)
    expect(observed.logs.filter((line) => line.includes("mpdWorktree")).length).toBe(1)
    expect(observed.spawns).toEqual(["impl"])
  })
})
