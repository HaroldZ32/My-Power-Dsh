// Seam 4 — the runtime theme registry: register the MPD palette the package ships.
//
// The host ALSO reads static theme files from `~/.dsh-tui/themes/<name>.json` (the guide's
// zero-code path). This module is the LIVE path: the palette becomes pickable without the user
// copying anything, and its lifetime is this plugin's activation — the host binds the registration
// to the caller and drops it on unload.
//
// HONESTY (the T10-F1 class): the host answers an invalid or DUPLICATE descriptor with an inert
// disposer, never a throw, and its plugin face exposes no read-back (`getSnapshot` is host-only).
// A returned disposer therefore proves nothing, so the seam reports `requested`, never `confirmed`;
// what IS verified here is that `register` was callable and did not throw.
import { effectOn } from "../../mpd-tui-adapter-plugin/src/index.js"
import type { Log } from "./log.js"
import type { PluginContextLike, SeamOutcome, TuiAdapter, TuiThemeDescriptorLike, TuiThemesLike } from "./types.js"

/**
 * The palette `themes/mpd-tui.json` ships, byte-identical to that asset.
 *
 * The two copies exist for two delivery paths (a user may copy the JSON into
 * `~/.dsh-tui/themes/`, and this registration makes it live without a copy); `theme.test.ts` asserts
 * they never drift. Every colour key is one of the host's own `Theme` keys, and `base: "dark"` is
 * one of its built-in palettes.
 */
export const MPD_THEME: TuiThemeDescriptorLike = Object.freeze({
  name: "mpd-tui",
  displayName: "MPD 终端 (MPD terminal)",
  base: "dark",
  colors: Object.freeze({
    accent: "#7FB6E8",
    accentShimmer: "#A9D0F5",
    permission: "#E0B36A",
    promptBorder: "#5C7A99",
    text: "#E6EAF0",
    inactive: "#9AA6B2",
    subtle: "#7C8894",
    selectionBg: "#2C3E50",
    success: "#8FD1A4",
    error: "#E08A8A",
    warning: "#E3C77E",
  }),
})

/** The seam handle: the one outcome this registration can honestly report. */
export interface ThemeSeam {
  /** The measured result, as the boot diagnostic reports it. */
  outcome(): SeamOutcome
}

/**
 * Register {@link MPD_THEME} through the TUI adapter's theme seam.
 *
 * The registration is attempted when the `tuiThemes` service binds (it may bind after `apply`
 * returns), owned by the activation through `effectOn`, and never throws: a host without the seam,
 * or one whose registry refuses the call, degrades to one diagnostic line.
 * @param ctx - the plugin context; the host records it as the registration's identity and owner.
 * @param tui - the DSH-TUI seam adapter (this file names no seam id of its own).
 * @param log - diagnostics.
 * @returns the seam handle.
 */
export function registerTheme(ctx: PluginContextLike, tui: TuiAdapter, log: Log): ThemeSeam {
  /** What this registration measured; `absent` until the seam binds and answers. */
  let outcome: SeamOutcome = { id: "themes", state: "absent", detail: "the theme registry is not composed" }
  tui.whenBound("themes", (service) => {
    /** The bound registry, read as the adapter's own shape. */
    const registry = service as TuiThemesLike | undefined
    if (typeof registry?.register !== "function") {
      outcome = { id: "themes", state: "refused", detail: "the bound theme registry exposes no register()" }
      return
    }
    try {
      /** The host's handle; an invalid or duplicate descriptor also returns an inert one. */
      const disposer = registry.register(MPD_THEME, ctx)
      if (typeof disposer === "function") effectOn(ctx, disposer, `mpd-tui theme ${MPD_THEME.name}`)
      outcome = { id: "themes", state: "requested", detail: `theme ${MPD_THEME.name} handed to the registry (the plugin face has no read-back)` }
    } catch (error) {
      outcome = { id: "themes", state: "refused", detail: String((error as Error)?.message ?? error) }
    }
  })
  log.debug(`theme ${MPD_THEME.name}: registration requested through the theme seam`)
  return { outcome: (): SeamOutcome => outcome }
}
