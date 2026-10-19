// THE HOST'S ONE GRAPH COMPUTATION SITE: the shared model's cache, and the plan-file watch that
// invalidates it.
//
// WHY THIS FILE EXISTS (`.mpd/plans/living-graph.md`, Amendment 3). Both planes draw ONE model, and the
// document says where it is computed: the shared core (`mpd-graph-core`) owns the rank derivation and
// the board/plan merge, and THIS plugin — the owner of the team record and of
// `/plugins/mpd-team/state` — computes the model once per team per change and hands the SAME value to
// both projections: the `mpdTeams` service the TUI reads, and the web payload the browser renders. A
// plane that recomputed a rank would be a second implementation free to drift, and the web factory
// cannot even import the core (it is spliced into the client bundle as a source body), which is why
// SERVING the value is the shape that works.
//
// PER TEAM, NOT PER WORKSPACE. The read surface is session-scoped: a session draws ITS OWN team, and the
// workspace principal is only the session-less fallback. A workspace-scoped model would hand a session
// the principal team's plan-only ghosts and draw a plausible wrong picture, so the cache key carries the
// team id and the fallback exists only for the caller that named no team.
//
// CACHE AND INVALIDATION. A model is built ON DEMAND and cached against the workspace's change-feed
// revision. A team write bumps that revision through the feed's own store hook. A PLAN write does not,
// because the feed watches `.mpd/team/**` and not `.mpd/plans/*.md` — so this module arms the core's
// plan watcher ONCE per workspace and funnels its batches into `feed.notify`, which is what makes a
// plan-only edit invalidate the model through the SAME one notification path (no second channel for a
// TUI surface to learn about).
import { buildModel, readPlanFile, resolvePlanFile, watchGraph } from "../../mpd-graph-core/src/index.ts"
import type { BoardTask, GraphModel, GraphWatchOptions, GraphWatchTargets, GraphWatcher } from "../../mpd-graph-core/src/index.ts"
import { summariseTeam, taskVisual } from "./team-store"
import type { TeamRecord } from "./team-store"

/**
 * What a {@link GraphModels} cache needs from the plugin row that owns it.
 *
 * The revision and the notify hook are the SAME change feed the `/events` route streams, so a model
 * invalidation and a rendered refresh are one event rather than two observers of one file.
 */
export interface GraphModelDeps {
  /** The change feed's per-workspace revision; a different value means a cached model is stale. */
  revision: (workspace: string) => number
  /** The change feed's own entry point, which a plan-file batch funnels into. */
  notify: (workspace: string) => void
  /** A bounded diagnostic sink; an omitted one swallows the degradation lines. */
  warn?: (line: string) => void
  /** The watcher factory, injected so an arm can drive batches without a filesystem. */
  watch?: (targets: GraphWatchTargets, options: GraphWatchOptions) => GraphWatcher
}

/** One team's cached model, and the workspace revision it was built at. */
interface CachedModel {
  /** The feed revision observed when the model was built. */
  revision: number
  /** The model itself: plain JSON, the same value both projections carry. */
  model: GraphModel
}

/** The plan watcher armed for one workspace, with the path it was armed for. */
interface ArmedPlanWatch {
  /** The live watcher. */
  watcher: GraphWatcher
  /** The plan path resolved when the watch was armed, so a beacon switch can re-arm. */
  planPath: string | undefined
}

/**
 * The board rows the merge consumes, projected from one team record.
 *
 * The VISUAL state is computed here with the SAME function the web payload and the TUI use, because
 * only this plane knows the OPT-1 rule (a failed dependency releases its dependents); the served depth
 * is the store's own summary, which the core uses ONLY as its documented rank fallback.
 * @param record - the team record to project.
 * @returns one board row per task, in board order.
 */
function boardOf(record: TeamRecord): BoardTask[] {
  /** The tallies and per-task served depths, computed once for the whole board. */
  const summary = summariseTeam(record)
  return record.tasks.map((task) => ({
    id: task.id,
    subject: task.subject,
    kind: task.kind,
    status: task.status,
    ...(task.owner === undefined ? {} : { owner: task.owner }),
    blockedBy: [...task.blockedBy],
    depth: summary.depths.get(task.id) ?? 0,
    visual: taskVisual(task, record.tasks),
    ...(task.attempt === undefined ? {} : { attempt: task.attempt }),
  }))
}

/** One error, rendered for a bounded diagnostic line. */
function messageOf(error: unknown): string {
  return String((error as Error)?.message ?? error)
}

/**
 * ONE model per (workspace, team), built on demand and invalidated by the change feed.
 *
 * Every member is synchronous and non-throwing: `get` is called from a tool/render path and from a web
 * route, and neither may be taken down by a malformed record, an unreadable plan or a refused watch.
 */
export class GraphModels {
  /** The hooks this cache reads and notifies through. */
  private readonly deps: GraphModelDeps
  /** The cached model per `workspace + NUL + teamId`. */
  private readonly cache = new Map<string, CachedModel>()
  /** The plan watcher armed per workspace. */
  private readonly watchers = new Map<string, ArmedPlanWatch>()
  /** Whether {@link GraphModels.dispose} has run; a disposed cache builds nothing. */
  private disposed = false

  /**
   * Build a cache over the change feed's revision and notification doors.
   * @param deps - the revision read, the notify hook, the diagnostic sink and the watcher factory.
   */
  constructor(deps: GraphModelDeps) {
    this.deps = deps
  }

  /**
   * The model for one team, built if the cache is cold or the workspace's revision moved.
   *
   * THE KEY IS THE TEAM ID, never the workspace alone: a session must receive ITS team's model, or a
   * plan-only ghost from the principal team would appear in a different team's DAG.
   * @param workspace - the CALLING SESSION's workspace root.
   * @param record - the team record the caller already read, so this never resolves sessions to teams.
   * @returns the shared model, or `undefined` when it could not be built.
   */
  get(workspace: string, record: TeamRecord): GraphModel | undefined {
    if (this.disposed) return undefined
    try {
      this.ensurePlanWatch(workspace)
      /** The revision the cache entry must match to still be valid. */
      const revision = this.deps.revision(workspace)
      /** This team's cache slot. */
      const key = workspace + "\u0000" + record.teamId
      /** The entry already held, when there is one. */
      const cached = this.cache.get(key)
      if (cached !== undefined && cached.revision === revision) return cached.model
      /** The freshly merged model: the board is authoritative, the plan is intent. */
      const model = buildModel({ board: boardOf(record), plan: readPlanFile(resolvePlanFile(workspace)) })
      this.cache.set(key, { revision, model })
      return model
    } catch (error) {
      this.deps.warn?.(`[mpd-team-core] building the graph model for ${record.teamId} failed: ${messageOf(error)}`)
      return undefined
    }
  }

  /**
   * Arm the core's plan watcher for one workspace, re-arming when the resolved plan path changes.
   *
   * A plan-only edit fires no notification from the team feed (it watches `.mpd/team/**`), so this is
   * the ONE observer that turns such an edit into the feed's own revision bump. The watcher follows the
   * PLAN FILE only; the board directory is already watched by the feed, and arming it twice would be the
   * duplication the one-substrate rule forbids.
   * @param workspace - the workspace whose plan file is followed.
   */
  private ensurePlanWatch(workspace: string): void {
    /** The plan this workspace currently follows, or undefined when it has none. */
    const planPath = resolvePlanFile(workspace)
    /** The watch already armed for this workspace, when there is one. */
    const held = this.watchers.get(workspace)
    if (held !== undefined && held.planPath === planPath) return
    if (held !== undefined) {
      try { held.watcher.close() } catch { /* already closed */ }
      this.watchers.delete(workspace)
    }
    // NO PLAN FILE: nothing to watch yet. A later `get` re-resolves, so the watcher arms as soon as a
    // plan appears — the same self-healing shape the change feed uses for a directory that did not exist.
    if (planPath === undefined) return
    try {
      /** The watcher door, the injected one in an arm and `watchGraph` in production. */
      const make = this.deps.watch ?? watchGraph
      /** The live watcher. */
      const watcher = make({ planFile: planPath }, {
        onChange: (): void => {
          // BOTH HALVES MATTER: the cached model must be dropped, and the feed must publish the change so
          // a passive panel re-reads it without waiting for a user action.
          this.invalidate(workspace)
          this.deps.notify(workspace)
        },
        onError: (error: unknown): void => {
          this.deps.warn?.(`[mpd-team-core] the graph plan watch for ${workspace} failed: ${messageOf(error)}`)
        },
      })
      this.watchers.set(workspace, { watcher, planPath })
    } catch (error) {
      // A refused watch degrades to the polling fallback both planes already have; it must not redden a
      // render or a route, and it is REPORTED once so the degradation is visible rather than silent.
      this.deps.warn?.(`[mpd-team-core] no graph plan watch for ${workspace} (${messageOf(error)}) — the planes keep their polling fallback`)
    }
  }

  /**
   * Drop every cached model for one workspace, keeping the watcher armed.
   * @param workspace - the workspace whose models are stale.
   */
  private invalidate(workspace: string): void {
    /** The key prefix every team of this workspace shares. */
    const prefix = workspace + "\u0000"
    for (const key of [...this.cache.keys()]) if (key.startsWith(prefix)) this.cache.delete(key)
  }

  /** Drop every cached model and close every watcher. Idempotent. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const armed of this.watchers.values()) {
      try { armed.watcher.close() } catch { /* already closed */ }
    }
    this.watchers.clear()
    this.cache.clear()
  }
}
