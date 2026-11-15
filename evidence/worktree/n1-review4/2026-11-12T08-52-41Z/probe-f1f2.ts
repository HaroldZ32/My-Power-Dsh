// Reviewer-owned independent probe for the F1/F2 repair (n1-review4).
// It drives the SAME exported operations the registered tools execute, against real throwaway git repos.
// It is evidence only: it is never imported by the product, and it edits no repository file.
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveConfig, type Config } from "../../../../packages/mpd-worktree-plugin/src/config.ts"
import {
  createWorktree,
  mergeWorktree,
  removeWorktree,
  worktreeStatus,
  WorktreeError,
  type WorktreeDeps,
} from "../../../../packages/mpd-worktree-plugin/src/ops.ts"

/** The probe's tally; a non-zero failed count means the frozen check did not hold. */
let failed = 0
/** One asserted fact, printed as machine-readable evidence. */
function check(id: string, ok: boolean, detail: string): void {
  if (!ok) failed += 1
  console.log(`CHECK ${id} ${ok ? "PASS" : "FAIL"} ${detail}`)
}
/** git with stdout captured and trimmed; a non-zero exit THROWS (precondition probes only). */
function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim()
}
/** git's exit status without throwing, for ref-existence style probes. */
function gitOk(cwd: string, args: string[]): boolean {
  try {
    execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: "pipe" })
    return true
  } catch {
    return false
  }
}
/** The refusal code a body throws, or NO-REFUSAL / NON:<value> when it is not a typed refusal. */
function refusal(body: () => unknown): string {
  try {
    body()
    return "NO-REFUSAL"
  } catch (error) {
    return error instanceof WorktreeError ? error.code : `NON:${String(error)}`
  }
}
/** A real git repository under a fresh temp root, with the plugin's deps resolved from config overrides. */
interface Sandbox {
  root: string
  deps: WorktreeDeps
}
function sandbox(overrides: Partial<Config>): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "n1-review4-"))
  git(root, ["init", "-q", "-b", "main"])
  git(root, ["config", "user.email", "reviewer@example.invalid"])
  git(root, ["config", "user.name", "reviewer"])
  writeFileSync(join(root, ".gitignore"), ".mpd/\n")
  writeFileSync(join(root, "a.txt"), "one\n")
  git(root, ["add", "."])
  git(root, ["commit", "-q", "-m", "init"])
  return { root, deps: { root, config: resolveConfig(overrides), log: () => undefined } }
}
/** Commits one file inside a worktree and returns the new tip SHA. */
function commitFile(dir: string, name: string, body: string, message: string): string {
  writeFileSync(join(dir, name), body)
  git(dir, ["add", name])
  git(dir, ["commit", "-q", "-m", message])
  return git(dir, ["rev-parse", "HEAD"])
}
/** The raw index document, for tamper and mutation assertions. */
function rawIndex(s: Sandbox): { worktrees: Array<Record<string, unknown>> } {
  return JSON.parse(readFileSync(join(s.root, ".mpd", "worktrees", "index.json"), "utf8")) as {
    worktrees: Array<Record<string, unknown>>
  }
}
/** Rewrites the single recorded branch, reproducing an attacker-writable index. */
function tamperBranch(s: Sandbox, branch: string): void {
  const file = join(s.root, ".mpd", "worktrees", "index.json")
  const index = JSON.parse(readFileSync(file, "utf8")) as { worktrees: Array<Record<string, unknown>> }
  index.worktrees[0]!.branch = branch
  writeFileSync(file, JSON.stringify(index))
}
/** Every ref name in the repository, sorted, for a before/after "no new ref" comparison. */
function refNames(root: string): string {
  return git(root, ["for-each-ref", "--format=%(refname)"])
}

// ============================================================================================
// F1-A: tag "feature" collides with branch "feature": merge must land the BRANCH tip, remove prunes.
// ============================================================================================
{
  const s = sandbox({})
  git(s.root, ["tag", "feature", "main"])
  const tagSha = git(s.root, ["rev-parse", "refs/tags/feature"])
  const created = createWorktree(s.deps, { name: "alice", branch: "feature" })
  check("F1A.create", created.branch === "feature", `recorded=${created.branch}`)
  check(
    "F1A.precondition_abbrev_is_ambiguous",
    git(created.path, ["rev-parse", "--abbrev-ref", "HEAD"]) === "heads/feature",
    `abbrev=${git(created.path, ["rev-parse", "--abbrev-ref", "HEAD"])}`,
  )
  check(
    "F1A.symbolic_ref_short",
    git(created.path, ["symbolic-ref", "--quiet", "HEAD"]) === "refs/heads/feature",
    `symbolic=${git(created.path, ["symbolic-ref", "--quiet", "HEAD"])}`,
  )
  const tip = commitFile(created.path, "feature.txt", "feature\n", "feature work")
  const before = worktreeStatus(s.deps, "alice")
  check("F1A.status_ahead", before.ahead === 1, `ahead=${before.ahead}`)
  check("F1A.status_unmerged_before", before.merged === false, `merged=${before.merged}`)
  const merged = mergeWorktree(s.deps, { name: "alice" })
  check("F1A.merge_ok", merged.merged === true, `merged=${merged.merged} commit=${merged.commit}`)
  check("F1A.branch_tip_reachable", gitOk(s.root, ["merge-base", "--is-ancestor", tip, "HEAD"]), `tip=${tip}`)
  check("F1A.merge_second_parent_is_branch_tip", git(s.root, ["rev-parse", "HEAD^2"]) === tip, `HEAD^2=${git(s.root, ["rev-parse", "HEAD^2"])} tip=${tip}`)
  check("F1A.branch_file_in_main", existsSync(join(s.root, "feature.txt")), "feature.txt in main")
  check("F1A.tag_unmoved", git(s.root, ["rev-parse", "refs/tags/feature"]) === tagSha, `tag=${tagSha}`)
  check("F1A.status_merged_after", worktreeStatus(s.deps, "alice").merged === true, "merged=true")
  const removed = removeWorktree(s.deps, { name: "alice" })
  check("F1A.remove_ok", removed.removed === true && removed.branchDeleted === true, `removed=${removed.removed} branchDeleted=${removed.branchDeleted}`)
  check("F1A.dir_gone", !existsSync(created.path), created.path)
  check("F1A.branch_ref_gone", !gitOk(s.root, ["rev-parse", "--verify", "--quiet", "refs/heads/feature"]), "refs/heads/feature gone")
  check("F1A.tag_still_present", gitOk(s.root, ["rev-parse", "--verify", "--quiet", "refs/tags/feature"]), "tag survives")
  rmSync(s.root, { recursive: true, force: true })
}

// ============================================================================================
// F1-B: tag "agent/alice" collides with the DEFAULT branch: merge lands the branch, remove prunes.
// ============================================================================================
{
  const s = sandbox({})
  git(s.root, ["tag", "agent/alice", "main"])
  const created = createWorktree(s.deps, { name: "alice" })
  check("F1B.default_branch", created.branch === "agent/alice", `recorded=${created.branch}`)
  check(
    "F1B.precondition_abbrev_is_ambiguous",
    git(created.path, ["rev-parse", "--abbrev-ref", "HEAD"]) === "heads/agent/alice",
    `abbrev=${git(created.path, ["rev-parse", "--abbrev-ref", "HEAD"])}`,
  )
  const tip = commitFile(created.path, "alice.txt", "alice\n", "alice work")
  const merged = mergeWorktree(s.deps, { name: "alice" })
  check("F1B.merge_ok", merged.merged === true, `merged=${merged.merged}`)
  check("F1B.branch_tip_reachable", gitOk(s.root, ["merge-base", "--is-ancestor", tip, "HEAD"]), `tip=${tip}`)
  check("F1B.merge_second_parent_is_branch_tip", git(s.root, ["rev-parse", "HEAD^2"]) === tip, `HEAD^2=${git(s.root, ["rev-parse", "HEAD^2"])} tip=${tip}`)
  check("F1B.branch_file_in_main", existsSync(join(s.root, "alice.txt")), "alice.txt in main")
  const removed = removeWorktree(s.deps, { name: "alice" })
  check("F1B.remove_prunes", removed.removed === true && removed.branchDeleted === true, `branchDeleted=${removed.branchDeleted}`)
  check("F1B.dir_gone", !existsSync(created.path), created.path)
  check("F1B.branch_ref_gone", !gitOk(s.root, ["rev-parse", "--verify", "--quiet", "refs/heads/agent/alice"]), "branch gone")
  check("F1B.tag_still_present", gitOk(s.root, ["rev-parse", "--verify", "--quiet", "refs/tags/agent/alice"]), "tag survives")
  rmSync(s.root, { recursive: true, force: true })
}

// ============================================================================================
// F1-C: a detached worktree HEAD is still refused by BOTH operations, with nothing mutated.
// ============================================================================================
{
  const s = sandbox({})
  const created = createWorktree(s.deps, { name: "alice" })
  git(created.path, ["checkout", "-q", "--detach", "HEAD"])
  const mainSha = git(s.root, ["rev-parse", "HEAD"])
  check("F1C.detached_remove", refusal(() => removeWorktree(s.deps, { name: "alice", force: true })) === "branch-mismatch", "remove refused")
  check("F1C.detached_merge", refusal(() => mergeWorktree(s.deps, { name: "alice" })) === "branch-mismatch", "merge refused")
  check("F1C.nothing_mutated", existsSync(created.path) && rawIndex(s).worktrees[0]?.status === "active" && git(s.root, ["rev-parse", "HEAD"]) === mainSha, "dir/record/main intact")
  rmSync(s.root, { recursive: true, force: true })
}

// ============================================================================================
// F1-D: a record whose branch differs from the live worktree HEAD is still refused (mismatch).
// ============================================================================================
{
  const s = sandbox({})
  const created = createWorktree(s.deps, { name: "alice" })
  git(s.root, ["branch", "other"])
  tamperBranch(s, "other")
  const mainSha = git(s.root, ["rev-parse", "HEAD"])
  check("F1D.mismatch_remove", refusal(() => removeWorktree(s.deps, { name: "alice", force: true })) === "branch-mismatch", "remove refused")
  check("F1D.mismatch_merge", refusal(() => mergeWorktree(s.deps, { name: "alice" })) === "branch-mismatch", "merge refused")
  check(
    "F1D.nothing_mutated",
    existsSync(created.path) && rawIndex(s).worktrees[0]?.status === "active" && git(s.root, ["rev-parse", "HEAD"]) === mainSha && gitOk(s.root, ["rev-parse", "--verify", "--quiet", "refs/heads/agent/alice"]),
    "dir/record/refs/main intact",
  )
  rmSync(s.root, { recursive: true, force: true })
}

// ============================================================================================
// F2: a refs/-rooted branch is refused as invalid-branch with NO new ref/dir/registration/record.
// ============================================================================================
{
  const s = sandbox({ protectedBranches: ["dev"] })
  git(s.root, ["branch", "dev"])
  const refsBefore = refNames(s.root)
  const worktreesBefore = git(s.root, ["worktree", "list", "--porcelain"])
  const indexFile = join(s.root, ".mpd", "worktrees", "index.json")
  const target = join(s.root, ".mpd", "worktrees", "alice")
  for (const spelling of ["refs/heads/dev", "refs/heads/main", "refs/heads/never-existed"]) {
    const code = refusal(() => createWorktree(s.deps, { name: "alice", branch: spelling }))
    check(`F2.refusal.${spelling}`, code === "invalid-branch", `code=${code}`)
    check(`F2.no_dir.${spelling}`, !existsSync(target), target)
    check(`F2.no_index.${spelling}`, !existsSync(indexFile), indexFile)
    check(`F2.no_new_ref.${spelling}`, refNames(s.root) === refsBefore, "ref set identical to before")
    check(
      `F2.no_registration.${spelling}`,
      git(s.root, ["worktree", "list", "--porcelain"]) === worktreesBefore,
      "worktree registration unchanged",
    )
  }
  check("F2.existing_refs_intact", gitOk(s.root, ["rev-parse", "--verify", "--quiet", "refs/heads/dev"]) && gitOk(s.root, ["rev-parse", "--verify", "--quiet", "refs/heads/main"]), "dev+main intact")
  check("F2.short_protected", refusal(() => createWorktree(s.deps, { name: "alice", branch: "dev" })) === "protected-branch", "short dev refused as protected-branch")
  check("F2.no_index_after_short_protected", !existsSync(indexFile), "still no index")
  const created = createWorktree(s.deps, { name: "alice", branch: "work/alice" })
  check("F2.short_creates", created.branch === "work/alice" && existsSync(target), `branch=${created.branch}`)
  const index = rawIndex(s)
  check("F2.recorded", index.worktrees.length === 1 && index.worktrees[0]?.branch === "work/alice" && index.worktrees[0]?.status === "active", JSON.stringify(index.worktrees[0]))
  rmSync(s.root, { recursive: true, force: true })
}

console.log(`\nPROBE_RESULT failed=${failed}`)
process.exitCode = failed === 0 ? 0 : 1
