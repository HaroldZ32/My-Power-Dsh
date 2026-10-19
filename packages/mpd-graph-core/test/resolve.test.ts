// PLAN-FILE RESOLUTION: beacon first, newest fallback, none.
//
// The order is the contract the README states, because two consumers resolving two different files
// is exactly the split this package exists to prevent. The beacon is the ACTIVE boulder work only:
// a completed work's plan is history, and a resolver that followed it would pin the live view to a
// finished wave.
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { readPlanFile, resolvePlanFile } from "../src/resolve.ts"

/** This test file's own directory, which is inside the workspace the file sandbox allows. */
const TEST_DIR = dirname(fileURLToPath(import.meta.url))

/**
 * Run one case inside a fresh temporary workspace and remove it afterwards.
 * @param run - the case body, given the absolute workspace root.
 */
function withWorkspace(run: (root: string) => void): void {
  /** The temporary workspace root. */
  const root = mkdtempSync(join(TEST_DIR, ".tmp-"))
  try {
    run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

/**
 * Create a directory path inside a workspace.
 * @param root - the workspace root.
 * @param path - the directory path, relative to the root.
 */
function makeDir(root: string, path: string): void {
  mkdirSync(join(root, path), { recursive: true })
}

/**
 * Write a file inside a workspace, creating its parent directories.
 * @param root - the workspace root.
 * @param path - the file path, relative to the root.
 * @param text - the file's content.
 */
function writeFile(root: string, path: string, text: string): void {
  makeDir(root, dirname(path))
  writeFileSync(join(root, path), text)
}

/**
 * Write the boulder ledger inside a workspace.
 * @param root - the workspace root.
 * @param state - the ledger value.
 */
function writeLedger(root: string, state: unknown): void {
  writeFile(root, ".mpd/boulder.json", JSON.stringify(state))
}

/**
 * Pin a file's modification time, so "newest" is a fact rather than a race.
 * @param root - the workspace root.
 * @param path - the file path, relative to the root.
 * @param seconds - the modification time in epoch seconds.
 */
function setMtime(root: string, path: string, seconds: number): void {
  utimesSync(join(root, path), seconds, seconds)
}

describe("the resolution order", () => {
  test("the active boulder work's plan wins over a newer file", () => {
    withWorkspace((root) => {
      writeFile(root, ".mpd/plans/active.md", "## TODOs\n\n1. the beacon.\n")
      writeFile(root, ".mpd/plans/newer.md", "## TODOs\n\n1. the newer plan.\n")
      setMtime(root, ".mpd/plans/active.md", 1_000)
      setMtime(root, ".mpd/plans/newer.md", 2_000)
      writeLedger(root, { active_work_id: "w1", works: { w1: { status: "active", active_plan: ".mpd/plans/active.md" } } })
      expect(resolvePlanFile(root)?.endsWith("active.md")).toBe(true)
    })
  })

  test("a terminal work is not a beacon: the newest plan wins", () => {
    withWorkspace((root) => {
      writeFile(root, ".mpd/plans/old.md", "## TODOs\n\n1. old.\n")
      writeFile(root, ".mpd/plans/new.md", "## TODOs\n\n1. new.\n")
      setMtime(root, ".mpd/plans/old.md", 1_000)
      setMtime(root, ".mpd/plans/new.md", 2_000)
      writeLedger(root, { active_work_id: "w1", works: { w1: { status: "completed", active_plan: ".mpd/plans/old.md" } } })
      expect(resolvePlanFile(root)?.endsWith("new.md")).toBe(true)
    })
  })

  test("a beacon whose file is gone falls through to the newest plan", () => {
    withWorkspace((root) => {
      writeFile(root, ".mpd/plans/present.md", "## TODOs\n\n1. present.\n")
      writeLedger(root, { active_work_id: "w1", works: { w1: { status: "active", active_plan: ".mpd/plans/gone.md" } } })
      expect(resolvePlanFile(root)?.endsWith("present.md")).toBe(true)
    })
  })

  test("an absolute beacon path is taken as written", () => {
    withWorkspace((root) => {
      writeFile(root, "elsewhere/plan.md", "## TODOs\n\n1. absolute.\n")
      writeLedger(root, { active_work_id: "w1", works: { w1: { status: "active", active_plan: join(root, "elsewhere/plan.md") } } })
      expect(resolvePlanFile(root)).toBe(join(root, "elsewhere/plan.md"))
    })
  })

  test("an unreadable ledger is not an error: the newest plan wins", () => {
    withWorkspace((root) => {
      writeFile(root, ".mpd/plans/only.md", "## TODOs\n\n1. only.\n")
      writeFile(root, ".mpd/boulder.json", "{ not json")
      expect(resolvePlanFile(root)?.endsWith("only.md")).toBe(true)
    })
  })

  test("the newest plan is chosen by mtime, then by name on a tie", () => {
    withWorkspace((root) => {
      writeFile(root, ".mpd/plans/b.md", "## TODOs\n\n1. b.\n")
      writeFile(root, ".mpd/plans/a.md", "## TODOs\n\n1. a.\n")
      setMtime(root, ".mpd/plans/a.md", 1_000)
      setMtime(root, ".mpd/plans/b.md", 1_000)
      expect(resolvePlanFile(root)?.endsWith("a.md")).toBe(true)
    })
  })

  test("a zh-CN twin is never mistaken for a plan", () => {
    withWorkspace((root) => {
      writeFile(root, ".mpd/plans/real.md", "## TODOs\n\n1. real.\n")
      writeFile(root, ".mpd/plans/real.zh-CN.md", "## TODOs\n\n1. 真正的。\n")
      setMtime(root, ".mpd/plans/real.md", 1_000)
      setMtime(root, ".mpd/plans/real.zh-CN.md", 9_000)
      expect(resolvePlanFile(root)?.endsWith("real.md")).toBe(true)
    })
  })

  test("a workspace with no plans directory resolves to nothing", () => {
    withWorkspace((root) => {
      expect(resolvePlanFile(root)).toBeUndefined()
    })
  })
})

describe("readPlanFile", () => {
  test("an undefined path is an empty plan with no problem", () => {
    expect(readPlanFile(undefined)).toEqual({ tasks: [], lanes: [], problems: [] })
  })

  test("an unreadable path is one reported problem, never a throw", () => {
    withWorkspace((root) => {
      /** The document for a file that does not exist. */
      const plan = readPlanFile(join(root, "missing.md"))
      expect(plan.tasks).toEqual([])
      expect(plan.problems.length).toBe(1)
      expect(plan.problems[0]?.line).toBe(0)
    })
  })

  test("a readable path is parsed like the text parser", () => {
    withWorkspace((root) => {
      writeFile(root, ".mpd/plans/read.md", "## TODOs\n\n1. read me.\n")
      /** The parsed document. */
      const plan = readPlanFile(join(root, ".mpd/plans/read.md"))
      expect(plan.tasks.map((task) => task.id)).toEqual(["T1"])
      expect(plan.problems).toEqual([])
    })
  })
})
