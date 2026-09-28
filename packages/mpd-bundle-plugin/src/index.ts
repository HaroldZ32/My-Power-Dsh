// mpd-bundle-plugin: the @mpd-dsh/mpd bundle's own main plugin + web client host
// surface. The bundle package's `main` must be a plain, dependency-free plugin:
// the bundle patch's self-registration row (`- id: mpd-web-compat` /
// `name: '@mpd-dsh/mpd'`, mirroring how @linxin666/dsh-web-ui-all registers its own
// web-ui-compat row) turns this plugin into a loader entry named `@mpd-dsh/mpd`,
// which is what the client-modules registry REQUIRES to build a boot-graph client
// row for the bundle (the row name, not the plugin export, names the entry).
//
// It is ALSO the server half of the bundle's web surface: the stuck-team front door's
// two routes are registered here (src/watchdog-web.ts), because a browser client cannot
// read the workspace store itself and the watchdog package is not ours to edit. Everything
// is soft-probed and effect-owned, so a webless profile keeps this plugin a pure marker.
import { registerWatchdogRoutes, WATCHDOG_WEB_READER, DEFAULT_TEAM_STATE_DIR } from "./watchdog-web.js"

/** The loader entry id the bundle patch's self-registration row names. */
export const name = "@mpd-dsh/mpd"
/** No declared dependencies: every seam below is soft-probed, so a webless profile keeps this a pure marker. */
export const inject: string[] = []

/** The adapter's agentless workspace resolver, probed PER REQUEST (this row's order is not ours). */
function workspaceResolver(ctx: any): { workspaceRootsAll: () => string[]; workspaceRoot: () => string } {
  /** Every live session workspace, with an env/cwd fallback when the adapter cannot answer. */
  const rootsAll = (): string[] => {
    try {
      /** The adapter's agentless resolver, read per request because this row's order is not ours. */
      const adapter = typeof ctx?.get === "function" ? ctx.get("mpdDsh", false) : undefined
      /** What the resolver answered; anything that is not a non-empty string array falls through. */
      const roots = typeof adapter?.workspaceRootsAll === "function" ? adapter.workspaceRootsAll() : undefined
      if (Array.isArray(roots) && roots.length > 0) {
        return roots.filter((root: unknown) => typeof root === "string" && root !== "")
      }
    } catch {
      // a broken resolver must not take the route down: fall through to the env
    }
    /** The workspace override from the environment, or "" so the cwd fallback below is explicit. */
    const fromEnv = typeof process.env.DSH_WORKSPACE_ROOT === "string" ? process.env.DSH_WORKSPACE_ROOT : ""
    return [fromEnv !== "" ? fromEnv : process.cwd()]
  }
  /** The one root a writer-side route should use. */
  const root = (): string => {
    try {
      /** The adapter's single-root resolver, probed afresh for this request. */
      const adapter = typeof ctx?.get === "function" ? ctx.get("mpdDsh", false) : undefined
      /** What it answered; only a non-empty string is accepted, anything else falls through. */
      const one = typeof adapter?.workspaceRoot === "function" ? adapter.workspaceRoot() : undefined
      if (typeof one === "string" && one !== "") return one
    } catch {
      // same fallback as above
    }
    return rootsAll()[0] ?? process.cwd()
  }
  return { workspaceRootsAll: rootsAll, workspaceRoot: root }
}

/** The team state dir, from the config service when it is mounted, else the documented default. */
function stateDirResolver(ctx: any): () => string {
  return () => {
    try {
      /** The runtime config service, when the composition mounted one. */
      const config = typeof ctx?.get === "function" ? ctx.get("mpdConfig", false) : undefined
      /** The configured state dir, accepted only as a non-blank string. */
      const value = typeof config?.get === "function" ? config.get("team.stateDir") : undefined
      if (typeof value === "string" && value.trim() !== "") return value.trim()
    } catch {
      // an absent or broken config service keeps the default
    }
    return DEFAULT_TEAM_STATE_DIR
  }
}

/**
 * Resolve the web server for THIS row, once per successful registration.
 *
 * The `webServer` service is provided by ANOTHER plugin whose fiber activates
 * independently of ours, so a ONE-SHOT `ctx.get` probe at apply() time RACES it
 * and loses on a composition where the server's row mounts later — measured on a
 * live profile (`@linxin666/dsh-web-all` + this bundle): `/plugins/mpd-workmate/*`
 * answered 200 while this plugin's own `/plugins/mpd-team-watchdog/state` answered
 * 404, because this file gave up where `mpd-workmate-plugin` retried.
 *
 * `internal/service` is the runtime's own binding event, so the resolver is
 * re-entered on every later bind and the routes can never be silently lost.
 * `httpServer` stays a fallback name (older hosts bind the same surface there).
 */
function webServerOf(dsh: any, ctx: any): any {
  // THROUGH THE ADAPTER. The web-server service is a harness seam like any other, and this row was
  // the last place in the bundle reading it directly; the adapter owns the two names it may bind
  // under and the tolerant probe.
  if (dsh !== undefined && typeof dsh.webServerOf === "function") {
    try {
      return dsh.webServerOf()
    } catch {
      return undefined
    }
  }
  return undefined
}

import { resolveDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"

/**
 * Register the watchdog routes when a web server exists, and re-register them on every later bind.
 *
 * @param ctx - the row context; the adapter and the two resolvers are read from it, never cached.
 */
function apply(ctx: any): void {
  // The adapter, resolved the way every other mpd row resolves it (AGENTS.md §6).
  const dsh: any = resolveDshAdapter(ctx)
  /** Whether the routes are already bound, so a later rebind cannot register them twice. */
  let registered = false
  /**
   * Bind the watchdog routes to the web server; retried until one answers.
   * @returns whether the routes are registered now.
   */
  const registerRoutes = (): boolean => {
    if (registered) return true
    // No web server (headless, CLI) and no effect seam both keep this a marker plugin.
    if (typeof ctx?.effect !== "function") return false
    /** The server for this attempt; absent or non-registering keeps this plugin a pure marker. */
    const webServer = webServerOf(dsh, ctx)
    if (webServer === undefined || typeof webServer.register !== "function") return false
    /** The workspace resolver this registration hands the routes; it is read freshly per request. */
    const workspace = workspaceResolver(ctx)
    /** What the registration reported, i.e. which of the two routes this server accepted. */
    const result = registerWatchdogRoutes(webServer, {
      roots: () => workspace.workspaceRootsAll(),
      stateDir: stateDirResolver(ctx),
      effect: (fn: () => unknown, label: string) => ctx.effect(fn, label),
    })
    if (!result.state) {
      // A refusal stays retryable: a later rebind may accept the same routes.
      console.warn("[mpd] the web server refused the watchdog routes — the stuck-team banner has no data source")
      return false
    }
    registered = true
    return true
  }
  registerRoutes()
  // The REBIND subscription goes through the adapter too: `internal/service` is the runtime's own
  // binding event, and the adapter owns which service names count as "the web server".
  if (dsh !== undefined && typeof dsh.onServiceBound === "function") {
    dsh.onServiceBound(["webServer", "httpServer"], () => { registerRoutes() })
  }
}

export { apply, WATCHDOG_WEB_READER }
