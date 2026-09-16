#!/usr/bin/env node

// t19 evidence probe — does the extension CLI work from a PACKED tree?
//
// It mirrors the packer's own copy rules instead of guessing them:
//   * `scripts/pack-mpd.mjs:69-73` (`cpDist`) ships `packages/<pkg>/dist` and NEVER
//     `packages/<pkg>/src`;
//   * `scripts/pack-mpd.mjs:127` ships `scripts/mpd-ext.mjs` (its comment even says the
//     AGENTS.md §4 Extension-CLI gate "runs it from the packed tree");
//   * the copy allowlist carries no `templates/` entry (t6's A4, verified again here).
//
// Two arms, so the two failures are told apart:
//   A. packed exactly as the packer builds it      -> the CLI cannot resolve its sources
//   B. packed with `packages/*/src` restored       -> the CLI runs; only the template is missing
//
// Run: node evidence/extensions/template-scaffold/<stamp>/packed-tree-probe.mjs
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, "..", "..", "..", "..")
const PACKED_PKGS = ["mpd-ext-plugin", "mpd-roles-plugin"]

function buildPacked(root, { withSrc }) {
  mkdirSync(join(root, "scripts"), { recursive: true })
  cpSync(join(REPO, "scripts", "mpd-ext.mjs"), join(root, "scripts", "mpd-ext.mjs"))
  for (const pkg of PACKED_PKGS) {
    mkdirSync(join(root, "packages", pkg), { recursive: true })
    cpSync(join(REPO, "packages", pkg, "dist"), join(root, "packages", pkg, "dist"), { recursive: true })
    if (withSrc) cpSync(join(REPO, "packages", pkg, "src"), join(root, "packages", pkg, "src"), { recursive: true })
  }
  cpSync(join(REPO, "extensions"), join(root, "extensions"), { recursive: true })
}

function run(root, args) {
  const result = spawnSync("bun", ["scripts/mpd-ext.mjs", ...args], { cwd: root, encoding: "utf8" })
  const stdout = result.stdout ?? ""
  const stderr = result.stderr ?? ""
  return {
    args,
    exitCode: result.status,
    firstLine: (stdout.trim().split("\n")[0] ?? "") || (stderr.trim().split("\n")[0] ?? ""),
    stderrTail: stderr.trim().split("\n").slice(-3).join(" | ").slice(0, 400),
  }
}

const packerSource = readFileSync(join(REPO, "scripts", "pack-mpd.mjs"), "utf8")
const sandbox = mkdtempSync(join(tmpdir(), "t19-packed-tree-"))
const report = {
  probe: "packed-tree-probe",
  repo: REPO,
  packer_facts: {
    "ships scripts/mpd-ext.mjs": packerSource.includes('"mpd-ext.mjs"'),
    "copies templates/": /templates\//.test(packerSource),
    "copies packages/*/src": /packages",\s*p,\s*"src"/.test(packerSource) || packerSource.includes('"src"'),
  },
  arms: [],
}

try {
  for (const withSrc of [false, true]) {
    const root = join(sandbox, withSrc ? "B-with-src" : "A-packed")
    buildPacked(root, { withSrc })
    const entry = {
      arm: withSrc ? "B — packed + packages/*/src restored" : "A — packed exactly as the packer builds it",
      layout: {
        "scripts/mpd-ext.mjs": existsSync(join(root, "scripts", "mpd-ext.mjs")),
        "packages/mpd-ext-plugin/src": existsSync(join(root, "packages", "mpd-ext-plugin", "src")),
        "packages/mpd-roles-plugin/src": existsSync(join(root, "packages", "mpd-roles-plugin", "src")),
        "templates/mpd-extension": existsSync(join(root, "templates", "mpd-extension")),
      },
      runs: [
        run(root, ["validate", "extensions/mpd-ext-example"]),
        run(root, ["scaffold", "probe-ext", "--dir", "."]),
        run(root, ["--self-test"]),
      ],
    }
    entry.template_shipped = entry.layout["templates/mpd-extension"]
    report.arms.push(entry)
  }
} finally {
  rmSync(sandbox, { recursive: true, force: true })
}

mkdirSync(join(HERE, "raw"), { recursive: true })
writeFileSync(join(HERE, "raw", "packed-tree-probe.json"), JSON.stringify(report, null, 2) + "\n")

for (const arm of report.arms) {
  process.stdout.write(`${arm.arm}\n`)
  process.stdout.write(`  layout: ${JSON.stringify(arm.layout)}\n`)
  for (const r of arm.runs) {
    process.stdout.write(`  ${JSON.stringify(r.args)} -> exit ${r.exitCode}: ${r.firstLine}\n`)
  }
}
process.stdout.write(`\nwrote ${join(HERE, "raw", "packed-tree-probe.json")}\n`)
