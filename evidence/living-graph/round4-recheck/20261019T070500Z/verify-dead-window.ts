// LANE E — round 4 of the watcher: a write that lands INSIDE the dead-re-arm window must still be
// delivered, and one change must stay one batch.
//
// THE SHAPE THAT MATTERS. A fake handle (the documented `createWatch` seam) is killed, and a real file
// is written on the very next line — inside the 25 ms re-arm window — with NO notification injected
// anywhere. The dead handle cannot report the write, and the fake emits nothing, so the ONLY possible
// source of a batch is the signature comparison the attempt now runs after `arm()`.
//
// Run under Bun 1.4.0 and Node 24 (and PATH Bun, free), as the previous rounds did.
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import type { FSWatcher } from "node:fs"
import { join } from "node:path"
import { watchGraph } from "../../../../packages/mpd-graph-core/src/watch.ts"
import type { GraphChangeEvent, GraphWatchFactory } from "../../../../packages/mpd-graph-core/src/watch.ts"

/** This run's own directory. */
const HERE = import.meta.dirname
/** Resolve after `ms` milliseconds. */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
/** Every scratch root, removed at the end. */
const scratchRoots: string[] = []
/**
 * One fresh scratch workspace.
 * @returns its root.
 */
function scratch(): string {
  const root = mkdtempSync(join(HERE, "dw-"))
  scratchRoots.push(root)
  return root
}

/** A fake platform watcher: it never observes anything, and the probe can kill it. */
interface FakeWatcher {
  /** The handlers the library registered, per event name. */
  handlers: Map<string, Array<(...args: unknown[]) => void>>
  /** Whether `close()` was called on it. */
  closed: boolean
  /** Register one handler (the shape `FSWatcher.on` provides). */
  on(event: string, listener: (...args: unknown[]) => void): FakeWatcher
  /** Close the handle (records it; emits nothing). */
  close(): void
  /** Fire one event at the registered handlers, as the platform would. */
  emit(event: string, ...args: unknown[]): void
}

/** A factory that mints fake handles and records the notify listeners the library installs. */
interface FakePlatform {
  /** The factory to pass as `createWatch`. */
  factory: GraphWatchFactory
  /** Every handle minted, in order. */
  handles: FakeWatcher[]
  /** Every notify listener the library passed, in order. */
  listeners: Array<(eventType: string, filename: string | undefined) => void>
  /** How many times the factory was called. */
  calls: number
}

/**
 * Build a fake platform.
 * @param failAfter - when set, calls after the first this many throw (a platform that refuses).
 * @returns the recorded platform.
 */
function fakePlatform(failAfter?: number): FakePlatform {
  const handles: FakeWatcher[] = []
  const listeners: Array<(eventType: string, filename: string | undefined) => void> = []
  const platform: FakePlatform = {
    handles,
    listeners,
    calls: 0,
    factory: ((_path: string, listener: (eventType: string, filename: string | undefined) => void) => {
      platform.calls += 1
      if (failAfter !== undefined && platform.calls > failAfter) throw new Error("platform refused the watch")
      const handlers = new Map<string, Array<(...args: unknown[]) => void>>()
      const fake: FakeWatcher = {
        handlers,
        closed: false,
        on(event, handler) {
          const list = handlers.get(event) ?? []
          list.push(handler)
          handlers.set(event, list)
          return fake
        },
        close() {
          fake.closed = true
        },
        emit(event, ...args) {
          for (const handler of handlers.get(event) ?? []) handler(...args)
        },
      }
      handles.push(fake)
      listeners.push(listener)
      return fake as unknown as FSWatcher
    }) as GraphWatchFactory,
  }
  return platform
}

/** One run's measurements. */
interface Measurements {
  /** The runtime string. */
  runtime: string
  /** Dead-window write: the batch arrived and how long it took. */
  deadWindow: { delivered: boolean; latencyMs: number; manual: boolean; batches: number; errors: number }
  /** Double-delivery guard: one change with a pending debounce timer. */
  doubleDelivery: { batches: number; manualAny: boolean; firstCoalesced: number }
  /** Give-up with failing attempts. */
  giveUp: { batches: number; errors: number; attempts: number }
  /** close() cancels a pending re-arm schedule. */
  closeCancels: { handlesAfterClose: number; afterWait: number; batches: number; closedPoll: boolean }
}
/** The runtime string of this process. */
const RUNTIME = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`

// ── 1. THE DEAD-WINDOW WRITE ─────────────────────────────────────────────────────────────────────
/** The dead-window measurement. */
const deadWindow = await (async () => {
  const root = scratch()
  const dir = join(root, "boards")
  mkdirSync(dir)
  writeFileSync(join(dir, "a.json"), "{}")
  const platform = fakePlatform()
  const events: GraphChangeEvent[] = []
  const errors: unknown[] = []
  const watcher = watchGraph({ boardDir: dir }, { debounceMs: 150, createWatch: platform.factory, onChange: (event) => { events.push(event) }, onError: (error) => { errors.push(error) } })
  try {
    await sleep(60)
    /** The first handle the library armed. */
    const first = platform.handles[0]
    /** The moment the watch was killed, from which latency is measured. */
    const killedAt = Date.now()
    first.emit("close")
    // THE WRITE LANDS INSIDE THE 25 ms WINDOW, and NO notification is injected anywhere.
    writeFileSync(join(dir, "b.json"), "{}")
    const start = Date.now()
    while (Date.now() - start < 3000 && events.length === 0) await sleep(5)
    /** The batch the signature comparison produced. */
    const batch = events[0]
    return { delivered: batch !== undefined, latencyMs: batch === undefined ? -1 : Date.now() - killedAt, manual: batch?.manual ?? true, batches: events.length, errors: errors.length }
  } finally {
    watcher.close()
    rmSync(root, { recursive: true, force: true })
  }
})()

// ── 2. THE DOUBLE-DELIVERY GUARD ────────────────────────────────────────────────────────────────
/** The guard measurement: a pending debounce timer plus a re-arm attempt. */
const doubleDelivery = await (async () => {
  const root = scratch()
  const dir = join(root, "boards")
  mkdirSync(dir)
  writeFileSync(join(dir, "a.json"), "{}")
  const platform = fakePlatform()
  const events: GraphChangeEvent[] = []
  const watcher = watchGraph({ boardDir: dir }, { debounceMs: 150, createWatch: platform.factory, onChange: (event) => { events.push(event) } })
  try {
    await sleep(60)
    // A real change AND its notification (the debounce timer is now pending), then a dead handle.
    writeFileSync(join(dir, "b.json"), "{}")
    platform.listeners[0]("rename", "b.json")
    platform.handles[0].emit("close")
    await sleep(900)
    /** The batch list after the debounce and all three attempts. */
    const snapshot = events.slice()
    return { batches: snapshot.length, manualAny: snapshot.some((event) => event.manual), firstCoalesced: snapshot[0]?.coalesced ?? 0 }
  } finally {
    watcher.close()
    rmSync(root, { recursive: true, force: true })
  }
})()

// ── 3. THE GIVE-UP, BOUNDED AND SILENT (the attempts themselves cannot re-arm) ──────────────────
/** The give-up measurement: the platform refuses every re-arm attempt. */
const giveUp = await (async () => {
  const root = scratch()
  const dir = join(root, "boards")
  mkdirSync(dir)
  writeFileSync(join(dir, "a.json"), "{}")
  const platform = fakePlatform(1)
  const events: GraphChangeEvent[] = []
  const errors: unknown[] = []
  const watcher = watchGraph({ boardDir: dir }, { debounceMs: 150, createWatch: platform.factory, onChange: (event) => { events.push(event) }, onError: (error) => { errors.push(error) } })
  try {
    await sleep(60)
    platform.handles[0].emit("close")
    await sleep(700)
    /** The errors/attempts at 700 ms, after all three bounded attempts (25/100/400) would have run. */
    const at700 = { errors: errors.length, attempts: platform.calls }
    await sleep(500)
    /** The same counters 500 ms later: the schedule must have STOPPED. */
    const after1100 = { errors: errors.length, attempts: platform.calls }
    return { batches: events.length, errors: errors.length, attempts: platform.calls, at700, after1100 }
  } finally {
    watcher.close()
    rmSync(root, { recursive: true, force: true })
  }
})()

// ── 4. close() CANCELS A PENDING RE-ARM SCHEDULE ────────────────────────────────────────────────
/** The cancel measurement. */
const closeCancels = await (async () => {
  const root = scratch()
  const dir = join(root, "boards")
  mkdirSync(dir)
  writeFileSync(join(dir, "a.json"), "{}")
  const platform = fakePlatform()
  const events: GraphChangeEvent[] = []
  const watcher = watchGraph({ boardDir: dir }, { debounceMs: 150, createWatch: platform.factory, onChange: (event) => { events.push(event) } })
  try {
    await sleep(60)
    platform.handles[0].emit("close")
    // Close IMMEDIATELY, while the 25/100/400 attempts are pending.
    watcher.close()
    /** The handle count at close time. */
    const atClose = platform.calls
    await sleep(800)
    return { handlesAfterClose: atClose, afterWait: platform.calls, batches: events.length, closedPoll: watcher.poll() }
  } finally {
    watcher.close()
    rmSync(root, { recursive: true, force: true })
  }
})()

for (const root of scratchRoots) {
  try { rmSync(root, { recursive: true, force: true }) } catch { /* already gone */ }
}

/** The measured result. */
const result: Measurements & { probe: string; at: string; verdict: Record<string, boolean> } = {
  probe: "dead-window",
  at: new Date().toISOString(),
  runtime: RUNTIME,
  deadWindow,
  doubleDelivery,
  giveUp: { batches: giveUp.batches, errors: giveUp.errors, attempts: giveUp.attempts, at700: giveUp.at700, after1100: giveUp.after1100 },
  closeCancels,
  verdict: {
    // 1: the write inside the re-arm window is delivered with NO injected notification, not manual.
    deadWindowWriteDelivered: deadWindow.delivered && deadWindow.manual === false,
    deadWindowOneBatch: deadWindow.batches === 1,
    // 2: one change with a pending debounce timer stays ONE batch, from the timer (not manual).
    doubleDeliveryGuard: doubleDelivery.batches === 1 && doubleDelivery.manualAny === false,
    // 3: the schedule STOPS after the bounded attempts (counters frozen at 700 ms), the give-up adds
    // no event, and each failed re-arm surfaces its platform refusal through onError.
    giveUpBounded: giveUp.after1100.attempts === giveUp.at700.attempts && giveUp.after1100.errors === giveUp.at700.errors,
    giveUpAddsNoEvent: giveUp.batches === 0,
    giveUpFailuresReported: giveUp.errors >= 3,
    // 4: close() cancels the pending attempts.
    closeCancelsRearm: closeCancels.afterWait === closeCancels.handlesAfterClose && closeCancels.batches === 0 && closeCancels.closedPoll === false,
  },
}
writeFileSync(join(HERE, `dead-window-${process.versions.bun ? "bun" + process.versions.bun : "node" + process.versions.node}.json`), JSON.stringify(result, null, 1))
console.log(JSON.stringify(result, null, 1))
