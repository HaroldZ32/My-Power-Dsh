// The panel-visible half of the defect, measured through the panel's OWN payload builder.
//
// `buildWatchdogState` is the function the Web front door's `/plugins/mpd-team-watchdog/state`
// route calls (`packages/mpd-bundle-plugin/src/watchdog-web.ts`), so this is the exact object
// the stuck-team banner renders: `stuck` is true when a hold exists OR any incident is newer
// than the reader's watermark, and `banner` is the newest unread incident.
//
// BEFORE runs against a sandbox root built from the byte copy of the incident log as it was
// before the cleanup; AFTER runs against the real workspace. Nothing here is simulated — the
// builder is imported from the bundle's source.
//
// Usage: bun panel-state.mjs <before-root> <after-root>
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildWatchdogState } from "/root/dshProj/my-power-dsh/packages/mpd-bundle-plugin/src/watchdog-web.ts"

const [beforeSource, afterRoot] = process.argv.slice(2)
const reader = "web-panel"
const summarize = (payload) => ({
  stuck: payload.stuck,
  replay: payload.replay,
  unread: Array.isArray(payload.unread) ? payload.unread.length : 0,
  banner: payload.banner === null || payload.banner === undefined ? null : {
    kind: payload.banner.kind,
    headline: typeof payload.banner.headline === "string" ? payload.banner.headline.slice(0, 120) : undefined,
  },
  holds: Array.isArray(payload.holds) ? payload.holds.length : 0,
})

// BEFORE: a sandbox root carrying ONLY the pre-cleanup incident log (and no watermark file).
const beforeRoot = join(tmpdir(), "watchdog-panel-before")
rmSync(beforeRoot, { recursive: true, force: true })
mkdirSync(join(beforeRoot, ".mpd", "team", "watchdog"), { recursive: true })
copyFileSync(beforeSource, join(beforeRoot, ".mpd", "team", "watchdog", "incidents.jsonl"))
const beforePayload = buildWatchdogState({ roots: [beforeRoot], stateDir: join(".mpd", "team"), reader })

const afterWatermark = join(afterRoot, ".mpd", "team", "watchdog", "read-watermark.json")
const afterPayload = buildWatchdogState({ roots: [afterRoot], stateDir: join(".mpd", "team"), reader })

writeFileSync(join(import.meta.dirname, "panel-state.json"), JSON.stringify({ reader, beforePayload: summarize(beforePayload), afterPayload: summarize(afterPayload), afterWatermark: existsSync(afterWatermark) ? JSON.parse(readFileSync(afterWatermark, "utf8")) : null }, null, 2) + "\n")
console.log("reader=" + reader)
console.log("BEFORE " + JSON.stringify(summarize(beforePayload)))
console.log("AFTER  " + JSON.stringify(summarize(afterPayload)))
rmSync(beforeRoot, { recursive: true, force: true })
