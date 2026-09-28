// Locks the 0.1.16-rc.3 backports that are not part of the delivery fix:
// settled team locks release their queue entry, blank optional task fields are
// normalized instead of bricking durable state, and the Web routes run inside
// the host's browser-authentication fence with a bounded body read.
import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
// The adopted Web-route boundary is vendored JavaScript with no declaration file, so its fence
// factory, its JSON body reader and its body error class all arrive untyped.
// @ts-expect-error vendored JavaScript has no declaration file
import { RequestBodyError, authenticatedWebRoutes, readJsonRequest } from "../lib/web-routes.js"
// The adopted quality-gate module is vendored JavaScript with no declaration file.
// @ts-expect-error vendored JavaScript has no declaration file
import { normalizeBlankOptionalTaskFields } from "../lib/quality-gates.js"
// The adopted durable-state module is vendored JavaScript with no declaration file.
// @ts-expect-error vendored JavaScript has no declaration file
import { readTeam, teamLockQueueKeys, withTeamLock } from "../lib/state.js"

/** Real-time delay in milliseconds; one lock waiter must still hold the key when the second arrives. */
const sleep = (ms: number): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, ms))

describe("withTeamLock: settled locks release their queue entry", () => {
  test("a completed lock leaves no queue entry behind", async () => {
    /** Lock key unique to this arm, so another arm's residual waiter cannot mask the leak. */
    const key = "team:hygiene:1"
    await withTeamLock(key, async () => undefined)
    expect(teamLockQueueKeys()).not.toContain(key)
  })

  test("a rejected mutation still releases its entry", async () => {
    /** Lock key unique to this arm, so another arm's residual waiter cannot mask the leak. */
    const key = "team:hygiene:2"
    await expect(withTeamLock(key, async () => { throw new Error("boom") })).rejects.toThrow("boom")
    expect(teamLockQueueKeys()).not.toContain(key)
  })

  test("serialization is preserved and the last waiter cleans up", async () => {
    /** Lock key unique to this arm, so another arm's residual waiter cannot mask the leak. */
    const key = "team:hygiene:3"
    /** Acquisition order the two waiters append to; serialization reads as a-start, a-end, b. */
    const order: string[] = []
    /** First waiter: holds the key across a real delay, forcing the second waiter to queue. */
    const first = withTeamLock(key, async () => {
      order.push("a-start")
      await sleep(10)
      order.push("a-end")
    })
    /** Second waiter: queued behind the first, so its push can only land after a-end. */
    const second = withTeamLock(key, async () => { order.push("b") })
    await Promise.all([first, second])
    expect(order).toEqual(["a-start", "a-end", "b"])
    expect(teamLockQueueKeys()).not.toContain(key)
  })
})

describe("blank optional task fields are normalized to absent", () => {
  test("blank scalars are dropped and blank list entries are filtered", () => {
    /** Gate output for a task whose optionals are blank scalars or blank-only lists. */
    const normalized = normalizeBlankOptionalTaskFields({
      subject: "work",
      objective: "",
      reviewedTaskId: "   ",
      sourceTaskId: "t1",
      changedPaths: [""],
      inScope: ["", "packages/x.ts"],
      coverageOf: ["  "],
    })
    expect(normalized).toEqual({ subject: "work", sourceTaskId: "t1", inScope: ["packages/x.ts"] })
  })

  test("non-blank values pass through untouched", () => {
    /** Task whose optionals all carry content, so normalization must be a pass-through. */
    const task = { objective: "ship it", changedPaths: ["a.ts", "b.ts"], verdict: "pass" }
    expect(normalizeBlankOptionalTaskFields(task)).toEqual(task)
  })

  test("a legacy dirty record still loads instead of bricking the team", async () => {
    /** Temp state root holding the legacy team record for the duration of this arm. */
    const dir = mkdtempSync(join(tmpdir(), "mpd-state-hygiene-"))
    try {
      mkdirSync(join(dir, "team-1", "inbox"), { recursive: true })
      writeFileSync(join(dir, "team-1", "team.json"), JSON.stringify({
        id: "team-1",
        name: "Legacy",
        captainSessionId: "session-captain",
        createdAt: Date.now(),
        phase: "running",
        taskSeq: 1,
        members: [{ name: "Alpha", id: "member-alpha", joinedAt: Date.now(), status: "idle" }],
        tasks: [{
          id: "t1",
          subject: "dirty legacy task",
          status: "pending",
          dependencies: [],
          // Written by an older build / a model that materializes optionals as "".
          objective: "",
          changedPaths: [""],
          inScope: ["", "packages/x.ts"],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }],
      }))
      /** The record the loader rebuilt from that dirty JSON: it must exist, cleaned up. */
      const team = await readTeam(dir, "team-1")
      expect(team).toBeDefined()
      expect(team?.tasks[0]).toMatchObject({ id: "t1", status: "pending", inScope: ["packages/x.ts"] })
      expect("objective" in (team?.tasks[0] ?? {})).toBe(false)
      expect("changedPaths" in (team?.tasks[0] ?? {})).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("Web routes: authentication fence and bounded body", () => {
  /** One registered route: the exact path plus the handler the wrapped host invokes. */
  type FakeRoute = {
    /** Exact-match path the route answers on. */
    readonly path: string
    /** Handler the fence calls; request and response stay opaque to this fixture. */
    readonly handler: (req: unknown, res: unknown) => unknown
  }

  /** A route host that records registrations, standing in for the raw Web-server service. */
  function fakeServer(): { routes: FakeRoute[]; register: (route: FakeRoute) => () => void } {
    /** Registered routes in registration order; the arms drive `routes[0]` directly. */
    const routes: FakeRoute[] = []
    return {
      routes,
      /** Records the wrapped route and hands back a no-op disposer. */
      register(route: FakeRoute): () => void {
        routes.push(route)
        return () => undefined
      },
    }
  }

  /** A response double that captures what the fence wrote instead of sending it. */
  function fakeResponse(): { captured: { status: number; body: string; headers: Record<string, string> }; writeHead(status: number, headers?: Record<string, string>): void; end(body?: string): void } {
    /** Status, headers and body the fence wrote; every route arm reads these back. */
    const captured: { status: number; body: string; headers: Record<string, string> } = { status: 0, body: "", headers: {} }
    return {
      captured,
      /** Mirrors the host's `writeHead`; omitted headers read back as none. */
      writeHead(status: number, headers?: Record<string, string>): void { captured.status = status; captured.headers = headers ?? {} },
      /** Mirrors the host's `end`; an omitted body reads back as the empty string. */
      end(body?: string): void { captured.body = body ?? "" },
    }
  }

  test("a missing Connection service fails closed with 503", async () => {
    /** Raw route host under test; the fence registers the guarded route onto it. */
    const raw = fakeServer()
    /** Fence-wrapped host whose Connection resolver reports the service missing. */
    const wrapped = authenticatedWebRoutes(raw, () => undefined)
    /** Whether the guarded handler ran; a fail-closed fence must keep this false. */
    let reached = false
    wrapped.register({ kind: "exact", path: "/x", handler: () => { reached = true } })
    /** Response double the request is dispatched against. */
    const res = fakeResponse()
    await raw.routes[0].handler({}, res)
    expect(res.captured.status).toBe(503)
    expect(reached).toBe(false)
    expect(res.captured.headers["cache-control"]).toBe("no-store")
  })

  test("a rejected request never reaches the handler", async () => {
    /** Raw route host under test; the fence registers the guarded route onto it. */
    const raw = fakeServer()
    /** Fence-wrapped host whose Connection gate rejects with 401. */
    const wrapped = authenticatedWebRoutes(raw, () => ({ requestRejection: () => 401 }))
    /** Whether the guarded handler ran; a rejected request must keep this false. */
    let reached = false
    wrapped.register({ kind: "exact", path: "/x", handler: () => { reached = true } })
    /** Response double the request is dispatched against. */
    const res = fakeResponse()
    await raw.routes[0].handler({}, res)
    expect(res.captured.status).toBe(401)
    expect(res.captured.body).toContain("unauthorized")
    expect(reached).toBe(false)
  })

  test("an admitted request runs the route handler unchanged", async () => {
    /** Raw route host under test; the fence registers the guarded route onto it. */
    const raw = fakeServer()
    /** Fence-wrapped host whose Connection gate admits the request. */
    const wrapped = authenticatedWebRoutes(raw, () => ({ requestRejection: () => undefined }))
    /** Whether the guarded handler ran; an admitted request must set this true. */
    let reached = false
    wrapped.register({ kind: "exact", path: "/x", handler: () => { reached = true } })
    await raw.routes[0].handler({}, fakeResponse())
    expect(reached).toBe(true)
  })

  test("readJsonRequest parses objects and refuses arrays, bad JSON, and oversized bodies", async () => {
    /** Wraps one chunk into the one-shot readable stream `readJsonRequest` drains. */
    const body = (chunk: Buffer | string): Readable => Readable.from([chunk])
    expect(await readJsonRequest(body('{"action":"approve"}'))).toEqual({ action: "approve" })
    expect(await readJsonRequest(body(""))).toEqual({})
    await expect(readJsonRequest(body("[1,2]"))).rejects.toThrow(RequestBodyError)
    await expect(readJsonRequest(body("{oops"))).rejects.toThrow(/invalid JSON/)
    await expect(readJsonRequest(body(Buffer.alloc(64)), 16)).rejects.toThrow(/too large/)
  })
})
