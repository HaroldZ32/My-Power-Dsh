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
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  PATHS, captureStdout, evidenceDir, finish, hashTree, read, sandboxWorkspace, say, selfTest, sha256, storePaths, writeEvidence,
} from "./lib/watchdog-lane.ts"
import type { LaneCheck, LaneResult, LaneVerdict, MountedWatchdog, StdoutCapture } from "./lib/watchdog-lane.ts"
import { exitOnRefusal, refuseOverwrite } from "./lib/immutable-output.ts"

/** The lane slug, which prefixes every printed line and names the evidence directory. */
const SLUG = "team-watchdog-notify"
/** The team id the seed store holds an incident and a hold for. */
const TEAM = "notify-probe"
/** The seed incident's timestamp (epoch ms) — also the watermark both acknowledges advance to. */
const T1 = 1_789_400_000_000
/** A second timestamp one minute later, used for the incidents appended mid-run. */
const T2 = T1 + 60_000

/** The banner half of the web payload (mirrors `WatchdogBanner`; only the incident id is asserted). */
interface WebBanner {
  /** The incident the banner names, `null` when the banner reports a bare hold. */
  incidentId: string | null
}

/** One activity record of the web payload (mirrors `WatchdogActivity`). */
interface WebActivity {
  /** The id of the incident the record stands for. */
  id: string
  /** Whether this reader still owes an acknowledge for it. */
  ackRequired: boolean
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
  /** The top banner's stuck marker as the RENDERED panel carries it. */
  renderedStuck: unknown
  /** The top child's `data-watchdog-banner` attribute value. */
  topChildAttr: unknown
  /** Whether the panel's FIRST rendered child is the banner. */
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
  /** Whether a SECOND unacknowledged incident replays again on the next start. */
  newIncidentReplays: boolean
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

/** The route module's consumed surface (`packages/mpd-bundle-plugin/src/watchdog-web.ts`). */
interface WebRouteModule {
  /**
   * @param options The roots, the state dir and the reader the payload is built for.
   * @returns The state payload the panel consumes.
   */
  buildWatchdogState(options: { roots: string[]; stateDir: string; reader: string }): WebPayload
  /**
   * @param webServer The host's route registrar.
   * @param deps The roots, state-dir and effect seams the routes are registered through.
   * @returns Which of the two routes registered.
   */
  registerWatchdogRoutes(
    webServer: { register: (route: { kind: string; path: string; handler: RouteHandler }) => unknown },
    deps: { roots: () => string[]; stateDir: () => string; effect: (fn: () => unknown) => unknown },
  ): { state: boolean; ack: boolean }
}

/** The minimal HTTP response double the REAL route handlers write into. */
interface FakeResponse {
  /** The status the handler wrote, 0 until it writes one. */
  status: number
  /** The body the handler wrote, "" until it writes one. */
  body: string
  /** @param status The HTTP status code the handler passes. */
  writeHead(status: number): void
  /** @param text The body text the handler passes. */
  end(text: string): void
}

/** The minimal HTTP request double: a URL plus the async-iterable body the route reads. */
interface FakeRequest {
  /** The request URL the handler parses its reader key from. */
  readonly url: string
  /** The request body as the async iterable the route's `for await` consumes. */
  [Symbol.asyncIterator](): AsyncGenerator<string>
}

/** One registered sidebar tab, as the harness records it. */
interface TabDescriptor {
  /** The tab's registration id, which the panel is looked up by. */
  readonly id: string
  /**
   * @param props The props the host hands the panel component.
   * @returns The rendered element record.
   */
  component(props: PanelProps): RenderedNode
}

/** The props the host hands the team page component. */
interface PanelProps {
  /** The harness context the page's effects resolve their services from. */
  ctx: unknown
  /** The session scope the tab was registered for. */
  scope: { sessionId: string }
  /** The tab descriptor the host handed the component. */
  tab: Record<string, unknown>
  /** Whether the panel is currently visible. */
  visible: boolean
}

/** One element record the hook runtime renders (only `type` and `props` are read here). */
interface RenderedNode {
  /** The component the element record points at. */
  type: (props: PanelProps) => RenderedNode
  /** The element's props, which every assertion reads through. */
  props: Record<string, unknown>
}

/** Everything the harness records about the client's own calls. */
interface HarnessCalls {
  /** Every sidebar tab the client registered, in order. */
  readonly registerTab: TabDescriptor[]
  /** Every fetch the client made through the harness. */
  readonly fetched: { readonly url: string; readonly method: string }[]
}

/** The offline harness over the built client, as this lane drives it. */
interface BundleHarness {
  /** The minimal cordis-like context the client factory is applied to. */
  readonly ctx: unknown
  /**
   * @param name The module name the client requires.
   * @returns The module the harness resolved for it.
   */
  require(name: string): unknown
  /** The canned fetch the drive installs over the global for the client's lifetime. */
  readonly fetchImpl: typeof globalThis.fetch
  /** Everything the client did through the harness. */
  readonly calls: HarnessCalls
  /** The hook runtime the panel component is rendered with. */
  readonly hooks: {
    /**
     * @param Component The component to render.
     * @param props The props it is rendered with.
     * @returns The settled element tree.
     */
    render(Component: (props: PanelProps) => RenderedNode, props: PanelProps): Promise<RenderedNode>
  }
  /**
   * Publish the sidebar service the way its own fiber does, after apply.
   * @returns Whether the service was published.
   */
  provideSidebar(): boolean
}

/** The offline hook harness module (`packages/mpd-bundle-plugin/test/client-harness.ts`). */
interface WebHarnessModule {
  /**
   * @param options The bundle-client factories and the canned fetch responses.
   * @returns The harness over that client.
   */
  createHarness(options: { factories: unknown; requestResponses: Record<string, unknown> }): BundleHarness
  /**
   * @returns The built client's registration factories.
   */
  loadBundleClient(): { factories: unknown }
}

/** The bundle-client module the harness requires for the sidebar plugin itself. */
interface MpdClientModule {
  /**
   * @param ctx The context the client plugin is applied to.
   */
  apply(ctx: unknown): void
}

/** The bundle-client module the harness requires for the team page. */
interface TeamPageModule {
  /** Re-poll the watchdog state the way the page's own poll does. */
  __watchdogPoll(): Promise<void>
  /** Reset the page's module-level state, so the next render starts clean. */
  __resetTeamPageForTests(): void
}

/** One incident record of the TUI view (only the timestamp is read here). */
interface TuiIncidentRecord {
  /** The incident's timestamp (epoch ms), which the acknowledge advances the watermark to. */
  readonly at: number
}

/** The durable state one TUI read observes. */
interface TuiWatchdogView {
  /** Team ids currently held by the watchdog. */
  readonly holds: readonly string[]
  /** Incidents this reader has not acknowledged yet. */
  readonly unread: readonly TuiIncidentRecord[]
}

/** The replay dialog request the TUI module builds. */
interface TuiWatchdogDialog {
  /** The dialog's title, carrying the notice text. */
  readonly title: string
  /** The choices the dialog offers. */
  readonly options: readonly { readonly id: string; readonly label: string }[]
}

/** The front-door facade the TUI module returns. */
interface TuiWatchdogFrontDoor {
  /**
   * @param upTo The incident timestamp to advance this reader's watermark to.
   * @returns Whether the acknowledge landed, and the watermark it reached.
   */
  acknowledge(upTo: number): { ok: boolean; watermark: number; error?: string }
}

/** The ctx slice the REAL front door reads (the stub context supplies exactly these five members). */
interface TuiFrontDoorContext {
  /** Soft service probe. */
  get: (name: string, strict?: boolean) => unknown
  /** Fiber-owned cleanup registration. */
  effect: (fn: () => unknown) => unknown
  /** Event subscription (unused by the front door, carried for shape fidelity). */
  on: (event: string, handler: (...args: unknown[]) => unknown) => unknown
  /** Deferred service resolution — the seam the front door's own `onService` drives. */
  inject: (dependencies: readonly string[], callback: (scoped: unknown) => void) => unknown
  /** The host logger. */
  logger: { warn(message: string): void; info(message: string): void; error(message: string): void; debug(message: string): void }
}

/** The diagnostics sink the front door writes through. */
interface TuiLog {
  /** Record a warning. */
  warn(message: string): void
  /** Record an informational line. */
  info(message: string): void
  /** Record a failure. */
  error(message: string): void
  /** Record a wiring detail. */
  debug(message: string): void
}

/** The dialog stand-in this lane hands the front door (the automatic replay is off, so it is unreached). */
interface TuiDialogStandIn {
  /** The choice the real dialog seam would return. */
  open: () => Promise<string>
}

/** The options this lane hands the REAL front door. */
interface TuiFrontDoorOptions {
  /** The workspace the front door reads its store from. */
  workspaceRoot: () => string
  /** The dialog stand-in. */
  dialogs: TuiDialogStandIn
  /** Keep the once-only automatic replay OFF for this drive. */
  replayOnAttach: boolean
  /** Counts the acknowledges the REAL service reported as landed. */
  onAcknowledged: () => void
}

/** The TUI module's consumed surface (`packages/mpd-tui-plugin/src/watchdog.ts`). */
interface TuiWatchdogModule {
  /** The reader key this front door owns. */
  readonly WATCHDOG_READER: string
  /** The prefix every notice starts with (asserted against the built bytes). */
  readonly WATCHDOG_NOTICE_PREFIX: string
  /** The dialog option id that acknowledges (asserted against the built bytes). */
  readonly ACKNOWLEDGE_OPTION: string
  /**
   * @param service The `mpdWatchdog` service, or `undefined` when the row is absent.
   * @param reader The reader key whose watermark decides "unread".
   * @param workspace The workspace to read.
   * @returns The durable view, all-empty when the service is absent or failing.
   */
  readWatchdogView(service: unknown, reader: string, workspace: string): TuiWatchdogView
  /**
   * @param view The view to describe.
   * @returns The status-line notice, or `undefined` when there is nothing to say.
   */
  watchdogNotice(view: TuiWatchdogView): string | undefined
  /**
   * @param view The view the dialog is built for.
   * @returns The replay dialog request.
   */
  watchdogDialog(view: TuiWatchdogView): TuiWatchdogDialog
  /**
   * @param notices The notice providers the status line composes, in call order.
   * @returns The composed status line, or `undefined` when none has anything to say.
   */
  composeNotices(...notices: readonly (string | undefined)[]): string | undefined
  /**
   * @param ctx The plugin context the front door resolves its seams from.
   * @param log The diagnostics sink.
   * @param options The workspace resolver, the dialog stand-in and the post-ack hook.
   * @returns The front-door facade.
   */
  attachWatchdogFrontDoor(ctx: TuiFrontDoorContext, log: TuiLog, options: TuiFrontDoorOptions): TuiWatchdogFrontDoor
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
    add("W4", web.topChildIsBanner === true, "the RENDERED panel's first child is the banner (stuck=" + JSON.stringify(web.renderedStuck) + ", topChild=" + JSON.stringify(web.topChildAttr) + ")")
    add("W5", web.recordCount === 1 && web.recordId === web.incidentId, "the rendered body carries exactly one record for that incident (" + JSON.stringify(web.recordCount) + ")")
    add("W6", web.ackAdvanced === true && web.watermarkAfter?.["web-panel"] === T1 && web.watermarkAfter?.["mpd-tui"] === 0,
      "the web acknowledge advanced ONLY its own reader key (web-panel → " + JSON.stringify(web.watermarkAfter?.["web-panel"]) + ", the TUI reader untouched at " + JSON.stringify(web.watermarkAfter?.["mpd-tui"]) + ")")
    add("W7", web.replayStoppedAfterAck === true && web.recordsAfterAck === 0,
      "after the acknowledge the web replay stops (replay=" + JSON.stringify(web.replayAfterAck) + ", records=" + JSON.stringify(web.recordsAfterAck) + ")")
    add("W8", web.newIncidentReplays === true, "a SECOND unacknowledged incident replays on the next start (permanent re-display by design)")
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
    add("T6", tui.unreadAfter === 0 && (tui.noticeAfter === undefined || !String(tui.noticeAfter).includes("unread")),
      "after acknowledging the whole replay the TUI reads NOTHING unread and its notice no longer replays incidents — it still shows the DURABLE hold, which is current state, not a replay (unread=" + JSON.stringify(tui.unreadAfter) + ", notice=" + JSON.stringify(tui.noticeAfter) + ")")
    add("T7", tui.builtBytesWired === true, "the BUILT TUI bytes carry the notice prefix, the reader key and the acknowledge option")
    add("T8", tui.newIncidentNotice !== undefined && String(tui.newIncidentNotice).includes("unread"),
      "a SECOND unacknowledged incident shows again on the next start (permanent re-display by design): " + JSON.stringify(tui.newIncidentNotice))
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

// ─────────────────────────────── web arm ───────────────────────────────
/**
 * Drive the REAL route handlers and the REAL built client over the seeded store.
 * @param ws Absolute path of the sandbox workspace.
 * @param dir The lane's evidence directory (unused by this arm, kept for call symmetry).
 * @returns The web arm's observed facts.
 */
async function runWebArm(ws: string, dir: string): Promise<WebArmObservation> {
  // The REAL route module, loaded by absolute path (a runtime path TS cannot resolve), so the
  // cast below names the two entries this arm consumes.
  const { buildWatchdogState, registerWatchdogRoutes } = await import(PATHS.webRoute) as WebRouteModule
  // The route table the registrar fills: path -> handler.
  const routes = new Map<string, RouteHandler>()
  // Which of the two routes registered (kept for the record; both are exercised below).
  const registered = registerWatchdogRoutes(
    { register: (route) => { routes.set(route.path, route.handler); return () => {} } },
    { roots: () => [ws], stateDir: () => join(".mpd", "team"), effect: (fn) => fn() },
  )
  // The minimal HTTP response double the REAL handlers write into.
  const fakeRes = (): FakeResponse => ({
    status: 0,
    body: "",
    /** @param status The HTTP status code the handler passes. */
    writeHead(status: number): void { this.status = status },
    /** @param text The body text the handler passes. */
    end(text: string): void { this.body = text },
  })
  // The minimal HTTP request double: the body is the async iterable the acknowledge reads.
  const fakeReq = (url: string, body?: unknown): FakeRequest => ({
    url,
    /** Yields the JSON body once when the caller passed one, which is all the routes' for-await reads. */
    async *[Symbol.asyncIterator](): AsyncGenerator<string> { if (body !== undefined) yield JSON.stringify(body) },
  })
  // The state route's URL, carrying this arm's reader key.
  const stateUrl = "/plugins/mpd-team-watchdog/state?reader=web-panel"
  // The acknowledge route's URL.
  const ackUrl = "/plugins/mpd-team-watchdog/ack"
  // The response the state handler writes into.
  const stateRes = fakeRes()
  // The state handler was registered above, so the lookup cannot come back empty.
  routes.get("/plugins/mpd-team-watchdog/state")!(fakeReq(stateUrl), stateRes)
  // The payload the REAL route produced for the panel's first poll: its own JSON body, which only
  // a cast can name (the handler answers with text).
  const payload = JSON.parse(stateRes.body) as WebPayload
  say(SLUG, "web: state route status=" + stateRes.status + " banner=" + JSON.stringify(payload.banner?.incidentId) + " replay=" + JSON.stringify(payload.replay))

  // The REAL built client, served by the payload the route just produced.
  // The offline hook harness module, loaded like the route; the cast names its two entries.
  const { createHarness, loadBundleClient } = await import(PATHS.webHarness) as WebHarnessModule
  // The built client's registration factories.
  const { factories } = loadBundleClient()
  // The canned responses the harness serves: the state route answers with the payload just produced.
  const responses: Record<string, unknown> = { [stateUrl]: payload }
  // The offline harness over the built client, with the canned fetch above.
  const harness = createHarness({ factories, requestResponses: responses })
  // The platform fetch the drive replaces for the client's lifetime.
  const savedFetch = globalThis.fetch
  globalThis.fetch = harness.fetchImpl
  harness.provideSidebar()
  // The client's own plugin surface: the harness resolves required modules as `unknown`, so the
  // cast names the one method this arm calls.
  const mpd = harness.require("@mpd-dsh/mpd") as MpdClientModule
  // The page module, resolved the same way, whose test hooks re-poll the state and reset the panel.
  const page = harness.require("@mpd-dsh/team-page") as TeamPageModule
  mpd.apply(harness.ctx)
  // The tab the client registered for the team panel; `apply` above registers it, so it is present.
  const tab = harness.calls.registerTab.find((descriptor) => descriptor.id === "mpd-agent-teams")!
  // The props the host hands the panel component.
  const props: PanelProps = { ctx: harness.ctx, scope: { sessionId: "s1" }, tab: {}, visible: true }
  // The panel element the tab's component returns for those props.
  const element = tab.component(props)
  // The panel's first settled render, which must carry the banner and one record.
  const first = await harness.hooks.render(element.type, props)
  // The children of one rendered node, nullish entries dropped; the cast states that the hook
  // runtime builds every child as an element record, which is all this arm reads.
  const children = (tree: RenderedNode): RenderedNode[] => (Array.isArray(tree.props.children) ? tree.props.children.filter((child) => child !== null && child !== undefined) : [tree.props.children]) as RenderedNode[]
  /**
   * @param node The node to inspect.
   * @param attr The attribute name to match.
   * @param out The accumulator the matches are pushed into.
   * @returns Every node carrying that attribute, in traversal order.
   */
  const findByAttr = (node: RenderedNode, attr: string, out: RenderedNode[] = []): RenderedNode[] => {
    if (node === null || typeof node !== "object") return out
    if (node.props && node.props[attr] !== undefined) out.push(node)
    for (const child of children(node)) findByAttr(child, attr, out)
    return out
  }
  // The panel's first rendered child, which must be the banner.
  const topChild = children(first)[0]
  // Every rendered activity record.
  const records = findByAttr(first, "data-watchdog-activity")
  // How many of the panel's own fetches hit the state route with no user action.
  const fetchedWithoutUserAction = harness.calls.fetched.filter((entry) => entry.url === stateUrl).length

  // The watermark file as it stood before the acknowledge.
  const wmBefore = read(storePaths(ws).watermark)
  // The response the acknowledge handler writes into.
  const ackRes = fakeRes()
  // The acknowledge handler was registered above, so the lookup cannot come back empty.
  await routes.get(ackUrl)!(fakeReq(ackUrl, { reader: "web-panel", incidentTs: T1, workspace: ws }), ackRes)
  // The watermark document right after the web acknowledge: a JSON file, which only a cast can type.
  const wmAfterWeb = JSON.parse(read(storePaths(ws).watermark)) as Record<string, number>
  // The payload the state route produces once the acknowledge landed (again its JSON body).
  const afterAck = JSON.parse((() => {
    // The response the second state read writes into; the handler was registered above.
    const res = fakeRes(); routes.get("/plugins/mpd-team-watchdog/state")!(fakeReq(stateUrl), res); return res.body
  })()) as WebPayload
  responses[stateUrl] = afterAck
  await page.__watchdogPoll()
  // The panel's tree after the re-poll, whose record count must be zero.
  const second = await harness.hooks.render(element.type, props)
  // How many activity records the re-polled panel renders.
  const recordsAfterAck = findByAttr(second, "data-watchdog-activity").length
  appendIncident(ws, { id: "inc-2", teamId: TEAM, kind: "warn", at: T2, cause: { kind: "silence", ms: 90000 }, taskId: "t10", attemptId: "att-2", scene: null, hold: "not-requested", acknowledgedBy: [] })
  // The payload built straight from the store for the SECOND incident; the REAL payload always
  // carries `unread`, which is the single field the non-null assertion below relies on.
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
    newIncidentReplays: newPayload.unread!.length === 1 && newPayload.banner?.incidentId === "inc-2",
  }
}

// ─────────────────────────────── TUI arm ───────────────────────────────
/**
 * Drive the REAL TUI module over the mounted `mpdWatchdog` service.
 * @param ws Absolute path of the sandbox workspace.
 * @param dir The lane's evidence directory (unused by this arm, kept for call symmetry).
 * @param mounted The mounted watchdog harness whose service this arm reads.
 * @returns The TUI arm's observed facts.
 */
async function runTuiArm(ws: string, dir: string, mounted: MountedWatchdog): Promise<TuiArmObservation> {
  // The REAL TUI module, loaded by absolute path (a runtime path TS cannot resolve), so the
  // cast below names the consumed surface.
  const tui = await import(PATHS.tuiWatchdog) as TuiWatchdogModule
  // The `mpdWatchdog` service the mounted row published.
  const service = mounted.services.get("mpdWatchdog")
  // The reader key this front door owns.
  const reader = tui.WATCHDOG_READER
  // The durable view before the acknowledge.
  const viewBefore = tui.readWatchdogView(service, reader, ws)
  // The status-line notice composed before the acknowledge.
  const noticeBefore = tui.watchdogNotice(viewBefore)
  // The replay dialog the front door would offer before the acknowledge.
  const dialogBefore = tui.watchdogDialog(viewBefore)
  // The bridge's own notice, which the README's status line composes beside the watchdog's.
  const bridgeNotice = "saved to settings"
  // The status line the TUI renders, with both notices composed.
  const composedLine = tui.composeNotices(bridgeNotice, noticeBefore)
  say(SLUG, "tui: reader=" + reader + " unread=" + viewBefore.unread.length + " notice=" + JSON.stringify(noticeBefore))

  // How many times the post-acknowledge hook ran.
  let acknowledged = 0
  // The REAL front door, attached over the stub context, the stub logger and a dialog stand-in.
  const frontDoor = tui.attachWatchdogFrontDoor(
    { get: mounted.ctx.get, effect: mounted.ctx.effect, on: mounted.ctx.on, inject: mounted.ctx.inject, logger: mounted.ctx.logger },
    { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
    { workspaceRoot: () => ws, dialogs: { open: async () => "acknowledge" }, replayOnAttach: false, onAcknowledged: () => { acknowledged += 1 } },
  )
  // The newest unread incident timestamp, i.e. the watermark the acknowledge advances to.
  const ackUpTo = viewBefore.unread.reduce((max, record) => Math.max(max, record.at ?? 0), 0)
  // What the REAL service reported for that acknowledge.
  const ackResult = frontDoor.acknowledge(ackUpTo)
  // The watermark document read back after the acknowledge: a JSON file, which only a cast can type.
  const wmAfter = JSON.parse(read(storePaths(ws).watermark)) as Record<string, number>
  // The durable view after the acknowledge: nothing should be unread any more.
  const viewAfter = tui.readWatchdogView(service, reader, ws)
  appendIncident(ws, { id: "inc-3", teamId: TEAM, kind: "warn", at: T2 + 1000, cause: { kind: "silence", ms: 90000 }, taskId: "t11", attemptId: "att-3", scene: null, hold: "not-requested", acknowledgedBy: [] })
  // The durable view once a SECOND unacknowledged incident exists.
  const viewNext = tui.readWatchdogView(service, reader, ws)
  // The built TUI dist's bytes, which the wiring assertion reads.
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
  seedStore(ws)
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
    observed.web = await runWebArm(ws, dir)
  }
  if (surface === "tui" || surface === "both") {
    seedStore(ws)
    observed.tui = await runTuiArm(ws, dir, mounted)
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
  // Every negative control mutates the HEALTHY fixture, which carries BOTH arms, so the non-null
  // assertions below cannot fire: they only spell that invariant for the checker.
  selfTest(SLUG, evaluate, healthy, [
    ["web-record-missing", (copy: NotifyObservation): void => { copy.web!.payload.activity = [] }, "a payload with no activity record"],
    ["web-not-top", (copy: NotifyObservation): void => { copy.web!.topChildIsBanner = false }, "a banner that is not the panel's first child"],
    ["web-no-first-poll", (copy: NotifyObservation): void => { copy.web!.fetchedWithoutUserAction = 0 }, "a replay that needed a user action"],
    ["web-ack-other-reader", (copy: NotifyObservation): void => { copy.web!.watermarkAfter["mpd-tui"] = T1 }, "an acknowledge that clobbered the OTHER reader's key"],
    ["web-replay-continues", (copy: NotifyObservation): void => { copy.web!.replayAfterAck = true; copy.web!.recordsAfterAck = 1 }, "a replay that survived the acknowledge"],
    ["tui-reader", (copy: NotifyObservation): void => { copy.tui!.readerKey = "web-panel" }, "a TUI front door using the web reader key"],
    ["tui-dialog", (copy: NotifyObservation): void => { copy.tui!.dialogOptionIds = ["dismiss"] }, "a dialog with no acknowledge action"],
    ["tui-compose", (copy: NotifyObservation): void => { copy.tui!.composedLine = "" }, "a notice that never reaches the status line"],
    ["tui-ack", (copy: NotifyObservation): void => { copy.tui!.watermarkAfter["mpd-tui"] = 0 }, "a TUI acknowledge that did not advance its watermark"],
    ["tui-ack-other", (copy: NotifyObservation): void => { copy.tui!.watermarkAfter["web-panel"] = copy.tui!.ackUpTo }, "a TUI acknowledge that clobbered the web reader's key"],
    ["tui-replay-continues", (copy: NotifyObservation): void => { copy.tui!.unreadAfter = 1 }, "a TUI replay that survived the acknowledge"],
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
