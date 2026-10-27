// probe-session.mts — create/bind a session, then look for the Team tab (the mpd tab needs a session).
import { chromium } from "playwright"

const BASE = process.argv[2]
const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] })
const context = await browser.newContext({ viewport: { width: 2300, height: 1500 }, deviceScaleFactor: 1, locale: "en-US" })
const page = await context.newPage()
const logs: string[] = []
page.on("console", (m) => { if (m.type() === "error" || /mpd|team/i.test(m.text())) logs.push(m.text().slice(0, 160)) })
await page.goto(BASE, { waitUntil: "domcontentloaded" })
await page.waitForTimeout(4000)
// The left rail's first "New Session" (aria-label exact) creates a fresh session in the active workspace.
for (const name of ["New Session", "New session"]) {
  const b = page.getByRole("button", { name, exact: true }).first()
  if ((await b.count()) > 0) { await b.click({ timeout: 5000, force: true }).catch((): void => {}); break }
}
await page.waitForTimeout(4000)
const out1 = await page.evaluate((): unknown => ({
  url: location.href,
  tabs: [...document.querySelectorAll<HTMLElement>('[role="tab"]')].map((el) => (el.innerText || "").trim().slice(0, 30)),
  team: [...document.querySelectorAll<HTMLElement>("*")].filter((el) => el.children.length === 0 && /Team/.test(el.textContent ?? "")).map((el) => (el.textContent ?? "").trim().slice(0, 60)).slice(0, 10),
  mpd: document.querySelectorAll("[data-mpd-team-tab],[data-mpd-graph],[data-mpd-box]").length,
  text: (document.body.innerText || "").slice(0, 500),
}))
// open right sidebar and click a Team-labelled element if present
const open = page.getByRole("button", { name: "Open right sidebar", exact: true }).first()
if ((await open.count()) > 0) await open.click({ timeout: 5000, force: true }).catch((): void => {})
await page.waitForTimeout(3000)
const out2 = await page.evaluate((): unknown => ({
  tabs: [...document.querySelectorAll<HTMLElement>('[role="tab"]')].map((el) => (el.innerText || "").trim().slice(0, 30)),
  mpd: document.querySelectorAll("[data-mpd-team-tab],[data-mpd-graph],[data-mpd-box]").length,
  text: (document.body.innerText || "").slice(0, 800),
}))
console.log(JSON.stringify({ logs, afterNewSession: out1, afterOpen: out2 }, null, 1))
await page.screenshot({ path: "/data/shots-fix2/session.png" })
await browser.close()
