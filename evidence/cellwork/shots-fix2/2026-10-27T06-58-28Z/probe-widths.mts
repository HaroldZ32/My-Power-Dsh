// probe-widths.mts — after a session + Team panel are open, report the graph viewport at several widths.
import { chromium } from "playwright"

const BASE = process.argv[2]
const widths = (process.argv[3] ?? "2900,3000,3200").split(",").map(Number)
const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] })
for (const width of widths) {
  const context = await browser.newContext({ viewport: { width, height: 1500 }, deviceScaleFactor: 1, locale: "en-US" })
  const page = await context.newPage()
  await page.goto(BASE, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(3500)
  for (const name of ["New Session", "New session"]) {
    const fresh = page.getByRole("button", { name, exact: true }).first()
    if ((await fresh.count()) > 0) { await fresh.click({ timeout: 5000, force: true }).catch((): void => {}); break }
  }
  await page.waitForTimeout(3500)
  const open = page.getByRole("button", { name: "Open right sidebar", exact: true }).first()
  if ((await open.count()) > 0) await open.click({ timeout: 5000, force: true }).catch((): void => {})
  await page.waitForTimeout(2000)
  const team = page.getByText(/^(Team|团队)$/).first()
  if ((await team.count()) > 0) await team.click({ timeout: 5000, force: true }).catch((): void => {})
  await page.waitForTimeout(3500)
  const g = await page.evaluate((): Record<string, unknown> => {
    const graph = document.querySelector<HTMLElement>("[data-mpd-graph]")
    const panel = document.querySelector<HTMLElement>("[data-mpd-team-tab]")
    const scroll = graph?.parentElement ?? null
    const re = (el: Element | null): number[] | null => { if (el === null) return null; const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] }
    const boxes = [...document.querySelectorAll<HTMLElement>("[data-mpd-box]")].map((el) => el.getAttribute("data-mpd-box") ?? "")
    const contentW = Math.max(...boxes.map((b) => { const p = b.split(",").map(Number); return p[0] + p[2] }), 0)
    const contentH = Math.max(...boxes.map((b) => { const p = b.split(",").map(Number); return p[1] + p[3] }), 0)
    return {
      viewport: [innerWidth, innerHeight], panel: re(panel), graph: re(graph),
      scroll: scroll === null ? null : { rect: re(scroll), clientWidth: scroll.clientWidth, scrollWidth: scroll.scrollWidth, scrollLeft: scroll.scrollLeft, clientHeight: scroll.clientHeight, scrollHeight: scroll.scrollHeight },
      boxes, contentW, contentH, boxCount: boxes.length, frames: document.querySelectorAll(".mpd-dag-group").length,
    }
  })
  console.log(JSON.stringify({ width, g }))
  await context.close()
}
await browser.close()
