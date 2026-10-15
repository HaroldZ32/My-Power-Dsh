// Stages the DECLARED optional dependency an MCP row's launcher resolves, into the tree under test.
//
// WHY IT EXISTS (measured, wave tui-015). The LSP MCP row launches
// `packages/mpd-mcp-lsp/dist/launch.js`, and that launcher resolves its `cclsp` dependency from the
// `node_modules` chain above its OWN file (`packages/mpd-mcp-shared/dependency-entry.ts`). A case that
// boots a tree which was never `bun install`ed therefore gets that launcher's `serveUnavailable`
// degrade: the row stays ALIVE and exposes ZERO tools (`unavailable-server.ts` lists no tools). The
// oneclick Docker lane skips steps 07/08 by design, so its `/opt/mpd` checkout carries no
// `node_modules` — measured inside that container: the source lane recorded 12 `mcp__lsp__*` names and
// 104/105 tools, the oneclick lane recorded 0 of them and 95 tools, and the two cases that assert an
// `mcp__lsp__*` name (or the canonical eight-name deny list, two of whose members are LSP renames)
// reddened for a reason that is the TREE's, not the row's.
//
// WHAT IT DOES. Reads the version the PUBLISHED manifest declares (`package.json`'s
// `optionalDependencies[name]`) and materializes that dependency into `<targetTree>/node_modules`, so
// the launcher finds it on the first tier of its own walk. Three tiers, offline first:
//   1. ALREADY PRESENT AT THE DECLARED VERSION — nothing to do; a copy recording ANOTHER version is
//      refused and falls through, so a stale tree is never reported as the manifest's declaration;
//   2. an ISOLATED checkout store (bun's `node_modules/.bun/<pkg>@<version>[+hash]/node_modules`,
//      pnpm's `node_modules/.pnpm/<pkg>@<version>/node_modules`) carries the package AND its whole
//      closure in ONE directory, so that directory is copied — bounded and hermetic (measured:
//      2.2 MB / 7 entries for `cclsp@0.7.0`);
//   3. otherwise `npm install <name>@<version>` into the target tree, which is the same closure a real
//      install materializes. This is the route the oneclick lane takes, because its checkout carries
//      no store to copy from.
// The plain HOISTED layout (`<checkout>/node_modules/<name>` with the dependencies flattened beside it
// in the same root) is deliberately NOT copied: copying a checkout's whole `node_modules` root would be
// neither bounded nor hermetic, so that shape falls through to tier 3.
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, readFileSync, realpathSync, statSync } from "node:fs"
import { basename, dirname, join } from "node:path"

/** The tier that produced a staged dependency, so the evidence says WHERE the bytes came from. */
export type DependencyStageSource = "already-present" | "checkout-store" | "npm-install" | "failed"

/** What one staging attempt measured: whether the dependency is now resolvable, and how it got there. */
export interface DependencyStage {
  /** True when `<targetTree>/node_modules/<name>/package.json` exists after the call. */
  readonly ok: boolean
  /** The tier that answered. */
  readonly source: DependencyStageSource
  /** The paths and exit status behind the verdict, quoted in the case's evidence. */
  readonly detail: string
}

/** The inputs of one staging attempt. */
export interface DependencyStageOptions {
  /** The repository root whose manifest declares the dependency (its `optionalDependencies`). */
  readonly repoRoot: string
  /** The tree that must end up carrying `<name>` in its own `node_modules` — the tree under test. */
  readonly targetTree: string
  /** The npm package name, exactly as the manifest declares it. */
  readonly name: string
  /** The version to install when no checkout store is available to copy. */
  readonly version: string
  /** The child environment for the npm fallback; defaults to the live process environment. */
  readonly env?: NodeJS.ProcessEnv
  /** The npm fallback's budget in milliseconds. */
  readonly timeoutMs?: number
}

/** The default budget for the npm fallback, which downloads the package and its closure. */
const NPM_INSTALL_TIMEOUT_MS: number = 600000

/**
 * Read the version the repository's PUBLISHED manifest declares for an optional dependency.
 *
 * The declaration is the subject, not a convenience: the cases stage exactly what the manifest
 * promises a user's install materializes, so a manifest edit that drops or renames the entry must
 * redden the caller instead of silently staging nothing.
 *
 * @param repoRoot The repository root whose `package.json` is read.
 * @param name The npm package name to look up under `optionalDependencies`.
 * @returns The declared version string, or `null` when the manifest does not declare it.
 */
export function declaredOptionalVersion(repoRoot: string, name: string): string | null {
  try {
    /** The parsed root manifest, or `null` when it cannot be read or parsed. */
    const manifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { optionalDependencies?: Record<string, unknown> }
    /** The declared value, accepted only when it is a non-empty string. */
    const declared = manifest.optionalDependencies?.[name]
    return typeof declared === "string" && declared !== "" ? declared : null
  } catch {
    return null
  }
}

/**
 * Locate an ISOLATED checkout store directory that carries the package and its whole closure.
 *
 * @param repoRoot The repository root whose `node_modules` is probed.
 * @param name The npm package name.
 * @returns The store's `node_modules` directory (the copy source), or `null` for every other layout.
 */
export function isolatedStoreDir(repoRoot: string, name: string): string | null {
  /** The checkout's own entry for the package; bun and pnpm both make this a symlink into the store. */
  const linked = join(repoRoot, "node_modules", name)
  if (!existsSync(linked)) return null
  try {
    /** The store path the symlink resolves to; a real directory resolves to itself. */
    const real = realpathSync(linked)
    /** The directory holding the package's dependencies in the isolated layout. */
    const store = dirname(real)
    // The isolated layouts put a `<pkg>@<version>` directory between two `node_modules` levels; the
    // HOISTED layout resolves straight into the checkout's own `node_modules` root, which must never be
    // copied wholesale.
    if (basename(store) !== "node_modules" || store === join(repoRoot, "node_modules")) return null
    // A store directory is only usable when the package itself is inside it, which keeps a stray
    // same-named directory from being copied as if it were the dependency.
    return statSync(real).isDirectory() && existsSync(join(store, name, "package.json")) ? store : null
  } catch {
    return null
  }
}

/**
 * Read the `version` an installed copy records in its own `package.json`.
 *
 * The recorded version is the only evidence of WHICH bytes a tree already carries, so it is what the
 * staging tiers compare against the manifest declaration.
 *
 * @param manifestPath Absolute path of the installed package's `package.json`.
 * @returns The recorded version string, or `null` when the file is unreadable or carries none.
 */
export function installedPackageVersion(manifestPath: string): string | null {
  try {
    /** The installed package's own manifest, which names the version its bytes came from. */
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { version?: unknown }
    return typeof manifest.version === "string" && manifest.version !== "" ? manifest.version : null
  } catch {
    return null
  }
}

/**
 * The rule the staging tiers apply to a copy already on disk: its recorded version must BE the
 * manifest's declaration.
 *
 * Split out so the decision is falsifiable offline, without an npm tier ever running.
 *
 * @param manifestPath Absolute path of the installed copy's `package.json`.
 * @param declaredVersion The version the repository manifest declares.
 * @returns True only when the copy records exactly the declared version.
 */
export function copyMatchesDeclaration(manifestPath: string, declaredVersion: string): boolean {
  return installedPackageVersion(manifestPath) === declaredVersion
}

/**
 * Materialize a manifest-declared optional dependency into a target tree's own `node_modules`.
 *
 * Never throws: every failure is reported as `{ ok: false, source: "failed" }` with the diagnosis in
 * `detail`, so a caller decides whether that is a case failure or a skip. A copy that is already
 * present or is copied from the checkout store is accepted only when its own `package.json` records
 * EXACTLY `options.version`; on any mismatch the next tier runs, and the npm tier installs
 * `name@version` from the registry, so the staged tree always carries the manifest's declaration.
 *
 * @param options The repository root, the tree under test, the package name and its declared version.
 * @returns The staging verdict with the tier that answered.
 */
export function stageDeclaredMcpDependency(options: DependencyStageOptions): DependencyStage {
  /** The manifest path a successful staging must have produced. */
  const installed = join(options.targetTree, "node_modules", options.name, "package.json")
  // THE VERSION IS CHECKED, NOT THE EXISTENCE (measured finding, wave fix/coderabbit-pr42): a warm tree
  // carries earlier runs' copies, and accepting one blind attributes this run's tool surface to a
  // version the manifest no longer declares.
  if (existsSync(installed) && copyMatchesDeclaration(installed, options.version)) return { ok: true, source: "already-present", detail: installed + " (version " + options.version + ")" }
  /** The isolated store to copy from, or `null` when this checkout has no such layout. */
  const store = isolatedStoreDir(options.repoRoot, options.name)
  if (store !== null) {
    try {
      cpSync(store, join(options.targetTree, "node_modules"), { recursive: true, dereference: true })
      if (existsSync(installed) && copyMatchesDeclaration(installed, options.version)) return { ok: true, source: "checkout-store", detail: store + " -> " + join(options.targetTree, "node_modules") + " (version " + options.version + ")" }
    } catch {
      // A partially copied store falls through to the npm tier, which is the authoritative closure.
    }
  }
  // The npm tier: the same closure a real install materializes, from the registry. The cache is pinned
  // INSIDE the target tree because the invoking home's `~/.npm` is not writable from every lane (a
  // read-only `$HOME` fails the fetch with `EROFS … open '<home>/.npm/_cacache/tmp/…'`, measured).
  const result = spawnSync("npm", ["install", "--prefix", options.targetTree, "--no-save", "--no-audit", "--no-fund", "--ignore-scripts", "--cache", join(options.targetTree, ".npm-cache"), options.name + "@" + options.version], {
    env: options.env ?? process.env,
    encoding: "utf8",
    timeout: options.timeoutMs ?? NPM_INSTALL_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
  })
  if (result.status === 0 && existsSync(installed)) {
    return { ok: true, source: "npm-install", detail: "npm install " + options.name + "@" + options.version + " --prefix " + options.targetTree }
  }
  /** The npm output tail, which names the real cause (registry, version, permissions). */
  const tail = ((result.stderr ?? "") + (result.stdout ?? "")).trim().split("\n").slice(-3).join(" | ").slice(0, 600)
  return {
    ok: false,
    source: "failed",
    detail: "exit=" + String(result.status) + (store === null ? " (no isolated checkout store to copy)" : " (checkout store copy did not produce the manifest)") + " tail=" + tail,
  }
}
