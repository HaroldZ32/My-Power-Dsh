#!/usr/bin/env node
// t9 (Reviewer) supplementary B8 MOUNT proof.
//
// The deterministic launcher gates prove the SHIPPED launcher answers real MCP
// calls. This adds the missing half: with every binary/CLI pin SCRUBBED, does a
// real dsh boot MOUNT the two MCP rows and start the launcher children?
//
// It cannot use the QA devPatch() verbatim: that rewrite keeps the
// `+ "/node_modules/"` operand, so the MCP row args become
// `<baseUrl>/node_modules/<abs-repo-path>/...` (t6's finding). This script applies
// the SAME generic rewrite and then repairs exactly that operand — nothing else.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, openSync, closeSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = "/root/dshProj/my-power-dsh"
const SCRUB = ["MPD_AST_GREP_SG_PATH", "MPD_AST_GREP_BIN_DIR", "MPD_DSH_ASTGREP_CLI", "MPD_CODEGRAPH_BIN", "MPD_DSH_CODEGRAPH_CLI"]

const sandbox = mkdtempSync(join(tmpdir(), "t9-b8-mount-"))
const ws = join(sandbox, "ws")
mkdirSync(ws, { recursive: true })
const home = join(sandbox, "home")
mkdirSync(home, { recursive: true })

// Corrections applied (and counted so the script can prove it did exactly this):
const PACKED_PRESETS_EXPR = '"/node_modules/@mpd-dsh/mpd/presets"'
let patch = readFileSync(join(repoRoot, "packages", "mpd-bundle", "cordis.patch.yml"), "utf8")
const stats = { presetsExpr: 0, operand: 0 }
patch = patch.split(PACKED_PRESETS_EXPR).join(JSON.stringify(join(repoRoot, "presets")))
stats.presetsExpr = patch.split(JSON.stringify(join(repoRoot, "presets"))).length - 1
patch = patch.split("name: '@mpd-dsh/mpd'").join("name: '" + join(repoRoot, "packages", "mpd-bundle-plugin", "dist", "index.js") + "'")
// Repair the WHOLE MCP-style operand (the QA devPatch only rewrites the inner
// `@mpd-dsh/mpd/` token, leaving `baseUrl + "/node_modules/"` in front):
//   ((typeof baseUrl …) + "/node_modules/@mpd-dsh/mpd/packages/<row>")
//   -> ("/root/dshProj/my-power-dsh/packages/<row>")
patch = patch.replace(/\(\(typeof baseUrl[\s\S]*?\) \+ "\/node_modules\/([^"]+)"\)/g, (_m, rest) => {
  stats.operand += 1
  return '("' + rest + '")'
})
// Remaining bundle-relative rows (@mpd-dsh/mpd/... outside that shape).
patch = patch.split("@mpd-dsh/mpd/").join(repoRoot + "/")
const patchPath = join(here, "b8-mount.dev.patch.yml")
writeFileSync(patchPath, patch)

const env = { ...process.env, DSH_HOME: sandbox, HOME: home }
for (const k of SCRUB) delete env[k]
const logFile = join(here, "b8-mount-boot.log")
const fd = openSync(logFile, "w")
const run = spawnSync("dsh", ["--profile", "headless", "--patch", patchPath, "reply with the single word ok"], {
  cwd: ws, env, encoding: "utf8", timeout: 300_000, stdio: ["ignore", fd, fd],
})
closeSync(fd)
const log = readFileSync(logFile, "utf8")
const g = (re) => (log.match(re) ?? []).map((m) => String(m).slice(0, 200))

const checks = [
  {
    name: "mount: the corrected operand rewrite actually landed in the MCP row args (the QA devPatch defect is repaired for this boot)",
    pass: stats.operand >= 2 && patch.includes("(\"" + repoRoot + "/packages/mpd-mcp-astgrep/launch.mjs\")") && patch.includes("(\"" + repoRoot + "/packages/mpd-mcp-codegraph/launch.mjs\")"),
    detail: `operandFixes=${stats.operand}`,
  },
  {
    name: "mount: no MODULE_NOT_FOUND for either launcher",
    pass: !/MODULE_NOT_FOUND/.test(log),
    detail: g(/MODULE_NOT_FOUND[^\n]*/).join(" | ") || "none",
  },
  {
    name: "mount: no MCP child spawn failure / BINARY_NOT_FOUND at boot",
    pass: !/BINARY_NOT_FOUND/.test(log) && !/plugin tree failed to load/.test(log) && !/failed to apply loader entry/.test(log),
    detail: g(/(BINARY_NOT_FOUND|plugin tree failed to load|failed to apply loader entry)[^\n]*/).join(" | ") || "none",
  },
  {
    name: "mount: mpd-codegraph resolved a binary (no `init status=no-binary`)",
    pass: /\[mpd-codegraph\] init status=ok/.test(log),
    detail: g(/\[mpd-codegraph\] init status=[^\n]*/).join(" | ") || "no mpd-codegraph init line",
  },
]
const result = {
  task: "t9 supplementary B8 mount boot (pins scrubbed, devPatch operand repaired)",
  stamp: new Date().toISOString(),
  bootExit: run.status,
  envScrubbed: SCRUB,
  rewriteStats: stats,
  patchPath,
  checks,
  allPass: checks.every((c) => c.pass),
  logPath: logFile,
  logExcerpt: log.split("\n").filter((l) => /mpd|mcp|BINARY|credential|credential|launch/i.test(l)).slice(0, 25),
}
writeFileSync(join(here, "b8-mount-boot.result.json"), JSON.stringify(result, null, 2))
console.log(JSON.stringify({ bootExit: run.status, rewriteStats: stats, allPass: result.allPass, checks: checks.map((c) => ({ [c.pass ? "PASS" : "FAIL"]: c.name, detail: c.detail })) }, null, 2))
rmSync(sandbox, { recursive: true, force: true })
process.exit(result.allPass ? 0 : 1)
