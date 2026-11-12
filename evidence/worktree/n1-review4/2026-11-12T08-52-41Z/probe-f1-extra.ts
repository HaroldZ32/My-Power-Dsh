// Reviewer-owned supplementary probe (n1-review4): the F1 fix must also keep the UNMERGED safety gate
// honest under a tag collision. Before the fix, `merge-base --is-ancestor feature main` answered for the
// TAG, so an unmerged branch looked merged and a plain remove would have discarded the worktree.
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveConfig } from "../../../../packages/mpd-worktree-plugin/src/config.ts"
import { createWorktree, removeWorktree, WorktreeError, type WorktreeDeps } from "../../../../packages/mpd-worktree-plugin/src/ops.ts"

/** The probe's tally. */
let failed = 0
/** One asserted fact. */
function check(id: string, ok: boolean, detail: string): void {
  if (!ok) failed += 1
  console.log(`CHECK ${id} ${ok ? "PASS" : "FAIL"} ${detail}`)
}
/** git with stdout captured; a non-zero exit throws. */
function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim()
}
/** git's exit status without throwing. */
function gitOk(cwd: string, args: string[]): boolean {
  try {
    execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: "pipe" })
    return true
  } catch {
    return false
  }
}
/** The refusal code, or NO-REFUSAL. */
function refusal(body: () => unknown): string {
  try {
    body()
    return "NO-REFUSAL"
  } catch (error) {
    return error instanceof WorktreeError ? error.code : `NON:${String(error)}`
  }
}

const root = mkdtempSync(join(tmpdir(), "n1-review4-extra-"))
git(root, ["init", "-q", "-b", "main"])
git(root, ["config", "user.email", "reviewer@example.invalid"])
git(root, ["config", "user.name", "reviewer"])
writeFileSync(join(root, ".gitignore"), ".mpd/\n")
writeFileSync(join(root, "a.txt"), "one\n")
git(root, ["add", "."])
git(root, ["commit", "-q", "-m", "init"])
const deps: WorktreeDeps = { root, config: resolveConfig({}), log: () => undefined }
git(root, ["tag", "feature", "main"])
const created = createWorktree(deps, { name: "alice", branch: "feature" })
writeFileSync(join(created.path, "wip.txt"), "wip\n")
git(created.path, ["add", "wip.txt"])
git(created.path, ["commit", "-q", "-m", "unmerged work"])
const tip = git(created.path, ["rev-parse", "HEAD"])
const mainSha = git(root, ["rev-parse", "HEAD"])
check(
  "X1.precondition_tag_shadows_branch",
  git(created.path, ["rev-parse", "--abbrev-ref", "HEAD"]) === "heads/feature",
  `abbrev=${git(created.path, ["rev-parse", "--abbrev-ref", "HEAD"])}`,
)
const code = refusal(() => removeWorktree(deps, { name: "alice" }))
check("X1.unmerged_refused_without_force", code === "unmerged", `code=${code}`)
check(
  "X1.nothing_lost",
  existsSync(created.path) && gitOk(root, ["rev-parse", "--verify", "--quiet", "refs/heads/feature"]) && git(root, ["rev-parse", "HEAD"]) === mainSha,
  `dir+ref+main intact; tip=${tip}`,
)
const forced = removeWorktree(deps, { name: "alice", force: true })
check("X1.force_removes", forced.removed === true && forced.branchDeleted === true && !existsSync(created.path), `branchDeleted=${forced.branchDeleted}`)
check("X1.tag_survives", gitOk(root, ["rev-parse", "--verify", "--quiet", "refs/tags/feature"]), "tag survives")
rmSync(root, { recursive: true, force: true })

// X2: a vanished directory whose branch is gone too is still PRUNED, and the name stays reusable.
{
  const s = mkdtempSync(join(tmpdir(), "n1-review4-prune-"))
  git(s, ["init", "-q", "-b", "main"])
  git(s, ["config", "user.email", "reviewer@example.invalid"])
  git(s, ["config", "user.name", "reviewer"])
  writeFileSync(join(s, ".gitignore"), ".mpd/\n")
  writeFileSync(join(s, "a.txt"), "one\n")
  git(s, ["add", "."])
  git(s, ["commit", "-q", "-m", "init"])
  const d: WorktreeDeps = { root: s, config: resolveConfig({}), log: () => undefined }
  const w = createWorktree(d, { name: "alice" })
  rmSync(w.path, { recursive: true, force: true })
  git(s, ["worktree", "prune"])
  git(s, ["branch", "-D", "agent/alice"])
  const pruned = removeWorktree(d, { name: "alice" })
  check("X2.vanished_prunes", pruned.removed === true && pruned.branchDeleted === false, `branchDeleted=${pruned.branchDeleted}`)
  const index = JSON.parse(readFileSync(join(s, ".mpd", "worktrees", "index.json"), "utf8")) as { worktrees: Array<Record<string, unknown>> }
  check("X2.tombstone", index.worktrees[0]?.status === "removed", `status=${String(index.worktrees[0]?.status)}`)
  const again = createWorktree(d, { name: "alice" })
  check("X2.name_reusable", again.branch === "agent/alice" && existsSync(again.path), `branch=${again.branch}`)
  rmSync(s, { recursive: true, force: true })
}

// X3: hostile branch spellings are typed refusals at creation, with no side effect.
{
  const s = mkdtempSync(join(tmpdir(), "n1-review4-inject-"))
  git(s, ["init", "-q", "-b", "main"])
  git(s, ["config", "user.email", "reviewer@example.invalid"])
  git(s, ["config", "user.name", "reviewer"])
  writeFileSync(join(s, ".gitignore"), ".mpd/\n")
  writeFileSync(join(s, "a.txt"), "one\n")
  git(s, ["add", "."])
  git(s, ["commit", "-q", "-m", "init"])
  const d: WorktreeDeps = { root: s, config: resolveConfig({}), log: () => undefined }
  for (const branch of ["-D", "bad..name"]) {
    const code = refusal(() => createWorktree(d, { name: "alice", branch }))
    check(`X3.option_injection.${branch}`, code === "invalid-branch", `code=${code}`)
  }
  check("X3.no_side_effect", !existsSync(join(s, ".mpd", "worktrees", "alice")) && !existsSync(join(s, ".mpd", "worktrees", "index.json")), "no dir, no index")
  rmSync(s, { recursive: true, force: true })
}

// X4: an index record created BEFORE the guard (a legacy full-ref spelling) is still consumable:
// symbolic-ref strips exactly one refs/heads/ prefix, so the record now matches the nested branch.
{
  const s = mkdtempSync(join(tmpdir(), "n1-review4-legacy-"))
  git(s, ["init", "-q", "-b", "main"])
  git(s, ["config", "user.email", "reviewer@example.invalid"])
  git(s, ["config", "user.name", "reviewer"])
  writeFileSync(join(s, ".gitignore"), ".mpd/\n")
  writeFileSync(join(s, "a.txt"), "one\n")
  git(s, ["add", "."])
  git(s, ["commit", "-q", "-m", "init"])
  const d: WorktreeDeps = { root: s, config: resolveConfig({}), log: () => undefined }
  const path = join(s, ".mpd", "worktrees", "alice")
  git(s, ["worktree", "add", "-q", "-b", "refs/heads/dev", path, "main"])
  writeFileSync(
    join(s, ".mpd", "worktrees", "index.json"),
    JSON.stringify({
      version: 1,
      worktrees: [{ key: "manual/alice", name: "alice", repo: s, path, branch: "refs/heads/dev", base: "main", createdAt: new Date().toISOString(), status: "active" }],
    }),
  )
  const removed = removeWorktree(d, { name: "alice" })
  check(
    "X4.legacy_full_ref_record_consumable",
    removed.removed === true && removed.branchDeleted === true && !existsSync(path) && !gitOk(s, ["rev-parse", "--verify", "--quiet", "refs/heads/refs/heads/dev"]),
    `removed=${removed.removed} branchDeleted=${removed.branchDeleted}`,
  )
  rmSync(s, { recursive: true, force: true })
}

console.log(`\nEXTRA_RESULT failed=${failed}`)
process.exitCode = failed === 0 ? 0 : 1
