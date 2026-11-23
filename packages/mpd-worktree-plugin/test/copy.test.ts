import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, rmSync, statfsSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index.ts"
import { apply } from "../src/index.ts"
import type { CopyBinding, CopyIdentity } from "../src/copy-authority.ts"
import type { CopyRecord } from "../src/copy-store.ts"

/** Scratch fixture roots created by this suite and cleaned after each test. */
const fixtures: string[] = []

/** Invoke Git in one of the suite's disposable repositories with a known commit identity. */
function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-C", root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.org", ...args], { encoding: "utf8" }).trim()
}

/** Create a commit and return its exact object name. */
function commit(root: string, file: string, contents: string): string {
  writeFileSync(join(root, file), contents)
  git(root, "add", "--", file)
  git(root, "commit", "-qm", file)
  return git(root, "rev-parse", "HEAD")
}

/** Registered tool result used by the fixture's short call wrapper. */
type Result = CopyRecord & { path: string; copies: CopyRecord[]; merged: boolean; conflicts: string[] }

/** The trusted endpoints are test doubles, while the registered function and repository are real. */
function fixture(): {
  root: string; base: string; task: { status: string; attempt: number }; bindings: Map<string, string>;
  call: (action: string, session: string, args?: Record<string, unknown>, cwd?: string) => Promise<Result>;
  request: (extra?: Record<string, unknown>, member?: string) => Promise<Result>;
} {
  /** A tiny directory isolated from the working project and its Git data. */
  const root = realpathSync(mkdtempSync(join(tmpdir(), "mpd-project-copy-")))
  fixtures.push(root)
  git(root, "init", "-q", "-b", "feature/integration")
  git(root, "config", "user.name", "Fixture")
  git(root, "config", "user.email", "fixture@example.org")
  writeFileSync(join(root, ".gitignore"), ".mpd/\ncache/\n")
  git(root, "add", ".gitignore")
  /** Initial committed input differs from the member's later edits. */
  const base = commit(root, "artifact.txt", "original\n")
  writeFileSync(join(root, "never-copy.txt"), "untracked canary\n")
  /** Durable capability map in the test double for project identity. */
  const bindings = new Map<string, string>()
  /** Fake the host boundary, keeping role and checkout independent of tool arguments. */
  const identity: CopyIdentity = {
    resolveSeat: ({ checkoutRoot, sessionId }) => {
      if (!["captain", "writer", "writer2"].includes(sessionId) || (checkoutRoot !== root && bindings.get(checkoutRoot) !== sessionId)) {
        return { kind: "denied" }
      }
      return { kind: "member", seat: sessionId === "captain" ? "captain" : "member", projectId: "project-one", projectRoot: root,
        checkoutRoot, memberId: sessionId, teamId: "team-one", memberName: sessionId }
    },
    bindCheckout: (input: CopyBinding) => { bindings.set(input.checkoutRoot, input.memberId) },
    unbindCheckout: (input: CopyBinding) => { bindings.delete(input.checkoutRoot) },
  }
  /** The primary claim can change while the persisted request awaits approval. */
  const task = { id: "T1", owner: "writer", kind: "work", status: "in_progress", attempt: 1, writeScopes: ["artifact.txt"] }
  /** Both writers share the same project reservation space. */
  const board = { phase: "active", leadSessionId: "captain", members: [
    { id: "M1", name: "writer", executorRef: "writer" }, { id: "M2", name: "writer2", executorRef: "writer2" },
  ], tasks: [task, { ...task, id: "T2", owner: "writer2" }] }
  /** The registered definition includes the host-facing projection as well as the raw body. */
  type RegisteredTool = { name: string; execute: (args: unknown, exec: DshToolExec) => unknown; output: { render: (args: unknown, value: unknown) => unknown } }
  /** The adapter's registering path publishes the function consumed by the fixture. */
  const tools = new Map<string, RegisteredTool>()
  apply({
    tools: { register: (tool: RegisteredTool) => {
      tools.set(tool.name, tool)
      return () => tools.delete(tool.name)
    } },
    get: (name: string) => name === "mpdProjectIdentity" ? identity : name === "mpdTeams" ? { get: () => board } : undefined,
    provide: () => undefined,
  })
  /** Exercise the function actually registered to the runtime, with host session metadata. */
  const tool = tools.get("mpd_worktree_copy")
  if (tool === undefined) throw new Error("copy tool did not register")
  /** Check each successful action's body and rendered reply through the registered definition. */
  const call = async (action: string, session: string, args: Record<string, unknown> = {}, cwd: string = root): Promise<Result> => {
    /** Keep the synthetic host's authentication separate from action arguments. */
    const input = { action, ...args }
    /** The harness snapshots this exact body before calling the renderer. */
    const result = await tool.execute(input, { agent: { session: { id: session, header: { cwd } } } }) as Result
    expect(result).toStrictEqual(JSON.parse(JSON.stringify(result)))
    expect(tool.output.render(input, result)).toEqual([{ type: "text", text: JSON.stringify(result, null, 2) }])
    return result
  }
  /** Standard request, with scenario overrides for refusal tests. */
  const request = (extra: Record<string, unknown> = {}, member: string = "writer"): Promise<Result> => call("request", member, {
    taskId: member === "writer" ? "T1" : "T2", source: ".", base, destination: member,
    scope: ["artifact.txt"], reason: "independent refs are required", setup: "no additional build inputs", estimatedBytes: 8_000_000, ...extra,
  })
  return { root, base, task, bindings, call, request }
}

/** A native verification ledger double with the same envelopes produced by the verify tools. */
function verified(root: string, record: Result, sha: string, verifier: string = "verifier"): string {
  /** Stable handles make the subsequent Git assertions readable. */
  const id = "rec-test"
  /** This is a distinct identity from both writer and captain. */
  const common = { version: 1, workspace: root, taskId: record.taskId, loopId: "loop-test" }
  /** Record and opened loop must agree on the attested identities. */
  const files = {
    [`records/${id}.json`]: { ...common, recordId: id, writerId: record.writerSession, verifierId: verifier, verdict: "PASS",
      notes: [`git-copy:${record.id}:${sha}`], createdAt: new Date().toISOString(), basis: { kind: "blind" },
      sources: [{ path: "contract.md" }], gateEvidence: [{ exit: 0, evidenceId: "ev-test" }] },
    "loops/loop-test.json": { ...common, writer: { id: record.writerSession, kind: "delegate" }, verifier: { id: verifier } },
  }
  for (const [name, value] of Object.entries(files)) {
    /** Only the fixture's own canonical ledger is written. */
    const path = join(root, ".mpd", "verify", name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(value))
  }
  return id
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("registered independent copy tool", () => {
  test("refuses absent, wrong, declined, expired and stale authority before allocating", async () => {
    /** One assigned writer and a distinct current captain share the disposable board. */
    const { root, task, request, call } = fixture()
    /** The request is durable before it receives any grant. */
    const copy = await request()
    /** Use the returned request ID to drive only its own lifecycle. */
    const id = copy.id
    expect((await request()).id).toBe(id)
    expect((await call("list", "writer2")).copies).toEqual([])
    expect((await call("list", "writer2", { id })).copies).toEqual([])
    expect((await call("list", "captain", { id })).copies).toEqual([copy])
    await expect(call("list", "outsider")).rejects.toThrow("copy-forbidden")
    await expect(call("create", "writer", { id })).rejects.toThrow("copy-approval-required")
    await expect(call("approve", "writer", { id })).rejects.toThrow("copy-forbidden")
    expect((await call("decline", "captain", { id, reason: "worktree is adequate" })).status).toBe("declined")
    await expect(call("create", "writer", { id })).rejects.toThrow("copy-approval-required")
    /** A second request simulates one that aged beyond the grant window. */
    const stale = await request()
    /** Overwrite only the temporary fixture ledger to simulate elapsed time. */
    const requestPath = join(root, ".mpd", "copies", "requests", `${stale.id}.json`)
    writeFileSync(requestPath, JSON.stringify({ ...JSON.parse(readFileSync(requestPath, "utf8")), requestedAt: "2000-01-01T00:00:00.000Z" }))
    await expect(call("approve", "captain", { id: stale.id })).rejects.toThrow("copy-expired")
    /** This fresh request will lose assignment when the claim counter advances. */
    const claim = await request()
    await call("approve", "captain", { id: claim.id })
    task.attempt += 1
    await expect(call("create", "writer", { id: claim.id })).rejects.toThrow("copy-stale-assignment")
    expect(readdirSync(dirname(copy.path))).toEqual([])
  })

  test("refuses a fresh allocation while another process holds the shared reservation lock", async () => {
    /** One member request is durable before another process acquires the lock. */
    const { root, request, call } = fixture()
    /** Reuse the tool's reply to target the exact request. */
    const { id, path } = await request()
    /** A subprocess acquires the same on-disk lock as a concurrent DSH process. */
    const lock = join(root, ".mpd", "copies", "lock")
    execFileSync("node", ["-e", "require('node:fs').mkdirSync(process.argv[1])", lock])
    await expect(call("approve", "captain", { id })).rejects.toThrow("copy-busy")
    expect(existsSync(path)).toBeFalse()
    rmSync(lock, { recursive: true })
    expect((await call("approve", "captain", { id })).status).toBe("approved")
  })

  test("reserves against other outstanding approvals and rejects symlinked destinations", async () => {
    /** Two writers share the same reservation directory and physical disk. */
    const { root, request, call } = fixture()
    /** Measure real fixture capacity without filling the filesystem. */
    const disk = statfsSync(root)
    /** Each request fits alone but both cannot fit at the same time. */
    const estimatedBytes = Math.floor(disk.bavail * disk.bsize * 0.7)
    /** The first writer reserves capacity before any checkout exists. */
    const one = await request({ estimatedBytes })
    /** The second writer cannot reuse those reserved bytes. */
    const two = await request({ estimatedBytes }, "writer2")
    expect((await call("approve", "captain", { id: one.id, reason: "fits the available budget" })).decisionReason).toBe("fits the available budget")
    await expect(call("approve", "captain", { id: two.id })).rejects.toThrow("copy-insufficient-space")
    expect(await call("decline", "captain", { id: one.id })).not.toHaveProperty("decisionReason")
    expect((await call("approve", "captain", { id: two.id })).status).toBe("approved")
    symlinkSync(root, two.path, "dir")
    await expect(call("create", "writer2", { id: two.id })).rejects.toThrow("copy-path-changed")
    expect(lstatSync(two.path).isSymbolicLink()).toBeTrue()
  })

  test("creates one independent checkout and merges only the exact verified commit", async () => {
    /** The board authorizes one writer and records its same-project binding. */
    const { root, base, task, request, call, bindings } = fixture()
    /** The request is durable before it receives any grant. */
    const copy = await request()
    /** Use the returned request ID to drive only its own lifecycle. */
    const id = copy.id
    /** The first grant and replay preserve one reservation timestamp and omit an absent note. */
    const grant = await call("approve", "captain", { id })
    expect(grant.status).toBe("approved")
    expect(grant).not.toHaveProperty("decisionReason")
    expect(await call("approve", "captain", { id })).toStrictEqual(grant)
    /** Only the granted request can publish an independent checkout. */
    const ready = await call("create", "writer", { id })
    expect((await call("create", "writer", { id })).rootId).toBe(ready.rootId)
    expect(readdirSync(dirname(ready.path))).toEqual(["writer"])
    expect(BigInt(ready.allocatedBytes ?? 0)).toBeGreaterThan(0n)
    expect(git(ready.path, "rev-parse", "--absolute-git-dir")).toBe(join(ready.path, ".git"))
    expect(git(root, "rev-parse", "--absolute-git-dir")).toBe(join(root, ".git"))
    expect(existsSync(join(ready.path, ".git", "objects", "info", "alternates"))).toBeFalse()
    expect(existsSync(join(ready.path, "never-copy.txt"))).toBeFalse()
    expect(existsSync(join(ready.path, ".mpd"))).toBeFalse()
    expect(bindings.get(ready.path)).toBe("writer")
    expect((await call("list", "writer", {}, ready.path)).copies[0]?.id).toBe(id)
    await expect(call("list", "writer2", {}, ready.path)).rejects.toThrow("copy-forbidden")
    /** The exact candidate will be bound to the verifier verdict. */
    const sha = commit(ready.path, "artifact.txt", "candidate\n")
    git(ready.path, "switch", "-c", "out-of-scope")
    commit(ready.path, "private.txt", "should never enter candidate history\n")
    git(ready.path, "rm", "private.txt")
    git(ready.path, "commit", "-qm", "remove private path from tip")
    await expect(call("submit", "writer", { id, commit: git(ready.path, "rev-parse", "HEAD") })).rejects.toThrow("copy-scope")
    git(ready.path, "switch", "development")
    /** Submission does not move the captain checkout. */
    const submission = await call("submit", "writer", { id, commit: sha }, ready.path)
    /** Advance the member branch to a commit that is outside the verification proof. */
    const ahead = commit(ready.path, "artifact.txt", "private tip\n")
    expect(git(root, "rev-parse", "HEAD")).toBe(base)
    /** The captain uses an unprotected local integration branch. */
    const into = "feature/integration"
    /** Use the temporary native verdict envelope, with this scenario's candidate binding. */
    const verification = verified(root, submission, ahead)
    await expect(call("integrate", "captain", { id, into, verification })).rejects.toThrow("copy-verification")
    verified(root, submission, sha, "writer")
    await expect(call("integrate", "captain", { id, into, verification })).rejects.toThrow("copy-verification")
    verified(root, submission, sha)
    expect((await call("integrate", "captain", { id, into, verification })).merged).toBeTrue()
    expect(git(root, "rev-parse", "HEAD^2")).toBe(sha)
    expect(readFileSync(join(root, "artifact.txt"), "utf8")).toBe("candidate\n")
    await expect(call("dispose", "captain", { id })).rejects.toThrow("copy-writer-active")
    task.status = "completed"
    await expect(call("dispose", "captain", { id })).rejects.toThrow("copy-unmerged")
    expect(git(ready.path, "rev-parse", "HEAD")).toBe(ahead)
    expect(bindings.get(ready.path)).toBe("writer")
  })

  test("preserves conflicts, ignored files and private ref namespaces; reclaims only when clean", async () => {
    /** The fixture preserves both Git repositories independently during conflict handling. */
    const { root, task, request, call, bindings } = fixture()
    /** Use the returned request ID to drive only its own lifecycle. */
    const id = (await request()).id
    await call("approve", "captain", { id })
    /** Only the registered checkout can be integrated or reclaimed. */
    const { path } = await call("create", "writer", { id })
    /** The exact candidate will be bound to the verifier verdict. */
    const sha = commit(path, "artifact.txt", "candidate\n")
    /** Submission does not move the captain checkout. */
    const submission = await call("submit", "writer", { id, commit: sha })
    /** Use the temporary native verdict envelope, with this scenario's candidate binding. */
    const verification = verified(root, submission, sha)
    /** The captain uses an unprotected local integration branch. */
    const into = "feature/integration"
    git(root, "switch", "-c", "feature/conflict")
    /** The divergent project commit must survive an aborted merge. */
    const captainTip = commit(root, "artifact.txt", "divergent\n")
    expect((await call("integrate", "captain", { id, into: "feature/conflict", verification })).conflicts).toEqual(["artifact.txt"])
    expect(git(root, "rev-parse", "HEAD")).toBe(captainTip)
    expect(existsSync(join(root, ".git", "MERGE_HEAD"))).toBeFalse()
    expect(git(path, "rev-parse", "HEAD")).toBe(sha)
    git(root, "switch", into)
    expect((await call("integrate", "captain", { id, into, verification })).merged).toBeTrue()
    task.status = "completed"
    mkdirSync(join(path, "cache"))
    /** Ignored data is still local work and must block disposal. */
    const cache = join(path, "cache", "local.txt")
    writeFileSync(cache, "keep local output\n")
    await expect(call("dispose", "captain", { id })).rejects.toThrow("copy-dirty")
    rmSync(cache)
    rmSync(dirname(cache), { recursive: true })
    git(path, "update-ref", "refs/private/checkpoint", sha)
    await expect(call("dispose", "captain", { id })).rejects.toThrow("copy-private-ref")
    git(path, "update-ref", "-d", "refs/private/checkpoint")
    /** Successful disposal releases both storage and native checkout binding. */
    const disposed = await call("dispose", "captain", { id })
    expect(disposed.status).toBe("disposed")
    expect(BigInt(disposed.releasedBytes ?? 0)).toBeGreaterThan(0n)
    if (process.env.MPD_COPY_QA_MEASURE === "1") {
      console.log(JSON.stringify({ allocatedBytes: disposed.allocatedBytes, releasedBytes: disposed.releasedBytes,
        freeBeforeDisposal: disposed.freeBeforeDisposal, freeAfterDisposal: disposed.freeAfterDisposal }))
    }
    expect(disposed.freeBeforeDisposal).toMatch(/^\d+$/)
    expect(disposed.freeAfterDisposal).toMatch(/^\d+$/)
    expect(bindings.has(path)).toBeFalse()
    expect(existsSync(path)).toBeFalse()
    expect((await call("dispose", "captain", { id })).status).toBe("disposed")
  })
})
