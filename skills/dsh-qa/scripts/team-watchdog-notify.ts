#!/usr/bin/env bun
// Case team-watchdog-notify — AC-12 / AC-13 / AC-14: BOTH front doors replay an unacknowledged
// incident and stop replaying it once the reader acknowledges.
//
// WEB ARM (reader key `web-panel`): the REAL route handlers from
// `packages/mpd-bundle-plugin/src/watchdog-web.ts` over a sandbox store, plus the REAL built
// `packages/mpd-bundle-plugin/client.js` in the offline hook harness, with `fetch` served by the
// payload the route just produced — so the rendered banner/record cannot be fed a fixture the
// route could not return.
// TUI ARM (reader key `mpd-tui`): the REAL `mpdWatchdog` service from the mounted watchdog dist,
// driven through the REAL TUI module `packages/mpd-tui-plugin/src/watchdog.ts`
// (`readWatchdogView` → `watchdogDialog`/`watchdogNotice` → `attachWatchdogFrontDoor().acknowledge`),
// with the status-line composition (`composeNotices`) asserted, and the watermark file proved
// byte-wise before/after.
//
// Both arms state the honest fallback: WITHOUT an acknowledge the replay is PERMANENT RE-DISPLAY
// BY DESIGN (the payload's `replay` flag and the on-screen line say so).
//
// Usage:
//   bun skills/dsh-qa/scripts/team-watchdog-notify.ts --self-test
//   bun skills/dsh-qa/scripts/team-watchdog-notify.ts --surface web|tui|both [--out <dir>]
// Evidence -> evidence/team-watchdog/lanes/<timestamp>-notify-<surface>/{result.json,output.log,raw/}
import { mkdirSync, writeFileSync } from "node:fs"
import { Readable } from "node:stream"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import {
  PATHS, captureStdout, evidenceDir, finish, hashTree, read, sandboxWorkspace, say, selfTest, sha256, storePaths, writeEvidence,
} from "./lib/watchdog-lane.ts"
import type { LaneCheck, LaneResult, LaneVerdict, MountedWatchdog, StdoutCapture } from "./lib/watchdog-lane.ts"
import { exitOnRefusal, refuseOverwrite } from "./lib/immutable-output.ts"
import type { ElementNode, TreeNode } from "../../../packages/mpd-bundle-plugin/test/client-harness.ts"
import { createTuiAdapter, TUI_SEAMS } from "../../../packages/mpd-tui-adapter-plugin/src/index.ts"
import type { PluginContextLike, TuiDialogsLike } from "../../../packages/mpd-tui-adapter-plugin/src/index.ts"
import { createDialogs } from "../../../packages/mpd-tui-plugin/src/dialogs.ts"

/** The lane slug, which prefixes every printed line and names the evidence directory. */
const SLUG = "team-watchdog-notify"
/** The team id the seed store holds an incident and a hold for. */
const TEAM = "notify-probe"
/** The seed incident's timestamp (epoch ms) — also the watermark both acknowledges advance to. */
const T1 = 1_789_400_000_000
/** A second timestamp one minute later, used for the incidents appended mid-run. */
const T2 = T1 + 60_000
/** A fresh incident after both readers clear their displayed streams. */
const T3 = T2 + 60_000
/** The sibling's Web watermark hides its seed, while any cross-root TUI write moves its lower watermark. */
const NEIGHBOR_WATERMARK = { "web-panel": T2, "mpd-tui": 17 } as const
/** The actual Web client polls the state path with the route's default reader. */
const WEB_STATE = "/plugins/mpd-team-watchdog/state"
/** The acknowledgement POST registered by the watchdog bundle. */
const WEB_ACK = "/plugins/mpd-team-watchdog/ack"

/** The banner half of the web payload (mirrors `WatchdogBanner`; only the incident id is asserted). */
interface WebBanner {
  /** The incident the banner names, `null` when the banner reports a bare hold. */
  incidentId: string | null
  /** The banner marker the shipped view prints immediately after its intro. */
  kind: string
}

/** One activity record of the web payload (mirrors `WatchdogActivity`). */
interface WebActivity {
  /** The id of the incident the record stands for. */
  id: string
  /** Whether this reader still owes an acknowledge for it. */
  ackRequired: boolean
  /** The incident’s root as served over the aggregate route. */
  workspace: string
}

/** The web state payload the REAL route returns; every field is optional because the lane only reads what it asserts. */
interface WebPayload {
  /** The top banner, `null` when nothing is held and nothing is unread. */
  banner?: WebBanner | null
  /** Whether a team is held right now. */
  stuck?: boolean
  /** Whether the payload replays incidents this reader has not acknowledged. */
  replay?: boolean
  /** The activity records that ride the payload, newest first. */
  activity?: WebActivity[]
  /** The ids of the unread incidents. */
  unread?: string[]
}

/** The web arm's observed facts. */
interface WebArmObservation {
  /** The payload the REAL state route produced for the panel's first poll. */
  payload: WebPayload
  /** The id of the incident the store was seeded with. */
  incidentId: string
  /** How many of the panel's own fetches hit the state route with no user action. */
  fetchedWithoutUserAction: number
  /** The rendered `data-watchdog-banner` immediately after the panel introduction. */
  topChildAttr: unknown
  /** Whether the real banner is above the activity list. */
  topChildIsBanner: boolean
  /** How many activity records the rendered body carries. */
  recordCount: number
  /** The incident id the first rendered record names. */
  recordId: unknown
  /** Whether the acknowledge advanced this reader's watermark. */
  ackAdvanced: boolean
  /** The watermark document as it stood right after the web acknowledge. */
  watermarkAfter: Record<string, number>
  /** The payload's replay flag after the acknowledge. */
  replayAfterAck: unknown
  /** How many activity records the re-poll rendered. */
  recordsAfterAck: number
  /** Whether the replay really stopped after the acknowledge. */
  replayStoppedAfterAck: boolean
  /** Whether a fresh incident returns to the rendered replay. */
  newIncidentReplays: boolean
  /** Workspace and stamp carried by the selected Web row, compared with the mounted route. */
  selectedWorkspaceAndTime: boolean
  /** Both reader keys in the other workspace, unchanged by the Web acknowledgement. */
  neighborWatermark: Record<string, number>
  /** The incident ids still rendered after the user acknowledges the previously displayed row. */
  replayAfterOldAck: unknown[]
}

/** The TUI arm's observed facts. */
interface TuiArmObservation {
  /** The reader key the TUI front door owns. */
  readerKey: string
  /** How many incidents were unread before the acknowledge. */
  unreadBefore: number
  /** The status-line notice composed before the acknowledge. */
  noticeBefore: string | undefined
  /** The option ids the replay dialog offered. */
  dialogOptionIds: string[]
  /** The status line the TUI renders, with the bridge's notice composed in. */
  composedLine: string | undefined
  /** The bridge's own notice, which the status line composes beside the watchdog's. */
  bridgeNotice: string | undefined
  /** The watermark timestamp the acknowledge advanced to. */
  ackUpTo: number
  /** Whether the REAL service reported the acknowledge as landed. */
  ackAdvanced: boolean
  /** How many times the post-acknowledge hook ran, when the arm reports it. */
  acknowledgedHook?: number
  /** The watermark document read back after the acknowledge. */
  watermarkAfter: Record<string, number>
  /** How many incidents remain unread after the acknowledge. */
  unreadAfter: number
  /** The status-line notice composed after the acknowledge. */
  noticeAfter: string | undefined
  /** The dialog request built from the post-acknowledge view, when anything was still unread. */
  dialogAfter: unknown
  /** The notice a SECOND unacknowledged incident produces on the next start. */
  newIncidentNotice: string | undefined
  /** Whether the built TUI bytes carry the notice prefix, the reader key and the acknowledge option. */
  builtBytesWired: boolean
  /** The sibling’s reader keys after switching workspace while the replay dialog was open. */
  neighborWatermark: Record<string, number>
  /** The incident timestamps the target still had unread after the older selection. */
  remainingAfterOldAck: number[]
}

/** The lane's whole observation: both front doors' facts plus the store's own fingerprints. */
interface NotifyObservation {
  /** The honest fallback the result states verbatim. */
  fallbackStated: unknown
  /** The watermark file's fingerprint before the acknowledges. */
  watermarkBeforeSha: unknown
  /** The watermark file's fingerprint after the acknowledges, assigned once both arms ran. */
  watermarkAfterSha?: unknown
  /** The watermark text before the acknowledges, kept for the record. */
  watermarkBeforeText?: string
  /** The watermark text after the acknowledges, kept for the record. */
  watermarkAfterText?: string
  /** The web arm's facts; absent when that surface did not run (its checks are then skipped). */
  web?: WebArmObservation
  /** The TUI arm's facts; absent when that surface did not run. */
  tui?: TuiArmObservation
}

/** One route handler, as the REAL bundle module registers it. */
type RouteHandler = (req: unknown, res: unknown) => unknown

/** The minimal Web page test seam that permits an explicit read and real effect cleanup. */
interface TeamPageModule {
  /** Re-poll the watchdog state through the browser's fetch path. */
  __watchdogPoll(): Promise<WebPayload | null>
  /** Reset polling and listeners when the test exits. */
  __resetTeamPageForTests(): void
}

/** The notify lane's result document, as `writeEvidence` and `finish` consume it. */
interface NotifyResult extends LaneResult {
  /** The acceptance criteria this lane covers. */
  task: string
  /** The lane slug every printed line is prefixed with. */
  lane: string
  /** The surface this run drove. */
  surface: string
  /** The two reader keys the front doors own. */
  readerKeys: { web: string; tui: string }
  /** The sandbox workspace every artifact was read from. */
  workspace: string
  /** The store tree's fingerprints before and after the arms ran. */
  storeFiles: { before: Record<string, unknown>; after: Record<string, unknown> }
  /** Everything the evaluator decided on. */
  observed: NotifyObservation
  /** The evidence file this lane wrote, set once the record is persisted. */
  evidenceFile?: string
}

/**
 * The pure evaluator over both arms' observed facts.
 * @param observed The two front doors' facts plus the store's own fingerprints.
 * @returns The verdict: every check with its detail, and whether all of them held.
 */
export function evaluate(observed: NotifyObservation): LaneVerdict {
  // One entry per assertion, in the order the checks run.
  const checks: LaneCheck[] = []
  // Record one assertion, coercing `ok` and stringifying `detail` exactly as the lane always did.
  const add = (id: string, ok: unknown, detail: unknown): number => checks.push({ id, ok: Boolean(ok), detail: String(detail) })

  if (observed.web !== undefined) {
    // The web arm's facts, narrowed to the arm that actually ran.
    const web = observed.web
    add("W1", web.payload?.banner?.incidentId === web.incidentId && web.payload?.stuck === true && web.payload?.replay === true,
      "the web payload's banner names the unacknowledged incident and marks the replay (" + JSON.stringify({ banner: web.payload?.banner?.incidentId, replay: web.payload?.replay }) + ")")
    add("W2", Array.isArray(web.payload?.activity) && web.payload.activity.length === 1 && web.payload.activity[0].ackRequired === true,
      "ONE activity record rides the payload the panel consumes (" + JSON.stringify(web.payload?.activity?.length) + ")")
    add("W3", web.fetchedWithoutUserAction >= 1, "the panel's FIRST poll fetches the route with no user action (" + String(web.fetchedWithoutUserAction) + " fetch(es))")
    add("W4", web.topChildIsBanner === true, "the rendered banner follows the panel introduction and precedes activity (banner=" + JSON.stringify(web.topChildAttr) + ")")
    add("W5", web.recordCount === 1 && web.recordId === web.incidentId, "the rendered body carries exactly one record for that incident (" + JSON.stringify(web.recordCount) + ")")
    add("W6", web.ackAdvanced === true && web.watermarkAfter?.["web-panel"] === T1 && web.watermarkAfter?.["mpd-tui"] === 0,
      "the web acknowledge advanced ONLY its own reader key (web-panel → " + JSON.stringify(web.watermarkAfter?.["web-panel"]) + ", the TUI reader untouched at " + JSON.stringify(web.watermarkAfter?.["mpd-tui"]) + ")")
    add("W7", web.replayStoppedAfterAck === true && web.recordsAfterAck === 0,
      "after the acknowledge the web replay stops (replay=" + JSON.stringify(web.replayAfterAck) + ", records=" + JSON.stringify(web.recordsAfterAck) + ")")
    add("W8", web.newIncidentReplays === true, "a fresh incident reappears in the rendered replay")
    add("W9", web.selectedWorkspaceAndTime && web.neighborWatermark["web-panel"] === NEIGHBOR_WATERMARK["web-panel"] && web.neighborWatermark["mpd-tui"] === NEIGHBOR_WATERMARK["mpd-tui"],
      "the rendered acknowledge targets its incident workspace and timestamp; the sibling watermark is unchanged (" + JSON.stringify(web.neighborWatermark) + ")")
    add("W10", web.replayAfterOldAck.length === 1 && web.replayAfterOldAck[0] === "inc-2",
      "a newer incident remains on screen after acknowledging the older selection (" + JSON.stringify(web.replayAfterOldAck) + ")")
  }

  if (observed.tui !== undefined) {
    // The TUI arm's facts, narrowed to the arm that actually ran.
    const tui = observed.tui
    add("T1", tui.readerKey === "mpd-tui", "the TUI front door owns the reader key mpd-tui (" + JSON.stringify(tui.readerKey) + ")")
    add("T2", tui.unreadBefore >= 1 && tui.noticeBefore !== undefined && tui.noticeBefore.includes("watchdog"),
      "the TUI status notice is composed while an incident is unread (" + JSON.stringify(tui.noticeBefore) + ")")
    add("T3", tui.composedLine === (tui.bridgeNotice === undefined ? tui.noticeBefore : tui.bridgeNotice + " · " + tui.noticeBefore) || String(tui.composedLine).includes(String(tui.noticeBefore)),
      "the notice reaches the COMPOSED status line the TUI renders (" + JSON.stringify(tui.composedLine) + ")")
    add("T4", tui.dialogOptionIds?.includes("acknowledge") === true, "the replay dialog offers the acknowledge action (" + JSON.stringify(tui.dialogOptionIds) + ")")
    add("T5", tui.ackAdvanced === true && tui.watermarkAfter?.[tui.readerKey] === tui.ackUpTo && tui.watermarkAfter?.["web-panel"] === 0,
      "the TUI acknowledge advanced the mpd-tui watermark through the REAL service up to " + JSON.stringify(tui.ackUpTo) + ", leaving the web reader's key untouched (" + JSON.stringify(tui.watermarkAfter) + ")")
    add("T6", tui.unreadAfter === 0 && tui.noticeAfter !== undefined && tui.noticeAfter.includes(TEAM) && !tui.noticeAfter.includes("unread"),
      "after acknowledging the whole replay the TUI reads NOTHING unread and its notice no longer replays incidents — it still shows the DURABLE hold, which is current state, not a replay (unread=" + JSON.stringify(tui.unreadAfter) + ", notice=" + JSON.stringify(tui.noticeAfter) + ")")
    add("T7", tui.builtBytesWired === true, "the BUILT TUI bytes carry the notice prefix, the reader key and the acknowledge option")
    add("T8", tui.newIncidentNotice !== undefined && String(tui.newIncidentNotice).includes("unread"),
      "a fresh incident reaches the TUI notice: " + JSON.stringify(tui.newIncidentNotice))
    add("T9", tui.neighborWatermark["mpd-tui"] === NEIGHBOR_WATERMARK["mpd-tui"] && tui.neighborWatermark["web-panel"] === NEIGHBOR_WATERMARK["web-panel"],
      "switching the active workspace while the dialog is open leaves the sibling watermark unchanged (" + JSON.stringify(tui.neighborWatermark) + ")")
    add("T10", tui.remainingAfterOldAck.length === 1 && tui.remainingAfterOldAck[0] === T2,
      "a late incident stays unread after the earlier replay is acknowledged (" + JSON.stringify(tui.remainingAfterOldAck) + ")")
  }

  add("N1", (observed.watermarkBeforeSha !== observed.watermarkAfterSha) === true, "the watermark file's BYTES changed across the acknowledges (" + String(observed.watermarkBeforeSha).slice(0, 12) + " → " + String(observed.watermarkAfterSha).slice(0, 12) + ")")
  // The honest fallback this lane states, read as a string for the two required phrases.
  const fallback = observed.fallbackStated
  add("N2", typeof fallback === "string" && fallback.toLowerCase().includes("permanent re-display") && fallback.toLowerCase().includes("by design"),
    "the honest fallback is stated verbatim in the result: " + JSON.stringify(fallback))
  return { ok: checks.length > 0 && checks.every((check) => check.ok), checks }
}

/**
 * Seed the sandbox store both arms start from: one hold, one incident, a scene pointer and a
 * watermark document with both reader keys at zero.
 * @param ws Absolute path of the sandbox workspace.
 */
function seedStore(ws: string): void {
  // The watchdog store's paths for that workspace.
  const paths = storePaths(ws)
  mkdirSync(paths.holdDir, { recursive: true })
  mkdirSync(paths.scene(TEAM), { recursive: true })
  writeFileSync(paths.hold(TEAM), JSON.stringify({ id: "hold-notify-1", teamId: TEAM, since: T1, cause: "silence 120000 ms", taskId: "t9", attemptId: "att-1", sceneAt: T1 }, null, 2) + "\n")
  writeFileSync(paths.incidents, JSON.stringify({ id: "inc-1", teamId: TEAM, kind: "escalate", at: T1, cause: { kind: "silence", ms: 120000 }, taskId: "t9", attemptId: "att-1", scene: null, hold: "applied", acknowledgedBy: [] }) + "\n")
  writeFileSync(paths.scenePointer(TEAM), JSON.stringify({ at: T1, cause: "silence" }) + "\n")
  writeFileSync(paths.watermark, JSON.stringify({ "mpd-tui": 0, "web-panel": 0 }, null, 2) + "\n")
}
/**
 * Append one incident record to the store's append-only incident log.
 * @param ws Absolute path of the sandbox workspace.
 * @param record The incident record to append.
 */
function appendIncident(ws: string, record: Record<string, unknown>): void {
  writeFileSync(storePaths(ws).incidents, JSON.stringify(record) + "\n", { flag: "a" })
}

/** Read the exact persisted reader keys after an action returns. */
function readWatermark(workspace: string): Record<string, number> {
  return JSON.parse(read(storePaths(workspace).watermark)) as Record<string, number>
}

/** Append a warning without changing the hold or the reader watermark. */
function appendWarning(workspace: string, id: string, at: number): void {
  appendIncident(workspace, { id, teamId: TEAM, kind: "warn", at, cause: { kind: "silence", ms: 90000 }, taskId: "t10", attemptId: "att-2", scene: null, hold: "not-requested", acknowledgedBy: [] })
}

/** Walk real client elements and return the rows matching a stable rendered marker. */
function elementsWith(tree: TreeNode, attr: string): ElementNode[] {
  if (Array.isArray(tree)) return tree.flatMap((child) => elementsWith(child, attr))
  if (typeof tree !== "object" || tree === null) return []
  return [...(tree.props[attr] === undefined ? [] : [tree]), ...elementsWith(tree.props.children, attr)]
}

/** Run the preserved Web bundle and its real route registrations against two sandbox stores. */
async function runWebArm(ws: string, neighbor: string): Promise<WebArmObservation> {
  /** The source routes the host bundles, loaded via a file URL for Windows. */
  const { registerWatchdogRoutes } = await import(pathToFileURL(PATHS.webRoute).href) as typeof import("../../../packages/mpd-bundle-plugin/src/watchdog-web.ts")
  /** The route table filled by the plugin's actual registration. */
  const routes = new Map<string, RouteHandler>()
  /** The sibling is first so a first-root fallback would land in the wrong store. */
  const registered = registerWatchdogRoutes(
    { register: (route) => { routes.set(route.path, route.handler); return () => {} } },
    { roots: () => [neighbor, ws], stateDir: () => join(".mpd", "team"), effect: (fn) => fn() },
  )
  if (!registered.state || !registered.ack) throw new Error("The watchdog Web routes did not mount")
  /** Client fetches and exact acknowledgement JSON, captured before dispatch to the real handlers. */
  const requests: string[] = []
  /** Each click's posted address and the route receipt's resulting timestamp. */
  const receipts: Array<{ workspace: unknown; incidentTs: unknown; after: unknown; status: number }> = []
  /** Replace the browser's transport only, passing its actual body and HTTP method to the routes. */
  const request = async (url: string, init?: RequestInit): Promise<Response> => {
    requests.push(url)
    /** The registered handler, identified by the request path. */
    const handler = routes.get(url.split("?")[0] ?? "")
    if (handler === undefined) return new Response(null, { status: 404 })
    /** The browser's actual POST payload, or an empty body for state reads. */
    const raw = typeof init?.body === "string" ? init.body : ""
    /** A Node request stream, like the installed route server provides. */
    const req = Object.assign(Readable.from(raw === "" ? [] : [raw]), { method: init?.method ?? "GET", url })
    /** HTTP code from the route. */
    let status = 0
    /** Response bytes produced by the route. */
    let body = ""
    await handler(req, { writeHead: (value: number): void => { status = value }, end: (value: string): void => { body = value } })
    if (url === WEB_ACK && raw !== "") {
      /** Read back the body that actually reached the server and the receipt the server produced. */
      const sent = JSON.parse(raw) as Record<string, unknown>
      /** The acknowledgement route's JSON receipt. */
      const result = JSON.parse(body) as Record<string, unknown>
      receipts.push({ workspace: sent.workspace, incidentTs: sent.incidentTs, after: result.after, status })
    }
    return new Response(body, { status })
  }
  /** The bundle client loader executes the committed factory for this proof. */
  const { loadMpdClient } = await import(pathToFileURL(PATHS.webHarness).href) as typeof import("../../../packages/mpd-bundle-plugin/test/client-harness.ts")
  /** The loaded client with the real watchdog module factory. */
  const client = loadMpdClient()
  /** The page's lifecycle seam for refresh and cleanup in the offline host. */
  const page = client.require("@mpd-dsh/team-page") as TeamPageModule
  globalThis.fetch = ((url, init) => request(String(url), init)) as typeof fetch
  try {
    client.exports.apply(client.ctx)
    client.provideSidebar()
    /** The public descriptor accepted by the host's tab registration. */
    const tab = client.calls.registerTab.find((candidate) => candidate.id === "mpd-agent-teams")
    if (tab === undefined) throw new Error("The watchdog sidebar tab did not mount")
    /** The mounted entry's component and its registered props. */
    const element = tab.component({})
    /** The first frame comes from the client's automatic poll, before any manual read or click. */
    const first = await client.hooks.render(element.type as Function, element.props)
    /** Initial page-originated polls to the state route. */
    const fetchedWithoutUserAction = requests.filter((url) => url === WEB_STATE).length
    /** Record the actual mounted route payload after the first automatic read. */
    const payload = await (await request(WEB_STATE)).json() as WebPayload
    /** The rendered banner and initial incident rows. */
    const topChildAttr = Array.isArray(first.props.children) ? elementsWith(first.props.children[1], "data-watchdog-banner")[0]?.props["data-watchdog-banner"] : undefined
    /** The initial frame must contain exactly the incident selected below. */
    const records = elementsWith(first, "data-watchdog-activity")
    /** The action the registered client rendered for a matching incident. */
    const ack = async (frame: ElementNode, id: string): Promise<ElementNode> => {
      /** Find the actual on-click handler wired by the deployed factory. */
      const click = elementsWith(frame, "data-watchdog-ack").find((row) => row.props["data-watchdog-ack"] === id)?.props.onClick
      if (typeof click !== "function") throw new Error("The rendered acknowledge control is missing for " + id)
      click()
      // The hook harness returns the frame drawn before its awaited effects settle.
      await client.hooks.act(element.type as Function, element.props)
      return client.hooks.render(element.type as Function, element.props)
    }
    // The first click is from a stale frame. The other, newer incident is already on disk.
    appendWarning(ws, "inc-2", T2)
    /** The post-click frame after acknowledging the older row. */
    const afterOld = await ack(first, "inc-1")
    /** The on-disk result must be T1 even though T2 was available. */
    const watermarkAfter = readWatermark(ws)
    /** Inspect the second root before the later acknowledgement. */
    const neighborWatermark = readWatermark(neighbor)
    /** The remaining visible activity from the newly read route state. */
    const replayAfterOldAck = elementsWith(afterOld, "data-watchdog-activity").map((row) => row.props["data-watchdog-activity"])
    /** The specific traffic the click produced, with the route's own acknowledgement receipt. */
    const oldReceipt = receipts[0]
    /** The second explicit acknowledgement should clear the remainder of the replay. */
    const afterAll = await ack(afterOld, "inc-2")
    /** Fresh read of the route after both acknowledgements. */
    const afterAck = await (await request(WEB_STATE)).json() as WebPayload
    /** The actual frame after the last replay entry was acknowledged. */
    const recordsAfterAck = elementsWith(afterAll, "data-watchdog-activity").length
    appendWarning(ws, "inc-3", T3)
    /** Explicit re-read following the same transport as the background poll. */
    const latest = await page.__watchdogPoll()
    /** The new incident must appear in the client as well as the payload. */
    const third = await client.hooks.act(element.type as Function, element.props)
    say(SLUG, "web: rendered and clicked first incident; watermark=" + String(watermarkAfter["web-panel"]) + " remaining=" + JSON.stringify(replayAfterOldAck))
    return {
      payload, incidentId: "inc-1", fetchedWithoutUserAction, topChildAttr,
      topChildIsBanner: topChildAttr !== undefined && topChildAttr === payload.banner?.kind,
      recordCount: records.length, recordId: records[0]?.props["data-watchdog-activity"],
      ackAdvanced: oldReceipt?.status === 200 && oldReceipt.after === T1,
      watermarkAfter, replayAfterAck: afterAck.replay, recordsAfterAck,
      replayStoppedAfterAck: afterAck.replay === false && recordsAfterAck === 0 && receipts[1]?.after === T2,
      newIncidentReplays: latest?.unread?.length === 1 && latest.banner?.incidentId === "inc-3" && elementsWith(third, "data-watchdog-activity")[0]?.props["data-watchdog-activity"] === "inc-3",
      selectedWorkspaceAndTime: oldReceipt?.workspace === ws && oldReceipt.incidentTs === T1 && payload.activity?.[0]?.workspace === ws,
      neighborWatermark, replayAfterOldAck,
    }
  } finally {
    page.__resetTeamPageForTests()
    client.hooks.runCleanups()
    client.restore()
  }
}

/** Drive the TUI's real adapter, dialog facade and mounted watchdog service across two roots. */
async function runTuiArm(ws: string, neighbor: string, mounted: MountedWatchdog): Promise<TuiArmObservation> {
  /** Load the current watchdog front door rather than a clone of its rendering rules. */
  const tui = await import(pathToFileURL(PATHS.tuiWatchdog).href) as typeof import("../../../packages/mpd-tui-plugin/src/watchdog.ts")
  /** The store service supplied by the watchdog mount. */
  const service = mounted.services.get("mpdWatchdog") as Parameters<typeof tui.readWatchdogView>[0]
  /** The reader whose watermark these actions can change. */
  const reader = tui.WATCHDOG_READER
  /** Before opening the dialog, only the seed incident is visible. */
  const before = tui.readWatchdogView(service, reader, ws)
  /** The rendered notice and the status line containing it. */
  const noticeBefore = tui.watchdogNotice(before)
  /** The bridge message already on the status line. */
  const bridgeNotice = "saved to settings"
  /** The status line holding both notices. */
  const composedLine = tui.composeNotices(bridgeNotice, noticeBefore)
  /** Select a different active workspace while the dialog is waiting for the user. */
  let active = ws
  /** The option ids presented in the real dialog invocation. */
  let dialogOptionIds: string[] = []
  /** Only the selected dialog has the late append and workspace switch. */
  const dialog: TuiDialogsLike = {
    select: async (request) => {
      dialogOptionIds = request.options.map((option) => option.id)
      appendWarning(ws, "inc-2", T2)
      active = neighbor
      return tui.ACKNOWLEDGE_OPTION
    },
    confirm: async (): Promise<undefined> => undefined,
    input: async (): Promise<undefined> => undefined,
  }
  mounted.ctx.provide(TUI_SEAMS.dialogs, dialog)
  /** Bind the real adapter and watchdog row to the same host fixture. */
  const ctx: PluginContextLike = {
    ...mounted.ctx,
    inject: (deps: readonly string[], bind: (scoped: PluginContextLike) => void): (() => void) => mounted.ctx.inject(deps, () => { bind(ctx) }),
  }
  /** The adapter used by both real TUI front-door components. */
  const adapter = createTuiAdapter(ctx)
  /** The facade that opens the real dialog seam and records if the post-ack hook ran. */
  let acknowledgedHook = 0
  /** Automatic replay is disabled so the test opens exactly one dialog. */
  const frontDoor = tui.attachWatchdogFrontDoor(ctx, adapter, mounted.ctx.logger, {
    workspaceRoot: () => active,
    dialogs: createDialogs(adapter, mounted.ctx.logger),
    replayOnAttach: false,
    onAcknowledged: () => { acknowledgedHook += 1 },
  })
  /** The real UI offered its choices and the host selected Acknowledge. */
  const selected = await frontDoor.offer()
  /** Capture both stores before the second acknowledgement. */
  const watermarkAfter = readWatermark(ws)
  /** The workspace selected only after the original dialog was shown. */
  const neighborWatermark = readWatermark(neighbor)
  /** Only the newly appended incident should still be unread at the original root. */
  const remainingAfterOldAck = frontDoor.view(ws).unread.map((incident) => incident.at)
  /** Acknowledge the newer incident explicitly in the same workspace. */
  const settled = frontDoor.acknowledge(T2, ws)
  /** The final read confirms replay cleared while the hold remains. */
  const after = frontDoor.view(ws)
  appendWarning(ws, "inc-3", T3)
  /** The new notice after a third arrival. */
  const newIncidentNotice = tui.watchdogNotice(frontDoor.view(ws))
  /** Keep the existing built-artifact check in addition to the mount and behavior assertions. */
  const dist = read(PATHS.tuiDist)
  say(SLUG, "tui: replay dialog selected " + String(selected) + "; watermark=" + String(watermarkAfter[reader]) + " remaining=" + JSON.stringify(remainingAfterOldAck))
  return {
    readerKey: reader, unreadBefore: before.unread.length, noticeBefore, dialogOptionIds, composedLine, bridgeNotice,
    ackUpTo: T1, ackAdvanced: selected === tui.ACKNOWLEDGE_OPTION && acknowledgedHook === 2 && settled.ok && settled.watermark === T2,
    acknowledgedHook, watermarkAfter, unreadAfter: after.unread.length, noticeAfter: tui.watchdogNotice(after),
    dialogAfter: after.unread.length > 0 ? tui.watchdogDialog(after) : undefined,
    newIncidentNotice,
    builtBytesWired: dist.includes(tui.WATCHDOG_NOTICE_PREFIX) && dist.includes(reader) && dist.includes(tui.ACKNOWLEDGE_OPTION),
    neighborWatermark, remainingAfterOldAck,
  }
}

/**
 * The real lane: seed the store, mount the built watchdog and drive the selected surface(s).
 * @param argv The process arguments, scanned for `--surface` and `--out`.
 * @returns The result document this run persisted.
 */
async function run(argv: readonly string[]): Promise<NotifyResult> {
  // The index of the `--surface` selector, or -1 when the caller named none.
  const surfaceAt = argv.indexOf("--surface")
  // The surface to drive: `web`, `tui` or both.
  const surface = surfaceAt >= 0 ? String(argv[surfaceAt + 1]) : "both"
  // The immutable evidence directory: `--out`, or a fresh timestamped one per surface.
  const dir = evidenceDir(argv, "notify-" + surface)
  // T-83: the evidence target is IMMUTABLE BY DEFAULT — a caller-supplied --out that already exists
  // is refused instead of being rewritten (the T-63/T-76 class: a re-run must never overwrite a record).
  try {
    refuseOverwrite(dir, { label: "evidence directory", remedy: "pass a new --out <dir>, or omit --out for a fresh timestamped directory (T-53)" })
  } catch (error) {
    exitOnRefusal(error, "[" + SLUG + "]")
  }
  // The sandbox workspace under that directory (DSH_HOME alone does not isolate workspace state).
  const ws = sandboxWorkspace(dir, "notify")
  /** The first registered workspace has unrelated reader state. */
  const neighbor = sandboxWorkspace(dir, "neighbor")
  seedStore(ws)
  seedStore(neighbor)
  writeFileSync(storePaths(neighbor).watermark, JSON.stringify(NEIGHBOR_WATERMARK) + "\n")
  // The lane's shared plumbing, imported lazily like the harness modules.
  const { mountRealWatchdog } = await import("./lib/watchdog-lane.ts")
  // The REAL watchdog dist mounted over the stub context, with the row's own thresholds.
  const mounted = await mountRealWatchdog({ workspace: ws, config: { warnSilenceMs: 60_000, tickIntervalMs: 5_000, warnStreakToEscalate: 2 } })
  // The watermark text before any acknowledge, kept for the record.
  const watermarkBeforeText = read(storePaths(ws).watermark)
  // The store tree's fingerprints before the arms ran.
  const storeBefore = hashTree(storePaths(ws).root)

  // The observation under construction: each surface arm is attached below, and an arm that does
  // not run stays absent, which is what makes the evaluator skip that arm's checks.
  const observed: NotifyObservation = { fallbackStated: "Without an acknowledge the replay is PERMANENT RE-DISPLAY BY DESIGN (the payload's `replay` flag and the on-screen line say so).", watermarkBeforeSha: sha256(watermarkBeforeText) }
  if (surface === "web" || surface === "both") {
    seedStore(ws) // each arm starts from the SAME seeded store (both readers present, neither acked)
    observed.web = await runWebArm(ws, neighbor)
  }
  if (surface === "tui" || surface === "both") {
    seedStore(ws)
    // Pin the language of the notice assertions without writing a host preference file.
    /** The previously chosen TUI locale for this process. */
    const previous = process.env.DSH_TUI_LANG
    process.env.DSH_TUI_LANG = "en"
    try {
      observed.tui = await runTuiArm(ws, neighbor, mounted)
    } finally {
      if (previous === undefined) delete process.env.DSH_TUI_LANG
      else process.env.DSH_TUI_LANG = previous
    }
  }
  observed.watermarkAfterSha = sha256(read(storePaths(ws).watermark))
  observed.watermarkBeforeText = watermarkBeforeText
  observed.watermarkAfterText = read(storePaths(ws).watermark)
  // The evaluator's verdict over the observation.
  const verdict = evaluate(observed)
  // The evidence document this run persists.
  const result: NotifyResult = {
    task: "AC-12 / AC-13 / AC-14 (notify: web banner+record+replay+ack, TUI status+dialog+watermark, both readers)",
    lane: SLUG,
    surface,
    readerKeys: { web: "web-panel", tui: "mpd-tui" },
    workspace: ws,
    storeFiles: { before: storeBefore, after: hashTree(storePaths(ws).root) },
    observed,
    checks: verdict.checks,
    ok: verdict.ok,
    notClaimed: [
      "No real browser render and no real TTY: the web arm asserts the RENDERED TREE through the offline hook runtime driving the REAL built client against the REAL route's payload; the TUI arm asserts the composed status value, the dialog request and the REAL watermark file (a keystroke drive is tui-panels' job).",
      "The fallback is stated, never hidden: without an acknowledge the replay is permanent re-display by design.",
    ],
  }
  result.evidenceFile = writeEvidence(dir, result, CAPTURE.lines)
  return result
}

/** Every line the run printed, captured so the same lines land in output.log. */
const CAPTURE: StdoutCapture = captureStdout()
// The raw command-line arguments, in the order the caller passed them.
const argv = process.argv.slice(2)
if (argv.includes("--self-test")) {
  CAPTURE.restore()
  // The synthetic healthy observation the evaluator must accept.
  const healthy: NotifyObservation = {
    watermarkBeforeSha: "aaa", watermarkAfterSha: "bbb",
    fallbackStated: "Without an acknowledge the replay is PERMANENT RE-DISPLAY BY DESIGN (stated).",
    web: {
      payload: { banner: { incidentId: "inc-1", kind: "held" }, stuck: true, replay: true, activity: [{ id: "inc-1", ackRequired: true, workspace: "/fixture" }] },
      incidentId: "inc-1", fetchedWithoutUserAction: 1, topChildAttr: "held", topChildIsBanner: true,
      recordCount: 1, recordId: "inc-1", ackAdvanced: true, watermarkAfter: { "web-panel": T1, "mpd-tui": 0 }, replayAfterAck: false, recordsAfterAck: 0,
      replayStoppedAfterAck: true, newIncidentReplays: true,
      selectedWorkspaceAndTime: true, neighborWatermark: { ...NEIGHBOR_WATERMARK }, replayAfterOldAck: ["inc-2"],
    },
    tui: {
      readerKey: "mpd-tui", unreadBefore: 1, noticeBefore: "watchdog: team notify-probe is held",
      dialogOptionIds: ["acknowledge", "dismiss"], composedLine: "saved to settings · watchdog: team notify-probe is held",
      bridgeNotice: "saved to settings", ackAdvanced: true, ackUpTo: T1, watermarkAfter: { "mpd-tui": T1, "web-panel": 0 }, unreadAfter: 0, noticeAfter: "watchdog: held notify-probe",
      dialogAfter: undefined, builtBytesWired: true, newIncidentNotice: "watchdog: held notify-probe · 1 unread incident",
      neighborWatermark: { ...NEIGHBOR_WATERMARK }, remainingAfterOldAck: [T2],
    },
  }
  // Every negative control mutates the HEALTHY fixture, which carries BOTH arms, so the non-null
  // assertions below cannot fire: they only spell that invariant for the checker.
  selfTest(SLUG, evaluate, healthy, [
    ["web-record-missing", (copy: NotifyObservation): void => { copy.web!.payload.activity = [] }, "a payload with no activity record"],
    ["web-not-top", (copy: NotifyObservation): void => { copy.web!.topChildIsBanner = false }, "a banner outside its expected rendered position"],
    ["web-no-first-poll", (copy: NotifyObservation): void => { copy.web!.fetchedWithoutUserAction = 0 }, "a replay that needed a user action"],
    ["web-ack-other-reader", (copy: NotifyObservation): void => { copy.web!.watermarkAfter["mpd-tui"] = T1 }, "an acknowledge that clobbered the OTHER reader's key"],
    ["web-replay-continues", (copy: NotifyObservation): void => { copy.web!.replayAfterAck = true; copy.web!.recordsAfterAck = 1 }, "a replay that survived the acknowledge"],
    ["web-wrong-workspace", (copy: NotifyObservation): void => { copy.web!.selectedWorkspaceAndTime = false }, "an acknowledgement with the wrong workspace or selected timestamp"],
    ["web-late-lost", (copy: NotifyObservation): void => { copy.web!.replayAfterOldAck = [] }, "a late incident hidden by an older Web acknowledgement"],
    ["tui-reader", (copy: NotifyObservation): void => { copy.tui!.readerKey = "web-panel" }, "a TUI front door using the web reader key"],
    ["tui-dialog", (copy: NotifyObservation): void => { copy.tui!.dialogOptionIds = ["dismiss"] }, "a dialog with no acknowledge action"],
    ["tui-compose", (copy: NotifyObservation): void => { copy.tui!.composedLine = "" }, "a notice that never reaches the status line"],
    ["tui-ack", (copy: NotifyObservation): void => { copy.tui!.watermarkAfter["mpd-tui"] = 0 }, "a TUI acknowledge that did not advance its watermark"],
    ["tui-ack-other", (copy: NotifyObservation): void => { copy.tui!.watermarkAfter["web-panel"] = copy.tui!.ackUpTo }, "a TUI acknowledge that clobbered the web reader's key"],
    ["tui-replay-continues", (copy: NotifyObservation): void => { copy.tui!.unreadAfter = 1 }, "a TUI replay that survived the acknowledge"],
    ["tui-wrong-workspace", (copy: NotifyObservation): void => { copy.tui!.neighborWatermark["mpd-tui"] = T3 }, "a dialog that wrote into the workspace selected after it opened"],
    ["tui-late-lost", (copy: NotifyObservation): void => { copy.tui!.remainingAfterOldAck = [] }, "a late incident hidden by an older TUI acknowledgement"],
    ["bytes", (copy: NotifyObservation): void => { copy.tui!.builtBytesWired = false }, "built TUI bytes with no notice/dialog wiring"],
    ["bytes-unchanged", (copy: NotifyObservation): void => { copy.watermarkAfterSha = copy.watermarkBeforeSha }, "a watermark file whose bytes never changed"],
    ["fallback-hidden", (copy: NotifyObservation): void => { copy.fallbackStated = "the replay stops" }, "a lane that hides the permanent-redisplay fallback"],
  ])
}
try {
  // The lane's result document, printed and persisted by `finish`.
  const result = await run(argv)
  CAPTURE.restore()
  finish(SLUG, result, CAPTURE.lines)
} catch (error) {
  CAPTURE.restore()
  // The thrown value is `unknown`: it is viewed as an error-like record so a plain-object throw
  // still reports its own `.stack`, exactly as that expression did before.
  say(SLUG, "CRASH: " + String((error as { stack?: unknown } | null)?.stack ?? error))
  process.exit(1)
}
