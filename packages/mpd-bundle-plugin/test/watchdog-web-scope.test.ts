import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import { apply } from "../src/index.ts"
import { loadMpdClient, type TreeNode } from "./client-harness.ts"

/** State and acknowledgement go through the routes registered by the plugin. */
const STATE = "/plugins/mpd-team-watchdog/state"
/** This is the action rendered by each unread row. */
const ACK = "/plugins/mpd-team-watchdog/ack"

/** The rendered acknowledgement for a known incident, traversed through the actual page tree. */
function clickOf(tree: TreeNode, id: string): Function | undefined {
  if (tree === null || typeof tree !== "object") return undefined
  if (Array.isArray(tree)) return tree.map((child) => clickOf(child, id)).find((click) => click !== undefined)
  if (tree.props["data-watchdog-ack"] === id) return tree.props.onClick
  return clickOf(tree.props.children, id)
}

test("the Web watchdog renders and acknowledges the selected incident in its own workspace", async () => {
  /** Two independent stores, with A first in the registry and no shared reader watermark. */
  const temp = mkdtempSync(join(tmpdir(), "mpd-web-watchdog-roots-"))
  /** The two scope addresses exposed by the host's live agents. */
  const a = join(temp, "a")
  /** The second workspace, which supplies the incident selected in the browser. */
  const b = join(temp, "b")
  /** The watchdog's declared sidecar paths under each project. */
  const directory = (root: string): string => join(root, ".mpd", "team", "watchdog")
  /** One record in the same append-only shape as the watchdog writer. */
  const incident = (id: string, at: number): string => JSON.stringify({ id, teamId: "team-1", at, kind: "warn", cause: { kind: "silence-channel", ms: 120000 }, taskId: "T2", attemptId: null, hold: "not-requested", scene: null, acknowledgedBy: [] })
  /** Run the browser factory from source until the shared rebuild updates its deployed bytes. */
  const client = loadMpdClient({}, ["@mpd-dsh/team-page"])
  try {
    mkdirSync(directory(a), { recursive: true })
    mkdirSync(directory(b), { recursive: true })
    writeFileSync(join(directory(a), "incidents.jsonl"), incident("a-new", 4000) + "\n")
    writeFileSync(join(directory(a), "read-watermark.json"), JSON.stringify({ "web-panel": 3000 }))
    writeFileSync(join(directory(b), "incidents.jsonl"), [incident("b-old", 1000), incident("b-new", 2000)].join("\n") + "\n")
    writeFileSync(join(directory(b), "read-watermark.json"), JSON.stringify({ "mpd-tui": 500 }))
    /** The host-facing route registrations served by the plugin. */
    const routes = new Map<string, (req: unknown, res: unknown) => unknown>()
    /** These live agents are the source of truth for the route's optional session query. */
    const agents = { list: () => [{ id: "s1", session: { id: "s1", header: { cwd: a } } }, { id: "s2", session: { id: "s2", header: { cwd: b } } }] }
    /** A small composition exposing the real adapter's registry and web server inputs. */
    const webServer = { register: (route: { path: string; handler: (req: unknown, res: unknown) => unknown }) => { routes.set(route.path, route.handler) } }
    apply({ get: (id: string): unknown => ({ agents, webServer })[id as "agents" | "webServer"], effect: (run: () => unknown): unknown => run() })
    /** A fetch transport over the plugin's public registrations and normal response envelope. */
    const request = async (url: string, init?: RequestInit): Promise<Response> => {
      /** The route server matches the path without its query. */
      const route = routes.get(url.split("?")[0] ?? "")
      if (route === undefined) return new Response(null, { status: 404 })
      /** A Node request carrying the same JSON body the browser actually sent. */
      const req = Object.assign(Readable.from(typeof init?.body === "string" ? [init.body] : []), { url, method: init?.method ?? "GET" })
      /** Capture the status/body through the only response methods the plugin writes. */
      let status = 0
      /** The serialized route result. */
      let body = ""
      await route(req, { writeHead: (code: number): void => { status = code }, end: (text: string): void => { body = text } })
      return new Response(body, { status })
    }
    /** Hold one pre-ack poll so the test can deliver it after the refreshed view. */
    let stale: Promise<Response> | undefined
    globalThis.fetch = (async (url, init) => {
      if (String(url) !== STATE || stale === undefined) return request(String(url), init)
      /** One late response only. The post-ack refresh is allowed to complete. */
      const waiting = stale
      stale = undefined
      return waiting
    }) as typeof fetch
    client.exports.apply(client.ctx)
    client.provideSidebar()
    /** The public watchdog tab and its source factory's refresh seam. */
    const tab = client.calls.registerTab.find((entry) => entry.id === "mpd-agent-teams")
    /** Expose the source factory's offline refresh and store hooks. */
    const page = client.require("@mpd-dsh/team-page") as { __watchdogPoll: () => Promise<unknown>; __resetTeamPageForTests: () => void }
    await new Promise((resolve) => setTimeout(resolve, 0))
    try {
      /** A chooses its own watermark, leaving both earlier B incidents unread. */
      const aggregate = await (await request(STATE)).json()
      expect(aggregate.activity.map((row: { id: string; workspace: string }) => [row.id, row.workspace])).toEqual([["a-new", a], ["b-new", b], ["b-old", b]])
      expect(aggregate.watermarksByWorkspace).toEqual({ [a]: { "web-panel": 3000 }, [b]: { "mpd-tui": 500 } })
      /** With a conversation query only the corresponding root is read. */
      const scoped = await (await request(STATE + "?sessionId=s2")).json()
      expect(scoped.workspaces).toEqual([b])
      expect((await request(STATE + "?sessionId=unknown")).status).toBe(404)
      /** The public button must carry the OLDER selected row's stamp and its own root. */
      const view = tab?.component({})
      if (view === undefined) throw new Error("watchdog tab did not register")
      /** The row actions from the browser hook runtime, as rendered. */
      const tree = await client.hooks.render(view.type, view.props)
      /** The lower B record is selected even though newer incidents still exist. */
      const click = clickOf(tree, "b-old")
      expect(typeof click).toBe("function")
      /** The server's previous snapshot is delivered only after the acknowledgement refresh. */
      const pending = Promise.withResolvers<Response>()
      /** The pre-ack body captured by the slower fetch. */
      const oldResponse = await request(STATE)
      stale = pending.promise
      /** A normal poll already in flight when the user presses the button. */
      const oldPoll = page.__watchdogPoll()
      await new Promise((resolve) => setTimeout(resolve, 0))
      click?.()
      await new Promise((resolve) => setTimeout(resolve, 0))
      pending.resolve(oldResponse)
      await oldPoll
      expect(tab?.badge()).toBe(2)
      expect(JSON.parse(readFileSync(join(directory(b), "read-watermark.json"), "utf8"))).toEqual({ "mpd-tui": 500, "web-panel": 1000 })
      expect(JSON.parse(readFileSync(join(directory(a), "read-watermark.json"), "utf8"))).toEqual({ "web-panel": 3000 })
      expect((await request(ACK, { method: "POST", body: JSON.stringify({ workspace: temp, incidentTs: 2000 }) })).status).toBe(400)
      expect((await request(ACK)).status).toBe(405)
      // A file in the hold directory's place is a read failure, distinct from a fresh store.
      writeFileSync(join(directory(b), "hold"), "unexpected file")
      expect((await request(STATE + "?sessionId=s2")).status).toBe(500)
      /** A failed second root cannot hide usable activity in the first root. */
      const partial = await (await request(STATE)).json()
      expect(partial.unread).toEqual(["a-new"])
      expect(partial.errors).toHaveLength(1)
    } finally {
      page.__resetTeamPageForTests()
    }
  } finally {
    client.restore()
    rmSync(temp, { recursive: true, force: true })
  }
})
