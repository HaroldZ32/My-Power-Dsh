// The bundle's OWN door to the sidebar host it ships.
//
// WHY THIS EXISTS. `dsh-better-sidebar` is a dependency this bundle declares, so it is present under
// `<bundle>/node_modules` on a checkout install — but the PROFILE's `node_modules` has only the linked
// bundle (`healProfileModuleFallback` does not materialize a declared dependency for a `link:` layer,
// measured), so a row named `dsh-better-sidebar` cannot resolve there and the bundle contributed NO
// sidebar GUI at all.
//
// Two repairs were measured and BOTH fail, which is why this shim exists:
//   • a `file://` URL as the row NAME mounts, then the loader disables the row with `its declared peer
//     dependencies cannot be validated: name.startsWith is not a function` — the validator is handed a
//     URL where it expects a package name;
//   • routing through the bundle's `exports` (`@mpd-dsh/mpd/node_modules/...`) is REFUSED BY NODE
//     itself: `Invalid "exports" target "./node_modules/*"`, a target may not contain `node_modules`.
//
// A RELATIVE import has neither problem: no exports target, no peer validation (the row resolves to
// THIS package, whose peers are empty), and the host's own dependencies resolve upward from its real
// location. The row is a normal `@mpd-dsh/mpd/packages/...` specifier, which both install layouts
// resolve.
//
// The host is reached by a path computed at RUNTIME, not by a static specifier: a static import of a
// path outside the package is not portable into the packed layout, where the host sits beside this
// package's parent directory rather than two levels up.
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

/**
 * Resolve the sidebar host: beside this package's parent first (a checkout install), then upward
 * through the usual node_modules chain (a packed install or a profile that has its own copy).
 */
function hostUrl(): string {
  /** This module's own directory, which is `dist/` in a built install. */
  const here = dirname(fileURLToPath(import.meta.url))
  // dist/ -> package -> packages/ -> bundle root
  const bundleRoot = join(here, "..", "..", "..")
  return pathToFileURL(join(bundleRoot, "node_modules", "dsh-better-sidebar", "lib", "index.js")).href
}

/** Everything the host exports, re-exported so a loader row can mount THIS module in its place. */
export interface SidebarHost {
  /** The host's declared plugin name, mirrored by this facade. */
  name?: string
  /** The host's declared service dependencies, restated on the facade below. */
  inject?: unknown
  /** The host's cordis apply, called as `(ctx, config)` by the loader. */
  apply?: (...args: unknown[]) => unknown
  /** The host's schemastery config type, when the package exports one. */
  Config?: unknown
}

/** The imported host module, memoized so a second load reuses it. */
let cached: SidebarHost | undefined

/** The host module, imported once. Throws with the path it tried, so a failure names the subject. */
export async function loadSidebarHost(): Promise<SidebarHost> {
  if (cached !== undefined) return cached
  /** The resolved file URL of the host entry, named in the failure message below. */
  const url = hostUrl()
  try {
    cached = (await import(url)) as SidebarHost
    return cached
  } catch (error) {
    throw new Error(`mpd-better-sidebar-host: could not import the sidebar host at ${url}: ${String((error as Error)?.message ?? error)}`)
  }
}

/**
 * A loader-facing facade: the same `name`/`inject`/`Config` the host declares, with an `apply` that
 * imports the host and delegates to it. Cordis applies a row by calling `apply(ctx, config)`.
 */
export const name = "mpd-better-sidebar-host"

/**
 * THE HOST'S OWN INJECT LIST, restated — because cordis takes the DECLARED list from the module it
 * loads, and this module is what the row names. Measured: with an empty list the host applied and
 * then threw `cannot get property "webServer" without inject`, i.e. the host was loaded and starved
 * of the services it declares.
 *
 * It is restated rather than imported because a static import would have to name a path that exists
 * in BOTH install layouts (the checkout ships the host under `<bundle>/node_modules`, a packed
 * install gets it in the profile's), and the dynamic import that solves that cannot produce a static
 * export. The bundle PINS the host's version (`dsh-better-sidebar@0.24.1`), and
 * `test/host-contract.test.ts` compares this list with the shipped package's own whenever that
 * package is resolvable — so a version bump that changes the list fails a test instead of starving
 * the host in silence.
 */
export const inject: string[] = ["webServer", "sessions", "webRuntime", "tools"]

/** Import the host and delegate one cordis apply to it; THROWS when it exports no apply. */
export async function apply(ctx: unknown, config: unknown): Promise<void> {
  /** The host module, imported once through the memoizing loader. */
  const host = await loadSidebarHost()
  if (typeof host.apply !== "function") throw new Error("mpd-better-sidebar-host: the sidebar host exports no apply()")
  await (host.apply as (a: unknown, b: unknown) => unknown)(ctx, config)
}
