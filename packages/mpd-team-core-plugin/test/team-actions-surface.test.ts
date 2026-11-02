// TASK B of the drive-surface wave: the `mpdTeamActions` SERVICE and the two fenced HTTP routes.
//
// WHAT THESE ARMS PROVE. The tool handlers and the HTTP surface run ONE sequence: the routes delegate
// to the service, the service builds a caller from a SESSION (never a tool exec), and a session that is
// not live answers `{ ok: false }` instead of throwing. The route arms follow the repo's ONE shipped
// mutating precedent (`mpd-team-watchdog-plugin/src/web.ts`) in its exact order — fence, own method
// guard, 64 KiB cap, boundary parse, then work — and they assert the success payload is the NARROW
// projection: no store object and no filesystem path at any depth.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { apply } from "../src/index.ts"
import {
  MAX_ACTION_BODY_BYTES,
  TEAM_ACTION_ROUTES,
  TEAM_APPROVE_PATH,
  TEAM_DISPATCH_PATH,
  TEAM_ROUTES,
  registerTeamRoutes,
  type TeamWebActions,
} from "../src/team-web"
import { addTeamMember, addTeamTask, createTeam, type TeamRecord } from "../src/team-store"
import type { MpdTeamActionsService } from "../src/team-actions"

/** The session every arm acts as. */
const LEAD = "lead-session-b"
/** The live agent a service call resolves for {@link LEAD}. */
const AGENT = { session: { id: LEAD, header: {} } }

/** The sandboxes this file created, removed after every arm. */
const sandboxes: string[] = []
afterEach(() => { for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true }) })

/** A fresh sandbox workspace, registered for cleanup. */
function sandbox(): string {
  /** The directory this call created. */
  const dir = mkdtempSync(join(tmpdir(), "mpd-team-action-surface-"))
  sandboxes.push(dir)
  return dir
}

/**
 * Every key at any depth whose name contains "path".
 *
 * WHY A WALK AND NOT `JSON.stringify`: the contract is about the PAYLOAD'S SHAPE — a client must not be
 * handed a filesystem path — so the assertion reads the object graph rather than searching a string for
 * a slash, which a task subject could contain legitimately.
 * @param value - the value to walk.
 * @param at - the diagnostic path of this node.
 * @returns the offending key paths; empty means the payload names no path.
 */
function pathKeys(value: unknown, at: string = "$"): string[] {
  if (value === null || typeof value !== "object") return []
  /** Violations found under this node. */
  const out: string[] = []
  for (const [key, child] of Object.entries(value)) {
    if (key.toLowerCase().includes("path")) out.push(`${at}.${key}`)
    out.push(...pathKeys(child, `${at}.${key}`))
  }
  return out
}

// ── the route double ────────────────────────────────────────────────────────

/** What one response double captured. */
interface Captured {
  /** The HTTP status the handler wrote. */
  status: number
  /** Every header the handler wrote with it. */
  headers: Record<string, string>
  /** The parsed JSON body. */
  body: unknown
}

/** A response double recording the status, the headers and the parsed body. */
function response(): { res: unknown; captured: Captured } {
  /** The state the handler writes into. */
  const captured: Captured = { status: 0, headers: {}, body: undefined }
  return {
    captured,
    res: {
      writeHead: (status: number, headers: Record<string, string>): void => { captured.status = status; captured.headers = headers },
      end: (text: string): void => { captured.body = JSON.parse(text) },
    },
  }
}

/**
 * A request double: the method, the URL and an optional streamed body.
 * @param method - the HTTP verb.
 * @param url - the request URL, carrying the `?sessionId=` query.
 * @param body - the body text, omitted for an empty body.
 * @returns the request the handler sees.
 */
function request(method: string, url: string, body?: string): unknown {
  return {
    method,
    url,
    // The route reads the body through the async iterator, exactly as a Node request streams it.
    async *[Symbol.asyncIterator](): AsyncGenerator<string> {
      if (body !== undefined) yield body
    },
  }
}

/**
 * Mount the route family against a server double, with the action surface this arm supplies.
 * @param actions - the mutation surface, or undefined to prove the routes stay unmounted.
 * @param authorize - the fence this arm's composition supplies.
 * @returns the handlers by path.
 */
function mount(actions: TeamWebActions | undefined, authorize?: (request: unknown) => 401 | 403 | undefined): Map<string, (req: unknown, res: unknown) => Promise<void>> {
  /** The handlers the server double captured. */
  const handlers = new Map<string, (req: unknown, res: unknown) => Promise<void>>()
  /** Whether every route — read and action — registered. */
  const ok = registerTeamRoutes({ register: (route: { kind: string; path: string; handler: (req: unknown, res: unknown) => unknown }) => {
    handlers.set(route.path, route.handler as (req: unknown, res: unknown) => Promise<void>)
    return () => {}
  } }, {
    recordFor: (): undefined => undefined,
    workspace: (): string => "/ws",
    executor: (): { kind: string; reason: string } => ({ kind: "native", reason: "the arm's executor" }),
    effect: (fn: () => unknown): unknown => fn(),
    warn: (): void => {},
    ...(authorize === undefined ? {} : { authorize }),
    ...(actions === undefined ? {} : { actions }),
  })
  expect(ok).toBe(true)
  return handlers
}

/**
 * Run one action-route request and return what it answered.
 * @param path - the route path to drive.
 * @param req - the request double.
 * @param authoriz - the fence, when the arm supplies one.
 * @param actions - the action surface, when the arm needs one.
 * @returns the captured response.
 */
async function call(path: string, req: unknown, authoriz?: (request: unknown) => 401 | 403 | undefined, actions?: TeamWebActions): Promise<Captured> {
  /** The handlers this arm mounted. */
  const handlers = mount(actions, authoriz)
  /** The handler for the requested path; a missing route is a test defect, not an answer. */
  const handler = handlers.get(path)
  if (handler === undefined) throw new Error(`no handler for ${path} (have ${[...handlers.keys()].join(", ")})`)
  /** The response double. */
  const { res, captured } = response()
  await handler(req, res)
  return captured
}

/** A record built through the STORE, so the projection fixture cannot drift from the real shape. */
function teamRecord(): TeamRecord {
  /** A fresh sandbox for this fixture. */
  const workspace = sandbox()
  /** The record as it grows through the store. */
  let team = createTeam(workspace, { name: "the wave", description: "ship it", leadSessionId: LEAD }, new Date("2026-11-02T02:00:00.000Z"))
  team = addTeamMember(team, { name: "Senior Engineer", description: "implements" }, new Date("2026-11-02T02:00:00.000Z"))
  team = addTeamTask(team, { subject: "core", description: "own it", blockedBy: [] }, new Date("2026-11-02T02:00:00.000Z"))
  return team
}

describe("the two routes — fence and boundary discipline", () => {
  test("the FENCE wins before anything else (401 and 403 both)", async () => {
    /** The record a happy call would project; it must NOT be reached. */
    const team = teamRecord()
    /** The action surface, recording calls so the arm can prove the refusal ran first. */
    const actions: TeamWebActions = {
      isLive: () => true,
      approve: async () => ({ ok: true, plan: { version: 1 } as never, team, created: { members: [], tasks: [] } }),
      dispatch: async () => ({ ok: true, pairs: [], skipped: [] }),
    }
    // A GET (which would be a 405) and a malformed body (which would be a 400) still answer the FENCE:
    // it is the first check, exactly like the watchdog precedent.
    expect((await call(TEAM_APPROVE_PATH, request("GET", TEAM_APPROVE_PATH), () => 401, actions)).status).toBe(401)
    expect((await call(TEAM_DISPATCH_PATH, request("POST", `${TEAM_DISPATCH_PATH}?sessionId=${LEAD}`, "{"), () => 403, actions)).status).toBe(403)
    /** The refusal payload the client reads. */
    const refused = (await call(TEAM_APPROVE_PATH, request("POST", `${TEAM_APPROVE_PATH}?sessionId=${LEAD}`, "{}"), () => 401, actions)).body as { ok: boolean; error: string }
    expect(refused.ok).toBe(false)
    expect(refused.error).toContain("not authenticated")
  })

  test("a non-POST is 405 with `allow: POST`", async () => {
    /** The action surface; it must not run. */
    const actions: TeamWebActions = {
      isLive: () => true,
      approve: async () => { throw new Error("the handler must not act on a GET") },
      dispatch: async () => { throw new Error("the handler must not act on a GET") },
    }
    expect((await call(TEAM_APPROVE_PATH, request("GET", `${TEAM_APPROVE_PATH}?sessionId=${LEAD}`), undefined, actions)).status).toBe(405)
    /** That answer, headers included. */
    const captured = await call(TEAM_DISPATCH_PATH, request("PUT", `${TEAM_DISPATCH_PATH}?sessionId=${LEAD}`), undefined, actions)
    expect(captured.status).toBe(405)
    expect(captured.headers.allow).toBe("POST")
  })

  test("a body over the 64 KiB cap is 413, unparsed; malformed JSON is 400", async () => {
    /** The action surface; neither call may reach it. */
    const actions: TeamWebActions = {
      isLive: () => true,
      approve: async () => { throw new Error("an oversized body must not reach the action") },
      dispatch: async () => { throw new Error("an oversized body must not reach the action") },
    }
    /** A body one byte past the cap. */
    const oversized = "x".repeat(MAX_ACTION_BODY_BYTES + 1)
    expect((await call(TEAM_DISPATCH_PATH, request("POST", `${TEAM_DISPATCH_PATH}?sessionId=${LEAD}`, oversized), undefined, actions)).status).toBe(413)
    expect((await call(TEAM_DISPATCH_PATH, request("POST", `${TEAM_DISPATCH_PATH}?sessionId=${LEAD}`, "{not json"), undefined, actions)).status).toBe(400)
    // A body AT the cap is admitted by the reader and then refused by the JSON parse, never by the cap.
    expect((await call(TEAM_DISPATCH_PATH, request("POST", `${TEAM_DISPATCH_PATH}?sessionId=${LEAD}`, "x".repeat(MAX_ACTION_BODY_BYTES)), undefined, actions)).status).toBe(400)
  })

  test("a mistyped dispatch field is a 400 at the boundary", async () => {
    /** The action surface; a bad field must not reach it. */
    const actions: TeamWebActions = {
      isLive: () => true,
      approve: async () => ({ ok: false, error: "unused" }),
      dispatch: async () => { throw new Error("a bad body must not reach the action") },
    }
    expect((await call(TEAM_DISPATCH_PATH, request("POST", `${TEAM_DISPATCH_PATH}?sessionId=${LEAD}`, JSON.stringify({ limit: "5" })), undefined, actions)).status).toBe(400)
    expect((await call(TEAM_DISPATCH_PATH, request("POST", `${TEAM_DISPATCH_PATH}?sessionId=${LEAD}`, JSON.stringify({ dryRun: "yes" })), undefined, actions)).status).toBe(400)
    expect((await call(TEAM_DISPATCH_PATH, request("POST", `${TEAM_DISPATCH_PATH}?sessionId=${LEAD}`, JSON.stringify([1, 2])), undefined, actions)).status).toBe(400)
  })

  test("a request that names no session is a 400", async () => {
    /** The action surface, which must not run without a session. */
    const actions: TeamWebActions = {
      isLive: () => true,
      approve: async () => { throw new Error("a session-less request must not act") },
      dispatch: async () => { throw new Error("a session-less request must not act") },
    }
    expect((await call(TEAM_APPROVE_PATH, request("POST", TEAM_APPROVE_PATH, "{}"), undefined, actions)).status).toBe(400)
    expect((await call(TEAM_DISPATCH_PATH, request("POST", TEAM_DISPATCH_PATH), undefined, actions)).status).toBe(400)
  })

  test("a session with no live agent is 409, and the action never runs", async () => {
    /** The action surface, recording nothing because liveness refuses first. */
    const actions: TeamWebActions = {
      isLive: () => false,
      approve: async () => { throw new Error("a dead session must not approve") },
      dispatch: async () => { throw new Error("a dead session must not dispatch") },
    }
    /** The answer. */
    const captured = await call(TEAM_APPROVE_PATH, request("POST", `${TEAM_APPROVE_PATH}?sessionId=dead`, "{}"), undefined, actions)
    expect(captured.status).toBe(409)
    expect((captured.body as { error: string }).error).toContain("session dead is not live")
  })
})

describe("the two routes — the NARROW success payload", () => {
  test("approve answers the team projection and the created ids, never a store object or a path", async () => {
    /** A real record, so the projection reads real fields. */
    const team = teamRecord()
    /** The action surface this arm drives. */
    const actions: TeamWebActions = {
      isLive: () => true,
      approve: async () => ({
        ok: true,
        plan: { version: 1, planId: "plan-1" } as never,
        team,
        created: { members: [{ name: "Senior Engineer", id: "child-1" }], tasks: [{ subject: "core", id: "T1" }] },
      }),
      dispatch: async () => ({ ok: true, pairs: [], skipped: [] }),
    }
    /** The answer. */
    const captured = await call(TEAM_APPROVE_PATH, request("POST", `${TEAM_APPROVE_PATH}?sessionId=${LEAD}`, "{}"), undefined, actions)
    expect(captured.status).toBe(200)
    expect(captured.headers["cache-control"]).toBe("no-store")
    expect(captured.body).toEqual({
      ok: true,
      team: { id: team.teamId, name: "the wave", memberCount: 1, taskCount: 1 },
      created: ["child-1", "T1"],
    })
    // THE SHAPE IS THE CONTRACT: no key at any depth may name a filesystem path.
    expect(pathKeys(captured.body)).toEqual([])
  })

  test("dispatch answers pairs (three fields) and the skipped list, never the raw engine rows", async () => {
    /** The input the route handed the action, kept so the arm proves the body reached it. */
    const inputs: Array<{ limit?: number; dryRun?: boolean }> = []
    /** The action surface this arm drives. */
    const actions: TeamWebActions = {
      isLive: () => true,
      approve: async () => ({ ok: false, error: "unused" }),
      dispatch: async (_sessionId: string, input: { limit?: number; dryRun?: boolean }) => {
        inputs.push(input)
        return {
          ok: true as const,
          pairs: [{ taskId: "T1", subject: "core", memberId: "child-1", memberName: "Senior Engineer" }],
          skipped: [{ taskId: "T2", subject: "review", reason: "not ready (blocked by T1)" }],
          forgotten: ["T9"],
          reaped: ["team-old"],
        }
      },
    }
    /** The answer. */
    const captured = await call(TEAM_DISPATCH_PATH, request("POST", `${TEAM_DISPATCH_PATH}?sessionId=${LEAD}`, JSON.stringify({ limit: 1, dryRun: false })), undefined, actions)
    expect(captured.status).toBe(200)
    expect(captured.body).toEqual({
      ok: true,
      pairs: [{ taskId: "T1", memberId: "child-1", memberName: "Senior Engineer" }],
      skipped: [{ taskId: "T2", subject: "review", reason: "not ready (blocked by T1)" }],
    })
    expect(pathKeys(captured.body)).toEqual([])
    // The parsed body reached the action UNCHANGED: the route is a boundary, not a second parser.
    expect(inputs).toEqual([{ limit: 1, dryRun: false }])
  })

  test("an action REFUSAL is a 400 sentence; an unexpected throw is a 500 with no detail", async () => {
    /** A refusing action surface. */
    const refusing: TeamWebActions = {
      isLive: () => true,
      approve: async () => ({ ok: false, error: "no team is staged in this session — use action:\"create\" first" }),
      dispatch: async () => ({ ok: false, error: "the workspace is not attributable" }),
    }
    /** The refusal answer. */
    const refused = await call(TEAM_APPROVE_PATH, request("POST", `${TEAM_APPROVE_PATH}?sessionId=${LEAD}`, "{}"), undefined, refusing)
    expect(refused.status).toBe(400)
    expect((refused.body as { error: string }).error).toContain("no team is staged")
    /** A surface that rejects, which the handler must contain. */
    const throwing: TeamWebActions = {
      isLive: () => true,
      approve: async () => { throw new Error("the store exploded at /home/someone/.mpd/team") },
      dispatch: async () => { throw new Error("the store exploded") },
    }
    /** The contained answer. */
    const failed = await call(TEAM_APPROVE_PATH, request("POST", `${TEAM_APPROVE_PATH}?sessionId=${LEAD}`, "{}"), undefined, throwing)
    expect(failed.status).toBe(500)
    // NEVER A PATH IN A CLIENT MESSAGE: the detail went to the row log, not the response.
    expect(JSON.stringify(failed.body)).not.toContain("/home/someone")
    expect(pathKeys(failed.body)).toEqual([])
  })

  test("a composition with NO action surface mounts the read routes only", async () => {
    /** The paths the double captured. */
    const handlers = mount(undefined)
    expect([...handlers.keys()]).toEqual([...TEAM_ROUTES])
    for (const path of TEAM_ACTION_ROUTES) expect(handlers.has(path)).toBe(false)
  })
})

// ── the service, driven through the REAL row ────────────────────────────────

/** One captured tool registration. */
interface Tool {
  /** The registered tool name. */
  name: string
  /** The registered tool's executor, exactly as the harness calls it. */
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** The harness one service arm drives: the sandbox, the tools and the published services. */
interface Harness {
  /** The sandbox workspace every call is scoped to. */
  workspace: string
  /** The tools the row registered, by name. */
  tools: Map<string, Tool>
  /** The services the row published, by id. */
  services: Map<string, unknown>
  /** Drive one registered tool as {@link LEAD}. */
  call: (name: string, args: unknown) => Promise<unknown>
}

/**
 * Apply the real row against a stub composition, so the SERVICE under test is the one this row
 * publishes — not a re-implementation of it.
 * @param live - whether {@link LEAD} is a live session in this composition.
 * @returns the harness an arm drives.
 */
function harness(live: boolean): Harness {
  /** The sandbox workspace, which is also what `workspaceRoot` answers. */
  const workspace = sandbox()
  /** The tools the row registered. */
  const tools = new Map<string, Tool>()
  /** The services the row published, by id. */
  const services = new Map<string, unknown>()
  /** The executor double: it raises any member under a handle derived from the name. */
  const executor = {
    kind: "native",
    reason: "the arm's executor",
    providers: (): string[] => [],
    spawn: async (_caller: unknown, request: { name: string }): Promise<{ handle: string; executor: string }> => ({ handle: "child-" + request.name, executor: "native" }),
    send: async (): Promise<void> => {},
    interrupt: async (): Promise<void> => {},
    membership: (): undefined => undefined,
    members: (): [] => [],
  }
  /** The stub adapter: every seam this row touches, and nothing else. */
  const dsh = {
    registerTool: (definition: Tool): (() => void) => { tools.set(definition.name, definition); return () => {} },
    registerCommand: (): (() => void) => () => {},
    workspaceRoot: (): string => workspace,
    workspaceRootsAll: (): string[] => [workspace],
    workspaceRootForSession: (sessionId: string): string | undefined => (live && sessionId === LEAD ? workspace : undefined),
    liveAgent: (sessionId: string): unknown => (live && sessionId === LEAD ? AGENT : undefined),
    liveAgents: (): unknown[] => (live ? [AGENT] : []),
    webServerOf: (): undefined => undefined,
    webRequestRejection: (): undefined => undefined,
    onServiceBound: (): void => {},
    onEvent: (): (() => void) => () => {},
    registerAgentPreStep: (): (() => void) => () => {},
    guardTool: (): (() => void) => () => {},
    teamExecutor: (): typeof executor => executor,
    teamMembership: (): undefined => undefined,
    teamListMembers: (): [] => [],
    teamListTasks: (): [] => [],
    capabilities: (): Record<string, never> => ({}),
    hasTool: (): boolean => false,
    executeTool: async (): Promise<{ ok: boolean; isError: boolean; value: unknown }> => ({ ok: true, isError: false, value: {} }),
    rowLog: (): void => {},
    text: (value: unknown): unknown => value,
  }
  /** The minimal cordis context `apply` needs. */
  const ctx = {
    get: (id: string): unknown => (id === "mpdDsh" ? dsh : undefined),
    on: (): void => {},
    effect: (fn: () => unknown): unknown => { try { return fn() ?? (() => {}) } catch { return () => {} } },
    provide: (id: string, value: unknown): void => { services.set(id, value) },
    inject: (): void => {},
  }
  apply(ctx as never)
  return {
    workspace,
    tools,
    services,
    call: async (name: string, args: unknown) => {
      /** The registered tool, or a thrown error naming what WAS registered. */
      const tool = tools.get(name)
      if (tool === undefined) throw new Error(`no tool ${name} (have ${[...tools.keys()].join(", ")})`)
      return tool.execute(args, { agent: AGENT })
    },
  }
}

/** The service id this row publishes; spelled here so a rename reddens the arm. */
const ACTIONS_SERVICE = "mpdTeamActions"

describe("mpdTeamActions — the service the routes and a panel both read", () => {
  test("is published by the row with both members", () => {
    /** A composition with a live session. */
    const h = harness(true)
    /** The published service. */
    const service = h.services.get(ACTIONS_SERVICE) as MpdTeamActionsService
    expect(service).toBeDefined()
    expect(typeof service.approve).toBe("function")
    expect(typeof service.dispatch).toBe("function")
  })

  test("a session that is NOT live answers { ok: false } — for both members, and never throws", async () => {
    /** A composition where nobody is live. */
    const h = harness(false)
    /** The published service. */
    const service = h.services.get(ACTIONS_SERVICE) as MpdTeamActionsService
    expect(await service.approve({ sessionId: LEAD })).toEqual({ ok: false, error: `session ${LEAD} is not live` })
    expect(await service.dispatch({ sessionId: LEAD })).toEqual({ ok: false, error: `session ${LEAD} is not live` })
    // An unknown id is the same refusal, not a crash: this is what a route maps to 409.
    expect((await service.approve({ sessionId: "nobody" })).ok).toBe(false)
  })

  test("the service and the TOOL path approve into the SAME record shape", async () => {
    /** A composition with a live session. */
    const h = harness(true)
    /** The published service. */
    const service = h.services.get(ACTIONS_SERVICE) as MpdTeamActionsService
    /**
     * Stage the wave through the tool surface.
     * @param name - the plan name, so the two records are distinguishable.
     * @returns nothing; the plan is left staged.
     */
    const stage = async (name: string): Promise<void> => {
      await h.call("agent_teams_plan", { action: "create", name, description: "ship the drive surface" })
      await h.call("agent_teams_plan", { action: "add_member", member: { name: "Senior Engineer", description: "implements", prompt: "You implement.", role: "Senior Engineer" } })
      await h.call("agent_teams_plan", { action: "create_task", task: { subject: "core", description: "own the record", blocked_by: [] } })
      await h.call("agent_teams_plan", { action: "create_task", task: { subject: "review", description: "judge it", kind: "review", blocked_by: ["core"] } })
    }
    /** One record, reduced to the fields two approvals must agree on (ids and stamps excluded). */
    const shape = (record: TeamRecord): unknown => ({
      name: record.name,
      description: record.description,
      leadSessionId: record.leadSessionId,
      phase: record.phase,
      members: record.members.map((member) => ({ id: member.id, name: member.name, description: member.description, role: member.role, status: member.status, executorRef: member.executorRef })),
      tasks: record.tasks.map((task) => ({ id: task.id, subject: task.subject, description: task.description, kind: task.kind, status: task.status, blockedBy: [...task.blockedBy], owner: task.owner, revision: task.revision })),
    })
    // 1. The SERVICE approves the first staged wave.
    await stage("the wave")
    /** The service's answer. */
    const viaService = await service.approve({ sessionId: LEAD })
    if (!viaService.ok) throw new Error(viaService.error)
    // 2. The TOOL approves a SECOND wave of the same content, through the SAME action behind the
    //    handler. The plan name is identical on purpose: the shape comparison is about the records,
    //    not about a label that would mask a real field difference.
    await stage("the wave")
    /** The tool's answer. */
    const viaTool = await h.call("agent_teams_plan", { action: "approve" }) as { team?: TeamRecord }
    expect(viaTool.team).toBeDefined()
    // SAME SHAPE, produced two ways: the extraction changed no field of the record.
    expect(shape(viaService.team as TeamRecord)).toEqual(shape(viaTool.team as TeamRecord))
    // The reply the tool caller sees is STILL the tool's own (no envelope flag leaked into it).
    expect(Object.prototype.hasOwnProperty.call(viaTool, "ok")).toBe(false)
    expect(viaTool.team?.name).toBe("the wave")
  })

  test("the service's dispatch runs the same pass a panel button would", async () => {
    /** A composition with a live session. */
    const h = harness(true)
    /** The published service. */
    const service = h.services.get(ACTIONS_SERVICE) as MpdTeamActionsService
    await h.call("agent_teams_plan", { action: "create", name: "dispatchable", description: "ship it" })
    await h.call("agent_teams_plan", { action: "add_member", member: { name: "Senior Engineer", description: "implements", prompt: "You implement." } })
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "core", description: "own it", blocked_by: [] } })
    /** The approval, run through the service too. */
    const approved = await service.approve({ sessionId: LEAD })
    if (!approved.ok) throw new Error(approved.error)
    /** The dispatch pass. */
    const pass = await service.dispatch({ sessionId: LEAD, limit: 1 })
    if (!pass.ok) throw new Error(pass.error)
    expect(pass.pairs.map((pair) => pair.taskId)).toEqual(["T1"])
    expect(pass.pairs[0]?.memberName).toBe("Senior Engineer")
  })
})
