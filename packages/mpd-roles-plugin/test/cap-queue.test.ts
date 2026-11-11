// THE RAISED CONCURRENCY BUDGET (W3) — the host refusal becomes a queue, and one counter serves all (§6).
//
// WHAT THESE ARMS PROVE. (1) A raise the HOST refuses for want of a live child slot is NOT a failed
// consult: the MPD slot is given back, the consult re-enters at the FRONT of the FIFO after a bounded
// backoff (250 ms doubling, 4 s ceiling), and it settles normally once the host admits it — with the
// refusal count visible as `hostRetries`. (2) Exhausting the attempt budget fails with the SAME error code
// and a message naming the one-time host setting the operator must change. (3) A per-start `maxConcurrent`
// request rides the SAME `acquire()` counter — thirty-two children under a default of eight — and an
// explicitly declared `MPD_DSH_CONSULT_MAX` still wins. Nothing here starts a real child or sleeps for a
// real backoff: the timer seam is injected, so the assertions are about the ORDER and the BUDGET.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createMpConsults } from "../src/consults.ts"
import { DELEGATE_MAX_TASKS, readDelegateTasks, type ConsultServiceView } from "../../mpd-cellwork-plugin/src/consults.ts"
import { RECON_MAX_QUESTIONS, runRecon, type ReconDeps } from "../../mpd-cellwork-plugin/src/recon.ts"
import { newCellState } from "../../mpd-cellwork-plugin/src/state.ts"
import type { DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index.ts"
import {
  CONSULT_HOST_BACKOFF_CAP_MS,
  CONSULT_HOST_RETRY_MAX_ATTEMPTS,
  CONSULT_MAX_DEFAULT,
  HOST_ACTIVATION_LIMIT_CODE,
  consultMaxDeclaredFromEnv,
  consultMaxFromEnv,
  createConsultSupervisor,
  hostBackoffMs,
  isHostActivationLimit,
  type ConsultSupervisor,
} from "../src/spawn-async.ts"

/** The normalized child report every successful fake handle resolves with. */
const CHILD_REPORT = { output: "done", structured: { summary: "the answer", recommendation: "ship it", details: "d", evidence: [] }, stopReason: "completed" }

/** One fake activation handle the test settles itself. */
interface FakeHandle {
  /** The handle's own id (the activity key the deadman would read). */
  id: string
  /** The child's settlement, resolved by the test. */
  result: Promise<{ output: string; structured: Record<string, unknown>; stopReason: string }>
  /** The interrupt seam the supervisor may call. */
  interrupt: () => void
}

/** A deferred promise, so a fake child settles exactly when the arm says so. */
interface Deferred {
  /** The promise itself. */
  promise: Promise<{ output: string; structured: Record<string, unknown>; stopReason: string }>
  /** Resolve it with the child's report. */
  resolve: (value: { output: string; structured: Record<string, unknown>; stopReason: string }) => void
}

/**
 * Build one externally-settled promise.
 *
 * @returns the promise and its resolver.
 */
function deferred(): Deferred {
  /** The captured resolver. */
  let resolve: Deferred["resolve"] = (): void => undefined
  /** The promise under test. */
  const promise = new Promise<{ output: string; structured: Record<string, unknown>; stopReason: string }>((res) => { resolve = res })
  return { promise, resolve }
}

/** The numbers the injected timer was asked to wait for, in order (the backoff sequence). */
type TimerLog = number[]

/**
 * Build the injected timer seam: record every delay and fire it on the next macrotask.
 *
 * A delay ABOVE {@link DEADMAN_TIMER_FLOOR_MS} is the consult deadman's own arm, which must NOT fire in a
 * test (it would interrupt the fake child); it is recorded and never scheduled.
 *
 * @param log - the array every requested delay is appended to.
 * @returns the pair of timer seams the supervisor takes.
 */
function timerSeams(log: TimerLog): {
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
} {
  return {
    setTimer: (fn: () => void, ms: number): unknown => {
      log.push(ms)
      if (ms >= DEADMAN_TIMER_FLOOR_MS) return undefined
      return setTimeout(fn, 0)
    },
    clearTimer: (handle: unknown): void => { clearTimeout(handle as ReturnType<typeof setTimeout>) },
  }
}

/** Delays at or above this are the deadman's arm (900 000 ms by default), never a backoff. */
const DEADMAN_TIMER_FLOOR_MS = 10000

/** One timer the supervisor asked a MANUAL seam to arm. */
interface PendingTimer {
  /** The callback the supervisor runs when the timer fires. */
  fn: () => void
  /** The requested delay, milliseconds. */
  ms: number
}

/** A timer seam the ARM drives by hand, so a backoff is OBSERVED instead of slept through. */
interface ManualTimers {
  /** Arm one timer; the handle is the pending entry itself. */
  setTimer: (fn: () => void, ms: number) => unknown
  /** Drop one armed timer (the supervisor's clear path). */
  clearTimer: (handle: unknown) => void
  /** Every armed timer, oldest first. */
  pending: PendingTimer[]
  /**
   * Fire exactly ONE timer with this delay, oldest first.
   * @param ms - the delay to fire.
   * @returns whether such a timer was pending.
   */
  fire: (ms: number) => boolean
}

/**
 * Build a timer seam whose timers only fire when the arm says so.
 * @returns the seam.
 */
function manualTimers(): ManualTimers {
  /** The armed timers, oldest first. */
  const pending: PendingTimer[] = []
  return {
    pending,
    setTimer: (fn: () => void, ms: number): unknown => {
      /** The entry the supervisor will clear by handle. */
      const entry: PendingTimer = { fn, ms }
      pending.push(entry)
      return entry
    },
    clearTimer: (handle: unknown): void => {
      /** Where the entry sits, or -1 when it already fired. */
      const index = pending.indexOf(handle as PendingTimer)
      if (index >= 0) pending.splice(index, 1)
    },
    fire: (ms: number): boolean => {
      /** The oldest timer with that delay. */
      const index = pending.findIndex((entry) => entry.ms === ms)
      if (index < 0) return false
      /** The fired entry, removed before its callback runs. */
      const entry = pending.splice(index, 1)[0]
      entry.fn()
      return true
    },
  }
}

/** The wall-clock bound one settlement await may take before the arm fails instead of hanging. */
const SETTLE_GUARD_MS = 1000

/**
 * Await one consult's settlement under a wall-clock guard.
 *
 * WHY: the front-re-entry arm would otherwise HANG forever if the consult were never admitted, and a
 * hanging suite is a worse signal than a red arm.
 * @param supervisor - the supervisor under test.
 * @param consultId - the consult to await.
 * @returns the settled report.
 */
async function settleWithin(supervisor: ConsultSupervisor, consultId: string): Promise<unknown> {
  /** The guard's rejection when the settlement never lands. */
  const guard = new Promise<never>((_resolve, reject) => {
    setTimeout(() => reject(new Error("settlement did not land within " + String(SETTLE_GUARD_MS) + " ms: the consult was never admitted")), SETTLE_GUARD_MS)
  })
  return await Promise.race([supervisor.settle(consultId), guard])
}

/**
 * Let the supervisor's queued microtasks run without advancing a timer.
 * @param rounds - how many microtask turns to yield (the retry loop awaits a few promises per step).
 * @returns a promise resolved after those turns.
 */
async function settleMicrotasks(rounds: number = 12): Promise<void> {
  for (let round = 0; round < rounds; round += 1) await Promise.resolve()
}

/** A canonicaliser good enough for the one role these arms use. */
function canonical(role: string): string | null {
  return role.trim().toLowerCase() === "reviewer" ? "Reviewer" : null
}

/** The host's own refusal, as the host throws it: the code on the error. */
function hostRefusal(message: string = HOST_ACTIVATION_LIMIT_CODE + ": the activation tree is at its live-child limit"): Error {
  return Object.assign(new Error(message), { code: HOST_ACTIVATION_LIMIT_CODE })
}

/**
 * Compose the service over a REAL supervisor and a scripted raise seam.
 *
 * @param script - the raise seam's answer for the 1-based attempt number: a handle, or an error to throw.
 * @param options - `declaredMax` wires the operator-declared cap; `log` receives every timer delay;
 *   `timers` replaces the auto seam with a hand-driven one.
 * @returns the supervisor, the service, the 1-based attempt numbers and the TASK LABEL of every raise.
 */
function compose(
  script: (attempt: number) => FakeHandle | Error,
  options: { declaredMax?: () => number | undefined; log?: TimerLog; timers?: ManualTimers } = {},
): { supervisor: ConsultSupervisor; service: ReturnType<typeof createMpConsults>; attempts: number[]; taskLog: string[] } {
  /** The 1-based attempt numbers the raise seam was called with. */
  const attempts: number[] = []
  /**
   * The task label of every raise, in the SAME order as `attempts`.
   *
   * WHY: a count-only log cannot tell WHICH consult was served, so a tail re-entry or a cancelled
   * consult's re-admission would pass an `attempts.length` check. This log makes the ORDER the
   * assertion (F1/N2 and the drain order in F2/N1).
   */
  const taskLog: string[] = []
  /** The injected timer seams: the hand-driven pair when the arm supplies one, else the auto seam. */
  const seams = options.timers === undefined
    ? timerSeams(options.log ?? [])
    : { setTimer: options.timers.setTimer, clearTimer: options.timers.clearTimer }
  /** The ONE supervisor under test. */
  const supervisor = createConsultSupervisor({
    handoffDir: () => "/tmp/mpd-handoff",
    log: () => undefined,
    activityOf: () => undefined,
    ...(options.declaredMax === undefined ? {} : { maxConcurrent: options.declaredMax }),
    setTimer: seams.setTimer,
    clearTimer: seams.clearTimer,
  })
  /** The service under test, over that same supervisor. */
  const service = createMpConsults({
    supervisor,
    raise: async (spec) => {
      attempts.push(attempts.length + 1)
      taskLog.push(String(spec.task))
      /** The scripted answer for this attempt. */
      const outcome = script(attempts.length)
      if (outcome instanceof Error) throw outcome
      // The role comes from the service's canonicaliser, never from the caller's spelling.
      return { ...outcome, id: outcome.id + "-" + spec.role.replace(/\s+/g, "-") }
    },
    canonicalRole: (role: string): string | null => canonical(role),
  })
  return { supervisor, service, attempts, taskLog }
}

/** The pass-through report a successful fake child resolves with. */
function completedReport(): { output: string; structured: Record<string, unknown>; stopReason: string } {
  return CHILD_REPORT
}

/** The declared-cap environment variable the precedence arms read. */
const ENV_KEY = "MPD_DSH_CONSULT_MAX"

/** Restore the env key after every arm, so a failure cannot leak the cap into another file. */
afterEach((): void => {
  delete process.env[ENV_KEY]
})

describe("the host refusal is a queue signal, never a failure (§6.1)", () => {
  test("three host refusals then success: hostRetries=3, the consult settles COMPLETE", async () => {
    /** The timer delays this arm observed. */
    const log: TimerLog = []
    /** The latest fake handle the scripted raise handed out. */
    let handle: FakeHandle | undefined
    /** The composed trio. */
    const { supervisor, service, attempts } = compose((attempt) => {
      if (attempt <= 3) return hostRefusal()
      handle = { id: "child-" + String(attempt), result: Promise.resolve(completedReport()), interrupt: () => undefined }
      return handle
    }, { log })
    /** The started consult. */
    const started = await service.start({ role: "Reviewer", task: "review the change", exec: {} })
    /** The settled report (the retry chain runs behind the start). */
    const report = await supervisor.settle(started.consultId)
    expect(report.status).toBe("complete")
    expect(attempts.length).toBe(4)
    // THE COUNT IS VISIBLE: the three refusals are on the record, so a render can show them.
    const view = supervisor.list().find((entry) => entry.consultId === started.consultId)
    expect(view?.hostRetries).toBe(3)
    expect(view?.state).toBe("complete")
    // The collect path carries the same view, never a failure.
    const outcome = service.collect(started.consultId)
    expect(outcome?.error).toBeUndefined()
    expect(outcome?.report?.summary).toBe("the answer")
    // THE BACKOFF: 250 ms doubling, capped at 4 s — the first three waits are the documented sequence.
    expect(log.slice(0, 3)).toEqual([250, 500, 1000])
  })

  test("an exhausted attempt budget fails with the SAME code and NAMES the host setting", async () => {
    /** The composed trio; every attempt is refused. */
    const { supervisor, service, attempts } = compose(() => hostRefusal())
    /** The started consult. */
    const started = await service.start({ role: "Reviewer", task: "review", exec: {} })
    /** The rejection the settlement carries. */
    let failure: unknown
    try {
      await supervisor.settle(started.consultId)
    } catch (error) {
      failure = error
    }
    // AT MOST eight attempts: the ninth raise never happens.
    expect(attempts.length).toBe(CONSULT_HOST_RETRY_MAX_ATTEMPTS)
    expect(isHostActivationLimit(failure)).toBe(true)
    expect((failure as { message: string }).message).toContain("maxActiveSubagents")
    expect((failure as { message: string }).message).toContain("Settings → Subagent limits")
    // The failure is visible on the record, with the full refusal count.
    const view = supervisor.list().find((entry) => entry.consultId === started.consultId)
    expect(view?.state).toBe("failed")
    expect(view?.hostRetries).toBe(CONSULT_HOST_RETRY_MAX_ATTEMPTS)
    expect(String(service.collect(started.consultId)?.error)).toContain("maxActiveSubagents")
  })

  test("a REAL child error still fails at once, with no retry", async () => {
    /** The composed trio; the single attempt throws a plain error. */
    const { supervisor, service, attempts } = compose(() => new Error("the model route is unconfigured"))
    /** The started consult. */
    const started = await service.start({ role: "Reviewer", task: "review", exec: {} })
    /** The rejection the settlement carries. */
    let failure: unknown
    try {
      await supervisor.settle(started.consultId)
    } catch (error) {
      failure = error
    }
    expect(attempts.length).toBe(1)
    expect((failure as Error).message).toBe("the model route is unconfigured")
    expect(supervisor.list()[0].hostRetries).toBeUndefined()
  })

  test("the refusal is also detected from the MESSAGE alone (a wrapper that drops the code)", async () => {
    /** The composed trio: the first attempt carries only the text, the second succeeds. */
    const { supervisor, service, attempts } = compose((attempt) => {
      if (attempt === 1) return new Error("spawn failed: " + HOST_ACTIVATION_LIMIT_CODE)
      return { id: "child", result: Promise.resolve(completedReport()), interrupt: () => undefined }
    })
    /** The started consult. */
    const started = await service.start({ role: "Reviewer", task: "review", exec: {} })
    /** The settled report. */
    const report = await supervisor.settle(started.consultId)
    expect(report.status).toBe("complete")
    expect(attempts.length).toBe(2)
    expect(supervisor.list()[0].hostRetries).toBe(1)
  })

  test("the backoff doubles from 250 ms and never exceeds the 4 s ceiling", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(hostBackoffMs)).toEqual([250, 500, 1000, 2000, 4000, 4000, 4000, 4000])
    expect(hostBackoffMs(8)).toBe(CONSULT_HOST_BACKOFF_CAP_MS)
  })
})

describe("the per-start budget rides the ONE counter (§6.2)", () => {
  test("maxConcurrent 32 admits 32 concurrent children under the default 8, and a third start waits", async () => {
    /** The handles the test settles, by the index of the raise that produced them. */
    const handles: Deferred[] = []
    /** The composed trio. */
    const { supervisor, service, attempts } = compose(() => {
      /** This child's settlement, resolved by the arm below. */
      const settled = deferred()
      handles.push(settled)
      return { id: "child-" + String(handles.length), result: settled.promise, interrupt: () => undefined }
    })
    // THE IDENTITY: the service answers from the SAME supervisor, so its own list sees every start.
    const ids: string[] = []
    for (let index = 0; index < 32; index += 1) {
      /** One started consult. */
      const started = await service.start({ role: "Reviewer", task: "task-" + String(index), exec: {}, maxConcurrent: 32 })
      ids.push(started.consultId)
    }
    // Let the starts' async raises run.
    for (let tick = 0; tick < 5; tick += 1) await new Promise((resolve) => setTimeout(resolve, 0))
    expect(attempts.length).toBe(32)
    expect(supervisor.list().length).toBe(32)
    expect(ids.length).toBe(32)
    // A 33rd start at the SAME requested budget must QUEUE, not raise a child.
    await service.start({ role: "Reviewer", task: "task-33", exec: {}, maxConcurrent: 32 })
    for (let tick = 0; tick < 5; tick += 1) await new Promise((resolve) => setTimeout(resolve, 0))
    expect(attempts.length).toBe(32)
    expect(supervisor.list().length).toBe(33)
    // Freeing one slot admits exactly one waiter, so the queue is real rather than a wider cap.
    handles[0].resolve(completedReport())
    await supervisor.settle(ids[0])
    for (let tick = 0; tick < 5; tick += 1) await new Promise((resolve) => setTimeout(resolve, 0))
    expect(attempts.length).toBe(33)
  })

  test("a DECLARED MPD_DSH_CONSULT_MAX wins over the per-start request", async () => {
    // The env cap is the operator's hard bound: a request for 32 may not beat it (§6.2 precedence).
    process.env[ENV_KEY] = "4"
    expect(consultMaxDeclaredFromEnv()).toBe(4)
    /** The composed trio, wired the way the row wires it: the DECLARED cap. */
    const { supervisor, service, attempts } = compose(() => {
      /** A child that stays running: the arm only counts admissions. */
      const settled = deferred()
      return { id: "child", result: settled.promise, interrupt: () => undefined }
    }, { declaredMax: () => consultMaxDeclaredFromEnv() })
    expect(supervisor.effectiveBudgetOf(32)).toBe(4)
    for (let index = 0; index < 6; index += 1) {
      await service.start({ role: "Reviewer", task: "task-" + String(index), exec: {}, maxConcurrent: 32 })
    }
    for (let tick = 0; tick < 5; tick += 1) await new Promise((resolve) => setTimeout(resolve, 0))
    expect(attempts.length).toBe(4)
    expect(supervisor.list().length).toBe(6)
  })

  test("with no declared cap the default 8 still applies when the start requests nothing", async () => {
    /** The composed trio, no declared cap and no request. */
    const { supervisor } = compose(() => {
      /** A child that stays running. */
      const settled = deferred()
      return { id: "child", result: settled.promise, interrupt: () => undefined }
    })
    expect(supervisor.effectiveBudgetOf(undefined)).toBe(CONSULT_MAX_DEFAULT)
    expect(supervisor.effectiveBudgetOf(12)).toBe(12)
  })
})

/**
 * A fake `mpdConsults` service good enough for `runRecon`'s batch path.
 *
 * @returns the service slice and every id it minted, in order.
 */
function fakeReconService(): { service: ConsultServiceView; started: string[] } {
  /** Every id the service minted. */
  const started: string[] = []
  /** The monotonic part of a minted id. */
  let sequence = 0
  /** The service under test. */
  const service: ConsultServiceView = {
    start: async (): Promise<unknown> => {
      sequence += 1
      /** The minted id. */
      const id = "recon-" + String(sequence)
      started.push(id)
      return { consultId: id, state: "running" }
    },
    settle: async (): Promise<unknown> => undefined,
    collect: (consultId: string): unknown => ({
      consultId,
      state: "complete",
      report: { role: "Explorer", status: "complete", summary: "found it", recommendation: "", details: "", evidence: [], stopReason: "completed", consultId, elapsedMs: 1 },
    }),
  }
  return { service, started }
}

/**
 * Build the recon dependencies over a fresh temp workspace and a fake service.
 *
 * @param service - the fake consult service.
 * @returns the dependencies `runRecon` takes.
 */
function reconDeps(service: ConsultServiceView): ReconDeps {
  return {
    consults: service,
    // The fake service ignores `exec`; it is present only because the real seam forwards it.
    exec: {} as unknown as DshToolExec,
    workspace: mkdtempSync(join(tmpdir(), "mpd-cap-queue-")),
    cell: newCellState({ cellId: "cell-20261111T000000000Z", objective: "raise the budget", captainSessionId: "session-captain", now: new Date("2026-11-11T00:00:00.000Z") }),
    caller: { member: "cell-planner", mode: "member" },
    personaFor: (): string | null => null,
    now: new Date("2026-11-11T00:00:01.000Z"),
  }
}

describe("the raised per-call bounds (§6.4 arm 4)", () => {
  test("cellwork_delegate accepts 32 tasks and refuses 33 WHOLE-CALL", () => {
    expect(DELEGATE_MAX_TASKS).toBe(32)
    /** Thirty-two valid tasks. */
    const thirtyTwo = Array.from({ length: 32 }, (_value, index) => ({ role: "Reviewer", task: "t" + String(index) }))
    /** The accepted parse. */
    const accepted = readDelegateTasks(thirtyTwo)
    expect("tasks" in accepted).toBe(true)
    /** One task over the bound. */
    const thirtyThree = [...thirtyTwo, { role: "Reviewer", task: "t32" }]
    /** The refusal. */
    const refused = readDelegateTasks(thirtyThree)
    expect("error" in refused).toBe(true)
    expect(String((refused as { error: string }).error)).toContain("33")
    expect(String((refused as { error: string }).error)).toContain("32")
    // The bound is an ARGUMENT: a row that configured 8 refuses the ninth task and names that number.
    expect("tasks" in readDelegateTasks(thirtyTwo.slice(0, 8), 8)).toBe(true)
    expect(String((readDelegateTasks(thirtyTwo.slice(0, 9), 8) as { error: string }).error)).toContain("more than the 8")
  })

  test("cellwork_recon accepts 16 questions and refuses 17", async () => {
    expect(RECON_MAX_QUESTIONS).toBe(16)
    /** A fake service for the accepted batch. */
    const acceptedFake = fakeReconService()
    /** Sixteen questions. */
    const sixteen = Array.from({ length: 16 }, (_value, index) => "q" + String(index + 1))
    /** The accepted batch answer. */
    const accepted = await runRecon(reconDeps(acceptedFake.service), { role: "Explorer", questions: sixteen })
    expect(accepted.ok).toBe(true)
    expect(accepted.ok ? accepted.reports?.length : 0).toBe(16)
    expect(acceptedFake.started.length).toBe(16)
    // ONE over the bound refuses the WHOLE call, and nothing starts.
    const refusedFake = fakeReconService()
    /** Seventeen questions. */
    const seventeen = [...sixteen, "q17"]
    /** The refusal. */
    const refused = await runRecon(reconDeps(refusedFake.service), { role: "Explorer", questions: seventeen })
    expect(refused.ok).toBe(false)
    expect(refused.ok ? "" : refused.error).toContain("more than the 16")
    expect(refusedFake.started.length).toBe(0)
    // The configured bound wins over the shipped default, again as an argument.
    const configuredFake = fakeReconService()
    /** Five questions under a configured bound of four. */
    const configured = await runRecon({ ...reconDeps(configuredFake.service), maxQuestions: 4 }, { role: "Explorer", questions: sixteen.slice(0, 5) })
    expect(configured.ok).toBe(false)
    expect(configured.ok ? "" : configured.error).toContain("more than the 4")
    expect(configuredFake.started.length).toBe(0)
  })
})

describe("the off-slot release and the FRONT re-entry, with a SECOND consult in play (§6.1, F1)", () => {
  test("A is refused, B is admitted DURING A's backoff, and A is re-served BEFORE C that queued behind it", async () => {
    /** The hand-driven timer seam, so the backoff lasts exactly as long as the arm says. */
    const timers = manualTimers()
    /** The handles of every SUCCESSFUL raise, in raise order (B, A-retry, C). */
    const children: Deferred[] = []
    /** The composed trio, all starts under a budget of ONE. */
    const { supervisor, service, attempts, taskLog } = compose((attempt) => {
      // A's FIRST attempt is the host refusal; every later attempt starts a child the arm settles.
      if (attempt === 1) return hostRefusal()
      /** This child's settlement. */
      const settled = deferred()
      children.push(settled)
      return { id: "child-" + String(attempt), result: settled.promise, interrupt: () => undefined }
    }, { timers })

    // A starts, is refused, and enters its 250 ms backoff holding NO slot.
    const a = await service.start({ role: "Reviewer", task: "A", exec: {}, maxConcurrent: 1 })
    await settleMicrotasks()
    expect(attempts.length).toBe(1)
    expect(timers.pending.some((entry) => entry.ms === 250)).toBe(true)

    // (a)+(c) B starts at the SAME budget of one while A's backoff timer is still pending, and is
    // ADMITTED: A gave the one slot back before sleeping, so the refusal cost the queue nothing.
    const b = await service.start({ role: "Reviewer", task: "B", exec: {}, maxConcurrent: 1 })
    await settleMicrotasks()
    expect(attempts.length).toBe(2)
    expect(timers.pending.some((entry) => entry.ms === 250)).toBe(true)

    // C queues behind the one busy slot: its raise must not run yet.
    const c = await service.start({ role: "Reviewer", task: "C", exec: {}, maxConcurrent: 1 })
    await settleMicrotasks()
    expect(attempts.length).toBe(2)

    // (b) A's backoff expires: A re-enters at the FRONT, ahead of C that queued while it slept.
    expect(timers.fire(250)).toBe(true)
    await settleMicrotasks()
    expect(attempts.length).toBe(2)

    // B finishes; the freed slot goes to A (FRONT), never to C (tail).
    children[0].resolve(completedReport())
    await settleWithin(supervisor, b.consultId)
    await settleMicrotasks()
    expect(attempts.length).toBe(3)
    // N2 — THE ORDER IS THE ASSERTION: the third raise is A's RETRY. A tail re-entry would raise C
    // here and fail on THIS line, not on a timeout: the log is ["A" (refused), "B", "A", …].
    expect(taskLog[2]).toBe("A")
    expect(supervisor.list().find((entry) => entry.consultId === a.consultId)?.hostRetries).toBe(1)

    // A's retry child finishes; the NEXT admission is C, so A was served exactly once more.
    children[1].resolve(completedReport())
    await settleWithin(supervisor, a.consultId)
    await settleMicrotasks()
    expect(attempts.length).toBe(4)
    // The whole raise order, semantically: A refused, B, A's retry, then C.
    expect(taskLog).toEqual(["A", "B", "A", "C"])
    /** A's final view: complete, with the one refusal on the record (never `failed`). */
    const aView = supervisor.list().find((entry) => entry.consultId === a.consultId)
    expect(aView?.state).toBe("complete")
    expect(aView?.hostRetries).toBe(1)
    /** C's final view: it did start. */
    expect(supervisor.list().find((entry) => entry.consultId === c.consultId)?.state).toBe("running")
  })
})

describe("a cancel inside the backoff window (§6.1 hazard, F2)", () => {
  test("the cancelled consult starts no child, does not double-release the slot, and the queue drains to C", async () => {
    /** The hand-driven timer seam, so the cancel lands INSIDE the window. */
    const timers = manualTimers()
    /** The handles of every successful raise, in raise order (B, C, D). */
    const children: Deferred[] = []
    /** The composed trio, every start at a budget of ONE. */
    const { supervisor, service, attempts, taskLog } = compose((attempt) => {
      // A's first attempt is the only host refusal; B, C and D each start a real fake child.
      if (attempt === 1) return hostRefusal()
      /** This child's settlement. */
      const settled = deferred()
      children.push(settled)
      return { id: "child-" + String(attempt), result: settled.promise, interrupt: () => undefined }
    }, { timers })

    // A is refused and now sleeps; B takes the freed slot; C queues.
    const a = await service.start({ role: "Reviewer", task: "A", exec: {}, maxConcurrent: 1 })
    await settleMicrotasks()
    expect(attempts.length).toBe(1)
    /** B: the start that must be ADMITTED while A sleeps (the slot A gave back). */
    const b = await service.start({ role: "Reviewer", task: "B", exec: {}, maxConcurrent: 1 })
    await settleMicrotasks()
    /** C: the start that queues BEHIND A, so it is the one a tail re-entry would wrongly serve first. */
    const c = await service.start({ role: "Reviewer", task: "C", exec: {}, maxConcurrent: 1 })
    await settleMicrotasks()
    expect(attempts.length).toBe(2)

    // THE CANCEL LANDS WHILE THE 250 ms BACKOFF TIMER IS STILL PENDING.
    const cancelled = service.cancel(a.consultId)
    expect(cancelled.state).toBe("interrupted")
    expect(cancelled.consultId).toBe(a.consultId)

    // A DOUBLE-RELEASE WOULD SHOW HERE: A gave its slot back once when the host refused it, and the
    // cancel's settlement must not release a second one. The ONE counter still counts B, so D queues.
    const d = await service.start({ role: "Reviewer", task: "D", exec: {}, maxConcurrent: 1 })
    await settleMicrotasks()
    expect(attempts.length).toBe(2)

    // Firing the stale backoff must start NO child and must not re-queue the settled consult: the raise
    // log is UNCHANGED — A's one REFUSED attempt, then B — and gains no fourth entry for A.
    expect(timers.fire(250)).toBe(true)
    await settleMicrotasks()
    expect(taskLog).toEqual(["A", "B"])
    expect(attempts.length).toBe(2)

    // B finishes: the queue drains to C, never to the cancelled A (the ORDER, by task label).
    children[0].resolve(completedReport())
    await settleWithin(supervisor, b.consultId)
    await settleMicrotasks()
    expect(attempts.length).toBe(3)
    expect(taskLog[2]).toBe("C")

    // C finishes: D is next, so the counter still admitted exactly one child per slot.
    children[1].resolve(completedReport())
    await settleWithin(supervisor, c.consultId)
    await settleMicrotasks()
    expect(attempts.length).toBe(4)
    // The whole raise order, semantically: A ONCE (refused), then B, C, D — the cancelled consult never
    // appears a second time, so no stale backoff ever re-admitted it.
    expect(taskLog).toEqual(["A", "B", "C", "D"])

    // The cancelled record keeps its ONE refusal and its interrupted state, and it never failed.
    /** A's final view. */
    const aView = supervisor.list().find((entry) => entry.consultId === a.consultId)
    expect(aView?.state).toBe("interrupted")
    expect(aView?.hostRetries).toBe(1)
    expect(supervisor.list().find((entry) => entry.consultId === d.consultId)?.state).toBe("running")
  })
})

/** A per-start request the malformed-env arm asks for (a number no default would produce). */
const originalBudgetRequest = 12

describe("a consult cancelled while QUEUED (§6.1 hazard, N1 companion)", () => {
  test("the granted slot is released WITHOUT raising a child, so the queue drains B -> C -> D", async () => {
    /** The hand-driven timer seam (no backoff is involved here, but the arm keeps the same shape). */
    const timers = manualTimers()
    /** The handles of every successful raise, in raise order (B, C, D). */
    const children: Deferred[] = []
    /** The composed trio, every start at a budget of ONE. */
    const { supervisor, service, attempts, taskLog } = compose((_attempt) => {
      /** This child's settlement. */
      const settled = deferred()
      children.push(settled)
      return { id: "child-" + String(children.length), result: settled.promise, interrupt: () => undefined }
    }, { timers })

    // B takes the one slot; A queues BEHIND it; C queues behind A; D queues last.
    /** B: takes the one slot. */
    const b = await service.start({ role: "Reviewer", task: "B", exec: {}, maxConcurrent: 1 })
    await settleMicrotasks()
    /** A: queued behind B, then cancelled BEFORE it is ever granted a slot. */
    const a = await service.start({ role: "Reviewer", task: "A", exec: {}, maxConcurrent: 1 })
    await settleMicrotasks()
    /** C: the first LIVE waiter, which must be served once A's granted slot is given back. */
    const c = await service.start({ role: "Reviewer", task: "C", exec: {}, maxConcurrent: 1 })
    await settleMicrotasks()
    /** D: the last waiter, admitted only after C finishes (so exactly one slot was handed out). */
    const d = await service.start({ role: "Reviewer", task: "D", exec: {}, maxConcurrent: 1 })
    await settleMicrotasks()
    expect(taskLog).toEqual(["B"])

    // THE CANCEL LANDS WHILE A IS STILL QUEUED — it was never granted a slot.
    const cancelled = service.cancel(a.consultId)
    expect(cancelled.state).toBe("interrupted")

    // B finishes: A's waiter IS granted the freed slot, and the POST-GRANT guard must give it straight
    // back without raising a child, so C — the next live waiter — is served instead.
    children[0].resolve(completedReport())
    await settleWithin(supervisor, b.consultId)
    await settleMicrotasks()
    // THE SEMANTIC ASSERTION: the raise order is B then C. A never raises, and a missing guard would
    // insert it here (and hold the slot, starving C and D).
    expect(taskLog).toEqual(["B", "C"])
    expect(attempts.length).toBe(2)

    // C finishes; D is admitted, so the released slot was given to the queue exactly once.
    children[1].resolve(completedReport())
    await settleWithin(supervisor, c.consultId)
    await settleMicrotasks()
    expect(taskLog).toEqual(["B", "C", "D"])
    expect(supervisor.list().find((entry) => entry.consultId === a.consultId)?.state).toBe("interrupted")
    expect(supervisor.list().find((entry) => entry.consultId === d.consultId)?.state).toBe("running")
  })
})

describe("a malformed MPD_DSH_CONSULT_MAX (§6.2, F4)", () => {
  test("an unusable env value falls back to the default 8, or to the request when one is present — never a throw, never unbounded", () => {
    for (const raw of ["abc", "", "0", "-3", "NaN", "Infinity"]) {
      // Every one is "not declared": the reader answers undefined and the defaulted reader answers 8.
      process.env[ENV_KEY] = raw
      expect(consultMaxDeclaredFromEnv()).toBeUndefined()
      expect(consultMaxFromEnv()).toBe(CONSULT_MAX_DEFAULT)
    }
    // With no usable declared value the per-start request applies; without one the shipped default does.
    process.env[ENV_KEY] = "nonsense"
    /** A supervisor wired exactly as the row wires it: the DECLARED env is the hard cap. */
    const { supervisor } = compose(() => {
      /** A child that stays running: this arm only reads the budget. */
      const settled = deferred()
      return { id: "child", result: settled.promise, interrupt: () => undefined }
    }, { declaredMax: () => consultMaxDeclaredFromEnv() })
    expect(supervisor.effectiveBudgetOf(originalBudgetRequest)).toBe(originalBudgetRequest)
    expect(supervisor.effectiveBudgetOf(undefined)).toBe(CONSULT_MAX_DEFAULT)
  })
})
