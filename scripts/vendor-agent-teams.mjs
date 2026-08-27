#!/usr/bin/env node
// vendor-agent-teams.mjs — materialize the SERVER-side runtime closure for the
// first-party agent-teams package (packages/mpd-agent-teams, upstream 0.1.14) and
// rewrite its host-plane lib to relative _deps paths.
//
// Why: \`dsh plugin add\` is pnpm-driven; pnpm never links a bundle's transitive deps
// into the profile root, and code loaded from the bundle cannot resolve @deepseek-ai/*
// bare imports through the profile root. The peer packages are taken from the HOST
// installation (exact running versions) and their bare imports rewritten to relative
// _deps paths, so the package is self-contained under any install layout.
//
// Usage: node scripts/vendor-agent-teams.mjs
//   env DSH_HOST_NM  host's node_modules root (default: the dsh installation's nested
//                    node_modules, e.g. <nvm>/lib/node_modules/@deepseek-ai/dsh/node_modules)
// The client artifacts (lib/client.js + lib/client/*) keep their bare @deepseek-ai
// imports: they are loaded by the web app's own bundler, not by node.
// Orchestrated by scripts/build-agent-teams.mjs (tsc build -> this materialize/rewrite).
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import process from "node:process"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const VENDOR = join(repoRoot, "packages", "mpd-agent-teams")
const DEPS = join(VENDOR, "_deps")
const HOST_NM = process.env.DSH_HOST_NM || "/home/haroldzhao/.nvm/versions/node/v24.19.0/lib/node_modules/@deepseek-ai/dsh/node_modules"

// name -> { dir, entry, specDir?, whole? } : bare specifier -> vendored subdir + entry file
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
  "@deepseek-ai/dsh-system-prompt": { dir: "dsh-system-prompt", entry: "lib/index.js" },
  "@deepseek-ai/dsh-workspace": { dir: "dsh-workspace", entry: "lib/index.js" },
  "@deepseek-ai/dsh-commands": { dir: "dsh-commands", entry: "lib/index.js" },
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
    out = out.replace(new RegExp("['\"]\\.\\.?/_deps/" + c.dir + "/[^'\"]+['\"]", "g"), "'" + spec + "'")
  }
  for (const [spec, c] of Object.entries(CHAIN)) {
    let target = relative(dirname(file), join(DEPS, c.dir, c.entry)).split("\\").join("/")
    if (!target.startsWith(".")) target = "./" + target
    out = out.split("from '" + spec + "'").join("from '" + target + "'")
    out = out.split("from \"" + spec + "\"").join("from '" + target + "'")
    out = out.split("import '" + spec + "'").join("import '" + target + "'")
    out = out.split("import(\"" + spec + "\")").join("import('" + target + "')")
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

// Type-only host dependency closures: vendored for typechecking, never loaded at
// runtime by the host plane (their own bare imports stay untouched).
const TYPES_ONLY_DIRS = new Set(["dsh-commands", "dsh-system-prompt", "dsh-workspace"])
function isTypesOnly(file) {
  const rel = relative(DEPS, file).split(sep).join("/")
  return [...TYPES_ONLY_DIRS].some((d) => rel === d || rel.startsWith(d + "/"))
}

/** Client artifacts are browser-bundler-resolved and must keep bare imports untouched. */
function isClientArtifact(file) {
  const rel = relative(repoRoot, file).split(sep).join("/")
  return rel.includes("/lib/client/") || rel.endsWith("/lib/client.js") || rel.endsWith("/lib/client.js.map")
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
  const depsOnly = process.argv.includes("--deps-only")
  if (!existsSync(HOST_NM)) { console.error("[vendor-agent-teams] FAIL: DSH_HOST_NM not found: " + HOST_NM); process.exit(1) }
  if (!depsOnly && !existsSync(join(VENDOR, "lib", "index.js"))) { console.error("[vendor-agent-teams] FAIL: packages/mpd-agent-teams/lib/index.js missing (run the tsc build first)"); process.exit(1) }
  rmSync(DEPS, { recursive: true, force: true })
  mkdirSync(DEPS, { recursive: true })
  for (const [spec, c] of Object.entries(CHAIN)) {
    vendorPackage(spec, c)
    console.log("[vendor-agent-teams] vendored " + spec + " -> _deps/" + c.dir)
  }
  for (const f of walk(DEPS)) {
    if (isTypesOnly(f)) continue
    rewriteFile(f)
  }
  if (depsOnly) {
    console.log("[vendor-agent-teams] deps-only materialize OK (" + Object.keys(CHAIN).length + " packages)")
    return
  }
  for (const f of walk(join(VENDOR, "lib"))) {
    if (isClientArtifact(f)) continue
    rewriteFile(f)
  }
  // report any residual bare imports (should be none outside client artifacts + d.ts)
  const residual = walk(join(VENDOR, "lib")).concat(walk(DEPS)).filter((f) => !isClientArtifact(f) && !isTypesOnly(f))
    .map((f) => ({ f, m: readFileSync(f, "utf8").match(/from ["']([^"'][^"']*?)["']/g) || [] }))
    .flatMap(({ f, m }) => m.map((x) => f.replace(repoRoot, "<repo>") + " :: " + x))
    .filter((x) => /from ['"]@|from ['"]zod|from ['"]@standard/.test(x))
  console.log("[vendor-agent-teams] residual bare imports (excluding client artifacts): " + residual.length)
  residual.forEach((x) => console.log("  " + x))
}

main()