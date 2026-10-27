// probe-dom.mts — dump what the web page actually shows before the Team tab opens (buttons, text, tabs).
import { chromium } from "playwright"

const BASE = process.argv[2]
const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] })
const context = await browser.newContext({ viewport: { width: 2300, height: 1500 }, deviceScaleFactor: 1, locale: "en-US" })
const page = await context.newPage()
await page.goto(BASE, { waitUntil: "domcontentloaded" })
await page.waitForTimeout(5000)
console.log(JSON.stringify({
  url: page.url(),
  title: await page.title(),
  text: (await page.evaluate((): string => document.body.innerText || "")).slice(0, 1500),
  buttons: await page.evaluate((): string[] => [...document.querySelectorAll<HTMLElement>("button,[role=button],[role=tab]")].map((el) => (el.getAttribute("aria-label") ?? "") + "|" + (el.innerText ?? "").trim().slice(0, 40)).slice(0, 60)),
}, null, 1))
await page.screenshot({ path: "/data/shots-fix2/dom.png" })
await browser.close()
