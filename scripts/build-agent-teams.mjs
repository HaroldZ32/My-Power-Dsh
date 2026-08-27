#!/usr/bin/env node
// build-agent-teams.mjs — build the first-party agent-teams package from source.
//   1) tsc -p packages/mpd-agent-teams/tsconfig.build.json  (host plane -> lib/)
//   2) node scripts/vendor-agent-teams.mjs                  (_deps materialize + import rewrite)
// The web client artifacts (lib/client.js, lib/client/*) are NOT rebuilt: they are
// upstream-built and browser-bundler-resolved (see docs/plan-f.md W1).
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const pkgDir = join(repoRoot, "packages", "mpd-agent-teams")
const isWin = process.platform === "win32"
const tscName = isWin ? "tsc.cmd" : "tsc"
const tscCandidates = [
  join(repoRoot, "node_modules", ".bin", tscName),
  join(pkgDir, "node_modules", ".bin", tscName),
]
const tsc = tscCandidates.find((p) => existsSync(p))
if (!tsc) {
  console.error("[build-agent-teams] FAIL: typescript not installed; run 'bun install' (or 'npm install --ignore-scripts') at the repo root first")
  process.exit(1)
}

function fail(msg) { console.error("[build-agent-teams] FAIL -", msg); process.exit(1) }

const depsOnly = spawnSync(process.execPath, [join(repoRoot, "scripts", "vendor-agent-teams.mjs"), "--deps-only"], { stdio: "inherit" })
if (depsOnly.status !== 0) fail("vendor-agent-teams --deps-only exit " + depsOnly.status)

console.log("[build-agent-teams] tsc:", relative(repoRoot, tsc))
const build = spawnSync(tsc, ["-p", "tsconfig.build.json"], { cwd: pkgDir, stdio: "inherit" })
if (build.status !== 0) fail("tsc exit " + build.status)

const vendor = spawnSync(process.execPath, [join(repoRoot, "scripts", "vendor-agent-teams.mjs")], { stdio: "inherit" })
if (vendor.status !== 0) fail("vendor-agent-teams exit " + vendor.status)

// --- client registration id must equal the bundle ENTRY name --------------------
// The web client-modules loader verifies that the served client bundle registers
// itself under the exact plugin entry name of the bundle row
// ('@mpd-dsh/mpd/packages/mpd-agent-teams'). Upstream built the artifact with its npm
// package name; rewrite it here so the source-integrated entry matches.
const ENTRY_ID = "@mpd-dsh/mpd/packages/mpd-agent-teams"
const clientFile = join(pkgDir, "lib", "client.js")
let clientSrc = readFileSync(clientFile, "utf8")
if (clientSrc.includes('id: "@nanmicoder/dsh-agent-teams"')) {
  clientSrc = clientSrc.replace('id: "@nanmicoder/dsh-agent-teams"', 'id: "' + ENTRY_ID + '"')
  writeFileSync(clientFile, clientSrc)
}
if (!clientSrc.includes('id: "' + ENTRY_ID + '"')) fail("client.js registration id not rewritten to " + ENTRY_ID)
console.log("[build-agent-teams] client registration id OK (" + ENTRY_ID + ")")

// --- verification: host-plane lib must have no bare @deepseek-ai / zod imports ----
const lib = join(pkgDir, "lib")
if (!existsSync(join(lib, "index.js"))) fail("lib/index.js missing after build")
function walk(dir) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (/\.(js|mjs)$/.test(e.name)) out.push(p)
  }
  return out
}
const bad = []
for (const f of walk(lib)) {
  const rel = relative(repoRoot, f).split("\\").join("/")
  if (rel.includes("/lib/client/") || rel.endsWith("/lib/client.js") || rel.endsWith("/lib/client.js.map")) continue
  const text = readFileSync(f, "utf8")
  for (const m of text.matchAll(/from ["']((?:@deepseek-ai\/|zod|@standard-schema\/spec)[^"']*)["']/g)) {
    bad.push(rel + " :: " + m[1])
  }
}
if (bad.length) fail("residual bare imports in host lib: " + bad.join(" | "))
console.log("[build-agent-teams] host lib import check OK (no bare @deepseek-ai/zod imports)")
console.log("[build-agent-teams] PASS")