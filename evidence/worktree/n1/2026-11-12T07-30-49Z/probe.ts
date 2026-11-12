// N1 verification probe: drives the SOURCE operations in throwaway git repositories.
// Reviewer-owned evidence; never imported by the product. Read-only with respect to the repo.
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveConfig, type Config } from "../../../../packages/mpd-worktree-plugin/src/config.ts"
import { createWorktree, mergeWorktree, removeWorktree, WorktreeError, type WorktreeDeps } from "../../../../packages/mpd-worktree-plugin/src/ops.ts"

const roots: string[] = []
function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim()
}
function gitQuiet(cwd: string, args: string[]): string {
  try { return git(cwd, args) } catch { return "<git-failed>" }
}
function gitOk(cwd: string, args: string[]): boolean {
  try { execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }); return true } catch { return false }
}
function sandbox(overrides: Partial<Config> = {}): WorktreeDeps & { root: string } {
  const root = mkdtempSync(join(tmpdir(), "n1-probe-"))
  roots.push(root)
  git(root, ["init", "-q", "-b", "main"])
  git(root, ["config", "user.email", "agent@example.com"])
  git(root, ["config", "user.name", "N1 Probe"])
  writeFileSync(join(root, ".gitignore"), ".mpd/\n")
  writeFileSync(join(root, "a.txt"), "one\n")
  git(root, ["add", "."])
  git(root, ["commit", "-q", "-m", "init"])
  return { root, config: resolveConfig(overrides), log: [] as string[] } as WorktreeDeps & { root: string }
}
function refusal(body: () => unknown): string {
  try { body(); return "NO-REFUSAL" } catch (e) { return e instanceof WorktreeError ? e.code : `NON-WORKTREE:${String(e)}` }
}
function tamperIndexAt(file: string, mutate: (entry: Record<string, unknown>) => void): void {
  const idx = JSON.parse(execFileSync("cat", [file], { encoding: "utf8" })) as { worktrees: Array<Record<string, unknown>> }
  mutate(idx.worktrees[0] as Record<string, unknown>)
  writeFileSync(file, JSON.stringify(idx))
}
function tamperIndex(root: string, mutate: (entry: Record<string, unknown>) => void): void {
  tamperIndexAt(join(root, ".mpd", "worktrees", "index.json"), mutate)
}

console.log("=== A: vanished worktree dir + vanished branch (contract: missing path is PRUNED, not an error) ===")
{
  const deps = sandbox()
  const created = createWorktree(deps, { name: "alice" })
  rmSync(created.path, { recursive: true, force: true })
  execFileSync("git", ["-C", deps.root, "worktree", "prune"])
  git(deps.root, ["branch", "-D", "agent/alice"])
  const code = refusal(() => removeWorktree(deps, { name: "alice", force: true }))
  const index = JSON.parse(execFileSync("cat", [join(deps.root, ".mpd", "worktrees", "index.json")], { encoding: "utf8" })) as { worktrees: Array<{ status: string }> }
  console.log("remove =>", code, "| recorded status:", index.worktrees[0]?.status, "| createWorktree again =>", refusal(() => createWorktree(deps, { name: "alice" })))
}

console.log("=== B: vanished worktree dir + existing branch (control: prune still works) ===")
{
  const deps = sandbox()
  const created = createWorktree(deps, { name: "alice" })
  rmSync(created.path, { recursive: true, force: true })
  execFileSync("git", ["-C", deps.root, "worktree", "prune"])
  console.log("remove =>", JSON.stringify(removeWorktree(deps, { name: "alice", force: true })), "| branch exists:", gitOk(deps.root, ["rev-parse", "--verify", "refs/heads/agent/alice"]))
}

console.log("=== C: a PRESENT worktree whose branch ref was deleted (broken HEAD) ===")
{
  const deps = sandbox()
  const created = createWorktree(deps, { name: "alice" })
  execFileSync("git", ["-C", deps.root, "update-ref", "-d", "refs/heads/agent/alice"])
  console.log("remove =>", refusal(() => removeWorktree(deps, { name: "alice", force: true })), "| dir exists:", existsSync(created.path))
}

console.log("=== D: tampered invalid branch names (option-injection guard) on BOTH operations ===")
for (const bad of ["-D", "bad..name", "head~1", "foo bar", "HEAD"]) {
  const deps = sandbox()
  createWorktree(deps, { name: "alice" })
  tamperIndex(deps.root, (entry) => { entry.branch = bad })
  console.log(`branch ${JSON.stringify(bad)} => remove:`, refusal(() => removeWorktree(deps, { name: "alice", force: true })), "| merge:", refusal(() => mergeWorktree(deps, { name: "alice", force: true })))
}

console.log("=== E: tampered literal refs/heads/master branch (not the protected master) ===")
{
  const deps = sandbox()
  const created = createWorktree(deps, { name: "alice" })
  git(deps.root, ["branch", "refs/heads/master"])
  tamperIndex(deps.root, (entry) => { entry.branch = "refs/heads/master" })
  console.log("remove =>", refusal(() => removeWorktree(deps, { name: "alice", force: true })), "| real master exists:", gitOk(deps.root, ["rev-parse", "--verify", "refs/heads/master"]), "| literal branch exists:", gitOk(deps.root, ["rev-parse", "--verify", "refs/heads/refs/heads/master"]), "| path exists:", existsSync(created.path))
}

console.log("=== F: merge when the worktree directory vanished (branch still exists) ===")
{
  const deps = sandbox()
  const created = createWorktree(deps, { name: "alice" })
  rmSync(created.path, { recursive: true, force: true })
  execFileSync("git", ["-C", deps.root, "worktree", "prune"])
  console.log("merge =>", refusal(() => mergeWorktree(deps, { name: "alice" })), "| branch exists:", gitOk(deps.root, ["rev-parse", "--verify", "refs/heads/agent/alice"]), "| main HEAD:", gitQuiet(deps.root, ["rev-parse", "HEAD"]))
}

console.log("=== G: tampered record pointing at the MAIN checkout itself, branch = main (dir = workspace root) ===")
{
  const deps = sandbox({ dir: "." })
  createWorktree(deps, { name: "alice" })
  tamperIndexAt(join(deps.root, "index.json"), (entry) => { entry.path = deps.root; entry.branch = "main" })
  const mainBefore = gitQuiet(deps.root, ["rev-parse", "HEAD"])
  const removeCode = refusal(() => removeWorktree(deps, { name: "alice", force: true }))
  const mainAfterRemove = gitQuiet(deps.root, ["rev-parse", "HEAD"])
  const mergeCode = refusal(() => mergeWorktree(deps, { name: "alice", force: true }))
  console.log("remove =>", removeCode, "| main HEAD before/after:", mainBefore.slice(0, 8), "/", mainAfterRemove.slice(0, 8), "| main branch exists:", gitOk(deps.root, ["rev-parse", "--verify", "refs/heads/main"]), "| main root still a worktree:", existsSync(join(deps.root, "a.txt")))
  console.log("merge =>", mergeCode, "| main HEAD after merge:", gitQuiet(deps.root, ["rev-parse", "HEAD"]).slice(0, 8))
}

for (const r of roots) rmSync(r, { recursive: true, force: true })
