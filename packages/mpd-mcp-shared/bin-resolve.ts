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
import { existsSync, readFileSync, realpathSync } from "node:fs"
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
  /**
   * Codegraph acceptance probe: whether the shim at this path can reach the per-platform bundle it
   * execs. Defaults to {@link hasCodegraphPlatformBundle}; null/absent means the default.
   */
  platformBundle?: ((shimPath: string) => boolean) | null
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

/**
 * `<bundle>` for a launcher inside it.
 *
 * WALKING, NOT COUNTING HOPS, and that is a measured correction rather than a preference. The
 * launcher used to live at `<bundle>/packages/<pkg>/launch.ts`, where `dirname` plus two hops IS the
 * bundle root; it now ships as the BUILT `<bundle>/packages/<pkg>/dist/launch.js`, where the same two
 * hops land on `<bundle>/packages` — a wrong root silently disables the `.toolchain` tier and the rest
 * of the bundle-relative chain. The walk returns the first ancestor whose `package.json` names this
 * bundle, and the old two-hop answer stays as the fallback for a launcher outside such a tree.
 *
 * @param launcherUrl - The running launcher's own `import.meta.url`.
 * @returns The bundle root directory, absolute.
 */
export function bundleRootFrom(launcherUrl: string): string {
  /** The launcher's own directory — where the walk starts. */
  let dir = dirname(fileURLToPath(launcherUrl))
  for (let hop = 0; hop < 6; hop++) {
    try {
      /** The candidate ancestor's manifest, parsed only for its package name. */
      const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: unknown }
      if (manifest.name === "@mpd-dsh/mpd") return dir
    } catch {
      // No manifest here, or an unreadable one: keep climbing.
    }
    /** The next ancestor up; equal to `dir` at the filesystem root, which ends the walk. */
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return resolve(dirname(fileURLToPath(launcherUrl)), "..", "..")
}

/**
 * A path's real location, or the path itself when it cannot be resolved (a missing path is a normal
 * answer for this resolver, never an error): the anchor `hasCodegraphPlatformBundle` searches from.
 *
 * @param path - The candidate path, normally a `node_modules/.bin` symlink.
 * @returns The link target's real path, or the input unchanged when `realpath` fails.
 */
function realpathIfPossible(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
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

/** The injection points of the per-platform bundle question; every one is optional. */
export interface PlatformBundleOptions {
  /** Platform whose per-platform package name is asked for (defaults to `process.platform`). */
  platform?: string
  /** Architecture whose per-platform package name is asked for (defaults to `process.arch`). */
  arch?: string
  /** Resolver replacement: returns the resolved file, or null when the package is not installed. */
  resolve?: (spec: string) => string | null
  /**
   * Real-path resolver the DEFAULT resolver anchors at, so the question is asked from the shim's own
   * on-disk location rather than from a `.bin` symlink's directory. Defaults to `fs.realpathSync`;
   * irrelevant when `resolve` is injected.
   */
  anchor?: (path: string) => string
}

/**
 * The npm package upstream publishes for one platform/architecture pair.
 *
 * The name is derived mechanically because that is how upstream's own shim derives it
 * (`"@colbymchenry/codegraph-" + process.platform + "-" + process.arch`); the per-platform packages
 * declare `os`/`cpu`, so only the matching one installs.
 *
 * @param platform - The platform segment, e.g. `linux`, `darwin` or `win32`.
 * @param arch - The architecture segment, e.g. `x64` or `arm64`.
 * @returns The per-platform package name, e.g. `@colbymchenry/codegraph-linux-x64`.
 */
export function codegraphPlatformPackage(platform: string, arch: string): string {
  return `@colbymchenry/codegraph-${platform}-${arch}`
}

/**
 * Whether the codegraph shim at `shimPath` can reach the per-platform bundle it execs.
 *
 * WHY THE CODEGRAPH TIERS ARE PROBED AT ALL (defect D-3, measured 2026-10-28). Upstream publishes the
 * executable as a THIN SHIM (`npm-shim.js`, the package's `bin`) plus a per-platform OPTIONAL
 * dependency, `@colbymchenry/codegraph-<platform>-<arch>`, which carries a bundled Node runtime and
 * the app. npm counts an UNFETCHABLE optional dependency as SUCCESS, so a registry mirror that did
 * not mirror that package leaves a complete-looking install whose `codegraph` shim cannot start —
 * the shim says so itself: "codegraph: no prebuilt bundle for linux-x64 … A registry mirror (e.g.
 * npmmirror/cnpm) that did not mirror the per-platform package is the usual cause."
 *
 * A missing ENGINE would be survivable, but a WRONG PIN is not, because the adopted resolver honours
 * `MPD_CODEGRAPH_BIN` unconditionally: its `resolveCodegraphCommand` returns `source: "env"` for any
 * NON-EMPTY value and its only later guard refuses a pin whose path does NOT exist. A pin to an
 * existing-but-unusable shim therefore bypasses the adopted chain (bundled → provisioned → PATH →
 * download) and the MCP row serves ZERO tools, silently.
 *
 * MEASURED in both directions, twice over. The three one-click stamps whose npm toolchain install
 * reported `added 4 packages` (one fewer than the five this toolchain has) each lost
 * `mcp__codegraph__codegraph_explore` (`MCP_TOOLS=2/3`), while every `added 5` stamp in the same lane
 * kept it (`3/3`). Locally, same launcher, two pins: the shim installed WITHOUT its per-platform
 * package answers no MCP frame at all (`tools/list` never arrives, 0 tools) and prints the message
 * quoted above, while the shim installed WITH it answers `tools/list` with `codegraph_explore`.
 *
 * The question asked here is EXACTLY the shim's own, in BOTH of the places upstream asks it, and from
 * the shim's own REAL location:
 *
 * - POSIX: `require.resolve("<pkg>/bin/codegraph")` — the launcher script the shim execs.
 * - win32: `require.resolve("<pkg>/node.exe")` **and** `require.resolve("<pkg>/lib/dist/bin/codegraph.js")`
 *   — upstream resolves BOTH before it starts the bundled process, so a package carrying only the
 *   runtime (or only the app) cannot start. Probing just `node.exe` would accept a half-installed
 *   Windows bundle and pin a shim that dies, which is the very failure this predicate exists to
 *   prevent. The app entry was measured present in the 1.5.0 per-platform layout
 *   (`lib/dist/bin/codegraph.js`, 114680 B on this host).
 * - The location is the shim's `realpath`, not the path it was named by. npm's hoisted layout puts
 *   `.bin/codegraph` beside the package, but the `nested`/`linked` layouts leave the platform package
 *   under the link TARGET's own `node_modules`; and Node itself resolves a required module by its real
 *   path, so anchoring at the symlink's directory would ask a question the shim never asks — and could
 *   reject a usable shim, which is worse than the miss it is here to catch.
 *
 * Nothing is spawned and nothing is downloaded, which is what makes it safe on every launcher start.
 *
 * @param shimPath - Absolute path of the candidate executable the resolver accepted by existence.
 * @param opts - Optional platform/arch/resolver/anchor overrides; each defaults to this host's answer.
 * @returns `true` only when every file upstream's shim needs resolves from the shim's real location.
 */
export function hasCodegraphPlatformBundle(shimPath: string, opts: PlatformBundleOptions = {}): boolean {
  /** The platform segment the package name is built from. */
  const platform = opts.platform ?? process.platform
  /** The architecture segment the package name is built from. */
  const arch = opts.arch ?? process.arch
  /** Real-path resolver for the anchor: a `.bin` symlink must not decide where the search starts. */
  const anchor = opts.anchor ?? realpathIfPossible
  /** Resolution anchored at the shim's REAL location, so the answer is the shim's own view. */
  const resolveFromShim = opts.resolve ?? ((spec: string): string | null => {
    try {
      // `createRequire` needs an absolute path or a file URL; a relative candidate is anchored at the
      // process cwd, which is the only meaning a relative executable path could have had anyway.
      return createRequire(resolve(anchor(shimPath))).resolve(spec)
    } catch {
      return null
    }
  })
  /** The platform package whose files upstream's shim resolves before it can start. */
  const platformPackage = codegraphPlatformPackage(platform, arch)
  /** Every file upstream's shim needs on THIS platform; win32 needs its runtime AND its app entry. */
  const requiredSpecs = platform === "win32"
    ? [`${platformPackage}/node.exe`, `${platformPackage}/lib/dist/bin/codegraph.js`]
    : [`${platformPackage}/bin/codegraph`]
  return requiredSpecs.every((spec: string): boolean => resolveFromShim(spec) !== null)
}

/**
 * Resolve the codegraph binary for an MCP launcher.
 * The require tier reads the package's own `bin` entry (1.5.0 ships
 * `bin: { codegraph: "npm-shim.js" }`), falling back to the adopted code's known
 * shim names.
 *
 * A candidate is accepted only when it EXISTS **and** its per-platform bundle resolves
 * ({@link hasCodegraphPlatformBundle}); an unusable candidate is SKIPPED so the next tier answers,
 * because pinning it would take the row's whole tool surface down (D-3, measured 2026-10-28).
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
    /** Acceptance probe: the per-platform bundle must resolve from the candidate's own location. */
    const usable = opts.platformBundle ?? ((shim: string): boolean => hasCodegraphPlatformBundle(shim, platform === process.platform ? {} : { platform }))
    return firstAccepted(candidates.filter((c) => (seen.has(c.path) ? false : (seen.add(c.path), true))), exists, usable)
  } catch {
    return null
  }
}
