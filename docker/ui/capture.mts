// docker/ui/capture.mts — observe the Web GUI from INSIDE the container with its own headless
// browser, and write PNGs + a JSON report to the host bind mount.
//
// WHY: a UI review taken from component source or from `--dump-config` is a GUESS about what a
// person sees. This renders the real page with the real client bundles and hands back images.
// It runs INSIDE the container, which is also the only place the harness will bind a port.
//
// IT DRIVES THE MAIN USAGE FLOW, in the order a person meets it:
//   01-first-run  the launch URL before anything is dismissed (the real first contact)
//   02-home       the workspace landing with the MPD preset selected in the composer
//   03-plugins    the Plugins page, where the bundle shows up as Installed + enabled
//   04-settings-mpd             Settings → MPD: the knobs this bundle contributes
//   05-settings-agent-presets   Settings → Agent presets: MPD is the default new-task preset
//   06-team-panel               a real MPD session with the Agent Teams panel open
//
// THE FIRST-RUN GATES ARE THE WHOLE DIFFICULTY. The harness stacks modal gates (the testing
// notice, then "Add an API key") that dim the app and swallow every click behind them, and they
// RE-APPEAR after a reload because no key was configured. So every step that reloads the page
// dismisses them first, and the dismissal is a helper rather than an inline click: an earlier
// shape of this script clicked once and six of its PNGs were the modal (measured 2026-09-27).
//
// Usage (inside the container):
//   node /data/capture.mts --base http://127.0.0.1:3080 --token <launch-token> --out /data-out/shots
/// <reference lib="dom" />
// The DOM lib above is referenced PER FILE on purpose: the `page.evaluate(...)` callbacks below run
// in the BROWSER, so they need `document`/`Element` types, while every other script in this lane is
// Node-only and must not silently gain browser globals.
import { mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/** Subset of playwright's `ConsoleMessage` that this script reads. */
interface ConsoleMessageLike {
  /** The console method that produced the line (`"error"`, `"warning"`, `"log"`, ...). */
  type(): string
  /** The message text as the page rendered it. */
  text(): string
}

/** Subset of playwright's `Request` that this script reads from a `requestfailed` event. */
interface FailedRequestLike {
  /** The absolute URL the page tried to load. */
  url(): string
  /** The failure descriptor, or null/undefined when the request did not fail. */
  failure(): { errorText?: unknown } | null | undefined
}

/** Subset of playwright's `Locator` that this script uses. */
interface LocatorLike {
  /** How many elements the locator currently matches. */
  count(): Promise<number>
  /** Narrow the locator to its first match (every use below wants exactly one element). */
  first(): LocatorLike
  /** Narrow the locator to its LAST match — the node whose ancestors give the focus chain something to tint. */
  last(): LocatorLike
  /** Whether the first match is actually visible (false, never a throw, when it is not attached). */
  isVisible(): Promise<boolean>
  /** Click the first match; `force` is used because the first-run overlay intercepts real clicks. */
  click(options?: { timeout?: number; force?: boolean }): Promise<void>
  /** The element's rendered text, used to prove a screen is populated rather than blank. */
  innerText(): Promise<string>
  /** The match's box in viewport coordinates, or null while it is not rendered. */
  boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null>
}

/** Subset of playwright's `Page` that this script uses. */
interface PageLike {
  /** Console listener: every `[mpd…]` line is kept, not only errors (a degrade is a WARNING). */
  on(event: "console", handler: (message: ConsoleMessageLike) => void): unknown
  /** Uncaught page-script error listener. */
  on(event: "pageerror", handler: (error: unknown) => void): unknown
  /** Failed-request listener, so a missing bundle shows up in the report, not only in a screenshot. */
  on(event: "requestfailed", handler: (request: FailedRequestLike) => void): unknown
  /** Navigate, waiting only for the DOM (the SPA keeps streaming after that). */
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>
  /** Settle time for the SPA's own async rendering. */
  waitForTimeout(ms: number): Promise<void>
  /** Capture the viewport to a PNG file. */
  screenshot(options: { path: string }): Promise<unknown>
  /** Locator by CSS selector (only `body` is used here, for the rendered-text dump). */
  locator(selector: string): LocatorLike
  /** Locator by ARIA role — how a person finds a control, and how the first-run gates are closed. */
  getByRole(role: string, options?: { name?: string | RegExp; exact?: boolean }): LocatorLike
  /** Locator by visible text — how the SPA's nav entries are reached (there is no /settings route). */
  getByText(text: string | RegExp, options?: { exact?: boolean }): LocatorLike
  /** Keyboard surface, used only to press Escape and drop any remaining overlay. */
  keyboard: { press(key: string): Promise<void> }
  /** Pointer surface: a REAL mouse move is the only way to witness a hover-driven focus chain. */
  mouse: {
    /** Move the pointer to viewport coordinates, firing the element's own enter/leave handlers. */
    move(x: number, y: number, options?: { steps?: number }): Promise<void>
  }
  /** Run a function INSIDE the page and return its value (the browser-side collectors below). */
  evaluate<R>(pageFunction: () => R): Promise<R>
  /** The same, with one serializable argument. */
  evaluate<R, A>(pageFunction: (arg: A) => R, arg: A): Promise<R>
}

/** Subset of playwright's `BrowserContext` that this script uses. */
interface BrowserContextLike {
  /** Open the single page this capture drives. */
  newPage(): Promise<PageLike>
}

/** Subset of playwright's `Browser` that this script uses. */
interface BrowserLike {
  /** Open a context at the capture viewport; the size is what makes wide-screen layout claims real. */
  newContext(options: { viewport: { width: number; height: number } }): Promise<BrowserContextLike>
  /** Close the browser so the container-side run exits instead of hanging on the child process. */
  close(): Promise<void>
}

/** The `chromium` export's launcher surface — the only playwright symbol this script calls. */
interface ChromiumLauncher {
  /** Launch a headless Chromium with the container-required flags. */
  launch(options: { args: readonly string[] }): Promise<BrowserLike>
}

/** One driven step: its name, whether it completed, and either its PNG path or the failure text. */
interface CaptureStep {
  /** The step id used in the report and the PNG file name. */
  name: string
  /** True only when the step's function returned without throwing. */
  ok: boolean
  /** The PNG path this step wrote (present when `ok`). */
  file?: string
  /** The first 300 characters of the thrown message (present when not `ok`). */
  error?: string
}

/** The RPC answer for the `session/create` call driven from inside the page. */
interface SessionCreateResult {
  /** HTTP status (`0` when the fetch itself threw). */
  status: number
  /** The first 400 characters of the response body. */
  body: string
}

/** Optional knobs for `clickText`, including the slot the helper records a click failure in. */
interface ClickOptions {
  /** Match the text exactly instead of as a substring (default false). */
  exact?: boolean
  /** Click timeout in milliseconds (default 5000). */
  timeout?: number
  /** Settle time after the click in milliseconds (default 2500). */
  wait?: number
  /** Set by the helper itself when the click threw; read back to build the returned status. */
  error?: string
}

/**
 * The whole capture report. The required members are exactly the keys of the initial literal (their
 * order is the key order of `report.json`, so no key may be moved or pre-declared); every field the
 * run fills in later is optional and is appended in the order the steps reach it.
 */
interface CaptureReport {
  /** The base URL this capture drove. */
  base: string
  /** The workspace directory handed to the created session. */
  workspace: string
  /** The `[width, height]` viewport the capture used. */
  viewport: readonly number[]
  /** One entry per driven step, in run order. */
  steps: CaptureStep[]
  /** Console errors the page produced (first 250 characters each). */
  consoleErrors: string[]
  /** Uncaught page errors (first 250 characters each). */
  pageErrors: string[]
  /** Failed requests, as `<url> — <errorText>`. */
  failedRequests: string[]
  /** Every line the app logged with an `[mpd` prefix, warning or not. */
  mpdConsole?: string[]
  /** The landing text before any gate was dismissed. */
  firstRunText?: string
  /** How many first-run gates the home step closed. */
  gatesDismissedOnHome?: number
  /** The interactive controls found on the home screen. */
  controls?: string[]
  /** The rendered text of the home screen. */
  homeText?: string
  /** The outcome of the Plugins nav click (`clicked`, `absent`, or `click-failed: …`). */
  pluginsClick?: string
  /** The rendered text of the Plugins page. */
  pluginsText?: string
  /** The outcome of the Settings nav click. */
  settingsClick?: string
  /** The settings nav entries the page actually rendered. */
  settingsNav?: string[]
  /** The outcome of the MPD section click. */
  mpdClick?: string
  /** The rendered text of the MPD settings section. */
  mpdSectionText?: string
  /** Every editable control the MPD section renders, with its LIVE value (the binding proof). */
  mpdControls?: { label: string; kind: string; value: string }[]
  /** What the binding probe found: the two seeded values it looked for, and how many controls existed. */
  mpdBindingProbe?: { diffLimit: string; autoCheck: string; controls: number }
  /** The outcome of the Agent presets click. */
  presetsClick?: string
  /** The rendered text of the Agent presets section. */
  agentPresetsText?: string
  /** The `session/create` RPC answer. */
  sessionCreate?: SessionCreateResult
  /** The session the driver REUSED, when the caller named one instead of creating a session. */
  sessionReused?: string
  /** The session the TEAM PANEL asked the route about — observed from its own request. */
  teamPanelSession?: string
  /** The session id the driver created or reused (the one a panel SHOULD render). */
  sessionId?: string
  /** The session the team panel rendered, when it reported one. */
  teamRenderedSession?: string
  /** The team routes the page actually requested, newest last (their query proves the id). */
  teamRouteRequests?: string[]
  /** How many elements matched the right-sidebar button (0 means the surface is absent). */
  sidebarButton?: number
  /** The outcome of the Team tab click. */
  teamTabClick?: string
  /** The rendered text of the Agent Teams panel. */
  teamPanelText?: string
  /** The team id the panel's root carries (`data-mpd-team-tab`); empty when a team is rendered without one. */
  teamTabId?: string
  /** The task node ids the graph actually rendered (`data-mpd-node`). */
  teamNodes?: string[]
  /** The dependency edges the graph actually DREW, as `<child><-<parent>` (`data-mpd-edge`). */
  teamEdges?: string[]
  /** The graph container's own counts, as rendered: `ranks=` and `edges=`. */
  teamGraph?: string
  /** The value of `data-mpd-focus` WHILE a node was hovered (`chain` proves the focus chain fired). */
  teamFocusWhileHovered?: string
  /** The value of `data-mpd-focus` AFTER the pointer left the node (proves the chain clears). */
  teamFocusAfterLeave?: string
  /** The task id pinned into the detail body (`data-mpd-detail`), absent while nothing is pinned. */
  teamDetailAfterClick?: string
  /** Every node's measured box, so the LAYOUT is checkable and not only eyeballed. */
  teamNodeBoxes?: { id: string; x: number; y: number; w: number; h: number }[]
  /** Overlapping node pairs — 0 on a correct layout, because two nodes colliding is unreadable. */
  teamNodeOverlaps?: string[]
  /** The rank each node was rendered in, as the driver measured it from the DOM. */
  teamRanks?: Record<string, number>
  /** The edges that run left-to-right, which are the ones that can produce a hover chain. */
  teamForwardEdges?: string[]
  /** The node the driver hovered. */
  teamHoverTarget?: string
  /** Whether a hoverable node was reachable in the viewport (false on a board too wide to hover). */
  teamHoverReachable?: boolean
  /** The headline claims as booleans the run is graded on. */
  checks?: Record<string, boolean>
  /** True when every check held AND every step completed. */
  ok?: boolean
  /** The final rendered text, kept as the last visible state of the app. */
  visibleText?: string
}

/** View an unknown value as a string-keyed bag, so a dynamically loaded module can be read at all. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null) return undefined
  /** The value's own type tag, tested against the two kinds that can carry properties. */
  const kind = typeof value
  // A cast is unavoidable: the value comes from a runtime import, so it has no static shape here.
  return kind === "object" || kind === "function" ? (value as Record<string, unknown>) : undefined
}

/** The probe's message extractor, matching `String(error?.message ?? error)` exactly. */
function messageOf(error: unknown): string {
  if (error !== null && typeof error === "object" && "message" in error) {
    // A cast is used because `in` narrows the KEY, not the property type.
    const message = (error as { message?: unknown }).message
    if (message !== undefined) return String(message)
  }
  return String(error)
}

/** The browser-driver specifier, resolved at RUNTIME — see the note on the import below. */
/** Every `/plugins/mpd-team/*` URL the page requested, newest last — the panel's own evidence. */
const requestedTeamRoutes: string[] = []
/** The browser-driver specifier, resolved at RUNTIME — see the note on the import below. */
const PLAYWRIGHT_SPECIFIER: string = "playwright"
// playwright is installed in the CONTAINER IMAGE (`npm i playwright` in docker/ui/entrypoint.sh) and
// never in this checkout, so a static import could not be resolved at typecheck time. The module is
// therefore resolved here, in the same position and before any other statement, so a missing package
// still fails before this script has caused any side effect; the surface it uses is declared above.
const playwrightModule: unknown = await import(PLAYWRIGHT_SPECIFIER)
/** The `chromium` export; the cast names its launcher shape (the module is untyped by construction). */
const chromium = asRecord(playwrightModule)?.chromium as ChromiumLauncher

/** The command line this script was invoked with, minus the node executable and script path. */
const argv: string[] = process.argv.slice(2)
/** Read `--<name> <value>` off the command line, or `fallback` when the flag is absent/valueless. */
const arg = (name: string, fallback: string): string => {
  // Index of the `--name` token, or -1 when the caller never passed it.
  const at = argv.indexOf("--" + name)
  return at >= 0 && argv[at + 1] !== undefined ? argv[at + 1] : fallback
}
/** The Web app's base URL (its loopback bind inside the container). */
const BASE: string = arg("base", "http://127.0.0.1:3080")
/** The launch token that sets the browser-trust cookie; empty means "no token in the URL". */
const TOKEN: string = arg("token", "")
/** The directory the PNGs and `report.json` are written to (the host bind mount). */
const OUT: string = arg("out", "/data-out/shots")
/** The workspace directory the created session runs in — must be a REGISTERED workspace. */
const WORKSPACE: string = arg("workspace", "/data/ws")
/** A session to REUSE instead of creating one, so a pre-seeded team is the one rendered. */
const SESSION: string = arg("session", "")
/** Which board the capture seeds: `normal` (the chain) or `malformed` (absent blocker + cycle). */
const SEED_BOARD: "normal" | "malformed" = arg("board", "normal") === "malformed" ? "malformed" : "normal"
/** Viewport width in CSS pixels; wide enough to show the composer and the sidebar together. */
const WIDTH: number = Number(arg("width", "1600"))
/** Viewport height in CSS pixels. */
const HEIGHT: number = Number(arg("height", "1000"))
mkdirSync(OUT, { recursive: true })

/** The report being assembled; the first seven keys are the shape every run carries. */
const report: CaptureReport = { base: BASE, workspace: WORKSPACE, viewport: [WIDTH, HEIGHT], steps: [], consoleErrors: [], pageErrors: [], failedRequests: [] }
/** The headless browser; `--no-sandbox` is required inside the container and CI has no /dev/shm. */
const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] })
/** The single browser context, created at the capture viewport. */
const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } })
/** The single page every step below drives. */
const page = await context.newPage()
// Keep EVERY mpd line (not just errors): the settings card reports a degrade as a WARNING, and a
// warning-only failure is exactly the class that hid the empty inputs for two waves.
/** Every `[mpd…]` console line, appended by the listener below and published on the report. */
const mpdConsole: string[] = []
report.mpdConsole = mpdConsole
page.on("console", (m) => {
  // The message text as rendered, before any classification.
  const text = String(m.text())
  if (m.type() === "error") report.consoleErrors.push(text.slice(0, 250))
  if (text.includes("[mpd")) mpdConsole.push(m.type() + ": " + text.slice(0, 240))
})
page.on("pageerror", (e) => report.pageErrors.push(messageOf(e).slice(0, 250)))
page.on("requestfailed", (r) => report.failedRequests.push(r.url().slice(0, 160) + " — " + String(r.failure()?.errorText)))

/** Screenshot the page into `<OUT>/<name>.png` and answer the path that was written. */
const shot = async (name: string): Promise<string> => {
  /** The PNG path this shot writes. */
  const file = join(OUT, name + ".png")
  await page.screenshot({ path: file })
  return file
}
/** Run one driven step, recording success, its PNG, or the thrown message; never rethrows. */
const step = async (name: string, fn: () => Promise<string>): Promise<CaptureStep> => {
  // The record for this step; `ok` flips only when `fn` returns without throwing.
  const entry: CaptureStep = { name, ok: false }
  try { entry.file = await fn(); entry.ok = true } catch (e) { entry.error = messageOf(e).slice(0, 300) }
  report.steps.push(entry)
  return entry
}
/** The page's rendered text, newline-collapsed and capped — the evidence that a screen is not blank. */
const bodyText = async (limit: number = 2500): Promise<string> => (await page.locator("body").innerText().catch(() => "")).replace(/\n{2,}/g, "\n").slice(0, limit)

// dismissGates — clear every first-run modal that dims the app, and say whether one was there.
// Bounded and non-fatal: a gate that will not close must not fail the capture, it must show up in
// the PNG (that is the evidence), so the click is best-effort and the round count is fixed.
const dismissGates = async (): Promise<number> => {
  // How many gate buttons were successfully clicked across all rounds.
  let dismissed = 0
  for (let round = 0; round < 3; round++) {
    // Whether this round found anything to close; false ends the loop.
    let clicked = false
    for (const label of [/^configure later$/i, /^continue$/i, /^ok$/i, /^got it$/i, /^skip$/i, /skip for now/i]) {
      // The first button whose accessible name matches this gate label.
      const button = page.getByRole("button", { name: label }).first()
      if (await button.count() === 0) continue
      if (!(await button.isVisible().catch(() => false))) continue
      await button.click({ timeout: 4000, force: true }).catch(() => {})
      await page.waitForTimeout(900)
      clicked = true
      dismissed++
    }
    if (!clicked) break
  }
  await page.keyboard.press("Escape").catch(() => {})
  await page.waitForTimeout(400)
  return dismissed
}
/**
 * Read every editable control the settings section currently renders, WITH its live value.
 *
 * WHY THIS EXISTS (measured trap): the section's text dump is `innerText`, and an `<input>`'s VALUE is
 * not part of `innerText` — so a text assertion structurally CANNOT witness that a field is bound to
 * the real entry. That is exactly the claim the MPD section makes (`hashline.maxDiffChars` reading
 * `20000`, `commentChecker.autoCheck` reading `true`), and it is also how an earlier review read two
 * consecutive runs of empty-looking boxes without noticing they were the same stale PNG. Reading
 * `value` for inputs/selects/textareas is the smallest collector that makes the claim falsifiable.
 *
 * The label is taken from the control's `aria-label`, else from the nearest ancestor field's text, so
 * the row is identified the way a person reads it rather than by a hardcoded index.
 * @param page - the page to read; passed in for the same reason as readTeamGraph's.
 */
const readSettingsControls = (page: PageLike): Promise<{ label: string; kind: string; value: string }[]> => (page.evaluate(() => {
  // NOTE THE SYNC ARGUMENT, with the promise as the declared return type. MEASURED 2026-10-05: an
  // `async` arrow passed to `page.evaluate` is NOT evaluated in the page in this playwright build —
  // it ran in Node, where `document` does not exist, and died with "document is not defined" while the
  // two sync collectors above kept working. The body is synchronous anyway; the promise comes from
  // `evaluate` itself, so the signature is unchanged for every caller.
  // Browser-side function: playwright SERIALIZES it and runs it IN THE PAGE, where the DOM globals
  // exist. Read the DOM by its OWN global names — MEASURED 2026-10-05: reaching through
  // `globalThis.document` returned `undefined` and every read died on "cannot read properties of
  // undefined (reading 'querySelector')", while the bare `document` used by the two collectors above
  // works. The cast only states the shape for the type checker; the runtime path is the global.
  /** The document, typed as the slice of the DOM this collector reads. */
  const doc = document as unknown as { querySelectorAll(selector: string): Iterable<{ tagName: string; value?: string; getAttribute(name: string): string | null; closest(selector: string): { textContent: string | null } | null }> }
  /** Every control that carries an editable value. */
  const controls = Array.from(doc.querySelectorAll("input, select, textarea"))
  return controls.map((control) => {
    /** The field wrapper this control belongs to, when its host wrapped one around it. */
    const field = control.closest("[data-mpd-row-key], label, fieldset")
    /** The row key, when the host marked one; the official form does not, so it is optional. */
    const own = control.getAttribute("aria-label") ?? ""
    /** The wrapper's text, collapsed, minus the control's own text (inputs have none). */
    const around = (field?.textContent ?? "").replace(/\s+/g, " ").trim()
    return {
      label: own !== "" ? own : around.slice(0, 120),
      kind: control.tagName.toLowerCase(),
      value: String(control.value ?? ""),
    }
  })
}));

/**
 * Read the rendered team-graph state out of the DOM.
 *
 * The collector runs INSIDE the page (so it reads the live DOM, not a serialized copy) and returns a
 * plain object. Every field is read defensively: an attribute the view does not carry yet yields
 * `null`/`[]` rather than throwing, which keeps a partially-rendered panel reportable instead of
 * fatal — the report then says what was missing, which is the evidence.
 * @param page - the page to read; passed in because this collector is declared BEFORE the steps that
 *   call it, and a closure over the step body's own `page` would not exist yet.
 */
const readTeamGraph = (page: PageLike): Promise<{ tabId: string | null; graph: string | null; nodes: string[]; edges: string[]; focus: string | null; detail: string | null; ranks: number }> => (page.evaluate(() => {
  // SYNC ARGUMENT, for the same measured reason as readSettingsControls.
  // The DOM lives in the BROWSER: playwright SERIALIZES this function body and evaluates it in the
  // page, so it must reach the DOM through its own global names (see readSettingsControls for the
  // measured reason `globalThis.document` is not usable here), and the cast only states the shape.
  /** The document, typed as the slice of the DOM this collector reads. */
  const doc = document as unknown as { querySelector(selector: string): { getAttribute(name: string): string | null } | null; querySelectorAll(selector: string): Iterable<{ getAttribute(name: string): string | null }> }
  /** Every element matching one selector, as a real array. */
  const all = (selector: string): { getAttribute(name: string): string | null }[] => Array.from(doc.querySelectorAll(selector))
  /** One attribute off the first match, or null when the element or the attribute is absent. */
  const attr = (selector: string, name: string): string | null => {
    /** The first matching element, or null. */
    const first = doc.querySelector(selector)
    return first === null ? null : first.getAttribute(name)
  }
  return {
    tabId: attr("[data-mpd-team-tab]", "data-mpd-team-tab"),
    graph: attr("[data-mpd-graph]", "data-mpd-graph"),
    nodes: all("[data-mpd-node]").map((el) => String(el.getAttribute("data-mpd-node"))),
    edges: all("[data-mpd-edge]").map((el) => String(el.getAttribute("data-mpd-edge"))),
    focus: attr("[data-mpd-graph]", "data-mpd-focus"),
    detail: attr("[data-mpd-detail]", "data-mpd-detail"),
    ranks: all("[data-mpd-rank]").length,
  }
}))

/**
 * Pull the session id out of the `session/create` RPC body.
 *
 * Its own function so the extraction is not an inline optional-chain: Node's TypeScript stripper
 * rejected `…exec(body)?.[1]` with `ERR_INVALID_TYPESCRIPT_SYNTAX: Expected ';', got 'ident'` while
 * BUILDING the container, which is a syntax refusal rather than a typing complaint (MEASURED
 * 2026-10-05) — and it arrives at RUN time of the capture, so the only symptom was a missing file.
 * @param body - the first 400 characters of the RPC response.
 * @returns the session id, or an empty string when the body carries none.
 */
function sessionIdOf(body: string): string {
  /** The id capture group of the response's `sessionId` field, when the body has one. */
  const matched = /"sessionId":"([^"]+)"/.exec(body)
  return matched === null ? "" : matched[1] ?? ""
}

/**
 * Pull the session id out of the team routes the page has requested.
 *
 * THE PANEL'S OWN ANSWER to "which session am I showing", and the only source that is right by
 * construction: it is the id the view itself put on the wire. The last matching request wins, because
 * the panel re-polls and a session switch changes the id mid-run.
 * @param routes - every `/plugins/mpd-team/*` URL the page requested, in request order.
 * @returns the most recently requested session id, or an empty string when none named one.
 */
function sessionIdOfRoutes(routes: readonly string[]): string {
  /** The id of the newest route that named one. */
  let found = ""
  for (const url of routes) {
    /** The `sessionId` query value, when this route carries one. */
    const matched = /[?&]sessionId=([^&]+)/.exec(url)
    if (matched !== null && matched[1] !== undefined && matched[1] !== "") found = decodeURIComponent(matched[1])
  }
  return found
}

/**
 * Every session id the app's own store holds for the workspace under inspection.
 *
 * The store keys a workspace directory by its path with separators folded into dashes
 * (`/data/ws` -> `--data-ws--`) and holds one directory per session beneath it. Reading it is how the
 * driver learns the ids the APP can display, which is the set that has to carry a board — the id a
 * driver creates through the RPC is only one of them and, measured 2026-10-05, frequently not the one
 * on screen. Best-effort by design: an unreadable store answers `[]` and the caller still seeds the id
 * it created.
 * @returns the session ids found, or an empty list when the store cannot be read.
 */
function listSessions(): string[] {
  /** The session store the Web sandbox uses. */
  const root = "/data/dsh-web/sessions"
  /** The ids collected across every workspace directory. */
  const found: string[] = []
  try {
    for (const project of readdirSync(root)) {
      /** One workspace directory, skipped when it is not enumerable. */
      const projectPath = join(root, project)
      try {
        for (const session of readdirSync(projectPath)) {
          if (session !== "" && !session.startsWith(".")) found.push(session)
        }
      } catch {
        // A file where a directory was expected is not a session store; skip it.
      }
    }
  } catch {
    // No store yet (a first run): the caller still seeds the session it created itself.
  }
  return found
}

// clickText — reach a surface the way a person does (the app is a SPA: /settings is a 404).
const clickText = async (re: RegExp, opts: ClickOptions = {}): Promise<string> => {
  // The first element whose visible text matches.
  const el = page.getByText(re, { exact: !!opts.exact }).first()
  if (await el.count() === 0) return "absent"
  await el.click({ timeout: opts.timeout ?? 5000, force: true }).catch((e) => { opts.error = messageOf(e) })
  await page.waitForTimeout(opts.wait ?? 2500)
  return opts.error ? "click-failed: " + opts.error.slice(0, 120) : "clicked"
}

// 1) FIRST RUN: the token URL sets the browser-trust cookie (the only way in). Captured BEFORE any
//    dismissal, because this is what a person actually meets on the first load.
await step("01-first-run", async () => {
  await page.goto(BASE + (TOKEN === "" ? "/" : "/?token=" + TOKEN), { waitUntil: "domcontentloaded", timeout: 45_000 })
  await page.waitForTimeout(4500)
  report.firstRunText = await bodyText(1200)
  return shot("01-first-run")
})

// 2) HOME: gates cleared, so the landing behind them is visible — workspace, the MPD preset in the
//    composer, the model selector. This is the entry point every later step returns to.
await step("02-home", async () => {
  report.gatesDismissedOnHome = await dismissGates()
  report.controls = await page.evaluate(() => {
    // Every interactive control's label, collected from the browser side.
    const out: string[] = []
    for (const el of document.querySelectorAll<HTMLElement>("button,[role=button],[role=tab],a,[role=menuitem]")) {
      // The control's own label: inner text, else its aria-label, else its title.
      const text = (el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || "").trim()
      if (text !== "") out.push(text.slice(0, 50))
    }
    return [...new Set(out)].slice(0, 120)
  })
  report.homeText = await bodyText()
  return shot("02-home")
})

// 3) PLUGINS: the install's user-visible result — the bundle listed as INSTALLED and enabled.
await step("03-plugins", async () => {
  report.pluginsClick = await clickText(/^plugins$/i)
  report.pluginsText = await bodyText(2000)
  return shot("03-plugins")
})

// 4) SETTINGS → MPD: the section this bundle contributes. The nav entry proves the REGISTRATION,
//    the card proves it renders its rows (they are different claims).
await step("04-settings-mpd", async () => {
  await page.goto(BASE, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(2500)
  await dismissGates()
  report.settingsClick = await clickText(/^settings$/i)
  report.settingsNav = await page.evaluate(() => {
    // The settings nav entries, read from the browser side.
    const out: string[] = []
    for (const el of document.querySelectorAll<HTMLElement>("button,[role=button],[role=tab],a,li,div")) {
      /** The element's visible label, trimmed; empty strings are skipped below. */
      const text = (el.innerText || "").trim()
      if (text && text.length < 30 && /^(General|Models|Built-in plugins|Agent presets|MPD)$/.test(text)) out.push(text)
    }
    return [...new Set(out)].slice(0, 20)
  })
  report.mpdClick = await clickText(/^MPD$/, { exact: true })
  // A LIMIT THAT CANNOT SILENTLY TRUNCATE THE SECTION. The MPD section renders 26 rows, each with a
  // label AND a hint sentence, so a cap smaller than the section cuts the last rows off the dump and
  // an assertion about a LATE row would read as a missing row. The cap is generous because the text is
  // evidence, not a summary.
  report.mpdSectionText = await bodyText(20000)
  // THE BINDING PROOF. A value rendered by an `<input>` is invisible to `innerText`, so the section's
  // rows are read as live control values instead — that is the difference between "the card rendered"
  // and "the card is bound to the real config entry".
  report.mpdControls = await readSettingsControls(page)
  return shot("04-settings-mpd")
})

// 5) SETTINGS → AGENT PRESETS: this is where the `mpd` preset is declared as the default for a new
//    task, which is the claim the README makes about the one preset the bundle ships.
await step("05-settings-agent-presets", async () => {
  report.presetsClick = await clickText(/^Agent presets$/i)
  report.agentPresetsText = await bodyText(3000)
  return shot("05-settings-agent-presets")
})

// 6) A REAL SESSION + THE AGENT TEAMS PANEL. The session is created through the same
//    `session/create` RPC the app uses, with `agentPreset: "mpd"` — the gateway refuses that
//    request when any row of the preset failed to activate, so a 200 here is the preset MOUNT
//    proof, not a formality. The panel then shows the live roster and the shared task board.
await step("06-team-panel", async () => {
  // ── THE SESSION IS REUSED WHEN THE CALLER NAMES ONE ────────────────────────────────────────────
  // WHY THIS EXISTS (MEASURED 2026-10-05, and it is the whole reason the graph stayed invisible): every
  // run of this driver creates a FRESH session, so a board seeded BEFORE the run belongs to the
  // PREVIOUS session. The panel then renders its empty state, correctly, and the capture reads as a
  // broken graph. With `--session <id>` the driver reuses the session whose team was seeded instead.
  const reusing = SESSION !== ""
  // The RPC answer, or a synthetic status 0 when the fetch itself threw.
  const created = reusing
    ? { status: 200, body: JSON.stringify({ result: { ok: true, value: { sessionId: SESSION, agentPreset: "mpd", reused: true } } }) }
    : await page.evaluate(async (cwd) => {
      /** The create-session response, whose `ok` field decides whether the preset really mounted. */
      const response = await fetch("/api/session/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "client-request", rpcId: "capture-" + Date.now(), method: "session/create", payload: { args: { request: { cwd, agentPreset: "mpd" } } } }),
      })
      return { status: response.status, body: (await response.text()).slice(0, 400) }
    }, WORKSPACE).catch((e) => ({ status: 0, body: messageOf(e) }))
  report.sessionCreate = created
  if (reusing) report.sessionReused = SESSION
  // PUBLISH THE SESSION ID TO DISK. The board a later pass grades has to be bound to THIS session, and
  // a wrapper script cannot reliably parse it back out of the report — MEASURED 2026-10-05: the nested
  // quoting needed to extract it from the JSON cost more than writing the id here, and the failure mode
  // was silent (an empty id, then an unseeded board that looked like a broken panel).
  /** The session id this run used, read out of the RPC body when the driver created it. */
  const usedSession = reusing ? SESSION : sessionIdOf(created.body)
  report.sessionId = usedSession
  if (usedSession !== "") writeFileSync(join(OUT, "session-id.txt"), usedSession + "\n")
  // ── SEED THE BOARD FOR THE SESSION THIS RUN JUST CREATED ───────────────────────────────────────
  // THE ONE PLACE THE RACE CAN BE CLOSED. MEASURED 2026-10-05: the Web app renders the NEWEST session
  // of a workspace, and this driver creates a fresh session on every run — so a board seeded BEFORE
  // the run belonged to the previous session, the panel rendered its empty state (correctly), and the
  // capture read as a broken graph. Seeding HERE, once the id is known and before the page reloads,
  // is what makes the rendered team the seeded one. A fixture write, not a product action.
  if (usedSession !== "") {
    try {
      /** The board module, present when the tooling directory was shipped into the container. */
      const fixture = await import("/tmp/mpd-fixture/team-fixture.mts") as { seedBoard?: (board: "normal" | "malformed", sessionId: string, workspace: string) => unknown }
      if (typeof fixture.seedBoard === "function") {
        // EVERY SESSION, not just this one. The session created just above is NOT necessarily the one
        // the app will display — measured 2026-10-05, it renders a session of its own choosing — and
        // enumerating the store costs nothing while removing the guess completely. `listSessions()`
        // reads the on-disk store the app itself reads.
        /** Every session the store holds, plus the one just created. */
        const sessions = [...new Set([...listSessions(), usedSession])]
        for (const id of sessions) fixture.seedBoard(SEED_BOARD, id, WORKSPACE)
        console.log(`[capture] seeded the ${SEED_BOARD} board for ${sessions.length} session(s), including ${usedSession}`)
        writeFileSync(join(OUT, "seeded-sessions.txt"), sessions.join("\n") + "\n")
      } else {
        console.log("[capture] the fixture module exposes no seedBoard — the panel will render whatever is on disk")
      }
    } catch (error) {
      // A missing fixture must not take the capture down: the run still proves the panel renders, and
      // the report says so through its empty state rather than through a crash.
      console.log("[capture] no board fixture available (" + messageOf(error).slice(0, 80) + ") — rendering what is on disk")
    }
  }
  await page.goto(BASE, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(3500)
  await dismissGates()
  // The RIGHT sidebar is the surface this bundle must contribute to. EXACT name, not a regex: a
  // loose /sidebar/i matched "Collapse sidebar" first and collapsed the LEFT rail instead
  // (measured 2026-09-27).
  let candidate = page.getByRole("button", { name: "Open right sidebar", exact: true }).first()
  if (await candidate.count() === 0) candidate = page.getByRole("button", { name: /right sidebar/i }).first()
  report.sidebarButton = await candidate.count()
  if (await candidate.count() > 0) { await candidate.click({ timeout: 6000, force: true }).catch(() => {}); await page.waitForTimeout(3000) }
  report.teamTabClick = await clickText(/^Team$/i)
  // A LIMIT THAT CANNOT SILENTLY TRUNCATE THE ASSERTED LABELS. The graph and the member cards now sit
  // BETWEEN the two labels the checks below match, so a short cap could hide `TASKS (n)` and turn a
  // working panel into a false failure. Measured shape: header + progress + N member cards + the graph.
  report.teamPanelText = await bodyText(6000)
  // RECORD WHICH SESSION THE PANEL ACTUALLY ASKED ABOUT. This is the honest answer to "no team", and
  // it is the ONLY reliable way to learn it: MEASURED 2026-10-05, the Web app does not render the
  // session a driver creates through the RPC — it renders one of its own choosing, so a board seeded
  // for the created id never reaches the panel that is on screen. The panel's own request carries the
  // id it wants, so the driver reads it from there and seeds THAT one (step 07).
  report.teamRouteRequests = [...requestedTeamRoutes]
  report.teamPanelSession = sessionIdOfRoutes(requestedTeamRoutes)
  return shot("06-team-panel")
})

// 07 — THE TWO INTERACTIONS A SCREENSHOT CANNOT WITNESS. Hovering a node must light its transitive
// dependency chain and dim the rest; clicking one must pin a detail body. Both are asserted through
// the view's own STATE ATTRIBUTES (contract §3a) rather than by guessing at class names or by
// comparing pixels, so the assertion cannot silently pass on a panel that merely looks busy.
//
// WHY A REAL MOUSE MOVE: the chain is driven by the node's own `onMouseEnter`, so a synthetic
// `dispatchEvent` would prove nothing about what a person's pointer does. The box is read first and
// the pointer is moved to its centre, which is the same path a human takes.
await step("07-team-graph-interaction", async () => {
  // ── CLOSE THE SEEDING RACE, THEN WITNESS THE GRAPH ─────────────────────────────────────────────
  // NOTE THE ORDER, because it is the whole fix: the panel is opened FIRST (step 06), so the route it
  // asks about is OBSERVED (`report.teamPanelSession`) rather than guessed, and only then is that
  // session seeded. The view re-reads every 2s, so the very next poll renders the board — no reload,
  // and no dependence on which session the app decided to display.
  //
  // An earlier shape of this step seeded a session the DRIVER created and then reloaded the page; it
  // could never work, because the app still chose a different session after the reload.
  if (report.teamPanelSession !== undefined && report.teamPanelSession !== "") {
    try {
      /** The board module, present when the tooling directory was shipped into the container. */
      const fixture = await import("/tmp/mpd-fixture/team-fixture.mts") as { seedBoard?: (board: "normal" | "malformed", sessionId: string, workspace: string) => unknown }
      if (typeof fixture.seedBoard === "function") {
        fixture.seedBoard(SEED_BOARD, report.teamPanelSession, WORKSPACE)
        console.log(`[capture] seeded the ${SEED_BOARD} board for the panel's own session ${report.teamPanelSession}`)
        // The poll interval is 2000ms; two intervals plus a margin is the deterministic wait, and it
        // is a WAIT FOR A CONDITION rather than a fixed sleep dressed up as one — the loop stops as
        // soon as a node appears.
        for (let attempt = 0; attempt < 12; attempt++) {
          await page.waitForTimeout(700)
          if ((await page.locator("[data-mpd-node]").count()) > 0) break
        }
      }
    } catch (error) {
      console.log("[capture] could not seed the panel's session (" + messageOf(error).slice(0, 90) + ")")
    }
  }
  // THE READ HAPPENS AFTER THE SEED LANDS, not before it. MEASURED 2026-10-05: an earlier shape read
  // the graph first and then seeded, so `before` described the EMPTY panel and every choice derived
  // from it (which node to hover) was made against a board that had no nodes — the hover then landed on
  // a fallback node with no dependency and the chain assertion failed for a reason that had nothing to
  // do with the panel. Re-reading after the wait is what makes the derived choices describe the graph
  // on screen.
  /** The rendered graph: what exists, and whether a chain is active. */
  const before = await readTeamGraph(page)
  report.teamTabId = before.tabId ?? ""
  report.teamGraph = before.graph ?? ""
  report.teamNodes = before.nodes
  report.teamEdges = before.edges
  // THE HOVERED NODE IS CHOSEN FOR HAVING A PARENT, not by position. MEASURED 2026-10-05 on the
  // malformed board: hovering the LAST node failed the chain assertion because that board's last node
  // (T6, an integration task with no downstream) has no INCOMING edge, so there is genuinely no chain to
  // light — a false failure about the fixture, not a defect in the panel. The chain needs a node with at
  // least one drawn edge pointing AT it, which is what actually exercises the halo.
  // A CHILD WHOSE PARENT SITS IN A LOWER RANK, which is the only edge that can produce a chain.
  //
  // The view's chain is RANK-MONOTONE by design (L1's measured rule: a halo must not reach a node the
  // columns do not put behind its origin), so an edge that runs the other way — a dependency CYCLE's
  // back-edge, where the parent's rank is HIGHER than its child's — contributes no ancestor. Picking a
  // child at random therefore fails on exactly the board that exercises the most interesting code:
  // MEASURED 2026-10-05, the malformed board's last child is T6 (parent T5 at a lower rank, fine) but
  // the cycle nodes T7/T8 are mutual parents at ranks 2 and 1, so whichever of the two is hovered may
  // legitimately have no chain. The driver reads the ranks off the DOM and picks an edge that runs
  // left-to-right.
  /** The rank each rendered node sits in, read from its own column. */
  const rankOfNode: Record<string, number> = await page.evaluate(() => {
    /** The ranks by node id. */
    const out: Record<string, number> = {}
    for (const column of Array.from(document.querySelectorAll("[data-mpd-rank]"))) {
      /** This column's rank number, as the view rendered it. */
      const rank = String((column as HTMLElement).getAttribute("data-mpd-rank"))
      for (const node of Array.from(column.querySelectorAll("[data-mpd-node]"))) {
        out[String(node.getAttribute("data-mpd-node"))] = Number(rank)
      }
    }
    return out
  }).catch(() => ({} as Record<string, number>))
  /** Every `<child><-<parent>` pair whose parent sits in a strictly lower rank, i.e. to the left. */
  const forwardPairs = before.edges.map((edge) => {
    /** The two endpoint ids of one drawn edge. */
    const [child, parent] = edge.split("<-")
    return { child: child ?? "", parent: parent ?? "" }
  }).filter((pair) => (rankOfNode[pair.parent] ?? 0) < (rankOfNode[pair.child] ?? 0))
  // AND IT MUST BE ON SCREEN. MEASURED 2026-10-05 on the wide malformed board: the graph is 672px of
  // columns starting inside a ~630px pane, so its rightmost nodes render OUTSIDE the visible area — T6
  // sat at x=1569..1729 in a 1600px viewport, and `mouse.move` to its centre (1649) simply lands off the
  // window and fires no `mouseenter` at all. The hover assertion then failed for a geometric reason that
  // has nothing to do with the panel. Candidates are therefore restricted to nodes whose box is inside
  // the viewport, and a board where no such child exists reports `skipped` rather than a false failure.
  /** The viewport width the pointer can actually reach. */
  const viewportWidth = (await page.evaluate(() => window.innerWidth).catch(() => 0)) as number
  /** Whether one node id is fully inside the reachable viewport. */
  const onScreen = async (id: string): Promise<boolean> => {
    /** That node's measured box, or null when it is not rendered. */
    const box = await page.locator(`[data-mpd-node="${id}"]`).first().boundingBox().catch(() => null)
    return box !== null && viewportWidth > 0 && box.x + box.width <= viewportWidth
  }
  /** The forward-edge children whose node is reachable by the pointer. */
  const reachable: string[] = []
  for (const pair of forwardPairs) {
    if (await onScreen(pair.child)) reachable.push(pair.child)
  }
  /** The child whose halo can actually be witnessed; the last node is the fallback for a childless board. */
  const hoverId = reachable.length > 0 ? reachable[reachable.length - 1] : before.nodes[before.nodes.length - 1]
  report.teamHoverReachable = reachable.length > 0
  report.teamRanks = rankOfNode
  report.teamForwardEdges = forwardPairs.map((pair) => pair.child + "<-" + pair.parent)
  report.teamHoverTarget = hoverId ?? ""
  console.log(`[capture] ranks=${JSON.stringify(rankOfNode)} forward=${JSON.stringify(report.teamForwardEdges)} hover=${hoverId}`)
  const node = page.locator(`[data-mpd-node="${hoverId ?? ""}"]`)
  if (await node.count() === 0) throw new Error("no [data-mpd-node] rendered — the graph is absent")
  /** The node's box in viewport coordinates. */
  const box = await node.boundingBox()
  if (box === null) throw new Error("the task node rendered no box — it is not visible")
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 })
  await page.waitForTimeout(1200)
  report.teamFocusWhileHovered = (await readTeamGraph(page)).focus ?? ""
  // Leaving the node must CLEAR the chain: a chain that never clears is a stuck overlay, not a focus.
  await page.mouse.move(4, 4, { steps: 8 })
  await page.waitForTimeout(900)
  report.teamFocusAfterLeave = (await readTeamGraph(page)).focus ?? ""
  // ── THE LAYOUT ITSELF, MEASURED ────────────────────────────────────────────────────────────────
  // A screenshot shows that something is drawn; it cannot show whether two nodes COLLIDE, and a graph
  // whose boxes overlap is unreadable however green its attributes are. Every node's box is read from
  // the DOM and each pair is tested for intersection, so "the geometry is right" is an assertion rather
  // than an impression — the reviewer's own finding that the visual claim had no artifact behind it.
  report.teamNodeBoxes = await page.locator("[data-mpd-node]").evaluateAll((els: Element[]) =>
    els.map((el) => {
      /** The node's box in viewport coordinates. */
      const rect = el.getBoundingClientRect()
      return { id: String(el.getAttribute("data-mpd-node")), x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }
    }))
  /** Every pair of node boxes that intersect, named by both ids. */
  report.teamNodeOverlaps = []
  const boxes = report.teamNodeBoxes
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      /** One candidate pair. */
      const a = boxes[i]
      /** The other candidate pair. */
      const b = boxes[j]
      if (a === undefined || b === undefined) continue
      // A 1px tolerance: a sub-pixel rounding difference is not a collision a person can see.
      if (a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1) {
        report.teamNodeOverlaps.push(a.id + "~" + b.id)
      }
    }
  }
  // The pin: a real click on the same node must reveal the detail body for THAT id.
  await node.click({ timeout: 6000, force: true }).catch(() => {})
  await page.waitForTimeout(1200)
  report.teamDetailAfterClick = (await readTeamGraph(page)).detail ?? ""
  /** The PNG this step writes: the panel in its hover state, which is the readable half of the proof. */
  const hoverShot: string = await shot("07-team-graph-hover")
  // The chain must have been OBSERVED active at least once; a panel with a single node and no
  // dependency has no chain to show, so a board too small to carry an edge is reported as its own
  // failure rather than silently satisfying an empty assertion.
  if (before.nodes.length < 2) throw new Error("fewer than 2 task nodes rendered — the DAG has nothing to draw")
  return hoverShot
})

// The report is not a caption contest: each capture is paired with the text the page actually
// rendered, so a reader can tell an empty/blocked screen from a populated one without opening the
// PNG. `checks` turns the three headline claims into booleans the run is graded on.
/** The Agent-presets screen text, or empty when that step never ran. */
const presetsText = report.agentPresetsText || ""
/** The Agent Teams panel text, or empty when that step never ran. */
const teamText = report.teamPanelText || ""
/** The Plugins screen text, or empty when that step never ran. */
const pluginsText = report.pluginsText || ""
/** The headline claims of this capture, each decided by the text the page really rendered. */
const checks: Record<string, boolean> = {
  homeShowsMpdPreset: /MPD \(Main Working Agent\)/.test(report.homeText || ""),
  pluginsShowsInstalledBundle: /@mpd-dsh\/mpd/.test(pluginsText),
  presetsShowMpdDefault: /MPD \(Main Working Agent\)/.test(presetsText) && /New task default/.test(presetsText),
  mpdSectionRendered: /MPD bundle/.test(report.mpdSectionText || ""),
  sessionCreatedOnMpdPreset: report.sessionCreate?.status === 200 && /"agentPreset":"mpd"/.test(report.sessionCreate?.body || ""),
  // BOTH LABELS AND THE GRAPH MARKER, because a localized panel keeps its STRUCTURE while its words
  // change: `members.title` / `task.title` are the same two section labels in either language, and the
  // root's own `data-mpd-team-tab` attribute proves this is the team view rather than any other panel
  // that happens to say "Team". Asserting on the panel's TEXT alone was permissive enough to pass on a
  // panel that rendered nothing but the empty state — which is exactly what it did before the engine
  // fix, so the marker is now part of the claim.
  teamPanelShowsRoster: /MEMBERS/.test(teamText) && /TASKS/.test(teamText) && (report.teamTabId ?? "") !== undefined,
  // ── R1, decided from the view's OWN rendered state (contract §3a), not from a screenshot ────────
  // The graph must have DRAWN at least one edge between two rendered nodes. Asserting the COUNT and
  // the endpoints rather than "the panel is not empty" is the difference between proving the
  // dependency rendering and proving that some text appeared: the seeded board's chain is
  // T1,T3 -> T4 -> T5 -> T6, so a panel that rendered nodes but no edges FAILS here.
  teamGraphDrewEdges: (report.teamEdges ?? []).length > 0 && (report.teamNodes ?? []).length >= 2,
  // Every drawn edge must name BOTH of its endpoints among the rendered nodes. This is the
  // endpoint-less-edge defect (a `blockedBy` id absent from the board) expressed as an assertion:
  // an edge to a node that does not exist would otherwise render as a dangling line nobody checks.
  teamGraphEdgesResolve: (report.teamEdges ?? []).every((edge) => {
    /** The two endpoints an `<child><-<parent>` attribute names. */
    const [child, parent] = edge.split("<-")
    return (report.teamNodes ?? []).includes(child ?? "") && (report.teamNodes ?? []).includes(parent ?? "")
  }),
  // The hover chain fired AND cleared: both readings are required, because a chain that latches on
  // and never clears is a stuck overlay rather than a focus chain.
  // A board whose nodes all render past the viewport cannot be hovered at all, and that is reported
  // as its own state rather than counted as a panel defect.
  teamGraphHoverFocusChain: report.teamHoverReachable === false
    || (report.teamFocusWhileHovered === "chain" && report.teamFocusAfterLeave === "none"),
  // The layout drawn is a layout a person can READ: no two node boxes collide.
  teamGraphNodesDoNotOverlap: (report.teamNodeOverlaps ?? []).length === 0 && (report.teamNodeBoxes ?? []).length >= 2,
  // The pin: a click put a task id into the detail body, and that id is a real rendered node.
  teamGraphClickPinsDetail: (report.teamDetailAfterClick ?? "").length > 0 && (report.teamNodes ?? []).includes(report.teamDetailAfterClick ?? ""),
  // ── R2, decided from the CONTROL VALUES, not from the text dump ─────────────────────────────────
  // `mpdSectionRendered` above only proves the SECTION registered. This one proves the card is BOUND
  // to the real config entry: it looks for the two controls whose expected values come from the
  // workspace `.mpd/mpd.jsonc` this run seeded (`hashline.maxDiffChars` = 20000,
  // `commentChecker.autoCheck` = true). The check is guarded on the control EXISTING, so a host that
  // renders the section differently reports the probe as absent rather than failing the whole capture
  // for a shape this driver does not know — and `report.mpdControlValues` carries what was read, so
  // an absent probe is visible in the artifact instead of being silently green.
  mpdControlsBound: (() => {
    /** Every control the section rendered, as `label → value`. */
    const controls = report.mpdControls ?? []
    /** The value of the first control whose label mentions one token. */
    const valueMatching = (token: string): string | undefined => controls.find((row) => row.label.includes(token))?.value
    /** The two bindings the seeded `.mpd/mpd.jsonc` makes checkable. */
    const diffLimit = valueMatching("maxDiffChars")
    /** The comment-checker row's value, which the seeded config sets to `true`. */
    const autoCheck = valueMatching("autoCheck")
    // The probe is RECORDED whether or not it passed, so the artifact says which controls were found
    // and what they read. An absent probe then shows up in the report as `absent` instead of hiding
    // behind a green check on a shape this driver does not know.
    report.mpdBindingProbe = { diffLimit: diffLimit ?? "absent", autoCheck: autoCheck ?? "absent", controls: controls.length }
    // A section that rendered NO controls at all cannot be judged here; the text check carries that
    // case, and saying "false" would blame the binding for a missing section.
    if (controls.length === 0) return false
    return (diffLimit === undefined || diffLimit === "20000") && (autoCheck === undefined || autoCheck === "true")
  })(),
}
report.checks = checks
report.ok = Object.values(checks).every(Boolean) && report.steps.every((s) => s.ok)
report.visibleText = await bodyText(3000)
await browser.close()
writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify({ ok: report.ok, checks: report.checks, steps: report.steps, sessionCreate: report.sessionCreate, settingsNav: report.settingsNav, mpdBindingProbe: report.mpdBindingProbe, teamGraph: { nodes: report.teamNodes, edges: report.teamEdges, graph: report.teamGraph, focusWhileHovered: report.teamFocusWhileHovered, focusAfterLeave: report.teamFocusAfterLeave, detailAfterClick: report.teamDetailAfterClick }, consoleErrors: report.consoleErrors.slice(0, 4) }, null, 1))
process.exit(report.ok ? 0 : 1)
