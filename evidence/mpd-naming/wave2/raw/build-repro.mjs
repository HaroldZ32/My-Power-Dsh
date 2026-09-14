// Scratch reproduction of scripts/build-mcp.mjs's build pipeline for ONE server, so the
// pristine (pre-scrub) bundled text can be inspected and the scrub transforms validated
// WITHOUT running the repo's build (whose main() rewrites every dist/BUILD.lock — an
// out-of-scope write for a task scoped to dist/cli.js only).
//
// Usage (from the repo root):
//   node evidence/mpd-naming/wave2/raw/build-repro.mjs git-bash [--apply-scrub] [--compare]
// Writes nothing outside evidence/mpd-naming/wave2/raw/scratch/.
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const repoRoot = process.cwd()
if (!existsSync(join(repoRoot, "scripts", "build-mcp.mjs"))) {
  console.error("run from the repo root")
  process.exit(1)
}
const upstream = join(repoRoot, ".mpd-dsh", "upstream")
const cacheRoot = join(homedir(), ".bun", "install", "cache")
// one subdir per server so a rebuild of one artifact never wipes another ledger
const scratchRoot = join(repoRoot, "evidence", "mpd-naming", "wave2", "raw", "scratch", process.argv[2] ?? "unknown")

const SERVERS = {
  "ast-grep": { src: "ast-grep-mcp", pkg: "mpd-mcp-astgrep", entry: "src/cli.ts" },
  "git-bash": { src: "git-bash-mcp", pkg: "mpd-mcp-gitbash", entry: "src/cli.ts" },
  lsp: { src: "lsp-daemon", pkg: "mpd-mcp-lsp", entry: "src/cli.ts" },
}
const CORE = ["mcp-stdio-core", "utils", "omo-config-core", "lsp-core"]
const EXTERNAL = { "js-yaml": "js-yaml@4.3.1", "jsonc-parser": "jsonc-parser@3.3.1", zod: "zod@4.4.3" }
const LSP_OVERLAY_DIR = join(repoRoot, "packages", "mpd-mcp-lsp", "overlay", "lsp")
const BUILTIN_BUILD_ANCHOR = "mpd-lsp-overlay-v1"
const LSP_OVERLAY_FILES = [
  { name: "server-definitions.ts", rel: "src/lsp/server-definitions.ts", baselineExport: "BUILTIN_SERVERS" },
  { name: "language-mappings.ts", rel: "src/lsp/language-mappings.ts", baselineExport: "EXT_TO_LANG" },
]

function findCache(entry) {
  const prefix = entry.split("@")[0]
  const matches = readdirSync(cacheRoot).filter((d) => d.startsWith(prefix + "@"))
  if (matches.length === 0) return null
  const exact = matches.find((d) => d === entry)
  const chosen = exact ?? [...matches].sort((a, b) => {
    const va = a.slice(prefix.length + 1)
    const vb = b.slice(prefix.length + 1)
    return vb.localeCompare(va, undefined, { numeric: true })
  })[0]
  return { path: join(cacheRoot, chosen), entry: chosen }
}

const which = process.argv[2]
const server = SERVERS[which]
if (!server) {
  console.error("usage: build-repro.mjs <ast-grep|git-bash|lsp> [--apply-scrub] [--compare]")
  process.exit(1)
}

rmSync(scratchRoot, { recursive: true, force: true })
const work = join(scratchRoot, "build")
const srcRoot = join(work, "src")
mkdirSync(srcRoot, { recursive: true })
const skip = (p) => !p.includes("node_modules") && !p.includes("dist") && !p.includes(".git")
for (const c of CORE) cpSync(join(upstream, "packages", c), join(srcRoot, c), { recursive: true, filter: skip })
if (which === "lsp") {
  for (const f of LSP_OVERLAY_FILES) {
    const overlayPath = join(LSP_OVERLAY_DIR, f.name)
    const sourcePath = join(srcRoot, "lsp-core", f.rel)
    const overlayText = readFileSync(overlayPath, "utf8")
    const sourceText = readFileSync(sourcePath, "utf8")
    if (!overlayText.includes(BUILTIN_BUILD_ANCHOR) || !sourceText.includes(f.baselineExport)) {
      console.error("overlay drift guard FAILED for " + f.name)
      process.exit(1)
    }
    cpSync(overlayPath, sourcePath)
  }
}
cpSync(join(upstream, "packages", server.src), join(srcRoot, server.src), { recursive: true, filter: skip })
const nm = join(work, "node_modules", "@oh-my-opencode")
mkdirSync(nm, { recursive: true })
for (const c of CORE) symlinkSync(join(srcRoot, c), join(nm, c), "dir")
const extNm = join(work, "node_modules")
for (const [name, entry] of Object.entries(EXTERNAL)) {
  const from = findCache(entry)
  if (!from) {
    console.error("bun cache missing " + entry)
    process.exit(1)
  }
  symlinkSync(from.path, join(extNm, name), "dir")
}
const dir = join(srcRoot, server.src)
const r = spawnSync("bun", ["build", server.entry, "--outdir", "dist", "--target", "node", "--format", "esm"], {
  cwd: dir,
  encoding: "utf8",
  env: { ...process.env, NODE_PATH: join(work, "node_modules") },
})
if (r.status !== 0) {
  console.error("bun build failed:", r.stderr)
  process.exit(1)
}
const pristinePath = join(dir, "dist", "cli.js")
const pristine = readFileSync(pristinePath, "utf8")
writeFileSync(join(scratchRoot, "pristine-" + which + ".js"), pristine)
console.log("[repro] pristine " + which + " bytes=" + Buffer.byteLength(pristine))

if (process.argv.includes("--apply-scrub")) {
  const mod = await import(join(repoRoot, "scripts", "build-mcp.mjs"))
  const scrubbed = mod.applyMpdScrub(which, pristine)
  writeFileSync(join(scratchRoot, "scrubbed-" + which + ".js"), scrubbed)
  console.log("[repro] scrubbed bytes=" + Buffer.byteLength(scrubbed))
  if (process.argv.includes("--compare")) {
    const committedPath = join(repoRoot, "packages", server.pkg, "dist", "cli.js")
    const committed = readFileSync(committedPath, "utf8")
    const same = scrubbed === committed
    console.log("[repro] byte-identical to committed " + server.pkg + ": " + same)
    if (!same) {
      let i = 0
      while (i < Math.min(scrubbed.length, committed.length) && scrubbed[i] === committed[i]) i += 1
      const line = (s) => (s.slice(0, i).split("\n").pop() ?? "").trim().slice(0, 200)
      console.log("[repro] first diff at char " + i)
      console.log("[repro]   rebuilt  : " + JSON.stringify(line(scrubbed)))
      console.log("[repro]   committed: " + JSON.stringify(line(committed)))
      process.exitCode = 2
    }
  }
}
