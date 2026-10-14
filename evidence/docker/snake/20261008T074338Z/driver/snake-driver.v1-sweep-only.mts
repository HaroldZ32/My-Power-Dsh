#!/usr/bin/env node
// snake-driver.mts — the LANE-E2 black-box playability driver.
//
// WHY THIS FILE EXISTS: the acceptance question is not "did a model write a file somewhere" but "does
// the file that landed PLAY". NOTHING below reads the page's own source, and no assertion is derived
// from it: every verdict comes from VISIBLE page state (the body's innerText, the rendered screenshot)
// plus REAL keyboard input into a real Chromium. That is what makes this driver independent of the
// agent that produced the artifact.
//
// WHERE IT RUNS: inside a container beside playwright (the project's own UI lane keeps playwright
// 1.49.1 + its Chromium in the `ui_ui-data` volume), writing rows and screenshots into the
// bind-mounted evidence directory. Invocation:
//   node snake-driver.mts --page <file path> --out <dir> --label <name> [--budget-ms N]
//
// Exit code: 0 when every recorded row is true, 1 when any row is false, 2 when the browser never
// started. A row that could not be measured is `null` and never counts as a pass.
import { createRequire } from "node:module"
import { createHash } from "node:crypto"
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

// The tiny slice of the DOM these callbacks touch, declared locally because this driver lives outside
// the repository's DOM type program (it is evidence tooling, not a package source). `declare` is
// type-only and erased by Node's type stripping.
declare const document: {
  body: { innerText: string } | null
  querySelectorAll(selector: string): ArrayLike<{ innerText?: string; textContent?: string | null }>
}

/** One assertion row, in the same NDJSON shape the Docker lane's `record()` writes. */
interface Row {
  /** Assertion name, e.g. `snake.scoreIncreased`. */
  name: string
  /** true pass, false fail, null not measurable. */
  ok: boolean | null
  /** Human-readable reason, so a reddening row needs no JSON digging. */
  reason: string
  /** The observed values the verdict rests on. */
  raw: string
}

/** Subset of playwright's `ConsoleMessage` this driver reads. */
interface ConsoleMessageLike {
  /** The console method that produced the line (`"error"`, `"warning"`, `"log"`, ...). */
  type(): string
  /** The message text as the page rendered it. */
  text(): string
}

/** Subset of playwright's `Request` this driver reads, for the self-containment assertion. */
interface RequestLike {
  /** The absolute URL the page asked for. */
  url(): string
}

/** Subset of playwright's `Page` this driver uses. */
interface PageLike {
  /** Navigate, resolving when the requested lifecycle event fired. */
  goto(url: string, options?: { waitUntil?: "load" | "domcontentloaded" | "commit"; timeout?: number }): Promise<unknown>
  /** Subscribe to an uncaught page error. */
  on(event: "pageerror", handler: (error: Error) => void): unknown
  /** Subscribe to a console message. */
  on(event: "console", handler: (message: ConsoleMessageLike) => void): unknown
  /** Subscribe to an outgoing request. */
  on(event: "request", handler: (request: RequestLike) => void): unknown
  /** The page's keyboard, for REAL key events. */
  keyboard: { press(key: string, options?: { delay?: number }): Promise<void> }
  /** Sleep inside the page's event loop. */
  waitForTimeout(milliseconds: number): Promise<void>
  /** Render a PNG of the current viewport. */
  screenshot(options?: { path?: string; type?: "png"; fullPage?: boolean }): Promise<Buffer>
  /** Evaluate a function in the page's context. */
  evaluate<T>(pageFunction: () => T): Promise<T>
  /** The page's current URL. */
  url(): string
  /** Tear the page down. */
  close(): Promise<void>
}

/** Subset of playwright's `Browser` this driver uses. */
interface BrowserLike {
  /** A fresh independent browsing context. */
  newContext(options?: { viewport?: { width: number; height: number } }): Promise<{
    /** A blank page in this context. */
    newPage(): Promise<PageLike>
  }>
  /** The engine's own version string, e.g. `131.0.6778.33`. */
  version(): string
  /** Shut the browser down. */
  close(): Promise<void>
}

/** Subset of playwright's `chromium` launcher object this driver uses. */
interface ChromiumLike {
  /** Start a browser process. */
  launch(options?: { headless?: boolean; args?: string[] }): Promise<BrowserLike>
}

/** One steering instruction: which key, how many times, and the pause between presses. */
interface Step {
  /** A playwright key name (`ArrowRight`, `Enter`, ...). */
  key: string
  /** How many times the key is pressed. */
  repeat: number
  /** Milliseconds to wait after each press — roughly one game tick. */
  gapMs: number
}

/** The visible-number reading a score verdict is computed from. */
interface Reading {
  /** The number following a score-ish label, or null when no such label was visible. */
  labelled: number | null
  /** Every integer token in the visible text, in DOM order. */
  numbers: number[]
  /** The visible text itself, for the game-over checks. */
  text: string
}

// ── the patterns ──────────────────────────────────────────────────────────────
// A "simple sweep" per the contract. Each attempt walks one pattern; when the snake dies the driver
// restarts it and tries the next pattern, so coverage accumulates across lives rather than depending
// on one lucky route. The counts are deliberately SHORT of a typical 20-wide board: overshooting the
// wall ends the life, and a life that ends early has covered nothing.

/** Narrow boustrophedon: right, drop a row, left, drop a row. */
const PATTERN_SWEEP: Step[] = [
  { key: "ArrowRight", repeat: 7, gapMs: 140 },
  { key: "ArrowDown", repeat: 1, gapMs: 140 },
  { key: "ArrowLeft", repeat: 7, gapMs: 140 },
  { key: "ArrowDown", repeat: 1, gapMs: 140 }
]

/** The same sweep mirrored and one cell wider, so a second life explores a different band. */
const PATTERN_WIDE: Step[] = [
  { key: "ArrowLeft", repeat: 9, gapMs: 140 },
  { key: "ArrowDown", repeat: 2, gapMs: 140 },
  { key: "ArrowRight", repeat: 9, gapMs: 140 },
  { key: "ArrowDown", repeat: 2, gapMs: 140 }
]

/** A tight loop: stresses the game's own turn handling and never approaches a wall. */
const PATTERN_LOOP: Step[] = [
  { key: "ArrowRight", repeat: 3, gapMs: 160 },
  { key: "ArrowDown", repeat: 3, gapMs: 160 },
  { key: "ArrowLeft", repeat: 3, gapMs: 160 },
  { key: "ArrowUp", repeat: 3, gapMs: 160 }
]

/** Every pattern, in the order the driver rotates them across attempts. */
const PATTERNS: readonly Step[][] = [PATTERN_SWEEP, PATTERN_WIDE, PATTERN_LOOP]

/** Matches a game-over announcement, in the languages a 简体中文-locale run may produce. */
const OVER_RE = /game\s*over|you\s*(lost|died|crashed)|游戏结束|游戏终止|\bgameover\b/i
/** Matches a restart affordance (a hint line or a control the page renders). */
const RESTART_RE = /restart|play\s*again|try\s*again|new\s*game|press\s+(enter|r\b|space)|按\s*(回车|r\b|空格)|重新开始|再玩/i

/** Read `--<flag> <value>` off the command line, or `fallback` when absent/valueless. */
function arg(flag: string, fallback: string = ""): string {
  /** Index of the flag token, or -1 when the caller never passed it. */
  const index = process.argv.indexOf("--" + flag)
  return index === -1 || index + 1 >= process.argv.length ? fallback : process.argv[index + 1]
}

/** The UTF-8 sha256 of a buffer, as lowercase hex. */
function sha256(buffer: Uint8Array): string {
  return createHash("sha256").update(buffer).digest("hex")
}

/** Every integer token in a string, in the order it appears. */
function integersIn(text: string): number[] {
  /** The collected values. */
  const out: number[] = []
  /** The shared matcher, reused so the loop allocates once. */
  const re = /-?\d+/g
  /** The current match, or null when the scan is done. */
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) out.push(Number(match[0]))
  return out
}

/** The number following a score-ish label, or null when the text carries no such label. */
function labelledScore(text: string): number | null {
  /** The first score/points label and the digits that follow it. */
  const match = text.match(/(?:score|points|得分|分数|分)\s*[:：=]?\s*(\d+)/i)
  return match === null ? null : Number(match[1])
}

/** Turn one snapshot of the visible text into a reading the score verdicts use. */
function readingOf(text: string): Reading {
  return { labelled: labelledScore(text), numbers: integersIn(text), text }
}

/** The paired-index increase between two readings of the same page, if exactly one token grew. */
function pairedIncrease(before: number[], after: number[]): { grew: boolean; index: number; from: number; to: number } {
  if (before.length !== after.length) return { grew: false, index: -1, from: 0, to: 0 }
  /** How many positions differ; more than one means the layout itself changed, not a counter. */
  let differing = 0
  /** The position that grew, or -1 while none has. */
  let grown = -1
  for (let index = 0; index < before.length; index += 1) {
    if (before[index] === after[index]) continue
    differing += 1
    if (after[index] > before[index]) grown = index
  }
  return differing === 1 && grown >= 0
    ? { grew: true, index: grown, from: before[grown], to: after[grown] }
    : { grew: false, index: -1, from: 0, to: 0 }
}

/** Read the page's visible text through the DOM the browser actually rendered. */
async function bodyText(page: PageLike): Promise<string> {
  return await page.evaluate(() => (document.body === null ? "" : document.body.innerText))
}

/** Read the visible text of every button-ish control, for the restart-affordance check. */
async function controlText(page: PageLike): Promise<string> {
  return await page.evaluate(() => {
    /** Every control whose label a user could read as an affordance. */
    const nodes = document.querySelectorAll("button, a, [role=button], [onclick]")
    /** The collected labels. */
    const labels: string[] = []
    for (let index = 0; index < nodes.length; index += 1) {
      /** The label the browser would render for this control. */
      const label = nodes[index].innerText ?? nodes[index].textContent ?? ""
      if (label.trim() !== "") labels.push(label.trim())
    }
    return labels.join(" | ")
  })
}

// ── the driver ────────────────────────────────────────────────────────────────

/** Absolute path of the page under test, as the caller passed it. */
const PAGE_PATH = resolve(arg("page"))
/** Evidence directory the rows and screenshots are written into. */
const OUT_DIR = resolve(arg("out", "."))
/** Label distinguishing this run's artifacts from the negative control's. */
const LABEL = arg("label", "run")
/** Wall-clock budget for the steering phase, in milliseconds. */
const BUDGET_MS = Number(arg("budget-ms", "90000"))
/** Optional free-text note recorded on every row, e.g. which artifact this run drove. */
const NOTE = arg("note", "")

mkdirSync(OUT_DIR, { recursive: true })
/** The NDJSON assertion ledger for this label. */
const ROW_FILE = join(OUT_DIR, LABEL + ".ndjson")
writeFileSync(ROW_FILE, "")

/** The accumulated rows, in emission order. */
const rows: Row[] = []

/** Append one row to the ledger and echo it to stdout. */
function record(name: string, ok: boolean | null, reason: string, raw: string): void {
  /** The row as recorded. */
  const row: Row = { name, ok, reason, raw: NOTE === "" ? raw : raw + " | note=" + NOTE }
  rows.push(row)
  appendFileSync(ROW_FILE, JSON.stringify(row) + "\n")
  console.log(`[${ok === true ? "PASS" : ok === false ? "FAIL" : "NULL"}] ${name}: ${reason} :: ${row.raw}`)
}

/** Screenshot into the evidence dir and return its bytes plus their hash. */
async function shoot(page: PageLike, name: string): Promise<{ path: string; sha: string; bytes: number }> {
  /** Where the PNG lands. */
  const path = join(OUT_DIR, LABEL + "-" + name + ".png")
  /** The rendered bytes. */
  const buffer = await page.screenshot({ path, type: "png" })
  return { path, sha: sha256(buffer), bytes: buffer.length }
}

// The playwright surface is loaded through `createRequire` on purpose: playwright is installed in the
// CONTAINER beside this file's `node_modules` symlink, never in the repository, so a static import
// could not resolve and would not typecheck.
/** CommonJS require bound to this module, so the container's playwright can be loaded by path. */
const requireFromHere = createRequire(import.meta.url)
/** The resolved playwright entry point, or null when the toolchain is absent. */
let chromium: ChromiumLike | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  chromium = (requireFromHere("playwright") as { chromium: ChromiumLike }).chromium
} catch (error) {
  record("snake.driverStarted", false, "playwright did not resolve from this file's node_modules", String(error).slice(0, 300))
  console.log("driver-exit=2")
  process.exit(2)
}

/** The launcher, once the try/catch above proved it exists. */
const launcher: ChromiumLike = chromium as ChromiumLike

/** Everything the assertions are computed from, gathered in one pass. */
const pageErrors: string[] = []
/** Console errors the page emitted (a page that throws into the console is not a healthy page). */
const consoleErrors: string[] = []
/** Every URL the page requested, in order. */
const requests: string[] = []

/** The browser, or null when the launch itself failed. */
let browser: BrowserLike | null = null
try {
  browser = await launcher.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
} catch (error) {
  record("snake.browserLaunched", false, "chromium did not start inside this container", String(error).slice(0, 400))
  console.log("driver-exit=2")
  process.exit(2)
}
/** The started browser. */
const running: BrowserLike = browser

/** A fresh context; the viewport is fixed so screenshots are comparable byte-for-byte. */
const context = await running.newContext({ viewport: { width: 900, height: 700 } })
/** The page under test. */
const page = await context.newPage()
page.on("pageerror", (error) => { pageErrors.push(String(error)) })
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()) })
page.on("request", (request) => { requests.push(request.url()) })

record("snake.driverStarted", true, "chromium launched and the page opened in a real engine", `browser=${running.version()} page=${pathToFileURL(PAGE_PATH).href}`)

try {
  await page.goto(pathToFileURL(PAGE_PATH).href, { waitUntil: "load", timeout: 20000 })
} catch (error) {
  record("snake.loaded", false, "the page never reached its load event", String(error).slice(0, 300))
  await running.close()
  console.log("driver-exit=1")
  process.exit(1)
}
await page.waitForTimeout(900)

/** The visible-text reading before any input. */
const startReading = readingOf(await bodyText(page))
/** The controls visible before any input, for the restart-affordance comparison. */
const startControls = await controlText(page)
/** The screenshot at rest, before the first key. */
const shotStart = await shoot(page, "01-start")

// ── assertion 1 (precondition of the score arm): a visible score number exists ─
record(
  "snake.scoreVisible",
  startReading.labelled !== null || startReading.numbers.length > 0,
  startReading.labelled !== null
    ? "a score-labelled number is visible on the page"
    : startReading.numbers.length > 0
      ? "no score label, but numeric counters are visible (the score arm falls back to paired-token growth)"
      : "the page shows NO number at all: a game whose score a player cannot see is a finding",
  `labelled=${startReading.labelled} numbers=[${startReading.numbers.join(",").slice(0, 120)}] chars=${startReading.text.length}`
)

// ── assertion (c) probe: the picture changes once the snake is driven ────────
await page.keyboard.press("ArrowRight")
await page.waitForTimeout(600)
/** The screenshot after the first real key press. */
const shotMoved = await shoot(page, "02-after-first-key")
/** Whether the rendered picture differs from the at-rest one. */
const moved = shotMoved.sha !== shotStart.sha

// ── the steering phase: sweep until the score grows, restarting dead lives ───
/** Epoch ms after which steering stops, whether or not the score grew. */
const deadline = Date.now() + BUDGET_MS
/** How many times a game-over state was seen and a restart was attempted. */
let restarts = 0
/** The reading that the score comparisons are made against; refreshed after each restart. */
let baseline = startReading
/** Set once a strict score increase is observed. */
let scoreGrew = false
/** Which method established the increase. */
let scoreMethod = "none"
/** The before/after values quoted into the score row. */
let scoreDelta = "from=0 to=0"
/** When the score grew, the screenshot of that moment. */
let shotEaten: { path: string; sha: string; bytes: number } | null = null

/** How many steering attempts have run, which also selects the pattern. */
let attempt = 0
while (!scoreGrew && Date.now() < deadline) {
  /** The pattern this attempt walks. */
  const pattern = PATTERNS[attempt % PATTERNS.length]
  attempt += 1
  console.log(`[drive] attempt=${attempt} pattern=${attempt % PATTERNS.length} at=${Date.now() - (deadline - BUDGET_MS)}ms`)
  for (const step of pattern) {
    for (let press = 0; press < step.repeat; press += 1) {
      if (scoreGrew || Date.now() > deadline) break
      await page.keyboard.press(step.key)
      await page.waitForTimeout(step.gapMs)
      if (press % 3 !== 2) continue
      /** The page's visible text at this probe. */
      const text = await bodyText(page)
      /** The reading derived from it. */
      const now = readingOf(text)
      if (now.labelled !== null && baseline.labelled !== null && now.labelled > baseline.labelled) {
        scoreGrew = true
        scoreMethod = "labelled"
        scoreDelta = `from=${baseline.labelled} to=${now.labelled}`
        shotEaten = await shoot(page, "03-after-eating")
        break
      }
      /** The paired-token increase, used when no score label is visible. */
      const paired = pairedIncrease(baseline.numbers, now.numbers)
      if (now.labelled === null && paired.grew) {
        scoreGrew = true
        scoreMethod = "paired-token"
        scoreDelta = `idx=${paired.index} from=${paired.from} to=${paired.to}`
        shotEaten = await shoot(page, "03-after-eating")
        break
      }
      if (OVER_RE.test(text)) {
        restarts += 1
        console.log(`[drive] game over detected mid-sweep; restart #${restarts}`)
        await page.keyboard.press("Enter")
        await page.waitForTimeout(350)
        await page.keyboard.press("r")
        await page.waitForTimeout(700)
        baseline = readingOf(await bodyText(page))
      }
    }
    if (scoreGrew || Date.now() > deadline) break
  }
}

record(
  "snake.scoreIncreased",
  scoreGrew,
  scoreGrew
    ? `the visible score grew while the snake was driven with real key events (method=${scoreMethod})`
    : `the score never grew in ${BUDGET_MS}ms of driving (attempts=${attempt} restarts=${restarts}) — the snake never reached its own food`,
  `${scoreDelta} restarts=${restarts} attempts=${attempt}`
)

record(
  "snake.visuallyMoved",
  moved,
  moved
    ? "the rendered viewport changed after a real key press (the snake is drawn where the game moved it)"
    : "the rendered viewport is IDENTICAL before and after a real key press — the picture never moved",
  `start=${shotStart.sha.slice(0, 16)}/${shotStart.bytes}B after=${shotMoved.sha.slice(0, 16)}/${shotMoved.bytes}B`
)

// ── assertion (d): steer into a wall and require a game-over state or a stop ──
/** The visible-text reading the wall drive starts from. */
const preWall = readingOf(await bodyText(page))
/** The screenshot the wall drive starts from. */
const shotPreWall = await shoot(page, "04-before-wall")
/** Set when a game-over announcement appears that the resting page did not carry. */
let overSeen = false
/** The final visible text of the wall drive. */
let wallText = preWall.text
for (let press = 0; press < 45; press += 1) {
  await page.keyboard.press("ArrowRight")
  await page.waitForTimeout(170)
  wallText = await bodyText(page)
  if (OVER_RE.test(wallText) && !OVER_RE.test(preWall.text)) { overSeen = true; break }
}
// A game that wraps at the wall (instead of dying) needs the self-collision route before the arm can
// be judged; a tight loop is the black-box way to ask for it without reading the source.
if (!overSeen) {
  for (let round = 0; round < 6 && !overSeen; round += 1) {
    for (const key of ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"]) {
      for (let press = 0; press < 3; press += 1) {
        await page.keyboard.press(key)
        await page.waitForTimeout(150)
        wallText = await bodyText(page)
        if (OVER_RE.test(wallText) && !OVER_RE.test(preWall.text)) { overSeen = true; break }
      }
      if (overSeen) break
    }
  }
}
/** The reading after the wall drive settled. */
const afterWall = readingOf(wallText)
/** Whether the score counter stopped over the wall drive. */
const scoreStopped = afterWall.labelled !== null && preWall.labelled !== null
  ? afterWall.labelled === preWall.labelled
  : JSON.stringify(afterWall.numbers) === JSON.stringify(preWall.numbers)
/** The controls visible after the wall drive. */
const afterControls = await controlText(page)
/** Whether a restart affordance is visible now. */
const restartAffordance = RESTART_RE.test(afterWall.text) || RESTART_RE.test(afterControls)
/** Which of the two contract branches carried the verdict. */
const overBranch = overSeen ? "game-over-text" : scoreStopped && restartAffordance ? "score-stopped+restart-affordance" : "none"
/** The screenshot of the final state, labelled by what it actually shows. */
const shotEnd = await shoot(page, overSeen ? "05-game-over" : "05-final")

record(
  "snake.gameOverOrRestart",
  overSeen || (scoreStopped && restartAffordance),
  overSeen
    ? "driving into the wall produced a game-over announcement the resting page did not carry"
    : scoreStopped && restartAffordance
      ? "the score stopped and the page offers a restart affordance"
      : "after steering into the wall the page neither announced a game over nor stopped the score with a restart affordance",
  `branch=${overBranch} overSeen=${overSeen} scoreStopped=${scoreStopped} restartAffordance=${restartAffordance} wallChars=${wallText.length}`
)

// ── assertion (a): no uncaught page error over the whole run ─────────────────
record(
  "snake.noPageError",
  pageErrors.length === 0 && consoleErrors.length === 0,
  pageErrors.length === 0 && consoleErrors.length === 0
    ? "no uncaught page error and no console error over the whole run"
    : "the page raised errors while it was being played",
  `pageErrors=${pageErrors.length} consoleErrors=${consoleErrors.length} first=${(pageErrors[0] ?? consoleErrors[0] ?? "").slice(0, 160)}`
)

// ── E2-b support: the page is self-contained (it fetched nothing external) ───
/** Every request that is not a local file, an inline data URL or a blob. */
const external = requests.filter((url) => !/^(file|data|blob|about):/.test(url))
record(
  "snake.selfContained",
  external.length === 0,
  external.length === 0
    ? "the page requested nothing but local file/data URLs — no network fetch, no external file"
    : "the page fetched external resources, so it is not self-contained",
  `requests=${requests.length} external=${external.length} first=${(external[0] ?? "").slice(0, 160)}`
)

/** Only the screenshots of the three mandated moments, in order. */
const shots = [shotStart.path, (shotEaten ?? shotMoved).path, shotEnd.path]
record(
  "snake.screenshots",
  true,
  "the three mandated moments were captured (start / after eating or after the first key / final state)",
  shots.join(" , ")
)

await running.close()

/** How many rows came out FALSE; the exit code is derived from this and never from the browser's. */
const failed = rows.filter((row) => row.ok === false).length
console.log(`[snake-driver] label=${LABEL} rows=${rows.length} failed=${failed}`)
console.log("driver-exit=" + (failed === 0 ? 0 : 1))
process.exit(failed === 0 ? 0 : 1)
