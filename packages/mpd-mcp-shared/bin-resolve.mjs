// Shared, side-effect-free binary resolver for the mpd MCP launchers (wave-2 B8).
//
// Why this exists: the bundle patch used to PIN the two MCP rows'
// MPD_AST_GREP_SG_PATH / MPD_CODEGRAPH_BIN to a packed-layout-only path, which is
// a WRONG NON-EMPTY value in a `link:` checkout install (and a wrong env pin
// disables the codegraph child's whole fallback machinery). Resolution now lives
// in the MCP package launcher — our code, bundle-relative — so the patch names no
// binary path at all.
//
// Precedence (decision record t1 §3.2, implemented exactly):
//   0. an env pin already set by the caller -> the launcher does nothing (checked by the launcher)
//   1. $MPD_AST_GREP_BIN_DIR/{ast-grep,sg}                                  (ast-grep only, upstream env contract)
//   2. createRequire(<launcher>).resolve(<pkg>/package.json) -> package bin (packed, any node linker)
//   3. <bundle>/.toolchain/node_modules/.bin/{ast-grep,sg} | .../codegraph  (checkout `link:` install)
//   4. <bundle>/node_modules/.bin/{ast-grep,sg} | .../codegraph                 (bundle-root install)
//   5. null -> the launcher leaves the env UNSET and the adopted code runs its own chain untouched
//
// Platform: a candidate NAME above is expanded into the spellings this host can actually
// EXECUTE (win32: <name>.exe/.com ahead of the bare name). Without that expansion a win32
// install resolves nothing: the linker writes `node_modules/.bin/<name>.exe` while the
// package's own `ast-grep` stays the `#!/usr/bin/env node` shim a shell-less spawn cannot
// start. Measured 2026-09-22: the ast_grep MCP answered BINARY_NOT_FOUND on win32 while
// `<bundle>/node_modules/.bin/ast-grep.exe --version` printed `ast-grep 0.45.2`.
//
// Acceptance for a candidate: existsSync plus, for ast-grep, a `--version` probe
// whose output contains "ast-grep". The probe is what rejects `.bin/sg` — the
// deprecated wrapper that exits 1 with a deprecation warning. `ast-grep` is tried
// before `sg` in every tier.
//
// Never throws: a launcher failure would take its MCP row's startup down.
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * The executable suffixes a candidate may carry on this platform.
 *
 * POSIX names a tool once; win32 resolves a bare name through `%PATHEXT%`, so the file on
 * disk is `<name>.exe` / `<name>.com` (bun's `.bin` stub, the package's own native binary)
 * or `<name>.cmd` / `<name>.bat` (the npm `.bin` shim). Only DIRECTLY SPAWNABLE suffixes are
 * offered: the adopted ast-grep runner starts its child with `shell: false` (measured in
 * `packages/mpd-mcp-astgrep/dist/cli.js`), and Node refuses a `.cmd`/`.bat` without a shell
 * (measured: EINVAL), so offering one would name a candidate the runner cannot start.
 * @param {Record<string,string|undefined>} [env] @param {string} [platform]
 * @returns {string[]}
 */
export function executableSuffixes(env = process.env, platform = process.platform) {
  if (platform !== "win32") return [""]
  const declared = String(env.PATHEXT ?? "")
    .split(";")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry === ".exe" || entry === ".com")
  return declared.length > 0 ? declared : [".exe", ".com"]
}

/**
 * Every spelling of `name` this platform can resolve, in probe order: the win32 extensions
 * first (a bare POSIX name is not executable there), then the bare name.
 * @param {string} name @param {Record<string,string|undefined>} [env] @param {string} [platform]
 * @returns {string[]}
 */
export function candidateSpellings(name, env = process.env, platform = process.platform) {
  const suffixes = executableSuffixes(env, platform)
  if (suffixes.length === 1 && suffixes[0] === "") return [name]
  return [...suffixes.map((suffix) => name + suffix), name]
}

/**
 * PATH-style spellings, for a consumer that CAN run a command script:
 * `resolveServeProcessInvocation` in packages/mpd-mcp-codegraph/dist/serve.js wraps a
 * `.cmd`/`.bat` in cmd.exe, so codegraph resolves one. ast-grep's runner starts its child with
 * `shell: false` and must stay on `executableSuffixes` instead.
 * @param {string} name @param {Record<string,string|undefined>} [env] @param {string} [platform]
 * @returns {string[]}
 */
export function pathSpellings(name, env = process.env, platform = process.platform) {
  if (platform !== "win32") return [name]
  const declared = String(env.PATHEXT ?? "")
    .split(";")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)
  const suffixes = declared.length > 0 ? declared : [".exe", ".com", ".cmd", ".bat"]
  return [...suffixes.map((suffix) => name + suffix), name]
}

/** ast-grep candidate names, preferred order (never `sg` before `ast-grep`). */
export const AST_GREP_NAMES = ["ast-grep", "sg"]

/** <bundle> for a launcher at <bundle>/packages/<pkg>/launch.mjs. */
export function bundleRootFrom(launcherUrl) {
  return resolve(dirname(fileURLToPath(launcherUrl)), "..", "..")
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

/**
 * Default ast-grep acceptance probe: `--version` must print "ast-grep".
 * `.toolchain/node_modules/.bin/sg` fails this (deprecated wrapper, exit 1).
 */
export function probeAstGrep(binary) {
  try {
    const out = execFileSync(binary, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 20_000,
    })
    return String(out).toLowerCase().includes("ast-grep")
  } catch {
    return false
  }
}

/** Resolve `spec` (a package.json path) from the launcher's module location. */
function packageJsonFor(launcherUrl, spec, opts) {
  try {
    if (typeof opts.requireResolve === "function") return opts.requireResolve(spec)
    return createRequire(launcherUrl).resolve(spec)
  } catch {
    return null
  }
}

function normalizeBinEntry(bin, pkgDir) {
  const rel = typeof bin === "string" ? bin : (bin && typeof bin === "object" ? Object.values(bin)[0] : null)
  if (typeof rel !== "string" || rel.length === 0) return null
  return isAbsolute(rel) ? rel : join(pkgDir, rel.replace(/^\.\//, ""))
}

function firstAccepted(candidates, exists, probe) {
  for (const c of candidates) {
    if (!c.path || !exists(c.path)) continue
    if (probe && !probe(c.path)) continue
    return { binary: c.path, source: c.source }
  }
  return null
}

/**
 * Resolve the ast-grep binary for an MCP launcher.
 * @returns {{binary:string, source:"bin-dir"|"require"|"toolchain"|"bundle-bin"}|null}
 */
export function resolveAstGrepBinary(launcherUrl, opts = {}) {
  try {
    const env = opts.env ?? process.env
    const platform = opts.platform ?? process.platform
    const exists = opts.exists ?? existsSync
    const probe = opts.probe ?? probeAstGrep
    const bundleRoot = opts.bundleRoot ?? bundleRootFrom(launcherUrl)
    const candidates = []
    const spellings = (name) => candidateSpellings(name, env, platform)

    const binDir = nonEmpty(env.MPD_AST_GREP_BIN_DIR)
    if (binDir) {
      for (const n of AST_GREP_NAMES) for (const s of spellings(n)) candidates.push({ path: join(binDir, s), source: "bin-dir" })
    }

    const pkgJson = packageJsonFor(launcherUrl, "@ast-grep/cli/package.json", opts)
    if (pkgJson) {
      const pkgDir = dirname(pkgJson)
      for (const n of AST_GREP_NAMES) for (const s of spellings(n)) candidates.push({ path: join(pkgDir, s), source: "require" })
    }

    // The linker's own `.bin`, in the two layouts this bundle meets: the installer's private
    // `<bundle>/.toolchain` prefix, then the bundle ROOT itself (a `bun install` / `npm install`
    // run inside a checkout). On win32 the second one is the tier that answers: bun writes
    // `.bin/ast-grep.exe` there and leaves the package's own `ast-grep` an unrunnable shim.
    const binDirs = [
      [join(bundleRoot, ".toolchain", "node_modules", ".bin"), "toolchain"],
      [join(bundleRoot, "node_modules", ".bin"), "bundle-bin"],
    ]
    for (const [bin, source] of binDirs) {
      for (const n of AST_GREP_NAMES) for (const s of spellings(n)) candidates.push({ path: join(bin, s), source })
    }

    return firstAccepted(candidates, exists, probe)
  } catch {
    return null
  }
}

/**
 * Resolve the codegraph binary for an MCP launcher.
 * The require tier reads the package's own `bin` entry (1.5.0 ships
 * `bin: { codegraph: "npm-shim.js" }`), falling back to the adopted code's known
 * shim names.
 * @returns {{binary:string, source:"require"|"toolchain"|"bundle-bin"}|null}
 */
export function resolveCodegraphBinary(launcherUrl, opts = {}) {
  try {
    const env = opts.env ?? process.env
    const platform = opts.platform ?? process.platform
    const exists = opts.exists ?? existsSync
    const bundleRoot = opts.bundleRoot ?? bundleRootFrom(launcherUrl)
    const candidates = []
    const spellings = (name) => pathSpellings(name, env, platform)

    const pkgJson = packageJsonFor(launcherUrl, "@colbymchenry/codegraph/package.json", opts)
    if (pkgJson) {
      const pkgDir = dirname(pkgJson)
      let binPath = null
      try {
        binPath = normalizeBinEntry(JSON.parse(readFileSync(pkgJson, "utf8")).bin, pkgDir)
      } catch { binPath = null }
      for (const p of [binPath, join(pkgDir, "bin", "codegraph.js"), join(pkgDir, "npm-shim.js")]) {
        if (p) candidates.push({ path: p, source: "require" })
      }
    }

    for (const s of spellings("codegraph")) {
      candidates.push({ path: join(bundleRoot, ".toolchain", "node_modules", ".bin", s), source: "toolchain" })
      candidates.push({ path: join(bundleRoot, "node_modules", ".bin", s), source: "bundle-bin" })
    }

    const seen = new Set()
    return firstAccepted(candidates.filter((c) => (seen.has(c.path) ? false : (seen.add(c.path), true))), exists, null)
  } catch {
    return null
  }
}
