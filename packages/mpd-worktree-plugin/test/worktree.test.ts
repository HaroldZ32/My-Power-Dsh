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
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DEFAULT_MAX, effectiveConfig, resolveConfig, type Config, type ResolvedConfig } from "../src/config.ts"
import { GIT_TIMEOUT_CODE, runGit } from "../src/git.ts"
import { createForMember, createWorktree, createWorktreeService, cwdForMember, listWorktrees, mergeWorktree, removeWorktree, WorktreeError, worktreeStatus, type MpdWorktreeService, type WorktreeDeps } from "../src/ops.ts"

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

/**
 * Rewrites the first raw state-file record, for the arms that exercise a hostile or stale record.
 * @param sandbox the sandbox whose index is rewritten.
 * @param mutate the change applied to the first record.
 * @returns nothing.
 */
function tamperIndex(sandbox: Sandbox, mutate: (entry: Record<string, unknown>) => void): void {
  /** The parsed state file, narrowed to the shape the row itself writes. */
  const index = readRawIndex(sandbox) as { version: number; worktrees: Array<Record<string, unknown>> }
  mutate(index.worktrees[0] as Record<string, unknown>)
  writeFileSync(join(sandbox.root, ".mpd", "worktrees", "index.json"), JSON.stringify(index))
}

afterEach(() => {
  while (createdRoots.length > 0) {
    /** The next root to delete; `force` keeps a half-built sandbox from reddening cleanup. */
    const root = createdRoots.pop() as string
    rmSync(root, { recursive: true, force: true })
  }
})

describe("config", () => {
  test("a fractional cap that floors below one falls back to DEFAULT_MAX", () => {
    /** A fractional cap whose floor is zero, which must not disable every create. */
    const fractional = resolveConfig({ max: 0.5 })
    expect(fractional.max).toBe(DEFAULT_MAX)
    /** A fractional cap above one keeps its floored value. */
    expect(resolveConfig({ max: 2.9 }).max).toBe(2)
  })

  test("effectiveConfig falls back to the row config when the mpdConfig lookup throws", () => {
    /** A context whose strict lookup throws for the absent optional service. */
    const ctx = {
      get: (key: string): unknown => {
        throw new Error("service " + key + " is absent")
      },
    }
    /** The row config that must stay authoritative when the service cannot be resolved. */
    const resolved = effectiveConfig(ctx, { max: 3, branchPrefix: "row/" })
    expect(resolved.max).toBe(3)
    expect(resolved.branchPrefix).toBe("row/")
  })
})

describe("git runner", () => {
  test("a stalled git is killed at the bound and reports a DISTINCT timeout code", () => {
    /** A directory holding a fake `git` that outlives the configured bound. */
    const bin = mkdtempSync(join(tmpdir(), "mpd-worktree-fakegit-"))
    createdRoots.push(bin)
    /** The executable script name `spawnSync` resolves through PATH. */
    const fake = join(bin, "git")
    writeFileSync(fake, "#!/bin/sh\nsleep 5\n")
    chmodSync(fake, 0o755)
    /** The PATH to restore even when the assertion fails. */
    const realPath = process.env.PATH
    process.env.PATH = bin + ":" + (realPath ?? "")
    try {
      /** The bounded run against the stalling fake, with a bound a test can afford. */
      const result = runGit(bin, ["status"], 100)
      expect(result.code).toBe(GIT_TIMEOUT_CODE)
      expect(result.code).not.toBe(-1)
      expect(result.stderr).toContain("timed out")
    } finally {
      process.env.PATH = realPath
    }
  })
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

  test("refuses a configured protected branch before any git or registry mutation (F4)", () => {
    // A repo whose default branch is `main` has no `dev`/`master` yet: that is exactly the state in
    // which the pre-fix create succeeded and then remove/merge refused the untampered record forever.
    for (const branch of ["dev", "master"]) {
      /** A sandbox that protects the release/integration names while the repository lacks them. */
      const sandbox = makeSandbox({ protectedBranches: ["master", "dev"] })
      /** The path the refused create would have used. */
      const target = join(sandbox.root, ".mpd", "worktrees", "alice")

      /** The typed creation refusal. */
      const error = refusal(() => createWorktree(sandbox.deps, { name: "alice", branch }))
      expect(error.code).toBe("protected-branch")
      expect(error.message).toContain(branch)
      expect(error.message).toContain("protectedBranches")

      // Nothing was created: no branch, no directory, no git worktree registration, no state record.
      expect(gitOk(sandbox.root, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])).toBe(false)
      expect(existsSync(target)).toBe(false)
      expect(git(sandbox.root, ["worktree", "list", "--porcelain"])).not.toContain(target)
      expect(existsSync(join(sandbox.root, ".mpd", "worktrees", "index.json"))).toBe(false)

      // The refusal registered no name: the same name still creates on a non-protected branch.
      /** The same name created after the refusal, which proves the name was never registered. */
      const created = createWorktree(sandbox.deps, { name: "alice" })
      expect(created.branch).toBe("agent/alice")
      expect(existsSync(target)).toBe(true)
    }
  })

  test("still creates a non-protected branch while other names are protected", () => {
    /** A sandbox whose config protects the release/integration lines. */
    const sandbox = makeSandbox({ protectedBranches: ["master", "dev"] })
    /** The ordinary explicit branch create that the protection list must not block. */
    const created = createWorktree(sandbox.deps, { name: "bob", branch: "work/bob" })

    expect(created.branch).toBe("work/bob")
    expect(gitOk(sandbox.root, ["rev-parse", "--verify", "--quiet", "refs/heads/work/bob"])).toBe(true)
    /** The state record the successful create wrote. */
    const index = readRawIndex(sandbox) as { worktrees: Array<Record<string, unknown>> }
    expect(index.worktrees[0]?.branch).toBe("work/bob")
    expect(index.worktrees[0]?.status).toBe("active")
  })

  test("refuses a refs/-rooted branch argument before any git or registry mutation (F2)", () => {
    // `git check-ref-format --branch refs/heads/dev` exits 0 while git creates
    // `refs/heads/refs/heads/dev`: the old guard admitted a record nothing could consume, and the
    // protected-name check (an exact short-name comparison) never saw `dev`.
    /** A sandbox that protects `dev`, the name the full-ref spelling tries to reach. */
    const sandbox = makeSandbox({ protectedBranches: ["dev"] })
    /** The existing local branch the `refs/heads/dev` spelling addresses. */
    git(sandbox.root, ["branch", "dev"])
    /** The path the refused creates would have used. */
    const target = join(sandbox.root, ".mpd", "worktrees", "alice")

    for (const branch of ["refs/heads/dev", "refs/heads/main", "refs/heads/never-existed"]) {
      /** The typed creation refusal for the full-ref spelling. */
      const error = refusal(() => createWorktree(sandbox.deps, { name: "alice", branch }))
      expect(error.code).toBe("invalid-branch")
      expect(error.message).toContain("short branch name")

      // Nothing was created: no branch ref (git would create `refs/heads/<spelling>`), no directory,
      // no worktree registration and no state record.
      expect(gitOk(sandbox.root, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])).toBe(false)
      expect(existsSync(target)).toBe(false)
      expect(git(sandbox.root, ["worktree", "list", "--porcelain"])).not.toContain(target)
      expect(existsSync(join(sandbox.root, ".mpd", "worktrees", "index.json"))).toBe(false)
    }

    // The existing branches the spellings addressed were not touched by the refusals.
    expect(gitOk(sandbox.root, ["rev-parse", "--verify", "--quiet", "refs/heads/dev"])).toBe(true)
    expect(gitOk(sandbox.root, ["rev-parse", "--verify", "--quiet", "refs/heads/main"])).toBe(true)

    // A normal SHORT branch still creates; `dev` itself stays refused as protected (F4).
    /** The ordinary create after the refused spellings. */
    const created = createWorktree(sandbox.deps, { name: "alice", branch: "work/alice" })
    expect(created.branch).toBe("work/alice")
    expect(existsSync(target)).toBe(true)
    /** The state record the successful create wrote. */
    const index = readRawIndex(sandbox) as { worktrees: Array<Record<string, unknown>> }
    expect(index.worktrees[0]?.branch).toBe("work/alice")
    expect(index.worktrees[0]?.status).toBe("active")
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

  test("refuses a repository whose canonical top level is outside the workspace", () => {
    /** The sandbox whose workspace is the containment boundary. */
    const sandbox = makeSandbox()
    /** A separate repository outside the workspace. */
    const outside = mkdtempSync(join(tmpdir(), "mpd-worktree-outrepo-"))
    createdRoots.push(outside)
    git(outside, ["init", "-q", "-b", "main"])
    git(outside, ["config", "user.email", "agent@example.com"])
    git(outside, ["config", "user.name", "Worktree Test"])
    writeFileSync(join(outside, "x.txt"), "x\n")
    git(outside, ["add", "."])
    git(outside, ["commit", "-q", "-m", "init"])

    /** The refusal of the outside repository. */
    const error = refusal(() => createWorktree(sandbox.deps, { name: "alice", repo: outside }))
    expect(error.code).toBe("repo-outside-workspace")
    // Refused BEFORE any mutation: no branch or worktree in the outside repository, no workspace record.
    expect(gitOk(outside, ["rev-parse", "--verify", "--quiet", "refs/heads/agent/alice"])).toBe(false)
    expect(git(outside, ["worktree", "list", "--porcelain"])).not.toContain(sandbox.root)
    expect(existsSync(join(sandbox.root, ".mpd", "worktrees", "alice"))).toBe(false)
  })

  test("supports a repository CONTAINED in the workspace", () => {
    /** The sandbox whose workspace is the containment boundary. */
    const sandbox = makeSandbox()
    /** A nested repository under the workspace root. */
    const nested = join(sandbox.root, "nested")
    mkdirSync(nested)
    git(nested, ["init", "-q", "-b", "main"])
    git(nested, ["config", "user.email", "agent@example.com"])
    git(nested, ["config", "user.name", "Worktree Test"])
    writeFileSync(join(nested, "x.txt"), "x\n")
    git(nested, ["add", "."])
    git(nested, ["commit", "-q", "-m", "init"])

    /** The worktree created in the contained repository. */
    const created = createWorktree(sandbox.deps, { name: "nested", repo: "nested" })
    expect(created.repo).toBe(git(nested, ["rev-parse", "--show-toplevel"]))
    expect(existsSync(created.path)).toBe(true)
    expect(git(nested, ["worktree", "list", "--porcelain"])).toContain(created.path)
  })

  test("removes the just-added worktree and branch when recording it fails", () => {
    /** The sandbox whose state path is obstructed by a directory. */
    const sandbox = makeSandbox()
    /** A DIRECTORY where the index file must be renamed into place, so the write fails. */
    const obstruction = join(sandbox.root, ".mpd", "worktrees", "index.json")
    mkdirSync(obstruction, { recursive: true })
    /** The path the failed create would have used. */
    const target = join(sandbox.root, ".mpd", "worktrees", "alice")

    expect(() => createWorktree(sandbox.deps, { name: "alice" })).toThrow()
    // The orphan is rolled back: neither the directory nor the branch survives a failed record write.
    expect(existsSync(target)).toBe(false)
    expect(gitOk(sandbox.root, ["rev-parse", "--verify", "--quiet", "refs/heads/agent/alice"])).toBe(false)

    // With the obstruction gone the SAME create succeeds, proving the rollback left a retryable state.
    rmSync(obstruction, { recursive: true, force: true })
    expect(createWorktree(sandbox.deps, { name: "alice" }).path).toBe(target)
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

describe("mpd_worktree_remove record validation", () => {
  test("refuses a recorded path outside the worktree root", () => {
    /** The sandbox whose worktree root is the containment boundary. */
    const sandbox = makeSandbox()
    /** The worktree whose record is tampered with. */
    const created = createWorktree(sandbox.deps, { name: "alice" })
    /** A directory OUTSIDE the worktree root but inside the workspace. */
    const outside = join(sandbox.root, "outside-tree")
    mkdirSync(outside)
    writeFileSync(join(outside, "keep.txt"), "keep\n")
    tamperIndex(sandbox, (entry) => {
      entry.path = outside
    })

    /** The containment refusal. */
    const error = refusal(() => removeWorktree(sandbox.deps, { name: "alice", force: true }))
    expect(error.code).toBe("outside-workspace")
    // Nothing was removed: neither the tampered directory nor the real worktree.
    expect(existsSync(join(outside, "keep.txt"))).toBe(true)
    expect(existsSync(created.path)).toBe(true)
  })

  test("refuses an existing recorded path git does not list as a worktree", () => {
    /** The sandbox whose worktree root is the containment boundary. */
    const sandbox = makeSandbox()
    /** The worktree whose record is tampered with. */
    const created = createWorktree(sandbox.deps, { name: "alice" })
    /** A plain directory inside the worktree root that git does not manage. */
    const ghost = join(sandbox.root, ".mpd", "worktrees", "ghost")
    mkdirSync(ghost, { recursive: true })
    tamperIndex(sandbox, (entry) => {
      entry.path = ghost
    })

    /** The registration refusal. */
    const error = refusal(() => removeWorktree(sandbox.deps, { name: "alice", force: true }))
    expect(error.code).toBe("unregistered-worktree")
    expect(existsSync(ghost)).toBe(true)
    expect(existsSync(created.path)).toBe(true)
  })

  test("keeps a failed branch deletion retryable instead of a terminal tombstone", () => {
    /** The sandbox this arm works in. */
    const sandbox = makeSandbox()
    /** The worktree whose branch deletion is made to fail. */
    const created = createWorktree(sandbox.deps, { name: "alice" })
    /** A ref lock that makes git refuse the branch deletion on the first removal. */
    const lock = join(sandbox.root, ".git", "refs", "heads", "agent", "alice.lock")
    writeFileSync(lock, "held\n")

    /** The first removal: the directory goes, the branch deletion fails. */
    const first = removeWorktree(sandbox.deps, { name: "alice", force: true })
    expect(first.removed).toBe(true)
    expect(first.branchDeleted).toBe(false)
    expect(first.branchError).toBeDefined()
    expect(existsSync(created.path)).toBe(false)
    expect(gitOk(sandbox.root, ["rev-parse", "--verify", "--quiet", "refs/heads/agent/alice"])).toBe(true)
    /** The tombstone still asks for a retry instead of reporting the cleanup as done. */
    const pending = readRawIndex(sandbox) as { worktrees: Array<Record<string, unknown>> }
    expect(pending.worktrees[0]?.status).toBe("removed")
    expect(pending.worktrees[0]?.branchPending).toBe(true)

    /** With the lock released, a later remove retries and completes the cleanup. */
    rmSync(lock)
    /** The retry's answer, which must actually delete the branch this time. */
    const retried = removeWorktree(sandbox.deps, { name: "alice", force: true })
    expect(retried.branchDeleted).toBe(true)
    expect(gitOk(sandbox.root, ["rev-parse", "--verify", "--quiet", "refs/heads/agent/alice"])).toBe(false)
    /** The retry clears the pending flag, so the tombstone is terminal again. */
    const cleared = readRawIndex(sandbox) as { worktrees: Array<Record<string, unknown>> }
    expect(cleared.worktrees[0]?.branchPending).toBeUndefined()
  })
})

describe("recorded branch revalidation (N1)", () => {
  test("refuses a tampered protected branch for remove AND merge, even with force", () => {
    /** A sandbox whose config protects the release/integration lines. */
    const sandbox = makeSandbox({ protectedBranches: ["master", "dev"] })
    /** The worktree whose recorded branch is tampered with. */
    const created = createWorktree(sandbox.deps, { name: "alice" })
    /** A real local branch the tampered record points at, which a forced remove would delete. */
    git(sandbox.root, ["branch", "master"])
    /** The commit the main checkout is on, which a merge must not move. */
    const mainCommit = git(sandbox.root, ["rev-parse", "HEAD"])
    tamperIndex(sandbox, (entry) => {
      entry.branch = "master"
    })

    expect(refusal(() => removeWorktree(sandbox.deps, { name: "alice", force: true })).code).toBe("protected-branch")
    expect(refusal(() => mergeWorktree(sandbox.deps, { name: "alice", force: true })).code).toBe("protected-branch")

    // Nothing was deleted and nothing was merged.
    expect(gitOk(sandbox.root, ["rev-parse", "--verify", "--quiet", "refs/heads/master"])).toBe(true)
    expect(gitOk(sandbox.root, ["rev-parse", "--verify", "--quiet", "refs/heads/agent/alice"])).toBe(true)
    expect(existsSync(created.path)).toBe(true)
    expect(git(sandbox.root, ["rev-parse", "HEAD"])).toBe(mainCommit)

    // The protection check precedes the vanished-directory early return too: losing the directory out
    // of band must not turn a protected record into a prune.
    rmSync(created.path, { recursive: true, force: true })
    git(sandbox.root, ["worktree", "prune"])
    expect(refusal(() => removeWorktree(sandbox.deps, { name: "alice", force: true })).code).toBe("protected-branch")
    expect(refusal(() => mergeWorktree(sandbox.deps, { name: "alice", force: true })).code).toBe("protected-branch")
    expect(gitOk(sandbox.root, ["rev-parse", "--verify", "--quiet", "refs/heads/master"])).toBe(true)
    expect(gitOk(sandbox.root, ["rev-parse", "--verify", "--quiet", "refs/heads/agent/alice"])).toBe(true)
  })

  test("refuses a tampered record naming another existing local branch", () => {
    /** The sandbox this arm works in. */
    const sandbox = makeSandbox()
    /** The worktree whose recorded branch is tampered with. */
    const created = createWorktree(sandbox.deps, { name: "alice" })
    /** The unrelated local branch the tampered record names. */
    git(sandbox.root, ["branch", "other"])
    /** The commit the main checkout is on, which a merge must not move. */
    const mainCommit = git(sandbox.root, ["rev-parse", "HEAD"])
    tamperIndex(sandbox, (entry) => {
      entry.branch = "other"
    })

    /** The remove refusal; the live HEAD, not the record, is what git reports. */
    const removeError = refusal(() => removeWorktree(sandbox.deps, { name: "alice", force: true }))
    expect(removeError.code).toBe("branch-mismatch")
    expect(removeError.message).toContain("alice")
    expect(removeError.message).toContain("other")
    expect(removeError.message).toContain("agent/alice")
    /** The merge refusal against the SAME tampered record. */
    const mergeError = refusal(() => mergeWorktree(sandbox.deps, { name: "alice" }))
    expect(mergeError.code).toBe("branch-mismatch")
    expect(mergeError.message).toContain("other")
    expect(mergeError.message).toContain("agent/alice")

    // Both the unrelated branch and the real worktree branch survive, and no merge landed.
    expect(gitOk(sandbox.root, ["rev-parse", "--verify", "--quiet", "refs/heads/other"])).toBe(true)
    expect(gitOk(sandbox.root, ["rev-parse", "--verify", "--quiet", "refs/heads/agent/alice"])).toBe(true)
    expect(existsSync(created.path)).toBe(true)
    expect(git(sandbox.root, ["rev-parse", "HEAD"])).toBe(mainCommit)
  })

  test("refuses a tampered record naming a branch git does not have", () => {
    /** The sandbox this arm works in. */
    const sandbox = makeSandbox()
    /** The worktree whose recorded branch is tampered with. */
    const created = createWorktree(sandbox.deps, { name: "alice" })
    /** The commit the main checkout is on, which a merge must not move. */
    const mainCommit = git(sandbox.root, ["rev-parse", "HEAD"])
    tamperIndex(sandbox, (entry) => {
      entry.branch = "ghost/branch"
    })

    /** The remove refusal for a branch that no longer exists in the repository. */
    const removeError = refusal(() => removeWorktree(sandbox.deps, { name: "alice", force: true }))
    expect(removeError.code).toBe("branch-missing")
    expect(removeError.message).toContain("ghost/branch")
    /** The merge refusal for the same missing branch. */
    const mergeError = refusal(() => mergeWorktree(sandbox.deps, { name: "alice" }))
    expect(mergeError.code).toBe("branch-missing")

    expect(gitOk(sandbox.root, ["rev-parse", "--verify", "--quiet", "refs/heads/ghost/branch"])).toBe(false)
    expect(gitOk(sandbox.root, ["rev-parse", "--verify", "--quiet", "refs/heads/agent/alice"])).toBe(true)
    expect(existsSync(created.path)).toBe(true)
    expect(git(sandbox.root, ["rev-parse", "HEAD"])).toBe(mainCommit)
  })

  test("refuses option-injection branch names on remove AND merge, leaving the branch and directory intact", () => {
    /** The sandbox this arm works in. */
    const sandbox = makeSandbox()
    /** The worktree whose recorded branch is tampered with. */
    const created = createWorktree(sandbox.deps, { name: "alice" })
    // A leading `-D` would reach `git branch -D` as an OPTION, not a name, without the guard at THIS
    // call site; `bad..name` is the other shape `git check-ref-format --branch` must refuse.
    /** The hostile spellings a tampered record may carry. */
    const hostile = ["-D", "bad..name"]
    for (const branch of hostile) {
      tamperIndex(sandbox, (entry) => {
        entry.branch = branch
      })
      /** The remove refusal at the call site that consumes the branch. */
      const removeError = refusal(() => removeWorktree(sandbox.deps, { name: "alice", force: true }))
      expect(removeError.code).toBe("invalid-branch")
      expect(removeError.message).toContain(branch)
      /** The merge refusal against the SAME tampered record. */
      const mergeError = refusal(() => mergeWorktree(sandbox.deps, { name: "alice" }))
      expect(mergeError.code).toBe("invalid-branch")
      expect(mergeError.message).toContain(branch)
    }

    // Both refusals happened BEFORE git consumed the name: the real branch and its worktree survive.
    expect(gitOk(sandbox.root, ["rev-parse", "--verify", "--quiet", "refs/heads/agent/alice"])).toBe(true)
    expect(existsSync(created.path)).toBe(true)
  })

  test("prunes a vanished directory even when its branch is gone too, and frees the name", () => {
    /** The sandbox this arm works in. */
    const sandbox = makeSandbox()
    /** The worktree whose directory AND branch vanish out of band. */
    const created = createWorktree(sandbox.deps, { name: "alice" })
    // Reproduces `rm -rf` + `git branch -D`, and a crash between remove's branch delete and tombstone.
    rmSync(created.path, { recursive: true, force: true })
    git(sandbox.root, ["worktree", "prune"])
    git(sandbox.root, ["branch", "-D", "agent/alice"])

    // Merge is unchanged: there is nothing checked out there to merge from.
    expect(refusal(() => mergeWorktree(sandbox.deps, { name: "alice" })).code).toBe("unregistered-worktree")

    // The vanished directory is the documented PRUNE case, not a `branch-missing` refusal.
    /** The prune's answer: removed, with no branch left to delete. */
    const removed = removeWorktree(sandbox.deps, { name: "alice", force: true })
    expect(removed.removed).toBe(true)
    expect(removed.branchDeleted).toBe(false)
    /** The tombstone the prune wrote, read back from the raw state file. */
    const index = readRawIndex(sandbox) as { worktrees: Array<{ status: string; branchPending?: boolean }> }
    expect(index.worktrees[0]?.status).toBe("removed")
    expect(index.worktrees[0]?.branchPending).toBeUndefined()

    // The name is usable again: no stranded ACTIVE record and no branch left to clash with.
    /** The re-created worktree under the SAME name. */
    const recreated = createWorktree(sandbox.deps, { name: "alice" })
    expect(recreated.branch).toBe("agent/alice")
    expect(existsSync(recreated.path)).toBe(true)
    expect(gitOk(sandbox.root, ["rev-parse", "--verify", "--quiet", "refs/heads/agent/alice"])).toBe(true)
  })

  test("refuses a worktree whose HEAD was detached out of band", () => {
    /** The sandbox this arm works in. */
    const sandbox = makeSandbox()
    /** The worktree whose HEAD is detached directly. */
    const created = createWorktree(sandbox.deps, { name: "alice" })
    git(created.path, ["checkout", "-q", "--detach"])

    expect(refusal(() => removeWorktree(sandbox.deps, { name: "alice", force: true })).code).toBe("branch-mismatch")
    expect(refusal(() => mergeWorktree(sandbox.deps, { name: "alice" })).code).toBe("branch-mismatch")

    // The detached worktree and its branch both survive; nothing was removed or merged.
    expect(git(created.path, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("HEAD")
    expect(gitOk(sandbox.root, ["rev-parse", "--verify", "--quiet", "refs/heads/agent/alice"])).toBe(true)
    expect(existsSync(created.path)).toBe(true)
  })

  test("removes and merges a worktree whose branch name collides with a tag (F1)", () => {
    // A tag and a branch commonly share a name. `git rev-parse --abbrev-ref HEAD` then answered
    // `heads/feature` while the record stored `feature`, so remove/merge refused forever; a bare
    // `git merge feature` would resolve the TAG, so the branch tip is merged by its full local ref.
    /** The sandbox this arm works in. */
    const sandbox = makeSandbox()
    /** The tag whose name collides with the branch the create will make. */
    git(sandbox.root, ["tag", "feature", "main"])
    /** The worktree on the colliding name. */
    const created = createWorktree(sandbox.deps, { name: "alice", branch: "feature" })
    expect(created.branch).toBe("feature")
    // The precondition that poisoned the old comparison: git's abbreviated answer carries the namespace.
    expect(git(created.path, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("heads/feature")

    // A commit only the BRANCH carries: a merge that resolved the tag would leave it behind.
    /** The branch tip, asserted to become reachable from the main checkout's HEAD. */
    const tip = commitFile(created.path, "feature.txt", "feature\n", "feature work")
    // status reads the same recorded name through rev-list/merge-base: both must name the BRANCH.
    /** The live record before the merge: one commit ahead of main and not merged yet. */
    const beforeMerge = worktreeStatus(sandbox.deps, "alice")
    expect(beforeMerge.ahead).toBe(1)
    expect(beforeMerge.merged).toBe(false)
    /** The merge answer; a tag-resolving merge would report "Already up to date" and lose the commit. */
    const merged = mergeWorktree(sandbox.deps, { name: "alice" })
    expect(merged.merged).toBe(true)
    expect(merged.branch).toBe("feature")
    expect(gitOk(sandbox.root, ["merge-base", "--is-ancestor", tip, "HEAD"])).toBe(true)
    expect(existsSync(join(sandbox.root, "feature.txt"))).toBe(true)
    /** The live record after the merge, read through the same ambiguous name. */
    expect(worktreeStatus(sandbox.deps, "alice").merged).toBe(true)

    /** The removal that used to refuse `branch-mismatch` and strand the directory and the record. */
    const removed = removeWorktree(sandbox.deps, { name: "alice" })
    expect(removed.removed).toBe(true)
    expect(removed.branchDeleted).toBe(true)
    expect(existsSync(created.path)).toBe(false)
    expect(gitOk(sandbox.root, ["rev-parse", "--verify", "--quiet", "refs/heads/feature"])).toBe(false)
  })

  test("removes a default agent/ worktree whose branch name collides with a tag (F1)", () => {
    /** The sandbox this arm works in. */
    const sandbox = makeSandbox()
    /** The tag that collides with the DEFAULT branch name `agent/alice`. */
    git(sandbox.root, ["tag", "agent/alice", "main"])
    /** The worktree on the default branch. */
    const created = createWorktree(sandbox.deps, { name: "alice" })
    expect(created.branch).toBe("agent/alice")
    expect(git(created.path, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("heads/agent/alice")

    /** The removal that used to refuse `branch-mismatch`. */
    const removed = removeWorktree(sandbox.deps, { name: "alice" })
    expect(removed.removed).toBe(true)
    expect(removed.branchDeleted).toBe(true)
    expect(existsSync(created.path)).toBe(false)
    expect(gitOk(sandbox.root, ["rev-parse", "--verify", "--quiet", "refs/heads/agent/alice"])).toBe(false)
  })

  test("keeps a valid record mergeable and removable", () => {
    /** The sandbox this arm works in. */
    const sandbox = makeSandbox()
    /** The valid worktree. */
    const created = createWorktree(sandbox.deps, { name: "alice" })
    commitFile(created.path, "alice.txt", "alice\n", "alice work")

    expect(mergeWorktree(sandbox.deps, { name: "alice" }).merged).toBe(true)
    /** The ordinary removal after the merge. */
    const removed = removeWorktree(sandbox.deps, { name: "alice" })
    expect(removed.removed).toBe(true)
    expect(removed.branchDeleted).toBe(true)
    expect(existsSync(created.path)).toBe(false)
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

  test("member lookups ignore a directory git no longer registers as a worktree", () => {
    /** The sandbox this arm works in. */
    const sandbox = makeSandbox()
    /** A plain directory at the member path, present on disk but not a git worktree. */
    const ghost = join(sandbox.root, ".mpd", "worktrees", "plan-x", "ghost")
    mkdirSync(ghost, { recursive: true })
    /** The stale record that names the plain directory. */
    writeFileSync(
      join(sandbox.root, ".mpd", "worktrees", "index.json"),
      JSON.stringify({
        version: 1,
        worktrees: [
          {
            key: "plan-x/ghost",
            name: "ghost",
            repo: sandbox.root,
            path: ghost,
            branch: "agent/plan-x/ghost",
            base: "main",
            createdAt: new Date().toISOString(),
            status: "active",
          },
        ],
      }),
    )
    /** The service the lanes consume. */
    const service = serviceFor(sandbox)

    expect(service.cwdForMember(undefined, { teamId: "plan-x", member: "ghost" })).toBeUndefined()
    // Recovery neither hands out nor adopts the unmanaged directory; the spawn degrades to the shared checkout.
    expect(service.createForMember(undefined, { teamId: "plan-x", member: "ghost" })).toBeUndefined()
    expect(sandbox.log.some((line) => line.includes("plan-x/ghost") && line.includes("shared checkout"))).toBe(true)
  })

  test("re-attaches the existing branch when a member directory vanished, preserving its commits", () => {
    /** The sandbox this arm works in. */
    const sandbox = makeSandbox()
    /** The service the lanes consume. */
    const service = serviceFor(sandbox)
    /** The first worktree, which is about to disappear. */
    const first = service.createForMember(undefined, { teamId: "plan-x", member: "Senior Engineer" })
    /** The member's commit, which a reattach must never discard. */
    const workCommit = commitFile(first?.path ?? "", "kept.txt", "kept\n", "member work")
    rmSync(first?.path ?? "", { recursive: true, force: true })

    /** The recovered worktree, reattached to the same branch. */
    const recovered = service.createForMember(undefined, { teamId: "plan-x", member: "Senior Engineer" })
    expect(recovered?.path).toBe(first?.path)
    expect(recovered?.branch).toBe(first?.branch)
    expect(git(recovered?.path ?? "", ["rev-parse", "HEAD"])).toBe(workCommit)
    expect(git(recovered?.path ?? "", ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("agent/plan-x/senior-engineer")
    expect(readFileSync(join(recovered?.path ?? "", "kept.txt"), "utf8")).toBe("kept\n")
  })

  test("refuses the reattach recovery when the vanished directory's branch is protected (F4)", () => {
    /** The member branch the recovery would reattach. */
    const branch = "agent/plan-x/senior-engineer"
    /** A sandbox that starts without protection, because the first create must legitimately succeed. */
    const sandbox = makeSandbox()
    /** The service the lanes consume. */
    const service = serviceFor(sandbox)
    /** The worktree that is about to vanish; its branch carries one member commit. */
    const first = createForMember(sandbox.deps, { teamId: "plan-x", member: "Senior Engineer" })
    /** The commit the refusal must leave on the branch. */
    const workCommit = commitFile(first?.path ?? "", "kept.txt", "kept\n", "member work")
    /** The recorded path the recovery would reattach. */
    const target = first?.path ?? ""
    // The deployment protects the member branch AFTER the record exists: protection is evaluated per call.
    sandbox.config.protectedBranches.push(branch)
    rmSync(target, { recursive: true, force: true })

    /** The typed refusal of the missing-directory reattach recovery. */
    const error = refusal(() => createForMember(sandbox.deps, { teamId: "plan-x", member: "Senior Engineer" }))
    expect(error.code).toBe("protected-branch")
    expect(error.message).toContain(branch)

    // Nothing was reattached: the path stays gone, the branch keeps its commit, the stale record stays.
    expect(existsSync(target)).toBe(false)
    expect(git(sandbox.root, ["rev-parse", "--verify", `refs/heads/${branch}`])).toBe(workCommit)
    expect(git(sandbox.root, ["worktree", "list", "--porcelain"])).not.toContain(target)
    /** The state file the refusal left untouched. */
    const index = readRawIndex(sandbox) as { worktrees: Array<Record<string, unknown>> }
    expect(index.worktrees[0]?.branch).toBe(branch)
    expect(index.worktrees[0]?.status).toBe("active")

    // The lane-facing service never throws: the refusal degrades the spawn to the shared checkout.
    expect(service.createForMember(undefined, { teamId: "plan-x", member: "Senior Engineer" })).toBeUndefined()
    expect(sandbox.log.some((line) => line.includes("plan-x/Senior Engineer") && line.includes("protected-branch"))).toBe(true)
  })

  test("does not reattach a branch another worktree already has checked out", () => {
    /** The sandbox this arm works in. */
    const sandbox = makeSandbox()
    /** The service the lanes consume. */
    const service = serviceFor(sandbox)
    /** The first worktree, which is about to disappear. */
    const first = service.createForMember(undefined, { teamId: "plan-x", member: "Senior Engineer" })
    rmSync(first?.path ?? "", { recursive: true, force: true })
    git(sandbox.root, ["worktree", "prune"])
    /** Another worktree that now holds the same branch, making a reattach unsafe. */
    const holder = join(sandbox.root, ".mpd", "worktrees", "holder")
    git(sandbox.root, ["worktree", "add", holder, first?.branch ?? ""])

    // git refuses the second attach; the service degrades instead of stealing the branch.
    expect(service.createForMember(undefined, { teamId: "plan-x", member: "Senior Engineer" })).toBeUndefined()
    expect(sandbox.log.some((line) => line.includes("plan-x/Senior Engineer") && line.includes("shared checkout"))).toBe(true)

    // Freeing the branch makes the SAME recovery retryable: the failed attempt kept the stale record.
    git(sandbox.root, ["worktree", "remove", "--force", holder])
    /** The retry after the branch is no longer checked out elsewhere. */
    const recovered = service.createForMember(undefined, { teamId: "plan-x", member: "Senior Engineer" })
    expect(recovered?.path).toBe(first?.path)
    expect(recovered?.branch).toBe(first?.branch)
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
