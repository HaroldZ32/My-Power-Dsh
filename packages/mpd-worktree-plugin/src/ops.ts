// The five worktree operations and the member service, expressed against a DEPENDENCY object
// (`root`, `config`, `log`) rather than a cordis context — so every rule in the contract is unit
// testable against a real temporary git repository, with no harness stub.
//
// Error policy: a REFUSAL throws {@link WorktreeError} carrying a machine-readable `code`; an expected
// NEGOTIATION (a merge conflict) is DATA in the return value (`{ merged: false, conflicts }`) and never
// a throw. The service methods NEVER throw — they degrade to `undefined` plus ONE log line (D4).
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import type { ResolvedConfig } from "./config"
import {
  addWorktree,
  branchExists,
  deleteBranch,
  headOf,
  headSha,
  isAncestor,
  isDirty,
  isValidBranch,
  mergeBranch,
  pruneWorktrees,
  removeWorktreePath,
  repoTopLevel,
  resolvesToCommit,
  revCount,
  trackedDirty,
  worktreePaths,
} from "./git"
import { canonicalPath, isUnderRoot, isValidName, slugify } from "./paths"
import { readIndex, withLock, writeIndex, type WorktreeEntry, type WorktreeStatus } from "./store"

/** Everything one operation needs: the CALLING session's workspace root, the effective config, one log sink. */
export interface WorktreeDeps {
  /** Absolute workspace root of the calling session (resolved per call, never cached). */
  root: string
  /** The effective row config. */
  config: ResolvedConfig
  /** One-line row logger; the row never prints to a terminal. */
  log: (line: string) => void
}

/** A typed refusal: `code` is stable and machine-readable, `message` names the rule and the remedy. */
export class WorktreeError extends Error {
  /** The stable refusal code (`invalid-name`, `outside-workspace`, `protected-branch`, …). */
  readonly code: string

  /**
   * @param code the stable refusal code.
   * @param message the human explanation, which must state the rule and the remedy.
   */
  constructor(code: string, message: string) {
    super("[mpd-worktree] " + code + ": " + message)
    this.code = code
    this.name = "WorktreeError"
  }
}

/**
 * The absolute worktree parent directory for one call.
 * @param deps the call dependencies.
 * @returns `config.dir` resolved against the workspace root, or `<root>/.mpd/worktrees`.
 */
export function worktreeDir(deps: WorktreeDeps): string {
  return deps.config.dir === undefined ? join(deps.root, ".mpd", "worktrees") : resolve(deps.root, deps.config.dir)
}

/**
 * The absolute state-file path for one call.
 * @param deps the call dependencies.
 * @returns `<worktreeDir>/index.json`.
 */
export function indexFile(deps: WorktreeDeps): string {
  return join(worktreeDir(deps), "index.json")
}

/**
 * Resolves the repository an operation works on.
 * @param deps the call dependencies.
 * @param override an explicit `repo` argument, which outranks the row config.
 * @returns git's canonical toplevel for the chosen directory.
 * @throws WorktreeError `not-a-repo` when the directory is not inside a git work tree.
 */
function resolveRepo(deps: WorktreeDeps, override?: string): string {
  /** The explicit argument first, then the row config; both are directories, not toplevels. */
  const candidate = override ?? deps.config.repo
  /** The absolute candidate: a relative row-config path resolves against the workspace root. */
  const dir = candidate === undefined ? deps.root : resolve(deps.root, candidate)
  /** git's own canonical answer, or undefined for a non-repository. */
  const top = repoTopLevel(dir)
  if (top === undefined) {
    throw new WorktreeError(
      "not-a-repo",
      `"${dir}" is not a git repository (git rev-parse --show-toplevel failed); pass repo or configure worktree.repo`,
    )
  }
  return top
}

/** Arguments of `mpd_worktree_create`. */
export interface CreateArgs {
  /** The worktree name; also the directory segment under the worktree parent. */
  name: string
  /** Optional team id: with `member`, it forms the record key `<teamId>/<member>`. */
  teamId?: string
  /** Optional member name: with `teamId`, it forms the record key `<teamId>/<member>`. */
  member?: string
  /** Base ref/SHA; default is the row config's base, else the main checkout's current HEAD. */
  base?: string
  /** Branch to create; default is `<branchPrefix><name>`. */
  branch?: string
  /** Repository directory; default is the row config's repo, else the workspace root. */
  repo?: string
}

/** The create operation's answer, as the contract fixes it. */
export interface CreateResult {
  /** The recorded name. */
  name: string
  /** The absolute worktree directory. */
  path: string
  /** The branch that was created. */
  branch: string
  /** The ref/SHA the branch started from. */
  base: string
  /** The repository the worktree belongs to. */
  repo: string
}

/** One live-enriched worktree record, the shape `list` and `status` report. */
export interface WorktreeRecord {
  /** The recorded name. */
  name: string
  /** The absolute worktree directory. */
  path: string
  /** The branch created for it. */
  branch: string
  /** The repository it belongs to. */
  repo: string
  /** Whether the directory exists on disk. */
  exists: boolean
  /** Whether the worktree has uncommitted changes (false when it is absent or unmanaged). */
  dirty: boolean
  /** Commits the branch has that the main checkout does not. */
  ahead: number
  /** Commits the main checkout has that the branch does not. */
  behind: number
  /** Whether every commit of the branch is reachable from the main checkout's current ref. */
  merged: boolean
}

/** Arguments of `mpd_worktree_merge`. */
export interface MergeArgs {
  /** The recorded worktree name (or its key). */
  name: string
  /** Target branch; default is the main checkout's current branch, and it must already be checked out there. */
  into?: string
  /** Whether a protected target branch may be merged into. */
  force?: boolean
}

/** The merge operation's answer: a success carries the commit, a conflict carries the paths and changes nothing. */
export interface MergeResult {
  /** Whether the merge committed. */
  merged: boolean
  /** The merged branch (present on success). */
  branch?: string
  /** The target branch (present on success). */
  into?: string
  /** The merge commit (present on success). */
  commit?: string
  /** The conflicted paths (present on a conflict). */
  conflicts?: string[]
  /** git's explanation when the failure was not a plain conflict, or when the abort itself failed. */
  reason?: string
}

/** Arguments of `mpd_worktree_remove`. */
export interface RemoveArgs {
  /** The recorded worktree name (or its key). */
  name: string
  /** Whether a dirty or unmerged worktree may be discarded. */
  force?: boolean
}

/** The remove operation's answer. */
export interface RemoveResult {
  /** Whether the record is gone from the working tree (a repeat call is idempotent). */
  removed: boolean
  /** The recorded name. */
  name: string
  /** The absolute worktree directory. */
  path: string
  /** The branch the worktree carried. */
  branch: string
  /** Whether the branch was deleted as part of the removal. */
  branchDeleted: boolean
  /** git's explanation when the branch could not be deleted (the record is still marked removed). */
  branchError?: string
}

/** The pair the member service addresses. */
export interface MemberRef {
  /** The owning team's id, as the caller spells it. */
  teamId: string
  /** The member's display name (for example `Senior Engineer`). */
  member: string
}

/** The service surface the team/cellwork lanes consume (`createForMember` / `cwdForMember`). */
export interface MpdWorktreeService {
  /**
   * Creates (or reuses) the worktree of one team member.
   * @param exec the tool exec of the spawn site, used only to resolve the workspace root.
   * @param ref the owning team and member.
   * @returns the worktree path and branch, or undefined when the row degraded (never a throw).
   */
  createForMember: (exec: unknown, ref: MemberRef) => { path: string; branch: string } | undefined
  /**
   * Reads the recorded worktree path of one team member, for the compaction reseed (D8).
   * @param exec the tool exec of the spawn site, used only to resolve the workspace root.
   * @param ref the owning team and member.
   * @returns the existing path, or undefined when no active worktree is recorded (never a throw).
   */
  cwdForMember: (exec: unknown, ref: MemberRef) => string | undefined
}

/** Construction inputs for {@link createWorktreeService}. */
export interface WorktreeServiceOptions {
  /** Resolves the calling session's workspace root for one exec. */
  rootOf: (exec?: unknown) => string
  /** The effective config of the composition. */
  config: ResolvedConfig
  /** One-line row logger. */
  log: (line: string) => void
}

/** The plan one create call executes, after the tool grammar and the caller's overrides are applied. */
interface CreatePlan {
  /** The recorded name. */
  name: string
  /** The absolute directory to create. */
  path: string
  /** The branch to create; undefined means `<branchPrefix>` + a caller-supplied suffix. */
  branch: string
  /** Optional team id for the record. */
  teamId?: string
  /** Optional member name for the record. */
  member?: string
  /** Optional repository override. */
  repo?: string
  /** Optional base override. */
  base?: string
}

/**
 * One-line description of a thrown value, used by the never-throwing service methods.
 * @param error whatever was thrown.
 * @returns the message, or the stringified value.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Looks one record up by display name or key.
 * @param file the state-file path.
 * @param name the name or key the caller supplied.
 * @returns the record.
 * @throws WorktreeError `unknown-worktree` naming every known record.
 */
function findEntry(file: string, name: string): WorktreeEntry {
  /** The index as this call reads it. */
  const index = readIndex(file)
  /** The record addressed by its display name or its key (team entries answer to both). */
  const entry = index.worktrees.find((candidate) => candidate.name === name || candidate.key === name)
  if (entry === undefined) {
    /** The known names, sorted, so a refusal lists what IS addressable. */
    const known = index.worktrees.map((candidate) => candidate.name).sort()
    throw new WorktreeError(
      "unknown-worktree",
      `no worktree named "${name}"` + (known.length === 0 ? "; the index is empty" : "; known: " + known.join(", ")),
    )
  }
  return entry
}

/**
 * Creates one worktree and records it, applying every rule of `mpd_worktree_create` to a plan.
 * @param deps the call dependencies.
 * @param plan the resolved name, path, branch and optional identity.
 * @returns the created record's contract fields.
 */
function createEntry(deps: WorktreeDeps, plan: CreatePlan): CreateResult {
  /** The repository the worktree belongs to (canonical toplevel). */
  const repo = resolveRepo(deps, plan.repo)
  if (!isUnderRoot(deps.root, plan.path)) {
    throw new WorktreeError(
      "outside-workspace",
      `worktree path "${plan.path}" is outside the workspace root "${deps.root}" ` +
        "(D2: a member's sandbox fence is the parent workspace, so an outside-root worktree is unwritable)",
    )
  }
  /** The record identity: the team pair when both halves are known, else `manual/<name>`. */
  const key = plan.teamId !== undefined && plan.member !== undefined ? plan.teamId + "/" + plan.member : "manual/" + plan.name
  /** The state file this mutation serializes on. */
  const file = indexFile(deps)
  return withLock(file, () => {
    /** The index read INSIDE the critical section, so the checks see the file this call will write. */
    const index = readIndex(file)
    /** An active record that already owns this name, key or path. */
    const clash = index.worktrees.find(
      (candidate) =>
        candidate.status === "active" &&
        (candidate.name === plan.name || candidate.key === key || canonicalPath(candidate.path) === canonicalPath(plan.path)),
    )
    if (clash !== undefined) {
      throw new WorktreeError(
        "name-registered",
        `"${plan.name}" is already registered as ${clash.key} (status ${clash.status}, branch ${clash.branch}); ` +
          "remove it first or pick another name",
      )
    }
    // The registry check comes FIRST so a duplicate name is reported as such; an unregistered leftover
    // directory on the target path is a different refusal, and it is checked here.
    if (existsSync(plan.path)) {
      throw new WorktreeError("path-exists", `"${plan.path}" already exists on disk; remove it or pick another name`)
    }
    /** The records the cap counts. */
    const active = index.worktrees.filter((candidate) => candidate.status === "active")
    if (active.length >= deps.config.max) {
      throw new WorktreeError(
        "limit-reached",
        `${active.length} worktrees are active and worktree.max is ${deps.config.max}; remove one first`,
      )
    }
    if (!isValidBranch(repo, plan.branch)) {
      throw new WorktreeError("invalid-branch", `"${plan.branch}" is not a valid branch name (git check-ref-format --branch failed)`)
    }
    if (branchExists(repo, plan.branch)) {
      throw new WorktreeError("branch-exists", `branch "${plan.branch}" already exists in ${repo}; pass a different branch`)
    }
    /** The main checkout's current HEAD, the base fallback. */
    const head = headOf(repo)
    if (head === undefined) {
      throw new WorktreeError("git-failed", `cannot read HEAD of ${repo} (an unborn repository has no base commit)`)
    }
    /** The base ref/SHA: argument, then row config, then the main checkout's HEAD. */
    const base = plan.base ?? deps.config.base ?? head.ref
    if (!resolvesToCommit(repo, base)) {
      throw new WorktreeError("invalid-base", `"${base}" does not resolve to a commit in ${repo}`)
    }
    /** git's failure text for the creation, or undefined on success. */
    const failure = addWorktree(repo, plan.path, plan.branch, base)
    if (failure !== undefined) throw new WorktreeError("git-failed", `git worktree add failed: ${failure}`)
    /** The record this call writes. */
    const entry: WorktreeEntry = {
      key,
      name: plan.name,
      ...(plan.teamId === undefined ? {} : { teamId: plan.teamId }),
      ...(plan.member === undefined ? {} : { member: plan.member }),
      repo,
      path: plan.path,
      branch: plan.branch,
      base,
      createdAt: new Date().toISOString(),
      status: "active",
    }
    /** Older records for the same identity (a removed/merged tombstone) are superseded by this one. */
    const kept = index.worktrees.filter(
      (candidate) => !(candidate.key === key || candidate.name === plan.name || canonicalPath(candidate.path) === canonicalPath(plan.path)),
    )
    writeIndex(file, { version: 1, worktrees: [...kept, entry] })
    return { name: plan.name, path: plan.path, branch: plan.branch, base, repo }
  })
}

/**
 * `mpd_worktree_create`: one worktree under the workspace, on a new branch, recorded in the index.
 * @param deps the call dependencies.
 * @param args the tool arguments.
 * @returns the created record's contract fields.
 */
export function createWorktree(deps: WorktreeDeps, args: CreateArgs): CreateResult {
  /** The name as the caller spelled it, trimmed and validated against the tool grammar. */
  const name = typeof args.name === "string" ? args.name.trim() : ""
  if (!isValidName(name)) {
    throw new WorktreeError("invalid-name", `"${name}" must match [a-z0-9][a-z0-9._-]{0,79}`)
  }
  /** The team half, kept only when it is a non-blank string. */
  const teamId = typeof args.teamId === "string" && args.teamId.trim() !== "" ? args.teamId.trim() : undefined
  /** The member half, kept only when it is a non-blank string. */
  const member = typeof args.member === "string" && args.member.trim() !== "" ? args.member.trim() : undefined
  /** The branch override, trimmed, or the prefix + name default computed by {@link createEntry}'s caller below. */
  const branch = typeof args.branch === "string" && args.branch.trim() !== "" ? args.branch.trim() : deps.config.branchPrefix + name
  /** The base override, trimmed when present. */
  const base = typeof args.base === "string" && args.base.trim() !== "" ? args.base.trim() : undefined
  /** The repository override, trimmed when present. */
  const repo = typeof args.repo === "string" && args.repo.trim() !== "" ? args.repo.trim() : undefined
  return createEntry(deps, {
    name,
    path: resolve(worktreeDir(deps), name),
    branch,
    ...(teamId === undefined ? {} : { teamId }),
    ...(member === undefined ? {} : { member }),
    ...(base === undefined ? {} : { base }),
    ...(repo === undefined ? {} : { repo }),
  })
}

/**
 * Enriches one record with the live git facts `list`/`status` report.
 * @param entry the recorded worktree.
 * @returns the record plus `exists`, `dirty`, `ahead`, `behind` and `merged`.
 */
function recordOf(entry: WorktreeEntry): WorktreeRecord {
  /** Whether the recorded directory still exists on disk. */
  const exists = existsSync(entry.path)
  /** The paths git itself reports as worktrees of the entry's repo. */
  const registered = new Set(worktreePaths(entry.repo).map((path) => canonicalPath(path)))
  // A path git no longer manages must NOT be probed with `git -C`: a stale directory would make git
  // ascend to the parent repository and report the MAIN checkout's status as the worktree's.
  /** Whether git still manages this path, the guard for running git inside it. */
  const managed = registered.has(canonicalPath(entry.path))
  /** The main checkout's current ref, the comparison base for ahead/behind/merged. */
  const head = headOf(entry.repo)
  /** The ahead/behind pair, absent when either side does not resolve. */
  const counts = head === undefined ? undefined : revCount(entry.repo, entry.branch, head.ref)
  return {
    name: entry.name,
    path: entry.path,
    branch: entry.branch,
    repo: entry.repo,
    exists,
    dirty: exists && managed && isDirty(entry.path),
    ahead: counts?.ahead ?? 0,
    behind: counts?.behind ?? 0,
    merged: head !== undefined && branchExists(entry.repo, entry.branch) && isAncestor(entry.repo, entry.branch, head.ref),
  }
}

/**
 * `mpd_worktree_list`: every live record, enriched from `git worktree list --porcelain` and the index.
 * Removed records are tombstones, not worktrees, and are omitted.
 * @param deps the call dependencies.
 * @returns one record per active or merged worktree.
 */
export function listWorktrees(deps: WorktreeDeps): WorktreeRecord[] {
  /** The index as this call reads it. */
  const index = readIndex(indexFile(deps))
  return index.worktrees.filter((entry) => entry.status !== "removed").map((entry) => recordOf(entry))
}

/**
 * `mpd_worktree_status`: the enriched record of one worktree.
 * @param deps the call dependencies.
 * @param name the recorded name or key.
 * @returns the record.
 */
export function worktreeStatus(deps: WorktreeDeps, name: string): WorktreeRecord {
  /** The record the caller addressed. */
  const entry = findEntry(indexFile(deps), typeof name === "string" ? name.trim() : "")
  return recordOf(entry)
}

/**
 * `mpd_worktree_merge`: `--no-ff` merge of a member branch into the main checkout's current branch.
 * Every precondition is a refusal that changes nothing; a conflict aborts and returns its paths.
 * @param deps the call dependencies.
 * @param args the tool arguments.
 * @returns the merge outcome.
 */
export function mergeWorktree(deps: WorktreeDeps, args: MergeArgs): MergeResult {
  /** The state file this call reads and finally updates. */
  const file = indexFile(deps)
  /** The record the caller addressed. */
  const entry = findEntry(file, typeof args.name === "string" ? args.name.trim() : "")
  if (entry.status !== "active") {
    throw new WorktreeError("not-active", `"${entry.name}" is ${entry.status}, not active; nothing to merge`)
  }
  /** The repository, re-canonicalised; a moved checkout refuses instead of guessing. */
  const repo = repoTopLevel(entry.repo)
  if (repo === undefined) {
    throw new WorktreeError("not-a-repo", `repository "${entry.repo}" is not a git checkout any more; refusing to merge`)
  }
  /** The main checkout's current HEAD. */
  const head = headOf(repo)
  if (head === undefined) throw new WorktreeError("git-failed", `cannot read HEAD of ${repo}`)
  if (head.detached) {
    throw new WorktreeError("detached-main", `the main checkout of ${repo} is detached at ${head.ref}; check out a branch before merging`)
  }
  /** The target branch: the explicit argument, else the main checkout's current branch. */
  const into = typeof args.into === "string" && args.into.trim() !== "" ? args.into.trim() : head.ref
  if (into !== head.ref) {
    throw new WorktreeError(
      "into-not-checked-out",
      `"${into}" is not checked out in the main worktree (it is on "${head.ref}"); a --no-ff merge runs in the checked-out branch`,
    )
  }
  if (deps.config.protectedBranches.includes(into) && args.force !== true) {
    throw new WorktreeError(
      "protected-branch",
      `"${into}" is a protected branch (worktree.protectedBranches); pass force:true to merge into it deliberately`,
    )
  }
  if (trackedDirty(repo)) {
    throw new WorktreeError("dirty-main", `the main checkout of ${repo} has uncommitted TRACKED changes; commit or stash them first`)
  }
  /** The merge attempt's outcome. */
  const outcome = mergeBranch(repo, entry.branch, `merge(${entry.key}): ${entry.branch}`)
  if (!outcome.ok) {
    deps.log(`[mpd-worktree] merge of ${entry.branch} into ${into} refused: ` + (outcome.conflicts.length > 0 ? outcome.conflicts.join(", ") : outcome.reason ?? "unknown"))
    return {
      merged: false,
      conflicts: outcome.conflicts,
      ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
    }
  }
  /** The merge commit the main checkout now points at. */
  const commit = headSha(repo) ?? ""
  withLock(file, () => {
    /** The index re-read inside the lock, so the status write lands on the current file. */
    const index = readIndex(file)
    /** The record this merge addresses. */
    const target = index.worktrees.find((candidate) => candidate.key === entry.key)
    if (target !== undefined) {
      target.status = "merged"
      writeIndex(file, index)
    }
  })
  return { merged: true, branch: entry.branch, into, commit }
}

/**
 * `mpd_worktree_remove`: removes the worktree directory and its branch, refusing unforced loss.
 * A missing directory is pruned, not an error.
 * @param deps the call dependencies.
 * @param args the tool arguments.
 * @returns the removal outcome.
 */
export function removeWorktree(deps: WorktreeDeps, args: RemoveArgs): RemoveResult {
  /** The state file this call reads and finally updates. */
  const file = indexFile(deps)
  /** The record the caller addressed. */
  const entry = findEntry(file, typeof args.name === "string" ? args.name.trim() : "")
  if (entry.status === "removed") {
    return { removed: true, name: entry.name, path: entry.path, branch: entry.branch, branchDeleted: false }
  }
  /** The repository, re-canonicalised; a moved checkout refuses instead of deleting the wrong tree. */
  const repo = repoTopLevel(entry.repo)
  if (repo === undefined) {
    throw new WorktreeError("not-a-repo", `repository "${entry.repo}" is not a git checkout any more; refusing to touch it`)
  }
  /** Whether the worktree directory carries uncommitted changes. */
  const dirty = existsSync(entry.path) && isDirty(entry.path)
  /** The main checkout's current ref. */
  const head = headOf(repo)
  /** Whether the branch holds commits the main checkout does not have. */
  const unmerged = head !== undefined && branchExists(repo, entry.branch) && !isAncestor(repo, entry.branch, head.ref)
  /** Whether the caller accepted the loss of commits or uncommitted work. */
  const force = args.force === true
  if ((dirty || unmerged) && !force) {
    throw new WorktreeError(
      dirty ? "dirty-worktree" : "unmerged",
      `"${entry.name}" is ${dirty ? "dirty (uncommitted changes)" : "unmerged (commits the main checkout does not have)"}; pass force:true to discard it`,
    )
  }
  if (existsSync(entry.path)) {
    /** git's failure text for the removal, or undefined. */
    const failure = removeWorktreePath(repo, entry.path, force)
    if (failure !== undefined) throw new WorktreeError("git-failed", `git worktree remove failed: ${failure}`)
  } else {
    // The contract's own rule: a missing path is PRUNED, not an error.
    pruneWorktrees(repo)
  }
  /** Whether the branch still exists after the directory went away. */
  const branchPresent = branchExists(repo, entry.branch)
  /** git's failure text for the branch deletion, or undefined. */
  const branchFailure = branchPresent ? deleteBranch(repo, entry.branch, force) : undefined
  /** The terminal status this removal records. */
  const status: WorktreeStatus = "removed"
  withLock(file, () => {
    /** The index re-read inside the lock, so the tombstone lands on the current file. */
    const index = readIndex(file)
    /** The record this removal addresses. */
    const target = index.worktrees.find((candidate) => candidate.key === entry.key)
    if (target !== undefined) {
      target.status = status
      writeIndex(file, index)
    }
  })
  return {
    removed: true,
    name: entry.name,
    path: entry.path,
    branch: entry.branch,
    branchDeleted: branchPresent && branchFailure === undefined,
    ...(branchFailure === undefined ? {} : { branchError: branchFailure }),
  }
}

/**
 * The D2/D3 worktree of one team member: `<dir>/<teamId>/<memberSlug>` on `agent/<teamId>/<memberSlug>`.
 * IDEMPOTENT per `{teamId, member}`: an existing active record whose directory is present is returned
 * unchanged; a recorded directory that disappeared is dropped (after a prune) and re-created.
 * @param deps the call dependencies.
 * @param ref the owning team and member.
 * @returns the worktree path and branch, or undefined when it could not be created (never a throw).
 */
export function createForMember(deps: WorktreeDeps, ref: MemberRef): { path: string; branch: string } | undefined {
  /** The team segment used in the path and branch. */
  const teamSlug = slugify(ref.teamId)
  /** The member segment used in the path and branch. */
  const memberSlug = slugify(ref.member)
  /** The record key the contract fixes: the caller's own spelling of the pair. */
  const key = ref.teamId + "/" + ref.member
  /** The state file this call reads. */
  const file = indexFile(deps)
  /** An active record for this pair, when one exists. */
  const existing = readIndex(file).worktrees.find((candidate) => candidate.key === key && candidate.status === "active")
  if (existing !== undefined && existsSync(existing.path)) return { path: existing.path, branch: existing.branch }
  if (existing !== undefined) {
    // The recorded directory is GONE: prune git's stale registration and drop the record, so the
    // create below is a fresh start instead of a `path-exists`/`name-registered` refusal.
    const repo = repoTopLevel(existing.repo)
    if (repo !== undefined) pruneWorktrees(repo)
    withLock(file, () => {
      /** The index re-read inside the lock before the stale record is dropped. */
      const index = readIndex(file)
      writeIndex(file, { version: 1, worktrees: index.worktrees.filter((candidate) => candidate.key !== key) })
    })
  }
  /** The creation result, reduced to the two fields the service contract exposes. */
  const result = createEntry(deps, {
    name: teamSlug + "/" + memberSlug,
    path: join(worktreeDir(deps), teamSlug, memberSlug),
    branch: deps.config.branchPrefix + teamSlug + "/" + memberSlug,
    teamId: ref.teamId,
    member: ref.member,
  })
  return { path: result.path, branch: result.branch }
}

/**
 * The read-only lookup a compaction reseed uses (D8): where one member's worktree is, if it exists.
 * @param deps the call dependencies.
 * @param ref the owning team and member.
 * @returns the recorded path, or undefined (absent record, missing directory, or any read failure).
 */
export function cwdForMember(deps: WorktreeDeps, ref: MemberRef): string | undefined {
  try {
    /** The active record for this pair. */
    const entry = readIndex(indexFile(deps)).worktrees.find(
      (candidate) => candidate.key === ref.teamId + "/" + ref.member && candidate.status === "active",
    )
    return entry !== undefined && existsSync(entry.path) ? entry.path : undefined
  } catch {
    return undefined
  }
}

/**
 * Builds the `mpdWorktree` service the team and cellwork lanes consume. Both methods NEVER throw:
 * a failure degrades to `undefined`, and `createForMember` logs exactly ONE line naming the pair.
 * @param options the root resolver, the effective config and the row logger.
 * @returns the service object `ctx.provide("mpdWorktree", …)` publishes.
 */
export function createWorktreeService(options: WorktreeServiceOptions): MpdWorktreeService {
  /**
   * The call dependencies for one exec; the root is resolved PER CALL (a workspace can be re-pointed).
   * @param exec the tool exec handed to the service method.
   * @returns the dependencies the operation runs with.
   */
  const depsFor = (exec: unknown): WorktreeDeps => ({ root: options.rootOf(exec), config: options.config, log: options.log })
  return {
    createForMember: (exec, ref) => {
      try {
        return createForMember(depsFor(exec), ref)
      } catch (error) {
        // ONE line, naming the pair and the fallback: a degraded spawn is never an error (D4).
        options.log(
          `[mpd-worktree] member worktree unavailable for ${ref?.teamId}/${ref?.member}: ${messageOf(error)} ` +
            "(the member spawns in the shared checkout)",
        )
        return undefined
      }
    },
    cwdForMember: (exec, ref) => {
      try {
        return cwdForMember(depsFor(exec), ref)
      } catch {
        return undefined
      }
    },
  }
}

