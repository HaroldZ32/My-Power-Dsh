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

/** One env bag: the launcher's live `process.env`, or a fixture standing in for it. */
export type ResolverEnv = Record<string, string | undefined>

/** The precedence tier that accepted a candidate (the documented order, as a closed set). */
export type BinSource = "bin-dir" | "require" | "toolchain" | "bundle-bin"

/** One accepted executable and the tier that produced it. */
export interface ResolvedBinary {
  /** Absolute (or launcher-relative) path of the executable to hand to the adopted server. */
  binary: string
  /** The tier of the documented precedence that accepted this path. */
  source: BinSource
}

/** The injection points of both resolvers; every one is optional so a caller can pin a tier. */
export interface ResolverOptions {
  /** Env to read (defaults to the launcher's own `process.env`). */
  env?: ResolverEnv
  /** Platform whose executable spellings are offered (defaults to `process.platform`). */
  platform?: string
  /** Existence probe (defaults to `fs.existsSync`). */
  exists?: (path: string) => boolean
  /** ast-grep acceptance probe (defaults to the `--version` probe); null/absent means the default. */
  probe?: ((binary: string) => boolean) | null
  /** Bundle root to search for the linker tiers (defaults to the launcher's `<bundle>`). */
  bundleRoot?: string
  /** `createRequire` replacement; returns the resolved package.json path, or null when absent. */
  requireResolve?: (spec: string) => string | null
}

/** One candidate before it is probed: a path plus the tier that proposed it. */
interface Candidate {
  /** The candidate executable path. */
  path: string
  /** The tier that proposed this path. */
  source: BinSource
}

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
export function executableSuffixes(env: ResolverEnv = process.env, platform: string = process.platform): string[] {
  if (platform !== "win32") return [""]
  /** The caller's own `%PATHEXT%` entries, lower-cased and narrowed to what can be spawned. */
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
export function candidateSpellings(name: string, env: ResolverEnv = process.env, platform: string = process.platform): string[] {
  /** The platform's executable suffixes; a bare `[""]` means "name it once". */
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
export function pathSpellings(name: string, env: ResolverEnv = process.env, platform: string = process.platform): string[] {
  if (platform !== "win32") return [name]
  /** The caller's own `%PATHEXT%` entries, lower-cased, in the order the host resolves them. */
  const declared = String(env.PATHEXT ?? "")
    .split(";")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)
  /** The suffixes to try, falling back to the documented win32 defaults. */
  const suffixes = declared.length > 0 ? declared : [".exe", ".com", ".cmd", ".bat"]
  return [...suffixes.map((suffix) => name + suffix), name]
}

/** ast-grep candidate names, preferred order (never `sg` before `ast-grep`). */
export const AST_GREP_NAMES: ReadonlyArray<string> = ["ast-grep", "sg"]

/** <bundle> for a launcher at <bundle>/packages/<pkg>/launch.mjs. */
export function bundleRootFrom(launcherUrl: string): string {
  return resolve(dirname(fileURLToPath(launcherUrl)), "..", "..")
}

/** A trimmed non-empty string, or null when the value is absent/blank/not a string. */
function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

/**
 * Default ast-grep acceptance probe: `--version` must print "ast-grep".
 * `.toolchain/node_modules/.bin/sg` fails this (deprecated wrapper, exit 1).
 */
export function probeAstGrep(binary: string): boolean {
  try {
    /** The probed binary's `--version` output (a Buffer or string, depending on the host). */
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
function packageJsonFor(launcherUrl: string, spec: string, opts: ResolverOptions): string | null {
  try {
    if (typeof opts.requireResolve === "function") return opts.requireResolve(spec)
    return createRequire(launcherUrl).resolve(spec)
  } catch {
    return null
  }
}

/** The package's declared shim as an absolute path: the `bin` string, or the first value of a bin map. */
function normalizeBinEntry(bin: unknown, pkgDir: string): string | null {
  /** The declared shim path as package.json spells it, before it is made absolute. */
  const rel: unknown = typeof bin === "string" ? bin : (bin && typeof bin === "object" ? Object.values(bin as Record<string, unknown>)[0] : null)
  if (typeof rel !== "string" || rel.length === 0) return null
  return isAbsolute(rel) ? rel : join(pkgDir, rel.replace(/^\.\//, ""))
}

/** The first candidate that exists (and passes the optional probe), or null when none does. */
function firstAccepted(candidates: ReadonlyArray<Candidate>, exists: (path: string) => boolean, probe: ((path: string) => boolean) | null): ResolvedBinary | null {
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
export function resolveAstGrepBinary(launcherUrl: string, opts: ResolverOptions = {}): ResolvedBinary | null {
  try {
    /** Env to read: the caller's, or this process's. */
    const env = opts.env ?? process.env
    /** Platform whose executable spellings are offered. */
    const platform = opts.platform ?? process.platform
    /** Existence predicate for a candidate path. */
    const exists = opts.exists ?? existsSync
    /** Acceptance predicate, which is what rejects the deprecated `sg` wrapper. */
    const probe = opts.probe ?? probeAstGrep
    /** The `<bundle>` root the two linker tiers are searched under. */
    const bundleRoot = opts.bundleRoot ?? bundleRootFrom(launcherUrl)
    /** Every candidate in precedence order, as the tiers below append to it. */
    const candidates: Candidate[] = []
    /** This platform's spellings of a candidate name, in probe order. */
    const spellings = (name: string): string[] => candidateSpellings(name, env, platform)

    /** The upstream env contract's own binary directory, when the caller set one. */
    const binDir = nonEmpty(env.MPD_AST_GREP_BIN_DIR)
    if (binDir) {
      for (const n of AST_GREP_NAMES) for (const s of spellings(n)) candidates.push({ path: join(binDir, s), source: "bin-dir" })
    }

    /** The installed package's package.json, as the launcher's own linker resolves it. */
    const pkgJson = packageJsonFor(launcherUrl, "@ast-grep/cli/package.json", opts)
    if (pkgJson) {
      /** The installed package's directory, where its own `ast-grep` binary sits. */
      const pkgDir = dirname(pkgJson)
      for (const n of AST_GREP_NAMES) for (const s of spellings(n)) candidates.push({ path: join(pkgDir, s), source: "require" })
    }

    // The linker's own `.bin`, in the two layouts this bundle meets: the installer's private
    // `<bundle>/.toolchain` prefix, then the bundle ROOT itself (a `bun install` / `npm install`
    // run inside a checkout). On win32 the second one is the tier that answers: bun writes
    // `.bin/ast-grep.exe` there and leaves the package's own `ast-grep` an unrunnable shim.
    /** The two `.bin` directories, each with the tier name it reports. */
    const binDirs: ReadonlyArray<readonly [string, BinSource]> = [
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
export function resolveCodegraphBinary(launcherUrl: string, opts: ResolverOptions = {}): ResolvedBinary | null {
  try {
    /** Env to read: the caller's, or this process's. */
    const env = opts.env ?? process.env
    /** Platform whose PATH-style spellings are offered (a `.cmd` shim is runnable here). */
    const platform = opts.platform ?? process.platform
    /** Existence predicate for a candidate path. */
    const exists = opts.exists ?? existsSync
    /** The `<bundle>` root the two linker tiers are searched under. */
    const bundleRoot = opts.bundleRoot ?? bundleRootFrom(launcherUrl)
    /** Every candidate in precedence order, as the tiers below append to it. */
    const candidates: Candidate[] = []
    /** This platform's spellings of a candidate name, in probe order. */
    const spellings = (name: string): string[] => pathSpellings(name, env, platform)

    /** The installed package's package.json, as the launcher's own linker resolves it. */
    const pkgJson = packageJsonFor(launcherUrl, "@colbymchenry/codegraph/package.json", opts)
    if (pkgJson) {
      /** The installed package's directory, where its own shim sits. */
      const pkgDir = dirname(pkgJson)
      /** The package's own declared shim, or null when its `bin` is absent or unusable. */
      let binPath: string | null = null
      try {
        binPath = normalizeBinEntry((JSON.parse(readFileSync(pkgJson, "utf8")) as { bin?: unknown }).bin, pkgDir)
      } catch { binPath = null }
      for (const p of [binPath, join(pkgDir, "bin", "codegraph.js"), join(pkgDir, "npm-shim.js")]) {
        if (p) candidates.push({ path: p, source: "require" })
      }
    }

    for (const s of spellings("codegraph")) {
      candidates.push({ path: join(bundleRoot, ".toolchain", "node_modules", ".bin", s), source: "toolchain" })
      candidates.push({ path: join(bundleRoot, "node_modules", ".bin", s), source: "bundle-bin" })
    }

    /** Paths already offered, so a candidate reachable through two tiers is probed once. */
    const seen = new Set<string>()
    return firstAccepted(candidates.filter((c) => (seen.has(c.path) ? false : (seen.add(c.path), true))), exists, null)
  } catch {
    return null
  }
}
