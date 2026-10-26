// shot.mts — the WEB capture for T29: open the MPD Team view on the NESTED board and screenshot it.
// Runs INSIDE the mpd-ui-view container (its playwright + chromium); seeded by the caller.
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"

const BASE = process.argv[2]
const OUT = process.argv[3]
const TEAMS = "/data/ws/.mpd/team"

// Bind the nested parent to EVERY session the web app's store holds: the app picks its own session.
const store = "/data/dsh-web/sessions"
const sessions: string[] = []
for (const key of readdirSync(store)) for (const id of readdirSync(join(store, key))) sessions.push(id.replace(/\.json$/, ""))
const index = JSON.parse(readFileSync(join(TEAMS, "teams.json"), "utf8")) as { version: number; active: Record<string, string> }
for (const id of sessions) index.active[id] = "team-nested-parent"
index.active["workspace"] = "team-nested-parent"
writeFileSync(join(TEAMS, "teams.json"), JSON.stringify(index, null, 2) + "\n")
console.log("[shot] bound", sessions.length, "session(s)")

const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] })
const context = await browser.newContext({ viewport: { width: 2300, height: 1500 }, deviceScaleFactor: 2, locale: "zh-CN" })
const page = await context.newPage()
/** Close every first-run gate (bilingual labels; bounded). */
const dismiss = async (): Promise<void> => {
  for (let round = 0; round < 3; round++) {
    let clicked = false
    for (const label of [/^configure later$/i, /^continue$/i, /^ok$/i, /^got it$/i, /^skip$/i, /skip for now/i, /^稍后配置$/, /^保存并继续$/, /^继续$/, /^跳过$/, /^知道了(，继续)?$/, /^确定$/]) {
      const button = page.getByRole("button", { name: label }).first()
      if ((await button.count()) === 0) continue
      if (!(await button.isVisible().catch(() => false))) continue
      await button.click({ timeout: 3000, force: true }).catch((): void => {})
      await page.waitForTimeout(600)
      clicked = true
    }
    if (!clicked) break
  }
  await page.keyboard.press("Escape").catch((): void => {})
}
await page.goto(BASE, { waitUntil: "domcontentloaded" })
await page.waitForTimeout(3500)
await dismiss()
// The RIGHT sidebar, then the Team tab (exact name; a loose /sidebar/i collapses the left rail).
let sidebar = page.getByRole("button", { name: "Open right sidebar", exact: true }).first()
if ((await sidebar.count()) === 0) sidebar = page.getByRole("button", { name: /right sidebar|右侧边栏|右侧栏/ }).first()
if ((await sidebar.count()) > 0) { await sidebar.click({ timeout: 6000, force: true }).catch((): void => {}); await page.waitForTimeout(2500) }
const tab = page.getByText(/^(Team|团队)$/).first()
if ((await tab.count()) > 0) { await tab.click({ timeout: 6000, force: true }).catch((): void => {}); await page.waitForTimeout(4000) }
await dismiss()
// THE PRECONDITION: the frame layer must be ON SCREEN before a single pixel is claimed.
/** What the rendered panel actually carries. */
const facts = await page.evaluate((): Record<string, unknown> => {
  const q = (s: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(s)]
  return {
    teamTab: document.querySelector("[data-mpd-team-tab]")?.getAttribute("data-mpd-team-tab") ?? null,
    graph: document.querySelector("[data-mpd-graph]")?.getAttribute("data-mpd-graph") ?? null,
    frames: q(".mpd-dag-group").length,
    groupRects: q("[data-mpd-group]").map((el) => el.getAttribute("data-mpd-group")),
    cardIds: q("[data-mpd-node]").map((el) => el.getAttribute("data-mpd-node")),
    boxes: q("[data-mpd-box]").map((el) => el.getAttribute("data-mpd-box")),
    bodyText: (document.body.innerText || "").slice(0, 400),
  }
})
console.log("[shot] FACTS " + JSON.stringify(facts))
// The capture: the Team panel itself when the frame layer exists, the whole window otherwise.
// Scroll the graph to its RIGHT edge so the BOX (the rightmost rank) is inside the panel's viewport.
await page.evaluate((): void => {
  for (const el of [...document.querySelectorAll<HTMLElement>("*")]) {
    if (el.scrollWidth > el.clientWidth + 8 && el.querySelector("[data-mpd-node]") !== null) el.scrollLeft = el.scrollWidth
  }
})
await page.waitForTimeout(800)
const panel = page.locator("[data-mpd-team-tab]").first()
if ((await panel.count()) > 0) { await panel.screenshot({ path: OUT }).catch((): void => {}) }
if (!(await import("node:fs").then((fs) => fs.existsSync(OUT)))) await page.screenshot({ path: OUT, fullPage: false })
writeFileSync("/data-out/shot-facts.json", JSON.stringify(facts, null, 2) + "\n")
await browser.close()
console.log("[shot] wrote " + OUT)
