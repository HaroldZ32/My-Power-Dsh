// LANE E — the web FLAT arm: wave 1's board (every `blockedBy: []`) must draw FLAT, from the served
// model's ONE rank, on the web plane too. This is the honesty clause G4 names, observed on the drawn
// bytes rather than inferred from the model.
//
// Run (from the REPO ROOT, so the harness resolves `client.js`): bun evidence/.../verify-web-flat.ts
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { buildModel } from "../../../../packages/mpd-graph-core/src/index.ts"
import type { BoardTask } from "../../../../packages/mpd-graph-core/src/index.ts"
import { loadMpdClient } from "../../../../packages/mpd-bundle-plugin/test/client-harness.ts"
import type { ElementNode, TreeNode } from "../../../../packages/mpd-bundle-plugin/test/client-harness.ts"
import { buildTeamState } from "../../../../packages/mpd-team-core-plugin/src/team-web.ts"
import { readTeam } from "../../../../packages/mpd-team-core-plugin/src/team-store.ts"
import { RECORD, SESSION, TEAM, fixtureWorkspace } from "./fixture.ts"

/** This run's own directory. */
const HERE = import.meta.dirname
/** A scratch workspace holding the flat record. */
const WS = fixtureWorkspace()
/** The flat record: five roots, no blocker anywhere. */
const flatRecord = {
  ...RECORD,
  tasks: ["T1", "T2", "T3", "T4", "T5"].map((id) => ({ id, subject: `Flat ${id}`, kind: "work", status: "pending", blockedBy: [], createdAt: RECORD.createdAt, updatedAt: RECORD.createdAt, revision: 1 })),
}
writeFileSync(join(WS, ".mpd", "team", "teams", `${TEAM}.json`), JSON.stringify(flatRecord, null, 1))
/** The record as the host route reads it. */
const record = readTeam(WS, TEAM)
/** The rows the host merges: five roots, served depth 0. */
const BOARD: BoardTask[] = ["T1", "T2", "T3", "T4", "T5"].map((id) => ({ id, subject: `Flat ${id}`, status: "pending", blockedBy: [], depth: 0 }))
/** The ONE flat model the host serves. */
const model = buildModel({ board: BOARD })
/** The state payload the host's own projection produces. */
const payload = buildTeamState(record, WS, SESSION, { kind: "native", reason: "lane-e flat fixture" }, undefined, model)

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

/** The real interval, restored when the probe ends. */
const realSetInterval = globalThis.setInterval
/** The intervals the view would have armed (they never run; the mount's own read is enough). */
const armedIntervals: number[] = []
globalThis.setInterval = ((fn: () => void, ms?: number) => {
  armedIntervals.push(ms ?? 0)
  return { fn } as unknown as ReturnType<typeof setInterval>
}) as typeof setInterval

/** The client, evaluated from the SHIPPED `client.js` bytes. */
const client = loadMpdClient({
  responses: {
    ["/plugins/mpd-team/state?sessionId=" + SESSION]: payload,
    ["/plugins/mpd-team/plan?sessionId=" + SESSION]: { ok: true, workspace: WS, plan: null },
    ["/plugins/mpd-team/task?sessionId=" + SESSION]: { ok: true, workspace: WS, contracts: [], hold: null },
  },
})

/** The measurement. */
let result: Record<string, unknown>
try {
  client.exports.apply(client.ctx)
  client.provideSidebar()
  /** The team tab the shipped client registered. */
  const tab = client.calls.registerTab.find((entry) => entry.id === "mpd-team")
  if (tab === undefined) throw new Error("the shipped client registered no mpd-team tab")
  /** The settled tree after the view's own reads. */
  const tree = await client.hooks.render(tab.component, { sessionId: SESSION })
  /** Every drawn box, with its rank attribute and id. */
  const boxes = elementsOf(tree)
    .filter((element) => element.props?.["data-mpd-box-rank"] !== undefined)
    .map((element) => ({ id: idIn(element), rank: Number(element.props["data-mpd-box-rank"]) }))
  result = {
    probe: "web-flat",
    at: new Date().toISOString(),
    payload: { modelRanks: model.ranks, ranksDerived: model.report.ranksDerived, servedRanks: payload.tasks.map((task) => ({ id: task.id, rank: task.rank })) },
    web: { boxes, armedIntervals },
    verdict: {
      modelOneRank: model.ranks.length === 1 && model.ranks[0].length === 5 && model.report.ranksDerived === true,
      servedRanksAllZero: payload.tasks.every((task) => task.rank === 0),
      boxesAllRankZero: boxes.length === 5 && boxes.every((box) => box.rank === 0),
      boxesAreTheFiveTasks: JSON.stringify([...boxes].map((box) => box.id).sort()) === JSON.stringify(["T1", "T2", "T3", "T4", "T5"]),
    },
  }
} catch (error) {
  result = { probe: "web-flat", at: new Date().toISOString(), error: String(error) }
} finally {
  client.hooks.runCleanups()
  globalThis.setInterval = realSetInterval
  client.restore()
}
writeFileSync(join(HERE, "web-flat-result.json"), JSON.stringify(result, null, 1))
console.log(JSON.stringify(result, null, 1))
