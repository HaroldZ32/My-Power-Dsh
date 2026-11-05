// D3 — THE FORCE ACTION (`forceWedgedTask`): handoff, interrupt, requeue and split.
//
// WHAT THESE ARMS PIN, one per clause of §D3.4:
//   a. the handoff document is written to `<ws>/.mpd/handoff/<member>-<task>-<UTC instant>.md` and
//      carries task, attempt, member, started, elapsed, last tool calls and the review state;
//   b. `executor().interrupt(caller.agent, handle)` is called for THAT member's handle only;
//   c. the row is requeued `pending`, owner cleared, attempt bumped, note naming the handoff;
//   d. the work is SPLIT: one row per declared write scope (>= 2 scopes) or ONE `[split]` continuation;
//   e. the captain gets ONE mailbox row;
//   f. the journal gets ONE `wedged-force` row.
// Plus the guards the incidents demanded: only the team's LEAD may force, the CAPTAIN is never a force
// target, a HANDOFF WRITE failure aborts this attempt as retryable (nothing is interrupted), and a
// reassignment or a sibling write that lands MID-FORCE is refused or PRESERVED — never overwritten.
//
// Every arm reads the STORE FILES, not the reply: a reply can claim a requeue while the record on disk
// still says `in_progress`.
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { DshTeamExecutor } from "../../mpd-dsh-adapter-plugin/src/index.ts"
import { forceWedgedTask, type TeamActionCaller, type TeamActionDeps } from "../src/team-actions"
import { readTeamJournal } from "../src/team-journal"
import { fold, readRecords } from "../src/mailbox-store"
import { addTeamMember, addTeamTask, createTeam, readTeam, updateTeamMember, updateTeamTask, writeTeam, type TeamRecord } from "../src/team-store"

/** The instant every store write in this file is stamped with. */
const NOW = new Date("2026-11-05T12:00:00.000Z")
/** The captain's session: the AUTHORISER, and the member a force must never target. */
const LEAD = "lead-session-force"
/** The member's executor handle: what a real claim writes as the owner. */
const MEMBER = "sess-member-force"
/** The member's board name. */
const MEMBER_NAME = "Senior Engineer"
/** The live agent a tool call would carry; its contents are opaque to the action. */
const AGENT = { session: { id: LEAD, header: {} } }

/** The sandboxes this file created, removed after every arm. */
const sandboxes: string[] = []
afterEach(() => { for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true }) })

/** What one arm observed about the seams the action calls. */
interface Observed {
  /** The sandbox workspace this fixture's stores write into. */
  workspace: string
  /** One entry per interrupt: `<handle>` plus the exact caller object. */
  interrupts: Array<{ handle: string; caller: unknown }>
  /** Set to make the executor's interrupt throw (the refusal arm). */
  interruptError: string | null
  /** Runs INSIDE the interrupt seam, so an arm can land a concurrent write while the force awaits. */
  onInterrupt?: () => void
}

/** One mounted fixture: the deps bundle, the caller and what the seams recorded. */
interface Fixture {
  /** The sandbox workspace. */
  workspace: string
  /** The deps bundle the action receives. */
  deps: TeamActionDeps
  /** The authorising caller (the team's lead, with a live agent). */
  caller: TeamActionCaller
  /** What the seams recorded. */
  observed: Observed
}

/** Build the deps bundle: real stores, a recording executor, no cordis context. */
function fixture(): Fixture {
  /** The sandbox workspace this arm's stores write into. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-force-"))
  sandboxes.push(workspace)
  /** What the seams observed. */
  const observed: Observed = { workspace, interrupts: [], interruptError: null }
  /** The executor double: records the interrupt and can refuse it. */
  const executor: DshTeamExecutor = {
    kind: "native",
    reason: "the arm's own executor",
    providers: (): string[] => ["interrupt"],
    spawn: async (): Promise<{ handle: string; executor: "native" }> => ({ handle: "child", executor: "native" }),
    send: async (): Promise<void> => {},
    interrupt: async (caller: unknown, handle: string): Promise<void> => {
      observed.interrupts.push({ handle, caller })
      // A sibling writer landing MID-AWAIT, which the arms that check the post-await read script here.
      observed.onInterrupt?.()
      if (observed.interruptError !== null) throw new Error(observed.interruptError)
    },
    membership: (): undefined => undefined,
    members: (): [] => [],
  }
  return {
    workspace,
    observed,
    caller: { workspace, sessionId: LEAD, lineage: [], agent: AGENT },
    deps: {
      now: () => NOW,
      executor: () => executor,
      bundleApprovalEffects: async (): Promise<void> => {},
      deriveParentTeam: (): undefined => undefined,
      resolveTeam: (): { refusal: string } => ({ refusal: "no team record in this workspace — approve a plan first" }),
      readWatchdogHold: () => ({ state: "free" }),
      service: (): undefined => undefined,
      log: (): void => {},
      beginDispatch: (): (() => void) => (): void => {},
      assertPlanGraph: (): void => {},
      assertScopesOrdered: (): void => {},
    },
  }
}

/** Build and persist one team with ONE `in_progress` row owned by `owner`. */
function teamWith(workspace: string, options: { scopes?: string[]; owner?: string; subject?: string } = {}): TeamRecord {
  /** The freshly minted record (it also binds the lead session to this team). */
  let record = createTeam(workspace, { name: "wave-force", description: "the force supervisor", leadSessionId: LEAD }, NOW)
  record = addTeamMember(record, { name: MEMBER_NAME, description: "implements" }, NOW)
  record = updateTeamMember(record, MEMBER_NAME, { executorRef: MEMBER, status: "running" })
  record = addTeamTask(record, { subject: options.subject ?? "the wedged row", description: "own the record", writeScopes: options.scopes ?? ["packages/a/**", "packages/b/**"] }, NOW)
  // `attempt: 1` is what a real claim records (`agent_teams_task claim`), so the force bumps 1 -> 2.
  record = updateTeamTask(record, "T1", { status: "in_progress", owner: options.owner ?? MEMBER, attempt: 1 }, NOW)
  writeTeam(workspace, record)
  return record
}

/** The handoff documents a workspace holds, in directory order. */
function handoffs(workspace: string): string[] {
  // The force-handoff directory the contract names.
  const dir = join(workspace, ".mpd", "handoff")
  return existsSync(dir) ? readdirSync(dir).sort() : []
}

describe("D3.4 — the force action", () => {
  test("a wedged member at the bound is interrupted, handed off, requeued and SPLIT by write scope", async () => {
    // The fixture: stores + recording executor.
    const box = fixture()
    // The team, with TWO declared write scopes (so the split is per scope).
    const created = teamWith(box.workspace)
    // The force, as the watchdog would issue it (attempt 1, elapsed just past the bound). The
    // watchdog's `attemptId` IS the row's `revision`, which the claim above bumped to 2.
    /** The row's own generation token, exactly as the watchdog projects it. */
    const generation = String(created.tasks.find((task) => task.id === "T1")?.revision ?? "")
    /** What the force answered. */
    const outcome = await forceWedgedTask(box.deps, box.caller, {
      teamId: created.teamId,
      taskId: "T1",
      evidence: { attemptId: generation, elapsedMs: 901_000, lastToolCalls: ["bash", "edit"] },
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error(outcome.error)

    // (b) THE INTERRUPT: the member's handle only, authorised by the caller's agent.
    expect(box.observed.interrupts).toEqual([{ handle: MEMBER, caller: AGENT }])
    expect(outcome.interrupted).toBe(true)

    // (a) THE HANDOFF: the contract's path and its seven facts.
    const files = handoffs(box.workspace)
    expect(files.length).toBe(1)
    expect(files[0]).toStartWith(`${MEMBER_NAME.replace(/\s+/g, "-")}-T1-`)
    expect(files[0].endsWith(".md")).toBe(true)
    // The document states every field the contract lists.
    const text = readFileSync(join(box.workspace, ".mpd", "handoff", files[0]), "utf8")
    expect(text).toContain("## Task")
    expect(text).toContain("- Task: T1 — the wedged row")
    expect(text).toContain("## Member")
    expect(text).toContain(`- Member: ${MEMBER_NAME}`)
    expect(text).toContain("## Timing")
    expect(text).toContain("- Elapsed: 901000 ms")
    expect(text).toContain("## Last tool calls")
    expect(text).toContain("`bash`")
    expect(text).toContain("## Review state")

    // (c) THE REQUEUE, read from DISK.
    /** The record as the force left it on disk. */
    const after = readTeam(box.workspace, created.teamId)
    if (after === undefined) throw new Error("the team record vanished")
    /** The requeued row, read back from disk. */
    const row = after.tasks.find((task) => task.id === "T1")
    if (row === undefined) throw new Error("the requeued row vanished")
    expect(row.status).toBe("pending")
    expect(row.owner).toBeUndefined()
    expect(row.attempt).toBe(2)
    expect(row.note).toContain(outcome.handoff)
    // The started clock is DELETED: the next claim is a new attempt whose clock starts then.
    expect(row.startedAt).toBeUndefined()

    // (d) THE SPLIT: one row per declared scope, unowned, pending, each naming the handoff.
    /** The rows the force created, in creation order. */
    const split = after.tasks.filter((task) => task.id !== "T1")
    expect(split.length).toBe(2)
    expect(split.map((task) => task.subject)).toEqual(["[split] the wedged row — packages/a/**", "[split] the wedged row — packages/b/**"])
    for (const task of split) {
      expect(task.status).toBe("pending")
      expect(task.owner).toBeUndefined()
      expect(task.writeScopes.length).toBe(1)
      expect(task.description).toContain(outcome.handoff)
    }
    expect(outcome.split).toEqual(split.map((task) => task.id))

    // (f) THE JOURNAL: ONE `wedged-force` row naming the row, the member and the handoff.
    const journal = readTeamJournal(box.workspace).filter((entry) => entry.event === "wedged-force")
    expect(journal.length).toBe(1)
    expect(journal[0]).toMatchObject({ teamId: created.teamId, taskId: "T1", member: MEMBER_NAME, path: outcome.handoff })

    // (e) THE MAILBOX: ONE row, addressed to the captain, naming the team, the task and the handoff.
    const mailbox = fold(readRecords(box.workspace))
    expect(mailbox.messages.length).toBe(1)
    expect(mailbox.messages[0]).toMatchObject({ toId: LEAD, fromId: "mpd-force-supervisor" })
    expect(mailbox.messages[0].body).toContain(outcome.handoff)
    expect(mailbox.messages[0].body).toContain(created.teamId)
  })

  test("with NO declared write scope the split is ONE continuation row that must narrow first", async () => {
    // The fixture.
    const box = fixture()
    // The team, whose single row declares no scope at all.
    const created = teamWith(box.workspace, { scopes: [] })
    // The force.
    const outcome = await forceWedgedTask(box.deps, box.caller, { teamId: created.teamId, taskId: "T1" })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error(outcome.error)
    // ONE continuation row, with the `[split]` prefix and the "narrow the scope" instruction.
    const after = readTeam(box.workspace, created.teamId)
    if (after === undefined) throw new Error("the team record vanished")
    /** The rows the force created, in creation order. */
    const split = after.tasks.filter((task) => task.id !== "T1")
    expect(split.length).toBe(1)
    expect(split[0].subject).toBe("[split] the wedged row")
    expect(split[0].description).toContain("NARROW THE SCOPE FIRST")
    expect(split[0].owner).toBeUndefined()
    expect(outcome.split).toEqual([split[0].id])
  })

  test("an owner stored as a SESSION ID resolves to its member (the VEdit spelling)", async () => {
    // The fixture.
    const box = fixture()
    // The team, whose row is owned by the member's SESSION, exactly as a claim writes it.
    const created = teamWith(box.workspace, { owner: MEMBER })
    // The force.
    const outcome = await forceWedgedTask(box.deps, box.caller, { teamId: created.teamId, taskId: "T1" })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error(outcome.error)
    expect(outcome.member).toBe(MEMBER_NAME)
    expect(box.observed.interrupts.map((entry) => entry.handle)).toEqual([MEMBER])
  })

  test("the CAPTAIN is never a force target: a lead-owned row is refused and nothing is written", async () => {
    // The fixture.
    const box = fixture()
    // A row owned by the LEAD's own session.
    const created = teamWith(box.workspace, { owner: LEAD })
    // The force: refused, with the sentence that says why.
    const outcome = await forceWedgedTask(box.deps, box.caller, { teamId: created.teamId, taskId: "T1" })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("a captain-owned row must never be forced")
    expect(outcome.error).toContain("captain is never a force target")
    // NOTHING was interrupted, no handoff written, the row untouched, no journal row.
    expect(box.observed.interrupts).toEqual([])
    expect(handoffs(box.workspace)).toEqual([])
    /** The record as the refusal left it: the row is still the member's. */
    const after = readTeam(box.workspace, created.teamId)
    expect(after?.tasks.find((task) => task.id === "T1")?.status).toBe("in_progress")
    expect(readTeamJournal(box.workspace).filter((entry) => entry.event === "wedged-force")).toEqual([])
  })

  test("an INTERRUPT refusal is recorded, and the row is STILL requeued and split", async () => {
    // The fixture, with an executor that refuses the interrupt.
    const box = fixture()
    box.observed.interruptError = "the handle is unknown to the harness"
    // The team under test.
    const created = teamWith(box.workspace)
    // The force.
    const outcome = await forceWedgedTask(box.deps, box.caller, { teamId: created.teamId, taskId: "T1" })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error(outcome.error)
    // The refusal is REPORTED, never hidden.
    expect(outcome.interrupted).toBe(false)
    expect(outcome.interruptError).toContain("unknown to the harness")
    // ... and the board still moves, because a stale handle must not leave a wedged row forever.
    const after = readTeam(box.workspace, created.teamId)
    expect(after?.tasks.find((task) => task.id === "T1")?.status).toBe("pending")
    expect(after?.tasks.filter((task) => task.id !== "T1").length).toBe(2)
    expect(readTeamJournal(box.workspace).filter((entry) => entry.event === "wedged-force").length).toBe(1)
  })

  test("a HANDOFF WRITE failure aborts the attempt as RETRYABLE and interrupts nobody", async () => {
    // The fixture.
    const box = fixture()
    // The team under test.
    const created = teamWith(box.workspace)
    // `mkdirSync` cannot replace a FILE, so this is a real, deterministic write failure.
    writeFileSync(join(box.workspace, ".mpd", "handoff"), "not a directory")
    // The force.
    const outcome = await forceWedgedTask(box.deps, box.caller, { teamId: created.teamId, taskId: "T1" })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("a failed handoff must abort the force")
    expect(outcome.retryable).toBe(true)
    expect(outcome.error).toContain("handoff write failed")
    // Nothing was interrupted, and the row is untouched: the next tick may decide it again.
    expect(box.observed.interrupts).toEqual([])
    expect(readTeam(box.workspace, created.teamId)?.tasks.find((task) => task.id === "T1")?.status).toBe("in_progress")
    expect(readTeamJournal(box.workspace).filter((entry) => entry.event === "wedged-force")).toEqual([])
  })

  test("CELLWORK INHERITANCE: a cell seat is a force target through the SAME path, and its record is untouched", async () => {
    // The fixture.
    const box = fixture()
    // A member bound to a CELLWORK seat: the executor handle is the seat's own session id (§D0.4).
    const created = teamWith(box.workspace, { owner: "cell-seat-7" })
    /** The record with that seat bound as the member's executor handle. */
    let bound = updateTeamMember(created, MEMBER_NAME, { executorRef: "cell-seat-7" })
    // The row is owned by the seat's session, the spelling a cell-backed claim writes.
    bound = updateTeamTask(bound, "T1", { status: "in_progress", owner: "cell-seat-7", attempt: 1 }, NOW)
    writeTeam(box.workspace, bound)
    // The force, exactly as the watchdog issues it for any member.
    const outcome = await forceWedgedTask(box.deps, box.caller, { teamId: bound.teamId, taskId: "T1" })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error(outcome.error)
    // The CELL seat itself was interrupted — no new hook, no second stop implementation.
    expect(box.observed.interrupts.map((entry) => entry.handle)).toEqual(["cell-seat-7"])
    // ... and the plane-neutral board work happened: requeue + split + journal.
    const after = readTeam(box.workspace, bound.teamId)
    expect(after?.tasks.find((task) => task.id === "T1")?.status).toBe("pending")
    expect(after?.tasks.filter((task) => task.id !== "T1").length).toBe(2)
    expect(readTeamJournal(box.workspace).filter((entry) => entry.event === "wedged-force").length).toBe(1)
    // TEAM-CORE NEVER WRITES THE CELL RECORD: the repair of the seat is cellwork's own verbs' job.
    expect(existsSync(join(box.workspace, ".mpd", "cellwork"))).toBe(false)
  })

  test("a row that is NOT in_progress is refused before anything is written", async () => {
    // The fixture.
    const box = fixture()
    // The team, whose row is put back on the board as pending.
    const created = teamWith(box.workspace)
    /** The record with its row reopened. */
    const reopened = updateTeamTask(created, "T1", { status: "pending", owner: "" }, NOW)
    writeTeam(box.workspace, reopened)
    // The force.
    const outcome = await forceWedgedTask(box.deps, box.caller, { teamId: created.teamId, taskId: "T1" })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("a pending row must not be forced")
    expect(outcome.error).toContain('is "pending"')
    expect(handoffs(box.workspace)).toEqual([])
  })

  test("a NON-LEAD live session is refused before any write or interrupt", async () => {
    // The fixture: the deps and the team, whose lead is `LEAD`.
    const box = fixture()
    // The team under test.
    const created = teamWith(box.workspace)
    // A LIVE session that is NOT this team's lead — the member's own executor handle.
    const intruder: TeamActionCaller = { ...box.caller, sessionId: MEMBER }
    // The force, issued by the foreign session.
    const outcome = await forceWedgedTask(box.deps, intruder, { teamId: created.teamId, taskId: "T1" })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("a non-lead caller must not force a member")
    expect(outcome.error).toContain("is not the lead")
    // NOTHING was interrupted, no handoff was written, and the board is untouched.
    expect(box.observed.interrupts).toEqual([])
    expect(handoffs(box.workspace)).toEqual([])
    /** The record as the refusal left it: the row is still the member's, still in progress. */
    const after = readTeam(box.workspace, created.teamId)
    expect(after?.tasks.find((task) => task.id === "T1")?.status).toBe("in_progress")
    expect(readTeamJournal(box.workspace).filter((entry) => entry.event === "wedged-force")).toEqual([])
  })

  test("a row REASSIGNED between the decision and the interrupt is not forced", async () => {
    // The fixture.
    const box = fixture()
    // The team under test.
    const created = teamWith(box.workspace)
    // The clock seam runs ONCE, before the read-again guard: this is exactly the window a sibling
    // writer can land a reassignment in, with no other suspense in between.
    let landed = false
    box.deps.now = () => {
      if (!landed) {
        landed = true
        /** The board as the reassigning writer read it. */
        const fresh = readTeam(box.workspace, created.teamId)
        if (fresh !== undefined) writeTeam(box.workspace, updateTeamTask(fresh, "T1", { owner: "another-member" }, NOW))
      }
      return NOW
    }
    // The force.
    const outcome = await forceWedgedTask(box.deps, box.caller, { teamId: created.teamId, taskId: "T1" })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("a reassigned row must not be forced")
    expect(outcome.error).toContain("no longer owned by")
    // Nobody was interrupted, no handoff was written, and the reassignment STANDS.
    expect(box.observed.interrupts).toEqual([])
    expect(handoffs(box.workspace)).toEqual([])
    /** The record as the refusal left it. */
    const after = readTeam(box.workspace, created.teamId)
    expect(after?.tasks.find((task) => task.id === "T1")?.owner).toBe("another-member")
  })

  test("a concurrent write that lands DURING the interrupt SURVIVES the force", async () => {
    // The fixture.
    const box = fixture()
    // The team under test (TWO declared scopes, so the split is per scope).
    const created = teamWith(box.workspace)
    // The sibling writer: while the force awaits the interrupt, another actor adds a row.
    box.observed.onInterrupt = () => {
      /** The board as the sibling writer read it. */
      const fresh = readTeam(box.workspace, created.teamId)
      if (fresh === undefined) throw new Error("the sibling writer must find the team")
      writeTeam(box.workspace, addTeamTask(fresh, { subject: "a concurrent row", description: "landed mid-force", writeScopes: [] }, NOW))
    }
    // The force.
    const outcome = await forceWedgedTask(box.deps, box.caller, { teamId: created.teamId, taskId: "T1" })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error(outcome.error)
    /** The record as the force left it. */
    const after = readTeam(box.workspace, created.teamId)
    if (after === undefined) throw new Error("the team record vanished")
    // THE PIN: the requeue is built on the record read AFTER the await, so the sibling's row is still
    // there — a snapshot taken before the interrupt would have silently dropped it.
    expect(after.tasks.some((task) => task.subject === "a concurrent row")).toBe(true)
    // ... and the force still did its own work: the requeue and the two split rows.
    /** The requeued row, read back from disk. */
    const row = after.tasks.find((task) => task.id === "T1")
    expect(row?.status).toBe("pending")
    expect(row?.attempt).toBe(2)
    expect(after.tasks.filter((task) => task.subject.startsWith("[split]")).length).toBe(2)
  })
})
