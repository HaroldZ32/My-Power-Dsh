#!/usr/bin/env node
// vendor-agent-teams.ts — materialize the server-side runtime closure of the adopted
// @nanmicoder/dsh-agent-teams plugin (0.1.14 body + backported 0.1.16-rc.3 upstream deltas)
// and its SERVER-side runtime closure into packages/mpd-agent-teams-plugin/_deps/ so
// the adopted (first-class main-code) plugin is self-contained under any install layout.
//
// Why: `dsh plugin add` is pnpm-driven; pnpm never links a bundle's transitive deps
// into the profile root, and code physically located OUTSIDE the profile's node_modules
// (e.g. a link: to this checkout) cannot resolve @deepseek-ai/* bare imports. The
// plugin's peer packages are taken from the HOST installation (exact running versions)
// and their bare imports rewritten to relative _deps paths.
//
// Usage: node scripts/vendor-agent-teams.ts
//   env DSH_HOST_NM  host's node_modules root — REQUIRED (no machine-specific
//                    default; e.g. <nvm>/lib/node_modules/@deepseek-ai/dsh/node_modules)
// The client bundle (lib/client.js) keeps its bare @deepseek-ai imports: it is loaded by
// the web app's own bundler, not by node.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import process from "node:process"
import { applyExportBridge } from "./patch-agent-teams-client.ts"
import { applyAgentTeamsFixes } from "./patch-agent-teams-fixes.ts"

/** The repository root, derived from this script's own URL (it lives in `<root>/scripts/`). */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
/** Root of the adopted agent-teams package whose runtime closure is vendored. */
const VENDOR = join(repoRoot, "packages", "mpd-agent-teams-plugin")
/** Vendored-closure directory under the adopted package; fully rebuilt by every run. */
const DEPS = join(VENDOR, "_deps")
/** The host installation's `node_modules` root; `undefined` unless `DSH_HOST_NM` is exported. */
const HOST_NM: string | undefined = process.env.DSH_HOST_NM

/** One chain entry: where a bare specifier's package is copied from and into. */
interface ChainEntry {
  /** Vendored subdirectory under `_deps/` that receives this package. */
  readonly dir: string
  /** Entry file inside the package, relative to the package root, kept for path rewriting. */
  readonly entry: string
  /** Source directory name under `$HOST_NM` for an unscoped package; absent for `@deepseek-ai/*`. */
  readonly specDir?: string
  /** Whether the WHOLE package is copied instead of only its `lib/` directory. */
  readonly whole?: boolean
}

// name -> { spec, entry } : bare specifier -> vendored subdir + entry file
/** The vendoring table: bare specifier -> vendored subdir + entry file, in copy order. */
const CHAIN: Readonly<Record<string, ChainEntry>> = {
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

/**
 * Resolve the host-side source root of one chain entry.
 * @param spec - the bare specifier from the vendoring table.
 * @returns the directory under `$HOST_NM` this package is copied from.
 */
function srcOf(spec: string): string {
  /** This specifier's vendoring table row. */
  const c = CHAIN[spec]
  // scoped @deepseek-ai packages live nested under $HOST_NM/@deepseek-ai/<name>
  // `HOST_NM` is asserted: main() refuses to reach any vendoring without it (non-empty check first).
  if (spec.startsWith("@deepseek-ai/")) return join(HOST_NM!, "@deepseek-ai", spec.slice("@deepseek-ai/".length))
  // `specDir` is asserted because every unscoped table row declares it; an undeclared one still
  // reaches join() as undefined and throws the same ERR_INVALID_ARG_TYPE the original did.
  return join(HOST_NM!, c.specDir!)
}

/**
 * Rewrite one vendored file's bare import specifiers to relative `_deps` paths, in place.
 * @param file - absolute path of the file to rewrite; written only when its bytes changed.
 */
function rewriteFile(file: string): void {
  /** The file's original bytes (UTF-8), used both as the replacement input and as the write guard. */
  const src = readFileSync(file, "utf8")
  /** The rewritten text; written back only when it differs from `src`. */
  let out = src
  // pre-normalize any manual/previous relative _deps paths back to bare specifiers
  for (const [spec, c] of Object.entries(CHAIN)) {
    out = out.replace(new RegExp(`['"]\\.\\.?/_deps/${c.dir}/[^'"]+['"]`, "g"), `'${spec}'`)
  }
  for (const [spec, c] of Object.entries(CHAIN)) {
    /** Path from this file to the vendored entry, in POSIX form (module specifiers use `/`). */
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

/**
 * Collect every JavaScript module under a directory, recursively.
 * @param dir - directory to walk.
 * @returns absolute paths of the `.js`/`.mjs`/`.cjs` files found, in directory order.
 */
function walk(dir: string): string[] {
  /** Accumulated module paths, depth-first. */
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    /** Absolute path of this entry. */
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (/\.(js|mjs|cjs)$/.test(e.name)) out.push(p)
  }
  return out
}

/**
 * Copy one table row's package into `_deps/<dir>`.
 * @param spec - the bare specifier being vendored (named in the failure messages).
 * @param c - that specifier's table row.
 */
function vendorPackage(spec: string, c: ChainEntry): void {
  /** Host-side source root of this package. */
  const src = srcOf(spec)
  /** Destination directory under `_deps/`. */
  const dstDir = join(DEPS, c.dir)
  if (c.whole) {
    if (!existsSync(join(src, c.entry.split("/")[0]))) throw new Error("missing entry for " + spec + " at " + src)
    mkdirSync(dstDir, { recursive: true })
    cpSync(src, dstDir, { recursive: true, filter: (f: string): boolean => !/(^|\/)(src|tests|benchmarks|dist-cjs)(\/|$)/.test(f) })
  } else {
    /** The package's `lib/` directory, the only part of a `@deepseek-ai/*` package vendored. */
    const srcLib = join(src, "lib")
    if (!existsSync(srcLib)) throw new Error("missing lib for " + spec + " at " + src)
    mkdirSync(dstDir, { recursive: true })
    cpSync(srcLib, join(dstDir, "lib"), { recursive: true })
  }
  for (const f of ["package.json", "LICENSE", "LICENSE.md"]) {
    /** The host-side license/manifest file, copied only when the package carries it. */
    const s = join(src, f)
    if (existsSync(s)) cpSync(s, join(dstDir, f))
  }
}

/**
 * One vendored file with the import specifiers its bytes spell out.
 * Kept as a named shape so the capture step types `m` as `string[]` (an unmatched `match` is `[]`).
 */
interface SpecifierHits {
  /** Absolute path of the scanned file. */
  readonly f: string
  /** Matched `from "…"` / `require("…")` substrings in file order; `[]` when the file has none. */
  readonly m: string[]
}

/** The report `applyAgentTeamsFixes` returns for one heal/verify pass over the adopted tree. */
interface AgentTeamsFixReport {
  /** `applied` when this pass inserted at least one region, otherwise `already-applied`. */
  readonly status: string
  /** Registered adopted files the pass walked. */
  readonly files: readonly string[]
  /** Ids of the deltas inserted by this pass (`[]` for a verify-only pass). */
  readonly inserted: readonly string[]
  /** Number of registered regions the pass walked. */
  readonly regions: number
}

/** The report `applyExportBridge` returns for one client-bridge pass. */
interface ClientBridgeReport {
  /** Bridge state after the pass: `applied`, `already-applied` or `missing`. */
  readonly status: string
  /** Number of symbols the pinned bridge exports. */
  readonly symbols: number
  /** Size in bytes of the client bundle the pass measured. */
  readonly bytes: number
}

/** Run the full vendoring pass; exits 1 on every refusal instead of leaving a half-vendored tree. */
function main(): void {
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
  // The adopted SERVER lib/ is never re-copied by this script (only import-rewritten above),
  // but our mpd LOCAL ADAPTATION deltas in it live in marked regions. Heal + verify them here so
  // a re-vendor / hand re-materialize of the tree cannot silently drop or rewrite them. A
  // refusal (missing region, ambiguous anchor, or a region that would re-declare a symbol the
  // file still carries) is a FAILURE of this run, not a warning: a silently broken adopted
  // module is exactly what the guard exists to prevent.
  /** The mpd delta report; assigned in the guarded block below, which exits on refusal. */
  let fixes: AgentTeamsFixReport
  try {
    fixes = applyAgentTeamsFixes({ write: true })
  } catch (error) {
    console.error("[vendor-agent-teams] FAIL: mpd delta guard refused the healed tree — " + String(error instanceof Error ? error.message : error))
    process.exit(1)
  }
  console.log("[vendor-agent-teams] mpd deltas " + fixes.status + " (" + fixes.regions + " region(s) across " + fixes.files.length + " adopted file(s)"
    + (fixes.inserted.length > 0 ? ", inserted: " + fixes.inserted.join(", ") : "") + ")")
  // The client bundle is excluded from the import rewrite above (it is loaded by the web
  // app's own bundler), but mpd-owned client code composes its views/store/locales/CSS
  // through the pinned additive export bridge. Re-apply it so a refresh of the adopted
  // bundle can never silently ship an unbridged client.
  /** The client export-bridge report for this pass. */
  const bridge: ClientBridgeReport = applyExportBridge({ write: true })
  console.log("[vendor-agent-teams] client export bridge " + (bridge.status === "applied" ? "applied" : "already applied")
    + " (" + bridge.symbols + " symbols, " + bridge.bytes + " bytes)")
  // report any residual bare imports (should be only the client bundle + type-only)
  /** Formatted `file :: specifier` lines for bare `@deepseek-ai`/`zod`/`@standard-schema` imports that survived. */
  const residual: string[] = walk(join(VENDOR, "lib")).concat(walk(DEPS)).filter((f: string): boolean => !f.includes("client.js"))
    .map((f: string): SpecifierHits => ({ f, m: readFileSync(f, "utf8").match(/(?:from|require\()\s*["']([^"'][^"']*?)["']/g) || [] }))
    .flatMap(({ f, m }: SpecifierHits): string[] => m.map((x: string): string => f.replace(repoRoot, "<repo>") + " :: " + x))
    .filter((x: string): boolean => /(?:from|require\()\s*["']@|(?:from|require\()\s*["']zod|(?:from|require\()\s*["']@standard/.test(x))
  console.log("[vendor-agent-teams] residual bare imports (excluding client): " + residual.length)
  residual.forEach((x: string): void => console.log("  " + x))
}

main()
