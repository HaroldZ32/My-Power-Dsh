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

export const name = "@mpd-dsh/mpd"
export const inject: string[] = []

/** The adapter's agentless workspace resolver, probed PER REQUEST (this row's order is not ours). */
function workspaceResolver(ctx: any): { workspaceRootsAll: () => string[]; workspaceRoot: () => string } {
  const rootsAll = (): string[] => {
    try {
      const adapter = typeof ctx?.get === "function" ? ctx.get("mpdDsh", false) : undefined
      const roots = typeof adapter?.workspaceRootsAll === "function" ? adapter.workspaceRootsAll() : undefined
      if (Array.isArray(roots) && roots.length > 0) {
        return roots.filter((root: unknown) => typeof root === "string" && root !== "")
      }
    } catch {
      // a broken resolver must not take the route down: fall through to the env
    }
    const fromEnv = typeof process.env.DSH_WORKSPACE_ROOT === "string" ? process.env.DSH_WORKSPACE_ROOT : ""
    return [fromEnv !== "" ? fromEnv : process.cwd()]
  }
  const root = (): string => {
    try {
      const adapter = typeof ctx?.get === "function" ? ctx.get("mpdDsh", false) : undefined
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
      const config = typeof ctx?.get === "function" ? ctx.get("mpdConfig", false) : undefined
      const value = typeof config?.get === "function" ? config.get("team.stateDir") : undefined
      if (typeof value === "string" && value.trim() !== "") return value.trim()
    } catch {
      // an absent or broken config service keeps the default
    }
    return DEFAULT_TEAM_STATE_DIR
  }
}

function apply(ctx: any): void {
  // Soft probe: a profile without a web server (headless, CLI) keeps this a marker plugin.
  let webServer: any
  try {
    webServer = typeof ctx?.get === "function" ? ctx.get("webServer", false) : undefined
  } catch {
    webServer = undefined
  }
  if (webServer === undefined || typeof webServer.register !== "function") return
  if (typeof ctx?.effect !== "function") return
  const workspace = workspaceResolver(ctx)
  const result = registerWatchdogRoutes(webServer, {
    roots: () => workspace.workspaceRootsAll(),
    stateDir: stateDirResolver(ctx),
    effect: (fn: () => unknown, label: string) => ctx.effect(fn, label),
  })
  if (!result.state) {
    console.warn("[mpd] the web server refused the watchdog routes — the stuck-team banner has no data source")
  }
}

export { apply, WATCHDOG_WEB_READER }
