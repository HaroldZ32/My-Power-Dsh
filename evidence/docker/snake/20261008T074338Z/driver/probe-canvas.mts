#!/usr/bin/env node
// probe-canvas.mts — a THROWAWAY diagnostic for the lane-E2 pixel sensor.
//
// It answers one question the driver's own rows cannot: what does the coarse colour map of the page's
// canvas actually contain? It is evidence tooling, it asserts nothing, and it is not part of any
// verdict — the driver's rows are.
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

/** The element surface the in-page probe reads. */
interface DomElementLike {
  /** The canvas backing-store width in device pixels. */
  width?: number
  /** The canvas backing-store height in device pixels. */
  height?: number
  /** A 2D rendering context, or null when the element cannot paint one. */
  getContext?(kind: "2d"): { getImageData(x: number, y: number, width: number, height: number): { data: ArrayLike<number> } } | null
}
declare const document: { querySelector(selector: string): DomElementLike | null }
/** Subset of playwright's Page this probe uses. */
interface PageLike {
  /** Navigate and wait for the load event. */
  goto(url: string, options?: { waitUntil?: string }): Promise<unknown>
  /** Evaluate a function in the page. */
  evaluate<T>(fn: () => T): Promise<T>
  /** Sleep in the page's event loop. */
  waitForTimeout(ms: number): Promise<void>
}
/** Subset of playwright's Browser this probe uses. */
interface BrowserLike {
  /** A fresh context. */
  newContext(): Promise<{ newPage(): Promise<PageLike> }>
  /** Shut down. */
  close(): Promise<void>
}

/** The CommonJS loader, so the container's playwright resolves by directory rather than by specifier. */
const requireFromHere = createRequire(import.meta.url)
/** The chromium launcher from the container's playwright install. */
const chromium = (requireFromHere("playwright") as { chromium: { launch(o?: unknown): Promise<BrowserLike> } }).chromium
/** The started browser. */
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
/** A page in a fresh context. */
const page = (await (await browser.newContext()).newPage())
await page.goto(pathToFileURL(resolve(process.argv[2])).href, { waitUntil: "load" })
await page.waitForTimeout(800)

/** Dump the canvas' raw palette and a few probe samples. */
async function dump(label: string): Promise<void> {
  /** Everything the diagnostic needs, gathered inside the page. */
  const info = await page.evaluate(() => {
    /** The page's first canvas. */
    const canvas = document.querySelector("canvas")
    if (canvas === null || typeof canvas.width !== "number" || typeof canvas.height !== "number") return { error: "no canvas" }
    /** The 2D context. */
    const ctx = canvas.getContext!("2d")
    if (ctx === null) return { error: "no 2d context" }
    /** The backing-store size. */
    const width = canvas.width
    /** The backing-store height. */
    const height = canvas.height
    /** The RGBA buffer. */
    const image = ctx.getImageData(0, 0, width, height).data
    /** Exact-colour counts over EVERY pixel, so the coarse sampler can be judged against the truth. */
    const exact = new Map<number, number>()
    for (let i = 0; i < image.length; i += 4) {
      /** The exact 24-bit colour. */
      const key = (image[i] << 16) | (image[i + 1] << 8) | image[i + 2]
      exact.set(key, (exact.get(key) ?? 0) + 1)
    }
    /** Samples along the longer axis, exactly as the driver computes them. */
    const cols = width >= height ? 72 : Math.max(8, Math.round((72 * width) / height))
    /** Samples along the shorter axis. */
    const rows = width >= height ? Math.max(8, Math.round((72 * height) / width)) : 72
    /** The coarse keys, exactly as the driver computes them. */
    const coarse = new Map<number, number>()
    /** A handful of raw sample coordinates, to prove the sampling lands where it claims. */
    const probes: string[] = []
    for (let gy = 0; gy < rows; gy += 1) {
      for (let gx = 0; gx < cols; gx += 1) {
        /** The sampled pixel. */
        const x = Math.min(width - 1, Math.floor(((gx + 0.5) * width) / cols))
        /** The sampled row. */
        const y = Math.min(height - 1, Math.floor(((gy + 0.5) * height) / rows))
        /** The offset of that pixel. */
        const offset = (y * width + x) * 4
        /** The quantised colour. */
        const key = ((image[offset] >> 3) << 10) | ((image[offset + 1] >> 3) << 5) | (image[offset + 2] >> 3)
        coarse.set(key, (coarse.get(key) ?? 0) + 1)
        if (probes.length < 4) probes.push(`gx=${gx},gy=${gy} -> x=${x},y=${y} rgba=${image[offset]},${image[offset + 1]},${image[offset + 2]},${image[offset + 3]}`)
      }
    }
    /** The exact palette, most pixels first. */
    const exactTop = [...exact.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([key, count]) => `#${key.toString(16).padStart(6, "0")} x${count}`)
    /** The coarse palette, most samples first. */
    const coarseTop = [...coarse.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([key, count]) => `${key} x${count}`)
    return { width, height, cols, rows, total: cols * rows, exactTop, coarseTop, probes }
  })
  console.log(`--- ${label} ---`)
  console.log(JSON.stringify(info, null, 1))
}

await dump("frame 1")
await page.waitForTimeout(400)
await dump("frame 2 (400ms later)")
await browser.close()
