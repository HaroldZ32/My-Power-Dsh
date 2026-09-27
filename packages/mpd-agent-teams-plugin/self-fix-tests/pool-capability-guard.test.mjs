// The pool-capability guard: a pooled task a member cannot EXECUTE is left in the
// pool for a member that can, and the withholding is loud.
//
// DEFECT (measured 2026-09-14, twice): read-only members received pooled
// implementation tasks, because the pool branch of the selection had no capability
// test at all — `nextReadyTask` returns the first ready unassigned task. The fix is
// region-registered adopted-code change (`mpd-delta pool-capability-guard` +
// `mpd-delta pool-capability-select`), so this file pins BOTH the behaviour and the
// registration invariants (nothing unmarked, and a re-materialize is REFUSED loudly
// instead of silently resurrecting the defect).
import { expect, test } from "bun:test"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { MPD_DELTAS } from "../lib/mpd-deltas.js"
import { codeOf } from "./lib-absence.mjs"
import { applyAgentTeamsFixes } from "../../../scripts/patch-agent-teams-fixes.mjs"
import * as scheduler from "../lib/scheduler.js"
import { stageScript } from "./scratch-scripts.mjs"

// Namespace import on purpose: the fix may be ABSENT (pre-fix tree, or a re-materialize
// that dropped the region), and each test below must then fail on its own behaviour
// instead of the whole file failing to LINK.
const nextCapableTask = scheduler.nextCapableTask

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const repoRoot = join(pluginRoot, "..", "..")
const SCHEDULER = join(pluginRoot, "lib", "scheduler.js")

/** The roster's read-only restriction, verbatim from the profile data. */
const READONLY_DENY = ["write", "edit", "mpd_hashline_edit", "bash", "mcp__ast_grep__rewrite", "mcp__ast_grep__scan", "mcp__lsp__rename"]

const implementationTask = (id) => ({
  id,
  subject: `implement ${id}`,
  kind: "implementation",
  status: "pending",
  dependencies: [],
  inScope: ["packages/thing/src/index.ts"],
  verify: ["./verify.sh"],
})
const reviewTask = (id) => ({
  id,
  subject: `review ${id}`,
  kind: "review",
  status: "pending",
  dependencies: [],
  reviewedTaskId: "t1",
  acceptance: ["verdict recorded"],
})
const readOnly = (name) => ({ name, toolDeny: READONLY_DENY })
const writer = (name) => ({ name, toolDeny: [] })

test("a pooled write task is LEFT IN THE POOL for a read-only member and reported", () => {
  const tasks = [implementationTask("t1"), reviewTask("t2")]
  const withheld = []
  const picked = nextCapableTask(tasks, readOnly("Architect"), (task, gap, explicit) => withheld.push({ id: task.id, gap, explicit }))

  // The review task is the one it can execute; the implementation task stays pooled.
  expect(picked?.id).toBe("t2")
  expect(withheld).toEqual([{ id: "t1", gap: ["write", "edit", "mpd_hashline_edit", "bash"], explicit: false }])
})

test("a write-capable member still gets the pooled write task (the guard is not a blanket refusal)", () => {
  const tasks = [implementationTask("t1"), reviewTask("t2")]
  const withheld = []
  const picked = nextCapableTask(tasks, writer("Senior Engineer"), (task, gap, explicit) => withheld.push({ id: task.id, gap, explicit }))
  expect(picked?.id).toBe("t1")
  expect(withheld).toEqual([])
})

test("a member whose deny blocks nothing relevant is unaffected by an unrelated deny entry", () => {
  const tasks = [implementationTask("t1")]
  const partial = { name: "Vision Analyst", toolDeny: ["mcp__lsp__rename"] }
  expect(nextCapableTask(tasks, partial, () => {})?.id).toBe("t1")
})

test("an EXPLICIT assignment is still dispatched to a restricted member, and says so", () => {
  // The captain's explicit pairing is the captain's decision: refusing it silently
  // would stall the DAG. It is dispatched, with a note that names the restriction.
  const tasks = [{ ...implementationTask("t1"), assignee: "Architect" }]
  const withheld = []
  const picked = nextCapableTask(tasks, readOnly("Architect"), (task, gap, explicit) => withheld.push({ id: task.id, gap, explicit }))
  expect(picked?.id).toBe("t1")
  expect(withheld).toEqual([{ id: "t1", gap: ["write", "edit", "mpd_hashline_edit", "bash"], explicit: true }])
})

test("a member's own ready task outranks a pooled task it could also run", () => {
  const tasks = [{ ...reviewTask("t1"), assignee: "Architect" }, reviewTask("t2"), implementationTask("t3")]
  const picked = nextCapableTask(tasks, readOnly("Architect"), () => {})
  expect(picked?.id).toBe("t1")
})

test("nothing executable is left: undefined, and every withheld candidate is reported", () => {
  const tasks = [implementationTask("t1"), implementationTask("t2")]
  const withheld = []
  const picked = nextCapableTask(tasks, readOnly("Architect"), (task, gap, explicit) => withheld.push({ id: task.id, explicit }))
  expect(picked).toBeUndefined()
  expect(withheld.map((entry) => entry.id)).toEqual(["t1", "t2"])
})

test("the guard is region-registered and its replacement is REFUSED after a re-materialize", () => {
  const source = readFileSync(SCHEDULER, "utf8")
  // (1) Nothing unmarked: every introduced symbol lives inside a delta region.
  const stripped = source.replace(/\/\/#region mpd-delta [\s\S]*?\/\/#endregion mpd-delta [A-Za-z0-9-]+/g, "")
  for (const token of ["nextCapableTask", "taskCapabilityGap", "taskCapabilityNeed", "pool-capability"])
    expect(stripped).not.toContain(token)
  // (2) The replacement is registered where the seam is.
  const ids = MPD_DELTAS.filter((delta) => delta.file.endsWith("scheduler.js")).map((delta) => delta.id)
  expect(ids).toContain("mpd-delta pool-capability-guard")
  expect(ids).toContain("mpd-delta pool-capability-select")

  // (3) A re-materialize that restores the upstream call site REFUSES loudly (the
  // replacement-shaped class: the seam's context pair no longer brackets an empty gap).
  const root = mkdtempSync(join(tmpdir(), "mpd-pool-cap-"))
  try {
    const libDir = join(root, "packages", "mpd-agent-teams-plugin", "lib")
    mkdirSync(libDir, { recursive: true })
    mkdirSync(join(root, "scripts"), { recursive: true })
    for (const name of [...new Set(MPD_DELTAS.map((delta) => delta.file.split("/").pop()))])
      cpSync(join(pluginRoot, "lib", name), join(libDir, name))
    stageScript(root, "patch-agent-teams-fixes.mjs")
    const target = join(libDir, "scheduler.js")
    // Simulate the re-materialize: the upstream selection comes back, our region is gone.
    const materialized = readFileSync(target, "utf8").replace(
      /[ ]*\/\/#region mpd-delta pool-capability-select[\s\S]*?\/\/#endregion mpd-delta pool-capability-select\n/,
      "                    const task = recoverOwned ? owned : owned === undefined\n                        ? nextReadyTask(fresh.tasks, currentMember.name)\n                        : undefined;\n")
    // T-92 (t43): the absence is a statement about the REGION, so it is asserted against the
    // comment-stripped text — a comment naming the region id must not redden it.
    expect(codeOf(materialized)).not.toContain("mpd-delta pool-capability-select")
    writeFileSync(target, materialized)
    expect(() => applyAgentTeamsFixes({ root, write: true })).toThrow(/pool-capability-select/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
