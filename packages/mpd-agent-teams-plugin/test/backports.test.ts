// Locks the 0.1.16-rc.3 backports that are not part of the delivery fix:
// settled team locks release their queue entry, blank optional task fields are
// normalized instead of bricking durable state, and the Web routes run inside
// the host's browser-authentication fence with a bounded body read.
import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import { RequestBodyError, authenticatedWebRoutes, readJsonRequest } from "../lib/web-routes.js"
import { normalizeBlankOptionalTaskFields } from "../lib/quality-gates.js"
import { readTeam, teamLockQueueKeys, withTeamLock } from "../lib/state.js"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe("withTeamLock: settled locks release their queue entry", () => {
  test("a completed lock leaves no queue entry behind", async () => {
    const key = "team:hygiene:1"
    await withTeamLock(key, async () => undefined)
    expect(teamLockQueueKeys()).not.toContain(key)
  })

  test("a rejected mutation still releases its entry", async () => {
    const key = "team:hygiene:2"
    await expect(withTeamLock(key, async () => { throw new Error("boom") })).rejects.toThrow("boom")
    expect(teamLockQueueKeys()).not.toContain(key)
  })

  test("serialization is preserved and the last waiter cleans up", async () => {
    const key = "team:hygiene:3"
    const order: string[] = []
    const first = withTeamLock(key, async () => {
      order.push("a-start")
      await sleep(10)
      order.push("a-end")
    })
    const second = withTeamLock(key, async () => { order.push("b") })
    await Promise.all([first, second])
    expect(order).toEqual(["a-start", "a-end", "b"])
    expect(teamLockQueueKeys()).not.toContain(key)
  })
})

describe("blank optional task fields are normalized to absent", () => {
  test("blank scalars are dropped and blank list entries are filtered", () => {
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
    const task = { objective: "ship it", changedPaths: ["a.ts", "b.ts"], verdict: "pass" }
    expect(normalizeBlankOptionalTaskFields(task)).toEqual(task)
  })

  test("a legacy dirty record still loads instead of bricking the team", async () => {
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
  function fakeServer() {
    const routes: { path: string; handler: (req: unknown, res: unknown) => unknown }[] = []
    return {
      routes,
      register(route: { path: string; handler: (req: unknown, res: unknown) => unknown }) {
        routes.push(route)
        return () => undefined
      },
    }
  }

  function fakeResponse() {
    const captured = { status: 0, body: "", headers: {} as Record<string, string> }
    return {
      captured,
      writeHead(status: number, headers?: Record<string, string>) { captured.status = status; captured.headers = headers ?? {} },
      end(body?: string) { captured.body = body ?? "" },
    }
  }

  test("a missing Connection service fails closed with 503", async () => {
    const raw = fakeServer()
    const wrapped = authenticatedWebRoutes(raw, () => undefined)
    let reached = false
    wrapped.register({ kind: "exact", path: "/x", handler: () => { reached = true } })
    const res = fakeResponse()
    await raw.routes[0].handler({}, res)
    expect(res.captured.status).toBe(503)
    expect(reached).toBe(false)
    expect(res.captured.headers["cache-control"]).toBe("no-store")
  })

  test("a rejected request never reaches the handler", async () => {
    const raw = fakeServer()
    const wrapped = authenticatedWebRoutes(raw, () => ({ requestRejection: () => 401 }))
    let reached = false
    wrapped.register({ kind: "exact", path: "/x", handler: () => { reached = true } })
    const res = fakeResponse()
    await raw.routes[0].handler({}, res)
    expect(res.captured.status).toBe(401)
    expect(res.captured.body).toContain("unauthorized")
    expect(reached).toBe(false)
  })

  test("an admitted request runs the route handler unchanged", async () => {
    const raw = fakeServer()
    const wrapped = authenticatedWebRoutes(raw, () => ({ requestRejection: () => undefined }))
    let reached = false
    wrapped.register({ kind: "exact", path: "/x", handler: () => { reached = true } })
    await raw.routes[0].handler({}, fakeResponse())
    expect(reached).toBe(true)
  })

  test("readJsonRequest parses objects and refuses arrays, bad JSON, and oversized bodies", async () => {
    const body = (chunk: Buffer | string) => Readable.from([chunk]) as unknown as Parameters<typeof readJsonRequest>[0]
    expect(await readJsonRequest(body('{"action":"approve"}'))).toEqual({ action: "approve" })
    expect(await readJsonRequest(body(""))).toEqual({})
    await expect(readJsonRequest(body("[1,2]"))).rejects.toThrow(RequestBodyError)
    await expect(readJsonRequest(body("{oops"))).rejects.toThrow(/invalid JSON/)
    await expect(readJsonRequest(body(Buffer.alloc(64)), 16)).rejects.toThrow(/too large/)
  })
})
