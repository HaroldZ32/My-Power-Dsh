import { lstatSync, readdirSync, realpathSync } from "node:fs"
import { join, matchesGlob } from "node:path"
import { firstLine, GIT_TIMEOUT_MS, runGit, type GitResult } from "./git.ts"
import { WorktreeError } from "./ops.ts"
import { canonicalPath } from "./paths.ts"

/** Full object names in the two formats Git can use for local repositories. */
export const OBJECT_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/

/** Capture an on-disk directory's identity without following a replaced symlink. */
export function directoryId(path: string): string {
  /** Device and inode survive renames, unlike a path. */
  const stat = lstatSync(path, { bigint: true })
  if (!stat.isDirectory() || realpathSync(path) !== path) {
    throw new WorktreeError("copy-path-changed", `expected a canonical directory at ${path}`)
  }
  return `${stat.dev}:${stat.ino}`
}

/** Detect entries including broken symlinks, surfacing filesystem errors other than absence. */
export function pathExists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false
    throw error
  }
}

/** Build the inherited environment without repository redirection, alternates or injected Git config. */
function gitEnvironment(): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  }
}

/** Execute a local Git operation with hooks and replacements disabled. */
function localGit(cwd: string, args: readonly string[]): GitResult {
  /** An empty hook directory is unnecessary when this absolute null device disables hooks. */
  const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null"
  return runGit(cwd, ["--no-replace-objects", "-c", "protocol.allow=never", "-c", "protocol.file.allow=always",
    "-c", `core.hooksPath=${nullDevice}`, "-c", "core.fsmonitor=false", "-c", "submodule.recurse=false",
    ...args], GIT_TIMEOUT_MS, gitEnvironment())
}

/** Require a successful Git operation and keep the refusal concise. */
function git(cwd: string, args: readonly string[]): string {
  /** The bounded result, with textual stdout preserved verbatim for NUL-delimited commands. */
  const result = localGit(cwd, args)
  if (result.code !== 0) {
    throw new WorktreeError("copy-git", `git ${args[0]} exited ${result.code}: ${firstLine(result.stderr)}`)
  }
  return result.stdout
}

/** Resolve an exact commit object and reject aliases, abbreviated hashes and tag objects. */
export function exactCommit(repo: string, sha: string): string {
  if (!OBJECT_ID.test(sha) || git(repo, ["rev-parse", "--verify", `${sha}^{commit}`]).trim() !== sha) {
    throw new WorktreeError("copy-exact-commit", "provide a full Git commit object ID")
  }
  return sha
}

/** Confirm the selected source is the project checkout and has a complete committed base. */
export function checkSource(repo: string, base: string): void {
  if (git(repo, ["rev-parse", "--show-toplevel"]).trim() !== repo ||
      git(repo, ["rev-parse", "--is-shallow-repository"]).trim() !== "false") {
    throw new WorktreeError("copy-source", "use the canonical project Git checkout with full history")
  }
  exactCommit(repo, base)
  if (git(repo, ["ls-tree", "--name-only", "-z", base, "--", ".mpd"]) !== "") {
    throw new WorktreeError("copy-runtime-state", "the approved commit includes a tracked .mpd path")
  }
}

/** Fetch just the selected commit and its reachable objects into an independent local repository. */
export function createCopy(repo: string, copy: string, base: string): void {
  /** Match the source object format before fetching from it. */
  const format = git(repo, ["rev-parse", "--show-object-format"]).trim()
  git(copy, ["init", "--template=", `--object-format=${format}`])
  fetchCopyCommit(copy, repo, base)
  git(copy, ["switch", "--create", "development", base])
}

/** Fetch the exact object without importing a movable remote ref or changing the destination HEAD. */
export function fetchCopyCommit(target: string, source: string, sha: string): void {
  git(target, ["fetch", "--no-tags", "--no-recurse-submodules", "--no-write-fetch-head", "--no-auto-gc", "--", source, sha])
  exactCommit(target, sha)
}

/** Check the copy's Git directory is local, distinct and independent of the source object store. */
export function independentGitId(repo: string, copy: string): string {
  /** The only Git data directory this tool may operate on inside an independent copy. */
  const gitDir = join(copy, ".git")
  /** Fingerprint checked before any Git mutation or recursive cleanup. */
  const id = directoryId(gitDir)
  directoryId(join(gitDir, "objects"))
  if (git(copy, ["rev-parse", "--show-toplevel"]).trim() !== copy ||
      canonicalPath(git(copy, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim()) !== gitDir ||
      canonicalPath(git(repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim()) === gitDir ||
      ["objects/info/alternates", "objects/info/http-alternates", "commondir", "shallow", "worktrees", "modules"].some((entry) => pathExists(join(gitDir, entry)))) {
    throw new WorktreeError("copy-not-independent", "the copy must use its own complete Git directory without alternates or attached worktrees/submodules")
  }
  return id
}

/** Check commit ancestry with a normal negative distinguished from an unavailable Git answer. */
function isAncestor(repo: string, ancestor: string, later: string): boolean {
  /** Exit 1 is the only normal negative from merge-base. */
  const result = localGit(repo, ["merge-base", "--is-ancestor", ancestor, later])
  if (result.code === 0 || result.code === 1) return result.code === 0
  throw new WorktreeError("copy-unmerged", `Git could not prove ${ancestor} is integrated`)
}

/** Check the content delta against the authorized scope and pin it in a clone-local ref. */
export function pinCandidate(copy: string, base: string, sha: string, scopes: readonly string[]): void {
  exactCommit(copy, sha)
  if (!isAncestor(copy, base, sha)) throw new WorktreeError("copy-base", "the candidate must descend from the approved base")
  /** Include every new commit and merge parent. Reverting a private file cannot hide it from fetched history. */
  const paths = git(copy, ["log", "--format=", "--name-only", "-z", "-m", "--no-renames", "--no-ext-diff", "--no-textconv", `${base}..${sha}`, "--"])
    .split("\0").filter(Boolean)
  for (const path of paths) {
    if (path === ".mpd" || path.startsWith(".mpd/") || !scopes.some((scope) => scope === "." ||
      path === scope || path.startsWith(`${scope}/`) || matchesGlob(path, scope))) {
      throw new WorktreeError("copy-scope", `candidate changes an unauthorized path: ${path}`)
    }
  }
  git(copy, ["update-ref", `refs/mpd/candidates/${sha}`, sha])
}

/** Refuse any unfinished independent checkout operation, including split-index and sequencer states. */
function checkGitIdle(repo: string): void {
  /** Git's per-checkout directory may differ from its common ref store. */
  const gitDir = git(repo, ["rev-parse", "--absolute-git-dir"]).trim()
  if (["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "REBASE_HEAD", "rebase-apply", "rebase-merge", "sequencer", "index.lock"]
    .some((entry) => pathExists(join(gitDir, entry)))) {
    throw new WorktreeError("copy-git-in-progress", "finish the checkout's current Git operation before proceeding")
  }
}

/** Require a fully observed clean status, adding ignored paths for disposal. */
function checkClean(repo: string, disposal: boolean): void {
  checkGitIdle(repo)
  if (git(repo, ["status", "--porcelain=v1", "-z", "--ignore-submodules=none",
    ...(disposal ? ["--untracked-files=all", "--ignored=matching"] : ["--untracked-files=no"])]) !== "") {
    throw new WorktreeError("copy-dirty", "preserve or clean the checkout's local changes and files first")
  }
}

/** Merge an exact SHA into the selected ordinary integration branch, or abort a failed merge. */
export function integrateCandidate(repo: string, copy: string, sha: string, into: string): { merged: boolean; conflicts: string[] } {
  checkClean(repo, false)
  checkBranch(repo, into)
  fetchCopyCommit(repo, copy, sha)
  /** Preserve ordinary per-user author configuration without importing global behavior into the merge. */
  const identity = runGit(repo, ["var", "GIT_COMMITTER_IDENT"])
  /** Extract only the name and email to pass as literal arguments. */
  const author = identity.code === 0 ? /^(.*) <([^<>]+)> \d+ [+-]\d{4}$/.exec(identity.stdout.trim()) : null
  /** Git handles a missing identity with its standard diagnostic. */
  const identityArgs = author === null ? [] : ["-c", `user.name=${author[1]}`, "-c", `user.email=${author[2]}`]
  /** Merge the exact object independently of any branch change in the copy. */
  const result = localGit(repo, [...identityArgs, "merge", "--no-ff", "--no-autostash", "-m", `Merge verified development copy ${sha}`, sha])
  if (result.code === 0) return { merged: true, conflicts: [] }
  if (localGit(repo, ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"]).code !== 0) {
    throw new WorktreeError("copy-merge", firstLine(result.stderr) || `git merge exited ${result.code}`)
  }
  /** Capture conflicts before the abort clears them. */
  const conflicts = localGit(repo, ["diff", "--name-only", "-z", "--diff-filter=U"])
  git(repo, ["merge", "--abort"])
  return { merged: false, conflicts: conflicts.stdout.split("\0").filter(Boolean) }
}

/** Require an exact, currently checked-out branch name. */
function checkBranch(repo: string, into: string): void {
  if (git(repo, ["symbolic-ref", "HEAD"]).trim() !== `refs/heads/${into}`) {
    throw new WorktreeError("copy-integration-branch", "check out the named integration branch first")
  }
}

/** Preserve unintegrated commits, local refs (including tags and notes), and dirty or ignored files. */
export function checkDisposable(repo: string, copy: string, integrated: string, branch: string): void {
  checkClean(copy, true)
  /** Git can omit paths marked assume-unchanged or skip-worktree from status. */
  const tracked = git(copy, ["ls-files", "-v", "-z"]).split("\0")
  if (tracked.some((line) => /^[a-zS] /.test(line))) {
    throw new WorktreeError("copy-hidden-changes", "clear assume-unchanged and skip-worktree flags before disposal")
  }
  /** Compare against the recorded integration branch, even if the captain has since switched branches. */
  const target = `refs/heads/${branch}`
  if (!isAncestor(repo, integrated, target)) throw new WorktreeError("copy-integration-lost", "the integration branch no longer contains the verified commit")
  /** A snapshot of all refs, including user-defined namespaces outside heads and tags. */
  const refs = git(copy, ["for-each-ref", "--format=%(objectname) %(objecttype) %(refname)"]).trim()
  for (const line of refs.split("\n").filter(Boolean)) {
    /** Ref names exclude spaces by Git's own grammar. */
    const [sha, type, ref] = line.split(" ")
    if (sha === undefined || ref === undefined) throw new WorktreeError("copy-ref", "an unreadable local ref prevents disposal")
    if (type === "commit" && (ref.startsWith("refs/heads/") || ref.startsWith("refs/mpd/candidates/"))) {
      if (isAncestor(repo, sha, target)) continue
    } else if (localGit(repo, ["show-ref", "--verify", "--hash", ref]).stdout.trim() === sha) {
      continue
    }
    throw new WorktreeError("copy-private-ref", `preserve private ref ${ref} before disposal`)
  }
  /** Reflog revisions and detached HEAD must also survive in the integration branch. */
  const localHistory = git(copy, ["reflog", "show", "--all", "--format=%H"]).trim().split("\n").filter(Boolean)
  for (const sha of new Set([git(copy, ["rev-parse", "HEAD"]).trim(), ...localHistory])) {
    if (!isAncestor(repo, sha, target)) throw new WorktreeError("copy-unmerged", `local history ${sha} is outside the integration branch`)
  }
}

/** Measure filesystem blocks for a registered tree without following symlinks. */
export function allocatedCopyBytes(path: string, device?: bigint): bigint {
  /** POSIX st_blocks uses 512-byte units, independent of the filesystem block size. */
  const stat = lstatSync(path, { bigint: true })
  if (device !== undefined && stat.dev !== device) {
    throw new WorktreeError("copy-filesystem", "unmount the nested filesystem before measuring or disposing of the copy")
  }
  /** The entry's own blocks include directories and symlinks. */
  const own = stat.blocks * 512n
  return stat.isDirectory() ? readdirSync(path).reduce((size, entry) => size + allocatedCopyBytes(join(path, entry), stat.dev), own) : own
}
