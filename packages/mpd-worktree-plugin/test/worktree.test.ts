// The worktree row's acceptance suite: a REAL temporary git repository, driven through the SAME
// operation functions the tools register, so every rule of the frozen contract is exercised without a
// harness stub.
//
// Coverage (contract §3 Lane A "Tests"): create → path/branch exist; list/status fields; a second
// create refused; a path outside the workspace refused; merge success; merge CONFLICT aborts and
// leaves the main checkout clean; a protected branch refused without force; remove refuses unmerged
// without force and succeeds with force; index persistence and a tolerant corrupt read. Plus: the
// never-throwing member service (createForMember / cwdForMember), the cap, a detached main checkout,
// and the idempotent reseed lookup.
import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveConfig, type Config, type ResolvedConfig } from "../src/config"
import { createWorktree, createWorktreeService, cwdForMember, listWorktrees, mergeWorktree, removeWorktree, WorktreeError, worktreeStatus, type MpdWorktreeService, type WorktreeDeps } from "../src/ops"

/** One throwaway workspace: the git repository root, its resolved config and the captured log lines. */
interface Sandbox {
  /** The absolute workspace root (also the repository's toplevel). */
  root: string
  /** The resolved row config the operations run with. */
  config: ResolvedConfig
  /** Every line the row logger received. */
  log: string[]
  /** The dependencies the operations run with. */
  deps: WorktreeDeps
}

/** Every root this file created, removed again after each test so a failing arm leaves no litter. */
const createdRoots: string[] = []

/**
 * Runs one git command in a directory and returns its trimmed stdout.
 * @param cwd the directory `git -C` runs in.
 * @param args the git arguments.
 * @returns the trimmed standard output.
 */
function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim()
}

/**
 * Runs one git probe whose NON-ZERO exit is an expected answer (a missing ref, a non-ancestor).
 * @param cwd the directory `git -C` runs in.
 * @param args the git arguments.
 * @returns true when git exited 0.
 */
function gitOk(cwd: string, args: string[]): boolean {
  try {
    execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" })
    return true
  } catch {
    return false
  }
}

/**
 * Creates a temporary workspace: a git repository on `main` with one commit, and the deps object.
 * @param overrides row-config leaves to override (the default sandbox has NO protected branches so a
 *   merge into `main` is available to the arms that are not about protection).
 * @returns the sandbox.
 */
function makeSandbox(overrides: Partial<Config> = {}): Sandbox {
  /** The throwaway root directory. */
  const root = mkdtempSync(join(tmpdir(), "mpd-worktree-"))
  createdRoots.push(root)
  git(root, ["init", "-q", "-b", "main"])
  git(root, ["config", "user.email", "agent@example.com"])
  git(root, ["config", "user.name", "Worktree Test"])
  // The real deployment keeps worktrees under `<ws>/.mpd`, which the bundle's own .gitignore excludes;
  // the sandbox mirrors that so the main checkout's `status --porcelain` stays about TRACKED work.
  writeFileSync(join(root, ".gitignore"), ".mpd/\n")
  writeFileSync(join(root, "a.txt"), "one\n")
  git(root, ["add", "."])
  git(root, ["commit", "-q", "-m", "init"])
  /** The captured row log lines. */
  const log: string[] = []
  /** The resolved config: the caller's overrides over the documented defaults. */
  const config = resolveConfig({ protectedBranches: [], ...overrides })
  return { root, config, log, deps: { root, config, log: (line: string) => log.push(line) } }
}

/**
 * Commits one file inside a worktree (or the main checkout) with a fixed identity.
 * @param dir the checkout to commit in.
 * @param file the file name relative to the checkout root.
 * @param content the content to write.
 * @param message the commit message.
 * @returns the created commit's SHA.
 */
function commitFile(dir: string, file: string, content: string, message: string): string {
  writeFileSync(join(dir, file), content)
  git(dir, ["add", file])
  git(dir, ["commit", "-q", "-m", message])
  return git(dir, ["rev-parse", "HEAD"])
}

/**
 * Asserts that an operation refuses with a typed error, and returns it.
 * @param body the operation that must refuse.
 * @returns the thrown {@link WorktreeError}.
 */
function refusal(body: () => unknown): WorktreeError {
  try {
    body()
  } catch (error) {
    if (error instanceof WorktreeError) return error
    throw error
  }
  throw new Error("expected the operation to refuse with a WorktreeError, but it returned")
}

/**
 * Reads the raw state file the row wrote.
 * @param sandbox the sandbox whose index is read.
 * @returns the parsed JSON value, left unknown because the test asserts fields itself.
 */
function readRawIndex(sandbox: Sandbox): unknown {
  return JSON.parse(readFileSync(join(sandbox.root, ".mpd", "worktrees", "index.json"), "utf8")) as unknown
}

afterEach(() => {
  while (createdRoots.length > 0) {
    /** The next root to delete; `force` keeps a half-built sandbox from reddening cleanup. */
    const root = createdRoots.pop() as string
    rmSync(root, { recursive: true, force: true })
  }
})

describe("mpd_worktree_create", () => {
  test("creates the directory and branch under <ws>/.mpd/worktrees and records them", () => {
    /** The sandbox this arm works in. */
    const sandbox = makeSandbox()
    /** The create answer. */
    const created = createWorktree(sandbox.deps, { name: "alice" })

    expect(created.name).toBe("alice")
    expect(created.path).toBe(join(sandbox.root, ".mpd", "worktrees", "alice"))
    expect(created.branch).toBe("agent/alice")
    expect(created.repo).toBe(sandbox.root)
    expect(existsSync(created.path)).toBe(true)
    // The branch exists in the MAIN repository and the worktree is registered there.
    expect(git(sandbox.root, ["rev-parse", "--verify", "refs/heads/agent/alice"])).toHaveLength(40)
    expect(git(sandbox.root, ["worktree", "list", "--porcelain"])).toContain(created.path)

    /** The state file the create wrote. */
    const index = readRawIndex(sandbox) as { version: number; worktrees: Array<Record<string, unknown>> }
    expect(index.version).toBe(1)
    expect(index.worktrees).toHaveLength(1)
    expect(index.worktrees[0]?.key).toBe("manual/alice")
    expect(index.worktrees[0]?.status).toBe("active")
    expect(index.worktrees[0]?.base).toBe("main")
  })

  test("honours an explicit branch and base", () => {
    /** The sandbox this arm works in. */
    const sandbox = makeSandbox()
    /** The create answer with both overrides. */
    const created = createWorktree(sandbox.deps, { name: "bob", branch: "work/bob", base: "main" })

    expect(created.branch).toBe("work/bob")
    expect(git(sandbox.root, ["rev-parse", "--verify", "refs/heads/work/bob"])).toHaveLength(40)
  })

  test("refuses a second create of the same name", () => {
    /** The sandbox this arm works in. */
    const sandbox = makeSandbox()
    createWorktree(sandbox.deps, { name: "alice" })

    /** The refusal of the duplicate create. */
    const error = refusal(() => createWorktree(sandbox.deps, { name: "alice" }))
    expect(error.code).toBe("name-registered")
  })

  test("refuses a name outside the tool grammar", () => {
    /** The sandbox this arm works in. */
    const sandbox = makeSandbox()

    expect(refusal(() => createWorktree(sandbox.deps, { name: "Bad Name" })).code).toBe("invalid-name")
  })

  test("refuses a path outside the workspace root (D2)", () => {
    /** A sandbox whose worktree parent sits OUTSIDE the workspace root. */
    const sandbox = makeSandbox({ dir: "../mpd-worktree-outside" })

    /** The D2 refusal. */
    const error = refusal(() => createWorktree(sandbox.deps, { name: "alice" }))
    expect(error.code).toBe("outside-workspace")
    expect(error.message).toContain("D2")
    expect(existsSync(join(sandbox.root, "..", "mpd-worktree-outside", "alice"))).toBe(false)
  })

  test("refuses a branch that already exists and an invalid branch name", () => {
    /** The sandbox this arm works in. */
    const sandbox = makeSandbox()

    expect(refusal(() => createWorktree(sandbox.deps, { name: "alice", branch: "main" })).code).toBe("branch-exists")
    expect(refusal(() => createWorktree(sandbox.deps, { name: "alice", branch: "-dash" })).code).toBe("invalid-branch")
  })

  test("refuses once the active-worktree cap is reached", () => {
    /** A sandbox capped at one active worktree. */
    const sandbox = makeSandbox({ max: 1 })
    createWorktree(sandbox.deps, { name: "alice" })

    expect(refusal(() => createWorktree(sandbox.deps, { name: "bob" })).code).toBe("limit-reached")
  })

  test("refuses a workspace that is not a git repository", () => {
    /** A bare temporary directory, not a repository. */
    const root = mkdtempSync(join(tmpdir(), "mpd-worktree-norepo-"))
    createdRoots.push(root)
    /** The deps of that non-repository workspace. */
    const deps: WorktreeDeps = { root, config: resolveConfig({}), log: () => {} }

    expect(refusal(() => createWorktree(deps, { name: "alice" })).code).toBe("not-a-repo")
  })
})

describe("mpd_worktree_list and status", () => {
  test("reports the live fields, including ahead/behind and merged", () => {
    /** The sandbox this arm works in. */
    const sandbox = makeSandbox()
    /** The created worktree. */
    const created = createWorktree(sandbox.deps, { name: "alice" })
    // The main checkout makes progress AFTER the worktree was cut, so the pair diverges.
    commitFile(sandbox.root, "m.txt", "main\n", "main ahead")

    /** The listed record of the fresh worktree. */
    const record = worktreeStatus(sandbox.deps, "alice")
    expect(record.exists).toBe(true)
    expect(record.dirty).toBe(false)
    expect(record.ahead).toBe(0)
    expect(record.behind).toBe(1)
    expect(record.merged).toBe(true)

    // A commit in the worktree flips ahead, and an uncommitted file flips dirty.
    commitFile(created.path, "w.txt", "work\n", "work ahead")
    writeFileSync(join(created.path, "scratch.txt"), "uncommitted\n")
    /** The record after the worktree moved. */
    const movedRecord = worktreeStatus(sandbox.deps, "alice")
    expect(movedRecord.ahead).toBe(1)
    expect(movedRecord.dirty).toBe(true)
    expect(movedRecord.merged).toBe(false)

    /** The list of every live record. */
    const listed = listWorktrees(sandbox.deps)
    expect(listed).toHaveLength(1)
    expect(listed[0]?.name).toBe("alice")
  })

  test("an unknown name is a structured refusal naming the known ones", () => {
    /** The sandbox this arm works in. */
    const sandbox = makeSandbox()
    createWorktree(sandbox.deps, { name: "alice" })

    /** The unknown-name refusal. */
    const error = refusal(() => worktreeStatus(sandbox.deps, "nobody"))
    expect(error.code).toBe("unknown-worktree")
    expect(error.message).toContain("alice")
  })

  test("status also accepts the record key", () => {
    /** The sandbox this arm works in. */
    const sandbox = makeSandbox()
    createWorktree(sandbox.deps, { name: "alice", teamId: "plan-x", member: "alice" })

    expect(worktreeStatus(sandbox.deps, "plan-x/alice").name).toBe("alice")
  })
})

describe("mpd_worktree_merge", () => {
  test("merges a fast-forward-able branch with a merge commit and marks the record merged", () => {
    /** The sandbox this arm works in. */
    const sandbox = makeSandbox()
    /** The created worktree. */
    const created = createWorktree(sandbox.deps, { name: "alice" })
    /** The commit the worktree adds. */
    const workCommit = commitFile(created.path, "alice.txt", "alice\n", "alice work")

    /** The merge answer. */
    const merged = mergeWorktree(sandbox.deps, { name: "alice" })
    expect(merged.merged).toBe(true)
    expect(merged.branch).toBe("agent/alice")
    expect(merged.into).toBe("main")
    expect(merged.commit).toBe(git(sandbox.root, ["rev-parse", "HEAD"]))
    // --no-ff: the merge commit has two parents and the contract's message.
    expect(git(sandbox.root, ["rev-list", "--parents", "-n", "1", "HEAD"]).split(" ")).toHaveLength(3)
    expect(git(sandbox.root, ["log", "-1", "--pretty=%s"])).toBe("merge(manual/alice): agent/alice")
    expect(git(sandbox.root, ["merge-base", "--is-ancestor", workCommit, "HEAD"])).toBe("")
    expect(existsSync(join(sandbox.root, "alice.txt"))).toBe(true)
    expect(worktreeStatus(sandbox.deps, "alice").merged).toBe(true)
  })

  test("refuses a detached main checkout", () => {
    /** The sandbox this arm works in. */
    const sandbox = makeSandbox()
    /** The created worktree. */
    const created = createWorktree(sandbox.deps, { name: "alice" })
    commitFile(created.path, "alice.txt", "alice\n", "alice work")
    git(sandbox.root, ["checkout", "-q", "--detach"])

    expect(refusal(() => mergeWorktree(sandbox.deps, { name: "alice" })).code).toBe("detached-main")
  })

  test("refuses a target branch that is not checked out, and a tracked-dirty main checkout", () => {
    /** The sandbox this arm works in. */
    const sandbox = makeSandbox()
    /** The created worktree. */
    const created = createWorktree(sandbox.deps, { name: "alice" })
    commitFile(created.path, "alice.txt", "alice\n", "alice work")
    git(sandbox.root, ["branch", "other"])
    expect(refusal(() => mergeWorktree(sandbox.deps, { name: "alice", into: "other" })).code).toBe("into-not-checked-out")

    writeFileSync(join(sandbox.root, "a.txt"), "dirty\n")
    expect(refusal(() => mergeWorktree(sandbox.deps, { name: "alice" })).code).toBe("dirty-main")
  })

  test("refuses a protected branch without force, then merges with force", () => {
    /** A sandbox that protects `main`. */
    const sandbox = makeSandbox({ protectedBranches: ["main"] })
    /** The created worktree. */
    const created = createWorktree(sandbox.deps, { name: "alice" })
    commitFile(created.path, "alice.txt", "alice\n", "alice work")

    expect(refusal(() => mergeWorktree(sandbox.deps, { name: "alice" })).code).toBe("protected-branch")
    expect(mergeWorktree(sandbox.deps, { name: "alice", force: true }).merged).toBe(true)
  })

  test("a CONFLICT aborts, reports the paths and leaves the main checkout clean", () => {
    /** The sandbox this arm works in. */
    const sandbox = makeSandbox()
    /** The created worktree. */
    const created = createWorktree(sandbox.deps, { name: "alice" })
    commitFile(created.path, "a.txt", "worktree\n", "worktree edit")
    /** The main checkout's commit that competes for the same file. */
    const mainCommit = commitFile(sandbox.root, "a.txt", "main\n", "main edit")

    /** The conflict answer. */
    const merged = mergeWorktree(sandbox.deps, { name: "alice" })
    expect(merged.merged).toBe(false)
    expect(merged.conflicts).toEqual(["a.txt"])
    // "change nothing": HEAD unmoved, no merge in progress, no conflict markers, no staged paths.
    expect(git(sandbox.root, ["rev-parse", "HEAD"])).toBe(mainCommit)
    expect(existsSync(join(sandbox.root, ".git", "MERGE_HEAD"))).toBe(false)
    expect(git(sandbox.root, ["status", "--porcelain"])).toBe("")
    expect(readFileSync(join(sandbox.root, "a.txt"), "utf8")).toBe("main\n")
    expect(worktreeStatus(sandbox.deps, "alice").merged).toBe(false)
  })
})

describe("mpd_worktree_remove", () => {
  test("refuses a dirty worktree without force and removes it with force", () => {
    /** The sandbox this arm works in. */
    const sandbox = makeSandbox()
    /** The created worktree. */
    const created = createWorktree(sandbox.deps, { name: "alice" })
    writeFileSync(join(created.path, "scratch.txt"), "uncommitted\n")

    expect(refusal(() => removeWorktree(sandbox.deps, { name: "alice" })).code).toBe("dirty-worktree")
    /** The forced removal's answer. */
    const removed = removeWorktree(sandbox.deps, { name: "alice", force: true })
    expect(removed.removed).toBe(true)
    expect(removed.branchDeleted).toBe(true)
    expect(existsSync(created.path)).toBe(false)
    expect(gitOk(sandbox.root, ["rev-parse", "--verify", "--quiet", "refs/heads/agent/alice"])).toBe(false)
  })

  test("refuses an unmerged worktree without force, then removes it with force", () => {
    /** The sandbox this arm works in. */
    const sandbox = makeSandbox()
    /** The created worktree. */
    const created = createWorktree(sandbox.deps, { name: "alice" })
    commitFile(created.path, "alice.txt", "alice\n", "alice work")

    expect(refusal(() => removeWorktree(sandbox.deps, { name: "alice" })).code).toBe("unmerged")
    /** The forced removal's answer. */
    const removed = removeWorktree(sandbox.deps, { name: "alice", force: true })
    expect(removed.removed).toBe(true)
    expect(existsSync(created.path)).toBe(false)
  })

  test("removes a merged worktree without force, is idempotent, and prunes a vanished directory", () => {
    /** The sandbox this arm works in. */
    const sandbox = makeSandbox()
    /** The created worktree. */
    const created = createWorktree(sandbox.deps, { name: "alice" })
    commitFile(created.path, "alice.txt", "alice\n", "alice work")
    mergeWorktree(sandbox.deps, { name: "alice" })

    /** The ordinary removal's answer. */
    const removed = removeWorktree(sandbox.deps, { name: "alice" })
    expect(removed.removed).toBe(true)
    expect(removed.branchDeleted).toBe(true)
    expect(existsSync(created.path)).toBe(false)
    // A repeat call is a tombstone, not an error.
    expect(removeWorktree(sandbox.deps, { name: "alice" }).removed).toBe(true)

    // The vanished-directory path: create, delete the directory by hand, then remove again.
    /** A second worktree whose directory is deleted out of band. */
    const second = createWorktree(sandbox.deps, { name: "bob" })
    rmSync(second.path, { recursive: true, force: true })
    expect(removeWorktree(sandbox.deps, { name: "bob" }).removed).toBe(true)
  })
})

describe("state file", () => {
  test("a corrupt index reads as empty instead of throwing", () => {
    /** The sandbox this arm works in. */
    const sandbox = makeSandbox()
    createWorktree(sandbox.deps, { name: "alice" })
    /** The state file the row wrote. */
    const file = join(sandbox.root, ".mpd", "worktrees", "index.json")
    writeFileSync(file, "{ this is not json")

    expect(listWorktrees(sandbox.deps)).toEqual([])
    expect(refusal(() => worktreeStatus(sandbox.deps, "alice")).code).toBe("unknown-worktree")
  })

  test("a record with a malformed field is dropped, not trusted", () => {
    /** The sandbox this arm works in. */
    const sandbox = makeSandbox()
    createWorktree(sandbox.deps, { name: "alice" })
    /** The state file the row wrote. */
    const file = join(sandbox.root, ".mpd", "worktrees", "index.json")
    writeFileSync(file, JSON.stringify({ version: 1, worktrees: [{ key: "manual/alice", name: 42 }, { key: "manual/bob" }] }))

    expect(listWorktrees(sandbox.deps)).toEqual([])
  })
})

describe("mpdWorktree service", () => {
  /**
   * Builds the service over a fixed workspace root.
   * @param sandbox the sandbox whose root and config the service reads.
   * @returns the service object.
   */
  function serviceFor(sandbox: Sandbox): MpdWorktreeService {
    return createWorktreeService({ rootOf: () => sandbox.root, config: sandbox.config, log: (line: string) => sandbox.log.push(line) })
  }

  test("createForMember places the worktree at <dir>/<team>/<member> and is idempotent", () => {
    /** The sandbox this arm works in. */
    const sandbox = makeSandbox()
    /** The service the lanes consume. */
    const service = serviceFor(sandbox)
    /** The first creation. */
    const first = service.createForMember(undefined, { teamId: "plan-x", member: "Senior Engineer" })
    expect(first?.path).toBe(join(sandbox.root, ".mpd", "worktrees", "plan-x", "senior-engineer"))
    expect(first?.branch).toBe("agent/plan-x/senior-engineer")
    expect(existsSync(first?.path ?? "")).toBe(true)

    /** The second call's answer: the SAME worktree, not a second one. */
    const second = service.createForMember(undefined, { teamId: "plan-x", member: "Senior Engineer" })
    expect(second).toEqual(first)
    /** The index after both calls. */
    const index = readRawIndex(sandbox) as { worktrees: unknown[] }
    expect(index.worktrees).toHaveLength(1)
    expect(cwdForMember(sandbox.deps, { teamId: "plan-x", member: "Senior Engineer" })).toBe(first?.path)
  })

  test("a non-git workspace degrades to undefined with exactly ONE log line", () => {
    /** A bare temporary directory, not a repository. */
    const root = mkdtempSync(join(tmpdir(), "mpd-worktree-norepo-"))
    createdRoots.push(root)
    /** The captured log lines. */
    const log: string[] = []
    /** The service over the non-repository workspace. */
    const service = createWorktreeService({ rootOf: () => root, config: resolveConfig({}), log: (line: string) => log.push(line) })

    expect(service.createForMember(undefined, { teamId: "plan-x", member: "alice" })).toBeUndefined()
    expect(log).toHaveLength(1)
    expect(log[0]).toContain("plan-x/alice")
    expect(log[0]).toContain("shared checkout")
    expect(service.cwdForMember(undefined, { teamId: "plan-x", member: "alice" })).toBeUndefined()
  })

  test("cwdForMember stays undefined for an unknown pair and for a vanished directory", () => {
    /** The sandbox this arm works in. */
    const sandbox = makeSandbox()
    /** The service the lanes consume. */
    const service = serviceFor(sandbox)
    expect(service.cwdForMember(undefined, { teamId: "plan-x", member: "nobody" })).toBeUndefined()

    /** A created worktree whose directory is then deleted out of band (a compaction reseed must not be handed a dead path). */
    const created = service.createForMember(undefined, { teamId: "plan-x", member: "alice" })
    rmSync(created?.path ?? "", { recursive: true, force: true })
    expect(service.cwdForMember(undefined, { teamId: "plan-x", member: "alice" })).toBeUndefined()
  })
})
