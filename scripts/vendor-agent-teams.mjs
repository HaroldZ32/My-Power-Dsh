#!/usr/bin/env node
// vendor-agent-teams.mjs — materialize the @nanmicoder/dsh-agent-teams plugin (0.1.14)
// and its SERVER-side runtime closure into packages/mpd-agent-teams-plugin/_deps/ so
// the adopted (first-class main-code) plugin is self-contained under any install layout.
//
// Why: `dsh plugin add` is pnpm-driven; pnpm never links a bundle's transitive deps
// into the profile root, and code physically located OUTSIDE the profile's node_modules
// (e.g. a link: to this checkout) cannot resolve @deepseek-ai/* bare imports. The
// plugin's peer packages are taken from the HOST installation (exact running versions)
// and their bare imports rewritten to relative _deps paths.
//
// Usage: node scripts/vendor-agent-teams.mjs
//   env DSH_HOST_NM  host's node_modules root — REQUIRED (no machine-specific
//                    default; e.g. <nvm>/lib/node_modules/@deepseek-ai/dsh/node_modules)
// The client bundle (lib/client.js) keeps its bare @deepseek-ai imports: it is loaded by
// the web app's own bundler, not by node.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import process from "node:process"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const VENDOR = join(repoRoot, "packages", "mpd-agent-teams-plugin")
const DEPS = join(VENDOR, "_deps")
const HOST_NM = process.env.DSH_HOST_NM

// name -> { spec, entry } : bare specifier -> vendored subdir + entry file
const CHAIN = {
  "@deepseek-ai/cosmokit": { dir: "cosmokit", entry: "lib/index.js" },
  "@deepseek-ai/schemastery": { dir: "schemastery", entry: "lib/index.mjs" },
  "@deepseek-ai/cordis": { dir: "cordis", entry: "lib/index.js" },
  "@deepseek-ai/dsh-scope": { dir: "dsh-scope", entry: "lib/index.js" },
  "@deepseek-ai/dsh-timeout": { dir: "dsh-timeout", entry: "lib/index.js" },
  "@deepseek-ai/dsh-llm": { dir: "dsh-llm", entry: "lib/index.js" },
  "@deepseek-ai/dsh-session": { dir: "dsh-session", entry: "lib/index.js" },
  "@deepseek-ai/dsh-subagent": { dir: "dsh-subagent", entry: "lib/index.js" },
  "@deepseek-ai/dsh-tools": { dir: "dsh-tools", entry: "lib/index.js" },
  "@deepseek-ai/dsh-agent": { dir: "dsh-agent", entry: "lib/index.js" },
  "zod": { dir: "zod", entry: "index.js", specDir: "zod", whole: true },
  "@standard-schema/spec": { dir: "standard-schema", entry: "dist/index.js", specDir: "@standard-schema/spec", whole: true }
}

function srcOf(spec) {
  const c = CHAIN[spec]
  // scoped @deepseek-ai packages live nested under $HOST_NM/@deepseek-ai/<name>
  if (spec.startsWith("@deepseek-ai/")) return join(HOST_NM, "@deepseek-ai", spec.slice("@deepseek-ai/".length))
  return join(HOST_NM, c.specDir)
}

function rewriteFile(file) {
  const src = readFileSync(file, "utf8")
  let out = src
  // pre-normalize any manual/previous relative _deps paths back to bare specifiers
  for (const [spec, c] of Object.entries(CHAIN)) {
    out = out.replace(new RegExp(`['"]\\.\\.?/_deps/${c.dir}/[^'"]+['"]`, "g"), `'${spec}'`)
  }
  for (const [spec, c] of Object.entries(CHAIN)) {
    let target = relative(dirname(file), join(DEPS, c.dir, c.entry)).split("\\").join("/")
    if (!target.startsWith(".")) target = "./" + target
    out = out.split(`from '${spec}'`).join(`from '${target}'`)
    out = out.split(`from "${spec}"`).join(`from '${target}'`)
    out = out.split(`import '${spec}'`).join(`import '${target}'`)
    out = out.split(`import "${spec}"`).join(`import '${target}'`)
    out = out.split(`import("${spec}")`).join(`import('${target}')`)
    out = out.split(`import('${spec}')`).join(`import('${target}')`)
    out = out.split(`require("${spec}")`).join(`require('${target}')`)
    out = out.split(`require('${spec}')`).join(`require('${target}')`)
  }
  if (out !== src) writeFileSync(file, out)
}

function walk(dir) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (/\.(js|mjs|cjs)$/.test(e.name)) out.push(p)
  }
  return out
}

function vendorPackage(spec, c) {
  const src = srcOf(spec)
  const dstDir = join(DEPS, c.dir)
  if (c.whole) {
    if (!existsSync(join(src, c.entry.split("/")[0]))) throw new Error("missing entry for " + spec + " at " + src)
    mkdirSync(dstDir, { recursive: true })
    cpSync(src, dstDir, { recursive: true, filter: (f) => !/(^|\/)(src|tests|benchmarks|dist-cjs)(\/|$)/.test(f) })
  } else {
    const srcLib = join(src, "lib")
    if (!existsSync(srcLib)) throw new Error("missing lib for " + spec + " at " + src)
    mkdirSync(dstDir, { recursive: true })
    cpSync(srcLib, join(dstDir, "lib"), { recursive: true })
  }
  for (const f of ["package.json", "LICENSE", "LICENSE.md"]) {
    const s = join(src, f)
    if (existsSync(s)) cpSync(s, join(dstDir, f))
  }
}

function main() {
  if (!HOST_NM) { console.error("[vendor-agent-teams] FAIL: DSH_HOST_NM must point at the dsh installation's node_modules root (no built-in default; e.g. export DSH_HOST_NM=$(dirname $(dirname $(which dsh))) 2>/dev/null or <nvm>/lib/node_modules/@deepseek-ai/dsh/node_modules)"); process.exit(1) }
  if (!existsSync(HOST_NM)) { console.error("[vendor-agent-teams] FAIL: DSH_HOST_NM not found: " + HOST_NM); process.exit(1) }
  if (!existsSync(join(repoRoot, "packages", "mpd-agent-teams-plugin", "lib", "index.js"))) { console.error("[vendor-agent-teams] FAIL: packages/mpd-agent-teams-plugin/lib missing (restore the adopted plugin first)"); process.exit(1) }
  rmSync(DEPS, { recursive: true, force: true })
  mkdirSync(DEPS, { recursive: true })
  for (const [spec, c] of Object.entries(CHAIN)) {
    vendorPackage(spec, c)
    console.log("[vendor-agent-teams] vendored " + spec + " -> _deps/" + c.dir)
  }
  for (const f of walk(DEPS)) rewriteFile(f)
  for (const f of walk(join(VENDOR, "lib"))) {
    if (f.endsWith("client.js") || f.endsWith("client.js.map")) continue
    rewriteFile(f)
  }
  // report any residual bare imports (should be only the client bundle + type-only)
  const residual = walk(join(VENDOR, "lib")).concat(walk(DEPS)).filter((f) => !f.includes("client.js"))
    .map((f) => ({ f, m: readFileSync(f, "utf8").match(/(?:from|require\()\s*["']([^"'][^"']*?)["']/g) || [] }))
    .flatMap(({ f, m }) => m.map((x) => f.replace(repoRoot, "<repo>") + " :: " + x))
    .filter((x) => /(?:from|require\()\s*["']@|(?:from|require\()\s*["']zod|(?:from|require\()\s*["']@standard/.test(x))
  console.log("[vendor-agent-teams] residual bare imports (excluding client): " + residual.length)
  residual.forEach((x) => console.log("  " + x))
}

main()
