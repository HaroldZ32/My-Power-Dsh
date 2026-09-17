#!/usr/bin/env node
// t70 harness: run the REAL packer against a SCRATCH out-dir without touching the canonical
// artifact (dist/mpd-package/ is out of this task's scope and the wave packs last, in t35).
//
// It copies scripts/pack-mpd.mjs and rewrites EXACTLY TWO path constants — `repoRoot` and
// `outDir` — then spawns the copy. Everything else (every copy call, the asset tables, the
// manifest writer, the validator sidecar) is byte-identical, and the harness refuses to patch
// when either anchor does not match exactly once, so a drifted packer fails loudly instead of
// silently producing a pack from something else.
//
// usage: node scratch-pack.mjs --out <dir> [--packer <path to pack-mpd.mjs>] [--repo <root>]
import { createHash } from "node:crypto"
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(".")
const arg = (k, dflt) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : dflt }
const out = resolve(arg("--out", join(here, "scratch-artifact")))
const packerPath = resolve(arg("--packer", join(repo, "scripts", "pack-mpd.mjs")))

const source = readFileSync(packerPath, "utf8")
const sha = (text) => createHash("sha256").update(text).digest("hex")
const lines = source.split("\n")

const anchors = [
  { name: "repoRoot", re: /^const repoRoot = dirname\(dirname\(fileURLToPath\(import\.meta\.url\)\)\)$/, replacement: "const repoRoot = " + JSON.stringify(repo) },
  { name: "outDir", re: /^const outDir = join\(repoRoot, "dist", "mpd-package"\)$/, replacement: "const outDir = " + JSON.stringify(out) },
]
for (const a of anchors) {
  const hits = lines.map((l, i) => (a.re.test(l) ? i : -1)).filter((i) => i >= 0)
  if (hits.length !== 1) {
    console.error("[scratch-pack] anchor `" + a.name + "` matched " + hits.length + " line(s), expected exactly 1 — refusing to patch a packer that has drifted")
    process.exit(2)
  }
  lines[hits[0]] = a.replacement
}
const patched = lines.join("\n")
const scratchPacker = join(here, "pack-mpd.scratch.mjs")
writeFileSync(scratchPacker, patched)

console.log("[scratch-pack] repo      = " + repo)
console.log("[scratch-pack] outDir    = " + out)
console.log("[scratch-pack] packer    = " + packerPath + "  sha256=" + sha(source).slice(0, 16))
console.log("[scratch-pack] patched   = " + scratchPacker + "  sha256=" + sha(patched).slice(0, 16))
console.log("[scratch-pack] patched lines: " + anchors.map((a) => a.name).join(", ") + " (2 of " + lines.length + " lines rewritten; every other line byte-identical)")

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const run = spawnSync(process.execPath, [scratchPacker], { stdio: ["ignore", "inherit", "inherit"], cwd: repo })
console.log("[scratch-pack] packer exit = " + run.status)
process.exit(run.status ?? 1)
