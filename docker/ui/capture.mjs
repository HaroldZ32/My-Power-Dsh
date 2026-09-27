// docker/ui/capture.mjs — observe the Web GUI from INSIDE the container with its own headless
// browser, and write PNGs + a JSON report to the host bind mount.
//
// WHY: a UI review taken from component source or from `--dump-config` is a GUESS about what a
// person sees. This renders the real page with the real client bundles and hands back images.
// It runs INSIDE the container, which is also the only place the harness will bind a port.
//
// Usage (inside the container):
//   node /data/capture.mjs --base http://127.0.0.1:3080 --token <launch-token> --out /data-out/shots
import { chromium } from "playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const at = argv.indexOf("--" + name)
  return at >= 0 && argv[at + 1] !== undefined ? argv[at + 1] : fallback
}
const BASE = arg("base", "http://127.0.0.1:3080")
const TOKEN = arg("token", "")
const OUT = arg("out", "/data-out/shots")
const WORKSPACE = arg("workspace", "/data/ws")
const WIDTH = Number(arg("width", "1600"))
const HEIGHT = Number(arg("height", "1000"))
mkdirSync(OUT, { recursive: true })

const report = { base: BASE, workspace: WORKSPACE, viewport: [WIDTH, HEIGHT], steps: [], consoleErrors: [], pageErrors: [], failedRequests: [] }
const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] })
const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } })
const page = await context.newPage()
page.on("console", (m) => { if (m.type() === "error") report.consoleErrors.push(String(m.text()).slice(0, 250)) })
page.on("pageerror", (e) => report.pageErrors.push(String(e?.message ?? e).slice(0, 250)))
page.on("requestfailed", (r) => report.failedRequests.push(r.url().slice(0, 160) + " — " + String(r.failure()?.errorText)))

const shot = async (name) => { const file = join(OUT, name + ".png"); await page.screenshot({ path: file }); return file }
const step = async (name, fn) => {
  const entry = { name, ok: false }
  try { entry.file = await fn(); entry.ok = true } catch (e) { entry.error = String(e?.message ?? e).slice(0, 300) }
  report.steps.push(entry)
  return entry
}

// 1) LAUNCH: the token URL sets the browser-trust cookie (the only way in).
await step("01-launch", async () => {
  await page.goto(BASE + (TOKEN === "" ? "/" : "/?token=" + TOKEN), { waitUntil: "domcontentloaded", timeout: 45_000 })
  await page.waitForTimeout(4000)
  return shot("01-launch")
})
// 2) The first-run notice is a MODAL: everything behind it is unclickable until dismissed.
await step("02-notice-dismissed", async () => {
  const button = page.getByRole("button", { name: /continue/i }).first()
  if (await button.count() > 0) { await button.click({ timeout: 8000 }).catch(() => {}); await page.waitForTimeout(1500) }
  return shot("02-after-notice")
})
// 3) A session with an EXPLICIT workspace: without one the app answers
//    "Unable to create default workspace" and nothing else can be reviewed.
await step("03-session-created", async () => {
  // The harness stacks FIRST-RUN modals: the testing notice, then "Add an API key". Both
  // dim the app and swallow clicks, so both are cleared before anything is driven.
  for (const label of [/configure later/i, /continue/i]) {
    const button = page.getByRole("button", { name: label }).first()
    if (await button.count() > 0) { await button.click({ timeout: 6000 }).catch(() => {}); await page.waitForTimeout(1200) }
  }
  const result = await page.evaluate(async (cwd) => {
    const response = await fetch("/api/session/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "client-request", rpcId: "capture-" + Date.now(), method: "session/create", payload: { args: { request: { cwd, agentPreset: "mpd" } } } }),
    })
    return { status: response.status, body: (await response.text()).slice(0, 400) }
  }, WORKSPACE).catch((e) => ({ status: 0, body: String(e?.message ?? e) }))
  report.sessionCreate = result
  await page.goto(BASE, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(3500)
  return shot("03-home-with-session")
})
// 4) The RIGHT sidebar is the surface this bundle must contribute to. Capture it closed,
//    then open it through whatever the header actually renders.
await step("04-sidebar-open", async () => {
  // The first-run gates RE-APPEAR: the API-key modal returns after a reload and its overlay
  // swallows every click behind it (measured: "Open right sidebar" was in the control list and
  // the click did nothing). Clear it again, immediately before the click that matters.
  for (const label of [/configure later/i, /continue/i]) {
    const again = page.getByRole("button", { name: label }).first()
    if (await again.count() > 0) { await again.click({ timeout: 6000, force: true }).catch(() => {}); await page.waitForTimeout(1200) }
  }
  const labels = await page.evaluate(() => {
    const out = []
    for (const el of document.querySelectorAll("button,[role=button],[role=tab],a")) {
      const text = (el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || "").trim()
      if (text !== "") out.push(text.slice(0, 40))
    }
    return [...new Set(out)].slice(0, 80)
  })
  report.controls = labels
  // EXACT name, not a regex: a loose /sidebar/i matched "Collapse sidebar" first and collapsed
  // the LEFT rail instead of opening the right panel (measured 2026-09-27, screenshot 04).
  let candidate = page.getByRole("button", { name: "Open right sidebar", exact: true }).first()
  if (await candidate.count() === 0) candidate = page.getByRole("button", { name: /right sidebar/i }).first()
  if (await candidate.count() > 0) { await candidate.click({ timeout: 6000, force: true }).catch(() => {}); await page.waitForTimeout(3000) }
  // The guide page is what the kit draws for a column with no tabs open; its entry boxes are
  // how a user reaches a contributed type.
  const guide = page.getByText(/team/i).first()
  if (await guide.count() > 0) { await guide.click({ timeout: 5000, force: true }).catch(() => {}); await page.waitForTimeout(2500) }
  // What the sidebar actually offers: the tab strip and the guide's entry boxes.
  report.sidebarText = (await page.locator("body").innerText().catch(() => "")).slice(0, 1500)
  return shot("04-sidebar")
})
// 5) The settings surface, reached by clicking (the app is a SPA: /settings is a 404).
await step("05-settings", async () => {
  const settings = page.getByText(/^settings$/i).first()
  if (await settings.count() > 0) { await settings.click({ timeout: 6000 }).catch(() => {}); await page.waitForTimeout(3000) }
  return shot("05-settings")
})
// 5b) The section this bundle contributes, opened: a nav entry proves the REGISTRATION, the page
// proves the card renders its rows (they are different claims).
await step("05b-mpd-section", async () => {
  const entry = page.getByText(/^MPD$/, { exact: true }).first()
  if (await entry.count() > 0) { await entry.click({ timeout: 6000, force: true }).catch(() => {}); await page.waitForTimeout(2500) }
  report.mpdSectionText = (await page.locator("body").innerText().catch(() => "")).slice(0, 3000)
  return shot("05b-mpd-section")
})
await step("06-plugins", async () => {
  await page.goto(BASE, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(2000)
  const plugins = page.getByText(/^plugins$/i).first()
  if (await plugins.count() > 0) { await plugins.click({ timeout: 6000 }).catch(() => {}); await page.waitForTimeout(3000) }
  return shot("06-plugins")
})
report.visibleText = (await page.locator("body").innerText().catch(() => "")).slice(0, 3000)
await browser.close()
writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify({ steps: report.steps, sessionCreate: report.sessionCreate, controls: (report.controls || []).slice(0, 40), consoleErrors: report.consoleErrors.slice(0, 4), failedRequests: report.failedRequests.slice(0, 4) }, null, 1))
