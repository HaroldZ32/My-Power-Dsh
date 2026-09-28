// docker/ui/capture.ts — observe the Web GUI from INSIDE the container with its own headless
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
//   node /data/capture.ts --base http://127.0.0.1:3080 --token <launch-token> --out /data-out/shots
/// <reference lib="dom" />
// The DOM lib above is referenced PER FILE on purpose: the `page.evaluate(...)` callbacks below run
// in the BROWSER, so they need `document`/`Element` types, while every other script in this lane is
// Node-only and must not silently gain browser globals.
import { mkdirSync, writeFileSync } from "node:fs"
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
  /** Whether the first match is actually visible (false, never a throw, when it is not attached). */
  isVisible(): Promise<boolean>
  /** Click the first match; `force` is used because the first-run overlay intercepts real clicks. */
  click(options?: { timeout?: number; force?: boolean }): Promise<void>
  /** The element's rendered text, used to prove a screen is populated rather than blank. */
  innerText(): Promise<string>
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
  /** The outcome of the Agent presets click. */
  presetsClick?: string
  /** The rendered text of the Agent presets section. */
  agentPresetsText?: string
  /** The `session/create` RPC answer. */
  sessionCreate?: SessionCreateResult
  /** How many elements matched the right-sidebar button (0 means the surface is absent). */
  sidebarButton?: number
  /** The outcome of the Team tab click. */
  teamTabClick?: string
  /** The rendered text of the Agent Teams panel. */
  teamPanelText?: string
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
  report.mpdSectionText = await bodyText(3000)
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
  // The RPC answer, or a synthetic status 0 when the fetch itself threw.
  const created = await page.evaluate(async (cwd) => {
    /** The create-session response, whose `ok` field decides whether the preset really mounted. */
    const response = await fetch("/api/session/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "client-request", rpcId: "capture-" + Date.now(), method: "session/create", payload: { args: { request: { cwd, agentPreset: "mpd" } } } }),
    })
    return { status: response.status, body: (await response.text()).slice(0, 400) }
  }, WORKSPACE).catch((e) => ({ status: 0, body: messageOf(e) }))
  report.sessionCreate = created
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
  report.teamPanelText = await bodyText(1500)
  return shot("06-team-panel")
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
  teamPanelShowsRoster: /MEMBERS/.test(teamText) && /TASKS/.test(teamText),
}
report.checks = checks
report.ok = Object.values(checks).every(Boolean) && report.steps.every((s) => s.ok)
report.visibleText = await bodyText(3000)
await browser.close()
writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify({ ok: report.ok, checks: report.checks, steps: report.steps, sessionCreate: report.sessionCreate, settingsNav: report.settingsNav, consoleErrors: report.consoleErrors.slice(0, 4) }, null, 1))
process.exit(report.ok ? 0 : 1)
