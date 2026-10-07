#!/usr/bin/env node
// docker/lib/browser-lane.ts — drive the REAL Web GUI in a real browser and record a verdict.
//
// WHY THIS FILE EXISTS: every other Web assertion in this lane is an HTTP or filesystem fact. None of
// them can tell a WORKING GUI from a page that renders a shell and swallows every keystroke — and the
// 2026-10-03 wave proved the gap in the other direction too: the lane reported 52/53 green while a
// live turn died of `MALFORMED_RESPONSE`, because nothing ever typed into the composer.
//
// So this lane does what a person does: open the app, dismiss the first-run gates, TYPE a prompt into
// the composer, press send, wait for the answer to render, then open the two surfaces this bundle
// contributes (the MPD settings section and the Agent Teams sidebar panel). Each stage is
// screenshotted into the evidence tree, and EVERY stage records an assertion row in the same NDJSON
// shape the entrypoint's `record()` writes, so a broken GUI reddens the run instead of decorating it.
//
// The verdict is never the model's prose: `ui.replyRendered` asks whether the TRANSCRIPT changed
// after the send, and the companion `live.web.*` rows (docker/lib/live-verdict.ts) read the session
// store for what the agent actually did.
//
// USAGE (inside the container, from a directory where `playwright` resolves)
//   node browser-lane.ts --base http://127.0.0.1:3080 --token <token> --workspace /work/ws
//                        --out /out/ui-shots --state /work/assertions.ndjson [--budget-ms 240000]
//
// Exit code: 0 when every recorded row is true, 1 when any is false, 2 when the browser never started.
import { appendFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

/** The assertion names this lane owns, in emission order. */
const UI_ASSERTIONS: readonly string[] = [
  "ui.loads",
  "ui.workspaceSelected",
  "ui.composerPresent",
  "ui.promptSent",
  "ui.replyRendered",
  "ui.mpdSettingsSection",
  "ui.teamPanel",
  "ui.noConsoleErrors"
]

/** One assertion row, byte-identical in shape to what the entrypoint's `record()` appends. */
interface UiRow {
  /** Assertion name, e.g. `ui.replyRendered`. */
  readonly name: string
  /** true pass, false fail, null not attempted. */
  readonly ok: boolean | null
  /** Human reason, so a failure needs no JSON digging. */
  readonly reason: string
  /** The observed value quoted beside the verdict. */
  readonly raw: string
}

// The placeholder texts the composer has carried, NEWEST FIRST. The value is NOT stable across
// harness releases or views: the new-session page of 0.2.0-rc.2 renders "Describe what you want to
// build, / commands, @ files or sessions" while an OPEN session renders "Add files or run commands"
// (measured 2026-10-03: asserting only the second made a working composer look absent, and the
// screenshot showed a live, enabled input). Matching is a substring test in Playwright, so a prefix
// is enough.
const COMPOSER_PLACEHOLDERS: readonly string[] = [
  "Describe what you want to build",
  "Add files or run commands"
]
/** The send control's accessible name. */
const SEND_LABEL = "Send message"
/** The prompt this lane types. It asks for one MPD tool so the reply proves the bundle's tool plane. */
const PROMPT = "Call the mpd_config_get tool once (it takes no arguments), then reply with exactly: DONE"

/** Read `--<flag> <value>` off the command line, or `fallback` when absent/valueless. */
function arg(flag: string, fallback: string = ""): string {
  /** Index of the flag token, or -1 when the caller never passed it. */
  const index = process.argv.indexOf("--" + flag)
  return index === -1 || index + 1 >= process.argv.length ? fallback : process.argv[index + 1]
}

/** The error message of an unknown thrown value. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** View an unknown value as a string-keyed bag, so the untyped playwright export can be read at all. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null) return undefined
  /** The value's own type tag, tested against the two kinds that can carry properties. */
  const kind = typeof value
  // A cast is unavoidable: the module is untyped by construction, so nothing here is static.
  return kind === "object" || kind === "function" ? (value as Record<string, unknown>) : undefined
}

// The playwright surface this lane uses, declared locally for the SAME reason docker/ui/capture.mts
// declares it: playwright is installed in the CONTAINER (npm i playwright inside docker/), never in
// this checkout, so a static import could not resolve at typecheck time.
/** Subset of playwright's `ConsoleMessage` that this lane reads. */
interface ConsoleMessageLike {
  /** The console method that produced the line (`"error"`, `"warning"`, `"log"`, ...). */
  type(): string
  /** The message text as the page rendered it. */
  text(): string
}

/** Subset of playwright's `Locator` that this lane uses. */
interface LocatorLike {
  /** How many elements the locator currently matches. */
  count(): Promise<number>
  /** Narrow the locator to its first match (every use below wants exactly one element). */
  first(): LocatorLike
  /** Narrow the locator to its N-th match, so a page full of inputs can be probed in order. */
  nth(index: number): LocatorLike
  /** Whether the first match is actually visible (false, never a throw, when it is not attached). */
  isVisible(): Promise<boolean>
  /** Whether the first match can actually be typed into — the property `isVisible` does NOT imply. */
  isEditable(): Promise<boolean>
  /** Read one attribute, for the filters that must exclude a known-wrong element by name. */
  getAttribute(name: string): Promise<string | null>
  /** Click the first match; `force` because a first-run overlay intercepts real clicks. */
  click(options?: { timeout?: number; force?: boolean }): Promise<void>
  /** Type text into the first match, replacing whatever was there (the composer is empty anyway). */
  fill(text: string): Promise<void>
  /** The element's rendered text, used to prove a screen is populated rather than blank. */
  innerText(): Promise<string>
}

/** Subset of playwright's `Page` that this lane uses. */
interface PageLike {
  /** Console listener — an error here is a broken GUI, not a cosmetic detail. */
  on(event: "console", handler: (message: ConsoleMessageLike) => void): unknown
  /** Uncaught page-script error listener. */
  on(event: "pageerror", handler: (error: unknown) => void): unknown
  /** Navigate, waiting only for the DOM (the SPA keeps streaming after that). */
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>
  /** Settle time for the SPA's own async rendering. */
  waitForTimeout(ms: number): Promise<void>
  /** Capture the viewport to a PNG file — the evidence a human re-reads. */
  screenshot(options: { path: string }): Promise<unknown>
  /** Locator by CSS selector (only `body` is used here, for the rendered-text dump). */
  locator(selector: string): LocatorLike
  /** Locator by ARIA role — how a person finds a control. */
  getByRole(role: string, options?: { name?: string | RegExp; exact?: boolean }): LocatorLike
  /** Locator by visible text — how the SPA's nav entries are reached (there is no /settings route). */
  getByText(text: string | RegExp, options?: { exact?: boolean }): LocatorLike
  /** Locator by the composer's placeholder — the one stable handle on the prompt input. */
  getByPlaceholder(text: string | RegExp): LocatorLike
  /** Keyboard surface, used to press Enter when no send button was found. */
  keyboard: { press(key: string): Promise<void> }
}

/** Subset of playwright's `BrowserContext` that this lane uses. */
interface BrowserContextLike {
  /** Open the single page this lane drives. */
  newPage(): Promise<PageLike>
}

/** Subset of playwright's `Browser` that this lane uses. */
interface BrowserLike {
  /** Open a context at the lane's viewport. */
  newContext(options: { viewport: { width: number; height: number } }): Promise<BrowserContextLike>
  /** Close the browser so the container-side run exits instead of hanging on the child process. */
  close(): Promise<void>
}

/** The `chromium` export's launcher surface — the only playwright symbol this lane calls. */
interface ChromiumLauncher {
  /** Launch a headless Chromium with the container-required flags. */
  launch(options: { args: readonly string[] }): Promise<BrowserLike>
}

/** The app's base URL. */
const BASE = arg("base", "http://127.0.0.1:3080")
/** The launch token that sets the browser-trust cookie; empty means "no token in the URL". */
const TOKEN = arg("token")
/** Where the PNGs land — inside the mounted evidence tree. */
const OUT = arg("out", "/out/ui-shots")
/** How long the transcript is given to change after the send. */
const BUDGET_MS = Number(arg("budget-ms", "240000"))
/** The NDJSON state file the rows are appended to. */
const STATE = arg("state")
/** When set, the lane records the null rows and exits WITHOUT loading Playwright (it may be absent). */
const UNAVAILABLE = arg("unavailable")
mkdirSync(OUT, { recursive: true })

/** Every row this lane recorded, in emission order. */
const rows: UiRow[] = []
/** Console errors the page emitted, captured for the failure report. */
const consoleErrors: string[] = []
/** Uncaught page errors, captured for the failure report. */
const pageErrors: string[] = []

/** Append one row to the state file and echo it the way the entrypoint's `record()` does. */
function record(row: UiRow): void {
  rows.push(row)
  /** The escaped-JSON form of `text`, so no control character reaches the state file. */
  const jsonEscape = (text: string): string => JSON.stringify(text).slice(1, -1)
  if (STATE !== "") appendFileSync(STATE, `{"name":"${jsonEscape(row.name)}","ok":${row.ok === null ? "null" : row.ok},"reason":"${jsonEscape(row.reason)}","raw":"${jsonEscape(row.raw)}"}\n`)
  console.log(`[record] ${row.name}=${row.ok === null ? "null" : row.ok} — ${row.reason}`)
}

/** Run one stage, turning a throw into a FAILED row instead of an aborted lane. */
async function stage(name: string, reason: string, fn: () => Promise<string>): Promise<void> {
  try {
    /** The stage's return value, quoted as the pass row's observation. */
    const raw = await fn()
    record({ name, ok: true, reason, raw })
  } catch (error) {
    record({ name, ok: false, reason, raw: messageOf(error).slice(0, 300) })
  }
}

// The null arm runs BEFORE Playwright is loaded: a lane that was never asked to drive a browser must
// still record every `ui.*` name (so the report shows "not attempted" instead of "not reached"), and
// it must do so in a container where Playwright was never installed.
if (UNAVAILABLE !== "") {
  for (const name of UI_ASSERTIONS) record({ name, ok: null, reason: UNAVAILABLE, raw: "not attempted" })
  process.exit(0)
}

/** The browser-driver specifier, resolved at RUNTIME — see the note beside the import below. */
const PLAYWRIGHT_SPECIFIER: string = "playwright"
// playwright is installed in the CONTAINER (`npm i playwright` in docker/entrypoint.sh step 14) and
// never in this checkout, so a static import could not be resolved at typecheck time. The module is
// loaded HERE, after the null arm above (which must work in a container where playwright is absent)
// and before any other side effect; the surface it uses is declared above.
const playwrightModule: unknown = await import(PLAYWRIGHT_SPECIFIER)
/** The `chromium` export; the cast names its launcher shape (the module is untyped by construction). */
const chromium = asRecord(playwrightModule)?.chromium as ChromiumLauncher

/** The browser this lane drives. */
const browser: BrowserLike = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] })
/** The single context, at a viewport wide enough for the composer and the sidebar together. */
const context: BrowserContextLike = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
/** The page every stage below drives. */
const page: PageLike = await context.newPage()
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(String(message.text()).slice(0, 250)) })
page.on("pageerror", (error) => pageErrors.push(messageOf(error).slice(0, 250)))

/** Screenshot the page into `<OUT>/<name>.png` and answer the path written. */
async function shot(name: string): Promise<string> {
  /** The PNG path this shot writes. */
  const file = join(OUT, name + ".png")
  await page.screenshot({ path: file })
  return file
}

/** The rendered body text, newline-collapsed and capped — the evidence a screen is not blank. */
async function bodyText(limit: number = 3000): Promise<string> {
  return (await page.locator("body").innerText().catch(() => "")).replace(/\n{2,}/g, "\n").slice(0, limit)
}

/** How many textbox-role candidates the resolver and its diagnostic probe. */
const TEXTBOX_PROBES = 6

/**
 * Resolve the prompt composer, whichever element this build renders it as.
 *
 * WHY THIS IS NOT A SINGLE LOCATOR: measured 2026-10-03, the composer of the new-session page is NOT
 * reachable by its placeholder, and `getByRole("textbox").first()` resolves to the SIDEBAR'S SESSION
 * SEARCH input (`tabindex="-1"`, invisible) — so a one-liner finds the wrong element and a working
 * composer looks absent. The candidates below are tried in preference order and the first VISIBLE one
 * wins; a placeholder is presentation, and a release that rewords it must not hide a usable input.
 *
 * @returns The composer locator, or undefined when no visible input exists.
 */
async function resolveComposer(): Promise<LocatorLike | undefined> {
  /** Candidate locators in preference order: real placeholders first, then generic inputs. */
  const candidates: LocatorLike[] = []
  for (const placeholder of COMPOSER_PLACEHOLDERS) candidates.push(page.getByPlaceholder(placeholder).first())
  candidates.push(page.locator('[contenteditable="true"]').first())
  candidates.push(page.locator("textarea").first())
  for (let index = 0; index < TEXTBOX_PROBES; index++) candidates.push(page.getByRole("textbox").nth(index))
  for (const candidate of candidates) {
    if (await candidate.count() === 0) continue
    if (!await candidate.isVisible().catch(() => false)) continue
    // VISIBLE IS NOT ENOUGH. The sidebar's session-search box is visible but neither editable nor
    // tabbable (`tabindex="-1"`), and a click on it times out — measured 2026-10-03, which is how a
    // working composer kept reading as "absent". Both filters are needed: the search box is visible.
    if (!await candidate.isEditable().catch(() => false)) continue
    /** The element's own placeholder, so a search field is excluded by name and not by luck. */
    const placeholder = await candidate.getAttribute("placeholder").catch(() => null)
    if (placeholder !== null && /search/i.test(placeholder)) continue
    if (await candidate.getAttribute("tabindex").catch(() => null) === "-1") continue
    return candidate
  }
  return undefined
}

/**
 * A one-line inventory of the input-like elements the page exposes, quoted on failure.
 *
 * A resolver that simply says "no composer" costs a full container run to diagnose; this makes one run
 * enough by reporting what WAS there.
 *
 * @returns A human-readable inventory, never empty.
 */
async function describeInputs(): Promise<string> {
  /** The descriptors collected across every probe. */
  const found: string[] = []
  for (let index = 0; index < TEXTBOX_PROBES; index++) {
    /** The textbox-role candidate at this index. */
    const box = page.getByRole("textbox").nth(index)
    if (await box.count() === 0) break
    /** Whether this candidate is actually visible — the property that disqualified the search box. */
    const visible = await box.isVisible().catch(() => false)
    found.push(`textbox[${index}]=visible:${visible},editable:${await box.isEditable().catch(() => false)}`)
  }
  found.push(`contenteditable=${await page.locator('[contenteditable="true"]').count()}`)
  found.push(`textarea=${await page.locator("textarea").count()}`)
  return found.join(" ")
}

/** Clear every first-run modal that dims the app; bounded and never fatal (the PNG is the evidence). */
async function dismissGates(): Promise<void> {
  for (let round = 0; round < 3; round++) {
    /** Whether this round found anything to close; false ends the loop. */
    let clicked = false
    for (const label of [/^configure later$/i, /^continue$/i, /^ok$/i, /^got it$/i, /^skip$/i, /skip for now/i]) {
      /** The first button whose accessible name matches this gate label. */
      const button = page.getByRole("button", { name: label }).first()
      if (await button.count() === 0) continue
      if (!(await button.isVisible().catch(() => false))) continue
      await button.click({ timeout: 4000, force: true }).catch(() => {})
      await page.waitForTimeout(900)
      clicked = true
    }
    if (!clicked) break
  }
  await page.keyboard.press("Escape").catch(() => {})
  await page.waitForTimeout(400)
}

// ── stage 1: the app loads at all ─────────────────────────────────────────────
await stage("ui.loads", "the Web GUI loaded and rendered visible text in a real browser",
  async () => {
    await page.goto(BASE + (TOKEN === "" ? "/" : "/?token=" + TOKEN), { waitUntil: "domcontentloaded", timeout: 45_000 })
    await page.waitForTimeout(4500)
    await dismissGates()
    /** The rendered text, quoted so a blank screen is distinguishable from a broken one. */
    const text = await bodyText(1200)
    await shot("ui-01-loaded")
    if (text.trim().length < 20) throw new Error("the page rendered almost no text: " + JSON.stringify(text.slice(0, 120)))
    return `chars=${text.length}`
  })

// ── stage 2: a workspace is chosen, so the composer is live ───────────────────
// The landing page's composer is DISABLED until a workspace is selected ("Choose a workspace to
// start"), and the picker behind that control is a NATIVE directory dialog a headless browser cannot
// drive. The entrypoint therefore registers the scratch workspace in the harness's own store BEFORE
// the boot; this stage proves the GUI picked it up, and drives the picker when the app still asks.
await stage("ui.workspaceSelected", "a workspace is selected in the GUI, so the session composer is live",
  async () => {
    /** Whether the composer is already reachable — the happy path when one workspace is registered. */
    const ready = async (): Promise<boolean> => (await resolveComposer()) !== undefined
    if (!await ready()) {
      /** The workspace chooser on the landing page. */
      const chooser = page.getByText(/choose workspace/i).first()
      if (await chooser.count() > 0) {
        await chooser.click({ timeout: 6000, force: true }).catch(() => {})
        await page.waitForTimeout(2500)
        // The entry is titled `ws` by the fixture; the other two labels are the fallbacks a person
        // would reach for (the workspace group, then the sidebar's own workspace heading).
        for (const label of [/^ws$/i, /ungrouped/i, /^workspaces$/i]) {
          /** One candidate workspace row in the picker. */
          const entry = page.getByText(label).first()
          if (await entry.count() === 0) continue
          await entry.click({ timeout: 6000, force: true }).catch(() => {})
          await page.waitForTimeout(2500)
          if (await ready()) break
        }
      }
    }
    /** The page text quoted on failure, so the screenshot and the reason agree. */
    const text = await bodyText(1500)
    await shot("ui-01b-workspace")
    if (!await ready()) throw new Error(`the composer never became reachable after selecting a workspace; the page shows ${JSON.stringify(text.slice(0, 200))}`)
    return `placeholders=${COMPOSER_PLACEHOLDERS.join(" | ")}`
  })

// ── stage 3: the composer is present and accepts input ────────────────────────
/** Whether the composer was found; later stages depend on it. */
let composerFound = false
await stage("ui.composerPresent", "the prompt composer exists and is editable — the entry point of every turn",
  async () => {
    /** The composer input this stage clicks into. */
    const box = await resolveComposer()
    if (box === undefined) throw new Error(`no VISIBLE composer was found; tried placeholders ${JSON.stringify(COMPOSER_PLACEHOLDERS)}, contenteditable, textarea and six textbox roles; the page had ${await describeInputs()}`)
    await box.click({ timeout: 5000 })
    composerFound = true
    return `placeholders=${COMPOSER_PLACEHOLDERS.join(" | ")}`
  })

// ── stage 4: TYPE a prompt and SEND it — the real usability proof ─────────────
/** The body text captured immediately before the send, so "did the transcript change" is measurable. */
let beforeSend = ""
await stage("ui.promptSent", "a prompt was typed into the composer and sent through the real UI",
  async () => {
    if (!composerFound) throw new Error("no composer was found, so nothing could be typed")
    /** The composer input, re-resolved because the page may have re-rendered. */
    const box = await resolveComposer()
    if (box === undefined) throw new Error("the composer disappeared between stages")
    await box.click({ timeout: 5000 })
    await box.fill(PROMPT)
    await page.waitForTimeout(500)
    beforeSend = await bodyText(6000)
    /** The send control, or a locator that matches nothing when it is absent. */
    const send = page.getByRole("button", { name: SEND_LABEL, exact: true }).first()
    if (await send.count() > 0) await send.click({ timeout: 8000, force: true })
    else await page.keyboard.press("Enter")
    await page.waitForTimeout(2500)
    await shot("ui-02-sent")
    // The prompt must be VISIBLE as a sent message, not merely typed: a composer that keeps the text
    // (because the click missed) would otherwise read as a successful send.
    const after = await bodyText(6000)
    if (!after.includes("mpd_config_get")) throw new Error("the prompt text never appeared in the transcript after send")
    return `promptChars=${PROMPT.length}`
  })

// ── stage 5: the answer renders — a turn really ran through the GUI ───────────
await stage("ui.replyRendered", "the transcript changed after the send and shows the turn's own output",
  async () => {
    if (!composerFound) throw new Error("no composer was found, so no turn could be driven")
    /** The instant the wait for a rendered reply gives up. */
    const deadline = Date.now() + BUDGET_MS
    /** The last text seen, so the failure report quotes what the screen really said. */
    let seen = ""
    while (Date.now() < deadline) {
      seen = await bodyText(8000)
      // The reply is the model's own `DONE` (the prompt asks for exactly that) OR a rendered tool
      // call for the tool we asked it to use. Either is proof the turn ran IN THE GUI.
      if (/\bDONE\b/.test(seen) || /mpd_config_get[\s\S]{0,200}(result|ok)/i.test(seen)) break
      await page.waitForTimeout(2500)
    }
    await shot("ui-03-reply")
    /** Whether the transcript grew enough to count as a rendered turn. */
    const grew = seen.length > beforeSend.length + 40
    if (!/\bDONE\b/.test(seen) && !grew) throw new Error(`the transcript did not change after the send (before=${beforeSend.length} after=${seen.length} chars)`)
    return `before=${beforeSend.length} after=${seen.length} done=${/\bDONE\b/.test(seen)}`
  })

// ── stage 6: the Agent Teams sidebar panel (still on the session view) ────────
await stage("ui.teamPanel", "the right sidebar opens on the Agent Teams panel with its roster and board",
  async () => {
    // NO page.goto here: the session view stage 5 left open is where a right sidebar exists at all,
    // and reloading to the landing page would discard it.
    await page.waitForTimeout(1500)
    // EXACT name, not a loose regex: /sidebar/i matched "Collapse sidebar" first and collapsed the
    // LEFT rail instead (measured 2026-09-27 in docker/ui/capture.mts).
    let button = page.getByRole("button", { name: "Open right sidebar", exact: true }).first()
    if (await button.count() === 0) button = page.getByRole("button", { name: /right sidebar/i }).first()
    if (await button.count() === 0) throw new Error("no 'Open right sidebar' control was found")
    await button.click({ timeout: 6000, force: true }).catch(() => {})
    await page.waitForTimeout(3000)
    /** The Team tab inside the sidebar, when the host renders one. */
    const team = page.getByText(/^Team$/).first()
    if (await team.count() > 0) { await team.click({ timeout: 6000, force: true }).catch(() => {}); await page.waitForTimeout(2000) }
    /** The rendered panel text, quoted so a blank panel is visible in the verdict. */
    const text = await bodyText(3000)
    await shot("ui-05-team-panel")
    if (!/MEMBERS|TASKS|Team/i.test(text)) throw new Error("the sidebar opened but no team panel content was rendered")
    return `chars=${text.length} teamTab=${await team.count()}`
  })

// ── stage 7: the MPD settings section this bundle contributes ─────────────────
await stage("ui.mpdSettingsSection", "the MPD settings section registers and renders its card in Settings",
  async () => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(2500)
    await dismissGates()
    /** The Settings control in the app's navigation. */
    const settings = page.getByRole("button", { name: /^settings$/i }).first()
    if (await settings.count() === 0) throw new Error("no Settings control was found")
    await settings.click({ timeout: 6000, force: true })
    await page.waitForTimeout(2000)
    /** The MPD nav entry this bundle contributes to Settings. */
    const mpd = page.getByText(/^MPD$/).first()
    if (await mpd.count() === 0) throw new Error("the MPD settings nav entry is absent")
    await mpd.click({ timeout: 6000, force: true })
    await page.waitForTimeout(2500)
    /** The rendered settings text the card claim is judged on. */
    const text = await bodyText(4000)
    await shot("ui-04-mpd-settings")
    if (!/MPD bundle/i.test(text)) throw new Error("the MPD section opened but its card text is absent: " + JSON.stringify(text.slice(0, 200)))
    return `chars=${text.length}`
  })

// ── stage 8: a console-clean page — a GUI that throws is not a usable GUI ──────
await stage("ui.noConsoleErrors", "the browser reported no console errors and no uncaught page errors",
  async () => {
    if (consoleErrors.length > 0 || pageErrors.length > 0) {
      throw new Error(`console=${consoleErrors.length} page=${pageErrors.length} first=${(consoleErrors[0] ?? pageErrors[0] ?? "").slice(0, 160)}`)
    }
    return "console=0 page=0"
  })

await browser.close()

/** How many rows are FALSE; the lane's exit code is derived from this, never from the browser's. */
const failed = rows.filter((row) => row.ok === false).length
console.log(`[browser-lane] rows=${rows.length} failed=${failed} shots=${OUT}`)
process.exit(failed === 0 ? 0 : 1)
