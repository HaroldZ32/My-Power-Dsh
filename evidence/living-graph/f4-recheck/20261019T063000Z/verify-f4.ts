// LANE E — F4 re-check (ONLY the directory-replacement recovery): the two shapes my previous probe
// could not pass, with NO poll() anywhere, plus the injected-close path and a no-storm control.
//
// WHAT CHANGED SINCE MY FAILING TRIALS: the watcher now accepts a directory SELF-EVENT, subscribes
// to each handle's `close`/`error` (matching the registry entry by OBJECT IDENTITY so a replaced
// handle's late close cannot kill its successor), re-arms on a bounded 25/100/400 ms schedule, and
// compares inode AND birthtime because a recreated directory can reuse the inode.
//
// Run under both Buns (PATH and the pinned toolchain) and record which one produced the numbers:
// the platform's reporing differs between runtimes and the recovery must not depend on one of them.
import { mkdirSync, mkdtempSync, renameSync, rmSync, statSync, watch, writeFileSync } from "node:fs"
import type { FSWatcher } from "node:fs"
import { join } from "node:path"
import { watchGraph } from "../../../../packages/mpd-graph-core/src/watch.ts"
import type { GraphChangeEvent, GraphWatchFactory } from "../../../../packages/mpd-graph-core/src/watch.ts"

/** This run's own directory. */
const HERE = import.meta.dirname
/** Resolve after `ms` milliseconds. */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Wait until a predicate holds, or time out.
 * @param predicate - the condition to poll for (this is the PROBE waiting, never the product).
 * @param ms - the wait budget.
 * @returns whether the predicate held.
 */
async function until(predicate: () => boolean, ms: number): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < ms) {
    if (predicate()) return true
    await sleep(10)
  }
  return predicate()
}

/** Every scratch root this run creates, removed at the end so the evidence tree stays clean. */
const scratchRoots: string[] = []
/**
 * One fresh scratch workspace.
 * @returns its absolute root.
 */
function scratch(): string {
  const root = mkdtempSync(join(HERE, "f4-"))
  scratchRoots.push(root)
  return root
}

// ── A. THE TWO LIVE SHAPES, WITH NO poll() ANYWHERE ───────────────────────────────────────────────
/** The outcome of one live replacement trial. */
interface LiveTrial {
  /** Which replacement shape ran. */
  kind: string
  /** Whether the recreated directory reused the inode. */
  sameIno: boolean
  /** Every batch the probe observed. */
  batches: Array<{ sequence: number; coalesced: number; manual: boolean }>
  /** Whether a batch arrived for the replacement itself. */
  replacementDelivered: boolean
  /** Whether the batch list ever marked a batch manual (a poll produced it). */
  manualAny: boolean
  /** Whether a file written AFTER the replacement produced a batch. */
  lateWriteDelivered: boolean
}

/**
 * Run one replacement shape and a late write, without calling poll().
 * @param kind - the shape to exercise.
 * @returns the measured outcome.
 */
async function liveTrial(kind: "rm-recreate" | "rename-away"): Promise<LiveTrial> {
  const root = scratch()
  const dir = join(root, "boards")
  mkdirSync(dir)
  writeFileSync(join(dir, "a.json"), "{}")
  const events: GraphChangeEvent[] = []
  const watcher = watchGraph({ boardDir: dir }, { debounceMs: 120, onChange: (event) => { events.push(event) } })
  try {
    await sleep(80)
    writeFileSync(join(dir, "first.json"), "{}")
    await until(() => events.length >= 1, 2000)
    const inoBefore = statSync(dir).ino
    if (kind === "rm-recreate") {
      rmSync(dir, { recursive: true, force: true })
      mkdirSync(dir)
    } else {
      renameSync(dir, dir + "-old")
      mkdirSync(dir)
    }
    writeFileSync(join(dir, "b.json"), "{}")
    const beforeReplacement = events.length
    const replacementDelivered = await until(() => events.length > beforeReplacement, 2500)
    // Let arm() (and, if a dead mark was raised, the bounded attempts) settle before the late write.
    await sleep(300)
    const beforeLate = events.length
    writeFileSync(join(dir, "late.json"), "{}")
    const lateWriteDelivered = await until(() => events.length > beforeLate, 3000)
    const sameIno = statSync(dir).ino === inoBefore
    return {
      kind,
      sameIno,
      batches: events.map((event) => ({ sequence: event.sequence, coalesced: event.coalesced, manual: event.manual })),
      replacementDelivered,
      manualAny: events.some((event) => event.manual),
      lateWriteDelivered,
    }
  } finally {
    watcher.close()
  }
}

const live = {
  rmRecreate: await liveTrial("rm-recreate"),
  renameAway: await liveTrial("rename-away"),
}

// ── B. THE INJECTED-CLOSE PATH ───────────────────────────────────────────────────────────────────
/** Every handle a factory trial created, in order. */
const handles: FSWatcher[] = []
/** The factory under test: a real watcher, handed back so the probe can drive its `close` signal. */
const factory: GraphWatchFactory = (path, listener) => {
  const watcher = watch(path, { persistent: false }, (event, name) => listener(String(event), name ?? undefined))
  handles.push(watcher)
  return watcher
}
/** Errors the watcher reported. */
const injectedErrors: unknown[] = []
const closeRoot = scratch()
const closeDir = join(closeRoot, "boards")
mkdirSync(closeDir)
writeFileSync(join(closeDir, "a.json"), "{}")
const closeEvents: GraphChangeEvent[] = []
const closeWatcher = watchGraph({ boardDir: closeDir }, { debounceMs: 80, createWatch: factory, onChange: (event) => { closeEvents.push(event) }, onError: (error) => { injectedErrors.push(error) } })
try {
  await sleep(80)
  /** The handle armed first. */
  const first = handles[0]
  // Replace the directory, which makes arm() retire the first handle and attach a second.
  rmSync(closeDir, { recursive: true, force: true })
  mkdirSync(closeDir)
  writeFileSync(join(closeDir, "b.json"), "{}")
  await until(() => closeEvents.length >= 1, 2500)
  await sleep(300)
  /** How many handles existed after the replacement's re-arm. */
  const afterRearm = handles.length
  // THE OLD HANDLE'S LATE `close` MUST NOT KILL ITS SUCCESSOR.
  first.emit("close")
  await sleep(300)
  /** The handle count after the old close (expected: unchanged). */
  const afterOldClose = handles.length
  const beforeC = closeEvents.length
  writeFileSync(join(closeDir, "c.json"), "{}")
  /** Whether the successor still delivered after the old close. */
  const successorStillWorks = await until(() => closeEvents.length > beforeC, 2500)
  // THE LIVE HANDLE'S OWN `close` MUST RE-ARM IT, WITH NO EVENT AND NO POLL.
  /** The handle that is live now. */
  const liveHandle = handles[handles.length - 1]
  liveHandle.emit("close")
  await sleep(700)
  /** The handle count after the dead watch's bounded re-arm attempts (expected: a NEW handle). */
  const afterDeadClose = handles.length
  const beforeD = closeEvents.length
  writeFileSync(join(closeDir, "d.json"), "{}")
  /** Whether the re-armed watch delivers. */
  const rearmedDelivers = await until(() => closeEvents.length > beforeD, 2500)
  // close() MUST CANCEL THE BOUNDED ATTEMPTS.
  handles[handles.length - 1].emit("close")
  closeWatcher.close()
  /** The handle count when close() ran. */
  const atClose = handles.length
  await sleep(800)
  /** The handle count after the attempts would have fired. */
  const afterCloseWait = handles.length
  var injected = {
    afterRearm,
    afterOldClose,
    oldCloseIgnored: afterOldClose === afterRearm,
    successorStillWorks,
    afterDeadClose,
    deadWatchRearmed: afterDeadClose > afterRearm,
    rearmedDelivers,
    atClose,
    afterCloseWait,
    closeCancelledTimers: afterCloseWait === atClose,
    closedPoll: closeWatcher.poll(),
    errors: injectedErrors.length,
  }
} finally {
  closeWatcher.close()
}

// ── C. THE NO-STORM CONTROL ─────────────────────────────────────────────────────────────────────
/** The handles the idle factory created. */
const idleHandles: FSWatcher[] = []
/** The idle factory: the same real watcher, counted. */
const idleFactory: GraphWatchFactory = (path, listener) => {
  const watcher = watch(path, { persistent: false }, (event, name) => listener(String(event), name ?? undefined))
  idleHandles.push(watcher)
  return watcher
}
const idleRoot = scratch()
const idleDir = join(idleRoot, "boards")
mkdirSync(idleDir)
writeFileSync(join(idleDir, "a.json"), "{}")
const idleEvents: GraphChangeEvent[] = []
const idleWatcher = watchGraph({ boardDir: idleDir }, { debounceMs: 80, createWatch: idleFactory, onChange: (event) => { idleEvents.push(event) } })
try {
  // Longer than the last bounded attempt (400 ms): an untouched directory must deliver NOTHING and
  // must not re-arm a single time.
  await sleep(1200)
  var idle = {
    batches: idleEvents.length,
    handles: idleHandles.length,
    idleDeliveredNothing: idleEvents.length === 0,
    idleDidNotRearm: idleHandles.length === 1,
    closedPoll: false,
  }
} finally {
  idleWatcher.close()
}
// `close()` after the wait: no attempt may attach anything afterwards.
await sleep(700)
idle.afterCloseHandles = idleHandles.length
idle.afterCloseNoRearm = idleHandles.length === 1
idle.closedPoll = idleWatcher.poll()

// Clean every scratch root so this evidence directory holds only the run's artifacts.
for (const root of scratchRoots) {
  try { rmSync(root, { recursive: true, force: true }) } catch { /* already gone */ }
}

/** The measured result. */
const result = {
  probe: "f4-replacement-recovery",
  at: new Date().toISOString(),
  runtime: process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`,
  live,
  injected,
  idle,
  verdict: {
    // A1: rm -rf + mkdir, no poll, late write delivered.
    rmRecreateLateWriteDelivered: live.rmRecreate.lateWriteDelivered,
    rmRecreateUsedSameInode: live.rmRecreate.sameIno,
    rmRecreateReplacementSeen: live.rmRecreate.replacementDelivered,
    // A2: rename-away + replacement, no poll, late write delivered.
    renameAwayLateWriteDelivered: live.renameAway.lateWriteDelivered,
    renameAwayReplacementSeen: live.renameAway.replacementDelivered,
    // A3: no batch in either shape was a manual (poll) batch.
    noPollBatch: live.rmRecreate.manualAny === false && live.renameAway.manualAny === false,
    // B: the injected close path.
    oldCloseCannotKillSuccessor: injected.oldCloseIgnored && injected.successorStillWorks,
    deadWatchRearmsWithoutEvent: injected.deadWatchRearmed && injected.rearmedDelivers,
    closeCancelsRearmTimers: injected.closeCancelledTimers && injected.closedPoll === false,
    // C: no storm on an idle directory.
    idleDirectoryStaysSilent: idle.idleDeliveredNothing && idle.idleDidNotRearm,
    noRearmAfterClose: idle.afterCloseNoRearm,
  },
}
writeFileSync(join(HERE, `f4-result-${process.versions.bun ? "bun" + process.versions.bun : "node" + process.versions.node}.json`), JSON.stringify(result, null, 1))
console.log(JSON.stringify(result, null, 1))
