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
// THE WEB RUNTIME SEAM WAS RENAMED IN HARNESS 0.2.1-rc.2 (measured 2026-10-17, both closures):
//   • 0.2.0-rc.2 `@deepseek-ai/dsh-web-app` does `ctx.provide("webRuntime", resolveLanTrust(host,
//     trustedHosts))`, i.e. `{ lanAddresses, trustedHosts }`;
//   • 0.2.1-rc.2 the SAME package does `ctx.provide("webApp", { getAdvertisedUrl })` — `webRuntime`
//     appears NOWHERE in that closure (recursive grep → 0 hits), and no service exposes
//     `trustedHosts` as a bind-dependent runtime value any more (the fence moved into
//     `dsh-client-connection`'s own `isTrustedApiRequest(request, trustedHosts, bindHost, protocol)`,
//     fed from its own config; the LAN-literal derivation left `dsh-web-app` entirely).
//
// The pinned host (`dsh-better-sidebar@0.24.1`) needs EXACTLY ONE member of the old service: its
// `/sidebar/api` fence is `isTrustedApiRequest(req, ctx.webRuntime.trustedHosts)`. So this shim now
// runs ONE seam probe at apply time: it prefers the 0.2.1 name, falls back to the 0.2.0 name, mounts
// the host only when the member really exists, and otherwise DISABLES ITSELF with the reason spelled —
// a row that waits for a service no build provides is the defect this probe removes.
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
// The host-plane seams this row injects, named by their adapter constants: the same single source of
// truth the other rows use, so a harness rename lands in the adapter only. `DSH_SEAM_WEB_RUNTIME` is
// the OLD generation's name and is deliberately NOT in the inject list below — the probe reads it.
import { DSH_SEAM_SESSIONS, DSH_SEAM_TOOLS, DSH_SEAM_WEB_RUNTIME, DSH_SEAM_WEB_SERVER, dshSeamInject, rowLogLine } from "../../mpd-dsh-adapter-plugin/src/index"

/**
 * The 0.2.1-rc.2 name of the Web GUI service: `@deepseek-ai/dsh-web-app` provides `webApp` as
 * `{ getAdvertisedUrl }`.
 *
 * LOCAL ON PURPOSE: `packages/mpd-dsh-adapter-plugin` owns the seam vocabulary and this constant
 * belongs there as soon as a second consumer needs it; this row is the only prober today, so the name
 * lives beside the probe instead of widening the adapter in a lane that may not edit it.
 */
export const DSH_SEAM_WEB_APP = "webApp"

/**
 * The ONE member of the Web runtime service the pinned sidebar host actually calls.
 *
 * Measured in `dsh-better-sidebar@0.24.1` (`lib/index.js`): its `/sidebar/api` fence is
 * `isTrustedApiRequest(req, ctx.webRuntime.trustedHosts)`. No other member of that service is read.
 */
export interface WebRuntimeTrustLike {
  /** Non-loopback authorities the host's browser-trust fence accepts, `host` or `host:port`. */
  readonly trustedHosts: readonly string[]
}

/** The smallest context surface the seam probe needs: a SOFT service read. */
export interface SoftProbeContext {
  /** Soft-reads one service; undefined when this composition does not provide it. */
  get?(name: string, strict?: boolean): unknown
}

/** Why the probe armed nothing — the reason a disabled row writes down. */
export type SidebarSeamReason =
  /** `webApp` exists but carries no `trustedHosts` (the measured 0.2.1-rc.2 shape). */
  | "web-app-without-member"
  /** `webApp` carries the member, but the pinned host reads it from `ctx.webRuntime` BY NAME. */
  | "web-app-under-another-name"
  /** Neither service is provided. */
  | "absent"

/**
 * What the row's ONE seam probe decided, and the evidence behind it.
 *
 * `detail` ALWAYS names both candidates, so an operator reading the boot line can tell "the harness
 * renamed the service" from "this composition never had one".
 */
export type SidebarSeamDecision =
  | {
    /** The 0.2.0-generation name is armed; the host will read `ctx.webRuntime.trustedHosts`. */
    readonly armed: "webRuntime"
    /** The probed service, narrowed to the member the host reads. */
    readonly service: WebRuntimeTrustLike
    /** The boot line's evidence, naming both candidates. */
    readonly detail: string
  }
  | {
    /** Nothing was armed; the row contributes no sidebar and must say why. */
    readonly armed: "none"
    /** Which of the three measured situations applies. */
    readonly reason: SidebarSeamReason
    /** The boot line's evidence, naming both candidates. */
    readonly detail: string
  }

/**
 * Decide whether this composition can drive the pinned host, from the two measured service names.
 *
 * The order is the NEWEST generation first: `webApp` is probed before `webRuntime`, and a `webApp`
 * that does not carry `trustedHosts` (every measured 0.2.1 build) cannot be armed. A future `webApp`
 * that DOES carry the member is still not armed, because the pinned host reads `ctx.webRuntime` by
 * name — aliasing one service onto another service's name is a compatibility view this row does not
 * build, so the probe reports that case honestly instead of guessing.
 * @param ctx - the row's context (or any object with a soft `get`).
 * @returns the decision, carrying the service when armed and the reason when not.
 */
export function probeSidebarSeam(ctx: SoftProbeContext): SidebarSeamDecision {
  /** The 0.2.1 name's value; undefined when this composition does not provide it. */
  const webApp = softProbe(ctx, DSH_SEAM_WEB_APP)
  /** The 0.2.0 name's value; undefined when this composition does not provide it. */
  const webRuntime = softProbe(ctx, DSH_SEAM_WEB_RUNTIME)
  /** The trusted-host view of the 0.2.1 service, undefined unless it really carries the member. */
  const appTrust = trustOf(webApp)
  /** The trusted-host view of the 0.2.0 service, undefined unless it really carries the member. */
  const runtimeTrust = trustOf(webRuntime)
  /** The line every decision carries: both candidates, in probe order, and what each offers. */
  const seen = `${DSH_SEAM_WEB_APP}=${describeService(webApp, appTrust)}, ${DSH_SEAM_WEB_RUNTIME}=${describeService(webRuntime, runtimeTrust)}`
  // A `webApp` that carries the member is reported as unusable rather than silently aliased: the host
  // reads the OLD name, and faking that name for a service shaped like it would hide a real rename.
  if (appTrust !== undefined) {
    return { armed: "none", reason: "web-app-under-another-name", detail: `${seen} — the pinned host reads ctx.${DSH_SEAM_WEB_RUNTIME} by name, so arming ${DSH_SEAM_WEB_APP} would need a context view this row does not build` }
  }
  // THE FALLBACK: when the newest name cannot drive the host, the OLD name still can — this is the
  // generation the pinned host was written against, and the probe arms it whenever the member exists.
  if (runtimeTrust !== undefined) {
    return { armed: "webRuntime", service: runtimeTrust, detail: seen }
  }
  // The 0.2.1 shape: the new service exists, the member does not, and no older provider is present.
  if (webApp !== undefined) {
    return { armed: "none", reason: "web-app-without-member", detail: `${seen} — 0.2.1-rc.2's WebApp declares only getAdvertisedUrl() and no bind-dependent trustedHosts` }
  }
  return { armed: "none", reason: "absent", detail: `${seen} — neither the Web GUI service nor the older Web runtime service is provided in this composition` }
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
 * The trusted-host view of one probed service value, or undefined when it does not carry the member.
 * @param value - the probed value, of unknown shape.
 * @returns the value narrowed to `trustedHosts`, or undefined when the member is missing or malformed.
 */
function trustOf(value: unknown): WebRuntimeTrustLike | undefined {
  if (typeof value !== "object" || value === null) return undefined
  /** The member read, unchecked until the array and every entry are known to be strings. */
  const trusted = (value as { trustedHosts?: unknown }).trustedHosts
  if (!Array.isArray(trusted)) return undefined
  if (!trusted.every((entry: unknown): boolean => typeof entry === "string")) return undefined
  // The array and its entries are checked above; the cast names the member this row relies on.
  return value as WebRuntimeTrustLike
}

/**
 * Render one probed candidate for the boot line.
 * @param value - the probed value, undefined when the service is absent.
 * @param trust - its trusted-host view, undefined when the member is missing.
 * @returns `absent`, `present without trustedHosts`, or the member's authority count.
 */
function describeService(value: unknown, trust: WebRuntimeTrustLike | undefined): string {
  if (value === undefined) return "absent"
  if (trust === undefined) return "present without trustedHosts"
  return `present with trustedHosts(${String(trust.trustedHosts.length)})`
}

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
 * THE HOST'S OWN INJECT LIST, restated — MINUS the Web runtime seam, which is PROBED, not injected.
 *
 * Measured: with an empty list the host applied and then threw `cannot get property "webServer"
 * without inject`, i.e. the host was loaded and starved of the services it declares.
 *
 * WHY `webRuntime` LEFT THIS LIST (the defect this row fixes, measured 2026-10-17): cordis delays a
 * row's apply until every injected service is ACTIVE, and harness 0.2.1-rc.2 provides no `webRuntime`
 * at all — the row therefore never applied and the boot printed
 * `mpd-better-sidebar ... pending (waiting for service: webRuntime)`. The name is now resolved by
 * {@link probeSidebarSeam} at apply time, and the host is mounted inside a scoped inject that declares
 * it, so the property is available to the host on the generation that still provides it.
 *
 * It is restated rather than imported because a static import would have to name a path that exists
 * in BOTH install layouts (the checkout ships the host under `<bundle>/node_modules`, a packed
 * install gets it in the profile's), and the dynamic import that solves that cannot produce a static
 * export. The bundle PINS the host's version (`dsh-better-sidebar@0.24.1`), and
 * `test/host-contract.test.ts` compares this list with the shipped package's own (minus the probed
 * seam) whenever that package is resolvable — so a version bump that changes the list fails a test
 * instead of starving the host in silence.
 */
export const inject: string[] = dshSeamInject(DSH_SEAM_WEB_SERVER, DSH_SEAM_SESSIONS, DSH_SEAM_TOOLS)

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
  } catch (error) {
    say(scoped, "warn", "apply failed: " + messageOf(error))
  }
}

/**
 * Import the host and delegate one cordis apply to it through the probed seam.
 *
 * The row ALWAYS applies (its inject list names only services both generations provide), and it either
 * mounts the host inside the armed scope or writes down why it disabled itself. It never waits for a
 * service that no build provides, and it never claims a sidebar it did not mount.
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
  say(ctx, "info", `seam armed: ${DSH_SEAM_WEB_RUNTIME}.trustedHosts (${String(decision.service.trustedHosts.length)} trusted authorities); ${decision.detail}`)
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
  // scope that declared it in `inject` (measured: `ctx.webRuntime` on a non-injecting scope throws
  // `cannot get property "webRuntime" without inject` even while the service is registered), and the
  // pinned host reads `ctx.webRuntime.trustedHosts` on every request. Handing the host the row's own
  // ctx would therefore surface as a per-request throw; the scoped inject makes the property real.
  try {
    ctx.inject([DSH_SEAM_WEB_RUNTIME], (scoped: SidebarApplyContext): void => {
      void mountHost(host, scoped, config)
    })
  } catch (error) {
    say(ctx, "warn", `disabled: could not inject ${DSH_SEAM_WEB_RUNTIME}: ${messageOf(error)}`)
  }
}
