// ONE DEBOUNCED FILE WATCHER over the task-plan inputs, shared by everything that draws them.
//
// WHY ONE, IN THE CORE (frozen decision, `.mpd/plans/living-graph.md` Amendment 1): the user chose
// event-driven refresh over polling "because it saves resources", and two watchers on one file is
// exactly the waste that choice names. Both planes subscribe to the same watcher instance; neither
// arms its own.
//
// HOW IT STAYS CORRECT ON A REAL FILESYSTEM. `fs.watch` is notorious for what it does NOT tell you: a
// rename can leave a file watch following an inode nobody writes to any more, a watch on a missing
// path simply refuses to attach, and the reported filename is advisory. So this watcher watches the
// DIRECTORY that holds each target (walking up to the nearest directory that exists, which is how a
// target that does not exist yet is still detected when it is created), and it decides whether
// anything changed by comparing a SIGNATURE it computes itself — inode, mtime, ctime and size per
// file — rather than by trusting the event payload. A rename, a replace, a delete and a create are
// therefore all just "the signature moved", and a notification storm that changes nothing emits
// nothing.
//
// THE DEBOUNCE IS OBSERVABLE, NOT SILENT. A coalesced batch reports how many raw notifications it
// absorbed (`coalesced` on the event, and the running total on the watcher), so a consumer asked
// "the board changed twice inside one window — what does the model show?" can prove the collapse
// instead of guessing. `poll()` is the manual resync path and uses the same comparison.
import { readdirSync, statSync, watch } from "node:fs"
import type { FSWatcher, Stats } from "node:fs"
import { basename, dirname, join } from "node:path"

/** The paths the watcher follows; every side is optional. */
export interface GraphWatchTargets {
  /** The directory holding the board records (`<workspace>/.mpd/team/teams`); missing is tolerated. */
  boardDir?: string
  /** The task-plan file; missing, replaced and renamed are all tolerated. */
  planFile?: string
  /**
   * The directory plan files APPEAR in (`<workspace>/.mpd/plans`).
   *
   * WATCHED AS A SET, not as one file, because "a plan edit re-renders" must also mean "a plan
   * CREATED re-renders": a new file changes the newest-plan resolution, so the host's cached model
   * is stale even though the file it was watching did not change. Without this target that event
   * would never fire. `*.zh-CN.md` twins are excluded, exactly as the resolver excludes them.
   */
  plansDir?: string
}

/** How the watcher behaves; every field has a documented default. */
export interface GraphWatchOptions {
  /** Debounce window in milliseconds; 150 when omitted. */
  debounceMs?: number
  /** The first batch listener, equivalent to an immediate `subscribe`. */
  onChange?: (event: GraphChangeEvent) => void
  /** Sink for a platform or listener failure; omitted means failures are swallowed. */
  onError?: (error: unknown) => void
}

/** One delivered batch of input changes. */
export interface GraphChangeEvent {
  /** The watched paths whose OWN signature moved, sorted lexicographically. */
  paths: string[]
  /** True when `poll()` produced the batch, false for a filesystem event. */
  manual: boolean
  /** 1-based batch counter, so a consumer can drop an out-of-order batch. */
  sequence: number
  /** Raw notifications this batch absorbed: greater than one proves a debounce collapse. */
  coalesced: number
}

/**
 * A live watcher over the task-plan inputs.
 *
 * The subscription, the resync path and the two counters are the whole surface; there is no way to
 * ask it for a model, because the model is the caller's to build from its own reads.
 */
export interface GraphWatcher {
  /**
   * Add a batch listener.
   * @param listener - called once per delivered batch.
   * @returns the unsubscribe function.
   */
  subscribe(listener: (event: GraphChangeEvent) => void): () => void
  /**
   * Recompute every target's signature and deliver a batch if anything changed.
   * @returns true when a batch was delivered.
   */
  poll(): boolean
  /** Stop the watchers, drop every listener, and make later polls no-ops. */
  close(): void
  /** Whether at least one directory handle is currently armed. */
  readonly watching: boolean
  /** Whether `close()` has run. */
  readonly closed: boolean
  /** Batches delivered so far; also the next batch's sequence. */
  readonly sequence: number
  /** Raw notifications merged into delivered batches so far. */
  readonly coalesced: number
}

/** One path the watcher follows. */
interface WatchTarget {
  /** The absolute-ish path the caller named. */
  path: string
  /** Which kind of path it is: a board directory, the plan file, or the plans directory as a set. */
  kind: "board-dir" | "plan-file" | "plans-dir"
}

/** One armed directory watch and what its notifications can mean. */
interface ArmedDirectory {
  /** The live platform watcher. */
  watcher: FSWatcher
  /** The inode this watcher was armed on, so a replaced directory is re-armed instead of trusted. */
  ino: number
  /** Whether the armed directory IS a target directory, which makes filename filtering meaningful. */
  exact: boolean
  /** Whether a board directory is watched here, so a `*.json` entry matters. */
  board: boolean
  /** Whether the plans directory is watched here, so any `*.md` entry matters. */
  plans: boolean
  /** The plan-file basenames watched here. */
  names: Set<string>
}

/**
 * A path's stats, or undefined when it cannot be read.
 * @param path - the path to stat.
 * @returns the stats, or undefined for a missing or unreadable path.
 */
function statOrUndefined(path: string): Stats | undefined {
  try {
    return statSync(path)
  } catch {
    return undefined
  }
}

/**
 * The nearest directory that exists at or above a path, so a watcher can attach before the target does.
 * @param path - the directory (or file) whose holder is wanted.
 * @returns the nearest existing directory, or undefined when even the filesystem root is unreadable.
 */
function nearestExistingDirectory(path: string): string | undefined {
  /** The directory being tested, walking up. */
  let current = path
  for (;;) {
    /** Whether `current` is an existing directory. */
    let exists = false
    try {
      exists = statSync(current).isDirectory()
    } catch {
      exists = false
    }
    if (exists) return current
    /** The next ancestor to try; the root is its own parent, which ends the walk. */
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

/**
 * The signature of a file: inode, mtime, ctime and size, or `missing`.
 *
 * The inode is what makes a REPLACE visible: a rename onto the path keeps mtime and size plausible
 * but gives the new bytes a different inode, so the signature moves even inside one millisecond.
 * @param path - the file to summarise.
 * @returns a stable token that changes when the file changes.
 */
function fileSignature(path: string): string {
  /** The file's stats, absent when it does not exist. */
  const stats = statOrUndefined(path)
  return stats === undefined ? "missing" : `${stats.ino}:${stats.mtimeMs}:${stats.ctimeMs}:${stats.size}`
}

/**
 * The signature of a directory's ACCEPTED entries: each one's name, inode, mtime and size, in name order.
 *
 * THE SET ITSELF IS PART OF THE SIGNATURE, and that is what makes a file APPEARING a change: a
 * directory with no accepted entry and one with a single new file have different tokens, so a plan
 * created where none existed invalidates the model instead of waiting for an edit to a file that was
 * never there. A replaced entry also moves the token, because its inode differs even when the name,
 * the size and a same-millisecond mtime do not.
 * @param directory - the directory to summarise.
 * @param accept - which entry names belong to the signature.
 * @returns a stable token that changes when any accepted entry is created, replaced or deleted.
 */
function directorySignature(directory: string, accept: (name: string) => boolean): string {
  /** The directory's entry names, or undefined when it cannot be read. */
  let names: string[]
  try {
    names = readdirSync(directory)
  } catch {
    return "unavailable"
  }
  /** One fragment per accepted entry, so the whole directory has one comparable token. */
  const parts: string[] = []
  for (const name of names.sort()) {
    if (!accept(name)) continue
    /** The entry's stats, absent when it vanished between listing and stat. */
    const stats = statOrUndefined(join(directory, name))
    if (stats === undefined) continue
    parts.push(`${name}:${stats.ino}:${stats.mtimeMs}:${stats.size}`)
  }
  return parts.join(";")
}

/**
 * The board directory's signature: every `*.json` record.
 * @param directory - the board directory.
 * @returns the directory's signature token.
 */
function boardSignature(directory: string): string {
  return directorySignature(directory, (name) => name.endsWith(".json"))
}

/**
 * The plans directory's signature: every CANDIDATE plan file, in name order.
 *
 * The `*.zh-CN.md` exclusion is the resolver's own rule, mirrored here so the watcher and
 * `resolvePlanFile` agree about what counts as a plan file.
 * @param directory - the plans directory.
 * @returns the directory's signature token.
 */
function plansSignature(directory: string): string {
  return directorySignature(directory, (name) => name.endsWith(".md") && !name.endsWith(".zh-CN.md"))
}

/**
 * A target's own signature, which is what the watcher actually compares.
 * @param target - the target to summarise.
 * @returns the target's signature token.
 */
function targetSignature(target: WatchTarget): string {
  if (target.kind === "board-dir") return boardSignature(target.path)
  if (target.kind === "plans-dir") return plansSignature(target.path)
  return fileSignature(target.path)
}

/**
 * Start watching the task-plan inputs.
 *
 * NEVER THROWS: a directory the platform refuses to watch is reported through `onError` and the
 * watcher keeps whatever handles it has, with `poll()` as the documented resync path.
 * @param targets - the board directory, the plan file and the plans directory; any may be omitted.
 * @param options - debounce window, initial listener and error sink.
 * @returns the live watcher.
 */
export function watchGraph(targets: GraphWatchTargets, options: GraphWatchOptions = {}): GraphWatcher {
  /** The debounce window; 150 ms when the caller expressed no preference. */
  const debounceMs = options.debounceMs ?? 150
  /** The targets this watcher follows, in caller order. */
  const watched: WatchTarget[] = []
  if (targets.boardDir !== undefined) watched.push({ path: targets.boardDir, kind: "board-dir" })
  if (targets.planFile !== undefined) watched.push({ path: targets.planFile, kind: "plan-file" })
  if (targets.plansDir !== undefined) watched.push({ path: targets.plansDir, kind: "plans-dir" })
  /** Each target's signature at its last delivered batch, or at arm time. */
  const signatures = new Map<string, string>()
  for (const target of watched) signatures.set(target.path, targetSignature(target))
  /** The directory watches currently armed, keyed by directory. */
  const armed = new Map<string, ArmedDirectory>()
  /** The batch listeners. */
  const listeners = new Set<(event: GraphChangeEvent) => void>()
  if (options.onChange !== undefined) listeners.add(options.onChange)
  /** The pending debounce timer, when one is armed. */
  let timer: ReturnType<typeof setTimeout> | undefined
  /** Raw notifications seen since the last delivered batch. */
  let pending = 0
  /** Batches delivered so far. */
  let sequence = 0
  /** Raw notifications merged into delivered batches so far. */
  let coalesced = 0
  /** Whether `close()` has run. */
  let closed = false

  /**
   * Report a failure to the caller's sink, if it registered one.
   * @param error - whatever the platform or a listener threw.
   */
  function report(error: unknown): void {
    options.onError?.(error)
  }

  /**
   * Whether a directory notification can concern a watched target.
   * @param name - the reported entry name; undefined means the platform did not say.
   * @returns true when a signature must be recomputed.
   */
  function relevant(name: string | undefined): boolean {
    if (name === undefined) return true
    for (const entry of armed.values()) {
      if (!entry.exact) return true
      if (entry.board && name.endsWith(".json")) return true
      if (entry.plans && name.endsWith(".md")) return true
      if (entry.names.has(name)) return true
      if (entry.names.size > 0 && name.endsWith(".md")) return true
    }
    return false
  }

  /**
   * Attach one directory watch, recording the inode it actually attached to.
   * @param directory - the existing directory to watch.
   * @returns the live watcher and its inode, or undefined when the platform refused it.
   */
  function armDirectory(directory: string): { watcher: FSWatcher; ino: number } | undefined {
    /** The directory's stats BEFORE the watch is attached, so a replacement can be detected later. */
    const stats = statOrUndefined(directory)
    if (stats === undefined) {
      report(new Error("watch target disappeared before it could be armed: " + directory))
      return undefined
    }
    try {
      /** The platform watcher; `persistent: false` so a library never holds the process open. */
      const watcher = watch(directory, { persistent: false }, (_event, name) => notify(typeof name === "string" ? name : undefined))
      watcher.on("error", report)
      return { watcher, ino: stats.ino }
    } catch (error) {
      report(error)
      return undefined
    }
  }

  /**
   * Arm one watcher per distinct directory the targets currently need, and drop the ones they no longer may keep.
   *
   * Called at start and after EVERY debounce, delivered or not, which is what heals two shapes the
   * platform cannot report well: a target whose directory did not exist when the watcher started
   * (the ancestor watch sees it appear, then the next pass moves the watch onto it), and a directory
   * REPLACED at the same path (a rename-in-place or an rm-and-recreate). The second shape is why the
   * inode is recorded and compared: an inotify watch follows the inode, not the path, so a watch that
   * looked "already armed" would silently stop reporting the new directory's files.
   */
  function arm(): void {
    if (closed) return
    /** The directories that should be armed, with what their notifications may mean. */
    const wanted = new Map<string, { exact: boolean; board: boolean; plans: boolean; names: Set<string> }>()
    for (const target of watched) {
      /** The directory that holds the target when it exists. */
      const wantedDir = target.kind === "plan-file" ? dirname(target.path) : target.path
      /** Where the watch can attach right now: that directory, or its nearest existing ancestor. */
      const existing = nearestExistingDirectory(wantedDir)
      if (existing === undefined) continue
      /** The registry entry for that directory, created on first sight. */
      const entry = wanted.get(existing) ?? { exact: existing === wantedDir, board: false, plans: false, names: new Set<string>() }
      entry.exact = entry.exact && existing === wantedDir
      if (target.kind === "plan-file") entry.names.add(basename(target.path))
      else if (existing === wantedDir && target.kind === "board-dir") entry.board = true
      else if (existing === wantedDir && target.kind === "plans-dir") entry.plans = true
      wanted.set(existing, entry)
    }
    for (const [directory, entry] of armed) {
      /** The directory's stats right now; a vanished or REPLACED path must not keep the old watch. */
      const stats = statOrUndefined(directory)
      if (wanted.has(directory) && stats !== undefined && stats.ino === entry.ino) continue
      entry.watcher.close()
      armed.delete(directory)
    }
    for (const [directory, desired] of wanted) {
      if (armed.has(directory)) continue
      /** The freshly attached watcher and the inode it attached to, absent when the platform refused. */
      const attached = armDirectory(directory)
      if (attached === undefined) continue
      armed.set(directory, { watcher: attached.watcher, ino: attached.ino, exact: desired.exact, board: desired.board, plans: desired.plans, names: desired.names })
    }
  }

  /**
   * Compare every target's signature and deliver one batch when anything changed.
   *
   * A notification that changed no signature emits NOTHING and resets the pending count, so an
   * unrelated write in a watched directory can never be attributed to a later batch. The arming
   * pass runs even when nothing was delivered: that is how a target directory which did not exist
   * gains its watch one level at a time as the path is created.
   * @param manual - whether a `poll()` asked for the comparison.
   * @returns true when a batch was delivered.
   */
  function deliver(manual: boolean): boolean {
    if (closed) return false
    /** The targets whose own signature moved since the last batch. */
    const changed: string[] = []
    for (const target of watched) {
      /** The target's signature right now. */
      const current = targetSignature(target)
      if (current === signatures.get(target.path)) continue
      signatures.set(target.path, current)
      changed.push(target.path)
    }
    if (changed.length === 0) {
      pending = 0
      arm()
      return false
    }
    changed.sort()
    sequence += 1
    /** The raw notifications this batch absorbed. */
    const absorbed = pending
    pending = 0
    coalesced += absorbed
    /** The batch every listener receives. */
    const event: GraphChangeEvent = { paths: changed, manual, sequence, coalesced: absorbed }
    for (const listener of [...listeners]) {
      try {
        listener(event)
      } catch (error) {
        report(error)
      }
    }
    arm()
    return true
  }

  /**
   * Record one filesystem notification and re-arm the debounce.
   * @param name - the changed entry's name, when the platform reported one.
   */
  function notify(name: string | undefined): void {
    if (closed) return
    if (!relevant(name)) return
    pending += 1
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      deliver(false)
    }, debounceMs)
  }

  arm()
  return {
    /** Add a batch listener and return the function that removes it. */
    subscribe(listener: (event: GraphChangeEvent) => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    /** Compare the signatures now and deliver a batch, which is the manual resync path. */
    poll(): boolean {
      if (closed) return false
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
      return deliver(true)
    },
    /** Stop every directory handle, drop the listeners and make later calls no-ops. */
    close(): void {
      if (closed) return
      closed = true
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
      for (const entry of armed.values()) entry.watcher.close()
      armed.clear()
      listeners.clear()
    },
    /** Whether at least one directory handle is armed right now. */
    get watching(): boolean {
      return armed.size > 0
    },
    /** Whether `close()` has run. */
    get closed(): boolean {
      return closed
    },
    /** How many batches have been delivered so far. */
    get sequence(): number {
      return sequence
    },
    /** How many raw notifications those batches absorbed in total. */
    get coalesced(): number {
      return coalesced
    },
  }
}
