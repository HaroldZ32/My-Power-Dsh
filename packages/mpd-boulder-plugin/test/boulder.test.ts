import { test, expect } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  normalizeSessionId,
  createBoulderState,
  writeBoulderState,
  readBoulderState,
  getActiveWorks,
  startTaskTimer,
  endTaskTimer,
  completeBoulder,
  getWorkById,
  getPlanProgress,
  getPlanChecklist,
} from "../src/vendor/index.ts"
import { apply } from "../src/index.ts"

test("session ids are dsh-prefixed by default", () => {
  expect(normalizeSessionId("session-1")).toBe("dsh:session-1")
  expect(normalizeSessionId("senpi:x")).toBe("senpi:x")
})

test("start, timer, complete lifecycle", () => {
  // Throwaway workspace root: the ledger is created under `<dir>/.mpd`.
  const dir = mkdtempSync(join(tmpdir(), "mpd-boulder-"))
  // Plan directory the parser is pointed at; it must exist before the plan file is written.
  const plans = join(dir, ".mpd", "plans")
  mkdirSync(plans, { recursive: true })
  // Plan carrying one TODO and one final-wave item, the two checkbox grammars the parser recognizes.
  const planPath = join(plans, "qa.md")
  writeFileSync(planPath, "# QA\n\n## TODOs\n- [ ] 1. First\n- [x] 2. Second\n\n## Final Verification Wave\n- [ ] F1. Final\n")
  // Fresh in-memory ledger for that plan; persisted on the next line.
  const state = createBoulderState(planPath, "session-1", "mpd-oracle")
  expect(writeBoulderState(dir, state)).toBe(true)
  expect(getActiveWorks(dir).length).toBe(1)
  // Id the persisted ledger exposes; the assertion mirrors createBoulderState always setting the mirror.
  const workId = state.active_work_id!
  expect(startTaskTimer(dir, workId, { taskKey: "1", taskLabel: "1", taskTitle: "First", sessionId: "session-1" })).toBeTruthy()
  expect(endTaskTimer(dir, workId, "1")).toBeTruthy()
  // Work re-read from disk, so the timer assertions cover persistence and not just the return value.
  const after = getWorkById(dir, workId)!
  expect(after.task_sessions?.["1"]?.status).toBe("completed")
  expect(after.task_sessions?.["1"]?.elapsed_ms).toBeGreaterThanOrEqual(0)
  // Ledger after completion, the mirror the final assertion reads back.
  const done = completeBoulder(dir, workId)!
  expect(done.works?.[workId]?.status).toBe("completed")
  // Ledger re-read from disk: `ended_at` must have been persisted, not merely returned.
  const re = readBoulderState(dir)!
  expect(re.works?.[workId]?.ended_at).toBeTruthy()
})

test("plan progress parses TODOs and verification wave", () => {
  // Throwaway workspace root holding this test's plan file.
  const dir = mkdtempSync(join(tmpdir(), "mpd-boulder-p-"))
  // Plan directory under that root, created before the plan is written.
  const plans = join(dir, ".mpd", "plans")
  mkdirSync(plans, { recursive: true })
  // Plan with two TODOs (one ticked) and one unticked final-wave item.
  const planPath = join(plans, "p.md")
  writeFileSync(planPath, "# P\n\n## TODOs\n- [ ] 1. A\n- [x] 2. B\n\n## Final Verification Wave\n- [ ] F1. C\n")
  // Counts view: three recognized items, one ticked, so the plan is not yet complete.
  const p = getPlanProgress(planPath)
  expect(p).toEqual({ total: 3, completed: 1, isComplete: false })
  // Checklist view, which additionally names the first unticked item.
  const checklist = getPlanChecklist(planPath)
  expect(checklist).toEqual({ completed: 1, remaining: 2, total: 3, nextTaskLabel: "1. A" })
})

test("mpd_boulder_status omits planProgress when null (lossless JSON contract)", async () => {
  // Saved so the sandbox workspace root is restored after the test, whatever it asserted.
  const prev = process.env.DSH_WORKSPACE_ROOT
  process.env.DSH_WORKSPACE_ROOT = mkdtempSync(join(tmpdir(), "mpd-bl-ws-"))
  try {
    // Capture array standing in for the harness tool registry.
    const tools: any[] = []
    apply({ tools: { register: (t: any) => tools.push(t) } } as any, {})
    // The status tool as the fake registry received it.
    const st = tools.find((t: any) => t.name === "mpd_boulder_status")
    // Call without planPath: the response must OMIT planProgress rather than carry a null.
    const noPlan = await st.execute({})
    // schema declares planProgress as `type: object` and not required: a present
    // null fails the host validator, so it must be omitted instead
    expect(noPlan.planProgress).toBeUndefined()
    expect(JSON.parse(JSON.stringify(noPlan))).toEqual(noPlan)
    expect(Object.values(noPlan)).not.toContain(undefined)
    // Call with an unreadable plan path: the parser reports zero counts instead of throwing.
    const withPlan = await st.execute({ planPath: "/nonexistent/plan.md" })
    expect(JSON.parse(JSON.stringify(withPlan))).toEqual(withPlan)
    expect(withPlan.planProgress).toEqual({ total: 0, completed: 0, isComplete: false })
    expect(typeof withPlan.planProgress).toBe("object")
  } finally {
    if (prev === undefined) delete process.env.DSH_WORKSPACE_ROOT; else process.env.DSH_WORKSPACE_ROOT = prev
  }
})
