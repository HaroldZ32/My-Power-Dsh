// probe-fit.mts — measure the Team panel's graph viewport at several window widths, BEFORE any capture.
// Runs inside the mpd-ui-view container (its playwright + chromium). Prints one JSON line per width so a
// caller can pick the smallest window whose graph viewport really holds the graph's content width.
import { chromium } from "playwright"

const BASE = process.argv[2]
if (BASE === undefined) throw new Error("usage: probe-fit.mts <url>")
const widths = (process.argv[3] ?? "2300,2900,3400").split(",").map((n) => Number(n))

/** Close every first-run gate (bilingual labels; bounded). */
const dismiss = async (page: import("playwright").Page): Promise<void> => {
  for (let round = 0; round < 3; round++) {
    let clicked = false
    for (const label of [/^configure later$/i, /^continue$/i, /^ok$/i, /^got it$/i, /^skip$/i, /skip for now/i, /^稍后配置$/, /^保存并继续$/, /^继续$/, /^跳过$/, /^知道了(，继续)?$/, /^确定$/]) {
      const button = page.getByRole("button", { name: label }).first()
      if ((await button.count()) === 0) continue
      if (!(await button.isVisible().catch(() => false))) continue
      await button.click({ timeout: 3000, force: true }).catch((): void => {})
      await page.waitForTimeout(500)
      clicked = true
    }
    if (!clicked) break
  }
  await page.keyboard.press("Escape").catch((): void => {})
}

/** Read the Team panel + graph geometry out of the live DOM. */
const readGeometry = (page: import("playwright").Page): Promise<Record<string, unknown>> =>
  page.evaluate((): Record<string, unknown> => {
    const graph = document.querySelector<HTMLElement>("[data-mpd-graph]")
    const panel = document.querySelector<HTMLElement>("[data-mpd-team-tab]")
    const chain: Record<string, unknown>[] = []
    for (let el = graph?.parentElement ?? null; el !== null && chain.length < 6; el = el.parentElement) {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      chain.push({
        tag: el.tagName.toLowerCase(),
        cls: el.className?.toString().slice(0, 60) ?? "",
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        overflowX: cs.overflowX,
        overflowY: cs.overflowY,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        scrollLeft: el.scrollLeft,
      })
    }
    const separators = [...document.querySelectorAll<HTMLElement>('[role="separator"]')].map((el) => {
      const r = el.getBoundingClientRect()
      return { rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], cls: el.className?.toString().slice(0, 50) ?? "" }
    })
    const pr = panel?.getBoundingClientRect()
    const gr = graph?.getBoundingClientRect()
    return {
      inner: [window.innerWidth, window.innerHeight],
      panel: pr === undefined ? null : [Math.round(pr.x), Math.round(pr.y), Math.round(pr.width), Math.round(pr.height)],
      graph: gr === undefined ? null : [Math.round(gr.x), Math.round(gr.y), Math.round(gr.width), Math.round(gr.height)],
      graphStyle: graph === null ? null : (() => {
        const cs = getComputedStyle(graph)
        return { width: cs.width, height: cs.height, position: cs.position }
      })(),
      chain,
      separators,
      boxes: [...document.querySelectorAll<HTMLElement>("[data-mpd-box]")].map((el) => el.getAttribute("data-mpd-box")),
      frames: document.querySelectorAll(".mpd-dag-group").length,
    }
  })

const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] })
for (const width of widths) {
  const context = await browser.newContext({ viewport: { width, height: 1500 }, deviceScaleFactor: 2, locale: "en-US" })
  const page = await context.newPage()
  await page.goto(BASE, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(3500)
  await dismiss(page)
  let sidebar = page.getByRole("button", { name: "Open right sidebar", exact: true }).first()
  if ((await sidebar.count()) === 0) sidebar = page.getByRole("button", { name: /right sidebar|右侧边栏|右侧栏/ }).first()
  if ((await sidebar.count()) > 0) {
    await sidebar.click({ timeout: 6000, force: true }).catch((): void => {})
    await page.waitForTimeout(2500)
  }
  const tab = page.getByText(/^(Team|团队)$/).first()
  if ((await tab.count()) > 0) {
    await tab.click({ timeout: 6000, force: true }).catch((): void => {})
    await page.waitForTimeout(4000)
  }
  await dismiss(page)
  console.log(JSON.stringify({ width, geometry: await readGeometry(page) }))
  await context.close()
}
await browser.close()
