// mpd-bootstrap: install-time-free provisioning inside the bundle package.
// At apply: (1) copies the bundled mpd-* presets into the harness user root
// $DSH_HOME/.agent-presets (idempotent, version-stamped); (2) prints one status line.
// No installer script, no fixed checkout path: everything resolves relative to
// this plugin's own package location.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

export const name = "mpd-bootstrap"
export const inject = []

type Config = { presetsDir?: string; skipPresets?: boolean }

function pkgRoot(): string {
  try {
    const req = createRequire(import.meta.url)
    return dirname(req.resolve("@mpd-dsh/mpd/package.json"))
  } catch {
    // fallback: dist/packages/mpd-bootstrap-plugin/dist/index.js -> three up
    return dirname(dirname(dirname(new URL(import.meta.url).pathname)))
  }
}

function userPresetsDir(): string {
  const home = process.env.DSH_HOME || join(homedir(), ".dsh")
  return join(home, ".agent-presets")
}

export function apply(ctx: any, config: Config = {}): void {
  if (config.skipPresets === true) {
    console.log("[mpd-bootstrap] presets skipped (config)")
    return
  }
  const root = pkgRoot()
  const presetsSrc = config.presetsDir ? config.presetsDir : join(root, "presets")
  const dest = userPresetsDir()
  const stamp = join(dest, ".mpd-presets-version")
  let version = "unknown"
  try { version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version ?? "unknown" } catch { /* keep */ }
  let installed = ""
  try { installed = readFileSync(stamp, "utf8").trim() } catch { /* keep */ }
  if (existsSync(presetsSrc) && readdirSync(presetsSrc).some((d) => d.startsWith("mpd-"))) {
    mkdirSync(dest, { recursive: true })
    if (installed !== version) {
      for (const d of readdirSync(presetsSrc)) {
        if (!d.startsWith("mpd-")) continue
        const from = join(presetsSrc, d)
        const to = join(dest, d)
        try { cpSync(from, to, { recursive: true, force: true }) } catch (e: any) { console.log("[mpd-bootstrap] preset copy failed: " + d + " " + String(e?.message ?? e)) }
      }
      try { writeFileSync(stamp, version) } catch { /* ignore */ }
      console.log("[mpd-bootstrap] presets installed (" + version + ") -> " + dest)
    } else {
      console.log("[mpd-bootstrap] presets up to date (" + version + ")")
    }
  } else {
    console.log("[mpd-bootstrap] no bundled presets found at " + presetsSrc)
  }
}