// Reviewer probe: N1's HEAD-equality check compares the RECORDED branch with git's ABBREVIATED branch
// answer. When the created name is ambiguous with an existing tag/ref, the abbreviation differs and
// remove/merge refuse forever. Reviewer-owned evidence; never imported by the product.
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveConfig } from "../../../../packages/mpd-worktree-plugin/src/config.ts"
import { createWorktree, mergeWorktree, removeWorktree, WorktreeError, type WorktreeDeps } from "../../../../packages/mpd-worktree-plugin/src/ops.ts"
function git(cwd: string, args: string[]): string { return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim() }
function gitOk(cwd: string, args: string[]): boolean { try { execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: "pipe" }); return true } catch { return false } }
function refusal(body: () => unknown): string { try { body(); return "NO-REFUSAL" } catch (e) { return e instanceof WorktreeError ? e.code : `NON:${String(e)}` } }
function sandbox(): WorktreeDeps & { root: string } {
  const root = mkdtempSync(join(tmpdir(), "n1-review3-amb-"))
  git(root, ["init", "-q", "-b", "main"]); git(root, ["config", "user.email", "a@b.c"]); git(root, ["config", "user.name", "p"])
  writeFileSync(join(root, ".gitignore"), ".mpd/\n"); writeFileSync(join(root, "a.txt"), "one\n")
  git(root, ["add", "."]); git(root, ["commit", "-q", "-m", "init"])
  return { root, config: resolveConfig({ protectedBranches: [] }), log: () => undefined }
}
// A) explicit branch name equal to an existing TAG (release tags and branches often share a name).
{
  const s = sandbox()
  git(s.root, ["tag", "feature", "main"])
  const created = createWorktree(s, { name: "alice", branch: "feature" })
  console.log("A create branch=feature with tag feature -> NO-REFUSAL; recorded =", created.branch)
  console.log("A worktree HEAD abbrev =", git(created.path, ["rev-parse", "--abbrev-ref", "HEAD"]))
  console.log("A merge =", refusal(() => mergeWorktree(s, { name: "alice" })))
  console.log("A remove(force) =", refusal(() => removeWorktree(s, { name: "alice", force: true })))
  console.log("A dir survives =", existsSync(created.path))
  const idx = JSON.parse(readFileSync(join(s.root, ".mpd", "worktrees", "index.json"), "utf8")) as { worktrees: Array<Record<string, unknown>> }
  console.log("A record active =", idx.worktrees[0]?.status === "active")
  rmSync(s.root, { recursive: true, force: true })
}
// B) the DEFAULT member branch name colliding with a tag of the same name.
{
  const s = sandbox()
  git(s.root, ["tag", "agent/alice", "main"])
  const created = createWorktree(s, { name: "alice" })
  console.log("\nB create default branch=agent/alice with tag agent/alice -> NO-REFUSAL; recorded =", created.branch)
  console.log("B worktree HEAD abbrev =", git(created.path, ["rev-parse", "--abbrev-ref", "HEAD"]))
  console.log("B merge =", refusal(() => mergeWorktree(s, { name: "alice" })))
  console.log("B remove(force) =", refusal(() => removeWorktree(s, { name: "alice", force: true })))
  console.log("B dir survives =", existsSync(created.path))
  rmSync(s.root, { recursive: true, force: true })
}
// C) control: no ambiguous ref exists.
{
  const s = sandbox()
  const created = createWorktree(s, { name: "alice" })
  console.log("\nC control create agent/alice without a colliding tag -> abbrev =", git(created.path, ["rev-parse", "--abbrev-ref", "HEAD"]), "remove =", refusal(() => removeWorktree(s, { name: "alice" })))
  rmSync(s.root, { recursive: true, force: true })
}
