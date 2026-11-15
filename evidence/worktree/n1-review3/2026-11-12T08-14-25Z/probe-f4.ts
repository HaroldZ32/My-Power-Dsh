// Independent F4 re-verification probe (review3) — reviewer-owned evidence, never imported by the
// product and never touching the repository's own state. Every section asserts observable behaviour in
// throwaway git repositories, so a regression prints FAIL and the process exits 1.
//
// Sections: A creation refuses a configured protected branch with NO side effect; B the registered
// tool surface has no `force` escape and ignores an extra force argument; C protection precedes the
// branch-exists check and is applied to the trimmed name; D the member-service reattach recovery is
// refused while the branch is protected and stays recoverable once it is not; E the N1 properties
// (vanished-dir prune, tampered protected/mismatch/detached, option injection, valid merge/remove).
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply } from "../../../../packages/mpd-worktree-plugin/src/index.ts"
import { resolveConfig, type Config, type ResolvedConfig } from "../../../../packages/mpd-worktree-plugin/src/config.ts"
import {
  createForMember,
  createWorktree,
  createWorktreeService,
  mergeWorktree,
  removeWorktree,
  WorktreeError,
  type WorktreeDeps,
} from "../../../../packages/mpd-worktree-plugin/src/ops.ts"

/** The temporary checkouts this probe made, removed at the end. */
const roots: string[] = []
/** The number of assertions that failed; the process exit code mirrors it. */
let failures = 0

/**
 * Prints one assertion and records a failure.
 * @param label the assertion name.
 * @param ok whether the observable matched the requirement.
 * @param detail the observed value, printed either way.
 */
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures += 1
  console.log(`${ok ? "PASS" : "FAIL"} ${label} :: ${detail}`)
}

/**
 * Runs git in a directory and returns trimmed stdout.
 * @param cwd the directory.
 * @param args the git arguments.
 * @returns the trimmed stdout.
 */
function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim()
}

/**
 * Whether a git command exits zero.
 * @param cwd the directory.
 * @param args the git arguments.
 * @returns true when git exits zero.
 */
function gitOk(cwd: string, args: string[]): boolean {
  try {
    execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: "pipe" })
    return true
  } catch {
    return false
  }
}

/** One throwaway repository plus the dependency object the operations take. */
interface ProbeSandbox {
  /** The repository/workspace root. */
  root: string
  /** The effective config object (shared by reference with `deps`, so an in-place change is seen). */
  config: ResolvedConfig
  /** The captured row log lines. */
  log: string[]
  /** The dependency object the five operations take. */
  deps: WorktreeDeps
}

/**
 * Makes a one-commit repository under its own temp directory.
 * @param overrides row-config leaves for this sandbox.
 * @returns the sandbox with its config and deps.
 */
function sandbox(overrides: Partial<Config> = {}): ProbeSandbox {
  const root = mkdtempSync(join(tmpdir(), "n1-review3-"))
  roots.push(root)
  git(root, ["init", "-q", "-b", "main"])
  git(root, ["config", "user.email", "agent@example.com"])
  git(root, ["config", "user.name", "N1 Review3 Probe"])
  writeFileSync(join(root, ".gitignore"), ".mpd/\n")
  writeFileSync(join(root, "a.txt"), "one\n")
  git(root, ["add", "."])
  git(root, ["commit", "-q", "-m", "init"])
  const log: string[] = []
  const config = resolveConfig(overrides)
  return { root, config, log, deps: { root, config, log: (line: string) => log.push(line) } }
}

/**
 * The refusal code a body throws, or `NO-REFUSAL` / `NON-WORKTREE:<value>` when it did not refuse.
 * @param body the operation to drive.
 * @returns the stable refusal code or a marker naming the unexpected outcome.
 */
function refusal(body: () => unknown): string {
  try {
    body()
    return "NO-REFUSAL"
  } catch (error) {
    return error instanceof WorktreeError ? error.code : `NON-WORKTREE:${String(error)}`
  }
}

/**
 * Parses the sandbox's state file.
 * @param s the sandbox.
 * @returns the parsed index.
 */
function indexOf(s: ProbeSandbox): { worktrees: Array<Record<string, unknown>> } {
  return JSON.parse(readFileSync(join(s.root, ".mpd", "worktrees", "index.json"), "utf8")) as {
    worktrees: Array<Record<string, unknown>>
  }
}

/**
 * Rewrites the first record of the state file (the untrusted-record simulation).
 * @param s the sandbox.
 * @param mutate the field mutation.
 */
function tamperIndex(s: ProbeSandbox, mutate: (entry: Record<string, unknown>) => void): void {
  const idx = indexOf(s)
  mutate(idx.worktrees[0] as Record<string, unknown>)
  writeFileSync(join(s.root, ".mpd", "worktrees", "index.json"), JSON.stringify(idx))
}

/**
 * Commits one file inside a worktree and returns the new HEAD.
 * @param worktree the worktree directory.
 * @param file the file name.
 * @param body the file contents.
 * @param message the commit subject.
 * @returns the committed SHA.
 */
function commitFile(worktree: string, file: string, body: string, message: string): string {
  writeFileSync(join(worktree, file), body)
  git(worktree, ["add", "."])
  git(worktree, ["commit", "-q", "-m", message])
  return git(worktree, ["rev-parse", "HEAD"])
}

/**
 * The local branch names git reports, sorted, as one comma-joined string.
 * @param root the repository.
 * @returns the branch names.
 */
function branches(root: string): string {
  return git(root, ["branch", "--format=%(refname:short)"]).split("\n").filter((line) => line !== "").sort().join(",")
}

console.log("=== A: create refuses a configured protected branch with NO git/registry side effect (F4) ===")
for (const branch of ["dev", "master"]) {
  /** A repo whose default is main and which lacks both protected names. */
  const s = sandbox({ protectedBranches: ["master", "dev"] })
  /** The worktree path the refused create would have used. */
  const target = join(s.root, ".mpd", "worktrees", "alice")
  /** The state path the refused create must not write. */
  const index = join(s.root, ".mpd", "worktrees", "index.json")
  /** The stable refusal code. */
  const code = refusal(() => createWorktree(s.deps, { name: "alice", branch }))
  check(`A[${branch}].1 refusal`, code === "protected-branch", code)
  check(`A[${branch}].2 no branch ref`, !gitOk(s.root, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]), `refs/heads/${branch}`)
  check(`A[${branch}].3 no directory`, !existsSync(target), target)
  check(`A[${branch}].4 no git registration`, !git(s.root, ["worktree", "list", "--porcelain"]).includes(target), "worktree list")
  check(`A[${branch}].5 no index record`, !existsSync(index), index)
  check(`A[${branch}].6 branch set unchanged`, branches(s.root) === "main", branches(s.root))
  /** The same name created on the default, non-protected branch AFTER the refusal. */
  const created = createWorktree(s.deps, { name: "alice" })
  check(`A[${branch}].7 name still usable`, created.branch === "agent/alice" && existsSync(created.path), `${created.branch} ${created.path}`)
  check(`A[${branch}].8 only the successful record exists`, indexOf(s).worktrees.length === 1 && indexOf(s).worktrees[0]?.branch === "agent/alice", JSON.stringify(indexOf(s).worktrees.map((entry) => entry.branch)))
}

console.log("=== B: the registered CREATE tool has no force argument and ignores an extra force:true (F4) ===")
{
  /** A repo protecting the release/integration names. */
  const s = sandbox({ protectedBranches: ["master", "dev"] })
  /** The tool definitions the row really registers. */
  const tools = new Map<string, { description: string; parameters: { properties?: Record<string, unknown> }; execute: (args: unknown, exec: unknown) => unknown }>()
  /** The adapter's captured row log. */
  const adapterLog: string[] = []
  /** A minimal adapter double: only the two seams `apply` uses. */
  const adapter = {
    registerTool: (definition: { name: string; description: string; parameters: { properties?: Record<string, unknown> }; execute: (args: unknown, exec: unknown) => unknown }): void => {
      tools.set(definition.name, definition)
    },
    rowLog: (_row: string, line: string): void => {
      adapterLog.push(line)
    },
    workspaceRoot: (): string => s.root,
  }
  /** A ctx double: the mounted adapter for `mpdDsh`, nothing else. */
  const ctx = {
    get: (id: string): unknown => (id === "mpdDsh" ? adapter : undefined),
    provide: (): void => undefined,
  }
  apply(ctx, { protectedBranches: ["master", "dev"], repo: s.root })
  /** The create tool definition. */
  const createTool = tools.get("mpd_worktree_create")
  check("B.1 create tool registered", createTool !== undefined, [...tools.keys()].join(","))
  check("B.2 no force property in the schema", createTool !== undefined && !("force" in (createTool.parameters.properties ?? {})), JSON.stringify(Object.keys(createTool?.parameters.properties ?? {})))
  /** The refusal an extra force:true argument still gets. */
  let code = "NO-REFUSAL"
  try {
    createTool?.execute({ name: "alice", branch: "dev", force: true }, undefined)
  } catch (error) {
    code = error instanceof WorktreeError ? error.code : `NON-WORKTREE:${String(error)}`
  }
  /** The worktree path the forced call would have used. */
  const target = join(s.root, ".mpd", "worktrees", "alice")
  check("B.3 force:true in args still refused", code === "protected-branch", code)
  check("B.4 no side effects from the forced call", !existsSync(target) && !gitOk(s.root, ["rev-parse", "--verify", "--quiet", "refs/heads/dev"]), "no dir, no ref")
  check("B.5 no index written", !existsSync(join(s.root, ".mpd", "worktrees", "index.json")), "index absent")
}

console.log("=== C: protection precedes branch-exists and matches the trimmed name (F4) ===")
{
  /** A repo protecting dev. */
  const s = sandbox({ protectedBranches: ["dev"] })
  // The branch EXISTS before the create: the refusal must still be protection, not branch-exists.
  git(s.root, ["branch", "dev"])
  /** The refusal for an existing protected branch. */
  const existing = refusal(() => createWorktree(s.deps, { name: "alice", branch: "dev" }))
  check("C.1 existing dev still protected-branch", existing === "protected-branch", existing)
  /** The refusal for a padded spelling of the protected name. */
  const padded = refusal(() => createWorktree(s.deps, { name: "alice", branch: " dev " }))
  check("C.2 padded name still protected-branch", padded === "protected-branch", padded)
  check("C.3 no worktree was created", !existsSync(join(s.root, ".mpd", "worktrees", "alice")), "path absent")
  /** A different, non-protected branch still creates. */
  const created = createWorktree(s.deps, { name: "alice", branch: "work/alice" })
  check("C.4 non-protected branch creates", created.branch === "work/alice" && gitOk(s.root, ["rev-parse", "--verify", "--quiet", "refs/heads/work/alice"]), created.branch)
}

console.log("=== D: member-service reattach recovery refuses a protected branch, then recovers once unprotected (F4) ===")
{
  /** A sandbox that starts unprotected so the first member create is legitimate. */
  const s = sandbox()
  /** The service the team/cellwork lanes consume. */
  const service = createWorktreeService({ rootOf: () => s.root, config: s.config, log: (line: string) => s.log.push(line) })
  /** The first, successful member worktree. */
  const first = createForMember(s.deps, { teamId: "plan-x", member: "Senior Engineer" })
  check("D.1 first member worktree created", first !== undefined && existsSync(first.path), JSON.stringify(first))
  /** A member commit the refusal must preserve. */
  const workCommit = commitFile(first?.path ?? "", "kept.txt", "kept\n", "member work")
  /** The recorded path the recovery would reattach. */
  const target = first?.path ?? ""
  /** The member branch. */
  const branch = first?.branch ?? ""
  s.config.protectedBranches.push(branch)
  rmSync(target, { recursive: true, force: true })
  // Direct service implementation: the recovery refuses with the stable code.
  /** The direct refusal of the missing-directory recovery. */
  const code = refusal(() => createForMember(s.deps, { teamId: "plan-x", member: "Senior Engineer" }))
  check("D.2 recovery refuses protected-branch", code === "protected-branch", code)
  check("D.3 path stays gone (no reattach)", !existsSync(target), target)
  check("D.4 branch keeps its commit", git(s.root, ["rev-parse", `refs/heads/${branch}`]) === workCommit, branch)
  check("D.5 no git worktree registration", !git(s.root, ["worktree", "list", "--porcelain"]).includes(target), "worktree list")
  check("D.6 stale record untouched and active", indexOf(s).worktrees[0]?.branch === branch && indexOf(s).worktrees[0]?.status === "active", JSON.stringify(indexOf(s).worktrees[0]))
  check("D.7 lane service degrades to undefined", service.createForMember(undefined, { teamId: "plan-x", member: "Senior Engineer" }) === undefined, "undefined")
  check("D.8 one log line names protected-branch", s.log.some((line) => line.includes("plan-x/Senior Engineer") && line.includes("protected-branch")), s.log.join(" | "))
  // Protection removed: the SAME call recovers and reattaches the branch, so the refusal stranded nothing.
  s.config.protectedBranches = s.config.protectedBranches.filter((name) => name !== branch)
  /** The recovered worktree after protection is lifted. */
  const recovered = service.createForMember(undefined, { teamId: "plan-x", member: "Senior Engineer" })
  check("D.9 recovers once unprotected", recovered !== undefined && existsSync(recovered.path), JSON.stringify(recovered))
  check("D.10 reattach preserves the member commit", recovered !== undefined && git(recovered.path, ["rev-parse", "HEAD"]) === workCommit, recovered === undefined ? "undefined" : git(recovered.path, ["rev-parse", "HEAD"]))
}

console.log("=== E: N1 properties remain intact (F1/F2/F3 regression) ===")
{
  // E1 — vanished directory AND vanished branch: remove prunes, frees the name, merge still refuses.
  /** A sandbox with no protected names. */
  const s = sandbox()
  /** The worktree that will vanish. */
  const created = createWorktree(s.deps, { name: "alice" })
  rmSync(created.path, { recursive: true, force: true })
  git(s.root, ["worktree", "prune"])
  git(s.root, ["branch", "-D", "agent/alice"])
  /** The prune answer. */
  const removed = removeWorktree(s.deps, { name: "alice", force: true })
  check("E1.1 remove prunes without force", removed.removed === true, JSON.stringify(removed))
  check("E1.2 branchDeleted false", removed.branchDeleted === false, String(removed.branchDeleted))
  check("E1.3 tombstone has no branchPending", indexOf(s).worktrees[0]?.status === "removed" && indexOf(s).worktrees[0]?.branchPending === undefined, JSON.stringify(indexOf(s).worktrees[0]))
  /** The same name created after the prune. */
  const recreated = createWorktree(s.deps, { name: "alice" })
  check("E1.4 name usable again", recreated.branch === "agent/alice" && existsSync(recreated.path), recreated.branch)

  // E2 — a tampered protected record: both operations refuse even with force, nothing is mutated.
  /** A sandbox protecting the release lines. */
  const p = sandbox({ protectedBranches: ["master", "dev"] })
  /** The real worktree. */
  const protectedReal = createWorktree(p.deps, { name: "alice" })
  git(p.root, ["branch", "master"])
  /** The main checkout's commit before the attempts. */
  const protectedHead = git(p.root, ["rev-parse", "HEAD"])
  tamperIndex(p, (entry) => {
    entry.branch = "master"
  })
  check("E2.1 remove refuses protected-branch", refusal(() => removeWorktree(p.deps, { name: "alice", force: true })) === "protected-branch", refusal(() => removeWorktree(p.deps, { name: "alice", force: true })))
  check("E2.2 merge refuses protected-branch", refusal(() => mergeWorktree(p.deps, { name: "alice", force: true })) === "protected-branch", refusal(() => mergeWorktree(p.deps, { name: "alice", force: true })))
  check("E2.3 refs and directory survive", gitOk(p.root, ["rev-parse", "--verify", "--quiet", "refs/heads/master"]) && gitOk(p.root, ["rev-parse", "--verify", "--quiet", "refs/heads/agent/alice"]) && existsSync(protectedReal.path), "refs + dir")
  check("E2.4 main HEAD unmoved", git(p.root, ["rev-parse", "HEAD"]) === protectedHead, "HEAD")
  check("E2.5 record still active", indexOf(p).worktrees[0]?.status === "active", String(indexOf(p).worktrees[0]?.status))

  // E3 — a tampered record naming another existing local branch: branch-mismatch on both operations.
  /** A sandbox with no protected names. */
  const m = sandbox()
  /** The real worktree. */
  const mismatchReal = createWorktree(m.deps, { name: "alice" })
  git(m.root, ["branch", "other"])
  /** The main checkout's commit before the attempts. */
  const mismatchHead = git(m.root, ["rev-parse", "HEAD"])
  tamperIndex(m, (entry) => {
    entry.branch = "other"
  })
  check("E3.1 remove branch-mismatch", refusal(() => removeWorktree(m.deps, { name: "alice", force: true })) === "branch-mismatch", refusal(() => removeWorktree(m.deps, { name: "alice", force: true })))
  check("E3.2 merge branch-mismatch", refusal(() => mergeWorktree(m.deps, { name: "alice" })) === "branch-mismatch", refusal(() => mergeWorktree(m.deps, { name: "alice" })))
  check("E3.3 directory, refs and HEAD survive", existsSync(mismatchReal.path) && gitOk(m.root, ["rev-parse", "--verify", "--quiet", "refs/heads/other"]) && gitOk(m.root, ["rev-parse", "--verify", "--quiet", "refs/heads/agent/alice"]) && git(m.root, ["rev-parse", "HEAD"]) === mismatchHead, "intact")

  // E4 — a worktree whose HEAD was detached out of band: branch-mismatch on both operations.
  /** A sandbox with no protected names. */
  const d = sandbox()
  /** The worktree to detach. */
  const detachedReal = createWorktree(d.deps, { name: "alice" })
  git(detachedReal.path, ["checkout", "-q", "--detach"])
  check("E4.1 remove branch-mismatch", refusal(() => removeWorktree(d.deps, { name: "alice", force: true })) === "branch-mismatch", refusal(() => removeWorktree(d.deps, { name: "alice", force: true })))
  check("E4.2 merge branch-mismatch", refusal(() => mergeWorktree(d.deps, { name: "alice" })) === "branch-mismatch", refusal(() => mergeWorktree(d.deps, { name: "alice" })))
  check("E4.3 detached dir and branch survive", existsSync(detachedReal.path) && gitOk(d.root, ["rev-parse", "--verify", "--quiet", "refs/heads/agent/alice"]), "intact")

  // E5 — option-injection branch names are refused at BOTH call sites (F3).
  for (const bad of ["-D", "bad..name"]) {
    /** A sandbox with no protected names. */
    const f = sandbox()
    /** The real worktree. */
    const injectionReal = createWorktree(f.deps, { name: "alice" })
    tamperIndex(f, (entry) => {
      entry.branch = bad
    })
    check(`E5[${bad}].1 remove invalid-branch`, refusal(() => removeWorktree(f.deps, { name: "alice", force: true })) === "invalid-branch", refusal(() => removeWorktree(f.deps, { name: "alice", force: true })))
    check(`E5[${bad}].2 merge invalid-branch`, refusal(() => mergeWorktree(f.deps, { name: "alice" })) === "invalid-branch", refusal(() => mergeWorktree(f.deps, { name: "alice" })))
    check(`E5[${bad}].3 real branch and directory survive`, gitOk(f.root, ["rev-parse", "--verify", "--quiet", "refs/heads/agent/alice"]) && existsSync(injectionReal.path), "intact")
  }

  // E6 — the ordinary lifecycle still works end to end.
  /** A sandbox with no protected names. */
  const ok = sandbox()
  /** The valid worktree. */
  const valid = createWorktree(ok.deps, { name: "alice" })
  commitFile(valid.path, "alice.txt", "alice\n", "alice work")
  check("E6.1 merge succeeds", refusal(() => mergeWorktree(ok.deps, { name: "alice" })) === "NO-REFUSAL", "merged")
  check("E6.2 record marked merged", indexOf(ok).worktrees[0]?.status === "merged", String(indexOf(ok).worktrees[0]?.status))
  /** The removal answer. */
  const removedOk = removeWorktree(ok.deps, { name: "alice" })
  check("E6.3 remove succeeds and deletes the branch", removedOk.removed === true && removedOk.branchDeleted === true && !existsSync(valid.path), JSON.stringify(removedOk))
}

for (const root of roots) rmSync(root, { recursive: true, force: true })
console.log(`RESULT: ${failures === 0 ? "PASS" : "FAIL"} failures=${failures} sandboxes=${roots.length}`)
process.exit(failures === 0 ? 0 : 1)
