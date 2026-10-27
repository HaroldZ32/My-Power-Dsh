// probe-team2.mts — find the Team item's clickable ancestor, click it, dump what the panel says.
import { chromium } from "playwright"

const BASE = process.argv[2]
const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] })
const context = await browser.newContext({ viewport: { width: 2300, height: 1500 }, deviceScaleFactor: 1, locale: "en-US" })
const page = await context.newPage()
const logs: string[] = []
page.on("console", (m) => logs.push(m.type() + " " + m.text().slice(0, 180)))
page.on("pageerror", (e) => logs.push("PAGEERROR " + String(e).slice(0, 180)))
await page.goto(BASE, { waitUntil: "domcontentloaded" })
await page.waitForTimeout(4000)
const open = page.getByRole("button", { name: "Open right sidebar", exact: true }).first()
if ((await open.count()) > 0) await open.click({ timeout: 5000, force: true }).catch((): void => {})
await page.waitForTimeout(2500)
// The clickable ancestor of the exact "Team" label.
const info = await page.evaluate((): Record<string, unknown> => {
  const el = [...document.querySelectorAll<HTMLElement>("*")].find((e) => e.children.length === 0 && /^(Team|团队)$/.test((e.textContent ?? "").trim()))
  if (el === undefined) return { found: false }
  const chain: string[] = []
  for (let a: HTMLElement | null = el; a !== null && chain.length < 6; a = a.parentElement) chain.push(a.tagName.toLowerCase() + "." + (a.className?.toString().slice(0, 30) ?? "") + "[role=" + (a.getAttribute("role") ?? "") + "]")
  const clickable = el.closest("button,[role=button],[role=treeitem],[role=menuitem],a") as HTMLElement | null
  return { found: true, chain, clickable: clickable === null ? null : clickable.outerHTML.slice(0, 300) }
})
console.log(JSON.stringify({ info }, null, 1))
const target = page.getByRole("button", { name: /Team/ }).first()
const targetCount = await target.count()
if (targetCount > 0) await target.click({ timeout: 5000, force: true }).catch((): void => {})
else {
  const fallback = page.getByText(/^(Team|团队)$/).first()
  if ((await fallback.count()) > 0) await fallback.click({ timeout: 5000, force: true }).catch((): void => {})
}
await page.waitForTimeout(4000)
const after = await page.evaluate((): Record<string, unknown> => ({
  tabs: [...document.querySelectorAll<HTMLElement>('[role="tab"]')].map((el) => (el.innerText || "").trim().slice(0, 30)),
  mpd: document.querySelectorAll("[data-mpd-team-tab],[data-mpd-graph],[data-mpd-box],.mpd-dag-group").length,
  text: (document.body.innerText || "").slice(0, 1000),
}))
console.log(JSON.stringify({ targetCount, after, logs: logs.slice(-12) }, null, 1))
await page.screenshot({ path: "/data/shots-fix2/team2.png" })
await browser.close()
