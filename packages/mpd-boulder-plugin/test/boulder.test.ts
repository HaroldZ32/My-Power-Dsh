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
  const dir = mkdtempSync(join(tmpdir(), "mpd-boulder-"))
  const plans = join(dir, ".mpd", "plans")
  mkdirSync(plans, { recursive: true })
  const planPath = join(plans, "qa.md")
  writeFileSync(planPath, "# QA\n\n## TODOs\n- [ ] 1. First\n- [x] 2. Second\n\n## Final Verification Wave\n- [ ] F1. Final\n")
  const state = createBoulderState(planPath, "session-1", "mpd-oracle")
  expect(writeBoulderState(dir, state)).toBe(true)
  expect(getActiveWorks(dir).length).toBe(1)
  const workId = state.active_work_id!
  expect(startTaskTimer(dir, workId, { taskKey: "1", taskLabel: "1", taskTitle: "First", sessionId: "session-1" })).toBeTruthy()
  expect(endTaskTimer(dir, workId, "1")).toBeTruthy()
  const after = getWorkById(dir, workId)!
  expect(after.task_sessions?.["1"]?.status).toBe("completed")
  expect(after.task_sessions?.["1"]?.elapsed_ms).toBeGreaterThanOrEqual(0)
  const done = completeBoulder(dir, workId)!
  expect(done.works?.[workId]?.status).toBe("completed")
  const re = readBoulderState(dir)!
  expect(re.works?.[workId]?.ended_at).toBeTruthy()
})

test("plan progress parses TODOs and verification wave", () => {
  const dir = mkdtempSync(join(tmpdir(), "mpd-boulder-p-"))
  const plans = join(dir, ".mpd", "plans")
  mkdirSync(plans, { recursive: true })
  const planPath = join(plans, "p.md")
  writeFileSync(planPath, "# P\n\n## TODOs\n- [ ] 1. A\n- [x] 2. B\n\n## Final Verification Wave\n- [ ] F1. C\n")
  const p = getPlanProgress(planPath)
  expect(p).toEqual({ total: 3, completed: 1, isComplete: false })
  const checklist = getPlanChecklist(planPath)
  expect(checklist).toEqual({ completed: 1, remaining: 2, total: 3, nextTaskLabel: "1. A" })
})

test("mpd_boulder_status omits planProgress when null (lossless JSON contract)", async () => {
  const prev = process.env.DSH_WORKSPACE_ROOT
  process.env.DSH_WORKSPACE_ROOT = mkdtempSync(join(tmpdir(), "mpd-bl-ws-"))
  try {
    const tools: any[] = []
    apply({ tools: { register: (t: any) => tools.push(t) } } as any, {})
    const st = tools.find((t: any) => t.name === "mpd_boulder_status")
    const noPlan = await st.execute({})
    // schema declares planProgress as `type: object` and not required: a present
    // null fails the host validator, so it must be omitted instead
    expect(noPlan.planProgress).toBeUndefined()
    expect(JSON.parse(JSON.stringify(noPlan))).toEqual(noPlan)
    expect(Object.values(noPlan)).not.toContain(undefined)
    const withPlan = await st.execute({ planPath: "/nonexistent/plan.md" })
    expect(JSON.parse(JSON.stringify(withPlan))).toEqual(withPlan)
    expect(withPlan.planProgress).toEqual({ total: 0, completed: 0, isComplete: false })
    expect(typeof withPlan.planProgress).toBe("object")
  } finally {
    if (prev === undefined) delete process.env.DSH_WORKSPACE_ROOT; else process.env.DSH_WORKSPACE_ROOT = prev
  }
})
