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
//
// THE SEAM MOVED TWICE (measured in both closure shapes):
//   • 0.2.0-rc.2 provided `webRuntime = { lanAddresses, trustedHosts }`, and `dsh-better-sidebar@0.24.1`
//     fenced `/sidebar/api` with `isTrustedApiRequest(req, ctx.webRuntime.trustedHosts)`;
//   • 0.2.1-rc.2 provides no `webRuntime` at all — `@deepseek-ai/dsh-web-app` now provides only
//     `webApp = { getAdvertisedUrl }`, and the LAST generation of this shim therefore probed for a
//     member no pinned host read any more.
//
// THE 0.28 CONTRACT (measured 2026-10-21 in `dsh-better-sidebar@0.28.0`'s `lib/index.js`):
//   • `inject = ['webServer', 'sessions', 'connection', 'tools']`;
//   • the `/sidebar/api` fence is `ctx.connection.requestRejection(req) === undefined`.
// `connection` is a cordis Service provided by `@deepseek-ai/dsh-client-connection`, i.e. by harness
// 0.2.1-rc.1+ (the host's peer floor and this bundle's pinned 0.2.1-rc.2 both satisfy it). So the shim
// now restates `connection` in its inject list and mounts the host as soon as that service exists; the
// only self-disable left is the honest "this composition provides no connection service" one.
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
// The host-plane seams this row injects, named by their adapter constants: the same single source of
// truth the other rows use, so a harness rename lands in the adapter only.
import { DSH_SEAM_SESSIONS, DSH_SEAM_TOOLS, DSH_SEAM_WEB_SERVER, rowLogLine } from "../../mpd-dsh-adapter-plugin/src/index"

/**
 * The 0.28 host's fourth injected seam: the carrier-neutral connection service whose
 * `requestRejection` is the sidebar's `/sidebar/api` fence.
 *
 * LOCAL ON PURPOSE: `packages/mpd-dsh-adapter-plugin` owns the seam vocabulary and this constant
 * belongs there as soon as a second consumer needs it; this row is the only consumer today, so the name
 * lives beside its inject list instead of widening the adapter in a lane that may not edit it.
 */
export const DSH_SEAM_CONNECTION = "connection"

/**
 * The ONE member of the connection service the pinned sidebar host actually calls.
 *
 * Measured in `dsh-better-sidebar@0.28.0` (`lib/index.js`): the fence is
 * `ctx.connection.requestRejection(req) === undefined`. No other member of that service is read by the
 * fence.
 */
export interface ConnectionFenceLike {
  /** Applies the Host/Origin and live-peer fence; `undefined` means the request is admitted. */
  requestRejection?: (request: unknown) => unknown
}

/** The smallest context surface the seam probe needs: a SOFT service read. */
export interface SoftProbeContext {
  /** Soft-reads one service; undefined when this composition does not provide it. */
  get?(name: string, strict?: boolean): unknown
}

/** Why the probe armed nothing — the reason a disabled row writes down. */
export type SidebarSeamReason =
  /** No `connection` service is provided in this composition. */
  | "absent"

/**
 * What the row's ONE seam probe decided, and the evidence behind it.
 *
 * `detail` always names the probed service and whether it carries the fence member, so an operator
 * reading the boot line can tell "the harness renamed or dropped the service" from "this composition
 * never had one".
 */
export type SidebarSeamDecision =
  | {
    /** The 0.28 connection service is present; the host may mount against it. */
    readonly armed: "connection"
    /** The probed service, as carried for diagnostics only. */
    readonly service: ConnectionFenceLike
    /** The boot line's evidence: presence plus whether the fence member is callable. */
    readonly detail: string
  }
  | {
    /** Nothing was armed; the row contributes no sidebar and must say why. */
    readonly armed: "none"
    /** Which situation applies. */
    readonly reason: SidebarSeamReason
    /** The boot line's evidence: the probed service's absence. */
    readonly detail: string
  }

/**
 * Decide whether this composition can drive the pinned 0.28 host.
 *
 * The probe arms on PRESENCE, not on the member: the host declares `connection` itself, so a real
 * loader hands it a real service, and a shape that lacks `requestRejection` fails loudly inside the
 * host's own apply (reported as `seam NOT mounted`) instead of being silently reinterpreted here. The
 * member is still inspected so the boot line says which case the operator is in.
 * @param ctx - the row's context (or any object with a soft `get`).
 * @returns the decision, carrying the service when armed and the reason when not.
 */
export function probeSidebarSeam(ctx: SoftProbeContext): SidebarSeamDecision {
  /** The 0.28 service's value; undefined when this composition does not provide it. */
  const connection = softProbe(ctx, DSH_SEAM_CONNECTION)
  if (connection === undefined) {
    return {
      armed: "none",
      reason: "absent",
      detail: `${DSH_SEAM_CONNECTION}=absent — the 0.28 sidebar host fences /sidebar/api through ctx.${DSH_SEAM_CONNECTION}.requestRejection, so it cannot mount without that service`,
    }
  }
  /** Whether the service carries the fence member the host calls. */
  const hasFence = typeof (connection as ConnectionFenceLike | null)?.requestRejection === "function"
  return {
    armed: "connection",
    service: connection as ConnectionFenceLike,
    detail: `${DSH_SEAM_CONNECTION}=${hasFence ? "present with requestRejection()" : "present without requestRejection() — the 0.28 host calls it, so its apply will report the failure"}`,
  }
}

/**
 * Soft-read one service from a row context.
 *
 * An absent `get`, a probe that throws and a missing registration all answer undefined: the probe is a
 * diagnostic, and it must never be the reason a boot fails.
 * @param ctx - the context to read from.
 * @param name - the service id.
 * @returns the service value, or undefined.
 */
function softProbe(ctx: SoftProbeContext, name: string): unknown {
  try {
    return typeof ctx?.get === "function" ? ctx.get(name, false) : undefined
  } catch {
    return undefined
  }
}

/**
 * Resolve the sidebar host: from the bundle's own `node_modules` (a checkout install), which is the
 * layout the bundle controls; a packed install materializes the same package there.
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

/**
 * The subset of the cordis context this row's apply uses.
 *
 * Kept STRUCTURAL (never the harness `Context` type) so this module stays loadable by the plain loader
 * and drivable from a test double.
 */
export interface SidebarApplyContext {
  /** Soft service read, used by the seam probe. */
  get?(name: string, strict?: boolean): unknown
  /** Defers work until one service is available; used to hand the host a scope that DECLARES it. */
  inject?(ids: readonly string[], callback: (scoped: SidebarApplyContext) => void): unknown
  /** The plane's logger, when it has one; a headless boot may not. */
  logger?: { info?(message: unknown): void; warn?(message: unknown): void }
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
 * THE HOST'S OWN INJECT LIST, restated — the module the loader reads the dependencies from is THIS one.
 *
 * Measured: with an empty list the host applied and then threw `cannot get property "webServer"
 * without inject`, i.e. the host was loaded and starved of the services it declares. The order is the
 * host's own (0.28.0: `webServer`, `sessions`, `connection`, `tools`) and `connection` is built into
 * this array directly because the adapter constant for it does not exist yet (see
 * {@link DSH_SEAM_CONNECTION}).
 *
 * It is restated rather than imported because a static import would have to name a path that exists in
 * BOTH install layouts (the checkout ships the host under `<bundle>/node_modules`, a packed install
 * gets it in the profile's), and the dynamic import that solves that cannot produce a static export.
 * The bundle PINS the host's version (`dsh-better-sidebar@0.28.0`), and `test/host-contract.test.ts`
 * compares this list with the shipped package's own whenever that package is resolvable — so a version
 * bump that changes the list fails a test instead of starving the host in silence.
 */
export const inject: string[] = [DSH_SEAM_WEB_SERVER, DSH_SEAM_SESSIONS, DSH_SEAM_CONNECTION, DSH_SEAM_TOOLS]

/**
 * Emit one row diagnostic: the adapter's workspace log line ALWAYS, the plane's logger when present.
 *
 * A headless boot has no logger sink, and the symptom this row now prevents was SILENT — a pending row
 * with nothing written down — so the line goes to the file sink first.
 * @param ctx - the context whose logger may carry the line.
 * @param level - `info` for an armed seam, `warn` for a self-disable.
 * @param line - the message, prefixed here with the row's name.
 */
function say(ctx: SidebarApplyContext, level: "info" | "warn", line: string): void {
  /** The attributed line, prefixed once so a shared boot log names its producer. */
  const text = "[mpd-better-sidebar] " + line
  try {
    rowLogLine("mpd-better-sidebar", text)
  } catch {
    // A diagnostic sink must never take a boot down.
  }
  try {
    /** The plane's logger, absent on a headless boot. */
    const logger = ctx?.logger
    if (level === "warn") logger?.warn?.(text)
    else logger?.info?.(text)
  } catch {
    // A logger must never take a boot down either.
  }
}

/**
 * One error's message, whatever the throw carried.
 * @param error - the thrown value.
 * @returns its message text.
 */
function messageOf(error: unknown): string {
  return String((error as { message?: unknown })?.message ?? error)
}

/**
 * Run the host's apply inside the armed scope; a failure is REPORTED, never thrown into the loader.
 * @param host - the host module.
 * @param scoped - the injected scope that declares the armed service name.
 * @param config - the row config, forwarded untouched.
 */
async function mountHost(host: SidebarHost, scoped: SidebarApplyContext, config: unknown): Promise<void> {
  try {
    await (host.apply as (a: unknown, b: unknown) => unknown)(scoped, config)
    // REPORTED FROM HERE, because only this point knows the mount actually happened: the `seam
    // armed` decision is written before the injected scope exists, so a line there would promise a
    // sidebar a failing or never-firing callback never delivered.
    say(scoped, "info", "seam MOUNTED: the sidebar host applied inside the injected scope")
  } catch (error) {
    say(scoped, "warn", "seam NOT mounted: the sidebar host apply failed: " + messageOf(error))
  }
}

/**
 * Import the host and delegate one cordis apply to it through the probed seam.
 *
 * The row ALWAYS applies when `connection` is present (its inject list names only services the 0.28
 * host itself declares), and it either mounts the host inside the armed scope or writes down why it
 * disabled itself. It never waits for a service that no build provides, and it never claims a sidebar
 * it did not mount.
 * @param ctx - the row's context.
 * @param config - the row config, forwarded to the host untouched.
 * @throws when the host module exports no `apply` at all (a packaging defect, not a seam decision).
 */
export async function apply(ctx: SidebarApplyContext, config: unknown): Promise<void> {
  /** This boot's ONE seam decision; it drives the mount and the diagnostic line. */
  const decision = probeSidebarSeam(ctx)
  if (decision.armed === "none") {
    // SELF-DISABLE, never wait: the row is applied and contributes nothing, with the reason written
    // down. Cordis cannot un-register a row from inside its own apply, so "disabled" here means
    // exactly what a disabled row would mean for this capability — no sidebar routes, no host plugin.
    say(ctx, "warn", `disabled: ${decision.detail} [reason=${decision.reason}]`)
    return
  }
  // ARMED IS NOT MOUNTED. This line records the PROBE DECISION; the mount happens later, inside the
  // injected scope, and reports its own outcome (`seam MOUNTED` / `seam NOT mounted`). A deployment
  // line must not claim more than has happened by the time it is written.
  say(ctx, "info", `seam ARMED (decision only; the mount is reported separately): ${decision.detail}`)
  /** The host module, imported once through the memoizing loader. */
  let host: SidebarHost
  try {
    host = await loadSidebarHost()
  } catch (error) {
    say(ctx, "warn", "disabled: " + messageOf(error))
    return
  }
  if (typeof host.apply !== "function") throw new Error("mpd-better-sidebar-host: the sidebar host exports no apply()")
  if (typeof ctx.inject !== "function") {
    say(ctx, "warn", "disabled: the row context has no inject channel, so the host cannot be given its scope")
    return
  }
  // THE MOUNT SCOPE IS AN INJECTED ONE. Cordis v4 exposes a service as a context PROPERTY only to a
  // scope that declared it in `inject`, and the 0.28 host reads `ctx.connection.requestRejection` on
  // every request. Handing the host the row's own ctx would therefore surface as a per-request throw;
  // the scoped inject makes the property real.
  try {
    ctx.inject([DSH_SEAM_CONNECTION], (scoped: SidebarApplyContext): void => {
      void mountHost(host, scoped, config)
    })
  } catch (error) {
    say(ctx, "warn", `seam NOT mounted: could not inject ${DSH_SEAM_CONNECTION}: ${messageOf(error)}`)
  }
}
