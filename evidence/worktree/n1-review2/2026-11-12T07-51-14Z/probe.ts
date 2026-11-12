// N1 re-verification probe (review2): drives the SOURCE operations in throwaway git repositories.
// Reviewer-owned evidence; never imported by the product and never touches the repository's own state.
// Every section asserts observable behaviour, so a regression prints FAIL and the process exits 1.
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveConfig, type Config } from "../../../../packages/mpd-worktree-plugin/src/config.ts"
import { createWorktree, mergeWorktree, removeWorktree, WorktreeError, type WorktreeDeps } from "../../../../packages/mpd-worktree-plugin/src/ops.ts"

const roots: string[] = []
let failures = 0

function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures += 1
  console.log(`${ok ? "PASS" : "FAIL"} ${label} :: ${detail}`)
}

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
  const root = mkdtempSync(join(tmpdir(), "n1-review2-"))
  roots.push(root)
  git(root, ["init", "-q", "-b", "main"])
  git(root, ["config", "user.email", "agent@example.com"])
  git(root, ["config", "user.name", "N1 Review Probe"])
  writeFileSync(join(root, ".gitignore"), ".mpd/\n")
  writeFileSync(join(root, "a.txt"), "one\n")
  git(root, ["add", "."])
  git(root, ["commit", "-q", "-m", "init"])
  return { root, config: resolveConfig(overrides), log: [] as string[] } as WorktreeDeps & { root: string }
}
function refusal(body: () => unknown): string {
  try { body(); return "NO-REFUSAL" } catch (e) { return e instanceof WorktreeError ? e.code : `NON-WORKTREE:${String(e)}` }
}
function indexOf(root: string): { worktrees: Array<Record<string, unknown>> } {
  return JSON.parse(readFileSync(join(root, ".mpd", "worktrees", "index.json"), "utf8")) as { worktrees: Array<Record<string, unknown>> }
}
function tamperIndex(root: string, mutate: (entry: Record<string, unknown>) => void): void {
  const idx = indexOf(root)
  mutate(idx.worktrees[0] as Record<string, unknown>)
  writeFileSync(join(root, ".mpd", "worktrees", "index.json"), JSON.stringify(idx))
}
function commitFile(worktree: string, file: string, body: string, message: string): void {
  writeFileSync(join(worktree, file), body)
  git(worktree, ["add", "."])
  git(worktree, ["commit", "-q", "-m", message])
}

console.log("=== A: F1 — vanished directory AND vanished branch (contract: missing path is PRUNED) ===")
{
  const deps = sandbox()
  const created = createWorktree(deps, { name: "alice" })
  rmSync(created.path, { recursive: true, force: true })
  git(deps.root, ["worktree", "prune"])
  git(deps.root, ["branch", "-D", "agent/alice"])
  let removed: { removed: boolean; branchDeleted: boolean } | undefined
  let thrown = ""
  try { removed = removeWorktree(deps, { name: "alice", force: true }) } catch (e) { thrown = e instanceof WorktreeError ? e.code : String(e) }
  const idx = indexOf(deps.root)
  check("A1 remove does not refuse", thrown === "", thrown === "" ? "no throw" : `threw ${thrown}`)
  check("A2 removed true", removed?.removed === true, JSON.stringify(removed))
  check("A3 branchDeleted false", removed?.branchDeleted === false, JSON.stringify(removed))
  check("A4 tombstone removed", idx.worktrees[0]?.status === "removed", String(idx.worktrees[0]?.status))
  check("A5 no branchPending", idx.worktrees[0]?.branchPending === undefined, String(idx.worktrees[0]?.branchPending))
  const recreate = refusal(() => createWorktree(deps, { name: "alice" }))
  check("A6 name is usable again", recreate === "NO-REFUSAL", recreate)
  check("A7 branch recreated", gitOk(deps.root, ["rev-parse", "--verify", "refs/heads/agent/alice"]), "refs/heads/agent/alice")
}

console.log("=== A2: F1 — merge of a vanished record still refuses ===")
{
  const deps = sandbox()
  const created = createWorktree(deps, { name: "alice" })
  rmSync(created.path, { recursive: true, force: true })
  git(deps.root, ["worktree", "prune"])
  git(deps.root, ["branch", "-D", "agent/alice"])
  const mainCommit = git(deps.root, ["rev-parse", "HEAD"])
  const mergeCode = refusal(() => mergeWorktree(deps, { name: "alice" }))
  check("A2.1 merge refuses unregistered-worktree", mergeCode === "unregistered-worktree", mergeCode)
  check("A2.2 main HEAD unmoved", git(deps.root, ["rev-parse", "HEAD"]) === mainCommit, "HEAD")
  check("A2.3 record still active", indexOf(deps.root).worktrees[0]?.status === "active", String(indexOf(deps.root).worktrees[0]?.status))
}

console.log("=== B: control — vanished directory with the branch still present (prune deletes it) ===")
{
  const deps = sandbox()
  const created = createWorktree(deps, { name: "alice" })
  rmSync(created.path, { recursive: true, force: true })
  git(deps.root, ["worktree", "prune"])
  const removed = removeWorktree(deps, { name: "alice", force: true })
  check("B1 branchDeleted true", removed.branchDeleted === true, JSON.stringify(removed))
  check("B2 branch gone", !gitOk(deps.root, ["rev-parse", "--verify", "refs/heads/agent/alice"]), "refs/heads/agent/alice")
  check("B3 tombstone removed", indexOf(deps.root).worktrees[0]?.status === "removed", String(indexOf(deps.root).worktrees[0]?.status))
}

console.log("=== C: PRESENT directory whose branch ref was deleted out of band ===")
{
  const deps = sandbox()
  const created = createWorktree(deps, { name: "alice" })
  execFileSync("git", ["-C", deps.root, "update-ref", "-d", "refs/heads/agent/alice"])
  const removeCode = refusal(() => removeWorktree(deps, { name: "alice", force: true }))
  const mergeCode = refusal(() => mergeWorktree(deps, { name: "alice" }))
  check("C1 remove refuses branch-missing", removeCode === "branch-missing", removeCode)
  check("C2 merge refuses branch-missing", mergeCode === "branch-missing", mergeCode)
  check("C3 directory survives", existsSync(created.path), created.path)
  check("C4 record still active", indexOf(deps.root).worktrees[0]?.status === "active", String(indexOf(deps.root).worktrees[0]?.status))
}

console.log("=== D: F3 — invalid recorded branch names refused at BOTH call sites ===")
for (const bad of ["-D", "bad..name"]) {
  const deps = sandbox()
  const created = createWorktree(deps, { name: "alice" })
  const mainCommit = git(deps.root, ["rev-parse", "HEAD"])
  tamperIndex(deps.root, (entry) => { entry.branch = bad })
  const removeCode = refusal(() => removeWorktree(deps, { name: "alice", force: true }))
  const mergeCode = refusal(() => mergeWorktree(deps, { name: "alice" }))
  check(`D[${bad}] remove invalid-branch`, removeCode === "invalid-branch", removeCode)
  check(`D[${bad}] merge invalid-branch`, mergeCode === "invalid-branch", mergeCode)
  check(`D[${bad}] real branch survives`, gitOk(deps.root, ["rev-parse", "--verify", "refs/heads/agent/alice"]), "refs/heads/agent/alice")
  check(`D[${bad}] directory survives`, existsSync(created.path), created.path)
  check(`D[${bad}] main HEAD unmoved`, git(deps.root, ["rev-parse", "HEAD"]) === mainCommit, "HEAD")
}

console.log("=== E: tampered protected record, directory PRESENT and GONE, force:true on both ops ===")
{
  const deps = sandbox({ protectedBranches: ["master", "dev"] })
  const created = createWorktree(deps, { name: "alice" })
  git(deps.root, ["branch", "master"])
  const mainCommit = git(deps.root, ["rev-parse", "HEAD"])
  tamperIndex(deps.root, (entry) => { entry.branch = "master" })
  const removePresent = refusal(() => removeWorktree(deps, { name: "alice", force: true }))
  const mergePresent = refusal(() => mergeWorktree(deps, { name: "alice", force: true }))
  check("E1 present remove protected-branch", removePresent === "protected-branch", removePresent)
  check("E2 present merge protected-branch", mergePresent === "protected-branch", mergePresent)
  rmSync(created.path, { recursive: true, force: true })
  git(deps.root, ["worktree", "prune"])
  const removeGone = refusal(() => removeWorktree(deps, { name: "alice", force: true }))
  const mergeGone = refusal(() => mergeWorktree(deps, { name: "alice", force: true }))
  check("E3 gone remove protected-branch", removeGone === "protected-branch", removeGone)
  check("E4 gone merge protected-branch", mergeGone === "protected-branch", mergeGone)
  check("E5 master survives", gitOk(deps.root, ["rev-parse", "--verify", "refs/heads/master"]), "refs/heads/master")
  check("E6 real branch survives", gitOk(deps.root, ["rev-parse", "--verify", "refs/heads/agent/alice"]), "refs/heads/agent/alice")
  check("E7 main HEAD unmoved", git(deps.root, ["rev-parse", "HEAD"]) === mainCommit, "HEAD")
  check("E8 record still active", indexOf(deps.root).worktrees[0]?.status === "active", String(indexOf(deps.root).worktrees[0]?.status))
}

console.log("=== F: mismatch and detached HEAD still refuse on BOTH operations ===")
{
  const deps = sandbox()
  const created = createWorktree(deps, { name: "alice" })
  git(deps.root, ["branch", "other"])
  const mainCommit = git(deps.root, ["rev-parse", "HEAD"])
  tamperIndex(deps.root, (entry) => { entry.branch = "other" })
  const removeCode = refusal(() => removeWorktree(deps, { name: "alice", force: true }))
  const mergeCode = refusal(() => mergeWorktree(deps, { name: "alice" }))
  check("F1 remove branch-mismatch", removeCode === "branch-mismatch", removeCode)
  check("F2 merge branch-mismatch", mergeCode === "branch-mismatch", mergeCode)
  check("F3 unrelated branch survives", gitOk(deps.root, ["rev-parse", "--verify", "refs/heads/other"]), "refs/heads/other")
  check("F4 real branch survives", gitOk(deps.root, ["rev-parse", "--verify", "refs/heads/agent/alice"]), "refs/heads/agent/alice")
  check("F5 directory survives", existsSync(created.path), created.path)
  check("F6 main HEAD unmoved", git(deps.root, ["rev-parse", "HEAD"]) === mainCommit, "HEAD")

  const detachedDeps = sandbox()
  const detached = createWorktree(detachedDeps, { name: "alice" })
  git(detached.path, ["checkout", "-q", "--detach"])
  const removeDetached = refusal(() => removeWorktree(detachedDeps, { name: "alice", force: true }))
  const mergeDetached = refusal(() => mergeWorktree(detachedDeps, { name: "alice" }))
  check("F7 detached remove branch-mismatch", removeDetached === "branch-mismatch", removeDetached)
  check("F8 detached merge branch-mismatch", mergeDetached === "branch-mismatch", mergeDetached)
  check("F9 detached dir survives", existsSync(detached.path), detached.path)
  check("F10 detached branch survives", gitOk(detachedDeps.root, ["rev-parse", "--verify", "refs/heads/agent/alice"]), "refs/heads/agent/alice")
}

console.log("=== G: valid record still merges and removes ===")
{
  const deps = sandbox()
  const created = createWorktree(deps, { name: "alice" })
  commitFile(created.path, "alice.txt", "alice\n", "alice work")
  const mergeCode = refusal(() => mergeWorktree(deps, { name: "alice" }))
  check("G1 merge succeeds", mergeCode === "NO-REFUSAL", mergeCode)
  check("G2 record merged", indexOf(deps.root).worktrees[0]?.status === "merged", String(indexOf(deps.root).worktrees[0]?.status))
  const removed = removeWorktree(deps, { name: "alice" })
  check("G3 remove succeeds", removed.removed === true, JSON.stringify(removed))
  check("G4 branch deleted", removed.branchDeleted === true, JSON.stringify(removed))
  check("G5 directory gone", !existsSync(created.path), created.path)
}

for (const root of roots) rmSync(root, { recursive: true, force: true })
console.log(`RESULT: ${failures === 0 ? "PASS" : "FAIL"} failures=${failures} sandboxes=${roots.length}`)
process.exit(failures === 0 ? 0 : 1)
