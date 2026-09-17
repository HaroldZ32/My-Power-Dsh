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
//   bun skills/dsh-qa/scripts/team-watchdog-notify.mjs --self-test
//   bun skills/dsh-qa/scripts/team-watchdog-notify.mjs --surface web|tui|both [--out <dir>]
// Evidence -> evidence/team-watchdog/lanes/<timestamp>-notify-<surface>/{result.json,output.log,raw/}
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  PATHS, captureStdout, evidenceDir, finish, hashTree, read, sandboxWorkspace, say, selfTest, sha256, storePaths, writeEvidence,
} from "./lib/watchdog-lane.mjs"
import { exitOnRefusal, refuseOverwrite } from "./lib/immutable-output.mjs"

const SLUG = "team-watchdog-notify"
const TEAM = "notify-probe"
const T1 = 1_789_400_000_000
const T2 = T1 + 60_000

/** The pure evaluator over both arms' observed facts. */
export function evaluate(observed) {
  const checks = []
  const add = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail: String(detail) })

  if (observed.web !== undefined) {
    const web = observed.web
    add("W1", web.payload?.banner?.incidentId === web.incidentId && web.payload?.stuck === true && web.payload?.replay === true,
      "the web payload's banner names the unacknowledged incident and marks the replay (" + JSON.stringify({ banner: web.payload?.banner?.incidentId, replay: web.payload?.replay }) + ")")
    add("W2", Array.isArray(web.payload?.activity) && web.payload.activity.length === 1 && web.payload.activity[0].ackRequired === true,
      "ONE activity record rides the payload the panel consumes (" + JSON.stringify(web.payload?.activity?.length) + ")")
    add("W3", web.fetchedWithoutUserAction >= 1, "the panel's FIRST poll fetches the route with no user action (" + String(web.fetchedWithoutUserAction) + " fetch(es))")
    add("W4", web.topChildIsBanner === true, "the RENDERED panel's first child is the banner (stuck=" + JSON.stringify(web.renderedStuck) + ", topChild=" + JSON.stringify(web.topChildAttr) + ")")
    add("W5", web.recordCount === 1 && web.recordId === web.incidentId, "the rendered body carries exactly one record for that incident (" + JSON.stringify(web.recordCount) + ")")
    add("W6", web.ackAdvanced === true && web.watermarkAfter?.["web-panel"] === T1 && web.watermarkAfter?.["mpd-tui"] === 0,
      "the web acknowledge advanced ONLY its own reader key (web-panel → " + JSON.stringify(web.watermarkAfter?.["web-panel"]) + ", the TUI reader untouched at " + JSON.stringify(web.watermarkAfter?.["mpd-tui"]) + ")")
    add("W7", web.replayStoppedAfterAck === true && web.recordsAfterAck === 0,
      "after the acknowledge the web replay stops (replay=" + JSON.stringify(web.replayAfterAck) + ", records=" + JSON.stringify(web.recordsAfterAck) + ")")
    add("W8", web.newIncidentReplays === true, "a SECOND unacknowledged incident replays on the next start (permanent re-display by design)")
  }

  if (observed.tui !== undefined) {
    const tui = observed.tui
    add("T1", tui.readerKey === "mpd-tui", "the TUI front door owns the reader key mpd-tui (" + JSON.stringify(tui.readerKey) + ")")
    add("T2", tui.unreadBefore >= 1 && tui.noticeBefore !== undefined && tui.noticeBefore.includes("watchdog"),
      "the TUI status notice is composed while an incident is unread (" + JSON.stringify(tui.noticeBefore) + ")")
    add("T3", tui.composedLine === (tui.bridgeNotice === undefined ? tui.noticeBefore : tui.bridgeNotice + " · " + tui.noticeBefore) || String(tui.composedLine).includes(String(tui.noticeBefore)),
      "the notice reaches the COMPOSED status line the TUI renders (" + JSON.stringify(tui.composedLine) + ")")
    add("T4", tui.dialogOptionIds?.includes("acknowledge") === true, "the replay dialog offers the acknowledge action (" + JSON.stringify(tui.dialogOptionIds) + ")")
    add("T5", tui.ackAdvanced === true && tui.watermarkAfter?.[tui.readerKey] === tui.ackUpTo && tui.watermarkAfter?.["web-panel"] === 0,
      "the TUI acknowledge advanced the mpd-tui watermark through the REAL service up to " + JSON.stringify(tui.ackUpTo) + ", leaving the web reader's key untouched (" + JSON.stringify(tui.watermarkAfter) + ")")
    add("T6", tui.unreadAfter === 0 && (tui.noticeAfter === undefined || !String(tui.noticeAfter).includes("unread")),
      "after acknowledging the whole replay the TUI reads NOTHING unread and its notice no longer replays incidents — it still shows the DURABLE hold, which is current state, not a replay (unread=" + JSON.stringify(tui.unreadAfter) + ", notice=" + JSON.stringify(tui.noticeAfter) + ")")
    add("T7", tui.builtBytesWired === true, "the BUILT TUI bytes carry the notice prefix, the reader key and the acknowledge option")
    add("T8", tui.newIncidentNotice !== undefined && String(tui.newIncidentNotice).includes("unread"),
      "a SECOND unacknowledged incident shows again on the next start (permanent re-display by design): " + JSON.stringify(tui.newIncidentNotice))
  }

  add("N1", (observed.watermarkBeforeSha !== observed.watermarkAfterSha) === true, "the watermark file's BYTES changed across the acknowledges (" + String(observed.watermarkBeforeSha).slice(0, 12) + " → " + String(observed.watermarkAfterSha).slice(0, 12) + ")")
  const fallback = observed.fallbackStated
  add("N2", typeof fallback === "string" && fallback.toLowerCase().includes("permanent re-display") && fallback.toLowerCase().includes("by design"),
    "the honest fallback is stated verbatim in the result: " + JSON.stringify(fallback))
  return { ok: checks.length > 0 && checks.every((check) => check.ok), checks }
}

function seedStore(ws) {
  const paths = storePaths(ws)
  mkdirSync(paths.holdDir, { recursive: true })
  mkdirSync(paths.scene(TEAM), { recursive: true })
  writeFileSync(paths.hold(TEAM), JSON.stringify({ id: "hold-notify-1", teamId: TEAM, since: T1, cause: "silence 120000 ms", taskId: "t9", attemptId: "att-1", sceneAt: T1 }, null, 2) + "\n")
  writeFileSync(paths.incidents, JSON.stringify({ id: "inc-1", teamId: TEAM, kind: "escalate", at: T1, cause: { kind: "silence", ms: 120000 }, taskId: "t9", attemptId: "att-1", scene: null, hold: "applied", acknowledgedBy: [] }) + "\n")
  writeFileSync(paths.scenePointer(TEAM), JSON.stringify({ at: T1, cause: "silence" }) + "\n")
  writeFileSync(paths.watermark, JSON.stringify({ "mpd-tui": 0, "web-panel": 0 }, null, 2) + "\n")
}
function appendIncident(ws, record) {
  writeFileSync(storePaths(ws).incidents, JSON.stringify(record) + "\n", { flag: "a" })
}

// ─────────────────────────────── web arm ───────────────────────────────
async function runWebArm(ws, dir) {
  const { buildWatchdogState, registerWatchdogRoutes } = await import(PATHS.webRoute)
  const routes = new Map()
  const registered = registerWatchdogRoutes(
    { register: (route) => { routes.set(route.path, route.handler); return () => {} } },
    { roots: () => [ws], stateDir: () => join(".mpd", "team"), effect: (fn) => fn() },
  )
  const fakeRes = () => ({ status: 0, body: "", writeHead(status) { this.status = status }, end(text) { this.body = text } })
  const fakeReq = (url, body) => ({ url, async *[Symbol.asyncIterator]() { if (body !== undefined) yield JSON.stringify(body) } })
  const stateUrl = "/plugins/mpd-team-watchdog/state?reader=web-panel"
  const ackUrl = "/plugins/mpd-team-watchdog/ack"
  const stateRes = fakeRes()
  routes.get("/plugins/mpd-team-watchdog/state")(fakeReq(stateUrl), stateRes)
  const payload = JSON.parse(stateRes.body)
  say(SLUG, "web: state route status=" + stateRes.status + " banner=" + JSON.stringify(payload.banner?.incidentId) + " replay=" + JSON.stringify(payload.replay))

  // The REAL built client, served by the payload the route just produced.
  const { createHarness, loadBundleClient } = await import(PATHS.webHarness)
  const { factories } = loadBundleClient()
  const responses = { [stateUrl]: payload }
  const harness = createHarness({ factories, requestResponses: responses })
  const savedFetch = globalThis.fetch
  globalThis.fetch = harness.fetchImpl
  harness.provideSidebar()
  const mpd = harness.require("@mpd-dsh/mpd")
  const page = harness.require("@mpd-dsh/team-page")
  mpd.apply(harness.ctx)
  const tab = harness.calls.registerTab.find((descriptor) => descriptor.id === "mpd-agent-teams")
  const props = { ctx: harness.ctx, scope: { sessionId: "s1" }, tab: {}, visible: true }
  const element = tab.component(props)
  const first = await harness.hooks.render(element.type, props)
  const children = (tree) => (Array.isArray(tree.props.children) ? tree.props.children.filter((child) => child !== null && child !== undefined) : [tree.props.children])
  const findByAttr = (node, attr, out = []) => {
    if (node === null || typeof node !== "object") return out
    if (node.props && node.props[attr] !== undefined) out.push(node)
    for (const child of children(node)) findByAttr(child, attr, out)
    return out
  }
  const topChild = children(first)[0]
  const records = findByAttr(first, "data-watchdog-activity")
  const fetchedWithoutUserAction = harness.calls.fetched.filter((entry) => entry.url === stateUrl).length

  const wmBefore = read(storePaths(ws).watermark)
  const ackRes = fakeRes()
  await routes.get(ackUrl)(fakeReq(ackUrl, { reader: "web-panel", incidentTs: T1, workspace: ws }), ackRes)
  const wmAfterWeb = JSON.parse(read(storePaths(ws).watermark))
  const afterAck = JSON.parse((() => { const res = fakeRes(); routes.get("/plugins/mpd-team-watchdog/state")(fakeReq(stateUrl), res); return res.body })())
  responses[stateUrl] = afterAck
  await page.__watchdogPoll()
  const second = await harness.hooks.render(element.type, props)
  const recordsAfterAck = findByAttr(second, "data-watchdog-activity").length
  appendIncident(ws, { id: "inc-2", teamId: TEAM, kind: "warn", at: T2, cause: { kind: "silence", ms: 90000 }, taskId: "t10", attemptId: "att-2", scene: null, hold: "not-requested", acknowledgedBy: [] })
  const newPayload = buildWatchdogState({ roots: [ws], stateDir: join(".mpd", "team"), reader: "web-panel" })
  globalThis.fetch = savedFetch
  page.__resetTeamPageForTests()
  return {
    payload, incidentId: "inc-1", fetchedWithoutUserAction,
    renderedStuck: first.props["data-watchdog-stuck"], topChildAttr: topChild.props["data-watchdog-banner"],
    topChildIsBanner: topChild.props["data-watchdog-banner"] === "incident",
    recordCount: records.length, recordId: records[0]?.props["data-watchdog-activity"],
    ackAdvanced: ackRes.status === 200 && JSON.parse(ackRes.body).after === T1,
    watermarkAfter: wmAfterWeb, replayAfterAck: afterAck.replay, recordsAfterAck,
    replayStoppedAfterAck: afterAck.replay === false && recordsAfterAck === 0,
    newIncidentReplays: newPayload.unread.length === 1 && newPayload.banner?.incidentId === "inc-2",
  }
}

// ─────────────────────────────── TUI arm ───────────────────────────────
async function runTuiArm(ws, dir, mounted) {
  const tui = await import(PATHS.tuiWatchdog)
  const service = mounted.services.get("mpdWatchdog")
  const reader = tui.WATCHDOG_READER
  const viewBefore = tui.readWatchdogView(service, reader, ws)
  const noticeBefore = tui.watchdogNotice(viewBefore)
  const dialogBefore = tui.watchdogDialog(viewBefore)
  const bridgeNotice = "saved to settings"
  const composedLine = tui.composeNotices(bridgeNotice, noticeBefore)
  say(SLUG, "tui: reader=" + reader + " unread=" + viewBefore.unread.length + " notice=" + JSON.stringify(noticeBefore))

  let acknowledged = 0
  const frontDoor = tui.attachWatchdogFrontDoor(
    { get: mounted.ctx.get, effect: mounted.ctx.effect, on: mounted.ctx.on, inject: mounted.ctx.inject, logger: mounted.ctx.logger },
    { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
    { workspaceRoot: () => ws, dialogs: { open: async () => "acknowledge" }, replayOnAttach: false, onAcknowledged: () => { acknowledged += 1 } },
  )
  const ackUpTo = viewBefore.unread.reduce((max, record) => Math.max(max, record.at ?? 0), 0)
  const ackResult = frontDoor.acknowledge(ackUpTo)
  const wmAfter = JSON.parse(read(storePaths(ws).watermark))
  const viewAfter = tui.readWatchdogView(service, reader, ws)
  appendIncident(ws, { id: "inc-3", teamId: TEAM, kind: "warn", at: T2 + 1000, cause: { kind: "silence", ms: 90000 }, taskId: "t11", attemptId: "att-3", scene: null, hold: "not-requested", acknowledgedBy: [] })
  const viewNext = tui.readWatchdogView(service, reader, ws)
  const dist = read(PATHS.tuiDist)
  return {
    readerKey: reader,
    unreadBefore: viewBefore.unread.length,
    noticeBefore,
    dialogOptionIds: (dialogBefore.options ?? []).map((option) => option.id),
    composedLine,
    bridgeNotice,
    ackUpTo,
    ackAdvanced: ackResult?.ok === true && ackResult.watermark === ackUpTo,
    acknowledgedHook: acknowledged,
    watermarkAfter: wmAfter,
    unreadAfter: viewAfter.unread.length,
    noticeAfter: tui.watchdogNotice(viewAfter),
    dialogAfter: viewAfter.unread.length > 0 ? tui.watchdogDialog(viewAfter) : undefined,
    newIncidentNotice: tui.watchdogNotice(viewNext),
    builtBytesWired: dist.includes(tui.WATCHDOG_NOTICE_PREFIX) && dist.includes(reader) && dist.includes(tui.ACKNOWLEDGE_OPTION),
  }
}

async function run(argv) {
  const surfaceAt = argv.indexOf("--surface")
  const surface = surfaceAt >= 0 ? String(argv[surfaceAt + 1]) : "both"
  const dir = evidenceDir(argv, "notify-" + surface)
  // T-83: the evidence target is IMMUTABLE BY DEFAULT — a caller-supplied --out that already exists
  // is refused instead of being rewritten (the T-63/T-76 class: a re-run must never overwrite a record).
  try {
    refuseOverwrite(dir, { label: "evidence directory", remedy: "pass a new --out <dir>, or omit --out for a fresh timestamped directory (T-53)" })
  } catch (error) {
    exitOnRefusal(error, "[" + SLUG + "]")
  }
  const ws = sandboxWorkspace(dir, "notify")
  seedStore(ws)
  const { mountRealWatchdog } = await import("./lib/watchdog-lane.mjs")
  const mounted = await mountRealWatchdog({ workspace: ws, config: { warnSilenceMs: 60_000, tickIntervalMs: 5_000, warnStreakToEscalate: 2 } })
  const watermarkBeforeText = read(storePaths(ws).watermark)
  const storeBefore = hashTree(storePaths(ws).root)

  const observed = { fallbackStated: "Without an acknowledge the replay is PERMANENT RE-DISPLAY BY DESIGN (the payload's `replay` flag and the on-screen line say so).", watermarkBeforeSha: sha256(watermarkBeforeText) }
  if (surface === "web" || surface === "both") {
    seedStore(ws) // each arm starts from the SAME seeded store (both readers present, neither acked)
    observed.web = await runWebArm(ws, dir)
  }
  if (surface === "tui" || surface === "both") {
    seedStore(ws)
    observed.tui = await runTuiArm(ws, dir, mounted)
  }
  observed.watermarkAfterSha = sha256(read(storePaths(ws).watermark))
  observed.watermarkBeforeText = watermarkBeforeText
  observed.watermarkAfterText = read(storePaths(ws).watermark)
  const verdict = evaluate(observed)
  const result = {
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

const CAPTURE = captureStdout()
const argv = process.argv.slice(2)
if (argv.includes("--self-test")) {
  CAPTURE.restore()
  const healthy = {
    watermarkBeforeSha: "aaa", watermarkAfterSha: "bbb",
    fallbackStated: "Without an acknowledge the replay is PERMANENT RE-DISPLAY BY DESIGN (stated).",
    web: {
      payload: { banner: { incidentId: "inc-1" }, stuck: true, replay: true, activity: [{ id: "inc-1", ackRequired: true }] },
      incidentId: "inc-1", fetchedWithoutUserAction: 1, renderedStuck: "1", topChildAttr: "incident", topChildIsBanner: true,
      recordCount: 1, recordId: "inc-1", ackAdvanced: true, watermarkAfter: { "web-panel": T1, "mpd-tui": 0 }, replayAfterAck: false, recordsAfterAck: 0,
      replayStoppedAfterAck: true, newIncidentReplays: true,
    },
    tui: {
      readerKey: "mpd-tui", unreadBefore: 1, noticeBefore: "watchdog: team notify-probe is held",
      dialogOptionIds: ["acknowledge", "dismiss"], composedLine: "saved to settings · watchdog: team notify-probe is held",
      bridgeNotice: "saved to settings", ackAdvanced: true, ackUpTo: T1, watermarkAfter: { "mpd-tui": T1, "web-panel": 0 }, unreadAfter: 0, noticeAfter: "watchdog: held notify-probe",
      dialogAfter: undefined, builtBytesWired: true, newIncidentNotice: "watchdog: held notify-probe · 1 unread incident",
    },
  }
  selfTest(SLUG, evaluate, healthy, [
    ["web-record-missing", (copy) => { copy.web.payload.activity = [] }, "a payload with no activity record"],
    ["web-not-top", (copy) => { copy.web.topChildIsBanner = false }, "a banner that is not the panel's first child"],
    ["web-no-first-poll", (copy) => { copy.web.fetchedWithoutUserAction = 0 }, "a replay that needed a user action"],
    ["web-ack-other-reader", (copy) => { copy.web.watermarkAfter["mpd-tui"] = T1 }, "an acknowledge that clobbered the OTHER reader's key"],
    ["web-replay-continues", (copy) => { copy.web.replayAfterAck = true; copy.web.recordsAfterAck = 1 }, "a replay that survived the acknowledge"],
    ["tui-reader", (copy) => { copy.tui.readerKey = "web-panel" }, "a TUI front door using the web reader key"],
    ["tui-dialog", (copy) => { copy.tui.dialogOptionIds = ["dismiss"] }, "a dialog with no acknowledge action"],
    ["tui-compose", (copy) => { copy.tui.composedLine = "" }, "a notice that never reaches the status line"],
    ["tui-ack", (copy) => { copy.tui.watermarkAfter["mpd-tui"] = 0 }, "a TUI acknowledge that did not advance its watermark"],
    ["tui-ack-other", (copy) => { copy.tui.watermarkAfter["web-panel"] = copy.tui.ackUpTo }, "a TUI acknowledge that clobbered the web reader's key"],
    ["tui-replay-continues", (copy) => { copy.tui.unreadAfter = 1 }, "a TUI replay that survived the acknowledge"],
    ["bytes", (copy) => { copy.tui.builtBytesWired = false }, "built TUI bytes with no notice/dialog wiring"],
    ["bytes-unchanged", (copy) => { copy.watermarkAfterSha = copy.watermarkBeforeSha }, "a watermark file whose bytes never changed"],
    ["fallback-hidden", (copy) => { copy.fallbackStated = "the replay stops" }, "a lane that hides the permanent-redisplay fallback"],
  ])
}
try {
  const result = await run(argv)
  CAPTURE.restore()
  finish(SLUG, result, CAPTURE.lines)
} catch (error) {
  CAPTURE.restore()
  say(SLUG, "CRASH: " + String(error?.stack ?? error))
  process.exit(1)
}
