// probe-sidebar.mts — read the right sidebar's own tab list and any mpd-attributed element.
import { chromium } from "playwright"

const BASE = process.argv[2]
const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] })
const context = await browser.newContext({ viewport: { width: 2300, height: 1500 }, deviceScaleFactor: 1, locale: "en-US" })
const page = await context.newPage()
await page.goto(BASE, { waitUntil: "domcontentloaded" })
await page.waitForTimeout(4500)
const out = await page.evaluate((): Record<string, unknown> => {
  const collapse = [...document.querySelectorAll<HTMLElement>("button")].find((el) => (el.getAttribute("aria-label") ?? "").includes("Collapse right sidebar"))
  let root: HTMLElement | null = collapse ?? null
  for (let i = 0; i < 6 && root !== null; i++) root = root.parentElement
  const tabs = [...document.querySelectorAll<HTMLElement>('[role="tab"]')].map((el) => ({ text: (el.innerText || "").trim().slice(0, 30), al: el.getAttribute("aria-label") }))
  const mpd = [...document.querySelectorAll<HTMLElement>("[data-mpd-team-tab],[data-mpd-graph],[data-mpd-box]")].length
  const buttons = [...document.querySelectorAll<HTMLElement>('button,[role="button"],[role="tab"]')]
    .map((el) => ((el.getAttribute("aria-label") ?? "") + "|" + (el.innerText ?? "").trim().slice(0, 30)).trim())
    .filter((s) => /team|dag|mpd|watchdog|workmate|tab/i.test(s))
  return {
    tabCount: tabs.length,
    tabs,
    mpdElements: mpd,
    matching: buttons,
    sidebarText: (root?.innerText ?? "").slice(0, 1200),
    html: (root?.outerHTML ?? "").slice(0, 1200),
  }
})
console.log(JSON.stringify(out, null, 1))
await browser.close()
