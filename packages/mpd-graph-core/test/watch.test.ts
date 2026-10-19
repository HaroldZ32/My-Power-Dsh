// THE WATCHER: one debounce, a real filesystem event, a manual resync and an observable counter.
//
// The arms are small on purpose: a missing file, a rename-and-replace, two creates inside one window
// (which must arrive as ONE batch whose counter says 2), a listener that throws, a directory replaced
// at the same path, and a watch that DIES with no notification at all. `poll()` is exercised as the
// explicit resync API, never as the way a replacement heals: the replacement arms call it nowhere.
import { afterAll, describe, expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs"
import type { FSWatcher } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import type { GraphChangeEvent, GraphWatchFactory, GraphWatcher } from "../src/watch.ts"
import { watchGraph } from "../src/watch.ts"

/** This test file's own directory, which is inside the workspace the file sandbox allows. */
const TEST_DIR = dirname(fileURLToPath(import.meta.url))

/** Every temporary workspace this file created, so a timed-out case is still swept up. */
const WORKSPACES: string[] = []

/**
 * Create a temporary workspace under this package and register it for the run-level sweep.
 *
 * THE SWEEP IS THE SECOND NET: each case removes its own root in `finally`, but a case that TIMES
 * OUT mid-await never reaches it, and a test run must not leave directories in the tree.
 * @returns the absolute workspace root.
 */
function scratch(): string {
  /** The fresh workspace root. */
  const root = mkdtempSync(join(TEST_DIR, ".tmp-"))
  WORKSPACES.push(root)
  return root
}

/**
 * Run one case inside a fresh temporary workspace and remove it afterwards.
 * @param run - the case body, given the absolute workspace root.
 * @returns a promise settled when the case and the cleanup are done.
 */
async function withWorkspace(run: (root: string) => Promise<void>): Promise<void> {
  /** The temporary workspace root. */
  const root = scratch()
  try {
    await run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
    /** The root's slot in the sweep list, or -1 when it is already gone. */
    const at = WORKSPACES.indexOf(root)
    if (at >= 0) WORKSPACES.splice(at, 1)
  }
}

afterAll(() => {
  for (const root of WORKSPACES) rmSync(root, { recursive: true, force: true })
  WORKSPACES.length = 0
})

/**
 * Wait a little, so a debounce or a bounded re-arm has time to run before the next assertion.
 * @param ms - how long to wait, in milliseconds.
 * @returns a promise resolved after that delay.
 */
function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/** A hand-driven watch: the test emits the platform's own `close` and notifications. */
class FakeWatch extends EventEmitter {
  /** The directory the core asked this fake to watch. */
  readonly armedOn: string
  /** Whether the core closed this fake, as it does when it replaces a watch. */
  closed = false
  /** The core's own notification sink, called by the test to simulate a filesystem event. */
  private readonly sink: (eventType: string, filename: string | undefined) => void
  /**
   * Build one fake watch over a directory.
   * @param armedOn - the directory the core asked to watch.
   * @param sink - the notification listener the core attached.
   */
  constructor(armedOn: string, sink: (eventType: string, filename: string | undefined) => void) {
    super()
    this.armedOn = armedOn
    this.sink = sink
  }
  /** Stop the fake; the core calls this when it replaces a watch. */
  close(): void {
    this.closed = true
  }
  /** Deliver one notification exactly as the platform would. */
  notify(name: string): void {
    this.sink("rename", name)
  }
  /** Die the way an invalidated platform watch does: a `close` and nothing else. */
  die(): void {
    this.emit("close")
  }
}

/**
 * A {@link GraphWatchFactory} that hands out {@link FakeWatch} instances and remembers them.
 * @param created - the fakes created, in arm order.
 * @returns the factory to pass as `createWatch`.
 */
function fakeWatchFactory(created: FakeWatch[]): GraphWatchFactory {
  return (path, sink) => {
    /** The fake for this arming. */
    const fake = new FakeWatch(path, sink)
    created.push(fake)
    // The fake implements the surface the watcher uses; TypeScript's FSWatcher class carries more.
    return fake as unknown as FSWatcher
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
    const root = scratch()
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
    const root = scratch()
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
    const root = scratch()
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
    const root = scratch()
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
    const root = scratch()
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
  test("rm -rf and an immediate mkdir: a later file is delivered with NO poll", async () => {
    await withWorkspace(async (root) => {
      /** The board directory the watcher follows. */
      const boardDir = join(root, "board")
      mkdirSync(boardDir)
      writeFileSync(join(boardDir, "a.json"), "{}")
      /** The watcher under test. */
      const watcher = watchGraph({ boardDir }, { debounceMs: 20 })
      try {
        writeFileSync(join(boardDir, "b.json"), "{}")
        /** The batch that proves the watch is live before the replacement. */
        const first = await nextEvent(watcher)
        expect(first.paths).toEqual([boardDir])
        // On this filesystem the recreated directory gets the SAME inode; only the birthtime differs.
        rmSync(boardDir, { recursive: true, force: true })
        mkdirSync(boardDir)
        // Let the replacement's own batch settle. NOTHING in this arm calls poll().
        await sleep(150)
        writeFileSync(join(boardDir, "late.json"), "{}")
        /** The batch the LATE file produced; a watch left on the dead directory cannot produce it. */
        const late = await nextEvent(watcher)
        expect(late.paths).toEqual([boardDir])
        expect(late.sequence).toBeGreaterThan(first.sequence)
      } finally {
        watcher.close()
      }
    })
  })

  test("a rename away and a replacement: a later file is delivered with NO poll", async () => {
    await withWorkspace(async (root) => {
      /** The board directory the watcher follows. */
      const boardDir = join(root, "board")
      mkdirSync(boardDir)
      writeFileSync(join(boardDir, "a.json"), "{}")
      /** The watcher under test. */
      const watcher = watchGraph({ boardDir }, { debounceMs: 20 })
      try {
        writeFileSync(join(boardDir, "b.json"), "{}")
        /** The batch that proves the watch is live before the rename. */
        const first = await nextEvent(watcher)
        expect(first.paths).toEqual([boardDir])
        renameSync(boardDir, boardDir + "-old")
        mkdirSync(boardDir)
        // The rename delivers one signal and then silence; the re-arm must not wait for another.
        await sleep(150)
        writeFileSync(join(boardDir, "late.json"), "{}")
        /** The batch the LATE file produced; the old watch follows the renamed directory. */
        const late = await nextEvent(watcher)
        expect(late.paths).toEqual([boardDir])
        expect(late.sequence).toBeGreaterThan(first.sequence)
      } finally {
        watcher.close()
      }
    })
  })
})

describe("a dead watch recovers on its own", () => {
  test("a platform close re-arms the watch with no poll and no file event", async () => {
    /** A workspace whose directory exists on disk for the arming stat. */
    const root = scratch()
    try {
      /** The board directory the fake watches. */
      const boardDir = join(root, "board")
      mkdirSync(boardDir)
      writeFileSync(join(boardDir, "a.json"), "{}")
      /** The fakes the injected factory hands out, in arm order. */
      const created: FakeWatch[] = []
      /** The watcher under test over the injected platform. */
      const watcher = watchGraph({ boardDir }, { debounceMs: 20, createWatch: fakeWatchFactory(created) })
      try {
        expect(created.length).toBe(1)
        // The death signal a runtime sends when it invalidates a watch: no notification, no error.
        created[0]?.die()
        // Recovery is time-based and bounded; no poll and no file event is involved.
        await sleep(150)
        expect(created.length).toBeGreaterThanOrEqual(2)
        expect(created[0]?.closed).toBe(true)
        // The re-armed watch is LIVE: a change through it must arrive.
        writeFileSync(join(boardDir, "b.json"), "{}")
        created[created.length - 1]?.notify("b.json")
        /** The batch the RE-ARMED watch produced. */
        const event = await nextEvent(watcher)
        expect(event.paths).toEqual([boardDir])
      } finally {
        watcher.close()
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("an untouched directory delivers nothing extra, and close() cancels the attempts", async () => {
    /** A workspace whose directory exists on disk for the arming stat. */
    const root = scratch()
    try {
      /** The board directory the fake watches. */
      const boardDir = join(root, "board")
      mkdirSync(boardDir)
      writeFileSync(join(boardDir, "a.json"), "{}")
      /** The fakes the injected factory hands out, in arm order. */
      const created: FakeWatch[] = []
      /** The watcher under test over the injected platform. */
      const watcher = watchGraph({ boardDir }, { debounceMs: 20, createWatch: fakeWatchFactory(created) })
      try {
        writeFileSync(join(boardDir, "b.json"), "{}")
        created[0]?.notify("b.json")
        /** The one batch the change produced. */
        const event = await nextEvent(watcher)
        expect(event.sequence).toBe(1)
        // A quiet directory must not heal itself into a storm: no re-arm, no second batch.
        await sleep(150)
        expect(watcher.sequence).toBe(1)
        expect(created.length).toBe(1)
        watcher.close()
        // A close arriving after close() must arm nothing: the attempts are cancelled.
        created[0]?.die()
        await sleep(150)
        expect(created.length).toBe(1)
        writeFileSync(join(boardDir, "c.json"), "{}")
        expect(watcher.poll()).toBe(false)
      } finally {
        watcher.close()
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
