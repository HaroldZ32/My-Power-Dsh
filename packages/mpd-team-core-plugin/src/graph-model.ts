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
//
// NESTED TEAMS (`cellwork` wave 4). A team whose record carries `parentTeamId` is a SUBCELL of that
// team, and the model the parent serves draws it as a BOX: its board is the box's interior, merged and
// ranked on its own by the shared core. This module's whole contribution is the INPUT — it walks the
// records (never the rendered model), turns every live descendant into a group input and lets the core
// apply the attachment rule. A team with no live child supplies no groups at all, which is what keeps a
// flat tree's model byte-identical to the one this package served before nested teams existed.
import { buildModel, plansDirectory, readPlanFile, resolvePlanFile, watchGraph } from "../../mpd-graph-core/src/index.ts"
import type { BoardTask, GraphModel, GraphWatchOptions, GraphWatchTargets, GraphWatcher } from "../../mpd-graph-core/src/index.ts"
import { isLiveTeam, readArchivedPlanIndex } from "./team-lifecycle"
import type { ArchivedPlanIndex } from "./team-lifecycle"
import { listTeams, summariseTeam, taskVisual } from "./team-store"
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

/** One team's cached model, the workspace revision it was built at, and the plan it was built from. */
interface CachedModel {
  /** The feed revision observed when the model was built. */
  revision: number
  /**
   * The plan path this model was built from, or undefined when the workspace had none.
   *
   * PART OF THE KEY, not a note: the newest-plan fallback can start resolving a DIFFERENT file while
   * the team and the feed revision are unchanged, and a revision-only check would keep serving a
   * model built from the previous plan — a wrong picture with no event to correct it.
   */
  planPath: string | undefined
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
 * The board rows of ONE NESTED team, with every id qualified by that team — the join key made unique.
 *
 * WHY THIS EXISTS (contract Amendment 7). Every team mints its tasks from the same `T1..Tn` space, and
 * the model's node id is the key BOTH renderers draw by — so two teams' `T1` would be one node in the
 * merged model, and `buildModel` refuses a duplicate outright. The team plane therefore qualifies a
 * nested team's ids with its own id (`<teamId>::<taskId>`, the spelling `dispatch.ts#ledgerKey` already
 * uses), and the ROOT frame keeps BARE ids: a caller asking for `/state` or a rank by id sees exactly
 * the ids the outer team's board carries, unchanged.
 *
 * A BLOCKER THAT NAMES A TASK OF THIS FRAME is this frame's node, so it wears the same qualified
 * spelling. Anything else was authored as a CROSS-FRAME reference and is kept VERBATIM: the parent's
 * bare `T3` and a sibling subcell's `teamB::T2` are exactly how the attachment rule finds the frame
 * border to anchor on.
 * @param record - the nested team whose board is being framed.
 * @returns the rows, id-qualified, in board order.
 */
function framedBoardOf(record: TeamRecord): BoardTask[] {
  /** This team's own task ids, so a reference that names one of them is qualified with it. */
  const own = new Set(record.tasks.map((task) => task.id))
  return boardOf(record).map((row) => ({
    ...row,
    id: `${record.teamId}::${row.id}`,
    blockedBy: (row.blockedBy ?? []).map((reference) => own.has(reference) ? `${record.teamId}::${reference}` : reference),
  }))
}

/**
 * One group handed to the shared core, declared STRUCTURALLY rather than imported.
 *
 * WHY NOT THE CORE'S OWN `GraphGroupInput`: this file's cross-package import into `mpd-graph-core` is a
 * FROZEN inventory entry matched by its exact statement (the independence gate in
 * `packages/mpd-dsh-adapter-plugin/test/`), so naming one more type on it would force an inventory
 * change for a shape this module only CONSTRUCTS. The repository's own convention for that situation is
 * this one: declare the slice, and let assignability keep it honest — the value is passed straight to
 * `buildModel`, so a drift in the real type reddens the full-program typecheck instead of drifting.
 */
interface GroupInput {
  /** The frame's id: the child team's own id, which is also its pseudo-node id in the parent frame. */
  id: string
  /** The frame's display title, drawn on the box border: the child team's name. */
  label: string
  /** The child's own board rows, id-qualified by {@link framedBoardOf}. */
  board: readonly BoardTask[]
  /** The child's own live children, recursively. */
  groups?: readonly GroupInput[]
}

/**
 * The nesting input of one team's model: every LIVE descendant team as a frame, recursively.
 *
 * THE RECORD IS THE SOURCE OF TRUTH, the model is derived: a team nests where its own `parentTeamId`
 * points, so this walks the records and hands the shared core the grouped BOARD ROWS of each child —
 * the core then merges, ranks and re-anchors every edge on its own (see `GraphGroup` in
 * `mpd-graph-core/src/types.ts` for the rule). Two deliberate reads:
 *
 *   - LIVENESS. A child whose phase is terminal, or whose plan was archived without approval, is not
 *     drawn: a finished subcell is history, and a box inside a live team that nobody can act on would
 *     be a picture of work that no longer exists. The archive index is read ONCE per build and reused
 *     for every child, which is why the cache is keyed by the feed revision (a team write, an archive
 *     write and an ending all bump it).
 *   - NO CYCLE. The chain is walked from `parentTeamId` upward by construction, so a hand-edited record
 *     that loops would be walked forever. The `seen` set makes the projection terminate and REPORTS the
 *     corruption once instead of throwing into a render — a tool refuses such a link long before it can
 *     be written (`agent_teams_plan` validates at create, at edit and at approve).
 *
 * A child's interior gets NO plan: the plan markdown is a WORKSPACE document (the newest one resolved
 * for this workspace), and merging it into a subcell's box would draw the parent's plan-only ghosts
 * inside a child that never declared them.
 * @param workspace - the workspace the records live in.
 * @param parentTeamId - the team whose children are collected.
 * @param archive - the archive index, read once by the caller for liveness.
 * @param warn - the row's bounded diagnostic sink, when one was injected.
 * @param seen - the ids already walked, so a corrupt chain terminates.
 * @returns one input per live child, ordered by team id (the core sorts again; this keeps the walk stable).
 */
function groupInputsOf(
  workspace: string,
  parentTeamId: string,
  archive: ArchivedPlanIndex,
  warn: ((line: string) => void) | undefined,
  seen: Set<string>,
): GroupInput[] {
  /** The live children of this team, in a stated order rather than the directory's. */
  const children = listTeams(workspace)
    .filter((record) => record.parentTeamId === parentTeamId)
    .sort((left, right) => (left.teamId < right.teamId ? -1 : left.teamId > right.teamId ? 1 : 0))
  /** The frames collected so far. */
  const inputs: GroupInput[] = []
  for (const child of children) {
    if (seen.has(child.teamId)) {
      warn?.(`[mpd-team-core] team ${child.teamId} is nested inside ${parentTeamId}, which is already on its own parent chain — the record was edited by hand; the projection skips the repeat`)
      continue
    }
    if (!isLiveTeam(child, archive)) continue
    seen.add(child.teamId)
    /** This child's own frames, collected before it is returned so the recursion is honest. */
    const nested = groupInputsOf(workspace, child.teamId, archive, warn, seen)
    inputs.push({
      id: child.teamId,
      label: child.name,
      // THE CHILD'S OWN ROWS, id-qualified: see {@link framedBoardOf} for why the child cannot keep the
      // bare `T1..Tn` this team's board also uses.
      board: framedBoardOf(child),
      ...(nested.length === 0 ? {} : { groups: nested }),
    })
  }
  return inputs
}

/**
 * The `groups` half of a {@link buildModel} input, or NO KEY AT ALL when the team has no live child.
 *
 * The absence is the backward guarantee: `mpd-graph-core` omits `GraphModel.groups` when it was given
 * none, so a flat team's model is the exact value (and the exact bytes) both planes already draw. The
 * archive index is read here, once per build, because liveness is a property of the CHILD's plan
 * archive rather than of the parent's board.
 * @param workspace - the workspace the records live in.
 * @param record - the team whose model is being built (its own id roots the walk).
 * @param warn - the row's bounded diagnostic sink, when one was injected.
 * @returns an object spread into the build input: `{}` for a childless team, `{ groups }` otherwise.
 */
function groupsOf(workspace: string, record: TeamRecord, warn: ((line: string) => void) | undefined): { groups?: readonly GroupInput[] } {
  /** Every live descendant of this team, nested as deep as the records go. */
  const groups = groupInputsOf(workspace, record.teamId, readArchivedPlanIndex(workspace), warn, new Set([record.teamId]))
  return groups.length === 0 ? {} : { groups }
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
   * The model for one team, built if the cache is cold, the revision moved, or the PLAN moved.
   *
   * THE KEY IS THE TEAM ID, never the workspace alone: a session must receive ITS team's model, or a
   * plan-only ghost from the principal team would appear in a different team's DAG. The plan path is
   * resolved ONCE per read and is part of the validity check, so the cache, the watcher and the merge
   * can never be looking at three different files.
   * @param workspace - the CALLING SESSION's workspace root.
   * @param record - the team record the caller already read, so this never resolves sessions to teams.
   * @returns the shared model, or `undefined` when it could not be built.
   */
  get(workspace: string, record: TeamRecord): GraphModel | undefined {
    if (this.disposed) return undefined
    try {
      // RESOLVED EXACTLY ONCE: this value keys the cache, arms the watcher and is read for the merge.
      // A second resolution anywhere is how the cache and the watch come to follow different files.
      /** The plan this read follows, or undefined when the workspace has none yet. */
      const planPath = resolvePlanFile(workspace)
      this.ensurePlanWatch(workspace, planPath)
      /** The revision the cache entry must match to still be valid. */
      const revision = this.deps.revision(workspace)
      /** This team's cache slot. */
      const key = workspace + "\u0000" + record.teamId
      /** The entry already held, when there is one. */
      const cached = this.cache.get(key)
      // BOTH KEYS ARE LOAD-BEARING: the revision catches a team write, the plan path catches a
      // newest-plan swap that fired no team event at all.
      if (cached !== undefined && cached.revision === revision && cached.planPath === planPath) return cached.model
      /** The freshly merged model: the board is authoritative, the plan is intent. */
      const model = buildModel({
        board: boardOf(record),
        plan: readPlanFile(planPath),
        // THE NESTING INPUT, OMITTED WHEN THE TEAM HAS NO LIVE CHILD: a flat tree's model therefore
        // carries no `groups` key at all and stays byte-identical to the one this row served before
        // nested teams existed (the backward guarantee is a test, not an intention).
        ...groupsOf(workspace, record, this.deps.warn),
      })
      this.cache.set(key, { revision, planPath, model })
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
   * resolved PLAN FILE and the plans DIRECTORY; the board directory is already watched by the feed, and
   * arming it twice would be the duplication the one-substrate rule forbids.
   *
   * THE DIRECTORY IS ARMED EVEN WHEN NO PLAN EXISTS YET: the newest-plan fallback means a file created
   * later — or a newer one that becomes the answer — must produce a batch, and a watcher bound to one
   * path would never see it. The directory target tracks the whole `*.md` set, so a swap is caught.
   * @param workspace - the workspace whose plan is followed.
   * @param planPath - the path resolved by the caller, so the watch and the cache cannot split.
   */
  private ensurePlanWatch(workspace: string, planPath: string | undefined): void {
    /** The watch already armed for this workspace, when there is one. */
    const held = this.watchers.get(workspace)
    if (held !== undefined && held.planPath === planPath) return
    if (held !== undefined) {
      try { held.watcher.close() } catch { /* already closed */ }
      this.watchers.delete(workspace)
    }
    try {
      /** The watcher door, the injected one in an arm and `watchGraph` in production. */
      const make = this.deps.watch ?? watchGraph
      // THE PLANS DIRECTORY SET IS ALWAYS ARMED: without it, the first plan file ever created in a
      // workspace would fire nothing — the "no plan yet" blind spot — and a newer file replacing the
      // resolved answer would fire nothing either.
      /** The live watcher. */
      const watcher = make({
        ...(planPath === undefined ? {} : { planFile: planPath }),
        plansDir: plansDirectory(workspace),
      }, {
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
