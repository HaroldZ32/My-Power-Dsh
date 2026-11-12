// Every git invocation the mpd-worktree row makes, in one place: one spawn shape, one result shape,
// and no throw for an expected refusal (a refusal is DATA the caller turns into a typed error).
//
// All calls use `git -C <dir>` so the process cwd is never consulted; a row must not depend on where
// the harness happens to run.
import { spawnSync } from "node:child_process"

/** One git invocation's observable result; `code` is -1 when the process could not be started at all. */
export interface GitResult {
  /** Exit status; -1 when git itself did not run (missing binary, bad `-C` directory). */
  code: number
  /** Standard output, decoded as UTF-8. */
  stdout: string
  /** Standard error, decoded as UTF-8. */
  stderr: string
}

/**
 * Runs one git command in a directory.
 * @param cwd the directory `git -C` runs in.
 * @param args the git arguments, in argv order.
 * @returns the exit code and both streams; never throws.
 */
export function runGit(cwd: string, args: readonly string[]): GitResult {
  /** The child's captured result; a spawn failure surfaces as a null status, mapped to -1. */
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" })
  return { code: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" }
}

/**
 * The first non-blank line of a git stream, for a one-line refusal reason.
 * @param text raw stdout or stderr.
 * @returns the first non-blank trimmed line, or "" when the stream is empty.
 */
export function firstLine(text: string): string {
  for (const line of text.split("\n")) {
    /** The trimmed line, tested for blankness before it is returned. */
    const trimmed = line.trim()
    if (trimmed !== "") return trimmed
  }
  return ""
}

/**
 * The repository's canonical top-level directory.
 * @param dir the directory to test (`git -C <dir> rev-parse --show-toplevel`).
 * @returns the toplevel path, or undefined when `dir` is not inside a git work tree.
 */
export function repoTopLevel(dir: string): string | undefined {
  /** git's own answer for the candidate directory. */
  const result = runGit(dir, ["rev-parse", "--show-toplevel"])
  if (result.code !== 0) return undefined
  /** The trimmed toplevel; a blank answer is treated as absent. */
  const top = result.stdout.trim()
  return top === "" ? undefined : top
}

/** The main checkout's HEAD, the base every comparison in this row is made against. */
export interface HeadInfo {
  /** The checked-out branch name, or the commit SHA when detached. */
  ref: string
  /** Whether HEAD is detached; a merge into a detached checkout is refused. */
  detached: boolean
}

/**
 * Reads the main checkout's current HEAD.
 * @param repo the repository directory.
 * @returns the branch name (or SHA when detached), or undefined for an unborn/broken HEAD.
 */
export function headOf(repo: string): HeadInfo | undefined {
  /** The symref answer: the branch name, or the literal `HEAD` when detached. */
  const branch = runGit(repo, ["rev-parse", "--abbrev-ref", "HEAD"])
  if (branch.code !== 0) return undefined
  /** The trimmed symbolic answer. */
  const symbolic = branch.stdout.trim()
  if (symbolic === "HEAD") {
    /** The detached commit SHA, the only ref such a checkout has. */
    const sha = runGit(repo, ["rev-parse", "HEAD"])
    if (sha.code !== 0) return undefined
    /** The trimmed SHA. */
    const detachedSha = sha.stdout.trim()
    return detachedSha === "" ? undefined : { ref: detachedSha, detached: true }
  }
  return symbolic === "" ? undefined : { ref: symbolic, detached: false }
}

/**
 * Reads the commit HEAD points at — the commit a successful merge lands.
 * @param repo the repository directory.
 * @returns the SHA, or undefined when HEAD does not resolve.
 */
export function headSha(repo: string): string | undefined {
  /** `rev-parse HEAD`, which answers both an attached and a detached HEAD. */
  const result = runGit(repo, ["rev-parse", "HEAD"])
  /** The trimmed SHA, empty when the probe failed. */
  const sha = result.stdout.trim()
  return result.code === 0 && sha !== "" ? sha : undefined
}

/**
 * Whether a branch name legal by `git check-ref-format --branch` (an argument beginning with `-` is
 * refused here as well, because git would read it as an option).
 * @param repo the repository the name will be created in.
 * @param branch the candidate branch name.
 * @returns true when git accepts the name.
 */
export function isValidBranch(repo: string, branch: string): boolean {
  if (branch.trim() === "" || branch.startsWith("-")) return false
  return runGit(repo, ["check-ref-format", "--branch", branch]).code === 0
}

/**
 * Whether the repository knows a LOCAL branch.
 * @param repo the repository directory.
 * @param branch the branch name.
 * @returns true when `refs/heads/<branch>` exists.
 */
export function branchExists(repo: string, branch: string): boolean {
  return runGit(repo, ["rev-parse", "--verify", "--quiet", "refs/heads/" + branch]).code === 0
}

/**
 * Whether a ref/commit resolves in the repository.
 * @param repo the repository directory.
 * @param rev the ref, branch or SHA.
 * @returns true when `rev` peels to a commit.
 */
export function resolvesToCommit(repo: string, rev: string): boolean {
  return runGit(repo, ["rev-parse", "--verify", "--quiet", rev + "^{commit}"]).code === 0
}

/**
 * Whether `branch` is an ancestor of `main` — the row's definition of "merged".
 * @param repo the repository directory.
 * @param branch the branch that may be merged.
 * @param main the comparison ref (the main checkout's HEAD).
 * @returns true when every commit of `branch` is reachable from `main`.
 */
export function isAncestor(repo: string, branch: string, main: string): boolean {
  return runGit(repo, ["merge-base", "--is-ancestor", branch, main]).code === 0
}

/** A branch's distance from the main checkout's current ref. */
export interface RevCount {
  /** Commits the branch has that the main ref does not. */
  ahead: number
  /** Commits the main ref has that the branch does not. */
  behind: number
}

/**
 * The ahead/behind pair of a branch relative to the main ref.
 * @param repo the repository directory.
 * @param branch the branch to count.
 * @param main the main checkout's ref.
 * @returns the pair, or undefined when either side does not resolve.
 */
export function revCount(repo: string, branch: string, main: string): RevCount | undefined {
  /** `--left-right --count` prints `<left>\t<right>` for `branch...main`. */
  const result = runGit(repo, ["rev-list", "--left-right", "--count", branch + "..." + main])
  if (result.code !== 0) return undefined
  /** The two counters, in git's own left/right order. */
  const parts = result.stdout.trim().split(/\s+/)
  if (parts.length < 2) return undefined
  return { ahead: Number(parts[0]) || 0, behind: Number(parts[1]) || 0 }
}

/**
 * Whether a directory has uncommitted changes (tracked or untracked).
 * @param dir the directory to probe; it must already be a managed checkout or worktree.
 * @returns true when `git status --porcelain` reports anything.
 */
export function isDirty(dir: string): boolean {
  /** The porcelain status; a failing probe is reported as clean so the caller's own `exists` check governs. */
  const result = runGit(dir, ["status", "--porcelain"])
  return result.code === 0 && result.stdout.trim() !== ""
}

/**
 * Whether the MAIN checkout has changes to TRACKED files. Untracked files do not block a merge that
 * does not touch them, so they are excluded here on purpose.
 * @param repo the repository directory.
 * @returns true when a tracked path is modified or staged.
 */
export function trackedDirty(repo: string): boolean {
  /** The porcelain status limited to tracked paths. */
  const result = runGit(repo, ["status", "--porcelain", "--untracked-files=no"])
  return result.code === 0 && result.stdout.trim() !== ""
}

/**
 * The worktree paths git itself reports for a repository.
 * @param repo the repository directory.
 * @returns the `worktree <path>` records in git's order; empty when the listing fails.
 */
export function worktreePaths(repo: string): string[] {
  /** The porcelain listing. */
  const result = runGit(repo, ["worktree", "list", "--porcelain"])
  if (result.code !== 0) return []
  /** The collected paths. */
  const paths: string[] = []
  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("worktree ")) paths.push(line.slice("worktree ".length).trim())
  }
  return paths
}

/**
 * Adds a worktree on a NEW branch.
 * @param repo the repository directory.
 * @param path the absolute directory to create.
 * @param branch the branch to create.
 * @param base the ref/SHA the branch starts from.
 * @returns git's failure text, or undefined on success.
 */
export function addWorktree(repo: string, path: string, branch: string, base: string): string | undefined {
  /** The creation invocation, in the contract's argument order. */
  const result = runGit(repo, ["worktree", "add", path, "-b", branch, base])
  return result.code === 0 ? undefined : firstLine(result.stderr) || firstLine(result.stdout) || "git worktree add exited " + result.code
}

/**
 * Removes one worktree directory.
 * @param repo the repository directory.
 * @param path the worktree directory.
 * @param force whether git may discard a dirty or locked worktree.
 * @returns git's failure text, or undefined on success.
 */
export function removeWorktreePath(repo: string, path: string, force: boolean): string | undefined {
  /** The removal invocation; `--force` is placed before the path git reads as the target. */
  const result = runGit(repo, ["worktree", "remove", ...(force ? ["--force"] : []), path])
  return result.code === 0 ? undefined : firstLine(result.stderr) || firstLine(result.stdout) || "git worktree remove exited " + result.code
}

/**
 * Prunes worktree registrations whose directories are gone — the contract's "a missing path is
 * pruned, not an error" path.
 * @param repo the repository directory.
 * @returns nothing; a prune failure is intentionally silent because the caller's next git call reports it.
 */
export function pruneWorktrees(repo: string): void {
  runGit(repo, ["worktree", "prune"])
}

/**
 * Deletes a local branch.
 * @param repo the repository directory.
 * @param branch the branch name.
 * @param force whether to use `-D` (discard unmerged commits) instead of `-d`.
 * @returns git's failure text, or undefined on success.
 */
export function deleteBranch(repo: string, branch: string, force: boolean): string | undefined {
  /** The deletion invocation; `-d` refuses an unmerged branch unless the caller forced it. */
  const result = runGit(repo, ["branch", force ? "-D" : "-d", branch])
  return result.code === 0 ? undefined : firstLine(result.stderr) || firstLine(result.stdout) || "git branch delete exited " + result.code
}

/** The outcome of one `git merge --no-ff` attempt. */
export interface MergeOutcome {
  /** Whether the merge committed. */
  ok: boolean
  /** The paths git reported as conflicted; empty for a non-conflict failure. */
  conflicts: string[]
  /** git's own explanation, when it is not a plain conflict (or when the abort itself failed). */
  reason?: string
}

/**
 * Merges one branch into the MAIN checkout's current branch with `--no-ff`, aborting on conflict so
 * the caller's "change nothing" promise holds.
 * @param repo the repository directory (its main checkout carries the checked-out target branch).
 * @param branch the branch to merge.
 * @param message the merge commit message.
 * @returns the outcome; only `ok: true` leaves a commit behind.
 */
export function mergeBranch(repo: string, branch: string, message: string): MergeOutcome {
  /** The merge attempt. */
  const result = runGit(repo, ["merge", "--no-ff", branch, "-m", message])
  if (result.code === 0) return { ok: true, conflicts: [] }
  /** Whether git actually STARTED a merge: only that state has something to abort. */
  const started = runGit(repo, ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"]).code === 0
  if (!started) {
    return { ok: false, conflicts: [], reason: firstLine(result.stderr) || firstLine(result.stdout) || "git merge exited " + result.code }
  }
  /** The conflicted paths, collected BEFORE the abort clears them. */
  const conflicts = runGit(repo, ["diff", "--name-only", "--diff-filter=U"])
    .stdout.split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
  /** The abort's own result; a failed abort is REPORTED, never swallowed. */
  const abort = runGit(repo, ["merge", "--abort"])
  return abort.code === 0
    ? { ok: false, conflicts }
    : { ok: false, conflicts, reason: "git merge --abort failed: " + (firstLine(abort.stderr) || "exit " + abort.code) }
}
