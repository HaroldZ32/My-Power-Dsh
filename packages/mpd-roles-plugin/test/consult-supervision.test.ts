// The consult supervisor's acceptance tests (§D2): overlap, wait/collect, the deadman and its
// single exemption, the concurrency queue, and the blocking report shape. The module is composed
// with injected seams, so nothing here needs a harness boot.
import { mkdtempSync, readFileSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { CONSULT_FORCE_AFTER_MS, CONSULT_TOOL_IN_FLIGHT_MAX_MS, consultActivityKeyOf, consultLabelKey, createConsultSupervisor, type ConsultToolActivity } from "../src/spawn-async.ts"

/** One externally-settled promise, the handle's `result` in every case below. */
function deferred(): { promise: Promise<any>; resolve: (value: any) => void; reject: (error: unknown) => void } {
  /** The resolver captured by the executor. */
  let resolve: (value: any) => void = (): void => undefined
  /** The rejecter captured by the executor. */
  let reject: (error: unknown) => void = (): void => undefined
  /** The promise itself. */
  const promise = new Promise<any>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

/** Let queued microtasks and one timer tick run. */
function tick(ms: number = 5): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** A fresh handoff directory per test. */
function handoffDir(): string {
  return join(mkdtempSync(join(tmpdir(), "mpd-consult-")), ".mpd", "handoff")
}

/** The normalized child report a fake handle resolves with. */
const CHILD_REPORT = { output: "done", structured: { summary: "the answer", recommendation: "ship it", details: "d", evidence: ["e1"] }, stopReason: "completed" }

describe("consult supervisor (§D2)", () => {
  test("two async consults START before either finishes (peak in-flight >= 2)", async () => {
    /** How many children were raised. */
    let raised = 0
    /** The handles' settlers, one per consult. */
    const settlers: Array<{ resolve: (value: any) => void }> = []
    /** The supervisor under test. */
    const supervisor = createConsultSupervisor({ handoffDir, log: () => undefined, activityOf: () => undefined })
    /** Raise one pending handle. */
    const raise = async (): Promise<any> => {
      raised += 1
      /** The handle's settlement. */
      const settled = deferred()
      settlers.push(settled)
      return { id: "child-" + raised, result: settled.promise, interrupt: () => undefined }
    }
    /** Two consults started before either report exists. */
    const first = supervisor.start({ role: "Reviewer", task: "one", exec: {}, raise })
    /** The second consult, started before the first child reported. */
    const second = supervisor.start({ role: "Architect", task: "two", exec: {}, raise })
    await tick()
    expect(raised).toBe(2)
    expect(first.state).toBe("running")
    expect(second.state).toBe("running")
    settlers.forEach((settled) => settled.resolve(CHILD_REPORT))
    await tick()
    expect((await supervisor.settle(first.consultId)).status).toBe("complete")
    expect((await supervisor.settle(second.consultId)).status).toBe("complete")
  })

  test("wait times out with state running, then collect returns the report", async () => {
    /** The child's settlement. */
    const settled = deferred()
    /** The supervisor under test. */
    const supervisor = createConsultSupervisor({ handoffDir, log: () => undefined, activityOf: () => undefined })
    /** The started consult. */
    const view = supervisor.start({ role: "Reviewer", task: "slow", exec: {}, raise: async () => ({ id: "c1", result: settled.promise, interrupt: () => undefined }) })
    /** The wait bound expires before the child reports. */
    const waited = await supervisor.wait(view.consultId, 10)
    expect((waited as any).state).toBe("running")
    settled.resolve(CHILD_REPORT)
    await tick()
    /** The collected report, released from the registry. */
    const collected = supervisor.collect(view.consultId)
    expect(collected.state).toBe("complete")
    expect(collected.report?.summary).toBe("the answer")
    expect(collected.report?.role).toBe("Reviewer")
    expect(supervisor.list().length).toBe(0)
  })

  test("the deadman interrupts a NON-bash consult and writes the handoff", async () => {
    /** The handoff directory this consult writes. */
    const dir = handoffDir()
    /** How many times the handle was interrupted. */
    let interrupted = 0
    /** The child's settlement. */
    const settled = deferred()
    /** The supervisor under test, with a 10 ms deadman. */
    const supervisor = createConsultSupervisor({ handoffDir: () => dir, log: () => undefined, activityOf: () => undefined, forceAfterMs: () => 10 })
    /** The started consult. */
    const view = supervisor.start({ role: "Researcher", task: "investigate the thing", exec: {}, raise: async () => ({ id: "c2", result: settled.promise, interrupt: () => { interrupted += 1 } }) })
    await tick(40)
    expect(interrupted).toBe(1)
    /** Every handoff document written for this consult. */
    const files = readdirSync(dir)
    expect(files.length).toBe(1)
    expect(files[0].startsWith("consult-" + view.consultId + "-")).toBe(true)
    /** The document's text. */
    const text = readFileSync(join(dir, files[0]), "utf8")
    expect(text).toContain("investigate the thing")
    expect(text).toContain("- role: Researcher")
    expect(text).toContain("last tool calls")
    /** The settlement the blocking surface sees. */
    const report = await supervisor.settle(view.consultId)
    expect(report.status).toBe("interrupted")
    expect(report.handoff).toBe(join(dir, files[0]))
    expect(report.stopReason).toBe("interrupted")
  })

  test("an OPEN bash call is NOT interrupted at ANY age and exactly one consult-long-bash record is written", async () => {
    /** The log lines the supervisor reported. */
    const lines: string[] = []
    /** How many times the handle was interrupted. */
    let interrupted = 0
    /** The child's settlement. */
    const settled = deferred()
    // The bash call started HOURS before this expiry: the exemption has no age bound (§S3).
    /** An activity record whose current call is an OPEN bash. */
    const activity: ConsultToolActivity = { current: { name: "bash", startedAt: Date.now() - 10_800_000, arguments: { command: "bun test" } }, history: [] }
    /** The supervisor under test, whose activity is keyed by the child id (F1 repair). */
    const supervisor = createConsultSupervisor({ handoffDir, log: (line) => lines.push(line), activityOf: (childId) => (childId === "c3" ? activity : undefined), forceAfterMs: () => 10, toolInFlightMaxMs: () => 1_000 })
    /** The started consult. */
    const view = supervisor.start({ role: "Senior Engineer", task: "run the gates", exec: {}, raise: async () => ({ id: "c3", result: settled.promise, interrupt: () => { interrupted += 1 } }) })
    await tick(60)
    expect(interrupted).toBe(0)
    // ONE incident per consult, not one per re-arm: the timer re-armed several times in 60 ms.
    expect(lines.filter((line) => line.includes("consult-long-bash")).length).toBe(1)
    expect(supervisor.list()[0].state).toBe("running")
    settled.resolve(CHILD_REPORT)
    await tick()
    expect((await supervisor.settle(view.consultId)).status).toBe("complete")
  })

  test("over the concurrency cap a consult QUEUES and never throws", async () => {
    /** How many children were raised. */
    let raised = 0
    /** The first child's settlement. */
    const first = deferred()
    /** The supervisor under test with a cap of ONE. */
    const supervisor = createConsultSupervisor({ handoffDir, log: () => undefined, activityOf: () => undefined, maxConcurrent: () => 1 })
    /** Raise one pending child. */
    const raise = async (): Promise<any> => {
      raised += 1
      /** The handle's settlement: the first consult is held open, later ones settle immediately. */
      const settled = raised === 1 ? first : deferred()
      if (raised > 1) settled.resolve(CHILD_REPORT)
      return { id: "child-" + raised, result: settled.promise, interrupt: () => undefined }
    }
    /** Two starts under a cap of one. */
    const one = supervisor.start({ role: "Reviewer", task: "first", exec: {}, raise })
    /** The second consult, which must wait for the first slot. */
    const two = supervisor.start({ role: "Reviewer", task: "second", exec: {}, raise })
    await tick()
    expect(raised).toBe(1)
    expect(supervisor.list().length).toBe(2)
    first.resolve(CHILD_REPORT)
    await tick(10)
    expect(raised).toBe(2)
    expect((await supervisor.settle(one.consultId)).status).toBe("complete")
    expect((await supervisor.settle(two.consultId)).status).toBe("complete")
  })

  test("the blocking report keeps its documented shape", async () => {
    /** The supervisor under test. */
    const supervisor = createConsultSupervisor({ handoffDir, log: () => undefined, activityOf: () => undefined })
    /** The started consult. */
    const view = supervisor.start({ role: "Explorer", task: "find it", exec: {}, raise: async () => ({ id: "c4", result: Promise.resolve(CHILD_REPORT), interrupt: () => undefined }) })
    /** The settled report. */
    const report = await supervisor.settle(view.consultId)
    expect(report.role).toBe("Explorer")
    expect(report.status).toBe("complete")
    expect(report.summary).toBe("the answer")
    expect(report.recommendation).toBe("ship it")
    expect(report.details).toBe("d")
    expect(report.evidence).toEqual(["e1"])
    expect(report.stopReason).toBe("completed")
    expect(typeof report.consultId).toBe("string")
    expect(typeof report.elapsedMs).toBe("number")
  })

  test("the documented defaults are the user's 15-minute rule and the watchdog's in-flight bound", () => {
    // Both are only the LAST link of their resolution chains (§S9): the row reads config first.
    expect(CONSULT_FORCE_AFTER_MS).toBe(900_000)
    expect(CONSULT_TOOL_IN_FLIGHT_MAX_MS).toBe(900_000)
  })

  test("cancelling a QUEUED consult releases no slot and starts no child (cap 1)", async () => {
    /** How many children were raised. */
    let raised = 0
    /** The first child's settlement, which holds the only slot until it resolves. */
    const first = deferred()
    /** The supervisor under test with a cap of ONE. */
    const supervisor = createConsultSupervisor({ handoffDir, log: () => undefined, activityOf: () => undefined, maxConcurrent: () => 1 })
    /** Raise one child: the first holds its slot, every later one settles at once. */
    const raise = async (): Promise<any> => {
      raised += 1
      /** The handle's settlement. */
      const settled = raised === 1 ? first : deferred()
      if (raised > 1) settled.resolve(CHILD_REPORT)
      return { id: "child-" + raised, result: settled.promise, interrupt: () => undefined }
    }
    /** The consult that owns the only slot. */
    const running = supervisor.start({ role: "Reviewer", task: "running", exec: {}, raise })
    /** The FIRST queued consult (never cancelled): it must start once the slot frees. */
    const queued = supervisor.start({ role: "Reviewer", task: "queued", exec: {}, raise })
    /** The SECOND queued consult, cancelled while it waits in `acquire()`. */
    const cancelled = supervisor.start({ role: "Reviewer", task: "cancelled", exec: {}, raise })
    await tick()
    expect(raised).toBe(1)
    // Cancelling a consult that never held a slot must NOT admit another child: the cap is still 1.
    supervisor.cancel(cancelled.consultId)
    await tick()
    expect(raised).toBe(1)
    // The cancelled consult settled `interrupted` without a child and without a slot.
    expect(supervisor.list().find((view) => view.consultId === cancelled.consultId)?.state).toBe("interrupted")
    // Only when the HOLDER settles does the queue move: exactly ONE more child starts.
    first.resolve(CHILD_REPORT)
    await tick()
    expect(raised).toBe(2)
    expect((await supervisor.settle(queued.consultId)).status).toBe("complete")
    expect(supervisor.list().some((view) => view.consultId === cancelled.consultId)).toBe(true)
  })

  test("wait reports the failure text of a consult whose child rejected", async () => {
    /** The supervisor under test. */
    const supervisor = createConsultSupervisor({ handoffDir, log: () => undefined, activityOf: () => undefined })
    /** The started consult, whose child REJECTS (the roster routes that to `failRecord`). */
    const view = supervisor.start({ role: "Researcher", task: "explode", exec: {}, raise: async () => ({ id: "c5", result: Promise.reject(new Error("the child blew up")), interrupt: () => undefined }) })
    await tick()
    /** The wait answer, which must carry the failure the output schema declares as `error`. */
    const waited = await supervisor.wait(view.consultId, 100) as any
    expect(waited.state).toBe("failed")
    expect(waited.error).toBe("the child blew up")
    // The same text `collect` answers, so the two read surfaces never disagree.
    expect(supervisor.collect(view.consultId).error).toBe("the child blew up")
  })
})

describe("activity keying (F1 repair)", () => {
  test("the activity key is the CHILD's session id, with the label only as a no-id fallback", () => {
    /** The adapter-backed label reader these assertions feed. */
    const labelOf = (): string => "Senior Engineer"
    expect(consultActivityKeyOf({ session: { id: "child-1" } }, labelOf)).toBe("child-1")
    expect(consultActivityKeyOf({ session: {} }, labelOf)).toBe(consultLabelKey("Senior Engineer"))
    expect(consultActivityKeyOf({}, () => undefined)).toBeUndefined()
    expect(consultActivityKeyOf(undefined, labelOf)).toBeUndefined()
    expect(consultLabelKey("Reviewer")).toBe("label:Reviewer")
  })

  test("two consults of ONE role: only the WEDGED one is interrupted, the bash-holding twin is untouched", async () => {
    /** The child ids the supervisor interrupted, in order. */
    const interrupts: string[] = []
    /** Build one never-settling handle for a given child id. */
    const handleFor = (id: string): any => {
      /** That child's settlement (never resolved in this arm). */
      const settled = deferred()
      return { id, result: settled.promise, interrupt: () => { interrupts.push(id) } }
    }
    /** The activity reader: ONLY the child named "bash-child" has an OPEN bash call. */
    const activityOf = (childId: string | undefined, _role: string): ConsultToolActivity | undefined => childId === "bash-child" ? { current: { name: "bash", startedAt: Date.now() }, history: [] } : undefined
    /** The supervisor under test. */
    const supervisor = createConsultSupervisor({ handoffDir, log: () => undefined, activityOf, forceAfterMs: () => 10 })
    /** A consult that holds an OPEN bash call — it must NOT be interrupted. */
    const bashHolder = supervisor.start({ role: "Senior Engineer", task: "run the verification suite", exec: {}, raise: async () => handleFor("bash-child") })
    /** A same-role sibling with NO open call — it MUST be interrupted at the bound. */
    const wedged = supervisor.start({ role: "Senior Engineer", task: "write the report", exec: {}, raise: async () => handleFor("wedged-child") })
    await tick(40)
    expect(interrupts).toEqual(["wedged-child"])
    /** The consulted views, keyed by id. */
    const states = new Map(supervisor.list().map((view) => [view.consultId, view.state]))
    expect(states.get(bashHolder.consultId)).toBe("running")
    expect(states.get(wedged.consultId)).toBe("interrupted")
    expect((await supervisor.settle(wedged.consultId)).status).toBe("interrupted")
  })

  test("§S9/AC9: the bound is read LIVE at every arm — two consults in ONE process run under different bounds", async () => {
    /** The child ids the supervisor interrupted, in order. */
    const interrupts: string[] = []
    /** The bound the supervisor reads at its NEXT arm; the test moves it between starts. */
    let boundMs = 10
    /** Build one never-settling handle for a given child id. */
    const handleFor = (id: string): any => {
      /** That child's settlement (never resolved in this arm). */
      const settled = deferred()
      return { id, result: settled.promise, interrupt: () => { interrupts.push(id) } }
    }
    /** The supervisor under test, whose bound closure reads the LIVE value. */
    const supervisor = createConsultSupervisor({ handoffDir, log: () => undefined, activityOf: () => undefined, forceAfterMs: () => boundMs })
    /** A consult armed under the 10 ms bound. */
    const fast = supervisor.start({ role: "Reviewer", task: "fast bound", exec: {}, raise: async () => handleFor("fast-child") })
    // Let the raises settle so each consult is ARMED against the value in force at that moment.
    await tick(5)
    // The configured bound MOVES before the second consult starts: a module constant cannot follow it.
    boundMs = 80
    /** A consult armed under the 80 ms bound. */
    const slow = supervisor.start({ role: "Reviewer", task: "slow bound", exec: {}, raise: async () => handleFor("slow-child") })
    await tick(40)
    expect(interrupts).toEqual(["fast-child"])
    expect(supervisor.list().find((view) => view.consultId === fast.consultId)?.state).toBe("interrupted")
    expect(supervisor.list().find((view) => view.consultId === slow.consultId)?.state).toBe("running")
    await tick(120)
    expect(interrupts).toEqual(["fast-child", "slow-child"])
  })

  test("§S3/§S9: ANY in-flight tool younger than toolInFlightMaxMs is activity; past the bound it stops counting", async () => {
    /** The mutable activity the source reports for this child. */
    const activity: ConsultToolActivity = { current: { name: "read", startedAt: Date.now(), arguments: { path: "src/x.ts" } }, history: [] }
    /** How many times the handle was interrupted. */
    let interrupted = 0
    /** The log lines the supervisor reported. */
    const lines: string[] = []
    /** The supervisor under test: a 10 ms deadman and a 5 000 ms in-flight bound. */
    const supervisor = createConsultSupervisor({
      handoffDir,
      log: (line) => lines.push(line),
      activityOf: (childId) => (childId === "tool-child" ? activity : undefined),
      forceAfterMs: () => 10,
      toolInFlightMaxMs: () => 5_000,
    })
    /** The started consult, whose open `read` call is YOUNG. */
    const view = supervisor.start({ role: "Explorer", task: "read the tree", exec: {}, raise: async () => ({ id: "tool-child", result: deferred().promise, interrupt: () => { interrupted += 1 } }) })
    await tick(40)
    // A non-`bash` call inside the bound is WORK, not a wedge — the old bash-only predicate killed here.
    expect(interrupted).toBe(0)
    expect(lines.some((line) => line.includes("consult-tool-in-flight"))).toBe(true)
    // The SAME call ages past the bound: a hung tool stops counting and the child is interrupted.
    activity.current = { name: "read", startedAt: Date.now() - 60_000, arguments: { path: "src/x.ts" } }
    activity.lastActivityAt = Date.now() - 60_000
    await tick(40)
    expect(interrupted).toBe(1)
    expect((await supervisor.settle(view.consultId)).status).toBe("interrupted")
  })

  test("§S9: the handoff records the measured idle duration and quotes the last assistant message", async () => {
    /** The handoff directory this consult writes. */
    const dir = handoffDir()
    /** The fake clock, epoch milliseconds, so the measured idle duration is exact. */
    let clock = 1_000_000
    /** The timer callback the deadman armed, fired by this test. */
    let armed: (() => void) | undefined
    /** The activity the source reports: a completed call, a committed message, then silence. */
    const activity: ConsultToolActivity = {
      history: [{ name: "bash", startedAt: clock, arguments: { command: "bun test" } }],
      lastActivityAt: clock + 30_000,
      lastAssistantMessage: "I am in the middle of the verification run.\nNext I will collect the exit codes.",
    }
    /** The supervisor under test, with injected clock and timer so the arithmetic is exact. */
    const supervisor = createConsultSupervisor({
      handoffDir: () => dir,
      log: () => undefined,
      activityOf: () => activity,
      now: () => clock,
      setTimer: (fn) => { armed = fn; return 1 },
      clearTimer: () => { armed = undefined },
      forceAfterMs: () => 600_000,
    })
    /** The started consult. */
    const view = supervisor.start({ role: "Senior Engineer", task: "run the gates", exec: {}, raise: async () => ({ id: "handoff-child", result: deferred().promise, interrupt: () => undefined }) })
    await tick()
    expect(armed).toBeDefined()
    // The timer fires 30 s LATE (630 000 ms after the start) and the newest observed activity was the
    // message 30 s after the start, so exactly 600 000 ms of silence — the whole bound — precede this
    // expiry. That is a REAL silence under §S9's measured-idle rule, so the child is settled here.
    clock = 1_000_000 + 630_000
    armed?.()
    /** The document on disk. */
    const text = readFileSync(join(dir, readdirSync(dir)[0]), "utf8")
    expect(text).toContain("- idle: 600000 ms with no observable activity")
    expect(text).toContain("last assistant message: I am in the middle of the verification run. Next I will collect the exit codes.")
    expect(text).toContain("deadman bound 600000 ms")
    expect(text).toContain("Next step: resume the task above")
    // The old template's constant claim is gone: the bound is configurable, the evidence is measured.
    expect(text).not.toContain("15-minute")
    /** The settlement the blocking surface sees. */
    const report = await supervisor.settle(view.consultId)
    expect(report.summary).toContain("no observable activity")
    expect(report.summary).toContain("600000 ms")
  })

  test("§S9: a tool COMPLETION shortly before the bound re-arms the deadman; a child silent for the whole bound is interrupted", async () => {
    /** The fake clock, epoch milliseconds, so each expiry instant is exact. */
    let clock = 1_000_000
    /** The timer callback the deadman armed, fired by this test. */
    let armed: (() => void) | undefined
    /** The delay the LAST arm waits, milliseconds (what the re-arm arithmetic is read from). */
    let delayMs = 0
    /** How many times the handle was interrupted. */
    let interrupted = 0
    // NO open tool at any point: the only evidence is `lastActivityAt`, which is exactly the case the
    // old predicate could not see (it re-armed from open-tool branches only).
    /** The activity the source reports for this child: completed calls stamped, nothing in flight. */
    const activity: ConsultToolActivity = { history: [], lastActivityAt: clock }
    /** The supervisor under test, with a 900 000 ms bound and an injected clock and timer. */
    const supervisor = createConsultSupervisor({
      handoffDir,
      log: () => undefined,
      activityOf: (childId) => (childId === "busy-child" ? activity : undefined),
      now: () => clock,
      setTimer: (fn, ms) => { armed = fn; delayMs = ms; return 1 },
      clearTimer: () => { armed = undefined },
      forceAfterMs: () => 900_000,
    })
    /** The started consult. */
    const view = supervisor.start({ role: "Senior Engineer", task: "slow but busy", exec: {}, raise: async () => ({ id: "busy-child", result: deferred().promise, interrupt: () => { interrupted += 1 } }) })
    await tick()
    expect(delayMs).toBe(900_000)
    // (1) The child COMPLETES a tool 1 ms before the bound expires: it is demonstrably working.
    clock += 900_000 - 1
    activity.history.push({ name: "read", startedAt: clock, arguments: { path: "src/x.ts" } })
    activity.lastActivityAt = clock
    clock += 1
    armed?.()
    expect(interrupted).toBe(0)
    expect(supervisor.list()[0].state).toBe("running")
    // Re-armed from the REMAINING time (900 000 - 1), not from a fresh full bound.
    expect(delayMs).toBe(899_999)
    // (2) The child then goes SILENT for the whole bound: this expiry is the one that settles it.
    clock += 899_999
    armed?.()
    expect(interrupted).toBe(1)
    /** The settlement the blocking surface sees. */
    const report = await supervisor.settle(view.consultId)
    expect(report.status).toBe("interrupted")
    expect(report.summary).toContain("900000 ms with no observable activity")
  })

  test("§S9: a configured bound of 0 DISABLES the consult deadman (the shared knob's meaning)", async () => {
    /** How many times the handle was interrupted. */
    let interrupted = 0
    /** The child's settlement. */
    const settled = deferred()
    /** The supervisor under test, whose configured bound is 0. */
    const supervisor = createConsultSupervisor({ handoffDir, log: () => undefined, activityOf: () => undefined, forceAfterMs: () => 0 })
    /** The started consult. */
    const view = supervisor.start({ role: "Reviewer", task: "never forced", exec: {}, raise: async () => ({ id: "c6", result: settled.promise, interrupt: () => { interrupted += 1 } }) })
    await tick(30)
    expect(interrupted).toBe(0)
    expect(supervisor.list()[0].state).toBe("running")
    settled.resolve(CHILD_REPORT)
    await tick()
    expect((await supervisor.settle(view.consultId)).status).toBe("complete")
  })
})
