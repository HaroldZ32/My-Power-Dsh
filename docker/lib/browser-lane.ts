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
// THE SETTINGS ENTRY POINT IS A CLICK ON THE HOST'S OWN LAUNCHER, NOT A BUTTON LABEL (measured
// 2026-10-17): a signed-out container's rail renders the host ACCOUNT MENU whose VISIBLE text is
// "… More" and whose ACCESSIBLE NAME is "Account menu" (`aria-label={t("menu")}`), so a query for a
// button named "Settings" matches nothing and a fallback keyed on the visible "More" text never runs.
// Stage 7 therefore clicks that launcher and then the menu's own "Settings" item — matching the ARIA
// label, not the visible text — and keeps the host's `settings.open` shortcut (Control+Comma) as the
// LAST resort, because a headless page does not guarantee that a key press reaches the shortcut
// manager. Every attempt is screenshotted before and after and recorded in `<out>/settings-open.txt`,
// and every failure NAMES what was tried and dumps the MPD client's `[mpd] …` console lines to
// `<out>/mpd-console.txt` — so the next red says which leg failed and on what screen, without a
// second Docker cycle. NOTE: the card mounts at PAGE LOAD (its slot is declared at boot), so a
// `[mpd] settings section:` line proves the CARD registered, never that the dialog opened.
//
// The verdict is never the model's prose: `ui.replyRendered` asks whether the TRANSCRIPT rendered the
// turn's OWN output — the answer the prompt asked for as a line of its own, or a rendered call of the
// tool it asked for — judged by `docker/lib/reply-verdict.ts`, which also refuses the prompt's own
// `DONE` and the turn's failure panel (FINDING F1, 2026-10-14: the pre-fix predicate greened on both).
// The companion `live.web.*` rows (docker/lib/live-verdict.ts) read the session store for what the
// agent actually did.
//
// USAGE (inside the container, from a directory where `playwright` resolves)
//   node browser-lane.ts --base http://127.0.0.1:3080 --token <token> --workspace /work/ws
//                        --out /out/ui-shots --state /work/assertions.ndjson [--budget-ms 240000]
//
// Exit code: 0 when every recorded row is true, 1 when any is false, 2 when the browser never started.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { judgeReply } from "./reply-verdict.ts"
import type { ReplyVerdict } from "./reply-verdict.ts"

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
/**
 * Every console line the MPD client emitted (`[mpd] …`), captured from page load on.
 *
 * WHY THIS EXISTS (measured 2026-10-17): the failed `ui.mpdSettingsSection` run raised
 * "no Settings control was found" — a sentence that cannot distinguish "the dialog never opened"
 * from "the card never registered", and cost a whole Docker cycle plus a wrong hypothesis. The card
 * prints its own mount outcome (`[mpd] settings section: form status=…` on success,
 * `… exposes no configForms service …` / `… could not mount …` on failure), so keeping those lines
 * turns the NEXT red into a self-explaining row. Bounded: one minified stack cannot flood it.
 */
const consoleMpd: string[] = []
/** How many `[mpd]` console lines are retained for a failure verdict (the tail is the interesting end). */
const MPD_CONSOLE_LIMIT = 32

/** Append one row to the state file and echo it the way the entrypoint's `record()` does. */
function record(row: UiRow): void {
  rows.push(row)
  /** The escaped-JSON form of `text`, so no control character reaches the state file. */
  const jsonEscape = (text: string): string => JSON.stringify(text).slice(1, -1)
  if (STATE !== "") appendFileSync(STATE, `{"name":"${jsonEscape(row.name)}","ok":${row.ok === null ? "null" : row.ok},"reason":"${jsonEscape(row.reason)}","raw":"${jsonEscape(row.raw)}"}\n`)
  console.log(`[record] ${row.name}=${row.ok === null ? "null" : row.ok} — ${row.reason}`)
}

/** One stage's outcome: a pass observation, or a DECLARED BOUND the run must report as `null`. */
type StageResult = string | { readonly bound: string; readonly raw: string }

/** Run one stage, turning a throw into a FAILED row instead of an aborted lane. */
async function stage(name: string, reason: string, fn: () => Promise<StageResult>): Promise<void> {
  try {
    /** The stage's return value: a pass observation, or a declared bound with its own reason. */
    const raw = await fn()
    // A BOUND IS NOT A PASS (`null` with its reason, the shape the credential-free `live.*` rows use):
    // the stage measured that the prerequisite is missing, which is neither a green nor a bundle defect.
    if (typeof raw === "string") record({ name, ok: true, reason, raw })
    else record({ name, ok: null, reason: raw.bound, raw: raw.raw })
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
page.on("console", (message) => {
  /** This line's text, capped so one minified stack cannot bloat the state file. */
  const text = String(message.text())
  if (message.type() === "error") consoleErrors.push(text.slice(0, 250))
  // THE MPD CLIENT'S OWN DIAGNOSTICS: the settings card prints exactly one mount line, so a red
  // stage can say whether the card REGISTERED (the line exists) or never mounted (it does not).
  if (text.includes("[mpd]")) {
    consoleMpd.push(text.slice(0, 250))
    if (consoleMpd.length > MPD_CONSOLE_LIMIT) consoleMpd.shift()
  }
})
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
await stage("ui.replyRendered", "the transcript rendered the turn's OWN output — the answer the prompt asked for as a line of its own, or a rendered call of the tool it asked for",
  async (): Promise<StageResult> => {
    if (!composerFound) throw new Error("no composer was found, so no turn could be driven")
    /** The instant the wait for a rendered reply gives up. */
    const deadline = Date.now() + BUDGET_MS
    /** The last text seen, so the failure report quotes what the screen really said. */
    let seen = ""
    /** The verdict this stage's row is recorded from, re-read from the LATEST capture every round. */
    let verdict: ReplyVerdict = judgeReply({ before: beforeSend, after: seen, prompt: PROMPT })
    while (Date.now() < deadline) {
      seen = await bodyText(8000)
      verdict = judgeReply({ before: beforeSend, after: seen, prompt: PROMPT })
      // TWO terminal states, and BOTH end the wait: a rendered turn output (judged by the shared
      // classifier), and the turn's failure panel — the GUI paints that when the turn has ENDED, so
      // waiting out the budget cannot produce a reply after it. The PROMPT's own `DONE` is not one of
      // them: it is echoed into the user's bubble the moment the message is sent, which is the exact
      // false green FINDING F1 reports (`before=225 after=619 done=true`, `ui-02`/`ui-03` byte-identical).
      if (verdict.kind === "reply" || verdict.failure !== "") break
      await page.waitForTimeout(2500)
    }
    await shot("ui-03-reply")
    if (verdict.kind === "reply") return verdict.raw
    if (verdict.kind === "credential-bound") {
      // THE HONEST OUTCOME IN A CREDENTIAL-FREE CONTAINER: no reply rendered, and the panel names the
      // missing prerequisite — so the row is a DECLARED BOUND (`null` with this reason), never a green.
      return {
        bound: `DECLARED BOUND — no reply was rendered: the turn's failure panel names the missing credential (${verdict.credential}) and this container stages none, so no model turn could run. ${verdict.detail}`,
        raw: verdict.raw,
      }
    }
    throw new Error(`no reply was rendered: ${verdict.detail} (${verdict.raw})`)
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

// ── the host's Settings dialog: CLICK FIRST, shortcut second ───────────────────
//
// THE DIALOG IS OPENED BY A REAL CLICK ON A CONTROL THE HOST RENDERS; the keyboard command is only
// the fallback. TWO Docker runs taught this, so both lessons are written down here:
//   1. The rail's bottom control is the host's ACCOUNT MENU. Its VISIBLE text is "… More" when
//      signed out (`signedIn ? label : t("more")`), but its ACCESSIBLE NAME is
//      `aria-label={t("menu")}` = "Account menu" — an aria-label overrides the visible text for the
//      accessible-name query, so the lane's earlier candidates ("More"/"Settings"/"Account") matched
//      NOTHING and the fallback loop never ran (`tried: Ctrl+Comma` alone in the 2026-10-17 artifact).
//      The menu's first item is `{ id: "settings", label: t("settings") }`.
//   2. `Control+Comma` is the host's registered `settings.open` command (aliases settings/preferences,
//      identical in both target generations), but a headless page does not guarantee that a key press
//      reaches the SPA's shortcut manager, so it is kept as the LAST resort, not the primary.
// EVERY attempt is screenshotted BEFORE and AFTER and recorded in `<out>/settings-open.txt`, so the
// next red names the leg that failed and shows the screen it failed on.
//
// NOTE ON THE CONSOLE: the settings card mounts at PAGE LOAD (the `settings.section` slot is declared
// at boot), so `[mpd] settings section: …` lines prove the CARD registered — not that the dialog
// opened. The open signal below is the host's OWN section nav, never our card.

/** How long one dialog probe waits for an open marker to appear. */
const DIALOG_PROBE_MS = 2000
/** How long a single click may take before the entry point counts as failed. */
const DIALOG_CLICK_MS = 5000

/**
 * The host-owned labels that prove the settings dialog is OPEN.
 *
 * The shipped settings clients register these section-nav entries in every measured build; the probe
 * accepts the FIRST one visible, so a release that renames one label does not hide an open dialog.
 */
const DIALOG_MARKERS: readonly string[] = ["General", "Built-in plugins", "Agent presets"]

/**
 * The launcher candidates, each with the short name the trace and the row use for it.
 *
 * "Account menu" is the MEASURED accessible name (`aria-label={t("menu")}`); the rest are kept for a
 * build that rewords that aria label. The visible "More" text is deliberately NOT relied on.
 */
const LAUNCHER_CANDIDATES: readonly { readonly name: string; readonly match: RegExp }[] = [
  { name: "Account menu", match: /^account menu$/i },
  { name: "More", match: /^more$/i },
  { name: "Settings", match: /^settings$/i },
  { name: "Account", match: /^account$/i },
]

/** One dialog-open attempt's record: what was tried, which marker fired, and the two screenshots. */
interface OpenAttempt {
  /** The short attempt name, quoted in the row and in the trace file. */
  readonly name: string
  /** The open marker that became visible, or "none". */
  readonly marker: string
  /** The before/after screenshot paths. */
  readonly shots: readonly string[]
}

/** Every dialog-open attempt this run made, in order. */
const openAttempts: OpenAttempt[] = []

/**
 * Wait until one locator is attached AND visible.
 * @param locator - the locator to probe.
 * @param budgetMs - how long to keep probing before answering false.
 * @returns whether it became visible inside the budget.
 */
async function waitVisible(locator: LocatorLike, budgetMs: number): Promise<boolean> {
  /** The instant this probe gives up; `waitForTimeout` is the only sleep this lane has. */
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    if (await locator.count() > 0 && await locator.isVisible().catch(() => false)) return true
    await page.waitForTimeout(200)
  }
  return false
}

/**
 * The host's own settings-nav entry with this label, matched as a whole visible line.
 * @param label - the nav label as the host renders it (`General`, `MPD`, …).
 * @returns the first matching locator.
 */
function settingsNavItem(label: string): LocatorLike {
  return page.getByText(new RegExp("^" + label + "$", "i")).first()
}

/**
 * One compact excerpt of the `[mpd]` console lines, for a row's `raw` field.
 *
 * The row's `raw` is capped at 300 characters by {@link stage}, and the diagnostic must SURVIVE that
 * cap, so the excerpt is deliberately short: a couple of lines, each flattened and clipped.
 * @param limit - how many trailing lines to include.
 * @returns the excerpt, or the explicit "none" sentence when the client emitted nothing.
 */
function mpdConsoleExcerpt(limit: number = 2): string {
  if (consoleMpd.length === 0) return "page console carried no [mpd] line"
  /** The trailing lines, flattened and shortened so the excerpt stays one readable row value. */
  const lines = consoleMpd.slice(-limit).map((line: string): string => line.replace(/\s+/gu, " ").slice(0, 64))
  return "[mpd]: " + lines.join(" | ")
}

/**
 * Write every captured `[mpd]` console line to `<OUT>/mpd-console.txt`.
 *
 * The row's `raw` field is capped at 300 characters by {@link stage}, so the FULL excerpt travels in
 * the mounted evidence tree beside the PNGs; the failure message names this path.
 * @returns the evidence file's path.
 */
function dumpMpdConsole(): string {
  /** The evidence file, beside the screenshots so it travels with the mounted tree. */
  const file = join(OUT, "mpd-console.txt")
  writeFileSync(file, consoleMpd.length === 0 ? "(no [mpd] console line was emitted)\n" : consoleMpd.join("\n") + "\n")
  return file
}

/**
 * Wait for ANY host-owned open marker: one visible section-nav label proves the dialog rendered.
 * @returns the marker label that became visible, or undefined when none did.
 */
async function settingsDialogMarker(): Promise<string | undefined> {
  for (const marker of DIALOG_MARKERS) {
    if (await waitVisible(settingsNavItem(marker), DIALOG_PROBE_MS)) return marker
  }
  return undefined
}

/**
 * Run ONE open attempt with a before/after screenshot and record its outcome.
 * @param name - the attempt's short name, quoted in the trace and the row.
 * @param slug - a file-name-safe form of the name, used in the screenshot names.
 * @param action - the click or key press this attempt performs.
 * @returns the open marker that fired, or undefined when the dialog stayed closed.
 */
async function attemptOpen(name: string, slug: string, action: () => Promise<void>): Promise<string | undefined> {
  /** This attempt's index, so the screenshot names sort in attempt order. */
  const index = String(openAttempts.length).padStart(2, "0")
  /** The screen BEFORE the attempt: what the entry point looked like when it was tried. */
  const before = await shot(`ui-04-open-${index}-${slug}-before`)
  await action()
  /** The host marker that proves the dialog rendered; undefined leaves the attempt recorded as "none". */
  const marker = await settingsDialogMarker()
  /** The screen AFTER the attempt (or after the probe budget, which IS the failing state). */
  const after = await shot(`ui-04-open-${index}-${slug}-after`)
  openAttempts.push({ name, marker: marker ?? "none", shots: [before, after] })
  return marker
}

/**
 * Write every open attempt to `<OUT>/settings-open.txt`.
 * @returns the evidence file's path.
 */
function dumpOpenTrace(): string {
  /** The evidence file, beside the screenshots and the console dump. */
  const file = join(OUT, "settings-open.txt")
  /** One line per attempt: its name, the marker that fired, and the two screenshots that show it. */
  const lines = openAttempts.map((attempt: OpenAttempt): string => `${attempt.name}: dialog=${attempt.marker} shots=${attempt.shots.join(",")}`)
  /** The probed marker vocabulary, printed so a renamed host label is diagnosable from the artifact. */
  const footer = `(open markers probed: ${DIALOG_MARKERS.join(", ")})\n`
  writeFileSync(file, (lines.length === 0 ? "(no open attempt was made)\n" : lines.join("\n") + "\n") + footer)
  return file
}

/**
 * One compact line naming the LAST attempts' outcomes, for the row's 300-character `raw`.
 * @param limit - how many trailing attempts to include.
 * @returns the trace excerpt, e.g. `Account menu->none, shortcut Ctrl+Comma->none`.
 */
function openTraceExcerpt(limit: number = 2): string {
  if (openAttempts.length === 0) return "no open attempt was made"
  return openAttempts.slice(-limit).map((attempt: OpenAttempt): string => `${attempt.name}->${attempt.marker}`).join(", ")
}

/**
 * The Settings menu item a launcher opened, clicked once it is visible.
 *
 * Role first (the host renders a real menu), then a plain text match for a build whose menu items are
 * not exposed with the `menuitem` role.
 * @returns nothing; the caller probes the open marker afterwards.
 */
async function clickSettingsMenuItem(): Promise<void> {
  /** The "Settings" item as a real menu item. */
  const item = page.getByRole("menuitem", { name: /^settings$/i }).first()
  if (await item.count() > 0 && await item.isVisible().catch(() => false)) {
    await item.click({ timeout: DIALOG_CLICK_MS, force: true }).catch(() => {})
    await page.waitForTimeout(1200)
    return
  }
  /** The same item found by visible text, when the menu exposes no menuitem role. */
  const byText = page.getByText(/^settings$/i).first()
  if (await byText.count() > 0 && await byText.isVisible().catch(() => false)) {
    await byText.click({ timeout: DIALOG_CLICK_MS, force: true }).catch(() => {})
    await page.waitForTimeout(1200)
  }
}

/**
 * Open the host's Settings dialog: the CLICK paths first, the keyboard shortcut last.
 *
 * The 2026-10-17 container run proved the shortcut alone cannot be trusted (a headless page does not
 * guarantee where a key press lands) and that the launcher must be matched by its ARIA label
 * ("Account menu"), not by the visible "More" text.
 * @returns the entry point that worked, named in the verdict (`launcher Account menu`, `shortcut …`).
 * @throws naming the attempt outcomes, the `[mpd]` console excerpt and both evidence files.
 */
async function openSettingsDialog(): Promise<string> {
  // Give the rail one bounded chance to PAINT the launcher before deciding it is absent: the SPA
  // renders the footer after its shell mounts, and the attempts below must not race that paint.
  await waitVisible(page.getByRole("button", { name: LAUNCHER_CANDIDATES[0].match }).first(), DIALOG_PROBE_MS)
  // PATH 1: the rail launcher — a real click, then the menu's own "Settings" item.
  for (const candidate of LAUNCHER_CANDIDATES) {
    /** The launcher button in the rail's footer, matched by ACCESSIBLE name. */
    const launcher = page.getByRole("button", { name: candidate.match }).first()
    if (await launcher.count() === 0) continue
    if (!(await launcher.isVisible().catch(() => false))) continue
    /** This attempt's screenshot slug, so the files say which spelling was clicked. */
    const slug = candidate.name.toLowerCase().replace(/[^a-z0-9]+/gu, "-")
    /** The marker this attempt produced, when it produced one. */
    const marker = await attemptOpen(candidate.name, slug, async (): Promise<void> => {
      await launcher.click({ timeout: DIALOG_CLICK_MS, force: true }).catch(() => {})
      await page.waitForTimeout(800)
      await clickSettingsMenuItem()
    })
    if (marker !== undefined) return `launcher ${candidate.name}`
    // A menu left open would swallow the next attempt's click, so close it before moving on.
    await page.keyboard.press("Escape").catch(() => {})
    await page.waitForTimeout(300)
  }
  // PATH 2 (LAST RESORT): the host's registered `settings.open` command. The body click gives the
  // document focus first, because a headless page does not guarantee where the key press lands.
  /** The marker the shortcut produced, when it produced one. */
  const shortcutMarker = await attemptOpen("shortcut Ctrl+Comma", "shortcut-ctrl-comma", async (): Promise<void> => {
    await page.locator("body").first().click({ timeout: DIALOG_CLICK_MS, force: true }).catch(() => {})
    await page.waitForTimeout(300)
    await page.keyboard.press("Control+Comma").catch(() => {})
    await page.waitForTimeout(1200)
  })
  if (shortcutMarker !== undefined) return "shortcut Ctrl+Comma"
  throw new Error(`the settings dialog did not open — last: ${openTraceExcerpt()}; open-trace=${dumpOpenTrace()}; mpd-console=${dumpMpdConsole()}; ${mpdConsoleExcerpt(1)}`)
}

// ── stage 7: the MPD settings section this bundle contributes ─────────────────
await stage("ui.mpdSettingsSection", "the MPD settings section registers and renders its card in Settings",
  async () => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(2500)
    await dismissGates()
    /** The entry point that opened the dialog, quoted in the pass line and in every failure below. */
    const openedBy = await openSettingsDialog()
    // The open trace is written as soon as the dialog is proven open, so it exists even when the MPD
    // assertion below fails and carries the attempt/marker/screenshot record with it.
    dumpOpenTrace()
    await page.waitForTimeout(1200)
    // SHOT BEFORE THE MPD CLICK: a dialog that opened with no MPD entry must still be readable
    // evidence (the old stage only screenshotted its success path, which is why the 0.2.1 red left
    // no picture of the settings screen at all).
    await shot("ui-04-mpd-settings-open")
    /** The MPD nav entry this bundle contributes to Settings. */
    const mpd = settingsNavItem("MPD")
    if (await mpd.count() === 0) {
      throw new Error(`no MPD settings nav entry after ${openedBy} — ${mpdConsoleExcerpt(1)}; open-trace=${dumpOpenTrace()}; mpd-console=${dumpMpdConsole()}`)
    }
    await mpd.click({ timeout: 6000, force: true })
    await page.waitForTimeout(2500)
    /** The rendered settings text the card claim is judged on. */
    const text = await bodyText(4000)
    await shot("ui-04-mpd-settings")
    if (!/MPD bundle/i.test(text)) {
      throw new Error(`the MPD section opened but its card text is absent after ${openedBy} — ${mpdConsoleExcerpt(1)}; open-trace=${dumpOpenTrace()}; mpd-console=${dumpMpdConsole()}`)
    }
    dumpMpdConsole()
    return `chars=${text.length} opened-by=${openedBy} open=${openTraceExcerpt(1)} mpd-console=${consoleMpd.length}`
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
