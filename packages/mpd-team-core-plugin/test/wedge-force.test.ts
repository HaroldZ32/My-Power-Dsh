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
import { forceWedgedTask, graceWedgedTask, type TeamActionCaller, type TeamActionDeps } from "../src/team-actions"
import { writeHandoffDocument } from "../src/team-handoff"
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
  /** One entry per executor `send`: the handle it targeted and the directive text it carried. */
  sends: Array<{ handle: string; text: string }>
  /** Set to make the executor's interrupt throw (the refusal arm). */
  interruptError: string | null
  /** Set to make the executor's `send` throw (the undeliverable-directive arm). */
  sendError: string | null
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
  const observed: Observed = { workspace, interrupts: [], sends: [], interruptError: null, sendError: null }
  /** The executor double: records the interrupt and can refuse it. */
  const executor: DshTeamExecutor = {
    kind: "native",
    reason: "the arm's own executor",
    providers: (): string[] => ["interrupt"],
    spawn: async (): Promise<{ handle: string; executor: "native" }> => ({ handle: "child", executor: "native" }),
    send: async (_caller: unknown, handle: string, content: string): Promise<void> => {
      observed.sends.push({ handle, text: content })
      if (observed.sendError !== null) throw new Error(observed.sendError)
    },
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
      // S7 (updated 2026-11-06): the row INHERITS the interrupted member as its owner, which is what
      // makes it dispatchable by an owner-only pass. It used to be UNOWNED, and every such row was
      // refused by the default dispatch pairing.
      expect(task.owner).toBe(MEMBER_NAME)
      expect(task.sourceTaskId).toBe("T1")
      expect(task.blockedBy).toEqual([])
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
    // S7 (updated 2026-11-06): the continuation row inherits the owner, has no blockers and names the
    // row it continues — the OLD pin was "unowned", which is the D4 defect this wave fixes.
    expect(split[0].owner).toBe(MEMBER_NAME)
    expect(split[0].blockedBy).toEqual([])
    expect(split[0].sourceTaskId).toBe("T1")
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

// S4–S7 (contract `watchdog-force-silence.md`, 2026-11-06): the grace phase's artifact, the terminal
// race, the inherited owner and the handoff that carries the work.
describe("S4–S7 — grace artifact, terminal race, dispatchable splits, a handoff that carries the work", () => {
  test("S4/AC4: a MEMBER handoff written during grace is used VERBATIM and no template is written", async () => {
    // The fixture.
    const box = fixture()
    // The team, with the member seat in the handoff window, exactly as `agent_teams_task handoff` leaves it.
    let record = teamWith(box.workspace)
    // The member's own seven-section document, written through the plane's own writer (which creates
    // the handoff directory and advances the ordinal).
    const memberPath = writeHandoffDocument(box.workspace, record.teamId, MEMBER_NAME, 1, "# Task\nT1\n\n# State\nhalf done\n")
    // The seat records the document and enters the checkpoint window.
    record = updateTeamMember(record, MEMBER_NAME, { handoff: { path: memberPath, ordinal: 1 }, mode: "checkpoint" })
    writeTeam(box.workspace, record)
    // The force.
    const outcome = await forceWedgedTask(box.deps, box.caller, { teamId: record.teamId, taskId: "T1" })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error(outcome.error)
    // THE ARTIFACT IS THE MEMBER'S, and the supervisor wrote no template beside it.
    expect(outcome.handoffSource).toBe("member")
    expect(outcome.handoff).toBe(memberPath)
    expect(handoffs(box.workspace)).toEqual([])
    // CLOSED CLEANLY: a member that complied is not interrupted.
    expect(box.observed.interrupts).toEqual([])
  })

  test("S5/AC7: the fallback handoff carries description, scopes, an ARGUMENT excerpt, the idle clock and real ids", async () => {
    // The fixture.
    const box = fixture()
    // The team under test.
    const created = teamWith(box.workspace)
    // The force, with the evidence the watchdog's fold and clock supply.
    const outcome = await forceWedgedTask(box.deps, box.caller, {
      teamId: created.teamId,
      taskId: "T1",
      evidence: { silentMs: 901_000, toolCalls: [{ tool: "bash", excerpt: "bun run typecheck" }], assistantMessage: "The typecheck is green.", lastToolCalls: ["bash"] },
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error(outcome.error)
    // The document, read back from disk.
    const text = readFileSync(outcome.handoff, "utf8")
    // THE WORK: the acceptance text, the declared scopes, the call WITH its argument excerpt, the
    // measured idle duration, and a next step naming the ACTUAL rows.
    expect(text).toContain("- Description: own the record")
    expect(text).toContain("`packages/a/**`")
    expect(text).toContain("bun run typecheck")
    expect(text).toContain("IDLE AT THE FORCE BOUND: 901000 ms")
    expect(text).toContain("The typecheck is green.")
    expect(text).toContain("`T1`")
    // The continuation rows are appended with their REAL ids after the split.
    expect(text).toContain("## Continuation rows")
    expect(text).toContain(outcome.split[0])
    // THE DEFECT STRING IS GONE.
    expect(text).not.toContain("system message")
  })

  test("S6/AC5: a `complete` landing DURING the interrupt survives: no requeue, no split, one force-skipped journal row", async () => {
    // The fixture.
    const box = fixture()
    // The team under test.
    const created = teamWith(box.workspace)
    // A sibling writer completes the row WHILE the interrupt is in flight.
    box.observed.onInterrupt = () => {
      /** The record as the concurrent completion left it. */
      const live = readTeam(box.workspace, created.teamId)
      if (live === undefined) throw new Error("the team vanished")
      writeTeam(box.workspace, updateTeamTask(live, "T1", { status: "completed", note: "finished during the interrupt" }, NOW))
    }
    // The force.
    const outcome = await forceWedgedTask(box.deps, box.caller, { teamId: created.teamId, taskId: "T1" })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error(outcome.error)
    // THE TERMINAL STATE WON: the payload says so and carries the observed status/revision.
    expect(outcome.skipped).toMatchObject({ status: "completed" })
    expect(outcome.requeued).toBeUndefined()
    expect(outcome.split).toEqual([])
    // The row on disk is STILL completed — never dragged back to pending.
    /** The record as the force left it. */
    const after = readTeam(box.workspace, created.teamId)
    expect(after?.tasks.find((task) => task.id === "T1")?.status).toBe("completed")
    expect(after?.tasks.filter((task) => task.id !== "T1")).toEqual([])
    // ONE journal row, and its reason states the skip with the status and revision.
    const skipped = readTeamJournal(box.workspace).filter((entry) => entry.event === "wedged-force" && String(entry.reason).includes("force-skipped"))
    expect(skipped.length).toBe(1)
    expect(String(skipped[0].reason)).toContain("status=completed")
    expect(String(skipped[0].reason)).toContain("revision=")
  })

  test("S7/AC6: every split row inherits the interrupted member as owner, has no blockers, and names its source; the captain hears the recovery verbs", async () => {
    // The fixture.
    const box = fixture()
    // The team under test.
    const created = teamWith(box.workspace)
    // The force.
    const outcome = await forceWedgedTask(box.deps, box.caller, { teamId: created.teamId, taskId: "T1" })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error(outcome.error)
    /** The record as the force left it. */
    const after = readTeam(box.workspace, created.teamId)
    if (after === undefined) throw new Error("the team record vanished")
    /** The continuation rows the force created. */
    const split = after.tasks.filter((task) => task.id !== "T1")
    expect(split.length).toBe(2)
    for (const task of split) {
      // DISPATCHABLE: the inherited owner is what owner-only dispatch pairs on.
      expect(task.owner).toBe(MEMBER_NAME)
      expect(task.blockedBy).toEqual([])
      expect(task.sourceTaskId).toBe("T1")
      expect(task.status).toBe("pending")
    }
    // THE CAPTAIN'S BODY names the inherited owner and all three recovery verbs.
    const mailbox = fold(readRecords(box.workspace))
    expect(mailbox.messages.length).toBe(1)
    /** The captain's message body, where the inherited owner and the recovery verbs must appear. */
    const body = mailbox.messages[0].body
    expect(body).toContain(`inherited ${MEMBER_NAME} as their owner`)
    expect(body).toContain('mode:"roster"')
    expect(body).toContain("reassign")
    expect(body).toContain('{action:"claim"')
  })

  // F1 (CodeRabbit, branch `fix/watchdog-force-silence`): adoption is bound to THIS task attempt.
  test("F1: a handoff written for ANOTHER task is NOT adopted — the directive still goes out", async () => {
    // The fixture.
    const box = fixture()
    // A team with TWO in-progress rows owned by the same member: T1 is the one the stale document
    // describes, T2 is the row that actually went silent after the member was reopened.
    let record = teamWith(box.workspace)
    record = addTeamTask(record, { subject: "the second row", description: "own that one too", writeScopes: ["packages/c/**"] }, NOW)
    record = updateTeamTask(record, "T2", { status: "in_progress", owner: MEMBER, attempt: 1 }, NOW)
    // The member's ONLY document describes T1 — exactly what a reopened seat keeps from its last row.
    /** The stale document, written for T1. */
    const stale = writeHandoffDocument(box.workspace, record.teamId, MEMBER_NAME, 1, "# Task\nT1\n\n# State\nfinished T1\n")
    record = updateTeamMember(record, MEMBER_NAME, { handoff: { path: stale, ordinal: 1 }, mode: "member" })
    writeTeam(box.workspace, record)
    // The grace directive for T2.
    /** What the grace action answered. */
    const outcome = await graceWedgedTask(box.deps, box.caller, { teamId: record.teamId, taskId: "T2" })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error(outcome.error)
    // NOT ADOPTED: a document about other work cannot stand in for THIS row's artifact.
    expect(outcome.adopted).toBeUndefined()
    expect(outcome.path).not.toBe(stale)
    // THE DIRECTIVE WENT OUT, names T2, and asks for the seven-section handoff.
    expect(box.observed.sends.length).toBe(1)
    expect(box.observed.sends[0].handle).toBe(MEMBER)
    expect(box.observed.sends[0].text).toContain("T2")
    expect(box.observed.sends[0].text).toContain('agent_teams_task {action:"handoff"')
    expect(outcome.delivered).toBe(true)
  })

  test("F1 control: a handoff whose Task section names THIS row is still adopted, and no directive is sent", async () => {
    // The fixture.
    const box = fixture()
    // The team under test.
    let record = teamWith(box.workspace)
    // The member's OWN document for T1, stating the attempt the row carries.
    /** The attributable document. */
    const document = writeHandoffDocument(box.workspace, record.teamId, MEMBER_NAME, 1, "# Task\nT1 (attempt 1) — the wedged row\n\n# State\nhalf done\n")
    record = updateTeamMember(record, MEMBER_NAME, { handoff: { path: document, ordinal: 1 }, mode: "checkpoint" })
    writeTeam(box.workspace, record)
    // The grace directive for the row the document names.
    /** What the grace action answered. */
    const outcome = await graceWedgedTask(box.deps, box.caller, { teamId: record.teamId, taskId: "T1" })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error(outcome.error)
    // COMPLIANCE IS STILL HONOURED: the document is adopted and nothing is delivered.
    expect(outcome.adopted).toBe(document)
    expect(outcome.directive).toBe("")
    expect(box.observed.sends).toEqual([])
  })

  test("F1: a document naming the task but a DIFFERENT attempt is not adopted", async () => {
    // The fixture.
    const box = fixture()
    // The team under test, with the row on its SECOND attempt.
    let record = teamWith(box.workspace)
    record = updateTeamTask(record, "T1", { status: "in_progress", owner: MEMBER, attempt: 2 }, NOW)
    // The document states attempt 1 — the previous generation's work.
    /** The stale-generation document. */
    const stale = writeHandoffDocument(box.workspace, record.teamId, MEMBER_NAME, 1, "# Task\nT1 (attempt 1)\n\n# State\nprevious generation\n")
    record = updateTeamMember(record, MEMBER_NAME, { handoff: { path: stale, ordinal: 1 }, mode: "member" })
    writeTeam(box.workspace, record)
    // The grace directive for the CURRENT generation.
    /** What the grace action answered. */
    const outcome = await graceWedgedTask(box.deps, box.caller, { teamId: record.teamId, taskId: "T1" })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error(outcome.error)
    // NOT ADOPTED, and the member is asked again for the current attempt.
    expect(outcome.adopted).toBeUndefined()
    expect(box.observed.sends.length).toBe(1)
  })

  // F2 (CodeRabbit, same branch): the captain notice quotes the CONFIGURED grace window.
  test("F2: the captain notice quotes the configured graceMs, not the hard-coded 90 s default", async () => {
    // The fixture.
    const box = fixture()
    // The team under test, with a member whose harness delivery seam REFUSES: the directive cannot be
    // delivered, which is the ONE case that mails the captain — and that mail states the deadline.
    const record = teamWith(box.workspace)
    // The refusal must be the SEND, not a missing handle: the roster lookup still needs the member.
    box.observed.sendError = "the member's session is no longer live"
    // A configured 240 s window, far from the default.
    /** The grace instant the watchdog recorded. */
    const graceSentAt = NOW.getTime()
    /** The CONFIGURED window under test, in ms. */
    const configuredGraceMs = 240_000
    // The grace attempt.
    /** What the grace action answered. */
    const outcome = await graceWedgedTask(box.deps, box.caller, { teamId: record.teamId, taskId: "T1", evidence: { graceSentAt, graceMs: configuredGraceMs } })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error(outcome.error)
    expect(outcome.delivered).toBe(false)
    // The captain's mailbox row.
    /** Every message the mailbox holds. */
    const mailbox = fold(readRecords(box.workspace))
    expect(mailbox.messages.length).toBe(1)
    /** The captain's message body, where the deadline must appear. */
    const body = mailbox.messages[0].body
    // THE CONFIGURED DEADLINE, and never the default's.
    expect(body).toContain(String(graceSentAt + configuredGraceMs))
    expect(body).not.toContain(String(graceSentAt + 90_000))
  })
})
