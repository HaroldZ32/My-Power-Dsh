// LANE E — plane preflight #2 (web): does the served payload's MODEL reach the drawn boxes?
//
// THE QUESTION. On the web side the factory body cannot import the core, so agreement rests on the
// SERVED value: the host puts `model` (and each task's `rank`) on `/plugins/mpd-team/state`, and the
// drawing must use them. This probe builds the payload with the host's OWN projection
// (`buildTeamState`), mounts the SHIPPED `client.js` through the repo's offline harness, and reads
// the two witness attributes the drawing publishes: `data-mpd-box-rank` and `data-mpd-edge`.
//
// Run: bun evidence/living-graph/plane-preflight/<ts>/verify-web.ts
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { loadMpdClient } from "../../../../packages/mpd-bundle-plugin/test/client-harness.ts"
import type { ElementNode, TreeNode } from "../../../../packages/mpd-bundle-plugin/test/client-harness.ts"
import { buildTeamState } from "../../../../packages/mpd-team-core-plugin/src/team-web.ts"
import { readTeam } from "../../../../packages/mpd-team-core-plugin/src/team-store.ts"
import { MODEL, SESSION, TEAM, fixtureWorkspace } from "./fixture.ts"

/** This run's own directory, where web-result.json is written. */
const HERE = import.meta.dirname
/** A scratch workspace holding the fixture record, read through the real store path. */
const WS = fixtureWorkspace()
/** The record as the host route reads it. */
const record = readTeam(WS, TEAM)
/** The state payload the host's own projection produces, model included. */
const payload = buildTeamState(record, WS, SESSION, { kind: "native", reason: "lane-e fixture" }, undefined, MODEL)
/** The route the view reads, with this fixture's session. */
const STATE_URL = "/plugins/mpd-team/state?sessionId=" + SESSION
/** The other two routes one mount reads. */
const PLAN_URL = "/plugins/mpd-team/plan?sessionId=" + SESSION
/** The frozen-contract route one mount reads. */
const TASK_URL = "/plugins/mpd-team/task?sessionId=" + SESSION

/** Every element in a rendered tree, depth first. */
function elementsOf(node: TreeNode, out: ElementNode[] = []): ElementNode[] {
  if (Array.isArray(node)) {
    for (const child of node) elementsOf(child, out)
    return out
  }
  if (node !== null && typeof node === "object") {
    const element = node as ElementNode
    out.push(element)
    elementsOf(element.props?.children as TreeNode, out)
  }
  return out
}

/** The plain text of a rendered subtree. */
function textOf(node: TreeNode): string {
  if (typeof node === "string") return node
  if (typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(textOf).join("")
  if (node !== null && typeof node === "object") return textOf((node as ElementNode).props?.children as TreeNode)
  return ""
}

/** Every plain-text leaf of a rendered subtree, in order. */
function leavesOf(node: TreeNode, out: string[] = []): string[] {
  if (typeof node === "string") {
    out.push(node)
    return out
  }
  if (typeof node === "number") {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) leavesOf(child, out)
    return out
  }
  if (node !== null && typeof node === "object") leavesOf((node as ElementNode).props?.children as TreeNode, out)
  return out
}

/** The task id a box draws: the ONE leaf that is exactly an id (`T1`, `F1`, …). */
function idIn(element: ElementNode): string | undefined {
  return leavesOf(element.props?.children as TreeNode).find((leaf) => /^[TF]\d+$/.test(leaf))
}

/** The client, evaluated from the SHIPPED `client.js` bytes, with the three routes canned. */
const client = loadMpdClient({
  responses: {
    [STATE_URL]: payload,
    [PLAN_URL]: { ok: true, workspace: WS, plan: null },
    [TASK_URL]: { ok: true, workspace: WS, contracts: [], hold: null },
  },
})

// THE TIMER DOUBLE. The view's 2000 ms poll interval is a real `setInterval`, which would hold this
// process open for the rest of the run; the probe wants the FIRST frame (which the mount reads
// immediately), not the fallback, so the interval is recorded and never armed. `setTimeout` is left
// alone because the offline render loop needs it to flush promises.
/** The real interval, restored when the probe ends. */
const realSetInterval = globalThis.setInterval
/** Every interval the view would have armed, for the transcript. */
const armedIntervals: number[] = []
globalThis.setInterval = ((fn: () => void, ms?: number) => {
  armedIntervals.push(ms ?? 0)
  return { fn } as unknown as ReturnType<typeof setInterval>
}) as typeof setInterval

/** The measurement, or the failure that stopped it. */
let result: Record<string, unknown>
try {
  client.exports.apply(client.ctx)
  client.provideSidebar()
  /** The team tab the shipped client registered. */
  const tab = client.calls.registerTab.find((entry) => entry.id === "mpd-team")
  if (tab === undefined) throw new Error("the shipped client registered no mpd-team tab")
  /** The settled tree after the view's own reads. */
  const tree = await client.hooks.render(tab.component, { sessionId: SESSION })
  /** Every element the tree holds. */
  const elements = elementsOf(tree)
  /** Every drawn box, with the two witness attributes. */
  const boxes = elements
    .filter((element) => element.props?.["data-mpd-box-rank"] !== undefined)
    .map((element) => ({ id: idIn(element), rank: Number(element.props["data-mpd-box-rank"]), planned: element.props["data-mpd-planned"] === "true" }))
  /** Every drawn edge's witness value (`blocked<-blocker`). */
  const edges = elements.filter((element) => element.props?.["data-mpd-edge"] !== undefined).map((element) => String(element.props["data-mpd-edge"]))
  /** The payload's own rank field, per task, as the host computed it. */
  const servedRanks = payload.tasks.map((task) => ({ id: task.id, rank: task.rank, depth: task.depth }))
  result = {
    probe: "web",
    at: new Date().toISOString(),
    fixture: { workspace: WS, urlsRead: client.calls.fetched.map((call) => call.url) },
    armedIntervals,
    payload: { hasModel: payload.model !== undefined, servedRanks },
    web: { boxes, edges, edgesSorted: [...edges].sort() },
    modelEdges: MODEL.edges.map((edge) => `${edge.to}<-${edge.from}`).sort(),
    verdict: {
      payloadCarriesModel: payload.model !== undefined,
      // The host's rank field must be the model's depth, not the store's `depth`.
      servedRankIsModelRank: servedRanks.every((task) => task.rank === MODEL.nodes.find((node) => node.id === task.id)?.depth),
      // The drawn box's rank attribute must equal the model's depth (T2=1, T4=2 discriminating).
      boxesFollowModel: boxes.every((box) => box.id === undefined || box.rank === MODEL.nodes.find((node) => node.id === box.id)?.depth),
      ghostBoxDrawn: boxes.some((box) => box.id === "T5" && box.planned === true && box.rank === 3),
      // The plan-only edge must be ROUTED on the web side (witness `T2<-T1`).
      planOnlyEdgeDrawn: [...edges].includes("T2<-T1"),
      edgeSetEqualsModel: JSON.stringify([...edges].sort()) === JSON.stringify(MODEL.edges.map((edge) => `${edge.to}<-${edge.from}`).sort()),
    },
  }
} catch (error) {
  result = { probe: "web", at: new Date().toISOString(), error: String(error) }
} finally {
  client.hooks.runCleanups()
  globalThis.setInterval = realSetInterval
  client.restore()
}
writeFileSync(join(HERE, "web-result.json"), JSON.stringify(result, null, 1))
console.log(JSON.stringify(result, null, 1))
