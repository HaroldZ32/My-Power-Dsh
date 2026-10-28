// probe-team.mts — open the Team panel and read the graph viewport vs its content width, at one width.
import { chromium } from "playwright"

const BASE = process.argv[2]
const WIDTH = Number(process.argv[3] ?? 2300)
const HEIGHT = Number(process.argv[4] ?? 1500)
const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] })
const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1, locale: "en-US" })
const page = await context.newPage()
await page.goto(BASE, { waitUntil: "domcontentloaded" })
await page.waitForTimeout(4000)
// A SESSION FIRST: the right sidebar's tool list (Team / Workmates) only appears inside an open session.
for (const name of ["New Session", "New session"]) {
  const fresh = page.getByRole("button", { name, exact: true }).first()
  if ((await fresh.count()) > 0) { await fresh.click({ timeout: 5000, force: true }).catch((): void => {}); break }
}
await page.waitForTimeout(4000)
const open = page.getByRole("button", { name: "Open right sidebar", exact: true }).first()
if ((await open.count()) > 0) await open.click({ timeout: 5000, force: true }).catch((): void => {})
await page.waitForTimeout(2000)
const team = page.getByText(/^(Team|团队)$/).first()
const teamCount = await team.count()
if (teamCount > 0) await team.click({ timeout: 5000, force: true }).catch((): void => {})
await page.waitForTimeout(4000)
const out = await page.evaluate((): Record<string, unknown> => {
  const graph = document.querySelector<HTMLElement>("[data-mpd-graph]")
  const panel = document.querySelector<HTMLElement>("[data-mpd-team-tab]")
  const chain: Record<string, unknown>[] = []
  for (let el = graph?.parentElement ?? null; el !== null && chain.length < 6; el = el.parentElement) {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    chain.push({ tag: el.tagName.toLowerCase(), cls: el.className?.toString().slice(0, 40) ?? "", rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], ox: cs.overflowX, sw: el.scrollWidth, cw: el.clientWidth, sl: el.scrollLeft })
  }
  const re = (el: HTMLElement | null): number[] | null => { if (el === null) return null; const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] }
  return {
    inner: [innerWidth, innerHeight],
    panel: re(panel), graph: re(graph), graphStyle: graph === null ? null : (() => { const cs = getComputedStyle(graph); return { w: cs.width, h: cs.height, pos: cs.position } })(),
    chain,
    boxes: [...document.querySelectorAll<HTMLElement>("[data-mpd-box]")].map((el) => el.getAttribute("data-mpd-box")),
    groups: [...document.querySelectorAll<HTMLElement>("[data-mpd-group]")].map((el) => el.getAttribute("data-mpd-group")),
    frames: document.querySelectorAll(".mpd-dag-group").length,
    separators: [...document.querySelectorAll<HTMLElement>('[role="separator"], [data-panel-resize-handle]')].map((el) => re(el)),
  }
})
console.log(JSON.stringify({ WIDTH, HEIGHT, out }, null, 1))
await page.screenshot({ path: "/data/shots-fix2/team-" + WIDTH + ".png" })
await browser.close()
