// THE WATCHER: one debounce, a real filesystem event, a manual resync and an observable counter.
//
// The arms are small on purpose: a missing file, a rename-and-replace, two creates inside one window
// (which must arrive as ONE batch whose counter says 2), a listener that throws, and the manual
// `poll()` path. `poll()` is what makes the missing-directory arm deterministic — the platform event
// is exercised separately, where its timing is part of the subject.
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import type { GraphChangeEvent, GraphWatcher } from "../src/watch.ts"
import { watchGraph } from "../src/watch.ts"

/** This test file's own directory, which is inside the workspace the file sandbox allows. */
const TEST_DIR = dirname(fileURLToPath(import.meta.url))

/**
 * Run one case inside a fresh temporary workspace and remove it afterwards.
 * @param run - the case body, given the absolute workspace root.
 * @returns a promise settled when the case and the cleanup are done.
 */
async function withWorkspace(run: (root: string) => Promise<void>): Promise<void> {
  /** The temporary workspace root. */
  const root = mkdtempSync(join(TEST_DIR, ".tmp-"))
  try {
    await run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

/**
 * Resolve with the watcher's next batch, or reject when none arrives in time.
 * @param watcher - the watcher to listen to.
 * @param ms - how long to wait before failing instead of hanging the suite.
 * @returns the delivered batch.
 */
function nextEvent(watcher: GraphWatcher, ms: number = 5000): Promise<GraphChangeEvent> {
  return new Promise<GraphChangeEvent>((resolve, reject) => {
    /** The subscription, dropped as soon as the batch or the timeout arrives. */
    const unsubscribe: () => void = watcher.subscribe((event) => {
      clearTimeout(timer)
      unsubscribe()
      resolve(event)
    })
    /** The timeout that turns silence into a failure. */
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      unsubscribe()
      reject(new Error("no batch within " + ms + "ms"))
    }, ms)
  })
}

describe("survival", () => {
  test("a plan file that does not exist yet can be watched, and its creation is delivered", async () => {
    await withWorkspace(async (root) => {
      /** The plan file, which does not exist when the watcher starts. */
      const planFile = join(root, "plan.md")
      /** The watcher under test. */
      const watcher = watchGraph({ planFile }, { debounceMs: 20 })
      try {
        expect(watcher.watching).toBe(true)
        writeFileSync(planFile, "## TODOs\n\n1. one.\n")
        /** The batch the creation produced. */
        const event = await nextEvent(watcher)
        expect(event.manual).toBe(false)
        expect(event.paths).toEqual([planFile])
      } finally {
        watcher.close()
      }
    })
  })

  test("a rename-and-replace is delivered as a change of the same target", async () => {
    await withWorkspace(async (root) => {
      /** The plan file the watcher follows. */
      const planFile = join(root, "plan.md")
      writeFileSync(planFile, "## TODOs\n\n1. one.\n")
      /** The watcher under test. */
      const watcher = watchGraph({ planFile }, { debounceMs: 20 })
      try {
        writeFileSync(planFile, "## TODOs\n\n1. one, edited.\n")
        /** The first batch, which tells us the watcher sees the file before the rename. */
        const first = await nextEvent(watcher)
        expect(first.paths).toEqual([planFile])
        renameSync(planFile, planFile + ".bak")
        writeFileSync(planFile, "## TODOs\n\n1. replaced.\n")
        /** The batch the replacement produced. */
        const second = await nextEvent(watcher)
        expect(second.paths).toEqual([planFile])
        expect(second.sequence).toBeGreaterThan(first.sequence)
      } finally {
        watcher.close()
      }
    })
  })

  test("close stops the watcher and makes later polls no-ops", () => {
    /** A workspace for the closed watcher's file. */
    const root = mkdtempSync(join(TEST_DIR, ".tmp-"))
    try {
      /** The plan file the watcher followed. */
      const planFile = join(root, "plan.md")
      /** The watcher under test. */
      const watcher = watchGraph({ planFile })
      watcher.close()
      expect(watcher.closed).toBe(true)
      expect(watcher.watching).toBe(false)
      writeFileSync(planFile, "## TODOs\n\n1. late.\n")
      expect(watcher.poll()).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("the debounce is observable", () => {
  test("two creates inside one window arrive as one batch that reports both notifications", async () => {
    await withWorkspace(async (root) => {
      /** The board directory the watcher follows, created before the watch so only the files are new. */
      const boardDir = join(root, "board")
      mkdirSync(boardDir)
      /** The watcher under test, with a window wide enough that both writes land inside it. */
      const watcher = watchGraph({ boardDir }, { debounceMs: 200 })
      try {
        writeFileSync(join(boardDir, "a.json"), "{}")
        writeFileSync(join(boardDir, "b.json"), "{}")
        /** The single collapsed batch. */
        const event = await nextEvent(watcher)
        expect(event.sequence).toBe(1)
        expect(event.paths).toEqual([boardDir])
        expect(event.coalesced).toBeGreaterThanOrEqual(2)
        expect(watcher.sequence).toBe(1)
        expect(watcher.coalesced).toBe(event.coalesced)
      } finally {
        watcher.close()
      }
    })
  })

  test("a missing board directory becomes watchable once it exists, and poll() proves it", () => {
    /** A workspace for the late board directory. */
    const root = mkdtempSync(join(TEST_DIR, ".tmp-"))
    try {
      /** A board directory that does not exist yet. */
      const boardDir = join(root, "board")
      /** The watcher under test; its long window keeps the platform event out of this arm. */
      const watcher = watchGraph({ boardDir }, { debounceMs: 500 })
      try {
        expect(watcher.watching).toBe(true)
        mkdirSync(boardDir, { recursive: true })
        writeFileSync(join(boardDir, "a.json"), "{}")
        expect(watcher.poll()).toBe(true)
        expect(watcher.poll()).toBe(false)
      } finally {
        watcher.close()
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("a listener that throws is reported and does not stop the batch", () => {
    /** A workspace for the throwing listener's file. */
    const root = mkdtempSync(join(TEST_DIR, ".tmp-"))
    try {
      /** The plan file the watcher follows. */
      const planFile = join(root, "plan.md")
      /** The failures the watcher reported. */
      const errors: unknown[] = []
      /** The watcher under test. */
      const watcher = watchGraph({ planFile }, { debounceMs: 500, onError: (error) => errors.push(error) })
      try {
        watcher.subscribe(() => {
          throw new Error("listener boom")
        })
        writeFileSync(planFile, "## TODOs\n\n1. one.\n")
        expect(watcher.poll()).toBe(true)
        expect(errors.length).toBe(1)
      } finally {
        watcher.close()
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("a plan that appears", () => {
  test("creating a plan where none existed is a batch when the plans directory is watched", () => {
    /** A workspace whose plans directory exists but holds nothing. */
    const root = mkdtempSync(join(TEST_DIR, ".tmp-"))
    try {
      /** The plans directory the host would pass. */
      const plansDir = join(root, ".mpd", "plans")
      mkdirSync(plansDir, { recursive: true })
      /** The watcher under test; the long window keeps the platform event out of this arm. */
      const watcher = watchGraph({ plansDir }, { debounceMs: 500 })
      try {
        writeFileSync(join(plansDir, "first.md"), "## TODOs\n\n1. one.\n")
        expect(watcher.poll()).toBe(true)
      } finally {
        watcher.close()
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("a NEWER plan emits a batch even though the watched file did not change", async () => {
    await withWorkspace(async (root) => {
      /** The plans directory holding the plan the watcher was armed for. */
      const plansDir = join(root, ".mpd", "plans")
      mkdirSync(plansDir, { recursive: true })
      /** The plan file resolved when the watch was armed. */
      const planFile = join(plansDir, "older.md")
      writeFileSync(planFile, "## TODOs\n\n1. older.\n")
      /** The watcher under test. */
      const watcher = watchGraph({ planFile, plansDir }, { debounceMs: 20 })
      try {
        writeFileSync(join(plansDir, "newer.md"), "## TODOs\n\n1. newer.\n")
        /** The batch the new file produced, attributed to the SET rather than to the old file. */
        const event = await nextEvent(watcher)
        expect(event.paths).toEqual([plansDir])
        expect(event.manual).toBe(false)
      } finally {
        watcher.close()
      }
    })
  })

  test("a zh-CN twin is not a plan change", () => {
    /** A workspace for the twin's plans directory. */
    const root = mkdtempSync(join(TEST_DIR, ".tmp-"))
    try {
      /** The plans directory the host would pass. */
      const plansDir = join(root, ".mpd", "plans")
      mkdirSync(plansDir, { recursive: true })
      /** The watcher under test; its long window keeps the platform event out of this arm. */
      const watcher = watchGraph({ plansDir }, { debounceMs: 500 })
      try {
        writeFileSync(join(plansDir, "plan.zh-CN.md"), "## TODOs\n\n1. 计划。\n")
        expect(watcher.poll()).toBe(false)
      } finally {
        watcher.close()
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("a directory replaced at the same path", () => {
  test("the watch follows the NEW inode, so later files are still reported", async () => {
    await withWorkspace(async (root) => {
      /** The board directory the watcher follows. */
      const boardDir = join(root, "board")
      mkdirSync(boardDir)
      writeFileSync(join(boardDir, "a.json"), "{}")
      /** The watcher under test. */
      const watcher = watchGraph({ boardDir }, { debounceMs: 30 })
      try {
        writeFileSync(join(boardDir, "b.json"), "{}")
        /** The first batch, which proves the watch is live before the replacement. */
        const first = await nextEvent(watcher)
        expect(first.paths).toEqual([boardDir])
        renameSync(boardDir, boardDir + "-old")
        mkdirSync(boardDir)
        writeFileSync(join(boardDir, "a.json"), "{}")
        expect(watcher.poll()).toBe(true)
        writeFileSync(join(boardDir, "c.json"), "{}")
        /** The batch the NEW directory's file produced; a watch left on the old inode cannot see it. */
        const third = await nextEvent(watcher)
        expect(third.paths).toEqual([boardDir])
        expect(third.sequence).toBeGreaterThan(first.sequence)
      } finally {
        watcher.close()
      }
    })
  })
})
