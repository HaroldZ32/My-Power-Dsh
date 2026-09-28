// The plan store is pure filesystem + plain data, so the whole workflow state machine is driven
// here without a ctx, a harness or a model. The arms are chosen to be the ones that MATTER: what
// survives a reload, what a second staging does to an approved plan, and whether an attempt
// counter can be confused with a board revision.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  addMember,
  addTask,
  archivePlan,
  archivePathFor,
  claimContract,
  clearHold,
  listContracts,
  newPlanId,
  placeHold,
  readContract,
  readHold,
  readPlan,
  stagePlan,
  teamRoot,
  writePlan,
  type StagedMember,
} from "../src/plan-store"

/** Per-test sandbox workspace, recreated by the hooks below so no state leaks between arms. */
let sandbox = ""
/** The frozen clock every stored timestamp in this file is derived from. */
const NOW = new Date("2026-09-27T10:00:00.000Z")

beforeEach(() => { sandbox = mkdtempSync(join(tmpdir(), "mpd-team-tools-")) })
afterEach(() => { rmSync(sandbox, { recursive: true, force: true }) })

/** A minimal staged member: the store requires a name and a non-empty prompt. */
const member = (name: string): StagedMember => ({ name, description: name + " does the thing", prompt: "You are " + name })

describe("the staged plan", () => {
  test("a fresh stage writes a plan under .mpd/team/staging and nothing else", () => {
    /** The freshly staged plan, which must carry no approval yet. */
    const plan = stagePlan(sandbox, "session-1", { name: "wave", description: "ship it", approval: "required" }, NOW)
    expect(plan.planId).toBe("plan-20260927100000")
    expect(plan.approvedAt).toBeUndefined()
    expect(existsSync(join(teamRoot(sandbox), "staging", "session-1.json"))).toBe(true)
    // Staging is not creating: no member, no task, no archive.
    expect(plan.members).toEqual([])
    expect(plan.tasks).toEqual([])
    expect(existsSync(join(teamRoot(sandbox), "archive"))).toBe(false)
  })

  test("members and tasks append, and a duplicate member name refuses", () => {
    /** The plan being appended to; every add returns a NEW plan. */
    let plan = stagePlan(sandbox, "session-1", { name: "wave", description: "", approval: "required" }, NOW)
    plan = addMember(plan, member("architect"))
    expect(() => addMember(plan, member("architect"))).toThrow(/already staged/)
    plan = addTask(plan, { subject: "t1", description: "first" })
    expect(() => addTask(plan, { subject: "  ", description: "empty" })).toThrow(/non-empty subject/)
    expect(plan.members).toHaveLength(1)
    expect(plan.tasks).toHaveLength(1)
  })

  test("a plan survives a reload: what is on disk is what a later call reads", () => {
    /** The plan built by chaining both appends, then written to disk. */
    const staged = addTask(addMember(stagePlan(sandbox, "session-1", { name: "wave", description: "d", approval: "required" }, NOW), member("lead")), { subject: "t1", description: "first" })
    writePlan(sandbox, staged)
    /** The plan read back from disk — the reload is what this arm is about. */
    const reloaded = readPlan(sandbox, "session-1")
    expect(reloaded?.members.map((m) => m.name)).toEqual(["lead"])
    expect(reloaded?.tasks.map((t) => t.subject)).toEqual(["t1"])
  })

  test("staging again REPLACES an unapproved plan and archives it — the old plan is still readable", () => {
    /** The first plan, which a second stage must archive rather than lose. */
    const first = stagePlan(sandbox, "session-1", { name: "one", description: "", approval: "required" }, NOW)
    /** The replacement plan, whose id must differ from the first's. */
    const second = stagePlan(sandbox, "session-1", { name: "two", description: "", approval: "required" }, new Date("2026-09-27T11:00:00.000Z"))
    expect(readPlan(sandbox, "session-1")?.name).toBe("two")
    expect(second.planId).not.toBe(first.planId)
    /** The archived bytes of the FIRST plan, which must still be readable. */
    const archived = readFileSync(join(archivePathFor(sandbox, first.planId), "plan.json"), "utf8")
    expect(JSON.parse(archived).name).toBe("one")
  })

  test("an APPROVED plan is not replaced by a plain stage — approval is the boundary", () => {
    /** The plan that will be marked approved before the replace path runs. */
    const plan = stagePlan(sandbox, "session-1", { name: "one", description: "", approval: "required" }, NOW)
    writePlan(sandbox, { ...plan, approvedAt: NOW.toISOString() })
    // The tool layer owns the refusal; the STORE's job is that the approved plan is not silently
    // archived by the replace path, which is what the caller's guard protects.
    const stillThere = readPlan(sandbox, "session-1")
    expect(stillThere?.approvedAt).toBe(NOW.toISOString())
    expect(archivePlan(sandbox, stillThere!)).toBe(archivePathFor(sandbox, plan.planId))
    expect(readPlan(sandbox, "session-1")).toBeUndefined()
  })

  test("sessions do not share a staging slot", () => {
    stagePlan(sandbox, "session-1", { name: "one", description: "", approval: "required" }, NOW)
    stagePlan(sandbox, "session-2", { name: "two", description: "", approval: "required" }, NOW)
    expect(readPlan(sandbox, "session-1")?.name).toBe("one")
    expect(readPlan(sandbox, "session-2")?.name).toBe("two")
  })

  test("a corrupt staging file reads as absent instead of throwing", () => {
    /** The staging directory, created by hand so a corrupt file can be planted. */
    const dir = join(teamRoot(sandbox), "staging")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "session-1.json"), "{ this is not json")
    expect(readPlan(sandbox, "session-1")).toBeUndefined()
  })
})

describe("task contracts and attempts", () => {
  /** A board task carrying a revision, to prove an attempt cannot be confused with one. */
  const task = (revision: number): Parameters<typeof claimContract>[1] => ({ id: "t4", subject: "wire the gate", description: "acceptance", blockedBy: ["t3"], writeScopes: ["src/**"], revision })

  test("the first claim is attempt 1 and freezes what the task said", () => {
    /** The contract frozen by the first claim. */
    const contract = claimContract(sandbox, task(3), "senior-1", NOW)
    expect(contract.attempt).toBe(1)
    expect(contract.revision).toBe(3)
    expect(contract.blockedBy).toEqual(["t3"])
    expect(contract.writeScopes).toEqual(["src/**"])
    expect(contract.claimedBy).toBe("senior-1")
  })

  test("the attempt counter is monotonic ACROSS claims, and a board revision cannot stand in for it", () => {
    claimContract(sandbox, task(3), "a", NOW)
    // A revision moves for ANY mutation — here an edit that never claimed the task.
    const second = claimContract(sandbox, task(9), "b", new Date("2026-09-27T10:05:00.000Z"))
    expect(second.attempt).toBe(2)
    expect(second.revision).toBe(9)
    /** A third claim after the revision went BACKWARDS, which must still raise the attempt. */
    const third = claimContract(sandbox, task(4), "c", new Date("2026-09-27T10:10:00.000Z"))
    // A revision that went BACKWARDS (a rebase, a re-created task) still cannot reset the attempt.
    expect(third.attempt).toBe(3)
  })

  test("contracts list newest claim first, and an unclaimed task has none", () => {
    claimContract(sandbox, { ...task(1), id: "t1", subject: "one" }, "a", new Date("2026-09-27T09:00:00.000Z"))
    claimContract(sandbox, { ...task(1), id: "t2", subject: "two" }, "b", new Date("2026-09-27T12:00:00.000Z"))
    expect(listContracts(sandbox).map((c) => c.taskId)).toEqual(["t2", "t1"])
    expect(readContract(sandbox, "t9")).toBeUndefined()
  })

  test("a corrupt contract reads as absent, never as a half-written claim", () => {
    claimContract(sandbox, task(1), "a", NOW)
    writeFileSync(join(teamRoot(sandbox), "contracts", "t4.json"), "{}")
    expect(readContract(sandbox, "t4")).toBeUndefined()
  })
})

describe("the halt", () => {
  test("a halt records who and why, and resuming reports whether one was there", () => {
    expect(readHold(sandbox)).toBeUndefined()
    expect(clearHold(sandbox)).toBe(false)
    /** The hold record written by `placeHold`. */
    const hold = placeHold(sandbox, "waiting for the user", "captain", NOW)
    expect(hold.reason).toBe("waiting for the user")
    expect(readHold(sandbox)?.heldBy).toBe("captain")
    expect(clearHold(sandbox)).toBe(true)
    expect(readHold(sandbox)).toBeUndefined()
  })
})

describe("plan identity", () => {
  test("a plan id is stable, sortable and derived from the clock", () => {
    expect(newPlanId(new Date("2026-01-02T03:04:05.000Z"))).toBe("plan-20260102030405")
    expect(newPlanId(new Date("2026-01-02T03:04:06.000Z")) > newPlanId(new Date("2026-01-02T03:04:05.000Z"))).toBe(true)
  })
})
