// Resolves the ENTRY FILE of a DECLARED npm dependency from whichever `node_modules` the installing
// profile materialized it into.
//
// WHY THIS IS SHARED AND NOT INLINE: the three MCP launchers (cclsp, git-mcp-server and
// mcp-server-commands) each have to answer the same two questions — "where did the profile put this
// package?" and "which file is its server entry?" — and a per-launcher copy is how one of them drifts
// from the others. This file is the ONE resolver, and it is dependency-free: node builtins only, so
// `bun build` inlines it into each launcher without pulling anything else in.
//
// THREE RESOLUTION TIERS, because `require.resolve` alone does NOT find these packages (measured on the
// real ones, not assumed):
//   1. `<name>/package.json` through node's resolver — exact and cheapest, and it works whenever the
//      package publishes no `exports` restriction.
//   2. the module entry through node's resolver, then a walk UP to the owning package.json (matched by
//      the `name` field). This is what covers an `exports` map that hides `./package.json`.
//   3. a manual `<dir>/node_modules/<name>/package.json` walk from the caller's own directory. This is
//      the ONLY tier that finds `mcp-server-commands` (its published manifest has no `main` and its
//      entry is the `bin`, so `require.resolve` finds nothing) and `@cyanheads/git-mcp-server` (its
//      `exports` map offers only `import`/`types` conditions, so a `require.resolve` finds nothing
//      either, and its `"./*": "./dist/*"` pattern sends `<name>/package.json` to a file that does not
//      exist). Both were MEASURED: tiers 1-2 returned null for both packages while the packages sat
//      installed in `node_modules`.
//
// A candidate whose declared entry does not exist on disk is SKIPPED rather than returned, so a stale
// manifest degrades to the next tier instead of to a launcher that dies on import.
import { createRequire } from "node:module"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/** One installed dependency, located and read. */
export interface DependencyEntry {
  /** Absolute path of the package's `package.json`, the anchor every other path is built from. */
  readonly packageJson: string
  /** Absolute path of the entry file this dependency's `main` (or configured `bin`) names. */
  readonly entry: string
  /** The installed version, read from the package.json rather than from the declared range. */
  readonly version: string
}

/** The subset of a `package.json` this resolver reads. */
interface PackageManifest {
  /** The package name; every tier matches it, so a same-named nested file is never accepted. */
  name?: unknown
  /** The installed version, reported for the log line. */
  version?: unknown
  /** The module/CommonJS entry, used when the caller does not ask for a `bin` name. */
  main?: unknown
  /** The executable map (or single string) whose named file is the MCP server entry. */
  bin?: unknown
}

/**
 * Read and parse one `package.json`, or null when it is missing or unparsable.
 *
 * @param path absolute path of the candidate manifest.
 * @returns the parsed manifest, or null.
 */
function readManifest(path: string): PackageManifest | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PackageManifest
  } catch {
    return null
  }
}

/**
 * Read one candidate manifest, accepting it only when it declares the requested package name.
 *
 * @param path absolute path of the candidate manifest.
 * @param packageName the name the manifest must declare.
 * @returns the parsed manifest, or null when the file is missing, unparsable or names another package.
 */
function manifestFor(path: string, packageName: string): PackageManifest | null {
  /** The parsed candidate, or null when it is unreadable. */
  const manifest = readManifest(path)
  return manifest !== null && manifest.name === packageName ? manifest : null
}

/**
 * Walk up from a resolved file to the `package.json` that owns it, matching the requested name.
 *
 * @param from absolute path of a file inside the package (its resolved entry is the usual input).
 * @param packageName the name the owning manifest must declare.
 * @returns the owning manifest's absolute path, or null when no ancestor declares that name.
 */
function ownerManifest(from: string, packageName: string): string | null {
  /** The directory under inspection, starting beside the resolved file. */
  let dir = dirname(resolve(from))
  for (;;) {
    /** The candidate manifest in this directory. */
    const candidate = join(dir, "package.json")
    if (existsSync(candidate) && manifestFor(candidate, packageName) !== null) return candidate
    /** The parent directory, or the same path at the filesystem root (the loop's exit). */
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/**
 * Walk `<dir>/node_modules/<name>/package.json` upwards from a starting directory.
 *
 * This is the tier `require.resolve` cannot replace: a package whose `bin` IS its entry, or whose
 * `exports` map has no condition node's resolver can pick, is invisible to `require.resolve` while
 * being perfectly present on disk.
 *
 * @param startDir the directory to start from (the caller's own package directory).
 * @param packageName the npm package name, scoped names included.
 * @returns the owning manifest's absolute path, or null when no ancestor `node_modules` has it.
 */
function walkNodeModules(startDir: string, packageName: string): string | null {
  /** The directory under inspection. */
  let dir = resolve(startDir)
  for (;;) {
    /** The candidate manifest inside this directory's `node_modules`. */
    const candidate = join(dir, "node_modules", packageName, "package.json")
    if (existsSync(candidate) && manifestFor(candidate, packageName) !== null) return candidate
    /** The parent directory, or the same path at the filesystem root (the loop's exit). */
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/**
 * The directory the node_modules walk starts from, derived from the caller's own module URL.
 *
 * @param from the calling launcher's module URL (`import.meta.url`) or an absolute path.
 * @returns the starting directory; the process cwd when the input cannot be converted.
 */
function startDirOf(from: string): string {
  try {
    return dirname(fileURLToPath(from))
  } catch {
    return process.cwd()
  }
}

/**
 * The entry file a manifest declares: its `bin` for the requested key, else its string `bin`, else its
 * `main`.
 *
 * @param manifest the owning manifest.
 * @param packageDir the directory the manifest's relative fields resolve against.
 * @param binName the `bin` key to prefer; `undefined` skips the map lookup.
 * @returns the absolute entry path, or null when the manifest declares none.
 */
function declaredEntry(manifest: PackageManifest, packageDir: string, binName?: string): string | null {
  if (binName !== undefined && typeof manifest.bin === "object" && manifest.bin !== null) {
    /** The `bin` map, whose every value is a package-relative file path. */
    const binMap = manifest.bin as Record<string, unknown>
    if (typeof binMap[binName] === "string") return resolve(packageDir, binMap[binName])
  }
  if (typeof manifest.bin === "string") return resolve(packageDir, manifest.bin)
  if (typeof manifest.main === "string") return resolve(packageDir, manifest.main)
  return null
}

/**
 * Resolve one declared dependency to the absolute file an MCP row must import.
 *
 * @param from the calling launcher's own module URL (`import.meta.url`), so resolution starts where the
 *   installed package lives instead of at the dsh process's cwd.
 * @param packageName the npm package name, exactly as the bundle's manifest declares it.
 * @param binName the `bin` key to prefer; the caller passes the server's own executable name. A
 *   missing key, a string `bin` or an absent `bin` all fall back to `main`, so an upstream packaging
 *   change (bin dropped, main renamed) degrades to "still launches" rather than "row dies".
 * @returns the located dependency, or null when it is not installed, not readable, or declares no
 *   existing entry file.
 */
export function resolveDependencyEntry(from: string, packageName: string, binName?: string): DependencyEntry | null {
  /** A require bound to the caller, so the parent walk starts inside the installed profile. */
  const req = createRequire(from)
  /** The manifest candidates, in tier order, deduplicated by path. */
  const candidates: string[] = []
  /**
   * Record one candidate path, ignoring nulls and repeats.
   *
   * @param path the candidate manifest path, or null when the tier found nothing.
   */
  const consider = (path: string | null): void => {
    if (path !== null && !candidates.includes(path)) candidates.push(path)
  }
  // Tier 1: the package's own package.json, whenever node's resolver exposes it.
  try {
    /** The directly resolved manifest path. */
    const direct = req.resolve(packageName + "/package.json")
    consider(existsSync(direct) && manifestFor(direct, packageName) !== null ? direct : null)
  } catch {
    // An `exports` map without a `./package.json` target lands here; tier 2 or 3 answers instead.
  }
  // Tier 2: the module entry through node's resolver, then up to its owning manifest.
  try {
    consider(ownerManifest(req.resolve(packageName), packageName))
  } catch {
    // Measured for both `mcp-server-commands` and `@cyanheads/git-mcp-server`: nothing to resolve.
  }
  // Tier 3: the manual node_modules walk from the caller's own directory.
  consider(walkNodeModules(startDirOf(from), packageName))
  for (const manifestPath of candidates) {
    /** The parsed owning manifest. */
    const manifest = manifestFor(manifestPath, packageName)
    if (manifest === null) continue
    /** The entry the manifest declares, or null when it declares none. */
    const entry = declaredEntry(manifest, dirname(manifestPath), binName)
    if (entry === null || !existsSync(entry)) continue
    return {
      packageJson: manifestPath,
      entry,
      version: typeof manifest.version === "string" ? manifest.version : "unknown"
    }
  }
  return null
}
