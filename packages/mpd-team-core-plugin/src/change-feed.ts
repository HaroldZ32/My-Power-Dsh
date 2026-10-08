// The team CHANGE FEED: what turns "poll the record" into "be told the record moved".
//
// WHY THIS EXISTS. Every mpd team surface POLLS: the TUI sidebar page ticks at 1000 ms, the workmate
// page at 2000 ms, the fullscreen scenes at 2000 ms, and the Web team view re-fetches its routes on an
// interval. Polling is the wrong shape for this data — one team record changes a few dozen times over a
// wave, in bursts — so a 1 s tick spends almost every wake-up learning that nothing happened, and
// still shows a finished task up to a second late.
//
// TWO SOURCES, ONE FEED. A change is OBSERVED either because THIS process wrote it (`team-store.ts`
// notifies through `onTeamStateWritten`, see the hook there) or because ANOTHER process did (`fs.watch`
// on the workspace's team root and its `teams/` child). Both funnel into the same per-workspace window,
// so a consumer cannot tell — and never has to — which one happened, and a container lane, a second
// session or a CLI is seen exactly like this process's own tool call.
//
// ONE OBSERVATION PER WINDOW. The first observation of a quiet period OPENS a window, bumps the
// revision and schedules the flush; every observation landing inside that window is ABSORBED (the
// revision already carries it, and the listeners are told once, at the window's end). The window is
// FIXED, never extended by a late arrival, which is what keeps a continuously busy team from
// postponing its own notification forever — the failure mode a trailing debounce has by construction.
// The first write of a burst therefore notifies on its own: it is the one that opens the window.
import { mkdirSync, watch } from "node:fs"
import { onTeamStateWritten, teamRoot, teamsDir } from "./team-store"

/**
 * The `fs.watch` door, injected so a test can COUNT watchers or FORCE a refusal.
 *
 * The refusals this models are real: a workspace that cannot be written, or a kernel whose inotify
 * watch limit is exhausted, makes `fs.watch` throw exactly here — and the feed must degrade, not fail.
 */
export type WatchFactory = (dir: string, onEvent: () => void) => { close: () => void }

/** What one workspace's feed looks like from the outside; the ARMS read this, a surface never does. */
export interface ChangeFeedStats {
  /** How many change windows have been observed: the same number {@link ChangeFeed.revision} answers. */
  revision: number
  /** How many listeners are subscribed right now. */
  listeners: number
  /** How many directory watches are live right now (two per armed workspace, none when refused). */
  watchers: number
  /** Whether a coalescing window is open at this instant. */
  pending: boolean
}

/** How a feed is configured; every field is optional and every default is the production one. */
export interface ChangeFeedOptions {
  /** The coalescing window in ms. A burst inside one window is one notification. */
  debounceMs?: number
  /** The watch door; defaults to `node:fs`'s non-recursive, non-persistent `watch`. */
  watch?: WatchFactory
  /** The bounded diagnostic sink for the degradation and containment lines. */
  warn?: (line: string) => void
}

/** One workspace's feed state: its counter, its listeners, its watches and its open window. */
interface WorkspaceFeed {
  /** How many change windows have been observed. Monotonic for the life of this feed. */
  revision: number
  /** The subscribed listeners, in subscription order. */
  listeners: Set<() => void>
  /** The directories currently watched, so a refused one is retried and an armed one is not doubled. */
  armed: Set<string>
  /** The live watch handles, keyed by the directory each covers, so both can be closed together. */
  watchers: Map<string, { close: () => void }>
  /** The open window's timer, or `undefined` when no window is open. */
  timer?: ReturnType<typeof setTimeout>
  /** Whether the ONE degradation line has been written for this workspace since the last arming. */
  reported: boolean
  /** Whether the ONE containment line has been written for a throwing listener here. */
  listenerReported: boolean
  /** Re-entry guard: a watcher callback must not arm a second watch for its own directory. */
  arming: boolean
}

/** The production watch door: NOT recursive (Linux inotify has no recursive mode) and NOT persistent. */
const watchDirectory: WatchFactory = (dir: string, onEvent: () => void): { close: () => void } => watch(dir, { persistent: false }, onEvent)

/**
 * Take a timer out of the event loop's keep-alive set.
 *
 * A pending coalescing window must never be the reason a process stays up — the notification it would
 * deliver has no consumer left once everything else has exited.
 * @param timer - the timer returned by `setTimeout`.
 */
function detachTimer(timer: ReturnType<typeof setTimeout>): void {
  /** The `unref` the runtime may or may not expose on a timer handle. */
  const unref = (timer as { unref?: unknown }).unref
  if (typeof unref === "function") (unref as () => void).call(timer)
}

/**
 * The per-workspace change feed published as `mpdTeams.subscribe` and `mpdTeams.revision`.
 *
 * ONE INSTANCE PER ROW, not one per process: the feed owns the pending timers and the live watch
 * handles, so a second `apply()` (a hot reload, or a unit test) holds its own and releases exactly its
 * own. It is synchronous, and every member contains its own failures: it is called from a WRITER's
 * stack (a team mutation) and from RENDER paths, and neither may be taken down by a broken feed.
 */
export class ChangeFeed {
  /** The coalescing window, in ms, that every observation opens. */
  private readonly debounceMs: number
  /** The watch door this feed arms through. */
  private readonly watchFor: WatchFactory
  /** The bounded diagnostic sink for the degradation and containment lines. */
  private readonly warn: (line: string) => void
  /** The per-workspace states, keyed by the workspace path exactly as the caller spelled it. */
  private readonly workspaces: Map<string, WorkspaceFeed> = new Map()
  /** The store-writer unsubscription, so a disposed feed stops observing at once. */
  private readonly unhook: () => void
  /** Whether this feed has been disposed; a disposed feed observes nothing and notifies nobody. */
  private disposed = false

  /**
   * Build a feed and hook it to this process's team-state writers.
   * @param options - the window, the watch door and the diagnostic sink; all three are optional.
   */
  constructor(options: ChangeFeedOptions = {}) {
    this.debounceMs = options.debounceMs ?? 50
    this.watchFor = options.watch ?? watchDirectory
    this.warn = options.warn ?? ((): void => {})
    this.unhook = onTeamStateWritten((workspace: string): void => { this.notify(workspace) })
  }

  /**
   * Observe one change to a workspace's team state.
   *
   * PUBLIC BECAUSE IT IS THE FEED'S OWN ENTRY POINT for anything that is not a store write this process
   * made — the store hook calls it, and an arm calls it to reason about coalescing without a
   * filesystem. It is safe to call from a writer's stack: it does no I/O beyond the arming attempt and
   * it never calls a listener synchronously.
   * @param workspace - the workspace whose state moved.
   */
  notify(workspace: string): void {
    if (this.disposed) return
    /** This workspace's state, created on first use. */
    const state = this.stateFor(workspace)
    // SELF-HEALING ARMING: a workspace whose directories did not exist when the first subscriber
    // arrived is retried here, so the watch is armed as soon as there is something to watch.
    this.arm(workspace, state)
    if (state.timer !== undefined) return
    // THE FIRST OBSERVATION OF A QUIET PERIOD is the one that counts and the one that schedules the
    // flush; everything landing inside the window it opens is absorbed by that same revision.
    state.revision += 1
    state.timer = setTimeout((): void => { this.flush(workspace) }, this.debounceMs)
    detachTimer(state.timer)
  }

  /**
   * Subscribe to a workspace's team-state changes.
   *
   * The watcher for a workspace is created LAZILY on its first subscriber, so a surface that never
   * looks at a workspace costs nothing, and it is released with the last one, so a page that closes
   * leaves no handle behind.
   * @param workspace - the workspace to follow.
   * @param listener - called asynchronously, at most once per change window.
   * @returns the disposer; calling it twice is safe, and a disposed feed hands back a dead one.
   */
  subscribe(workspace: string, listener: () => void): () => void {
    if (this.disposed) return (): void => {}
    /** This workspace's state, created on first use. */
    const state = this.stateFor(workspace)
    state.listeners.add(listener)
    this.arm(workspace, state)
    /** Whether this particular disposer has already done its work. */
    let released = false
    return (): void => {
      if (released) return
      released = true
      this.release(workspace, listener)
    }
  }

  /**
   * How many change windows this feed has observed for one workspace.
   * @param workspace - the workspace to ask about.
   * @returns the counter, or 0 for a workspace never seen.
   */
  revision(workspace: string): number {
    return this.workspaces.get(workspace)?.revision ?? 0
  }

  /**
   * The introspection the arms read; a production surface has no use for it.
   * @param workspace - the workspace to ask about.
   * @returns the live counts, all zero for a workspace never seen.
   */
  stats(workspace: string): ChangeFeedStats {
    /** The state, absent for a workspace this feed never touched. */
    const state = this.workspaces.get(workspace)
    if (state === undefined) return { revision: 0, listeners: 0, watchers: 0, pending: false }
    return { revision: state.revision, listeners: state.listeners.size, watchers: state.watchers.size, pending: state.timer !== undefined }
  }

  /** Release every watch, timer and listener this feed holds. Idempotent. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unhook()
    for (const state of this.workspaces.values()) {
      if (state.timer !== undefined) clearTimeout(state.timer)
      for (const handle of state.watchers.values()) {
        // A handle that is already gone is not an error: the feed's job is to end up with none.
        try { handle.close() } catch { /* already closed */ }
      }
      state.watchers.clear()
      state.armed.clear()
      state.listeners.clear()
      state.timer = undefined
    }
    this.workspaces.clear()
  }

  /**
   * Deliver one window's worth of change to the listeners that are subscribed at its end.
   *
   * The listener set is SNAPSHOT before the first call, so a listener that unsubscribes itself (or
   * another) from inside the call cannot shorten the delivery for the rest, and a listener that
   * THROWS is contained: it must not break the writer that caused the change, the other listeners, or
   * the boot.
   * @param workspace - the workspace whose window is closing.
   */
  private flush(workspace: string): void {
    /** The state as of this instant; a disposed feed has none and delivers nothing. */
    const state = this.workspaces.get(workspace)
    if (state === undefined) return
    state.timer = undefined
    for (const listener of [...state.listeners]) {
      try {
        listener()
      } catch (error) {
        if (state.listenerReported) continue
        state.listenerReported = true
        this.warn(`[mpd-team-core] team change feed: a listener threw and was contained (${String((error as Error)?.message ?? error)})`)
      }
    }
  }

  /**
   * Drop one listener, releasing the workspace's resources when it was the last.
   * @param workspace - the workspace to release from.
   * @param listener - the listener being removed.
   */
  private release(workspace: string, listener: () => void): void {
    /** The state, absent when this workspace was never seen. */
    const state = this.workspaces.get(workspace)
    if (state === undefined) return
    state.listeners.delete(listener)
    if (state.listeners.size > 0) return
    // THE WATCHER LIVES EXACTLY AS LONG AS SOMEBODY LISTENS. The STATE stays, because `revision` is a
    // monotonic counter a RECONNECTING client compares its own number against: resetting it to 0 on
    // the last unsubscribe would make every reconnecting surface report a change that never happened.
    if (state.timer !== undefined) clearTimeout(state.timer)
    state.timer = undefined
    for (const handle of state.watchers.values()) {
      try { handle.close() } catch { /* already closed */ }
    }
    state.watchers.clear()
    state.armed.clear()
  }

  /**
   * Arm the directory watches of one workspace, as far as the filesystem allows.
   *
   * THREE THINGS THIS GETS RIGHT, each of them load-bearing:
   *   · the directories may NOT EXIST YET — a fresh workspace, or a session that has never created a
   *     team — and `fs.watch` refuses a path that is not there, so they are created first. That is a
   *     deliberate side effect: `<workspace>/.mpd/team/**` is this plugin's own state root, and
   *     without it the FIRST record (the one an approval writes, possibly from ANOTHER process) would
   *     land with no watch armed and would be invisible to every subscriber;
   *   · a refusal is NOT PERMANENT. Only directories already armed are skipped, so the next call — a
   *     new subscriber, or the next observed change — retries the refused one. That is what keeps a
   *     workspace whose directory appeared LATER from being watched by nobody, forever;
   *   · re-entry is refused, because a watcher's own callback must never arm a second watch for the
   *     directory that produced the event.
   * @param workspace - the workspace to arm.
   * @param state - its feed state.
   */
  private arm(workspace: string, state: WorkspaceFeed): void {
    if (this.disposed || state.arming) return
    state.arming = true
    try {
      // BOTH DIRECTORIES, not the team root alone: `teams.json` is a direct child of the root while a
      // record is a child of `teams/`, and a non-recursive watch reports changes to a directory's own
      // entries only. Linux inotify has no recursive mode at all, so two watches is the portable
      // answer rather than a recursive one.
      /** The directories this workspace's team state lives in, the index's first. */
      const dirs: string[] = [teamRoot(workspace), teamsDir(workspace)]
      // PASS 1 CREATES, PASS 2 ARMS, and the order is load-bearing: creating `teams/` INSIDE a watched
      // team root would be observed by that watch and counted as a change the workspace never made —
      // measured as a `hello` frame carrying `rev: 1` on a workspace that had been written to exactly
      // zero times, because arming a fresh workspace looked like a mutation to itself.
      for (const dir of dirs) {
        if (state.armed.has(dir)) continue
        // A directory that cannot be created is reported by the arming pass below, with the error the
        // caller cares about (the watch that could not be armed) rather than this one's.
        try { mkdirSync(dir, { recursive: true }) } catch { /* the watch below reports the refusal */ }
      }
      for (const dir of dirs) {
        if (state.armed.has(dir)) continue
        try {
          state.watchers.set(dir, this.watchFor(dir, (): void => { this.notify(workspace) }))
          state.armed.add(dir)
          if (state.reported) {
            state.reported = false
            this.warn(`[mpd-team-core] team change feed: watch armed for ${dir}`)
          }
        } catch (error) {
          // ONE BOUNDED LINE, never one per write: an unwritable workspace must not turn every team
          // mutation into a log entry. The line says which fact is missing, so a reader can tell
          // "in-process only" from "watching".
          if (state.reported) continue
          state.reported = true
          this.warn(`[mpd-team-core] team change feed: no filesystem watch for ${dir} (${String((error as Error)?.message ?? error)}) — in-process notifications only, a write from ANOTHER process will not be seen`)
        }
      }
    } finally {
      state.arming = false
    }
  }

  /**
   * The state of one workspace, minted on first use.
   * @param workspace - the workspace whose state is wanted.
   * @returns the existing state, or a fresh zeroed one.
   */
  private stateFor(workspace: string): WorkspaceFeed {
    /** The state already held for this workspace, if any. */
    const existing = this.workspaces.get(workspace)
    if (existing !== undefined) return existing
    /** The fresh state: revision 0, nothing subscribed, nothing armed, no window open. */
    const created: WorkspaceFeed = {
      revision: 0,
      listeners: new Set(),
      armed: new Set(),
      watchers: new Map(),
      reported: false,
      listenerReported: false,
      arming: false,
    }
    this.workspaces.set(workspace, created)
    return created
  }
}
