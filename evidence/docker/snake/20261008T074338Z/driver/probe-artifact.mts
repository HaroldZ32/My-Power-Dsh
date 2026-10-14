#!/usr/bin/env node
// probe-artifact.mts — a THROWAWAY diagnostic for the lane-E2 pixel sensor, run against the LIVE
// artifact while the driver's food arm is red.
//
// It answers one question the driver's rows cannot: what is actually in the coarse colour map, and
// which colours CHANGE between frames? Nothing here asserts anything; the driver's rows are the
// verdict. It is black-box: it reads the colours the engine painted, never the page's source.
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

/** The element surface the in-page probe reads. */
interface DomElementLike {
  /** The canvas backing-store width in device pixels. */
  width?: number
  /** The canvas backing-store height in device pixels. */
  height?: number
  /** A 2D rendering context. */
  getContext?(kind: "2d"): { getImageData(x: number, y: number, w: number, h: number): { data: ArrayLike<number> } } | null
}
declare const document: { querySelector(selector: string): DomElementLike | null }
/** Subset of playwright's Page this probe uses. */
interface PageLike {
  /** Navigate and wait for load. */
  goto(url: string, options?: { waitUntil?: string }): Promise<unknown>
  /** Press a key for real. */
  keyboard: { press(key: string): Promise<void> }
  /** Evaluate a function in the page. */
  evaluate<T>(fn: () => T): Promise<T>
  /** Sleep inside the page's event loop. */
  waitForTimeout(ms: number): Promise<void>
}
/** Subset of playwright's Browser this probe uses. */
interface BrowserLike {
  /** A fresh context. */
  newContext(): Promise<{ newPage(): Promise<PageLike> }>
  /** Shut down. */
  close(): Promise<void>
}

/** The CommonJS loader, so the container's playwright resolves by directory. */
const requireFromHere = createRequire(import.meta.url)
/** The chromium launcher. */
const chromium = (requireFromHere("playwright") as { chromium: { launch(o?: unknown): Promise<BrowserLike> } }).chromium
/** The started browser. */
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
/** The page under test. */
const page = (await (await browser.newContext()).newPage())
await page.goto(pathToFileURL(resolve(process.argv[2])).href, { waitUntil: "load" })
await page.waitForTimeout(900)

/** The coarse key grid, exactly as the driver computes it. */
async function grid(): Promise<number[]> {
  return await page.evaluate(() => {
    /** The page's first canvas. */
    const canvas = document.querySelector("canvas")
    if (canvas === null || typeof canvas.width !== "number" || typeof canvas.height !== "number") return []
    /** Its 2D context. */
    const ctx = canvas.getContext!("2d")
    if (ctx === null) return []
    /** The backing-store size. */
    const width = canvas.width
    /** The backing-store height. */
    const height = canvas.height
    /** The RGBA buffer. */
    const image = ctx.getImageData(0, 0, width, height).data
    /** Samples along the longer axis. */
    const cols = width >= height ? 72 : Math.max(8, Math.round((72 * width) / height))
    /** Samples along the shorter axis. */
    const rows = width >= height ? Math.max(8, Math.round((72 * height) / width)) : 72
    /** The quantised samples. */
    const keys: number[] = []
    for (let gy = 0; gy < rows; gy += 1) {
      for (let gx = 0; gx < cols; gx += 1) {
        /** The sampled pixel. */
        const x = Math.min(width - 1, Math.floor(((gx + 0.5) * width) / cols))
        /** The sampled row. */
        const y = Math.min(height - 1, Math.floor(((gy + 0.5) * height) / rows))
        /** Its offset in the RGBA buffer. */
        const offset = (y * width + x) * 4
        keys.push(((image[offset] >> 3) << 10) | ((image[offset + 1] >> 3) << 5) | (image[offset + 2] >> 3))
      }
    }
    return keys
  })
}

/** Decode a 15-bit key back into the RGB triple it stands for. */
function rgb(key: number): string {
  /** Five bits each, shifted back into the top of a byte. */
  const r = ((key >> 10) & 31) << 3
  /** The green channel. */
  const g = ((key >> 5) & 31) << 3
  /** The blue channel. */
  const b = (key & 31) << 3
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`
}

/** Print the palette of one frame, most common colour first. */
function report(label: string, keys: number[]): void {
  /** Occurrences per colour. */
  const counts = new Map<number, number>()
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1)
  /** The palette, most common first. */
  const palette = [...counts.entries()].sort((a, b) => b[1] - a[1])
  console.log(`--- ${label}: samples=${keys.length} distinct=${palette.length} ---`)
  /** A running total, so the coverage of the top colours can be read off. */
  let cumulative = 0
  for (const [key, count] of palette.slice(0, 14)) {
    cumulative += count
    console.log(`  key=${key} ${rgb(key)} x${count} (${((count / keys.length) * 100).toFixed(1)}%, cum ${((cumulative / keys.length) * 100).toFixed(1)}%)`)
  }
}

// The game waits on its start screen, so the first keys of the driver's run happen before any motion.
await grid()
console.log("== pre-start (the page is on its start screen) ==")
report("frame A", await grid())
await page.keyboard.press("ArrowRight")
await page.waitForTimeout(600)
/** The frame after the game started. */
const frameB = await grid()
report("frame B (after the first key)", frameB)
/** How many samples differ between two consecutive frames. */
let previous = frameB
for (let round = 0; round < 4; round += 1) {
  await page.waitForTimeout(400)
  /** The newest frame. */
  const next = await grid()
  /** Samples the engine repainted since the last frame. */
  const changed: number[] = []
  for (let index = 0; index < next.length; index += 1) if (next[index] !== previous[index]) changed.push(index)
  /** How many of each colour appeared where it was not. */
  const appeared = new Map<number, number>()
  for (const index of changed) appeared.set(next[index], (appeared.get(next[index]) ?? 0) + 1)
  console.log(`--- round ${round}: changed=${changed.length} ---`)
  for (const [key, count] of [...appeared.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  new ${rgb(key)} x${count}`)
  }
  previous = next
}
await browser.close()
