// probe-newtab.mts — click the dock's "+ New tab" and list what the menu offers (the Team tab's home).
import { chromium } from "playwright"

const BASE = process.argv[2]
const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] })
const context = await browser.newContext({ viewport: { width: 2300, height: 1500 }, deviceScaleFactor: 1, locale: "en-US" })
const page = await context.newPage()
await page.goto(BASE, { waitUntil: "domcontentloaded" })
await page.waitForTimeout(4500)
const add = page.getByRole("button", { name: "New tab", exact: true }).first()
if ((await add.count()) === 0) console.log("NO New tab button")
else await add.click({ timeout: 5000, force: true }).catch((): void => {})
await page.waitForTimeout(1500)
const menu = await page.evaluate((): Record<string, unknown> => ({
  text: [...document.querySelectorAll<HTMLElement>('[role="menu"] , [role="menuitem"], [data-radix-menu-content], [role="dialog"]')].map((el) => (el.innerText || "").trim().slice(0, 400)),
  buttons: [...document.querySelectorAll<HTMLElement>('button,[role="menuitem"],[role="option"]')].map((el) => ((el.getAttribute("aria-label") ?? "") + "|" + (el.innerText ?? "").trim().slice(0, 30)).trim()).filter((s) => s.length > 1).slice(0, 40),
}))
console.log(JSON.stringify(menu, null, 1))
await page.screenshot({ path: "/data/shots-fix2/newtab.png" })
await browser.close()
