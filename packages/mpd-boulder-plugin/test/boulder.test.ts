import { test, expect } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { existsSync } from "node:fs"
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

// ── THE STATE ROOT (D4 defect, measured live 2026-10-06) ─────────────────────
// `mpd_boulder_*` reads and writes `<root>/.mpd/boulder.json`, where `root` is the session workspace
// unless `boulder.dir` overrides it. The knob's retired schema default resolved to `.mpd` in every
// real boot, and that value was taken as a ROOT — so the ledger landed at
// `<ws>/.mpd/.mpd/boulder.json`. Consistently wrong is why the unit arms stayed green while signal D
// (the session gate's "an ACTIVE boulder work exists") could never fire. These arms pin the PATH.
test("mpd_boulder_start writes the ledger at the CONTRACT path <ws>/.mpd/boulder.json", async () => {
  // The sandbox workspace this arm's adapter resolves, restored whatever the assertions do.
  const prev = process.env.DSH_WORKSPACE_ROOT
  /** The workspace the tool resolves through the adapter's workspaceRoot(). */
  const ws = mkdtempSync(join(tmpdir(), "mpd-bl-root-"))
  process.env.DSH_WORKSPACE_ROOT = ws
  try {
    /** The registered tools, with NO mpdConfig service mounted: the knob is genuinely unset. */
    const tools: any[] = []
    apply({ tools: { register: (t: any) => tools.push(t) } } as any, {})
    /** The start tool, whose `stateFile` names the root it actually used. */
    const start = tools.find((t: any) => t.name === "mpd_boulder_start")
    /** The plan the work is bound to; the tool only records the path, so it need not exist. */
    const planPath = join(ws, ".mpd", "plans", "p.md")
    /** The start call's answer, whose `stateFile` names the root it actually used. */
    const started = await start.execute({ planPath })
    // THE CONTRACT PATH, and the file is really there: a `stateFile` that merely LOOKS right while
    // the bytes went elsewhere would keep the defect invisible.
    expect(started.stateFile).toBe(join(ws, ".mpd", "boulder.json"))
    expect(started.stateFile).not.toContain(join(".mpd", ".mpd"))
    expect(existsSync(join(ws, ".mpd", "boulder.json"))).toBe(true)
    expect(existsSync(join(ws, ".mpd", ".mpd", "boulder.json"))).toBe(false)
    // The tool that READS the ledger agrees, which is the half a write-only assertion would miss.
    /** The status tool, reading the ledger back through the same root resolution. */
    const status = tools.find((t: any) => t.name === "mpd_boulder_status")
    /** The status call's answer, read back through the same root resolution. */
    const read = await status.execute({})
    expect(read.stateFile).toBe(join(ws, ".mpd", "boulder.json"))
    // The READ agrees with the write: the ledger the start call wrote is the one status sees.
    expect(read.activeWorks.length).toBe(1)
    expect(read.state?.status).toBe("active")
  } finally {
    if (prev === undefined) delete process.env.DSH_WORKSPACE_ROOT; else process.env.DSH_WORKSPACE_ROOT = prev
  }
})

test("the LEGACY `.mpd` knob value still lands on the contract path, and a real path still overrides", async () => {
  // The two halves of the shared normalization: the retired default is NOT a root (it would double
  // the path), while a path a user actually means keeps overriding.
  const prev = process.env.DSH_WORKSPACE_ROOT
  /** The workspace the tool resolves when no override applies. */
  const ws = mkdtempSync(join(tmpdir(), "mpd-bl-norm-"))
  process.env.DSH_WORKSPACE_ROOT = ws
  try {
    for (const [label, value, expected] of [
      ["the retired default", ".mpd", join(ws, ".mpd", "boulder.json")],
      ["the `./.mpd/` spelling", "./.mpd/", join(ws, ".mpd", "boulder.json")],
      ["the workspace itself", ".", join(ws, ".mpd", "boulder.json")],
      ["an explicit root", "/srv/boulder-state", join("/srv/boulder-state", ".mpd", "boulder.json")],
    ] as Array<[string, string, string]>) {
      /** The registered tools for this knob value. */
      const tools: any[] = []
      // The config service a real boot mounts; its answer is the ONLY source of the override here.
      const mpdConfig = { get: (key: string) => (key === "boulder.dir" ? value : undefined) }
      apply({ tools: { register: (t: any) => tools.push(t) }, get: (name: string) => (name === "mpdConfig" ? mpdConfig : undefined) } as any, {})
      /** The status tool, whose `stateFile` is the resolve of this knob value. */
      const status = await tools.find((t: any) => t.name === "mpd_boulder_status").execute({})
      expect(status.stateFile, label).toBe(expected)
      expect(status.stateFile, label).not.toContain(join(".mpd", ".mpd"))
    }
  } finally {
    if (prev === undefined) delete process.env.DSH_WORKSPACE_ROOT; else process.env.DSH_WORKSPACE_ROOT = prev
  }
})
