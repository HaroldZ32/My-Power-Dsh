// Reviewer probe: full-ref branch spellings. A caller passing "refs/heads/<existing-branch>" is
// admitted by create; git then abbreviates the nested ref differently from the recorded string, so
// remove/merge refuse branch-mismatch forever. The F4 guard only compares the protected list exactly.
// Reviewer-owned evidence; never imported by the product and never touching repository state.
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveConfig, type Config } from "../../../../packages/mpd-worktree-plugin/src/config.ts"
import { createWorktree, mergeWorktree, removeWorktree, WorktreeError, type WorktreeDeps } from "../../../../packages/mpd-worktree-plugin/src/ops.ts"

function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim()
}
function gitOk(cwd: string, args: string[]): boolean {
  try { execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: "pipe" }); return true } catch { return false }
}
function refusal(body: () => unknown): string {
  try { body(); return "NO-REFUSAL" } catch (e) { return e instanceof WorktreeError ? e.code : `NON:${String(e)}` }
}
interface S { root: string; deps: WorktreeDeps }
function sandbox(overrides: Partial<Config>): S {
  const root = mkdtempSync(join(tmpdir(), "n1-review3-ref-"))
  git(root, ["init", "-q", "-b", "main"]); git(root, ["config", "user.email", "a@b.c"]); git(root, ["config", "user.name", "p"])
  writeFileSync(join(root, ".gitignore"), ".mpd/\n"); writeFileSync(join(root, "a.txt"), "one\n")
  git(root, ["add", "."]); git(root, ["commit", "-q", "-m", "init"])
  return { root, deps: { root, config: resolveConfig(overrides), log: () => undefined } }
}
// Control: the literal protected name is refused before any mutation.
{
  const c = sandbox({ protectedBranches: ["dev"] })
  git(c.root, ["branch", "dev"])
  console.log("CONTROL create branch=dev ->", refusal(() => createWorktree(c.deps, { name: "alice", branch: "dev" })))
  rmSync(c.root, { recursive: true, force: true })
}
// Existing local branches addressed by a full ref: create is admitted, then nothing can consume the record.
for (const name of ["dev", "main"] as const) {
  const s = sandbox({ protectedBranches: ["dev"] })
  git(s.root, ["branch", "dev"])
  const spelling = `refs/heads/${name}`
  console.log(`\n=== create branch="${spelling}" (local branch "${name}" EXISTS) ===`)
  const created = createWorktree(s.deps, { name: "alice", branch: spelling })
  console.log("create = NO-REFUSAL; recorded branch =", created.branch)
  console.log("worktree HEAD abbrev =", git(created.path, ["rev-parse", "--abbrev-ref", "HEAD"]))
  console.log("the literal target ref exists =", gitOk(s.root, ["rev-parse", "--verify", "--quiet", `refs/heads/${name}`]))
  console.log("merge(force) =", refusal(() => mergeWorktree(s.deps, { name: "alice", force: true })))
  console.log("remove(force) =", refusal(() => removeWorktree(s.deps, { name: "alice", force: true })))
  console.log("directory survives =", existsSync(created.path))
  const idx = JSON.parse(readFileSync(join(s.root, ".mpd", "worktrees", "index.json"), "utf8")) as { worktrees: Array<Record<string, unknown>> }
  console.log("record still active =", idx.worktrees[0]?.status === "active")
  s.deps.config.protectedBranches.length = 0
  console.log("remove with EMPTY protected list =", refusal(() => removeWorktree(s.deps, { name: "alice", force: true })))
  rmSync(s.root, { recursive: true, force: true })
}
// Control: no local branch collides, so the abbreviation round-trips and the record is removable.
{
  const s = sandbox({ protectedBranches: ["dev"] })
  const created = createWorktree(s.deps, { name: "alice", branch: "refs/heads/never-existed" })
  console.log(`\n=== create branch="refs/heads/never-existed" (no collision) ===`)
  console.log("worktree HEAD abbrev =", git(created.path, ["rev-parse", "--abbrev-ref", "HEAD"]))
  console.log("remove(force) =", refusal(() => removeWorktree(s.deps, { name: "alice", force: true })))
  rmSync(s.root, { recursive: true, force: true })
}
