#!/usr/bin/env node
// Offline build of ast-grep/git-bash MCP: copy source from the oh-my-openagent checkout (read-only) into a temp workspace,
// use bun cache for external dependencies, then after bun build copy dist artifacts into the mpd-dsh plugin package.
// The original repo stays untouched; artifacts go into the plugin package (plugin-form) with SHA256 recorded in BUILD.lock.
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, symlinkSync, mkdtempSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
// Legacy layout assumed repoRoot = <the upstream checkout>/.mpd/port/mpd-dsh. Auto-detect the
// pinned checkout at .mpd-dsh/upstream; override with MPD_UPSTREAM_ROOT when it lives elsewhere.
const mpdRoot = process.env.MPD_UPSTREAM_ROOT || (existsSync(join(repoRoot, ".mpd-dsh", "upstream", ".git")) ? join(repoRoot, ".mpd-dsh", "upstream") : join(repoRoot, "..", "..", ".."))
const cacheRoot = join(homedir(), ".bun", "install", "cache")

const SERVERS = [
  { name: "ast-grep", src: "ast-grep-mcp", pkg: "mpd-mcp-astgrep", entry: "src/cli.ts", argv: [] },
  { name: "git-bash", src: "git-bash-mcp", pkg: "mpd-mcp-gitbash", entry: "src/cli.ts", argv: [] },
  { name: "lsp", src: "lsp-daemon", pkg: "mpd-mcp-lsp", entry: "src/cli.ts", argv: ["mcp"] }
]
const CORE = ["mcp-stdio-core", "utils", "omo-config-core", "lsp-core"]
const EXTERNAL = { "js-yaml": "js-yaml@5.3.0", "jsonc-parser": "jsonc-parser@3.3.1", "zod": "zod@4.4.3" }

// F6 fix: discover all cache entries by package-name prefix, prefer an exact match for the "expected version", otherwise take the highest version;
// write the actually resolved entries to BUILD.lock for reproducibility.
function findCache(entry) {
  const prefix = entry.split("@")[0]
  const matches = readdirSync(cacheRoot).filter((d) => d.startsWith(prefix + "@"))
  if (matches.length === 0) return null
  const exact = matches.find((d) => d === entry)
  const chosen = exact ?? [...matches].sort((a, b) => {
    const va = a.slice(prefix.length + 1), vb = b.slice(prefix.length + 1)
    return vb.localeCompare(va, undefined, { numeric: true })
  })[0]
  return { path: join(cacheRoot, chosen), entry: chosen }
}

const work = mkdtempSync(join(tmpdir(), "mpd-dsh-mcp-build-"))
try {
  const srcRoot = join(work, "src")
  mkdirSync(srcRoot, { recursive: true })
  for (const c of CORE) {
    cpSync(join(mpdRoot, "packages", c), join(srcRoot, c), { recursive: true, filter: (s) => !s.includes("node_modules") && !s.includes("dist") && !s.includes(".git") })
  }
  for (const s of SERVERS) {
    cpSync(join(mpdRoot, "packages", s.src), join(srcRoot, s.src), { recursive: true, filter: (p) => !p.includes("node_modules") && !p.includes("dist") && !p.includes(".git") })
  }
  // node_modules layout (mimic a bun workspace)
  const nm = join(work, "node_modules", "@oh-my-opencode")
  mkdirSync(nm, { recursive: true })
  for (const c of CORE) {
    symlinkSync(join(srcRoot, c), join(nm, c), "dir")
  }
  const extNm = join(work, "node_modules")
  const resolvedExternals = {}
  for (const [name, entry] of Object.entries(EXTERNAL)) {
    const from = findCache(entry)
    if (!from) { console.error("[build-mcp] bun cache missing external dependency: " + entry); process.exit(1) }
    symlinkSync(from.path, join(extNm, name), "dir")
    resolvedExternals[name] = from.entry
    console.log("[build-mcp] ext dep: " + name + " <- " + from.entry)
  }
  for (const s of SERVERS) {
    const dir = join(srcRoot, s.src)
    const r = spawnSync("bun", ["build", s.entry, "--outdir", "dist", "--target", "node", "--format", "esm"], { cwd: dir, encoding: "utf8", env: { ...process.env, NODE_PATH: join(work, "node_modules") } })
    if (r.status !== 0) { console.error("[build-mcp] build failed " + s.name + ":", r.stderr); process.exit(1) }
    const cli = join(dir, "dist", "cli.js")
    const out = join(repoRoot, "packages", s.pkg, "dist")
    mkdirSync(out, { recursive: true })
    const built = readFileSync(cli, "utf8")
    writeFileSync(join(out, "cli.js"), built)
    writeFileSync(join(out, "BUILD.lock"), JSON.stringify({
      source: "oh-my-openagent", sourceDir: "packages/" + s.src, builtAt: new Date().toISOString(),
      build: ["bun build " + s.entry + " --outdir dist --target node --format esm"],
      externalDeps: resolvedExternals,
      artifact: { file: "cli.js", sha256: createHash("sha256").update(built).digest("hex"), bytes: built.length }
    }, null, 2) + "\n")
    console.log("[build-mcp] " + s.name + " -> " + join(out, "cli.js") + " (" + built.length + " bytes)")
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
console.log("[build-mcp] PASS")
