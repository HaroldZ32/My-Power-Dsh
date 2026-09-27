// docker/ui/capture.mjs — observe the Web GUI from INSIDE the container with its own headless
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
// Keep EVERY mpd line (not just errors): the settings card reports a degrade as a WARNING, and a
// warning-only failure is exactly the class that hid the empty inputs for two waves.
report.mpdConsole = []
page.on("console", (m) => {
  const text = String(m.text())
  if (m.type() === "error") report.consoleErrors.push(text.slice(0, 250))
  if (text.includes("[mpd")) report.mpdConsole.push(m.type() + ": " + text.slice(0, 240))
})
page.on("pageerror", (e) => report.pageErrors.push(String(e?.message ?? e).slice(0, 250)))
page.on("requestfailed", (r) => report.failedRequests.push(r.url().slice(0, 160) + " — " + String(r.failure()?.errorText)))

const shot = async (name) => { const file = join(OUT, name + ".png"); await page.screenshot({ path: file }); return file }
const step = async (name, fn) => {
  const entry = { name, ok: false }
  try { entry.file = await fn(); entry.ok = true } catch (e) { entry.error = String(e?.message ?? e).slice(0, 300) }
  report.steps.push(entry)
  return entry
}
const bodyText = async (limit = 2500) => (await page.locator("body").innerText().catch(() => "")).replace(/\n{2,}/g, "\n").slice(0, limit)

// dismissGates — clear every first-run modal that dims the app, and say whether one was there.
// Bounded and non-fatal: a gate that will not close must not fail the capture, it must show up in
// the PNG (that is the evidence), so the click is best-effort and the round count is fixed.
const dismissGates = async () => {
  let dismissed = 0
  for (let round = 0; round < 3; round++) {
    let clicked = false
    for (const label of [/^configure later$/i, /^continue$/i, /^ok$/i, /^got it$/i, /^skip$/i, /skip for now/i]) {
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
const clickText = async (re, opts = {}) => {
  const el = page.getByText(re, { exact: !!opts.exact }).first()
  if (await el.count() === 0) return "absent"
  await el.click({ timeout: opts.timeout ?? 5000, force: true }).catch((e) => { opts.error = String(e?.message ?? e) })
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
    const out = []
    for (const el of document.querySelectorAll("button,[role=button],[role=tab],a,[role=menuitem]")) {
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
    const out = []
    for (const el of document.querySelectorAll("button,[role=button],[role=tab],a,li,div")) {
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
  const created = await page.evaluate(async (cwd) => {
    const response = await fetch("/api/session/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "client-request", rpcId: "capture-" + Date.now(), method: "session/create", payload: { args: { request: { cwd, agentPreset: "mpd" } } } }),
    })
    return { status: response.status, body: (await response.text()).slice(0, 400) }
  }, WORKSPACE).catch((e) => ({ status: 0, body: String(e?.message ?? e) }))
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
const presetsText = report.agentPresetsText || ""
const teamText = report.teamPanelText || ""
const pluginsText = report.pluginsText || ""
report.checks = {
  homeShowsMpdPreset: /MPD \(Main Working Agent\)/.test(report.homeText || ""),
  pluginsShowsInstalledBundle: /@mpd-dsh\/mpd/.test(pluginsText),
  presetsShowMpdDefault: /MPD \(Main Working Agent\)/.test(presetsText) && /New task default/.test(presetsText),
  mpdSectionRendered: /MPD bundle/.test(report.mpdSectionText || ""),
  sessionCreatedOnMpdPreset: report.sessionCreate?.status === 200 && /"agentPreset":"mpd"/.test(report.sessionCreate?.body || ""),
  teamPanelShowsRoster: /MEMBERS/.test(teamText) && /TASKS/.test(teamText),
}
report.ok = Object.values(report.checks).every(Boolean) && report.steps.every((s) => s.ok)
report.visibleText = await bodyText(3000)
await browser.close()
writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify({ ok: report.ok, checks: report.checks, steps: report.steps, sessionCreate: report.sessionCreate, settingsNav: report.settingsNav, consoleErrors: report.consoleErrors.slice(0, 4) }, null, 1))
process.exit(report.ok ? 0 : 1)
