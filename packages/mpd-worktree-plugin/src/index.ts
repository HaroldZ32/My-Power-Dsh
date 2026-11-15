// mpd-worktree-plugin: one git worktree + branch per write-capable team/cellwork member, forwarded as
// the child session's EFFECTIVE cwd, so members write in parallel without sharing `.git/HEAD`.
//
// What this row owns (frozen contract: `.mpd/plans/agent-worktrees.md` §3 Lane A):
//   * the five `mpd_worktree_*` tools (create / list / status / merge / remove) and their state file
//     `<ws>/.mpd/worktrees/index.json` (atomic write, tolerant read, in-process critical section);
//   * the `mpdWorktree` service (`createForMember` / `cwdForMember`) — the ONLY surface the team-core
//     and cellwork lanes call, which NEVER throws: a degraded spawn is today's shared-checkout
//     behaviour plus ONE log line (D4);
//   * the config knobs in `src/config.ts` (row config, optionally overlaid by `.mpd/mpd.jsonc`
//     `worktree.*` through the composed `mpdConfig` service).
//
// What this row deliberately does NOT do: any adapter/spawn change (Lane B), any wiring into a member
// spawn site or the compaction reseed (Lane C), and any merge automation — the captain merges by hand.
//
// Harness seams go through `mpd-dsh-adapter` only (AGENTS.md §6): `registerTool` and `rowLog` are the
// two this row uses, and `ctx.provide` publishes the service without touching a harness service.
import { DSH_SEAM_TOOLS, dshSeamInject, resolveDshAdapter, type DshAdapter, type DshToolDef } from "../../mpd-dsh-adapter-plugin/src/index.ts"
import { effectiveConfig, type Config } from "./config.ts"
import {
  createWorktree,
  createWorktreeService,
  listWorktrees,
  mergeWorktree,
  removeWorktree,
  worktreeStatus,
  type CreateArgs,
  type MergeArgs,
  type MemberRef,
  type RemoveArgs,
  type WorktreeDeps,
} from "./ops.ts"

/** The cordis row id this plugin registers under; the bundle patch mounts it as `mpd-worktree`. */
export const name = "mpd-worktree"

/** Cordis service ids this row waits for: the tool registrar is its only hard seam. */
export const inject = dshSeamInject(DSH_SEAM_TOOLS)

/** The row's own log base name (`<ws>/.mpd/logs/mpd-worktree.log`). */
const LOG_ROW = "mpd-worktree"

/** The service id the team-core and cellwork lanes resolve with `ctx.get("mpdWorktree", false)`. */
export const WORKTREE_SERVICE = "mpdWorktree"

/** The five tool names this row must register; the boot line counts against this list. */
const TOOL_NAMES: readonly string[] = [
  "mpd_worktree_create",
  "mpd_worktree_list",
  "mpd_worktree_status",
  "mpd_worktree_merge",
  "mpd_worktree_remove",
]

/**
 * One-line description of a thrown value, for the degradation log lines.
 * @param error whatever was thrown.
 * @returns the message, or the stringified value.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The row entry point: registers the five tools and publishes the `mpdWorktree` service.
 * Never throws out of `apply` — a seam or registration failure is ONE log line, not a broken boot.
 * @param ctx the cordis context (only `resolveDshAdapter` and `ctx.provide` are read).
 * @param config the row config from `cordis.patch.yml`.
 * @returns nothing.
 */
export function apply(ctx: unknown, config: Config = {}): void {
  /** The shared adapter: the ONE contact surface with the harness tool seam (AGENTS.md §6). */
  const dsh: DshAdapter = resolveDshAdapter(ctx as never)
  /** The effective config: the row config with the optional `.mpd/mpd.jsonc` `worktree.*` overlay. */
  const resolved = effectiveConfig(ctx, config)
  // R5: a row never prints. The adapter's per-row file log is the sink, and the sink itself may
  // degrade on a headless boot, so even the log call is contained.
  /** Append one diagnostic line to this row's own log file. */
  const log = (line: string): void => {
    try {
      dsh.rowLog(LOG_ROW, line)
    } catch {
      // The sink is the LAST fallback; there is nowhere further to report a failure to report.
    }
  }

  if (!resolved.enabled) {
    log("[mpd-worktree] disabled by config (worktree.enabled=false): no tools and no mpdWorktree service")
    return
  }

  // The workspace root is resolved PER CALL from the exec (never cached, never chdir), because one
  // host serves many sessions with different workspaces (AGENTS.md §6).
  /** The calling session's workspace root for one call. */
  const rootOf = (exec?: unknown): string => {
    try {
      return dsh.workspaceRoot(exec as never)
    } catch {
      return process.cwd()
    }
  }
  /** The call dependencies for one tool invocation. */
  const depsFor = (exec: unknown): WorktreeDeps => ({ root: rootOf(exec), config: resolved, log })
  /** Registers one tool, containing a duplicate/invalid registration as ONE line instead of a boot failure. */
  const register = (definition: DshToolDef): void => {
    try {
      dsh.registerTool(definition)
    } catch (error) {
      log(`[mpd-worktree] tool "${definition.name}" not registered: ` + messageOf(error))
    }
  }

  register({
    name: "mpd_worktree_create",
    description:
      "Create a git worktree for an agent under <workspace>/.mpd/worktrees on a new branch (default agent/<name>). " +
      "The path MUST stay inside the workspace (D2: a member's sandbox fence is the parent workspace). " +
      "Refuses an existing path, a registered name, a branch that already exists and a protected branch name " +
      "(worktree.protectedBranches).",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Worktree name: [a-z0-9][a-z0-9._-]{0,79}; also the directory segment." },
        teamId: { type: "string", description: "Optional team id; with member it forms the record key <teamId>/<member>." },
        member: { type: "string", description: "Optional member name; with teamId it forms the record key <teamId>/<member>." },
        base: { type: "string", description: "Base ref/SHA; default is the row config's base, then the main checkout's HEAD." },
        branch: { type: "string", description: "Branch to create; default <branchPrefix><name>." },
        repo: { type: "string", description: "Repository directory; default the row config's repo, then the workspace root." },
      },
      required: ["name"],
    },
    execute: (args: CreateArgs, exec: unknown) => createWorktree(depsFor(exec), args),
  })

  register({
    name: "mpd_worktree_list",
    description:
      "List the worktrees this row recorded, joined with `git worktree list --porcelain`: name, path, branch, repo, " +
      "exists, dirty, ahead/behind against the main checkout's current branch, and merged.",
    parameters: { type: "object", properties: {} },
    execute: (_args: unknown, exec: unknown) => listWorktrees(depsFor(exec)),
  })

  register({
    name: "mpd_worktree_status",
    description: "The same enriched record as mpd_worktree_list, for ONE recorded worktree; an unknown name is a refusal listing the known ones.",
    parameters: {
      type: "object",
      properties: { name: { type: "string", description: "The recorded worktree name or its key." } },
      required: ["name"],
    },
    execute: (args: { name: string }, exec: unknown) => worktreeStatus(depsFor(exec), args?.name),
  })

  register({
    name: "mpd_worktree_merge",
    description:
      "Merge a worktree branch into the main checkout's CURRENT branch with `git merge --no-ff`. Refuses a detached or " +
      "tracked-dirty main checkout, a target that is not checked out there, and a protected branch without force:true. " +
      "A conflict aborts the merge and returns { merged:false, conflicts }, changing nothing.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "The recorded worktree name or its key." },
        into: { type: "string", description: "Target branch; default the main checkout's current branch (it must already be checked out there)." },
        force: { type: "boolean", description: "Merge into a protected branch deliberately (worktree.protectedBranches)." },
      },
      required: ["name"],
    },
    execute: (args: MergeArgs, exec: unknown) => mergeWorktree(depsFor(exec), args),
  })

  register({
    name: "mpd_worktree_remove",
    description:
      "Remove a recorded worktree directory and delete its branch. Refuses a dirty or unmerged worktree without force:true. " +
      "A missing directory is pruned (not an error); the record is marked removed.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "The recorded worktree name or its key." },
        force: { type: "boolean", description: "Discard uncommitted changes and unmerged commits." },
      },
      required: ["name"],
    },
    execute: (args: RemoveArgs, exec: unknown) => removeWorktree(depsFor(exec), args),
  })

  // The service the team-core and cellwork lanes consume. Its methods never throw: a workspace that is
  // not a repository, a failed create or a disabled row all degrade to `undefined` (the spawn then
  // keeps today's shared-checkout behaviour) with ONE log line.
  try {
    /** The service object published as `mpdWorktree`. */
    const service = createWorktreeService({ rootOf, config: resolved, log })
    /** The context's provide surface, when this composition has one. */
    const provide = (ctx as { provide?: (id: string, value: unknown) => void } | undefined)?.provide
    if (typeof provide === "function") provide(WORKTREE_SERVICE, service)
    else log("[mpd-worktree] ctx.provide is unavailable: the mpdWorktree service was NOT published (tools still work)")
  } catch (error) {
    log("[mpd-worktree] publishing the mpdWorktree service failed: " + messageOf(error))
  }

  // ONE boot line naming what really registered, so "the row is mounted" is distinguishable from
  // "the tools exist"; the state path is the workspace-relative default rather than a frozen absolute.
  log(`[mpd-worktree] ready: ${TOOL_NAMES.join(", ")}; state <workspace>/.mpd/worktrees/index.json`)
}

/** Re-exported so a caller that only needs the member shape does not import the operation module. */
export type { MemberRef }
