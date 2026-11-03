// CELLWORK SPLIT — the NON-FATAL empty-write-scope warning (D3, C4).
//
// WHY THIS FILE EXISTS (VEdit P0, lane A): a split task with no `writeScopes` produced a frozen contract
// whose "Allowed write scopes" section said `(none declared — this task produces no code)` and NOTHING
// else. A writer then stopped on its first edit — the worst case being a `repair` row, whose whole job is
// an edit — and the splitter had no signal that its omission froze a contract allowing no path (VEdit
// memory `write-scopes-mvzhudek.md`).
//
// THE RULE THIS PINS: the warning is NON-FATAL. The split is still accepted, the task is still
// materialisable, and the warning list is EXCLUDED from the `accepted` predicate — it refuses to stay
// SILENT, it does not refuse the task.
import { test, expect } from "bun:test"
import { mkdtempSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { submitSplit, type SplitSubmission, type SplitTaskInput, type SplitVerdict } from "../src/split.ts"
import { buildContractDoc } from "../src/activate.ts"
import { newCellState } from "../src/state.ts"
import { DEFAULT_CELLWORK_CONFIG } from "../src/config.ts"
import type { WindowReading } from "../src/budget.ts"

/** The cell id every arm uses; only the workspace differs per arm. */
const CELL_ID = "cell-split-warnings"

/** The roster the graphs are validated against. */
const ROSTER: readonly string[] = ["Senior Engineer", "Deep Worker", "Reviewer", "Lead", "Junior Engineer"]

/** A CERTIFIED window large enough that a small task passes the 1/4 rule (never a guessed number). */
const CERTIFIED_WINDOW: WindowReading = { provider: "test", model: "test-model", window: 1000000, provenance: "catalog", maxOutputTokens: 8192 }

/**
 * Submit one graph through the production writer.
 *
 * @param tasks - the graph to measure and validate.
 * @returns the persisted verdict.
 */
async function submit(tasks: readonly SplitTaskInput[]): Promise<SplitVerdict> {
  /** A fresh temp workspace root for this arm. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-split-warn-"))
  /** The submission a splitter would have sent. */
  const submission: SplitSubmission = { revision: 1, tasks }
  return submitSplit({
    workspace,
    cellId: CELL_ID,
    config: DEFAULT_CELLWORK_CONFIG,
    roster: ROSTER,
    window: async (): Promise<WindowReading> => CERTIFIED_WINDOW,
    now: new Date("2026-11-03T00:00:00.000Z"),
  }, submission)
}

/** One task shape with the fields every arm sets, so each arm only declares its difference. */
interface TaskShape {
  /** The task key. */
  key: string
  /** The chain kind. */
  kind: string
  /** The owner role. */
  ownerRole: string
  /** The declared write scopes. */
  writeScopes: readonly string[]
  /** The declared blockers. */
  blockedBy: readonly string[]
}

/**
 * Normalise one task shape into the submission input.
 *
 * @param shape - the declared task.
 * @returns the submission row.
 */
function task(shape: TaskShape): SplitTaskInput {
  return {
    key: shape.key,
    subject: "Do " + shape.key,
    description: "Change one small thing.",
    kind: shape.kind,
    ownerRole: shape.ownerRole,
    writeScopes: [...shape.writeScopes],
    blockedBy: [...shape.blockedBy],
    independent: false,
    inputs: [],
    verify: shape.kind === "work",
  }
}

test("D3/C4: a work task with NO write scope warns by key, and the split is still ACCEPTED", async () => {
  /** The graph: one `work` task that declares no path, plus its review. */
  const verdict = await submit([
    task({ key: "work-a", kind: "work", ownerRole: "Senior Engineer", writeScopes: [], blockedBy: [] }),
    task({ key: "review-a", kind: "review", ownerRole: "Reviewer", writeScopes: ["docs/a.md"], blockedBy: ["work-a"] }),
  ])
  // NON-FATAL (C4): the omission is a warning, never a refusal.
  expect(verdict.accepted).toBe(true)
  expect(verdict.findings).toEqual([])
  expect(verdict.warnings.length).toBe(1)
  expect(verdict.warnings[0].taskKey).toBe("work-a")
  expect(verdict.warnings[0].code).toBe("write-scopes-empty")
  // The consequence AND the remedy are both named, or a reader cannot act on it.
  expect(verdict.warnings[0].detail).toContain("no path")
  expect(verdict.warnings[0].detail).toContain("scope")
  expect(verdict.totals.acceptedCount).toBe(2)
  // The warning is EXCLUDED from the acceptance predicate: a task that declares no path still counts.
  expect(verdict.totals.refusedCount).toBe(0)
})

test("D3/C4: `repair` and `integration` tasks are covered too, and a `review` task with no scope is not", async () => {
  /** The graph: a repair with no path, an integration with no path, and a review that writes nothing. */
  const verdict = await submit([
    task({ key: "fix-a", kind: "repair", ownerRole: "Junior Engineer", writeScopes: [], blockedBy: [] }),
    task({ key: "ship", kind: "integration", ownerRole: "Lead", writeScopes: [], blockedBy: ["fix-a"] }),
    task({ key: "plain-review", kind: "review", ownerRole: "Reviewer", writeScopes: [], blockedBy: ["fix-a"] }),
  ])
  expect(verdict.accepted).toBe(true)
  expect(verdict.warnings.map((warning) => warning.taskKey).sort()).toEqual(["fix-a", "ship"])
  expect(verdict.warnings.every((warning) => warning.code === "write-scopes-empty")).toBe(true)
})

test("C4: a graph with every scope declared carries NO warning, so the channel cannot become noise", async () => {
  /** The fully-scoped graph. */
  const verdict = await submit([
    task({ key: "work-a", kind: "work", ownerRole: "Senior Engineer", writeScopes: ["src/a.ts"], blockedBy: [] }),
    task({ key: "review-a", kind: "review", ownerRole: "Reviewer", writeScopes: ["docs/a.md"], blockedBy: ["work-a"] }),
  ])
  expect(verdict.accepted).toBe(true)
  expect(verdict.warnings).toEqual([])
})

test("D3/C4: the frozen contract's no-scope line carries the recovery, not just the fact", async () => {
  /** The graph carrying one scope-less work task. */
  const verdict = await submit([
    task({ key: "work-a", kind: "work", ownerRole: "Senior Engineer", writeScopes: [], blockedBy: [] }),
    task({ key: "review-a", kind: "review", ownerRole: "Reviewer", writeScopes: ["docs/a.md"], blockedBy: ["work-a"] }),
  ])
  /** The cell the contract is built for. */
  const cell = newCellState({ cellId: CELL_ID, objective: "ship the widget", captainSessionId: "session-captain", now: new Date("2026-11-03T00:00:00.000Z") })
  /** The frozen contract document for the scope-less task. */
  const doc = buildContractDoc({ cell, config: DEFAULT_CELLWORK_CONFIG, split: verdict }, verdict.tasks[0], verdict.tasks[1], "T1")
  expect(doc).toContain("(none declared")
  // THE RECOVERY: the writer must be told what to DO before its first write, not only what is missing.
  expect(doc).toContain("captain")
  expect(doc).toContain("BEFORE the first write")
})
