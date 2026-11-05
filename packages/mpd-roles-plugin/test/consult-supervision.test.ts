// The consult supervisor's acceptance tests (§D2): overlap, wait/collect, the deadman and its
// single exemption, the concurrency queue, and the blocking report shape. The module is composed
// with injected seams, so nothing here needs a harness boot.
import { mkdtempSync, readFileSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { CONSULT_FORCE_AFTER_MS, createConsultSupervisor, type ConsultToolActivity } from "../src/spawn-async.ts"

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

  test("an OPEN bash call is NOT interrupted and one consult-long-bash warning is recorded", async () => {
    /** The log lines the supervisor reported. */
    const lines: string[] = []
    /** How many times the handle was interrupted. */
    let interrupted = 0
    /** The child's settlement. */
    const settled = deferred()
    /** An activity record whose current call is an OPEN bash. */
    const activity: ConsultToolActivity = { current: { name: "bash", startedAt: Date.now(), arguments: { command: "bun test" } }, history: [] }
    /** The supervisor under test. */
    const supervisor = createConsultSupervisor({ handoffDir, log: (line) => lines.push(line), activityOf: () => activity, forceAfterMs: () => 10 })
    /** The started consult. */
    const view = supervisor.start({ role: "Senior Engineer", task: "run the gates", exec: {}, raise: async () => ({ id: "c3", result: settled.promise, interrupt: () => { interrupted += 1 } }) })
    await tick(60)
    expect(interrupted).toBe(0)
    expect(lines.filter((line) => line.includes("consult-long-bash")).length).toBeGreaterThanOrEqual(1)
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

  test("the default deadman is the user's 15-minute rule", () => {
    expect(CONSULT_FORCE_AFTER_MS).toBe(900_000)
  })
})
