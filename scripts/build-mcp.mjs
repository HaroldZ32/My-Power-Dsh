#!/usr/bin/env node
// 离线构建 ast-grep/git-bash MCP：源码从 omo 检出（只读）拷入临时工作区，
// 用 bun cache 提供外部依赖，bun build 后把 dist 产物拷入 omo-dsh 插件包。
// 原仓库零改动；产物进插件包（plugin-form）+ SHA256 记录 BUILD.lock。
import { spawnSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, symlinkSync, mkdtempSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const omoRoot = join(repoRoot, "..", "..", "..")
const cacheRoot = join(homedir(), ".bun", "install", "cache")

const SERVERS = [
  { name: "ast-grep", src: "ast-grep-mcp", pkg: "omo-mcp-astgrep", entry: "src/cli.ts", argv: [] },
  { name: "git-bash", src: "git-bash-mcp", pkg: "omo-mcp-gitbash", entry: "src/cli.ts", argv: [] },
  { name: "lsp", src: "lsp-daemon", pkg: "omo-mcp-lsp", entry: "src/cli.ts", argv: ["mcp"] }
]
const CORE = ["mcp-stdio-core", "utils", "omo-config-core", "lsp-core"]
const EXTERNAL = { "js-yaml": "js-yaml@4.3.1", "jsonc-parser": "jsonc-parser@3.3.1", "zod": "zod@4.4.3" }

// F6 fix: 按包名前缀发现所有缓存条目，优先取“期望版本”精确匹配，否则取版本号最大者；
// 实际解析到的条目写入 BUILD.lock 以便复现。
function findCache(entry) {
  const prefix = entry.split("@")[0]
  const matches = readdirSync(cacheRoot).filter((d) => d.startsWith(prefix + "@"))
  if (matches.length === 0) return null
  const want = entry.split("@")[1]
  const exact = matches.find((d) => d === entry)
  const chosen = exact ?? [...matches].sort((a, b) => {
    const va = a.slice(prefix.length + 1), vb = b.slice(prefix.length + 1)
    return vb.localeCompare(va, undefined, { numeric: true })
  })[0]
  return { path: join(cacheRoot, chosen), entry: chosen }
}

function sha(p) { return createHash("sha256").update(readFileSync(p)).digest("hex") }

const work = mkdtempSync(join(tmpdir(), "omo-dsh-mcp-build-"))
try {
  const srcRoot = join(work, "src")
  mkdirSync(srcRoot, { recursive: true })
  for (const c of CORE) {
    cpSync(join(omoRoot, "packages", c), join(srcRoot, c), { recursive: true, filter: (s) => !s.includes("node_modules") && !s.includes("dist") && !s.includes(".git") })
  }
  for (const s of SERVERS) {
    cpSync(join(omoRoot, "packages", s.src), join(srcRoot, s.src), { recursive: true, filter: (p) => !p.includes("node_modules") && !p.includes("dist") && !p.includes(".git") })
  }
  // node_modules 布局（模仿 bun workspace）
  const nm = join(work, "node_modules", "@oh-my-opencode")
  mkdirSync(nm, { recursive: true })
  for (const c of CORE) {
    symlinkSync(join(srcRoot, c), join(nm, c), "dir")
  }
  const extNm = join(work, "node_modules")
  const resolvedExternals = {}
  for (const [name, entry] of Object.entries(EXTERNAL)) {
    const from = findCache(entry)
    if (!from) { console.error("[build-mcp] bun cache 缺外部依赖: " + entry); process.exit(1) }
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
    cpSync(cli, join(out, "cli.js"))
    writeFileSync(join(out, "BUILD.lock"), JSON.stringify({
      source: "oh-my-openagent", sourceDir: "packages/" + s.src, builtAt: new Date().toISOString(),
      build: ["bun build " + s.entry + " --outdir dist --target node --format esm"],
      externalDeps: resolvedExternals,
      artifact: { file: "cli.js", sha256: sha(join(out, "cli.js")), bytes: readFileSync(join(out, "cli.js")).length }
    }, null, 2) + "\n")
    console.log("[build-mcp] " + s.name + " -> " + join(out, "cli.js") + " (" + readFileSync(join(out, "cli.js")).length + " bytes)")
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
console.log("[build-mcp] PASS")
