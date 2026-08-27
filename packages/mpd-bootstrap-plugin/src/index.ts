// mpd-bootstrap: install-time-free provisioning inside the bundle package.
// At apply: (1) copies the bundled mpd-* presets into the harness user root
// $DSH_HOME/.agent-presets; (2) copies the bundled skill corpus (repo skills/
// per AGENTS.md layout) into the harness user root $DSH_HOME/skills (the
// user-dsh skill root, scanned by dsh-skill-filesystem in every session);
// both idempotent + version-stamped.
// (3) prints one status line. No installer script, no fixed checkout path:
// everything resolves relative to this plugin's own package location.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export const name = "mpd-bootstrap"
export const inject = []

type Config = { presetsDir?: string; skipPresets?: boolean; skillsDir?: string; skipSkills?: boolean }

function pkgRoot(): string {
  // Location-derived, no package-name resolution: this file lives at
  // <pkg-root>/packages/mpd-bootstrap-plugin/dist/index.js, so the package
  // root is four directories up. Presets live at <pkg-root>/presets and the
  // skill corpus at <pkg-root>/.agents/skills.
  return dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
}

function userPresetsDir(): string {
  const home = process.env.DSH_HOME || join(homedir(), ".dsh")
  return join(home, ".agent-presets")
}

function userSkillsDir(): string {
  const home = process.env.DSH_HOME || join(homedir(), ".dsh")
  return join(home, "skills")
}

/** Copy src children into dest, idempotent per version stamp; `filter` keeps only matching entries. */
function syncTree(src: string, dest: string, version: string, label: string, filter?: (name: string) => boolean): void {
  if (!existsSync(src)) {
    console.log("[mpd-bootstrap] no bundled " + label + " at " + src)
    return
  }
  mkdirSync(dest, { recursive: true })
  const stamp = join(dest, ".mpd-" + label + "-version")
  let installed = ""
  try { installed = readFileSync(stamp, "utf8").trim() } catch { /* keep */ }
  if (installed === version) {
    console.log("[mpd-bootstrap] " + label + " up to date (" + version + ")")
    return
  }
  for (const d of readdirSync(src)) {
    if (filter && !filter(d)) continue
    try { cpSync(join(src, d), join(dest, d), { recursive: true, force: true }) } catch (e: any) { console.log("[mpd-bootstrap] " + label + " copy failed: " + d + " " + String(e?.message ?? e)) }
  }
  try { writeFileSync(stamp, version) } catch { /* ignore */ }
  console.log("[mpd-bootstrap] " + label + " installed (" + version + ") -> " + dest)
}

export function apply(ctx: any, config: Config = {}): void {
  const root = pkgRoot()
  let version = "unknown"
  try { version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version ?? "unknown" } catch { /* keep */ }
  if (config.skipPresets === true) {
    console.log("[mpd-bootstrap] presets skipped (config)")
  } else {
    const presetsSrc = config.presetsDir ? config.presetsDir : join(root, "presets")
    syncTree(presetsSrc, userPresetsDir(), version, "presets", (d) => d.startsWith("mpd-"))
  }
  if (config.skipSkills === true) {
    console.log("[mpd-bootstrap] skills skipped (config)")
  } else {
    const skillsSrc = config.skillsDir ? config.skillsDir : join(root, "skills")
    syncTree(skillsSrc, userSkillsDir(), version, "skills")
  }
}