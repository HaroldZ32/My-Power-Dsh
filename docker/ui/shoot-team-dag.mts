// docker/ui/shoot-team-dag.mts — capture the Web Team view of the NESTED fixture, framing the WHOLE graph.
//
// WHY THIS SCRIPT EXISTS. The published `web-team-dag-groups.png` was captured from a panel narrower
// than the graph it draws: the boxes span 0..1234 CSS px, the captured viewport was 1034, and the panel
// cannot scroll (scrollWidth == clientWidth), so both ends of the drawing were clipped and the facts
// file recorded the false sentence "graph scrolled right". A wider window makes the panel wider (the
// host gives it 45% of the viewport), so the WHOLE graph fits at scroll origin; this script refuses to
// write a PNG unless that is measurably true, and it writes the numbers into the facts file.
//
// WHAT IT TOUCHES. The profile it captures is a CONTAINER's copy (`/data/dsh-web`), never the host's
// `~/.dsh`: the bundle under test is the checkout's `mpd-team-core-plugin/dist` +
// `mpd-bundle-plugin/{dist,client.js}` patched into that copy, because the image's published 0.15.1 has
// no group input.
//
// Usage (inside the container, from /data so `playwright` resolves):
//   node shoot-team-dag.mts <url> <out.png> <out-facts.json> [width] [height] [locale]
// Exit status: 0 a framed capture was written, 1 a precondition failed, 2 the arguments are unusable.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { chromium, type Page } from "playwright"

const [BASE, OUT_PNG, OUT_FACTS, WIDTH_ARG, HEIGHT_ARG, LOCALE_ARG] = process.argv.slice(2)
if (BASE === undefined || OUT_PNG === undefined || OUT_FACTS === undefined) {
  throw new Error("usage: shoot-team-dag.mts <url> <out.png> <out-facts.json> [width] [height] [locale]")
}
/** The window to photograph. 2900 CSS px gives the host's 45% right sidebar 1304 px, which holds the
 * 1234 px graph plus its 24 px padding; a narrower window cannot fit the drawing and is refused below. */
const WIDTH = Number(WIDTH_ARG ?? 2900)
const HEIGHT = Number(HEIGHT_ARG ?? 1500)
/** The browser locale: `en-US` for the English asset, `zh-CN` for the Chinese twin. */
const LOCALE = LOCALE_ARG ?? "en-US"
/** The nested fixture's parent team, written by `.mpd/readme-ref/nested/nested-fixture.ts --write`. */
const TEAM_ID = "team-nested-parent"
const TEAMS = "/data/ws/.mpd/team"
/** The padding the panel draws around the graph, used only to report the capture's own box origin. */
const PANEL_PAD_X = 12
/** Headroom kept under the graph so the deepest card's border is not flush with the image edge. */
const BOTTOM_PAD = 14

/** Bind the nested parent to EVERY session the web store holds, so the panel renders it whichever
 *  session the app picked — the same rule the wave-4 capture used. */
function bindEverySession(): number {
  const store = "/data/dsh-web/sessions"
  const sessions: string[] = []
  for (const key of readdirSync(store)) {
    for (const id of readdirSync(join(store, key))) sessions.push(id.replace(/\.json$/, ""))
  }
  const index = JSON.parse(readFileSync(join(TEAMS, "teams.json"), "utf8")) as { version: number; active: Record<string, string> }
  for (const id of sessions) index.active[id] = TEAM_ID
  index.active.workspace = TEAM_ID
  writeFileSync(join(TEAMS, "teams.json"), JSON.stringify(index, null, 2) + "\n")
  return sessions.length
}

/** Close every first-run gate (bilingual labels; bounded). */
async function dismiss(page: Page): Promise<void> {
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

/** What the rendered panel carries, plus the framing numbers the measurement gate needs. */
interface PanelFacts {
  boxes: string[]
  groups: string[]
  cards: string[]
  frames: number
  panel: number[]
  graph: number[]
  scroll: { rect: number[]; clientWidth: number; scrollWidth: number; scrollLeft: number; clientHeight: number; scrollHeight: number }
  contentWidth: number
  contentHeight: number
}

/** Read the Team panel's geometry and the boxes it draws. */
async function readPanel(page: Page): Promise<PanelFacts> {
  return page.evaluate((): PanelFacts => {
    const graph = document.querySelector<HTMLElement>("[data-mpd-graph]")
    const panel = document.querySelector<HTMLElement>("[data-mpd-team-tab]")
    if (graph === null || panel === null) throw new Error("no [data-mpd-graph]/[data-mpd-team-tab] on screen")
    const rect = (el: Element | null): number[] => {
      if (el === null) return [0, 0, 0, 0]
      const r = el.getBoundingClientRect()
      return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]
    }
    const boxes = [...document.querySelectorAll<HTMLElement>("[data-mpd-box]")].map((el) => el.getAttribute("data-mpd-box") ?? "")
    const scroll = graph.parentElement
    const contentWidth = Math.max(...boxes.map((raw) => { const p = raw.split(",").map(Number); return p[0] + p[2] }), 0)
    const contentHeight = Math.max(...boxes.map((raw) => { const p = raw.split(",").map(Number); return p[1] + p[3] }), 0)
    return {
      boxes,
      groups: [...document.querySelectorAll<HTMLElement>("[data-mpd-group]")].map((el) => el.getAttribute("data-mpd-group") ?? ""),
      cards: [...document.querySelectorAll<HTMLElement>("[data-mpd-node]")].map((el) => el.getAttribute("data-mpd-node") ?? ""),
      frames: document.querySelectorAll(".mpd-dag-group").length,
      panel: rect(panel),
      graph: rect(graph),
      scroll: scroll === null ? { rect: [0, 0, 0, 0], clientWidth: 0, scrollWidth: 0, scrollLeft: 0, clientHeight: 0, scrollHeight: 0 } : {
        rect: rect(scroll), clientWidth: scroll.clientWidth, scrollWidth: scroll.scrollWidth, scrollLeft: scroll.scrollLeft,
        clientHeight: scroll.clientHeight, scrollHeight: scroll.scrollHeight,
      },
      contentWidth,
      contentHeight,
    }
  })
}

const bound = bindEverySession()
console.log(`[shoot] bound ${bound} web session(s) to ${TEAM_ID}`)
const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] })
const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 2, locale: LOCALE })
const page = await context.newPage()
await page.goto(BASE, { waitUntil: "domcontentloaded" })
await page.waitForTimeout(4000)
await dismiss(page)
// A SESSION FIRST: the right sidebar's tool list (Team / Workmates) only exists inside an open session.
for (const name of ["New Session", "New session", "新建会话"]) {
  const fresh = page.getByRole("button", { name, exact: true }).first()
  if ((await fresh.count()) > 0) { await fresh.click({ timeout: 6000, force: true }).catch((): void => {}); break }
}
await page.waitForTimeout(4000)
const open = page.getByRole("button", { name: /^(Open right sidebar|打开右侧边栏)$/ }).first()
if ((await open.count()) > 0) {
  await open.click({ timeout: 6000, force: true }).catch((): void => {})
  await page.waitForTimeout(2500)
}
// THE TAB IS A BUTTON TITLED `Team` / `团队`, followed by its one-line description: an exact text match
// stops working the moment a locale wraps the label, so the search is by accessible name PREFIX and
// falls back to the bare label. A failed match is retried once on the settled sidebar.
for (let attempt = 0; attempt < 2; attempt++) {
  const named = page.getByRole("button", { name: /^(Team|团队)(\s|$)/ }).first()
  if ((await named.count()) > 0) await named.click({ timeout: 6000, force: true }).catch((): void => {})
  else {
    const bare = page.getByText(/^(Team|团队)$/).first()
    if ((await bare.count()) > 0) await bare.click({ timeout: 6000, force: true }).catch((): void => {})
  }
  await page.waitForSelector("[data-mpd-team-tab]", { timeout: 12000 }).catch((): void => {})
  if ((await page.locator("[data-mpd-team-tab]").count()) > 0) break
  await page.waitForTimeout(1500)
}
await dismiss(page)
// The precondition: the frame layer is on screen, and the graph is not scrolled.
const facts = await readPanel(page)
if (facts.frames < 1 || facts.boxes.length === 0) {
  console.error(`[shoot] REFUSED: frames=${facts.frames} boxes=${facts.boxes.length} — the Team panel did not render the nested fixture`)
  await browser.close()
  process.exit(1)
}
await page.evaluate((): void => {
  for (const el of [...document.querySelectorAll<HTMLElement>("*")]) {
    if (el.scrollWidth > el.clientWidth) el.scrollLeft = 0
    if (el.scrollHeight > el.clientHeight) el.scrollTop = 0
  }
})
await page.waitForTimeout(800)
const framed = await readPanel(page)
// The clip: the panel from its own top to the graph's bottom plus headroom — the header, the roster and
// the WHOLE graph, with no empty page below it.
const clipHeight = framed.graph[1] + framed.graph[3] + BOTTOM_PAD - framed.panel[1]
const clip = { x: framed.panel[0], y: framed.panel[1], width: framed.panel[2], height: clipHeight }
await page.screenshot({ path: OUT_PNG, clip })
const imagePx = [Math.round(clip.width * 2), Math.round(clip.height * 2)]
// The measurement gate's input: the boxes in the graph's own frame, the rect photographed, and where the
// graph's (0,0) sits inside it — so `x >= 0 && x + w <= capturedWidth` is checked in the IMAGE's frame.
const capture = {
  image: OUT_PNG.split("/").pop() ?? OUT_PNG,
  imagePx,
  deviceScaleFactor: 2,
  capturedWidth: Math.round(clip.width),
  capturedHeight: Math.round(clip.height),
  boxOrigin: [framed.graph[0] - Math.round(clip.x), framed.graph[1] - Math.round(clip.y)],
  graphViewport: [framed.graph[2], framed.graph[3]],
  scrollX: framed.scroll.scrollLeft,
  scrollY: 0,
  contentWidth: framed.contentWidth,
  contentHeight: framed.contentHeight,
}
const record = {
  web: {
    surface: `dsh web, Team view (mpd-bundle-plugin client.js), locale ${LOCALE}`,
    bundle: "the CURRENT checkout's mpd-team-core-plugin/dist + mpd-bundle-plugin/{dist,client.js} patched into the container profile (the image ships 0.15.1, which has no group input)",
    team: TEAM_ID,
    frames: framed.frames,
    groupRects: framed.groups,
    cards: framed.cards,
    boxes: framed.boxes,
    capture,
    viewport: `${WIDTH}x${HEIGHT} @ deviceScaleFactor 2, locale ${LOCALE} — fits: scrollX=${capture.scrollX}, ` +
      `captured ${capture.capturedWidth}x${capture.capturedHeight} CSS px at origin (${capture.boxOrigin[0]},${capture.boxOrigin[1]}), ` +
      `graph viewport ${capture.graphViewport[0]}x${capture.graphViewport[1]} CSS px vs content ${capture.contentWidth}x${capture.contentHeight} CSS px ` +
      `(headroom ${capture.graphViewport[0] - capture.contentWidth}x${capture.graphViewport[1] - capture.contentHeight} px)`,
  },
}
writeFileSync(OUT_FACTS, JSON.stringify(record, null, 2) + "\n")
console.log(`[shoot] wrote ${OUT_PNG} (${imagePx[0]}x${imagePx[1]} px) and ${OUT_FACTS}`)
console.log(`[shoot] frames=${framed.frames} boxes=${framed.boxes.length} content=${framed.contentWidth}x${framed.contentHeight} viewport=${framed.graph[2]}x${framed.graph[3]} scrollX=${framed.scroll.scrollLeft}`)
if (!existsSync(OUT_PNG)) {
  console.error("[shoot] REFUSED: no PNG was written")
  await browser.close()
  process.exit(1)
}
await browser.close()
