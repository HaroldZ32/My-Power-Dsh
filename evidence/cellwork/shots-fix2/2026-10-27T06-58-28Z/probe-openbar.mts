// probe-openbar.mts — open the HOST right sidebar and dump its tabs/panels (where the mpd Team tab lives).
import { chromium } from "playwright"

const BASE = process.argv[2]
const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] })
const context = await browser.newContext({ viewport: { width: 2300, height: 1500 }, deviceScaleFactor: 1, locale: "en-US" })
const page = await context.newPage()
const logs: string[] = []
page.on("console", (m) => { if (m.type() === "error" || /mpd|team/i.test(m.text())) logs.push(m.text().slice(0, 200)) })
page.on("pageerror", (e) => logs.push("PAGEERROR " + String(e).slice(0, 200)))
await page.goto(BASE, { waitUntil: "domcontentloaded" })
await page.waitForTimeout(4500)
const open = page.getByRole("button", { name: "Open right sidebar", exact: true }).first()
console.log("open count", await open.count())
if ((await open.count()) > 0) { await open.click({ timeout: 5000, force: true }).catch((): void => {}); }
await page.waitForTimeout(2500)
const out = await page.evaluate((): Record<string, unknown> => {
  const tabs = [...document.querySelectorAll<HTMLElement>('[role="tab"]')].map((el) => (el.innerText || "").trim().slice(0, 40))
  const teamLike = [...document.querySelectorAll<HTMLElement>("*")].filter((el) => el.children.length === 0 && /^(Team|团队)$/.test((el.textContent ?? "").trim())).length
  const mpd = [...document.querySelectorAll<HTMLElement>("[data-mpd-team-tab],[data-mpd-graph],[data-mpd-box],[data-mpd-team]")].length
  return { tabs, teamLike, mpd, bodyText: (document.body.innerText || "").slice(0, 800) }
})
console.log(JSON.stringify({ logs, out }, null, 1))
await page.screenshot({ path: "/data/shots-fix2/openbar.png" })
await browser.close()
